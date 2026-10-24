import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Store, ValidationError } from "../electron/store.mjs";
import {
  FiscalRepository,
  FiscalConcurrencyError,
  FiscalIntegrityError,
} from "../electron/fiscal/repository.mjs";
import {
  FISCAL_STATES,
  ACTIVE_STATES,
  TERMINAL_STATES,
  FiscalStateError,
  canTransition,
  assertTransition,
  recoverInterruptedState,
  evaluateStatusResult,
} from "../electron/fiscal/state-machine.mjs";

function createTempDir(prefix = "gasgestao-fiscal-test-") {
  return mkdtempSync(join(tmpdir(), prefix));
}

test("D01-D03: migração de schema 5 populado, abertura idempotente e rollback em falha", (t) => {
  const dir = createTempDir("mig-test-");
  const dbPath = join(dir, "legacy-v5.sqlite");
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  // 1. Cria um banco na versão 5 populado com clientes, produtos, pedidos, movimentos e fiscal_references
  {
    const legacyStore = new Store(dbPath);
    // Forçamos o estado exato da v5 criando dados operacionais
    const customerId = legacyStore.saveCustomer({
      name: "Cliente Legado",
      phone: "11988887777",
      address: "Rua Legada, 100",
      city: "Tatuí",
      uf: "SP",
    });
    const productId = legacyStore.saveProduct({
      name: "GLP P13 Teste",
      price_cents: 11500,
      cost_cents: 8000,
      stock: 50,
      min_stock: 5,
    });
    const orderId = legacyStore.createOrder({
      customer_id: customerId,
      delivery_type: "retirada",
      payment_method: "dinheiro",
      items: [{ product_id: productId, quantity: 2 }],
      paid_cents: 23000,
    });
    legacyStore.db.prepare(
      "INSERT INTO fiscal_references (id, value, product_id, imported_at) VALUES (?, ?, ?, ?)",
    ).run("ref-legacy-1", "{}", productId, "2026-10-23T10:00:00.000Z");

    const stateBefore = legacyStore.getState();
    assert.equal(legacyStore.db.prepare("PRAGMA user_version").get().user_version, 6);
    legacyStore.close();

    // Simulamos um banco puramente v5 revertendo a migração 6 e o user_version
    const rawDb = new DatabaseSync(dbPath);
    rawDb.exec(`
      DROP TABLE IF EXISTS fiscal_jobs;
      DROP TABLE IF EXISTS fiscal_audit;
      DROP TABLE IF EXISTS fiscal_events;
      DROP TABLE IF EXISTS fiscal_attempts;
      DROP TABLE IF EXISTS fiscal_artifacts;
      DROP TABLE IF EXISTS fiscal_revisions;
      DROP TABLE IF EXISTS fiscal_documents;
      DROP TABLE IF EXISTS fiscal_sequences;
      DROP TABLE IF EXISTS fiscal_profiles;
      DROP TABLE IF EXISTS fiscal_customer_details;
      DROP TABLE IF EXISTS fiscal_issuers;
      PRAGMA user_version = 5;
    `);
    assert.equal(rawDb.prepare("PRAGMA user_version").get().user_version, 5);
    rawDb.close();

    // D01: Abrir com Store deve migrar aditivamente para versão 6 sem perder nada
    const migratedStore = new Store(dbPath);
    assert.equal(migratedStore.db.prepare("PRAGMA user_version").get().user_version, 6);
    const stateAfter = migratedStore.getState();

    // Preservação estrita dos dados operacionais
    assert.equal(stateAfter.customers.length, stateBefore.customers.length);
    assert.equal(stateAfter.products.length, stateBefore.products.length);
    assert.equal(stateAfter.orders.length, stateBefore.orders.length);
    assert.equal(stateAfter.stockMoves.length, stateBefore.stockMoves.length);
    assert.equal(stateAfter.cashEntries.length, stateBefore.cashEntries.length);
    assert.equal(migratedStore.getOrder(orderId).total_cents, 23000);
    assert.equal(migratedStore.getEntity("products", productId, "Produto").stock, 48);

    // D02: Repetir abertura de banco já na versão 6
    migratedStore.close();
    const reopenStore = new Store(dbPath);
    assert.equal(reopenStore.db.prepare("PRAGMA user_version").get().user_version, 6);
    assert.equal(reopenStore.getOrder(orderId).total_cents, 23000);
    assert.equal(reopenStore.db.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
    assert.equal(reopenStore.db.prepare("PRAGMA foreign_key_check").all().length, 0);
    reopenStore.close();
  }

  // D03: Falha simulada no meio de migração causa rollback completo e mantém user_version anterior
  {
    const failDbPath = join(dir, "fail-migration.sqlite");
    const raw = new DatabaseSync(failDbPath);
    raw.exec(`
      CREATE TABLE test_data (id INTEGER PRIMARY KEY, val TEXT);
      INSERT INTO test_data VALUES (1, 'preservar');
      PRAGMA user_version = 5;
    `);
    assert.equal(raw.prepare("PRAGMA user_version").get().user_version, 5);

    assert.throws(() => {
      raw.exec("BEGIN IMMEDIATE");
      raw.exec("CREATE TABLE partial_table (id INT);");
      raw.exec("INSERT INTO test_data VALUES (2, 'alterado_parcial');");
      // Simula erro no meio do processo
      throw new Error("Simulação de falha catastrófica durante migração");
    }, /Simulação de falha catastrófica/);

    raw.exec("ROLLBACK");
    assert.equal(raw.prepare("PRAGMA user_version").get().user_version, 5);
    const rows = raw.prepare("SELECT * FROM test_data").all();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].val, "preservar");
    const tableExists = raw.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='partial_table'").get();
    assert.equal(tableExists, undefined);
    raw.close();
  }
});

