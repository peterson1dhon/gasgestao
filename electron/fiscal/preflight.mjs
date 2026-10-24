/**
 * Preflight de emissão fiscal: validação completa antes de qualquer reserva de número.
 *
 * O preflight NUNCA reserva número de NF-e/NFC-e.
 * Retorna lista de issues categorizados por severidade (error, warning, info).
 * Todo issue obrigatório com severity='error' bloqueia a emissão.
 *
 * Validações cobertas:
 * - Emissor: campos obrigatórios, CRT, thumbprint, capacidade do modelo/ambiente
 * - Cliente: tipo de documento fiscal (CPF/CNPJ), endereço estruturado, IE quando exigida
 * - Pedido: itens, totais, pagamentos
 * - Perfil fiscal: existência, aprovação, vigência na data de emissão, campos mínimos
 * - Política: modelo/ambiente, produção bloqueada, credenciamento NFC-e
 * - Data de emissão: dentro das políticas vigentes
 */

import { validateIssuerConfig } from "./config.mjs";
import { getCapabilities, validateEmissionDate } from "./policies.mjs";
import { validCnpj } from "../cnpj.mjs";
import { calculateDraftFiscalSale, FiscalCalculationError, RTC_2026_POLICY_ID } from "./calculator.mjs";
import { formatDecimal } from "./decimal.mjs";

const validCpf = (value) => {
  if (typeof value !== "string" || !/^\d{11}$/.test(value) || /^(\d)\1{10}$/.test(value)) return false;
  const digit = (length) => {
    const sum = Array.from({ length }, (_, index) => Number(value[index]) * (length + 1 - index))
      .reduce((total, part) => total + part, 0);
    return ((sum * 10) % 11) % 10;
  };
  return digit(9) === Number(value[9]) && digit(10) === Number(value[10]);
};

export class PreflightError extends Error {
  constructor(message, issues = []) {
    super(message);
    this.name = "PreflightError";
    this.issues = issues;
  }
}

/**
 * Valida os dados fiscais do cliente para o modelo solicitado.
 *
 * Para NF-e (55): destinatário pode ser PF (CPF) ou PJ (CNPJ) ou consumidor final sem CPF (indIEDest=9 + sem doc)
 * Para NFC-e (65): CPF ou CNPJ são opcionais; omissão permitida para consumidor final
 *
 * @param {object} customerFiscalDetails - dados fiscais do cliente (fiscal_customer_details.payload_json)
 * @param {number} model - 55 | 65
 * @returns {Array<{code, severity, field, message}>}
 */
