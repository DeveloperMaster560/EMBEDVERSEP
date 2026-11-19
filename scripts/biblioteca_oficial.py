"""
Biblioteca oficial de EMBEDVERSE: genera server/bibliotecas.lock.json.

Los clientes no instalan bibliotecas: compilan en el servidor con las nuestras.
Este archivo fija, para cada biblioteca de la lista curada
(server/bibliotecas.json):
  - la versión EXACTA (la más reciente del índice al generar; luego no cambia
    sola: actualizar es volver a generar, revisar el diff y probar);
  - sus dependencias, resueltas (también con versión fija);
  - las cabeceras (#include) que proporciona, para saber qué biblioteca pide
    un sketch;
  - el repositorio y el checksum del archivo.
Y comprueba que dos bibliotecas oficiales no den la misma cabecera (el
compilador podría elegir la que no es).

Además genera server/cabeceras-indice.json: cabecera → bibliotecas de TODO el
índice de Arduino que la dan, para decirle al cliente qué biblioteca pide
cuando no está en la oficial.

Las cabeceras se leen del .zip de cada biblioteca (sin instalarla): el índice
solo las declara para ~1 de cada 4, y el nombre no siempre las delata
(TinyGPSPlus → TinyGPS++.h). Los .zip se comprueban con su checksum y quedan en
.tools/arduino-downloads/libraries, donde arduino-cli los reutiliza al instalar.

Uso (desde la carpeta del proyecto, con el índice ya descargado por placas.sh):
    python3 scripts/biblioteca_oficial.py [ruta/library_index.json] [--sin-descargar]
"""

from __future__ import annotations

import hashlib
import json
import re
import sys
import urllib.request
import zipfile
from datetime import datetime, timezone
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[1]
CURADA = RAIZ / "server" / "bibliotecas.json"
SALIDA = RAIZ / "server" / "bibliotecas.lock.json"
CABECERAS = RAIZ / "server" / "cabeceras-indice.json"
DESCARGAS = RAIZ / ".tools" / "arduino-downloads" / "libraries"
INDICES = [RAIZ / ".tools" / f"arduino-data-{p}" / "library_index.json" for p in ("darwin", "linux", "win32")] + \
          [RAIZ / ".tools" / "arduino-data" / "library_index.json"]


def version(v: str) -> tuple:
    partes = re.split(r"[.\-+]", v)
    return tuple((0, int(p)) if p.isdigit() else (-1, p) for p in partes)


def ultimas(indice: dict) -> dict[str, dict]:
    u: dict[str, dict] = {}
    for lib in indice["libraries"]:
        n = lib["name"]
        if n not in u or version(lib["version"]) > version(u[n]["version"]):
            u[n] = lib
    return u


def cabeceras_de(lib: dict) -> list[str]:
    inc = lib.get("providesIncludes") or []
    return sorted(set(inc))


def probables(nombre: str) -> list[str]:
    limpio = re.sub(r"[^A-Za-z0-9_ ]", "", nombre).strip()
    sin_sufijo = re.sub(r"\s+(library|Library|sensor library|Arduino Library)$", "", limpio)
    res = []
    for base in (limpio, sin_sufijo):
        for v in (base.replace(" ", "_"), base.replace(" ", "")):
            if v and f"{v}.h" not in res:
                res.append(f"{v}.h")
    return res


def _normal(t: str) -> str:
    return re.sub(r"[^a-z0-9]", "", t.lower())


