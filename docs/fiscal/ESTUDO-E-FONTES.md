# Fontes e conclusões do estudo

Data de corte: 24/10/2026. Downloads oficiais possuem URL, tamanho e SHA-256 no [manifesto](fontes-oficiais.json). Hash comprova identidade do arquivo consultado, não sua permanência como última versão. Antes de implementar uma revisão, comparar portal, versão interna, vigência, XSD, tabelas e regras de validação. Resultado de busca pode estar desatualizado em relação ao arquivo oficial.

## Mudanças que afetam diretamente o projeto

| Evidência oficial | Consequência de engenharia |
|---|---|
| Portal Nacional lista NT 2025.002 v1.52, publicada em 01/10/2026; pacote XSD permanece 010f | Manifesto precisa separar versão da NT, versão do schema, tabelas e datas de ativação das regras. Não considerar o XSD suficiente para validar toda regra fiscal. |
| Tabela cClassTrib publicada em 01/10/2026 contém 620006 para GLP observado e sinaliza grupo monofásico | O laboratório GLP não implementa o conjunto completo de IBS/CBS monofásico. Aprovação 100 não encerra essa lacuna. |
| Portais SP anunciam fim do pedido de inutilização em 01/11/2026, citando Ajustes SINIEF 38/2026 e 40/2026 | Implementar política por data. Manter lacunas e numeração auditáveis. Não exigir inutilização como teste universal após essa data. |
| SP anuncia protocolo NFC-e de 17 dígitos em produção desde 05/10/2026 | Protocolo é string, aceitar formatos permitidos pelo schema (15 ou 17), não intervalo 15–17 que admite 16. |
| NT 2026.004 v1.01 trata CNPJ alfanumérico | Não limpar letras nem usar Number para identificadores. Suporte atual fiscal é restrito ao emitente numérico; destinatário alfanumérico precisa de cobertura explícita. |
| Manual DANFE NFC-e/QR v6 prevê QR Code v3 | QR online v3 não utiliza CSC. Cadastro/CSC antigo do portal não justifica misturar os algoritmos v2 e v3. |

