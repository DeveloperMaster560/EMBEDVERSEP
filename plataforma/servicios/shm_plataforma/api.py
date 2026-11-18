"""
API de la plataforma SHM (FastAPI). Documentación interactiva en /api/docs.

Varios proyectos (puentes, edificios) comparten el servidor. Cada credencial
tiene un ALCANCE y nunca ve nada fuera de él:

  lectura    su proyecto: estaciones, ventanas, avisos y crudos
  operador   lo anterior + reconocer avisos
  ingeniero  lo anterior + elevar un aviso a E3/E4 (único camino a esos niveles)
  estacion   solo subir crudos de SU estación
  admin      administrador del servidor: consulta todos los proyectos y reconoce
             avisos; NO puede elevar a E3/E4 (eso es del ingeniero de cada obra)

Lo que está fuera del alcance responde 404, igual que si no existiera: así no se
puede averiguar qué estaciones tienen otros proyectos.
Toda acción que cambia algo queda en `auditoria`, con su proyecto.
"""

from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone
from typing import Callable, Optional

from fastapi import Depends, FastAPI, Header, HTTPException, Request, Response
from pydantic import BaseModel, Field

from .almacen import ErrorAlmacen

# Qué roles cumplen cada exigencia. «admin» lee y opera en todos los proyectos,
# pero no decide niveles estructurales.
CUMPLEN = {
    "lectura": {"lectura", "operador", "ingeniero", "admin"},
    "operador": {"operador", "ingeniero", "admin"},
    "ingeniero": {"ingeniero"},
}
NO_EXISTE_ESTACION = "No existe esa estación."
MAX_CRUDO = 64 * 1024 * 1024


class Reconocer(BaseModel):
    nota: str = Field(min_length=3, max_length=2000)


class CambioNivel(BaseModel):
    nivel: str = Field(pattern=r"^E[34]$")
    justificacion: str = Field(min_length=20, max_length=4000)


