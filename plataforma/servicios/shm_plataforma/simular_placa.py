"""
Simula en el PC un sketch de Arduino/ESP32 SIN modificarlo.

Cómo (simulación «por bus»):
  · Las bibliotecas de sensores son las REALES (las de la biblioteca oficial,
    desde sus .zip verificados), no imitaciones: el sketch y la biblioteca se
    comportan como en la placa.
  · Lo simulado es el hardware: el bus I2C entrega cada byte al MODELO DEL
    CHIP (firmware/simulador-host/modelos: registros, tiempos, CRC según la
    hoja de datos), y los pines, el ADC y el reloj salen de un escenario CSV.
    Un modelo de chip sirve para todas las bibliotecas de ese chip.
  · String, Print y Stream son los del núcleo de Arduino.
  · La placa importa (--placa): macros de su familia, resolución del ADC,
    búfer I2C, si tiene Wi-Fi y Serial.printf.

Aún imitados (no por bus): Wi-Fi, MQTT (PubSubClient), NTP y DHT11/22 (su
protocolo de un hilo depende de tiempos de microsegundos).

    python -m shm_plataforma.simular_placa ../../firmware/esp32-ambiente \\
        --escenario ../../firmware/simulador-host/escenarios/cacao-prueba.csv --duracion 600 --enviar

Qué NO simula: tiempos del procesador, memoria (RAM/pila), interrupciones,
ruido eléctrico, la radio. En AVR un int es de 16 bits y aquí de 32. Que
funcione aquí no prueba que funcione en la placa; que falle aquí sí suele
indicar un error de lógica, de formato o de cableado lógico (dirección I2C,
orden de inicialización).

Escenario CSV: primera columna t_s, luego una columna por señal (ver
firmware/simulador-host/LEEME.md). Entre filas se interpola; una celda vacía =
el sensor falla en ese tramo (en I2C: el chip no responde, NACK).
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import zipfile
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Optional

from .contrato import validate_for_server
from .contrato_medidas import validate_measurement_message

RAIZ = Path(__file__).resolve().parents[3]
SIMULADOR = RAIZ / "firmware" / "simulador-host"
NUCLEO = SIMULADOR / "nucleo"
MODELOS = SIMULADOR / "modelos"
TOOLS = RAIZ / ".tools"
ZIPS = TOOLS / "arduino-downloads" / "libraries"
EXTRAIDAS = TOOLS / "simulador" / "bibliotecas"
INSTALADAS = Path(os.environ.get("SIM_BIBLIOTECAS") or TOOLS / "arduino-user" / "libraries")
LOCK = RAIZ / "server" / "bibliotecas.lock.json"
INDICE_CABECERAS = RAIZ / "server" / "cabeceras-indice.json"
PLACAS = RAIZ / "server" / "placas.json"
TOPICO = re.compile(r"^shm/v1/([A-Z0-9][A-Z0-9-]{1,31})/(registro|medida|estado|evento)$")
INCLUDE = re.compile(r'^\s*#\s*include\s*[<"]([^>"]+)[>"]', re.M)
FUENTES = (".c", ".cpp")
CABECERAS = (".h", ".hpp")
# Del núcleo de Arduino (cores/arduino del núcleo AVR): portables y reales.
DEL_NUCLEO_ARDUINO = ["WString.h", "WString.cpp", "Print.h", "Print.cpp", "Stream.h", "Stream.cpp", "Printable.h",
                      "IPAddress.h", "IPAddress.cpp", "Client.h", "Server.h", "Udp.h", "WCharacter.h", "binary.h"]
# Cabeceras de hardware que no tienen sentido en el PC.
REGISTROS = re.compile(r"^(avr/(io|interrupt|sleep|wdt|eeprom|power)\.h|util/delay\.h|driver/|soc/|hal/|stm32\w*\.h|hardware/)")


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


# ------------------------------------------------------------------ placa

@dataclass
class PlacaSim:
    id: str
    nombre: str
    arquitectura: str
    macros: list[str]
    wifi: bool

    @property
    def flags(self) -> list[str]:
        return [f"-D{m}" for m in self.macros]


def placa_sim(placa_id: str) -> PlacaSim:
    placas = {p["id"]: p for p in json.loads(PLACAS.read_text(encoding="utf-8"))["placas"]}
    p = placas.get(placa_id)
    if p is None:
        raise ErrorSimulacion(f"Placa desconocida: {placa_id}. Las disponibles están en server/placas.json.")
    arq = p["paquete"].split(":")[1]
    macros = {
        "avr": ["ARDUINO_ARCH_AVR"], "megaavr": ["ARDUINO_ARCH_MEGAAVR"],
        "esp32": ["ESP32", "ARDUINO_ARCH_ESP32", "SIM_PRINTF", "SIM_BITS_ADC=12"],
        "esp8266": ["ESP8266", "ARDUINO_ARCH_ESP8266", "SIM_PRINTF"],
        "rp2040": ["ARDUINO_ARCH_RP2040", "SIM_PRINTF"], "stm32": ["ARDUINO_ARCH_STM32", "SIM_PRINTF"],
        "samd": ["ARDUINO_ARCH_SAMD"], "sam": ["ARDUINO_ARCH_SAM"], "renesas_uno": ["ARDUINO_ARCH_RENESAS_UNO"],
    }.get(arq, ["ARDUINO_ARCH_MBED"] if arq.startswith("mbed") else [])
    if p["paquete"].startswith("teensy:"):
        # El núcleo de PJRC se llama «avr» por historia, pero las Teensy 3/4 son ARM. Se imita su
        # API (Serial.printf, ADC de 10 bits por omisión) sin las macros de sus registros
        # (__IMXRT1062__…): una biblioteca que los toca dice «no se puede simular».
        macros = ["TEENSYDUINO=160", "ARDUINO_" + p["fqbn"].split(":")[2].upper(), "SIM_PRINTF"]
    macros.insert(0, "ARDUINO=10819")   # como arduino-cli: en la línea de órdenes, no solo en Arduino.h
    if placa_id == "arduino-uno":
        macros.append("ARDUINO_AVR_UNO")
    elif placa_id == "arduino-mega":
        macros.append("ARDUINO_AVR_MEGA2560")
    # Wi-Fi con la API de WiFi.h del ESP32 (la que imita el simulador).
    wifi = arq == "esp32" or (arq == "rp2040" and placa_id.endswith("w"))
    if wifi:
        macros.append("SIM_WIFI")
    return PlacaSim(p["id"], p["nombre"], arq, macros, wifi)


# ------------------------------------------------------------- bibliotecas

def nucleo_arduino() -> Path:
    """cores/arduino del núcleo AVR instalado (sus clases portables)."""
    for d in sorted(TOOLS.glob("arduino-data*/packages/arduino/hardware/avr/*/cores/arduino"), reverse=True):
        if (d / "WString.cpp").is_file():
            return d
    raise ErrorSimulacion("El simulador usa String/Print/Stream del núcleo de Arduino y no lo encuentro. "
                          "Instálalo una vez con:  sh scripts/placas.sh nucleo arduino-uno")


@dataclass
class Biblioteca:
    nombre: str
    version: str
    raiz: Path
    incluir: list[Path]
    fuentes: list[Path]
    usa: list[str] = field(default_factory=list)   # otras bibliotecas que incluye


def _indice_oficial() -> tuple[dict[str, dict], dict[str, dict]]:
    libs = json.loads(LOCK.read_text(encoding="utf-8"))["bibliotecas"]
    por_cabecera: dict[str, dict] = {}
    for b in libs:
        internas = set(b.get("cabeceras_internas") or [])
        for h in b["cabeceras"] + b.get("cabeceras_probables", []):
            if h not in internas:
                por_cabecera.setdefault(h, b)
    return por_cabecera, {b["nombre"]: b for b in libs}


def _carpeta_de(b: dict) -> Path:
    """La biblioteca, tal cual se publicó: instalada con esa versión, o extraída de su .zip verificado."""
    for d in INSTALADAS.glob("*") if INSTALADAS.is_dir() else []:
        props = d / "library.properties"
        if props.is_file():
            t = props.read_text(encoding="utf-8", errors="replace")
            if re.search(rf"^name\s*=\s*{re.escape(b['nombre'])}\s*$", t, re.M) and \
               re.search(rf"^version\s*=\s*{re.escape(b['version'])}\s*$", t, re.M):
                return d
    archivo = b["url"].rsplit("/", 1)[1]
    destino = EXTRAIDAS / archivo[:-4]
    if not destino.is_dir():
        z = ZIPS / archivo
        if not z.is_file():
            raise ErrorSimulacion(f"Falta el .zip de «{b['nombre']}» {b['version']}. Descárgalo (con su checksum) con:  "
                                  "python3 scripts/biblioteca_oficial.py")
        tmp = destino.with_suffix(".tmp")
        shutil.rmtree(tmp, ignore_errors=True)
        with zipfile.ZipFile(z) as f:
            for n in f.namelist():
                if n.startswith("/") or ".." in Path(n).parts:
                    raise ErrorSimulacion(f"El .zip de {b['nombre']} tiene rutas fuera de su carpeta")
            f.extractall(tmp)
        tmp.rename(destino)
    dentro = [d for d in destino.iterdir() if d.is_dir()]
    return dentro[0] if len(dentro) == 1 else destino


def _biblioteca(b: dict) -> Biblioteca:
    raiz = _carpeta_de(b)
    if (raiz / "src").is_dir():   # formato 1.5: todo src/, recursivo
        incluir = [raiz / "src"]
        fuentes = [f for f in (raiz / "src").rglob("*") if f.suffix in FUENTES]
    else:                         # formato antiguo: raíz + utility/
        incluir = [raiz] + ([raiz / "utility"] if (raiz / "utility").is_dir() else [])
        fuentes = [f for d in incluir for f in d.iterdir() if f.suffix in FUENTES]
    return Biblioteca(b["nombre"], b["version"], raiz, incluir, sorted(fuentes))


FALTA = re.compile(r"fatal error: '?([^':\n]+?)'?(?: file not found|: No such file or directory)")


def resolver(fuentes: list[Path], incluir: list[str], flags: list[str], cxx: str, cc: str
             ) -> tuple[list[Biblioteca], list[str]]:
    """Bibliotecas que el sketch usa de verdad, como hace arduino-cli: se pasa
    el preprocesador (con las macros de la placa) y, cuando falta una cabecera,
    se añade la biblioteca oficial que la da y se repite. Así solo cuenta lo
    que se compila para ESTA placa (un #include dentro de #if __AVR__ no pesa
    en un ESP32). Devuelve (bibliotecas, problemas)."""
    por_cabecera, por_nombre = _indice_oficial()
    usadas: dict[str, Biblioteca] = {}
    problemas: list[str] = []
    cola = list(fuentes)
    hechos: set[Path] = set()
    # Los archivos de una biblioteca extraída no cambian: qué bibliotecas pide cada uno, con
    # estas macros, se guarda (preprocesar RadioLib entero en cada simulación son ~15 s).
    ruta_cache = TOOLS / "simulador" / "resolucion.json"
    try:
        cache = json.loads(ruta_cache.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        cache = {}
    firma = hashlib.sha256(json.dumps([flags, sorted(p.name for p in NUCLEO.rglob("*.h"))]).encode()).hexdigest()[:16]

    def anadir(b: dict, duena: Optional[Biblioteca]) -> Optional[Biblioteca]:
        if b["nombre"] not in usadas:
            try:
                usadas[b["nombre"]] = _biblioteca(b)
            except ErrorSimulacion as e:
                problemas.append(str(e))
                return None
            cola.extend(usadas[b["nombre"]].fuentes)
        if duena is not None and b["nombre"] not in duena.usa and b["nombre"] != duena.nombre:
            duena.usa.append(b["nombre"])
        return usadas[b["nombre"]]

    while cola:
        f = cola.pop(0)
        if f in hechos:
            continue
        hechos.add(f)
        duena_f = next((x for x in usadas.values() if f.is_relative_to(x.raiz)), None)
        clave = f"{firma}:{f}" if duena_f is not None else None
        if clave and clave in cache:
            for n in cache[clave]:
                if n in por_nombre:
                    anadir(por_nombre[n], duena_f)
            continue
        pedidas: list[str] = []
        limpio = True
        for _ in range(50):
            orden = [cc, "-std=gnu11", "-x", "c"] if f.suffix == ".c" else [cxx, "-std=gnu++17", "-x", "c++"]
            duena_f = next((x for x in usadas.values() if f.is_relative_to(x.raiz)), None)
            visibles = _alcance(duena_f, usadas) if duena_f else list(usadas.values())
            extra = [x for b in visibles for d in b.incluir for x in ("-I", str(d))]
            r = subprocess.run([*orden, *flags, *incluir, *extra, "-E", str(f), "-o", os.devnull],
                               capture_output=True, text=True)
            m = FALTA.search(r.stderr) if r.returncode != 0 else None
            if not m:
                break                           # preprocesa (los demás errores los da la compilación)
            limpio = False
            inc = m.group(1).strip()
            base = Path(inc).name
            quien = next((f"«{b.nombre}»" for b in usadas.values() if f.is_relative_to(b.raiz)), "el sketch")
            if REGISTROS.match(inc):
                problemas.append(f"{quien} usa registros del microcontrolador ({inc}): no se puede ejecutar en el PC")
                break
            b = por_cabecera.get(base)
            duena = next((x for x in usadas.values() if f.is_relative_to(x.raiz)), None)
            if b is None or (b["nombre"] in usadas and (duena is None or b["nombre"] in duena.usa)):
                problemas.append(f"{inc} (en {quien}): no es de la biblioteca oficial" + _sugerencia(base))
                break
            if anadir(b, duena) is None:
                break
            pedidas.append(b["nombre"])
            limpio = True
        if clave and limpio:
            cache[clave] = pedidas
    try:
        ruta_cache.parent.mkdir(parents=True, exist_ok=True)
        ruta_cache.write_text(json.dumps(cache), encoding="utf-8")
    except OSError:
        pass
    return list(usadas.values()), sorted(set(problemas))


def _alcance(b: Biblioteca, todas: dict[str, Biblioteca]) -> list[Biblioteca]:
    """La biblioteca y las que incluye (recursivo), en orden estable."""
    res, pila = {}, [b.nombre]
    while pila:
        n = pila.pop()
        if n in res or n not in todas:
            continue
        res[n] = todas[n]
        pila.extend(todas[n].usa)
    return sorted(res.values(), key=lambda x: x.nombre)


def _sugerencia(cabecera: str) -> str:
    try:
        idx = json.loads(INDICE_CABECERAS.read_text(encoding="utf-8"))["cabeceras"]
    except OSError:
        return ""
    s = idx.get(cabecera)
    return f" (la dan: {', '.join(s[:3])})" if s else ""


def compilar(sketch_dir: Path, destino: Path, compilador: Optional[str] = None,
             placa: str = "esp32-devkit") -> Path:
    sketch_dir = sketch_dir.resolve()
    inos = sorted(sketch_dir.glob("*.ino"))
    if not inos:
        raise ErrorSimulacion(f"No hay ningún .ino en {sketch_dir}")
    ps = placa_sim(placa)
    cxx = compilador or shutil.which("c++") or shutil.which("g++") or shutil.which("clang++")
    cc = shutil.which("cc") or shutil.which("gcc") or shutil.which("clang")
    if not cxx or not cc:
        raise ErrorSimulacion("No hay compilador de C/C++ en este equipo (c++, g++ o clang++).")

    destino.mkdir(parents=True, exist_ok=True)
    origen = nucleo_arduino()
    # Copia aparte, sin el Arduino.h del AVR al lado (Stream.cpp hace #include "Arduino.h").
    nucleo = TOOLS / "simulador" / "nucleo-arduino" / hashlib.sha256(str(origen).encode()).hexdigest()[:12]
    if not all((nucleo / n).is_file() for n in DEL_NUCLEO_ARDUINO if (origen / n).is_file()):
        nucleo.mkdir(parents=True, exist_ok=True)
        for n in DEL_NUCLEO_ARDUINO:
            if (origen / n).is_file():
                shutil.copy2(origen / n, nucleo / n)
    sk = destino / "sketch"
    sk.mkdir(exist_ok=True)
    for f in sketch_dir.iterdir():
        if f.suffix in CABECERAS + FUENTES:
            shutil.copy(f, sk / f.name)
    # secretos.h no está en el repositorio: para simular basta la plantilla.
    if not (sk / "secretos.h").exists() and (sketch_dir / "secretos.ejemplo.h").exists():
        shutil.copy(sketch_dir / "secretos.ejemplo.h", sk / "secretos.h")
    # Como el IDE de Arduino: todos los .ino de la carpeta forman un solo programa.
    unido = "".join(f'#line 1 "{i.name}"\n' + i.read_text(encoding="utf-8") + "\n" for i in inos)
    (sk / "sketch.cpp").write_text('#include "Arduino.h"\n' + unido, encoding="utf-8")

    base = ["-I", str(NUCLEO), "-I", str(nucleo), "-I", str(sk)]
    propias = [sk / "sketch.cpp", *[p for p in sk.iterdir() if p.suffix in FUENTES and p.name != "sketch.cpp"]]
    bibliotecas, problemas = resolver(propias, base, ps.flags, cxx, cc)
    if problemas:
        raise ErrorSimulacion("No se puede simular:\n  · " + "\n  · ".join(problemas))
    todas = {b.nombre: b for b in bibliotecas}
    def opciones(f: Path) -> list[str]:
        # Cada archivo ve solo lo que incluye: así su objeto en caché sirve para otros sketches.
        duena = next((b for b in bibliotecas if f.is_relative_to(b.raiz)), None)
        if duena is not None:
            visibles = _alcance(duena, todas)
        elif f.is_relative_to(sk):
            visibles = sorted(bibliotecas, key=lambda x: x.nombre)
        else:
            visibles = []                      # núcleo del simulador, modelos, String/Print/Stream
        # La carpeta del sketch (temporal) solo para el sketch: si no, ningún objeto se reutilizaría.
        rutas = base if f.is_relative_to(sk) else ["-I", str(NUCLEO), "-I", str(nucleo)]
        return ["-O1", "-w", "-fno-strict-aliasing", *ps.flags, *rutas,
                *[x for b in visibles for d in b.incluir for x in ("-I", str(d))]]
    # El orden importa: los objetos globales se construyen en el orden de enlace, y en la placa
    # el núcleo (Serial, Wire…) existe antes que los del sketch (PZEM004Tv30 pzem(Serial2) abre
    # el puerto en su constructor).
    fuentes = [NUCLEO / "sim.cpp", *sorted(MODELOS.glob("*.cpp")),
               *[nucleo / n for n in DEL_NUCLEO_ARDUINO if n.endswith(".cpp") and (nucleo / n).is_file()],
               *[f for b in bibliotecas for f in b.fuentes],
               sk / "sketch.cpp", *[p for p in sk.iterdir() if p.suffix in FUENTES and p.name != "sketch.cpp"]]
    # Si cambia el simulador (sus cabeceras, sus modelos), ningún objeto viejo sirve.
    firma = hashlib.sha256("".join(f"{q}{q.stat().st_mtime_ns}" for q in sorted(SIMULADOR.rglob("*"))
                                   if q.is_file()).encode()).hexdigest()
    objetos = []
    for f in fuentes:
        # Un objeto por fuente, en caché: las bibliotecas no se recompilan en cada simulación.
        es_c = f.suffix == ".c"
        orden = [cc, "-std=gnu11"] if es_c else [cxx, "-std=gnu++17"]
        comunes = opciones(f)
        clave = hashlib.sha256(json.dumps([str(f), f.stat().st_mtime_ns, orden, comunes, firma]).encode()).hexdigest()[:20]
        obj = (destino if f.is_relative_to(destino) else TOOLS / "simulador" / "obj") / f"{f.stem}-{clave}.o"
        obj.parent.mkdir(parents=True, exist_ok=True)
        if not obj.is_file():
            r = subprocess.run([*orden, *comunes, "-c", str(f), "-o", str(obj)], capture_output=True, text=True)
            if r.returncode != 0:
                quien = next((f"la biblioteca «{b.nombre}»" for b in bibliotecas if f.is_relative_to(b.raiz)), None) \
                    or ("el núcleo del simulador" if f.is_relative_to(SIMULADOR) or f.is_relative_to(nucleo) else "el sketch")
                errores = [l.replace(str(destino) + os.sep, "").replace(str(RAIZ) + os.sep, "")
                           for l in r.stderr.splitlines() if "error" in l]
                raise ErrorSimulacion(f"{quien} no compila en el simulador ({ps.nombre}):\n"
                                      + "\n".join((errores or r.stderr.splitlines())[:15]))
        objetos.append(str(obj))
    exe = destino / ("placa.exe" if os.name == "nt" else "placa")
    r = subprocess.run([cxx, *objetos, "-o", str(exe)], capture_output=True, text=True)
    if r.returncode != 0:
        faltan = sorted(set(re.findall(r"\"?([A-Za-z_][\w:~<>, ]*\(?[^\"\n]*)\"?, referenced from", r.stderr)))
        raise ErrorSimulacion("No enlaza (algo que la biblioteca espera de la placa y el simulador no tiene):\n"
                              + "\n".join((faltan or [l for l in r.stderr.splitlines() if "undefined" in l.lower()]
                                           or r.stderr.splitlines())[:12]))
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


def preparar_aire(aire: Path, nombre: str) -> None:
    """Quita del aire lo que transmitió este mismo nodo en una simulación anterior."""
    if aire.is_file():
        lineas = aire.read_text(encoding="utf-8").splitlines()
        aire.write_text("".join(l + "\n" for l in lineas if l.split(" ", 1)[0] != nombre), encoding="utf-8")
    else:
        aire.parent.mkdir(parents=True, exist_ok=True)
        aire.touch()


def ejecutar(exe: Path, escenario: Path, duracion_s: float, inicio_ms: int,
             al_publicar: Optional[Callable[[Mensaje], None]] = None,
             al_serie: Optional[Callable[[str], None]] = None, limite_s: float = 120,
             conexiones: Optional[list[str]] = None, aire: Optional[Path] = None,
             nombre: str = "placa", reloj_placa: Optional[list[float]] = None) -> Resultado:
    """conexiones: «MAX31865 cs=10»… (se suman a las «#@ conectar» del escenario).
    aire: archivo compartido por los nodos LoRa simulados (ver modelos/sx127x.cpp).
    reloj_placa: [s] que se actualiza con la hora simulada de cada línea de la consola."""
    nombre = re.sub(r"\s+", "_", nombre) or "placa"
    env = dict(os.environ, SIM_ESCENARIO=str(escenario.resolve()), SIM_DURACION_S=str(duracion_s),
               SIM_INICIO_MS=str(inicio_ms), SIM_NOMBRE=nombre,
               SIM_CONEXIONES="\n".join("conectar " + c for c in conexiones or []))
    if aire is not None:
        preparar_aire(aire, nombre)
        env["SIM_AIRE"] = str(aire.resolve())
    mensajes, serie, notas, t_fin = [], [], [], 0.0
    hora = reloj_placa if reloj_placa is not None else [0.0]
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
                elif linea.startswith("@@L "):
                    _, t_us, *resto = linea.split(" ", 2)
                    hora[0] = int(t_us) / 1e6
                    linea = resto[0] if resto else ""
                    serie.append(linea)
                    if al_serie:
                        al_serie(linea)
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


def _pasarela(proyecto: Path, estaciones: list[str], inicio_ms: int, hora: list[float],
              mensajes: list[Mensaje], al_mensaje: Callable[[Mensaje], None], callado: bool):
    """La pasarela de texto libre, con la hora simulada de cada línea."""
    from .lector_texto import LectorTexto
    from .pasarela_serie import Pasarela
    from .proyecto import ProyectoInvalido, cargar_archivo
    try:
        datos = cargar_archivo(proyecto).datos
    except ProyectoInvalido as e:
        raise ErrorSimulacion("Proyecto no válido:\n  " + "\n  ".join(e.problemas)) from e
    por_id = {e["id"]: e for e in datos["estaciones"]}
    if not estaciones:
        raise ErrorSimulacion("--pasarela necesita al menos una --estacion")
    faltan = [e for e in estaciones if e not in por_id]
    if faltan:
        raise ErrorSimulacion(f"{', '.join(faltan)} no está en {proyecto}")
    try:
        lectores = [LectorTexto(por_id[e]) for e in estaciones]
    except ValueError as e:
        raise ErrorSimulacion(str(e)) from e

    def publicar(topico: str, carga: bytes) -> None:
        m = Mensaje(hora[0], topico, carga.decode("utf-8"))
        m.problemas = validar(topico, m.carga)
        mensajes.append(m)
        al_mensaje(m)

    def salida(texto: str) -> None:
        if not callado and not texto.startswith("placa: "):
            print(f"        pasarela: {texto}")

    return Pasarela(estaciones, publicar, None, salida=salida, lectores=lectores,
                    reloj=lambda: inicio_ms / 1000 + hora[0])


def principal(argv: Optional[list[str]] = None) -> int:
    ap = argparse.ArgumentParser(description="Simula un sketch de ESP32/Arduino en el PC con sensores de un escenario.")
    ap.add_argument("sketch", type=Path, help="carpeta del sketch (la que tiene el .ino)")
    ap.add_argument("--escenario", type=Path, required=True, help="CSV con t_s y las señales")
    ap.add_argument("--duracion", type=float, default=300, help="segundos de tiempo simulado (300)")
    ap.add_argument("--placa", default="esp32-devkit", help="id de server/placas.json (esp32-devkit)")
    ap.add_argument("--enviar", action="store_true", help="publicar en el broker como la estación")
    ap.add_argument("--broker", default="127.0.0.1")
    ap.add_argument("--broker-puerto", type=int, default=1883)
    ap.add_argument("--env", type=Path, default=Path(__file__).resolve().parents[2] / ".env")
    ap.add_argument("--json", action="store_true", help="resumen en JSON (para la app)")
    ap.add_argument("--conectar", action="append", default=[], metavar="'MODELO clave=valor…'",
                    help="dispositivo SPI o serie, como «#@ conectar» en el escenario (se puede repetir)")
    ap.add_argument("--aire", type=Path, help="archivo del «aire» LoRa compartido entre nodos simulados")
    ap.add_argument("--pasarela", type=Path, metavar="PROYECTO.json",
                    help="pasar la consola por la pasarela de texto libre (como pasarela_serie --proyecto)")
    ap.add_argument("--estacion", action="append", default=[], help="estación de --pasarela (se puede repetir)")
    a = ap.parse_args(argv)

    # La simulación termina «ahora»: los datos quedan en el pasado reciente y Grafana los muestra.
    inicio_ms = int(time.time() * 1000 - a.duracion * 1000)
    clientes: dict = {}          # una sesión del broker por estación, con su contraseña
    enviados = 0

    def publicar(m: Mensaje) -> None:
        nonlocal enviados
        if not a.enviar:
            return
        est = TOPICO.match(m.topico)
        if not est:
            return
        cliente = clientes.get(est.group(1))
        if cliente is None:
            from .pasarela_serie import MqttMinimo, leer_env
            env = leer_env(a.env)
            clave = env.get(f"MQTT_{est.group(1).replace('-', '_')}_PASSWORD")
            if not clave:
                raise ErrorSimulacion(f"No hay contraseña MQTT para {est.group(1)} en {a.env}: ¿está dada de alta en un proyecto?")
            cliente = clientes[est.group(1)] = MqttMinimo(a.broker, a.broker_puerto, est.group(1), clave)
            cliente.conectar()
        cliente.publicar(m.topico, m.carga.encode("utf-8"))
        enviados += 1

    def mostrar(m: Mensaje) -> None:
        if not a.json:
            marca = "✓" if not m.problemas else "✗ " + "; ".join(m.problemas[:2])
            print(f"[{m.t_s:8.1f} s] {m.topico}  {marca}")
        publicar(m)

    hora = [0.0]
    de_pasarela: list[Mensaje] = []
    pasarela = None
    al_serie = None if a.json else (lambda l: print(f"           placa: {l}"))
    try:
        if a.pasarela:
            pasarela = _pasarela(a.pasarela, a.estacion, inicio_ms, hora, de_pasarela, mostrar, a.json)
            def al_serie(l: str, eco=al_serie) -> None:
                if eco:
                    eco(l)
                pasarela.linea(l)
        with tempfile.TemporaryDirectory(prefix="sim-placa-") as tmp:
            exe = compilar(a.sketch, Path(tmp), placa=a.placa)
            r = ejecutar(exe, a.escenario, a.duracion, inicio_ms, mostrar, al_serie,
                         conexiones=a.conectar, aire=a.aire, nombre=a.sketch.resolve().name, reloj_placa=hora)
            r.mensajes.extend(de_pasarela)
    except ErrorSimulacion as e:
        if a.json:
            print(json.dumps({"error": str(e)}, ensure_ascii=False))
        else:
            print(f"✗ {e}", file=sys.stderr)
        return 1
    finally:
        for c in clientes.values():
            c.cerrar()
    res = r.resumen() | {"enviados": enviados}
    if pasarela is not None:
        res["rechazados_por_la_pasarela"] = pasarela.rechazados
        res["con_problemas"] += pasarela.rechazados
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
