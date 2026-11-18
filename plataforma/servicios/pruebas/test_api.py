"""Pruebas de la API con un repositorio falso (necesita fastapi y httpx; si faltan, se omiten)."""

import hashlib
import tempfile
import unittest

try:
    from fastapi.testclient import TestClient
except ImportError:  # pragma: no cover
    TestClient = None

from shm_plataforma.almacen import AlmacenDisco

TOKENS = {
    "t-lectura": {"id": 1, "nombre": "consulta", "rol": "lectura", "station_id": None, "proyecto_id": "novena"},
    "t-operador": {"id": 2, "nombre": "operador1", "rol": "operador", "station_id": None, "proyecto_id": "novena"},
    "t-ingeniero": {"id": 3, "nombre": "ing1", "rol": "ingeniero", "station_id": None, "proyecto_id": "novena"},
    "t-estacion": {"id": 4, "nombre": "SD-V2-M", "rol": "estacion", "station_id": "SD-V2-M", "proyecto_id": "novena"},
    # Otro ingeniero, con su propio edificio en el mismo servidor.
    "t-ing-otro": {"id": 5, "nombre": "ing2", "rol": "ingeniero", "station_id": None, "proyecto_id": "edificio-b"},
    "t-lec-otro": {"id": 6, "nombre": "consulta2", "rol": "lectura", "station_id": None, "proyecto_id": "edificio-b"},
    "t-admin": {"id": 7, "nombre": "CIAI", "rol": "admin", "station_id": None, "proyecto_id": None},
    "t-huerfana": {"id": 8, "nombre": "vieja", "rol": "lectura", "station_id": None, "proyecto_id": None},
}

ESTACIONES = {"SD-V2-M": "novena", "EDB-SD-1": "edificio-b"}


class RepoFalso:
    def __init__(self):
        self.auditoria, self.fichas_ = [], {}
        self.avisos_ = {7: {"id": 7, "nivel": "E2", "abierto": True, "station_id": "SD-V2-M", "proyecto_id": "novena"},
                        9: {"id": 9, "nivel": "E1", "abierto": True, "station_id": "EDB-SD-1", "proyecto_id": "edificio-b"}}

    def salud(self): return True
    def credencial(self, token): return TOKENS.get(token)
    def proyecto_de_estacion(self, s): return ESTACIONES.get(s)
    def proyecto(self, p): return {"proyecto_id": p, "definicion": {}} if p in ESTACIONES.values() else None
    def proyectos(self, p): return [{"proyecto_id": x} for x in sorted(set(ESTACIONES.values())) if p in (None, x)]
    def estaciones(self, p): return [{"station_id": s, "proyecto_id": x} for s, x in ESTACIONES.items() if p in (None, x)]
    def ventanas(self, s, d, h, l, c): return [{"station_id": s}]
    def disponibilidad(self, s, d): return []
    def avisos(self, abiertos, limite, p): return [a for a in self.avisos_.values() if p in (None, a["proyecto_id"])]
    def aviso(self, i): return self.avisos_.get(i)
    def reconocer_aviso(self, i, quien, nota): self.avisos_[i]["abierto"] = False
    def cambiar_nivel(self, i, nivel, quien, j): self.avisos_[i]["nivel"] = nivel
    def auditar(self, *a): self.auditoria.append(a)
    def guardar_ficha(self, f, v): self.fichas_[(f.station_id, f.nombre)] = {"clave": f.clave, "sha256": f.sha256}
    def ficha(self, s, n): return self.fichas_.get((s, n))
    def fichas(self, s, l): return list(self.fichas_.values())


def h(token):
    return {"Authorization": f"Bearer {token}"}


