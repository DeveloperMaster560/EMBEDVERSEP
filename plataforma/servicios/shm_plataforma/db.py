"""Repositorio PostgreSQL/TimescaleDB para la ingesta y la API (psycopg 3)."""

from __future__ import annotations

import hashlib
import json
import os
from datetime import datetime
from typing import Optional

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from .ingesta import Aviso, Ventana


def conectar() -> psycopg.Connection:
    dsn = os.environ.get("DATABASE_URL")
    if not dsn:
        raise RuntimeError("Falta DATABASE_URL")
    return psycopg.connect(dsn, autocommit=True, row_factory=dict_row)


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


class RepositorioPg:
    def __init__(self, conn: psycopg.Connection):
        self.c = conn

    # ── ingesta ──
    def estacion_activa(self, station_id: str) -> bool:
        r = self.c.execute("SELECT activa FROM estaciones WHERE station_id = %s", (station_id,)).fetchone()
        return bool(r and r["activa"])

    def _ventana(self, r) -> Optional[Ventana]:
        if not r:
            return None
        return Ventana(r["station_id"], r["inicio"], r["duracion_s"], r["crc32"], list(r["estados"]),
                       r["calidad_tiempo"], r["registro"], r["recibido"], r["fuera_de_orden"])

    def ventana_existente(self, station_id: str, inicio: datetime) -> Optional[Ventana]:
        return self._ventana(self.c.execute(
            "SELECT * FROM ventanas WHERE station_id = %s AND inicio = %s", (station_id, inicio)).fetchone())

    def ultima_ventana(self, station_id: str) -> Optional[Ventana]:
        return self._ventana(self.c.execute(
            "SELECT * FROM ventanas WHERE station_id = %s ORDER BY inicio DESC LIMIT 1", (station_id,)).fetchone())

    def guardar_ventana(self, v: Ventana) -> None:
        r = v.registro
        self.c.execute(
            """INSERT INTO ventanas (station_id, inicio, duracion_s, recibido, calidad_tiempo, estados, crc32,
                                     muestras, huecos, saturadas, firmware_version, schema_version, fuera_de_orden, registro)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
               ON CONFLICT (station_id, inicio) DO NOTHING""",
            (v.station_id, v.inicio, v.duracion_s, v.recibido, v.calidad_tiempo, v.estados, v.crc32,
             r.get("samples"), r.get("gaps"), r.get("saturated"), r.get("firmware_version"),
             r.get("schema_version"), v.fuera_de_orden, Jsonb(r)))

    def guardar_rechazo(self, topic: str, payload: bytes, recibido: datetime, problemas: list[str]) -> None:
        self.c.execute("INSERT INTO rechazos (topic, payload, recibido, problemas) VALUES (%s,%s,%s,%s)",
                       (topic, payload, recibido, problemas))

    def guardar_estado(self, station_id: str, estado: dict, recibido: datetime) -> None:
        self.c.execute(
            """INSERT INTO estado_estacion (station_id, estado, recibido) VALUES (%s,%s,%s)
               ON CONFLICT (station_id) DO UPDATE SET estado = EXCLUDED.estado, recibido = EXCLUDED.recibido""",
            (station_id, Jsonb(estado), recibido))

    def guardar_aviso(self, a: Aviso) -> None:
        # Un aviso abierto con el mismo código no se repite en cada ventana.
        abierto = self.c.execute(
            "SELECT 1 FROM avisos WHERE station_id = %s AND codigo = %s AND abierto", (a.station_id, a.codigo)).fetchone()
        if abierto and a.categoria in ("comunicacion", "medicion"):
            return
        self.c.execute(
            "INSERT INTO avisos (station_id, categoria, nivel, codigo, detalle, desde) VALUES (%s,%s,%s,%s,%s,%s)",
            (a.station_id, a.categoria, a.nivel, a.codigo, a.detalle, a.desde))

    def marcar_visto(self, station_id: str, cuando: datetime) -> None:
        self.c.execute(
            """INSERT INTO estado_estacion (station_id, ultimo_visto) VALUES (%s,%s)
               ON CONFLICT (station_id) DO UPDATE
               SET ultimo_visto = GREATEST(estado_estacion.ultimo_visto, EXCLUDED.ultimo_visto)""",
            (station_id, cuando))
        # Si la estación vuelve a hablar, se cierra su aviso de silencio.
        self.c.execute(
            """UPDATE avisos SET abierto = false, nota = coalesce(nota || ' ', '') || 'Cerrado: la estación volvió a comunicar.'
               WHERE station_id = %s AND codigo = 'ESTACION_SILENCIOSA' AND abierto""", (station_id,))

    def ultimo_visto(self) -> dict[str, tuple[datetime, int]]:
        rows = self.c.execute(
            """SELECT e.station_id, s.ultimo_visto, e.periodo_s FROM estaciones e
               JOIN estado_estacion s USING (station_id) WHERE e.activa AND s.ultimo_visto IS NOT NULL""").fetchall()
        return {r["station_id"]: (r["ultimo_visto"], r["periodo_s"]) for r in rows}

    # ── API ──
    # `proyecto` es el alcance de la credencial: un proyecto_id, o None para el
    # administrador del servidor (todos). Ninguna consulta de la API se hace sin él.
    def credencial(self, token: str) -> Optional[dict]:
        return self.c.execute(
            "SELECT id, nombre, rol, station_id, proyecto_id FROM credenciales WHERE token_sha256 = %s AND activa",
            (token_hash(token),)).fetchone()

    def auditar(self, quien: str, accion: str, objeto: str, detalle: dict, proyecto: Optional[str] = None) -> None:
        self.c.execute("INSERT INTO auditoria (quien, accion, objeto, detalle, proyecto_id) VALUES (%s,%s,%s,%s,%s)",
                       (quien, accion, objeto, Jsonb(detalle), proyecto))

    def salud(self) -> bool:
        return self.c.execute("SELECT 1 AS ok").fetchone()["ok"] == 1

    def proyectos(self, proyecto: Optional[str]) -> list[dict]:
        return self.c.execute(
            """SELECT p.proyecto_id, p.nombre, p.tipo_estructura, p.institucion, p.entidad_responsable,
                      p.responsable_estructural, p.activo, p.actualizado,
                      (SELECT count(*) FROM estaciones e WHERE e.proyecto_id = p.proyecto_id AND e.activa) AS estaciones_activas
               FROM proyectos p WHERE %(p)s::text IS NULL OR p.proyecto_id = %(p)s ORDER BY p.proyecto_id""",
            {"p": proyecto}).fetchall()

    def proyecto_de_estacion(self, station_id: str) -> Optional[str]:
        r = self.c.execute("SELECT proyecto_id FROM estaciones WHERE station_id = %s", (station_id,)).fetchone()
        return r["proyecto_id"] if r else None

    def estaciones(self, proyecto: Optional[str]) -> list[dict]:
        return self.c.execute(
            """SELECT e.proyecto_id, e.station_id, e.tipo, e.nombre, e.ubicacion, e.simulada, e.activa, e.periodo_s,
                      s.ultimo_visto, s.estado
               FROM estaciones e LEFT JOIN estado_estacion s USING (station_id)
               WHERE %(p)s::text IS NULL OR e.proyecto_id = %(p)s
               ORDER BY e.proyecto_id, e.station_id""", {"p": proyecto}).fetchall()

    def ventanas(self, station_id: str, desde: datetime, hasta: datetime, limite: int, completo: bool) -> list[dict]:
        cols = "*" if completo else ("station_id, inicio, duracion_s, recibido, calidad_tiempo, estados, crc32, "
                                     "muestras, huecos, saturadas, firmware_version, fuera_de_orden")
        return self.c.execute(
            f"SELECT {cols} FROM ventanas WHERE station_id = %s AND inicio >= %s AND inicio < %s "
            "ORDER BY inicio DESC LIMIT %s", (station_id, desde, hasta, limite)).fetchall()

    def disponibilidad(self, station_id: str, desde: datetime) -> list[dict]:
        return self.c.execute(
            "SELECT * FROM disponibilidad_horaria WHERE station_id = %s AND hora >= %s ORDER BY hora",
            (station_id, desde)).fetchall()

    def avisos(self, solo_abiertos: bool, limite: int, proyecto: Optional[str]) -> list[dict]:
        filtro = "AND a.abierto" if solo_abiertos else ""
        return self.c.execute(
            f"""SELECT a.*, e.proyecto_id FROM avisos a JOIN estaciones e USING (station_id)
                WHERE (%(p)s::text IS NULL OR e.proyecto_id = %(p)s) {filtro}
                ORDER BY a.creado DESC LIMIT %(l)s""", {"p": proyecto, "l": limite}).fetchall()

    def aviso(self, aviso_id: int) -> Optional[dict]:
        return self.c.execute(
            "SELECT a.*, e.proyecto_id FROM avisos a JOIN estaciones e USING (station_id) WHERE a.id = %s",
            (aviso_id,)).fetchone()

    def reconocer_aviso(self, aviso_id: int, quien: str, nota: str) -> None:
        self.c.execute(
            """UPDATE avisos SET abierto = false, reconocido_por = %s, reconocido_en = now(),
                      nota = coalesce(nota || ' ', '') || %s WHERE id = %s""", (quien, nota, aviso_id))

    def cambiar_nivel(self, aviso_id: int, nivel: str, quien: str, justificacion: str) -> None:
        self.c.execute(
            "UPDATE avisos SET nivel = %s, nota = coalesce(nota || ' ', '') || %s WHERE id = %s",
            (nivel, f"[{nivel} por {quien}] {justificacion}", aviso_id))

    def guardar_ficha(self, ficha, ventana_inicio: Optional[datetime]) -> None:
        self.c.execute(
            """INSERT INTO archivos_crudos (station_id, nombre, clave, bytes, sha256, ventana_inicio)
               VALUES (%s,%s,%s,%s,%s,%s) ON CONFLICT (station_id, nombre) DO NOTHING""",
            (ficha.station_id, ficha.nombre, ficha.clave, ficha.bytes, ficha.sha256, ventana_inicio))

    def fichas(self, station_id: str, limite: int) -> list[dict]:
        return self.c.execute(
            "SELECT * FROM archivos_crudos WHERE station_id = %s ORDER BY recibido DESC LIMIT %s",
            (station_id, limite)).fetchall()

    def ficha(self, station_id: str, nombre: str) -> Optional[dict]:
        return self.c.execute(
            "SELECT * FROM archivos_crudos WHERE station_id = %s AND nombre = %s", (station_id, nombre)).fetchone()

    # ── proyectos ──
    def importar_proyecto(self, pr) -> dict:
        """Lleva un proyecto.json a la base, en una sola transacción.

        No roba estaciones ni sensores de otro proyecto: si un identificador ya
        pertenece a otro, se rechaza todo el archivo. Lo que sale del archivo
        se desactiva; nunca se borran datos medidos.
        """
        from .proyecto import ESTADOS_CON_ALTA, ProyectoInvalido

        d = pr.datos
        pid = d["proyecto_id"]
        with self.c.transaction():
            ajenas = self.c.execute(
                "SELECT station_id, proyecto_id FROM estaciones WHERE station_id = ANY(%s::text[]) AND proyecto_id <> %s",
                ([e["id"] for e in d["estaciones"]], pid)).fetchall()
            sensores_ids = [s["id"] for e in d["estaciones"] for s in e.get("sensores", [])]
            ajenos = self.c.execute(
                """SELECT s.sensor_id, e.proyecto_id FROM sensores s JOIN estaciones e USING (station_id)
                   WHERE s.sensor_id = ANY(%s::text[]) AND e.proyecto_id <> %s""", (sensores_ids, pid)).fetchall()
            problemas = [f"la estación «{r['station_id']}» ya pertenece al proyecto «{r['proyecto_id']}»" for r in ajenas]
            problemas += [f"el sensor «{r['sensor_id']}» ya pertenece al proyecto «{r['proyecto_id']}»" for r in ajenos]
            if problemas:
                raise ProyectoInvalido(problemas)

            self.c.execute(
                """INSERT INTO proyectos (proyecto_id, nombre, tipo_estructura, institucion, entidad_responsable,
                                          responsable_estructural, archivo_sha256, definicion, actualizado)
                   VALUES (%s,%s,%s,%s,%s,%s,%s,%s, now())
                   ON CONFLICT (proyecto_id) DO UPDATE SET
                     nombre = EXCLUDED.nombre, tipo_estructura = EXCLUDED.tipo_estructura,
                     institucion = EXCLUDED.institucion, entidad_responsable = EXCLUDED.entidad_responsable,
                     responsable_estructural = EXCLUDED.responsable_estructural,
                     archivo_sha256 = EXCLUDED.archivo_sha256, definicion = EXCLUDED.definicion,
                     actualizado = now()""",
                (pid, d["nombre"], d["estructura"]["tipo"], d.get("institucion"), d.get("entidad_responsable"),
                 d.get("responsable_estructural"), pr.sha256, Jsonb(d)))

            altas, sensores = [], 0
            for e in d["estaciones"]:
                if e["estado"] not in ESTADOS_CON_ALTA:
                    continue
                ub = e.get("ubicacion") or {}
                self.c.execute(
                    """INSERT INTO estaciones (station_id, proyecto_id, tipo, nombre, ubicacion, simulada, activa, periodo_s, notas)
                       VALUES (%s,%s,%s,%s,%s,%s,true,%s,%s)
                       ON CONFLICT (station_id) DO UPDATE SET
                         tipo = EXCLUDED.tipo, nombre = EXCLUDED.nombre, ubicacion = EXCLUDED.ubicacion,
                         simulada = EXCLUDED.simulada, activa = true, periodo_s = EXCLUDED.periodo_s,
                         notas = EXCLUDED.notas""",
                    (e["id"], pid, e["tipo"], e["nombre"], ub.get("descripcion"), e["estado"] == "simulada",
                     e["comunicacion"]["periodo_s"], e.get("notas")))
                altas.append(e["id"])
                for s in e.get("sensores", []):
                    self.c.execute(
                        """INSERT INTO sensores (sensor_id, station_id, modelo, ejes, magnitud, unidad, muestreo_hz, notas)
                           VALUES (%s,%s,%s,%s,%s,%s,%s,%s)
                           ON CONFLICT (sensor_id) DO UPDATE SET
                             station_id = EXCLUDED.station_id, modelo = EXCLUDED.modelo, ejes = EXCLUDED.ejes,
                             magnitud = EXCLUDED.magnitud, unidad = EXCLUDED.unidad,
                             muestreo_hz = EXCLUDED.muestreo_hz, notas = EXCLUDED.notas""",
                        (s["id"], e["id"], s["modelo"], s["ejes"], s["magnitud"], s["unidad"],
                         s.get("muestreo_hz"), s.get("notas")))
                    sensores += 1
            desactivadas = self.c.execute(
                """UPDATE estaciones SET activa = false
                   WHERE proyecto_id = %s AND activa AND NOT (station_id = ANY(%s::text[])) RETURNING station_id""",
                (pid, altas)).fetchall()
            self.auditar("migrar", "importar_proyecto", pid,
                         {"sha256": pr.sha256, "estaciones": altas,
                          "desactivadas": [r["station_id"] for r in desactivadas]}, pid)
        return {"altas": len(altas), "desactivadas": len(desactivadas), "sensores": sensores}


def dumps(o) -> str:
    return json.dumps(o, default=str, ensure_ascii=False)
