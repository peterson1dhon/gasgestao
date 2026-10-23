param([Parameter(Mandatory=$true)][string]$Source, [Parameter(Mandatory=$true)][string]$Output)
$ErrorActionPreference = 'Stop'
$connection = New-Object -ComObject ADODB.Connection
$writer = $null
function SourceHash {
    $stream = [System.IO.File]::OpenRead($Source)
    $hash = [System.Security.Cryptography.SHA256]::Create()
    try { [BitConverter]::ToString($hash.ComputeHash($stream)) } finally { $stream.Dispose(); $hash.Dispose() }
}
$before = SourceHash
try {
    $connection.Mode = 1
    $connection.Open("Provider=Microsoft.Jet.OLEDB.4.0;Data Source=$Source;Mode=Read;Persist Security Info=False;")
    $rows = $connection.Execute('SELECT e.cep, e.tipo_logradouro, e.logradouro, b.bairro, c.cidade, c.uf FROM (enderecos AS e LEFT JOIN bairros AS b ON e.id_bairro=b.id_bairro) LEFT JOIN cidades AS c ON e.id_cidade=c.id_cidade')
    $writer = New-Object System.IO.StreamWriter($Output, $false, (New-Object System.Text.UTF8Encoding($false)))
    while (!$rows.EOF) { $writer.Write($rows.GetString(2, 10000, [string][char]31, [string][char]30, '')) }
    $rows.Close()
} finally {
    if ($writer) { $writer.Dispose() }
    if ($connection.State -ne 0) { $connection.Close() }
    [void][Runtime.InteropServices.Marshal]::ReleaseComObject($connection)
}
if ((SourceHash) -ne $before) { throw 'O arquivo de origem foi alterado durante a consulta.' }
