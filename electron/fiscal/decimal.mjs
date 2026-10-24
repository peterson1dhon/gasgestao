// Aritmética fiscal pura. Nenhum valor monetário passa por ponto flutuante.
// Entrada decimal textual, saída de dinheiro em centavos inteiros seguros.

const pow10 = (scale) => 10n ** BigInt(scale);
const cents = (value, name) => {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`${name} deve ser centavos inteiros não negativos.`);
  return BigInt(value);
};
const safeNumber = (value) => {
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < 0n) throw new RangeError("Valor em centavos excede a faixa segura.");
  return Number(value);
};
const roundHalfUp = (numerator, denominator) => {
  if (denominator <= 0n || numerator < 0n) throw new RangeError("Divisão fiscal inválida.");
  return (numerator * 2n + denominator) / (2n * denominator);
};

export function parseDecimal(value, scale, name = "valor") {
  if (!Number.isInteger(scale) || scale < 0 || scale > 10) throw new RangeError("Escala decimal inválida.");
  if (typeof value !== "string" || value.length > 32 || !/^(0|[1-9]\d*)(?:\.(\d+))?$/.test(value)) {
    throw new TypeError(`${name} deve ser decimal textual canônico não negativo.`);
  }
  const [whole, fraction = ""] = value.split(".");
  if (fraction.length > scale) throw new RangeError(`${name} excede ${scale} casas decimais.`);
  return BigInt(whole) * pow10(scale) + BigInt((fraction || "").padEnd(scale, "0") || "0");
}

export function formatDecimal(value, scale) {
  if (typeof value !== "bigint" || value < 0n || !Number.isInteger(scale) || scale < 0 || scale > 10) {
    throw new TypeError("Decimal escalado inválido.");
  }
  const unit = pow10(scale);
  return scale ? `${value / unit}.${String(value % unit).padStart(scale, "0")}` : String(value);
}

export function lineTotalCents(quantity, unitPrice) {
  const q = parseDecimal(quantity, 4, "quantidade");
  const price = parseDecimal(unitPrice, 10, "preço unitário");
  if (q === 0n) throw new RangeError("Quantidade fiscal deve ser positiva.");
  return safeNumber(roundHalfUp(q * price, pow10(12)));
}

export function percentCents(baseCents, percent) {
  const base = cents(baseCents, "base");
  const rate = parseDecimal(percent, 4, "alíquota percentual");
  return safeNumber(roundHalfUp(base * rate, pow10(6)));
}

export function adRemCents(quantity, ratePerUnit) {
  const q = parseDecimal(quantity, 4, "quantidade tributável");
  const rate = parseDecimal(ratePerUnit, 4, "alíquota por unidade");
  return safeNumber(roundHalfUp(q * rate, pow10(6)));
}

// Método dos maiores restos. IDs estáveis definem o desempate; a ordem de
// apresentação não altera a distribuição. Peso zero nunca recebe parcela.
export function allocateCents(totalCents, entries) {
  const total = cents(totalCents, "total a ratear");
  if (!Array.isArray(entries) || entries.length === 0) throw new TypeError("Itens de rateio ausentes.");
  const seen = new Set();
  const rows = entries.map((entry, index) => {
    if (!entry || typeof entry.id !== "string" || !entry.id || seen.has(entry.id)) {
      throw new TypeError("IDs de item inválidos ou repetidos.");
    }
    seen.add(entry.id);
    return {id: entry.id, index, weight: cents(entry.weightCents, "peso do item"), share: 0n, remainder: 0n};
  });
  const weightTotal = rows.reduce((sum, row) => sum + row.weight, 0n);
  if (weightTotal === 0n) {
    if (total !== 0n) throw new RangeError("Não há base positiva para rateio.");
    return rows.map(row => ({id: row.id, cents: 0}));
  }
  let assigned = 0n;
  for (const row of rows) {
    const numerator = total * row.weight;
    row.share = numerator / weightTotal;
    row.remainder = numerator % weightTotal;
    assigned += row.share;
  }
  const ranked = rows.filter(row => row.weight > 0n).sort((a,b) =>
    a.remainder === b.remainder ? (a.id < b.id ? -1 : 1) : (a.remainder > b.remainder ? -1 : 1));
  for (let i = 0; i < Number(total - assigned); i++) ranked[i].share++;
  return rows.sort((a,b) => a.index - b.index).map(row => ({id: row.id, cents: safeNumber(row.share)}));
}

// O rateio operacional não presume quais parcelas entram em cada base de
// tributo. O perfil aprovado e a operação definirão isso no calculator.mjs.
export function allocateOrderAdjustments(items, discountCents, freightCents) {
  if (!Array.isArray(items) || items.length === 0) throw new TypeError("Pedido sem itens.");
  const weights = items.map(item => ({id: item.id, weightCents: item.grossCents}));
  const gross = weights.reduce((sum,item) => sum + cents(item.weightCents,"valor bruto"),0n);
  const discount = cents(discountCents,"desconto");
  const freight = cents(freightCents,"frete");
  if (discount > gross) throw new RangeError("Desconto maior que o valor bruto.");
  const discounts = new Map(allocateCents(discountCents,weights).map(item => [item.id,item.cents]));
  const freights = new Map(allocateCents(freightCents,weights).map(item => [item.id,item.cents]));
  const result = items.map(item => {
    const partDiscount = BigInt(discounts.get(item.id));
    const partFreight = BigInt(freights.get(item.id));
    const itemGross = cents(item.grossCents,"valor bruto");
    if (partDiscount > itemGross) throw new RangeError("Desconto de item maior que o valor bruto.");
    return {id:item.id,grossCents:item.grossCents,discountCents:Number(partDiscount),freightCents:Number(partFreight),adjustedCents:safeNumber(itemGross-partDiscount+partFreight)};
  });
  const adjustedTotal = gross - discount + freight;
  safeNumber(adjustedTotal);
  if (result.reduce((sum,item) => sum + BigInt(item.adjustedCents),0n) !== adjustedTotal) {
    throw new Error("Falha de reconciliação do rateio.");
  }
  return result;
}
