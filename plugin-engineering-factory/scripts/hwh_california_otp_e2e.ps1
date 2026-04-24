param(
    [string]$ApiHost = 'ca-hwh-api.915500.xyz',
    [string]$SiteHost = 'ca-hwh.915500.xyz',
    [string]$IpAddress = '134.199.226.198',
    [string]$ProductKey = 'leadfill-one-profile',
    [string]$ExtensionId = 'dnnpkaefmlhacigijccbhemgaenjbcpk',
    [string]$Version = '0.2.0',
    [string]$OutputPath = ''
)

$ErrorActionPreference = 'Stop'

$sshKey = Join-Path $env:USERPROFILE '.ssh\id_ed25519_do_auto'
$apiBase = "https://$ApiHost"
$siteBase = "https://$SiteHost"
$resolveArgs = @('--resolve', "$ApiHost`:443:$IpAddress", '-k')

function Get-CaliforniaAnonKey {
    $anon = ssh -i $sshKey "root@$IpAddress" "python3 - <<'PY'
from pathlib import Path
for line in Path('/opt/supabase-core/.env').read_text().splitlines():
    if line.startswith('ANON_KEY='):
        print(line.split('=', 1)[1])
        break
PY"
    if (-not $anon) {
        throw 'Missing California ANON_KEY'
    }
    return $anon.Trim()
}

function Invoke-CurlJson {
    param(
        [Parameter(Mandatory = $true)][string]$Url,
        [string]$Method = 'POST',
        [string]$Body = '',
        [hashtable]$Headers = @{}
    )

    $requestPath = Join-Path $env:TEMP ("codex-" + [guid]::NewGuid().ToString('N') + '.json')
    if ($Body -ne '') {
        Set-Content -Path $requestPath -Value $Body -Encoding ascii
    }

    try {
        $args = @('--silent', '--show-error') + $resolveArgs + @('--write-out', "`nHTTPSTATUS:%{http_code}", '-X', $Method, $Url)
        foreach ($headerName in $Headers.Keys) {
            $args += @('-H', ($headerName + ': ' + $Headers[$headerName]))
        }
        if ($Body -ne '') {
            $args += @('--data-binary', "@$requestPath")
        }

        $raw = & curl.exe @args
        $rawText = [string]::Join("`n", @($raw))
        $statusMatch = [regex]::Match($rawText, 'HTTPSTATUS:(\d{3})\s*$')
        if (-not $statusMatch.Success) {
            throw 'Unable to parse curl HTTP status'
        }
        $statusCode = [int]$statusMatch.Groups[1].Value
        $bodyText = $rawText.Substring(0, $statusMatch.Index).TrimEnd()
        $json = $null
        if ($bodyText -and $bodyText.Trim()) {
            try {
                $json = $bodyText | ConvertFrom-Json
                if ($json -is [string] -and (($json.Trim().StartsWith('{')) -or ($json.Trim().StartsWith('[')))) {
                    $json = $json | ConvertFrom-Json
                }
            } catch {
                $json = $bodyText
            }
        }

        return [pscustomobject]@{
            status = $statusCode
            body = $json
            raw = $bodyText
        }
    } finally {
        Remove-Item $requestPath -ErrorAction SilentlyContinue
    }
}

function New-MailTmAccount {
    $domainResponse = Invoke-RestMethod -UseBasicParsing -Uri 'https://api.mail.tm/domains' -TimeoutSec 20
    $domain = ($domainResponse.'hydra:member' | Select-Object -First 1).domain
    if (-not $domain) {
        throw 'No mail.tm domain available'
    }

    $address = 'leadfill' + [guid]::NewGuid().ToString('N').Substring(0, 10) + '@' + $domain
    $password = 'P@ssw0rd-' + [guid]::NewGuid().ToString('N').Substring(0, 12)

    $null = Invoke-RestMethod `
        -Method Post `
        -UseBasicParsing `
        -Uri 'https://api.mail.tm/accounts' `
        -ContentType 'application/json' `
        -Body (@{ address = $address; password = $password } | ConvertTo-Json -Compress) `
        -TimeoutSec 20

    $tokenResponse = Invoke-RestMethod `
        -Method Post `
        -UseBasicParsing `
        -Uri 'https://api.mail.tm/token' `
        -ContentType 'application/json' `
        -Body (@{ address = $address; password = $password } | ConvertTo-Json -Compress) `
        -TimeoutSec 20

    return [pscustomobject]@{
        address = $address
        password = $password
        token = $tokenResponse.token
    }
}

function Get-LatestMailboxMessage {
    param([string]$Token)

    $headers = @{ Authorization = "Bearer $Token" }
    $messages = Invoke-RestMethod -UseBasicParsing -Headers $headers -Uri 'https://api.mail.tm/messages' -TimeoutSec 20
    $latest = $messages.'hydra:member' | Sort-Object createdAt -Descending | Select-Object -First 1
    if (-not $latest) {
        return $null
    }

    $detail = Invoke-RestMethod -UseBasicParsing -Headers $headers -Uri ('https://api.mail.tm/messages/' + $latest.id) -TimeoutSec 20
    return [pscustomobject]@{
        id = $latest.id
        subject = $detail.subject
        createdAt = $detail.createdAt
        text = $detail.text
    }
}

