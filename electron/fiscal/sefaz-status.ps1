param(
    [ValidateSet('List','Status')][string]$Mode='List',
    [string]$Thumbprint='',
    [ValidateSet('55','65')][string]$Model='55'
)
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
[Console]::OutputEncoding=New-Object System.Text.UTF8Encoding($false)
$store=New-Object System.Security.Cryptography.X509Certificates.X509Store('My','CurrentUser')
$phase='certificate_store'
function CertificateInfo($certificate) {
    $company=[regex]::Match($certificate.Subject,'(?<!\d)(\d{14})(?!\d)')
    $label=$certificate.GetNameInfo([System.Security.Cryptography.X509Certificates.X509NameType]::SimpleName,$false)
    $label=[regex]::Replace($label,'(?<!\d)\d{10}(\d{4})(?!\d)','**********$1')
    return [ordered]@{thumbprint=$certificate.Thumbprint;label=$label;cnpjSuffix=$(if($company.Success){$company.Value.Substring(10)}else{''});hasCompanyId=$company.Success;validFrom=$certificate.NotBefore.ToString('yyyy-MM-dd');validUntil=$certificate.NotAfter.ToString('yyyy-MM-dd');hasPrivateKey=$certificate.HasPrivateKey;validNow=($certificate.NotBefore -le [datetime]::Now -and $certificate.NotAfter -gt [datetime]::Now);store='CurrentUser/My'}
}
try {
    $store.Open([System.Security.Cryptography.X509Certificates.OpenFlags]::ReadOnly)
    $certificates=@($store.Certificates | Where-Object {$_.HasPrivateKey -and $_.Issuer -match 'ICP|AC |Certisign|SERASA|Soluti|VALID'})
    if($Mode -eq 'List') {
        $items=@($certificates | ForEach-Object {CertificateInfo $_})
        @{ok=$true;certificates=$items} | ConvertTo-Json -Depth 5 -Compress
        exit 0
    }
    if($Thumbprint -notmatch '^[a-fA-F0-9]{40}$'){throw 'CERTIFICATE_SELECTION_INVALID'}
    $certificate=@($certificates | Where-Object {$_.Thumbprint -eq $Thumbprint})
    if($certificate.Count -ne 1){throw 'CERTIFICATE_NOT_FOUND'}
    $certificate=$certificate[0]
    $info=CertificateInfo $certificate
    if(!$info.validNow){throw 'CERTIFICATE_EXPIRED_OR_NOT_YET_VALID'}
    if(!$info.hasCompanyId){throw 'CERTIFICATE_COMPANY_ID_MISSING'}
    $phase='certificate_chain'
    $chain=New-Object System.Security.Cryptography.X509Certificates.X509Chain
    try {
        $chain.ChainPolicy.RevocationMode=[System.Security.Cryptography.X509Certificates.X509RevocationMode]::Online
        $chain.ChainPolicy.RevocationFlag=[System.Security.Cryptography.X509Certificates.X509RevocationFlag]::ExcludeRoot
        $chain.ChainPolicy.VerificationFlags=[System.Security.Cryptography.X509Certificates.X509VerificationFlags]::NoFlag
        $chain.ChainPolicy.UrlRetrievalTimeout=[TimeSpan]::FromSeconds(5)
        if(!$chain.Build($certificate)){throw 'CERTIFICATE_CHAIN_NOT_TRUSTED'}
    } finally {$chain.Dispose()}
    # Destinos fixos: somente status de homologacao. Nenhuma emissao ou producao.
    if($Model -eq '55'){$endpoint='https://homologacao.nfe.fazenda.sp.gov.br/ws/nfestatusservico4.asmx'}
    else {$endpoint='https://homologacao.nfce.fazenda.sp.gov.br/ws/NFeStatusServico4.asmx'}
    [System.Net.ServicePointManager]::SecurityProtocol=[System.Net.SecurityProtocolType]::Tls12
    [System.Net.ServicePointManager]::CheckCertificateRevocationList=$true
    $action='http://www.portalfiscal.inf.br/nfe/wsdl/NFeStatusServico4/nfeStatusServicoNF'
    $xml='<?xml version="1.0" encoding="utf-8"?><soap12:Envelope xmlns:soap12="http://www.w3.org/2003/05/soap-envelope"><soap12:Body><nfeDadosMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeStatusServico4"><consStatServ xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"><tpAmb>2</tpAmb><cUF>35</cUF><xServ>STATUS</xServ></consStatServ></nfeDadosMsg></soap12:Body></soap12:Envelope>'
    $bytes=[System.Text.Encoding]::UTF8.GetBytes($xml)
    $phase='https_status'
    $request=[System.Net.HttpWebRequest]::Create($endpoint)
    $request.Method='POST'
    $request.ContentType='application/soap+xml; charset=utf-8; action="'+$action+'"'
    $request.Timeout=15000
    $request.ReadWriteTimeout=15000
    $request.AllowAutoRedirect=$false
    $request.ContentLength=$bytes.Length
    [void]$request.ClientCertificates.Add($certificate)
    $out=$request.GetRequestStream()
    try {$out.Write($bytes,0,$bytes.Length)} finally {$out.Dispose()}
    $response=$request.GetResponse()
    try {
        $stream=$response.GetResponseStream()
        $buffer=New-Object byte[] 4096
        $memory=New-Object System.IO.MemoryStream
        try {
            while(($count=$stream.Read($buffer,0,$buffer.Length)) -gt 0){
                if($memory.Length+$count -gt 262144){throw 'RESPONSE_TOO_LARGE'}
                $memory.Write($buffer,0,$count)
            }
            $body=[System.Text.Encoding]::UTF8.GetString($memory.ToArray())
        } finally {$stream.Dispose();$memory.Dispose()}
    } finally {$response.Close()}
    $phase='response_validation'
    $settings=New-Object System.Xml.XmlReaderSettings
    $settings.DtdProcessing=[System.Xml.DtdProcessing]::Prohibit
    $settings.XmlResolver=$null
    $reader=[System.Xml.XmlReader]::Create((New-Object System.IO.StringReader($body)),$settings)
    $document=New-Object System.Xml.XmlDocument
    $document.XmlResolver=$null
    try {$document.Load($reader)} finally {$reader.Dispose()}
    $result=$document.SelectSingleNode('//*[local-name()="retConsStatServ" and namespace-uri()="http://www.portalfiscal.inf.br/nfe"]')
    if(!$result){throw 'INVALID_SEFAZ_RESPONSE'}
    $ns=New-Object System.Xml.XmlNamespaceManager($document.NameTable)
    $ns.AddNamespace('n','http://www.portalfiscal.inf.br/nfe')
    $status=$result.SelectSingleNode('n:cStat',$ns).InnerText
    $reason=$result.SelectSingleNode('n:xMotivo',$ns).InnerText
    $environment=$result.SelectSingleNode('n:tpAmb',$ns).InnerText
    $state=$result.SelectSingleNode('n:cUF',$ns).InnerText
    if($environment -ne '2' -or $state -ne '35' -or $status -notmatch '^\d{3}$'){throw 'INVALID_SEFAZ_ENVIRONMENT'}
    @{ok=$true;model=$Model;environment='homologacao';tpAmb=2;state='SP';cUF=35;endpoint=$endpoint;cStat=$status;reason=$reason;checkedAt=[datetime]::UtcNow.ToString('o');validUntil=$info.validUntil;privateKeyExported=$false;chainValidated=$true;operation='STATUS';live=$true} | ConvertTo-Json -Depth 5 -Compress
} catch {
    # Nao exporta a excecao bruta: pode conter detalhes do provedor ou certificado.
    $code=$_.Exception.Message
    $exception=$_.Exception
    while($exception.InnerException -and !($exception -is [System.Net.WebException])){$exception=$exception.InnerException}
    $transportStatus=''
    $knownCodes=@('CERTIFICATE_SELECTION_INVALID','CERTIFICATE_NOT_FOUND','CERTIFICATE_EXPIRED_OR_NOT_YET_VALID','CERTIFICATE_COMPANY_ID_MISSING','CERTIFICATE_CHAIN_NOT_TRUSTED','RESPONSE_TOO_LARGE','INVALID_SEFAZ_RESPONSE','INVALID_SEFAZ_ENVIRONMENT')
    if($code -notin $knownCodes) {
        $code='SEFAZ_CONNECTION_FAILED'
        if($exception -is [System.Net.WebException]){
            $transportStatus=[string]$exception.Status
            if($exception.Response){$code='HTTP_'+[int]$exception.Response.StatusCode}
        }
    }
    @{ok=$false;code=$code;model=$Model;phase=$phase;transportStatus=$transportStatus;exceptionType=$exception.GetType().Name;environment='homologacao';operation='STATUS';privateKeyExported=$false} | ConvertTo-Json -Compress
    exit 1
} finally {$store.Close()}
