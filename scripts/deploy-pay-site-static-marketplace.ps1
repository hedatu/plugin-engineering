$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$siteDir = Join-Path $repoRoot "plugin-engineering-factory\generated\plugin-pages\leadfill-one-profile"
$sshKey = Join-Path $env:USERPROFILE ".ssh\id_ed25519_do_auto"
$hostName = "root@134.199.226.198"
$remoteDist = "/opt/commercial-extension-factory/apps/hwh/dist"

if (-not (Test-Path -LiteralPath (Join-Path $siteDir "index.html"))) {
  throw "Static marketplace output not found: $siteDir"
}

$indexHtml = Get-Content -LiteralPath (Join-Path $siteDir "index.html") -Raw
if (-not $indexHtml.Contains("G-V93ET05FSR")) {
  throw "GA4 tag G-V93ET05FSR is missing from static marketplace output."
}

if ($indexHtml.Contains('/assets/index-')) {
  throw "Refusing to deploy apps/web SPA assets from the static marketplace deploy script."
}

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$archive = Join-Path $env:TEMP "hwh-static-marketplace-$stamp.tar.gz"
$remoteArchive = "/tmp/hwh-static-marketplace-$stamp.tar.gz"

if (Test-Path -LiteralPath $archive) {
  Remove-Item -LiteralPath $archive -Force
}

tar -czf $archive -C $siteDir .
scp -i $sshKey -o IdentitiesOnly=yes -o BatchMode=yes $archive "$hostName:$remoteArchive"

$remoteScript = @"
set -euo pipefail
remote_tar='$remoteArchive'
dist='$remoteDist'
backup=/opt/commercial-extension-factory/backups/hwh-static-before-deploy-$stamp
mkdir -p /opt/commercial-extension-factory/backups
cp -a "`$dist" "`$backup"
find "`$dist" -mindepth 1 -maxdepth 1 -exec rm -rf {} +
tar -xzf "`$remote_tar" -C "`$dist"
rm -f "`$remote_tar"
if command -v caddy >/dev/null 2>&1; then caddy reload --config /etc/caddy/Caddyfile >/tmp/caddy-hwh-static-$stamp.log 2>&1 || true; fi
echo deployed="`$dist"
echo backup="`$backup"
"@

$remoteScript | ssh -i $sshKey -o IdentitiesOnly=yes -o BatchMode=yes $hostName "bash -s"
Remove-Item -LiteralPath $archive -Force
