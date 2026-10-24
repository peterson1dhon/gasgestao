// Exercita estrutura fiscal observada. Não parametriza vendas nem transmite XML.
import { createHash } from "node:crypto";
import { buildLabEnvelope, xmlText } from "./lab-document.mjs";
import {
  field,
  code,
  previewFiscalReference,
  referenceWarnings,
} from "./references.mjs";

const fail = (message) => {
  throw new Error(message);
};
const tag = (name, value) => `<${name}>${xmlText(value)}</${name}>`;
const round = (n, d) => (n + d / 2n) / d;
const fixed = (n, scale) =>
  `${n / 10n ** BigInt(scale)}.${String(n % 10n ** BigInt(scale)).padStart(scale, "0")}`;
const dec = (value) => {
  if (!/^\d{1,11}(?:\.\d{1,4})?$/.test(value))
    fail("Decimal ausente ou inválido na referência.");
  const [a, b = ""] = value.split(".");
  return BigInt(a) * 10000n + BigInt(b.padEnd(4, "0"));
};
function one(ref, path, pattern = /^.+$/) {
  const matches = ref.fields.filter((f) => f.path === path);
  if (matches.length !== 1 || !pattern.test(matches[0].value))
    fail(`Campo ausente, repetido ou não suportado: ${path}`);
  return matches[0].value;
}
const rate = (ref, path, max = 1000000n) => {
  const v = dec(one(ref, path, /^\d+(?:\.\d{1,4})?$/));
  if (v > max) fail("Alíquota fora do intervalo técnico.");
  return fixed(v, 4);
};

