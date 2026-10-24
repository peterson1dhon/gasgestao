import { createHash, randomUUID } from "node:crypto";
import {
  assertTransition,
  isActiveState,
  recoverInterruptedState,
  FiscalStateError,
} from "./state-machine.mjs";

export class FiscalConcurrencyError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "FiscalConcurrencyError";
    this.details = details;
  }
}

export class FiscalIntegrityError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "FiscalIntegrityError";
    this.details = details;
  }
}

export const SCHEMA_V6_SQL = `
CREATE TABLE IF NOT EXISTS fiscal_issuers (
  id TEXT PRIMARY KEY,
  identity TEXT NOT NULL UNIQUE,
  configuration_json TEXT NOT NULL CHECK(json_valid(configuration_json)),
  production_enabled INTEGER NOT NULL DEFAULT 0 CHECK(production_enabled IN (0,1))
);

CREATE TABLE IF NOT EXISTS fiscal_customer_details (
  customer_id INTEGER PRIMARY KEY REFERENCES customers(id),
  payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
  row_version INTEGER NOT NULL DEFAULT 0 CHECK(row_version>=0)
);

CREATE TABLE IF NOT EXISTS fiscal_profiles (
  id TEXT PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id),
  version INTEGER NOT NULL CHECK(version>0),
  valid_from TEXT NOT NULL,
  valid_until TEXT,
  approval_state TEXT NOT NULL CHECK(approval_state IN ('draft','approved','retired')),
  approved_by TEXT,
  approved_at TEXT,
  payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
  UNIQUE(product_id,version),
  CHECK(valid_until IS NULL OR valid_until>=valid_from),
  CHECK(approval_state!='approved' OR (approved_by IS NOT NULL AND approved_at IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS fiscal_sequences (
  issuer_id TEXT NOT NULL REFERENCES fiscal_issuers(id),
  environment TEXT NOT NULL CHECK(environment IN ('homologacao','producao')),
  model INTEGER NOT NULL CHECK(model IN (55,65)),
  series INTEGER NOT NULL CHECK(series BETWEEN 0 AND 889),
  last_number INTEGER NOT NULL DEFAULT 0 CHECK(last_number BETWEEN 0 AND 999999999),
  PRIMARY KEY(issuer_id,environment,model,series)
);

CREATE TABLE IF NOT EXISTS fiscal_documents (
  id TEXT PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders(id),
  issuer_id TEXT NOT NULL,
  environment TEXT NOT NULL,
  model INTEGER NOT NULL,
  series INTEGER NOT NULL,
  number INTEGER NOT NULL CHECK(number BETWEEN 1 AND 999999999),
  cnf TEXT NOT NULL CHECK(length(cnf)=8 AND cnf NOT GLOB '*[^0-9]*'),
  issued_at TEXT NOT NULL,
  access_key TEXT NOT NULL CHECK(length(access_key)=44),
  state TEXT NOT NULL CHECK(state IN ('prepared','signed','sending','uncertain','authorized','rejected','cancel_pending','cancel_uncertain','cancelled','blocked','abandoned')),
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  row_version INTEGER NOT NULL DEFAULT 0 CHECK(row_version>=0),
  FOREIGN KEY(issuer_id,environment,model,series) REFERENCES fiscal_sequences(issuer_id,environment,model,series),
  UNIQUE(issuer_id,environment,model,series,number),
  UNIQUE(environment,access_key),
  CHECK((state IN ('cancelled','abandoned') AND active=0) OR (state NOT IN ('cancelled','abandoned') AND active=1))
);

CREATE UNIQUE INDEX IF NOT EXISTS fiscal_one_active_order ON fiscal_documents(order_id,environment) WHERE active=1;

CREATE TABLE IF NOT EXISTS fiscal_revisions (
  document_id TEXT NOT NULL REFERENCES fiscal_documents(id),
  version INTEGER NOT NULL CHECK(version>0),
  snapshot_json TEXT NOT NULL CHECK(json_valid(snapshot_json)),
  snapshot_sha256 TEXT NOT NULL CHECK(length(snapshot_sha256)=64),
  engine_version TEXT NOT NULL,
  policy_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(document_id,version)
);

CREATE TABLE IF NOT EXISTS fiscal_artifacts (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('signed_xml','request','response','nfe_proc','event_proc','pdf')),
  content BLOB NOT NULL,
  sha256 TEXT NOT NULL CHECK(length(sha256)=64),
  created_at TEXT NOT NULL,
  FOREIGN KEY(document_id,revision) REFERENCES fiscal_revisions(document_id,version)
);

CREATE TABLE IF NOT EXISTS fiscal_attempts (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  request_id TEXT NOT NULL UNIQUE,
  operation TEXT NOT NULL CHECK(operation IN ('authorize','query','receipt','cancel')),
  started_at TEXT NOT NULL,
  completed_at TEXT,
  outcome TEXT CHECK(outcome IN ('success','rejected','uncertain','blocked')),
  request_artifact_id TEXT REFERENCES fiscal_artifacts(id),
  response_artifact_id TEXT REFERENCES fiscal_artifacts(id),
  result_json TEXT CHECK(result_json IS NULL OR json_valid(result_json)),
  FOREIGN KEY(document_id,revision) REFERENCES fiscal_revisions(document_id,version)
);

CREATE TABLE IF NOT EXISTS fiscal_events (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES fiscal_documents(id),
  event_type TEXT NOT NULL,
  sequence INTEGER NOT NULL CHECK(sequence BETWEEN 1 AND 99),
  payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
  created_at TEXT NOT NULL,
  UNIQUE(document_id,event_type,sequence)
);

CREATE TABLE IF NOT EXISTS fiscal_audit (
  id INTEGER PRIMARY KEY,
  document_id TEXT REFERENCES fiscal_documents(id),
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  detail_json TEXT NOT NULL CHECK(json_valid(detail_json)),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS fiscal_jobs (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES fiscal_documents(id),
  purpose TEXT NOT NULL CHECK(purpose IN ('authorize','query','receipt','cancel','reconcile')),
  dedup_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK(status IN ('pending','running','done','blocked')),
  not_before TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts>=0),
  lease_owner TEXT,
  lease_until TEXT
);

CREATE INDEX IF NOT EXISTS fiscal_jobs_pending ON fiscal_jobs(status,not_before);

CREATE TRIGGER IF NOT EXISTS fiscal_identity_immutable BEFORE UPDATE OF order_id,issuer_id,environment,model,series,number,cnf,issued_at,access_key ON fiscal_documents
BEGIN SELECT RAISE(ABORT,'fiscal identity is immutable'); END;

CREATE TRIGGER IF NOT EXISTS fiscal_document_no_delete BEFORE DELETE ON fiscal_documents
BEGIN SELECT RAISE(ABORT,'fiscal document cannot be deleted'); END;

CREATE TRIGGER IF NOT EXISTS fiscal_sequence_no_decrease BEFORE UPDATE OF last_number ON fiscal_sequences WHEN NEW.last_number<OLD.last_number
BEGIN SELECT RAISE(ABORT,'fiscal sequence cannot decrease'); END;

CREATE TRIGGER IF NOT EXISTS fiscal_sequence_no_delete BEFORE DELETE ON fiscal_sequences WHEN OLD.last_number>0
BEGIN SELECT RAISE(ABORT,'fiscal sequence with issued documents cannot be deleted'); END;

CREATE TRIGGER IF NOT EXISTS fiscal_revision_no_update BEFORE UPDATE ON fiscal_revisions BEGIN SELECT RAISE(ABORT,'immutable revision'); END;
CREATE TRIGGER IF NOT EXISTS fiscal_revision_no_delete BEFORE DELETE ON fiscal_revisions BEGIN SELECT RAISE(ABORT,'immutable revision'); END;

CREATE TRIGGER IF NOT EXISTS fiscal_artifact_no_update BEFORE UPDATE ON fiscal_artifacts BEGIN SELECT RAISE(ABORT,'immutable artifact'); END;
CREATE TRIGGER IF NOT EXISTS fiscal_artifact_no_delete BEFORE DELETE ON fiscal_artifacts BEGIN SELECT RAISE(ABORT,'immutable artifact'); END;

CREATE TRIGGER IF NOT EXISTS fiscal_attempt_no_delete BEFORE DELETE ON fiscal_attempts BEGIN SELECT RAISE(ABORT,'immutable attempt'); END;

CREATE TRIGGER IF NOT EXISTS fiscal_audit_no_update BEFORE UPDATE ON fiscal_audit BEGIN SELECT RAISE(ABORT,'immutable audit'); END;
CREATE TRIGGER IF NOT EXISTS fiscal_audit_no_delete BEFORE DELETE ON fiscal_audit BEGIN SELECT RAISE(ABORT,'immutable audit'); END;

CREATE TRIGGER IF NOT EXISTS fiscal_event_no_update BEFORE UPDATE ON fiscal_events BEGIN SELECT RAISE(ABORT,'immutable event'); END;
CREATE TRIGGER IF NOT EXISTS fiscal_event_no_delete BEFORE DELETE ON fiscal_events BEGIN SELECT RAISE(ABORT,'immutable event'); END;

CREATE TRIGGER IF NOT EXISTS fiscal_profile_approved_immutable BEFORE UPDATE ON fiscal_profiles
WHEN OLD.approval_state='approved' AND (NEW.product_id!=OLD.product_id OR NEW.version!=OLD.version OR NEW.valid_from!=OLD.valid_from OR NEW.payload_json!=OLD.payload_json OR NEW.approval_state NOT IN ('approved','retired'))
BEGIN SELECT RAISE(ABORT,'approved fiscal profile payload is immutable; retire it or create a new version'); END;

CREATE TRIGGER IF NOT EXISTS fiscal_profile_approved_no_delete BEFORE DELETE ON fiscal_profiles
WHEN OLD.approval_state='approved'
BEGIN SELECT RAISE(ABORT,'approved fiscal profile cannot be deleted'); END;
`;