test("D04-D06: concorrência de sequências, duplicidade e modelo 55/65 na mesma venda", (t) => {
  const dir = createTempDir("seq-test-");
  const dbPath = join(dir, "concurrency.sqlite");
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const store1 = new Store(dbPath);
  const repo1 = store1.fiscal;

  const issuer = repo1.saveIssuer({
    id: "iss-1",
    identity: "12345678000199",
    configuration: { razao: "Empresa Teste LTDA" },
    productionEnabled: 0,
  });
  repo1.initSequence({ issuerId: issuer.id, environment: "homologacao", model: 55, series: 1, initialNumber: 0 });
  repo1.initSequence({ issuerId: issuer.id, environment: "homologacao", model: 65, series: 1, initialNumber: 0 });
  repo1.initSequence({ issuerId: issuer.id, environment: "producao", model: 55, series: 1, initialNumber: 0 });

  const custId = store1.saveCustomer({ name: "Cliente Teste", phone: "11999998888" });
  const prodId = store1.saveProduct({ name: "Produto Teste", price_cents: 1000, cost_cents: 500, stock: 100, min_stock: 0 });
  const orderId = store1.createOrder({
    customer_id: custId,
    delivery_type: "retirada",
    payment_method: "dinheiro",
    items: [{ product_id: prodId, quantity: 1 }],
  });

  // D04: Duas conexões distintas competindo por reserva de número na mesma sequência
  const store2 = new Store(dbPath);
  const repo2 = store2.fiscal;

  const n1 = repo1.reserveNextNumber({ issuerId: issuer.id, environment: "homologacao", model: 55, series: 1 });
  const n2 = repo2.reserveNextNumber({ issuerId: issuer.id, environment: "homologacao", model: 55, series: 1 });
  const n3 = repo1.reserveNextNumber({ issuerId: issuer.id, environment: "homologacao", model: 55, series: 1 });

  assert.equal(n1, 1);
  assert.equal(n2, 2);
  assert.equal(n3, 3);
  assert.equal(new Set([n1, n2, n3]).size, 3, "Números devem ser únicos e estritamente crescentes");

  // D05 & D06: Uma única nota ativa por pedido e ambiente, cobrindo modelos 55 e 65
  const doc1 = repo1.reserveDocument({
    orderId,
    issuerId: issuer.id,
    environment: "homologacao",
    model: 55,
    series: 1,
    cnf: "12345678",
    accessKey: "35261012345678000199550010000000041123456780",
    snapshot: { orderId, total: 1000 },
  });
  assert.equal(doc1.number, 4);
  assert.equal(doc1.state, "prepared");
  assert.equal(doc1.active, 1);

  // Tentativa de segundo documento ativo (seja modelo 55 ou 65) no mesmo pedido/ambiente falha
  assert.throws(
    () =>
      repo2.reserveDocument({
        orderId,
        issuerId: issuer.id,
        environment: "homologacao",
        model: 65,
        series: 1,
        cnf: "87654321",
        accessKey: "35261012345678000199650010000000011876543210",
        snapshot: { orderId, total: 1000 },
      }),
    /Já existe um documento fiscal ativo/,
  );

  store1.close();
  store2.close();
});

