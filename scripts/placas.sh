#!/bin/sh
# Instala núcleos de placa y bibliotecas DONDE EMBEDVERSE LOS BUSCA (macOS / Linux).
#
#   sh scripts/placas.sh lista                         placas conocidas y cuáles están instaladas
#   sh scripts/placas.sh nucleo esp32-devkit           núcleo de una placa de server/placas.json
#   sh scripts/placas.sh nucleo vendedor:arq URL       un núcleo que no está en la lista
#   sh scripts/placas.sh biblioteca "DHT sensor library" "BH1750"
#   sh scripts/placas.sh oficial                       TODA la biblioteca oficial, versiones exactas
#                                                      (server/bibliotecas.lock.json): lo que usa el servidor
#   sh scripts/placas.sh verificadas                   las aprobadas por scripts/verificar_biblioteca.py
#   sh scripts/placas.sh grupo ambiente                un grupo de server/bibliotecas.json
#   sh scripts/placas.sh grupos                        los grupos y lo que llevan
#   sh scripts/placas.sh zip ruta/biblioteca.zip       una biblioteca que no está en el gestor
#   sh scripts/placas.sh instaladas
#
# Núcleos   → .tools/arduino-data-<sistema>/packages/…   (binarios de ESTE sistema)
# Bibliotecas → .tools/arduino-user/libraries/…          (código fuente: valen en todos)
# Necesita Arduino CLI en .tools (scripts/setup-arduino.sh) y Node (el de la app).
set -eu
RAIZ="$(cd "$(dirname "$0")/.." && pwd)"
TOOLS="$RAIZ/.tools"
CLI="$TOOLS/arduino-cli/arduino-cli"
case "$(uname -s)" in Darwin) SO=darwin ;; *) SO=linux ;; esac
CONFIG="$TOOLS/arduino-cli-config/placas-$SO.yaml"
[ -x "$CLI" ] || { echo "Falta Arduino CLI en .tools: ejecuta primero  sh scripts/setup-arduino.sh"; exit 1; }
mkdir -p "$TOOLS/arduino-cli-config" "$TOOLS/arduino-data-$SO" "$TOOLS/arduino-user" "$TOOLS/arduino-downloads" "$TOOLS/arduino-home"
export HOME="$TOOLS/arduino-home"   # arduino-cli exige HOME; así no toca el tuyo

# Todas las URL de índices de la lista, para que «core install» las encuentre.
URLS=$(node -e "const d=require('$RAIZ/server/placas.json');console.log([...new Set(d.placas.map(p=>p.indice).filter(Boolean))].map(u=>'    - '+u).join('\n'))")
cat > "$CONFIG" <<YAML
board_manager:
  additional_urls:
$URLS
directories:
  data: $TOOLS/arduino-data-$SO
  downloads: $TOOLS/arduino-downloads
  user: $TOOLS/arduino-user
library:
  enable_unsafe_install: true
YAML
cli() { "$CLI" --config-file "$CONFIG" "$@"; }

orden="${1:-ayuda}"; [ $# -gt 0 ] && shift
case "$orden" in
  lista)
    node -e "