export class FiscalRepository {
  constructor(store) {
    this.store = store;
  }

  get db() {
    return this.store.db;
  }

  timestamp() {
    return this.store.timestamp ? this.store.timestamp() : new Date().toISOString();
  }

  static applyMigrationV6(db) {
    db.exec(SCHEMA_V6_SQL);
  }

  // --- ISSUERS ---

  saveIssuer({ id, identity, configuration, productionEnabled = 0 }) {
    const configJson =
      typeof configuration === "string" ? configuration : JSON.stringify(configuration || {});
    return this.store.transaction(() => {
      const existing = this.getIssuer(id);
      if (existing && existing.identity !== identity) {
        throw new FiscalIntegrityError("A identidade fiscal do emitente é imutável; cadastre outro emitente.");
      }
      this.db
        .prepare(
          `INSERT INTO fiscal_issuers (id, identity, configuration_json, production_enabled)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             configuration_json = excluded.configuration_json,
             production_enabled = excluded.production_enabled`,
        )
        .run(id, identity, configJson, productionEnabled ? 1 : 0);
      return this.getIssuer(id);
    });
  }

  getIssuer(id) {
    const row = this.db.prepare("SELECT * FROM fiscal_issuers WHERE id = ?").get(id);
    if (!row) return null;
    return {
      id: row.id,
      identity: row.identity,
      configuration: JSON.parse(row.configuration_json),
      productionEnabled: Boolean(row.production_enabled),
    };
  }

