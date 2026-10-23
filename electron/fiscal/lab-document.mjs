// Documento ficticio de R$ 1,00, restrito a homologacao. Nao calcula tributos reais.
import { randomInt } from "node:crypto";
const NS = "http://www.portalfiscal.inf.br/nfe";
export function accessKeyDigit(first43) {
  if (!/^\d{43}$/.test(first43)) throw new Error("Chave base inválida.");
  let weight = 2,
    sum = 0;
  for (let i = 42; i >= 0; i--) {
    sum += Number(first43[i]) * weight;
    weight = weight === 9 ? 2 : weight + 1;
  }
  const digit = 11 - (sum % 11);
  return String(digit >= 10 ? 0 : digit);
}
export function xmlText(value) {
  const text = String(value ?? "");
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text))
    throw new Error("Controle inválido no XML.");
  return text.replace(
    /[&<>"']/g,
    (ch) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&apos;",
      })[ch],
  );
}
export function saoPauloTimestamp(date = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("sv-SE", {
      timeZone: "America/Sao_Paulo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
      timeZoneName: "longOffset",
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}${parts.timeZoneName.replace("GMT", "").replace(/\u2212/g, "-")}`;
}
export function buildLabDocument({
  issuer,
  model,
  number,
  series = 829,
  issuedAt = saoPauloTimestamp(),
  control = String(randomInt(1, 100000000)).padStart(8, "0"),
}) {
  if (!["55", "65"].includes(String(model)))
    throw new Error("Modelo inválido.");
  model = String(model);
  if (
    !Number.isSafeInteger(number) ||
    number < 1 ||
    number > 999999999 ||
    !Number.isInteger(series) ||
    series < 1 ||
    series > 889
  )
    throw new Error("Numeração inválida.");
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}-03:00$/.test(issuedAt) ||
    !/^\d{8}$/.test(control)
  )
    throw new Error("Data/controle inválido.");
  if (issuedAt.slice(0, 4) !== "2026")
    throw new Error(
      "Os parâmetros deste laboratório são exclusivos dos testes de 2026.",
    );
  const address = issuer.address;
  if (
    !/^\d{14}$/.test(issuer.CNPJ) ||
    !/^\d{12}$/.test(issuer.IE) ||
    !["1", "3"].includes(issuer.CRT) ||
    !address ||
    address.UF !== "SP" ||
    !/^35\d{5}$/.test(address.cMun) ||
    !issuer.xNome
  )
    throw new Error(
      "O laboratório exige emitente SP, IE e CRT 1 ou 3 confirmado. Não substitui validação fiscal atual.",
    );
  for (const key of ["xLgr", "nro", "xBairro", "cMun", "xMun", "UF", "CEP"])
    if (!address[key]) throw new Error(`Endereço incompleto: ${key}`);
  const partial = `35${issuedAt.slice(2, 4)}${issuedAt.slice(5, 7)}${issuer.CNPJ}${model}${String(series).padStart(3, "0")}${String(number).padStart(9, "0")}1${control}`;
  const key = partial + accessKeyDigit(partial),
    dv = key.slice(-1);
  const tag = (name, value) => `<${name}>${xmlText(value)}</${name}>`;
  const addressXml =
    ["xLgr", "nro", "xCpl", "xBairro", "cMun", "xMun", "UF", "CEP"]
      .filter((k) => address[k])
      .map((k) => tag(k, address[k]))
      .join("") + "<cPais>1058</cPais><xPais>BRASIL</xPais>";
  const dest =
    model === "55"
      ? `<dest>${tag("CNPJ", issuer.CNPJ)}<xNome>NF-E EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL</xNome><enderDest><xLgr>RUA DE TESTE</xLgr><nro>1</nro><xBairro>CENTRO</xBairro>${tag("cMun", address.cMun)}${tag("xMun", address.xMun)}<UF>SP</UF>${tag("CEP", address.CEP)}<cPais>1058</cPais><xPais>BRASIL</xPais></enderDest><indIEDest>1</indIEDest>${tag("IE", issuer.IE)}</dest>`
      : "";
  const supplementary =
    model === "65"
      ? `<infNFeSupl><qrCode><![CDATA[https://www.homologacao.nfce.fazenda.sp.gov.br/qrcode?p=${key}|3|2]]></qrCode><urlChave>https://www.homologacao.nfce.fazenda.sp.gov.br/consulta</urlChave></infNFeSupl>`
      : "";
  const normal = issuer.CRT === "3";
  // Aliquota de exemplo para exercitar a estrutura, sem parametrizar vendas reais.
  const icms = normal
    ? "<ICMS00><orig>0</orig><CST>00</CST><modBC>3</modBC><vBC>1.00</vBC><pICMS>18.0000</pICMS><vICMS>0.18</vICMS></ICMS00>"
    : "<ICMSSN102><orig>0</orig><CSOSN>103</CSOSN></ICMSSN102>";
  const rtc = normal
    ? "<IBSCBS><CST>000</CST><cClassTrib>000001</cClassTrib><gIBSCBS><vBC>0.82</vBC><gIBSUF><pIBSUF>0.1000</pIBSUF><vIBSUF>0.00</vIBSUF></gIBSUF><gIBSMun><pIBSMun>0.0000</pIBSMun><vIBSMun>0.00</vIBSMun></gIBSMun><vIBS>0.00</vIBS><gCBS><pCBS>0.9000</pCBS><vCBS>0.01</vCBS></gCBS></gIBSCBS></IBSCBS>"
    : "";
  const rtcTotal = normal
    ? "<IBSCBSTot><vBCIBSCBS>0.82</vBCIBSCBS><gIBS><gIBSUF><vDif>0.00</vDif><vDevTrib>0.00</vDevTrib><vIBSUF>0.00</vIBSUF></gIBSUF><gIBSMun><vDif>0.00</vDif><vDevTrib>0.00</vDevTrib><vIBSMun>0.00</vIBSMun></gIBSMun><vIBS>0.00</vIBS><vCredPres>0.00</vCredPres><vCredPresCondSus>0.00</vCredPresCondSus></gIBS><gCBS><vDif>0.00</vDif><vDevTrib>0.00</vDevTrib><vCBS>0.01</vCBS><vCredPres>0.00</vCredPres><vCredPresCondSus>0.00</vCredPresCondSus></gCBS></IBSCBSTot><vNFTot>1.00</vNFTot>"
    : "";
  const xml = `<?xml version="1.0" encoding="utf-8"?><NFe xmlns="${NS}"><infNFe Id="NFe${key}" versao="4.00"><ide><cUF>35</cUF><cNF>${control}</cNF><natOp>VENDA TESTE HOMOLOGACAO</natOp><mod>${model}</mod><serie>${series}</serie><nNF>${number}</nNF><dhEmi>${issuedAt}</dhEmi><tpNF>1</tpNF><idDest>1</idDest>${tag("cMunFG", address.cMun)}<tpImp>${model === "55" ? "1" : "4"}</tpImp><tpEmis>1</tpEmis><cDV>${dv}</cDV><tpAmb>2</tpAmb><finNFe>1</finNFe><indFinal>1</indFinal><indPres>1</indPres><procEmi>0</procEmi><verProc>GasGestao-0.6-LAB</verProc></ide><emit>${tag("CNPJ", issuer.CNPJ)}${tag("xNome", issuer.xNome)}<enderEmit>${addressXml}</enderEmit>${tag("IE", issuer.IE)}${tag("CRT", issuer.CRT)}</emit>${dest}<det nItem="1"><prod><cProd>TESTEHML001</cProd><cEAN>SEM GTIN</cEAN><xProd>NOTA FISCAL EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL</xProd><NCM>22021000</NCM><CEST>1711100</CEST><CFOP>5102</CFOP><uCom>UN</uCom><qCom>1.0000</qCom><vUnCom>1.0000000000</vUnCom><vProd>1.00</vProd><cEANTrib>SEM GTIN</cEANTrib><uTrib>UN</uTrib><qTrib>1.0000</qTrib><vUnTrib>1.0000000000</vUnTrib><indTot>1</indTot></prod><imposto><ICMS>${icms}</ICMS><PIS><PISNT><CST>07</CST></PISNT></PIS><COFINS><COFINSNT><CST>07</CST></COFINSNT></COFINS>${rtc}</imposto><vItem>1.00</vItem></det><total><ICMSTot><vBC>${normal ? "1.00" : "0.00"}</vBC><vICMS>${normal ? "0.18" : "0.00"}</vICMS><vICMSDeson>0.00</vICMSDeson><vFCP>0.00</vFCP><vBCST>0.00</vBCST><vST>0.00</vST><vFCPST>0.00</vFCPST><vFCPSTRet>0.00</vFCPSTRet><vProd>1.00</vProd><vFrete>0.00</vFrete><vSeg>0.00</vSeg><vDesc>0.00</vDesc><vII>0.00</vII><vIPI>0.00</vIPI><vIPIDevol>0.00</vIPIDevol><vPIS>0.00</vPIS><vCOFINS>0.00</vCOFINS><vOutro>0.00</vOutro><vNF>1.00</vNF></ICMSTot>${rtcTotal}</total><transp><modFrete>9</modFrete></transp><pag><detPag><tPag>01</tPag><vPag>1.00</vPag></detPag></pag><infAdic><infCpl>TESTE TECNICO SEM VALOR FISCAL. Parametros de exemplo de referencia historica; nao confirma tributacao atual nem registra venda.</infCpl></infAdic></infNFe>${supplementary}</NFe>`;
  return {
    key,
    xml,
    model,
    number,
    series,
    environment: "homologacao",
    valueCents: 100,
  };
}
