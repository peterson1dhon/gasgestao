// F04 parcial: XML determinístico de homologação, sem assinatura ou transmissão.
// Aceita somente o vetor ordinário de água já calculado pela F03.
import { accessKeyDigit, xmlText } from "./lab-document.mjs";
import { lineTotalCents, percentCents } from "./decimal.mjs";
import { RTC_2026_POLICY_ID } from "./calculator.mjs";

const NS = "http://www.portalfiscal.inf.br/nfe";
const fail = (message) => { throw new Error(message); };
const tag = (name, value) => `<${name}>${xmlText(value)}</${name}>`;
const money = (value) => {
  if (!Number.isSafeInteger(value) || value < 0) fail("Centavos inválidos no snapshot fiscal.");
  return `${Math.trunc(value / 100)}.${String(value % 100).padStart(2, "0")}`;
};
const digits = (value, length, name) => {
  if (typeof value !== "string" || !new RegExp(`^\\d{${length}}$`).test(value)) fail(`${name} inválido.`);
  return value;
};
const present = (value, name) => {
  if (typeof value !== "string" || !value.trim()) fail(`${name} ausente.`);
  return value;
};
function addressXml(address) {
  if (!address || address.UF !== "SP") fail("Endereço SP ausente.");
  return ["xLgr", "nro", "xBairro", "cMun", "xMun", "UF", "CEP"].map(key => {
    const value = present(address[key], key);
    if (key === "cMun") digits(value, 7, key);
    if (key === "CEP") digits(value, 8, key);
    return tag(key, value);
  }).join("") + "<cPais>1058</cPais><xPais>BRASIL</xPais>";
}
function ordinaryContribution(name, tax) {
  if (tax.kind !== "notCalculated" || tax.cst !== "04" || tax.amountCents !== 0) {
    fail(`${name} ainda não possui serialização operacional nesta etapa.`);
  }
  return `<${name}><${name}NT><CST>04</CST></${name}NT></${name}>`;
}
function itemXml(item, product, index) {
  if (!product || !/^[A-Za-z0-9._-]{1,60}$/.test(product.code) ||
      !/^[A-Za-z0-9]{1,6}$/.test(product.unit) || !product.name ||
      product.profileId !== item.profileId) fail("Produto do snapshot não confere com a prévia.");
  if (item.icms?.kind !== "adValorem" || item.icms.cst !== "00" ||
      item.rtc?.kind !== "standard" || item.rtc.cst !== "000" || item.rtc.cClassTrib !== "000001") {
    fail("Classe tributária sem serializador F04 aprovado.");
  }
  if (item.rtc.ibsUfRate !== "0.1000" || item.rtc.ibsMunRate !== "0.0000" || item.rtc.cbsRate !== "0.9000") {
    fail("Alíquotas RTC fora da política 2026.");
  }
  if (item.discountCents || item.freightCents || item.grossCents !== item.adjustedCents ||
      lineTotalCents(item.quantity, item.unitPrice) !== item.grossCents) {
    fail("Desconto/frete exigem teste XSD e reconciliação próprios.");
  }
  if (item.icms.baseCents !== item.grossCents ||
      percentCents(item.icms.baseCents,item.icms.rate) !== item.icmsCents ||
      percentCents(item.rtc.baseCents,item.rtc.ibsUfRate) !== item.ibsUfCents ||
      percentCents(item.rtc.baseCents,item.rtc.ibsMunRate) !== item.ibsMunCents ||
      percentCents(item.rtc.baseCents,item.rtc.cbsRate) !== item.cbsCents) {
    fail("Valores de imposto do snapshot fiscal divergentes.");
  }
  if (item.rtc.ibsUfCents + item.rtc.ibsMunCents !== item.ibsUfCents + item.ibsMunCents) fail("IBS divergente.");
  const rtc = `<IBSCBS><CST>000</CST><cClassTrib>000001</cClassTrib><gIBSCBS>` +
    tag("vBC", money(item.rtc.baseCents)) +
    `<gIBSUF>${tag("pIBSUF", item.rtc.ibsUfRate)}${tag("vIBSUF", money(item.ibsUfCents))}</gIBSUF>` +
    `<gIBSMun>${tag("pIBSMun", item.rtc.ibsMunRate)}${tag("vIBSMun", money(item.ibsMunCents))}</gIBSMun>` +
    tag("vIBS", money(item.ibsUfCents + item.ibsMunCents)) +
    `<gCBS>${tag("pCBS", item.rtc.cbsRate)}${tag("vCBS", money(item.cbsCents))}</gCBS></gIBSCBS></IBSCBS>`;
  return `<det nItem="${index + 1}"><prod>${tag("cProd", product.code)}<cEAN>SEM GTIN</cEAN>` +
    tag("xProd", product.name) + `<NCM>22011000</NCM><CFOP>5102</CFOP>` +
    tag("uCom", product.unit) + tag("qCom", item.quantity) + tag("vUnCom", item.unitPrice) +
    tag("vProd", money(item.grossCents)) + `<cEANTrib>SEM GTIN</cEANTrib>` +
    tag("uTrib", present(product.taxableUnit, "Unidade tributável")) +
    tag("qTrib", item.taxableQuantity) + tag("vUnTrib", item.taxableUnitPrice) +
    `<indTot>1</indTot></prod><imposto><ICMS><ICMS00>` +
    tag("orig", digits(product.origin, 1, "Origem")) + `<CST>00</CST><modBC>3</modBC>` +
    tag("vBC", money(item.icms.baseCents)) + tag("pICMS", item.icms.rate) +
    tag("vICMS", money(item.icmsCents)) + `</ICMS00></ICMS>` +
    ordinaryContribution("PIS", item.pis) + ordinaryContribution("COFINS", item.cofins) +
    rtc + `</imposto>${tag("vItem", money(item.adjustedCents))}</det>`;
}
const zero = ["vICMSDeson","vFCP","vBCST","vST","vFCPST","vFCPSTRet"].map(key => tag(key,"0.00")).join("");
const otherZero = ["vFrete","vSeg","vDesc","vII","vIPI","vIPIDevol","vPIS","vCOFINS","vOutro"].map(key => tag(key,"0.00")).join("");
function totalsXml(t) {
  const ibs = t.ibsUfCents + t.ibsMunCents;
  return `<total><ICMSTot>${tag("vBC",money(t.grossCents))}${tag("vICMS",money(t.icmsCents))}${zero}` +
    tag("vProd",money(t.grossCents)) + otherZero + tag("vNF",money(t.documentCents)) +
    `</ICMSTot><IBSCBSTot>${tag("vBCIBSCBS",money(t.rtcBaseCents))}` +
    `<gIBS><gIBSUF><vDif>0.00</vDif><vDevTrib>0.00</vDevTrib>${tag("vIBSUF",money(t.ibsUfCents))}</gIBSUF>` +
    `<gIBSMun><vDif>0.00</vDif><vDevTrib>0.00</vDevTrib>${tag("vIBSMun",money(t.ibsMunCents))}</gIBSMun>` +
    `${tag("vIBS",money(ibs))}<vCredPres>0.00</vCredPres><vCredPresCondSus>0.00</vCredPresCondSus></gIBS>` +
    `<gCBS><vDif>0.00</vDif><vDevTrib>0.00</vDevTrib>${tag("vCBS",money(t.cbsCents))}` +
    `<vCredPres>0.00</vCredPres><vCredPresCondSus>0.00</vCredPresCondSus></gCBS></IBSCBSTot>` +
    `${tag("vNFTot",money(t.documentCents))}</total>`;
}

