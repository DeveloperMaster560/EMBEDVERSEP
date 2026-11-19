# Instala núcleos de placa y bibliotecas DONDE EMBEDVERSE LOS BUSCA (Windows).
#
#   powershell -ExecutionPolicy Bypass -File scripts\placas.ps1 lista
#   powershell -ExecutionPolicy Bypass -File scripts\placas.ps1 nucleo esp32-devkit
#   powershell -ExecutionPolicy Bypass -File scripts\placas.ps1 nucleo vendedor:arq URL
#   powershell -ExecutionPolicy Bypass -File scripts\placas.ps1 biblioteca "DHT sensor library" "BH1750"
#   powershell -ExecutionPolicy Bypass -File scripts\placas.ps1 oficial      (TODA la biblioteca oficial, versiones exactas)
#   powershell -ExecutionPolicy Bypass -File scripts\placas.ps1 grupo ambiente
#   powershell -ExecutionPolicy Bypass -File scripts\placas.ps1 grupos
#   powershell -ExecutionPolicy Bypass -File scripts\placas.ps1 zip C:\ruta\biblioteca.zip
#   powershell -ExecutionPolicy Bypass -File scripts\placas.ps1 instaladas
#
# Núcleos     -> .tools\arduino-data\packages\...      (binarios de Windows)
# Bibliotecas -> .tools\arduino-user\libraries\...     (código fuente: valen en todos)
# Necesita Arduino CLI en .tools (scripts\setup-arduino.ps1).
param([string]$orden = "ayuda", [Parameter(ValueFromRemainingArguments = $true)][string[]]$resto = @())
$ErrorActionPreference = "Stop"
$raiz = Split-Path -Parent $PSScriptRoot
$tools = Join-Path $raiz ".tools"
$cli = Join-Path $tools "arduino-cli\arduino-cli.exe"
if (-not (Test-Path -LiteralPath $cli)) { Write-Host "Falta Arduino CLI en .tools: ejecuta primero scripts\setup-arduino.ps1"; exit 1 }
$datos = Join-Path $tools "arduino-data"
$usuario = Join-Path $tools "arduino-user"
$descargas = Join-Path $tools "arduino-downloads"
$cfgDir = Join-Path $tools "arduino-cli-config"
New-Item -ItemType Directory -Force -Path $datos, $usuario, $descargas, $cfgDir | Out-Null
$placas = (Get-Content -Raw -Encoding UTF8 (Join-Path $raiz "server\placas.json") | ConvertFrom-Json).placas
$grupos = (Get-Content -Raw -Encoding UTF8 (Join-Path $raiz "server\bibliotecas.json") | ConvertFrom-Json).grupos

$urls = $placas | Where-Object { $_.indice } | ForEach-Object { $_.indice } | Select-Object -Unique
$config = Join-Path $cfgDir "placas-win32.yaml"
$yaml = @("board_manager:", "  additional_urls:") + ($urls | ForEach-Object { "    - $_" }) + @(
  "directories:", "  data: '$datos'", "  downloads: '$descargas'", "  user: '$usuario'",
  "library:", "  enable_unsafe_install: true")
[System.IO.File]::WriteAllLines($config, $yaml)
function Cli { & $cli --config-file $config @args; if ($LASTEXITCODE -ne 0) { throw "arduino-cli falló ($LASTEXITCODE)" } }

function Instalada($p) {
  $v, $a = $p.paquete.Split(":")
  $d = Join-Path $datos "packages\$v\hardware\$a"
  return (Test-Path -LiteralPath $d) -and @(Get-ChildItem -LiteralPath $d -ErrorAction SilentlyContinue).Count -gt 0
}

