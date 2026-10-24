/**
 * Máquina de estados pura para emissão fiscal (NF-e 55 e NFC-e 65).
 * Sem I/O, sem rede, sem dependência direta do banco.
 *
 * Estados permitidos:
 * - prepared: Número e snapshot reservados, sem POST.
 * - signed: Bytes assinados e validados por XSD persistidos.
 * - sending: Intenção durável registrada; envio em andamento.
 * - uncertain: Possível envio sem confirmação ou timeout; resultado não reconciliado.
 * - authorized: Protocolo correlacionado e nfeProc persistido.
 * - rejected: Rejeição definitiva comprovada pela SEFAZ.
 * - cancel_pending: Intenção de cancelamento registrada duravelmente.
 * - cancel_uncertain: Evento de cancelamento enviado com retorno incerto ou timeout.
 * - cancelled: Cancelamento vinculado e confirmado na SEFAZ.
 * - blocked: Bloqueio para intervenção (falha cadastral, consumo indevido, divergência).
 * - abandoned: Documento encerrado localmente antes do envio ou após rejeição definitiva auditada.
 */

export const FISCAL_STATES = Object.freeze([
  "prepared",
  "signed",
  "sending",
  "uncertain",
  "authorized",
  "rejected",
  "cancel_pending",
  "cancel_uncertain",
  "cancelled",
  "blocked",
  "abandoned",
]);

export const TERMINAL_STATES = Object.freeze(["cancelled", "abandoned"]);

export const ACTIVE_STATES = Object.freeze(
  FISCAL_STATES.filter((s) => !TERMINAL_STATES.includes(s)),
);

/**
 * Matriz de transições permitidas.
 * Cada transição reflete as regras estritas do dossiê fiscal.
 */
export const VALID_TRANSITIONS = Object.freeze({
  prepared: Object.freeze(["signed", "abandoned", "blocked"]),
  signed: Object.freeze(["sending", "abandoned", "blocked"]),
  sending: Object.freeze(["uncertain", "authorized", "rejected", "blocked"]),
  uncertain: Object.freeze(["authorized", "rejected", "blocked"]),
  authorized: Object.freeze(["cancel_pending", "blocked"]),
  rejected: Object.freeze(["signed", "abandoned", "blocked"]),
  cancel_pending: Object.freeze(["cancel_uncertain", "cancelled", "authorized", "blocked"]),
  cancel_uncertain: Object.freeze(["cancelled", "authorized", "blocked"]),
  blocked: Object.freeze(["prepared", "signed", "uncertain", "cancel_uncertain", "abandoned"]),
  cancelled: Object.freeze([]),
  abandoned: Object.freeze([]),
});

export class FiscalStateError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "FiscalStateError";
    this.details = details;
  }
}

/**
 * Retorna true se o estado for considerado ativo (active=1).
 * cancelled e abandoned possuem active=0.
 */
export function isActiveState(state) {
  if (!FISCAL_STATES.includes(state)) {
    throw new FiscalStateError(`Estado fiscal desconhecido: "${state}".`);
  }
  return !TERMINAL_STATES.includes(state);
}

/**
 * Verifica se a transição de um estado para outro é permitida.
 */
export function canTransition(fromState, toState) {
  if (!FISCAL_STATES.includes(fromState) || !FISCAL_STATES.includes(toState)) {
    return false;
  }
  const allowed = VALID_TRANSITIONS[fromState];
  return Boolean(allowed && allowed.includes(toState));
}

/**
 * Valida a transição e lança FiscalStateError se for inválida.
 */
export function assertTransition(fromState, toState, context = {}) {
  if (!FISCAL_STATES.includes(fromState)) {
    throw new FiscalStateError(`Estado de origem inválido: "${fromState}".`, {
      fromState,
      toState,
      ...context,
    });
  }
  if (!FISCAL_STATES.includes(toState)) {
    throw new FiscalStateError(`Estado de destino inválido: "${toState}".`, {
      fromState,
      toState,
      ...context,
    });
  }
  if (!canTransition(fromState, toState)) {
    throw new FiscalStateError(
      `Transição fiscal proibida de "${fromState}" para "${toState}".`,
      { fromState, toState, ...context },
    );
  }
}

/**
 * Recupera o estado de um documento que foi interrompido por desligamento
 * ou reinício da aplicação durante operações em andamento.
 * - 'sending' -> 'uncertain' (não sabemos se a SEFAZ recebeu o POST)
 * - 'cancel_pending' -> 'cancel_uncertain' (não sabemos se o evento foi processado)
 * - demais estados mantêm o estado atual
 */
export function recoverInterruptedState(state) {
  if (!FISCAL_STATES.includes(state)) {
    throw new FiscalStateError(`Estado fiscal inválido para recuperação: "${state}".`);
  }
  if (state === "sending") return "uncertain";
  if (state === "cancel_pending") return "cancel_uncertain";
  return state;
}

/**
 * Interpretação estrita de retornos da SEFAZ para determinar o próximo estado
 * e o desfecho da tentativa, conforme a tabela de estados e recuperação do dossiê.
 */
