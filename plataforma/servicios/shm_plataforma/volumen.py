"""
Volumen de datos por estación y por red (ARQUITECTURA.md §6).

Todo sale de supuestos escritos aquí, no de mediciones. Cambiar un supuesto
cambia la tabla; `python -m shm_plataforma.volumen` la vuelve a imprimir.

Supuestos:
  - 3 ejes de aceleración, adquisición continua.
  - Formato crudo «int24»: el ADXL355 entrega 20 bits por eje en 3 bytes
    (adxl355_regs.h; mapa de registros AÚN SIN COTEJAR con la hoja de datos).
  - Formato crudo «float32»: lo que guarda hoy el firmware (4 bytes por eje).
  - Cabecera por bloque de 10 s: 256 bytes (hora, calidad de hora, CRC,
    configuración). Valor de diseño, no medido.
  - Factor de margen de la tarjeta (sistema de archivos, desgaste, rotación):
    2,0, el mismo que usa diseno_tecnico.md §10.
  - Registro resumido: el JSON que emite hoy el firmware, ~700 bytes cada 10 s,
    más ~30 % de sobrecarga MQTT/TLS/TCP (estimación, no medida).
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass

AXES = 3
BLOCK_S = 10
HEADER_BYTES = 256
CARD_MARGIN = 2.0
SUMMARY_BYTES = 700
SUMMARY_PERIOD_S = 10
PROTOCOL_OVERHEAD = 1.30

FORMATS = {"int24": 3, "float32": 4}
RATES_HZ = (100, 200, 500, 1000)

GB = 1e9
MB = 1e6


@dataclass
class Volumen:
    rate_hz: int
    formato: str
    bytes_s: float
    mb_h: float
    gb_dia: float
    gb_mes: float          # 30 días
    kbit_s: float          # ancho de banda para subir TODO el crudo en continuo
    tarjeta_7d_gb: float   # anillo local de 7 días con margen


def crudo(rate_hz: int, formato: str = "int24") -> Volumen:
    per_sample = AXES * FORMATS[formato]
    bytes_s = rate_hz * per_sample + HEADER_BYTES / BLOCK_S
    return Volumen(
        rate_hz=rate_hz,
        formato=formato,
        bytes_s=bytes_s,
        mb_h=bytes_s * 3600 / MB,
        gb_dia=bytes_s * 86400 / GB,
        gb_mes=bytes_s * 86400 * 30 / GB,
        kbit_s=bytes_s * 8 / 1000,
        tarjeta_7d_gb=bytes_s * 86400 * 7 * CARD_MARGIN / GB,
    )


def resumen_mb_mes() -> float:
    return SUMMARY_BYTES * PROTOCOL_OVERHEAD * (86400 / SUMMARY_PERIOD_S) * 30 / MB


def tabla(formato: str) -> str:
    filas = [
        f"| Muestreo | B/s | MB/h | GB/día | GB/mes | kbit/s continuo | microSD 7 días ×{CARD_MARGIN:g} |",
        "|---:|---:|---:|---:|---:|---:|---:|",
    ]
    for hz in RATES_HZ:
        v = crudo(hz, formato)
        filas.append(
            f"| {hz} Hz | {v.bytes_s:,.0f} | {v.mb_h:,.1f} | {v.gb_dia:,.2f} | {v.gb_mes:,.1f} | {v.kbit_s:,.1f} | {v.tarjeta_7d_gb:,.1f} GB |"
        )
    return "\n".join(filas)


def tabla_red(formato: str, estaciones=(4, 10, 20)) -> str:
    filas = ["| Muestreo | " + " | ".join(f"{n} est. GB/mes" for n in estaciones) + " |",
             "|---:|" + "---:|" * len(estaciones)]
    for hz in RATES_HZ:
        v = crudo(hz, formato)
        filas.append(f"| {hz} Hz | " + " | ".join(f"{v.gb_mes * n:,.0f}" for n in estaciones) + " |")
    return "\n".join(filas)


def main() -> None:
    ap = argparse.ArgumentParser(description="Volumen de datos de la red SHM")
    ap.add_argument("--formato", choices=sorted(FORMATS), default="int24")
    a = ap.parse_args()
    print(f"## Crudo por estación ({a.formato})\n")
    print(tabla(a.formato))
    print(f"\n## Crudo de la red ({a.formato})\n")
    print(tabla_red(a.formato))
    print(f"\n## Resumen por estación\n\n{resumen_mb_mes():.1f} MB/mes por MQTT, independiente de la frecuencia de muestreo.")


if __name__ == "__main__":
    main()
