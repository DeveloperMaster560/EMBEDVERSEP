#!/usr/bin/env bash
#
# Instala Arduino CLI y el core AVR en .tools, para macOS y Linux.
#
# Equivalente de scripts/setup-arduino.ps1, que solo servía en Windows. Sin
# esto, en un Mac o en Linux el botón «Simular» del laboratorio no puede
# compilar: el servidor busca .tools/arduino-cli/arduino-cli y el core AVR
# 1.8.8, y solo había un binario de Windows.
#
#   ./scripts/setup-arduino.sh
#
# No toca nada fuera de .tools, que está en .gitignore. No instala nada en el
# sistema ni pide privilegios de administrador.
#
# SEGURIDAD: se descarga del repositorio oficial de Arduino en GitHub y se
# comprueba el SHA-256 contra el archivo de sumas que publica la propia
# versión. Si no cuadra, no se instala nada.

set -euo pipefail

VERSION='1.5.1'
BASE_URL="https://github.com/arduino/arduino-cli/releases/download/v${VERSION}"
CHECKSUMS_NAME="${VERSION}-checksums.txt"

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TOOLS_ROOT="${PROJECT_ROOT}/.tools"
CLI_DIRECTORY="${TOOLS_ROOT}/arduino-cli"
CONFIG_DIRECTORY="${TOOLS_ROOT}/arduino-cli-config"
DOWNLOADS_DIRECTORY="${TOOLS_ROOT}/arduino-downloads"
USER_DIRECTORY="${TOOLS_ROOT}/arduino-user"
CLI_PATH="${CLI_DIRECTORY}/arduino-cli"
CONFIG_PATH="${CONFIG_DIRECTORY}/arduino-cli.yaml"

# --- qué archivo toca para este sistema -------------------------------------
# PLATFORM nombra el archivo que publica Arduino; NODE_PLATFORM nombra el
# directorio de datos, y tiene que coincidir con process.platform de Node,
# porque es lo que busca server/arduinoCompiler.ts.
case "$(uname -s)" in
  Darwin) PLATFORM='macOS'; NODE_PLATFORM='darwin' ;;
  Linux)  PLATFORM='Linux'; NODE_PLATFORM='linux' ;;
  *)
    echo "Sistema no contemplado: $(uname -s). Use scripts/setup-arduino.ps1 en Windows." >&2
    exit 1
    ;;
esac

case "$(uname -m)" in
  arm64|aarch64) ARCH_PATTERN='ARM64' ;;
  x86_64|amd64)  ARCH_PATTERN='64bit' ;;
  *)
    echo "Arquitectura no contemplada: $(uname -m)." >&2
    exit 1
    ;;
esac

# Propio de la plataforma A PROPOSITO. arduino-cli guarda las herramientas por
# version, no por sistema: instalar aqui el nucleo de macOS sobre el directorio
# compartido SOBRESCRIBIRIA los binarios de Windows, y quien copie .tools entre
# equipos perderia el que ya tenia. Separandolos conviven.
DATA_DIRECTORY="${TOOLS_ROOT}/arduino-data-${NODE_PLATFORM}"

WORKSPACE="$(mktemp -d)"
trap 'rm -rf "${WORKSPACE}"' EXIT

echo "Arduino CLI ${VERSION} para ${PLATFORM} ${ARCH_PATTERN}"
echo "Descargando las sumas de verificación oficiales…"
curl -fsSL "${BASE_URL}/${CHECKSUMS_NAME}" -o "${WORKSPACE}/checksums.txt"

# El nombre del archivo se LEE del fichero de sumas en vez de componerlo a
# mano: así no depende de que el convenio de nombres de Arduino no cambie, y
# de paso queda comprobado que lo que se descarga es lo que ellos publicaron.
LINE="$(grep -E "[[:space:]]\*?arduino-cli_${VERSION}_${PLATFORM}_${ARCH_PATTERN}\.(tar\.gz|zip)$" \
  "${WORKSPACE}/checksums.txt" | head -n 1 || true)"
if [ -z "${LINE}" ]; then
  echo "No se encontró un archivo para ${PLATFORM} ${ARCH_PATTERN} en las sumas oficiales." >&2
  echo "Archivos publicados en esta versión:" >&2
  awk '{print "  " $2}' "${WORKSPACE}/checksums.txt" >&2
  exit 1
