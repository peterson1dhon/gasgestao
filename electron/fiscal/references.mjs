import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ValidationError } from "../store.mjs";

// Códigos observados no seletor de saída; catálogo de consulta, não enquadramento automático.
export const OBSERVED_CFOPS = Object.freeze(
  "5101/6101 5102/6102 5104/6104 6108 5117/6117 5152/6152 5202/6202 5209/6209 5401/6401 5403/6403 6404 5405 5408/6408 5409/6409 5411/6411 5413/6413 5415/6415 5551/6551 5552/6552 5553/6553 5556/6556 5652/6652 5653/6653 5655/6655 5656/6656 5657/6657 5659/6659 5661/6661 5662/6662 5904/6904 5908/6908 5909/6909 5910/6910 5915/6915 5920/6920 5921/6921 5922/6922 5927 5929/6929 5949/6949".split(
    " ",
  ),
);
const run = promisify(execFile);
const helper = fileURLToPath(new URL("./read-reference.ps1", import.meta.url))
  .replace("app.asar/", "app.asar.unpacked/")
  .replace("app.asar\\", "app.asar.unpacked\\");
const fail = (message) => {
  throw new ValidationError(message);
};
const plain = (value) =>
  value && typeof value === "object" && !Array.isArray(value);
const hash = (value) => createHash("sha256").update(value).digest("hex");
const integer = (value, min = 1, max = 1000000) =>
  Number.isSafeInteger(value) && value >= min && value <= max;
const decimal = (value, scale = 4) => {
  if (
    typeof value !== "string" ||
    !new RegExp(`^\\d{1,11}(?:\\.\\d{1,${scale}})?$`).test(value)
  )
    fail("Valor decimal fiscal inválido.");
  const [a, b = ""] = value.split(".");
  return BigInt(a) * 10n ** BigInt(scale) + BigInt(b.padEnd(scale, "0"));
};
const rounded = (n, d) => (n + d / 2n) / d;
const fixed = (n, scale) =>
  `${n / 10n ** BigInt(scale)}.${String(n % 10n ** BigInt(scale)).padStart(scale, "0")}`;
