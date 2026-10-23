import { _electron as electron } from "playwright";
import electronPath from "electron";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const root = resolve(fileURLToPath(new URL("../", import.meta.url))),
  artifacts = join(root, ".test-artifacts");
await mkdir(artifacts, { recursive: true });
const dir = await mkdtemp(join(artifacts, "fiscal-ui-"));
const packaged = process.argv.includes("--packaged"),
  live = process.argv.includes("--live");
const env = { ...process.env, GASGESTAO_DATA_DIR: dir, GASGESTAO_TEST: "1" };
delete env.ELECTRON_RUN_AS_NODE;
if (live) env.GASGESTAO_FISCAL_LIVE_TEST = "1";
else delete env.GASGESTAO_FISCAL_LIVE_TEST;
let app;
const errors = [];
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
async function open(p) {
  await p.getByRole("menuitem", { name: "Utilitários", exact: true }).click();
  await p
    .getByRole("menuitem", { name: "Diagnóstico fiscal SP", exact: true })
    .click();
  await p
    .getByRole("dialog", { name: "Diagnóstico fiscal SP", exact: true })
    .waitFor();
}
try {
  let page = await launch();
  await open(page);
  let dialog = page.getByRole("dialog");
  await page.waitForFunction(
    () =>
      document.querySelector(
        'select[aria-label="Certificado da empresa no Windows"]',
      )?.value,
  );
  if (live) {
    const eligible = await page.evaluate(
      async () =>
        (await window.gasgestao.fiscalCertificates()).data.filter(
          (c) => c.validNow && c.hasPrivateKey && c.hasCompanyId,
        ).length,
    );
    assert.equal(
      eligible,
      1,
      "O teste automático exige exatamente um certificado de empresa elegível.",
    );
  }
  const before = await page.evaluate(() => window.gasgestao.bootstrap());
  await dialog
    .getByRole("button", { name: "Testar NF-e (55)", exact: true })
    .click();
  await dialog
    .getByText(
      live
        ? "107 — Serviço em Operação"
        : "107 — Resposta simulada para testes de interface",
      { exact: true },
    )
    .waitFor({ timeout: 45000 });
  await dialog
    .getByRole("button", { name: "Testar NFC-e (65)", exact: true })
    .click();
  await page.waitForFunction(
    () => document.querySelectorAll("tbody tr").length >= 2,
    null,
    { timeout: 45000 },
  );
  // A grade de fundo pode ter linhas; a confirmação abaixo usa somente o diálogo.
  await dialog
    .locator("tbody tr")
    .filter({ hasText: "NFC-e (65)" })
    .waitFor({ timeout: 45000 });
  assert.equal(await dialog.locator("tbody tr").count(), 2);
  if (!live) {
    assert.equal(
      await dialog
        .getByText("SIMULAÇÃO — teste da interface, sem conexão externa", {
          exact: true,
        })
        .count(),
      2,
    );
    await mkdir(join(artifacts, "screenshots"), { recursive: true });
    await page.screenshot({
      path: join(artifacts, "screenshots", "diagnostico-fiscal.png"),
      fullPage: true,
    });
  }
  assert.equal(await page.evaluate(() => typeof window.require), "undefined");
  const bad = await page.evaluate(() =>
    window.gasgestao.fiscalStatus({
      model: "55",
      thumbprint: "A".repeat(40),
      environment: "producao",
    }),
  );
  assert.equal(bad.ok, false);
  const after = await page.evaluate(() => window.gasgestao.bootstrap());
  assert.equal(before.data.meta.order_count, after.data.meta.order_count);
  assert.deepEqual(before.data.cashEntries, after.data.cashEntries);
  const summary = await page.evaluate(() => window.gasgestao.fiscalSummary());
  assert.equal(summary.data.canIssue, false);
  if (live) {
    assert.equal(summary.data.results.length, 2);
    assert.ok(
      summary.data.results.every(
        (r) =>
          r.live &&
          r.cStat === "107" &&
          r.tpAmb === 2 &&
          r.chainValidated &&
          !r.privateKeyExported,
      ),
    );
  }
  if (live) {
    await app.close();
    app = null;
    page = await launch();
    await open(page);
    dialog = page.getByRole("dialog");
    await dialog
      .locator("tbody tr")
      .filter({ hasText: "NFC-e (65)" })
      .waitFor();
    assert.equal(await dialog.locator("tbody tr").count(), 2);
  }
  await page.setViewportSize({ width: 1000, height: 720 });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  assert.equal(errors.length, 0, errors.join("\n"));
  const report = {
    ok: true,
    packaged,
    live,
    environment: "homologacao",
    state: "SP",
    models: ["55", "65"],
    documentsIssued: 0,
    productionAccessed: false,
    privateKeysExported: false,
    checks: [
      "diagnóstico dos dois modelos",
      "produção e destino arbitrário bloqueados",
      "nenhum pedido ou lançamento criado",
      "contexto isolado e janela de 1000px",
      ...(live
        ? ["respostas reais 107 e persistência após reiniciar"]
        : ["simulação identificada na tela"]),
    ],
    results: live ? summary.data.results : [],
    errors,
    finished: new Date().toISOString(),
  };
  await writeFile(
    join(
      artifacts,
      `fiscal-ui-${live ? "live" : "mock"}${packaged ? "-packaged" : ""}.json`,
    ),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report));
} catch (e) {
  if (app && !live)
    await app
      .windows()[0]
      ?.screenshot({
        path: join(artifacts, "fiscal-failure.png"),
        fullPage: true,
      })
      .catch(() => {});
  throw e;
} finally {
  if (app) await app.close();
}
