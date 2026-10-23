import { _electron as electron } from "playwright";
import electronPath from "electron";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Store, localDate } from "../electron/store.mjs";
const root = resolve(fileURLToPath(new URL("../", import.meta.url))),
  artifacts = join(root, ".test-artifacts");
await mkdir(artifacts, { recursive: true });
const dir = await mkdtemp(join(artifacts, "engagement-ui-"));
const packaged = process.argv.includes("--packaged");
const now = new Date();
let clock = now;
const store = new Store(join(dir, "gasgestao.sqlite"), { now: () => clock });
const customer = store.saveCustomer({
  name: "Maria de demonstração",
  phone: "11900000001",
  address: "Rua Exemplo, 10",
});
const gas = store.saveProduct({
  name: "Gás P13",
  category: "Gás",
  price_cents: 11000,
  cost_cents: 8000,
  stock: 100,
  min_stock: 1,
});
const water = store.saveProduct({
  name: "Água 20 L",
  category: "Água",
  price_cents: 1500,
  cost_cents: 700,
  stock: 100,
  min_stock: 1,
});
function buy(days, product) {
  clock = new Date(now);
  clock.setDate(clock.getDate() - days);
  clock.setHours(12, 0, 0, 0);
  const id = store.createOrder({
    customer_id: customer,
    delivery_type: "retirada",
    payment_method: "fiado",
    items: [{ product_id: product, quantity: 1 }],
  });
  store.changeOrderStatus({ order_id: id, status: "preparando" });
  store.changeOrderStatus({ order_id: id, status: "entregue" });
  return id;
}
buy(90, gas);
buy(60, gas);
const gasSource = buy(30, gas);
buy(14, water);
buy(9, water);
const waterSource = buy(5, water);
store.close();
const checks = [],
  errors = [];
