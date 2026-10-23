import { DatabaseSync } from "node:sqlite";
import { existsSync } from "node:fs";
import { ValidationError } from "./store.mjs";

export function postalCode(value) {
  if (typeof value !== "string" || !/^\d{5}-?\d{3}$/.test(value.trim()))
    throw new ValidationError("Informe um CEP com 8 dígitos.");
  return value.trim().replace("-", "");
}
export function lookupPostal(filename, value) {
  const cep = postalCode(value);
  if (!existsSync(filename))
    throw new ValidationError(
      "Base de CEP offline não instalada neste computador. Preencha o endereço manualmente.",
    );
  const db = new DatabaseSync(filename, { readOnly: true });
  try {
    const addresses = db
      .prepare(
        "SELECT DISTINCT cep,street,neighborhood,city,uf FROM addresses WHERE cep=? ORDER BY city,street,neighborhood LIMIT 100",
      )
      .all(cep);
    return { addresses, offline: true };
  } finally {
    db.close();
  }
}
