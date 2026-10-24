/**
 * Políticas de emissão fiscal: endpoints, capacidades e bloqueios por ambiente/data.
 * Módulo PURO — sem I/O, sem banco de dados, sem rede.
 *
 * Decisões que NÃO podem ser improvisadas:
 * - Homologação e produção ficam isoladas por identidade, sequência, política e endpoints.
 * - Produção começa BLOQUEADA; só abre com flag explícito e checklist F11/F12 concluído.
 * - Endpoints fixos por operação/modelo/ambiente; nenhuma URL fornecida externamente.
 * - Capacidade 65 depende de credenciamento confirmado (E01); não basta serviço retornar 107.
 */
import { validateIssuerConfig } from "./config.mjs";

// ─── Endpoints SEFAZ São Paulo (Homologação) ────────────────────────────────
// Fontes: fontes-oficiais.json ids webservices-nfe e webservices-nfce; data corte 24/10/2026.
// Atualizar ANTES de qualquer uso em produção (conferir especialmente 01/11, 03/11 e virada 2027).
export const ENDPOINTS_HOMOLOGACAO = Object.freeze({
  55: Object.freeze({
    NfeAutorizacao: "https://homologacao.nfe.fazenda.sp.gov.br/ws/nfeautorizacao4.asmx",
    NfeRetAutorizacao: "https://homologacao.nfe.fazenda.sp.gov.br/ws/nferetautorizacao4.asmx",
    NfeConsultaProtocolo: "https://homologacao.nfe.fazenda.sp.gov.br/ws/nfeconsultaprotocolo4.asmx",
    NfeCancelamento: "https://homologacao.nfe.fazenda.sp.gov.br/ws/nferecepcaoevento4.asmx",
    NfeInutilizacao: "https://homologacao.nfe.fazenda.sp.gov.br/ws/nfeinutilizacao4.asmx",
    NfeStatusServico: "https://homologacao.nfe.fazenda.sp.gov.br/ws/nfestatusservico4.asmx",
  }),
  65: Object.freeze({
    NfceAutorizacao: "https://homologacao.nfce.fazenda.sp.gov.br/ws/NfceAutorizacao4.asmx",
    NfceRetAutorizacao: "https://homologacao.nfce.fazenda.sp.gov.br/ws/NfceRetAutorizacao4.asmx",
    NfceConsultaProtocolo: "https://homologacao.nfce.fazenda.sp.gov.br/ws/NfceConsultaProtocolo4.asmx",
    NfceCancelamento: "https://homologacao.nfce.fazenda.sp.gov.br/ws/NfceRecepcaoEvento4.asmx",
    NfceStatusServico: "https://homologacao.nfce.fazenda.sp.gov.br/ws/NfceStatusServico4.asmx",
  }),
});

// Produção mantida no objeto mas INACESSÍVEL sem production_enabled=1 + checklist completo.
// NÃO remover este bloco; existe para futuro e para tornar explícito o isolamento.
export const ENDPOINTS_PRODUCAO = Object.freeze({
  55: Object.freeze({
    NfeAutorizacao: "https://nfe.fazenda.sp.gov.br/ws/nfeautorizacao4.asmx",
    NfeRetAutorizacao: "https://nfe.fazenda.sp.gov.br/ws/nferetautorizacao4.asmx",
    NfeConsultaProtocolo: "https://nfe.fazenda.sp.gov.br/ws/nfeconsultaprotocolo4.asmx",
    NfeCancelamento: "https://nfe.fazenda.sp.gov.br/ws/nferecepcaoevento4.asmx",
    NfeInutilizacao: "https://nfe.fazenda.sp.gov.br/ws/nfeinutilizacao4.asmx",
    NfeStatusServico: "https://nfe.fazenda.sp.gov.br/ws/nfestatusservico4.asmx",
  }),
  65: Object.freeze({
    NfceAutorizacao: "https://nfce.fazenda.sp.gov.br/ws/NfceAutorizacao4.asmx",
    NfceRetAutorizacao: "https://nfce.fazenda.sp.gov.br/ws/NfceRetAutorizacao4.asmx",
    NfceConsultaProtocolo: "https://nfce.fazenda.sp.gov.br/ws/NfceConsultaProtocolo4.asmx",
    NfceCancelamento: "https://nfce.fazenda.sp.gov.br/ws/NfceRecepcaoEvento4.asmx",
    NfceStatusServico: "https://nfce.fazenda.sp.gov.br/ws/NfceStatusServico4.asmx",
  }),
});

// Mapeamento operação → chave de endpoint
export const OPERATION_ENDPOINT_KEY = Object.freeze({
  authorize: { 55: "NfeAutorizacao", 65: "NfceAutorizacao" },
  receipt: { 55: "NfeRetAutorizacao", 65: "NfceRetAutorizacao" },
  query: { 55: "NfeConsultaProtocolo", 65: "NfceConsultaProtocolo" },
  cancel: { 55: "NfeCancelamento", 65: "NfceCancelamento" },
  status: { 55: "NfeStatusServico", 65: "NfceStatusServico" },
  inutilizacao: { 55: "NfeInutilizacao" },
});

