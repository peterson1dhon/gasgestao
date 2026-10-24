// Sem --issue: apenas geração, assinatura A1 e XSD local. Nenhuma autorização.
// Com --issue: dois documentos fictícios de R$ 1,00, NF-e 55, exclusivamente homologação.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile, open, unlink, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { readReferenceFile, field } from "../electron/fiscal/references.mjs";
import { buildReferenceLabDocument } from "../electron/fiscal/reference-lab-document.mjs";
import { fileURLToPath } from "node:url";
if (process.platform !== "win32" || !process.env.LOCALAPPDATA)
  throw new Error("Laboratório requer Windows.");
if (process.argv.slice(2).some((a) => a !== "--issue"))
  throw new Error("Argumento não suportado.");
const issue = process.argv.includes("--issue"),
  run = promisify(execFile);
const base = join(process.env.LOCALAPPDATA, "GasGestao-Fiscal-Homologacao");
const referenceBase = join(
  process.env.LOCALAPPDATA,
  "GasGestao-Fiscal-Referencias",
);
const helper = fileURLToPath(
  new URL("../electron/fiscal/homologation-lab.ps1", import.meta.url),
);
const ps = join(
  process.env.SystemRoot || "C:\\Windows",
  "System32",
  "WindowsPowerShell",
  "v1.0",
  "powershell.exe",
);
const root = fileURLToPath(new URL("../", import.meta.url));
async function invoke(mode, model, path) {
  let out = "";
  try {
    ({ stdout: out } = await run(
      ps,
      [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        helper,
        "-Mode",
        mode,
        "-Model",
        model,
        "-InputFile",
        path,
      ],
      {
        windowsHide: true,
        timeout: 60000,
        maxBuffer: 1048576,
        encoding: "utf8",
      },
    ));
  } catch (e) {
    out = e.stdout || "";
  }
  try {
    return JSON.parse(out.trim().replace(/^\uFEFF/, ""));
  } catch {
    throw new Error(
      `Sem resposta reconhecida: ${mode}. Não repetir transmissão sem consulta.`,
    );
  }
}
const json = async (path) =>
  JSON.parse((await readFile(path, "utf8")).replace(/^\uFEFF/, ""));
const digest = async (path) =>
  createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
await mkdir(base, { recursive: true });
const lockPath = join(base, "lab-running.lock"),
  lock = await open(lockPath, "wx");
