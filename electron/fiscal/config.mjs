/**
 * Configuração do emissor fiscal: persistência e leitura via FiscalRepository.
 *
 * Regras:
 * - CNPJ, IE, CRT e endereço fiscal estruturado são obrigatórios para habilitar emissão.
 * - Código IBGE do município (7 dígitos) é distinto do CEP.
 * - Certificado é identificado somente pelo thumbprint; a chave privada NÃO é exportada.
 * - Produção começa bloqueada (production_enabled = 0) e só é habilitada explicitamente.
 * - Nenhum dado real da empresa vai para o código-fonte ou para o Git.
 */

import { randomUUID } from "node:crypto";
import { validCnpj, normalizeCnpj } from "../cnpj.mjs";

export class ConfigValidationError extends Error {
  constructor(message, issues = []) {
    super(message);
    this.name = "ConfigValidationError";
    this.issues = issues;
  }
}

// Campos obrigatórios do emissor com descrições para mensagens de erro
const REQUIRED_ISSUER_FIELDS = [
  { key: "cnpj",         label: "CNPJ do emitente",                    validate: (v) => /^\d{14}$/.test(String(v).replace(/\D/g, "")) && validCnpj(v) },
  { key: "ie",           label: "Inscrição Estadual",                   validate: (v) => typeof v === "string" && v.trim().length >= 2 },
  { key: "crt",         label: "Código de Regime Tributário (CRT)",    validate: (v) => [1, 2, 3, 4].includes(Number(v)) },
  { key: "razao",        label: "Razão Social / Nome do Emitente",      validate: (v) => typeof v === "string" && v.trim().length >= 2 && v.trim().length <= 60 },
  { key: "logradouro",   label: "Logradouro do endereço fiscal",        validate: (v) => typeof v === "string" && v.trim().length >= 2 && v.trim().length <= 60 },
  { key: "numero",       label: "Número do endereço fiscal",            validate: (v) => typeof v === "string" && v.trim().length >= 1 && v.trim().length <= 60 },
  { key: "bairro",       label: "Bairro do endereço fiscal",            validate: (v) => typeof v === "string" && v.trim().length >= 2 && v.trim().length <= 60 },
  { key: "municipio",    label: "Nome do Município",                    validate: (v) => typeof v === "string" && v.trim().length >= 2 && v.trim().length <= 60 },
  { key: "municipioIBGE", label: "Código IBGE do Município (7 dígitos)", validate: (v) => /^\d{7}$/.test(String(v)) },
  { key: "uf",           label: "UF (2 letras)",                        validate: (v) => /^[A-Z]{2}$/.test(String(v).toUpperCase()) },
  { key: "cep",          label: "CEP (8 dígitos numéricos)",            validate: (v) => /^\d{8}$/.test(String(v).replace(/\D/g, "")) },
  { key: "telefone",     label: "Telefone do emitente",                 validate: (v) => typeof v === "string" && v.replace(/\D/g, "").length >= 10 },
  { key: "thumbprint",   label: "Thumbprint do certificado A1 (40 hex)", validate: (v) => /^[0-9a-fA-F]{40}$/.test(String(v)) },
];

// CRT 3 = Regime Normal (o emitente auditado; Simples Nacional é 1 ou 2)
const ALLOWED_CRT = [3];

/**
 * Valida todos os campos do emissor e retorna lista de issues.
 * Não lança exceção; deixa o chamador decidir.
 *
 * @param {object} data - dados brutos do emissor
 * @returns {{ valid: boolean, issues: Array<{code, field, message}> }}
 */
