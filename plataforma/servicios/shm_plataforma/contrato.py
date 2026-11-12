"""
Contrato de datos estación → servidor.

Es la misma regla que `src/shm/data-contract.ts` (la que usa la aplicación y
la que cumple el firmware de `firmware/shm-station`). Las dos implementaciones
se prueban contra los mismos casos: `plataforma/contrato/casos.json`.

Solo biblioteca estándar, para que se pruebe en cualquier Python ≥ 3.9 sin
instalar nada.
"""

from __future__ import annotations

import json
import re
from typing import Any

STATION_STATES = (
    "NORMAL", "DATA_GAP", "SENSOR_FAULT", "SATURATED", "TIME_HOLDOVER",
    "TIME_INVALID", "STORAGE_FAULT", "POWER_LOW", "COMM_LOST", "EVENT_CAPTURE",
)

# GNSS_LOCKED y HOLDOVER vienen del diseño. INVALID se añadió por
# correspondencia con TIME_INVALID y sigue pendiente de confirmar con ingeniería.
TIME_QUALITIES = ("GNSS_LOCKED", "HOLDOVER", "INVALID")

REQUIRED = (
    "schema_version", "station_id", "sensor_id", "timestamp_utc", "time_quality",
    "sample_rate_hz", "axes", "units", "filter_id", "firmware_version",
    "samples_file", "samples_crc32", "health",
)

# Versiones del esquema que el servidor acepta.
SCHEMA_VERSIONS = ("1.0",)

DIAGNOSTIC_WORDS = re.compile(r"\b(dano|danio|daño|damage|inseguro|unsafe|colapso|collapse)\b", re.IGNORECASE)
RFC3339 = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$")
CRC32_HEX = re.compile(r"^[0-9a-fA-F]{8}$")
STATION_ID = re.compile(r"^[A-Z0-9][A-Z0-9-]{1,31}$")


def _js_empty(v: Any) -> bool:
    return v is None or v == ""


def validate_station_record(r: Any) -> list[str]:
    """Devuelve la lista de problemas; vacía si el registro cumple el contrato."""
    if not isinstance(r, dict):
        return ["El registro no es un objeto JSON."]
    problems: list[str] = []

    for key in REQUIRED:
        if key not in r or _js_empty(r[key]):
            problems.append(f"Falta el campo obligatorio «{key}».")

    ts = r.get("timestamp_utc")
    if isinstance(ts, str) and not RFC3339.match(ts):
        problems.append("«timestamp_utc» no está en RFC 3339.")
    if "received_utc" in r:
        rec = r["received_utc"]
        if not isinstance(rec, str) or not RFC3339.match(rec):
            problems.append("«received_utc» no está en RFC 3339.")
        elif rec == ts:
            problems.append(
                "La hora de recepción coincide exactamente con la de muestreo: "
                "la retransmisión no debe cambiar la marca original (§8)."
            )

    tq = r.get("time_quality")
    if isinstance(tq, str) and tq not in TIME_QUALITIES:
        problems.append(f"«time_quality» desconocida: {tq}.")
    health = r.get("health")
    if tq == "GNSS_LOCKED" and isinstance(health, dict) and health.get("pps_locked") is False:
        problems.append("Se declara GNSS_LOCKED con el PPS sin enganchar.")

    sr = r.get("sample_rate_hz")
    if isinstance(sr, bool) or not isinstance(sr, (int, float)) or not sr > 0:
        problems.append("«sample_rate_hz» debe ser un número positivo.")
    axes = r.get("axes")
    if isinstance(axes, list) and len(axes) != 3:
        problems.append("El registro crudo exige tres ejes sincronizados (§8).")
    crc = r.get("samples_crc32")
    if isinstance(crc, str) and not CRC32_HEX.match(crc):
        problems.append("«samples_crc32» debe ser un CRC-32 en hexadecimal (8 cifras).")

    if "states" in r:
        states = r["states"]
        if not isinstance(states, list):
            problems.append("«states» debe ser una lista.")
        else:
            for s in states:
                if str(s) not in STATION_STATES:
                    problems.append(f"Estado desconocido: {s}.")
            if "NORMAL" in states and len(states) > 1:
                problems.append("NORMAL no puede convivir con otro estado.")

    if DIAGNOSTIC_WORDS.search(json.dumps(r, ensure_ascii=False)):
        problems.append(
            "El registro contiene un diagnóstico estructural; el firmware no etiqueta daño ni seguridad (§7)."
        )
    return problems


def validate_for_server(r: Any) -> list[str]:
    """El contrato más las reglas propias del servidor (versión e identificador)."""
    problems = validate_station_record(r)
    if not isinstance(r, dict):
        return problems
    sv = r.get("schema_version")
    if isinstance(sv, str) and sv and sv not in SCHEMA_VERSIONS:
        problems.append(f"Versión de esquema no admitida: {sv} (admitidas: {', '.join(SCHEMA_VERSIONS)}).")
    sid = r.get("station_id")
    if isinstance(sid, str) and sid and not STATION_ID.match(sid):
        problems.append("«station_id» solo admite mayúsculas, cifras y guiones (2–32 caracteres).")
    return problems