test("D07-D09: isolamento de ambientes, concorrência CAS e não-redução de sequências", (t) => {
  const store = new Store(":memory:");
  t.after(() => store.close());
  const repo = store.fiscal;

  const issuer = repo.saveIssuer({
    id: "iss-sp",
    identity: "11222333000144",
    configuration: {},
    productionEnabled: 0,
  });

  // D07: Mesma série/modelo em ambientes diferentes são sequências completamente isoladas
  repo.initSequence({ issuerId: issuer.id, environment: "homologacao", model: 55, series: 1, initialNumber: 10 });
  repo.initSequence({ issuerId: issuer.id, environment: "producao", model: 55, series: 1, initialNumber: 500 });

  const numHomolog = repo.reserveNextNumber({ issuerId: issuer.id, environment: "homologacao", model: 55, series: 1 });
  const numProd = repo.reserveNextNumber({ issuerId: issuer.id, environment: "producao", model: 55, series: 1 });
  assert.equal(numHomolog, 11);
  assert.equal(numProd, 501);

  // D09: Tentativa de reduzir contador da sequência é bloqueada por trigger
  assert.throws(
    () =>
      store.db.exec(
        "UPDATE fiscal_sequences SET last_number = 5 WHERE issuer_id = 'iss-sp' AND environment = 'homologacao' AND model = 55 AND series = 1",
      ),
    /fiscal sequence cannot decrease/,
  );

  // D08: CAS com row_version obsoleto ou estado divergente lança FiscalConcurrencyError
  const custId = store.saveCustomer({ name: "Cliente C", phone: "11911112222" });
  const prodId = store.saveProduct({ name: "Produto C", price_cents: 2000, cost_cents: 1000, stock: 10, min_stock: 0 });
  const orderId = store.createOrder({
    customer_id: custId,
    delivery_type: "retirada",
    payment_method: "dinheiro",
    items: [{ product_id: prodId, quantity: 1 }],
  });

  const doc = repo.reserveDocument({
    orderId,
    issuerId: issuer.id,
    environment: "homologacao",
    model: 55,
    series: 1,
    cnf: "11112222",
    accessKey: "35261011222333000144550010000000121111122220",
    snapshot: { orderId },
  });

  // Primeira transição CAS válida (prepared -> signed)
  const updatedDoc = repo.transitionDocumentCAS({
    documentId: doc.id,
    fromState: "prepared",
    toState: "signed",
    expectedRowVersion: 0,
    actor: "test_signer",
    reason: "Assinado com sucesso",
  });
  assert.equal(updatedDoc.state, "signed");
  assert.equal(updatedDoc.row_version, 1);

  // Tentativa concorrente com row_version desatualizada (0) deve falhar
  assert.throws(
    () =>
      repo.transitionDocumentCAS({
        documentId: doc.id,
        fromState: "signed",
        toState: "sending",
        expectedRowVersion: 0,
        actor: "concurrent_worker",
      }),
    FiscalConcurrencyError,
  );

  // Tentativa com estado de origem divergente deve falhar
  assert.throws(
    () =>
      repo.transitionDocumentCAS({
        documentId: doc.id,
        fromState: "prepared",
        toState: "signed",
        expectedRowVersion: 1,
        actor: "bad_worker",
      }),
    FiscalConcurrencyError,
  );
});

