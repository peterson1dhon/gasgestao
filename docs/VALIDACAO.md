# Validação da versão 0.7.0

## Referências fiscais — 0.7.0

48 testes locais aprovados e compilação concluída. O novo grupo testa assinatura matemática com XML sintético assinado, adulteração/DTD, preservação, zeros iniciais, variantes tributárias, migração 4→5, idempotência, vínculo, backup e cálculo decimal de ICMS/IBS/CBS. A nova interface passou por consulta/busca, vínculo persistente, prévia P13, isolamento e janela de 1000px com dados fictícios. Regressão operacional, lembretes/vasilhames e diagnóstico simulado também passaram na fonte.

A leitura dos três XMLs reais preservou os arquivos, verificou matematicamente as assinaturas, importou cinco itens e permitiu consultar 89–94 campos por item e calcular cinco prévias. Não verificou cadeia/revogação, autenticidade do protocolo na SEFAZ, situação atual ou correção fiscal; nenhuma nota nova foi transmitida. Ver [campos de gás e água](FISCAL-GAS-AGUA.md).

A distribuição Windows 0.7.0 passou também pela nova interface de referências, pelos 15 grupos de regressão operacional e pelo diagnóstico fiscal simulado. O auxiliar XML fica em `app.asar.unpacked`. A versão anterior foi preservada separadamente, e foi criado backup íntegro do perfil pessoal antes da migração 4→5; os cinco itens de referência foram integrados sem alterar o estado operacional.

## Histórico da distribuição 0.6.0 e laboratório

Atualização do código em desenvolvimento: o laboratório posterior à distribuição passou a ter 42 testes locais e realizou emissão real de homologação, com resultado parcial. NF-e autorizada e cancelada; NFC-e rejeitada por cadastro e inutilização com serviço desativado. Ver [teste de emissão](TESTE-EMISSAO-SP.md). O instalador e os testes de interface da versão 0.6.0 abaixo permanecem como foram entregues; o laboratório ainda não foi integrado à tela de vendas.

## Regras de negócio

`npm test`: 37 testes aprovados, incluindo sete do novo diagnóstico fiscal e os 30 cenários anteriores. Eles cobrem preservação de preços históricos, atomicidade em estoque insuficiente, produtos repetidos no carrinho, pagamentos parciais e limites, cancelamento com estornos por forma, fluxo de entrega e retirada, ajustes de estoque, validação monetária, backup íntegro e reabertura, relatórios e escape HTML de comprovantes. O teste adicional confere que um comprovante cancelado não apresenta o valor estornado como uma dívida.

## Interface desktop

O cenário automatizado em `scripts/test-ui.mjs` usa uma base própria e percorre cadastro de cliente/produto/entregador, criação do pedido, recebimento parcial e complementar, entrega, cancelamento, reposição, despesa de caixa, relatórios, configurações, reabertura e backup automático. A demonstração usa outra base com cadastros fictícios. O resultado final fica em `.test-artifacts/ui-result.json`.

A consulta de CEP usa uma base sintética isolada nos testes de interface: preenchimento automático, CEP não encontrado sem apagar campos, seleção de alternativas e gravação de CEP/UF. Os novos testes unitários verificam consulta somente leitura, entrada inválida, base ausente e migração de cadastros da versão anterior.

O grupo adicional valida menus, filtros por pagamento e entrega, abertura por F8, minimizar/restaurar módulo e largura de 1000px.

As capturas da interface real ficam em `.test-artifacts/screenshots`. Esses diretórios e bancos de teste não entram no Git.

Resultado confirmado em 23/10/2026: os quinze grupos de verificação de interface passaram, sem erros JavaScript no renderer. Também foram verificadas a ausência de `require`/`process` na página, a persistência após reiniciar e a criação do backup automático. A compilação TypeScript/Vite passou.

O mesmo cenário completo foi executado novamente em `release/win-unpacked/GasGestao.exe`, com `app.isPackaged=true`. Os quinze grupos também passaram no executável de distribuição, sem erros no renderer. O resultado está em `.test-artifacts/ui-result-packaged.json`.

O executável empacotado informa versão 0.6.0 e nome de produto GasGestao nos recursos do Windows. O instalador é gerado pelo electron-builder/NSIS; sua execução no perfil pessoal do usuário não faz parte dos testes automatizados. O fluxo de GitHub Actions foi incluído para a publicação; seu resultado remoto deve ser verificado separadamente dos testes locais.

## Limites

A validação automatizada não comprova integração com equipamentos de Bina, API de envio automático do WhatsApp, autorização de notas fiscais ou impressoras físicas. O teste fiscal real confirma somente status em homologação, detalhado abaixo. A abertura manual do WhatsApp com rascunho está disponível, mas a sessão real e a entrega de mensagens não foram testadas. A impressão usa o diálogo de impressão do Windows, e os comprovantes ainda precisam ser conferidos na impressora da operação.

Apenas a base de CEP original foi lida nos testes operacionais, com autorização do usuário. Seu hash permaneceu igual. Não foram usados bancos operacionais ou executáveis originais nesses testes. A inspeção fiscal posterior leu referências XML antigas em pasta privada; os limites estão no relatório de emissão.

## Inspeção de disponibilidade e RevGás