def crear_app(obtener_repo: Callable[[], object], almacen) -> FastAPI:
    app = FastAPI(title="Plataforma SHM — EMBEDVERSE", version="0.2.0",
                  docs_url="/api/docs", openapi_url="/api/openapi.json")

    def repo():
        return obtener_repo()

    def quien(authorization: Optional[str] = Header(default=None), r=Depends(repo)) -> dict:
        if not authorization or not authorization.startswith("Bearer "):
            raise HTTPException(401, "Falta el token (Authorization: Bearer …).")
        cred = r.credencial(authorization[7:].strip())
        if not cred:
            raise HTTPException(401, "Token no válido o revocado.")
        return cred

    def exige(rol_minimo: str):
        def dep(c: dict = Depends(quien)) -> dict:
            if c["rol"] not in CUMPLEN[rol_minimo]:
                raise HTTPException(403, f"Hace falta el rol «{rol_minimo}».")
            return c
        return dep

    def alcance(c: dict):
        """None = todos los proyectos (solo admin); si no, el proyecto de la credencial."""
        if c["rol"] == "admin":
            return None
        if not c.get("proyecto_id"):  # defensa: una credencial sin proyecto no ve nada
            raise HTTPException(403, "La credencial no tiene proyecto asignado.")
        return c["proyecto_id"]

    def estacion_visible(station_id: str, c: dict, r) -> str:
        """Devuelve el proyecto de la estación, o 404 si no existe o es de otro proyecto."""
        proyecto = r.proyecto_de_estacion(station_id)
        a = alcance(c)
        if proyecto is None or (a is not None and proyecto != a):
            raise HTTPException(404, NO_EXISTE_ESTACION)
        return proyecto

    def aviso_visible(aviso_id: int, c: dict, r) -> dict:
        av = r.aviso(aviso_id)
        a = alcance(c)
        if not av or (a is not None and av["proyecto_id"] != a):
            raise HTTPException(404, "No existe ese aviso.")
        return av

    def rango(desde: Optional[datetime], hasta: Optional[datetime]) -> tuple[datetime, datetime]:
        hasta = hasta or datetime.now(timezone.utc)
        desde = desde or hasta - timedelta(hours=1)
        if desde.tzinfo is None or hasta.tzinfo is None:
            raise HTTPException(422, "Las fechas deben llevar zona horaria (por ejemplo, terminar en Z).")
        if hasta - desde > timedelta(days=31):
            raise HTTPException(422, "El rango máximo es de 31 días.")
        return desde, hasta

    @app.get("/api/v1/salud")
    def salud(r=Depends(repo)):
        try:
            ok = r.salud()
        except Exception:  # noqa: BLE001
            ok = False
        if not ok:
            raise HTTPException(503, "La base de datos no responde.")
        return {"estado": "ok"}

    @app.get("/api/v1/sesion")
    def sesion(c=Depends(quien)):
        """Quién soy y qué alcance tengo (sin el token)."""
        return {"nombre": c["nombre"], "rol": c["rol"], "proyecto_id": c.get("proyecto_id"),
                "station_id": c.get("station_id")}

    @app.get("/api/v1/proyectos")
    def proyectos(c=Depends(exige("lectura")), r=Depends(repo)):
        return r.proyectos(alcance(c))

    @app.get("/api/v1/estaciones")
    def estaciones(c=Depends(exige("lectura")), r=Depends(repo)):
        return r.estaciones(alcance(c))

    @app.get("/api/v1/estaciones/{station_id}/ventanas")
    def ventanas(station_id: str, desde: Optional[datetime] = None, hasta: Optional[datetime] = None,
                 limite: int = 500, completo: bool = False, c=Depends(exige("lectura")), r=Depends(repo)):
        estacion_visible(station_id, c, r)
        d, h = rango(desde, hasta)
        return r.ventanas(station_id, d, h, max(1, min(limite, 5000)), completo)

    @app.get("/api/v1/estaciones/{station_id}/disponibilidad")
    def disponibilidad(station_id: str, horas: int = 24, c=Depends(exige("lectura")), r=Depends(repo)):
        estacion_visible(station_id, c, r)
        horas = max(1, min(horas, 24 * 31))
        return r.disponibilidad(station_id, datetime.now(timezone.utc) - timedelta(hours=horas))

    @app.get("/api/v1/avisos")
    def avisos(abiertos: bool = True, limite: int = 200, c=Depends(exige("lectura")), r=Depends(repo)):
        return r.avisos(abiertos, max(1, min(limite, 2000)), alcance(c))

    @app.post("/api/v1/avisos/{aviso_id}/reconocer")
    def reconocer(aviso_id: int, cuerpo: Reconocer, c=Depends(exige("operador")), r=Depends(repo)):
        av = aviso_visible(aviso_id, c, r)
        r.reconocer_aviso(aviso_id, c["nombre"], cuerpo.nota)
        r.auditar(c["nombre"], "reconocer_aviso", str(aviso_id), {"nota": cuerpo.nota}, av["proyecto_id"])
        return {"ok": True}

    @app.post("/api/v1/avisos/{aviso_id}/nivel")
    def nivel(aviso_id: int, cuerpo: CambioNivel, c=Depends(exige("ingeniero")), r=Depends(repo)):
        """E3/E4 solo los asigna el ingeniero DEL PROYECTO, con justificación escrita."""
        av = aviso_visible(aviso_id, c, r)
        r.cambiar_nivel(aviso_id, cuerpo.nivel, c["nombre"], cuerpo.justificacion)
        r.auditar(c["nombre"], "cambiar_nivel", str(aviso_id),
                  {"nivel": cuerpo.nivel, "justificacion": cuerpo.justificacion}, av["proyecto_id"])
        return {"ok": True}

    @app.put("/api/v1/crudos/{station_id}/{nombre}", status_code=201)
    async def subir_crudo(station_id: str, nombre: str, request: Request, response: Response,
                          x_contenido_sha256: str = Header(...), x_ventana_inicio: Optional[str] = Header(default=None),
                          c=Depends(quien), r=Depends(repo)):
        if c["rol"] != "estacion" or c["station_id"] != station_id:
            raise HTTPException(403, "Solo la propia estación puede subir sus crudos.")
        largo = request.headers.get("content-length")
        if largo and int(largo) > MAX_CRUDO:
            raise HTTPException(413, "Archivo demasiado grande.")
        datos = await request.body()
        if len(datos) > MAX_CRUDO:
            raise HTTPException(413, "Archivo demasiado grande.")
        ventana = None
        if x_ventana_inicio:
            try:
                ventana = datetime.fromisoformat(x_ventana_inicio.replace("Z", "+00:00"))
            except ValueError:
                raise HTTPException(422, "X-Ventana-Inicio no es una fecha RFC 3339.")
        try:
            ficha = almacen.guardar(station_id, nombre, datos, x_contenido_sha256.lower())
        except ErrorAlmacen as e:
            raise HTTPException(409 if "inmutables" in str(e) else 422, str(e))
        r.guardar_ficha(ficha, ventana)
        if ficha.nuevo:
            r.auditar(c["nombre"], "subir_crudo", ficha.clave, {"bytes": ficha.bytes, "sha256": ficha.sha256},
                      c.get("proyecto_id"))
        else:
            response.status_code = 200
        return {"clave": ficha.clave, "bytes": ficha.bytes, "sha256": ficha.sha256, "nuevo": ficha.nuevo}

    @app.get("/api/v1/crudos/{station_id}")
    def listar_crudos(station_id: str, limite: int = 200, c=Depends(exige("lectura")), r=Depends(repo)):
        estacion_visible(station_id, c, r)
        return r.fichas(station_id, max(1, min(limite, 2000)))

    @app.get("/api/v1/crudos/{station_id}/{nombre}")
    def bajar_crudo(station_id: str, nombre: str, c=Depends(exige("lectura")), r=Depends(repo)):
        estacion_visible(station_id, c, r)
        f = r.ficha(station_id, nombre)
        if not f:
            raise HTTPException(404, "No existe ese archivo.")
        if not re.match(r"^[A-Za-z0-9._/-]+$", f["clave"]):
            raise HTTPException(500, "Clave de almacén no válida.")
        return Response(almacen.leer(f["clave"]), media_type="application/octet-stream",
                        headers={"X-Contenido-SHA256": f["sha256"]})

    return app


def app_desde_entorno() -> FastAPI:
    import threading

    from .almacen import desde_entorno
    from .db import RepositorioPg, conectar

    local = threading.local()

    def obtener():
        # Una conexión por hilo de trabajo; se rehace si se cayó.
        c = getattr(local, "repo", None)
        if c is None or c.c.closed:
            local.repo = RepositorioPg(conectar())
        return local.repo

    return crear_app(obtener, desde_entorno())