export function field(reference, path) {
  return reference.fields.find((f) => f.path === path)?.value ?? "";
}
export function code(reference, group, name = "CST") {
  return (
    reference.fields.find(
      (f) =>
        f.path.startsWith(`imposto/${group}/`) && f.path.endsWith(`/${name}`),
    )?.value ?? ""
  );
}
function validateFields(fields) {
  if (!Array.isArray(fields) || !fields.length || fields.length > 1024)
    fail("Campos fiscais inválidos.");
  return fields.map((f) => {
    if (
      !plain(f) ||
      typeof f.path !== "string" ||
      !/^(prod|imposto|ide|emit|dest|transp|pag|total)(\/[A-Za-z][A-Za-z0-9]{0,63}){1,24}$/.test(
        f.path,
      ) ||
      typeof f.value !== "string" ||
      f.value.length > 2048
    )
      fail("Campo fiscal inválido.");
    if (
      !/^(prod|imposto|total)\//.test(f.path) &&
      ![
        "ide/cUF",
        "ide/natOp",
        "ide/tpNF",
        "ide/idDest",
        "ide/finNFe",
        "ide/indFinal",
        "ide/indPres",
        "ide/tpEmis",
        "emit/CRT",
        "emit/enderEmit/UF",
        "dest/indIEDest",
        "dest/enderDest/UF",
        "transp/modFrete",
        "pag/detPag/tPag",
      ].includes(f.path)
    )
      fail("Identificadores pessoais não fazem parte do catálogo fiscal.");
    return { path: f.path, value: f.value };
  });
}
export function normalizeReferenceDocument(raw) {
  if (
    !plain(raw) ||
    raw.ok !== true ||
    !/^[a-f0-9]{64}$/.test(raw.documentHash) ||
    !/^[a-f0-9]{64}$/.test(raw.issuerHash) ||
    !["55", "65"].includes(raw.model) ||
    !["1", "2"].includes(raw.environment) ||
    !["100", "150"].includes(raw.status) ||
    raw.signatureVerified !== true ||
    raw.certificateChainChecked !== false ||
    raw.currentStatusChecked !== false ||
    !["1", "2", "3", "4"].includes(raw.crt) ||
    !/^[A-Z]{2}$/.test(raw.uf) ||
    typeof raw.issuedAt !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/.test(
      raw.issuedAt,
    ) ||
    !Array.isArray(raw.items) ||
    !raw.items.length ||
    raw.items.length > 990
  )
    fail("Referência fiscal sem assinatura e protocolo compatíveis.");
  const seen = new Set();
  return raw.items.map((item) => {
    if (
      !plain(item) ||
      !/^[1-9]\d{0,2}$/.test(item.item) ||
      seen.has(item.item)
    )
      fail("Item fiscal inválido ou repetido.");
    seen.add(item.item);
    const reference = {
      id: hash(`${raw.documentHash}:${item.item}`),
      documentHash: raw.documentHash,
      issuerHash: raw.issuerHash,
      item: item.item,
      issuedAt: raw.issuedAt,
      model: raw.model,
      environment: raw.environment,
      crt: raw.crt,
      uf: raw.uf,
      status: raw.status,
      signatureVerified: true,
      certificateChainChecked: false,
      currentStatusChecked: false,
      fields: validateFields(item.fields),
    };
    for (const path of [
      "prod/cProd",
      "prod/xProd",
      "prod/NCM",
      "prod/CFOP",
      "prod/uCom",
      "prod/uTrib",
    ])
      if (!field(reference, path))
        fail("Identificação fiscal do item incompleta.");
    if (
      !/^\d{8}$/.test(field(reference, "prod/NCM")) ||
      !/^\d{4}$/.test(field(reference, "prod/CFOP"))
    )
      fail("NCM/CFOP da referência inválido.");
    for (const path of ["prod/qCom", "prod/qTrib"])
      if (decimal(field(reference, path)) <= 0n)
        fail("Quantidade fiscal inválida.");
    return reference;
  });
}
export function referenceWarnings(reference, all = []) {
  const warnings = [
    "Referência histórica: exige revisão antes de uso fiscal. XML não confirma situação atual, revogação do certificado ou correção dos impostos.",
  ];
  const name = field(reference, "prod/xProd"),
    ncm = field(reference, "prod/NCM");
  if (field(reference, "prod/uCom") !== field(reference, "prod/uTrib"))
    warnings.push(
      "Unidades comercial e tributável diferentes: conferir fator de conversão e apresentação do produto.",
    );
  if (ncm.startsWith("2201") && field(reference, "prod/CEST") === "0300500")
    warnings.push(
      "Conferir CEST pela embalagem: o código observado não deve ser aplicado indistintamente a garrafas, fardos e galões.",
    );
  if (ncm.startsWith("2201") && /20\s*L|510\s*ML/i.test(name))
    warnings.push(
      "Conferir volume/embalagem da água e quantidade tributável com a contabilidade.",
    );
  if (
    ncm.startsWith("2201") &&
    reference.uf === "SP" &&
    reference.issuedAt.slice(0, 10) >= "2026-07-01" &&
    (code(reference, "ICMS") === "60" ||
      field(reference, "prod/CFOP") === "5405")
  )
    warnings.push(
      "Revisão prioritária: água com ST em SP após 01/07/2026. Conferir os itens excluídos pela Portaria SRE 9/2026 e o tratamento do estoque com a contabilidade; não aplicar a referência automaticamente.",
    );
  const key = (r) =>
    [
      field(r, "prod/CFOP"),
      code(r, "ICMS"),
      code(r, "ICMS", "CSOSN"),
      code(r, "PIS"),
      code(r, "COFINS"),
      code(r, "IBSCBS"),
      field(r, "imposto/IBSCBS/cClassTrib"),
    ].join("|");
  if (
    all.some(
      (other) =>
        other.id !== reference.id &&
        other.issuerHash === reference.issuerHash &&
        field(other, "prod/cProd") === field(reference, "prod/cProd") &&
        key(other) !== key(reference),
    )
  )
    warnings.push(
      "O mesmo produto possui referências com códigos tributários diferentes. Nenhuma foi escolhida automaticamente.",
    );
  if (
    ncm.startsWith("2711") &&
    (code(reference, "ICMS") !== "61" ||
      !field(reference, "prod/comb/cProdANP"))
  )
    warnings.push(
      "Referência de gás exige conferir regime monofásico e dados ANP antes de calcular.",
    );
  return warnings;
}
export async function readReferenceFile(path, executor = run) {
  if (
    typeof path !== "string" ||
    !/^[A-Za-z]:[\\/]/.test(path) ||
    !/\.xml$/i.test(path)
  )
    fail("Selecione um XML local de NF-e/NFC-e.");
  let stdout;
  try {
    ({ stdout } = await executor(
      join(
        process.env.SystemRoot || "C:\\Windows",
        "System32",
        "WindowsPowerShell",
        "v1.0",
        "powershell.exe",
      ),
      [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        helper,
        "-InputFile",
        path,
      ],
      {
        windowsHide: true,
        timeout: 30000,
        maxBuffer: 8 * 1024 * 1024,
        encoding: "utf8",
      },
    ));
  } catch {
    fail(
      "Não foi possível ler o XML e verificar assinatura/protocolo. Confira o arquivo selecionado.",
    );
  }
  let raw;
  try {
    raw = JSON.parse(stdout.trim().replace(/^\uFEFF/, ""));
  } catch {
    fail("Resposta de leitura fiscal inválida.");
  }
  return normalizeReferenceDocument(raw);
}
export function previewFiscalReference(reference, input) {
  if (
    !plain(input) ||
    !integer(input.quantity, 1, 10000) ||
    !integer(input.unitPriceCents, 1, 100000000)
  )
    fail("Informe quantidade e preço válidos para a prévia.");
  if (
    !reference.issuedAt.startsWith("2026-") ||
    reference.crt !== "3" ||
    reference.uf !== "SP" ||
    !["5102", "5405", "5656"].includes(field(reference, "prod/CFOP")) ||
    ["ide/tpNF", "ide/idDest", "ide/finNFe"].some(
      (path) => field(reference, path) !== "1",
    )
  )
    fail(
      "Prévia restrita às referências de venda normal interna de 2026, regime normal/SP, CFOP 5102, 5405 ou 5656. Outros casos permanecem para consulta.",
    );
  const total = BigInt(input.quantity) * BigInt(input.unitPriceCents);
  const factorNumerator = decimal(field(reference, "prod/qTrib")),
    factorDenominator = decimal(field(reference, "prod/qCom"));
  const q = rounded(
    BigInt(input.quantity) * factorNumerator * 10000n,
    factorDenominator,
  );
  let tax = 0n,
    retained = 0n;
  const cst = code(reference, "ICMS");
  if (cst === "61") {
    const retainedQuantity = rounded(
      BigInt(input.quantity) *
        decimal(field(reference, "imposto/ICMS/ICMS61/qBCMonoRet")) *
        10000n,
      factorDenominator,
    );
    retained = rounded(
      retainedQuantity *
        decimal(field(reference, "imposto/ICMS/ICMS61/adRemICMSRet")) *
        100n,
      100000000n,
    );
  } else if (cst === "00")
    tax = rounded(
      total * decimal(field(reference, "imposto/ICMS/ICMS00/pICMS")),
      1000000n,
    );
  else if (cst !== "60")
    fail(
      "Prévia disponível apenas para ICMS 00, 60 e 61. Os demais campos permanecem consultáveis.",
    );
  if (
    !["04", "06", "07", "08", "09"].includes(code(reference, "PIS")) ||
    !["04", "06", "07", "08", "09"].includes(code(reference, "COFINS"))
  )
    fail("Prévia de PIS/COFINS deste grupo ainda não implementada.");
  const rtc = code(reference, "IBSCBS");
  let ibs = 0n,
    cbs = 0n;
  if (rtc === "000") {
    const base = total - tax;
    ibs =
      rounded(
        base *
          decimal(field(reference, "imposto/IBSCBS/gIBSCBS/gIBSUF/pIBSUF")),
        1000000n,
      ) +
      rounded(
        base *
          decimal(field(reference, "imposto/IBSCBS/gIBSCBS/gIBSMun/pIBSMun")),
        1000000n,
      );
    cbs = rounded(
      base * decimal(field(reference, "imposto/IBSCBS/gIBSCBS/gCBS/pCBS")),
      1000000n,
    );
  } else if (
    rtc !== "620" ||
    field(reference, "imposto/IBSCBS/cClassTrib") !== "620006"
  )
    fail("Prévia IBS/CBS deste grupo ainda não implementada.");
  return {
    simulation: true,
    canIssue: false,
    total: fixed(total, 2),
    tributaryQuantity: fixed(q, 4),
    tributaryUnit: field(reference, "prod/uTrib"),
    icms: fixed(tax, 2),
    retainedIcms: fixed(retained, 2),
    ibs: fixed(ibs, 2),
    cbs: fixed(cbs, 2),
    note: "Simulação da referência para venda simples em 2026, sem desconto, frete ou outros tributos. Valores não são acrescidos ao total. Não valida o enquadramento fiscal nem emite nota.",
  };
}
export class FiscalReferences {
  constructor(store) {
    this.store = store;
  }
  list() {
    const references = this.store.db
      .prepare(
        "SELECT r.*,p.name AS linked_product_name FROM fiscal_references r LEFT JOIN products p ON p.id=r.product_id ORDER BY imported_at DESC,id",
      )
      .all()
      .map((row) => ({
        ...JSON.parse(row.value),
        productId: row.product_id,
        linkedProductName: row.linked_product_name,
        importedAt: row.imported_at,
      }));
    return {
      canIssue: false,
      references: references.map((r) => ({
        ...r,
        warnings: referenceWarnings(r, references),
      })),
      operations: OBSERVED_CFOPS,
    };
  }
  async importFiles(paths, reader = readReferenceFile) {
    if (!Array.isArray(paths) || !paths.length || paths.length > 30)
      fail("Selecione de um a 30 XMLs por importação.");
    const docs = [];
    for (const path of paths) docs.push(await reader(path));
    let added = 0;
    this.store.transaction(() => {
      for (const ref of docs.flat()) {
        const exists = this.store.db
          .prepare("SELECT 1 FROM fiscal_references WHERE id=?")
          .get(ref.id);
        if (exists) continue;
        const count = this.store.db
          .prepare("SELECT count(*) AS n FROM fiscal_references")
          .get().n;
        if (count >= 5000)
          fail(
            "Limite local de referências atingido. Preserve o histórico antes de ampliar o catálogo.",
          );
        this.store.db
          .prepare(
            "INSERT INTO fiscal_references(id,value,imported_at) VALUES(?,?,?)",
          )
          .run(ref.id, JSON.stringify(ref), this.store.timestamp());
        added++;
      }
    });
    return { added, ...this.list() };
  }
  link(input) {
    if (
      !plain(input) ||
      typeof input.id !== "string" ||
      !/^[a-f0-9]{64}$/.test(input.id) ||
      !(input.productId === null || integer(input.productId))
    )
      fail("Vínculo fiscal inválido.");
    if (input.productId !== null)
      this.store.getEntity("products", input.productId, "Produto", true);
    if (
      !this.store.db
        .prepare("SELECT 1 FROM fiscal_references WHERE id=?")
        .get(input.id)
    )
      fail("Referência não encontrada.");
    this.store.db
      .prepare("UPDATE fiscal_references SET product_id=? WHERE id=?")
      .run(input.productId, input.id);
    return this.list();
  }
  preview(input) {
    if (!plain(input) || typeof input.id !== "string")
      fail("Referência inválida.");
    const row = this.store.db
      .prepare("SELECT value FROM fiscal_references WHERE id=?")
      .get(input.id);
    if (!row) fail("Referência não encontrada.");
    return previewFiscalReference(JSON.parse(row.value), input);
  }
}