export function validateCustomerFiscal(customerFiscalDetails, model) {
  const issues = [];

  if (!customerFiscalDetails) {
    if (model === 55) {
      // NF-e 55 pode ser emitida sem CPF/CNPJ apenas para consumidor final (indIEDest=9)
      // mas endereço estruturado mínimo é exigido em operações internas
      issues.push({
        code: "C01_CUSTOMER_FISCAL_MISSING",
        severity: "error",
        field: "customerFiscalDetails",
        message:
          "Dados fiscais estruturados do cliente não cadastrados. " +
          "Para NF-e, informe CPF ou CNPJ e endereço fiscal com código IBGE do município.",
      });
    }
    // NFC-e 65: ausência total de dados fiscais é aceitável para consumidor final
    return issues;
  }

  if (typeof customerFiscalDetails !== "object" || Array.isArray(customerFiscalDetails)) {
    return [{code: "C01_CUSTOMER_FISCAL_INVALID", severity: "error", field: "customerFiscalDetails",
      message: "Dados fiscais do destinatário devem ser um cadastro estruturado."}];
  }

  const d = customerFiscalDetails;

  // Tipo de documento do destinatário
  if (d.docType && !["cpf", "cnpj", "exterior", "sem_doc"].includes(d.docType)) {
    issues.push({
      code: "C02_CUSTOMER_DOC_TYPE_INVALID",
      severity: "error",
      field: "docType",
      message: `Tipo de documento do destinatário inválido: "${d.docType}".`,
    });
  }

  if (model === 55 && (!d.docType || ["sem_doc", "exterior"].includes(d.docType))) {
    issues.push({
      code: "C02_CUSTOMER_DOC_REQUIRED",
      severity: "error",
      field: "docType",
      message: "Para a operação interna NF-e 55, identifique o destinatário por CPF ou CNPJ.",
    });
  }

  if (d.docType === "cpf" && !validCpf(d.doc)) {
    issues.push({
      code: "C03_CUSTOMER_CPF_INVALID",
      severity: "error",
      field: "doc",
      message: "CPF do destinatário inválido: confira os dígitos verificadores.",
    });
  }

  if (d.docType === "cnpj" && !validCnpj(d.doc)) {
    issues.push({
      code: "C04_CUSTOMER_CNPJ_INVALID",
      severity: "error",
      field: "doc",
      message: "CNPJ do destinatário inválido, inclusive os dígitos verificadores.",
    });
  }

  // Endereço estruturado mínimo para NF-e 55
  if (model === 55) {
    for (const field of ["nome", "logradouro", "numero", "bairro", "municipio", "cep"]) {
      if (typeof d[field] !== "string" || !d[field].trim()) {
        issues.push({code: "C05_CUSTOMER_ADDRESS_INCOMPLETE", severity: "error", field,
          message: `Dados fiscais do destinatário incompletos: informe ${field}.`});
      }
    }
    if (d.cep && !/^\d{8}$/.test(String(d.cep))) {
      issues.push({code: "C05_CUSTOMER_CEP_INVALID", severity: "error", field: "cep",
        message: "CEP fiscal do destinatário deve ter oito dígitos."});
    }
    if (!d.municipioIBGE || !/^\d{7}$/.test(String(d.municipioIBGE))) {
      issues.push({
        code: "C05_CUSTOMER_MUNICIPIO_INVALID",
        severity: "error",
        field: "municipioIBGE",
        message:
          "Código IBGE do município do destinatário ausente ou inválido. " +
          "Não é o CEP — são 7 dígitos (ex: 3550308 para São Paulo).",
      });
    }
    if (!d.uf || !/^[A-Z]{2}$/.test(String(d.uf || "").toUpperCase())) {
      issues.push({
        code: "C06_CUSTOMER_UF_INVALID",
        severity: "error",
        field: "uf",
        message: "UF do destinatário ausente ou inválida (2 letras maiúsculas).",
      });
    }
  }

  // Verificação de IE para PJ em operação interna
  if (d.docType === "cnpj" && model === 55) {
    if (d.indIEDest === undefined || d.indIEDest === null) {
      issues.push({
        code: "C07_CUSTOMER_INDIEDEDEST_MISSING",
        severity: "error",
        field: "indIEDest",
        message:
          "Indicador de IE do destinatário PJ (indIEDest) ausente. " +
          "Use 1 (contribuinte ICMS), 2 (isento) ou 9 (não contribuinte).",
      });
    }
  }

  return issues;
}

/**
 * Valida os pagamentos do plano fiscal para o pedido.
 *
 * @param {Array<{method, amountCents, timing}>} paymentPlan
 * @param {number} totalCents
 * @returns {Array<{code, severity, field, message}>}
 */
