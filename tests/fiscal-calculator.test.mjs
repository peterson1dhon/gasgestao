import test from "node:test";
import assert from "node:assert/strict";
import {calculateDraftFiscalSale, calculateRetainedIcms, FiscalCalculationError, RTC_2026_POLICY_ID} from "../electron/fiscal/calculator.mjs";

const waterProfile = (overrides = {}) => ({
  id:"synthetic-water-v1",approvalState:"approved",approvedBy:"revisor sintético",approvedAt:"2026-10-20T12:00:00-03:00",
  validFrom:"2026-01-01",validUntil:"2026-12-31",operation:"internal_sale_sp",uf:"SP",models:[55,65],
  ncm:"22011000",cfop:"5102",taxableFactor:"20.0000",
  taxes:{
    icms:{kind:"adValorem",cst:"00",baseRule:"adjusted",rate:"18.0000"},
    pis:{kind:"notCalculated",cst:"04"},
    cofins:{kind:"notCalculated",cst:"04"},
    ibsCbs:{kind:"standard",cst:"000",cClassTrib:"000001",baseRule:"adjustedLessIcms",ibsUfRate:"0.1000",ibsMunRate:"0.0000",cbsRate:"0.9000"},
  },...overrides,
});
const sale = (overrides = {}) => ({
  policyId:RTC_2026_POLICY_ID,issuedOn:"2026-10-24",model:55,
  items:[{id:"item-1",quantity:"1.0000",unitPrice:"100.0000000000",profile:waterProfile()}],
  discountCents:0,freightCents:0,expectedTotalCents:10000,...overrides,
});
const rejects = (input, code) => assert.throws(() => calculateDraftFiscalSale(input),
  error => error instanceof FiscalCalculationError && error.code === code);

test("água sintética reconcilia vProd, vNF e base RTC sem somar IBS/CBS ao preço de 2026", () => {
  const result=calculateDraftFiscalSale(sale());
  assert.equal(result.items[0].taxableQuantity,"20.0000");
  assert.equal(result.items[0].icms.baseCents,10000);
  assert.equal(result.totals.icmsCents,1800);
  assert.equal(result.items[0].rtc.baseCents,8200);
  assert.equal(result.totals.ibsUfCents,8);
  assert.equal(result.totals.ibsMunCents,0);
  assert.equal(result.totals.cbsCents,74);
  assert.equal(result.totals.documentCents,10000);
});

test("bases encadeadas só seguem a fórmula explicitamente aprovada no perfil sintético", () => {
  const profile=waterProfile({taxes:{
    icms:{kind:"adValorem",cst:"00",baseRule:"adjusted",rate:"18.0000"},
    pis:{kind:"adValorem",cst:"06",baseRule:"adjustedLessIcms",rate:"1.6500"},
    cofins:{kind:"adValorem",cst:"06",baseRule:"adjustedLessIcms",rate:"7.6000"},
    ibsCbs:{kind:"standard",cst:"000",cClassTrib:"000001",baseRule:"adjustedLessIcmsPisCofins",ibsUfRate:"0.1000",ibsMunRate:"0.0000",cbsRate:"0.9000"},
  }});
  const result=calculateDraftFiscalSale(sale({items:[{id:"item-1",quantity:"1.0000",unitPrice:"100.0000000000",profile}]}));
  assert.deepEqual([result.totals.pisCents,result.totals.cofinsCents,result.items[0].rtc.baseCents,
    result.totals.ibsUfCents,result.totals.cbsCents],[135,623,7442,7,67]);
});

test("dois itens, desconto e frete fecham no total original do pedido", () => {
  const two=sale({items:[
    {id:"b",quantity:"1.0000",unitPrice:"100.0000000000",profile:waterProfile()},
    {id:"a",quantity:"1.0000",unitPrice:"100.0000000000",profile:waterProfile()},
  ],discountCents:1,freightCents:2,expectedTotalCents:20001});
  const result=calculateDraftFiscalSale(two);
  assert.equal(result.totals.grossCents,20000);
  assert.equal(result.totals.discountCents,1);
  assert.equal(result.totals.freightCents,2);
  assert.equal(result.totals.documentCents,20001);
  assert.deepEqual(result.items.map(x=>x.discountCents),[0,1]);
  rejects({...two,expectedTotalCents:20000},"DOCUMENT_TOTAL_MISMATCH");
});

test("GLP calcula ICMS retido separadamente e bloqueia IBS/CBS monofásico incompleto", () => {
  assert.equal(calculateRetainedIcms({taxableQuantity:"13.0000",ratePerTaxUnit:"1.4700"}),1911);
  const glp=waterProfile({id:"synthetic-glp-v1",ncm:"27111910",cfop:"5656",taxableFactor:"13.0000",taxes:{
    icms:{kind:"retainedMono",cst:"61",ratePerTaxUnit:"1.4700"},
    pis:{kind:"notCalculated",cst:"04"},cofins:{kind:"notCalculated",cst:"04"},
    ibsCbs:{kind:"mono",cst:"620",cClassTrib:"620006"},
  }});
  rejects(sale({items:[{id:"glp",quantity:"1.0000",unitPrice:"100.0000000000",profile:glp}]}),"MONO_RTC_NOT_IMPLEMENTED");
});

test("sem aprovação, vigência, classificação ou alíquota não há prévia apta", () => {
  const withProfile = (profile) => sale({items:[{id:"item-1",quantity:"1.0000",unitPrice:"100.0000000000",profile}]});
  rejects(withProfile(waterProfile({approvalState:"draft"})),"PROFILE_NOT_APPROVED");
  rejects(withProfile(waterProfile({validUntil:"2026-06-30"})),"PROFILE_OUT_OF_DATE");
  rejects(withProfile(waterProfile({cfop:"5405"})),"PROFILE_OUT_OF_SCOPE");
  rejects(withProfile(waterProfile({taxes:{...waterProfile().taxes,ibsCbs:{kind:"standard",cst:"000",cClassTrib:"999999",baseRule:"adjusted",ibsUfRate:"0.1000",ibsMunRate:"0.0000",cbsRate:"0.9000"}}})),"UNSUPPORTED_RTC_CLASS");
  rejects(withProfile(waterProfile({taxes:{...waterProfile().taxes,ibsCbs:{...waterProfile().taxes.ibsCbs,ibsMunRate:"0.1000"}}})),"RTC_RATE_MISMATCH");
  rejects(withProfile(waterProfile({taxes:{...waterProfile().taxes,fcp:{rate:"2.0000"}}})),"UNSUPPORTED_TAX_FIELD");
  rejects(withProfile(waterProfile({taxes:{...waterProfile().taxes,icms:{kind:"adValorem",cst:"00",baseRule:"adjusted"}}})),"MISSING_TAX_RATE");
  rejects(sale({issuedOn:"2027-01-01"}),"POLICY_NOT_REVIEWED");
  rejects(sale({items:[sale().items[0],sale().items[0]],expectedTotalCents:20000}),"DUPLICATE_ITEM_ID");
});
