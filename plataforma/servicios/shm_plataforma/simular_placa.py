"""
Simula en el PC un sketch de ESP32/Arduino SIN modificarlo.

El sketch se compila con el compilador del PC contra cabeceras simuladas
(firmware/simulador-host/nucleo): reloj virtual, Wi-Fi, MQTT, NTP y sensores
cuyas lecturas salen de un escenario CSV. Lo que publica se revisa con los
contratos de la plataforma y, con --enviar, se manda al broker de verdad como
si fuera la estación.

    python -m shm_plataforma.simular_placa ../../firmware/esp32-ambiente \\
        --escenario ../../firmware/simulador-host/escenarios/cacao-dia.csv --duracion 600 --enviar

Qué NO simula (y por qué importa): tiempos reales del procesador, memoria
(RAM y pila del ESP32), interrupciones, ruido eléctrico, el radio Wi-Fi.
Que funcione aquí no prueba que funcione en la placa; que falle aquí sí
suele indicar un error de lógica o de formato.

Escenario CSV: primera columna t_s (segundos desde el arranque), luego una
columna por señal. Entre filas se interpola; una celda vacía = el sensor falla
en ese tramo. Columnas que entienden los sensores simulados:
    temperatura (°C), humedad (%HR)       DHT11/DHT22
    luz (lux)                             BH1750
    distancia_cm                          HC-SR04 (pulseIn)
    A<pin> (cuentas del ADC)              analogRead(pin)
    D<pin> (0/1)                          digitalRead(pin)
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
import threading
import time
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Optional

from .contrato import validate_for_server
from .contrato_medidas import validate_measurement_message

RAIZ = Path(__file__).resolve().parents[3]
NUCLEO = RAIZ / "firmware" / "simulador-host" / "nucleo"
TOPICO = re.compile(r"^shm/v1/([A-Z0-9][A-Z0-9-]{1,31})/(registro|medida|estado|evento)$")
INCLUDE = re.compile(r'^\s*#\s*include\s*[<"]([^>"]+)[>"]', re.M)
BIBLIOTECAS_USUARIO = Path(os.environ.get("SIM_BIBLIOTECAS") or RAIZ / ".tools" / "arduino-user" / "libraries")
# Bibliotecas de software puro: no tocan hardware, así que el simulador usa la
# biblioteca real (instalada con scripts/placas.*) en vez de una imitación.
PORTABLES = {"ArduinoJson.h": "ArduinoJson"}


def biblioteca_portable(cabecera: str) -> Optional[Path]:
    nombre = PORTABLES.get(cabecera)
    if not nombre:
        return None
    for d in (BIBLIOTECAS_USUARIO / nombre / "src", BIBLIOTECAS_USUARIO / nombre):
        if (d / cabecera).is_file():
            return d
    return None


class ErrorSimulacion(RuntimeError):
    pass


@dataclass
class Mensaje:
    t_s: float
    topico: str
    carga: str
    problemas: list[str] = field(default_factory=list)


@dataclass
class Resultado:
    mensajes: list[Mensaje]
    serie: list[str]
    notas: list[str]
    t_fin_s: float

    def resumen(self) -> dict:
        por = Counter(m.topico for m in self.mensajes)
        malos = [m for m in self.mensajes if m.problemas]
        return {"mensajes": len(self.mensajes), "por_topico": dict(por), "con_problemas": len(malos),
                "primer_problema": malos[0].problemas if malos else None, "notas": self.notas,
                "tiempo_simulado_s": self.t_fin_s}


def cabeceras_que_faltan(sketch_dir: Path) -> list[str]:
    """#include que ni el simulador ni el sketch ni la biblioteca estándar tienen."""
    propias = {p.name for p in sketch_dir.iterdir() if p.suffix in (".h", ".hpp")}
    simuladas = {p.name for p in NUCLEO.iterdir() if p.suffix == ".h"}
    faltan = []
    for f in sketch_dir.iterdir():
        if f.suffix not in (".ino", ".h", ".cpp", ".hpp"):
            continue
        for inc in INCLUDE.findall(f.read_text(encoding="utf-8", errors="replace")):
            base = Path(inc).name
            if base in propias or base in simuladas or inc == "secretos.h" or biblioteca_portable(inc):
                continue
            if "/" in inc or "." not in inc:   # sys/time.h, <string>…: del sistema
                continue
            if inc in ("math.h", "stdint.h", "stdio.h", "stdlib.h", "string.h", "time.h", "stdarg.h", "ctype.h"):
                continue
            faltan.append(inc)
    return sorted(set(faltan))


