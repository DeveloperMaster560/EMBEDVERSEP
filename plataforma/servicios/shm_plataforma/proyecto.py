"""
Archivo de proyecto de monitoreo (`proyectos/<id>/proyecto.json`).

Cada estructura instrumentada —un puente, un edificio— es un proyecto: un
archivo que la describe completa (estructura, estaciones, sensores y criterios).
La plataforma, la app y el firmware se configuran a partir de él; ningún
proyecto queda escrito en el código.

Solo usa la biblioteca estándar: lo importa también `scripts/preparar.py`, que
corre en el equipo anfitrión sin dependencias.

Reglas de integridad que el validador hace cumplir:
  - un umbral nunca entra sin quién lo aprobó y cuándo: la plataforma no
    inventa criterios estructurales;
  - el identificador de una estación es único en TODO el servidor, porque es
    su usuario en el broker y su tópico MQTT (se comprueba al importar);
  - la unidad de cada sensor corresponde a su magnitud.
"""

from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Optional

from .contrato_medidas import MAGNITUDES

FORMATO = "embedverse-proyecto-shm/1"

RE_PROYECTO = re.compile(r"^[a-z0-9][a-z0-9-]{1,39}$")
RE_ESTACION = re.compile(r"^[A-Z0-9][A-Z0-9-]{1,31}$")
RE_SENSOR = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{1,63}$")

TIPOS_ESTRUCTURA = {"puente", "edificio", "otro"}
# SD dinámica · SS cuasiestática · SR referencia de tiempo/ambiental · GW pasarela
TIPOS_ESTACION = {"SD", "SS", "SR", "GW"}
# diseno: aún en papel · simulada: firmware sin hardware · instalada: en la estructura
ESTADOS_ESTACION = {"diseno", "simulada", "instalada", "retirada"}
# Las que la plataforma da de alta (tienen usuario en el broker).
ESTADOS_CON_ALTA = {"simulada", "instalada"}
PROTOCOLOS = {"mqtt"}

# Magnitudes y unidades: el mismo catálogo que el contrato de medidas.
UNIDADES = {nombre: set(m["unidades"]) for nombre, m in MAGNITUDES.items()}


class ProyectoInvalido(ValueError):
    def __init__(self, problemas: list[str]):
        super().__init__("; ".join(problemas))
        self.problemas = problemas


@dataclass
class Proyecto:
    datos: dict
    sha256: str
    ruta: Optional[Path] = None

    @property
    def id(self) -> str:
        return self.datos["proyecto_id"]

    def estaciones_con_alta(self) -> list[dict]:
        return [e for e in self.datos["estaciones"] if e["estado"] in ESTADOS_CON_ALTA]


def _texto(v: Any) -> bool:
    return isinstance(v, str) and v.strip() != ""


