// Remove caracteres invisíveis de textos colados sem alterar os cadastros.
const normalize = (value) =>
  String(value ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}|\p{Cf}/gu, "")
    .replace(/\s+/gu, " ")
    .trim()
    .toLowerCase();
export function contains(value, search) {
  const query = normalize(search),
    haystack = normalize(value);
  if (!query || haystack.includes(query)) return true;
  const document = query.replace(/[./-]/g, "");
  if (
    /^[a-z\d./-]+$/.test(query) &&
    /^[a-z\d]{12}\d{2}$/.test(document) &&
    haystack.replace(/[^a-z\d]/g, "").includes(document)
  )
    return true;
  // Aceita a máscara de telefone/CEP colada de outros aplicativos.
  const digits = query.replace(/\D/g, "");
  return (
    /^[+\d\s()./\-]+$/.test(query) &&
    digits.length >= 5 &&
    haystack.replace(/\D/g, "").includes(digits)
  );
}