def compilar(sketch_dir: Path, destino: Path, compilador: Optional[str] = None) -> Path:
    sketch_dir = sketch_dir.resolve()
    inos = sorted(sketch_dir.glob("*.ino"))
    if not inos:
        raise ErrorSimulacion(f"No hay ningún .ino en {sketch_dir}")
    faltan = cabeceras_que_faltan(sketch_dir)
    if faltan:
        sin_instalar = [f for f in faltan if f in PORTABLES]
        otras = [f for f in faltan if f not in PORTABLES]
        partes = []
        if sin_instalar:
            orden = "powershell -ExecutionPolicy Bypass -File scripts\\placas.ps1" if os.name == "nt" else "sh scripts/placas.sh"
            partes.append("Falta instalar " + ", ".join(PORTABLES[f] for f in sin_instalar)
                          + " (software puro: el simulador usa la biblioteca real). Desde la carpeta del proyecto: "
                          + "; ".join(f'{orden} biblioteca "{PORTABLES[f]}"' for f in sin_instalar))
        if otras:
            partes.append("El simulador aún no imita estas bibliotecas de hardware: " + ", ".join(otras)
                          + f" (las que sí imita están en {NUCLEO.relative_to(RAIZ)})")
        raise ErrorSimulacion(". ".join(partes) + ".")
    cxx = compilador or shutil.which("c++") or shutil.which("g++") or shutil.which("clang++")
    if not cxx:
        raise ErrorSimulacion("No hay compilador de C++ en este equipo (c++, g++ o clang++).")
    destino.mkdir(parents=True, exist_ok=True)
    for f in sketch_dir.iterdir():
        if f.suffix in (".h", ".hpp", ".cpp", ".c"):
            shutil.copy(f, destino / f.name)
    # secretos.h no está en el repositorio: para simular basta la plantilla.
    if not (destino / "secretos.h").exists() and (sketch_dir / "secretos.ejemplo.h").exists():
        shutil.copy(sketch_dir / "secretos.ejemplo.h", destino / "secretos.h")
    # Como el IDE de Arduino: todos los .ino de la carpeta forman un solo programa.
    unido = "".join(f'#line 1 "{i.name}"\n' + i.read_text(encoding="utf-8") + "\n" for i in inos)
    (destino / "sketch.cpp").write_text('#include "Arduino.h"\n' + unido, encoding="utf-8")
    exe = destino / ("placa.exe" if os.name == "nt" else "placa")
    fuentes = [str(destino / "sketch.cpp"), str(NUCLEO / "sim.cpp")] + \
              [str(p) for p in destino.glob("*.cpp") if p.name != "sketch.cpp"]
    extra = []
    for f in [sketch_dir / x for x in os.listdir(sketch_dir)]:
        if f.suffix in (".ino", ".h", ".cpp", ".hpp"):
            for inc in INCLUDE.findall(f.read_text(encoding="utf-8", errors="replace")):
                d = biblioteca_portable(inc)
                if d and str(d) not in extra:
                    extra += ["-I", str(d)]
    orden = [cxx, "-std=gnu++17", "-O1", "-w", "-I", str(NUCLEO), "-I", str(destino), *extra, *fuentes, "-o", str(exe)]
    r = subprocess.run(orden, capture_output=True, text=True)
    if r.returncode != 0:
        errores = [l for l in r.stderr.splitlines() if "error" in l]
        raise ErrorSimulacion("El sketch no compila en el simulador:\n" + "\n".join((errores or r.stderr.splitlines())[:15]))
    return exe


def validar(topico: str, carga: str) -> list[str]:
    m = TOPICO.match(topico)
    if not m:
        return [f"Tópico fuera del esquema shm/v1/<estación>/<tipo>: {topico}"]
    estacion, tipo = m.groups()
    if tipo == "estado":
        try:
            return [] if isinstance(json.loads(carga), dict) else ["El estado no es un objeto JSON."]
        except json.JSONDecodeError as e:
            return [f"El estado no es JSON: {e}"]
    if tipo == "evento":
        return ["Los mensajes de evento aún no tienen contrato definido."]
    try:
        d = json.loads(carga)
    except json.JSONDecodeError as e:
        return [f"No es JSON válido: {e}"]
    p = validate_measurement_message(d) if tipo == "medida" else validate_for_server(d)
    if isinstance(d, dict) and d.get("station_id") not in (None, estacion):
        p.append(f"El mensaje dice ser de {d.get('station_id')} pero va por el tópico de {estacion}.")
    return p


