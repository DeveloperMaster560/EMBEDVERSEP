"""
Núcleo de la ingesta: qué hacer con cada mensaje que llega de una estación.

Sin dependencias de red ni de base de datos: recibe el tópico, los bytes y la
hora de recepción, y habla con un «repositorio» (PostgreSQL en servicio, uno en
memoria en las pruebas). Así se prueba igual en Windows, macOS o Linux.

Reglas (ARQUITECTURA.md §7):
  - un mensaje inválido no se pierde: se guarda en `rechazos` con el motivo;
  - el `station_id` del cuerpo debe coincidir con el del tópico, y la estación
    debe estar dada de alta;
  - duplicado = misma estación y misma `timestamp_utc`: se descarta si el CRC
    coincide; si no coincide es un CONFLICTO y se conserva el primero;
  - lo que llega fuera de orden se guarda igual, marcado;
  - entre dos ventanas consecutivas se comprueba la continuidad temporal;
  - la plataforma clasifica en comunicación / medición / posible evento, y
    NUNCA asigna por sí sola los niveles E3–E4 (anomalía estructural): exigen
    umbrales aprobados por ingeniería, que hoy no existen.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Optional, Protocol

from .contrato import validate_for_server

TOPIC = re.compile(r"^shm/v1/([A-Z0-9][A-Z0-9-]{1,31})/(registro|estado|evento)$")

# Tolerancia para decidir que dos ventanas son contiguas.
CONTINUITY_TOLERANCE_S = 0.05

MEASUREMENT_STATES = {
    "DATA_GAP", "SENSOR_FAULT", "SATURATED", "TIME_HOLDOVER", "TIME_INVALID",
    "STORAGE_FAULT", "POWER_LOW",
}
COMM_STATES = {"COMM_LOST"}
EVENT_STATES = {"EVENT_CAPTURE"}


def parse_time(s: str) -> datetime:
    """RFC 3339 → datetime con zona. Acepta «Z» y fracciones de cualquier longitud."""
    s = s.strip()
    if s.endswith("Z"):
        s = s[:-1] + "+00:00"
    m = re.match(r"^(.*T\d{2}:\d{2}:\d{2})(\.\d+)?([+-]\d{2}:\d{2})$", s)
    if not m:
        raise ValueError(f"hora no RFC 3339: {s}")
    frac = (m.group(2) or ".0")[1:7].ljust(6, "0")
    return datetime.fromisoformat(f"{m.group(1)}.{frac}{m.group(3)}")


def to_rfc3339(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


@dataclass
class Ventana:
    """Una ventana de medición tal como queda guardada."""
    station_id: str
    inicio: datetime
    duracion_s: Optional[float]
    crc32: str
    estados: list[str]
    calidad_tiempo: str
    registro: dict
    recibido: datetime
    fuera_de_orden: bool = False


@dataclass
class Aviso:
    """Algo que la plataforma debe mostrar o notificar."""
    station_id: str
    categoria: str   # comunicacion | medicion | continuidad | posible_evento | integridad
    nivel: str       # E0–E2; E3/E4 no se asignan automáticamente
    codigo: str
    detalle: str
    desde: Optional[datetime] = None


@dataclass
class Resultado:
    accion: str      # guardado | duplicado | conflicto | rechazado | estado
    problemas: list[str] = field(default_factory=list)
    avisos: list[Aviso] = field(default_factory=list)


class Repositorio(Protocol):
    def estacion_activa(self, station_id: str) -> bool: ...
    def ventana_existente(self, station_id: str, inicio: datetime) -> Optional[Ventana]: ...
    def ultima_ventana(self, station_id: str) -> Optional[Ventana]: ...
    def guardar_ventana(self, v: Ventana) -> None: ...
    def guardar_rechazo(self, topic: str, payload: bytes, recibido: datetime, problemas: list[str]) -> None: ...
    def guardar_estado(self, station_id: str, estado: dict, recibido: datetime) -> None: ...
    def guardar_aviso(self, a: Aviso) -> None: ...
    def marcar_visto(self, station_id: str, cuando: datetime) -> None: ...


def duracion_ventana(r: dict) -> Optional[float]:
    """Duración de la ventana según muestras / frecuencia, si el registro la permite calcular."""
    n, fs = r.get("samples"), r.get("sample_rate_hz")
    if isinstance(n, int) and not isinstance(n, bool) and n > 0 and isinstance(fs, (int, float)) and fs > 0:
        return n / float(fs)
    return None


def clasificar(r: dict) -> list[Aviso]:
    """Estados de la estación → avisos por categoría. Solo niveles E0–E2."""
    sid = r["station_id"]
    desde = parse_time(r["timestamp_utc"])
    avisos: list[Aviso] = []
    for s in r.get("states") or []:
        if s in COMM_STATES:
            avisos.append(Aviso(sid, "comunicacion", "E1", s, "La estación declara pérdida de comunicación.", desde))
        elif s in MEASUREMENT_STATES:
            avisos.append(Aviso(sid, "medicion", "E1", s,
                                "Calidad de medición: no es una anomalía estructural.", desde))
        elif s in EVENT_STATES:
            # E2 = operacional: una persona debe revisar la captura. La
            # plataforma no puede subirlo a E3 sin umbrales aprobados.
            avisos.append(Aviso(sid, "posible_evento", "E2", s,
                                "Captura de evento: requiere revisión técnica antes de cualquier interpretación.", desde))
    return avisos


class Ingestor:
    def __init__(self, repo: Repositorio):
        self.repo = repo

    def procesar(self, topic: str, payload: bytes, recibido: datetime) -> Resultado:
        m = TOPIC.match(topic)
        if not m:
            return self._rechazar(topic, payload, recibido, [f"Tópico fuera del esquema shm/v1/<estación>/<tipo>: {topic}"])
        station_topic, tipo = m.group(1), m.group(2)

        try:
            data = json.loads(payload.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as e:
            return self._rechazar(topic, payload, recibido, [f"El mensaje no es JSON UTF-8 válido: {e}"])

        if not self.repo.estacion_activa(station_topic):
            return self._rechazar(topic, payload, recibido, [f"Estación no registrada o dada de baja: {station_topic}"])

        if tipo == "estado":
            if not isinstance(data, dict):
                return self._rechazar(topic, payload, recibido, ["El estado no es un objeto JSON."])
            self.repo.guardar_estado(station_topic, data, recibido)
            self.repo.marcar_visto(station_topic, recibido)
            return Resultado("estado")
        if tipo == "evento":
            # Reservado: el firmware aún no publica eventos. Se guarda como rechazo
            # explicado para no perderlo ni inventarle un formato.
            return self._rechazar(topic, payload, recibido, ["Los mensajes de evento aún no tienen contrato definido."])

        problemas = validate_for_server(data)
        if not problemas and data["station_id"] != station_topic:
            problemas.append(
                f"El registro dice ser de {data['station_id']} pero llegó por el tópico de {station_topic}."
            )
        if not problemas:
            try:
                inicio = parse_time(data["timestamp_utc"])
            except ValueError as e:
                problemas.append(str(e))
        if problemas:
            return self._rechazar(topic, payload, recibido, problemas)

        self.repo.marcar_visto(station_topic, recibido)
        existente = self.repo.ventana_existente(station_topic, inicio)
        if existente is not None:
            if existente.crc32.lower() == str(data["samples_crc32"]).lower():
                return Resultado("duplicado")
            aviso = Aviso(station_topic, "integridad", "E1", "CONFLICTO_DUPLICADO",
                          f"Dos registros distintos para la ventana {data['timestamp_utc']}: "
                          f"CRC guardado {existente.crc32}, recibido {data['samples_crc32']}. Se conserva el primero.",
                          inicio)
            self.repo.guardar_aviso(aviso)
            self.repo.guardar_rechazo(topic, payload, recibido, [aviso.detalle])
            return Resultado("conflicto", [aviso.detalle], [aviso])

        ultima = self.repo.ultima_ventana(station_topic)
        v = Ventana(
            station_id=station_topic,
            inicio=inicio,
            duracion_s=duracion_ventana(data),
            crc32=str(data["samples_crc32"]).lower(),
            estados=list(data.get("states") or []),
            calidad_tiempo=data["time_quality"],
            registro=data,
            recibido=recibido,
            fuera_de_orden=ultima is not None and inicio < ultima.inicio,
        )
        avisos = clasificar(data)
        if ultima is not None and not v.fuera_de_orden:
            avisos.extend(self._continuidad(ultima, v))
        self.repo.guardar_ventana(v)
        for a in avisos:
            self.repo.guardar_aviso(a)
        return Resultado("guardado", [], avisos)

    def _continuidad(self, previa: Ventana, v: Ventana) -> list[Aviso]:
        if previa.duracion_s is None:
            return []
        esperado = previa.inicio.timestamp() + previa.duracion_s
        delta = v.inicio.timestamp() - esperado
        if abs(delta) <= CONTINUITY_TOLERANCE_S:
            return []
        if delta > 0:
            codigo, texto = "HUECO_TEMPORAL", f"Faltan {delta:.3f} s entre {to_rfc3339(previa.inicio)} y {to_rfc3339(v.inicio)}."
        else:
            codigo, texto = "SOLAPE_TEMPORAL", f"La ventana empieza {-delta:.3f} s antes de que termine la anterior."
        # Si alguna de las dos ventanas no tenía hora GNSS, la discontinuidad puede
        # ser un salto de reloj y no un hueco real: se dice.
        if "GNSS_LOCKED" not in (previa.calidad_tiempo, v.calidad_tiempo) or previa.calidad_tiempo != v.calidad_tiempo:
            texto += " Hubo cambio o pérdida de la calidad de hora: puede ser un salto de reloj."
        return [Aviso(v.station_id, "continuidad", "E1", codigo, texto, v.inicio)]

    def _rechazar(self, topic: str, payload: bytes, recibido: datetime, problemas: list[str]) -> Resultado:
        self.repo.guardar_rechazo(topic, payload, recibido, problemas)
        return Resultado("rechazado", problemas)


def estaciones_silenciosas(ultimo_visto: dict[str, datetime], ahora: datetime, limite_s: float) -> list[Aviso]:
    """Estaciones de las que no llega nada hace más de `limite_s`: falla de COMUNICACIÓN, no del puente."""
    avisos = []
    for sid, visto in sorted(ultimo_visto.items()):
        silencio = (ahora - visto).total_seconds()
        if silencio > limite_s:
            avisos.append(Aviso(sid, "comunicacion", "E1", "ESTACION_SILENCIOSA",
                                f"Sin mensajes desde hace {silencio:.0f} s. Los datos siguen en la memoria local de la estación.",
                                visto))
    return avisos


class RepositorioMemoria:
    """Repositorio en memoria: pruebas y la demostración sin base de datos."""

    def __init__(self, estaciones: Optional[list[str]] = None):
        self.estaciones = set(estaciones or [])
        self.ventanas: dict[tuple[str, datetime], Ventana] = {}
        self.rechazos: list[tuple[str, bytes, datetime, list[str]]] = []
        self.estados: dict[str, tuple[dict, datetime]] = {}
        self.avisos: list[Aviso] = []
        self.visto: dict[str, datetime] = {}

    def estacion_activa(self, station_id):
        return station_id in self.estaciones

    def ventana_existente(self, station_id, inicio):
        return self.ventanas.get((station_id, inicio))

    def ultima_ventana(self, station_id):
        vs = [v for (s, _), v in self.ventanas.items() if s == station_id]
        return max(vs, key=lambda v: v.inicio) if vs else None

    def guardar_ventana(self, v):
        self.ventanas[(v.station_id, v.inicio)] = v

    def guardar_rechazo(self, topic, payload, recibido, problemas):
        self.rechazos.append((topic, payload, recibido, list(problemas)))

    def guardar_estado(self, station_id, estado, recibido):
        self.estados[station_id] = (estado, recibido)

    def guardar_aviso(self, a):
        self.avisos.append(a)

    def marcar_visto(self, station_id, cuando):
        self.visto[station_id] = max(cuando, self.visto.get(station_id, cuando))
