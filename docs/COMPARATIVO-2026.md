# Levantamento: GasExpert 2026 e GasGestão 0.4.0

Consulta realizada em 23/10/2026. Comparação baseada na documentação pública do fabricante; o executável GasExpert 2026 não foi instalado nem testado nesta etapa. Não há afirmação de equivalência completa entre os programas.

## Fontes

- [Atualizações oficiais, com seções separadas de 2026 e 2025](https://www.maikonlyne.com.br/pagina/atualizacoes).
- [Página oficial de downloads que identifica a edição 2026](https://www.maikonlyne.com.br/pagina/downloads).
- [Inventário geral de funções do produto](https://www.maikonlyne.com.br/produto/2724/gas-expert-2017-software-disk-gas,-agua-e-bebidas).
- [Documentação técnica da Receita Federal para cálculo do DV](https://www.gov.br/receitafederal/pt-br/centrais-de-conteudo/publicacoes/documentos-tecnicos/cnpj).

## Novidades publicadas e decisão

| Referência | Recurso publicado | Situação no GasGestão 0.4.0 |
|---|---|---|
| 2026 | CNPJ alfanumérico | Implementado no cliente, busca, CSV e comprovante; aceita também o numérico. |
| 2026 | Margem esquerda de recibos | Configuração de 0 a 40 colunas, restrita à impressão. |
| 2026 | Wallpapers | Excluídos desta entrega conforme pedido de preservar o layout. |
| 2026 | Melhorias internas genéricas | Sem detalhes públicos suficientes para estabelecer equivalência. |
| 2025 | Busca com caracteres invisíveis | Implementada; aceita também telefone formatado e acentos. |
| 2025 | Telefone obrigatório opcional | Implementado, desligado por padrão. |
| 2025 | Assinatura em recibo a prazo via WhatsApp | Adaptada ao comprovante impresso; envio pelo WhatsApp continua ausente. |
| 2025 | Filtro de pedidos sem pagamento definido | Nosso modelo sempre exige uma forma; foi acrescentado filtro de saldo pendente, que inclui entregas concluídas. Os critérios são diferentes. |
| 2025 | Ampliação da base de CEP | A base local permanece com 1.131.462 registros. Não foi obtida nem confirmada uma atualização. |

A coluna “Referência” distingue os recursos explicitamente anunciados para 2026 das melhorias publicadas em 2025. Nada foi atribuído à versão 2026 apenas por estar na mesma página.

## Diferenças funcionais maiores

O inventário do fabricante também menciona veículos, fornecedores, tabelas de preços, carregamentos, acertos, contas a pagar/receber, comissões, previsão de vendas, empréstimos, usuários e auditoria. Esses itens pertencem à lista geral do produto e não foram tratados como novidades de 2026.

O nosso programa já tem cadastro básico, pedidos, estoque, recebimentos parciais, cancelamentos, caixa, relatórios, CEP e backups. Ainda não oferece os módulos completos de frota, compras/fornecedores, tabelas especiais de preço, carregamento/acerto, contas a pagar, comissões, empréstimos, autenticação, auditoria ou previsão de vendas. O saldo a receber dos pedidos não equivale a um módulo completo de contas a receber. Bina, WhatsApp e emissão fiscal continuam pendentes.

## Como usar o que foi implementado

- **Clientes → Incluir/Editar:** o CNPJ opcional ocupa a célula antes vazia ao lado do telefone; nenhum campo anterior foi deslocado. O formato e os dígitos verificadores são validados localmente. Não é feita consulta de situação cadastral na Receita. Minúsculas são normalizadas para maiúsculas.
- **Busca de clientes:** aceita nomes com acentos, texto com caracteres invisíveis e telefone/CNPJ com máscara. Os dados armazenados não são alterados pela busca.
- **Pedidos → Situação → Pagamento pendente:** mostra saldo maior que zero, excluindo cancelados, inclusive quando o pedido já foi entregue. Os demais filtros de data, entrega e forma de pagamento continuam combinados.
- **Configurações → Opções de cadastro e impressão:** a margem fica entre 0 e 40 colunas; a opção de exigir telefone pode ser ativada e desativada. Cadastros existentes não são alterados ao ativar essa opção.
- **Comprovante impresso:** inclui o CNPJ quando informado e espaço para assinatura quando a venda é a prazo e ainda tem saldo. Não mostra assinatura em cancelamento ou pedido já quitado. A impressão continua sem valor fiscal.

## Preservação do layout e dos dados

`src/classic.css`, `src/classic.tsx` e os ícones mantiveram seu conteúdo. As barras, cores, menus, grades e organização das janelas foram preservadas. As novas configurações ficam recolhidas em um detalhe da tela já existente. A correção de foco dos formulários não altera o visual.

A migração de banco acrescenta CNPJ vazio e mantém os clientes e CEPs existentes. As novas configurações começam com margem zero e telefone opcional. Os testes usam perfis separados, sem editar o banco pessoal nem a instalação original.

## Ideias propostas na versão 0.4.0

Atualização: o usuário aprovou as três ideias, implementadas na 0.5.0. A lista abaixo registra as propostas originais. Veja [o guia atual](LEMBRETES-E-VASILHAMES.md).

1. **Repetir o último pedido:** carregar os itens e endereço anteriores para revisão, consultando preço e estoque atuais antes de confirmar. Evita redigitação sem criar venda automaticamente.
2. **Lembrete de possível recompra:** mostrar clientes que podem estar próximos de pedir novamente, a partir do intervalo real de compras. Sem enviar mensagens automaticamente.
3. **Controle de vasilhames emprestados:** registrar entrega e retorno por cliente, com saldo e histórico. Exige definir antes como a revenda trata cascos, cauções e comodatos.

## Validação

20 testes automatizados, 15 grupos de interface na fonte e no executável empacotado, verificação visual do comprovante em modo de impressão e consulta real de CEP offline. Ver [VALIDACAO.md](VALIDACAO.md). Não foi validada uma impressora física nem a execução do instalador no perfil pessoal.