  getIssuerByIdentity(identity) {
    const row = this.db
      .prepare("SELECT * FROM fiscal_issuers WHERE identity = ?")
      .get(identity);
    if (!row) return null;
    return {
      id: row.id,
      identity: row.identity,
      configuration: JSON.parse(row.configuration_json),
      productionEnabled: Boolean(row.production_enabled),
    };
  }

  listIssuers() {
    return this.db
      .prepare("SELECT * FROM fiscal_issuers ORDER BY identity")
      .all()
      .map((row) => ({
        id: row.id,
        identity: row.identity,
        configuration: JSON.parse(row.configuration_json),
        productionEnabled: Boolean(row.production_enabled),
      }));
  }

  // --- SEQUENCES ---

  initSequence({ issuerId, environment, model, series, initialNumber = 0 }) {
    this.db
      .prepare(
        `INSERT INTO fiscal_sequences (issuer_id, environment, model, series, last_number)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(issuer_id, environment, model, series) DO NOTHING`,
      )
      .run(issuerId, environment, model, series, initialNumber);
    return this.getSequence({ issuerId, environment, model, series });
  }

  getSequence({ issuerId, environment, model, series }) {
    return this.db
      .prepare(
        `SELECT * FROM fiscal_sequences
         WHERE issuer_id = ? AND environment = ? AND model = ? AND series = ?`,
      )
      .get(issuerId, environment, model, series);
  }

