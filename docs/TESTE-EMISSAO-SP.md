# Teste real de emissão — 23/10/2026

**Resultado: NF-e de teste autorizada e cancelada; NFC-e ainda bloqueada pelo cadastro de homologação. Não passou tudo.**

Uma NF-e fictícia de R$ 1,00 foi transmitida à homologação de São Paulo com o certificado da empresa instalado no Windows. O laboratório gerou e assinou o XML, validou a estrutura oficial, recebeu autorização e verificou o cancelamento. Não houve transmissão a webservice fiscal de produção nem alteração de pedidos, estoque ou caixa do aplicativo.

## Resultados observados

| Verificação | Resultado |
| --- | --- |
| Estrutura XML dos modelos 55 e 65 | Válida no XSD oficial, pacote 010f |
| Assinatura pelo Windows e verificação após salvar/reabrir | Aprovadas nos dois modelos, chave privada não exportada |
| Consulta do cadastro do emitente | 111, inscrição ativa, regime normal de apuração |
| Autorização NF-e 55 | 104 no lote e **100 — Autorizado o uso da NF-e**, com protocolo |
| Consulta NF-e após autorizar | **100** |
| Cancelamento NF-e | **135 — Evento registrado e vinculado à NF-e** |
| Consulta NF-e após cancelar | **101 — Cancelamento de NF-e homologado** |
| Repetição da mesma transmissão | Bloqueada localmente antes de outra solicitação de autorização |
| Autorização NFC-e 65 | **245 — CNPJ emitente não cadastrado**, sem autorização |
| Consulta da chave NFC-e | 217, não consta na base |
| Inutilização de dois números rejeitados do laboratório | **998 — Serviço desativado**, sem confirmação de inutilização |
| Tentativa de selecionar produção | Bloqueada antes do uso do certificado/rede |
| XML assinado alterado | Alteração detectada; transmissão não executada |
| Modelo divergente do documento | Bloqueado |

Evidência mínima, sem identificador de certificado, CNPJ, chave de acesso ou número de protocolo: [resultado-emissao-sefaz.json](resultado-emissao-sefaz.json). XMLs assinados, respostas completas e protocolo ficam somente na pasta privada local `%LOCALAPPDATA%\GasGestao-Fiscal-Homologacao`. O XML padrão contém o certificado público; a chave privada permaneceu no Windows.

## O que foi ajustado durante a homologação

Os XMLs antigos pertenciam à empresa do certificado, mas usavam Simples Nacional. A primeira tentativa retornou 180, regime divergente. A consulta cadastral oficial retornou regime normal, e o exemplo foi ajustado com base nessa resposta, sem alterar o cadastro da empresa.

O destinatário genérico usado por documentação antiga retornou 181 por ausência no cadastro da Receita. O exemplo passou a identificar a própria empresa como destinatária fictícia da NF-e, com nome de homologação e sem dados de clientes. A NFC-e foi preparada sem consumidor identificado.

A ausência de IBS/CBS foi rejeitada com 1115. Foram incluídos os campos e totais de um cenário demonstrativo de tributação integral de 2026, conforme a estrutura oficial. Depois desses ajustes, a NF-e foi autorizada. Isso não torna corretos os impostos das vendas reais da revenda: o exemplo usa produto/bebida genérico, não valida tributação de GLP, água ou comodato e não constitui parametrização fiscal de produção.

## Pendência concreta da NFC-e

O [portal oficial NFC-e/SP](https://www.nfce.fazenda.sp.gov.br/NFCePortal/) disponibiliza credenciamento separado para o ambiente de testes. O acesso de homologação funcionou com o certificado e com a autenticação oficial de homologação da SEFAZ. O estabelecimento foi selecionado para inspeção; o cadastro exige **nome completo, e-mail e telefone do responsável**, todos vazios.

Esses dados foram solicitados ao usuário. Não foram inventados responsáveis ou contatos, e a solicitação de credenciamento não foi enviada. Depois de concluir o credenciamento de testes e aguardar a disponibilidade do cadastro, será necessário repetir autorização, consulta, cancelamento e validação do QR Code da NFC-e.

O retorno 998 da inutilização precisa ser investigado com as orientações/serviço da SEFAZ; não deve ser apresentado como sucesso. Nenhum número de produção foi reservado ou inutilizado.

## Limites da entrega

- A emissão ocorreu pelo laboratório do código em desenvolvimento, fora da tela de vendas. O instalador 0.6.0 permanece com diagnóstico de status e sem botão de emissão. Não foi publicado outro instalador nesta etapa.
- Não foram concluídos os testes da NFC-e, de impressão física/DANFE, de contingência ou de recuperação de uma interrupção real durante autorização. O bloqueio de retransmissão foi testado; isso não equivale à validação de todos os cenários de falha de rede.
- O laboratório usa série separada em homologação, sequência local persistida, valor fixo de R$ 1,00 e parâmetros de exemplo limitados a 2026. O histórico de tentativas é gravado antes do envio e impede repetição automática da mesma chave.
- A inutilização foi restrita a dois números com tentativa rejeitada e consulta 217 registrada no próprio laboratório. A operação não retornou aprovação.
- Antes do uso diário faltam parametrização fiscal dos produtos reais, credenciamento/testes da NFC-e, DANFE, contingência/recuperação e integração transacional entre estado fiscal e pedido. Não substituir o emissor atual com base apenas neste teste.

## Execução e validação local

`npm test`: **42 testes aprovados**. Os cinco novos testes do laboratório cobrem composição/DV da chave, escaping XML, diferenças entre os modelos, QR Code v3, limites de entrada/data, coerência do exemplo CRT normal/IBS/CBS e as guardas do auxiliar. `npm run build` aprovado, com os mesmos arquivos de estilo e interface da versão 0.6.0.

`node scripts/test-fiscal-emission.mjs` prepara/assina/verifica documentos sem autorizar. `--issue` transmite os dois exemplos, consulta o resultado e tenta cancelamento somente após autorização confirmada. Não incluir esse comando em CI nem em testes rotineiros; exige perfil privado e os esquemas oficiais preparados nesta máquina. O comando não exporta o A1. Não repetir testes reais quando os resultados existentes já forem suficientes.

Esquemas baixados do [Portal Nacional NF-e](https://www.nfe.fazenda.gov.br/portal/listaConteudo.aspx?tipoConteudo=BMPFMBoln3w%3D): pacote 010f, SHA-256 `b8589490a58a09a993a80e6ac4d7ed10f20892061ecfc56719337098d4b95998`, com dependências oficiais. A identificação dos campos e alíquotas de transição foi conferida com o [Portal de Conformidade Fácil](https://dfe-portal.svrs.rs.gov.br/CFF/ClassificacaoTributaria) e com a [Receita Federal](https://www.gov.br/receitafederal/pt-br/acesso-a-informacao/acoes-e-programas/reforma-tributaria-do-consumo/entenda). Esses exemplos não substituem a análise fiscal do contador.
