# Plano de execução para GPT Sol

Implementar em entregas pequenas, com commit e evidência por etapa. Não prometer prazo de 25 dias sem confirmar data de vencimento e pendências externas. Estudo não é autorização tributária nem novo instalador.

| Etapa | Depende de | Trabalho concreto | Aceite para avançar |
|---|---|---|---|
| F01 — persistência | Leitura do dossiê | Migração 6, repository e state-machine; ajustar limite de schema no Store; proteger cancelamento operacional | **CONCLUÍDA (24/10/2026)**: Migração aditiva 6 integrada ao Store; `FiscalRepository` e `FiscalStateMachine` criados; cancelamento operacional de pedidos bloqueado quando há nota ativa/incerteza; 62 testes automatizados aprovados (incluindo D01–D15 em `tests/fiscal-persistence.test.mjs`), `npm run build` e `validar-proposta.mjs` sem erros. |
| F02 — configuração | F01 | Emitente/ambientes, certificado explícito, sidecar cliente fiscal, perfis versionados, capacidades | **CONCLUÍDA COMO BASE INTERNA (24/10/2026):** configuração privada do emitente, referência por thumbprint, cadastro fiscal estruturado, perfis versionados e preflight em memória. Identidade do emitente e vigências aprovadas não colidem; CPF/CNPJ/Pix/endereço/ano futuro falham fechados. NFC-e e produção seguem bloqueadas. O preflight ainda emite `F03_ENGINE_NOT_IMPLEMENTED` para qualquer venda: F03 deve substituí-lo somente depois de cálculo completo e testes. Certificado/cadeia são checados no adaptador F05, não nesta etapa. |
| F03 — motor puro | F02 | Decimal/quantidades/rateio, perfis sintéticos GLP e água, pagamentos, totais, regras por vigência | **EM ANDAMENTO:** decimal e rateio completos; `calculator.mjs` calcula prévia por perfil aprovado para água/5102/00/000001, ICMS/PIS/COFINS/IBS/CBS e reconcilia totais com pedido. Prévia ligada ao preflight. GLP monofásico 620006, água ST e bases reais por SKU aguardam regra/validação E03; F04 mantém toda emissão bloqueada. Ver [contrato F03](CALCULO-F03.md). |
| F04 — documentos | F03 | Builder XML próprio, schemas/manifesto, assinatura e verificação estrita | XMLs sintéticos 55/65 passam XSD; alteração de 1 byte/ID duplicado/referência externa falham |
| F05 — transporte | F04 | Adaptador Windows separado do laboratório; validação SOAP/respostas/eventos; mocks | Retornos trocados e inválidos nunca autorizam/cancelam; protocolo 15/17 sem 16; logs sanitizados |
| F06 — recuperação | F05 | Outbox/worker, receipts, query, persistência anterior ao POST, cancelamento correlacionado | Matriz de falhas abruptas passa; consulta após timeout; nenhum número novo automático; nenhum duplo efeito |
| F07 — DANFE | F04, F06 | A4 NF-e, térmico NFC-e, QR3, Code128, exportação nfeProc/evento | PDF renderizado revisado, decoder independente, nenhuma impressão incerta como autorizada |
| F08 — interface | F02–F07 | IPC tipado, botão Fiscal no pedido, estados/pendências no diagnóstico existente | Mesmo layout clássico; duplo clique idempotente; permissões sender/frame; simulação ponta a ponta |
| F09 — homologação 55 | F08, E02–E05 | Ciclo controlado GLP/água com valores fictícios, consulta, impressão e cancelamento; perfis revisados | Autorização/protocolos/eventos correlacionados, consulta final, arquivos privados e relatório sanitizado |
| F10 — homologação 65 | F09, E01 | Credenciamento válido, ciclo NFC-e, QR3 e regras próprias | Superar 245 legitimamente; autorização, QR legível, cancelamento/consulta; não usar NF-e como evidência de NFC-e |
| F11 — operação segura | F09/F10 conforme modelo | Backup/restauração, instalador, certificado renovado, filas, treinamento e documentação | Teste em Windows empacotado, restauro com bloqueio e reconciliação, impressora física aprovada |
| F12 — produção | F11, E03/E06/E07/E08 | Revalidar fontes, cadastro e séries, habilitar apenas capacidades aprovadas; escolha de venda real pelo usuário | Checklist completo por modelo; nota real acompanhada, consulta e entrega do XML/DANFE; nenhuma emissão fictícia em produção |

F09 não exige esperar E01: NF-e pode avançar separadamente. Habilitação de 55 não habilita 65. Contingência offline, devolução e demais operações são novas etapas posteriores; não fingir cobertura para encerrar F12.

## Entrega mínima de cada commit

1. Arquivos alterados e motivo.
2. Testes executados, resultados reais e casos ainda ausentes.
3. Atualização deste plano com etapa concluída/parcial/bloqueada e evidência.
4. Nenhum XML real, certificado, segredo, chave de nota ou banco pessoal no Git.
5. `npm test` e `npm run build`; testes UI pertinentes quando interface/IPC mudar. Não usar ensaio com A1/SEFAZ como teste unitário ou CI público.

Antes de F09/F10, registrar modelo, ambiente, série exclusiva de testes, quantidade máxima de notas e limpeza fiscal por cancelamento quando aplicável. Não rodar scripts repetidamente apenas para verificar documentação. Os testes anteriores permanecem evidência histórica; novos testes devem corresponder ao novo código.

## Detalhes de F01 que não devem ficar para depois

- SQL é aditivo e não mexe em preço/estoque/caixa. Evoluir Store de schema5 para6 em transação.
- Perfil aprovado deve ficar imutável: qualquer alteração cria nova versão; retirada de vigência não muda o snapshot histórico. A proposta SQL não implementa sozinha toda essa regra.
- Adicionar validação de referência entre artefatos e tentativas: FK de ID garante existência, mas serviço deve provar que pertencem ao mesmo documento/revisão.
- Número reservado, identidade, revisão, artefatos e auditoria não podem ser apagados pelo repositório. Restringir métodos de escrita; fortalecer triggers onde necessário.
- CAS: `UPDATE ... SET row_version=row_version+1 ... WHERE id=? AND row_version=? AND state=?`; zero linhas = conflito, não sucesso.
- Fila com dedup_key estável. Recuperar lease expirado não significa repetir autorização: examinar tentativa e consultar.
- Testar duas conexões SQLite competindo por sequência e pela mesma venda; BEGIN IMMEDIATE/índices devem impedir duplicidade.

## O que não fazer

Não reescrever o layout; não copiar código servidor do RevGás (não foi obtido); não remover validações porque a SEFAZ aceitou o exemplo; não usar códigos históricos como defaults universais; não alterar XML autorizado; não resolver timeout emitindo número novo; não usar segredo em CLI/log; não “liberar tudo” quando apenas 55 passou; não chamar o protótipo de sistema fiscal finalizado.
