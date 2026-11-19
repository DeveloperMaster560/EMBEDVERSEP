"""
Pasarela serie: cualquier placa conectada al PC por USB → plataforma SHM.

Corre en el PC donde está la plataforma (fuera de Docker) y publica en el
broker como la estación indicada, con su contraseña de plataforma/.env.
Acepta dos clases de líneas por el puerto serie (o por la entrada estándar):

1. **Registros completos** del contrato, solos o con el prefijo «SHM »
   (lo que imprime firmware/esp32-mpu6050 o cualquier placa que ya arme el
   JSON). Se comprueban con el mismo contrato que el servidor y se publican
   tal cual. El «station_id» debe ser el de la estación de la pasarela.

2. **Muestras sueltas**: tres números por línea (x, y, z), separados por
   coma, punto y coma, espacio o tabulador. Es lo mínimo que puede imprimir
   cualquier microcontrolador (Arduino Uno, STM32, PIC…). La pasarela arma
   las ventanas: N = Hz × 10 s muestras, CRC-32 como el formato SHMW,
   estadísticas por eje. La hora la pone el PC al llegar la primera muestra
   (por eso «time_uncertainty_us» es grande: el USB retrasa y agrupa).
   Una línea que no se puede leer cuenta como hueco (NaN), nunca como 0.

Las líneas que empiezan por «#» se muestran (mensajes de la placa) y no se envían.

Uso (desde plataforma/servicios):

    python -m shm_plataforma.pasarela_serie --estacion LAB-SERIE-01 --puerto COM5
    python -m shm_plataforma.pasarela_serie --estacion LAB-SERIE-01 --puerto /dev/cu.usbserial-0001 --hz 100 --unidad g
    otro-programa | python -m shm_plataforma.pasarela_serie --estacion LAB-SERIE-01 --puerto -

Para un puerto serie real hace falta pyserial (`py -m pip install pyserial`).
Sin dependencias para lo demás: el cliente MQTT es mínimo y va aquí.
"""

from __future__ import annotations

import argparse
import json
import math
import re
import socket
import struct
import sys
import time
import zlib
from collections import deque
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable, Iterator, Optional

from .contrato import validate_for_server
from .contrato_medidas import validate_measurement_message

G = 9.80665
VENTANA_S = 10
NUMERO = r"[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?"
MUESTRA = re.compile(rf"^\s*({NUMERO})\s*[,;\s]\s*({NUMERO})\s*[,;\s]\s*({NUMERO})\s*$")
RAIZ_PLATAFORMA = Path(__file__).resolve().parents[2]


# ---------------------------------------------------------------- MQTT mínimo

def _cadena(s: str) -> bytes:
    b = s.encode("utf-8")
    return struct.pack(">H", len(b)) + b


def _longitud(n: int) -> bytes:
    out = bytearray()
    while True:
        d, n = n % 128, n // 128
        out.append(d | (0x80 if n else 0))
        if not n:
            return bytes(out)


class MqttMinimo:
    """MQTT 3.1.1, solo CONNECT y PUBLISH con QoS 1 (espera el PUBACK)."""

    RAZONES = {1: "versión de protocolo", 2: "identificador rechazado", 3: "servidor no disponible",
               4: "usuario o contraseña incorrectos", 5: "no autorizado"}

    def __init__(self, host: str, puerto: int, usuario: str, clave: str, timeout: float = 5.0):
        self.host, self.puerto, self.usuario, self.clave, self.timeout = host, puerto, usuario, clave, timeout
        self.sock: Optional[socket.socket] = None
        self._id = 0

    def conectar(self) -> None:
        s = socket.create_connection((self.host, self.puerto), timeout=self.timeout)
        var = _cadena("MQTT") + bytes([4, 0xC2]) + struct.pack(">H", 60)   # usuario + clave + sesión limpia
        carga = _cadena(f"{self.usuario}-serie") + _cadena(self.usuario) + _cadena(self.clave)
        s.sendall(bytes([0x10]) + _longitud(len(var) + len(carga)) + var + carga)
        r = self._leer(s, 4)
        if r[0] != 0x20 or r[3] != 0:
            s.close()
            raise ConnectionError(f"el broker rechazó la conexión: {self.RAZONES.get(r[3], r[3])}")
        self.sock = s

    def _leer(self, s: socket.socket, n: int) -> bytes:
        b = b""
        while len(b) < n:
            c = s.recv(n - len(b))
            if not c:
                raise ConnectionError("el broker cerró la conexión")
            b += c
        return b

    def publicar(self, topico: str, carga: bytes) -> None:
        if self.sock is None:
            self.conectar()
        assert self.sock is not None
        self._id = self._id % 65535 + 1
        var = _cadena(topico) + struct.pack(">H", self._id)
        try:
            self.sock.sendall(bytes([0x32]) + _longitud(len(var) + len(carga)) + var + carga)
            r = self._leer(self.sock, 4)
        except OSError:
            self.cerrar()
            raise
        if r[0] != 0x40 or struct.unpack(">H", r[2:4])[0] != self._id:
            self.cerrar()
            raise ConnectionError("respuesta inesperada del broker (¿publicó fuera de su rama?)")

    def cerrar(self) -> None:
        if self.sock is not None:
            try:
                self.sock.close()
            finally:
                self.sock = None


