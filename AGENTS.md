# GasGestão Desktop

Aplicativo Windows de gestão local. Converse em português. O código é uma implementação nova, com interface e dados próprios.

- Não copie executáveis, bancos, configurações secretas, código descompilado ou recursos visuais do GasExpert para este repositório.
- Dados operacionais ficam no diretório de dados do aplicativo, nunca no código-fonte ou no Git.
- Valores monetários são inteiros em centavos. Estoque e movimentações financeiras precisam ser transacionais.
- Mudanças em pedidos devem preservar a coerência entre estoque, pagamentos e cancelamentos.
- Não habilite Node.js no renderer; exponha somente operações específicas pelo preload.
- Rode `npm test`, `npm run build` e os testes de interface pertinentes antes de entregar.
- Mantenha README, CHANGELOG e o roteiro de desenvolvimento coerentes com o que realmente funciona.
- Não apresente integrações planejadas como disponíveis.
