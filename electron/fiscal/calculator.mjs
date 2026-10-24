// Prévia fiscal pura. Nenhuma regra tributária é inferida de um XML antigo:
// vigência, bases, códigos e alíquotas devem constar de perfil aprovado.
// A saída é cálculo, não autorização para assinar ou transmitir documento.
import {
  adRemCents,
  allocateOrderAdjustments,
  convertTribQuantity,
  lineTotalCents,
  percentCents,
  unitTribPrice,
} from "./decimal.mjs";

export const RTC_2026_POLICY_ID = "SP-RTC-2026-NT2025.002-v1.52";

export class FiscalCalculationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "FiscalCalculationError";
    this.code = code;
  }
}
const fail = (code, message) => { throw new FiscalCalculationError(code, message); };
const intCents = (value, label) => {
  if (!Number.isSafeInteger(value) || value < 0) fail("INVALID_CENTS", `${label} deve ser centavos inteiros seguros.`);
  return value;
};
const sumCents = (items, field) => {
  const sum = items.reduce((total, item) => total + BigInt(item[field]), 0n);
  if (sum > BigInt(Number.MAX_SAFE_INTEGER)) fail("TOTAL_OVERFLOW", `Total ${field} excede a faixa segura.`);
  return Number(sum);
};
const code = (value, pattern, label) => {
  if (typeof value !== "string" || !pattern.test(value)) fail("INVALID_FISCAL_CODE", `${label} ausente ou inválido.`);
  return value;
};
const onlyKeys = (value, allowed, label) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("INVALID_TAX_SPEC", `${label} deve ser um objeto fiscal estruturado.`);
  }
  const unexpected = Object.keys(value).filter(key => !allowed.includes(key));
  if (unexpected.length) fail("UNSUPPORTED_TAX_FIELD", `${label} contém campo fiscal não suportado: ${unexpected.join(", ")}.`);
};
const checkedDate = (value, label) => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) fail("INVALID_DATE", `${label} inválida.`);
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day) {
    fail("INVALID_DATE", `${label} inválida.`);
  }
  return value;
};

// Estes nomes descrevem contas matemáticas, não sua aplicabilidade legal.
// O responsável tributário precisa escolher a base correta por SKU/operação.
const baseFor = (rule, adjustedCents, taxes) => {
  let base;
  if (rule === "adjusted") base = adjustedCents;
  else if (rule === "adjustedLessIcms") base = adjustedCents - taxes.icmsCents;
  else if (rule === "adjustedLessIcmsPisCofins") {
    base = adjustedCents - taxes.icmsCents - taxes.pisCents - taxes.cofinsCents;
  } else fail("UNSUPPORTED_BASE_RULE", "Regra de base tributária desconhecida.");
  if (base < 0) fail("NEGATIVE_TAX_BASE", "Base tributária negativa; revise o perfil e os valores.");
  return base;
};

const calculateOrdinaryTax = (name, spec, adjustedCents, taxes) => {
  if (!spec || typeof spec !== "object") fail("MISSING_TAX_SPEC", `Regra ${name} ausente.`);
  onlyKeys(spec, ["kind","cst","baseRule","rate"], name);
  const cst = code(spec.cst, /^\d{2}$/, `CST ${name}`);
  if (name === "ICMS" && !(spec.kind === "adValorem" && cst === "00")) {
    fail("UNSUPPORTED_ICMS_CLASS", "Neste cálculo ICMS ordinário exige CST 00 e alíquota explícita.");
  }
  if (name !== "ICMS" && !(
    (spec.kind === "notCalculated" && cst === "04") ||
    (spec.kind === "adValorem" && cst === "06")
  )) fail("UNSUPPORTED_CONTRIBUTION_CLASS", `${name} exige CST 04 sem cálculo ou CST 06 com alíquota explícita.`);
  if (spec.kind === "notCalculated") {
    if (spec.rate !== undefined || spec.baseRule !== undefined) {
      fail("CONTRADICTORY_TAX_SPEC", `${name} sem cálculo não pode carregar alíquota/base.`);
    }
    return {kind: spec.kind, cst, baseCents: 0, amountCents: 0};
  }
  if (spec.kind !== "adValorem") fail("UNSUPPORTED_TAX_KIND", `Regra ${name} não suportada.`);
  if (typeof spec.rate !== "string") fail("MISSING_TAX_RATE", `Alíquota ${name} ausente.`);
  const baseCents = baseFor(spec.baseRule, adjustedCents, taxes);
  const amountCents = percentCents(baseCents, spec.rate);
  return {kind: spec.kind, cst, baseCents, rate: spec.rate, amountCents};
};

export function calculateRetainedIcms({taxableQuantity, ratePerTaxUnit}) {
  return adRemCents(taxableQuantity, ratePerTaxUnit);
}

