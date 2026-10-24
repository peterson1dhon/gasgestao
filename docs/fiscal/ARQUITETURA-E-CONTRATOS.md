# Arquitetura de implementação

Decisões de projeto, não funcionalidades já entregues. Manter Electron/React/SQLite, sem serviço de nuvem obrigatório. O processo principal é o único proprietário da persistência e do certificado.

## Organização proposta

| Arquivo novo | Responsabilidade |
|---|---|
| `electron/fiscal/repository.mjs` | Migração, sequências, snapshots, artefatos, CAS, tentativas e fila durável. |
| `electron/fiscal/state-machine.mjs` | Transições puras, invariantes e decisões de recuperação; sem rede. |
| `electron/fiscal/policies.mjs` | Manifestos, vigências, endpoints permitidos, capacidades e bloqueios. |
| `electron/fiscal/decimal.mjs` | Decimais exatos e arredondamento; sem ponto flutuante para tributos. |
| `electron/fiscal/calculator.mjs` | Cálculo de itens/totais a partir de perfil aprovado e snapshot. |
| `electron/fiscal/document-builder.mjs` | XML próprio determinístico e na ordem do XSD. |
| `electron/fiscal/transport.mjs` | Contrato do helper Windows, timeout e interpretação de envelope. |
| `electron/fiscal/windows-adapter.ps1` | A1, assinatura, XSD, TLS e SOAP com parâmetros fechados. |
| `electron/fiscal/service.mjs` | Preflight, preparação, assinatura, submissão, consulta e cancelamento. |
| `electron/fiscal/worker.mjs` | Recuperação na abertura e processamento serial da fila. |
| `electron/fiscal/print.mjs` | DANFE HTML/PDF e impressão, sem dependência do recibo comum. |

Preservar `homologation-lab.ps1`, `lab-document.mjs` e `reference-lab-document.mjs` como laboratório restrito. Reaproveitar somente funções puras cobertas por testes, não a autorização especial para R$ 1. Não expor XML/envelope/endpoint arbitrário pelo preload.

## Migração e persistência

Usar a [proposta SQL](schema-v6-proposta.sql) como ponto de partida da migração aditiva 6. Executar dentro de `Store.transaction`, atualizar `user_version` somente no final e alterar o limite de versão aceito pelo Store. Antes de migrar a base real, backup consistente e teste de abertura/restauração em cópia. Não recriar tabelas operacionais ou iniciar banco vazio silenciosamente.

O SQL define integridade estrutural. Regras de campos JSON, hashes, aprovação, transições e correlação dependem do repositório e dos testes descritos aqui. Não considerar CHECK/JSON válido suficiente para aprovação fiscal.

- Identidade: emitente, ambiente, modelo, série e número. Uma sequência para cada combinação; inteiro de 1 a 999999999. Série inicialmente 0–889 para evitar faixas especiais sem suporte. Validar regra vigente específica antes de ampliar.
- `fiscal_documents`: identidade nunca muda após reserva. `active=1` desde reserva até cancelamento confirmado ou abandono permitido; índice único por pedido/ambiente, abrangendo modelos 55 e 65.
- `fiscal_revisions`: snapshots imutáveis de pedido, emitente, destinatário, perfis, pagamentos, cálculos, versão do motor e manifesto. `version` crescente. Corrigir somente após rejeição definitiva; chave permanece se identidade não mudou. Mudança de componente da chave exige procedimento explícito, não UPDATE oculto.
- `fiscal_artifacts`: bytes exatos de XML assinado, requisição, resposta, nfeProc e evento processado; SHA-256 conferido na leitura. Canônico no SQLite para compartilhar transação/backup, exportações são cópias.
- `fiscal_attempts`: intenção durável ANTES do POST, artefatos associados, fase e desfecho. Não apagar falhas.
- `fiscal_audit`: eventos append-only com ator, razão e correlação. Não registrar segredo ou XML em texto de log.
- `fiscal_jobs`: fila durável, uma reivindicação por vez, lease e retomada. Job repetido não implica novo POST.

Uma transação curta reserva número + documento + snapshot + auditoria. Depois assinatura/rede fora da transação. Outra transação grava resultado completo + estado + artefatos + próximo job. Usar atualização condicional por `row_version` e estado esperado. O wrapper `Store.transaction` é síncrono: NÃO passar função async e NÃO abrir BEGIN aninhado. Manter instância única Electron e proteção SQLite mesmo assim.

## Contratos de dados

IDs locais opacos UUID. `environment`: `homologacao|producao`; tradução a tpAmb ocorre no serviço. `model`: `55|65` numérico fechado. Protocolo, chave, CNPJ/CPF e códigos fiscais são strings. Valores finais são centavos inteiros seguros; decimais intermediários são strings canônicas, ponto decimal, sem notação científica. Nunca aceitar número JS impreciso para valor fiscal.

