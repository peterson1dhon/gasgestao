# Perfis tributários, cálculos e impressão

Especificação de engenharia. Códigos observados em XMLs são referências, não aprovação para todos os produtos. A implementação não deve preencher campo desconhecido com zero, isento, CFOP genérico ou “sem pagamento” para obter autorização.

## Escopo inicial e bloqueios

Liberar inicialmente venda interna SP ordinária, CRT 3, modelos 55/65, perfis aprovados individualmente. Devolução, transferência, remessa, venda interestadual, exportação, complemento, ajuste, operação com benefício não suportado e substituição de NFC-e por NF-e ficam bloqueados com mensagem específica. O catálogo de CFOP continua consultivo.

GLP engarrafado e água comercializada não implicam implementar modelos especiais NFGas/NFAg. O escopo continua 55/65. Casco/vasilhame vendido, emprestado e retorno de embalagem são operações diferentes; não aplicar automaticamente a tributação do conteúdo.

## Dados necessários

| Origem | Campos e validação |
|---|---|
| Emitente versionado | CNPJ, IE, CRT, razão/nome, endereço estruturado, número, bairro, CEP, município IBGE, UF; configuração aprovada, nunca extraída de exemplo fictício |
| Cliente fiscal | Tipo/CPF/CNPJ, nome, IE/indIEDest, endereço estruturado e município; exigências por modelo/operação. Não confundir cliente sem documento permitido na NFC-e com CPF inválido. |
| Produto/perfil | Descrição, NCM, CEST quando aplicável, GTIN ou literal oficial apropriado, CFOP, origem, unidade comercial/tributável, fator exato, ICMS, PIS, COFINS, IBS/CBS, combustível/ANP, vigência e revisor |
| Pedido congelado | Itens/preços históricos, desconto, entrega/frete, quantidade, finalidade, destino, presença, consumidor final e plano de pagamentos |
| Compras/origem fiscal | Informações de retenção/monofasia e origem necessárias por produto/lote, quando aplicáveis; não reutilizar valores totais de outra venda |

Os produtos atuais não possuem perfil fiscal completo. O cadastro de cliente possui endereço livre e CNPJ opcional; CPF, IE e endereço fiscal não podem ser inferidos dessa string. Código IBGE não é CEP. Perfil deve incluir capacidade por modelo/UF/operação, período de validade, fonte e aprovação identificada.

## Referências observadas e divergências

| Produto | Referência observada | Ação antes de produção |
|---|---|---|
| GLP P13 | NCM 27111910; CEST 0601100; CFOP 5656; ICMS 61; ANP 210203001; PIS/COFINS 04; IBS/CBS CST 620 e classe 620006 | Confirmar cadastro/fornecedor, composição e origem. Implementar IBS/CBS monofásico conforme política vigente e perfil aprovado. |
| Água | NCM 22011000; referências com 5405/60 e com 5102/00; PIS/COFINS 04 ou 06; classe 000001 | Resolver divergência pela operação, embalagem e vigência. Não oferecer escolha arbitrária entre exemplos. |
| Água em embalagens distintas | Mesmo CEST observado e unidade tributável LT com fator aparente 1 | Validar CEST por apresentação e conversão real; 20 L e 510 ml não recebem automaticamente o mesmo fator. |

O laboratório GLP cobre uma unidade P13, origem única e pGLP 100; não prova suporte a P45, misturas ou múltiplas origens. Grupo de origem repetido exige coleção estruturada; o leitor de referência atual achata caminhos e não serve de serializador completo.

## Aritmética

Usar BigInt escalado internamente, serializado em strings decimais. Centavos para totais finais; precisão de quantidade, preço unitário e alíquota segundo cada campo XSD (por exemplo quantidades com até 4 casas e preços unitários com até 10). Nunca usar parseFloat/toFixed como motor de cálculo. Arredondamento decimal explícito e testado por regra; somar valores dos itens já calculados quando o leiaute exigir soma.

