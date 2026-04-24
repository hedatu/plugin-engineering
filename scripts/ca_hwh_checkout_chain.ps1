param(
  [ValidateSet('web', 'chrome_extension')]
  [string]$Source = 'web'
)

$ErrorActionPreference = 'Stop'

$mailtmPath = Join-Path $env:TEMP 'mailtm-otp.json'
if (-not (Test-Path $mailtmPath)) {
  throw 'mailtm-otp.json not found'
}

$mailtm = Get-Content $mailtmPath | ConvertFrom-Json
$apiBase = 'https://ca-hwh-api.915500.xyz'
$siteBase = 'https://ca-hwh.915500.xyz'
$installationIdPath = Join-Path $PSScriptRoot '..\\tmp_known_installation_id.txt'
$sessionOut = Join-Path $env:TEMP 'ca-hwh-session.json'
$mailHeaders = @{ Authorization = ('Bearer ' + $mailtm.token) }
$distAssetsPath = Join-Path $PSScriptRoot '..\\apps\\web\\dist\\assets'

function Get-LatestMailMessage {
  $messages = Invoke-RestMethod -UseBasicParsing -Headers $mailHeaders -Uri 'https://api.mail.tm/messages' -TimeoutSec 20
  $latest = $messages.'hydra:member' | Sort-Object -Property createdAt -Descending | Select-Object -First 1
  if (-not $latest) {
    return $null
  }

  $detail = Invoke-RestMethod -UseBasicParsing -Headers $mailHeaders -Uri ('https://api.mail.tm/messages/' + $latest.id) -TimeoutSec 20
  return [pscustomobject]@{
    id = $latest.id
    createdAt = $detail.createdAt
    text = $detail.text
    subject = $detail.subject
  }
}

function Invoke-JsonPost {
  param(
    [Parameter(Mandatory = $true)][string]$Url,
    [Parameter(Mandatory = $true)][string]$Body,
    [hashtable]$Headers = @{}
  )

  $reqPath = Join-Path $env:TEMP ('req_' + [guid]::NewGuid().ToString('N') + '.json')
  Set-Content -Path $reqPath -Value $Body -Encoding ascii
  try {
    $curlArgs = @('--silent', '--show-error', '-X', 'POST', $Url, '-H', 'Content-Type: application/json', '--data-binary', "@$reqPath")
    foreach ($key in $Headers.Keys) {
      $curlArgs += @('-H', ($key + ': ' + $Headers[$key]))
    }

    $raw = & curl.exe @curlArgs
    return ($raw | ConvertFrom-Json)
  } finally {
    Remove-Item $reqPath -ErrorAction SilentlyContinue
  }
}

function Test-AnonKeyCandidate {
  param([Parameter(Mandatory = $true)][string]$Candidate)

  $tmpHeaders = Join-Path $env:TEMP ('auth_probe_' + [guid]::NewGuid().ToString('N') + '.txt')
  try {
    $response = & curl.exe `
      --silent `
      --show-error `
      --write-out '%{http_code}' `
      --output $tmpHeaders `
      'https://ca-hwh-api.915500.xyz/auth/v1/settings' `
      -H ('apikey: ' + $Candidate)

    return ($response -eq '200')
  } finally {
    Remove-Item $tmpHeaders -ErrorAction SilentlyContinue
  }
}

function Resolve-WorkingAnonKey {
  $candidates = New-Object System.Collections.Generic.List[string]
  $envFile = Join-Path $PSScriptRoot '..\\apps\\web\\.env.production.local'
  if (Test-Path $envFile) {
    $candidate = ((Get-Content $envFile | Where-Object {
      $_ -match '^PUBLIC_SUPABASE_ANON_KEY='
    } | Select-Object -First 1) -replace '^PUBLIC_SUPABASE_ANON_KEY=', '').Trim()
    if ($candidate) {
      $candidates.Add($candidate)
    }
  }

  if (Test-Path $distAssetsPath) {
    Get-ChildItem $distAssetsPath -Filter '*.js' | ForEach-Object {
      $content = Get-Content $_.FullName -Raw
      [regex]::Matches($content, 'eyJ[a-zA-Z0-9._-]{100,}') | ForEach-Object {
        if (-not $candidates.Contains($_.Value)) {
          $candidates.Add($_.Value)
        }
      }
    }
  }

  foreach ($candidate in $candidates) {
    if (Test-AnonKeyCandidate -Candidate $candidate) {
      return $candidate
    }
  }

  throw 'No working public anon key candidate passed auth/v1/settings on California staging'
}

