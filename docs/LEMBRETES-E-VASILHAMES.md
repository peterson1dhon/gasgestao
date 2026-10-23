# Repetição, lembretes e vasilhames — 0.5.0

As três sugestões foram aprovadas pelo usuário e implementadas, incluindo a preparação de mensagem para o cliente. O estilo clássico foi mantido; os novos módulos usam os mesmos diálogos, campos e grades. Não houve alteração do CSS clássico.

## Repetir pedido

Há duas entradas:

- Em **Clientes**, o ícone de pedido ao lado de editar abre o último pedido não cancelado daquele cliente.
- Nos detalhes de um pedido, **Repetir pedido** abre aquele pedido como base.

A ação abre um rascunho para revisão. Não cria pedido, recebimento ou reserva de estoque. Itens e quantidades são sugeridos; os preços são os atuais do catálogo. O endereço e a taxa anterior são copiados para conferência. Desconto e recebimentos começam zerados; o pagamento não é herdado. Confira esses valores antes de criar.

A confirmação continua usando a transação normal de pedido, com validação de cliente/produto ativo e estoque. Produto inativo ou estoque abaixo da quantidade sugerida gera aviso no rascunho; o operador precisa remover, substituir ou corrigir o item. Pedido cancelado e cliente inativo não podem ser usados como base.

A consulta ao último pedido usa todo o banco, inclusive pedidos anteriores aos 500 mostrados na tela.

## Lembretes de recompra

Abra **Utilitários → Lembretes de recompra (N)**. O número indica sugestões pendentes de revisão. Ao iniciar, o aplicativo avisa se houver lembretes; a lista e a contagem são atualizadas a cada minuto enquanto o aplicativo está aberto. Não há serviço de aviso rodando com o programa fechado.

O cálculo é feito separadamente para cada cliente e produto:

1. Usa somente compras concluídas, com status Entregue/retirada concluída. Cancelamentos e pedidos não concluídos não contam como consumo.
2. Agrupa compras do mesmo produto no mesmo dia para não criar intervalos artificiais.
3. Exige no mínimo três datas de compra. Considera no máximo as sete datas mais recentes, permitindo até seis intervalos.
4. Divide cada intervalo pela quantidade da compra anterior e calcula a média em dias por unidade.
5. Multiplica essa média pela quantidade da última compra para estimar a próxima reposição. Arredonda o prazo para dias inteiros, com mínimo de um dia.

Exemplos conferidos nos testes: gás comprado a cada 30 dias gera média de 30 dias; água comprada com intervalos de quatro e cinco dias gera média de 4,5 dias e previsão de cinco dias para uma unidade. Duas unidades na última compra prolongam a previsão, conforme a mesma estimativa de consumo.

A previsão não comprova que o produto acabou. Compras irregulares ou mudanças de consumo podem reduzir sua precisão. Cliente/produto inativo não gera sugestão. Um pedido em andamento para o mesmo cliente e produto evita nova indicação de contato. As consultas consideram o histórico completo do banco, além dos limites da grade de pedidos.

Por padrão aparecem apenas os lembretes vencidos ou previstos para hoje que ainda precisam de revisão. **Mostrar próximos e já tratados** permite consultar previsões futuras, contatos registrados, adiamentos e clientes pausados.

## Mensagem e WhatsApp

Ao selecionar um lembrete, o programa prepara uma mensagem com cliente, produto e nome da revenda. Exemplo editável:

> Olá, Maria! Tudo bem? Aqui é da Minha revenda. Está precisando repor Água 20 L? Se quiser, podemos combinar uma entrega no melhor horário para você.

O operador pode editar, copiar ou clicar em **Abrir WhatsApp com mensagem**. O aplicativo usa o formato oficial [clique para conversa](https://faq.whatsapp.com/5913398998672934/?locale=pt_BR), com telefone internacional e texto codificado. Não recebe um endereço externo arbitrário do renderer. A implementação atual atende telefones brasileiros com DDD, acrescentando 55 quando necessário.

A abertura do link depende do navegador/aplicativo de WhatsApp disponível e do acesso à internet. O texto é preparado; o envio continua sendo confirmado pelo operador no WhatsApp. Não há disparo automático, integração com a API Business, agendamento de envio ou confirmação de entrega/leitura.

O histórico diferencia:

- **Link aberto:** registra a abertura solicitada ao Windows; não significa mensagem enviada.
- **Registrar contato realizado:** ação manual após o atendimento. Guarda data e texto e evita repetir o lembrete no mesmo ciclo de compra.
- **Adiar lembrete:** retira a sugestão por um número de dias, sem modificar as compras.
- **Desativar lembretes do cliente:** pausa todos os produtos desse cliente. Pode ser revertido na lista completa.

Uma nova compra concluída abre um novo ciclo e permite nova previsão. Gás e água permanecem independentes. Registrar contato para água não registra contato para gás. A cópia de texto pode ser usada mesmo se o telefone ainda não estiver cadastrado; a abertura do WhatsApp exige um número válido.

O aplicativo não agenda automaticamente uma entrega quando a mensagem oferece combinar horário: o atendimento e a criação do pedido continuam sendo feitos pelo operador.

## Vasilhames emprestados

Abra **Movimentos → Vasilhames emprestados**.

Selecione cliente, tipo de vasilhame/produto, empréstimo ou devolução, quantidade e motivo/referência. Os saldos são separados por cliente e produto. A devolução pode ser parcial e não pode ultrapassar o saldo emprestado. Os registros mantêm data e motivo.

O cadastro de produtos existente identifica o tipo de recipiente, por exemplo galão de Água 20 L ou casco de Gás P13. Esse livro de empréstimos não movimenta o estoque de produto cheio e não altera o caixa. Caução, comodato financeiro e cobrança automática não foram acrescentados. O operador registra separadamente os recipientes efetivamente emprestados ou retornados.

É possível receber devolução de cliente/produto que tenha sido inativado depois do empréstimo. Novos empréstimos exigem cadastros ativos. A aba Saldos considera todos os movimentos; a aba Histórico mostra os 500 mais recentes. Os saldos não são limitados a esses 500 registros.

## Persistência e testes

Esquema SQLite versão 4, com tabelas de movimentos de vasilhames, preferências e eventos de lembrete. A migração preserva cadastros, CEPs, CNPJs, pedidos e recebimentos. O backup completo inclui os novos registros.

`npm test`: 30 testes aprovados. `npm run test:ui`: 15 grupos de regressão. `npm run test:engagement`: quatro grupos específicos, com o mesmo cenário executado no programa empacotado. São verificadas repetição, preço atual, estoque, empréstimo/devolução, média por produto, mensagem editada, link codificado, contato, adiamento, pausa e persistência após reiniciar.

Nos testes de interface, `GASGESTAO_TEST=1` impede abrir o navegador e impede escrever na área de transferência pessoal. Não foram enviadas mensagens nem usados contatos reais. Isso valida a preparação do link e os fluxos internos; a sessão real do WhatsApp do usuário não foi acessada.
