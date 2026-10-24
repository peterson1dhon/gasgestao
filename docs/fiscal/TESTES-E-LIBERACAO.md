# Matriz de testes e liberação

Estes são casos de aceite a implementar; não são resultados já aprovados. Usar fixtures sintéticas, banco temporário e transporte falso por padrão. Resultado deste estudo e smoke test SQL ficam em `validacao-estudo.json`. Evidência anterior real: `../resultado-glp-agua.json`.

| IDs | Cenário | Resultado esperado |
|---|---|---|
| D01–D03 | Migrar schema5 populado; repetir abertura; falha no meio da migração | Dados operacionais idênticos, versão6 apenas no sucesso, rollback completo |
| D04–D06 | Duas reservas concorrentes; duplo clique; tentar 55 e65 na mesma venda/ambiente | Números únicos, mesmo request retorna documento existente, uma nota ativa |
| D07–D09 | Mesma sequência em ambientes diferentes; CAS obsoleto; tentativa de reduzir contador | Ambientes independentes, conflito explícito, redução bloqueada |
| D10–D12 | Alterar identidade; editar revisão; apagar XML autorizado | Operações recusadas, histórico intacto |
| D13–D15 | FK inexistente; artefato de outra nota; perfil alterado depois de emitido | Recusa/revisão correta, impressão usa snapshot original |
| C01–C04 | Emitente incompleto; cliente CPF inválido; município inexistente; endereço textual sem número | Preflight bloqueia sem reserva e indica campo correto |
| C05–C08 | Certificado vencido; revogação falha; múltiplos A1; certificado de outra identidade | Sem POST, diagnóstico sanitizado, seleção não arbitrária |
| C09–C11 | Destinatário alfanumérico; emitente alfanumérico fora do suporte; relógio/fuso incoerente | Preservar letras, bloquear capacidade não suportada, não emitir com horário inválido |
| T01–T04 | Rateio com resto; desconto maior que total; quantidade fracionária; precisão máxima | Soma exata, rejeição de negativos, arredondamento documentado |
| T05–T08 | P13/P45; água 20 L/510 ml; grupo de origem repetido; retenção histórica | Conversão por perfil, nenhum fator 1 genérico, sem reutilização de total de outra venda |
| T09–T12 | Perfil ST antigo; data após vigência; mudança2027; classe incompatível com grupo | Bloqueio explícito; regras por data; nenhum zero fiscal implícito |
| T13–T16 | Pix estático/dinâmico; fiado; pagamentos mistos; troco | Código correspondente, caixa permanece coerente, soma validada |
| T17–T19 | GLP monofásico; base IBS sintética82; frete/desconto em bases diferentes | Vetores revisados e totais reconciliados, sem copiar ICMS para IBS/CBS |
| X01–X04 | XML válido55/65; ordem incorreta de tags; campo obrigatório ausente; namespace falso | Somente válido passa XSD |
| X05–X09 | XML alterado depois da assinatura; ID duplicado; referência externa; DTD/XXE; transform não permitido | Verificação falha sem acesso externo |
| X10–X12 | XML excessivo; response truncada; HTML200/SOAPFault | Erro limitado/sanitizado; uncertain quando há efeito possível |
| N01–N04 | cStat100 chave errada; ambiente errado; digest divergente; protocolo16 | Nunca authorized |
| N05–N08 | Protocolo15/17; lote103/105/104; 204/539; 217 após timeout | Formatos válidos aceitos com correlação, consulta/recibo, sem nota nova automática |
| N09–N12 | 245;656;998; status desconhecido | Bloqueios específicos, sem loop, sem falso sucesso |
| R01–R07 | Matar processo em cada fronteira descrita em ESTADOS-E-RECUPERACAO | Retomada determinística, uma identidade, consulta após possível POST |
| R08–R10 | Resposta tardia; lease expirado; duas instâncias | CAS preserva estado, fila não duplica efeito, segunda instância controlada |
| E01–E05 | Cancelar nota rejeitada; evento de outra chave;136;573; timeout de cancelamento | Recusa ou reconciliação; não cancelar por status isolado |
| E06–E08 | Prazo ordinário vencido; pedido entregue; cancelamento confirmado | Fluxo legal especial bloqueado, nenhum estorno automático, histórico preservado |
| P01–P04 | A4 e80mm; muitos itens; textos/acentos longos; código de barras eQR | Sem corte/sobreposição, leitura com decoder independente |
| P05–P08 | Homologação; cancelada; incerta; reimpressão após editar cliente | Identificação adequada, sem DANFE autorizado para incerta, mesmo snapshot |
| B01–B04 | Backup comWAL; restauro antigo; falta de disco; hash alterado | Backup consistente, emissão bloqueada após restauro, falha explícita, integridade detectada |
| U01–U04 | Sender estranho; iframe; endpoint/path arbitrário; payload extra | IPC recusa sem executar helper |
| U05–U08 | Duplo clique naUI; fila pendente ao abrir; pedido cancelado; erros do helper | Estado claro, sem duplicidade, guard operacional, sem segredo em log |
| H01–H04 | Ciclo real homologação55 GLP/água;65 apóscredenciamento;QR real;cancelamento/consulta | Protocolos e artefatos privados correlacionados; relatório público sanitizado |
| L01–L04 | Instalador semNode; upgrade comdados; tentativa downgrade; impressora física | Programa inicia, dados intactos, downgrade recusa sem apagar, papel legível |

## Regras de qualidade dos testes

Fixtures de cálculo devem conter resultado esperado calculado independentemente, não usar a mesma função sob teste para criar o expected. Transporte falso deve conseguir simular “servidor aceitou e cliente caiu”. Testar recovery pelo estado persistido após reabrir o banco, não apenas por mocks em memória. Para concorrência, usar conexões/processos distintos e asserts sobre resultado final.

Assinatura local de teste pode usar certificado sintético em suíte isolada; nunca incluir PFX real no repositório. Testes com A1 pessoal precisam de execução local explícita. CI não deve conter dados da empresa ou chamar SEFAZ. Comparar XML estrutural e campos fiscais; comparação literal de assinatura/dhEmi aleatória não é teste estável.

## Critérios para habilitar produção, por modelo

- Pendências de cadastro/perfis/série correspondentes resolvidas e registradas privadamente.
- Fonte/schema/tabelas vigentes reconferidos na data da liberação, inclusive mudanças de novembro e de exercício.
- Matriz crítica D/C/T/X/N/R/E aprovada; nenhum defeito P0 aberto.
- Ciclo homologação completo do próprio modelo, com evidência da versão exata do código.
- Impressão física e backup/restauração aprovados; operador consegue identificar pendência e recuperar sem duplicar nota.
- Série coordenada com outros emissores; ambiente/endpoints claramente visíveis; produção desbloqueada somente na configuração aprovada.
- Escolha explícita de uma venda real pelo usuário para a primeira emissão acompanhada. Nenhuma nota fictícia em produção.

Falha NFC-e não bloqueia automaticamente toda evolução NF-e, mas mantém capacidade65 desabilitada. Não declarar sistema “todo seguro”: registrar controles testados e limites. Não desinstalar o emissor anterior antes de validar exportação de documentos, contingência operacional e transição.
