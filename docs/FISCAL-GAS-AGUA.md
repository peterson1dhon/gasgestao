# Campos fiscais de gás e água — 0.7.0

**Avanço de 24/10/2026:** o laboratório do código agora gera XMLs GLP/água e validou o ciclo de duas NF-e em homologação; veja [resultados e limites](TESTE-GLP-AGUA.md). A consulta/prévia da interface 0.7.0 descrita abaixo permanece igual, sem emissão pelo pedido.

## Levantamento e códigos

Em 23/10/2026 foram consultadas as opções de saída do RevGás e baixados, pela interface autorizada, três XMLs já emitidos, com cinco itens. O novo leitor verificou matematicamente as três assinaturas e a compatibilidade de chave/digest com o protocolo presente no arquivo. Isso não verifica a autenticidade do protocolo na SEFAZ, a cadeia/revogação do certificado ou a situação atual da nota.

Foram retidos entre 89 e 94 campos por item: produto, ICMS, PIS, COFINS, IBS/CBS, combustível/ANP, natureza e indicadores de operação, modalidade de frete, código de pagamento e totais. O catálogo não inclui identificação pessoal do destinatário, chave completa, número da nota, certificado ou XML completo. Os originais permanecem privados, fora do Git.

| Referência observada | NCM | CEST observado | CFOP | ICMS CST | PIS/COFINS CST | IBS/CBS CST e cClassTrib |
|---|---|---|---|---|---|---|
| GLP P13 | 27111910 | 0601100 | 5656 | 61 | 04/04 | 620 / 620006 |
| Água, uma referência | 22011000 | 0300500 | 5405 | 60 | 04/04 | 000 / 000001 |
| Água, outras referências | 22011000 | 0300500 | 5102 | 00 | 06/06 | 000 / 000001 |

São observações dos arquivos, não indicação automática para vendas futuras nem atestado de correção das notas anteriores. Faltam amostras suficientes para P45, todos os tamanhos de água, NFC-e e cada operação.

O GLP inclui ANP, composição, valor de partida, UF de consumo, origem do combustível e ICMS monofásico retido anteriormente. As folhas desses grupos, inclusive repetições, são preservadas; ausência não vira zero automaticamente. O seletor de saída apresentou 40 opções, algumas em pares interno/interestadual, registradas para consulta: não são 40 operações de emissão implementadas.

## Revisão necessária

A mesma água possui códigos diferentes entre referências. Unidade comercial, tributável, quantidades e apresentação/CEST também exigem conferência; não se deve aplicar um código indistintamente a garrafas, fardos e galões.

A [Portaria SRE 9/2026](https://legislacao.fazenda.sp.gov.br/Paginas/Portaria-SRE-9-de-2026.aspx), com efeitos a partir de 01/07/2026, excluiu itens de bebidas/água da ST e determinou tratamento do estoque. Referências de água com ST em SP após essa data recebem alerta prioritário. A revisão deve considerar produto, operação e estoque, sem concluir automaticamente que toda nota anterior está errada.

A [RC 34216/2026 da SEFAZ-SP](https://legislacao.fazenda.sp.gov.br/Paginas/RC34216_2026.aspx) descreve CST 61, CFOP 5656 e campos monofásicos na situação de varejo nela examinada. O IBS/CBS deve ser confrontado com a [tabela oficial de classificação tributária](https://dfe-portal.svrs.rs.gov.br/Cff/ClassificacaoTributaria). Essas fontes orientam a revisão, sem substituir a parametrização da empresa.

## Funções disponíveis

Abra **Utilitários → Diagnóstico fiscal SP → Referências fiscais gás e água**:

- Importe de um a 30 XMLs locais por vez, sem duplicar arquivos repetidos.
- Consulte e busque campos/valores, preservando zeros iniciais e variantes.
- Vincule a referência ao produto cadastrado, sempre em revisão.
- Veja alertas de divergências, conversão, apresentação/CEST e ST em SP.
- Consulte as 40 opções de operação levantadas.
- Calcule uma prévia sem criar venda, reserva, pagamento ou transmissão.

A prévia cobre somente venda simples interna de 2026, CRT 3/SP, CFOP 5102/5405/5656, ICMS 00/60/61, PIS/COFINS sem cálculo nos grupos previstos e IBS/CBS 000 ou 620006. Usa o fator da referência sem corrigir divergências automaticamente. Não calcula descontos, frete, benefícios, outros tributos ou operações diferentes. Outros códigos ficam consultáveis e são recusados pelo cálculo ainda não implementado.

Os cálculos usam inteiros com escala decimal. O ICMS anteriormente retido aparece separado e não é somado ao preço; IBS/CBS do exemplo de 2026 também não é acrescido ao total. A prévia não é um XML fiscal emitível.

## Dados, segurança e testes

O esquema SQLite passou para 5. Catálogo e vínculos entram no backup completo; XMLs completos não são copiados para o banco. Importar não altera produtos, preços, estoque, pedidos ou caixa. O seletor pertence ao processo principal e não fornece leitura arbitrária ao renderer. O parser limita tamanho/profundidade/saída, proíbe DTD/resolução externa e recusa assinatura adulterada.

48 testes locais foram aprovados, incluindo XML sintético assinado, rejeição de adulteração/DTD, migração, idempotência, backup, vínculo, arredondamento e divergências. A nova interface foi testada com dados fictícios, reinício, cálculo P13, isolamento e largura de 1000px. A regressão operacional e o diagnóstico simulado também passaram na fonte. Resultados da distribuição em [Validação](VALIDACAO.md).

Não houve nova emissão ou mudança de cadastro/configuração no RevGás. Foi solicitada a geração do arquivo mensal de outubro, mas não houve confirmação de conclusão/download; esse arquivo não integra as evidências. Os três XMLs individuais foram baixados com sucesso.

O levantamento utiliza controles acessíveis e XMLs exportados; não representa acesso ao código do servidor do RevGás. O REA/Ghidra sobre o GasExpert local tem [registro separado](ENGENHARIA-REVERSA.md). CSS e navegação clássicos foram preservados.

A emissão no pedido continua pendente: parâmetros revisados, XML integral, credenciamento/testes NFC-e, DANFE, eventos e recuperação de falhas. O ciclo de NF-e anteriormente aprovado em homologação usou exemplo genérico, não a tributação real do GLP; ver [teste de emissão](TESTE-EMISSAO-SP.md).
