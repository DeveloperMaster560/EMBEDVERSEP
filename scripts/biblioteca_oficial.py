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

Uso (desde la carpeta del proyecto, con el índice ya descargado por placas.sh):
    python3 scripts/biblioteca_oficial.py [ruta/library_index.json]
"""

from __future__ import annotations

import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[1]
CURADA = RAIZ / "server" / "bibliotecas.json"
SALIDA = RAIZ / "server" / "bibliotecas.lock.json"
CABECERAS = RAIZ / "server" / "cabeceras-indice.json"
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


# Bibliotecas que trae el núcleo de cada placa: no se instalan aparte.
DEL_NUCLEO = {"SPI", "Wire", "EEPROM", "SoftwareSerial", "HID", "WiFi", "Keyboard", "Mouse"}


def resolver(nombre: str, u: dict[str, dict], grupo: str, salida: dict, problemas: list[str], via: str | None = None):
    if via is not None and nombre in DEL_NUCLEO:
        return
    if nombre in salida:
        if via and via not in salida[nombre]["requerida_por"]:
            salida[nombre]["requerida_por"].append(via)
        return
    lib = u.get(nombre)
    if lib is None:
        problemas.append(f"«{nombre}» no está en el índice de Arduino" + (f" (dependencia de {via})" if via else ""))
        return
    salida[nombre] = {
        "nombre": nombre,
        "version": lib["version"],
        "grupo": grupo if via is None else None,
        "requerida_por": [via] if via else [],
        "cabeceras": cabeceras_de(lib),
        # Si el índice no las declara, las probables por el nombre (Adafruit MPU6050 →
        # Adafruit_MPU6050.h). Las reales las lee el servidor de la biblioteca instalada.
        "cabeceras_probables": [] if cabeceras_de(lib) else probables(nombre),
        "arquitecturas": lib.get("architectures") or [],
        "autor": lib.get("author"),
        "repositorio": lib.get("repository") or lib.get("website"),
        "url": lib["url"],
        "checksum": lib["checksum"],
        "bytes": lib.get("size"),
        "licencia": None,   # el índice no la trae: se revisa aparte (ver _nota)
    }
    for dep in lib.get("dependencies") or []:
        resolver(dep["name"], u, grupo, salida, problemas, nombre)


def principal() -> int:
    ruta = Path(sys.argv[1]) if len(sys.argv) > 1 else next((p for p in INDICES if p.is_file()), None)
    if ruta is None or not ruta.is_file():
        print("No encuentro library_index.json. Descárgalo con: sh scripts/placas.sh lista", file=sys.stderr)
        return 1
    indice = json.loads(ruta.read_text(encoding="utf-8"))
    u = ultimas(indice)
    grupos = json.loads(CURADA.read_text(encoding="utf-8"))["grupos"]

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
    choques = {c: sorted(ns) for c, ns in duenos.items() if len(ns) > 1}

    lock = {
        "_nota": ("Biblioteca oficial de EMBEDVERSE. Generado por scripts/biblioteca_oficial.py desde "
                  "server/bibliotecas.json; NO editar a mano. Versiones fijas: el servidor compila "
                  "siempre con estas. «licencia» null = aún sin revisar: antes de entregar binarios "
                  "compilados al público hay que revisar las GPL/LGPL."),
        "generado": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "indice": {"archivo": ruta.name, "bytes": ruta.stat().st_size},
        "bibliotecas": sorted(salida.values(), key=lambda x: x["nombre"].lower()),
        "cabeceras_repetidas": choques,
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
          f"{len(choques)} repetidas entre bibliotecas oficiales")
    for c, ns in sorted(choques.items()):
        print(f"  ! {c}: {', '.join(ns)}")
    sin_cab = [x["nombre"] for x in salida.values() if not x["cabeceras"]]
    if sin_cab:
        print(f"· {len(sin_cab)} sin cabeceras declaradas en el índice (se deducen al instalar): {', '.join(sin_cab[:8])}…")
    for p in problemas:
        print(f"  ✗ {p}")
    print(f"· índice completo: {len(mapa)} cabeceras → {CABECERAS.relative_to(RAIZ)}")
    return 1 if problemas else 0


if __name__ == "__main__":
    sys.exit(principal())