const fs=require('fs'),path=require('path');const d=require('$RAIZ/server/placas.json');
const dirs=['$TOOLS/arduino-data-$SO','$TOOLS/arduino-data'];
const hay=p=>{const [v,a]=p.paquete.split(':');return dirs.some(x=>{try{return fs.readdirSync(path.join(x,'packages',v,'hardware',a)).length>0}catch{return false}})};
let f='';for(const p of d.placas){if(p.familia!==f){f=p.familia;console.log('\n'+f)}console.log('  '+(hay(p)?'[instalada] ':'[ — ]       ')+p.id.padEnd(30)+p.nombre+(p.descarga_mb?'  (~'+p.descarga_mb+' MB)':''))}"
    ;;
  nucleo)
    [ $# -ge 1 ] || { echo "Uso: sh scripts/placas.sh nucleo <id de placa | vendedor:arquitectura [URL]>"; exit 1; }
    PAQ=$(node -e "const d=require('$RAIZ/server/placas.json');const p=d.placas.find(p=>p.id==='$1');console.log(p?p.paquete:'')")
    if [ -z "$PAQ" ]; then
      case "$1" in *:*) PAQ="$1" ;; *) echo "No conozco la placa «$1». Mira:  sh scripts/placas.sh lista"; exit 1 ;; esac
      [ $# -ge 2 ] && EXTRA="--additional-urls $2" || EXTRA=""
    else EXTRA=""; fi
    echo "· Actualizando índices…"; cli core update-index $EXTRA
    echo "· Instalando $PAQ en .tools/arduino-data-$SO (puede tardar; ESP32 descarga más de 1 GB)…"
    cli core install "$PAQ" $EXTRA
    echo "✓ Listo. Reinicia «npm run dev» si estaba abierto y elige la placa en «Compilar para»."
    ;;
  biblioteca)
    [ $# -ge 1 ] || { echo 'Uso: sh scripts/placas.sh biblioteca "Nombre exacto" ["Otra"…]'; exit 1; }
    cli lib update-index
    for b in "$@"; do echo "· $b"; cli lib install "$b"; done
    echo "✓ Bibliotecas en .tools/arduino-user/libraries"
    ;;
  oficial)
    cli lib update-index
    TOTAL=$(node -e "console.log(require('$RAIZ/server/bibliotecas.lock.json').bibliotecas.length)")
    echo "· Biblioteca oficial: $TOTAL bibliotecas con versión fija (puede tardar)"
    FALLOS=0
    node -e "for (const b of require('$RAIZ/server/bibliotecas.lock.json').bibliotecas) console.log(b.nombre+'@'+b.version)" | {
      while IFS= read -r b; do
        if cli lib install --no-deps "$b" >/dev/null 2>&1; then echo "  ✓ $b"; else echo "  ✗ $b"; FALLOS=$((FALLOS+1)); fi
      done
      [ "$FALLOS" -eq 0 ] && echo "✓ Biblioteca oficial completa en .tools/arduino-user/libraries" \
        || echo "✗ $FALLOS no se instalaron (mira arriba); vuelve a ejecutar «oficial» para reintentarlas"
    }
    ;;
  verificadas)
    cli lib update-index
    # Primero sus dependencias (versión fija), luego ellas; todo sin resolver solo.
    node -e "
const v=require('$RAIZ/server/bibliotecas-verificadas.json').bibliotecas.filter(b=>b.estado==='verificada');
for (const b of v) for (const d of (b.dependencias||[])) console.log(d.nombre+'@'+d.version);
for (const b of v) console.log(b.nombre+'@'+b.version);" | while IFS= read -r b; do
      if cli lib install --no-deps "$b" >/dev/null 2>&1; then echo "  ✓ $b"; else echo "  ✗ $b"; fi
    done
    ;;
  grupo)
    [ $# -ge 1 ] || { echo "Uso: sh scripts/placas.sh grupo <nombre>  (ver: sh scripts/placas.sh grupos)"; exit 1; }
    cli lib update-index
    node -e "const g=require('$RAIZ/server/bibliotecas.json').grupos['$1'];if(!g){console.error('Grupo desconocido: $1');process.exit(1)}console.log(g.join('\n'))" | while IFS= read -r b; do
      echo "· $b"; cli lib install "$b" || echo "  ✗ no se pudo instalar «$b» (se sigue con las demás)"
    done
    ;;
  grupos)
    node -e "const g=require('$RAIZ/server/bibliotecas.json').grupos;for(const [k,v] of Object.entries(g))console.log(k.padEnd(24)+v.length+' bibliotecas: '+v.join(', '))"
    ;;
  zip)
    [ $# -ge 1 ] || { echo "Uso: sh scripts/placas.sh zip ruta/al/archivo.zip"; exit 1; }
    cli lib install --zip-path "$1"
    ;;
  instaladas)
    echo "Núcleos:"; cli core list; echo; echo "Bibliotecas:"; cli lib list
    ;;
  *)
    sed -n '2,18p' "$0"
    ;;
esac