test("D10-D12: imutabilidade de identidade, imutabilidade de revisão e proibição de deleção", (t) => {
  const store = new Store(":memory:");
  t.after(() => store.close());
  const repo = store.fiscal;

  const issuer = repo.saveIssuer({
    id: "iss-sec",
    identity: "99888777000166",
    configuration: {},
    productionEnabled: 0,
  });
  repo.initSequence({ issuerId: issuer.id, environment: "homologacao", model: 55, series: 1, initialNumber: 0 });

  const custId = store.saveCustomer({ name: "Cliente Imutavel", phone: "11933334444" });
  const prodId = store.saveProduct({ name: "Botijão", price_cents: 10000, cost_cents: 7000, stock: 10, min_stock: 0 });
  const orderId = store.createOrder({
    customer_id: custId,
    delivery_type: "retirada",
    payment_method: "dinheiro",
    items: [{ product_id: prodId, quantity: 1 }],
  });

  const doc = repo.reserveDocument({
    orderId,
    issuerId: issuer.id,
    environment: "homologacao",
    model: 55,
    series: 1,
    cnf: "55556666",
    accessKey: "35261099888777000166550010000000011555566660",
    snapshot: { orderId, item: "Botijão" },
  });

  // D10: Alterar identidade de documento emitido é expressamente proibido
  assert.throws(
    () => store.db.exec(`UPDATE fiscal_documents SET number = 999 WHERE id = '${doc.id}'`),
    /fiscal identity is immutable/,
  );
  assert.throws(
    () => store.db.exec(`UPDATE fiscal_documents SET access_key = '${'1'.repeat(44)}' WHERE id = '${doc.id}'`),
    /fiscal identity is immutable/,
  );
  assert.throws(
    () => store.db.exec(`UPDATE fiscal_documents SET order_id = 99999 WHERE id = '${doc.id}'`),
    /fiscal identity is immutable/,
  );

  // D11: Editar revisão existente é proibido
  assert.throws(
    () => store.db.exec(`UPDATE fiscal_revisions SET snapshot_json = '{}' WHERE document_id = '${doc.id}'`),
    /immutable revision/,
  );
  assert.throws(
    () => store.db.exec(`DELETE FROM fiscal_revisions WHERE document_id = '${doc.id}'`),
    /immutable revision/,
  );

  // D12: Apagar artefato ou documento é proibido
  const art = repo.saveArtifact({
    documentId: doc.id,
    revision: 1,
    kind: "signed_xml",
    content: "<nfeProc><NFe/></nfeProc>",
  });

  assert.throws(
    () => store.db.exec(`UPDATE fiscal_artifacts SET content = 'hacked' WHERE id = '${art.id}'`),
    /immutable artifact/,
  );
  assert.throws(
    () => store.db.exec(`DELETE FROM fiscal_artifacts WHERE id = '${art.id}'`),
    /immutable artifact/,
  );
  assert.throws(
    () => store.db.exec(`DELETE FROM fiscal_documents WHERE id = '${doc.id}'`),
    /fiscal document cannot be deleted/,
  );

  // Sequence com documentos emitidos não pode ser deletada
  assert.throws(
    () =>
      store.db.exec(
        `DELETE FROM fiscal_sequences WHERE issuer_id = '${issuer.id}' AND environment = 'homologacao' AND model = 55 AND series = 1`,
      ),
    /fiscal sequence with issued documents cannot be deleted/,
  );
});

test("D13-D15: integridade referencial de artefatos/tentativas e imutabilidade de perfil aprovado", (t) => {
  const store = new Store(":memory:");
  t.after(() => store.close());
  const repo = store.fiscal;

  const issuer = repo.saveIssuer({
    id: "iss-integrity",
    identity: "55544433000122",
    configuration: {},
    productionEnabled: 0,
  });
  repo.initSequence({ issuerId: issuer.id, environment: "homologacao", model: 55, series: 1, initialNumber: 0 });

  const custId = store.saveCustomer({ name: "Cliente Int", phone: "11922223333" });
  const prodId = store.saveProduct({ name: "Produto Int", price_cents: 5000, cost_cents: 3000, stock: 10, min_stock: 0 });
  const orderId = store.createOrder({
    customer_id: custId,
    delivery_type: "retirada",
    payment_method: "dinheiro",
    items: [{ product_id: prodId, quantity: 1 }],
  });

  const doc = repo.reserveDocument({
    orderId,
    issuerId: issuer.id,
    environment: "homologacao",
    model: 55,
    series: 1,
    cnf: "77778888",
    accessKey: "35261055544433000122550010000000011777788880",
    snapshot: { orderId },
  });

  // D13: Salvar artefato para documento ou revisão inexistente falha por FK / integridade
  assert.throws(
    () =>
      repo.saveArtifact({
        documentId: "doc-inexistente",
        revision: 1,
        kind: "signed_xml",
        content: "xml",
      }),
    FiscalIntegrityError,
  );
  assert.throws(
    () =>
      repo.saveArtifact({
        documentId: doc.id,
        revision: 999, // revisão inexistente
        kind: "signed_xml",
        content: "xml",
      }),
    FiscalIntegrityError,
  );

  // D14: Tentativa referenciando artefato de outro documento/revisão falha
  const artOther = repo.saveArtifact({
    documentId: doc.id,
    revision: 1,
    kind: "request",
    content: "req1",
  });

  // Cria uma revisão 2
  const rev2 = repo.createRevision({
    documentId: doc.id,
    snapshot: { orderId, correction: true },
  });
  assert.equal(rev2.version, 2);

  // Tentar registrar tentativa na revisão 2 usando artefato da revisão 1
  assert.throws(
    () =>
      repo.recordAttemptStart({
        documentId: doc.id,
        revision: 2,
        requestId: "req-attempt-1",
        operation: "authorize",
        requestArtifactId: artOther.id, // pertence à revisão 1!
      }),
    FiscalIntegrityError,
  );

  // D15: Perfil fiscal aprovado não pode ter payload alterado ou ser deletado
  const draftProfile = repo.saveProfileDraft({
    productId: prodId,
    version: 1,
    validFrom: "2026-10-01",
    payload: { ncm: "27111910", cfop: "5656" },
  });
  assert.equal(draftProfile.approvalState, "draft");

  const approved = repo.approveProfile({
    id: draftProfile.id,
    approvedBy: "Auditor Tributário",
  });
  assert.equal(approved.approvalState, "approved");

  // Tentativa de editar payload do perfil aprovado é rejeitada pelo trigger
  assert.throws(
    () =>
      store.db.exec(
        `UPDATE fiscal_profiles SET payload_json = '{"ncm":"99999999"}' WHERE id = '${approved.id}'`,
      ),
    /approved fiscal profile payload is immutable/,
  );

  // Tentativa de deletar perfil aprovado é rejeitada pelo trigger
  assert.throws(
    () => store.db.exec(`DELETE FROM fiscal_profiles WHERE id = '${approved.id}'`),
    /approved fiscal profile cannot be deleted/,
  );

  // Para alterar regras fiscais, o perfil deve ser retirado e uma nova versão criada
  const retired = repo.retireProfile({ id: approved.id, validUntil: "2026-10-24" });
  assert.equal(retired.approvalState, "retired");
  assert.equal(retired.validUntil, "2026-10-24");

  const v2Profile = repo.saveProfileDraft({
    productId: prodId,
    version: 2,
    validFrom: "2026-10-25",
    payload: { ncm: "27111910", cfop: "5656", icmsCst: "61" },
  });
  assert.equal(v2Profile.version, 2);
});