`prepare({orderId, model, environment, profileVersionIds, paymentPlan, recipientFiscalId, expectedOrderVersion})`:

1. Recarregar pedido e dados no principal. Como o pedido atual não tem row_version, acrescentar versão operacional ou comparar hash determinístico de todos os campos relevantes dentro da transação; não confiar no renderer.
2. Validar capacidade, cadastro, perfis vigentes, pagamentos e totais. Preflight inválido não reserva número.
3. Congelar snapshot e reservar identidade. Gerar cNF criptográfico de 8 dígitos, dhEmi com fuso, DV segundo padrão aplicável. Guardar tudo; nunca regenerar após restart.
4. Retornar `{documentId, state, revision, preview, issues}` sem dados do certificado.

`paymentPlan`: lista de `{method, amountCents, timing, pixType?, card?}`; ver tributação. `issues`: lista de `{code, severity, field, message}` sanitizada. Nenhum alerta obrigatório pode ser descartado com botão genérico “continuar”.

## IPC proposto

Manter validação sender/mainFrame do `handle` atual e validação estrita dos objetos (campos desconhecidos rejeitados).

| Canal / método preload | Entrada | Saída |
|---|---|---|
| `fiscal:preflight` / fiscalPreflight | orderId, model, environment | issues e capacidades; sem reserva |
| `fiscal:prepare` / fiscalPrepare | contrato acima | documentId, revisão e resumo |
| `fiscal:submit` / fiscalSubmit | documentId, expectedRevision, requestId | estado atual; chamada duplicada idempotente |
| `fiscal:query` / fiscalQuery | documentId | estado/job, não consulta livre por chave |
| `fiscal:cancel` / fiscalCancel | documentId, justification, expectedRevision, requestId | evento/estado, sem estorno operacional |
| `fiscal:list-for-order` / fiscalListForOrder | orderId | resumos e ações permitidas |
| `fiscal:print` / fiscalPrint | documentId, printerId permitido | resultado da impressão |
| `fiscal:export` / fiscalExport | documentId, tipo permitido | diálogo nativo e confirmação; sem path fornecido pelo renderer |

Adicionar métodos a `electron/preload.cjs` e tipos a `src/api.ts`. Em `src/forms.tsx`, usar o OrderDetails existente para botão compacto Fiscal, estado e ações. Configuração no `src/fiscal.tsx` existente. Não substituir MDI, menu, CSS, cores, barras ou navegação. Prévia DANFE é um documento de impressão separado, não novo layout do aplicativo.

## Helper e segurança

Processo filho sem shell e argumentos interpolados; passar JSON validado por stdin ou arquivo privado controlado pelo principal. Nenhuma senha em linha de comando. Request DTO fechado: operação, documento/revisão, ambiente enum, paths internos resolvidos, thumbprint selecionado. Helper resolve endpoint em mapa fixo e rejeita caminhos fora da pasta privada. Resposta estruturada com ID de correlação, resultado e referência privada; stdout sem dumps de XML ou certificado.

XML: DTD proibido, resolver externo nulo, limite explícito de tamanho (inicialmente 2 MiB documento e 4 MiB resposta, com erro claro), namespace/root exatos, XSD local com hash aprovado, único ID esperado e única assinatura/referência. Rejeitar referência externa, algoritmo/transform fora da allowlist e wrapping. Valores exatos de algoritmos devem seguir MOC/XSD e testes do A1; não “modernizar” algoritmo unilateralmente.

TLS normal com validação de servidor/cadeia/revogação, sem redirecionamento para outro host, sem ignorar erros. Certificado escolhido explicitamente, com chave privada, validade, cadeia e vínculo ao emitente. Não escolher primeiro certificado encontrado. Separar erro de credencial, assinatura, HTTP/SOAP e rejeição fiscal.

## Backup, restauração e atualização

Incluir novas tabelas no backup SQLite consistente já existente; validar integrity_check e hashes de amostra/artefatos. XMLs e dados fiscais são sensíveis mesmo sem a chave A1. Controle de acesso local e política de backup devem ser definidos; DPAPI não é backup portável nem proteção contra malware do próprio usuário.

Restauração sempre entra com emissão bloqueada: reconsultar pendências e reconciliar sequências com documentos emitidos após o backup e com outros emissores. Não reduzir contador por falta de notas no backup. Não há consulta simples de status que descubra o maior número usado. Exclusividade de série deve ser documentada.

Distribuição deve incluir scripts e schemas fora de caminhos quebrados por ASAR, com manifesto de integridade. Testar instalador em Windows sem Node/Java adicionais, atualização preservando banco e falha de migração. Versão antiga deve recusar banco mais novo, sem apagar dados. A assinatura de código do instalador é distinta do certificado A1 fiscal.
