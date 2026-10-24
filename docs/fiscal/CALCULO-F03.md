# Contrato do cálculo fiscal F03

Estado em 24/10/2026: prévia matemática implementada em `electron/fiscal/calculator.mjs` e ligada a `runPreflight`. Não assina, reserva número, transmite ou autoriza nota. Um cálculo que fecha retorna `calculation`, mas o preflight mantém `F04_DOCUMENT_NOT_IMPLEMENTED`. A aplicação empacotada ainda não recebeu esta mudança.

## Perfil aceito nesta etapa

O perfil persistido é uma versão aprovada com revisor, data e vigência. Para água no caminho ordinário: `operation=internal_sale_sp`, `uf=SP`, modelo 55 ou 65 declarado, NCM `22011000`, CFOP `5102`, `taxableFactor` textual e quatro regras explícitas em `taxes`: ICMS `00` ad valorem, PIS/COFINS `04` sem cálculo ou `06` ad valorem, IBS/CBS `000/000001` padrão. É necessário informar as bases aplicáveis e taxas. Outros CFOPs, ST/60, benefícios, classes, grupos ou campos de imposto não são ignorados: o motor bloqueia.

O exemplo de R$ 100,00 com ICMS 18%, PIS/COFINS `04`, base de IBS/CBS de R$ 82,00, IBS UF 0,1%, IBS município 0% e CBS 0,9% produz ICMS R$ 18,00, IBS UF R$ 0,08, IBS município R$ 0,00 e CBS R$ 0,74. **É um vetor sintético.** A fórmula da base e o enquadramento de cada SKU precisam da revisão E03; o programa não presume que toda venda de água tenha esse resultado. Em 2026, a prévia mantém o preço de R$ 100,00 sem somar os valores IBS/CBS ao total cobrado, conforme a regra transitória versionada.

As alíquotas do grupo padrão 2026 ficam fixas na política `SP-RTC-2026-NT2025.002-v1.52`. Perfil com taxa diferente é recusado. O código bloqueia datas anteriores a 2026 e a partir de 2027. Antes de avançar para F04, verificar novamente [NT 2025.002 v1.52](https://www.nfe.fazenda.gov.br/portal/exibirArquivo.aspx?conteudo=HXPO8VLbh4o%3D), o [XSD 010f](https://www.nfe.fazenda.gov.br/portal/exibirArquivo.aspx?conteudo=8ITFuBLltXs=) e a [tabela cClassTrib](https://www.nfe.fazenda.gov.br/portal/exibirArquivo.aspx?conteudo=Cd5xq2ZVuEg%3D).

## Contas e invariantes

- Multiplicar quantidade comercial (até 4 casas) pelo preço unitário (até 10) e arredondar vProd para centavos. Rejeitar valor/precisão inválidos.
- Converter qCom em qTrib pelo fator explícito do perfil. Derivar vUnTrib com até 10 casas e verificar que qTrib × vUnTrib volta ao mesmo vProd em centavos. P13 com fator 13,0000 e galão com fator 20,0000 são vetores; a apresentação real do produto deve ser confirmada.
- Ratear desconto e frete por valor bruto, usando maiores restos e desempate por ID de item. Nenhum centavo desaparece. A taxa de entrega operacional só vira frete fiscal se receber classificação explícita revisada; caso contrário, o preflight falha.
- Bases calculadas: `adjusted` (bruto menos desconto mais frete), `adjustedLessIcms` ou `adjustedLessIcmsPisCofins`. São **operações matemáticas configuráveis**, não determinação legal automática de base. Perfil aprovado precisa selecionar a correta para cada tributo.
- ICMS retido monofásico de GLP pode ser calculado por qTrib × ad rem, separado do ICMS da venda e do preço. O documento GLP continua bloqueado porque o grupo IBS/CBS monofásico completo não está implementado.
- Somar cada valor dos itens e reconciliar `vProd - vDesc + vFrete = vNF` com o total histórico do pedido. Na prévia 2026, IBS/CBS não altera esse total. Estado fiscal não modifica estoque nem caixa.

## Limites explícitos para a etapa seguinte

1. Obter E03: regras tributárias revisadas por SKU, inclusive base de PIS/COFINS/IBS/CBS, CEST, apresentação e dados de GLP. XML antigo não é aprovação.
2. Completar monofasia IBS/CBS 620006 conforme calendário efetivo e validar água com ST; manter ambos bloqueados até a cobertura completa.
3. F04 deverá transformar **o snapshot congelado** da prévia em XML 55/65, conferir XSD e regras de validação, sem recalcular a partir do cadastro atual.
4. Aplicar uma tabela de capacidades por modelo/operação/UF, não habilitar todas as 40 opções de CFOP observadas.
5. Em F05/F09, comparar cálculo e XML com casos homologados e revisão tributária; aceitação cStat 100 sozinha não aprova imposto.

`tests/fiscal-calculator.test.mjs`, `tests/fiscal-config.test.mjs` e `tests/fiscal-decimal.test.mjs` cobrem os vetores sintéticos, integração ao preflight, precisão, rateio, classificação e bloqueios. O preflight não toca na SEFAZ nem no certificado.