Em 23/10/2026, o executável 0.6.0 foi aberto e a interface clássica foi conferida visualmente. Foi criado um atalho GasGestão na Área de Trabalho. A consulta autenticada do RevGás ocorreu no navegador interno, sem salvar dados nem emitir documentos. Não é um novo teste de regressão ou de emissão; ver [estudo funcional](ESTUDO-REVGAS.md).

## Base local real

A conversão importou 1.131.462 endereços, descartou cinco registros incompletos e obteve `PRAGMA integrity_check=ok`. A consulta real de `18270-001` retornou Rua Onze de Agosto, Centro, Tatuí/SP, pela interface e pelo IPC do aplicativo, com a rede do contexto desabilitada. O teste não gravou clientes e também foi executado no aplicativo empacotado. Resultado local em `.test-artifacts/local-postal-result.json`.

A data de atualização dos dados da origem não foi confirmada. O instalador não inclui a base de CEP: neste computador ela já está instalada separadamente em `%LOCALAPPDATA%\GasGestao-Referencias\cep.sqlite`.

## Melhorias funcionais e layout preservado

Os quatro novos testes cobrem vetores oficiais de CNPJ numérico/alfanumérico e DV incorreto, máscaras/caracteres invisíveis em buscas, migração de esquema 2 com preservação de cliente/CEP e persistência das opções, restrição opcional de telefone, limites da margem e assinatura apenas para venda a prazo pendente.

Na interface, os grupos adicionais percorrem CNPJ inválido/válido, busca por telefone colado/CNPJ, margem 8, ativação da exigência de telefone, rejeição de cliente sem telefone e filtro de saldo pendente incluindo entregas já concluídas.

`scripts/test-receipt.mjs` valida o comprovante renderizado no Electron em mídia de impressão: deslocamento horizontal de 0 para cerca de 57px ao configurar oito colunas, CNPJ, assinatura e conteúdo dentro da página A4 simulada. Fonte e executável empacotado foram verificados. A captura fica em `.test-artifacts/screenshots/recibo-prazo.png`; os resultados em `.test-artifacts/receipt-result.json`.

Os arquivos de estilo/navegação clássicos não foram alterados. As capturas foram inspecionadas. A validação do recibo em tela não confirma o alinhamento de uma impressora física, que depende do papel e do driver.

## Três ideias aprovadas e mensagens — 0.5.0

Dez testes adicionais cobrem rascunho sem efeito financeiro/estoque, preços atuais na confirmação, alertas de estoque/inatividade, separação entre produtos, média de 4,5 dias, quantidade comprada, agrupamento por dia, cancelamento, pedido em andamento, contato/adiamento/pausa, link de WhatsApp, devolução excedente, migração de esquema 3 e backup. Outro cenário dentro desses testes verifica consultas além dos 500 pedidos da grade.

Além dos 15 grupos da regressão, `scripts/test-engagement-ui.mjs` executa quatro grupos completos na fonte e no executável: repetição de pedido pelo cliente e pelos detalhes; empréstimo/devolução; mensagem editada e link validado; persistência e janela de 1000px. Resultado em `.test-artifacts/engagement-ui.json` e `.test-artifacts/engagement-ui-packaged.json`.

Os testes usam cadastro fictício e perfil temporário. O modo de teste impede abrir o navegador do WhatsApp e escrever na área de transferência pessoal. Nenhuma mensagem externa foi enviada. Os resultados confirmam o rascunho e o link, não o login ou a entrega de mensagens na conta real do usuário.

As capturas de lembretes e vasilhames foram inspecionadas. O CSS clássico permanece igual. A atualização no aplicativo ocorre enquanto ele está aberto; não foi criado serviço para enviar notificações com o programa fechado.

## Diagnóstico fiscal e segurança — 0.6.0

Os sete testes adicionais verificam: rejeição de produção/destino arbitrário/entrada indevida; argumentos separados e processo oculto; aceitação somente de resposta compatível com homologação SP; lista permitida de metadados e ocultação de erros sensíveis; limite e sanitização do registro local; intervalo de consultas e persistência sem identificador do certificado; proteções do auxiliar TLS/XML e ausência de operação de emissão.

`scripts/test-fiscal-ui.mjs` percorre o menu, os dois modelos, isolamento do renderer, rejeição de parâmetros indevidos e janela de 1000px. A execução padrão utiliza certificado fictício e respostas marcadas como SIMULAÇÃO; foi testada na fonte e na distribuição. Essa captura foi inspecionada e não serve como comprovação de acesso à SEFAZ.

Com `--live`, o mesmo fluxo usa o certificado instalado no Windows, consulta os dois serviços reais e confirma a persistência após reiniciar. Fonte e executável empacotado retornaram **107 — Serviço em Operação** para NF-e 55 e NFC-e 65, com cadeia/revogação validadas e chave privada sem exportação. O auxiliar PowerShell empacotado foi executado a partir de `app.asar.unpacked`. Os testes usaram perfis temporários, sem alterar cadastros/caixa. Nenhum documento foi emitido e nenhum destino de produção foi acessado.

O resultado público mínimo fica em [resultado-sefaz.json](resultado-sefaz.json), sem nome/CNPJ/identificador de certificado. Os resultados locais mais detalhados ficam em `.test-artifacts/fiscal-ui-live.json` e `.test-artifacts/fiscal-ui-live-packaged.json`. `npm audit` reportou zero vulnerabilidades conhecidas na árvore instalada em 23/10/2026; isso não é garantia de segurança integral. O [estudo fiscal](FISCAL-SP.md) registra pendências, limites e as próximas validações.