export function validateIssuerConfig(data) {
  if (!data || typeof data !== "object") {
    return {
      valid: false,
      issues: [{ code: "ISSUER_NULL", field: null, message: "Dados do emissor ausentes." }],
    };
  }

  const issues = [];

  for (const { key, label, validate } of REQUIRED_ISSUER_FIELDS) {
    const value = data[key];
    if (value === undefined || value === null || value === "") {
      issues.push({
        code: `ISSUER_FIELD_MISSING_${key.toUpperCase()}`,
        field: key,
        message: `Campo obrigatório ausente: ${label}.`,
        severity: "error",
      });
    } else if (!validate(value)) {
      issues.push({
        code: `ISSUER_FIELD_INVALID_${key.toUpperCase()}`,
        field: key,
        message: `Valor inválido para ${label}.`,
        severity: "error",
      });
    }
  }

  // Validação adicional: CNPJ deve passar no algoritmo de dígitos verificadores
  if (data.cnpj) {
    const rawCnpj = String(data.cnpj).replace(/\D/g, "");
    if (rawCnpj.length === 14 && !validCnpj(rawCnpj)) {
      issues.push({
        code: "ISSUER_CNPJ_DV_INVALID",
        field: "cnpj",
        message: "CNPJ inválido: dígitos verificadores não conferem.",
        severity: "error",
      });
    }
  }

  // Validação do CRT permitido
  if (data.crt && !ALLOWED_CRT.includes(Number(data.crt))) {
    issues.push({
      code: "ISSUER_CRT_NOT_ALLOWED",
      field: "crt",
      message: `CRT ${data.crt} não é suportado. Valores permitidos: ${ALLOWED_CRT.join(", ")}.`,
      severity: "error",
    });
  }

  return { valid: issues.length === 0, issues };
}

/**
 * Salva ou atualiza a configuração do emissor fiscal.
 * NUNCA grava CNPJ real, IE ou certificado no Git — apenas no banco local.
 *
 * @param {FiscalRepository} fiscalRepo
 * @param {object} data - dados do emissor (inclui campos obrigatórios)
 * @param {string} [id] - UUID do emissor; gerado automaticamente se omitido
 */
export function saveIssuerConfig(fiscalRepo, data, id = null) {
  const { valid, issues } = validateIssuerConfig(data);
  if (!valid) {
    throw new ConfigValidationError(
      "Configuração do emissor inválida.",
      issues,
    );
  }

  const issuerId = id ?? randomUUID();

  // Normaliza CNPJ antes de gravar (remove pontuação)
  const normalizedCnpj = normalizeCnpj(data.cnpj);
  const identity = normalizedCnpj;

  const configuration = {
    cnpj: normalizedCnpj,
    ie: String(data.ie).trim(),
    crt: Number(data.crt),
    razao: String(data.razao).trim(),
    logradouro: String(data.logradouro).trim(),
    numero: String(data.numero).trim(),
    complemento: data.complemento ? String(data.complemento).trim() : "",
    bairro: String(data.bairro).trim(),
    municipio: String(data.municipio).trim(),
    municipioIBGE: String(data.municipioIBGE),
    uf: String(data.uf).toUpperCase(),
    cep: String(data.cep).replace(/\D/g, ""),
    telefone: String(data.telefone).replace(/\D/g, ""),
    thumbprint: String(data.thumbprint).toUpperCase(),
    // Capacidades extras — só definidas explicitamente
    nfceCredentialed: Boolean(data.nfceCredentialed),
    seriesCoordinated: Boolean(data.seriesCoordinated),
    fiscalProfileApproved: Boolean(data.fiscalProfileApproved),
    backupConfigured: Boolean(data.backupConfigured),
  };

  return fiscalRepo.saveIssuer({
    id: issuerId,
    identity,
    configuration,
    productionEnabled: 0, // Produção SEMPRE começa bloqueada
  });
}

/**
 * Carrega o emissor ativo do banco.
 * Retorna null se não houver emissor configurado (nunca inventa dados).
 */
export function loadIssuerConfig(fiscalRepo) {
  const all = fiscalRepo.listIssuers();
  if (!all || all.length === 0) return null;
  if (all.length !== 1) throw new ConfigValidationError("Selecione explicitamente o emissor fiscal.");
  return all[0];
}

/**
 * Habilita produção para um emissor — exige confirmação explícita e checklist.
 * NUNCA deve ser chamado automaticamente.
 */
export function enableProduction(fiscalRepo, issuerId, { confirmed = false } = {}) {
  if (!confirmed) {
    throw new ConfigValidationError(
      "Para habilitar produção é necessário passar { confirmed: true } e ter concluído o checklist F11/F12.",
      [{ code: "PROD_ENABLE_NOT_CONFIRMED", field: null, message: "Confirmação explícita necessária." }],
    );
  }

  throw new ConfigValidationError("Produção indisponível nesta etapa; critérios F11/F12 ainda não implementados.", [{code: "PROD_RELEASE_NOT_IMPLEMENTED"}]);
}