export class PolicyError extends Error {
  constructor(message, code = "POLICY_BLOCKED", details = {}) {
    super(message);
    this.name = "PolicyError";
    this.code = code;
    this.details = details;
  }
}

/**
 * Resolve o endpoint exato para uma operação.
 * Lança PolicyError se o endpoint não existir ou produção estiver bloqueada.
 *
 * @param {object} params
 * @param {string} params.operation  - 'authorize'|'receipt'|'query'|'cancel'|'status'|'inutilizacao'
 * @param {number} params.model      - 55 | 65
 * @param {string} params.environment - 'homologacao'|'producao'
 * @param {object} params.issuer     - emissor com production_enabled (boolean)
 */
export function resolveEndpoint({ operation, model, environment, issuer }) {
  if (!["homologacao", "producao"].includes(environment)) {
    throw new PolicyError(
      `Ambiente inválido: "${environment}". Use 'homologacao' ou 'producao'.`,
      "INVALID_ENVIRONMENT",
    );
  }
  if (![55, 65].includes(model)) {
    throw new PolicyError(
      `Modelo inválido: ${model}. Use 55 (NF-e) ou 65 (NFC-e).`,
      "INVALID_MODEL",
    );
  }
  if (environment === "producao") {
    if (!issuer?.productionEnabled) {
      throw new PolicyError(
        "Emissão em produção está bloqueada. Conclua o checklist de liberação (F11/F12) e habilite explicitamente.",
        "PRODUCTION_BLOCKED",
        { issuerId: issuer?.id },
      );
    }
    // F12 ainda não foi implementada. Uma alteração manual no banco não pode
    // transformar a lista futura de URLs em autorização de uso real.
    throw new PolicyError(
      "Transporte fiscal de produção ainda não foi liberado neste aplicativo.",
      "PRODUCTION_NOT_IMPLEMENTED",
    );
  }

  const endpointMap =
    environment === "homologacao" ? ENDPOINTS_HOMOLOGACAO : ENDPOINTS_PRODUCAO;
  const opKey = OPERATION_ENDPOINT_KEY[operation]?.[model];

  if (!opKey) {
    throw new PolicyError(
      `Operação "${operation}" não suportada para modelo ${model}.`,
      "UNSUPPORTED_OPERATION",
      { operation, model, environment },
    );
  }

  const url = endpointMap[model]?.[opKey];
  if (!url) {
    throw new PolicyError(
      `Endpoint não configurado para ${operation}/${model}/${environment}.`,
      "ENDPOINT_MISSING",
      { operation, model, environment, opKey },
    );
  }

  return url;
}

/**
 * Retorna as capacidades habilitadas para um emissor em uma data específica.
 * Capacidades são determinadas pelo emissor, pendências externas e data.
 *
 * Regras:
 * - can55: liberado quando emissor está configurado e production_enabled (para produção)
 *   OU apenas configurado (para homologação); depende de E02 estar resolvido.
 * - can65: só habilitado quando credenciamento NFC-e confirmado (E01).
 * - contingency, devolution, interstate, etc: sempre bloqueados nesta versão.
 *
 * @param {object} issuer - emissor retornado pelo FiscalRepository
 * @param {string} [atDate] - ISO date string (default: hoje)
 * @returns {object} capabilities
 */
export function getCapabilities(issuer, atDate = new Date().toISOString().slice(0, 10)) {
  if (!issuer) {
    return {
      can55: false,
      can65: false,
      contingency: false,
      devolution: false,
      interstate: false,
      complemento: false,
      inutilizacao: false,
      reasons: ["Emissor não configurado."],
    };
  }

  const reasons = [];
  const cfg = issuer.configuration || {};

  // Verifica campos mínimos do emissor
  const issuerCheck = validateIssuerConfig(cfg);
  if (!issuerCheck.valid) {
    reasons.push("Configuração do emissor incompleta ou inválida; revise os campos fiscais obrigatórios.");
  }

  const can55 = issuerCheck.valid;
  if (!can55) {
    reasons.push("NF-e (modelo 55) bloqueada: emissor incompleto.");
  }

  // can65: exige can55 + flag de credenciamento NFC-e (E01)
  const nfceCredentialed = Boolean(cfg.nfceCredentialed);
  // O sinal cadastral ainda não é evidência de autorização 65. Só F10,
  // com credenciamento e ciclo homologado, pode habilitar esta capacidade.
  const can65 = false;
  if (can55) {
    reasons.push(
      nfceCredentialed
        ? "NFC-e (modelo 65) bloqueada: falta comprovar o ciclo de homologação F10."
        : "NFC-e (modelo 65) bloqueada: credenciamento no portal de homologação pendente (E01).",
    );
  }

  // Inutilização: SP anuncia fim após 01/11/2026 (Ajustes SINIEF 38/2026 e 40/2026)
  const inutilizacaoBlocked = atDate >= "2026-11-01";
  if (inutilizacaoBlocked) {
    reasons.push(
      "Inutilização bloqueada: SP anunciou descontinuação a partir de 01/11/2026 (Ajustes SINIEF 38/40 de 2026). Verifique norma vigente antes de habilitar.",
    );
  }

  return {
    can55,
    can65,
    contingency: false,        // Bloqueado: depende de requisitos legais e técnicos (F11+)
    devolution: false,         // Bloqueado: operação especial não implementada
    interstate: false,         // Bloqueado: fora do escopo inicial SP interno
    complemento: false,        // Bloqueado: operação especial não implementada
    inutilizacao: false,         // Fluxo não implementado; após 01/11/2026 SP anuncia dispensa.
    reasons: reasons.length > 0 ? reasons : [],
  };
}