function calculateDraftFiscalSaleInternal({items, discountCents, freightCents, expectedTotalCents, issuedOn, model, policyId}) {
  checkedDate(issuedOn, "Data da emissão");
  if (issuedOn < "2026-01-01" || issuedOn >= "2027-01-01" || policyId !== RTC_2026_POLICY_ID) {
    fail("POLICY_NOT_REVIEWED", "Não há política calculada para esta data e versão.");
  }
  if (![55, 65].includes(model)) fail("UNSUPPORTED_MODEL", "Modelo fiscal não suportado.");
  if (!Array.isArray(items) || items.length === 0) fail("EMPTY_ITEMS", "Venda sem itens.");
  const itemIds = items.map(item => item?.id);
  if (new Set(itemIds).size !== itemIds.length) fail("DUPLICATE_ITEM_ID", "Pedido contém item fiscal repetido.");
  intCents(discountCents, "Desconto");
  intCents(freightCents, "Frete");
  intCents(expectedTotalCents, "Total do pedido");

  const grossItems = items.map((item) => {
    if (!item || typeof item.id !== "string" || !item.id) fail("INVALID_ITEM", "Item sem identidade estável.");
    const profile = item.profile;
    if (!profile || profile.approvalState !== "approved" || !profile.approvedBy || !profile.approvedAt) {
      fail("PROFILE_NOT_APPROVED", `Perfil do item ${item.id} não foi aprovado.`);
    }
    if (profile.operation !== "internal_sale_sp" || profile.uf !== "SP" || !Array.isArray(profile.models) || !profile.models.includes(model)) {
      fail("PROFILE_OUT_OF_SCOPE", `Perfil do item ${item.id} não cobre esta operação/modelo.`);
    }
    if (checkedDate(profile.validFrom, "Início da vigência") > issuedOn ||
      (profile.validUntil && checkedDate(profile.validUntil, "Fim da vigência") < issuedOn)) {
      fail("PROFILE_OUT_OF_DATE", `Perfil do item ${item.id} fora da vigência.`);
    }
    code(profile.ncm, /^\d{8}$/, "NCM");
    code(profile.cfop, /^\d{4}$/, "CFOP");
    if (typeof profile.id !== "string" || !profile.id) fail("PROFILE_ID_MISSING", "Perfil sem versão identificada.");
    const grossCents = lineTotalCents(item.quantity, item.unitPrice);
    const taxableQuantity = convertTribQuantity(item.quantity, profile.taxableFactor);
    const taxableUnitPrice = unitTribPrice({taxableQuantity, commercialTotalCents: grossCents});
    return {id: item.id, quantity: item.quantity, unitPrice: item.unitPrice,
      taxableQuantity, taxableUnitPrice, grossCents, profile};
  });
  const allocations = allocateOrderAdjustments(grossItems, discountCents, freightCents);
  const byId = new Map(allocations.map(row => [row.id, row]));

  const calculated = grossItems.map((item) => {
    const adjustment = byId.get(item.id);
    const adjustedCents = adjustment.adjustedCents;
    const spec = item.profile.taxes;
    if (!spec || typeof spec !== "object") fail("MISSING_TAX_SPEC", `Impostos do item ${item.id} ausentes.`);
    onlyKeys(spec, ["icms","pis","cofins","ibsCbs"], "Impostos do produto");
    const taxes = {icmsCents: 0, retainedIcmsCents: 0, pisCents: 0, cofinsCents: 0};
    let icms;
    if (spec.icms?.kind === "retainedMono") {
      onlyKeys(spec.icms, ["kind","cst","ratePerTaxUnit"], "ICMS retido");
      if (spec.icms.cst !== "61") fail("ICMS_CLASS_MISMATCH", "ICMS retido monofásico exige CST 61 neste escopo.");
      if (item.profile.cfop !== "5656" || item.profile.ncm !== "27111910") {
        fail("PROFILE_OUT_OF_SCOPE", "ICMS 61 retido só está mapeado para GLP/5656 neste estudo.");
      }
      taxes.retainedIcmsCents = calculateRetainedIcms({taxableQuantity:item.taxableQuantity,ratePerTaxUnit:spec.icms.ratePerTaxUnit});
      icms = {kind:"retainedMono",cst:"61",taxableQuantity:item.taxableQuantity,
        ratePerTaxUnit:spec.icms.ratePerTaxUnit,retainedCents:taxes.retainedIcmsCents};
    } else {
      if (item.profile.cfop !== "5102" || item.profile.ncm !== "22011000") {
        fail("PROFILE_OUT_OF_SCOPE", "Tributação ordinária só está mapeada para água/5102 neste estudo.");
      }
      icms = calculateOrdinaryTax("ICMS", spec.icms, adjustedCents, taxes);
      taxes.icmsCents = icms.amountCents;
    }
    const pis = calculateOrdinaryTax("PIS", spec.pis, adjustedCents, taxes);
    taxes.pisCents = pis.amountCents;
    const cofins = calculateOrdinaryTax("COFINS", spec.cofins, adjustedCents, taxes);
    taxes.cofinsCents = cofins.amountCents;

    const ibsCbs = spec.ibsCbs;
    if (!ibsCbs || typeof ibsCbs !== "object") fail("MISSING_RTC_SPEC", "Regra IBS/CBS ausente.");
    onlyKeys(ibsCbs, ["kind","cst","cClassTrib","baseRule","ibsUfRate","ibsMunRate","cbsRate"], "IBS/CBS");
    if (ibsCbs.cst === "620" || ibsCbs.cClassTrib === "620006" || ibsCbs.kind === "mono") {
      fail("MONO_RTC_NOT_IMPLEMENTED", "IBS/CBS monofásico ainda exige implementação e revisão fiscal específica.");
    }
    if (ibsCbs.kind !== "standard" || ibsCbs.cst !== "000" || ibsCbs.cClassTrib !== "000001") {
      fail("UNSUPPORTED_RTC_CLASS", "Classe IBS/CBS não suportada por este cálculo.");
    }
    if (typeof ibsCbs.ibsUfRate !== "string" || typeof ibsCbs.ibsMunRate !== "string" || typeof ibsCbs.cbsRate !== "string") {
      fail("MISSING_TAX_RATE", "Alíquota IBS/CBS ausente.");
    }
    // CST 000/cClass 000001 no exercício 2026; outras reduções/classes
    // exigem um perfil e uma política novos. A fonte fica no manifesto 1.52.
    if (ibsCbs.ibsUfRate !== "0.1000" || ibsCbs.ibsMunRate !== "0.0000" || ibsCbs.cbsRate !== "0.9000") {
      fail("RTC_RATE_MISMATCH", "Alíquotas IBS/CBS não correspondem à política padrão 2026 deste cálculo.");
    }
    const baseCents = baseFor(ibsCbs.baseRule, adjustedCents, taxes);
    const ibsUfCents = percentCents(baseCents, ibsCbs.ibsUfRate);
    const ibsMunCents = percentCents(baseCents, ibsCbs.ibsMunRate);
    const cbsCents = percentCents(baseCents, ibsCbs.cbsRate);
    const rtc = {kind:"standard",cst:"000",cClassTrib:"000001",baseCents,
      ibsUfRate:ibsCbs.ibsUfRate,ibsUfCents,ibsMunRate:ibsCbs.ibsMunRate,
      ibsMunCents,cbsRate:ibsCbs.cbsRate,cbsCents};
    return {id:item.id,quantity:item.quantity,unitPrice:item.unitPrice,
      taxableQuantity:item.taxableQuantity,taxableUnitPrice:item.taxableUnitPrice,
      grossCents:item.grossCents,discountCents:adjustment.discountCents,
      freightCents:adjustment.freightCents,adjustedCents,
      profileId:item.profile.id,icms,pis,cofins,rtc,
      icmsCents:taxes.icmsCents,retainedIcmsCents:taxes.retainedIcmsCents,
      pisCents:taxes.pisCents,cofinsCents:taxes.cofinsCents,ibsUfCents,ibsMunCents,cbsCents};
  });
  const totals = {
    grossCents:sumCents(calculated,"grossCents"),
    discountCents:sumCents(calculated,"discountCents"),
    freightCents:sumCents(calculated,"freightCents"),
    documentCents:sumCents(calculated,"adjustedCents"),
    icmsCents:sumCents(calculated,"icmsCents"),
    retainedIcmsCents:sumCents(calculated,"retainedIcmsCents"),
    pisCents:sumCents(calculated,"pisCents"),
    cofinsCents:sumCents(calculated,"cofinsCents"),
    ibsUfCents:sumCents(calculated,"ibsUfCents"),
    ibsMunCents:sumCents(calculated,"ibsMunCents"),
    cbsCents:sumCents(calculated,"cbsCents"),
  };
  if (totals.documentCents !== expectedTotalCents ||
      totals.grossCents - totals.discountCents + totals.freightCents !== totals.documentCents) {
    fail("DOCUMENT_TOTAL_MISMATCH", "Totais fiscais não conciliam com o pedido congelado.");
  }
  return {policyId,issuedOn,model,items:calculated,totals};
}

export function calculateDraftFiscalSale(input) {
  try {
    return calculateDraftFiscalSaleInternal(input);
  } catch (error) {
    if (error instanceof FiscalCalculationError) throw error;
    if (error instanceof TypeError || error instanceof RangeError) {
      throw new FiscalCalculationError("INVALID_CALCULATION_INPUT", "Dados numéricos fiscais inválidos ou fora da precisão permitida.");
    }
    throw error;
  }
}
