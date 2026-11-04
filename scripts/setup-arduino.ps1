$ErrorActionPreference = 'Stop'

$version = '1.5.1'
$archiveName = "arduino-cli_${version}_Windows_64bit.zip"
$checksumsName = "$version-checksums.txt"
$baseUrl = "https://github.com/arduino/arduino-cli/releases/download/v$version"
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$toolsRoot = Join-Path $projectRoot '.tools'
$cliDirectory = Join-Path $toolsRoot 'arduino-cli'
$configurationDirectory = Join-Path $toolsRoot 'arduino-cli-config'
$downloadsDirectory = Join-Path $toolsRoot 'arduino-downloads'
$dataDirectory = Join-Path $toolsRoot 'arduino-data'
$userDirectory = Join-Path $toolsRoot 'arduino-user'
$archivePath = Join-Path ([IO.Path]::GetTempPath()) $archiveName
$checksumsPath = Join-Path ([IO.Path]::GetTempPath()) $checksumsName
$cliPath = Join-Path $cliDirectory 'arduino-cli.exe'
$configurationPath = Join-Path $configurationDirectory 'arduino-cli.yaml'

New-Item -ItemType Directory -Force -Path $cliDirectory, $configurationDirectory | Out-Null
Invoke-WebRequest -Uri "$baseUrl/$archiveName" -OutFile $archivePath
Invoke-WebRequest -Uri "$baseUrl/$checksumsName" -OutFile $checksumsPath

$checksumLine = Get-Content -LiteralPath $checksumsPath |
  Where-Object { $_ -match "\s$([regex]::Escape($archiveName))$" } |
  Select-Object -First 1
if (-not $checksumLine) {
  throw "No se encontró el SHA-256 oficial de $archiveName."
}

$expectedHash = ($checksumLine -split '\s+')[0].ToUpperInvariant()
$actualHash = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash
if ($actualHash -ne $expectedHash) {
  throw "La verificación SHA-256 de Arduino CLI falló. No se instalará el archivo."
}

Expand-Archive -LiteralPath $archivePath -DestinationPath $cliDirectory -Force
if (-not (Test-Path -LiteralPath $configurationPath)) {
  & $cliPath config init --dest-dir $configurationDirectory
  if ($LASTEXITCODE -ne 0) { throw 'No se pudo crear la configuración de Arduino CLI.' }
}

& $cliPath config set directories.data $dataDirectory --config-file $configurationPath
if ($LASTEXITCODE -ne 0) { throw 'No se pudo configurar el directorio de datos.' }
& $cliPath config set directories.downloads $downloadsDirectory --config-file $configurationPath
if ($LASTEXITCODE -ne 0) { throw 'No se pudo configurar el directorio de descargas.' }
& $cliPath config set directories.user $userDirectory --config-file $configurationPath
if ($LASTEXITCODE -ne 0) { throw 'No se pudo configurar el directorio de usuario.' }
& $cliPath core update-index --config-file $configurationPath
if ($LASTEXITCODE -ne 0) { throw 'No se pudieron actualizar los índices de placas.' }
& $cliPath core install arduino:avr --config-file $configurationPath
if ($LASTEXITCODE -ne 0) { throw 'No se pudo instalar el core Arduino AVR.' }

Write-Host "Arduino Uno listo: Arduino CLI $version y arduino:avr instalados localmente en .tools."
