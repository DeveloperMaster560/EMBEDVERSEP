"""
Verificación automática de bibliotecas (nivel «verificada»).

Cuando un cliente pide una biblioteca que no es oficial, este script decide si
puede usarse SIN revisión manual:

  1. Está en el índice de Arduino → versión exacta y dependencias.
  2. Licencia (API pública de GitHub). Permisiva (MIT, BSD, Apache, ISC, Zlib,
     Unlicense, CC0) → apta. GPL/LGPL/desconocida → revisión manual: entregar
     un binario compilado con ellas trae obligaciones.
  3. Se instala en una carpeta AISLADA (.tools/verificacion/), nunca en la
     del servidor.
  4. Se compilan sus propios ejemplos (hasta 3) en las placas cuyo núcleo hay
     en este equipo y que la biblioteca declara soportar. Solo se compila:
     nada se ejecuta.
  5. No debe dar cabeceras que ya da una oficial.

Resultado en server/bibliotecas-verificadas.json:
  verificada       todo bien: el servidor la acepta (tras «placas.sh verificadas»)
  revision_manual  licencia no permisiva o desconocida, o choca con una oficial
  sin_probar       ninguna placa suya tiene núcleo en este equipo
  rechazada        no está en el índice o ningún ejemplo compila

Uso, desde la carpeta del proyecto:
    python3 scripts/verificar_biblioteca.py "Adafruit SCD30" "FastLED"
    python3 scripts/verificar_biblioteca.py --solicitudes      (las más pedidas por los clientes)
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from biblioteca_oficial import DEL_NUCLEO, INDICES, ultimas  # noqa: E402

RAIZ = Path(__file__).resolve().parents[1]
TOOLS = RAIZ / ".tools"
CLI = TOOLS / "arduino-cli" / ("arduino-cli.exe" if os.name == "nt" else "arduino-cli")
SO = {"darwin": "darwin", "win32": "win32"}.get(sys.platform, "linux")
DATOS = [TOOLS / f"arduino-data-{SO}", TOOLS / "arduino-data"]
SALIDA = RAIZ / "server" / "bibliotecas-verificadas.json"
LOCK = RAIZ / "server" / "bibliotecas.lock.json"
PLACAS = RAIZ / "server" / "placas.json"
SOLICITUDES = TOOLS / "solicitudes-bibliotecas.jsonl"

PERMISIVAS = {"MIT", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "ISC", "Zlib", "Unlicense", "CC0-1.0", "BSL-1.0", "0BSD"}
EJEMPLOS_MAX = 3
TIEMPO_COMPILACION_S = 300


def licencia(repo: str | None) -> tuple[str | None, str]:
    """(SPDX, de dónde salió). Solo repositorios públicos de GitHub."""
    m = re.match(r"https?://github\.com/([^/]+)/([^/.]+?)(?:\.git)?/?$", repo or "")
    if not m:
        return None, "el repositorio no está en GitHub: revisar a mano"
    url = f"https://api.github.com/repos/{m.group(1)}/{m.group(2)}/license"
    req = urllib.request.Request(url, headers={"User-Agent": "embedverse-verificador", "Accept": "application/vnd.github+json"})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            d = json.load(r)
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return None, "el repositorio no declara licencia"
        if e.code == 403:
            return None, "límite de la API de GitHub alcanzado: reintentar en una hora"
        return None, f"GitHub respondió {e.code}"
    except OSError as e:
        return None, f"sin conexión con GitHub ({e})"
    spdx = (d.get("license") or {}).get("spdx_id")
    return (None if spdx in (None, "NOASSERTION") else spdx), f"GitHub: {d.get('path', 'LICENSE')}"


def nucleos_instalados() -> dict[str, tuple[Path, dict]]:
    """arquitectura → (carpeta de datos, una placa de placas.json con ese núcleo)."""
    res: dict[str, tuple[Path, dict]] = {}
    for p in json.loads(PLACAS.read_text(encoding="utf-8"))["placas"]:
        vend, arq = p["paquete"].split(":")
        if arq in res:
            continue
        for d in DATOS:
            base = d / "packages" / vend / "hardware" / arq
            if base.is_dir() and any((v / "platform.txt").is_file() for v in base.iterdir()):
                res[arq] = (d, p)
                break
    return res


def cabeceras_instaladas(lib_dir: Path) -> list[str]:
    hs = {f.name for d in (lib_dir, lib_dir / "src") if d.is_dir() for f in d.iterdir() if f.suffix in (".h", ".hpp")}
    props = lib_dir / "library.properties"
    if props.is_file():
        m = re.search(r"^includes\s*=\s*(.*)$", props.read_text(encoding="utf-8", errors="replace"), re.M)
        if m:
            hs |= {x.strip() for x in m.group(1).split(",") if x.strip()}
    return sorted(hs)


def dependencias(nombre: str, u: dict[str, dict]) -> list[dict]:
    """Todas las dependencias (recursivas) con versión fija, como en la oficial."""
    vistas: dict[str, str] = {}
    pila = [nombre]
    while pila:
        for d in (u.get(pila.pop()) or {}).get("dependencies") or []:
            n = d["name"]
            if n in DEL_NUCLEO or n in vistas or n == nombre or n not in u:
                continue
            vistas[n] = u[n]["version"]
            pila.append(n)
    return [{"nombre": n, "version": v} for n, v in sorted(vistas.items())]


def motivo_error(salida: str) -> str:
    """La línea que explica el fallo, no el «ld returned 1» final."""
    # Sin rutas de este equipo: el resultado se sube al repositorio.
    salida = re.sub(r"\S*/(?:\.\./)+", "", salida.replace(str(RAIZ), "")).replace(str(Path.home()), "~")
    lineas = [l.strip() for l in salida.splitlines() if l.strip()]
    for clave in ("overflowed", "will not fit", "undefined reference", "#error", "error:"):
        for l in lineas:
            if clave in l and "collect2" not in l:
                return l
    return lineas[-1] if lineas else ""


def verificar(nombre: str, u: dict[str, dict], oficiales: dict[str, str], nucleos: dict) -> dict:
    ahora = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    lib = u.get(nombre)
    if lib is None:
        return {"nombre": nombre, "estado": "rechazada", "motivos": ["no está en el índice de Arduino"], "fecha": ahora}
    r: dict = {"nombre": nombre, "version": lib["version"], "repositorio": lib.get("repository"),
               "arquitecturas": lib.get("architectures") or ["*"], "fecha": ahora, "motivos": [],
               "dependencias": dependencias(nombre, u)}
    spdx, fuente = licencia(lib.get("repository"))
    r["licencia"], r["licencia_fuente"] = spdx, fuente
    licencia_ok = spdx in PERMISIVAS
    if not licencia_ok:
        r["motivos"].append(f"licencia {spdx or 'desconocida'} ({fuente}): revisar antes de entregar binarios")

    arqs = r["arquitecturas"]
    placas = [(arq, *nucleos[arq]) for arq in nucleos if "*" in arqs or arq in arqs]
    caja = TOOLS / "verificacion" / re.sub(r"[^A-Za-z0-9_.-]", "_", nombre)
    shutil.rmtree(caja, ignore_errors=True)
    (caja / "user").mkdir(parents=True)
    (caja / "home").mkdir()

    def cli(datos: Path, *args: str, tiempo: int = 600) -> subprocess.CompletedProcess:
        cfg = caja / f"cfg-{datos.name}.yaml"
        cfg.write_text(f"directories:\n  data: {json.dumps(str(datos))}\n  downloads: {json.dumps(str(TOOLS / 'arduino-downloads'))}\n"
                       f"  user: {json.dumps(str(caja / 'user'))}\n", encoding="utf-8")
        return subprocess.run([str(CLI), "--config-file", str(cfg), *args], capture_output=True, text=True,
                              timeout=tiempo, env=dict(os.environ, HOME=str(caja / "home")))

    inst = cli(DATOS[0] if DATOS[0].is_dir() else DATOS[1], "lib", "install", f"{nombre}@{lib['version']}")
    if inst.returncode != 0:
        r["estado"] = "rechazada"
        r["motivos"].append("no se pudo instalar: " + (inst.stderr or inst.stdout).strip()[-300:])
        return r
    libs = caja / "user" / "libraries"
    propia = next((d for d in libs.iterdir() if (d / "library.properties").is_file() and
                   re.search(rf"^name\s*=\s*{re.escape(nombre)}\s*$", (d / "library.properties").read_text(errors="replace"), re.M)), None)
    if propia is None:
        r["estado"] = "rechazada"
        r["motivos"].append("instalada pero no se encuentra su carpeta")
        return r
    r["cabeceras"] = cabeceras_instaladas(propia)
    choques = sorted({f"{h} (ya la da {oficiales[h]})" for h in r["cabeceras"] if h in oficiales})
    if choques:
        r["motivos"].append("choca con la biblioteca oficial: " + ", ".join(choques))

    ejemplos = sorted(p.parent for p in (propia / "examples").rglob("*.ino"))[:EJEMPLOS_MAX] if (propia / "examples").is_dir() else []
    r["pruebas"] = []
    if not placas:
        r["estado"] = "sin_probar"
        r["motivos"].append(f"declara {', '.join(arqs)}; en este equipo no hay núcleo de ninguna de ellas")
        return r
    if not ejemplos:
        r["motivos"].append("no trae ejemplos que compilar")
    for arq, datos, placa in placas:
        for ej in ejemplos:
            with tempfile.TemporaryDirectory(prefix="verif-") as tmp:
                destino = Path(tmp) / ej.name
                shutil.copytree(ej, destino)
                try:
                    c = cli(datos, "compile", "--fqbn", placa["fqbn"], "--build-path", str(Path(tmp) / "build"), str(destino),
                            tiempo=TIEMPO_COMPILACION_S)
                    ok, salida = c.returncode == 0, (c.stderr or c.stdout)
                except subprocess.TimeoutExpired:
                    ok, salida = False, "tiempo agotado"
            error = motivo_error(salida)
            r["pruebas"].append({"placa": placa["id"], "ejemplo": ej.name, "compila": ok, **({} if ok else {"error": error[:300]})})

    compilan = [p for p in r["pruebas"] if p["compila"]]
    fallan = [p for p in r["pruebas"] if not p["compila"]]
    if compilan and fallan:
        r["motivos"].append(f"{len(fallan)} de {len(r['pruebas'])} ejemplos no compilan (ver «pruebas»): "
                            "la biblioteca sirve, pero no todo lo que ofrece funciona en todas las placas")
    if r["pruebas"] and not compilan:
        r["estado"] = "rechazada"
        r["motivos"].append("ningún ejemplo compila en las placas de este equipo")
    elif not licencia_ok or choques:
        r["estado"] = "revision_manual"
    elif not r["pruebas"]:
        r["estado"] = "revision_manual"
    else:
        r["estado"] = "verificada"
    r["placas_probadas"] = sorted({p["placa"] for p in compilan})
    return r


def principal() -> int:
    ap = argparse.ArgumentParser(description="Verificación automática de bibliotecas pedidas por clientes.")
    ap.add_argument("nombres", nargs="*")
    ap.add_argument("--solicitudes", type=int, nargs="?", const=10, help="verificar las N más pedidas (10)")
    ap.add_argument("--indice", type=Path)
    a = ap.parse_args()

    ruta = a.indice or next((p for p in INDICES if p.is_file()), None)
    if not ruta or not CLI.is_file():
        print("Falta el índice o Arduino CLI. Ejecuta antes: sh scripts/placas.sh lista", file=sys.stderr)
        return 1
    u = ultimas(json.loads(ruta.read_text(encoding="utf-8")))
    lock = json.loads(LOCK.read_text(encoding="utf-8"))["bibliotecas"]
    oficiales = {h: b["nombre"] for b in lock for h in b["cabeceras"] + b.get("cabeceras_probables", [])}
    nombres_oficiales = {b["nombre"] for b in lock}

    nombres = list(a.nombres)
    if a.solicitudes:
        if SOLICITUDES.is_file():
            pedidas = Counter()
            for l in SOLICITUDES.read_text(encoding="utf-8").splitlines():
                s = json.loads(l)
                if s.get("sugerencias"):
                    pedidas[s["sugerencias"][0]] += 1
            nombres += [n for n, _ in pedidas.most_common(a.solicitudes)]
        else:
            print("Aún no hay solicitudes de clientes.")
    nombres = [n for n in dict.fromkeys(nombres) if n not in nombres_oficiales]
    if not nombres:
        print("Nada que verificar (¿ya son oficiales?).")
        return 0

    nucleos = nucleos_instalados()
    print(f"· Núcleos en este equipo: {', '.join(f'{k} ({v[1]['id']})' for k, v in nucleos.items()) or 'ninguno'}")
    previas = json.loads(SALIDA.read_text(encoding="utf-8"))["bibliotecas"] if SALIDA.is_file() else []
    por_nombre = {b["nombre"]: b for b in previas}
    for n in nombres:
        print(f"· {n}…", flush=True)
        r = verificar(n, u, oficiales, nucleos)
        por_nombre[n] = r
        pruebas = r.get("pruebas") or []
        print(f"  → {r['estado'].upper()}  v{r.get('version', '?')}  licencia {r.get('licencia') or '—'}  "
              f"ejemplos {sum(p['compila'] for p in pruebas)}/{len(pruebas)} compilan")
        for m in r["motivos"]:
            print(f"    · {m}")
    SALIDA.write_text(json.dumps({
        "_nota": ("Nivel «verificada»: bibliotecas pedidas por clientes y revisadas automáticamente por "
                  "scripts/verificar_biblioteca.py. Solo las de estado «verificada» se aceptan al compilar."),
        "bibliotecas": sorted(por_nombre.values(), key=lambda b: b["nombre"].lower()),
    }, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"· Resultado en {SALIDA.relative_to(RAIZ)}")
    return 0


if __name__ == "__main__":
    sys.exit(principal())
