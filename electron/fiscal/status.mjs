import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { ValidationError } from "../store.mjs";
import {
  existsSync,
  readFileSync,
  mkdirSync,
  writeFileSync,
  renameSync,
  statSync,
} from "node:fs";
import { dirname } from "node:path";
const run = promisify(execFile);
export const STATUS_ENDPOINTS = Object.freeze({
  55: "https://homologacao.nfe.fazenda.sp.gov.br/ws/nfestatusservico4.asmx",
  65: "https://homologacao.nfce.fazenda.sp.gov.br/ws/NFeStatusServico4.asmx",
});
const helper = fileURLToPath(new URL("./sefaz-status.ps1", import.meta.url))
  .replace("app.asar/", "app.asar.unpacked/")
  .replace("app.asar\\", "app.asar.unpacked\\");
const errorMessages = {
  CERTIFICATE_SELECTION_INVALID: "Selecione um certificado da lista.",
  CERTIFICATE_NOT_FOUND:
    "O certificado não foi encontrado no usuário atual do Windows.",
  CERTIFICATE_EXPIRED_OR_NOT_YET_VALID:
    "O certificado está vencido ou ainda não é válido.",
  CERTIFICATE_COMPANY_ID_MISSING:
    "O certificado selecionado não identifica um CNPJ no nome. Confira se é o A1 da empresa.",
  CERTIFICATE_CHAIN_NOT_TRUSTED:
    "Não foi possível validar a cadeia e a revogação do certificado no Windows. Confira as autoridades certificadoras instaladas e a conexão.",
  SEFAZ_CONNECTION_FAILED:
    "Não foi possível concluir a conexão autenticada. Confira o certificado e a conexão; a emissão continua indisponível.",
  HTTP_403:
    "A SEFAZ recusou o certificado/conexão (HTTP 403). É preciso investigar o certificado e a cadeia de confiança.",
  INVALID_SEFAZ_ENVIRONMENT:
    "A resposta não confirmou homologação de São Paulo. O teste foi rejeitado.",
  INVALID_SEFAZ_RESPONSE:
    "A SEFAZ não devolveu uma resposta de status reconhecida.",
};
export function validateStatusInput(input) {
  if (
    !input ||
    !Object.hasOwn(STATUS_ENDPOINTS, String(input.model)) ||
    typeof input.thumbprint !== "string" ||
    !/^[a-fA-F0-9]{40}$/.test(input.thumbprint)
  )
    throw new ValidationError(
      "Selecione NF-e ou NFC-e e um certificado válido da lista.",
    );
  if (Object.keys(input).some((k) => !["model", "thumbprint"].includes(k)))
    throw new ValidationError(
      "O diagnóstico aceita somente modelo e certificado. Destino e ambiente são fixos.",
    );
  return {
    model: String(input.model),
    thumbprint: input.thumbprint.toUpperCase(),
  };
}
export async function runHelper(args, executor = run) {
  const executable = join(
    process.env.SystemRoot || "C:\\Windows",
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "powershell.exe",
  );
  let output;
  try {
    output = await executor(
      executable,
      [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        helper,
        ...args,
      ],
      {
        windowsHide: true,
        timeout: 40000,
        maxBuffer: 262144,
        encoding: "utf8",
      },
    );
  } catch (error) {
    try {
      output = { stdout: error.stdout || "" };
      const parsed = JSON.parse(output.stdout.trim());
      if (parsed.ok === false)
        throw new ValidationError(
          errorMessages[parsed.code] ||
            "O diagnóstico não foi concluído; confira a conexão e o certificado.",
        );
    } catch (parsedError) {
      if (parsedError instanceof ValidationError) throw parsedError;
    }
    throw new ValidationError(
      "O diagnóstico não respondeu no prazo ou o auxiliar do Windows está indisponível.",
    );
  }
  let result;
  try {
    result = JSON.parse(output.stdout.trim().replace(/^\uFEFF/, ""));
  } catch {
    throw new ValidationError(
      "O auxiliar de diagnóstico devolveu uma resposta inválida.",
    );
  }
  if (!result.ok)
    throw new ValidationError(
      errorMessages[result.code] || "O diagnóstico não foi concluído.",
    );
  return result;
}
export async function listFiscalCertificates(executor) {
  const result = await runHelper(["-Mode", "List"], executor);
  if (!Array.isArray(result.certificates))
    throw new ValidationError("Lista de certificados inválida.");
  return result.certificates
    .filter(
      (c) =>
        typeof c.thumbprint === "string" && /^[A-F0-9]{40}$/.test(c.thumbprint),
    )
    .map((c) => ({
      thumbprint: c.thumbprint,
      label: String(c.label).slice(0, 300),
      cnpjSuffix: String(c.cnpjSuffix || "").slice(0, 4),
      hasCompanyId: c.hasCompanyId === true,
      validFrom: String(c.validFrom),
      validUntil: String(c.validUntil),
      hasPrivateKey: c.hasPrivateKey === true,
      validNow: c.validNow === true,
      store: "CurrentUser/My",
    }));
}
export async function checkFiscalStatus(input, executor) {
  const safe = validateStatusInput(input);
  const result = await runHelper(
    ["-Mode", "Status", "-Thumbprint", safe.thumbprint, "-Model", safe.model],
    executor,
  );
  if (
    result.model !== safe.model ||
    result.tpAmb !== 2 ||
    result.cUF !== 35 ||
    result.endpoint !== STATUS_ENDPOINTS[safe.model] ||
    result.operation !== "STATUS" ||
    result.privateKeyExported !== false ||
    result.chainValidated !== true ||
    result.live !== true
  )
    throw new ValidationError(
      "A resposta do teste não confirmou o destino e as proteções esperadas.",
    );
  if (
    !/^\d{3}$/.test(result.cStat) ||
    typeof result.reason !== "string" ||
    result.reason.length > 512
  )
    throw new ValidationError(
      "O serviço devolveu um código de status inválido.",
    );
  return publicStatus(result, safe.model);
}
function publicStatus(result, model) {
  if (
    !/^\d{3}$/.test(result.cStat) ||
    typeof result.reason !== "string" ||
    result.reason.length > 512 ||
    typeof result.checkedAt !== "string" ||
    !Number.isFinite(Date.parse(result.checkedAt)) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(result.validUntil)
  )
    throw new ValidationError("Registro de diagnóstico inválido.");
  return {
    ok: true,
    model,
    environment: "homologacao",
    tpAmb: 2,
    state: "SP",
    cUF: 35,
    endpoint: STATUS_ENDPOINTS[model],
    cStat: result.cStat,
    reason: result.reason,
    checkedAt: String(result.checkedAt),
    validUntil: String(result.validUntil),
    privateKeyExported: false,
    chainValidated: true,
    operation: "STATUS",
    live: true,
  };
}
export class FiscalDiagnostics {
  constructor(filename, { executor, now = Date.now } = {}) {
    this.filename = filename;
    this.executor = executor;
    this.now = now;
    this.attempts = new Map();
    this.busy = false;
  }
  summary() {
    let results = [];
    if (this.filename && existsSync(this.filename))
      try {
        if (statSync(this.filename).size > 65536) throw new Error("cache_size");
        const parsed = JSON.parse(readFileSync(this.filename, "utf8"));
        if (Array.isArray(parsed.results))
          results = parsed.results
            .filter(
              (r) =>
                r &&
                r.environment === "homologacao" &&
                r.tpAmb === 2 &&
                r.cUF === 35 &&
                Object.hasOwn(STATUS_ENDPOINTS, r.model) &&
                r.endpoint === STATUS_ENDPOINTS[r.model] &&
                r.operation === "STATUS" &&
                r.live === true &&
                r.chainValidated === true &&
                r.privateKeyExported === false,
            )
            .slice(-2)
            .flatMap((r) => {
              try {
                return [publicStatus(r, String(r.model))];
              } catch {
                return [];
              }
            });
      } catch {}
    return {
      phase: "diagnostico",
      state: "SP",
      environment: "homologacao",
      canIssue: false,
      results,
    };
  }
  list() {
    return listFiscalCertificates(this.executor);
  }
  async check(input) {
    const safe = validateStatusInput(input);
    if (this.busy)
      throw new ValidationError("Aguarde o diagnóstico atual terminar.");
    const last = this.attempts.get(safe.model);
    if (last !== undefined && this.now() - last < 60000)
      throw new ValidationError(
        "Aguarde um minuto antes de repetir o teste deste modelo.",
      );
    this.attempts.set(safe.model, this.now());
    this.busy = true;
    try {
      const result = await checkFiscalStatus(safe, this.executor);
      if (this.filename) {
        mkdirSync(dirname(this.filename), { recursive: true });
        const results = this.summary().results.filter(
          (r) => r.model !== safe.model,
        );
        results.push(result);
        const temporary = `${this.filename}.tmp`;
        writeFileSync(
          temporary,
          JSON.stringify({ schema: 1, results }, null, 2),
          { encoding: "utf8", mode: 0o600 },
        );
        renameSync(temporary, this.filename);
      }
      return result;
    } finally {
      this.busy = false;
    }
  }
}