# ------------------------------------------------------------ ventanas en PC

def hora_rfc3339(t: float) -> str:
    return datetime.fromtimestamp(t, timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _num(v: float) -> Optional[float]:
    return None if math.isnan(v) or math.isinf(v) else float(f"{v:.5g}")


class Ventanero:
    """Arma ventanas de N muestras de 3 ejes a partir de líneas de texto."""

    def __init__(self, estacion: str, sensor: str, hz: float, unidad: str, rango_g: Optional[float],
                 reloj=time.time):
        self.estacion, self.sensor, self.hz, self.rango_g = estacion, sensor, hz, rango_g
        self.factor = G if unidad == "g" else 1.0
        self.n = int(round(hz * VENTANA_S))
        self.reloj = reloj
        self.muestras: list[tuple[float, float, float]] = []
        self.inicio = 0.0
        self.siguiente: Optional[float] = None   # dónde empieza la próxima si las muestras siguen seguidas
        self.secuencia = 0

    def linea(self, texto: str) -> Optional[dict]:
        """Añade una línea de muestra (o hueco si no se lee). Devuelve el registro al completar."""
        m = MUESTRA.match(texto)
        if not self.muestras:
            if not m:
                return None            # basura antes de empezar: no abre ventana
            # Muestras seguidas: la ventana empieza donde acabó la anterior (el
            # reloj del muestreo manda). Solo se vuelve a la hora del PC si se
            # separan más de 1 s (la placa se reinició o se perdieron datos).
            ahora = self.reloj()
            seguida = self.siguiente is not None and abs(ahora - self.siguiente) < 1.0
            self.inicio = self.siguiente if seguida else ahora   # type: ignore[assignment]
        if m:
            self.muestras.append(tuple(float(x) * self.factor for x in m.groups()))   # type: ignore[arg-type]
        else:
            self.muestras.append((math.nan, math.nan, math.nan))
        if len(self.muestras) < self.n:
            return None
        r = self._registro()
        self.siguiente = self.inicio + self.n / self.hz
        self.muestras = []
        return r

    def _registro(self) -> dict:
        datos = self.muestras
        crc = zlib.crc32(b"".join(struct.pack("<3f", *m) for m in datos)) & 0xFFFFFFFF
        medidas = [m for m in datos if not any(math.isnan(v) for v in m)]
        huecos = len(datos) - len(medidas)
        lim = 0.995 * self.rango_g * G if self.rango_g else None
        saturadas = sum(1 for m in medidas if lim and any(abs(v) >= lim for v in m))
        stats: dict[str, list[Optional[float]]] = {"mean": [], "std": [], "min": [], "max": []}
        for e in range(3):
            col = [m[e] for m in medidas]
            if not col:
                for k in stats:
                    stats[k].append(None)
                continue
            media = sum(col) / len(col)
            var = max(sum(v * v for v in col) / len(col) - media * media, 0.0)
            stats["mean"].append(_num(media))
            stats["std"].append(_num(math.sqrt(var)))
            stats["min"].append(_num(min(col)))
            stats["max"].append(_num(max(col)))
        estados = (["DATA_GAP"] if huecos else []) + (["SATURATED"] if saturadas else [])
        r = {
            "schema_version": "1.0", "station_id": self.estacion, "sensor_id": self.sensor,
            "timestamp_utc": hora_rfc3339(self.inicio), "time_quality": "NTP",
            # El USB agrupa y retrasa las líneas: la hora es la de llegada, con
            # decenas de milisegundos de incertidumbre. Se declara, no se oculta.
            "time_uncertainty_us": 100000,
            "sample_rate_hz": self.hz, "axes": ["x", "y", "z"], "units": "m/s2", "range_g": self.rango_g,
            "filter_id": "desconocido-placa", "firmware_version": "pasarela-serie-0.1.0", "calibration_id": None,
            "samples_file": f"no-guardada/{self.estacion}/{self.secuencia:08d}", "samples_crc32": f"{crc:08x}",
            "states": estados or ["NORMAL"],
            "health": {"sensor_ok": True, "storage_ok": False, "pps_locked": False, "supply_v": None},
            "samples": len(datos), "gaps": huecos, "saturated": saturadas, "sequence": self.secuencia,
            "stats": stats, "gateway": "serie",
        }
        self.secuencia += 1
        return r


# ---------------------------------------------------------------- pasarela

def extraer_registro(texto: str) -> Optional[dict]:
    t = texto.strip()
    for prefijo in ("SHM ", "MEDIDA "):
        if t.startswith(prefijo):
            t = t[len(prefijo):].strip()
    if not t.startswith("{"):
        return None
    try:
        r = json.loads(t)
    except json.JSONDecodeError:
        return None
    return r if isinstance(r, dict) else None


class Pasarela:
    def __init__(self, estacion: str, publicar, ventanero: Optional[Ventanero], salida=print):
        self.estacion = estacion
        self.publicar = publicar          # (tópico, bytes) -> None; lanza si falla
        self.ventanero = ventanero
        self.salida = salida
        # (tipo, mensaje): «registro» = ventana, «medida» = sensores lentos.
        self.cola: deque[tuple[str, bytes]] = deque(maxlen=360)   # 1 h de registros si se cae el broker
        self.enviados = self.rechazados = 0

    def linea(self, texto: str) -> None:
        texto = texto.rstrip("\r\n")
        if not texto.strip():
            return
        if texto.lstrip().startswith("#"):
            self.salida(f"placa: {texto.strip()}")
            return
        r = extraer_registro(texto)
        if r is None and self.ventanero is not None:
            r = self.ventanero.linea(texto)
            if r is None:
                return
        elif r is None:
            self.salida(f"(ignorada; para muestras sueltas usa --hz) {texto[:80]}")
            return
        if "measurements" in r:
            return self._medida(r)
        problemas = validate_for_server(r)
        if r.get("station_id") != self.estacion:
            problemas.append(f"el registro es de «{r.get('station_id')}» pero la pasarela publica como «{self.estacion}»")
        if problemas:
            self.rechazados += 1
            self.salida("✗ registro no enviado: " + "; ".join(problemas))
            return
        self.cola.append(("registro", json.dumps(r, ensure_ascii=False, separators=(",", ":")).encode("utf-8")))
        st = r.get("stats", {}).get("std")
        self.salida(f"ventana {r['timestamp_utc']}  muestras {r.get('samples')}  huecos {r.get('gaps')}"
                    + (f"  desv. x/y/z {st}" if st else ""))
        self.vaciar()

    def _medida(self, r: dict) -> None:
        problemas = validate_measurement_message(r)
        if r.get("station_id") != self.estacion:
            problemas.append(f"el mensaje es de «{r.get('station_id')}» pero la pasarela publica como «{self.estacion}»")
        if problemas:
            self.rechazados += 1
            self.salida("✗ medida no enviada: " + "; ".join(problemas))
            return
        self.cola.append(("medida", json.dumps(r, ensure_ascii=False, separators=(",", ":")).encode("utf-8")))
        self.salida(f"medida {r['timestamp_utc']}  " + "  ".join(
            f"{m['quantity']} {'—' if m['value'] is None else m['value']} {m['unit']}" for m in r["measurements"]))
        self.vaciar()

    def vaciar(self) -> None:
        while self.cola:
            tipo, carga = self.cola[0]
            try:
                self.publicar(f"shm/v1/{self.estacion}/{tipo}", carga)
            except (OSError, ConnectionError) as e:
                self.salida(f"… broker no disponible ({e}); {len(self.cola)} en espera")
                return
            self.cola.popleft()
            self.enviados += 1


def leer_env(ruta: Path) -> dict[str, str]:
    valores = {}
    if ruta.exists():
        for linea in ruta.read_text(encoding="utf-8").splitlines():
            if "=" in linea and not linea.lstrip().startswith("#"):
                k, v = linea.split("=", 1)
                valores[k.strip()] = v.strip()
    return valores


def lineas_de(puerto: str, baudios: int) -> Iterator[str]:
    if puerto == "-":
        yield from sys.stdin
        return
    try:
        import serial  # type: ignore[import-not-found]
    except ImportError:
        raise SystemExit("Para leer un puerto serie hace falta pyserial:  py -m pip install pyserial")
    while True:
        try:
            with serial.Serial(puerto, baudios, timeout=1) as s:
                print(f"· Leyendo {puerto} a {baudios} baudios")
                pendiente = b""
                while True:
                    pendiente += s.read(4096)
                    *completas, pendiente = pendiente.split(b"\n")
                    for b in completas:
                        yield b.decode("utf-8", "replace")
        except serial.SerialException as e:
            print(f"… {puerto}: {e}; reintento en 3 s")
            time.sleep(3)


def principal(argv: Optional[Iterable[str]] = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--estacion", required=True, help="ID de la estación (como en proyecto.json)")
    ap.add_argument("--puerto", required=True, help="COM5, /dev/ttyUSB0, /dev/cu.usbserial-…; «-» = entrada estándar")
    ap.add_argument("--baudios", type=int, default=115200)
    ap.add_argument("--hz", type=float, help="frecuencia de las muestras sueltas (activa el modo muestras)")
    ap.add_argument("--unidad", choices=("m/s2", "g"), default="m/s2", help="unidad de las muestras sueltas")
    ap.add_argument("--rango-g", type=float, default=None, help="fondo de escala del sensor, para contar saturadas")
    ap.add_argument("--sensor", help="ID del sensor (por omisión MPU6050-<estación>)")
    ap.add_argument("--broker", default="127.0.0.1")
    ap.add_argument("--broker-puerto", type=int, default=1883)
    ap.add_argument("--env", default=str(RAIZ_PLATAFORMA / ".env"), help="archivo con las contraseñas")
    a = ap.parse_args(list(argv) if argv is not None else None)
    try:
        sys.stdout.reconfigure(errors="replace")   # consolas de Windows sin UTF-8
    except (AttributeError, ValueError):
        pass

    var = "MQTT_" + a.estacion.replace("-", "_") + "_PASSWORD"
    clave = leer_env(Path(a.env)).get(var)
    if not clave:
        print(f"No encuentro {var} en {a.env}. ¿La estación está en un proyecto.json y ejecutaste iniciar?")
        return 1
    mqtt = MqttMinimo(a.broker, a.broker_puerto, a.estacion, clave)
    ventanero = Ventanero(a.estacion, a.sensor or f"MPU6050-{a.estacion}", a.hz, a.unidad, a.rango_g) if a.hz else None
    p = Pasarela(a.estacion, mqtt.publicar, ventanero)
    print(f"· Pasarela serie → {a.broker}:{a.broker_puerto} como {a.estacion}"
          + (f"; muestras sueltas a {a.hz:g} Hz en {a.unidad}" if a.hz else "; registros completos"))
    try:
        for linea in lineas_de(a.puerto, a.baudios):
            p.linea(linea)
    except KeyboardInterrupt:
        pass
    finally:
        p.vaciar()
        mqtt.cerrar()
        print(f"· Enviados {p.enviados}, rechazados {p.rechazados}, sin enviar {len(p.cola)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(principal())