@unittest.skipIf(TestClient is None, "fastapi/httpx no instalados")
class Api(unittest.TestCase):
    def setUp(self):
        from shm_plataforma.api import crear_app
        self.dir = tempfile.TemporaryDirectory()
        self.repo = RepoFalso()
        self.c = TestClient(crear_app(lambda: self.repo, AlmacenDisco(self.dir.name)))

    def tearDown(self):
        self.dir.cleanup()

    def test_sin_token_401(self):
        self.assertEqual(self.c.get("/api/v1/estaciones").status_code, 401)
        self.assertEqual(self.c.get("/api/v1/estaciones", headers=h("falso")).status_code, 401)
        self.assertEqual(self.c.get("/api/v1/salud").status_code, 200)

    def test_estacion_no_puede_leer(self):
        self.assertEqual(self.c.get("/api/v1/estaciones", headers=h("t-estacion")).status_code, 403)
        self.assertEqual(self.c.get("/api/v1/estaciones", headers=h("t-lectura")).status_code, 200)

    def test_solo_ingeniero_eleva_a_e3_con_justificacion(self):
        cuerpo = {"nivel": "E3", "justificacion": "Revisión de la captura y comparación con línea base."}
        self.assertEqual(self.c.post("/api/v1/avisos/7/nivel", json=cuerpo, headers=h("t-operador")).status_code, 403)
        self.assertEqual(self.c.post("/api/v1/avisos/7/nivel", json={"nivel": "E3", "justificacion": "corta"},
                                     headers=h("t-ingeniero")).status_code, 422)
        self.assertEqual(self.c.post("/api/v1/avisos/7/nivel", json={**cuerpo, "nivel": "E2"},
                                     headers=h("t-ingeniero")).status_code, 422)
        self.assertEqual(self.c.post("/api/v1/avisos/7/nivel", json=cuerpo, headers=h("t-ingeniero")).status_code, 200)
        self.assertEqual(self.repo.avisos_[7]["nivel"], "E3")
        self.assertEqual(self.repo.auditoria[-1][1], "cambiar_nivel")

    def test_operador_reconoce(self):
        r = self.c.post("/api/v1/avisos/7/reconocer", json={"nota": "Revisado en sitio"}, headers=h("t-lectura"))
        self.assertEqual(r.status_code, 403)
        r = self.c.post("/api/v1/avisos/7/reconocer", json={"nota": "Revisado en sitio"}, headers=h("t-operador"))
        self.assertEqual(r.status_code, 200)

    def test_subida_de_crudo(self):
        datos = b"\x00\x01" * 500
        sha = hashlib.sha256(datos).hexdigest()
        url = "/api/v1/crudos/SD-V2-M/000001.bin"
        cab = {**h("t-estacion"), "X-Contenido-SHA256": sha}
        self.assertEqual(self.c.put(url, content=datos, headers={**h("t-lectura"), "X-Contenido-SHA256": sha}).status_code, 403)
        self.assertEqual(self.c.put("/api/v1/crudos/SD-OTRA/1.bin", content=datos, headers=cab).status_code, 403)
        self.assertEqual(self.c.put(url, content=datos, headers={**cab, "X-Contenido-SHA256": "0" * 64}).status_code, 422)
        self.assertEqual(self.c.put(url, content=datos, headers=cab).status_code, 201)
        self.assertEqual(self.c.put(url, content=datos, headers=cab).status_code, 200)  # repetida: idempotente
        otro = b"distinto"
        self.assertEqual(self.c.put(url, content=otro, headers={**cab, "X-Contenido-SHA256": hashlib.sha256(otro).hexdigest()}).status_code, 409)
        r = self.c.get(url, headers=h("t-lectura"))
        self.assertEqual(r.content, datos)
        self.assertEqual(r.headers["X-Contenido-SHA256"], sha)


