"""
Extrae las ventanas de una microSD de estación (anillo «SHMRING1», ver
firmware/shm-station/include/sdring.h) a archivos SHMW sueltos:

    python -m shm_plataforma.tarjeta imagen.img --salida carpeta/

Deja carpeta/SHM/<estación>/<AAAAMMDD|SINHORA>/<secuencia>.bin y dice qué
ranuras estaban dañadas. Lee una IMAGEN de la tarjeta: copiarla del lector
(dd, Win32 Disk Imager…) suele pedir permisos de administrador; esta
herramienta no los pide ni escribe nunca en la tarjeta.

Solo biblioteca estándar. PROPUESTA pendiente de validación por ingeniería.
"""

from __future__ import annotations

import argparse
import struct
import sys
import zlib
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import BinaryIO

from .crudo import CABECERA_V1, MAGIC, CrudoInvalido, leer

BLOQUE = 512
RANURA_BLOQUES = 48
PRIMERA_LBA = 2048
MAGIC_ANILLO = b"SHMRING1"


class TarjetaInvalida(ValueError):
    pass


@dataclass
class Informe:
    estacion: str
    ranuras: int
    ventanas: list[tuple[int, Path]] = field(default_factory=list)
    danadas: list[tuple[int, str]] = field(default_factory=list)   # (ranura, motivo)
    vacias: int = 0


def superbloque(f: BinaryIO) -> tuple[str, int]:
    f.seek(0)
    b = f.read(BLOQUE)
    if len(b) < BLOQUE or b[:8] != MAGIC_ANILLO:
        raise TarjetaInvalida("No es una tarjeta de estación SHM (falta el superbloque SHMRING1).")
    if zlib.crc32(b[:508]) & 0xFFFFFFFF != struct.unpack_from("<I", b, 508)[0]:
        raise TarjetaInvalida("El superbloque está dañado.")
    version, bloques, primera, ranuras = struct.unpack_from("<IIII", b, 8)
    if (version, bloques, primera) != (1, RANURA_BLOQUES, PRIMERA_LBA):
        raise TarjetaInvalida(f"Versión de anillo no admitida ({version}, {bloques}, {primera}).")
    return b[24:56].split(b"\0", 1)[0].decode("ascii"), ranuras


def dia(inicio_ms: int, calidad: str) -> str:
    if calidad == "TIME_INVALID":
        return "SINHORA"
    return datetime.fromtimestamp(inicio_ms / 1000, tz=timezone.utc).strftime("%Y%m%d")


def extraer(imagen: Path, salida: Path) -> Informe:
    with imagen.open("rb") as f:
        estacion, ranuras = superbloque(f)
        inf = Informe(estacion, ranuras)
        for r in range(ranuras):
            f.seek((PRIMERA_LBA + r * RANURA_BLOQUES) * BLOQUE)
            crudo = f.read(RANURA_BLOQUES * BLOQUE)
            if len(crudo) < CABECERA_V1:
                inf.vacias += ranuras - r   # la imagen acaba aquí (zona nunca escrita)
                break
            if crudo[:4] != MAGIC:
                inf.vacias += 1
                continue
            try:
                cab, n, ejes = struct.unpack_from("<H", crudo, 6)[0], struct.unpack_from("<I", crudo, 28)[0], crudo[8]
                v = leer(crudo[: cab + n * ejes * 4], con_datos=False)
            except (CrudoInvalido, struct.error) as e:
                inf.danadas.append((r, str(e)))
                continue
            if v.station_id != estacion or v.secuencia % ranuras != r:
                inf.danadas.append((r, f"La ranura dice ser {v.station_id}/{v.secuencia}: no le corresponde."))
                continue
            destino = salida / "SHM" / estacion / dia(v.inicio_utc_ms, v.calidad_tiempo) / f"{v.secuencia:08d}.bin"
            destino.parent.mkdir(parents=True, exist_ok=True)
            destino.write_bytes(crudo[: cab + n * ejes * 4])
            inf.ventanas.append((v.secuencia, destino))
    inf.ventanas.sort()
    return inf


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Extrae las ventanas de una imagen de microSD de estación SHM.")
    ap.add_argument("imagen", type=Path)
    ap.add_argument("--salida", type=Path, required=True)
    a = ap.parse_args(argv)
    try:
        inf = extraer(a.imagen, a.salida)
    except (TarjetaInvalida, OSError) as e:
        print(f"Error: {e}", file=sys.stderr)
        return 1
    print(f"Estación {inf.estacion}: {len(inf.ventanas)} ventanas extraídas de {inf.ranuras} ranuras "
          f"({inf.vacias} sin usar, {len(inf.danadas)} dañadas).")
    if inf.ventanas:
        print(f"Secuencias {inf.ventanas[0][0]}–{inf.ventanas[-1][0]} en {a.salida / 'SHM' / inf.estacion}")
    for r, motivo in inf.danadas:
        print(f"  ranura {r}: {motivo}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