  reserveNextNumber({ issuerId, environment, model, series }) {
    const seq = this.getSequence({ issuerId, environment, model, series });
    if (!seq) {
      throw new Error(
        `Sequência fiscal não inicializada para emissor=${issuerId}, ambiente=${environment}, modelo=${model}, série=${series}.`,
      );
    }
    const nextNumber = seq.last_number + 1;
    if (nextNumber > 999999999) {
      throw new Error("Limite máximo de numeração da série atingido (999.999.999).");
    }
    const res = this.db
      .prepare(
        `UPDATE fiscal_sequences
         SET last_number = ?
         WHERE issuer_id = ? AND environment = ? AND model = ? AND series = ? AND last_number = ?`,
      )
      .run(nextNumber, issuerId, environment, model, series, seq.last_number);
    if (res.changes === 0) {
      throw new FiscalConcurrencyError(
        "Conflito de concorrência ao reservar próximo número da sequência fiscal.",
      );
    }
    return nextNumber;
  }

  // --- DOCUMENTS ---

  reserveDocument({
    id = randomUUID(),
    orderId,
    issuerId,
    environment,
    model,
    series,
    cnf,
    accessKey,
    issuedAt = this.timestamp(),
    snapshot,
    engineVersion = "0.7.0-fiscal-v1",
    policyId = "rtc-2025-002-v1.52",
    actor = "system",
  }) {
    return this.store.transaction(() => {
      // 1. Verifica se já existe documento fiscal ativo para o mesmo pedido e ambiente
      const existingActive = this.db
        .prepare(
          "SELECT id, state FROM fiscal_documents WHERE order_id = ? AND environment = ? AND active = 1",
        )
        .get(orderId, environment);
      if (existingActive) {
        throw new FiscalStateError(
          `Já existe um documento fiscal ativo (${existingActive.state}) para o pedido #${orderId} no ambiente ${environment}.`,
          { existingDocId: existingActive.id, state: existingActive.state },
        );
      }

      // 2. Reserva o próximo número da sequência
      const number = this.reserveNextNumber({ issuerId, environment, model, series });

      // 3. Insere o documento em estado 'prepared'
      this.db
        .prepare(
          `INSERT INTO fiscal_documents (
            id, order_id, issuer_id, environment, model, series, number,
            cnf, issued_at, access_key, state, active, row_version
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'prepared', 1, 0)`,
        )
        .run(
          id,
          orderId,
          issuerId,
          environment,
          model,
          series,
          number,
          cnf,
          issuedAt,
          accessKey,
        );

      // 4. Cria a revisão inicial 1
      const snapshotJson =
        typeof snapshot === "string" ? snapshot : JSON.stringify(snapshot || {});
      const snapshotSha256 = createHash("sha256").update(snapshotJson).digest("hex");
      const revTime = this.timestamp();

      this.db
        .prepare(
          `INSERT INTO fiscal_revisions (
            document_id, version, snapshot_json, snapshot_sha256,
            engine_version, policy_id, created_at
          ) VALUES (?, 1, ?, ?, ?, ?, ?)`,
        )
        .run(id, snapshotJson, snapshotSha256, engineVersion, policyId, revTime);

      // 5. Registra auditoria
      this.recordAudit({
        documentId: id,
        actor,
        action: "reserve",
        detail: { orderId, model, series, number, accessKey, environment },
        createdAt: revTime,
      });

      return {
        id,
        orderId,
        issuerId,
        environment,
        model,
        series,
        number,
        cnf,
        issuedAt,
        accessKey,
        state: "prepared",
        active: 1,
        rowVersion: 0,
        revision: 1,
        snapshotSha256,
      };
    });
  }

  getDocument(id) {
    return this.db.prepare("SELECT * FROM fiscal_documents WHERE id = ?").get(id);
  }

  getDocumentByOrder(orderId, environment) {
    return this.db
      .prepare(
        "SELECT * FROM fiscal_documents WHERE order_id = ? AND environment = ? AND active = 1",
      )
      .get(orderId, environment);
  }

  listDocumentsForOrder(orderId) {
    return this.db
      .prepare(
        "SELECT * FROM fiscal_documents WHERE order_id = ? ORDER BY issued_at DESC, number DESC",
      )
      .all(orderId);
  }

  transitionDocumentCAS({
    documentId,
    fromState,
    toState,
    expectedRowVersion,
    actor = "system",
    reason = "",
    extraAudit = null,
  }) {
    assertTransition(fromState, toState, { documentId });
    const active = isActiveState(toState) ? 1 : 0;
    const now = this.timestamp();

    return this.store.transaction(() => {
      const res = this.db
        .prepare(
          `UPDATE fiscal_documents
           SET state = ?, active = ?, row_version = row_version + 1
           WHERE id = ? AND state = ? AND row_version = ?`,
        )
        .run(toState, active, documentId, fromState, expectedRowVersion);

      if (res.changes === 0) {
        const current = this.getDocument(documentId);
        throw new FiscalConcurrencyError(
          `Conflito de concorrência ao transitar documento ${documentId} de "${fromState}" para "${toState}". Estado atual: ${current ? `"${current.state}" (row_version=${current.row_version})` : "inexistente"}.`,
          { documentId, fromState, toState, expectedRowVersion, current },
        );
      }

      this.recordAudit({
        documentId,
        actor,
        action: `transition:${fromState}->${toState}`,
        detail: { fromState, toState, expectedRowVersion, reason, extraAudit },
        createdAt: now,
      });

      return this.getDocument(documentId);
    });
  }

