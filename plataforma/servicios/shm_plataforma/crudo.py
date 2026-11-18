"""
Lector del archivo crudo de ventana «SHMW» v1 (firmware/shm-station/FORMATO_BIN.md).

PROPUESTA pendiente de validación por ingeniería. Solo biblioteca estándar.
`leer` nunca «arregla» un archivo: si algo no cuadra lo dice y no devuelve datos.
"""

from __future__ import annotations

import math
import struct
import zlib
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

MAGIC = b"SHMW"
VERSIONES = (1,)
CABECERA_V1 = 160
CALIDAD_TIEMPO = {0: "GNSS_LOCKED", 1: "TIME_HOLDOVER", 2: "TIME_INVALID"}
FLOAT32 = 1

# offset 8..47 en un solo struct; los textos se leen aparte.
_FIJO = struct.Struct("<BBBBIqIIIIII")


class CrudoInvalido(ValueError):
    pass


@dataclass
class Ventana:
    version: int
    station_id: str
    sensor_id: str
    firmware_version: str
    filter_id: str
    secuencia: int
    inicio_utc_ms: int
    calidad_tiempo: str
    muestreo_hz: float
    rango_g: int
    ejes: int
    muestras: int
    huecos: int
    saturadas: int
    data_crc32: str
    sensor_ok: bool
    pps_locked: bool
    datos: list[tuple[float, ...]] = field(repr=False, default_factory=list)

    @property
    def inicio_rfc3339(self) -> str:
        dt = datetime.fromtimestamp(self.inicio_utc_ms / 1000, tz=timezone.utc)
        return dt.strftime("%Y-%m-%dT%H:%M:%S.") + f"{self.inicio_utc_ms % 1000:03d}Z"

    def huecos_en_datos(self) -> int:
        return sum(1 for m in self.datos if all(math.isnan(v) for v in m))


def _texto(b: bytes) -> str:
    return b.split(b"\0", 1)[0].decode("ascii", errors="replace")


def crc32(b: bytes) -> str:
    return f"{zlib.crc32(b) & 0xFFFFFFFF:08x}"


def leer(contenido: bytes, *, con_datos: bool = True) -> Ventana:
    if len(contenido) < 8 or contenido[:4] != MAGIC:
        raise CrudoInvalido("No es un archivo SHMW (firma incorrecta).")
    version, cab = struct.unpack_from("<HH", contenido, 4)
    if version not in VERSIONES:
        raise CrudoInvalido(f"Versión SHMW {version} no admitida (admitidas: {VERSIONES}).")
    if cab < CABECERA_V1 or len(contenido) < cab:
        raise CrudoInvalido("Cabecera incompleta: el archivo quedó a medias.")
    declarado = struct.unpack_from("<I", contenido, 156)[0]
    if zlib.crc32(contenido[:156]) & 0xFFFFFFFF != declarado:
        raise CrudoInvalido("El CRC de la cabecera no coincide: cabecera dañada.")

    (ejes, tipo, tq, rango, mhz, inicio, sec, n, huecos, sat, dcrc, flags) = _FIJO.unpack_from(contenido, 8)
    if tipo != FLOAT32:
        raise CrudoInvalido(f"Tipo de muestra {tipo} desconocido.")
    if tq not in CALIDAD_TIEMPO:
        raise CrudoInvalido(f"Calidad de tiempo {tq} desconocida.")
    esperado = cab + n * ejes * 4
    if len(contenido) != esperado:
        raise CrudoInvalido(
            f"Tamaño {len(contenido)} B, se esperaban {esperado} B: archivo incompleto (corte de energía) o alterado.")
    datos_b = contenido[cab:]
    if zlib.crc32(datos_b) & 0xFFFFFFFF != dcrc:
        raise CrudoInvalido("El CRC de los datos no coincide: muestras dañadas.")

    datos: list[tuple[float, ...]] = []
    if con_datos:
        valores = struct.unpack(f"<{n * ejes}f", datos_b)
        datos = [valores[i:i + ejes] for i in range(0, len(valores), ejes)]
    return Ventana(
        version=version, station_id=_texto(contenido[48:80]), sensor_id=_texto(contenido[80:112]),
        firmware_version=_texto(contenido[112:128]), filter_id=_texto(contenido[128:152]),
        secuencia=sec, inicio_utc_ms=inicio, calidad_tiempo=CALIDAD_TIEMPO[tq], muestreo_hz=mhz / 1000,
        rango_g=rango, ejes=ejes, muestras=n, huecos=huecos, saturadas=sat, data_crc32=f"{dcrc:08x}",
        sensor_ok=bool(flags & 1), pps_locked=bool(flags & 2), datos=datos,
    )


def contrastar(v: Ventana, registro: dict[str, Any]) -> list[str]:
    """Lo que no cuadra entre el archivo y su registro JSON (vacío si cuadra)."""
    out: list[str] = []
    pares = [
        ("station_id", v.station_id), ("sensor_id", v.sensor_id), ("samples_crc32", v.data_crc32),
        ("timestamp_utc", v.inicio_rfc3339), ("time_quality", v.calidad_tiempo),
        ("sample_rate_hz", v.muestreo_hz), ("range_g", v.rango_g),
        ("firmware_version", v.firmware_version), ("filter_id", v.filter_id),
    ]
    for campo, valor in pares:
        r = registro.get(campo)
        if campo == "samples_crc32" and isinstance(r, str):
            r = r.lower()
        if r != valor:
            out.append(f"«{campo}»: el registro dice {r!r} y el archivo {valor!r}.")
    for campo, valor in (("samples", v.muestras), ("gaps", v.huecos), ("saturated", v.saturadas)):
        if campo in registro and registro[campo] != valor:
            out.append(f"«{campo}»: el registro dice {registro[campo]!r} y el archivo {valor!r}.")
    return out