def cabeceras_del_archivo(lib: dict) -> tuple[list[str], list[str]] | None:
    """(cabeceras, internas) reales del .zip publicado (raíz y src/, como las ve
    el compilador). None si no se pudo descargar o el checksum no coincide.

    Pública = la incluyen los ejemplos, la declara el índice o se llama como la
    biblioteca. Las demás son internas (config.h de HX711_ADC, splash.h de
    Adafruit SSD1306): un cliente que escribe «config.h» se refiere al suyo, y
    dos bibliotecas pueden tener una interna igual sin chocar."""
    DESCARGAS.mkdir(parents=True, exist_ok=True)
    destino = DESCARGAS / lib["archiveFileName"]
    algoritmo, _, esperado = lib["checksum"].partition(":")
    def correcto() -> bool:
        h = hashlib.new(algoritmo.replace("-", "").lower())
        with destino.open("rb") as f:
            for trozo in iter(lambda: f.read(1 << 20), b""):
                h.update(trozo)
        return h.hexdigest() == esperado.lower()
    try:
        if not (destino.is_file() and correcto()):
            req = urllib.request.Request(lib["url"], headers={"User-Agent": "embedverse-biblioteca-oficial"})
            with urllib.request.urlopen(req, timeout=120) as r, destino.open("wb") as f:
                while trozo := r.read(1 << 20):
                    f.write(trozo)
            if not correcto():
                destino.unlink()
                return None
        with zipfile.ZipFile(destino) as z:
            nombres = z.namelist()
            de_ejemplos = set()
            for n in nombres:
                if "/examples/" in n and re.search(r"\.(ino|h|cpp|c)$", n, re.I):
                    texto = z.read(n).decode("utf-8", "replace")
                    de_ejemplos |= {m.split("/")[-1] for m in re.findall(r'#\s*include\s*[<"]([^>"]+)[>"]', texto)}
    except (OSError, zipfile.BadZipFile, ValueError):
        return None
    res = set()
    for n in nombres:
        partes = n.split("/")
        # <carpeta>/<x>.h   o   <carpeta>/src/<x>.h
        if len(partes) == 2 or (len(partes) == 3 and partes[1] == "src"):
            if re.search(r"\.(h|hpp)$", partes[-1], re.I):
                res.add(partes[-1])
    nombre = _normal(lib["name"])
    publicas = {h for h in res if h in de_ejemplos or h in cabeceras_de(lib)
                or (len(_normal(h.rsplit(".", 1)[0])) >= 3 and _normal(h.rsplit(".", 1)[0]) in nombre)}
    if not publicas:
        publicas = set(res)        # sin pistas: todas cuentan como públicas
    return sorted(res), sorted(res - publicas)


# Bibliotecas que trae el núcleo de cada placa: no se instalan aparte.
DEL_NUCLEO = {"SPI", "Wire", "EEPROM", "SoftwareSerial", "HID", "WiFi", "Keyboard", "Mouse"}


LEER_ARCHIVOS = True


FIJAS: dict[str, dict] = {}       # nombre → {"version", "motivo"} (server/bibliotecas.json)
TODAS: dict[tuple[str, str], dict] = {}   # (nombre, versión) → entrada del índice


def resolver(nombre: str, u: dict[str, dict], grupo: str, salida: dict, problemas: list[str], via: str | None = None):
    if via is not None and nombre in DEL_NUCLEO:
        return
    if nombre in salida:
        if via and via not in salida[nombre]["requerida_por"]:
            salida[nombre]["requerida_por"].append(via)
        return
    lib = u.get(nombre)
    if nombre in FIJAS:
        lib = TODAS.get((nombre, FIJAS[nombre]["version"]))
        if lib is None:
            problemas.append(f"«{nombre}» {FIJAS[nombre]['version']} (versión fija) no está en el índice")
            return
    if lib is None:
        problemas.append(f"«{nombre}» no está en el índice de Arduino" + (f" (dependencia de {via})" if via else ""))
        return
    del_archivo = cabeceras_del_archivo(lib) if LEER_ARCHIVOS else None
    if LEER_ARCHIVOS and del_archivo is None:
        problemas.append(f"«{nombre}»: no se pudo leer su .zip (descarga o checksum); cabeceras deducidas del nombre")
    cabeceras = sorted(set(cabeceras_de(lib)) | set(del_archivo[0] if del_archivo else []))
    salida[nombre] = {
        "nombre": nombre,
        "version": lib["version"],
        "grupo": grupo if via is None else None,
        "requerida_por": [via] if via else [],
        "cabeceras": cabeceras,
        "cabeceras_origen": "archivo" if del_archivo is not None else ("indice" if cabeceras else None),
        "cabeceras_internas": del_archivo[1] if del_archivo else [],
        # Solo si no hubo forma de leerlas: deducidas del nombre (Adafruit MPU6050 → Adafruit_MPU6050.h).
        "cabeceras_probables": [] if cabeceras else probables(nombre),
        "arquitecturas": lib.get("architectures") or [],
        "autor": lib.get("author"),
        "repositorio": lib.get("repository") or lib.get("website"),
        "url": lib["url"],
        "checksum": lib["checksum"],
        "bytes": lib.get("size"),
        "licencia": None,   # el índice no la trae: se revisa aparte (ver _nota)
        **({"version_fija": FIJAS[nombre]["motivo"], "ultima_en_indice": u[nombre]["version"]} if nombre in FIJAS else {}),
    }
    for dep in lib.get("dependencies") or []:
        resolver(dep["name"], u, grupo, salida, problemas, nombre)


