import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../electron/store.mjs";
import { Engagement, whatsappUrl } from "../electron/engagement.mjs";
function setup(t) {
  let clock = "2026-10-23";
  const store = new Store(":memory:", {
    now: () => new Date(`${clock}T15:00:00-03:00`),
  });
  t.after(() => store.close());
  const service = new Engagement(store);
  const customer = store.saveCustomer({
    name: "Maria de teste",
    phone: "11900000001",
    address: "Rua Exemplo, 10",
  });
  const gas = store.saveProduct({
    name: "Gás P13",
    price_cents: 11000,
    cost_cents: 8000,
    stock: 100,
    min_stock: 1,
  });
  const water = store.saveProduct({
    name: "Água 20 L",
    price_cents: 1500,
    cost_cents: 700,
    stock: 100,
    min_stock: 1,
  });
  function buy(day, product = gas, quantity = 1, extra = {}) {
    clock = day;
    const id = store.createOrder({
      customer_id: customer,
      delivery_type: "retirada",
      payment_method: "fiado",
      paid_cents: 0,
      delivery_fee_cents: 0,
      discount_cents: 0,
      items: [{ product_id: product, quantity }],
      ...extra,
    });
    store.changeOrderStatus({ order_id: id, status: "preparando" });
    store.changeOrderStatus({ order_id: id, status: "entregue" });
    clock = "2026-10-23";
    return id;
  }
  function gasHistory() {
    buy("2026-07-25");
    buy("2026-08-24");
    return buy("2026-09-23");
  }
  return {
    store,
    service,
    customer,
    gas,
    water,
    buy,
    gasHistory,
    setDay: (day) => {
      clock = day;
    },
  };
}
test("repetir pedido prepara rascunho sem cobrar nem reservar e usa preços atuais ao confirmar", (t) => {
  const { store, service, customer, gas, buy } = setup(t);
  const source = buy("2026-09-01", gas, 2);
  store.saveProduct({
    ...store.getState().products.find((p) => p.id === gas),
    price_cents: 12500,
  });
  const before = store.getState();
  const draft = service.repeatDraft({ customer_id: customer });
  assert.equal(draft.source_id, source);
  assert.deepEqual(draft.items, [{ product_id: gas, quantity: 2 }]);
  assert.equal(draft.paid_cents, undefined);
  assert.equal(draft.payment_method, undefined);
  assert.deepEqual(store.getState().cashEntries, before.cashEntries);
  assert.equal(store.getState().orders.length, before.orders.length);
  assert.equal(store.getState().products.find((p) => p.id === gas).stock, 98);
  const repeated = store.createOrder({
    ...draft,
    paid_cents: 0,
    payment_method: "pix",
    discount_cents: 0,
  });
  assert.equal(store.getOrder(repeated).total_cents, 25000);
  assert.equal(store.getOrder(repeated).paid_cents, 0);
  assert.equal(store.getOrder(source).total_cents, 22000);
});
test("rascunho avisa estoque/inatividade e rejeita cliente inativo ou pedido cancelado", (t) => {
  const { store, service, customer, gas, buy } = setup(t);
  const source = buy("2026-09-01", gas, 2);
  store.adjustStock({ product_id: gas, delta: -97, note: "Ajuste de teste" });
  assert.match(
    service.repeatDraft({ order_id: source }).warnings[0],
    /estoque atual 1/,
  );
  const product = store.getState().products.find((p) => p.id === gas);
  store.saveProduct({ ...product, active: false });
  assert.match(
    service.repeatDraft({ order_id: source }).warnings[0],
    /inativo/,
  );
  store.saveCustomer({ ...store.getState().customers[0], active: false });
  assert.throws(() => service.repeatDraft({ order_id: source }), /inativo/);
  store.saveCustomer({ ...store.getState().customers[0], active: true });
  store.changeOrderStatus({ order_id: source, status: "cancelado" });
  assert.throws(
    () => service.repeatDraft({ order_id: source }),
    /não cancelado/,
  );
  assert.throws(
    () => service.repeatDraft({ customer_id: customer }),
    /ainda não possui/,
  );
});
test("previsão separa gás de água e aceita média de 4,5 dias com três compras concluídas", (t) => {
  const { service, gas, water, buy, gasHistory } = setup(t);
  gasHistory();
  buy("2026-10-09", water);
  buy("2026-10-14", water);
  buy("2026-10-18", water);
  const gasRow = service.reminders().find((r) => r.product_id === gas),
    waterRow = service.reminders().find((r) => r.product_id === water);
  assert.equal(gasRow.average_days, 30);
  assert.equal(gasRow.due_date, "2026-10-23");
  assert.equal(gasRow.actionable, true);
  assert.equal(waterRow.average_days, 4.5);
  assert.equal(waterRow.expected_days, 5);
  assert.equal(waterRow.actionable, true);
  assert.match(waterRow.message, /Água 20 L/);
  assert.doesNotMatch(waterRow.message, /acabou|está acabando/);
});
test("quantidade maior prolonga estimativa; compras no mesmo dia não inventam intervalos", (t) => {
  const { service, gas, water, buy } = setup(t);
  buy("2026-07-25", gas);
  buy("2026-08-24", gas);
  buy("2026-09-23", gas, 2);
  buy("2026-10-01", water);
  buy("2026-10-01", water);
  buy("2026-10-05", water);
  const rows = service.reminders();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].expected_days, 60);
  assert.equal(rows[0].due_date, "2026-11-22");
  assert.equal(rows[0].actionable, false);
});
test("cancelamentos não contam; pedido em andamento evita lembrete de compra duplicada", (t) => {
  const { store, service, gas, buy, gasHistory, customer } = setup(t);
  gasHistory();
  const cancelled = buy("2026-10-01", gas);
  store.changeOrderStatus({ order_id: cancelled, status: "cancelado" });
  assert.equal(service.reminders()[0].last_purchase, "2026-09-23");
  const pending = store.createOrder({
    customer_id: customer,
    delivery_type: "retirada",
    payment_method: "pix",
    items: [{ product_id: gas, quantity: 1 }],
  });
  assert.equal(service.reminders()[0].pending_order, true);
  assert.equal(service.reminders()[0].actionable, false);
  store.changeOrderStatus({ order_id: pending, status: "cancelado" });
  assert.equal(service.reminders()[0].actionable, true);
});
test("adiamento, pausa e contato respeitam produto/ciclo; abrir WhatsApp não significa envio", (t) => {
  const { service, gasHistory, buy, gas, setDay, customer } = setup(t);
  gasHistory();
  let row = service.reminders()[0];
  const url = service.prepareWhatsApp({
    ...row,
    message: "Olá, Maria! Quer combinar uma entrega?",
  }).url;
  assert.match(url, /^https:\/\/wa.me\/5511900000001\?text=/);
  service.recordWhatsAppOpened({ ...row, message: "Olá, Maria!" });
  assert.equal(service.reminders()[0].contacted, false);
  assert.equal(service.reminders()[0].actionable, true);
  service.reminderAction({ ...row, kind: "adiado", days: 3 });
  assert.equal(service.reminders()[0].actionable, false);
  setDay("2026-10-26");
  assert.equal(service.reminders()[0].actionable, true);
  service.setReminderPreference({ customer_id: customer, enabled: false });
  assert.equal(service.reminders()[0].actionable, false);
  assert.throws(
    () => service.prepareWhatsApp({ ...row, message: "Olá" }),
    /desativados/,
  );
  service.setReminderPreference({ customer_id: customer, enabled: true });
  service.reminderAction({
    ...row,
    kind: "contato",
    message: "Contato feito manualmente",
  });
  service.reminderAction({ ...row, kind: "contato" });
  assert.equal(
    service.db
      .prepare("SELECT COUNT(*) n FROM reminder_events WHERE kind='contato'")
      .get().n,
    1,
  );
  assert.equal(service.reminders()[0].actionable, false);
  buy("2026-10-26", gas);
  setDay("2026-11-28");
  row = service.reminders()[0];
  assert.equal(row.contacted, false);
  assert.equal(row.actionable, true);
  assert.throws(
    () =>
      service.currentReminder({
        customer_id: customer,
        product_id: gas,
        last_order_id: 1,
      }),
    /histórico mudou/,
  );
});
test("vasilhames: saldos por cliente/produto, devolução parcial e rejeição atômica de excesso", (t) => {
  const { store, service, customer, gas, water } = setup(t);
  const before = store.getState();
  const second = store.saveCustomer({ name: "Outro cliente" });
  service.containerMove({
    customer_id: customer,
    product_id: water,
    kind: "emprestimo",
    quantity: 3,
    note: "Galões de teste",
  });
  service.containerMove({
    customer_id: customer,
    product_id: water,
    kind: "devolucao",
    quantity: 1,
    note: "Retorno parcial",
  });
  service.containerMove({
    customer_id: second,
    product_id: gas,
    kind: "emprestimo",
    quantity: 1,
    note: "Casco de teste",
  });
  assert.equal(
    service.containerState().balances.find((b) => b.customer_id === customer)
      .quantity,
    2,
  );
  assert.throws(
    () =>
      service.containerMove({
        customer_id: customer,
        product_id: water,
        kind: "devolucao",
        quantity: 3,
        note: "Excesso",
      }),
    /supera o saldo/,
  );
  assert.equal(service.containerState().moves.length, 3);
  assert.throws(
    () =>
      service.containerMove({
        customer_id: customer,
        product_id: water,
        kind: "emprestimo",
        quantity: -1,
        note: "Inválido",
      }),
    /Quantidade/,
  );
  assert.deepEqual(store.getState().products, before.products);
  assert.deepEqual(store.getState().cashEntries, before.cashEntries);
  store.saveCustomer({
    ...store.getState().customers.find((c) => c.id === customer),
    active: false,
  });
  service.containerMove({
    customer_id: customer,
    product_id: water,
    kind: "devolucao",
    quantity: 2,
    note: "Retorno final após inativação",
  });
  assert.equal(
    service.containerState().balances.some((b) => b.customer_id === customer),
    false,
  );
  assert.throws(
    () =>
      service.containerMove({
        customer_id: customer,
        product_id: water,
        kind: "emprestimo",
        quantity: 1,
        note: "Inativo",
      }),
    /inativo/,
  );
});
test("links de WhatsApp validam telefone/mensagem e codificam texto sem permitir outro destino", () => {
  const message = "Olá Maria! Água & gás? https://exemplo.test/#teste";
  const url = new URL(whatsappUrl("(11) 90000-0001", message));
  assert.equal(url.origin, "https://wa.me");
  assert.equal(url.pathname, "/5511900000001");
  assert.equal(url.searchParams.get("text"), message);
  assert.throws(() => whatsappUrl("123", "Olá"), /telefone/);
  assert.throws(() => whatsappUrl("11900000001", ""), /mensagem/);
  assert.throws(() => whatsappUrl("11900000001", "a".repeat(2001)), /mensagem/);
});
test("migração da versão 3, backup e reinício preservam vasilhames e preferências de lembretes", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "engagement-backup-"));
  let store;
  t.after(() => {
    store?.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const path = join(dir, "app.sqlite");
  store = new Store(path);
  const customer = store.saveCustomer({
    name: "Cliente antigo",
    postal_code: "18270001",
    cnpj: "12ABC34501DE35",
  });
  const product = store.saveProduct({
    name: "Galão",
    stock: 10,
    min_stock: 1,
    price_cents: 1500,
    cost_cents: 700,
  });
  store.db.exec(
    "DROP TABLE reminder_events; DROP TABLE reminder_preferences; DROP TABLE container_moves; DROP INDEX items_customer_reminder; PRAGMA user_version=3;",
  );
  store.close();
  store = new Store(path);
  assert.equal(store.getState().customers[0].cnpj, "12ABC34501DE35");
  assert.equal(store.getState().customers[0].postal_code, "18270001");
  const service = new Engagement(store);
  service.containerMove({
    customer_id: customer,
    product_id: product,
    kind: "emprestimo",
    quantity: 2,
    note: "Saldo inicial conferido",
  });
  service.setReminderPreference({ customer_id: customer, enabled: false });
  const backup = store.backupTo(join(dir, "backup.sqlite"));
  store.close();
  store = new Store(backup);
  const restored = new Engagement(store);
  assert.equal(restored.containerState().balances[0].quantity, 2);
  assert.equal(
    store.db
      .prepare("SELECT enabled FROM reminder_preferences WHERE customer_id=?")
      .get(customer).enabled,
    0,
  );
  assert.equal(
    store.db.prepare("PRAGMA integrity_check").get().integrity_check,
    "ok",
  );
});
test("lembrete e repetição consultam compras além dos últimos 500 pedidos da interface", (t) => {
  const { store, service, customer, gas, water, gasHistory, buy } = setup(t);
  const last = gasHistory();
  store.adjustStock({
    product_id: water,
    delta: 600,
    note: "Estoque de teste para histórico extenso",
  });
  const second = store.saveCustomer({ name: "Cliente recente" });
  for (let i = 0; i < 501; i++)
    buy("2026-10-23", water, 1, { customer_id: second });
  assert.equal(
    store.getState().orders.some((o) => o.id === last),
    false,
  );
  assert.equal(
    service
      .reminders()
      .find((r) => r.customer_id === customer && r.product_id === gas)
      .actionable,
    true,
  );
  assert.equal(service.repeatDraft({ customer_id: customer }).source_id, last);
});
