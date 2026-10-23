# Estudo funcional do RevGás

Inspeção em 23/10/2026, no navegador interno, com a conta autorizada pelo usuário. Este levantamento descreve telas e fluxos observados. Não reproduz código, elementos gráficos, credenciais, dados de clientes ou documentos fiscais do serviço.

## Fluxos observados

| Área | Comportamento visto no RevGás | Situação do GasGestão |
|---|---|---|
| Estabelecimento | Configurações distintas de NF-e, NFC-e, CT-e e MDF-e. | Aplicativo local com uma revenda; diagnóstico SP para modelos 55 e 65. |
| Parâmetros fiscais | Regime tributário e incidência; ambiente; tipo de emissão; série e número separados para homologação/produção; opção de Reforma Tributária. | O laboratório usa parâmetros restritos de homologação. Ainda não existe editor fiscal de produção. |
| NF-e | Destinatário/remetente, entrada/saída, data, operação, consumidor final, redução de base, chaves referenciadas e vários produtos com quantidade, preço e desconto. | Pedidos já têm vários produtos e valores, mas não os parâmetros fiscais completos. |
| Transporte e combustível | Tipo de transporte, veículo, origem do combustível, UF e informações adicionais no formulário de NF-e. | Dados fiscais específicos de GLP ainda pendentes. |
| Detalhe fiscal do GLP | Consulta de uma nota existente distingue unidade/quantidade comercial e tributável, CFOP, NCM, CST, origem, ICMS monofásico retido anteriormente, PIS e COFINS. | O teste de bebida genérica não cobre esses grupos de GLP; exige modelagem e validação próprias antes de emitir gás. |
| Consulta de NF-e | Filtros por período, cliente/número; colunas de operação e status. Notas autorizadas e canceladas aparecem separadamente pelo estado. | A grade de pedidos representa a operação comercial; a futura situação fiscal precisa ser independente. |
| Documentos e eventos | Ações de DANFE, XML, cancelamento, CC-e e MDF-e na lista; notas canceladas exibem menos ações. A presença do botão não comprova que a ação foi testada. | Laboratório passou por autorização/consulta/cancelamento da NF-e. DANFE, CC-e e MDF-e não implementados. |
| Intercâmbio fiscal | Menu para notas destinadas/transportadas, importação da SEFAZ, importação manual, inutilização e download de XML. | Não há esses fluxos na interface atual. Inutilização de teste retornou serviço desativado. |
| Produtos | Lista com disponível, comodato e trânsito; status ativo/inativo e busca. Edição mostra marca, formas de pagamento, preço mínimo, prazos, volume, fardo e tipo. | Cadastro básico, ajustes de estoque e empréstimo/devolução de vasilhames. Preço mínimo e estoque em trânsito ainda pendentes. |
| Outros módulos | Menus de fornecedores, terminais, veículos, colaboradores, IBPT, certificado digital, contabilidades, escrituração e relatórios. | Menu observado não significa módulo integralmente estudado ou equivalente implementado. |

Nas telas desta conta, NF-e e NFC-e estavam configuradas para produção; não foram alteradas. O regime normal observado é compatível com a consulta cadastral oficial já usada pelo laboratório. Isso não valida sozinho o cálculo dos tributos da revenda.

## Limite encontrado na NFC-e

Ao navegar em **Nota ao consumidor → Emitir NFC-e**, o sistema redirecionou para uma página informando que o estabelecimento não possui acesso ao recurso, com oferta de plano e aviso de falta de configuração de NFC-e. O formulário completo de emissão de NFC-e não ficou acessível. A tela de configuração separada foi consultada apenas para identificar campos, incluindo identificador do CSC e CSC; seus valores secretos não foram coletados.

Esse bloqueio do RevGás é distinto da rejeição **245 — emitente não cadastrado** obtida no nosso teste direto com a SEFAZ em homologação. Não comprova ausência de credenciamento em produção.

## Prioridades propostas, mantendo o layout clássico

1. **Completar o fiscal antes de liberar emissão na venda.** Cadastro fiscal por produto/operação, numeração e ambientes separados, armazenamento protegido de parâmetros, credenciamento de testes da NFC-e, tributos reais de GLP/água, DANFE e recuperação após falha. Conferir parâmetros com documentação oficial vigente e responsável fiscal; não copiar os valores visíveis do outro sistema como regra geral.
2. **Adicionar situação fiscal independente ao pedido.** Exibir rascunho, em processamento, autorizada, rejeitada e cancelada numa janela interna clássica, com histórico, protocolo e acesso ao XML. Consulta antes de retransmissão evita duplicidade; cancelar a nota não deve estornar estoque/caixa por conta própria.
3. **Facilitar a entrega dos documentos à contabilidade.** Exportar XMLs autorizados e eventos por período, preservando originais e protocolos. Esses arquivos são privados e não pertencem ao GitHub.
4. **Depois do fiscal, avaliar preço mínimo e acerto de entregador.** São melhorias úteis à rotina, mas dependem das regras da revenda e de aprovação do usuário antes da implementação.

Estas são propostas e lacunas registradas; a inspeção não adicionou funções ao aplicativo nem mudou seu visual. A interface deve manter menus, janelas internas, cores e grade compacta atuais.

## Alcance da verificação

A inspeção foi de leitura: navegação, abertura de formulários e consulta de detalhes. Não foram salvos cadastros/configurações, emitidas ou canceladas notas no RevGás, contratados planos ou enviadas mensagens. O acesso às telas não foi tratado como teste de emissão. A senha fornecida para o acesso não foi gravada no projeto.

Os testes próprios e seus resultados continuam em [Validação](VALIDACAO.md) e [Teste de emissão SP](TESTE-EMISSAO-SP.md). O instalador 0.6.0 possui diagnóstico fiscal, enquanto a emissão/cancelamento de homologação permanece no laboratório de desenvolvimento.

Fonte consultada: [aplicação oficial RevGás](https://app.revgas.com/), em sessão autenticada. A disponibilidade depende da conta e do plano; o levantamento não afirma acesso a todos os módulos.
