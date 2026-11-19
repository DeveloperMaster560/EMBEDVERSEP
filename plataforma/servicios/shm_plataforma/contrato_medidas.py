"""
Contrato de MEDIDAS: sensores lentos de un valor (temperatura, humedad, luz,
humedad de suelo, distancia, gases…). Complementa al registro de ventanas
(contrato.py), que es para aceleración e inclinación en varios ejes.

Tópico: shm/v1/<estación>/medida. Un mensaje = una lectura de varios sensores
de la misma estación en el mismo instante:

    {"schema_version": "1.0", "station_id": "LAB-AMB-01",
     "timestamp_utc": "2026-11-19T14:00:00.000Z", "time_quality": "NTP",
     "firmware_version": "esp32-ambiente-0.1.0",
     "measurements": [
        {"sensor_id": "DHT22-LAB-AMB-01-T", "quantity": "temperatura", "value": 24.3, "unit": "degC"},
        {"sensor_id": "BH1750-LAB-AMB-01", "quantity": "luz", "value": null, "unit": "lux", "error": "sin respuesta"}]}

Reglas (las mismas en src/shm/medidas-contract.ts; casos compartidos en
plataforma/contrato/casos-medidas.json):
  - un sensor que no leyó envía «value»: null, nunca -999 ni 0;
  - magnitud y unidad de plataforma/servicios/shm_plataforma/magnitudes.json;
  - valores físicamente imposibles (humedad de 150 %) se rechazan: son
    límites físicos, no umbrales de alerta;
  - el firmware no diagnostica (mismas palabras prohibidas que el registro).
"""

from __future__ import annotations

import json
import math
import re
from pathlib import Path
from typing import Any

from .contrato import DIAGNOSTIC_WORDS, RFC3339, SCHEMA_VERSIONS, STATION_ID, TIME_QUALITIES

MAGNITUDES: dict[str, dict] = json.loads(
    Path(__file__).with_name("magnitudes.json").read_text(encoding="utf-8"))["magnitudes"]

SENSOR_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{1,63}$")
MAX_MEDIDAS = 64
# Valores que los programas usan para decir «no hay lectura». Disfrazados de
# número acaban en las gráficas y en los promedios como si se hubieran medido.
CENTINELAS = {-999.0, -9999.0, -99999.0, 9999.0, 99999.0}
REQUIRED = ("schema_version", "station_id", "timestamp_utc", "time_quality", "firmware_version", "measurements")


def _numero(v: Any) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def validate_measurement_message(r: Any) -> list[str]:
    """Problemas del mensaje de medidas; lista vacía si cumple el contrato."""
    if not isinstance(r, dict):
        return ["El mensaje no es un objeto JSON."]
    p: list[str] = []
    for k in REQUIRED:
        if k not in r or r[k] is None or r[k] == "":
            p.append(f"Falta el campo obligatorio «{k}».")
    sv = r.get("schema_version")
    if isinstance(sv, str) and sv and sv not in SCHEMA_VERSIONS:
        p.append(f"Versión de esquema no admitida: {sv}.")
    sid = r.get("station_id")
    if isinstance(sid, str) and sid and not STATION_ID.match(sid):
        p.append("«station_id» solo admite mayúsculas, cifras y guiones (2–32 caracteres).")
    ts = r.get("timestamp_utc")
    if isinstance(ts, str) and not RFC3339.match(ts):
        p.append("«timestamp_utc» no está en RFC 3339.")
    tq = r.get("time_quality")
    if isinstance(tq, str) and tq not in TIME_QUALITIES:
        p.append(f"«time_quality» desconocida: {tq}.")

    ms = r.get("measurements")
    if "measurements" in r and not isinstance(ms, list):
        p.append("«measurements» debe ser una lista.")
    elif isinstance(ms, list):
        if not ms:
            p.append("«measurements» está vacía.")
        if len(ms) > MAX_MEDIDAS:
            p.append(f"Demasiadas medidas en un mensaje ({len(ms)}; máximo {MAX_MEDIDAS}).")
        vistos: set[str] = set()
        for i, m in enumerate(ms[:MAX_MEDIDAS]):
            p.extend(_medida(i, m, vistos))

    if DIAGNOSTIC_WORDS.search(json.dumps(r, ensure_ascii=False)):
        p.append("El mensaje contiene un diagnóstico; el equipo mide, no diagnostica.")
    return p


def _medida(i: int, m: Any, vistos: set[str]) -> list[str]:
    if not isinstance(m, dict):
        return [f"measurements[{i}] no es un objeto."]
    p: list[str] = []
    sid = m.get("sensor_id")
    donde = f"measurements[{i}]" + (f" ({sid})" if isinstance(sid, str) else "")
    if not isinstance(sid, str) or not SENSOR_ID.match(sid):
        p.append(f"{donde}: «sensor_id» no válido.")
    elif sid in vistos:
        p.append(f"{donde}: el sensor aparece dos veces en el mismo mensaje.")
    else:
        vistos.add(sid)
    q, u = m.get("quantity"), m.get("unit")
    mag = MAGNITUDES.get(q) if isinstance(q, str) else None
    if mag is None:
        p.append(f"{donde}: magnitud desconocida «{q}».")
    elif mag["vectorial"]:
        p.append(f"{donde}: {q} se mide en varios ejes y viaja en ventanas (tópico registro), no como medida suelta.")
    elif u not in mag["unidades"]:
        p.append(f"{donde}: la unidad de {q} debe ser una de {', '.join(mag['unidades'])} (llegó «{u}»).")
    if "value" not in m:
        p.append(f"{donde}: falta «value» (null si el sensor no leyó).")
        return p
    v = m["value"]
    if v is None:
        return p
    if not _numero(v) or not math.isfinite(v):
        p.append(f"{donde}: «value» debe ser un número o null.")
        return p
    if float(v) in CENTINELAS:
        p.append(f"{donde}: {v} parece un valor de «sin lectura»; envíe null.")
    elif mag is not None and not mag["vectorial"]:
        if mag["min"] is not None and v < mag["min"]:
            p.append(f"{donde}: {v} {u} es físicamente imposible (mínimo {mag['min']}).")
        if mag["max"] is not None and v > mag["max"]:
            p.append(f"{donde}: {v} {u} es físicamente imposible (máximo {mag['max']}).")
    return p