$anon = Resolve-WorkingAnonKey

$latestBefore = Get-LatestMailMessage
$sendOtpResponse = Invoke-JsonPost `
  -Url ($apiBase + '/auth/v1/otp') `
  -Body (@{ email = $mailtm.address; create_user = $true } | ConvertTo-Json -Compress) `
  -Headers @{ apikey = $anon; Origin = $siteBase; Referer = ($siteBase + '/login') }

$message = $null
for ($attempt = 0; $attempt -lt 24; $attempt++) {
  Start-Sleep -Seconds 5
  $candidate = Get-LatestMailMessage
  if ($null -eq $candidate) {
    continue
  }

  if ($null -eq $latestBefore -or $candidate.id -ne $latestBefore.id -or $candidate.createdAt -ne $latestBefore.createdAt) {
    $message = $candidate
    break
  }
}

if ($null -eq $message) {
  throw 'No new OTP email delivered after SEND_OTP'
}

$codeMatch = [regex]::Match($message.text, 'enter the code:\s*(\d{6})', 'IgnoreCase')
$code = $codeMatch.Groups[1].Value
if (-not $code) {
  throw 'OTP code not found in mailbox message'
}

$verify = Invoke-JsonPost `
  -Url ($apiBase + '/auth/v1/verify') `
  -Body (@{ email = $mailtm.address; token = $code; type = 'email' } | ConvertTo-Json -Compress) `
  -Headers @{ apikey = $anon; Origin = $siteBase; Referer = ($siteBase + '/login') }

$access = $verify.access_token
if (-not $access) {
  throw 'VERIFY_OTP did not return access_token'
}

$installId = if (Test-Path $installationIdPath) {
  (Get-Content -Raw $installationIdPath).Trim()
} else {
  [guid]::NewGuid().ToString()
}

$authHeaders = @{
  apikey = $anon
  Authorization = ('Bearer ' + $access)
}

$registerInstallation = Invoke-JsonPost `
  -Url ($apiBase + '/functions/v1/register-installation') `
  -Body (@{
      productKey = 'leadfill-one-profile'
      installationId = $installId
      extensionId = 'dnnpkaefmlhacigijccbhemgaenjbcpk'
      browser = 'chrome'
      version = '0.2.0'
    } | ConvertTo-Json -Compress) `
  -Headers $authHeaders

if ($registerInstallation.registered -eq $true) {
  Set-Content -Path $installationIdPath -Value $installId -Encoding ascii
}

$checkout = Invoke-JsonPost `
  -Url ($apiBase + '/functions/v1/create-checkout-session') `
  -Body (@{
      productKey = 'leadfill-one-profile'
      planKey = 'lifetime'
      installationId = $installId
      source = $Source
    } | ConvertTo-Json -Compress) `
  -Headers $authHeaders

if (-not $checkout.checkoutUrl) {
  throw 'create-checkout-session did not return checkoutUrl'
}

@{
  email = $mailtm.address
  access_token = $access
  user_id = $verify.user.id
  installation_id = $installId
  anon_key = $anon
  source = $Source
  checkout_url = $checkout.checkoutUrl
  session_id = $checkout.sessionId
  local_order_id = $checkout.localOrderId
  created_at = (Get-Date).ToUniversalTime().ToString('o')
} | ConvertTo-Json -Depth 5 | Set-Content -Path $sessionOut -Encoding utf8

[pscustomobject]@{
  email = $mailtm.address
  user_id = $verify.user.id
  installation_id = $installId
  source = $Source
  checkout_url = $checkout.checkoutUrl
  session_id = $checkout.sessionId
  local_order_id = $checkout.localOrderId
  send_otp_http_ok = [bool]$sendOtpResponse
} | ConvertTo-Json -Depth 8
