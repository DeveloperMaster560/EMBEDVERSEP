# Arranca la plataforma SHM en Windows (PowerShell 5.1 o 7).
#   powershell -ExecutionPolicy Bypass -File scripts\iniciar.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\iniciar.ps1 demo
param([string]$modo = "")
$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")

$py = $null
foreach ($c in @("py", "python", "python3")) {
  if (Get-Command $c -ErrorAction SilentlyContinue) { $py = $c; break }
}
if (-not $py) { Write-Host "Falta Python 3.9 o posterior: https://www.python.org/downloads/windows/"; exit 1 }

& $py scripts\preparar.py
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

if ($modo -eq "demo") {
  docker compose --profile demo up -d --build
} else {
  docker compose up -d --build
}
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
docker compose ps
Write-Host ""
Write-Host "API y documentacion:  http://127.0.0.1:8000/api/docs"
Write-Host "Grafana:              http://127.0.0.1:3000   (usuario admin; contrasena GRAFANA_ADMIN_PASSWORD en .env)"
Write-Host "Broker MQTT:          127.0.0.1:1883"