export function buildReferenceLabDocument({
  reference,
  issuer,
  model = "55",
  number,
  issuedAt,
  control,
}) {
  if (!reference || issuer?.CRT !== "3")
    fail("O teste de referências exige CRT 3 confirmado.");
  if (
    reference.signatureVerified !== true ||
    reference.currentStatusChecked !== false ||
    reference.certificateChainChecked !== false ||
    !["100", "150"].includes(reference.status)
  )
    fail("Referência sem as verificações esperadas do leitor.");
  const issuerHash = createHash("sha256").update(issuer.CNPJ).digest("hex");
  if (reference.issuerHash !== issuerHash)
    fail("A referência não pertence ao emitente do laboratório.");
  // Campos repetidos não podem ser reduzidos silenciosamente à primeira ocorrência.
  const seen = new Set();
  for (const f of reference.fields) {
    if (seen.has(f.path))
      fail(
        "Referência com grupos repetidos ainda não suportados pelo gerador.",
      );
    seen.add(f.path);
  }
  const ncm = one(reference, "prod/NCM", /^\d{8}$/),
    cfop = one(reference, "prod/CFOP", /^\d{4}$/);
  const glp =
    ncm === "27111910" && cfop === "5656" && code(reference, "ICMS") === "61";
  const water =
    ncm === "22011000" && cfop === "5102" && code(reference, "ICMS") === "00";
  if (!glp && !water)
    fail(
      "Gerador restrito a GLP/5656/61 e água/5102/00. Água com ST exige revisão.",
    );
  const expected = glp ? ["620", "620006"] : ["000", "000001"];
  if (
    one(reference, "imposto/IBSCBS/CST") !== expected[0] ||
    one(reference, "imposto/IBSCBS/cClassTrib") !== expected[1]
  )
    fail("Classificação IBS/CBS ainda não suportada.");
  // Não omitir silenciosamente grupos de impostos ou ajustes não implementados.
  const icmsGroup = glp ? "ICMS61" : "ICMS00";
  const allowed = new Set([
    ...[
      "orig",
      "CST",
      ...(glp
        ? ["qBCMonoRet", "adRemICMSRet", "vICMSMonoRet"]
        : ["modBC", "vBC", "pICMS", "vICMS"]),
    ].map((k) => `imposto/ICMS/${icmsGroup}/${k}`),
    "imposto/vTotTrib",
    "imposto/PIS/PISNT/CST",
    "imposto/COFINS/COFINSNT/CST",
    "imposto/IBSCBS/CST",
    "imposto/IBSCBS/cClassTrib",
    ...(!glp
      ? [
          "vBC",
          "gIBSUF/pIBSUF",
          "gIBSUF/vIBSUF",
          "gIBSMun/pIBSMun",
          "gIBSMun/vIBSMun",
          "vIBS",
          "gCBS/pCBS",
          "gCBS/vCBS",
        ].map((k) => `imposto/IBSCBS/gIBSCBS/${k}`)
      : []),
  ]);
  if (
    reference.fields.some(
      (f) => f.path.startsWith("imposto/") && !allowed.has(f.path),
    )
  )
    fail("Imposto, redução ou benefício não implementado no laboratório.");
  if (
    reference.fields.some((f) =>
      /^prod\/(cBenef|EXTIPI|indEscala|CNPJFab|DI|detExport|rastro|med|arma|veicProd|RECOPI|CEST.*\/)/.test(
        f.path,
      ),
    )
  )
    fail("Detalhamento adicional de produto exige implementação específica.");
  const preview = previewFiscalReference(reference, {
    quantity: 1,
    unitPriceCents: 100,
  });
  const q = dec(preview.tributaryQuantity);
  if (q === 0n) fail("Quantidade tributável arredondada para zero.");
  const uCom = one(reference, "prod/uCom", /^[A-Za-z0-9]{1,6}$/),
    uTrib = one(reference, "prod/uTrib", /^[A-Za-z0-9]{1,6}$/);
  const orig = one(reference, `imposto/ICMS/${icmsGroup}/orig`, /^[0-8]$/);
  let comb = "",
    icms = "",
    rtc = "",
    rtcBase = "0.00",
    ibsUF = "0.00",
    ibsMun = "0.00";
  if (glp) {
    if (uTrib !== "KG") fail("GLP exige unidade tributável KG neste teste.");
    const anp = one(reference, "prod/comb/cProdANP", /^210203001$/);
    const percent = rate(reference, "prod/comb/pGLP");
    if (dec(percent) !== 1000000n) fail("Mistura de GLP ainda não suportada.");
    const allowedComb = [
      "cProdANP",
      "descANP",
      "pGLP",
      "vPart",
      "UFCons",
      "origComb/indImport",
      "origComb/cUFOrig",
      "origComb/pOrig",
    ].map((k) => "prod/comb/" + k);
    if (
      reference.fields.some(
        (f) => f.path.startsWith("prod/comb/") && !allowedComb.includes(f.path),
      )
    )
      fail("Grupo de combustível ainda não suportado.");
    const desc = one(reference, "prod/comb/descANP", /^.{2,95}$/);
    const uf = one(reference, "prod/comb/UFCons", /^SP$/);
    const imported = one(reference, "prod/comb/origComb/indImport", /^[01]$/);
    const originUF = one(
      reference,
      "prod/comb/origComb/cUFOrig",
      /^(1[1-7]|2[1-9]|3[1-35]|4[1-3]|5[0-3])$/,
    );
    const originPct = rate(reference, "prod/comb/origComb/pOrig");
    if (dec(originPct) !== 1000000n)
      fail("Múltiplas origens de combustível exigem implementação específica.");
    comb =
      "<comb>" +
      tag("cProdANP", anp) +
      tag("descANP", desc) +
      tag("pGLP", percent) +
      tag(
        "vPart",
        fixed(round(dec(one(reference, "prod/comb/vPart")), 100n), 2),
      ) +
      tag("UFCons", uf) +
      "<origComb>" +
      tag("indImport", imported) +
      tag("cUFOrig", originUF) +
      tag("pOrig", originPct) +
      "</origComb></comb>";
    const baseQty = fixed(
      round(
        dec(one(reference, "imposto/ICMS/ICMS61/qBCMonoRet")) * 10000n,
        dec(one(reference, "prod/qCom")),
      ),
      4,
    );
    icms =
      "<ICMS61>" +
      tag("orig", orig) +
      "<CST>61</CST>" +
      tag("qBCMonoRet", baseQty) +
      tag("adRemICMSRet", rate(reference, "imposto/ICMS/ICMS61/adRemICMSRet")) +
      tag("vICMSMonoRet", preview.retainedIcms) +
      "</ICMS61>";
    rtc = "<IBSCBS><CST>620</CST><cClassTrib>620006</cClassTrib></IBSCBS>";
  } else {
    if (reference.fields.some((f) => f.path.startsWith("prod/comb/")))
      fail("Água não admite grupo de combustível.");
    one(reference, "imposto/ICMS/ICMS00/modBC", /^3$/);
    const p = rate(reference, "imposto/ICMS/ICMS00/pICMS");
    icms =
      "<ICMS00>" +
      tag("orig", orig) +
      "<CST>00</CST><modBC>3</modBC><vBC>1.00</vBC>" +
      tag("pICMS", p) +
      tag("vICMS", preview.icms) +
      "</ICMS00>";
    rtcBase = fixed(100n - BigInt(preview.icms.replace(".", "")), 2);
    const base = BigInt(rtcBase.replace(".", ""));
    const ufRate = rate(reference, "imposto/IBSCBS/gIBSCBS/gIBSUF/pIBSUF"),
      munRate = rate(reference, "imposto/IBSCBS/gIBSCBS/gIBSMun/pIBSMun"),
      cbsRate = rate(reference, "imposto/IBSCBS/gIBSCBS/gCBS/pCBS");
    ibsUF = fixed(round(base * dec(ufRate), 1000000n), 2);
    ibsMun = fixed(round(base * dec(munRate), 1000000n), 2);
    rtc =
      "<IBSCBS><CST>000</CST><cClassTrib>000001</cClassTrib><gIBSCBS>" +
      tag("vBC", rtcBase) +
      "<gIBSUF>" +
      tag("pIBSUF", ufRate) +
      tag("vIBSUF", ibsUF) +
      "</gIBSUF><gIBSMun>" +
      tag("pIBSMun", munRate) +
      tag("vIBSMun", ibsMun) +
      "</gIBSMun>" +
      tag("vIBS", preview.ibs) +
      "<gCBS>" +
      tag("pCBS", cbsRate) +
      tag("vCBS", preview.cbs) +
      "</gCBS></gIBSCBS></IBSCBS>";
  }
  const nt = (group) =>
    "<" +
    group +
    "><" +
    group +
    "NT>" +
    tag(
      "CST",
      one(reference, `imposto/${group}/${group}NT/CST`, /^(04|06|07|08|09)$/),
    ) +
    "</" +
    group +
    "NT></" +
    group +
    ">";
  const cest = field(reference, "prod/CEST");
  if (cest && !/^\d{7}$/.test(cest)) fail("CEST inválido.");
  const detailXml =
    '<det nItem="1"><prod><cProd>TESTEHML' +
    (glp ? "GLP" : "AGUA") +
    "</cProd><cEAN>SEM GTIN</cEAN><xProd>NOTA FISCAL EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL</xProd>" +
    tag("NCM", ncm) +
    (cest ? tag("CEST", cest) : "") +
    tag("CFOP", cfop) +
    tag("uCom", uCom) +
    "<qCom>1.0000</qCom><vUnCom>1.0000000000</vUnCom><vProd>1.00</vProd><cEANTrib>SEM GTIN</cEANTrib>" +
    tag("uTrib", uTrib) +
    tag("qTrib", preview.tributaryQuantity) +
    tag("vUnTrib", fixed(round(100000000000000n, q), 10)) +
    "<indTot>1</indTot>" +
    comb +
    "</prod><imposto><ICMS>" +
    icms +
    "</ICMS>" +
    nt("PIS") +
    nt("COFINS") +
    rtc +
    "</imposto><vItem>1.00</vItem></det>";
  const mono = glp
    ? tag(
        "qBCMonoRet",
        fixed(
          round(
            dec(one(reference, "imposto/ICMS/ICMS61/qBCMonoRet")) * 100n,
            dec(one(reference, "prod/qCom")),
          ),
          2,
        ),
      ) + tag("vICMSMonoRet", preview.retainedIcms)
    : "";
  const zeroTags = ["vICMSDeson", "vFCP", "vBCST", "vST", "vFCPST", "vFCPSTRet"]
    .map((k) => tag(k, "0.00"))
    .join("");
  const totalXml =
    "<total><ICMSTot>" +
    tag("vBC", glp ? "0.00" : "1.00") +
    tag("vICMS", preview.icms) +
    zeroTags +
    mono +
    "<vProd>1.00</vProd>" +
    [
      "vFrete",
      "vSeg",
      "vDesc",
      "vII",
      "vIPI",
      "vIPIDevol",
      "vPIS",
      "vCOFINS",
      "vOutro",
    ]
      .map((k) => tag(k, "0.00"))
      .join("") +
    "<vNF>1.00</vNF></ICMSTot><IBSCBSTot>" +
    tag("vBCIBSCBS", rtcBase) +
    "<gIBS><gIBSUF><vDif>0.00</vDif><vDevTrib>0.00</vDevTrib>" +
    tag("vIBSUF", ibsUF) +
    "</gIBSUF><gIBSMun><vDif>0.00</vDif><vDevTrib>0.00</vDevTrib>" +
    tag("vIBSMun", ibsMun) +
    "</gIBSMun>" +
    tag("vIBS", preview.ibs) +
    "<vCredPres>0.00</vCredPres><vCredPresCondSus>0.00</vCredPresCondSus></gIBS><gCBS><vDif>0.00</vDif><vDevTrib>0.00</vDevTrib>" +
    tag("vCBS", preview.cbs) +
    "<vCredPres>0.00</vCredPres><vCredPresCondSus>0.00</vCredPresCondSus></gCBS></IBSCBSTot><vNFTot>1.00</vNFTot></total>";
  const document = buildLabEnvelope(
    { issuer, model, number, series: 829, issuedAt, control },
    { detailXml, totalXml },
  );
  return {
    ...document,
    scenario: glp ? "GLP" : "AGUA",
    canIssue: false,
    referenceId: reference.id,
    warnings: [
      ...referenceWarnings(reference),
      "Laboratório sem estimativa IBPT/vTotTrib: o valor histórico não é reutilizado.",
    ],
    preview,
  };
}
