"""
Lector de texto libre: líneas que imprime cualquier placa → mensaje de medidas.

Muchas placas ya funcionan y no conviene tocar su firmware: imprimen
«t=24.31 mA=12.70», «Temp: 24.3, Hum: 60» o «AGUA,19.5,3.2,7.1» (lo que llega
por un receptor LoRa). En vez de pedir que armen nuestro JSON, el proyecto.json
dice, por sensor, dónde está su valor en la línea:

    "lectura": {"campo": "t"}                 clave=valor o clave: valor (sin mayúsculas/minúsculas)
    "lectura": {"columna": 1}                 posición tras separar por coma, punto y coma o tabulador
                                              (o espacios si no hay ninguno); empieza en 0
    "lectura": {"campo": "t", "sin_lectura": [-127, 85]}
                                              valores que el FABRICANTE usa para «no leí» (DS18B20
                                              desconectado = -127, recién encendido = 85). Se envían
                                              como null con el motivo. Los declara el proyecto,
                                              porque -127 mV es un redox válido.

Y la estación, si la línea trae un prefijo que dice de quién es (varias
estaciones por un mismo receptor):

    "comunicacion": {"protocolo": "lora", "periodo_s": 60, "prefijo": "AGUA"}

Nada se inventa: un valor que no viene, no es número o es NaN va como null con
su motivo. Una línea en la que no aparece ningún sensor de la estación se
ignora (mensajes de arranque, depuración). Los valores se envían tal cual, en
la unidad que declara el proyecto: convertir o calibrar es cosa del firmware
o del ingeniero, no de la pasarela.

La hora es la del PC al recibir la línea (time_quality NTP si el PC lo está):
el USB y la radio retrasan, así que sirve para sensores lentos, no para
sincronizar acelerómetros.
"""

from __future__ import annotations

import math
import re
from datetime import datetime, timezone
from typing import Any, Optional

from .contrato_medidas import CENTINELAS

PAR = re.compile(r"([A-Za-z_][\w.%/+-]*)\s*[=:]\s*([^\s,;]+)")
SEPARADORES = re.compile(r"[,;\t]")


def hora_rfc3339(t: float) -> str:
    return datetime.fromtimestamp(t, timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.") + f"{int(t * 1000) % 1000:03d}Z"


def problemas_de_lectura(lectura: Any) -> list[str]:
    """Para proyecto.py: la forma de «lectura» de un sensor."""
    if not isinstance(lectura, dict):
        return ["«lectura» debe ser un objeto con «campo» o «columna»"]
    p = []
    campo, columna = lectura.get("campo"), lectura.get("columna")
    if (campo is None) == (columna is None):
        p.append("«lectura» lleva «campo» (texto) o «columna» (entero ≥ 0), uno de los dos")
    if campo is not None and not (isinstance(campo, str) and re.fullmatch(r"[A-Za-z_][\w.%/+-]*", campo)):
        p.append("«lectura.campo» debe ser un nombre como «t», «temp» o «mA»")
    if columna is not None and (not isinstance(columna, int) or isinstance(columna, bool) or columna < 0):
        p.append("«lectura.columna» debe ser un entero ≥ 0")
    sin = lectura.get("sin_lectura", [])
    if not isinstance(sin, list) or not all(isinstance(x, (int, float)) and not isinstance(x, bool) for x in sin):
        p.append("«lectura.sin_lectura» debe ser una lista de números")
    otras = set(lectura) - {"campo", "columna", "sin_lectura"}
    if otras:
        p.append(f"«lectura» no admite {sorted(otras)}")
    return p


class LectorTexto:
    def __init__(self, estacion: dict):
        self.id = estacion["id"]
        self.prefijo: Optional[str] = (estacion.get("comunicacion") or {}).get("prefijo")
        self.firmware = (estacion.get("hardware") or {}).get("firmware_version") or "desconocido"
        self.sensores = [s for s in estacion.get("sensores", []) if isinstance(s.get("lectura"), dict)]
        if not self.sensores:
            raise ValueError(f"la estación {self.id} no tiene sensores con «lectura» en el proyecto")

    def acepta(self, linea: str) -> bool:
        if self.prefijo is None:
            return True
        t = linea.strip()
        return t.startswith(self.prefijo) and (len(t) == len(self.prefijo) or not t[len(self.prefijo)].isalnum())

    def _cuerpo(self, linea: str) -> str:
        t = linea.strip()
        if self.prefijo and t.startswith(self.prefijo):
            t = t[len(self.prefijo):]
        return t

    def medida(self, linea: str, t: float) -> Optional[dict]:
        """Mensaje del contrato de medidas, o None si la línea no trae nada de esta estación."""
        if not self.acepta(linea):
            return None
        cuerpo = self._cuerpo(linea)
        pares = {k.lower(): v for k, v in PAR.findall(cuerpo)}
        texto_columnas = cuerpo.strip().lstrip(",;\t ")
        columnas = [c.strip() for c in (SEPARADORES.split(texto_columnas) if SEPARADORES.search(texto_columnas)
                                         else texto_columnas.split())]
        medidas, alguno = [], False
        for s in self.sensores:
            lec = s["lectura"]
            if "campo" in lec:
                crudo = pares.get(lec["campo"].lower())
                donde = f"«{lec['campo']}»"
            else:
                crudo = columnas[lec["columna"]] if lec["columna"] < len(columnas) and columnas[lec["columna"]] else None
                donde = f"la columna {lec['columna']}"
            m: dict[str, Any] = {"sensor_id": s["id"], "quantity": s["magnitud"], "unit": s["unidad"], "value": None}
            if crudo is None:
                m["error"] = f"la línea no trae {donde}"
            else:
                alguno = True
                try:
                    v = float(crudo)
                except ValueError:
                    m["error"] = f"{donde} = «{crudo[:20]}» no es un número"
                else:
                    if math.isnan(v) or math.isinf(v):
                        m["error"] = f"la placa envió {crudo} en {donde} (el sensor no leyó)"
                    elif v in [float(x) for x in lec.get("sin_lectura", [])]:
                        m["error"] = f"{crudo} es el valor de «sin lectura» de {s.get('modelo', 'el sensor')}"
                    elif v in CENTINELAS:
                        # El contrato rechaza el mensaje entero; aquí solo se pierde este sensor.
                        m["error"] = f"{crudo} es un valor de «sin lectura» (centinela), no una medida"
                    else:
                        m["value"] = v
            medidas.append(m)
        if not alguno:
            return None
        return {
            "schema_version": "1.0",
            "station_id": self.id,
            "timestamp_utc": hora_rfc3339(t),
            "time_quality": "NTP",
            "firmware_version": self.firmware,
            "measurements": medidas,
        }
