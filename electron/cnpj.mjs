// Regra de DV conferida na documentação técnica da Receita Federal.
// https://www.gov.br/receitafederal/pt-br/centrais-de-conteudo/publicacoes/documentos-tecnicos/cnpj
export const normalizeCnpj = (value) =>
  String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/[./-]/g, "");
export function validCnpj(value) {
  const cnpj = normalizeCnpj(value);
  if (!/^[A-Z0-9]{12}\d{2}$/.test(cnpj) || /^0{14}$/.test(cnpj)) return false;
  const digit = (base) => {
    let sum = 0,
      weight = 2;
    for (let i = base.length - 1; i >= 0; i--) {
      sum += (base.charCodeAt(i) - 48) * weight;
      weight = weight === 9 ? 2 : weight + 1;
    }
    const remainder = sum % 11;
    return String(remainder < 2 ? 0 : 11 - remainder);
  };
  const base = cnpj.slice(0, 12),
    first = digit(base);
  return cnpj.slice(12) === first + digit(base + first);
}
