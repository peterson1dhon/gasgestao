import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildLabDocument,
  accessKeyDigit,
  xmlText,
  saoPauloTimestamp,
} from "../electron/fiscal/lab-document.mjs";
const issuer = {
  CNPJ: "12345678000195",
  IE: "123456789012",
  CRT: "1",
  xNome: "EMPRESA FICTICIA & TESTE",
  address: {
    xLgr: "RUA <TESTE>",
    nro: "1",
    xBairro: "CENTRO",
    cMun: "3554003",
    xMun: "Tatui",
    UF: "SP",
    CEP: "18270001",
  },
};
const options = {
  issuer,
  model: "55",
  number: 1,
  issuedAt: "2026-10-23T15:00:00-03:00",
  control: "12345678",
};
test("chave de acesso segue composicao e modulo 11, com documento fixo de homologacao", () => {
  const { key, xml, valueCents } = buildLabDocument(options);
  assert.equal(key.length, 44);
  assert.equal(key.slice(0, 6), "352610");
  assert.equal(key.slice(20, 22), "55");
  assert.equal(key.slice(22, 25), "829");
  assert.equal(key.at(-1), accessKeyDigit(key.slice(0, 43)));
  // Calculo independente, do primeiro digito para o ultimo: pesos da chave 43 posições.
  const sum = [...key.slice(0, 43)].reduce(
    (a, n, i) => a + Number(n) * [4, 3, 2, 9, 8, 7, 6, 5][i % 8],
    0,
  );
  const expected = 11 - (sum % 11) >= 10 ? 0 : 11 - (sum % 11);
  assert.equal(Number(key.at(-1)), expected);
  assert.match(xml, /<tpAmb>2<\/tpAmb>/);
  assert.match(xml, /<vNF>1.00<\/vNF>/);
  assert.equal(valueCents, 100);
});
test("documentos diferenciam modelos, destinatario de teste e QR Code v3 de homologacao", () => {
  const a = buildLabDocument(options).xml,
    b = buildLabDocument({ ...options, model: "65" }).xml;
  assert.match(a, /<dest><CNPJ>12345678000195<\/CNPJ>/);
  assert.doesNotMatch(a, /<infNFeSupl>/);
  assert.doesNotMatch(b, /<dest>/);
  assert.match(b, /qrcode\?p=\d{44}\|3\|2/);
  assert.match(b, /<tpImp>4<\/tpImp>/);
  assert.match(a, /EMPRESA FICTICIA &amp; TESTE/);
  assert.match(a, /RUA &lt;TESTE&gt;/);
});
test("entrada incorreta e caracteres XML indevidos sao rejeitados", () => {
  for (const override of [
    { model: "57" },
    { number: 0 },
    { number: 1.5 },
    { series: 900 },
    { control: "1234" },
    { issuedAt: "2026-10-23" },
    { issuedAt: "2027-01-01T12:00:00-03:00" },
    { issuer: { ...issuer, CRT: "2" } },
    { issuer: { ...issuer, address: { ...issuer.address, UF: "RJ" } } },
  ])
    assert.throws(() => buildLabDocument({ ...options, ...override }));
  assert.throws(() => xmlText("texto\u0000"));
  assert.throws(() => accessKeyDigit("123"));
  assert.equal(
    saoPauloTimestamp(new Date("2026-10-23T18:00:00Z")),
    "2026-10-23T15:00:00-03:00",
  );
});
test("CRT normal utiliza grupo CST e totais coerentes do exemplo", () => {
  const { xml } = buildLabDocument({
    ...options,
    issuer: { ...issuer, CRT: "3" },
  });
  assert.match(xml, /<CRT>3<\/CRT>/);
  assert.match(xml, /<ICMS00>/);
  assert.doesNotMatch(xml, /<CSOSN>/);
  assert.match(xml, /<ICMSTot><vBC>1.00<\/vBC><vICMS>0.18<\/vICMS>/);
  assert.match(xml, /<IBSCBS><CST>000<\/CST><cClassTrib>000001<\/cClassTrib>/);
  assert.match(xml, /<gIBSCBS><vBC>0.82<\/vBC>/);
  assert.match(xml, /<pCBS>0.9000<\/pCBS><vCBS>0.01<\/vCBS>/);
  assert.match(xml, /<vItem>1.00<\/vItem>/);
  assert.match(xml, /<vNFTot>1.00<\/vNFTot>/);
});
test("laboratorio fixa homologacao, valor, certificado da empresa e uma tentativa por chave", () => {
  const script = readFileSync(
    new URL("../electron/fiscal/homologation-lab.ps1", import.meta.url),
    "utf8",
  );
  assert.match(script, /PRODUCTION_BLOCKED/);
  assert.match(script, /LAB_TOTAL_ONLY_ONE_REAL/);
  assert.match(script, /CERTIFICATE_SELECTION/);
  assert.match(script, /FileMode\]::CreateNew/);
  assert.match(script, /PROTOCOL_DIGEST_MISMATCH/);
  assert.match(script, /SIGNATURE_REFERENCE/);
  assert.doesNotMatch(
    script,
    /ServerCertificateValidationCallback|Export-PfxCertificate|\.Export\(/,
  );
});