let app;
const env = { ...process.env, GASGESTAO_DATA_DIR: dir, GASGESTAO_TEST: "1" };
delete env.ELECTRON_RUN_AS_NODE;
async function launch() {
  app = await electron.launch({
    executablePath: packaged
      ? join(root, "release", "win-unpacked", "GasGestao.exe")
      : electronPath,
    args: packaged ? [] : [root],
    env,
  });
  const p = await app.firstWindow();
  p.on("pageerror", (e) => errors.push(e.message));
  await p.getByTestId("classic-shell").waitFor();
  return p;
}
async function state(p) {
  const r = await p.evaluate(() => window.gasgestao.bootstrap());
  assert.equal(r.ok, true);
  return r.data;
}
async function nav(p, name) {
  await p
    .getByRole("navigation", { name: "Menu principal" })
    .getByRole("button", { name, exact: true })
    .click();
}
async function menu(p, name, item) {
  await p.getByRole("menuitem", { name, exact: true }).click();
  await p.getByRole("menuitem", { name: item }).click();
}
try {
  let page = await launch();
  assert.equal(
    (await state(page)).reminders.filter((r) => r.actionable).length,
    2,
  );
  await nav(page, "Clientes");
  await page
    .getByRole("button", {
      name: "Repetir último pedido de Maria de demonstração",
      exact: true,
    })
    .click();
  let dialog = page.getByRole("dialog");
  await dialog
    .getByText(new RegExp(`Baseado no pedido #${waterSource},`))
    .waitFor();
  assert.equal((await state(page)).orders.length, 6);
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden" });
  await page.evaluate(async (id) => {
    const s = (await window.gasgestao.bootstrap()).data;
    const p = s.products.find((p) => p.id === id);
    await window.gasgestao.saveProduct({ ...p, price_cents: 13000 });
  }, gas);
  await page.reload();
  await page.getByTestId("classic-shell").waitFor();
  await page
    .getByRole("button", { name: "Todas as datas", exact: true })
    .click();
  await page
    .getByRole("button", { name: `Abrir pedido ${gasSource}`, exact: true })
    .click();
  await page
    .getByRole("button", { name: "Repetir pedido", exact: true })
    .click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Quantidade de Gás P13").fill("2");
  assert.equal(
    await dialog.getByLabel("Recebimento", { exact: true }).inputValue(),
    "nao",
  );
  await dialog
    .getByRole("button", { name: "Criar pedido", exact: true })
    .click();
  await dialog.waitFor({ state: "hidden" });
  let s = await state(page);
  const repeated = s.orders[0];
  assert.equal(repeated.total_cents, 26000);
  assert.equal(repeated.paid_cents, 0);
  assert.equal(s.products.find((p) => p.id === gas).stock, 95);
  assert.equal(s.orders.find((o) => o.id === gasSource).total_cents, 11000);
  assert.equal(
    s.reminders.find((r) => r.product_id === gas).pending_order,
    true,
  );
  await page.evaluate(
    (id) =>
      window.gasgestao.changeOrderStatus({ order_id: id, status: "cancelado" }),
    repeated.id,
  );
  await page.reload();
  await page.getByTestId("classic-shell").waitFor();
  checks.push(
    "repetição pelo cliente e pelo pedido: rascunho revisável, preço atual, pagamento zerado e reserva apenas na confirmação",
  );
  await menu(page, "Movimentos", "Vasilhames emprestados");
  dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("Cliente do vasilhame")
    .selectOption(String(customer));
  await dialog
    .getByLabel("Tipo de vasilhame / produto")
    .selectOption(String(water));
  await dialog.getByLabel("Quantidade de vasilhames").fill("3");
  await dialog
    .getByLabel("Motivo ou referência do vasilhame")
    .fill("Galões emprestados na entrega de demonstração");
  await dialog
    .getByRole("button", { name: "Registrar vasilhames", exact: true })
    .click();
  await page.waitForFunction(
    async () =>
      (await window.gasgestao.bootstrap()).data.containers.balances[0]
        ?.quantity === 3,
  );
  await dialog
    .getByLabel("Movimentação de vasilhame")
    .selectOption("devolucao");
  await dialog.getByLabel("Quantidade de vasilhames").fill("1");
  await dialog
    .getByLabel("Motivo ou referência do vasilhame")
    .fill("Retorno de um galão");
  await dialog
    .getByRole("button", { name: "Registrar vasilhames", exact: true })
    .click();
  await page.waitForFunction(
    async () =>
      (await window.gasgestao.bootstrap()).data.containers.balances[0]
        ?.quantity === 2,
  );
  await dialog.getByLabel("Quantidade de vasilhames").fill("3");
  await dialog
    .getByRole("button", { name: "Registrar vasilhames", exact: true })
    .click();
  await dialog
    .getByRole("alert")
    .filter({ hasText: "supera o saldo" })
    .waitFor();
  assert.equal((await state(page)).containers.moves.length, 2);
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden" });
  await menu(page, "Movimentos", "Vasilhames emprestados");
  const screenshots = join(artifacts, "screenshots");
  await mkdir(screenshots, { recursive: true });
  await page.screenshot({
    path: join(screenshots, "vasilhames.png"),
    fullPage: true,
  });
  await page.keyboard.press("Escape");
  checks.push(
    "vasilhames: empréstimo, devolução parcial e bloqueio de devolução excedente sem alterar saldo",
  );
  await menu(page, "Utilitários", /^Lembretes de recompra/);
  dialog = page.getByRole("dialog");
  await dialog
    .getByRole("button", {
      name: "Preparar mensagem para Maria de demonstração: Água 20 L",
      exact: true,
    })
    .click();
  const message =
    "Olá, Maria! Tudo bem? Está precisando de água? Podemos combinar uma entrega no melhor horário para você.";
  await dialog.getByLabel("Mensagem do lembrete").fill(message);
  await page.screenshot({
    path: join(screenshots, "lembretes.png"),
    fullPage: true,
  });
  await dialog
    .getByRole("button", { name: "Abrir WhatsApp com mensagem", exact: true })
    .click();
  await dialog
    .getByRole("status")
    .filter({ hasText: "Modo de teste" })
    .waitFor();
  const result = await page.evaluate(
    async ({ customer, water, message }) => {
      const s = (await window.gasgestao.bootstrap()).data;
      const r = s.reminders.find(
        (r) => r.customer_id === customer && r.product_id === water,
      );
      return window.gasgestao.openReminderWhatsApp({ ...r, message });
    },
    { customer, water, message },
  );
  assert.equal(result.ok, true);
  assert.equal(result.data.opened, false);
  assert.equal(result.data.test, true);
  assert.equal(new URL(result.data.url).searchParams.get("text"), message);
  assert.equal(new URL(result.data.url).pathname, "/5511900000001");
  assert.equal(
    (await state(page)).reminders.find((r) => r.product_id === water).contacted,
    false,
  );
  await dialog
    .getByRole("button", { name: "Registrar contato realizado", exact: true })
    .click();
  await page.waitForFunction(
    async () =>
      (await window.gasgestao.bootstrap()).data.reminders.find(
        (r) => r.product_name === "Água 20 L",
      ).contacted,
  );
  await dialog
    .getByRole("checkbox", { name: "Mostrar próximos e já tratados" })
    .check();
  await dialog
    .getByRole("button", {
      name: "Preparar mensagem para Maria de demonstração: Gás P13",
      exact: true,
    })
    .click();
  await dialog
    .getByRole("button", { name: "Adiar lembrete", exact: true })
    .click();
  await page.waitForFunction(
    async () =>
      (await window.gasgestao.bootstrap()).data.reminders.find(
        (r) => r.product_name === "Gás P13",
      ).snoozed,
  );
  await dialog
    .getByRole("button", {
      name: "Desativar lembretes do cliente",
      exact: true,
    })
    .click();
  await dialog
    .getByRole("button", { name: "Reativar lembretes do cliente", exact: true })
    .click();
  await page.setViewportSize({ width: 1000, height: 720 });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await page.screenshot({
    path: join(screenshots, "lembretes-1000px.png"),
    fullPage: true,
  });
  await app.close();
  app = null;
  page = await launch();
  s = await state(page);
  assert.equal(s.containers.balances[0].quantity, 2);
  assert.equal(s.reminders.find((r) => r.product_id === water).contacted, true);
  assert.equal(s.reminders.find((r) => r.product_id === water).contact_message,message);
  assert.equal(s.reminders.find((r) => r.product_id === gas).snoozed, true);
  assert.equal(
    s.reminders.every((r) => r.enabled),
    true,
  );
  checks.push(
    "lembretes: médias separadas, edição de mensagem, link seguro em teste sem envio, contato manual, adiamento e pausa",
  );
  checks.push(
    "reinício preserva vasilhames e ciclo de contato; janelas utilizáveis em 1000px",
  );
  assert.equal(errors.length, 0, errors.join("\n"));
  const resultReport = {
    ok: true,
    packaged,
    checks,
    errors,
    noExternalMessages: true,
    finished: new Date().toISOString(),
  };
  await writeFile(
    join(
      artifacts,
      packaged ? "engagement-ui-packaged.json" : "engagement-ui.json",
    ),
    JSON.stringify(resultReport, null, 2),
  );
  console.log(JSON.stringify(resultReport));
} catch (e) {
  if (app) {
    const pages = app.windows();
    await pages[0]
      ?.screenshot({
        path: join(artifacts, "engagement-failure.png"),
        fullPage: true,
      })
      .catch(() => {});
  }
  throw e;
} finally {
  if (app) await app.close();
}
