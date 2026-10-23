param(
    [ValidateSet('Sign','Validate','Authorize','Query','Cancel','Registry','Inutilize')][string]$Mode,
    [ValidateSet('55','65')][string]$Model='55',
    [string]$InputFile=''
)
# Laboratorio restrito de homologacao. Nao e um emissor de producao.
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
[Console]::OutputEncoding=New-Object System.Text.UTF8Encoding($false)
Add-Type -AssemblyName System.Security
$base=[IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'GasGestao-Fiscal-Homologacao'))
$nsUri='http://www.portalfiscal.inf.br/nfe'
$store=$null
$phase='input_validation'
function LoadSafeXml([string]$content) {
    if($content.Length -gt 1048576){throw 'XML_SIZE'}
    $settings=New-Object System.Xml.XmlReaderSettings
    $settings.DtdProcessing=[Xml.DtdProcessing]::Prohibit
    $settings.XmlResolver=$null
    $reader=[Xml.XmlReader]::Create((New-Object IO.StringReader($content)),$settings)
    $doc=New-Object Xml.XmlDocument
    $doc.PreserveWhitespace=$true
    $doc.XmlResolver=$null
    try {$doc.Load($reader)} finally {$reader.Dispose()}
    return ,$doc
}
function SaveXml($doc,[string]$path) {
    $settings=New-Object Xml.XmlWriterSettings
    $settings.Encoding=New-Object Text.UTF8Encoding($false)
    $settings.Indent=$false
    $writer=[Xml.XmlWriter]::Create($path,$settings)
    try {$doc.Save($writer)} finally {$writer.Dispose()}
}
function SelectText($doc,[string]$xpath) {
    $manager=New-Object Xml.XmlNamespaceManager($doc.NameTable)
    $manager.AddNamespace('n',$nsUri)
    $node=$doc.SelectSingleNode($xpath,$manager)
    if($node){return $node.InnerText}
    return ''
}
function SignNode($doc,$target,$certificate) {
    $signed=New-Object Security.Cryptography.Xml.SignedXml($doc)
    $signed.SigningKey=[Security.Cryptography.X509Certificates.RSACertificateExtensions]::GetRSAPrivateKey($certificate)
    $signed.SignedInfo.CanonicalizationMethod=[Security.Cryptography.Xml.SignedXml]::XmlDsigC14NTransformUrl
    $signed.SignedInfo.SignatureMethod=[Security.Cryptography.Xml.SignedXml]::XmlDsigRSASHA1Url
    $reference=New-Object Security.Cryptography.Xml.Reference
    $reference.Uri='#'+$target.GetAttribute('Id')
    $reference.DigestMethod=[Security.Cryptography.Xml.SignedXml]::XmlDsigSHA1Url
    $reference.AddTransform((New-Object Security.Cryptography.Xml.XmlDsigEnvelopedSignatureTransform))
    $reference.AddTransform((New-Object Security.Cryptography.Xml.XmlDsigC14NTransform))
    $signed.AddReference($reference)
    $info=New-Object Security.Cryptography.Xml.KeyInfo
    $info.AddClause((New-Object Security.Cryptography.Xml.KeyInfoX509Data($certificate)))
    $signed.KeyInfo=$info
    $signed.ComputeSignature()
    [void]$target.ParentNode.AppendChild($doc.ImportNode($signed.GetXml(),$true))
}
function VerifySignature($doc,$certificate) {
    $signature=$doc.GetElementsByTagName('Signature','http://www.w3.org/2000/09/xmldsig#')
    if($signature.Count -ne 1){throw 'SIGNATURE_COUNT'}
    $signed=New-Object Security.Cryptography.Xml.SignedXml($doc)
    $signed.LoadXml($signature[0])
    if(!$signed.CheckSignature($certificate,$true)){throw 'SIGNATURE_INVALID'}
    $reference=@($signed.SignedInfo.References)[0]
    if($reference.Uri -ne ('#'+$doc.DocumentElement.FirstChild.GetAttribute('Id'))){throw 'SIGNATURE_REFERENCE'}
}
function ValidateNFe($doc) {
    $schema=Join-Path $base 'schemas-010f\nfe_v4.00.xsd'
    $set=New-Object Xml.Schema.XmlSchemaSet
    [void]$set.Add($nsUri,$schema)
    $set.Compile()
    $doc.Schemas=$set
    $messages=New-Object 'Collections.Generic.List[string]'
    $handler=[Xml.Schema.ValidationEventHandler]{param($sender,$event) $messages.Add($event.Message)}
    $doc.Validate($handler)
    if($messages.Count){
        # Esquema pode citar valores fiscais: detalhes somente na pasta privada.
        [IO.File]::WriteAllLines((Join-Path $base 'schema-errors-private.txt'),$messages)
        throw 'XSD_INVALID'
    }
}
function PostSoap([string]$endpoint,[string]$service,[string]$method,[string]$payload,$certificate,[string]$savePath) {
    if($endpoint -notmatch '^https://homologacao\.(nfe|nfce)\.fazenda\.sp\.gov\.br/ws/[a-zA-Z0-9]+\.asmx$'){throw 'ENDPOINT_NOT_HOMOLOGATION'}
    [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12
    [Net.ServicePointManager]::CheckCertificateRevocationList=$true
    $ws='http://www.portalfiscal.inf.br/nfe/wsdl/'+$service
    $action=$ws+'/'+$method
    $body='<soap12:Envelope xmlns:soap12="http://www.w3.org/2003/05/soap-envelope"><soap12:Body><nfeDadosMsg xmlns="'+$ws+'">'+$payload+'</nfeDadosMsg></soap12:Body></soap12:Envelope>'
    $bytes=[Text.Encoding]::UTF8.GetBytes($body)
    $request=[Net.HttpWebRequest]::Create($endpoint)
    $request.Method='POST';$request.ContentType='application/soap+xml; charset=utf-8; action="'+$action+'"'
    $request.Timeout=25000;$request.ReadWriteTimeout=25000;$request.AllowAutoRedirect=$false
    $request.ContentLength=$bytes.Length
    [void]$request.ClientCertificates.Add($certificate)
    $out=$request.GetRequestStream()
    try {$out.Write($bytes,0,$bytes.Length)} finally {$out.Dispose()}
    $response=$request.GetResponse()
    try {
        $stream=$response.GetResponseStream();$buffer=New-Object byte[] 4096;$memory=New-Object IO.MemoryStream
        try {
            while(($count=$stream.Read($buffer,0,$buffer.Length)) -gt 0){
                if($memory.Length+$count -gt 1048576){throw 'RESPONSE_SIZE'}
                $memory.Write($buffer,0,$count)
            }
            $text=[Text.Encoding]::UTF8.GetString($memory.ToArray())
        } finally {$stream.Dispose();$memory.Dispose()}
    } finally {$response.Close()}
    $doc=LoadSafeXml $text
    if($service -eq 'CadConsultaCadastro4') {
        if((SelectText $doc '//n:retConsCad/n:infCons/n:UF') -ne 'SP'){throw 'RESPONSE_STATE'}
    } elseif((SelectText $doc '//n:tpAmb') -ne '2'){throw 'RESPONSE_ENVIRONMENT'}
    SaveXml $doc $savePath
    return ,$doc
}
try {
    if(!$Mode){throw 'MODE_REQUIRED'}
    $path=[IO.Path]::GetFullPath($InputFile)
    if(!$path.StartsWith($base+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)){throw 'INPUT_OUTSIDE_PRIVATE_LAB'}
    $doc=LoadSafeXml ([IO.File]::ReadAllText($path))
    if($doc.DocumentElement.LocalName -ne 'NFe' -or $doc.DocumentElement.NamespaceURI -ne $nsUri){throw 'NFE_ROOT'}
    if((SelectText $doc '/n:NFe/n:infNFe/n:ide/n:tpAmb') -ne '2'){throw 'PRODUCTION_BLOCKED'}
    if((SelectText $doc '/n:NFe/n:infNFe/n:ide/n:cUF') -ne '35'){throw 'STATE_NOT_SP'}
    if((SelectText $doc '/n:NFe/n:infNFe/n:ide/n:mod') -ne $Model){throw 'MODEL_MISMATCH'}
    if((SelectText $doc '/n:NFe/n:infNFe/n:total/n:ICMSTot/n:vNF') -ne '1.00'){throw 'LAB_TOTAL_ONLY_ONE_REAL'}
    $manager=New-Object Xml.XmlNamespaceManager($doc.NameTable);$manager.AddNamespace('n',$nsUri)
    $info=$doc.SelectSingleNode('/n:NFe/n:infNFe',$manager)
    $key=$info.GetAttribute('Id').Replace('NFe','')
    $issuer=SelectText $doc '/n:NFe/n:infNFe/n:emit/n:CNPJ'
    if($key -notmatch '^\d{44}$' -or $key.Substring(6,14) -ne $issuer){throw 'ACCESS_KEY_ISSUER'}
    $phase='certificate'
    $store=New-Object Security.Cryptography.X509Certificates.X509Store('My','CurrentUser')
    $store.Open([Security.Cryptography.X509Certificates.OpenFlags]::ReadOnly)
    $certificates=@($store.Certificates | Where-Object {$_.HasPrivateKey -and $_.NotBefore -le [datetime]::Now -and $_.NotAfter -gt [datetime]::Now -and $_.Subject -match ('(?<!\d)'+$issuer+'(?!\d)')})
    if($certificates.Count -ne 1){throw 'CERTIFICATE_SELECTION'}
    $certificate=$certificates[0]
    $chain=New-Object Security.Cryptography.X509Certificates.X509Chain
    try {
        $chain.ChainPolicy.RevocationMode=[Security.Cryptography.X509Certificates.X509RevocationMode]::Online
        $chain.ChainPolicy.RevocationFlag=[Security.Cryptography.X509Certificates.X509RevocationFlag]::ExcludeRoot
        $chain.ChainPolicy.UrlRetrievalTimeout=[TimeSpan]::FromSeconds(5)
        if(!$chain.Build($certificate)){throw 'CERTIFICATE_CHAIN'}
    } finally {$chain.Dispose()}
    $phase=$Mode
    if($Mode -eq 'Sign') {
        if($doc.GetElementsByTagName('Signature','http://www.w3.org/2000/09/xmldsig#').Count){throw 'ALREADY_SIGNED'}
        SignNode $doc $info $certificate
        VerifySignature $doc $certificate
        ValidateNFe $doc
        $signedPath=[IO.Path]::Combine([IO.Path]::GetDirectoryName($path),[IO.Path]::GetFileNameWithoutExtension($path)+'-signed.xml')
        SaveXml $doc $signedPath
        @{ok=$true;mode=$Mode;model=$Model;environment='homologacao';signatureValid=$true;schemaValid=$true;privateKeyExported=$false} | ConvertTo-Json -Compress
        exit 0
    }
    VerifySignature $doc $certificate
    ValidateNFe $doc
    if($Mode -eq 'Validate') {
        @{ok=$true;mode=$Mode;model=$Model;environment='homologacao';signatureValid=$true;schemaValid=$true} | ConvertTo-Json -Compress
        exit 0
    }
    $hostName=$(if($Model -eq '55'){'homologacao.nfe.fazenda.sp.gov.br'}else{'homologacao.nfce.fazenda.sp.gov.br'})
    $stem=[IO.Path]::Combine([IO.Path]::GetDirectoryName($path),[IO.Path]::GetFileNameWithoutExtension($path))
    $responsePath=$stem+'-'+$Mode+'-response.xml'
    if($Mode -eq 'Registry') {
        if($Model -ne '55'){throw 'REGISTRY_MODEL'}
        $payload='<ConsCad xmlns="'+$nsUri+'" versao="2.00"><infCons><xServ>CONS-CAD</xServ><UF>SP</UF><CNPJ>'+$issuer+'</CNPJ></infCons></ConsCad>'
        $response=PostSoap 'https://homologacao.nfe.fazenda.sp.gov.br/ws/cadconsultacadastro4.asmx' 'CadConsultaCadastro4' 'consultaCadastro' $payload $certificate $responsePath
        @{ok=$true;mode=$Mode;environment='homologacao';cStat=(SelectText $response '//n:retConsCad/n:infCons/n:cStat');reason=(SelectText $response '//n:retConsCad/n:infCons/n:xMotivo');taxRegime=(SelectText $response '//n:infCad/n:xRegApur');registrationStatus=(SelectText $response '//n:infCad/n:cSit');privateKeyExported=$false} | ConvertTo-Json -Compress
    } elseif($Mode -eq 'Authorize') {
        $marker=Join-Path $base ($key+'-authorization-attempt.json')
        if([IO.File]::Exists($marker)){throw 'AUTHORIZATION_ALREADY_ATTEMPTED_QUERY_FIRST'}
        # Uma tentativa por chave. Apos falha/timeout, consultar antes de decidir outra acao.
        $lock=[IO.File]::Open($marker,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
        try {$b=[Text.Encoding]::UTF8.GetBytes('{"environment":"homologacao","attempted":true}');$lock.Write($b,0,$b.Length)} finally {$lock.Dispose()}
        $endpoint='https://'+$hostName+'/ws/NFeAutorizacao4.asmx'
        $batch=[datetime]::UtcNow.ToString('yyyyMMddHHmmss')
        $payload='<enviNFe xmlns="'+$nsUri+'" versao="4.00"><idLote>'+$batch+'</idLote><indSinc>1</indSinc>'+$doc.DocumentElement.OuterXml+'</enviNFe>'
        $response=PostSoap $endpoint 'NFeAutorizacao4' 'nfeAutorizacaoLote' $payload $certificate $responsePath
        $status=SelectText $response '//n:retEnviNFe/n:cStat';$reason=SelectText $response '//n:retEnviNFe/n:xMotivo'
        $documentStatus=SelectText $response '//n:infProt/n:cStat';$protocol=SelectText $response '//n:infProt/n:nProt'
        if($documentStatus -in @('100','150')) {
            if((SelectText $response '//n:infProt/n:chNFe') -ne $key -or $protocol -notmatch '^\d{15,17}$'){throw 'PROTOCOL_MISMATCH'}
            $digest=$doc.GetElementsByTagName('DigestValue','http://www.w3.org/2000/09/xmldsig#')[0].InnerText
            if((SelectText $response '//n:infProt/n:digVal') -ne $digest){throw 'PROTOCOL_DIGEST_MISMATCH'}
            $proc=LoadSafeXml ('<nfeProc xmlns="'+$nsUri+'" versao="4.00">'+$doc.DocumentElement.OuterXml+$response.SelectSingleNode('//n:protNFe',$manager).OuterXml+'</nfeProc>')
            SaveXml $proc ($stem+'-procNFe.xml')
        }
        @{ok=$true;mode=$Mode;model=$Model;environment='homologacao';batchStatus=$status;reason=$reason;documentStatus=$documentStatus;documentReason=(SelectText $response '//n:infProt/n:xMotivo');authorized=($documentStatus -in @('100','150'));protocolReceived=($protocol.Length -gt 0);privateKeyExported=$false} | ConvertTo-Json -Compress
    } elseif($Mode -eq 'Query') {
        $endpoint='https://'+$hostName+'/ws/NFeConsultaProtocolo4.asmx'
        $payload='<consSitNFe xmlns="'+$nsUri+'" versao="4.00"><tpAmb>2</tpAmb><xServ>CONSULTAR</xServ><chNFe>'+$key+'</chNFe></consSitNFe>'
        $response=PostSoap $endpoint 'NFeConsultaProtocolo4' 'nfeConsultaNF' $payload $certificate $responsePath
        @{ok=$true;mode=$Mode;model=$Model;environment='homologacao';cStat=(SelectText $response '//n:retConsSitNFe/n:cStat');reason=(SelectText $response '//n:retConsSitNFe/n:xMotivo');privateKeyExported=$false} | ConvertTo-Json -Compress
    } elseif($Mode -eq 'Cancel') {
        $authorization=LoadSafeXml ([IO.File]::ReadAllText($stem+'-Authorize-response.xml'))
        $protocol=SelectText $authorization '//n:infProt/n:nProt'
        if((SelectText $authorization '//n:infProt/n:chNFe') -ne $key -or (SelectText $authorization '//n:infProt/n:cStat') -notin @('100','150')){throw 'CANCEL_REQUIRES_AUTHORIZATION'}
        $cancelMarker=Join-Path $base ($key+'-cancel-attempt.json')
        if([IO.File]::Exists($cancelMarker)){throw 'CANCEL_ALREADY_ATTEMPTED_QUERY_FIRST'}
        $lock=[IO.File]::Open($cancelMarker,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None);$lock.Dispose()
        $eventTime=[datetimeoffset]::Now.ToString('yyyy-MM-ddTHH:mm:sszzz')
        $event=LoadSafeXml ('<evento xmlns="'+$nsUri+'" versao="1.00"><infEvento Id="ID110111'+$key+'01"><cOrgao>35</cOrgao><tpAmb>2</tpAmb><CNPJ>'+$issuer+'</CNPJ><chNFe>'+$key+'</chNFe><dhEvento>'+$eventTime+'</dhEvento><tpEvento>110111</tpEvento><nSeqEvento>1</nSeqEvento><verEvento>1.00</verEvento><detEvento versao="1.00"><descEvento>Cancelamento</descEvento><nProt>'+$protocol+'</nProt><xJust>Cancelamento de documento ficticio de homologacao para teste do aplicativo GasGestao</xJust></detEvento></infEvento></evento>')
        SignNode $event $event.DocumentElement.FirstChild $certificate
        VerifySignature $event $certificate
        SaveXml $event ($stem+'-cancel-event.xml')
        $payload='<envEvento xmlns="'+$nsUri+'" versao="1.00"><idLote>'+[datetime]::UtcNow.ToString('yyyyMMddHHmmss')+'</idLote>'+$event.DocumentElement.OuterXml+'</envEvento>'
        $response=PostSoap ('https://'+$hostName+'/ws/NFeRecepcaoEvento4.asmx') 'NFeRecepcaoEvento4' 'nfeRecepcaoEventoNF' $payload $certificate $responsePath
        @{ok=$true;mode=$Mode;model=$Model;environment='homologacao';batchStatus=(SelectText $response '//n:retEnvEvento/n:cStat');eventStatus=(SelectText $response '//n:retEvento/n:infEvento/n:cStat');eventReason=(SelectText $response '//n:retEvento/n:infEvento/n:xMotivo');privateKeyExported=$false} | ConvertTo-Json -Compress
    } elseif($Mode -eq 'Inutilize') {
        # Somente dois numeros anteriores que tenham tentativa rejeitada e consulta 217 registrada neste laboratorio.
        $currentNumber=[int](SelectText $doc '/n:NFe/n:infNFe/n:ide/n:nNF')
        $series=SelectText $doc '/n:NFe/n:infNFe/n:ide/n:serie'
        if($Model -ne '55' -or $series -ne '829' -or $currentNumber -lt 3){throw 'INUTILIZE_LAB_RANGE_ONLY'}
        $start=$currentNumber-2;$end=$currentNumber-1
        $records=@(Get-ChildItem -LiteralPath $base -Filter '*-signed-Authorize-response.xml' -File)
        for($number=$start;$number -le $end;$number++){
            $verified=$false
            foreach($record in $records){
                $prior=LoadSafeXml ([IO.File]::ReadAllText($record.FullName))
                $priorKey=SelectText $prior '//n:infProt/n:chNFe'
                if($priorKey -notmatch '^\d{44}$' -or $priorKey.Substring(6,14) -ne $issuer -or $priorKey.Substring(20,2) -ne $Model -or [int]$priorKey.Substring(22,3) -ne 829 -or [int]$priorKey.Substring(25,9) -ne $number){continue}
                if((SelectText $prior '//n:infProt/n:cStat') -in @('100','150')){throw 'INUTILIZE_AUTHORIZED_NUMBER_BLOCKED'}
                $queryPath=$record.FullName.Replace('-Authorize-response.xml','-Query-response.xml')
                $queried=LoadSafeXml ([IO.File]::ReadAllText($queryPath))
                if((SelectText $queried '//n:retConsSitNFe/n:cStat') -ne '217'){throw 'INUTILIZE_REQUIRES_NOT_FOUND_QUERY'}
                $verified=$true
            }
            if(!$verified){throw 'INUTILIZE_MISSING_REJECTED_LAB_RECORD'}
        }
        $year=([datetime]::Now.Year%100).ToString('00')
        $id='ID35'+$year+$issuer+$Model+$series.PadLeft(3,'0')+$start.ToString().PadLeft(9,'0')+$end.ToString().PadLeft(9,'0')
        $marker=Join-Path $base ($id+'-inutilize-attempt.json')
        if([IO.File]::Exists($marker)){throw 'INUTILIZE_ALREADY_ATTEMPTED'}
        $inut=LoadSafeXml ('<inutNFe xmlns="'+$nsUri+'" versao="4.00"><infInut Id="'+$id+'"><tpAmb>2</tpAmb><xServ>INUTILIZAR</xServ><cUF>35</cUF><ano>'+$year+'</ano><CNPJ>'+$issuer+'</CNPJ><mod>'+$Model+'</mod><serie>'+$series+'</serie><nNFIni>'+$start+'</nNFIni><nNFFin>'+$end+'</nNFFin><xJust>Inutilizacao de numeros rejeitados nos testes ficticios do laboratorio GasGestao</xJust></infInut></inutNFe>')
        SignNode $inut $inut.DocumentElement.FirstChild $certificate
        VerifySignature $inut $certificate
        SaveXml $inut ($stem+'-inutilize-signed.xml')
        $lock=[IO.File]::Open($marker,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None);$lock.Dispose()
        $response=PostSoap ('https://'+$hostName+'/ws/NFeInutilizacao4.asmx') 'NFeInutilizacao4' 'nfeInutilizacaoNF' $inut.DocumentElement.OuterXml $certificate $responsePath
        @{ok=$true;mode=$Mode;model=$Model;environment='homologacao';cStat=(SelectText $response '//n:retInutNFe/n:infInut/n:cStat');reason=(SelectText $response '//n:retInutNFe/n:infInut/n:xMotivo');start=$start;end=$end;privateKeyExported=$false} | ConvertTo-Json -Compress
    } else {throw 'MODE_NOT_IMPLEMENTED'}
} catch {
    # Excecao completa pode conter caminhos, identificadores ou XML: nao a imprime.
    $code=$_.Exception.Message
    if($code -notmatch '^[A-Z][A-Z0-9_]{2,70}$'){$code='LAB_OPERATION_FAILED'}
    @{ok=$false;code=$code;phase=$phase;model=$Model;environment='homologacao';privateKeyExported=$false;exceptionType=$_.Exception.GetType().Name;scriptLine=$_.InvocationInfo.ScriptLineNumber} | ConvertTo-Json -Compress
    exit 1
} finally {if($store){$store.Close()}}
