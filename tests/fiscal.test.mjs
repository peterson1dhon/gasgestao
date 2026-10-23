import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  FiscalDiagnostics,
  STATUS_ENDPOINTS,
  validateStatusInput,
  checkFiscalStatus,
  listFiscalCertificates,
} from "../electron/fiscal/status.mjs";
const input = { model: "55", thumbprint: "A".repeat(40) };
const result = (model = "55") => ({
  ok: true,
  model,
  tpAmb: 2,
  cUF: 35,
  endpoint: STATUS_ENDPOINTS[model],
  operation: "STATUS",
  privateKeyExported: false,
  chainValidated: true,
  live: true,
  cStat: "107",
  reason: "Serviço em Operação",
  checkedAt: new Date().toISOString(),
  validUntil: "2027-01-01",
});
test("diagnóstico rejeita produção, URL arbitrária, injeção e modelo inválido antes de executar auxiliar", () => {
  assert.deepEqual(
    validateStatusInput({ ...input, thumbprint: "a".repeat(40) }),
    input,
  );
  for (const value of [
    { ...input, environment: "producao" },
    { ...input, url: "https://example.com" },
    { ...input, model: "57" },
    { ...input, thumbprint: "A; whoami" },
    null,
  ])
    assert.throws(() => validateStatusInput(value));
  assert.equal(
    Object.values(STATUS_ENDPOINTS).every((e) =>
      new URL(e).hostname.startsWith("homologacao."),
    ),
    true,
  );
});
test("processo auxiliar usa argumentos separados, janela oculta e nunca recebe senha/certificado exportado", async () => {
  let seen;
  const executor = async (executable, args, options) => {
    seen = { executable, args, options };
    return { stdout: JSON.stringify(result()) };
  };
  const response = await checkFiscalStatus(input, executor);
  assert.equal(response.cStat, "107");
  assert.equal(seen.options.windowsHide, true);
  assert.ok(seen.options.timeout <= 40000);
  assert.ok(seen.args.includes("-NonInteractive"));
  assert.ok(seen.args.includes("-NoProfile"));
  assert.ok(!seen.args.some((x) => /pfx|p12|password/i.test(x)));
  assert.equal(response.privateKeyExported, false);
});
test("resposta precisa confirmar homologação SP, chave não exportada, cadeia válida e destino exato", async () => {
  for (const bad of [
    { tpAmb: 1 },
    { cUF: 33 },
    { endpoint: "https://nfe.fazenda.sp.gov.br/ws/nfestatusservico4.asmx" },
    { privateKeyExported: true },
    { chainValidated: false },
    { operation: "AUTORIZAR" },
    { live: false },
    { cStat: "xyz" },
  ])
    await assert.rejects(
      checkFiscalStatus(input, async () => ({
        stdout: JSON.stringify({ ...result(), ...bad }),
      })),
    );
});
test("metadados públicos são limitados e erros não expõem senha ou exceção bruta", async () => {
  const certs = await listFiscalCertificates(async () => ({
    stdout: JSON.stringify({
      ok: true,
      certificates: [
        {
          thumbprint: input.thumbprint,
          label: "Empresa de teste",
          validNow: true,
          hasPrivateKey: true,
          hasCompanyId: true,
          privateKey: "NUNCA_RETORNAR",
        },
      ],
    }),
  }));
  assert.equal(certs[0].privateKey, undefined);
  await assert.rejects(
    checkFiscalStatus(input, async () => {
      const e = new Error("senha=SEGREDO_TESTE");
      e.stdout = JSON.stringify({
        ok: false,
        code: "CERTIFICATE_CHAIN_NOT_TRUSTED",
      });
      throw e;
    }),
    (e) => /cadeia/.test(e.message) && !e.message.includes("SEGREDO_TESTE"),
  );
  await assert.rejects(
    checkFiscalStatus(input, async () => {
      throw new Error("senha=SEGREDO_TESTE");
    }),
    (e) => !e.message.includes("SEGREDO_TESTE"),
  );
});
test("cache é limitado, validado e não devolve campos extras à interface", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "fiscal-cache-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const filename = join(dir, "status.json");
  const diagnostics = new FiscalDiagnostics(filename);
  const stored = {
    ...result(),
    environment: "homologacao",
    secret: "NAO_RETORNAR",
  };
  writeFileSync(
    filename,
    JSON.stringify({ results: [stored, { ...stored, tpAmb: 1 }] }),
  );
  assert.equal(diagnostics.summary().results.length, 1);
  assert.equal(diagnostics.summary().results[0].secret, undefined);
  writeFileSync(
    filename,
    JSON.stringify({ results: [{ ...stored, checkedAt: "invalido" }] }),
  );
  assert.deepEqual(diagnostics.summary().results, []);
  writeFileSync(filename, " ".repeat(65537));
  assert.deepEqual(diagnostics.summary().results, []);
});
test("limite de frequência e persistência não armazenam seletor de certificado nem dados operacionais", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "fiscal-test-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  let now = 1000,
    calls = 0;
  const filename = join(dir, "status.json");
  const service = new FiscalDiagnostics(filename, {
    now: () => now,
    executor: async (_exe, args) => {
      calls++;
      return { stdout: JSON.stringify(result(args.at(-1))) };
    },
  });
  await service.check(input);
  await assert.rejects(service.check(input), /um minuto/);
  assert.equal(calls, 1);
  await service.check({ ...input, model: "65" });
  assert.equal(service.summary().results.length, 2);
  const saved = readFileSync(filename, "utf8");
  assert.ok(!saved.includes(input.thumbprint));
  assert.ok(!/pfx|senha|privateKey":/i.test(saved));
  const restored = new FiscalDiagnostics(filename);
  assert.equal(restored.summary().canIssue, false);
  assert.equal(restored.summary().results.length, 2);
  now += 60000;
  await service.check(input);
  assert.equal(calls, 3);
});
test("script fixa STATUS/homologação, valida TLS/revogação, proíbe DTD e não exporta chave", () => {
  const script = readFileSync(
    new URL("../electron/fiscal/sefaz-status.ps1", import.meta.url),
    "utf8",
  );
  assert.match(script, /<tpAmb>2<\/tpAmb>/);
  assert.match(script, /<xServ>STATUS<\/xServ>/);
  assert.match(script, /CheckCertificateRevocationList=\$true/);
  assert.match(script, /RevocationMode.*Online/);
  assert.match(script, /DtdProcessing.*Prohibit/);
  assert.match(script, /XmlResolver=\$null/);
  assert.match(script, /AllowAutoRedirect=\$false/);
  assert.doesNotMatch(
    script,
    /ServerCertificateValidationCallback|Export-PfxCertificate|\.Export\(/,
  );
  assert.doesNotMatch(
    script,
    /NFeAutorizacao4\.asmx|nfeinutilizacao4\.asmx|<tpAmb>1<\/tpAmb>/i,
  );
});