def ejecutar(exe: Path, escenario: Path, duracion_s: float, inicio_ms: int,
             al_publicar: Optional[Callable[[Mensaje], None]] = None,
             al_serie: Optional[Callable[[str], None]] = None, limite_s: float = 120) -> Resultado:
    env = dict(os.environ, SIM_ESCENARIO=str(escenario.resolve()), SIM_DURACION_S=str(duracion_s),
               SIM_INICIO_MS=str(inicio_ms))
    mensajes, serie, notas, t_fin = [], [], [], 0.0
    cortado = threading.Event()
    with subprocess.Popen([str(exe)], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
                          encoding="utf-8", errors="replace", env=env) as proc:
        def cortar() -> None:
            cortado.set()
            proc.kill()
        reloj = threading.Timer(limite_s, cortar)   # también corta bucles que no imprimen nada
        reloj.start()
        try:
            assert proc.stdout is not None and proc.stderr is not None
            for linea in proc.stdout:
                linea = linea.rstrip("\n")
                if linea.startswith("@@PUB "):
                    _, t_us, topico, carga = linea.split(" ", 3)
                    m = Mensaje(int(t_us) / 1e6, topico, carga)
                    m.problemas = validar(topico, carga)
                    mensajes.append(m)
                    if al_publicar:
                        al_publicar(m)
                elif linea.startswith("@@SIM "):
                    notas.append(linea[6:])
                elif linea.startswith("@@FIN "):
                    t_fin = int(linea[6:]) / 1e6
                elif linea:
                    serie.append(linea)
                    if al_serie:
                        al_serie(linea)
            err = proc.stderr.read()
            codigo = proc.wait()
        finally:
            reloj.cancel()
    if cortado.is_set():
        raise ErrorSimulacion(f"La simulación tardó más de {limite_s:.0f} s reales: el sketch se quedó en un bucle "
                              "que no deja pasar el tiempo (¿un while sin delay()?).")
    if codigo != 0:
        raise ErrorSimulacion(f"La simulación terminó con error ({codigo}): {err.strip()[:500]}")
    return Resultado(mensajes, serie, notas, t_fin)


def principal(argv: Optional[list[str]] = None) -> int:
    ap = argparse.ArgumentParser(description="Simula un sketch de ESP32/Arduino en el PC con sensores de un escenario.")
    ap.add_argument("sketch", type=Path, help="carpeta del sketch (la que tiene el .ino)")
    ap.add_argument("--escenario", type=Path, required=True, help="CSV con t_s y las señales")
    ap.add_argument("--duracion", type=float, default=300, help="segundos de tiempo simulado (300)")
    ap.add_argument("--enviar", action="store_true", help="publicar en el broker como la estación")
    ap.add_argument("--broker", default="127.0.0.1")
    ap.add_argument("--broker-puerto", type=int, default=1883)
    ap.add_argument("--env", type=Path, default=Path(__file__).resolve().parents[2] / ".env")
    ap.add_argument("--json", action="store_true", help="resumen en JSON (para la app)")
    a = ap.parse_args(argv)

    # La simulación termina «ahora»: los datos quedan en el pasado reciente y Grafana los muestra.
    inicio_ms = int(time.time() * 1000 - a.duracion * 1000)
    cliente = None
    enviados = 0

    def publicar(m: Mensaje) -> None:
        nonlocal cliente, enviados
        if not a.enviar:
            return
        est = TOPICO.match(m.topico)
        if not est:
            return
        if cliente is None:
            from .pasarela_serie import MqttMinimo, leer_env
            env = leer_env(a.env)
            clave = env.get(f"MQTT_{est.group(1).replace('-', '_')}_PASSWORD")
            if not clave:
                raise ErrorSimulacion(f"No hay contraseña MQTT para {est.group(1)} en {a.env}: ¿está dada de alta en un proyecto?")
            cliente = MqttMinimo(a.broker, a.broker_puerto, est.group(1), clave)
            cliente.conectar()
        cliente.publicar(m.topico, m.carga.encode("utf-8"))
        enviados += 1

    def mostrar(m: Mensaje) -> None:
        if not a.json:
            marca = "✓" if not m.problemas else "✗ " + "; ".join(m.problemas[:2])
            print(f"[{m.t_s:8.1f} s] {m.topico}  {marca}")
        publicar(m)

    try:
        with tempfile.TemporaryDirectory(prefix="sim-placa-") as tmp:
            exe = compilar(a.sketch, Path(tmp))
            r = ejecutar(exe, a.escenario, a.duracion, inicio_ms, mostrar,
                         None if a.json else (lambda l: print(f"           placa: {l}")))
    except ErrorSimulacion as e:
        if a.json:
            print(json.dumps({"error": str(e)}, ensure_ascii=False))
        else:
            print(f"✗ {e}", file=sys.stderr)
        return 1
    finally:
        if cliente is not None:
            cliente.cerrar()
    res = r.resumen() | {"enviados": enviados}
    if a.json:
        print(json.dumps(res | {"mensajes_detalle": [m.__dict__ for m in r.mensajes[:200]]}, ensure_ascii=False))
    else:
        print(f"\n· {res['tiempo_simulado_s']:.0f} s simulados; {res['mensajes']} mensajes "
              f"({', '.join(f'{k}: {v}' for k, v in res['por_topico'].items()) or 'ninguno'}); "
              f"{res['con_problemas']} con problemas; {enviados} enviados al broker.")
        for n in r.notas:
            print(f"· aviso del simulador: {n}")
    return 0 if res["con_problemas"] == 0 else 3


if __name__ == "__main__":
    sys.exit(principal())
