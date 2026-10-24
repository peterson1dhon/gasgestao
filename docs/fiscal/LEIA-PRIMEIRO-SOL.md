# Continuidade fiscal — leia antes de implementar

Estudo fechado em 24/10/2026. Base auditada: `98eaa1943844def246058c3a61c2bdbfaabd5481`, aplicativo 0.7.0, SQLite versão 5. Este dossiê é uma especificação para implementação, não uma declaração de prontidão fiscal. Não modifica o programa instalado.

## Objetivo e limites

Implementar emissão própria de NF-e 55 e NFC-e 65 para a revenda de gás e água em São Paulo, inicialmente operações internas ordinárias e estabelecimento CRT 3. Preservar o layout clássico. Trabalhar primeiro com simulações locais e homologação. Não remover as travas do laboratório para transformá-lo em emissor de produção.

A autorização do usuário abrange desenvolvimento e testes em homologação. A primeira emissão real exige a conclusão dos critérios de liberação e a escolha explícita do usuário sobre a venda real. Não emitir documentos reais para testar. Não enviar mensagens a clientes durante desenvolvimento.

## Evidência existente

- A1 do repositório de certificados do Windows usado sem exportar chave privada; comunicação com SEFAZ testada.
- Oito XMLs de laboratório GLP/água, modelos 55/65, assinados e validados pelo XSD 010f.
- Duas NF-e 55 fictícias de R$ 1: autorização 100, consulta 100, cancelamento 135, consulta final 101. Evidência em [teste GLP/água](../TESTE-GLP-AGUA.md) e [resultado sanitizado](../resultado-glp-agua.json).
- NFC-e ainda não teve ciclo completo aprovado: tentativa anterior retornou 245, emitente não cadastrado. Não confundir status de serviço 107 com habilitação para emitir.
- 52 testes passaram no avanço anterior; isso cobre o código atual, não os módulos propostos aqui.
- A tela de pedidos ainda não emite notas. Não houve liberação em produção. Aceitação em homologação não comprova enquadramento tributário correto.

## Ordem obrigatória de leitura

1. [Fontes, versões e alterações](ESTUDO-E-FONTES.md) e [manifesto](fontes-oficiais.json).
2. [Arquitetura e contratos](ARQUITETURA-E-CONTRATOS.md).
3. [Estados e recuperação](ESTADOS-E-RECUPERACAO.md).
4. [Tributação e documentos](TRIBUTACAO-E-DOCUMENTOS.md).
   Para o código iniciado na F03, ler também o [contrato do cálculo](CALCULO-F03.md).
5. [Pendências da empresa](PENDENCIAS-DA-EMPRESA.md).
6. [Plano de execução](PLANO-DE-EXECUCAO.md) e [testes/liberação](TESTES-E-LIBERACAO.md).

## Primeiro trabalho do GPT Sol

Executar apenas a etapa F01 do plano: criar a migração aditiva 6, o repositório fiscal e a máquina de estados pura, com testes em banco temporário. A [proposta SQL](schema-v6-proposta.sql) é uma base validável, não uma migração já instalada. Não executar esse SQL no banco pessoal. Preservar todos os dados e rotinas operacionais. Entregar teste de concorrência, unicidade, rollback, integridade referencial e preservação de pedidos/estoque/caixa. Depois avançar pelas dependências do plano.

## Decisões que não podem ser improvisadas

- Homologação e produção ficam isoladas por identidade, sequência, política e endpoints; produção começa bloqueada.
- Uma venda não pode ganhar simultaneamente NF-e e NFC-e ativas no mesmo ambiente.
- Timeout significa resultado desconhecido; consultar antes de qualquer reenvio. Não trocar o número para contornar incerteza.
- Nunca substituir o XML autorizado por XML regenerado. Guardar bytes assinados, protocolo e eventos.
- Cadastro ou XML importado não aprova tributação. Perfis precisam de revisão identificada e vigência.
- Manter XMLs reais, certificados, CNPJ da empresa, cadastro de clientes e respostas integrais fora do Git. O repositório é público.
- Não assumir que a tabela de 40 CFOPs significa 40 operações implementadas.
- Atualizações posteriores a 24/10/2026 exigem nova conferência oficial antes da homologação final; conferir especialmente 01/11, 03/11 e a mudança de exercício para 2027.

## Onde estão os recursos locais

Projeto: diretório deste repositório. Programa empacotado: `release/win-unpacked/GasGestao.exe`. Instalador atual: `release/GasGestao-0.7.0-Windows-x64-Setup.exe`.

Dados privados: `%APPDATA%/GasGestao`; laboratório e referências em `%LOCALAPPDATA%/GasGestao-Fiscal-Homologacao` e `%LOCALAPPDATA%/GasGestao-Fiscal-Referencias`. Downloads oficiais deste estudo: `%LOCALAPPDATA%/GasGestao-Fiscal-Estudo-20261024`. Não despejar conteúdo desses diretórios no terminal ou em relatórios públicos.

REA/Ghidra não forneceu o código servidor do RevGás. A análise do executável empacotado GasExpert não equivale à recuperação integral do programa. A implementação fiscal deve ser própria, baseada nos padrões oficiais e nas referências autorizadas.

## Prompt pronto para continuar

> Leia AGENTS.md e docs/fiscal/LEIA-PRIMEIRO-SOL.md, depois os documentos na ordem indicada. Implemente o plano fiscal começando pela F01 e respeitando suas dependências. Preserve o layout clássico e os dados. Não transforme o laboratório em produção removendo travas. Use somente bancos temporários nos testes automatizados; não emita notas reais. Registre o que implementou, os testes efetivamente executados e os bloqueios restantes. Não invente dados da empresa ou regras tributárias pendentes. Avance autonomamente nas etapas que não dependem dessas informações.
