# Traspaso del proyecto a Windows

Guía para dejar EMBEDVERSE funcionando en un equipo Windows a partir del
repositorio. Escrita el 9 de noviembre de 2026, después de corregir los dos
puntos que impedían que arrancara.

## Lo que git **no** lleva

Estas rutas están en `.gitignore` y hay que reconstruirlas en el equipo nuevo.
No es un olvido: son pesadas, dependen del sistema operativo o contienen
credenciales.

| Ruta | Qué es | Cómo se recupera |
|---|---|---|
| `node_modules/` | dependencias de JavaScript | `npm install` |
| `tools/venv/`, `.venv/` | entorno de Python del generador | `.\tools\setup_generator.ps1` |
| `.tools/` | Arduino CLI y el core AVR | se descarga aparte (ver más abajo) |
| `dist/` | compilación de producción | `npm run build` |
| `.env`, `.env.*` | configuración opcional | **no hace falta**: el proyecto no lee ninguna variable propia salvo `EMBEDVERSE_PYTHON`, y es opcional |
| `EMBEDVERSE_BUILDING_001/` | salidas del generador | se regenera al usarlo |

## Pasos

Con **Node.js 20 o superior** (aquí se usó 24.22.2) y **Python 3.10 o
superior** instalados y en el `PATH`:

```powershell
git clone <url-del-repositorio>
cd Desarrolo

npm install                      # dependencias de la aplicación
.\tools\setup_generator.ps1      # entorno de Python del generador
npm run dev                      # servidor de desarrollo en http://localhost:5174
```

El script de PowerShell crea `tools\venv`, instala las dependencias de
`tools\requirements-min.txt` y comprueba que la biblioteca de geometría
responde. Para las salidas en DXF, IFC, PDF y STEP hace falta el conjunto
completo:

```powershell
.\tools\setup_generator.ps1 -Full
```

### Si el intérprete de Python no se encuentra

La variable `EMBEDVERSE_PYTHON` permite señalar un intérprete concreto cuando
el automático no sirve:

```powershell
$env:EMBEDVERSE_PYTHON = "C:\ruta\a\python.exe"
```

### Si PowerShell no deja ejecutar el script

Windows bloquea los scripts sin firma. Para esta sesión solamente:

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
```

### Arduino CLI

`.tools\arduino-cli\arduino-cli.exe` ya está en el equipo de origen pero **no
viaja en git** (`.tools/` está ignorado). Hay dos caminos:

1. **Copiarlo a mano** desde el equipo anterior. Es lo más rápido: la carpeta
   `.tools` ocupa 437 MB con el core AVR incluido, y así se evita volver a
   descargarlo.
2. **Descargarlo de nuevo** desde arduino.cc e instalar el core
   `arduino:avr@1.8.8`, que es la versión que el servidor espera en
   `.tools\arduino-data\packages\arduino\hardware\avr\1.8.8`.

Sin Arduino CLI el proyecto arranca igual y el laboratorio sigue simulando: el
panel permite **cargar un `.hex` ya compilado**. Lo que no se puede es compilar
el código fuente del proyecto.

## Verificación

Después de instalar, estas cuatro órdenes tienen que pasar:

```powershell
npx tsc -b          # tipos. OJO: `tsc --noEmit` NO comprueba nada en este repo
npx vitest run      # pruebas
npx oxlint          # análisis estático
npm run build       # compilación de producción
```

Y las del generador de Python:

```powershell
tools\venv\Scripts\python.exe -m unittest discover -s tools\building_generator -p "test_*.py"
```

Pasan **41 pruebas** y aparece **un error**, que es anterior a este traspaso:

`test_build_arch.py` no es un módulo de `unittest` sino un script que termina
con `sys.exit(1)` cuando su comprobación falla, así que `unittest discover` lo
muestra como `ImportError: Failed to import test module`. El fallo de fondo es
«hay ventanas en fachada» y sigue sin resolverse. Está comprobado que no lo
introdujo este trabajo: no hay ningún cambio en `tools/building_generator/`.
Para verlo por separado:

```powershell
tools\venv\Scripts\python.exe tools\building_generator\test_build_arch.py
```

## Diferencias de plataforma que ya están resueltas

Dos cosas estaban atadas a Unix y se corrigieron para este traspaso:

- **Búsqueda del intérprete de Python.** `server/generatorRuntime.ts` buscaba
  `\.venv\bin\python`, que es la ruta de Unix. En Windows es
  `Scripts\python.exe`. Ahora `pythonCandidates()` recibe la plataforma y
  devuelve las rutas correctas, con `python` y `py` como últimos recursos en
  vez de `python3` (que en Windows suele ser el intermediario de la Microsoft
  Store y no un intérprete). Hay pruebas en
  `server/buildingGenerator.test.ts`.
- **Finales de línea.** `.gitattributes` fuerza `lf` en `*.sh` y `*.py`, `crlf`
  en `*.ps1`, y marca como binarios los `.glb`, `.hex`, imágenes, PDF y
  comprimidos. Sin esto, git convertiría los scripts de bash y rompería los
  archivos binarios al pasarlos entre sistemas.

El compilador de Arduino ya era consciente de la plataforma: busca
`arduino-cli.exe` en Windows y `arduino-cli` en el resto, y si no encuentra una
cadena de herramientas compatible lo dice con claridad en vez de fallar de
forma confusa.

## Lo que sigue dependiendo del sistema

- **Compilar firmware** necesita Arduino CLI instalado para ese sistema. El
  binario que hay en `.tools` es de Windows (`arduino-cli.exe`), así que en
  macOS o Linux hay que instalar el propio. La carga directa de `.hex` existe
  precisamente para no depender de esto.
- **Las salidas en STEP** necesitan `cadquery`, que no tiene rueda para todas
  las combinaciones de Python y sistema operativo. `setup_generator.ps1 -Full`
  avisa si no la consigue instalar en vez de dejar un entorno a medias.
