import { _electron as electron } from "playwright";
import electronPath from "electron";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Store } from "../electron/store.mjs";
import {
  FiscalReferences,
  normalizeReferenceDocument,
} from "../electron/fiscal/references.mjs";
const root = resolve(fileURLToPath(new URL("../", import.meta.url))),
  artifacts = join(root, ".test-artifacts");
await mkdir(artifacts, { recursive: true });
const dir = await mkdtemp(join(artifacts, "fiscal-reference-ui-"));
const packaged = process.argv.includes("--packaged");
const pathArg = process.argv.find((a) => a.startsWith("--executable="));
const env = { ...process.env, GASGESTAO_DATA_DIR: dir, GASGESTAO_TEST: "1" };
delete env.ELECTRON_RUN_AS_NODE;
const fields = {
  "prod/cProd": "TESTE-P13",
  "prod/xProd": "GÁS P13 — referência fictícia",
  "prod/NCM": "27111910",
  "prod/CEST": "0601100",
  "prod/CFOP": "5656",
  "prod/uCom": "UN",
  "prod/qCom": "1",
  "prod/uTrib": "KG",
  "prod/qTrib": "13",
  "prod/comb/cProdANP": "210203001",
  "imposto/ICMS/ICMS61/CST": "61",
  "imposto/ICMS/ICMS61/adRemICMSRet": "1.4700",
  "imposto/ICMS/ICMS61/qBCMonoRet": "13",
  "imposto/PIS/PISNT/CST": "04",
  "imposto/COFINS/COFINSNT/CST": "04",
  "imposto/IBSCBS/CST": "620",
  "imposto/IBSCBS/cClassTrib": "620006",
  "ide/tpNF": "1",
  "ide/idDest": "1",
  "ide/finNFe": "1",
};
const doc = {
  ok: true,
  documentHash: "a".repeat(64),
  issuerHash: "b".repeat(64),
  issuedAt: "2026-10-21T12:00:00-03:00",
  model: "55",
  environment: "2",
  crt: "3",
  uf: "SP",
  status: "100",
  signatureVerified: true,
  certificateChainChecked: false,
  currentStatusChecked: false,
  items: [
    {
      item: "1",
      fields: Object.entries(fields).map(([path, value]) => ({ path, value })),
    },
  ],
};
const store = new Store(join(dir, "gasgestao.sqlite"));
const productId = store.saveProduct({
  name: "Gás de demonstração",
  category: "Gás",
  price_cents: 12000,
  cost_cents: 1,
  min_stock: 0,
});
const imported = await new FiscalReferences(store).importFiles(
  ["fixture.xml"],
  async () => normalizeReferenceDocument(doc),
);
const referenceId = imported.references[0].id;
store.close();
let app;
const errors = [];
async function launch() {
  app = await electron.launch({
    executablePath: pathArg
      ? pathArg.slice("--executable=".length)
      : packaged
        ? join(root, "release/win-unpacked/GasGestao.exe")
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
  await p.getByText("Referências fiscais gás e água", { exact: true }).click();
  await p
    .getByLabel("Referência fiscal do produto", { exact: true })
    .selectOption(referenceId);
}
try {
  let p = await launch();
  await open(p);
  const baseline = await p.evaluate(() => window.gasgestao.bootstrap());
  await p.getByLabel("Buscar campo fiscal", { exact: true }).fill("CEST");
  await p.getByRole("cell", { name: "0601100", exact: true }).waitFor();
  await p.getByLabel("Buscar campo fiscal", { exact: true }).fill("");
  await p
    .getByLabel("Produto local — vínculo em revisão", { exact: true })
    .selectOption(String(productId));
  await p
    .getByText("Vínculo salvo em revisão; emissão permanece indisponível.", {
      exact: true,
    })
    .waitFor();
  await p.getByText("Prévia de cálculo — sem emitir", { exact: true }).click();
  await p.getByLabel("Quantidade da prévia", { exact: true }).fill("2");
  await p
    .getByLabel("Preço unitário da prévia", { exact: true })
    .fill("120,00");
  await p.getByRole("button", { name: "Calcular prévia", exact: true }).click();
  await p
    .getByLabel("Resultado da prévia fiscal", { exact: true })
    .getByText(/38.22/)
    .waitFor();
  const result = await p.evaluate(async () => ({
    state: await window.gasgestao.bootstrap(),
    catalog: await window.gasgestao.fiscalReferences(),
    blocked: await window.gasgestao.importFiscalReferences(),
    node: typeof window.require,
  }));
  assert.deepEqual(result.state, baseline);
  assert.equal(result.catalog.data.canIssue, false);
  assert.equal(result.blocked.ok, false);
  assert.equal(result.node, "undefined");
  await p.setViewportSize({ width: 1000, height: 720 });
  assert.ok(
    await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  );
  await mkdir(join(artifacts, "screenshots"), { recursive: true });
  await p.screenshot({
    path: join(
      artifacts,
      "screenshots",
      `referencias-fiscais${packaged ? "-packaged" : ""}.png`,
    ),
    fullPage: true,
  });
  await app.close();
  app = null;
  p = await launch();
  await open(p);
  assert.equal(
    await p
      .getByLabel("Produto local — vínculo em revisão", { exact: true })
      .inputValue(),
    String(productId),
  );
  assert.equal(errors.length, 0, errors.join("\n"));
  const report = {
    ok: true,
    packaged,
    syntheticData: true,
    canIssue: false,
    documentsIssued: 0,
    checks: [
      "códigos completos e zeros preservados",
      "vínculo em revisão persiste ao reiniciar",
      "prévia P13 com conversão e ICMS monofásico",
      "sem alterar vendas/estoque/caixa e sem abrir arquivo pessoal",
      "sandbox e largura de 1000px",
    ],
    errors,
  };
  await writeFile(
    join(artifacts, `fiscal-reference-ui${packaged ? "-packaged" : ""}.json`),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report));
} finally {
  if (app) await app.close();
}