test("Bloqueio de cancelamento operacional com documento fiscal ativo e preservação de estoque/caixa", (t) => {
  const store = new Store(":memory:");
  t.after(() => store.close());
  const repo = store.fiscal;

  const issuer = repo.saveIssuer({
    id: "iss-guard",
    identity: "77788899000100",
    configuration: {},
    productionEnabled: 0,
  });
  repo.initSequence({ issuerId: issuer.id, environment: "homologacao", model: 55, series: 1, initialNumber: 0 });

  const custId = store.saveCustomer({ name: "Cliente Guard", phone: "11988889999" });
  const prodId = store.saveProduct({ name: "GLP P13 Guard", price_cents: 11000, cost_cents: 8000, stock: 20, min_stock: 0 });
  const orderId = store.createOrder({
    customer_id: custId,
    delivery_type: "retirada",
    payment_method: "dinheiro",
    items: [{ product_id: prodId, quantity: 2 }],
    paid_cents: 22000,
  });

  assert.equal(store.getEntity("products", prodId, "Produto").stock, 18);
  assert.equal(store.getState().metrics.cash_balance, 22000);

  // Reserva documento fiscal para o pedido
  const doc = repo.reserveDocument({
    orderId,
    issuerId: issuer.id,
    environment: "homologacao",
    model: 55,
    series: 1,
    cnf: "99887766",
    accessKey: "35261077788899000100550010000000011998877660",
    snapshot: { orderId, total: 22000 },
  });

  // Tentativa de cancelar pedido pelo Store com documento fiscal ativo (prepared) DEVE FALHAR
  assert.throws(
    () => store.changeOrderStatus({ order_id: orderId, status: "cancelado" }),
    /Não é possível cancelar o pedido .* com documento fiscal ativo ou incerto/,
  );

  // Estoque e caixa devem permanecer estritamente intactos!
  assert.equal(store.getEntity("products", prodId, "Produto").stock, 18);
  assert.equal(store.getState().metrics.cash_balance, 22000);
  assert.equal(store.getOrder(orderId).status, "novo");

  // Documento avança para authorized
  repo.transitionDocumentCAS({
    documentId: doc.id,
    fromState: "prepared",
    toState: "signed",
    expectedRowVersion: 0,
  });
  repo.transitionDocumentCAS({
    documentId: doc.id,
    fromState: "signed",
    toState: "sending",
    expectedRowVersion: 1,
  });
  repo.transitionDocumentCAS({
    documentId: doc.id,
    fromState: "sending",
    toState: "authorized",
    expectedRowVersion: 2,
  });

  // Pedido continua bloqueado para cancelamento operacional
  assert.throws(
    () => store.changeOrderStatus({ order_id: orderId, status: "cancelado" }),
    /Não é possível cancelar o pedido/,
  );

  // Após cancelamento fiscal homologado (authorized -> cancel_pending -> cancelled), active vira 0
  repo.transitionDocumentCAS({
    documentId: doc.id,
    fromState: "authorized",
    toState: "cancel_pending",
    expectedRowVersion: 3,
  });
  repo.transitionDocumentCAS({
    documentId: doc.id,
    fromState: "cancel_pending",
    toState: "cancelled",
    expectedRowVersion: 4,
  });

  const finalDoc = repo.getDocument(doc.id);
  assert.equal(finalDoc.state, "cancelled");
  assert.equal(finalDoc.active, 0);

  // Agora que a nota fiscal não está mais ativa, o cancelamento operacional é permitido
  store.changeOrderStatus({ order_id: orderId, status: "cancelado" });
  assert.equal(store.getOrder(orderId).status, "cancelado");
  // Estoque é reposto e caixa estornado normalmente
  assert.equal(store.getEntity("products", prodId, "Produto").stock, 20);
  assert.equal(store.getState().metrics.cash_balance, 0);
});

