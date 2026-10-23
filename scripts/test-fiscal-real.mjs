// Consulta real de STATUS, somente homologação, sem emissão e sem exportar chaves.
import { FiscalDiagnostics } from "../electron/fiscal/status.mjs";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const root = resolve(fileURLToPath(new URL("../", import.meta.url))),
  artifacts = join(root, ".test-artifacts");
await mkdir(artifacts, { recursive: true });
const diagnostics = new FiscalDiagnostics(
  join(artifacts, "fiscal-status-live.json"),
);
const eligible = (await diagnostics.list()).filter(
  (c) => c.validNow && c.hasPrivateKey && c.hasCompanyId,
);
if (eligible.length !== 1)
  throw new Error(
    "Selecione o certificado da empresa na tela de diagnóstico: a escolha automática exige exatamente um certificado elegível.",
  );
const results = [];
for (const model of ["55", "65"])
  results.push(
    await diagnostics.check({ model, thumbprint: eligible[0].thumbprint }),
  );
const report = {
  ok: results.every((r) => r.cStat === "107"),
  operation: "STATUS",
  environment: "homologacao",
  productionAccessed: false,
  documentsIssued: 0,
  privateKeysExported: false,
  results,
  finished: new Date().toISOString(),
};
await writeFile(
  join(artifacts, "fiscal-real-result.json"),
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report));
