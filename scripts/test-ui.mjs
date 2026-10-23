import { createPostalFixture } from "../tests/helpers/postal-fixture.mjs";
import { _electron as electron } from "playwright";
import electronPath from "electron";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";
const root = resolve(fileURLToPath(new URL("../", import.meta.url)));
const artifacts = join(root, ".test-artifacts");
const packaged = process.argv.includes("--packaged");
const reportFilename = packaged ? "ui-result-packaged.json" : "ui-result.json";
await mkdir(artifacts, { recursive: true });
const dataDir = await mkdtemp(join(artifacts, "e2e-"));
const postalFixture = join(dataDir, "cep-fixture.sqlite");
createPostalFixture(postalFixture);
const errors = [];
const checks = [];
const env = {
  ...process.env,
  GASGESTAO_DATA_DIR: dataDir,
  GASGESTAO_TEST: "1",
  GASGESTAO_CEP_DB: postalFixture,
};
delete env.ELECTRON_RUN_AS_NODE;
async function launch(path = dataDir) {
  const app = await electron.launch({
    executablePath: packaged
      ? join(root, "release", "win-unpacked", "GasGestao.exe")
      : electronPath,
    args: packaged ? [] : [root],
    env: { ...env, GASGESTAO_DATA_DIR: path },
    timeout: 60000,
  });
  const page = await app.firstWindow();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.getByTestId("classic-shell").waitFor({ timeout: 30000 });
  return { app, page };
}
let running;
async function state(page) {
  const result = await page.evaluate(() => window.gasgestao.bootstrap());
  assert.equal(result.ok, true);
  return result.data;
}
try {
  running = await launch();
  assert.equal(
    await running.app.evaluate(({ app }) => app.isPackaged),
    packaged,
  );
  let { page } = running;
  const nav = async (name) =>
    page
      .getByRole("navigation", { name: "Menu principal" })
      .getByRole("button", { name, exact: true })
      .click();
  await nav("Clientes");
  await page.getByRole("button", { name: "Novo cliente", exact: true }).click();
  let dialog = page.getByRole("dialog");
  await dialog.getByLabel("Nome do cliente").fill("Cliente Teste UI");
  await dialog.getByLabel("Telefone com DDD").fill("11900000001");
  await dialog.getByLabel("CNPJ (opcional)").fill("12ABC34501DE36");
  await dialog.getByRole("button", { name: "Salvar", exact: true }).click();
  await dialog
    .getByRole("alert")
    .filter({ hasText: "CNPJ inválido" })
    .waitFor();
  await dialog.getByLabel("CNPJ (opcional)").fill("12.ABC.345/01DE-35");
  await dialog.getByLabel("CEP", { exact: true }).fill("12345-678");
  await page.waitForFunction(
    () =>
      document.querySelector('input[name="address"]')?.value ===
      "Rua de Teste Offline",
  );
  assert.equal(
    await dialog.getByLabel("Bairro", { exact: true }).inputValue(),
    "Bairro Teste",
  );
  assert.equal(
    await dialog.getByLabel("UF", { exact: true }).inputValue(),
    "SP",
  );
  await dialog.getByLabel("CEP", { exact: true }).fill("00000000");
  await dialog
    .getByRole("status")
    .filter({ hasText: "CEP não encontrado" })
    .waitFor();
  assert.equal(
    await dialog.getByLabel("Endereço", { exact: true }).inputValue(),
    "Rua de Teste Offline",
  );
  await dialog.getByLabel("CEP", { exact: true }).fill("12345000");
  await dialog.getByLabel("Endereços encontrados").selectOption("1");
  assert.equal(
    await dialog.getByLabel("Endereço", { exact: true }).inputValue(),
    "Rua Alternativa B",
  );
  await dialog.getByLabel("Endereço", { exact: true }).fill("Rua Exemplo, 10");
  await dialog.getByLabel("Cidade", { exact: true }).fill("Cidade Exemplo");
  await dialog.getByRole("button", { name: "Salvar", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
  checks.push("cadastro de cliente pela interface");
  const savedCustomer = (await state(page)).customers[0];
  assert.equal(savedCustomer.postal_code, "12345000");
  assert.equal(savedCustomer.uf, "SP");
  assert.equal(savedCustomer.cnpj, "12ABC34501DE35");
  const customerSearch = page.getByPlaceholder(
    "Buscar nome, telefone ou endereço",
  );
  await customerSearch.fill("\u200e (11) 90000-0001 \u200f");
  assert.equal(await page.locator(".person-cell").count(), 1);
  await customerSearch.fill("12.ABC.345/01DE-35");
  assert.equal(await page.locator(".person-cell").count(), 1);
  await customerSearch.fill("");
  checks.push(
    "CNPJ alfanumérico validado e busca com telefone colado e CNPJ formatado",
  );
  checks.push(
    "CEP offline: preenchimento, não encontrado, escolha entre endereços e persistência",
  );
  await nav("Produtos");
  await page.getByRole("button", { name: "Novo produto", exact: true }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Nome do produto").fill("Gás Teste UI");
  await dialog.getByLabel("Preço de venda").fill("110,00");
  await dialog.getByLabel("Custo unitário").fill("80,00");
  await dialog.getByLabel("Estoque inicial").fill("5");
  await dialog.getByLabel("Estoque mínimo").fill("1");
  await dialog.getByRole("button", { name: "Salvar", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
  await nav("Entregadores");
  await page
    .getByRole("button", { name: "Novo entregador", exact: true })
    .click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Nome do entregador").fill("Entregador Teste UI");
  await dialog.getByRole("button", { name: "Salvar", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
  checks.push("cadastro de produto e entregador");
  await nav("Pedidos");
  await page.getByRole("button", { name: "Novo pedido", exact: true }).click();
  dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("Cliente", { exact: true })
    .selectOption({ label: "Cliente Teste UI · (11) 90000-0001" });
  await dialog
    .getByLabel("Entregador", { exact: true })
    .selectOption({ label: "Entregador Teste UI" });
  await dialog
    .getByLabel("Adicionar produto", { exact: true })
    .selectOption({ index: 1 });
  await dialog.getByRole("button", { name: "Adicionar", exact: true }).click();
  await dialog.getByLabel("Quantidade de Gás Teste UI").fill("2");
  await dialog
    .getByLabel("Recebimento", { exact: true })
    .selectOption("parcial");
  await dialog.getByLabel("Recebido agora").fill("30,00");
  await dialog
    .getByRole("button", { name: "Criar pedido", exact: true })
    .click();
  await dialog.waitFor({ state: "hidden" });
  let s = await state(page);
  assert.equal(s.products[0].stock, 3);
  assert.equal(s.orders[0].paid_cents, 3000);
  assert.equal(s.orders[0].total_cents, 22000);
  checks.push("pedido com reserva e pagamento parcial");
  await page
    .getByRole("button", { name: "Abrir pedido 1", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Registrar recebimento", exact: true })
    .click();
  dialog = page.getByRole("dialog");
  await dialog
    .getByRole("button", { name: "Confirmar recebimento", exact: true })
    .click();
  await dialog.waitFor({ state: "hidden" });
  await page
    .getByRole("button", { name: "Abrir pedido 1", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Iniciar preparo", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Enviar para entrega", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Confirmar entrega", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByText("Entregue", { exact: true })
    .waitFor();
  s = await state(page);
  assert.equal(s.orders[0].status, "entregue");
  assert.equal(s.orders[0].paid_cents, 22000);
  checks.push("recebimento complementar e fluxo completo da entrega");
  await page
    .getByRole("button", { name: "Cancelar pedido", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Confirmar cancelamento", exact: true })
    .click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  s = await state(page);
  assert.equal(s.products[0].stock, 5);
  assert.equal(s.metrics.cash_balance, 0);
  assert.equal(s.orders[0].status, "cancelado");
  checks.push("cancelamento com reposição e estorno pela interface");
  await page.getByRole("button", { name: "Novo pedido", exact: true }).click();
  dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("Cliente", { exact: true })
    .selectOption({ index: 1 });
  await dialog
    .getByLabel("Adicionar produto", { exact: true })
    .selectOption({ index: 1 });
  await dialog.getByRole("button", { name: "Adicionar", exact: true }).click();
  await dialog.getByLabel("Quantidade de Gás Teste UI").fill("99");
  await dialog
    .getByRole("button", { name: "Criar pedido", exact: true })
    .click();
  await dialog
    .getByRole("alert")
    .filter({ hasText: "Estoque insuficiente" })
    .waitFor();
  await dialog.getByRole("button", { name: "Fechar janela" }).click();
  s = await state(page);
  assert.equal(s.orders.length, 1);
  assert.equal(s.products[0].stock, 5);
  checks.push("erro de estoque mantém a operação intacta");
  await nav("Estoque");
  await page
    .getByRole("button", { name: "Movimentar estoque", exact: true })
    .click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Quantidade", { exact: true }).fill("3");
  await dialog.getByLabel("Motivo", { exact: true }).fill("Reposição de teste");
  await dialog
    .getByRole("button", { name: "Registrar movimentação", exact: true })
    .click();
  await dialog.waitFor({ state: "hidden" });
  assert.equal((await state(page)).products[0].stock, 8);
  await nav("Caixa");
  await page
    .getByRole("button", { name: "Novo lançamento", exact: true })
    .click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Valor (R$)").fill("25,00");
  await dialog.getByLabel("Descrição").fill("Despesa de teste");
  await dialog
    .getByRole("button", { name: "Registrar lançamento", exact: true })
    .click();
  await dialog.waitFor({ state: "hidden" });
  assert.equal((await state(page)).metrics.cash_balance, -2500);
  checks.push("reposição de estoque e despesa de caixa");
  await nav("Relatórios");
  await page.getByRole("heading", { name: "Produtos mais vendidos" }).waitFor();
  await page
    .getByRole("button", { name: "Configurações", exact: true })
    .click();
  await page.getByLabel("Nome da revenda").fill("Revenda Teste UI");
  await page
    .getByText("Opções de cadastro e impressão", { exact: true })
    .click();
  await page.getByLabel("Margem esquerda do recibo (colunas)").fill("8");
  await page
    .getByRole("checkbox", { name: "Exigir telefone no cadastro de clientes" })
    .check();
  await page
    .getByRole("button", { name: "Salvar configurações", exact: true })
    .click();
  await page
    .locator(".classic-statusbar")
    .filter({ hasText: "Revenda Teste UI" })
    .waitFor();
  assert.equal(await page.evaluate(() => typeof window.require), "undefined");
  assert.equal(await page.evaluate(() => typeof window.process), "undefined");
  checks.push("relatórios, configurações e isolamento do renderer");
  await nav("Clientes");
  await page.getByRole("button", { name: "Novo cliente", exact: true }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Nome do cliente").fill("Cliente sem telefone");
  await dialog.getByRole("button", { name: "Salvar", exact: true }).click();
  await dialog
    .getByRole("alert")
    .filter({ hasText: "telefone com DDD" })
    .waitFor();
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden" });
  checks.push(
    "configuração de margem do recibo e telefone obrigatório opcional",
  );
  await running.app.close();
  running = null;
  running = await launch();
  s = await state(running.page);
  assert.equal(s.settings.name, "Revenda Teste UI");
  assert.equal(s.settings.receipt_left_columns, 8);
  assert.equal(s.settings.require_customer_phone, true);
  assert.equal(s.customers[0].cnpj, "12ABC34501DE35");
  assert.equal(s.products[0].stock, 8);
  assert.equal(s.orders[0].status, "cancelado");
  assert.equal(s.metrics.cash_balance, -2500);
  const backups = await readdir(join(dataDir, "backups"));
  assert.ok(backups.some((p) => p.endsWith(".sqlite")));
  await running.app.close();
  running = null;
  checks.push("persistência após reiniciar e backup automático");
  const demoDir = await mkdtemp(join(artifacts, "demo-"));
  running = await launch(demoDir);
  page = running.page;
  await page
    .getByRole("navigation", { name: "Menu principal" })
    .getByRole("button", { name: "Visão geral", exact: true })
    .click();
  await page.getByRole("button", { name: "Explorar demonstração" }).click();
  await page
    .getByRole("button", { name: "Carregar demonstração", exact: true })
    .click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  const screenshots = join(artifacts, "screenshots");
  await mkdir(screenshots, { recursive: true });
  const toast = page.getByRole("button", { name: "Fechar notificação" });
  if (await toast.isVisible()) await toast.click();
  await page.screenshot({
    path: join(screenshots, "visao-geral.png"),
    fullPage: true,
  });
  for (const [navName, filename] of [
    ["Pedidos", "pedidos"],
    ["Clientes", "clientes"],
    ["Estoque", "estoque"],
    ["Caixa", "caixa"],
  ]) {
    await page
      .getByRole("navigation", { name: "Menu principal" })
      .getByRole("button", { name: new RegExp(`^${navName}`) })
      .click();
    await page.screenshot({
      path: join(screenshots, `${filename}.png`),
      fullPage: true,
    });
  }
  await page.getByRole("menuitem", { name: "Movimentos", exact: true }).click();
  await page.getByRole("menuitem", { name: /^Pedidos Realizados/ }).click();
  assert.ok((await page.locator(".orders-table tbody tr").count()) > 0);
  await page
    .getByRole("button", { name: "Todas as datas", exact: true })
    .click();
  assert.equal(await page.locator(".orders-table tbody tr").count(), 12);
  await page.getByLabel("Situação do pedido", { exact: true }).selectOption("a_receber");
  const unpaid = (await state(page)).orders.filter(
    (o) => o.status !== "cancelado" && o.paid_cents < o.total_cents,
  );
  assert.equal(
    await page.locator(".orders-table tbody tr").count(),
    unpaid.length,
  );
  assert.ok(unpaid.some((o) => o.status === "entregue"));
  await page.getByLabel("Situação do pedido", { exact: true }).selectOption("todos");
  checks.push(
    "filtro financeiro inclui pedidos entregues com pagamento pendente",
  );
  await page
    .getByRole("radio", { name: "C/Pgto a prazo", exact: true })
    .check();
  const cancelled = await page.locator(".orders-table tbody tr").count();
  assert.ok(cancelled > 0 && cancelled < 12);
  assert.ok(
    await page
      .locator(".orders-table tbody tr")
      .first()
      .evaluate((el) => el.classList.contains("order-aprazo")),
  );
  await page
    .getByRole("radio", { name: "Todos os Pedidos", exact: true })
    .check();
  await page.getByRole("checkbox", { name: "Entregue", exact: true }).uncheck();
  assert.ok((await page.locator(".orders-table tbody tr").count()) < 12);
  await page.getByRole("checkbox", { name: "Entregue", exact: true }).check();
  await page.keyboard.press("F8");
  await page.getByRole("dialog").waitFor();
  await page.screenshot({
    path: join(screenshots, "novo-pedido.png"),
    fullPage: true,
  });
  await page.keyboard.press("Escape");
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "Minimizar janela interna" }).click();
  assert.equal(await page.locator(".classic-page-window").count(), 0);
  await page
    .getByRole("button", { name: "Pedidos Realizados", exact: true })
    .click();
  assert.equal(await page.locator(".classic-page-window").count(), 1);
  await page.setViewportSize({ width: 1000, height: 720 });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  );
  await page.screenshot({
    path: join(screenshots, "pedidos-1000px.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 940 });
  await page.getByRole("button", { name: "Hoje", exact: true }).click();
  await page.screenshot({
    path: join(screenshots, "pedidos.png"),
    fullPage: true,
  });
  await page
    .getByRole("navigation", { name: "Menu principal" })
    .getByRole("button", { name: "Clientes", exact: true })
    .click();
  await page.getByRole("button", { name: "Novo cliente", exact: true }).click();
  await page.screenshot({
    path: join(screenshots, "novo-cliente.png"),
    fullPage: true,
  });
  await page.keyboard.press("Escape");
  checks.push(
    "layout clássico: menus, filtros por cor e entrega, F8, minimizar/restaurar e janela de 1000px",
  );
  assert.equal(errors.length, 0, errors.join("\n"));
  checks.push("demonstração e cinco capturas da interface real");
  await writeFile(
    join(artifacts, reportFilename),
    JSON.stringify(
      {
        ok: true,
        packaged,
        checks,
        errors,
        dataDir,
        finished: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ ok: true, checks, errors }, null, 2));
} catch (error) {
  await writeFile(
    join(artifacts, reportFilename),
    JSON.stringify(
      { ok: false, checks, errors, error: error.stack, dataDir },
      null,
      2,
    ),
  );
  if (running) {
    await running.page
      .screenshot({ path: join(artifacts, "failure.png"), fullPage: true })
      .catch(() => {});
  }
  throw error;
} finally {
  if (running) await running.app.close();
}