def validar(d: Any) -> list[str]:
    """Lista de problemas en español; vacía si el proyecto es válido."""
    p: list[str] = []
    if not isinstance(d, dict):
        return ["el proyecto debe ser un objeto JSON"]
    if d.get("formato") != FORMATO:
        p.append(f"«formato» debe ser «{FORMATO}»")
    pid = d.get("proyecto_id")
    if not isinstance(pid, str) or not RE_PROYECTO.match(pid):
        p.append("«proyecto_id»: minúsculas, cifras y guiones, de 2 a 40 caracteres (p. ej. «puente-chicamocha»)")
    if not _texto(d.get("nombre")):
        p.append("falta «nombre»")

    est = d.get("estructura")
    if not isinstance(est, dict) or est.get("tipo") not in TIPOS_ESTRUCTURA:
        p.append(f"«estructura.tipo» debe ser uno de {sorted(TIPOS_ESTRUCTURA)}")

    ub = d.get("ubicacion")
    if ub is not None:
        if not isinstance(ub, dict):
            p.append("«ubicacion» debe ser un objeto")
        else:
            for k, lim in (("latitud", 90), ("longitud", 180)):
                v = ub.get(k)
                if v is not None and (not isinstance(v, (int, float)) or isinstance(v, bool) or abs(v) > lim):
                    p.append(f"«ubicacion.{k}» fuera de rango")

    estaciones = d.get("estaciones")
    if not isinstance(estaciones, list):
        p.append("«estaciones» debe ser una lista (puede estar vacía)")
        estaciones = []
    vistos_e: set[str] = set()
    vistos_s: set[str] = set()
    for i, e in enumerate(estaciones):
        if not isinstance(e, dict):
            p.append(f"estaciones[{i}] debe ser un objeto")
            continue
        eid = e.get("id")
        donde = f"estación «{eid}»" if isinstance(eid, str) else f"estaciones[{i}]"
        if not isinstance(eid, str) or not RE_ESTACION.match(eid):
            p.append(f"{donde}: «id» en MAYÚSCULAS, cifras y guiones (p. ej. «CHI-SD-L1-M»)")
        elif eid in vistos_e:
            p.append(f"{donde}: «id» repetido")
        else:
            vistos_e.add(eid)
        if e.get("tipo") not in TIPOS_ESTACION:
            p.append(f"{donde}: «tipo» debe ser uno de {sorted(TIPOS_ESTACION)}")
        if e.get("estado") not in ESTADOS_ESTACION:
            p.append(f"{donde}: «estado» debe ser uno de {sorted(ESTADOS_ESTACION)}")
        if not _texto(e.get("nombre")):
            p.append(f"{donde}: falta «nombre»")
        com = e.get("comunicacion")
        if e.get("estado") in ESTADOS_CON_ALTA:
            if not isinstance(com, dict) or com.get("protocolo") not in PROTOCOLOS:
                p.append(f"{donde}: «comunicacion.protocolo» debe ser uno de {sorted(PROTOCOLOS)}")
            else:
                per = com.get("periodo_s")
                if not isinstance(per, int) or isinstance(per, bool) or not 1 <= per <= 3600:
                    p.append(f"{donde}: «comunicacion.periodo_s» entero entre 1 y 3600")
        sensores = e.get("sensores", [])
        if not isinstance(sensores, list):
            p.append(f"{donde}: «sensores» debe ser una lista")
            sensores = []
        for j, s in enumerate(sensores):
            if not isinstance(s, dict):
                p.append(f"{donde}: sensores[{j}] debe ser un objeto")
                continue
            sid = s.get("id")
            sd = f"{donde}, sensor «{sid}»" if isinstance(sid, str) else f"{donde}, sensores[{j}]"
            if not isinstance(sid, str) or not RE_SENSOR.match(sid):
                p.append(f"{sd}: «id» no válido")
            elif sid in vistos_s:
                p.append(f"{sd}: «id» repetido en el proyecto")
            else:
                vistos_s.add(sid)
            if not _texto(s.get("modelo")):
                p.append(f"{sd}: falta «modelo»")
            mag = s.get("magnitud")
            if mag not in UNIDADES:
                p.append(f"{sd}: «magnitud» debe ser una de {sorted(UNIDADES)}")
            elif s.get("unidad") not in UNIDADES[mag]:
                p.append(f"{sd}: la unidad de {mag} debe ser una de {sorted(UNIDADES[mag])}")
            ejes = s.get("ejes")
            vectorial = mag in MAGNITUDES and MAGNITUDES[mag]["vectorial"]
            if vectorial or ejes is not None:
                if not isinstance(ejes, list) or not ejes or not all(_texto(x) for x in ejes):
                    p.append(f"{sd}: «ejes» debe ser una lista no vacía" + ("" if vectorial else " u omitirse (sensor de un valor)"))
            hz = s.get("muestreo_hz")
            if hz is not None and (not isinstance(hz, (int, float)) or isinstance(hz, bool) or hz <= 0):
                p.append(f"{sd}: «muestreo_hz» debe ser positivo o null")

    cri = d.get("criterios")
    if not isinstance(cri, dict):
        p.append("falta «criterios» (usar estado «sin_definir» y umbrales vacíos si aún no los hay)")
    else:
        umbrales = cri.get("umbrales", [])
        if not isinstance(umbrales, list):
            p.append("«criterios.umbrales» debe ser una lista")
        elif umbrales and not (_texto(cri.get("aprobados_por")) and _texto(cri.get("fecha"))):
            p.append("hay umbrales sin «criterios.aprobados_por» y «criterios.fecha»: "
                     "un umbral estructural solo entra firmado por el ingeniero responsable")
        if cri.get("estado") not in {"sin_definir", "propuestos", "aprobados"}:
            p.append("«criterios.estado» debe ser sin_definir, propuestos o aprobados")
        elif cri.get("estado") == "aprobados" and not _texto(cri.get("aprobados_por")):
            p.append("criterios «aprobados» sin «aprobados_por»")
    return p


def cargar(texto: str | bytes, ruta: Optional[Path] = None) -> Proyecto:
    crudo = texto.encode("utf-8") if isinstance(texto, str) else texto
    try:
        datos = json.loads(crudo.decode("utf-8-sig"))
    except (UnicodeDecodeError, json.JSONDecodeError) as e:
        raise ProyectoInvalido([f"no es JSON válido: {e}"]) from e
    problemas = validar(datos)
    if problemas:
        raise ProyectoInvalido(problemas)
    return Proyecto(datos, hashlib.sha256(crudo).hexdigest(), ruta)


def cargar_archivo(ruta: Path) -> Proyecto:
    try:
        return cargar(ruta.read_bytes(), ruta)
    except ProyectoInvalido as e:
        raise ProyectoInvalido([f"{ruta}: {x}" for x in e.problemas]) from None


def cargar_carpeta(raiz: Path) -> list[Proyecto]:
    """Todos los `*/proyecto.json` bajo `raiz`, validados y sin choques entre sí."""
    proyectos = [cargar_archivo(r) for r in sorted(raiz.glob("*/proyecto.json"))]
    problemas, ids, estaciones = [], {}, {}
    for pr in proyectos:
        if pr.id in ids:
            problemas.append(f"«{pr.id}» está en {ids[pr.id]} y en {pr.ruta}")
        ids[pr.id] = pr.ruta
        for e in pr.datos["estaciones"]:
            otro = estaciones.get(e["id"])
            if otro and otro != pr.id:
                problemas.append(f"la estación «{e['id']}» está en los proyectos «{otro}» y «{pr.id}»; "
                                 "los identificadores de estación son únicos en todo el servidor")
            estaciones[e["id"]] = pr.id
    if problemas:
        raise ProyectoInvalido(problemas)
    return proyectos
