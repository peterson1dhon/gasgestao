import test from "node:test";
import assert from "node:assert/strict";
import { buildReferenceLabDocument } from "../electron/fiscal/reference-lab-document.mjs";
import { options, referenceFixture } from "./helpers/fiscal-reference.mjs";
const generate = (ref) =>
  buildReferenceLabDocument({ ...options, reference: ref });
const set = (r, path, value) => {
  r.fields.find((f) => f.path === path).value = value;
};
test("XML GLP mantém base monofásica independente, ANP e total fixo de homologação", () => {
  const r = referenceFixture(),
    d = generate(r);
  assert.equal(d.environment, "homologacao");
  assert.equal(d.valueCents, 100);
  assert.equal(d.canIssue, false);
  assert.match(
    d.xml,
    /<qTrib>13.0000<\/qTrib><vUnTrib>0.0769230769<\/vUnTrib>/,
  );
  assert.match(
    d.xml,
    /<qBCMonoRet>13.0000<\/qBCMonoRet><adRemICMSRet>1.4700<\/adRemICMSRet><vICMSMonoRet>19.11<\/vICMSMonoRet>/,
  );
  assert.match(
    d.xml,
    /<qBCMonoRet>13.00<\/qBCMonoRet><vICMSMonoRet>19.11<\/vICMSMonoRet>/,
  );
  assert.match(d.xml, /<cProdANP>210203001<\/cProdANP>/);
  assert.match(d.xml, /<vPart>2.50<\/vPart>/);
  assert.match(d.xml, /<vNF>1.00<\/vNF>/);
  assert.match(d.xml, /<tpAmb>2<\/tpAmb>/);
  assert.doesNotMatch(d.xml, /<vICMSMonoRet>0.00/);
  set(r, "imposto/ICMS/ICMS61/qBCMonoRet", "12");
  assert.match(
    generate(r).xml,
    /<qBCMonoRet>12.0000<\/qBCMonoRet><adRemICMSRet>1.4700<\/adRemICMSRet><vICMSMonoRet>17.64<\/vICMSMonoRet>/,
  );
});
test("água recalcula tributos e valor unitário tributável sem reutilizar valores da nota original", () => {
  const d = generate(referenceFixture(false));
  assert.match(
    d.xml,
    /<qTrib>20.0000<\/qTrib><vUnTrib>0.0500000000<\/vUnTrib>/,
  );
  assert.match(
    d.xml,
    /<vBC>1.00<\/vBC><pICMS>18.0000<\/pICMS><vICMS>0.18<\/vICMS>/,
  );
  assert.match(d.xml, /<gIBSCBS><vBC>0.82<\/vBC>/);
  assert.match(d.xml, /<vCBS>0.01<\/vCBS>/);
  assert.doesNotMatch(d.xml, /99.99|<comb>|<ICMS60>/);
  assert.equal(
    d.warnings.some((w) => w.includes("CEST")),
    true,
  );
  const n = buildReferenceLabDocument({
    ...options,
    model: "65",
    reference: referenceFixture(false),
  });
  assert.match(n.xml, /qrcode\?p=\d{44}\|3\|2/);
  assert.doesNotMatch(n.xml, /<dest>/);
});
test("enquadramento estranho, ST, grupos não implementados e dados incompletos são bloqueados", () => {
  for (const mutate of [
    (r) => {
      r.issuerHash = "b".repeat(64);
    },
    (r) => {
      r.signatureVerified = false;
    },
    (r) => {
      r.crt = "1";
    },
    (r) => {
      r.uf = "RJ";
    },
    (r) => set(r, "prod/CFOP", "6656"),
    (r) => set(r, "imposto/IBSCBS/cClassTrib", "620004"),
    (r) => set(r, "prod/comb/pGLP", "90"),
    (r) => set(r, "prod/comb/origComb/pOrig", "80"),
    (r) => set(r, "prod/uTrib", "LT"),
    (r) => r.fields.push({ path: "imposto/IPI/IPITrib/CST", value: "50" }),
    (r) => r.fields.push({ path: "prod/comb/origComb/cUFOrig", value: "33" }),
    (r) => {
      r.fields = r.fields.filter((f) => f.path !== "prod/comb/descANP");
    },
  ]) {
    const r = referenceFixture();
    mutate(r);
    assert.throws(() => generate(r));
  }
  const water = referenceFixture(false);
  set(water, "prod/CFOP", "5405");
  assert.throws(() => generate(water), /Água com ST/);
  const rate = referenceFixture(false);
  set(rate, "imposto/ICMS/ICMS00/pICMS", "101");
  assert.throws(() => generate(rate));
  assert.throws(() =>
    buildReferenceLabDocument({
      ...options,
      issuedAt: "2027-01-01T12:00:00-03:00",
      reference: referenceFixture(),
    }),
  );
});
test("geração não altera a referência e escapa textos controlados de combustível", () => {
  const r = referenceFixture();
  set(r, "prod/comb/descANP", "GLP & TESTE <X>");
  const original = JSON.stringify(r);
  const d = generate(r);
  assert.equal(JSON.stringify(r), original);
  assert.match(d.xml, /<descANP>GLP &amp; TESTE &lt;X&gt;<\/descANP>/);
  r.fields.push({ path: "imposto/vTotTrib", value: "99.99" });
  assert.doesNotMatch(generate(r).xml, /<vTotTrib>/);
  assert.ok(generate(r).warnings.some((w) => w.includes("IBPT")));
});