  // --- REVISIONS ---

  createRevision({
    documentId,
    snapshot,
    engineVersion = "0.7.0-fiscal-v1",
    policyId = "rtc-2025-002-v1.52",
    actor = "system",
  }) {
    return this.store.transaction(() => {
      const doc = this.getDocument(documentId);
      if (!doc) throw new Error(`Documento fiscal inexistente: ${documentId}`);

      const latest = this.getLatestRevision(documentId);
      const nextVersion = latest ? latest.version + 1 : 1;
      const snapshotJson =
        typeof snapshot === "string" ? snapshot : JSON.stringify(snapshot || {});
      const snapshotSha256 = createHash("sha256").update(snapshotJson).digest("hex");
      const createdAt = this.timestamp();

      this.db
        .prepare(
          `INSERT INTO fiscal_revisions (
            document_id, version, snapshot_json, snapshot_sha256,
            engine_version, policy_id, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(documentId, nextVersion, snapshotJson, snapshotSha256, engineVersion, policyId, createdAt);

      this.recordAudit({
        documentId,
        actor,
        action: `new_revision:${nextVersion}`,
        detail: { version: nextVersion, snapshotSha256, engineVersion, policyId },
        createdAt,
      });

      return {
        documentId,
        version: nextVersion,
        snapshotJson,
        snapshotSha256,
        engineVersion,
        policyId,
        createdAt,
      };
    });
  }

  getRevision(documentId, version) {
    return this.db
      .prepare("SELECT * FROM fiscal_revisions WHERE document_id = ? AND version = ?")
      .get(documentId, version);
  }

  getLatestRevision(documentId) {
    return this.db
      .prepare(
        "SELECT * FROM fiscal_revisions WHERE document_id = ? ORDER BY version DESC LIMIT 1",
      )
      .get(documentId);
  }

  // --- ARTIFACTS ---

  saveArtifact({
    id = randomUUID(),
    documentId,
    revision,
    kind,
    content,
    createdAt = this.timestamp(),
  }) {
    const rev = this.getRevision(documentId, revision);
    if (!rev) {
      throw new FiscalIntegrityError(
        `Revisão ${revision} do documento ${documentId} não existe para vincular artefato.`,
      );
    }

    const buffer = Buffer.isBuffer(content)
      ? content
      : Buffer.from(typeof content === "string" ? content : "");
    const sha256 = createHash("sha256").update(buffer).digest("hex");

    this.db
      .prepare(
        `INSERT INTO fiscal_artifacts (id, document_id, revision, kind, content, sha256, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, documentId, revision, kind, buffer, sha256, createdAt);

    return {
      id,
      documentId,
      revision,
      kind,
      sha256,
      createdAt,
    };
  }

  getArtifact(id) {
    const row = this.db.prepare("SELECT * FROM fiscal_artifacts WHERE id = ?").get(id);
    if (!row) return null;

    const buffer = Buffer.isBuffer(row.content) ? row.content : Buffer.from(row.content);
    const actualSha256 = createHash("sha256").update(buffer).digest("hex");
    if (actualSha256 !== row.sha256) {
      throw new FiscalIntegrityError(
        `Corrupção de integridade no artefato fiscal ${id}: hash esperado=${row.sha256}, obtido=${actualSha256}.`,
      );
    }
    return { ...row, content: buffer };
  }

  // --- ATTEMPTS ---

  recordAttemptStart({
    id = randomUUID(),
    documentId,
    revision,
    requestId,
    operation,
    requestArtifactId = null,
    startedAt = this.timestamp(),
  }) {
    // Validação estrita: se requestArtifactId for informado, provar que pertence a (documentId, revision)
    if (requestArtifactId) {
      const art = this.getArtifact(requestArtifactId);
      if (!art || art.document_id !== documentId || art.revision !== revision) {
        throw new FiscalIntegrityError(
          `Artefato de requisição ${requestArtifactId} não pertence ao documento ${documentId} revisão ${revision}.`,
        );
      }
    }

    this.db
      .prepare(
        `INSERT INTO fiscal_attempts (
          id, document_id, revision, request_id, operation,
          started_at, outcome, request_artifact_id
        ) VALUES (?, ?, ?, ?, ?, ?, NULL, ?)`,
      )
      .run(id, documentId, revision, requestId, operation, startedAt, requestArtifactId);

    return {
      id,
      documentId,
      revision,
      requestId,
      operation,
      startedAt,
      requestArtifactId,
    };
  }

  recordAttemptCompletion({
    requestId,
    completedAt = this.timestamp(),
    outcome,
    responseArtifactId = null,
    result = null,
  }) {
    const attempt = this.getAttemptByRequestId(requestId);
    if (!attempt) {
      throw new Error(`Tentativa com request_id=${requestId} não localizada.`);
    }

    if (responseArtifactId) {
      const art = this.getArtifact(responseArtifactId);
      if (
        !art ||
        art.document_id !== attempt.document_id ||
        art.revision !== attempt.revision
      ) {
        throw new FiscalIntegrityError(
          `Artefato de resposta ${responseArtifactId} não pertence ao documento ${attempt.document_id} revisão ${attempt.revision}.`,
        );
      }
    }

    const resultJson =
      result === null || result === undefined
        ? null
        : typeof result === "string"
          ? result
          : JSON.stringify(result);

    this.db
      .prepare(
        `UPDATE fiscal_attempts
         SET completed_at = ?, outcome = ?, response_artifact_id = ?, result_json = ?
         WHERE request_id = ?`,
      )
      .run(completedAt, outcome, responseArtifactId, resultJson, requestId);

    return this.getAttemptByRequestId(requestId);
  }

  getAttemptByRequestId(requestId) {
    return this.db
      .prepare("SELECT * FROM fiscal_attempts WHERE request_id = ?")
      .get(requestId);
  }

  listAttemptsForDocument(documentId) {
    return this.db
      .prepare(
        "SELECT * FROM fiscal_attempts WHERE document_id = ? ORDER BY started_at ASC",
      )
      .all(documentId);
  }

  // --- EVENTS ---

  recordEvent({
    id = randomUUID(),
    documentId,
    eventType,
    sequence,
    payload,
    createdAt = this.timestamp(),
  }) {
    const payloadJson =
      typeof payload === "string" ? payload : JSON.stringify(payload || {});
    this.db
      .prepare(
        `INSERT INTO fiscal_events (id, document_id, event_type, sequence, payload_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(id, documentId, eventType, sequence, payloadJson, createdAt);
    return { id, documentId, eventType, sequence, payloadJson, createdAt };
  }

  listEventsForDocument(documentId) {
    return this.db
      .prepare(
        "SELECT * FROM fiscal_events WHERE document_id = ? ORDER BY sequence ASC",
      )
      .all(documentId);
  }

  // --- AUDIT ---

  recordAudit({
    documentId = null,
    actor,
    action,
    detail = {},
    createdAt = this.timestamp(),
  }) {
    const detailJson =
      typeof detail === "string" ? detail : JSON.stringify(detail || {});
    this.db
      .prepare(
        `INSERT INTO fiscal_audit (document_id, actor, action, detail_json, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(documentId, actor, action, detailJson, createdAt);
  }

  listAuditForDocument(documentId) {
    return this.db
      .prepare("SELECT * FROM fiscal_audit WHERE document_id = ? ORDER BY id ASC")
      .all(documentId);
  }

  // --- JOBS (Fila durável) ---

  enqueueJob({
    id = randomUUID(),
    documentId,
    purpose,
    dedupKey,
    notBefore = this.timestamp(),
  }) {
    // Inserção idempotente por dedup_key
    this.db
      .prepare(
        `INSERT INTO fiscal_jobs (id, document_id, purpose, dedup_key, status, not_before, attempts)
         VALUES (?, ?, ?, ?, 'pending', ?, 0)
         ON CONFLICT(dedup_key) DO NOTHING`,
      )
      .run(id, documentId, purpose, dedupKey, notBefore);

    return this.db
      .prepare("SELECT * FROM fiscal_jobs WHERE dedup_key = ?")
      .get(dedupKey);
  }

  claimPendingJob({
    leaseOwner = `worker-${process.pid}`,
    leaseDurationMs = 30000,
    now = new Date(),
  } = {}) {
    const nowIso = now.toISOString();
    const leaseUntil = new Date(now.getTime() + leaseDurationMs).toISOString();

    return this.store.transaction(() => {
      const candidate = this.db
        .prepare(
          `SELECT * FROM fiscal_jobs
           WHERE (status = 'pending' OR (status = 'running' AND lease_until < ?))
             AND not_before <= ?
           ORDER BY not_before ASC
           LIMIT 1`,
        )
        .get(nowIso, nowIso);

      if (!candidate) return null;

      const res = this.db
        .prepare(
          `UPDATE fiscal_jobs
           SET status = 'running', lease_owner = ?, lease_until = ?, attempts = attempts + 1
           WHERE id = ? AND (status = 'pending' OR (status = 'running' AND lease_until < ?))`,
        )
        .run(leaseOwner, leaseUntil, candidate.id, nowIso);

      if (res.changes === 0) return null;

      return this.db.prepare("SELECT * FROM fiscal_jobs WHERE id = ?").get(candidate.id);
    });
  }

  completeJob(jobId) {
    this.db
      .prepare(
        `UPDATE fiscal_jobs
         SET status = 'done', lease_owner = NULL, lease_until = NULL
         WHERE id = ?`,
      )
      .run(jobId);
    return this.db.prepare("SELECT * FROM fiscal_jobs WHERE id = ?").get(jobId);
  }

  failJob(jobId, { retryDelaySeconds = 30, maxAttempts = 5, blockedReason = "" } = {}) {
    const job = this.db.prepare("SELECT * FROM fiscal_jobs WHERE id = ?").get(jobId);
    if (!job) return null;

    if (job.attempts >= maxAttempts) {
      this.db
        .prepare(
          `UPDATE fiscal_jobs
           SET status = 'blocked', lease_owner = NULL, lease_until = NULL
           WHERE id = ?`,
        )
        .run(jobId);
    } else {
      const nextTime = new Date(Date.now() + retryDelaySeconds * 1000).toISOString();
      this.db
        .prepare(
          `UPDATE fiscal_jobs
           SET status = 'pending', not_before = ?, lease_owner = NULL, lease_until = NULL
           WHERE id = ?`,
        )
        .run(nextTime, jobId);
    }
    return this.db.prepare("SELECT * FROM fiscal_jobs WHERE id = ?").get(jobId);
  }

  // --- RECOVERY AT STARTUP ---

  recoverInterruptedDocuments({ actor = "startup_recovery" } = {}) {
    return this.store.transaction(() => {
      const sendingDocs = this.db
        .prepare(
          `SELECT * FROM fiscal_documents
           WHERE state IN ('sending', 'cancel_pending') AND active = 1`,
        )
        .all();

      const recovered = [];
      const now = this.timestamp();

      for (const doc of sendingDocs) {
        const nextState = recoverInterruptedState(doc.state);
        this.db
          .prepare(
            `UPDATE fiscal_documents
             SET state = ?, row_version = row_version + 1
             WHERE id = ? AND state = ? AND row_version = ?`,
          )
          .run(nextState, doc.id, doc.state, doc.row_version);

        this.recordAudit({
          documentId: doc.id,
          actor,
          action: `startup_recover:${doc.state}->${nextState}`,
          detail: {
            previousState: doc.state,
            recoveredState: nextState,
            reason: "Processo foi interrompido antes da confirmação do resultado.",
          },
          createdAt: now,
        });

        // Agenda job de conciliação / consulta
        const dedupKey = `reconcile-${doc.id}-${nextState}-${doc.row_version + 1}`;
        this.enqueueJob({
          documentId: doc.id,
          purpose: nextState === "cancel_uncertain" ? "cancel" : "query",
          dedupKey,
          notBefore: now,
        });

        recovered.push({ id: doc.id, previousState: doc.state, state: nextState });
      }

      return recovered;
    });
  }

  // --- CUSTOMER FISCAL DETAILS ---

  saveCustomerDetails({ customerId, payload, expectedVersion = 0 }) {
    const payloadJson =
      typeof payload === "string" ? payload : JSON.stringify(payload || {});
    return this.store.transaction(() => {
      const existing = this.getCustomerDetails(customerId);
      if (!existing) {
        this.db
          .prepare(
            `INSERT INTO fiscal_customer_details (customer_id, payload_json, row_version)
             VALUES (?, ?, 0)`,
          )
          .run(customerId, payloadJson);
        return { customerId, payload: JSON.parse(payloadJson), rowVersion: 0 };
      }

      const res = this.db
        .prepare(
          `UPDATE fiscal_customer_details
           SET payload_json = ?, row_version = row_version + 1
           WHERE customer_id = ? AND row_version = ?`,
        )
        .run(payloadJson, customerId, expectedVersion);

      if (res.changes === 0) {
        throw new FiscalConcurrencyError(
          `Conflito ao atualizar dados fiscais do cliente #${customerId}. Versão esperada ${expectedVersion}.`,
        );
      }
      return { customerId, payload: JSON.parse(payloadJson), rowVersion: expectedVersion + 1 };
    });
  }

  getCustomerDetails(customerId) {
    const row = this.db
      .prepare("SELECT * FROM fiscal_customer_details WHERE customer_id = ?")
      .get(customerId);
    if (!row) return null;
    return {
      customerId: row.customer_id,
      payload: JSON.parse(row.payload_json),
      rowVersion: row.row_version,
    };
  }

  // --- FISCAL PROFILES ---

  saveProfileDraft({
    id = randomUUID(),
    productId,
    version,
    validFrom,
    validUntil = null,
    payload,
  }) {
    const payloadJson =
      typeof payload === "string" ? payload : JSON.stringify(payload || {});
    this.db
      .prepare(
        `INSERT INTO fiscal_profiles (
          id, product_id, version, valid_from, valid_until,
          approval_state, approved_by, approved_at, payload_json
        ) VALUES (?, ?, ?, ?, ?, 'draft', NULL, NULL, ?)`,
      )
      .run(id, productId, version, validFrom, validUntil, payloadJson);
    return this.getProfile(id);
  }

  approveProfile({ id, approvedBy, approvedAt = this.timestamp() }) {
    if (!approvedBy) throw new Error("Aprovador obrigatório para aprovar perfil fiscal.");
    return this.store.transaction(() => {
      const draft = this.getProfile(id);
      if (!draft || draft.approvalState !== "draft") {
        throw new Error(`Perfil fiscal ${id} não está em rascunho para ser aprovado.`);
      }
      const overlap = this.db.prepare(
        `SELECT id FROM fiscal_profiles
         WHERE product_id = ? AND approval_state = 'approved'
           AND valid_from <= COALESCE(?, '9999-12-31')
           AND COALESCE(valid_until, '9999-12-31') >= ? LIMIT 1`,
      ).get(draft.productId, draft.validUntil, draft.validFrom);
      if (overlap) {
        throw new FiscalIntegrityError("Já existe perfil fiscal aprovado com vigência sobreposta para este produto.");
      }
      this.db.prepare(
        `UPDATE fiscal_profiles SET approval_state = 'approved', approved_by = ?, approved_at = ?
         WHERE id = ? AND approval_state = 'draft'`,
      ).run(approvedBy, approvedAt, id);
      return this.getProfile(id);
    });
  }

  retireProfile({ id, validUntil = this.timestamp() }) {
    const res = this.db
      .prepare(
        `UPDATE fiscal_profiles
         SET approval_state = 'retired', valid_until = ?
         WHERE id = ? AND approval_state = 'approved'`,
      )
      .run(validUntil, id);
    if (res.changes === 0) {
      throw new Error(`Perfil fiscal ${id} não está aprovado para ser retirado.`);
    }
    return this.getProfile(id);
  }

  getProfile(id) {
    const row = this.db.prepare("SELECT * FROM fiscal_profiles WHERE id = ?").get(id);
    if (!row) return null;
    return {
      id: row.id,
      productId: row.product_id,
      version: row.version,
      validFrom: row.valid_from,
      validUntil: row.valid_until,
      approvalState: row.approval_state,
      approvedBy: row.approved_by,
      approvedAt: row.approved_at,
      payload: JSON.parse(row.payload_json),
    };
  }

  getActiveProfile({ productId, atDate = this.timestamp() }) {
    const row = this.db
      .prepare(
        `SELECT * FROM fiscal_profiles
         WHERE product_id = ?
           AND approval_state = 'approved'
           AND valid_from <= ?
           AND (valid_until IS NULL OR valid_until >= ?)
         ORDER BY version DESC
         LIMIT 1`,
      )
      .get(productId, atDate, atDate);
    if (!row) return null;
    return {
      id: row.id,
      productId: row.product_id,
      version: row.version,
      validFrom: row.valid_from,
      validUntil: row.valid_until,
      approvalState: row.approval_state,
      approvedBy: row.approved_by,
      approvedAt: row.approved_at,
      payload: JSON.parse(row.payload_json),
    };
  }
}
