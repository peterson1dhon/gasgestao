// Valida somente o desenho SQL em memória; não conecta à SEFAZ nem ao banco pessoal.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Store } from '../../electron/store.mjs';

const store = new Store(':memory:');
const db = store.db;
let checks = 0;
const ok = (fn) => { fn(); checks++; };
try {
  const customer = store.saveCustomer({name:'Cliente sintético',phone:'11900000001',address:'Rua de teste, 1'});
  const product = store.saveProduct({name:'Produto sintético',price_cents:100,cost_cents:50,stock:10,min_stock:0});
  const order = store.createOrder({customer_id:customer,delivery_type:'retirada',payment_method:'dinheiro',items:[{product_id:product,quantity:1}]});
  const before = JSON.stringify(store.getState());
  store.transaction(() => db.exec(readFileSync(new URL('./schema-v6-proposta.sql',import.meta.url),'utf8')));
  ok(() => assert.equal(JSON.stringify(store.getState()),before));
  ok(() => assert.equal(db.prepare('PRAGMA user_version').get().user_version,5));
  db.prepare('INSERT INTO fiscal_issuers VALUES (?,?,?,?)').run('issuer','SYNTHETIC','{}',0);
  for (const env of ['homologacao','producao']) {
    for (const model of [55,65]) db.prepare('INSERT INTO fiscal_sequences VALUES (?,?,?,?,?)').run('issuer',env,model,1,0);
  }
  const insert = (id,env='homologacao',model=55,number=1,state='prepared',active=1,key=id.padEnd(44,'A')) => db.prepare(
    'INSERT INTO fiscal_documents(id,order_id,issuer_id,environment,model,series,number,cnf,issued_at,access_key,state,active) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)'
  ).run(id,order,'issuer',env,model,1,number,'12345678','2026-10-24T12:00:00-03:00',key,state,active);
  insert('doc1');
  ok(() => assert.throws(() => insert('doc2','homologacao',65),/UNIQUE/));
  ok(() => assert.doesNotThrow(() => insert('prod','producao')));
  ok(() => assert.throws(() => insert('badstate','homologacao',55,2,'unknown'),/CHECK/));
  ok(() => assert.throws(() => insert('badactive','homologacao',55,2,'cancelled',1),/CHECK/));
  ok(() => assert.throws(() => db.exec("UPDATE fiscal_documents SET number=2 WHERE id='doc1'"),/immutable/));
  db.exec("UPDATE fiscal_sequences SET last_number=1 WHERE environment='homologacao' AND model=55");
  ok(() => assert.throws(() => db.exec("UPDATE fiscal_sequences SET last_number=0 WHERE environment='homologacao' AND model=55"),/decrease/));
  db.prepare('INSERT INTO fiscal_revisions VALUES (?,?,?,?,?,?,?)').run('doc1',1,'{}','a'.repeat(64),'study','policy','2026-10-24');
  ok(() => assert.throws(() => db.exec("UPDATE fiscal_revisions SET snapshot_json='{}'"),/immutable/));
  db.prepare('INSERT INTO fiscal_artifacts VALUES (?,?,?,?,?,?,?)').run('art1','doc1',1,'signed_xml',Buffer.from('<synthetic/>'),'b'.repeat(64),'2026-10-24');
  ok(() => assert.throws(() => db.exec('DELETE FROM fiscal_artifacts'),/immutable/));
  ok(() => assert.throws(() => db.prepare('INSERT INTO fiscal_artifacts VALUES (?,?,?,?,?,?,?)').run('orphan','missing',1,'response',Buffer.from('x'),'c'.repeat(64),'2026-10-24'),/FOREIGN KEY/));
  db.prepare('INSERT INTO fiscal_audit(document_id,actor,action,detail_json,created_at) VALUES (?,?,?,?,?)').run('doc1','test','prepared','{}','2026-10-24');
  ok(() => assert.throws(() => db.exec("UPDATE fiscal_audit SET actor='other'"),/immutable/));
  ok(() => assert.throws(() => store.transaction(() => { db.exec("UPDATE fiscal_sequences SET last_number=2 WHERE environment='homologacao' AND model=55"); throw new Error('rollback-test'); }),/rollback-test/));
  ok(() => assert.equal(db.prepare("SELECT last_number FROM fiscal_sequences WHERE environment='homologacao' AND model=55").get().last_number,1));
  const cas = db.prepare("UPDATE fiscal_documents SET row_version=row_version+1,state='signed' WHERE id='doc1' AND row_version=? AND state='prepared'");
  ok(() => assert.equal(cas.run(0).changes,1));
  ok(() => assert.equal(cas.run(0).changes,0));
  db.exec("UPDATE fiscal_documents SET state='cancelled',active=0 WHERE id='doc1'");
  ok(() => assert.doesNotThrow(() => insert('replacement','homologacao',55,2)));
  ok(() => assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok'));
  ok(() => assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0));
  ok(() => assert.equal(JSON.stringify(store.getState()),before));
  console.log(JSON.stringify({scope:'SQL design only; no network or personal database',checks,passed:checks,sourceSchema:5,migratedApplication:false}));
} finally { store.close(); }