export function evaluateStatusResult({
  cStat,
  operation = "authorize",
  correlations = {},
} = {}) {
  const code = String(cStat || "").trim();
  const {
    accessKeyMatches = true,
    environmentMatches = true,
    protocolValid = true,
    digestMatches = true,
    eventSequenceMatches = true,
  } = correlations;

  // Autorização direta (100) ou autorização fora de prazo (150)
  if (code === "100" || code === "150") {
    if (
      !accessKeyMatches ||
      !environmentMatches ||
      !protocolValid ||
      !digestMatches
    ) {
      return {
        nextState: "blocked",
        outcome: "blocked",
        reason:
          "Divergência de correlação no retorno 100/150 (chave, ambiente, protocolo ou digest).",
      };
    }
    return {
      nextState: "authorized",
      outcome: "success",
      reason: "Autorização concedida e correlacionada.",
    };
  }

  // Lote recebido / em processamento (103, 105)
  if (code === "103" || code === "105") {
    return {
      nextState: "uncertain",
      outcome: "uncertain",
      isBatchPending: true,
      reason: "Lote recebido ou em processamento; aguardar consulta de recibo.",
    };
  }

  // Evento vinculado (135)
  if (code === "135") {
    if (operation === "cancel") {
      if (!accessKeyMatches || !environmentMatches || !protocolValid || !eventSequenceMatches) {
        return {
          nextState: "blocked",
          outcome: "blocked",
          reason: "Divergência de correlação no evento de cancelamento 135.",
        };
      }
      return {
        nextState: "cancelled",
        outcome: "success",
        reason: "Cancelamento homologado e vinculado.",
      };
    }
    return {
      nextState: "authorized",
      outcome: "success",
      reason: "Evento registrado e vinculado.",
    };
  }

  // Evento registrado mas não vinculado (136)
  if (code === "136") {
    return {
      nextState: operation === "cancel" ? "cancel_uncertain" : "uncertain",
      outcome: "uncertain",
      reason: "Evento registrado mas não vinculado; requer consulta confirmatória.",
    };
  }

  // Duplicidade de NF-e / NFC-e (204, 539)
  if (code === "204" || code === "539") {
    return {
      nextState: "uncertain",
      outcome: "uncertain",
      isDuplicate: true,
      reason:
        "Duplicidade detectada pela SEFAZ. Consultar e correlacionar documento existente; não gerar outro número.",
    };
  }

  // Duplicidade de evento (573)
  if (code === "573") {
    return {
      nextState: operation === "cancel" ? "cancel_uncertain" : "uncertain",
      outcome: "uncertain",
      isDuplicate: true,
      reason: "Duplicidade de evento detectada pela SEFAZ. Consultar evento correspondente.",
    };
  }

  // Documento não localizado na SEFAZ (217)
  if (code === "217") {
    return {
      nextState: "uncertain",
      outcome: "uncertain",
      reason:
        "Documento não localizado no momento (217). Não comprova rejeição definitiva; manter reconciliação limitada.",
    };
  }

  // Emitente não cadastrado (245)
  if (code === "245") {
    return {
      nextState: "blocked",
      outcome: "blocked",
      reason:
        "Emitente não cadastrado para este modelo/ambiente (245). Bloquear emissão e solicitar regularização cadastral.",
    };
  }

  // Consumo indevido (656)
  if (code === "656") {
    return {
      nextState: "blocked",
      outcome: "blocked",
      reason:
        "Consumo indevido detectado pela SEFAZ (656). Interromper tentativas automáticas e registrar intervenção.",
    };
  }

  // Cancelamento confirmado em consulta (101)
  if (code === "101") {
    if (operation === "query" || operation === "cancel") {
      return {
        nextState: "cancelled",
        outcome: "success",
        reason: "Cancelamento de NF-e/NFC-e confirmado em consulta (101).",
      };
    }
  }

  // Serviço indisponível ou desativado (998)
  if (code === "998") {
    return {
      nextState: "blocked",
      outcome: "blocked",
      reason: "Serviço SEFAZ indisponível ou desativado (998).",
    };
  }

  // Rejeições definitivas padrão
  return {
    nextState: "rejected",
    outcome: "rejected",
    reason: `Rejeição fiscal definitiva (cStat: ${code || "desconhecido"}).`,
  };
}

/**
 * Retorna lista de ações permitidas na interface ou no fluxo para o estado atual.
 */
export function allowedActions(state) {
  switch (state) {
    case "prepared":
      return ["sign", "abandon"];
    case "signed":
      return ["submit", "abandon"];
    case "sending":
      return ["wait"];
    case "uncertain":
      return ["query", "reconcile"];
    case "authorized":
      return ["print", "export", "cancel", "query"];
    case "rejected":
      return ["new_revision", "abandon"];
    case "cancel_pending":
      return ["wait"];
    case "cancel_uncertain":
      return ["query", "reconcile"];
    case "cancelled":
      return ["print", "export", "audit_view"];
    case "blocked":
      return ["diagnose", "reconcile", "abandon"];
    case "abandoned":
      return ["audit_view"];
    default:
      return [];
  }
}
