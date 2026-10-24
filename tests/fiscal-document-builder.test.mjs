import test from "node:test";
import assert from "node:assert/strict";
import { calculateDraftFiscalSale, RTC_2026_POLICY_ID } from "../electron/fiscal/calculator.mjs";
import { buildUnsignedWaterHomologation55 } from "../electron/fiscal/document-builder.mjs";

const address={xLgr:"RUA DE TESTE",nro:"1",xBairro:"CENTRO",cMun:"3554003",xMun:"TATUI",UF:"SP",CEP:"18270000"};
const issuer={CNPJ:"99999999000191",IE:"123456789012",CRT:"3",xNome:"EMITENTE FICTICIO",address};
const recipient={CNPJ:"88888888000182",address};
const profile={id:"agua-teste-v1",approvalState:"approved",approvedBy:"revisor sintetico",
  approvedAt:"2026-10-20T12:00:00-03:00",validFrom:"2026-01-01",validUntil:"2026-12-31",
  operation:"internal_sale_sp",uf:"SP",models:[55],ncm:"22011000",cfop:"5102",taxableFactor:"20.0000",
  taxes:{icms:{kind:"adValorem",cst:"00",baseRule:"adjusted",rate:"18.0000"},
    pis:{kind:"notCalculated",cst:"04"},cofins:{kind:"notCalculated",cst:"04"},
    ibsCbs:{kind:"standard",cst:"000",cClassTrib:"000001",baseRule:"adjustedLessIcms",
      ibsUfRate:"0.1000",ibsMunRate:"0.0000",cbsRate:"0.9000"}}};
const calculation=calculateDraftFiscalSale({policyId:RTC_2026_POLICY_ID,issuedOn:"2026-10-24",model:55,
  items:[{id:"1",quantity:"1.0000",unitPrice:"100.0000000000",profile}],
  discountCents:0,freightCents:0,expectedTotalCents:10000});
const input={issuer,recipient,calculation,products:[{code:"AGUA20",name:"AGUA 20L TESTE",unit:"UN",taxableUnit:"LT",origin:"0",profileId:profile.id}],
  number:1,series:829,issuedAt:"2026-10-24T12:00:00-03:00",control:"12345678"};
export const syntheticDocumentInput=input;

test("F04 parcial serializa o cálculo congelado e a chave sem permitir emissão",()=>{
  const result=buildUnsignedWaterHomologation55(input);
  assert.equal(result.key.length,44);
  assert.equal(result.canIssue,false);
  assert.match(result.xml,/<vBCIBSCBS>82\.00<\/vBCIBSCBS>/);
  assert.match(result.xml,/<vICMS>18\.00<\/vICMS>/);
  assert.match(result.xml,/<vCBS>0\.74<\/vCBS>/);
  assert.match(result.xml,/<vNFTot>100\.00<\/vNFTot>/);
  assert.match(result.xml,/<qTrib>20\.0000<\/qTrib>/);
  assert.match(result.xml,/<tpAmb>2<\/tpAmb>/);
});
test("F04 parcial recusa produção implícita, perfil trocado, frete e campo de imposto fora do escopo",()=>{
  assert.throws(()=>buildUnsignedWaterHomologation55({...input,products:[{...input.products[0],profileId:"outra"}]}));
  assert.throws(()=>buildUnsignedWaterHomologation55({...input,issuedAt:"2027-01-01T12:00:00-03:00"}));
  assert.throws(()=>buildUnsignedWaterHomologation55({...input,calculation:{...calculation,totals:{...calculation.totals,freightCents:1}}}));
  assert.throws(()=>buildUnsignedWaterHomologation55({...input,calculation:{...calculation,items:[{...calculation.items[0],icms:{...calculation.items[0].icms,cst:"60"}}]}}));
  assert.throws(()=>buildUnsignedWaterHomologation55({...input,calculation:{...calculation,totals:{...calculation.totals,documentCents:10001}}}));
});