const report = {
  environment: "homologacao",
  productionAccessed: false,
  technicalTestOnly: true,
  realTaxationApproved: false,
  valueCentsPerDocument: 100,
  transmissionRequested: issue,
  cases: [],
  negativeChecks: [],
  finished: null,
  allLocalChecksPassed: false,
  allRequestedAuthorizationChecksPassed: false,
};
const id = new Date().toISOString().replace(/[-:.TZ]/g, "");
try {
  const profile = await json(join(base, "reference-profile-private.json"));
  const cert = await json(join(base, "certificate-company-public.json"));
  if (profile.issuer.CNPJ !== cert.cnpj)
    throw new Error("Emitente divergente.");
  const prior = await json(join(base, "last-prepared-run-private.json"));
  const registry = await invoke(
    "Registry",
    "55",
    prior.files.find((f) => f.model === "55").signed,
  );
  assert.equal(registry.ok, true, "Consulta cadastral falhou.");
  if (
    registry.taxRegime !== "NORMAL - REGIME PERIÓDICO DE APURAÇÃO" ||
    registry.registrationStatus !== "1" ||
    registry.cStat !== "111"
  )
    throw new Error("Regime ou situação cadastral exige revisão.");
  const issuer = { ...profile.issuer, CRT: "3" };
  report.registryConfirmedNormal = true;
  const refs = [],
    sources = [];
  for (let i = 1; i <= 3; i++) {
    const path = join(referenceBase, `referencia-${i}.xml`);
    sources.push({ path, hash: await digest(path) });
    refs.push(...(await readReferenceFile(path)));
  }
  const st = refs.find((r) => field(r, "prod/CFOP") === "5405");
  assert.ok(st, "Referência ST necessária ao teste negativo.");
  assert.throws(() =>
    buildReferenceLabDocument({ issuer, number: 1, reference: st }),
  );
  report.negativeChecks.push("água com ST bloqueada no gerador");
  const selected = refs.filter((r) =>
    ["5656", "5102"].includes(field(r, "prod/CFOP")),
  );
  assert.equal(selected.length, 4, "Conjunto de referências incompleto.");
  const scenarios = issue
    ? [
        selected.find((r) => field(r, "prod/CFOP") === "5656"),
        selected.find((r) => field(r, "prod/CFOP") === "5102"),
      ]
    : selected;
  const numbers = await json(join(base, "lab-numbers.json")),
    files = [];
  for (let i = 0; i < scenarios.length; i++) {
    for (const model of issue ? ["55"] : ["55", "65"]) {
      numbers[model] = Number(numbers[model] || 0) + 1;
      assert.ok(
        Number.isSafeInteger(numbers[model]) &&
          numbers[model] > 0 &&
          numbers[model] <= 999999999,
      );
      await writeFile(
        join(base, "lab-numbers.json"),
        JSON.stringify(numbers, null, 2),
      );
      const doc = buildReferenceLabDocument({
        issuer,
        model,
        number: numbers[model],
        reference: scenarios[i],
      });
      const file = join(base, `reference-${id}-${i}-${model}.xml`),
        signed = file.replace(/\.xml$/, "-signed.xml");
      await writeFile(file, doc.xml, { encoding: "utf8", flag: "wx" });
      const sign = await invoke("Sign", model, file);
      assert.equal(
        sign.ok,
        true,
        `Assinatura/XSD ${doc.scenario}/${model}: ${sign.code || "erro"}`,
      );
      const verify = await invoke("Validate", model, signed);
      assert.equal(
        verify.ok,
        true,
        `Reabertura ${doc.scenario}/${model}: ${verify.code || "erro"}`,
      );
      const result = {
        scenario: doc.scenario,
        model,
        signatureValid: true,
        schemaValid: true,
        reopenedSignatureValid: true,
        authorized: false,
      };
      report.cases.push(result);
      files.push({ file, signed, model, result, sourceIndex: i });
      console.log(
        JSON.stringify({
          stage: "local-validation",
          scenario: doc.scenario,
          model,
          passed: true,
        }),
      );
    }
  }
  const first = files[0],
    unsigned = await readFile(first.file, "utf8"),
    signed = await readFile(first.signed, "utf8");
  const production = join(base, `reference-negative-production-${id}.xml`),
    tampered = join(base, `reference-negative-tamper-${id}.xml`);
  await writeFile(
    production,
    unsigned.replace("<tpAmb>2</tpAmb>", "<tpAmb>1</tpAmb>"),
  );
  assert.equal(
    (await invoke("Sign", "55", production)).code,
    "PRODUCTION_BLOCKED",
  );
  await writeFile(
    tampered,
    signed.replace("VENDA TESTE HOMOLOGACAO", "ALTERACAO NAO ASSINADA"),
  );
  assert.equal(
    (await invoke("Validate", "55", tampered)).code,
    "SIGNATURE_INVALID",
  );
  report.negativeChecks.push(
    "produção bloqueada antes do certificado",
    "alteração do XML assinado detectada",
  );
  for (const source of sources)
    assert.equal(
      await digest(source.path),
      source.hash,
      "Referência original alterada.",
    );
  report.sourceFilesUnchanged = true;
  report.allLocalChecksPassed = true;
  await writeFile(
    join(base, `reference-run-${id}-private.json`),
    JSON.stringify({ id, files: files.map(({ result, ...f }) => f) }, null, 2),
  );
  if (issue) {
    const gas = files.find(
        (f) => f.model === "55" && f.result.scenario === "GLP",
      ),
      water = files.find(
        (f) => f.model === "55" && f.result.scenario === "AGUA",
      );
    assert.ok(gas && water);
    for (const f of [gas, water]) {
      f.result.authorization = await invoke("Authorize", "55", f.signed);
      f.result.authorized = f.result.authorization.authorized === true;
      f.result.query = await invoke("Query", "55", f.signed);
      if (f.result.authorized && f.result.query.cStat === "100") {
        f.result.cancellation = await invoke("Cancel", "55", f.signed);
        f.result.finalQuery = await invoke("Query", "55", f.signed);
      }
      // Só testar o marcador após uma resposta recebida. Em falha de transporte,
      // a consulta acima é a única operação permitida; não repetir autorização.
      if (f.result.authorization.ok) {
        const duplicate = await invoke("Authorize", "55", f.signed);
        assert.equal(
          duplicate.code,
          "AUTHORIZATION_ALREADY_ATTEMPTED_QUERY_FIRST",
          "Bloqueio de retransmissão falhou.",
        );
        f.result.duplicateTransmissionBlocked = true;
      }
      console.log(
        JSON.stringify({
          stage: "homologation-cycle",
          scenario: f.result.scenario,
          ...f.result,
        }),
      );
      // Não repetir autorização. Uma resposta incerta encerra os envios para investigação.
      if (
        !f.result.authorization.ok ||
        !f.result.query.ok ||
        (f.result.authorized && f.result.finalQuery?.cStat !== "101")
      )
        break;
    }
    report.allRequestedAuthorizationChecksPassed = [gas, water].every(
      (f) =>
        f.result.authorized &&
        f.result.cancellation?.eventStatus === "135" &&
        f.result.finalQuery?.cStat === "101",
    );
    if (!report.allRequestedAuthorizationChecksPassed) process.exitCode = 1;
  }
} catch (e) {
  report.failure = String(e.message).slice(0, 250);
  process.exitCode = 1;
} finally {
  report.finished = new Date().toISOString();
  await writeFile(
    join(base, `reference-result-${id}.json`),
    JSON.stringify(report, null, 2),
  );
  await writeFile(
    join(root, ".test-artifacts", "fiscal-reference-emission-result.json"),
    JSON.stringify(report, null, 2),
  );
  await lock.close();
  await unlink(lockPath);
  console.log(JSON.stringify(report));
}
