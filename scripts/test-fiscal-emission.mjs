// Executar explicitamente com --issue para transmitir documentos ficticios em homologacao.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile, mkdir, open, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { buildLabDocument } from "../electron/fiscal/lab-document.mjs";
const run = promisify(execFile),
  root = resolve(fileURLToPath(new URL("../", import.meta.url)));
if (process.platform !== "win32" || !process.env.LOCALAPPDATA)
  throw new Error("O laboratorio requer Windows e certificado instalado.");
const base = join(process.env.LOCALAPPDATA, "GasGestao-Fiscal-Homologacao");
const send = process.argv.includes("--issue");
const ps = join(
  process.env.SystemRoot || "C:\\Windows",
  "System32",
  "WindowsPowerShell",
  "v1.0",
  "powershell.exe",
);
const helper = join(root, "electron", "fiscal", "homologation-lab.ps1");
async function invoke(mode, model, file) {
  let stdout;
  try {
    ({ stdout } = await run(
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
        file,
      ],
      {
        windowsHide: true,
        timeout: 60000,
        maxBuffer: 1048576,
        encoding: "utf8",
      },
    ));
  } catch (error) {
    stdout = error.stdout || "";
  }
  try {
    return JSON.parse(stdout.trim().replace(/^\uFEFF/, ""));
  } catch {
    throw new Error(
      `Auxiliar sem resposta reconhecida na etapa ${mode}; não repetir transmissão sem consultar resultado.`,
    );
  }
}
await mkdir(base, { recursive: true });
const lockPath = join(base, "lab-running.lock");
const lock = await open(lockPath, "wx");
const publicReport = {
  environment: "homologacao",
  state: "SP",
  productionAccessed: false,
  valueCentsPerDocument: 100,
  parameters:
    "tributos de exemplo; CRT conferido no cadastro quando disponivel; nao valida tributacao das vendas",
  models: [],
  checks: [],
  allCoreChecksPassed: false,
  finished: null,
};
try {
  const profile = JSON.parse(
    (
      await readFile(join(base, "reference-profile-private.json"), "utf8")
    ).replace(/^\uFEFF/, ""),
  );
  const publicCompany = JSON.parse(
    (
      await readFile(join(base, "certificate-company-public.json"), "utf8")
    ).replace(/^\uFEFF/, ""),
  );
  assert.equal(
    profile.issuer.CNPJ,
    publicCompany.cnpj,
    "Referência não corresponde à empresa do certificado.",
  );
  let issuer = { ...profile.issuer };
  try {
    const prior = JSON.parse(
      await readFile(join(base, "last-prepared-run-private.json"), "utf8"),
    );
    const file = prior.files.find((f) => f.model === "55");
    const registry = await invoke("Registry", "55", file.signed);
    publicReport.registry = registry;
    assert.equal(registry.ok, true, "Consulta de cadastro falhou.");
    assert.equal(registry.cStat, "111", "Cadastro sem ocorrência única.");
    assert.equal(registry.registrationStatus, "1", "Inscrição não habilitada.");
    if (registry.taxRegime.startsWith("NORMAL")) issuer.CRT = "3";
    else if (registry.taxRegime.toUpperCase().includes("SIMPLES NACIONAL"))
      issuer.CRT = "1";
    else
      throw new Error(
        "Regime retornado precisa de conferência antes de transmitir.",
      );
    console.log(
      JSON.stringify({ stage: "registry", ...registry, crt: issuer.CRT }),
    );
  } catch (e) {
    if (e.code !== "ENOENT" || send) throw e;
  }
  publicReport.crt = issuer.CRT;
  let numbers = { 55: 0, 65: 0 };
  try {
    numbers = JSON.parse(
      await readFile(join(base, "lab-numbers.json"), "utf8"),
    );
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  const id = new Date().toISOString().replace(/[-:.TZ]/g, "");
  const files = [];
  for (const model of ["55", "65"]) {
    numbers[model] = Number(numbers[model] || 0) + 1;
    await writeFile(
      join(base, "lab-numbers.json"),
      JSON.stringify(numbers, null, 2),
    );
    const document = buildLabDocument({
      issuer,
      model,
      number: numbers[model],
    });
    const file = join(base, `lab-${id}-${model}.xml`),
      signed = file.replace(/\.xml$/, "-signed.xml");
    await writeFile(file, document.xml, { encoding: "utf8", flag: "wx" });
    const signature = await invoke("Sign", model, file);
    assert.equal(
      signature.ok,
      true,
      `Assinatura/XSD modelo ${model}: ${signature.code || "erro"}`,
    );
    const verified = await invoke("Validate", model, signed);
    assert.equal(
      verified.ok,
      true,
      `Assinatura após reabrir modelo ${model}: ${verified.code || "erro"}`,
    );
    files.push({ model, file, signed });
    publicReport.models.push({
      model,
      signatureValid: true,
      schemaValid: true,
      authorized: false,
      authorization: null,
      queryBeforeCancellation: null,
      cancellation: null,
      queryAfterCancellation: null,
    });
    console.log(
      JSON.stringify({
        stage: "local-validation",
        model,
        ...signature,
        reopenedSignatureValid: verified.ok,
      }),
    );
  }
  const first = files[0],
    unsigned = await readFile(first.file, "utf8"),
    signedXml = await readFile(first.signed, "utf8");
  const production = join(base, `negative-production-${id}.xml`);
  await writeFile(
    production,
    unsigned.replace("<tpAmb>2</tpAmb>", "<tpAmb>1</tpAmb>"),
  );
  const blocked = await invoke("Sign", "55", production);
  assert.equal(blocked.ok, false);
  assert.equal(blocked.code, "PRODUCTION_BLOCKED");
  const tampered = join(base, `negative-tampered-${id}.xml`);
  await writeFile(
    tampered,
    signedXml.replace("VENDA TESTE HOMOLOGACAO", "CONTEUDO MODIFICADO"),
  );
  const integrity = await invoke("Validate", "55", tampered);
  assert.equal(integrity.ok, false);
  assert.equal(integrity.code, "SIGNATURE_INVALID");
  const wrongModel = await invoke("Validate", "65", first.signed);
  assert.equal(wrongModel.ok, false);
  assert.equal(wrongModel.code, "MODEL_MISMATCH");
  publicReport.checks.push(
    "assinatura e XSD oficial dos dois modelos",
    "assinatura confirmada após salvar/reabrir",
    "produção bloqueada antes do uso do certificado",
    "alteração do XML detectada",
    "modelo divergente bloqueado",
  );
  console.log(
    JSON.stringify({
      stage: "negative-tests",
      productionBlocked: true,
      tamperingBlocked: true,
      wrongModelBlocked: true,
    }),
  );
  await writeFile(
    join(base, "last-prepared-run-private.json"),
    JSON.stringify({ id, files }, null, 2),
  );
  if (send) {
    for (const file of files) {
      const modelResult = publicReport.models.find(
        (r) => r.model === file.model,
      );
      modelResult.authorization = await invoke(
        "Authorize",
        file.model,
        file.signed,
      );
      modelResult.authorized = modelResult.authorization.authorized === true;
      console.log(
        JSON.stringify({
          stage: "authorization",
          model: file.model,
          ...modelResult.authorization,
        }),
      );
      // Mesmo em timeout, consulta a chave preparada. Nao repete a autorizacao.
      modelResult.queryBeforeCancellation = await invoke(
        "Query",
        file.model,
        file.signed,
      );
      console.log(
        JSON.stringify({
          stage: "query",
          model: file.model,
          ...modelResult.queryBeforeCancellation,
        }),
      );
      if (
        modelResult.authorized &&
        modelResult.queryBeforeCancellation.cStat === "100"
      ) {
        modelResult.cancellation = await invoke(
          "Cancel",
          file.model,
          file.signed,
        );
        console.log(
          JSON.stringify({
            stage: "cancellation",
            model: file.model,
            ...modelResult.cancellation,
          }),
        );
        modelResult.queryAfterCancellation = await invoke(
          "Query",
          file.model,
          file.signed,
        );
        const repeat = await invoke("Authorize", file.model, file.signed);
        assert.equal(repeat.ok, false);
        assert.equal(
          repeat.code,
          "AUTHORIZATION_ALREADY_ATTEMPTED_QUERY_FIRST",
        );
        modelResult.duplicateTransmissionBlocked = true;
      }
    }
    publicReport.allCoreChecksPassed = publicReport.models.every(
      (r) =>
        r.authorized &&
        r.queryBeforeCancellation?.cStat === "100" &&
        r.cancellation?.eventStatus === "135" &&
        r.queryAfterCancellation?.cStat === "101" &&
        r.duplicateTransmissionBlocked,
    );
    publicReport.checks.push(
      "tentativas de autorização dos dois modelos e consulta real da chave",
      "cancelamento e consulta final somente quando autorizado",
      "bloqueio de retransmissão da mesma chave",
    );
  }
  publicReport.finished = new Date().toISOString();
  publicReport.documentsAuthorized = publicReport.models.filter(
    (r) => r.authorized,
  ).length;
  publicReport.documentsCancelled = publicReport.models.filter(
    (r) => r.queryAfterCancellation?.cStat === "101",
  ).length;
  await mkdir(join(root, ".test-artifacts"), { recursive: true });
  await writeFile(
    join(
      root,
      ".test-artifacts",
      `fiscal-emission-${send ? "live" : "local"}.json`,
    ),
    JSON.stringify(publicReport, null, 2),
  );
  console.log(JSON.stringify(publicReport));
} finally {
  await lock.close();
  await unlink(lockPath);
}
