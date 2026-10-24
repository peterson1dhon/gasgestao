import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { Store } from "../electron/store.mjs";
import {
  FiscalReferences,
  normalizeReferenceDocument,
  referenceWarnings,
  previewFiscalReference,
} from "../electron/fiscal/references.mjs";
import { buildLabDocument } from "../electron/fiscal/lab-document.mjs";

function raw({
  cst = "61",
  cfop = "5656",
  name = "GLP de teste",
  item = "1",
  source = "a",
  code = "GAS",
} = {}) {
  const fields = {
    "prod/cProd": code,
    "prod/xProd": name,
    "prod/NCM": cst === "61" ? "27111910" : "22011000",
    "prod/CEST": cst === "61" ? "0601100" : "0300500",
    "prod/CFOP": cfop,
    "prod/uCom": "UN",
    "prod/qCom": "1",
    "prod/uTrib": cst === "61" ? "KG" : "LT",
    "prod/qTrib": cst === "61" ? "13" : "1",
    [`imposto/ICMS/ICMS${cst}/CST`]: cst,
    "imposto/PIS/PISNT/CST": "04",
    "imposto/COFINS/COFINSNT/CST": "04",
    "imposto/IBSCBS/CST": cst === "61" ? "620" : "000",
    "imposto/IBSCBS/cClassTrib": cst === "61" ? "620006" : "000001",
  };
  if (cst === "61") {
    fields["prod/comb/cProdANP"] = "210203001";
    fields["imposto/ICMS/ICMS61/adRemICMSRet"] = "1.4700";
    fields["imposto/ICMS/ICMS61/qBCMonoRet"] = "13";
  } else {
    fields["imposto/ICMS/ICMS00/pICMS"] = "18.0000";
    fields["imposto/IBSCBS/gIBSCBS/gIBSUF/pIBSUF"] = "0.10";
    fields["imposto/IBSCBS/gIBSCBS/gIBSMun/pIBSMun"] = "0.00";
    fields["imposto/IBSCBS/gIBSCBS/gCBS/pCBS"] = "0.90";
  }
  Object.assign(fields, {
    "ide/tpNF": "1",
    "ide/idDest": "1",
    "ide/finNFe": "1",
  });
  return {
    ok: true,
    documentHash: source.repeat(64),
    issuerHash: "b".repeat(64),
    issuedAt: "2026-10-21T12:00:00-03:00",
    model: "55",
    environment: "1",
    crt: "3",
    uf: "SP",
    status: "100",
    signatureVerified: true,
    certificateChainChecked: false,
    currentStatusChecked: false,
    items: [
      {
        item,
        fields: Object.entries(fields).map(([path, value]) => ({
          path,
          value,
        })),
      },
    ],
  };
}
test("referências preservam zeros e grupos, recusam assinatura/protocolo incompatíveis e itens repetidos", () => {
  const doc = raw();
  const [ref] = normalizeReferenceDocument(doc);
  assert.equal(ref.fields.find((f) => f.path === "prod/CEST").value, "0601100");
  assert.equal(ref.id.length, 64);
  for (const change of [
    { signatureVerified: false },
    { status: "101" },
    { model: "99" },
    { issuerHash: "" },
    { items: [doc.items[0], doc.items[0]] },
  ])
    assert.throws(() => normalizeReferenceDocument({ ...doc, ...change }));
  assert.throws(() =>
    normalizeReferenceDocument({
      ...doc,
      items: [
        { item: "1", fields: [{ path: "Signature/CNPJ", value: "123" }] },
      ],
    }),
  );
});
test("prévia calcula GLP em quilos e ICMS anterior sem acrescer imposto retido ao total", () => {
  const [ref] = normalizeReferenceDocument(raw());
  const result = previewFiscalReference(ref, {
    quantity: 2,
    unitPriceCents: 12000,
  });
  assert.deepEqual(
    [
      result.total,
      result.tributaryQuantity,
      result.retainedIcms,
      result.icms,
      result.ibs,
      result.cbs,
    ],
    ["240.00", "26.0000", "38.22", "0.00", "0.00", "0.00"],
  );
  assert.equal(result.canIssue, false);
  const basis = ref.fields.find(
    (f) => f.path === "imposto/ICMS/ICMS61/qBCMonoRet",
  );
  basis.value = "12";
  assert.equal(
    previewFiscalReference(ref, { quantity: 2, unitPriceCents: 12000 })
      .retainedIcms,
    "35.28",
  );
  basis.value = "13";
  assert.throws(() =>
    previewFiscalReference(
      { ...ref, issuedAt: "2025-10-21T12:00:00-03:00" },
      { quantity: 1, unitPriceCents: 100 },
    ),
  );
  assert.throws(() =>
    previewFiscalReference(
      { ...ref, crt: "1" },
      { quantity: 1, unitPriceCents: 100 },
    ),
  );
  assert.throws(() =>
    previewFiscalReference(ref, { quantity: 1.5, unitPriceCents: 1 }),
  );
});
test("prévia separa água tributada e ST, arredonda valores em centavos e sinaliza divergências", () => {
  const [normal] = normalizeReferenceDocument(
    raw({ cst: "00", cfop: "5102", name: "ÁGUA 20L", code: "AGUA" }),
  );
  const [st] = normalizeReferenceDocument(
    raw({
      cst: "60",
      cfop: "5405",
      name: "ÁGUA 20L",
      code: "AGUA",
      source: "c",
    }),
  );
  const a = previewFiscalReference(normal, {
    quantity: 26,
    unitPriceCents: 900,
  });
  assert.deepEqual(
    [a.total, a.icms, a.ibs, a.cbs],
    ["234.00", "42.12", "0.19", "1.73"],
  );
  const b = previewFiscalReference(st, { quantity: 4, unitPriceCents: 1700 });
  assert.deepEqual(
    [b.total, b.icms, b.ibs, b.cbs],
    ["68.00", "0.00", "0.07", "0.61"],
  );
  const warnings = referenceWarnings(st, [normal, st]);
  assert.ok(warnings.some((w) => w.includes("códigos tributários diferentes")));
  assert.ok(warnings.some((w) => w.includes("CEST")));
  assert.ok(warnings.some((w) => w.includes("Portaria SRE 9/2026")));
  assert.ok(warnings.some((w) => w.includes("quantidade tributável")));
  normal.fields.find((f) => f.path === "imposto/ICMS/ICMS00/CST").value = "20";
  assert.throws(() =>
    previewFiscalReference(normal, { quantity: 1, unitPriceCents: 100 }),
  );
});
test("importação é idempotente, preserva variantes, vínculo não muda vendas e backup mantém catálogo", async () => {
  mkdirSync(resolve(".test-artifacts"), { recursive: true });
  const dir = mkdtempSync(resolve(".test-artifacts/fiscal-reference-store-")),
    file = join(dir, "state.sqlite");
  let store = new Store(file),
    refs = new FiscalReferences(store);
  const before = store.getState();
  const doc = normalizeReferenceDocument(raw());
  const reader = async () => doc;
  assert.equal((await refs.importFiles(["test.xml"], reader)).added, 1);
  assert.equal((await refs.importFiles(["test.xml"], reader)).added, 0);
  assert.deepEqual(store.getState(), before);
  const productId = store.saveProduct({
    name: "Produto de teste",
    price_cents: 12000,
    cost_cents: 1,
    min_stock: 0,
  });
  refs.link({ id: doc[0].id, productId });
  assert.equal(refs.list().references[0].productId, productId);
  assert.equal(refs.list().canIssue, false);
  assert.throws(() => refs.link({ id: doc[0].id, productId: 99999 }));
  assert.equal(store.db.prepare("PRAGMA user_version").get().user_version, 6);
  store.backupTo(join(dir, "backup.sqlite"));
  store.close();
  store = new Store(join(dir, "backup.sqlite"));
  refs = new FiscalReferences(store);
  assert.equal(refs.list().references.length, 1);
  assert.equal(refs.list().references[0].productId, productId);
  store.close();
});
test("migração de banco anterior mantém pedidos e catálogo começa vazio", () => {
  const store = new Store(":memory:");
  store.db.exec("DROP TABLE fiscal_references; PRAGMA user_version=4");
  mkdirSync(resolve(".test-artifacts"), { recursive: true });
  const dir = mkdtempSync(
    resolve(".test-artifacts/fiscal-reference-migration-"),
  );
  const path = join(dir, "old.sqlite");
  store.backupTo(path);
  store.close();
  const migrated = new Store(path);
  assert.equal(new FiscalReferences(migrated).list().references.length, 0);
  assert.equal(
    migrated.db.prepare("PRAGMA user_version").get().user_version,
    6,
  );
  migrated.close();
});
test(
  "leitor real verifica XML assinado, preserva bytes e rejeita adulteração e DTD",
  { skip: process.platform !== "win32" },
  async () => {
    mkdirSync(resolve(".test-artifacts"), { recursive: true });
    const dir = mkdtempSync(resolve(".test-artifacts/fiscal-reference-xml-"));
    const issuer = {
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
        CEP: "18270000",
      },
    };
    const invoice = buildLabDocument({
      issuer,
      model: "55",
      number: 1,
      control: "12345678",
      issuedAt: "2026-10-23T12:00:00-03:00",
    });
    const unsigned = join(dir, "unsigned.xml"),
      signed = join(dir, "signed.xml");
    writeFileSync(unsigned, invoice.xml);
    const ps = String.raw`
param([string]$InputFile,[string]$OutputFile)
Add-Type -AssemblyName System.Security
$doc=New-Object Xml.XmlDocument; $doc.PreserveWhitespace=$true; $doc.Load($InputFile)
$rsa=New-Object Security.Cryptography.RSACryptoServiceProvider(2048); $rsa.PersistKeyInCsp=$false
try {
 $sx=New-Object Security.Cryptography.Xml.SignedXml($doc); $sx.SigningKey=$rsa
 $sx.SignedInfo.CanonicalizationMethod='http://www.w3.org/TR/2001/REC-xml-c14n-20010315'; $sx.SignedInfo.SignatureMethod='http://www.w3.org/2000/09/xmldsig#rsa-sha1'
 $ref=New-Object Security.Cryptography.Xml.Reference; $ref.Uri='#'+$doc.DocumentElement.infNFe.Id; $ref.DigestMethod='http://www.w3.org/2000/09/xmldsig#sha1'
 $ref.AddTransform((New-Object Security.Cryptography.Xml.XmlDsigEnvelopedSignatureTransform)); $ref.AddTransform((New-Object Security.Cryptography.Xml.XmlDsigC14NTransform)); $sx.AddReference($ref)
 $ki=New-Object Security.Cryptography.Xml.KeyInfo; $ki.AddClause((New-Object Security.Cryptography.Xml.RSAKeyValue($rsa))); $sx.KeyInfo=$ki; $sx.ComputeSignature()
 [void]$doc.DocumentElement.AppendChild($doc.ImportNode($sx.GetXml(),$true))
 $digest=[Convert]::ToBase64String($ref.DigestValue); $key=$doc.DocumentElement.infNFe.Id.Substring(3)
 $xml='<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">'+$doc.DocumentElement.OuterXml+'<protNFe versao="4.00"><infProt><tpAmb>2</tpAmb><chNFe>'+$key+'</chNFe><digVal>'+$digest+'</digVal><cStat>100</cStat></infProt></protNFe></nfeProc>'
 [IO.File]::WriteAllText($OutputFile,$xml,(New-Object Text.UTF8Encoding($false)))
} finally {$rsa.Dispose()}
`;
    const signScript = join(dir, "sign.ps1");
    writeFileSync(signScript, ps);
    const powershell = join(
      process.env.SystemRoot,
      "System32/WindowsPowerShell/v1.0/powershell.exe",
    );
    execFileSync(
      powershell,
      [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        signScript,
        "-InputFile",
        unsigned,
        "-OutputFile",
        signed,
      ],
      { windowsHide: true },
    );
    const { readReferenceFile } = await import(
      "../electron/fiscal/references.mjs"
    );
    const bytes = readFileSync(signed),
      refs = await readReferenceFile(signed);
    assert.equal(refs.length, 1);
    assert.equal(refs[0].signatureVerified, true);
    assert.deepEqual(readFileSync(signed), bytes);
    const altered = join(dir, "altered.xml");
    writeFileSync(
      altered,
      bytes.toString().replace("<NCM>22021000</NCM>", "<NCM>27111910</NCM>"),
    );
    await assert.rejects(() => readReferenceFile(altered));
    const dtd = join(dir, "dtd.xml");
    writeFileSync(
      dtd,
      '<!DOCTYPE nfeProc [<!ENTITY probe SYSTEM "file:///C:/Windows/win.ini">]><nfeProc>&probe;</nfeProc>',
    );
    await assert.rejects(() => readReferenceFile(dtd));
  },
);