/**
 * Valida se um emissor tem produção habilitada corretamente.
 * Retorna lista de bloqueios pendentes para produção.
 */
export function productionReadinessCheck(issuer) {
  const blocks = [];

  if (!issuer) {
    blocks.push({ code: "E00_NO_ISSUER", message: "Emissor não configurado." });
    return blocks;
  }

  if (!issuer.productionEnabled) {
    blocks.push({
      code: "PROD_NOT_ENABLED",
      message:
        "Produção não habilitada. Conclua o checklist F11/F12 e habilite explicitamente.",
    });
  }

  const cfg = issuer.configuration || {};

  if (!cfg.seriesCoordinated) {
    blocks.push({
      code: "E06_SERIES_NOT_COORDINATED",
      message:
        "Série não coordenada com outros emissores (RevGás e demais). Resolva E06 antes da produção.",
    });
  }

  if (!cfg.fiscalProfileApproved) {
    blocks.push({
      code: "E03_PROFILES_NOT_APPROVED",
      message:
        "Perfis tributários não aprovados por responsável tributário (E03). Revisar GLP e água SKU a SKU.",
    });
  }

  if (!cfg.backupConfigured) {
    blocks.push({
      code: "E08_BACKUP_NOT_CONFIGURED",
      message: "Rotina de backup e restauração não configurada e testada (E08).",
    });
  }

  return blocks;
}

/**
 * Verifica se uma data de emissão está dentro de um período com política válida.
 * RTC (NT 2025.002 v1.52) define calendário para novembro e mudança de exercício 2027.
 *
 * @param {string} dhEmi - ISO datetime string
 * @returns {{ valid: boolean, warnings: string[] }}
 */
export function validateEmissionDate(dhEmi) {
  const warnings = [];
  if (typeof dhEmi !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(dhEmi)) {
    return { valid: false, warnings: ["Informe data e hora ISO com fuso horário explícito."] };
  }
  const d = new Date(dhEmi);
  if (isNaN(d.getTime())) {
    return { valid: false, warnings: ["Data de emissão inválida."] };
  }

  const dateStr = dhEmi.slice(0, 10);
  const [year, month, day] = dateStr.split("-").map(Number);
  const calendarDate = new Date(Date.UTC(year, month - 1, day));
  if (calendarDate.getUTCFullYear() !== year || calendarDate.getUTCMonth() !== month - 1 || calendarDate.getUTCDate() !== day) {
    return { valid: false, warnings: ["Data civil de emissão inválida."] };
  }

  // Alerta para datas em período de mudança de regras
  if (dateStr >= "2026-11-01" && dateStr <= "2026-11-03") {
    warnings.push(
      "Data em período de mudança de regras (01/11–03/11/2026). Reconferir RTC NT 2025.002 v1.52 e normas estaduais antes de emitir.",
    );
  }

  if (dateStr >= "2027-01-01") {
    warnings.push(
      "Data em 2027: reconferir calendário RTC, alíquotas IBS/CBS e transição monofásica vigentes. Regras de 2026 não se aplicam automaticamente.",
    );
    return { valid: false, warnings };
  }

  return { valid: true, warnings };
}

/**
 * Verifica se o protocolo recebido da SEFAZ tem formato válido.
 * SP usa protocolo de 15 ou 17 dígitos (produção: 17 desde 05/10/2026).
 * NÃO aceitar 16 dígitos (intervalo 15-17 admite 16, mas não é válido).
 */
export function validateProtocolFormat(protocol) {
  if (typeof protocol !== "string") return false;
  const cleaned = protocol.trim();
  // Aceitar exatamente 15 ou 17 dígitos numéricos (não o intervalo, que incluiria 16)
  return /^\d{15}$/.test(cleaned) || /^\d{17}$/.test(cleaned);
}
