<#
  Comparte el Ollama de este PC con el Mac por Tailscale, para que el equipo de
  agentes que corre en el Mac use la potencia de este PC.

    powershell -ExecutionPolicy Bypass -File scripts\windows\compartir-ollama.ps1
    powershell -ExecutionPolicy Bypass -File scripts\windows\compartir-ollama.ps1 -Detener

  Que hace:
    - Arranca Ollama si no corre. Sigue escuchando SOLO en 127.0.0.1 (no se toca
      OLLAMA_HOST; los agentes de este PC siguen funcionando igual).
    - Con "tailscale serve" publica el puerto 11434 unicamente dentro de tu red
      Tailscale (cifrado, solo tus equipos). Nunca 0.0.0.0, sin reglas de firewall.
    - Hace una generacion de prueba y muestra si el modelo corre en GPU o CPU.
  No instala nada. Requisitos: Ollama y Tailscale instalados, sesion iniciada en
  Tailscale con la misma cuenta que el Mac, y el modelo descargado.
#>
param(
  [string]$Modelo = 'qwen2.5-coder:7b',
  [switch]$Detener
)
$ErrorActionPreference = 'Stop'

function Get-LocalJson([string]$Uri) {
  try { return Invoke-RestMethod -Uri $Uri -TimeoutSec 3 } catch { return $null }
}

$ts = Get-Command tailscale.exe -ErrorAction SilentlyContinue
$tsPath = if ($ts) { $ts.Source } else { Join-Path $env:ProgramFiles 'Tailscale\tailscale.exe' }
if (-not (Test-Path $tsPath)) { throw 'No se encuentra Tailscale. Instálalo desde tailscale.com e inicia sesión.' }

if ($Detener) {
  & $tsPath serve --tcp=11434 off
  Write-Output 'Ollama ya no se comparte por Tailscale. En el Mac: sh scripts/enlazar-windows.sh --local'
  exit 0
}

& $tsPath status *> $null
if ($LASTEXITCODE -ne 0) { throw 'Tailscale no tiene sesión iniciada en este PC. Ábrelo e inicia sesión con la misma cuenta que en el Mac.' }
$ip = (& $tsPath ip -4 | Select-Object -First 1).Trim()
if ($ip -notmatch '^100\.') { throw "Dirección Tailscale inesperada: $ip" }

# 1. Ollama en loopback, con el modelo.
$tags = Get-LocalJson 'http://127.0.0.1:11434/api/tags'
if (-not $tags) {
  $ollama = Get-Command ollama.exe -ErrorAction SilentlyContinue
  if (-not $ollama) { throw 'No se encuentra Ollama. Instálalo y vuelve a ejecutar.' }
  Start-Process -FilePath $ollama.Source -ArgumentList 'serve' -WindowStyle Hidden | Out-Null
  for ($i = 0; $i -lt 30 -and -not $tags; $i++) { Start-Sleep -Seconds 2; $tags = Get-LocalJson 'http://127.0.0.1:11434/api/tags' }
}
if (-not $tags) { throw 'Ollama no respondió en http://127.0.0.1:11434.' }
if (-not ($tags.models | Where-Object { $_.name -eq $Modelo })) { throw "Falta $Modelo. Descárgalo con: ollama pull $Modelo" }
Write-Output "Ollama listo en 127.0.0.1 con $Modelo."

# 2. Publicar solo dentro de la red Tailscale.
& $tsPath serve --bg --tcp 11434 tcp://127.0.0.1:11434
if ($LASTEXITCODE -ne 0) { throw 'No se pudo activar "tailscale serve". Si pide permisos, ejecuta esta ventana de PowerShell como administrador.' }
Write-Output "Compartido dentro de Tailscale en http://${ip}:11434"

# 3. Prueba real y dónde corre (GPU/CPU).
$t0 = Get-Date
$body = @{ model = $Modelo; prompt = 'Responde solo: listo'; stream = $false; options = @{ num_predict = 8 } } | ConvertTo-Json
$null = Invoke-RestMethod -Uri 'http://127.0.0.1:11434/api/generate' -Method Post -Body $body -ContentType 'application/json' -TimeoutSec 300
Write-Output ("Generación de prueba: {0:N1} s (incluye cargar el modelo)." -f ((Get-Date) - $t0).TotalSeconds)
$ollamaCmd = Get-Command ollama.exe -ErrorAction SilentlyContinue
if ($ollamaCmd) { & $ollamaCmd.Source ps }
$smi = Get-Command nvidia-smi.exe -ErrorAction SilentlyContinue
if ($smi) { & $smi.Source --query-gpu=name,memory.total,memory.used --format=csv }

$nombre = $env:COMPUTERNAME.ToLower()
Write-Output ''
Write-Output 'Listo. En el Mac ejecuta:'
Write-Output "  sh scripts/enlazar-windows.sh $nombre      (o con la IP: $ip)"
