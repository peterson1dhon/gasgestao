-- PROPOSTA: executar somente em banco temporário no estudo.
-- Migração real: envolver em Store.transaction e definir user_version=6 ao final.
-- Não executa COMMIT, não muda user_version e não altera tabelas operacionais.
CREATE TABLE fiscal_issuers (
  id TEXT PRIMARY KEY,
  identity TEXT NOT NULL UNIQUE,
  configuration_json TEXT NOT NULL CHECK(json_valid(configuration_json)),
  production_enabled INTEGER NOT NULL DEFAULT 0 CHECK(production_enabled IN (0,1))
);
CREATE TABLE fiscal_customer_details (
  customer_id INTEGER PRIMARY KEY REFERENCES customers(id),
  payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
  row_version INTEGER NOT NULL DEFAULT 0 CHECK(row_version>=0)
);
CREATE TABLE fiscal_profiles (
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
CREATE TABLE fiscal_sequences (
  issuer_id TEXT NOT NULL REFERENCES fiscal_issuers(id),
  environment TEXT NOT NULL CHECK(environment IN ('homologacao','producao')),
  model INTEGER NOT NULL CHECK(model IN (55,65)),
  series INTEGER NOT NULL CHECK(series BETWEEN 0 AND 889),
  last_number INTEGER NOT NULL DEFAULT 0 CHECK(last_number BETWEEN 0 AND 999999999),
  PRIMARY KEY(issuer_id,environment,model,series)
);
CREATE TABLE fiscal_documents (
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
CREATE UNIQUE INDEX fiscal_one_active_order ON fiscal_documents(order_id,environment) WHERE active=1;
CREATE TABLE fiscal_revisions (
  document_id TEXT NOT NULL REFERENCES fiscal_documents(id),
  version INTEGER NOT NULL CHECK(version>0),
  snapshot_json TEXT NOT NULL CHECK(json_valid(snapshot_json)),
  snapshot_sha256 TEXT NOT NULL CHECK(length(snapshot_sha256)=64),
  engine_version TEXT NOT NULL,
  policy_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(document_id,version)
);
CREATE TABLE fiscal_artifacts (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('signed_xml','request','response','nfe_proc','event_proc','pdf')),
  content BLOB NOT NULL,
  sha256 TEXT NOT NULL CHECK(length(sha256)=64),
  created_at TEXT NOT NULL,
  FOREIGN KEY(document_id,revision) REFERENCES fiscal_revisions(document_id,version)
);
CREATE TABLE fiscal_attempts (
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
CREATE TABLE fiscal_events (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES fiscal_documents(id),
  event_type TEXT NOT NULL,
  sequence INTEGER NOT NULL CHECK(sequence BETWEEN 1 AND 99),
  payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
  created_at TEXT NOT NULL,
  UNIQUE(document_id,event_type,sequence)
);
CREATE TABLE fiscal_audit (
  id INTEGER PRIMARY KEY,
  document_id TEXT REFERENCES fiscal_documents(id),
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  detail_json TEXT NOT NULL CHECK(json_valid(detail_json)),
  created_at TEXT NOT NULL
);
CREATE TABLE fiscal_jobs (
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
CREATE INDEX fiscal_jobs_pending ON fiscal_jobs(status,not_before);
CREATE TRIGGER fiscal_identity_immutable BEFORE UPDATE OF order_id,issuer_id,environment,model,series,number,cnf,issued_at,access_key ON fiscal_documents
BEGIN SELECT RAISE(ABORT,'fiscal identity is immutable'); END;
CREATE TRIGGER fiscal_sequence_no_decrease BEFORE UPDATE OF last_number ON fiscal_sequences WHEN NEW.last_number<OLD.last_number
BEGIN SELECT RAISE(ABORT,'fiscal sequence cannot decrease'); END;
CREATE TRIGGER fiscal_revision_no_update BEFORE UPDATE ON fiscal_revisions BEGIN SELECT RAISE(ABORT,'immutable revision'); END;
CREATE TRIGGER fiscal_revision_no_delete BEFORE DELETE ON fiscal_revisions BEGIN SELECT RAISE(ABORT,'immutable revision'); END;
CREATE TRIGGER fiscal_artifact_no_update BEFORE UPDATE ON fiscal_artifacts BEGIN SELECT RAISE(ABORT,'immutable artifact'); END;
CREATE TRIGGER fiscal_artifact_no_delete BEFORE DELETE ON fiscal_artifacts BEGIN SELECT RAISE(ABORT,'immutable artifact'); END;
CREATE TRIGGER fiscal_audit_no_update BEFORE UPDATE ON fiscal_audit BEGIN SELECT RAISE(ABORT,'immutable audit'); END;
CREATE TRIGGER fiscal_audit_no_delete BEFORE DELETE ON fiscal_audit BEGIN SELECT RAISE(ABORT,'immutable audit'); END;
CREATE TRIGGER fiscal_event_no_update BEFORE UPDATE ON fiscal_events BEGIN SELECT RAISE(ABORT,'immutable event'); END;
CREATE TRIGGER fiscal_event_no_delete BEFORE DELETE ON fiscal_events BEGIN SELECT RAISE(ABORT,'immutable event'); END;
