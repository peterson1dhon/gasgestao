# Engenharia reversa com REA e Ghidra

Retomada executada em 23/10/2026, com REA 6.7.0 e Ghidra 12.1.4, no Windows. O diagnóstico do provedor Ghidra passou. A inspeção das telas do RevGás é um estudo separado e não foi apresentada como descompilação desse serviço.

## Escopo e resultado

Foram usadas cópias locais autorizadas do GasExpert 2020 para entender estrutura e funções. A análise foi estática, sem iniciar o executável nem modificar seus bytes. Os resultados brutos permanecem em pasta local de análise, fora deste repositório.

| Alvo | Funções reconhecidas | Importações de DLLs | Rotinas locais | Resultado |
|---|---:|---:|---:|---|
| Executável instalado, análise anterior | 13 | 11 | 2 | Carregador visível; regras de negócio não recuperadas. |
| Outra cópia da mesma versão, extraída do arquivo antigo | 14 | 11 | 3 | Entrada e rotina sobreposta relacionadas ao carregador; terceira rotina com instruções inválidas. Nenhuma regra comercial recuperada com confiança. |

Os dois executáveis informam versão 12.05.0044 e têm hashes diferentes. Isso não demonstra que a cópia alternativa seja mais recente ou mais completa. Ambos apresentam fortes indícios de compactação/proteção.

Na retomada, duas sessões reais do REA por MCP completaram 18 operações: abertura, inventário, funções, textos, pseudocódigo, assembly e fechamento. As três rotinas locais da cópia alternativa foram examinadas. O fato de o Ghidra reconhecer uma rotina não prova que ela seja código válido de cadastro, venda, estoque ou caixa.

## Integridade e limites

- O SHA-256 do executável original continua igual ao registro anterior e à cópia analisada.
- As duas sessões confirmaram que a cópia alternativa permaneceu intacta.
- O alvo não foi executado, e não foram alterados licença, proteção, bancos ou configurações do programa original.
- O runtime Visual Basic 6 e a estrutura PE x86 foram identificados anteriormente. O projeto-fonte original não foi recuperado.
- Os bancos comerciais protegidos permanecem sem esquema recuperado. A base de CEP, acessível separadamente, já foi integrada ao GasGestão; isso não equivale a recuperar os bancos de pedidos.
- Não foram publicados executáveis, bancos, recursos gráficos, pseudocódigo ou assembly do programa original.

## Consequência para o GasGestão

O GasGestão continua sendo uma implementação própria. Seus testes validam suas próprias regras; não comprovam equivalência com todas as regras do programa original. O layout clássico permanece preservado.

A análise estática disponível chegou ao limite da camada de proteção. Para complementar o mapa funcional, o próximo caminho útil é observar telas e entradas/saídas numa instalação de teste isolada, ou usar exportações documentadas e autorizadas. Isso ainda não foi executado nesta retomada. Não apresentar o código interno do GasExpert como recuperado.

Consulte também o [estudo funcional do RevGás](ESTUDO-REVGAS.md) e os [resultados próprios de validação](VALIDACAO.md).
