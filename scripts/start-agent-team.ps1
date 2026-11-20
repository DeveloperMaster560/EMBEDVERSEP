$ErrorActionPreference = 'Stop'
$workspace = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$localRoot = Join-Path $env:LOCALAPPDATA 'EMBEDVERSE'
$logRoot = Join-Path $localRoot 'logs'
New-Item -ItemType Directory -Path $logRoot -Force | Out-Null

function Get-LocalJson([string]$Uri) {
  try { return Invoke-RestMethod -Uri $Uri -TimeoutSec 2 } catch { return $null }
}

function Start-LocalNpm([string]$Task, [string]$LogName) {
  $npmCommand = Get-Command npm.cmd -ErrorAction Stop
  $stdout = Join-Path $logRoot "$LogName.out.log"
  $stderr = Join-Path $logRoot "$LogName.err.log"
  Start-Process -FilePath $npmCommand.Source -ArgumentList @('run', $Task) -WorkingDirectory $workspace `
    -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr | Out-Null
}

$ollamaTags = Get-LocalJson 'http://127.0.0.1:11434/api/tags'
if (-not $ollamaTags) {
  $ollamaCommand = Get-Command ollama.exe -ErrorAction SilentlyContinue
  if (-not $ollamaCommand) { throw 'No se encuentra Ollama. Instálalo y vuelve a ejecutar npm run agent:start.' }
  $ollamaLog = Join-Path $logRoot 'ollama.err.log'
  Start-Process -FilePath $ollamaCommand.Source -ArgumentList 'serve' -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $logRoot 'ollama.out.log') -RedirectStandardError $ollamaLog | Out-Null
  for ($attempt = 0; $attempt -lt 30 -and -not $ollamaTags; $attempt++) {
    Start-Sleep -Seconds 2
    $ollamaTags = Get-LocalJson 'http://127.0.0.1:11434/api/tags'
  }
}
if (-not $ollamaTags) { throw 'Ollama no respondió en http://127.0.0.1:11434. Revisa los logs locales.' }
if (-not ($ollamaTags.models | Where-Object { $_.name -eq 'qwen2.5-coder:7b' })) {
  throw 'Falta qwen2.5-coder:7b. Descárgalo con "ollama pull qwen2.5-coder:7b" y vuelve a iniciar.'
}
Write-Output 'Ollama listo con qwen2.5-coder:7b.'

$runtime = Get-LocalJson 'http://127.0.0.1:5175/health'
if (-not $runtime) {
  Start-LocalNpm 'agent:runtime' 'agent-runtime'
  for ($attempt = 0; $attempt -lt 45 -and -not $runtime; $attempt++) {
    Start-Sleep -Seconds 2
    $runtime = Get-LocalJson 'http://127.0.0.1:5175/health'
  }
}
if (-not $runtime) { throw "El runtime no respondió. Revisa $logRoot\agent-runtime.err.log" }
Write-Output 'Runtime local listo.'

$uiPort = 5174
$uiListener = Get-NetTCPConnection -State Listen -LocalPort $uiPort -ErrorAction SilentlyContinue
Write-Output "Comprobando interfaz local en puerto $uiPort."
if (-not $uiListener) {
  Write-Output 'Iniciando interfaz.'
  Start-LocalNpm 'agent:ui' 'agent-ui'
  $uiPage = $null
  for ($attempt = 0; $attempt -lt 45 -and -not $uiPage; $attempt++) {
    Start-Sleep -Seconds 2
    try { $uiPage = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$uiPort/" -TimeoutSec 3 } catch { }
  }
} else {
  Write-Output 'La interfaz ya tiene un proceso escuchando.'
  try { $uiPage = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$uiPort/" -TimeoutSec 5 } catch { Write-Output "Error HTTP UI: $($_.Exception.Message)"; $uiPage = $null }
}
if ($uiPage) { Write-Output "Respuesta UI: HTTP $($uiPage.StatusCode)." }
if (-not $uiPage -or $uiPage.StatusCode -ne 200) {
  throw "La interfaz no respondió en http://127.0.0.1:$uiPort. Revisa $logRoot\agent-ui.err.log"
}

Write-Output "Equipo EMBEVERSE listo: http://127.0.0.1:$uiPort/"
Write-Output "Runtime: http://127.0.0.1:5175/health"
Write-Output "Modelo: qwen2.5-coder:7b"
