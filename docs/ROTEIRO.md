# Roteiro de desenvolvimento

## Etapa 1 — aplicação local operacional

Cadastros, pedidos, entregadores, fluxo de entrega, estoque reservado, recebimentos parciais, caixa, estornos, comprovantes, relatórios e backups. Testes de regras e do fluxo na janela Electron. Esta é a entrega 0.1.0.

## Entregas adicionais concluídas

- Laboratório de 24/10/2026: geração própria de XML GLP/água, oito documentos dos modelos 55/65 assinados e válidos no XSD; duas NF-e 55 fictícias autorizadas e canceladas em homologação. Sem novo instalador ou emissão no pedido. Ver `TESTE-GLP-AGUA.md`.

- 0.7.0: leitura/consulta de referências fiscais de gás/água exportadas do RevGás, vínculo em revisão, prévia e alertas de divergência. Catálogo com 40 opções de operação. Emissão no pedido permanece pendente; ver `FISCAL-GAS-AGUA.md`.

- 0.2.0: layout clássico conforme referências públicas do original.
- 0.3.0: consulta offline de CEP integrada e base local instalada neste computador. A atualização dessa base ainda não é automática.

- 0.4.0: melhorias de cadastro, busca, filtro financeiro e comprovantes comparadas com as notas oficiais de 2026/2025, mantendo o layout clássico.
- 0.5.0: as três ideias foram aprovadas e implementadas, com mensagem preparada para abertura manual no WhatsApp; ver `LEMBRETES-E-VASILHAMES.md`.
- 0.6.0: diagnóstico real da NF-e e NFC-e de São Paulo em homologação, usando certificado instalado no Windows, sem emitir documentos. Estudo fiscal e plano para a janela de 25 dias em `FISCAL-SP.md`.
- Laboratório posterior à 0.6.0: NF-e fictícia autorizada, consultada e cancelada em homologação. NFC-e aguardando dados do responsável para credenciamento de testes; inutilização retornou serviço desativado. Emissão ainda fora da tela de vendas. Ver `TESTE-EMISSAO-SP.md`.

## Etapa 2 — validar com o uso real

- Conferir telas e fluxos do GasExpert em funcionamento, inclusive na versão recente.
- Ajustar pedido, impressão e atendimento à rotina da revenda.
- Vasilhames físicos já têm controle básico de empréstimo/devolução. Validar antes regras financeiras de comodato/caução, troco, acerto de entregadores e lançamentos retroativos.
- Implementar restauração de backup com verificação e preservação da base anterior.
- Melhorar paginação da interface para históricos extensos.

## Etapa 3 — integrações

- Importação autorizada a partir de exportações ou bancos acessíveis do sistema anterior.
- WhatsApp: abertura manual com rascunho já disponível. API Business, disparo automático e confirmação de entrega continuam fora do escopo atual.
- Bina/DTMF: identificar equipamento, driver e protocolo efetivamente usados.
- Impressoras térmicas e modelos de comprovante por equipamento.
- Fiscal: status dos dois modelos e ciclo básico da NF-e em homologação concluídos. Próximos marcos: concluir credenciamento/testes da NFC-e, tratar indisponibilidade de inutilização, parametrizar tributos reais de gás/água, imprimir DANFE e integrar estados fiscais ao pedido sem duplicidade. A produção depende desses resultados e da conferência fiscal da empresa. Ver `FISCAL-SP.md` e `TESTE-EMISSAO-SP.md`.

## Etapa 4 — expansão

- Operadores e perfis de acesso.
- Servidor e sincronização para mais de um terminal.
- Interface para celular e navegador sobre a mesma lógica de negócio.
- Atualização automática com distribuição assinada.

## Repositório remoto

Repositório criado pelo usuário: [peterson1dhon/gasgestao](https://github.com/peterson1dhon/gasgestao), público. A publicação inclui somente código próprio e documentação sem dados privados. Bancos, backups, XMLs, certificados, credenciais, instaladores e arquivos do GasExpert ficam fora do Git.

O [estudo do RevGás](ESTUDO-REVGAS.md) registra os fluxos consultados no navegador interno, o bloqueio do formulário de NFC-e nesta conta e prioridades propostas para concluir o fiscal sem alterar o layout.
