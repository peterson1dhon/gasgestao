import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store, ValidationError, localDate } from "../electron/store.mjs";
import { receiptHtml } from "../electron/receipt.mjs";
function setup(t, stock = 10) {
  const store = new Store(":memory:");
  t.after(() => store.close());
  const customer = store.saveCustomer({
    name: "Cliente de teste",
    phone: "11900000001",
    address: "Rua Exemplo, 10",
  });
  const product = store.saveProduct({
    name: "Gás P13",
    price_cents: 11000,
    cost_cents: 8000,
    stock,
    min_stock: 2,
  });
  const driver = store.saveDriver({ name: "Entregador de teste" });
  const order = (extra = {}) =>
    store.createOrder({
      customer_id: customer,
      driver_id: driver,
      delivery_type: "entrega",
      delivery_address: "Rua Exemplo, 10",
      payment_method: "pix",
      items: [{ product_id: product, quantity: 2 }],
      ...extra,
    });
  return { store, customer, product, driver, order };
}
test("pedido reserva estoque e preserva preço histórico quando produto é atualizado", (t) => {
  const { store, product, order } = setup(t);
  const orderId = order({ delivery_fee_cents: 500, discount_cents: 100 });
  assert.equal(store.getEntity("products", product, "Produto").stock, 8);
  assert.equal(store.getOrder(orderId).total_cents, 22400);
  store.saveProduct({
    id: product,
    name: "Novo nome",
    price_cents: 12000,
    cost_cents: 9000,
    min_stock: 3,
  });
  assert.equal(store.getOrder(orderId).items[0].name, "Gás P13");
  assert.equal(store.getOrder(orderId).items[0].unit_price_cents, 11000);
});
test("estoque insuficiente desfaz integralmente o pedido e as movimentações", (t) => {
  const { store, product, order } = setup(t, 1);
  assert.throws(() => order(), /Estoque insuficiente/);
  assert.equal(store.getState().orders.length, 0);
  assert.equal(store.getEntity("products", product, "Produto").stock, 1);
  assert.equal(store.getState().stockMoves.length, 1);
});
test("produto repetido no carrinho não contorna limite de estoque", (t) => {
  const { store, product, order } = setup(t, 3);
  assert.throws(
    () =>
      order({
        items: [
          { product_id: product, quantity: 2 },
          { product_id: product, quantity: 2 },
        ],
      }),
    /Estoque insuficiente/,
  );
  assert.equal(store.getState().orders.length, 0);
});
test("pagamentos parciais não permitem exceder o total", (t) => {
  const { store, order } = setup(t);
  const orderId = order({ paid_cents: 10000 });
  assert.equal(store.getOrder(orderId).paid_cents, 10000);
  assert.throws(
    () =>
      store.receivePayment({
        order_id: orderId,
        amount_cents: 13000,
        method: "pix",
      }),
    ValidationError,
  );
  store.receivePayment({
    order_id: orderId,
    amount_cents: 12000,
    method: "dinheiro",
  });
  assert.equal(store.getOrder(orderId).paid_cents, 22000);
  assert.equal(store.getState().metrics.cash_balance, 22000);
});
test("cancelamento repõe estoque e estorna recebimentos por forma de pagamento uma única vez", (t) => {
  const { store, product, order } = setup(t);
  const orderId = order({ paid_cents: 10000 });
  store.receivePayment({
    order_id: orderId,
    amount_cents: 12000,
    method: "dinheiro",
  });
  store.changeOrderStatus({ order_id: orderId, status: "cancelado" });
  assert.equal(store.getEntity("products", product, "Produto").stock, 10);
  assert.equal(store.getState().metrics.cash_balance, 0);
  assert.equal(store.getOrder(orderId).paid_cents, 0);
  assert.equal(
    store.getState().cashEntries.filter((e) => e.flow === "saida").length,
    2,
  );
  assert.throws(
    () => store.changeOrderStatus({ order_id: orderId, status: "cancelado" }),
    /já está cancelado/,
  );
  assert.throws(
    () =>
      store.receivePayment({
        order_id: orderId,
        amount_cents: 1,
        method: "pix",
      }),
    /cancelados/,
  );
});
test("fluxo de entrega exige entregador e a passagem pela rota", (t) => {
  const { store, order, driver } = setup(t);
  const orderId = order({ driver_id: null });
  assert.throws(
    () => store.changeOrderStatus({ order_id: orderId, status: "entregue" }),
    ValidationError,
  );
  store.changeOrderStatus({ order_id: orderId, status: "preparando" });
  assert.throws(
    () => store.changeOrderStatus({ order_id: orderId, status: "em_rota" }),
    /entregador/,
  );
  store.assignDriver({ order_id: orderId, driver_id: driver });
  store.changeOrderStatus({ order_id: orderId, status: "em_rota" });
  assert.throws(
    () => store.assignDriver({ order_id: orderId, driver_id: null }),
    /Mantenha/,
  );
  store.changeOrderStatus({ order_id: orderId, status: "entregue" });
  assert.equal(store.getOrder(orderId).status, "entregue");
  assert.equal(
    store.getOrder(orderId).paid_cents,
    0,
    "entrega não inventa recebimento",
  );
});
test("retirada pode ser concluída depois do preparo", (t) => {
  const { store, order } = setup(t);
  const orderId = order({
    delivery_type: "retirada",
    delivery_address: "",
    driver_id: null,
  });
  store.changeOrderStatus({ order_id: orderId, status: "preparando" });
  store.changeOrderStatus({ order_id: orderId, status: "entregue" });
  assert.equal(store.getOrder(orderId).status, "entregue");
});
test("ajuste de estoque exige motivo e não permite saldo negativo", (t) => {
  const { store, product } = setup(t, 3);
  assert.throws(
    () => store.adjustStock({ product_id: product, delta: -4, note: "Perda" }),
    /supera/,
  );
  assert.throws(
    () => store.adjustStock({ product_id: product, delta: 2, note: "" }),
    ValidationError,
  );
  store.adjustStock({
    product_id: product,
    delta: 5,
    note: "Compra de reposição",
  });
  assert.equal(store.getEntity("products", product, "Produto").stock, 8);
});
test("centavos fracionados, descontos inválidos e telefone inválido são rejeitados", (t) => {
  const { store, order } = setup(t);
  assert.throws(
    () => store.saveCustomer({ name: "A", phone: "123" }),
    ValidationError,
  );
  assert.throws(() => order({ discount_cents: 23000 }), ValidationError);
  assert.throws(() => order({ paid_cents: 1.5 }), ValidationError);
  assert.equal(store.getState().orders.length, 0);
});
test("backup abre com integridade e preserva dados depois de reiniciar", (t) => {
  const temp = mkdtempSync(join(tmpdir(), "gasgestao-test-"));
  t.after(() => rmSync(temp, { recursive: true, force: true }));
  const path = join(temp, "banco.sqlite");
  const backup = join(temp, "backup.sqlite");
  const store = new Store(path);
  store.saveCustomer({ name: "Persistido" });
  store.backupTo(backup);
  store.close();
  const reopened = new Store(path);
  assert.equal(reopened.getState().customers[0].name, "Persistido");
  reopened.close();
  const restored = new Store(backup);
  assert.equal(restored.getState().customers[0].name, "Persistido");
  assert.equal(
    restored.db.prepare("PRAGMA integrity_check").get().integrity_check,
    "ok",
  );
  restored.close();
});
test("relatório exclui cancelados e respeita período", (t) => {
  const { store, order } = setup(t);
  const a = order();
  const b = order();
  store.changeOrderStatus({ order_id: b, status: "cancelado" });
  const date = localDate();
  const report = store.report(date, date);
  assert.equal(report.orders, 1);
  assert.equal(report.sales, 22000);
  assert.equal(report.products[0].quantity, 2);
  assert.throws(() => store.report("x", date), ValidationError);
});
test("comprovante escapa texto de cliente e de produto", (t) => {
  const { store, customer, order } = setup(t);
  store.saveCustomer({ id: customer, name: "<script>alert(1)</script>" });
  const html = receiptHtml(store.getOrder(order()), {
    name: "Revenda & Exemplo",
  });
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(!html.includes("<script>"));
  assert.ok(html.includes("Revenda &amp; Exemplo"));
});
test("comprovante cancelado não apresenta o valor estornado como dívida", (t) => {
  const { store, order } = setup(t);
  const orderId = order({ paid_cents: 22000 });
  store.changeOrderStatus({ order_id: orderId, status: "cancelado" });
  const html = receiptHtml(store.getOrder(orderId), { name: "Teste" }).replace(
    /\u00a0/g,
    " ",
  );
  assert.ok(html.includes("<p>A receber: R$ 0,00</p>"));
});
test("demonstração só é criada em base vazia e mantém regras de estoque e caixa", (t) => {
  const store = new Store(":memory:");
  t.after(() => store.close());
  store.seedDemo();
  const state = store.getState();
  assert.equal(state.orders.length, 12);
  assert.ok(state.products.every((p) => p.stock >= 0));
  assert.throws(() => store.seedDemo(), /base vazia/);
  assert.equal(
    state.metrics.cash_balance,
    state.cashEntries.reduce(
      (sum, e) =>
        sum + (e.flow === "entrada" ? e.amount_cents : -e.amount_cents),
      0,
    ),
  );
});
