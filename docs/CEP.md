# CEP offline

A consulta usa exclusivamente uma base SQLite local, aberta em modo somente leitura por uma operação IPC específica. O renderer não recebe acesso a arquivos ou ao Node. As consultas SQL usam parâmetros e validam o CEP no processo principal. Os endereços não entram no banco operacional até salvar um cliente.

## Preparar uma base local compatível

No Windows, com Node 24 ou superior e provedor Microsoft Jet OLEDB 4.0 de 32 bits:

```powershell
node scripts/import-cep.mjs "D:\Gas Expert 2020\bdcep.mdb" "$env:LOCALAPPDATA\GasGestao-Referencias\cep.sqlite"
```

O importador exige as tabelas `enderecos`, `bairros` e `cidades` com o esquema local analisado. Não é um importador genérico de qualquer MDB. Mantém a origem em modo de leitura, verifica o hash antes/depois e faz uma cópia convertida; não distribui dados no Git. Um destino existente é rejeitado para preservar a base anterior.

O importador registra hash da origem, quantidade de registros, quantidade descartada e data da importação na tabela `metadata`. A data de importação não é a data de atualização dos CEPs.

A aplicação procura `%LOCALAPPDATA%\GasGestao-Referencias\cep.sqlite`. Para desenvolvimento/testes, `GASGESTAO_CEP_DB` aponta para uma base alternativa. Não há acesso ao MDB original durante o uso normal. Se a base estiver ausente ou não contiver o CEP, a tela explica o resultado e mantém a edição manual disponível.

## Resultado nesta máquina

1.131.462 endereços importados; cinco registros incompletos descartados; SQLite íntegro. Conferida a consulta de 18270-001 → Rua Onze de Agosto, Centro, Tatuí/SP. A origem foi preservada. Não há atualização automática nem confirmação da atualidade de todos os registros.

## Testes

`npm test` cobre consulta, formato do CEP, retorno vazio, alternativas, base ausente, preservação do arquivo consultado e migração/persistência. `npm run test:ui` usa uma base sintética própria e independente da instalação original. `node scripts/test-local-postal.mjs --packaged` é uma verificação opcional desta base real em um perfil temporário, sem gravar clientes.