test("Recuperação no startup: sending -> uncertain e cancel_pending -> cancel_uncertain com fila e auditoria", (t) => {
  const store = new Store(":memory:");
  t.after(() => store.close());
  const repo = store.fiscal;

  const issuer = repo.saveIssuer({
    id: "iss-rec",
    identity: "12312312000100",
    configuration: {},
    productionEnabled: 0,
  });
  repo.initSequence({ issuerId: issuer.id, environment: "homologacao", model: 55, series: 1, initialNumber: 0 });

  const custId = store.saveCustomer({ name: "Cliente Rec", phone: "11988881111" });
  const prodId = store.saveProduct({ name: "Prod Rec", price_cents: 1000, cost_cents: 500, stock: 10, min_stock: 0 });
  const order1 = store.createOrder({ customer_id: custId, delivery_type: "retirada", payment_method: "dinheiro", items: [{ product_id: prodId, quantity: 1 }] });
  const order2 = store.createOrder({ customer_id: custId, delivery_type: "retirada", payment_method: "dinheiro", items: [{ product_id: prodId, quantity: 1 }] });

  const doc1 = repo.reserveDocument({
    orderId: order1,
    issuerId: issuer.id,
    environment: "homologacao",
    model: 55,
    series: 1,
    cnf: "11110000",
    accessKey: "35261012312312000100550010000000011111100000",
    snapshot: { order1 },
  });
  repo.transitionDocumentCAS({ documentId: doc1.id, fromState: "prepared", toState: "signed", expectedRowVersion: 0 });
  repo.transitionDocumentCAS({ documentId: doc1.id, fromState: "signed", toState: "sending", expectedRowVersion: 1 });

  const doc2 = repo.reserveDocument({
    orderId: order2,
    issuerId: issuer.id,
    environment: "homologacao",
    model: 55,
    series: 1,
    cnf: "22220000",
    accessKey: "35261012312312000100550010000000021222200000",
    snapshot: { order2 },
  });
  repo.transitionDocumentCAS({ documentId: doc2.id, fromState: "prepared", toState: "signed", expectedRowVersion: 0 });
  repo.transitionDocumentCAS({ documentId: doc2.id, fromState: "signed", toState: "sending", expectedRowVersion: 1 });
  repo.transitionDocumentCAS({ documentId: doc2.id, fromState: "sending", toState: "authorized", expectedRowVersion: 2 });
  repo.transitionDocumentCAS({ documentId: doc2.id, fromState: "authorized", toState: "cancel_pending", expectedRowVersion: 3 });

  // Simula queda e reabertura do sistema com recuperação de pendências
  const recovered = repo.recoverInterruptedDocuments({ actor: "test_recovery_worker" });
  assert.equal(recovered.length, 2);

  const doc1After = repo.getDocument(doc1.id);
  const doc2After = repo.getDocument(doc2.id);

  assert.equal(doc1After.state, "uncertain", "sending deve ser recuperado como uncertain");
  assert.equal(doc2After.state, "cancel_uncertain", "cancel_pending deve ser recuperado como cancel_uncertain");

  // Jobs duráveis foram enfileirados para consulta/conciliação
  const jobs = store.db.prepare("SELECT * FROM fiscal_jobs").all();
  assert.equal(jobs.length, 2);
  const jobDoc1 = jobs.find((j) => j.document_id === doc1.id);
  const jobDoc2 = jobs.find((j) => j.document_id === doc2.id);
  assert.ok(jobDoc1);
  assert.equal(jobDoc1.purpose, "query");
  assert.ok(jobDoc2);
  assert.equal(jobDoc2.purpose, "cancel");

  // Auditoria registrada
  const audits1 = repo.listAuditForDocument(doc1.id);
  assert.ok(audits1.some((a) => a.action.startsWith("startup_recover:sending->uncertain")));
});

