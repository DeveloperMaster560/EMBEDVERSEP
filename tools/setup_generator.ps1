# Prepara el entorno de Python que necesita el generador, en Windows.
#
#   .\tools\setup_generator.ps1           # mínimo: lo que usa el Studio
#   .\tools\setup_generator.ps1 -Full     # añade IFC, DXF, PDF y STEP
#
# Si PowerShell se niega a ejecutarlo, es la directiva de ejecución:
#   Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
#
# Crea tools\venv. La aplicación lo encuentra sola; si prefieres otro entorno,
# define EMBEDVERSE_PYTHON con la ruta de su intérprete antes de arrancar Vite.

[CmdletBinding()]
param(
    [switch]$Full,
    # Intérprete base. Por omisión el lanzador oficial de Windows, que elige
    # una versión instalada de verdad en lugar del acceso directo de la tienda.
    [string]$Python = 'py'
)

$ErrorActionPreference = 'Stop'

$Root = Split-Path -Parent $PSScriptRoot
$Venv = Join-Path $Root 'tools\venv'
$VenvPython = Join-Path $Venv 'Scripts\python.exe'

function Resolve-BasePython {
    foreach ($candidate in @($Python, 'py', 'python')) {
        try {
            $version = & $candidate --version 2>&1
            # El acceso directo de la Microsoft Store no imprime versión:
            # responde con un aviso y abre la tienda. Hay que descartarlo.
            if ($LASTEXITCODE -eq 0 -and "$version" -match 'Python 3') {
                return $candidate
            }
        } catch {
            continue
        }
    }
    throw "No se encontró Python 3. Instálalo desde python.org (no desde la Microsoft Store) y vuelve a intentarlo."
}

$Base = Resolve-BasePython
Write-Host "==> Interprete base: $(& $Base --version 2>&1)"

if (-not (Test-Path $VenvPython)) {
    Write-Host "==> Creando entorno en tools\venv"
    & $Base -m venv $Venv
    if ($LASTEXITCODE -ne 0) { throw "No se pudo crear el entorno virtual." }
} else {
    Write-Host "==> Reutilizando tools\venv"
}

& $VenvPython -m pip install --quiet --upgrade pip

Write-Host "==> Instalando dependencias de geometria y malla"
$Requirements = Join-Path $PSScriptRoot 'requirements-min.txt'
& $VenvPython -m pip install --quiet -r $Requirements
if ($LASTEXITCODE -ne 0) { throw "Fallo la instalacion de dependencias minimas." }

if ($Full) {
    Write-Host "==> Instalando IFC, DXF, PDF y STEP (descarga grande)"
    & $VenvPython -m pip install --quiet -r (Join-Path $PSScriptRoot 'requirements-full.txt')
    if ($LASTEXITCODE -ne 0) { throw "Fallo la instalacion de dependencias completas." }
}

Write-Host "==> Comprobando el generador"
$check = @'
import importlib, sys
faltan = []
for mod in ("numpy", "shapely", "trimesh", "scipy", "networkx"):
    try:
        importlib.import_module(mod)
    except Exception as exc:
        faltan.append("%s: %s" % (mod, exc))
if faltan:
    print("FALTAN DEPENDENCIAS:")
    for f in faltan:
        print("   -", f)
    sys.exit(1)
import trimesh
print("   trimesh", trimesh.__version__, "listo")
'@
$check | & $VenvPython -
if ($LASTEXITCODE -ne 0) { throw "El entorno quedo incompleto." }

Write-Host ""
Write-Host "Entorno listo en tools\venv"
Write-Host "Arranca la app con:  npm run dev"
Write-Host 'Si usas otro entorno:  $env:EMBEDVERSE_PYTHON = "C:\ruta\al\python.exe"; npm run dev'