function Get-OtpCodeFromMessage {
    param([string]$Text)

    if ($null -eq $Text) {
        $Text = ''
    }

    $primary = [regex]::Match($Text, 'enter the code:\s*(\d{6})', 'IgnoreCase')
    if ($primary.Success) {
        return $primary.Groups[1].Value
    }

    $fallback = [regex]::Match($Text, '\b(\d{6})\b')
    if ($fallback.Success) {
        return $fallback.Groups[1].Value
    }

    return $null
}

function Get-UrlHostsFromMessage {
    param([string]$Text)

    if ($null -eq $Text) {
        $Text = ''
    }

    $matches = [regex]::Matches($Text, 'https?://([A-Za-z0-9\\.-]+)')
    if (-not $matches.Count) {
        return @()
    }

    return @(
        $matches |
            ForEach-Object { $_.Groups[1].Value.ToLowerInvariant() } |
            Sort-Object -Unique
    )
}

$blockers = New-Object System.Collections.Generic.List[string]
$anonKey = Get-CaliforniaAnonKey
$mailbox = New-MailTmAccount

$publicHeaders = @{
    'Content-Type' = 'application/json'
    'apikey' = $anonKey
    'Origin' = $siteBase
    'Referer' = "$siteBase/login"
}

$sendOtp = Invoke-CurlJson `
    -Url "$apiBase/auth/v1/otp" `
    -Body (@{ email = $mailbox.address; create_user = $true } | ConvertTo-Json -Compress) `
    -Headers $publicHeaders

$message = $null
for ($attempt = 0; $attempt -lt 24; $attempt++) {
    Start-Sleep -Seconds 5
    $candidate = Get-LatestMailboxMessage -Token $mailbox.token
    if ($candidate) {
        $message = $candidate
        break
    }
}

if (-not $message) {
    $blockers.Add('OTP_EMAIL_NOT_DELIVERED')
}

$otpCode = if ($message) { Get-OtpCodeFromMessage -Text $message.text } else { $null }
$messageHosts = if ($message) { Get-UrlHostsFromMessage -Text $message.text } else { @() }
if (-not $otpCode) {
    $blockers.Add('OTP_CODE_NOT_FOUND')
}

$verifyOtp = $null
$accessToken = $null
if ($otpCode) {
    $verifyOtp = Invoke-CurlJson `
        -Url "$apiBase/auth/v1/verify" `
        -Body (@{ email = $mailbox.address; token = $otpCode; type = 'email' } | ConvertTo-Json -Compress) `
        -Headers $publicHeaders
    $accessToken = $verifyOtp.body.access_token
    if (-not $accessToken) {
        $blockers.Add('VERIFY_OTP_NO_SESSION')
    }
} else {
    $verifyOtp = [pscustomobject]@{ status = 0; body = $null; raw = '' }
}

$installationId = [guid]::NewGuid().ToString()
$getEntitlement = $null
$registerInstallation = $null
$usageResults = @()

if ($accessToken) {
    $authHeaders = @{
        'Content-Type' = 'application/json'
        'apikey' = $anonKey
        'Authorization' = "Bearer $accessToken"
        'Origin' = $siteBase
        'Referer' = "$siteBase/account"
    }

    $getEntitlement = Invoke-CurlJson `
        -Url "$apiBase/functions/v1/get-entitlement" `
        -Body (@{ productKey = $ProductKey } | ConvertTo-Json -Compress) `
        -Headers $authHeaders

    $registerInstallation = Invoke-CurlJson `
        -Url "$apiBase/functions/v1/register-installation" `
        -Body (@{
            productKey = $ProductKey
            installationId = $installationId
            extensionId = $ExtensionId
            browser = 'chrome'
            version = $Version
        } | ConvertTo-Json -Compress) `
        -Headers $authHeaders

    for ($index = 1; $index -le 11; $index++) {
        $usageResults += Invoke-CurlJson `
            -Url "$apiBase/functions/v1/consume-usage" `
            -Body (@{
                productKey = $ProductKey
                featureKey = 'leadfill_fill_action'
                amount = 1
                installationId = $installationId
            } | ConvertTo-Json -Compress) `
            -Headers $authHeaders
    }
}

$report = [pscustomobject]@{
    email = $mailbox.address
    send_otp = $sendOtp
    latest_message = if ($message) {
        [pscustomobject]@{
            id = $message.id
            subject = $message.subject
            createdAt = $message.createdAt
            urlHosts = $messageHosts
            mentionsWeiWang = ($messageHosts | Where-Object { $_ -match 'weiwang' }).Count -gt 0
        }
    } else {
        $null
    }
    verify_otp = $verifyOtp
    user_id = if ($verifyOtp -and $verifyOtp.body -and $verifyOtp.body.user) { $verifyOtp.body.user.id } else { $null }
    installation_id = $installationId
    get_entitlement = $getEntitlement
    register_installation = $registerInstallation
    usage_results = $usageResults
    blockers = @($blockers)
}

$json = $report | ConvertTo-Json -Depth 50
if ($OutputPath) {
    Set-Content -Path $OutputPath -Value $json -Encoding UTF8
}

$json
