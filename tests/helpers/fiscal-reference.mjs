import { createHash } from "node:crypto";
import { normalizeReferenceDocument } from "../../electron/fiscal/references.mjs";
export const issuer = {
  CNPJ: "12345678000195",
  IE: "123456789012",
  CRT: "3",
  xNome: "EMPRESA FICTICIA",
  address: {
    xLgr: "RUA TESTE",
    nro: "1",
    xBairro: "CENTRO",
    cMun: "3554003",
    xMun: "TATUI",
    UF: "SP",
    CEP: "18270001",
  },
};
export const options = {
  issuer,
  model: "55",
  number: 1,
  issuedAt: "2026-10-24T12:00:00-03:00",
  control: "12345678",
};
export function referenceFixture(glp = true) {
  const f = {
    "prod/cProd": "EXEMPLO",
    "prod/xProd": glp ? "GLP P13" : "AGUA 20L",
    "prod/NCM": glp ? "27111910" : "22011000",
    "prod/CEST": glp ? "0601100" : "0300500",
    "prod/CFOP": glp ? "5656" : "5102",
    "prod/uCom": "UN",
    "prod/qCom": "1",
    "prod/uTrib": glp ? "KG" : "LT",
    "prod/qTrib": glp ? "13" : "20",
    "ide/tpNF": "1",
    "ide/idDest": "1",
    "ide/finNFe": "1",
    "imposto/PIS/PISNT/CST": glp ? "04" : "06",
    "imposto/COFINS/COFINSNT/CST": glp ? "04" : "06",
    "imposto/IBSCBS/CST": glp ? "620" : "000",
    "imposto/IBSCBS/cClassTrib": glp ? "620006" : "000001",
  };
  if (glp)
    Object.assign(f, {
      "prod/comb/cProdANP": "210203001",
      "prod/comb/descANP": "GLP DE TESTE",
      "prod/comb/pGLP": "100.0000",
      "prod/comb/vPart": "2.50",
      "prod/comb/UFCons": "SP",
      "prod/comb/origComb/indImport": "0",
      "prod/comb/origComb/cUFOrig": "35",
      "prod/comb/origComb/pOrig": "100.0000",
      "imposto/ICMS/ICMS61/orig": "0",
      "imposto/ICMS/ICMS61/CST": "61",
      "imposto/ICMS/ICMS61/qBCMonoRet": "13",
      "imposto/ICMS/ICMS61/adRemICMSRet": "1.4700",
      "imposto/ICMS/ICMS61/vICMSMonoRet": "19.11",
    });
  else
    Object.assign(f, {
      "imposto/ICMS/ICMS00/orig": "0",
      "imposto/ICMS/ICMS00/CST": "00",
      "imposto/ICMS/ICMS00/modBC": "3",
      "imposto/ICMS/ICMS00/vBC": "99.99",
      "imposto/ICMS/ICMS00/pICMS": "18.0000",
      "imposto/ICMS/ICMS00/vICMS": "99.99",
      "imposto/IBSCBS/gIBSCBS/vBC": "99.99",
      "imposto/IBSCBS/gIBSCBS/gIBSUF/pIBSUF": "0.1000",
      "imposto/IBSCBS/gIBSCBS/gIBSMun/pIBSMun": "0.0000",
      "imposto/IBSCBS/gIBSCBS/gCBS/pCBS": "0.9000",
    });
  return normalizeReferenceDocument({
    ok: true,
    documentHash: "a".repeat(64),
    issuerHash: createHash("sha256").update(issuer.CNPJ).digest("hex"),
    issuedAt: options.issuedAt,
    model: "55",
    environment: "1",
    status: "100",
    signatureVerified: true,
    certificateChainChecked: false,
    currentStatusChecked: false,
    crt: "3",
    uf: "SP",
    items: [
      {
        item: "1",
        fields: Object.entries(f).map(([path, value]) => ({ path, value })),
      },
    ],
  })[0];
}