switch ($orden) {
  "lista" {
    $familia = ""
    foreach ($p in $placas) {
      if ($p.familia -ne $familia) { $familia = $p.familia; Write-Host ""; Write-Host $familia }
      $marca = if (Instalada $p) { "[instalada] " } else { "[ - ]       " }
      $peso = if ($p.descarga_mb) { "  (~$($p.descarga_mb) MB)" } else { "" }
      Write-Host ("  " + $marca + $p.id.PadRight(30) + $p.nombre + $peso)
    }
  }
  "nucleo" {
    if ($resto.Count -lt 1) { Write-Host "Uso: scripts\placas.ps1 nucleo <id de placa | vendedor:arquitectura [URL]>"; exit 1 }
    $p = $placas | Where-Object { $_.id -eq $resto[0] } | Select-Object -First 1
    $extra = @()
    if ($p) { $paq = $p.paquete }
    elseif ($resto[0] -like "*:*") { $paq = $resto[0]; if ($resto.Count -ge 2) { $extra = @("--additional-urls", $resto[1]) } }
    else { Write-Host "No conozco la placa '$($resto[0])'. Mira: scripts\placas.ps1 lista"; exit 1 }
    Write-Host "· Actualizando índices..."; Cli core update-index @extra
    Write-Host "· Instalando $paq en .tools\arduino-data (puede tardar; ESP32 descarga mas de 1 GB)..."
    Cli core install $paq @extra
    Write-Host "Listo. Reinicia 'npm run dev' si estaba abierto y elige la placa en 'Compilar para'."
  }
  "biblioteca" {
    if ($resto.Count -lt 1) { Write-Host 'Uso: scripts\placas.ps1 biblioteca "Nombre exacto" ["Otra"...]'; exit 1 }
    Cli lib update-index
    foreach ($b in $resto) { Write-Host "· $b"; Cli lib install $b }
    Write-Host "Bibliotecas en .tools\arduino-user\libraries"
  }
  "oficial" {
    $lock = Get-Content -Raw -Encoding UTF8 (Join-Path $raiz "server\bibliotecas.lock.json") | ConvertFrom-Json
    Cli lib update-index
    Write-Host "· Biblioteca oficial: $($lock.bibliotecas.Count) bibliotecas con version fija (puede tardar)"
    $fallos = 0
    foreach ($b in $lock.bibliotecas) {
      $ref = "$($b.nombre)@$($b.version)"
      try { Cli lib install --no-deps $ref | Out-Null; Write-Host "  ok $ref" }
      catch { Write-Host "  FALLO $ref"; $fallos++ }
    }
    if ($fallos -eq 0) { Write-Host "Biblioteca oficial completa en .tools\arduino-user\libraries" }
    else { Write-Host "$fallos no se instalaron (mira arriba); vuelve a ejecutar 'oficial' para reintentarlas" }
  }
  "grupo" {
    if ($resto.Count -lt 1) { Write-Host "Uso: scripts\placas.ps1 grupo <nombre>  (ver: scripts\placas.ps1 grupos)"; exit 1 }
    $lista = $grupos.($resto[0])
    if (-not $lista) { Write-Host "Grupo desconocido: $($resto[0])"; exit 1 }
    Cli lib update-index
    foreach ($b in $lista) {
      Write-Host "· $b"
      try { Cli lib install $b } catch { Write-Host "  no se pudo instalar '$b' (se sigue con las demas)" }
    }
  }
  "grupos" {
    foreach ($k in $grupos.PSObject.Properties.Name) {
      $v = $grupos.$k; Write-Host ($k.PadRight(24) + "$($v.Count) bibliotecas: " + ($v -join ", "))
    }
  }
  "zip" {
    if ($resto.Count -lt 1) { Write-Host "Uso: scripts\placas.ps1 zip C:\ruta\archivo.zip"; exit 1 }
    Cli lib install --zip-path $resto[0]
  }
  "instaladas" { Write-Host "Nucleos:"; Cli core list; Write-Host ""; Write-Host "Bibliotecas:"; Cli lib list }
  default { Get-Content $PSCommandPath -TotalCount 14 | Select-Object -Skip 1 }
}
