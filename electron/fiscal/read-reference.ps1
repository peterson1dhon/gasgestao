param([Parameter(Mandatory=$true)][string]$InputFile)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
try {
  if (!$InputFile -or $InputFile.StartsWith('\\') -or !(Test-Path -LiteralPath $InputFile -PathType Leaf)) { throw 'INVALID_FILE' }
  $file = Get-Item -LiteralPath $InputFile
  if ($file.Extension -ine '.xml' -or $file.Length -gt 2097152 -or $file.Length -eq 0) { throw 'INVALID_FILE' }
  $bytes = [IO.File]::ReadAllBytes($file.FullName)
  $sha = [Security.Cryptography.SHA256]::Create()
  function Digest([byte[]]$data) { return ([BitConverter]::ToString($sha.ComputeHash($data))).Replace('-','').ToLowerInvariant() }
  $settings = New-Object System.Xml.XmlReaderSettings
  $settings.DtdProcessing = [Xml.DtdProcessing]::Prohibit
  $settings.XmlResolver = $null
  $settings.MaxCharactersInDocument = 2097152
  $settings.MaxCharactersFromEntities = 0
  $stream = New-Object IO.MemoryStream(,$bytes)
  $reader = [Xml.XmlReader]::Create($stream,$settings)
  $doc = New-Object Xml.XmlDocument
  $doc.PreserveWhitespace = $true
  $doc.XmlResolver = $null
  try { $doc.Load($reader) } finally { $reader.Dispose(); $stream.Dispose() }
  $ns = New-Object Xml.XmlNamespaceManager($doc.NameTable)
  $ns.AddNamespace('n','http://www.portalfiscal.inf.br/nfe')
  $ns.AddNamespace('d','http://www.w3.org/2000/09/xmldsig#')
  $info = $doc.SelectSingleNode('/n:nfeProc/n:NFe/n:infNFe',$ns)
  $protocol = $doc.SelectSingleNode('/n:nfeProc/n:protNFe/n:infProt',$ns)
  if (!$info -or !$protocol -or $doc.SelectNodes('//n:infNFe',$ns).Count -ne 1 -or $doc.SelectNodes('//n:NFe',$ns).Count -ne 1) { throw 'INVALID_DOCUMENT' }
  function Value($node,[string]$path) {
    $found = $node.SelectSingleNode($path,$ns)
    if ($found) { return $found.InnerText }
    return ''
  }
  $key = $info.GetAttribute('Id')
  if ($key -cnotmatch '^NFe[0-9]{44}$' -or (Value $protocol 'n:chNFe') -cne $key.Substring(3)) { throw 'INVALID_DOCUMENT' }
  $model = Value $info 'n:ide/n:mod'
  $environment = Value $info 'n:ide/n:tpAmb'
  $status = Value $protocol 'n:cStat'
  if ($model -notin @('55','65') -or $environment -notin @('1','2') -or (Value $protocol 'n:tpAmb') -ne $environment -or $status -notin @('100','150')) { throw 'NOT_AUTHORIZED_XML' }
  Add-Type -AssemblyName System.Security
  $signatures = $doc.SelectNodes('/n:nfeProc/n:NFe/d:Signature',$ns)
  if ($signatures.Count -ne 1 -or $doc.SelectNodes('//d:Signature',$ns).Count -ne 1) { throw 'INVALID_SIGNATURE' }
  $signed = New-Object Security.Cryptography.Xml.SignedXml($doc)
  $signed.LoadXml($signatures[0])
  if ($signed.SignedInfo.CanonicalizationMethod -cne 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315' -or $signed.SignedInfo.SignatureMethod -notin @('http://www.w3.org/2000/09/xmldsig#rsa-sha1','http://www.w3.org/2001/04/xmldsig-more#rsa-sha256')) { throw 'INVALID_SIGNATURE' }
  if ($signed.SignedInfo.References.Count -ne 1 -or $signed.SignedInfo.References[0].Uri -cne ('#'+$key)) { throw 'INVALID_SIGNATURE' }
  $reference = $signed.SignedInfo.References[0]
  if ($reference.DigestMethod -notin @('http://www.w3.org/2000/09/xmldsig#sha1','http://www.w3.org/2001/04/xmlenc#sha256')) { throw 'INVALID_SIGNATURE' }
  for ($i=0; $i -lt $reference.TransformChain.Count; $i++) {
    $transform = $reference.TransformChain[$i]
    if ($transform.Algorithm -notin @('http://www.w3.org/2000/09/xmldsig#enveloped-signature','http://www.w3.org/TR/2001/REC-xml-c14n-20010315')) { throw 'INVALID_SIGNATURE' }
  }
  # Verifica somente a assinatura matemática, sem consulta de rede/revogação.
  if (!$signed.CheckSignature() -or [Convert]::ToBase64String($reference.DigestValue) -cne (Value $protocol 'n:digVal')) { throw 'INVALID_SIGNATURE' }
  $issuer = Value $info 'n:emit/n:CNPJ'
  if ($issuer -notmatch '^\d{14}$') { throw 'INVALID_DOCUMENT' }
  $details = $info.SelectNodes('n:det',$ns)
  if ($details.Count -lt 1 -or $details.Count -gt 990) { throw 'INVALID_DOCUMENT' }
  function Leaves($node,[string]$prefix,$output,[int]$depth=0) {
    if ($depth -gt 24 -or $output.Count -ge 1024) { throw 'LIMIT_EXCEEDED' }
    $children = @($node.ChildNodes | Where-Object { $_.NodeType -eq [Xml.XmlNodeType]::Element })
    if (!$children.Count) {
      if ($node.InnerText.Length -gt 2048) { throw 'LIMIT_EXCEEDED' }
      [void]$output.Add([pscustomobject]@{path=$prefix;value=$node.InnerText})
      return
    }
    foreach ($child in $children) {
      if ($child.NamespaceURI -cne 'http://www.portalfiscal.inf.br/nfe') { throw 'INVALID_DOCUMENT' }
      Leaves $child ($prefix+'/'+$child.LocalName) $output ($depth+1)
    }
  }
  $items = New-Object Collections.ArrayList
  foreach ($det in $details) {
    $fields = New-Object Collections.ArrayList
    foreach ($group in @('prod','imposto')) {
      $node = $det.SelectSingleNode('n:'+$group,$ns)
      if (!$node) { throw 'INVALID_DOCUMENT' }
      Leaves $node $group $fields
    }
    foreach ($path in @('ide/cUF','ide/natOp','ide/tpNF','ide/idDest','ide/finNFe','ide/indFinal','ide/indPres','ide/tpEmis','emit/CRT','emit/enderEmit/UF','dest/indIEDest','dest/enderDest/UF','transp/modFrete')) {
      $xpath = ($path.Split('/') | ForEach-Object { 'n:'+$_ }) -join '/'
      $context = $info.SelectSingleNode($xpath,$ns)
      if ($context) { Leaves $context $path $fields }
    }
    foreach ($payment in $info.SelectNodes('n:pag/n:detPag/n:tPag',$ns)) { Leaves $payment 'pag/detPag/tPag' $fields }
    $totals = $info.SelectSingleNode('n:total',$ns)
    if ($totals) { Leaves $totals 'total' $fields }
    [void]$items.Add([pscustomobject]@{item=$det.GetAttribute('nItem');fields=@($fields.ToArray())})
  }
  [pscustomobject]@{
    ok=$true; documentHash=(Digest $bytes); issuerHash=(Digest ([Text.Encoding]::UTF8.GetBytes($issuer)))
    issuedAt=(Value $info 'n:ide/n:dhEmi'); model=$model; environment=$environment
    crt=(Value $info 'n:emit/n:CRT'); uf=(Value $info 'n:emit/n:enderEmit/n:UF')
    status=$status; signatureVerified=$true; certificateChainChecked=$false; currentStatusChecked=$false
    items=@($items.ToArray())
  } | ConvertTo-Json -Depth 12 -Compress
} catch {
  $code = $_.Exception.Message
  if ($code -notin @('INVALID_FILE','INVALID_DOCUMENT','NOT_AUTHORIZED_XML','INVALID_SIGNATURE','LIMIT_EXCEEDED')) { $code='INVALID_DOCUMENT' }
  [pscustomobject]@{ok=$false;code=$code} | ConvertTo-Json -Compress
  exit 1
}
