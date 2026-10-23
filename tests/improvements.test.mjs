import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validCnpj, normalizeCnpj } from "../electron/cnpj.mjs";
import { contains } from "../shared/search.mjs";
import { Store } from "../electron/store.mjs";
import { receiptHtml } from "../electron/receipt.mjs";
test("CNPJ aceita vetores oficiais numéricos e alfanuméricos e rejeita DV incorreto", () => {
  for (const value of [
    "12.ABC.345/01DE-35",
    "90.021.382/0001-22",
    "00000000000191",
    "ABCDEFGHIJKL80",
  ])
    assert.equal(validCnpj(value), true, value);
  for (const value of [
    "12.ABC.345/01DE-36",
    "ABCDEFGHIJKL81",
    "00000000000000",
    "0000000000019L",
    "0123456?789ABC",
    "12ABC34501DE35<script>",
  ])
    assert.equal(validCnpj(value), false, value);
  assert.equal(normalizeCnpj(" 12.abc.345/01de-35 "), "12ABC34501DE35");
});
test("busca aceita caracteres invisíveis, acentos, máscara de telefone e CNPJ sem alterar dados", () => {
  const original = "José da Silva 11900000001 12ABC34501DE35";
  for (const query of [
    "\u200e José\u200b da\u00a0Silva \u200f",
    "JOSE\tDA\nSILVA",
    "\u202a(11) 90000-0001\u202c",
    "12.ABC.345/01DE-35",
  ])
    assert.equal(contains(original, query), true, query);
  assert.equal(contains(original, "11999999999"), false);
  assert.equal(contains(original, "outra pessoa"), false);
  assert.equal(contains(original, "\u200b"), true);
});
test("banco versão 2 migra preservando CEP e cliente; CNPJ e opções sobrevivem ao reinício", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "improvements-"));
  t.after(() => {
    store?.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const path = join(dir, "app.sqlite");
  let store = new Store(path);
  const customer = store.saveCustomer({
    name: "Empresa de teste",
    postal_code: "12345678",
    address: "Rua anterior, 15",
  });
  store.db.exec(
    "DROP TABLE reminder_events; DROP TABLE reminder_preferences; DROP TABLE container_moves; DROP INDEX items_customer_reminder; ALTER TABLE customers DROP COLUMN cnpj; PRAGMA user_version=2;",
  );
  store.close();
  store = new Store(path);
  assert.equal(store.getState().customers[0].address, "Rua anterior, 15");
  assert.equal(store.getState().customers[0].postal_code, "12345678");
  assert.equal(store.getState().customers[0].cnpj, "");
  assert.equal(store.settings().receipt_left_columns, 0);
  store.saveCustomer({
    id: customer,
    name: "Empresa de teste",
    postal_code: "12345678",
    cnpj: "12.abc.345/01de-35",
  });
  assert.throws(
    () => store.saveCustomer({ name: "Inválida", cnpj: "12ABC34501DE36" }),
    /CNPJ inválido/,
  );
  assert.equal(store.getState().customers.length, 1);
  store.saveSettings({
    name: "Teste",
    receipt_left_columns: 8,
    require_customer_phone: true,
  });
  assert.throws(
    () => store.saveCustomer({ name: "Sem telefone" }),
    /telefone com DDD/,
  );
  store.saveCustomer({ name: "Com telefone", phone: "11900000001" });
  assert.throws(
    () => store.saveSettings({ name: "Teste", receipt_left_columns: -1 }),
    /Margem esquerda/,
  );
  assert.throws(
    () => store.saveSettings({ name: "Teste", receipt_left_columns: 41 }),
    /Margem esquerda/,
  );
  assert.throws(
    () => store.saveSettings({ name: "Teste", receipt_left_columns: 1.5 }),
    /Margem esquerda/,
  );
  store.close();
  store = new Store(path);
  assert.equal(
    store.getState().customers.find((c) => c.id === customer).cnpj,
    "12ABC34501DE35",
  );
  assert.equal(store.settings().receipt_left_columns, 8);
  assert.equal(store.settings().require_customer_phone, true);
});
test("comprovante respeita margem, mostra CNPJ e pede assinatura só para venda a prazo pendente", () => {
  const store = new Store(":memory:");
  try {
    const customer = store.saveCustomer({
      name: "Empresa de teste",
      cnpj: "12ABC34501DE35",
    });
    const product = store.saveProduct({
      name: "Produto",
      price_cents: 10000,
      cost_cents: 5000,
      stock: 5,
      min_stock: 0,
    });
    const id = store.createOrder({
      customer_id: customer,
      delivery_type: "retirada",
      payment_method: "fiado",
      items: [{ product_id: product, quantity: 1 }],
      delivery_fee_cents: 0,
      discount_cents: 0,
      paid_cents: 0,
    });
    const order = store.getOrder(id);
    const html = receiptHtml(order, { name: "Teste", receipt_left_columns: 8 });
    assert.match(html, /margin-left:8ch/);
    assert.match(html, /12ABC34501DE35/);
    assert.match(html, /Assinatura do cliente/);
    assert.match(html, /VENDA A PRAZO/);
    assert.doesNotMatch(
      receiptHtml({ ...order, paid_cents: 10000 }, { name: "Teste" }),
      /Assinatura do cliente/,
    );
    assert.doesNotMatch(
      receiptHtml({ ...order, status: "cancelado" }, { name: "Teste" }),
      /Assinatura do cliente/,
    );
    assert.doesNotMatch(
      receiptHtml({ ...order, payment_method: "pix" }, { name: "Teste" }),
      /Assinatura do cliente/,
    );
    assert.doesNotMatch(
      receiptHtml(order, {
        name: "Teste",
        receipt_left_columns: "1; color:red",
      }),
      /color:red/,
    );
  } finally {
    store.close();
  }
});
