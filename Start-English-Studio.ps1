$ErrorActionPreference = 'Stop'
$appDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$port = 8765
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) { Write-Host 'Node.js 24 or newer is required to start the app.'; Read-Host 'Press Enter'; exit 1 }
Set-Location $appDir
if (-not (Test-Path (Join-Path $appDir 'node_modules'))) {
  Write-Host 'Installing English Word Studio dependencies...'
  & (Get-Command npm).Source install
}
if (-not (Test-Path (Join-Path $appDir 'dist\index.html'))) {
  Write-Host 'Building the web interface...'
  & (Get-Command npm).Source run build
}
try {
  $health = Invoke-RestMethod "http://localhost:$port/api/health" -TimeoutSec 2
} catch {
  Start-Process -FilePath $node.Source -ArgumentList @('--env-file-if-exists=.env','server.mjs') -WorkingDirectory $appDir -WindowStyle Hidden
  $ready = $false
  for ($attempt = 0; $attempt -lt 20; $attempt++) {
    Start-Sleep -Milliseconds 350
    try { $health = Invoke-RestMethod "http://localhost:$port/api/health" -TimeoutSec 2; $ready = $true; break } catch {}
  }
  if (-not $ready) { throw 'The local server did not become ready.' }
}
Start-Process "http://localhost:$port"
