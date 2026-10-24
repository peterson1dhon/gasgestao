# Laboratório fiscal de gás e água — 24/10/2026

**Duas NF-e fictícias de R$ 1,00 foram autorizadas e canceladas na homologação da SEFAZ-SP: uma com a estrutura de GLP e outra com a estrutura de água tributada.** O resultado é técnico; não aprova o enquadramento da empresa para vendas reais. A emissão pela tela de pedidos permanece pendente e o instalador continua na versão 0.7.0.

## Resultado comprovado

| Etapa | GLP, modelo 55 | Água, modelo 55 |
| --- | --- | --- |
| XML, assinatura A1 e XSD oficial 010f | Aprovados | Aprovados |
| Assinatura após salvar/reabrir | Aprovada | Aprovada |
| Autorização com protocolo e digest compatíveis | 100 | 100 |
| Consulta antes de cancelar | 100 | 100 |
| Evento de cancelamento | 135 | 135 |
| Consulta depois de cancelar | 101 | 101 |
| Segunda autorização da mesma chave | Bloqueada localmente | Bloqueada localmente |

Antes desse envio, quatro referências (GLP e três apresentações de água) geraram oito XMLs para os modelos 55 e 65: todos passaram na assinatura A1, XSD e verificação após reabrir. **NFC-e não foi transmitida nesta rodada**: continua a pendência de credenciamento de homologação descrita no [teste anterior](TESTE-EMISSAO-SP.md).

O cadastro oficial confirmou inscrição ativa e regime normal antes da preparação. Água com ST foi recusada pelo gerador. Tentativa de produção foi bloqueada antes de usar o certificado; alteração do XML assinado foi detectada. Os três XMLs de referência permaneceram byte a byte inalterados. Pedidos, estoque, caixa e configurações do RevGás não foram modificados.

Evidências sem CNPJ, consumidor, chave, número da nota, protocolo ou seletor de certificado: [resultado-glp-agua.json](resultado-glp-agua.json). Originais e respostas completas ficam somente na pasta privada `%LOCALAPPDATA%\GasGestao-Fiscal-Homologacao`, fora do Git.

## Implementação nova

O gerador próprio reutiliza o envelope de homologação e constrói item e totais novamente, sem copiar o XML comercial. Usa série 829, ambiente 2, valor fixo de R$ 1,00, uma unidade comercial e destinatário fictício de teste. A sequência é persistida sob o mesmo bloqueio do laboratório anterior.

- GLP: NCM/CEST/CFOP, ANP, composição, valor de partida, origem e UF de consumo, ICMS 61 e IBS/CBS 620006. A base monofásica é independente da quantidade tributável; o ICMS anteriormente retido não é acrescido ao preço.
- Água: CFOP 5102, ICMS 00, PIS/COFINS não tributados nos grupos suportados e IBS/CBS 000001. Bases, impostos e valor unitário tributável são recalculados para o documento fictício, com inteiros e arredondamento decimal.
- O valor histórico aproximado `vTotTrib` não é copiado: estimativa IBPT ainda não implementada neste laboratório.

Misturas/múltiplas origens de combustível, ST da água, outros impostos, benefícios/reduções, referências incompletas ou grupos repetidos são recusados. O código não configura produtos automaticamente nem oferece emissão em produção.

## Limites que continuam

A autorização de homologação não confirma a correção de CEST, conversões de embalagem/unidade, incidência, alíquotas ou classificação tributária. Esses pontos continuam em revisão, sobretudo a divergência das referências de água e a [Portaria SRE 9/2026](https://legislacao.fazenda.sp.gov.br/Paginas/Portaria-SRE-9-de-2026.aspx). A revisão de IBS/CBS deve usar as tabelas oficiais vigentes, como o [Portal de Conformidade Fácil](https://dfe-portal.svrs.rs.gov.br/Cff/ClassificacaoTributaria).

Não há cobertura de P45, todas as operações do catálogo, vários itens por nota, descontos/frete, tributos fora dos grupos suportados, DANFE/impressão física, contingência ou recuperação de interrupção real. O teste não resolveu a rejeição 245 da NFC-e nem o retorno 998 da inutilização. Faltam parâmetros revisados e integração transacional entre o estado fiscal e o pedido para operação diária.

## Verificação e execução

52 testes automatizados e a compilação foram aprovados. A interface existente de referências também passou nas cinco verificações com dados fictícios, sem emitir documentos. Os quatro novos testes cobrem XML GLP/água, bases independentes, arredondamento/conversão, preservação da referência, escaping e bloqueios de entradas/grupos não suportados. Não usam o A1 nem acessam a SEFAZ.

`node scripts/test-fiscal-reference-emission.mjs` usa os três XMLs privados e o A1 instalado: consulta o cadastro em homologação, gera oito documentos, assina e valida localmente. Não solicita autorização de nota. Exige o perfil e os esquemas oficiais locais; não integra o CI.

`--issue` prepara somente duas NF-e 55, uma por cenário, e executa autorização, consulta, cancelamento e consulta final. Não envia NFC-e. Uma resposta de transporte incerta encerra os próximos envios sem repetir a autorização. Os resultados acima já foram obtidos: não repetir emissões reais apenas para repetir testes aprovados.

O layout, a navegação e o banco do aplicativo não mudaram nesta etapa. Este avanço é do laboratório no código-fonte; não foi gerado outro instalador.
