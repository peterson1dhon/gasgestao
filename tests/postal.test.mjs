import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { lookupPostal } from "../electron/postal.mjs";
import { Store } from "../electron/store.mjs";
import { createPostalFixture } from "./helpers/postal-fixture.mjs";
test("consulta offline aceita CEP formatado, mantém opções e não altera a base", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "postal-test-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, "cep.sqlite");
  createPostalFixture(path);
  const before = readFileSync(path);
  const found = lookupPostal(path, "12345-678");
  assert.equal(found.offline, true);
  assert.equal(found.addresses[0].street, "Rua de Teste Offline");
  assert.equal(lookupPostal(path, "12345000").addresses.length, 2);
  assert.equal(lookupPostal(path, "00000000").addresses.length, 0);
  assert.throws(() => lookupPostal(path, "1234' OR 1=1"), /8 dígitos/);
  assert.throws(
    () => lookupPostal(join(dir, "ausente.sqlite"), "12345678"),
    /não instalada/,
  );
  assert.deepEqual(readFileSync(path), before);
});
test("migração da versão 1 preserva cadastros e persiste CEP e UF após reiniciar", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "postal-migrate-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, "app.sqlite");
  const old = new DatabaseSync(path);
  old.exec(
    "CREATE TABLE customers(id INTEGER PRIMARY KEY,name TEXT,phone TEXT,address TEXT,neighborhood TEXT,city TEXT,notes TEXT,active INTEGER); INSERT INTO customers VALUES(1,'Cliente existente','','Rua antiga, 20','','Cidade antiga','Observação original',1); PRAGMA user_version=1;",
  );
  old.exec(
    'CREATE TABLE settings(id INTEGER PRIMARY KEY,value TEXT); INSERT INTO settings VALUES(1,\'{"name":"Revenda antiga"}\');',
  );
  old.exec("CREATE TABLE order_items(product_id INTEGER,order_id INTEGER);");
  old.close();
  const store = new Store(path);
  assert.equal(
    store.db.prepare("SELECT postal_code FROM customers").get().postal_code,
    "",
  );
  assert.equal(
    store.db.prepare("SELECT address FROM customers").get().address,
    "Rua antiga, 20",
  );
  store.saveCustomer({
    id: 1,
    name: "Cliente existente",
    address: "Rua antiga, 20",
    postal_code: "12345-678",
    uf: "sp",
    notes: "Observação original",
  });
  assert.throws(
    () => store.saveCustomer({ name: "Inválido", postal_code: "123" }),
    /CEP/,
  );
  store.close();
  const reopened = new Store(path);
  const row = reopened.db.prepare("SELECT * FROM customers WHERE id=1").get();
  assert.equal(row.postal_code, "12345678");
  assert.equal(row.uf, "SP");
  assert.equal(row.notes, "Observação original");
  reopened.close();
});
