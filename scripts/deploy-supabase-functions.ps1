param(
  [string]$ProjectRef = ""
)

$ErrorActionPreference = "Stop"

$commonArgs = @()
if ($ProjectRef) {
  $commonArgs += @("--project-ref", $ProjectRef)
}

$functions = @(
  "create-checkout-session",
  "get-entitlement",
  "consume-usage",
  "register-installation"
)

foreach ($fn in $functions) {
  Write-Host "Deploying $fn ..."
  & supabase functions deploy $fn @commonArgs
}

Write-Host "Deploying waffo-webhook with --no-verify-jwt ..."
& supabase functions deploy waffo-webhook --no-verify-jwt @commonArgs

