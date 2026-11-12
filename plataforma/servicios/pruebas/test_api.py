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
    "t-lectura": {"id": 1, "nombre": "consulta", "rol": "lectura", "station_id": None},
    "t-operador": {"id": 2, "nombre": "operador1", "rol": "operador", "station_id": None},
    "t-ingeniero": {"id": 3, "nombre": "ing1", "rol": "ingeniero", "station_id": None},
    "t-estacion": {"id": 4, "nombre": "SD-V2-M", "rol": "estacion", "station_id": "SD-V2-M"},
}


class RepoFalso:
    def __init__(self):
        self.auditoria, self.fichas_ = [], {}
        self.avisos_ = {7: {"id": 7, "nivel": "E2", "abierto": True}}

    def salud(self): return True
    def credencial(self, token): return TOKENS.get(token)
    def estaciones(self): return [{"station_id": "SD-V2-M"}]
    def avisos(self, abiertos, limite): return list(self.avisos_.values())
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


if __name__ == "__main__":
    unittest.main()