Fontes: [NT RTC 1.52](https://www.nfe.fazenda.gov.br/portal/exibirArquivo.aspx?conteudo=HXPO8VLbh4o%3D), [tabela cClassTrib](https://www.nfe.fazenda.gov.br/portal/exibirArquivo.aspx?conteudo=Cd5xq2ZVuEg%3D), [NF-e SP](https://portal.fazenda.sp.gov.br/servicos/nfe), [NFC-e SP](https://portal.fazenda.sp.gov.br/servicos/nfce/), [NT CNPJ](https://www.nfe.fazenda.gov.br/portal/exibirArquivo.aspx?conteudo=BTZQzgsO9Ws%3D), [manual QR](https://www.nfe.fazenda.gov.br/portal/exibirArquivo.aspx?conteudo=k%2FIuuaW4YiY%3D).

O retorno 998 observado anteriormente no serviço de inutilização é fato de teste. Não comprova, sozinho, dispensa legal antes de 01/11/2026. O texto integral dos Ajustes citados não foi recuperado nesta pesquisa; a conclusão sobre SP se apoia nos avisos estaduais. Para casos históricos, consultar orientação estadual aplicável à data.

## RTC: não generalizar uma data de ativação

A NT 1.52 contém calendário para novembro e regras específicas ainda marcadas como implementação futura. Examinar UB13-40 (grupo monofásico), UB100-20 (CBS ad valorem), VB01-10 (vItem) e W60 (vNFTot), além do cronograma inicial. A transição monofásica muda entre 2026, 2027–2028 e 2029; não transportar a alíquota ICMS para IBS/CBS. Em 2026, não acrescentar automaticamente IBS/CBS ao valor cobrado usando fórmulas de exercícios seguintes. O motor deve selecionar políticas versionadas por data e bloquear combinações sem perfil aprovado. [NT 2025.002 v1.52](https://www.nfe.fazenda.gov.br/portal/exibirArquivo.aspx?conteudo=HXPO8VLbh4o%3D).

## Água e GLP

A Portaria SRE 9/2026 altera o enquadramento de mercadorias e tem efeitos relevantes a partir de julho. Conferir descrição, embalagem, NCM/CEST e estoque de transição por SKU; não copiar ST de XML antigo. A resposta de consulta sobre GLP é referência de uma situação concreta, não parecer automaticamente aplicável a qualquer venda. [Portaria SRE 9/2026](https://legislacao.fazenda.sp.gov.br/Paginas/Portaria-SRE-9-de-2026.aspx), [RC 34216/2026](https://legislacao.fazenda.sp.gov.br/Paginas/RC34216_2026.aspx).

## Cancelamento e contingência

Planejar o fluxo ordinário NF-e em até 24 horas da autorização; a hipótese extemporânea não deve ser apresentada como prazo normal. Para NFC-e, o portal trata pedidos além de 30 minutos como extemporâneos. Conferir a norma vigente e a origem exata do relógio antes de habilitar produção. Registrar horário da SEFAZ e fuso, não apenas o relógio da máquina. [FAQ NF-e SP](https://portal.fazenda.sp.gov.br/servicos/nfe/Paginas/perguntas-frequentes.aspx/respostas_ii.asp), [cancelamento extemporâneo NFC-e](https://portal.fazenda.sp.gov.br/servicos/nfce/Paginas/Guia-Cancel-Extemp-NFCe.aspx).

SP menciona contingência offline no portal atual. Isso não torna automaticamente aplicável todo prazo de manuais antigos. A primeira entrega será online; contingência NFC-e depende de revisão da disciplina estadual atual, prazo de transmissão e impressão específica. Enquanto isso, indisponibilidade bloqueia emissão normal e orienta o operador; não inventar autorização. NF-e 55 não usa o tipo offline 9 de NFC-e.

## Auditoria do código atual

| Prioridade | Constatação | Tratamento obrigatório |
|---|---|---|
| P0 | `homologation-lab.ps1` correlaciona autorização melhor que consulta/cancelamento | Validar chave, ambiente, modelo/identidade, protocolo, digest quando presente e identificadores do evento em todos os retornos. |
| P0 | Marcador do laboratório é permanente; não há recuperação completa após timeout | Persistência, estados e consulta reconciliadora antes da UI. Não apagar marcador para repetir. |
| P0 | `changeOrderStatus` cancela pedido e estorna operações diretamente | Guardar cancelamento operacional quando houver documento fiscal ativo/incerto. Cancelamento fiscal não estorna automaticamente caixa/estoque. |
| P0 | Perfil importado e prévia não são motor tributário completo | Perfis aprovados, vigência e cálculo independente. |
| P0 | Cadastro tem endereço textual, não endereço fiscal estruturado | Acrescentar cadastro fiscal validado; nunca decompor endereço por adivinhação. |
| P1 | Regex de protocolo aceita 16; XML de resposta/evento não tem toda cobertura XSD | Corrigir no novo adaptador e adicionar fixtures negativas. |
| P1 | Seleção do certificado por substring do Subject | Configuração explícita do certificado, cadeia/revogação, vínculo de identidade conforme política ICP-Brasil. Bloquear ambiguidades. |
| P1 | Verificação de assinatura não restringe completamente referências/transforms/IDs | Allowlist e rejeição de wrapping, IDs duplicados e referências externas. |
| P1 | Logger genérico imprime message de erro | Sanitizar falhas do helper antes de chegar a console/renderer. |
| P1 | Backup existe, mas restauração fiscal não | Restaurar com emissão bloqueada até reconciliar pendências e sequência. |

## Fontes técnicas

Transações SQLite não podem incluir `await` no wrapper síncrono atual. Persistir antes da rede e confirmar o resultado em outra transação curta. Backup deve ser um snapshot consistente, não cópia isolada de arquivo com WAL ativo. [SQLite transações](https://www.sqlite.org/lang_transaction.html), [SQLite backup](https://www.sqlite.org/backup.html).

Impressão e PDF podem aproveitar Electron em janela isolada, com documento fiscal próprio. Proteção Windows por DPAPI não protege contra código malicioso executando como o mesmo usuário. Conferir disponibilidade da API na versão Electron instalada antes de adotá-la. [Electron webContents](https://www.electronjs.org/docs/latest/api/web-contents), [safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage).

Dependência proposta, ainda não instalada: `bwip-js@4.11.4` (MIT), geração local de Code128 e QR, apenas no processo principal. Fixar versão/lockfile, revisar licença e validar leitura com decoder independente. [Projeto oficial](https://github.com/metafloor/bwip-js).