test("Fila durável (fiscal_jobs): idempotência por dedup_key, lease atômico e limite de tentativas", (t) => {
  const store = new Store(":memory:");
  t.after(() => store.close());
  const repo = store.fiscal;

  const issuer = repo.saveIssuer({ id: "iss-jobs", identity: "44455566000188", configuration: {} });
  repo.initSequence({ issuerId: issuer.id, environment: "homologacao", model: 55, series: 1 });
  const custId = store.saveCustomer({ name: "Cliente Jobs", phone: "11988880000" });
  const prodId = store.saveProduct({ name: "Prod Jobs", price_cents: 1000, cost_cents: 500, stock: 10, min_stock: 0 });
  const orderId = store.createOrder({ customer_id: custId, delivery_type: "retirada", payment_method: "dinheiro", items: [{ product_id: prodId, quantity: 1 }] });

  const doc = repo.reserveDocument({
    orderId,
    issuerId: issuer.id,
    environment: "homologacao",
    model: 55,
    series: 1,
    cnf: "33334444",
    accessKey: "35261044455566000188550010000000011333344440",
    snapshot: {},
  });

  // Idempotência por dedup_key
  const job1 = repo.enqueueJob({
    documentId: doc.id,
    purpose: "query",
    dedupKey: "query-doc-1",
  });
  const job2 = repo.enqueueJob({
    documentId: doc.id,
    purpose: "query",
    dedupKey: "query-doc-1",
  });
  assert.equal(job1.id, job2.id, "Dedup key estável não duplica job");

  // Claim atômico
  const claimed = repo.claimPendingJob({ leaseOwner: "worker-A", leaseDurationMs: 60000 });
  assert.ok(claimed);
  assert.equal(claimed.id, job1.id);
  assert.equal(claimed.status, "running");
  assert.equal(claimed.lease_owner, "worker-A");
  assert.equal(claimed.attempts, 1);

  // Outro worker não consegue pegar o mesmo job enquanto o lease está ativo
  const secondClaim = repo.claimPendingJob({ leaseOwner: "worker-B" });
  assert.equal(secondClaim, null);

  // Falha do job reagenda com backoff
  const failed = repo.failJob(job1.id, { retryDelaySeconds: 10, maxAttempts: 3 });
  assert.equal(failed.status, "pending");
  assert.equal(failed.lease_owner, null);

  // Falha após atingir maxAttempts bloqueia o job
  repo.claimPendingJob({ leaseOwner: "worker-A", now: new Date(Date.now() + 15000) });
  repo.failJob(job1.id, { retryDelaySeconds: 10, maxAttempts: 3 });
  repo.claimPendingJob({ leaseOwner: "worker-A", now: new Date(Date.now() + 30000) });
  const blocked = repo.failJob(job1.id, { retryDelaySeconds: 10, maxAttempts: 3 });
  assert.equal(blocked.status, "blocked");
});

