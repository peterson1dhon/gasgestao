import { _electron as electron } from "playwright";
import electronPath from "electron";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { receiptHtml } from "../electron/receipt.mjs";
const root = resolve(fileURLToPath(new URL("../", import.meta.url)));
const artifacts = join(root, ".test-artifacts");
await mkdir(artifacts, { recursive: true });
const dataDir = await mkdtemp(join(artifacts, "receipt-"));
const packaged = process.argv.includes("--packaged");
const env = {
  ...process.env,
  GASGESTAO_DATA_DIR: dataDir,
  GASGESTAO_TEST: "1",
};
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({
  executablePath: packaged
    ? join(root, "release", "win-unpacked", "GasGestao.exe")
    : electronPath,
  args: packaged ? [] : [root],
  env,
});
try {
  const page = await app.firstWindow();
  await page.getByTestId("classic-shell").waitFor();
  const state = await page.evaluate(async () => {
    const a = window.gasgestao;
    const c = await a.saveCustomer({
      name: "Empresa de demonstração",
      cnpj: "12ABC34501DE35",
      phone: "11900000001",
    });
    const p = await a.saveProduct({
      name: "Gás P13 de demonstração",
      price_cents: 11000,
      cost_cents: 8000,
      stock: 5,
      min_stock: 1,
    });
    await a.saveSettings({
      name: "Revenda de demonstração",
      receipt_left_columns: 8,
    });
    const o = await a.createOrder({
      customer_id: c.data,
      delivery_type: "retirada",
      payment_method: "fiado",
      items: [{ product_id: p.data, quantity: 1 }],
      delivery_fee_cents: 0,
      discount_cents: 0,
      paid_cents: 0,
    });
    if (!c.ok || !p.ok || !o.ok)
      throw new Error("Falha ao preparar comprovante de teste");
    return (await a.bootstrap()).data;
  });
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setBackgroundColor("#ffffff"),
  );
  await page.setViewportSize({ width: 794, height: 1123 });
  await page.setContent(receiptHtml(state.orders[0], state.settings));
  await page.emulateMedia({ media: "print" });
  const before = await page
    .locator("body")
    .evaluate((el) => ({
      left: el.getBoundingClientRect().left,
      width: el.scrollWidth,
      text: el.textContent,
    }));
  assert.ok(before.left > 0);
  assert.ok(before.width < 794 - before.left);
  assert.match(before.text, /Assinatura do cliente/);
  assert.match(before.text, /12ABC34501DE35/);
  await mkdir(join(artifacts, "screenshots"), { recursive: true });
  await page.screenshot({
    path: join(artifacts, "screenshots", "recibo-prazo.png"),
    fullPage: true,
  });
  await page.setContent(
    receiptHtml(state.orders[0], {
      ...state.settings,
      receipt_left_columns: 0,
    }),
  );
  const zero = await page
    .locator("body")
    .evaluate((el) => el.getBoundingClientRect().left);
  assert.ok(before.left > zero + 40);
  const result = {
    ok: true,
    packaged,
    leftAt8Columns: before.left,
    leftAt0Columns: zero,
    signature: true,
    cnpj: true,
    finished: new Date().toISOString(),
  };
  await writeFile(
    join(artifacts, "receipt-result.json"),
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result));
} finally {
  await app.close();
}