export function validatePaymentPlan(paymentPlan, totalCents) {
  const issues = [];

  if (!Array.isArray(paymentPlan) || paymentPlan.length === 0) {
    issues.push({
      code: "T13_PAYMENT_PLAN_EMPTY",
      severity: "error",
      field: "paymentPlan",
      message:
        "Plano de pagamento fiscal ausente. Informe ao menos um meio de pagamento e valor.",
    });
    return issues;
  }

  // Métodos válidos conforme tabela nacional (meios-pagamento.zip, data 24/10/2026)
  const VALID_METHODS = new Set([
    "01", // Dinheiro
    "02", // Cheque
    "03", // Cartão de Crédito
    "04", // Cartão de Débito
    "05", // Crediário / Venda a Prazo
    "10", // Vale Alimentação
    "11", // Vale Refeição
    "12", // Vale Presente
    "13", // Vale Combustível
    "15", // Boleto Bancário
    "16", // Depósito Bancário
    "17", // PIX Dinâmico (QR Code com informações do pagamento)
    "18", // Transferência bancária, Carteira Digital
    "19", // Programa de fidelidade, cashback, crédito virtual
    "20", // PIX Estático (transferência/chave)
    "21", // Crédito em Loja
    "22", // Pagamento instantâneo (EFT)
    "90", // Sem pagamento (devolução, etc.)
    "99", // Outros (exige xPag)
  ]);

  let totalFromPlan = 0n;

  for (let i = 0; i < paymentPlan.length; i++) {
    const p = paymentPlan[i];

    if (!p || typeof p !== "object" || Array.isArray(p)) {
      issues.push({code: "T13_PAYMENT_ENTRY_INVALID", severity: "error", field: `paymentPlan[${i}]`,
        message: "Item do plano de pagamento inválido."});
      continue;
    }

    if (!VALID_METHODS.has(String(p.method))) {
      issues.push({
        code: "T13_PAYMENT_METHOD_INVALID",
        severity: "error",
        field: `paymentPlan[${i}].method`,
        message:
          `Meio de pagamento inválido: "${p.method}". ` +
          "Confira a tabela oficial de meios de pagamento (meios-pagamento.zip, portal NF-e).",
      });
    }

    // method=99 exige descrição
    if (String(p.method) === "99" && (typeof p.description !== "string" || !p.description.trim())) {
      issues.push({
        code: "T13_PAYMENT_99_NO_DESCRIPTION",
        severity: "error",
        field: `paymentPlan[${i}].description`,
        message: "Meio de pagamento '99 - Outros' exige descrição (xPag).",
      });
    }

    // method=90 (sem pagamento) não deve coexistir com outros
    if (String(p.method) === "90" && paymentPlan.length > 1) {
      issues.push({
        code: "T13_PAYMENT_90_WITH_OTHERS",
        severity: "error",
        field: `paymentPlan[${i}].method`,
        message:
          "Meio de pagamento '90 - Sem pagamento' não pode coexistir com outros meios de pagamento.",
      });
    }

    // PIX: distinguir dinâmico (17) de estático (20)
    if (["17", "20"].includes(String(p.method))) {
      const expectedPixType = String(p.method) === "17" ? "dinamico" : "estatico";
      if (p.pixType !== expectedPixType) {
        issues.push({
          code: "T13_PIX_TYPE_MISSING",
          severity: "error",
          field: `paymentPlan[${i}].pixType`,
          message:
            `PIX requer pixType: 'dinamico' (código 17) ou 'estatico' (código 20). ` +
            "Não usar 'pix' genérico — o código fiscal difere.",
        });
      }
    }

    // Validação de valor
    const cents = p.amountCents;
    if (!Number.isSafeInteger(cents) || cents < 0) {
      issues.push({
        code: "T13_PAYMENT_AMOUNT_INVALID",
        severity: "error",
        field: `paymentPlan[${i}].amountCents`,
        message: `Valor de pagamento inválido em item[${i}]: deve ser inteiro não negativo em centavos.`,
      });
    } else {
      totalFromPlan += BigInt(cents);
    }
  }

  // Soma deve cobrir o total do documento
  if (Number.isSafeInteger(totalCents) && totalCents > 0) {
    if (paymentPlan.some((p) => p && String(p.method) === "90")) {
      issues.push({code: "T13_PAYMENT_90_SALE", severity: "error", field: "paymentPlan",
        message: "Venda com valor positivo não pode usar '90 - Sem pagamento'. Informe o meio de pagamento ou crediário aprovado."});
    }
    const expectedTotal = BigInt(totalCents);
    if (totalFromPlan !== expectedTotal) {
      issues.push({
        code: "T13_PAYMENT_SUM_MISMATCH",
        severity: "error",
        field: "paymentPlan",
        message:
          `Soma dos pagamentos (${totalFromPlan} centavos) diverge do total do documento (${expectedTotal} centavos).`,
      });
    }
  }

  return issues;
}