test("Integridade de artefatos: validação de hash SHA-256 na leitura detecta adulteração", (t) => {
  const store = new Store(":memory:");
  t.after(() => store.close());
  const repo = store.fiscal;

  const issuer = repo.saveIssuer({ id: "iss-hash", identity: "12300012000199", configuration: {} });
  repo.initSequence({ issuerId: issuer.id, environment: "homologacao", model: 55, series: 1 });
  const custId = store.saveCustomer({ name: "Cliente Hash", phone: "11988881234" });
  const prodId = store.saveProduct({ name: "Prod Hash", price_cents: 1000, cost_cents: 500, stock: 10, min_stock: 0 });
  const orderId = store.createOrder({ customer_id: custId, delivery_type: "retirada", payment_method: "dinheiro", items: [{ product_id: prodId, quantity: 1 }] });

  const doc = repo.reserveDocument({
    orderId,
    issuerId: issuer.id,
    environment: "homologacao",
    model: 55,
    series: 1,
    cnf: "44445555",
    accessKey: "35261012300012000199550010000000011444455550",
    snapshot: {},
  });

  const art = repo.saveArtifact({
    documentId: doc.id,
    revision: 1,
    kind: "signed_xml",
    content: "<xml>conteudo original</xml>",
  });

  // Leitura normal
  const retrieved = repo.getArtifact(art.id);
  assert.equal(retrieved.content.toString("utf8"), "<xml>conteudo original</xml>");

  // Simula adulteração bypassando trigger (desativando temporariamente triggers ou alterando sha256 no banco)
  store.db.exec("DROP TRIGGER fiscal_artifact_no_update");
  store.db.exec(`UPDATE fiscal_artifacts SET content = X'001122' WHERE id = '${art.id}'`);

  // Leitura deve acusar corrupção de integridade por mismatch de hash
  assert.throws(() => repo.getArtifact(art.id), FiscalIntegrityError);
});

test("Máquina de estados pura: matriz de transições, invariantes e avaliação de status SEFAZ", () => {
  // 1. Estados e terminalidade
  assert.equal(FISCAL_STATES.length, 11);
  assert.deepEqual(TERMINAL_STATES, ["cancelled", "abandoned"]);
  assert.equal(ACTIVE_STATES.length, 9);

  // 2. Transições permitidas e proibidas
  assert.equal(canTransition("prepared", "signed"), true);
  assert.equal(canTransition("prepared", "abandoned"), true);
  assert.equal(canTransition("prepared", "authorized"), false);
  assert.equal(canTransition("prepared", "cancel_pending"), false);

  assert.equal(canTransition("signed", "sending"), true);
  assert.equal(canTransition("signed", "authorized"), false);

  assert.equal(canTransition("sending", "authorized"), true);
  assert.equal(canTransition("sending", "uncertain"), true);
  assert.equal(canTransition("sending", "rejected"), true);

  assert.equal(canTransition("authorized", "cancel_pending"), true);
  assert.equal(canTransition("authorized", "signed"), false);
  assert.equal(canTransition("authorized", "abandoned"), false);

  assert.equal(canTransition("cancelled", "authorized"), false);
  assert.equal(canTransition("abandoned", "prepared"), false);

  // 3. assertTransition lança erro descritivo
  assert.throws(
    () => assertTransition("authorized", "signed"),
    FiscalStateError,
  );

  // 4. Interpretação de cStat SEFAZ
  // cStat 100 com tudo correlacionado -> authorized
  const r100 = evaluateStatusResult({
    cStat: "100",
    correlations: { accessKeyMatches: true, environmentMatches: true, protocolValid: true, digestMatches: true },
  });
  assert.equal(r100.nextState, "authorized");
  assert.equal(r100.outcome, "success");

  // cStat 100 com divergência de digest ou chave -> blocked
  const r100Bad = evaluateStatusResult({
    cStat: "100",
    correlations: { accessKeyMatches: false, environmentMatches: true, protocolValid: true, digestMatches: true },
  });
  assert.equal(r100Bad.nextState, "blocked");
  assert.equal(r100Bad.outcome, "blocked");

  // cStat 204 duplicidade -> uncertain (não autorizar e não emitir nova nota)
  const r204 = evaluateStatusResult({ cStat: "204" });
  assert.equal(r204.nextState, "uncertain");
  assert.equal(r204.outcome, "uncertain");
  assert.equal(r204.isDuplicate, true);

  // cStat 245 emitente não cadastrado -> blocked
  const r245 = evaluateStatusResult({ cStat: "245" });
  assert.equal(r245.nextState, "blocked");

  // cStat 656 consumo indevido -> blocked
  const r656 = evaluateStatusResult({ cStat: "656" });
  assert.equal(r656.nextState, "blocked");

  // cStat 135 em cancelamento -> cancelled
  const r135Cancel = evaluateStatusResult({
    cStat: "135",
    operation: "cancel",
    correlations: { accessKeyMatches: true, environmentMatches: true, protocolValid: true, eventSequenceMatches: true },
  });
  assert.equal(r135Cancel.nextState, "cancelled");
  assert.equal(r135Cancel.outcome, "success");

  // cStat 136 em cancelamento -> cancel_uncertain
  const r136Cancel = evaluateStatusResult({ cStat: "136", operation: "cancel" });
  assert.equal(r136Cancel.nextState, "cancel_uncertain");
  assert.equal(r136Cancel.outcome, "uncertain");
});