fi

EXPECTED_HASH="$(echo "${LINE}" | awk '{print $1}')"
ARCHIVE_NAME="$(echo "${LINE}" | awk '{print $2}' | sed 's/^\*//')"

echo "Descargando ${ARCHIVE_NAME}…"
curl -fsSL "${BASE_URL}/${ARCHIVE_NAME}" -o "${WORKSPACE}/${ARCHIVE_NAME}"

ACTUAL_HASH="$(shasum -a 256 "${WORKSPACE}/${ARCHIVE_NAME}" | awk '{print $1}')"
if [ "${ACTUAL_HASH}" != "${EXPECTED_HASH}" ]; then
  echo "La verificación SHA-256 falló. No se instalará el archivo." >&2
  echo "  esperado: ${EXPECTED_HASH}" >&2
  echo "  obtenido: ${ACTUAL_HASH}" >&2
  exit 1
fi
echo "SHA-256 correcto."

mkdir -p "${CLI_DIRECTORY}" "${CONFIG_DIRECTORY}"
case "${ARCHIVE_NAME}" in
  *.tar.gz) tar -xzf "${WORKSPACE}/${ARCHIVE_NAME}" -C "${CLI_DIRECTORY}" ;;
  *.zip)    unzip -oq "${WORKSPACE}/${ARCHIVE_NAME}" -d "${CLI_DIRECTORY}" ;;
  *)
    echo "Formato de archivo no contemplado: ${ARCHIVE_NAME}" >&2
    exit 1
    ;;
esac

if [ ! -x "${CLI_PATH}" ]; then
  echo "El archivo no contenía arduino-cli donde se esperaba: ${CLI_PATH}" >&2
  exit 1
fi

# --- configuración, toda dentro de .tools -----------------------------------
if [ ! -f "${CONFIG_PATH}" ]; then
  "${CLI_PATH}" config init --dest-dir "${CONFIG_DIRECTORY}"
fi
"${CLI_PATH}" config set directories.data "${DATA_DIRECTORY}" --config-file "${CONFIG_PATH}"
"${CLI_PATH}" config set directories.downloads "${DOWNLOADS_DIRECTORY}" --config-file "${CONFIG_PATH}"
"${CLI_PATH}" config set directories.user "${USER_DIRECTORY}" --config-file "${CONFIG_PATH}"

echo "Actualizando el índice de placas…"
"${CLI_PATH}" core update-index --config-file "${CONFIG_PATH}"

# El servidor exige exactamente el core AVR 1.8.8: así lo comprueba
# server/arduinoCompiler.ts antes de compilar nada.
echo "Instalando el core arduino:avr 1.8.8 (unos 200 MB)…"
"${CLI_PATH}" core install arduino:avr@1.8.8 --config-file "${CONFIG_PATH}"

PLATFORM_FILE="${DATA_DIRECTORY}/packages/arduino/hardware/avr/1.8.8/platform.txt"
if [ ! -f "${PLATFORM_FILE}" ]; then
  echo "El core quedó instalado donde el servidor no lo busca." >&2
  echo "  esperado: ${PLATFORM_FILE}" >&2
  exit 1
fi

# No basta con platform.txt: es un archivo de texto idéntico en todos los
# sistemas, así que un núcleo instalado en otro equipo lo tiene igual. Lo que
# delata un núcleo ajeno es el compilador, que sí es un binario nativo.
if ! find "${DATA_DIRECTORY}/packages/arduino/tools/avr-gcc" \
     -type f -name 'avr-gcc' -perm -u+x 2>/dev/null | grep -q .; then
  echo "El núcleo no trae un avr-gcc nativo para este sistema." >&2
  echo "  buscado en: ${DATA_DIRECTORY}/packages/arduino/tools/avr-gcc/*/bin/avr-gcc" >&2
  exit 1
fi

echo
echo "Listo. Arduino CLI ${VERSION} y arduino:avr 1.8.8 instalados en .tools."
echo "El botón «Simular» del laboratorio ya puede compilar en este equipo."
