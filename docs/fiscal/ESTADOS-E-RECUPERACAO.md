# Estados, idempotência e recuperação

Estado operacional do pedido e estado fiscal são independentes. Cancelamento fiscal confirmado não prova devolução de mercadoria nem estorno de pagamento. O serviço fiscal deve bloquear `Store.changeOrderStatus(...cancelado)` enquanto houver documento ativo ou incerto e oferecer um fluxo explícito; não alterar diretamente estoque/caixa.

## Estados permitidos

| Estado | Significado | Próxima ação permitida |
|---|---|---|
| prepared | Número e snapshot reservados, sem POST | Assinar, corrigir falha local ou abandonar antes de qualquer tentativa |
| signed | Bytes assinados/XSD aprovados persistidos | Registrar intenção e submeter uma vez |
| sending | Intenção durável; chamada em andamento | Aguardar; após restart tratar como uncertain |
| uncertain | Pode ter sido autorizado; resultado não reconciliado | Consultar chave ou recibo; bloquear nova emissão da venda |
| authorized | Protocolo correlacionado e nfeProc persistido | Consultar, exportar, imprimir, pedir cancelamento elegível |
| rejected | Rejeição definitiva comprovada | Revisar snapshot e assinar nova revisão; não apagar a anterior |
| cancel_pending | Intenção de evento registrada | Enviar evento uma vez; após restart consultar |
| cancel_uncertain | Evento pode ter sido aceito | Consultar/reconciliar; manter documento ativo |
| cancelled | Cancelamento vinculado confirmado | Exportar histórico; liberar nova emissão somente por ação explícita |
| blocked | Identidade/ambiente ou situação exige intervenção | Diagnóstico e reconciliação, sem nova nota automática |
| abandoned | Nunca enviado, ou rejeição definitiva permite encerrar | Manter número/lacuna auditáveis; active=0 |

O banco aceita esses nomes; a máquina pura define as transições. Estados cancelled/abandoned têm active=0; os demais active=1. `blocked` não significa permissão para abandonar. Cancelamento não pode transitar de rejected/prepared. Documento authorized não pode ser editado, abandonado ou voltar a signed.

## Sequência de autorização

1. Preflight completo sem reservar número. Conferir pedido, perfis e ambiente.
2. BEGIN IMMEDIATE: reservar número, snapshot, identidade e auditoria; COMMIT.
3. Gerar, assinar e validar. Persistir XML exato + hash e estado signed atomicamente.
4. BEGIN: gravar tentativa com requestId único e estado sending; COMMIT antes do POST.
5. Enviar fora da transação. Em timeout/falha após possível envio, gravar uncertain; se processo morrer, worker converte sending em uncertain ao retomar.
6. Validar retorno por schema e correlação. Persistir resposta, protocolo/processado e estado numa única transação CAS. Resposta tardia não sobrescreve revisão posterior.
7. Se lote assíncrono, persistir nRec e consultar recibo. Nunca tratar “lote recebido/processado” como autorização do documento.

Identidade e número nunca são reciclados automaticamente, inclusive após falha local. RequestId repetido retorna o estado já existente. Limite de uma emissão fiscal ativa por pedido/ambiente cobre modelos diferentes. Atualização da configuração não muda o endpoint/emitente congelado de documento pendente.

## Interpretação de retornos

| Código/situação | Tratamento |
|---|---|
| 100/150 | Somente authorized se chave, ambiente, identidade, protocolo e digest aplicável corresponderem ao XML persistido. |
| 103/105 | Recebido/em processamento: salvar recibo e agendar consulta. |
| 104 | Inspecionar protocolo interno do documento; não autorizar apenas pelo status do lote. |
| 204/539 | Duplicidade: consultar e correlacionar documento existente. Não marcar sucesso nem gerar outro número automaticamente. |
| 217 | Documento não localizado naquele momento. Não prova que o envio anterior nunca será processado. Manter reconciliação limitada. |
| 245 | Emitente não cadastrado: bloquear capacidade desse modelo/ambiente e solicitar regularização. Não repetir em loop. |
| 656 | Consumo indevido: interromper tentativas automáticas, respeitar orientação do serviço e registrar intervenção. |
| 135/136 em evento | Conferir tipo, chave, ambiente, sequência e vínculo; 136 não prova cancelamento vinculado. Consultar antes de concluir. |
| 573 em evento | Duplicidade: recuperar/consultar evento correspondente; não criar nova sequência para contornar. |
| 101 em consulta | Confirmar identidade da nota e evidência do cancelamento; preservar evento/protocolo. |
| 998 | Serviço indisponível/desativado conforme resposta. Aplicar política de serviço/data, não considerar operação realizada. |
| HTTP 200 com HTML, SOAP Fault, truncamento, XML inválido | Falha de transporte/protocolo; após POST potencialmente aceito, uncertain. |
| Demais códigos | Tabela versionada; desconhecido fica blocked/uncertain conforme possibilidade de efeito, nunca “sucesso padrão”. |

Guardar status bruto sanitizado e resposta integral privada. Códigos históricos de denegação devem ser representáveis como bloqueio terminal auditável sem reutilização de número; não inferir regras atuais por memória.

## Política de consulta (decisão interna)

Uma fila serial com atrasos iniciais de 30, 60, 120, 300 e 600 segundos, jitter pequeno e limite persistido; esses tempos são estratégia do aplicativo, não prazo legal. Respeitar limites específicos do serviço e parar diante de 656. Após esgotar o ciclo, deixar pendente visível para intervenção, preservando consulta manual controlada. Não usar polling contínuo a cada segundo.

Reenvio exige consulta prévia, identidade e bytes preservados, motivo registrado e regra explícita testada. Enquanto não houver evidência suficiente para resolver o envio anterior, não liberar outro número. Consulta 217 isolada não habilita reenvio irrestrito. A primeira versão pode manter reenvio manual supervisionado após reconciliação, sem tentativa automática de “consertar” XML.

## Cancelamento

Validar elegibilidade operacional (mercadoria não circulou/hipótese legal aplicável), prazo vigente e justificativa exigida pelo schema, sem preencher texto fictício. Usar protocolo da autorização validada. Congelar evento, ID, sequência e bytes antes do envio. Correlacionar retorno com esses dados. Timeout exige consulta do evento/documento; não repetir com outra sequência.

Se o pedido já foi entregue ou situação exige devolução, bloquear cancelamento comum e explicar que operação de devolução ainda não está implementada. Não cadastrar uma devolução como cancelamento para simplificar.

## Pontos de falha que precisam de teste

Injetar encerramento do processo: antes/depois da reserva; após assinatura; após persistir sending e antes do POST; após servidor aceitar e antes do cliente receber; após receber e antes de COMMIT; após COMMIT e antes da resposta à UI. Repetir no cancelamento. Em cada ponto verificar número, bytes, audit trail, uma única nota ativa e ausência de movimentações operacionais extras. Recuperação deve funcionar sem arquivo `Authorize-response` do laboratório.