/**
 * Executa o preflight completo de emissão.
 *
 * @param {object} params
 * @param {object} params.store - instância do Store com store.fiscal (FiscalRepository)
 * @param {number} params.orderId - ID do pedido
 * @param {number} params.model - 55 | 65
 * @param {string} params.environment - 'homologacao' | 'producao'
 * @param {Array<string>} [params.profileVersionIds] - IDs de perfis fiscais a usar (por produto)
 * @param {Array<object>} [params.paymentPlan] - plano de pagamento fiscal
 * @param {string|null} [params.recipientFiscalId] - CPF ou CNPJ do destinatário (opcional NFC-e)
 * @param {string} [params.emissionDate] - ISO datetime para verificar vigência de perfis e políticas
 * @param {string} [params.deliveryFeeTreatment] - 'freight' quando revisão fiscal confirmou que a taxa é frete
 * @returns {{ ok: boolean, issues: Array<{code, severity, field, message}>, capabilities: object }}
 */
export function runPreflight({
  store,
  orderId,
  model,
  environment,
  profileVersionIds = [],
  paymentPlan = [],
  emissionDate = new Date().toISOString(),
  deliveryFeeTreatment,
}) {
  const issues = [];
  const repo = store.fiscal;

  // ── 1. Modelo e ambiente ─────────────────────────────────────────────────
  if (![55, 65].includes(model)) {
    issues.push({
      code: "C09_MODEL_INVALID",
      severity: "error",
      field: "model",
      message: `Modelo inválido: ${model}. Somente 55 (NF-e) e 65 (NFC-e) são suportados.`,
    });
  }
  if (!["homologacao", "producao"].includes(environment)) {
    issues.push({
      code: "C09_ENVIRONMENT_INVALID",
      severity: "error",
      field: "environment",
      message: `Ambiente inválido: "${environment}". Use 'homologacao' ou 'producao'.`,
    });
  }

  // ── 2. Emissor ───────────────────────────────────────────────────────────
  const issuers = repo.listIssuers();
  const issuer = issuers.length === 1 ? issuers[0] : null;
  if (issuers.length > 1) issues.push({code: "ISSUER_AMBIGUOUS", severity: "error", message: "Selecione explicitamente um emissor fiscal."});
  const issuerValidation = validateIssuerConfig(issuer?.configuration ?? {});

  for (const issue of issuerValidation.issues) {
    issues.push({ ...issue, severity: "error" });
  }

  // ── 3. Capacidades do modelo/ambiente ────────────────────────────────────
  const dateText = typeof emissionDate === "string" ? emissionDate : "";
  const caps = getCapabilities(issuer, dateText.slice(0, 10));
  for (const reason of caps.reasons) {
    issues.push({
      code: "C08_CAPABILITY_BLOCKED",
      severity: "info",
      field: "issuer.configuration",
      message: reason,
    });
  }

  if (model === 55 && !caps.can55) {
    issues.push({
      code: "C08_CAPABILITY_55_BLOCKED",
      severity: "error",
      field: "model",
      message: "Emissão de NF-e (modelo 55) não está habilitada para este emissor.",
    });
  }
  if (model === 65 && !caps.can65) {
    issues.push({
      code: "C08_CAPABILITY_65_BLOCKED",
      severity: "error",
      field: "model",
      message:
        "Emissão de NFC-e (modelo 65) não está habilitada. " +
        "Credenciamento no portal de homologação da SEFAZ-SP pendente (E01).",
    });
  }

  // Produção bloqueada sem flag explícito
  if (environment === "producao") {
    issues.push({
      code: "PROD_BLOCKED",
      severity: "error",
      field: "environment",
      message:
        "Emissão em produção está bloqueada. " +
        "Complete o checklist F11/F12 e habilite produção explicitamente.",
    });
  }

  // ── 4. Pedido ────────────────────────────────────────────────────────────
  let order = null;
  try {
    order = store.getOrder(orderId);
  } catch {
    issues.push({
      code: "D01_ORDER_NOT_FOUND",
      severity: "error",
      field: "orderId",
      message: `Pedido #${orderId} não encontrado.`,
    });
  }

  if (order) {
    if (!Array.isArray(order.items) || order.items.length === 0 || !Number.isSafeInteger(order.total_cents) || order.total_cents <= 0) {
      issues.push({ code: "ORDER_INVALID", severity: "error", field: "orderId", message: "Pedido sem itens ou total válido." });
    }
    if (order.status === "cancelado") {
      issues.push({
        code: "D02_ORDER_CANCELLED",
        severity: "error",
        field: "orderId",
        message: "Não é possível emitir nota para pedido cancelado.",
      });
    }

    // Verificar se já há nota ativa para este pedido/ambiente
    const existingDoc = repo.getDocumentByOrder(orderId, environment);
    if (existingDoc) {
      issues.push({
        code: "D05_DOCUMENT_ALREADY_ACTIVE",
        severity: "error",
        field: "orderId",
        message:
          `Já existe documento fiscal ativo (${existingDoc.state}) para o pedido #${orderId} em ${environment}. ` +
          "Resolva a situação anterior antes de emitir nova nota.",
      });
    }
  }

  // ── 5. Dados fiscais do cliente ──────────────────────────────────────────
  if (order) {
    const customerFiscalDetails = repo.getCustomerDetails(order.customer_id);
    const customerIssues = validateCustomerFiscal(
      customerFiscalDetails?.payload ?? null,
      model,
    );
    for (const issue of customerIssues) issues.push(issue);
  }

  // ── 6. Perfis fiscais dos produtos ──────────────────────────────────────
  if (order && order.items) {
    const selectedIds = Array.isArray(profileVersionIds) ? profileVersionIds : [];
    if (profileVersionIds !== undefined && !Array.isArray(profileVersionIds)) {
      issues.push({code: "T09_PROFILE_SELECTION_INVALID", severity: "error", field: "profileVersionIds",
        message: "Seleção de perfis fiscais inválida."});
    }
    if (selectedIds.length > 0 && selectedIds.length !== order.items.length) {
      issues.push({code: "T09_PROFILE_SELECTION_COUNT", severity: "error", field: "profileVersionIds",
        message: "Informe uma versão de perfil para cada item do pedido."});
    }
    for (const [index, item] of order.items.entries()) {
      const activeProfile = repo.getActiveProfile({
        productId: item.product_id,
        atDate: dateText.slice(0, 10),
      });

      if (!activeProfile) {
        issues.push({
          code: "T09_PROFILE_NOT_FOUND",
          severity: "error",
          field: `items.product_${item.product_id}`,
          message:
            `Perfil fiscal não encontrado para o produto "${item.name}" (ID ${item.product_id}) ` +
            `na data ${dateText.slice(0, 10)}. Cadastre e aprove um perfil fiscal com vigência válida.`,
        });
        continue;
      }

      if (selectedIds.length > 0 && selectedIds[index] !== activeProfile.id) {
        issues.push({code: "T09_PROFILE_SELECTION_STALE", severity: "error", field: `profileVersionIds[${index}]`,
          message: `A versão fiscal selecionada para "${item.name}" não é a versão aprovada vigente. Revise a emissão.`});
      }

      if (activeProfile.approvalState !== "approved") {
        issues.push({
          code: "T09_PROFILE_NOT_APPROVED",
          severity: "error",
          field: `items.product_${item.product_id}`,
          message:
            `Perfil fiscal do produto "${item.name}" não está aprovado ` +
            `(estado: ${activeProfile.approvalState}). ` +
            "Perfis precisam de revisão identificada e vigência aprovada antes da emissão.",
        });
      }

      // Campos mínimos obrigatórios no payload do perfil
      const pld = activeProfile.payload || {};
      const missingProfileFields = [];
      if (!pld.ncm) missingProfileFields.push("NCM");
      if (!pld.cfop) missingProfileFields.push("CFOP");
      if (typeof pld.taxes?.icms?.cst !== "string") missingProfileFields.push("CST ICMS");

      if (missingProfileFields.length > 0) {
        issues.push({
          code: "T09_PROFILE_INCOMPLETE",
          severity: "error",
          field: `items.product_${item.product_id}`,
          message:
            `Perfil fiscal do produto "${item.name}" está incompleto. ` +
            `Campos obrigatórios ausentes: ${missingProfileFields.join(", ")}.`,
        });
      }

      // Alerta sobre IBS/CBS monofásico não implementado (GLP classe 620006)
      if (pld.cClassTrib === "620006" || pld.ibsMonofasico) {
        issues.push({
          code: "T17_IBS_CBS_MONOFASICO_NOT_IMPLEMENTED",
          severity: "error",
          field: `items.product_${item.product_id}`,
          message:
            `Produto "${item.name}" utiliza IBS/CBS monofásico (classe 620006/GLP), ` +
            "que ainda não está implementado nesta versão. " +
            "Aprovação em homologação não encerra esta lacuna (NT 2025.002 v1.52, UB13-40).",
        });
      }
    }
  }

  // ── 7. Plano de pagamento ────────────────────────────────────────────────
  if (order) {
    for (const issue of validatePaymentPlan(paymentPlan, order.total_cents)) issues.push(issue);
  }

  // ── 8. Validação da data de emissão ─────────────────────────────────────
  const { valid: dateValid, warnings: dateWarnings } = validateEmissionDate(dateText);
  if (!dateValid) {
    issues.push({
      code: "C09_EMISSION_DATE_INVALID",
      severity: "error",
      field: "emissionDate",
      message: "Data de emissão inválida.",
    });
  }
  for (const w of dateWarnings) {
    issues.push({
      code: "EMISSION_DATE_WARNING",
      severity: "warning",
      field: "emissionDate",
      message: w,
    });
  }

  let calculation = null;
  if (order && !issues.some(issue => issue.severity === "error")) {
    try {
      const fee = order.delivery_fee_cents;
      if (fee > 0 && deliveryFeeTreatment !== "freight") {
        throw new FiscalCalculationError("DELIVERY_FEE_UNCLASSIFIED",
          "Classifique a taxa de entrega com revisão fiscal antes de incluí-la na nota.");
      }
      const fiscalItems = order.items.map(item => {
        const profile = repo.getActiveProfile({productId:item.product_id,atDate:dateText.slice(0,10)});
        return {
          id:String(item.id),quantity:formatDecimal(BigInt(item.quantity)*10000n,4),
          unitPrice:formatDecimal(BigInt(item.unit_price_cents)*100000000n,10),
          profile:{...profile.payload,id:profile.id,approvalState:profile.approvalState,
            approvedBy:profile.approvedBy,approvedAt:profile.approvedAt,
            validFrom:profile.validFrom,validUntil:profile.validUntil},
        };
      });
      calculation = calculateDraftFiscalSale({items:fiscalItems,
        discountCents:order.discount_cents,freightCents:fee,
        expectedTotalCents:order.total_cents,issuedOn:dateText.slice(0,10),
        model,policyId:RTC_2026_POLICY_ID});
    } catch (error) {
      if (!(error instanceof FiscalCalculationError)) throw error;
      issues.push({code:`F03_${error.code}`,severity:"error",field:"fiscalEngine",message:error.message});
    }
  }
  // F04/F05 ainda não assinam/transmitem a partir desta prévia. Mesmo uma
  // simulação aritmética válida não pode liberar a reserva de número.
  issues.push({code:"F04_DOCUMENT_NOT_IMPLEMENTED",severity:"error",field:"fiscalDocument",
    message:"Documento fiscal operacional ainda não implementado; prévia disponível apenas para conferência."});

  const errors = issues.filter((i) => i.severity === "error");
  return {
    ok: errors.length === 0,
    issues,
    capabilities: caps,
    calculation,
  };
}
