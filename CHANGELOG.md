# Histórico

## Em desenvolvimento — 2026-10-24

Gerador próprio de XML de laboratório para GLP e água tributada, com assinatura A1, XSD oficial, recálculo de item/totais e bloqueio de enquadramentos ainda não suportados. Oito XMLs válidos nos modelos 55/65. Duas NF-e 55 fictícias autorizadas, consultadas e canceladas em homologação, com retransmissão bloqueada. 52 testes locais e compilação aprovados. Ver `docs/TESTE-GLP-AGUA.md`.

Avanço do laboratório no código-fonte, sem novo instalador, mudança no layout ou emissão pela tela de pedidos. NFC-e e revisão tributária real continuam pendentes.

## 0.7.0 — 2026-10-23

Referências fiscais de gás/água integradas ao diagnóstico existente: importação de XMLs com assinatura matemática verificada, consulta dos campos, vínculo em revisão ao produto, alertas de divergência e prévia de cálculo. Catálogo das 40 opções de saída observadas. Leitura real de três XMLs do RevGás, cinco itens, 89–94 campos por item; originais e dados privados fora do Git.

Esquema 5 preserva catálogo/vínculos no backup. ICMS 00/60/61 e grupos observados de PIS/COFINS e IBS/CBS cobertos pela prévia restrita; códigos ausentes não recebem valor padrão. Alerta prioritário para revisar água com ST em SP após 01/07/2026 conforme Portaria SRE 9/2026. Importação não cria venda nem movimentação. Emissão no pedido permanece indisponível; layout/CSS clássicos preservados. Ver `docs/FISCAL-GAS-AGUA.md`.

## Documentação e distribuição do código — 2026-10-23

Estudo funcional do RevGás em sessão autorizada no navegador interno, com fluxos de NF-e, configurações separadas, cadastro de produtos e limite de acesso à emissão de NFC-e. Propostas registradas sem mudança do layout ou da lógica do aplicativo. Código próprio preparado para o repositório público criado pelo usuário; dados operacionais, documentos fiscais e certificados excluídos. Executável 0.6.0 aberto e atalho na Área de Trabalho criado.

## Em desenvolvimento — laboratório fiscal, 2026-10-23

Documento fictício de R$ 1,00, assinatura pelo certificado do Windows, validação no XSD oficial 010f, autorização/consulta/cancelamento em homologação, persistência do protocolo e bloqueio de retransmissão. NF-e retornou 100, cancelamento 135 e consulta final 101. NFC-e retornou 245 e depende do cadastro no portal de homologação. Inutilização retornou 998, serviço desativado. Não apresentar esses testes como emissor de produção nem como função já integrada ao instalador 0.6.0.

Consulta cadastral oficial identificou regime normal, corrigindo referência histórica de Simples Nacional. Foram acrescentados campos de IBS/CBS do exemplo de teste e QR Code v3. Parâmetros demonstrativos não validam a tributação real dos produtos da revenda. 42 testes automatizados locais aprovados; interface e instalador existentes preservados. Resultado em `docs/TESTE-EMISSAO-SP.md`.

## 0.6.0 — 2026-10-23

Primeira etapa fiscal para São Paulo: diagnóstico real de status da NF-e (55) e NFC-e (65), em homologação, disponível no menu Utilitários. Seleção de certificado no repositório pessoal do Windows, validação da cadeia/revogação e TLS 1.2; chave privada sem exportação. Resultados mínimos guardados fora do repositório, sem seletor de certificado, senha ou dados de clientes.

Destinos e operação STATUS fixos, validação de parâmetros e resposta, processos sem janela e com tempo limite. Testes simulados identificados e separados dos testes reais. Emissão, cancelamento e produção continuam indisponíveis. Layout e CSS clássicos preservados.

37 testes automatizados e compilação aprovados. Regressão da interface, módulos de recompra/vasilhames e diagnóstico fiscal verificados na fonte e no executável Windows. Os dois modelos responderam 107 nos testes reais. Estudo e limites de segurança em `docs/FISCAL-SP.md`.

## 0.5.0 — 2026-10-23

Implementadas as três ideias aprovadas: repetir pedido/último pedido do cliente com preço atual e revisão; previsão de recompra por cliente/produto com pelo menos três datas de compra; controle de empréstimos e devoluções de vasilhames.

Lembretes geram mensagem editável e permitem copiar ou abrir o WhatsApp com o rascunho. Envio continua manual. Registro de contato por ciclo, adiamento e pausa por cliente; abertura do link registrada separadamente de contato confirmado. Atualização da contagem enquanto o aplicativo está aberto.

Migração transacional para esquema 4, saldos e eventos incluídos no backup. Estilo clássico preservado, com novas opções nos menus existentes. 30 testes automatizados e cenários completos de regressão e dos novos módulos na fonte e no executável Windows.

## 0.4.0 — 2026-10-23

Melhorias funcionais comparadas com a documentação oficial da edição 2026 e recursos de 2025: CNPJ numérico/alfanumérico validado no cliente, CSV e comprovante; margem esquerda do recibo em colunas; assinatura na venda a prazo com saldo pendente; busca que tolera caracteres invisíveis e máscaras; filtro financeiro que inclui entregas concluídas; opção de exigir telefone.

Layout clássico, menus, cores e estilos preservados. Campo de CNPJ ocupa célula vazia no cadastro; novas configurações ficam recolhidas. Migração transacional para esquema 3. Foco inicial do formulário corrigido para evitar retorno inesperado ao primeiro campo durante a digitação.

Levantamento e ideias propostas em `docs/COMPARATIVO-2026.md`. WhatsApp, Bina e emissão fiscal continuam sem integração.

## 0.3.0 — 2026-10-23

Consulta offline de CEP no cadastro de clientes, automática após oito dígitos, com botão para repetir, seleção de endereços alternativos e preenchimento de rua, bairro, cidade e UF. Tratamento de CEP ausente e base não instalada, mantendo o preenchimento manual. CEP/UF persistidos, migração transacional de bancos anteriores e inclusão desses campos no CSV.

Importador local MDB → SQLite em modo somente leitura; base de referência mantida fora do repositório e do instalador. Testes de consulta, integridade da origem, migração e fluxo real sem internet.

## 0.2.0 — 2026-10-23

Interface refeita no padrão clássico solicitado: menus Cadastros/Movimentos/Financeiro/Relatórios/Utilitários/Ajuda; barras de ferramentas; janelas internas azuis; controles cinza; grades compactas e linhas amarelas, verdes e vermelhas. Abertura em Pedidos Realizados. Consulta com seleção de linha, filtros por data, pagamento e entrega, atalhos F8/F9 e F2 nos formulários, minimizar e restaurar módulos.

Regras de negócio e banco preservados. Instalador 0.1.0 mantido; publicação no GitHub segue adiada.

## 0.1.0 — 2026-10-23

Primeira implementação do GasGestão Desktop para Windows. Interface em português, funcionamento offline e banco SQLite local.

Cadastros de clientes, produtos e entregadores; pedidos de entrega/retirada; reserva de estoque; recebimentos parciais; cancelamentos com devolução de estoque e estorno; caixa e histórico de movimentações; painel e relatórios por período; exportação CSV; comprovante impresso; configurações e backups.

Código próprio, sem inclusão dos arquivos ou do código descompilado do programa usado como referência funcional.

Publicação no GitHub adiada pelo usuário. Integrações com WhatsApp, Bina, emissão fiscal e importação do sistema anterior permanecem planejadas.