Rateio de desconto/frete: proporcional ao valor bruto elegível, em centavos; distribuir restos pelo maior resto fracionário com desempate estável por item. Documentar separadamente quais parcelas compõem cada base tributária. Não descontar mais que o valor elegível; excluir itens de base zero e rejeitar rateio impossível. Frete no pedido não pode ser apenas somado a vNF sem a classificação fiscal correspondente.

Vetores sintéticos mínimos:

- Três itens de 100 centavos, desconto total de 1: distribuição determinística [1,0,0] com IDs ordenados. Soma dos descontos = 1, nenhum centavo criado.
- P13, quantidade tributável 13,0000 KG e alíquota histórica ICMS retido 1,4700: 19,11. É exemplo aritmético, não declaração de alíquota vigente; retenção não é imposto novo somado ao preço.
- Perfil sintético com base IBS/CBS 82,00, alíquotas 0,1% e 0,9%: 0,08 e 0,74. Não concluir que toda água de R$ 100 terá base 82; demais exclusões/componentes dependem do perfil.
- Conversão aprovada 1 embalagem de 20 L: qTrib 20,0000, não 1,0000; testar também frações de litro e precisão do preço tributável sem alterar total comercial.

Totais ICMS/PIS/COFINS/IBS/CBS e vNF/vNFTot precisam de reconciliação própria. Não adaptar apenas a prévia atual. Manter 2026 separado de regras de 2027; configuração sem política válida para dhEmi bloqueia emissão. vTotTrib/IBPT e informações adicionais exigem fonte/vigência quando aplicáveis; não fabricar percentuais.

## Pagamentos

Tabela nacional distingue Pix dinâmico (17) de Pix estático/transferência (20). A opção `pix` atual é insuficiente: coletar subtipo/configuração do recebimento. Dinheiro 01, crédito 03, débito 04. Crediário 05 pode representar venda a prazo se enquadramento confirmado; 90 significa sem pagamento e não deve representar automaticamente fiado. 99 exige descrição. [Tabela oficial](https://www.nfe.fazenda.gov.br/portal/exibirArquivo.aspx?conteudo=i4LxLcsXUHc%3D).

O plano de pagamento fiscal representa a operação, enquanto `paid_cents` representa recebimentos já registrados. Venda a prazo pode ter pagamento previsto sem baixa financeira. Suportar mistura de meios, timing, troco e dados de cartão quando exigidos. Não marcar venda como paga para satisfazer o XML. Não inventar autorização/credenciadora de cartão não integrado.

## DANFE e QR

NF-e 55: implementar DANFE padrão A4 conforme MOC Anexo II, não chamar recibo atual de DANFE. NFC-e: documento térmico inicialmente 80 mm, manual v6, QR v3. 58 mm somente após layout e teste físico próprios. DANFE Simplificado Tipo 2 fica fora da primeira entrega; possui requisitos específicos da NT 2026.002.

Gerar HTML/CSS isolado com escape de todo texto e sem recursos externos, a partir do snapshot e protocolo persistidos. Usar printToPDF/print em BrowserWindow sandboxed sem Node. Não regenerar conteúdo fiscal a partir de cadastros atuais. Incluir identificação de homologação, dados obrigatórios, chave/código de barras, protocolo/data, totais e impostos aplicáveis. Reimpressão não emite nova nota. Documento cancelado deve ficar claramente identificado; documento incerto não imprime como autorizado.

QR v3 online usa chave, versão 3 e ambiente separados por `|`, na URL oficial do ambiente. Implementar exatamente a serialização do manual e validar leitura independente. QR offline v3 inclui outros parâmetros e assinatura específica; não reutilizar algoritmo CSC v2. Contingência offline é etapa separada e permanece bloqueada até requisitos legais/técnicos e prazo estadual estarem documentados e testados. [Manual v6](https://www.nfe.fazenda.gov.br/portal/exibirArquivo.aspx?conteudo=k%2FIuuaW4YiY%3D).

Testar escala real, margens, textos longos, acentuação, paginação, muitos itens, rodapé, Code128 e QR em papel. Renderizar PDF não comprova leitura em impressora térmica. O usuário deve confirmar impressora e largura na etapa de liberação.