def principal() -> int:
    global LEER_ARCHIVOS
    args = [a for a in sys.argv[1:] if a != "--sin-descargar"]
    LEER_ARCHIVOS = "--sin-descargar" not in sys.argv
    ruta = Path(args[0]) if args else next((p for p in INDICES if p.is_file()), None)
    if ruta is None or not ruta.is_file():
        print("No encuentro library_index.json. Descárgalo con: sh scripts/placas.sh lista", file=sys.stderr)
        return 1
    indice = json.loads(ruta.read_text(encoding="utf-8"))
    u = ultimas(indice)
    curada = json.loads(CURADA.read_text(encoding="utf-8"))
    grupos = curada["grupos"]
    FIJAS.update({k: v for k, v in curada.get("versiones_fijas", {}).items() if not k.startswith("_")})
    TODAS.update({(l["name"], l["version"]): l for l in indice["libraries"]})

    salida: dict[str, dict] = {}
    problemas: list[str] = []
    for grupo, nombres in grupos.items():
        for n in nombres:
            if n in salida and salida[n]["grupo"] is None:
                salida[n]["grupo"] = grupo     # era solo dependencia; también está curada
            resolver(n, u, grupo, salida, problemas)

    # Cabeceras repetidas entre bibliotecas oficiales: el compilador no sabría cuál usar.
    duenos: dict[str, list[str]] = {}
    for lib in salida.values():
        for c in lib["cabeceras"]:
            duenos.setdefault(c, []).append(lib["nombre"])
    internas = {lib["nombre"]: set(lib["cabeceras_internas"]) for lib in salida.values()}
    repetidas = {c: sorted(ns) for c, ns in duenos.items() if len(ns) > 1}
    # Choque: la ofrece hacia fuera alguna de ellas. Si en todas es interna, cada una usa la suya.
    choques = {c: ns for c, ns in repetidas.items() if not all(c in internas[n] for n in ns)}
    solo_internas = {c: ns for c, ns in repetidas.items() if c not in choques}

    lock = {
        "_nota": ("Biblioteca oficial de EMBEDVERSE. Generado por scripts/biblioteca_oficial.py desde "
                  "server/bibliotecas.json; NO editar a mano. Versiones fijas: el servidor compila "
                  "siempre con estas. «licencia» null = aún sin revisar: antes de entregar binarios "
                  "compilados al público hay que revisar las GPL/LGPL."),
        "generado": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "indice": {"archivo": ruta.name, "bytes": ruta.stat().st_size},
        "bibliotecas": sorted(salida.values(), key=lambda x: x["nombre"].lower()),
        "cabeceras_repetidas": choques,
        "cabeceras_internas_repetidas": solo_internas,
        "problemas": problemas,
    }
    SALIDA.write_text(json.dumps(lock, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")

    # Cabecera → bibliotecas que la dan, en todo el índice (para sugerir).
    mapa: dict[str, list[str]] = {}
    for lib in u.values():
        for c in cabeceras_de(lib) or probables(lib["name"]):
            mapa.setdefault(c, []).append(lib["name"])

    def orden(cabecera: str, nombres: list[str]) -> list[str]:
        # Primero la biblioteca cuyo nombre ES la cabecera (WiFiManager.h → WiFiManager).
        base = re.sub(r"[^a-z0-9]", "", cabecera.rsplit(".", 1)[0].lower())
        return sorted(set(nombres), key=lambda n: (re.sub(r"[^a-z0-9]", "", n.lower()) != base, n.lower()))
    CABECERAS.write_text(json.dumps({
        "_nota": "Cabecera → bibliotecas del índice de Arduino que la proporcionan. Generado por scripts/biblioteca_oficial.py.",
        "cabeceras": {c: orden(c, ns)[:8] for c, ns in sorted(mapa.items())},
    }, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")

    curadas = sum(1 for x in salida.values() if x["grupo"])
    print(f"· {curadas} bibliotecas curadas + {len(salida) - curadas} dependencias = {len(salida)} con versión fija")
    print(f"· {sum(len(x['cabeceras']) for x in salida.values())} cabeceras conocidas; "
          f"{len(choques)} repetidas entre bibliotecas oficiales"
          + (f" (+{len(solo_internas)} internas, sin efecto: {', '.join(sorted(solo_internas))})" if solo_internas else ""))
    for c, ns in sorted(choques.items()):
        print(f"  ! {c}: {', '.join(ns)}")
    sin_cab = [x["nombre"] for x in salida.values() if not x["cabeceras"]]
    if sin_cab:
        print(f"· {len(sin_cab)} sin cabeceras declaradas en el índice (se deducen al instalar): {', '.join(sin_cab[:8])}…")
    for n, f in FIJAS.items():
        if n in salida and salida[n].get("ultima_en_indice") != salida[n]["version"]:
            print(f"· {n} fijada en {salida[n]['version']} (última: {salida[n]['ultima_en_indice']}): {f['motivo'][:90]}…")
    for p in problemas:
        print(f"  ✗ {p}")
    print(f"· índice completo: {len(mapa)} cabeceras → {CABECERAS.relative_to(RAIZ)}")
    return 1 if problemas or choques else 0


if __name__ == "__main__":
    sys.exit(principal())