@unittest.skipIf(TestClient is None, "fastapi/httpx no instalados")
class AislamientoEntreProyectos(unittest.TestCase):
    """Dos ingenieros en el mismo servidor: cada uno ve SOLO su proyecto."""

    def setUp(self):
        from shm_plataforma.api import crear_app
        self.dir = tempfile.TemporaryDirectory()
        self.repo = RepoFalso()
        self.c = TestClient(crear_app(lambda: self.repo, AlmacenDisco(self.dir.name)))

    def tearDown(self):
        self.dir.cleanup()

    def ids(self, url, token, campo):
        r = self.c.get(url, headers=h(token))
        self.assertEqual(r.status_code, 200, r.text)
        return sorted(x[campo] for x in r.json())

    def test_cada_uno_lista_solo_lo_suyo(self):
        self.assertEqual(self.ids("/api/v1/estaciones", "t-lectura", "station_id"), ["SD-V2-M"])
        self.assertEqual(self.ids("/api/v1/estaciones", "t-lec-otro", "station_id"), ["EDB-SD-1"])
        self.assertEqual(self.ids("/api/v1/avisos", "t-lectura", "id"), [7])
        self.assertEqual(self.ids("/api/v1/avisos", "t-lec-otro", "id"), [9])
        self.assertEqual(self.ids("/api/v1/proyectos", "t-lec-otro", "proyecto_id"), ["edificio-b"])

    def test_lo_ajeno_responde_404_como_si_no_existiera(self):
        for url in ("/api/v1/estaciones/SD-V2-M/ventanas", "/api/v1/estaciones/SD-V2-M/disponibilidad",
                    "/api/v1/crudos/SD-V2-M", "/api/v1/crudos/SD-V2-M/000001.bin"):
            ajena = self.c.get(url, headers=h("t-lec-otro"))
            inexistente = self.c.get(url.replace("SD-V2-M", "NO-EXISTE"), headers=h("t-lec-otro"))
            self.assertEqual(ajena.status_code, 404, url)
            self.assertEqual(ajena.json(), inexistente.json(), url)  # no se distingue «ajena» de «no existe»
        self.assertEqual(self.c.get("/api/v1/estaciones/SD-V2-M/ventanas", headers=h("t-lectura")).status_code, 200)

    def test_no_se_actua_sobre_avisos_ajenos(self):
        cuerpo = {"nivel": "E3", "justificacion": "Revisión de la captura y comparación con línea base."}
        self.assertEqual(self.c.post("/api/v1/avisos/7/nivel", json=cuerpo, headers=h("t-ing-otro")).status_code, 404)
        self.assertEqual(self.c.post("/api/v1/avisos/7/reconocer", json={"nota": "no es mío"},
                                     headers=h("t-ing-otro")).status_code, 404)
        self.assertEqual(self.repo.avisos_[7]["nivel"], "E2")
        self.assertTrue(self.repo.avisos_[7]["abierto"])
        self.assertEqual(self.repo.auditoria, [])

    def test_admin_ve_todo_pero_no_decide_niveles_estructurales(self):
        self.assertEqual(self.ids("/api/v1/estaciones", "t-admin", "station_id"), ["EDB-SD-1", "SD-V2-M"])
        self.assertEqual(self.ids("/api/v1/avisos", "t-admin", "id"), [7, 9])
        cuerpo = {"nivel": "E3", "justificacion": "Revisión de la captura y comparación con línea base."}
        self.assertEqual(self.c.post("/api/v1/avisos/9/nivel", json=cuerpo, headers=h("t-admin")).status_code, 403)
        r = self.c.post("/api/v1/avisos/9/reconocer", json={"nota": "Revisado por operación"}, headers=h("t-admin"))
        self.assertEqual(r.status_code, 200)
        self.assertEqual(self.repo.auditoria[-1][-1], "edificio-b")  # la auditoría queda en el proyecto del aviso

    def test_definicion_solo_del_propio_proyecto(self):
        self.assertEqual(self.c.get("/api/v1/proyectos/novena", headers=h("t-lectura")).status_code, 200)
        ajeno = self.c.get("/api/v1/proyectos/novena", headers=h("t-lec-otro"))
        inexistente = self.c.get("/api/v1/proyectos/nada", headers=h("t-lec-otro"))
        self.assertEqual((ajeno.status_code, ajeno.json()), (inexistente.status_code, inexistente.json()))
        self.assertEqual(self.c.get("/api/v1/proyectos/edificio-b", headers=h("t-admin")).status_code, 200)

    def test_credencial_sin_proyecto_no_ve_nada(self):
        self.assertEqual(self.c.get("/api/v1/estaciones", headers=h("t-huerfana")).status_code, 403)

    def test_sesion_dice_el_alcance(self):
        r = self.c.get("/api/v1/sesion", headers=h("t-ing-otro")).json()
        self.assertEqual((r["rol"], r["proyecto_id"]), ("ingeniero", "edificio-b"))


if __name__ == "__main__":
    unittest.main()
