param(
  [string]$HostName = "134.199.226.198",
  [string]$User = "root",
  [string]$IdentityFile = "$env:USERPROFILE\.ssh\id_ed25519_do_auto",
  [string]$RemoteDist = "/opt/commercial-extension-factory/apps/hwh/dist",
  [string]$RemoteBackups = "/opt/commercial-extension-factory/backups",
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$webDist = Join-Path $repoRoot "apps\web\dist"
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$packagePath = Join-Path $env:TEMP "pay-site-apps-web-$stamp.tar.gz"
$remotePackage = "/tmp/pay-site-apps-web-$stamp.tar.gz"
$remoteTmp = "/tmp/pay-site-apps-web-$stamp"
$backupDir = "$RemoteBackups/apps-web-dist-pre-deploy-$stamp"

Push-Location $repoRoot
try {
  npm run build:web

  $indexPath = Join-Path $webDist "index.html"
  if (!(Test-Path $indexPath)) {
    throw "apps/web build did not produce dist/index.html"
  }

  $indexHtml = Get-Content -Raw $indexPath
  if ($indexHtml -notmatch "G-V93ET05FSR") {
    throw "apps/web dist/index.html is missing GA4 measurement ID G-V93ET05FSR"
  }

  if (Test-Path $packagePath) {
    Remove-Item -LiteralPath $packagePath -Force
  }
  tar -czf $packagePath -C $webDist .

  if ($DryRun) {
    Write-Host "Dry run completed."
    Write-Host "Built: $webDist"
    Write-Host "Package: $packagePath"
    Write-Host "Remote target: ${User}@${HostName}:$RemoteDist"
    Write-Host "Remote backup would be: $backupDir"
    exit 0
  }

  scp -i $IdentityFile -o IdentitiesOnly=yes $packagePath "${User}@${HostName}:$remotePackage"

  $remoteScript = @"
set -euo pipefail
test -d "$RemoteDist"
rm -rf "$remoteTmp"
mkdir -p "$remoteTmp"
tar -xzf "$remotePackage" -C "$remoteTmp"
test -f "$remoteTmp/index.html"
grep -q 'G-V93ET05FSR' "$remoteTmp/index.html"
cp -a "$RemoteDist" "$backupDir"
rsync -a --delete "$remoteTmp/" "$RemoteDist/"
caddy reload --config /etc/caddy/Caddyfile >/tmp/caddy-reload-apps-web-$stamp.log 2>&1 || true
grep -q 'G-V93ET05FSR' "$RemoteDist/index.html"
echo "backup=$backupDir"
echo "deployed=$RemoteDist"
"@ -replace "`r", ""

  $remoteScript | ssh -i $IdentityFile -o IdentitiesOnly=yes -o BatchMode=yes "${User}@${HostName}" "bash -s"
}
finally {
  Pop-Location
}