export function buildUnsignedWaterHomologation55({issuer, recipient, calculation, products, number, series, issuedAt, control}) {
  if (calculation?.policyId !== RTC_2026_POLICY_ID || calculation.model !== 55 ||
      !issuedAt?.startsWith(calculation.issuedOn) || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}-03:00$/.test(issuedAt)) {
    fail("Política/data/modelo não correspondem ao snapshot.");
  }
  if (issuer?.CRT !== "3" || !Number.isSafeInteger(number) || number < 1 || number > 999999999 ||
      !Number.isSafeInteger(series) || series < 1 || series > 889 ||
      !Array.isArray(products) || products.length !== calculation.items?.length || !calculation.items.length) {
    fail("Identidade ou itens fiscais inválidos.");
  }
  digits(issuer.CNPJ,14,"CNPJ emitente"); digits(issuer.IE,12,"IE emitente");
  digits(recipient?.CNPJ,14,"CNPJ destinatário"); digits(control,8,"cNF");
  if (calculation.totals.discountCents || calculation.totals.freightCents || calculation.totals.pisCents || calculation.totals.cofinsCents) {
    fail("Ajustes/contribuições fora do cenário F04 parcial.");
  }
  const sum = (field) => calculation.items.reduce((total,item) => total + BigInt(item[field]), 0n);
  for (const [itemField,totalField] of [
    ["grossCents","grossCents"],["adjustedCents","documentCents"],
    ["icmsCents","icmsCents"],["ibsUfCents","ibsUfCents"],
    ["ibsMunCents","ibsMunCents"],["cbsCents","cbsCents"],
  ]) {
    if (sum(itemField) !== BigInt(calculation.totals[totalField])) fail("Totais do snapshot fiscal divergentes.");
  }
  if (calculation.totals.grossCents !== calculation.totals.documentCents ||
      calculation.totals.documentCents <= 0) fail("Total da nota fora do cenário F04 parcial.");
  const first43=`35${issuedAt.slice(2,4)}${issuedAt.slice(5,7)}${issuer.CNPJ}55${String(series).padStart(3,"0")}${String(number).padStart(9,"0")}1${control}`;
  const key=first43+accessKeyDigit(first43);
  const details=calculation.items.map((item,index)=>itemXml(item,products[index],index)).join("");
  const rtcBaseCents=calculation.items.reduce((sum,item)=>sum+item.rtc.baseCents,0);
  const total=totalsXml({...calculation.totals,rtcBaseCents});
  const emitAddress=addressXml(issuer.address), recipientAddress=addressXml(recipient.address);
  const xml=`<?xml version="1.0" encoding="utf-8"?><NFe xmlns="${NS}"><infNFe Id="NFe${key}" versao="4.00">` +
    `<ide><cUF>35</cUF>${tag("cNF",control)}<natOp>VENDA DE MERCADORIA</natOp><mod>55</mod>` +
    tag("serie",series)+tag("nNF",number)+tag("dhEmi",issuedAt)+`<tpNF>1</tpNF><idDest>1</idDest>` +
    tag("cMunFG",issuer.address.cMun)+`<tpImp>1</tpImp><tpEmis>1</tpEmis>`+tag("cDV",key.slice(-1))+
    `<tpAmb>2</tpAmb><finNFe>1</finNFe><indFinal>1</indFinal><indPres>1</indPres><procEmi>0</procEmi>` +
    `<verProc>GasGestao-F04-LAB</verProc></ide><emit>`+tag("CNPJ",issuer.CNPJ)+tag("xNome",present(issuer.xNome,"Emitente"))+
    `<enderEmit>${emitAddress}</enderEmit>`+tag("IE",issuer.IE)+`<CRT>3</CRT></emit><dest>`+
    tag("CNPJ",recipient.CNPJ)+`<xNome>NF-E EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL</xNome>`+
    `<enderDest>${recipientAddress}</enderDest><indIEDest>9</indIEDest></dest>`+details+total+
    `<transp><modFrete>9</modFrete></transp><pag><detPag><tPag>01</tPag>`+tag("vPag",money(calculation.totals.documentCents))+
    `</detPag></pag><infAdic><infCpl>TESTE TECNICO SEM VALOR FISCAL</infCpl></infAdic></infNFe></NFe>`;
  return {key,xml,model:55,environment:"homologacao",canIssue:false,number,series};
}
