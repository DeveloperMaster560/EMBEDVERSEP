"""Pruebas del núcleo: solo biblioteca estándar (python -m unittest discover -s pruebas)."""

import copy
import hashlib
import json
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

from shm_plataforma.almacen import AlmacenDisco, ErrorAlmacen
from shm_plataforma.contrato import validate_for_server, validate_station_record
from shm_plataforma.ingesta import Ingestor, RepositorioMemoria, estaciones_silenciosas, parse_time
from shm_plataforma.pasarela_sim import Cola
from shm_plataforma.volumen import crudo, resumen_mb_mes

RAIZ = Path(__file__).resolve().parents[2]
CASOS = json.loads((RAIZ / "contrato" / "casos.json").read_text(encoding="utf-8"))["casos"]
BASE = CASOS[0]["registro"]
T0 = datetime(2026, 11, 12, 12, 0, 20, tzinfo=timezone.utc)


def registro(segundos: int, **cambios) -> bytes:
    r = copy.deepcopy(BASE)
    r["timestamp_utc"] = (datetime(2026, 11, 12, 12, 0, 0, tzinfo=timezone.utc) + timedelta(seconds=segundos)) \
        .isoformat(timespec="milliseconds").replace("+00:00", "Z")
    r.update(cambios)
    return json.dumps(r).encode()


class Contrato(unittest.TestCase):
    def test_casos_compartidos_con_la_app(self):
        for caso in CASOS:
            with self.subTest(caso["nombre"]):
                problemas = validate_station_record(caso["registro"])
                self.assertEqual(not problemas, caso["valido"], problemas)
                if caso["problema_contiene"]:
                    self.assertTrue(any(caso["problema_contiene"] in p for p in problemas), problemas)

    def test_version_de_esquema_desconocida(self):
        r = dict(BASE, schema_version="9.9")
        self.assertTrue(any("Versión de esquema" in p for p in validate_for_server(r)))


class Ingesta(unittest.TestCase):
    def setUp(self):
        self.repo = RepositorioMemoria(["SD-V2-M"])
        self.ing = Ingestor(self.repo)
        self.t = "shm/v1/SD-V2-M/registro"

    def test_guarda_y_descarta_duplicado(self):
        self.assertEqual(self.ing.procesar(self.t, registro(0), T0).accion, "guardado")
        self.assertEqual(self.ing.procesar(self.t, registro(0), T0).accion, "duplicado")
        self.assertEqual(len(self.repo.ventanas), 1)

    def test_conflicto_conserva_el_primero(self):
        self.ing.procesar(self.t, registro(0), T0)
        res = self.ing.procesar(self.t, registro(0, samples_crc32="ffffffff"), T0)
        self.assertEqual(res.accion, "conflicto")
        v = next(iter(self.repo.ventanas.values()))
        self.assertEqual(v.crc32, "1a2b3c4d")

    def test_fuera_de_orden_se_guarda_marcado(self):
        self.ing.procesar(self.t, registro(20), T0)
        self.ing.procesar(self.t, registro(10), T0)
        v = self.repo.ventanas[("SD-V2-M", parse_time("2026-11-12T12:00:10Z"))]
        self.assertTrue(v.fuera_de_orden)

    def test_hueco_temporal(self):
        self.ing.procesar(self.t, registro(0), T0)
        res = self.ing.procesar(self.t, registro(30), T0)  # faltan las ventanas de 10 s y 20 s
        codigos = [a.codigo for a in res.avisos]
        self.assertIn("HUECO_TEMPORAL", codigos)

    def test_ventanas_contiguas_sin_aviso_de_continuidad(self):
        self.ing.procesar(self.t, registro(0, states=["NORMAL"]), T0)
        res = self.ing.procesar(self.t, registro(10, states=["NORMAL"]), T0)
        self.assertEqual(res.avisos, [])

    def test_hueco_con_perdida_de_gnss_lo_advierte(self):
        self.ing.procesar(self.t, registro(0), T0)
        res = self.ing.procesar(self.t, registro(25, time_quality="HOLDOVER",
                                                 health={**BASE["health"], "pps_locked": False}), T0)
        hueco = [a for a in res.avisos if a.codigo == "HUECO_TEMPORAL"][0]
        self.assertIn("salto de reloj", hueco.detalle)

    def test_estacion_suplantada_por_topico(self):
        res = self.ing.procesar("shm/v1/SD-OTRA/registro", registro(0), T0)
        self.assertEqual(res.accion, "rechazado")
        self.repo.estaciones.add("SD-OTRA")
        res = self.ing.procesar("shm/v1/SD-OTRA/registro", registro(0), T0)
        self.assertEqual(res.accion, "rechazado")
        self.assertIn("tópico", res.problemas[0])

    def test_invalido_no_se_pierde(self):
        res = self.ing.procesar(self.t, b"{no es json", T0)
        self.assertEqual(res.accion, "rechazado")
        self.assertEqual(len(self.repo.rechazos), 1)
        self.assertEqual(self.repo.rechazos[0][1], b"{no es json")

    def test_falla_de_sensor_es_medicion_no_evento(self):
        res = self.ing.procesar(self.t, registro(0, states=["SENSOR_FAULT", "DATA_GAP"],
                                                 health={**BASE["health"], "sensor_ok": False}), T0)
        self.assertEqual({a.categoria for a in res.avisos}, {"medicion"})

    def test_nunca_asigna_e3_ni_e4(self):
        for i, estados in enumerate((["EVENT_CAPTURE"], ["SATURATED"], ["COMM_LOST"], ["NORMAL"])):
            res = self.ing.procesar(self.t, registro(10 * i, states=estados), T0)
            for a in res.avisos:
                self.assertIn(a.nivel, ("E0", "E1", "E2"))

    def test_estacion_silenciosa_es_comunicacion(self):
        avisos = estaciones_silenciosas({"SD-V2-M": T0}, T0 + timedelta(minutes=5), 60)
        self.assertEqual(avisos[0].categoria, "comunicacion")
        self.assertEqual(estaciones_silenciosas({"SD-V2-M": T0}, T0 + timedelta(seconds=30), 60), [])

    def test_estado_retenido(self):
        res = self.ing.procesar("shm/v1/SD-V2-M/estado", b'{"en_linea": false}', T0)
        self.assertEqual(res.accion, "estado")
        self.assertEqual(self.repo.estados["SD-V2-M"][0], {"en_linea": False})


class Almacen(unittest.TestCase):
    def test_inmutable_e_integro(self):
        with tempfile.TemporaryDirectory() as d:
            a = AlmacenDisco(d)
            datos = b"\x01\x02" * 100
            sha = hashlib.sha256(datos).hexdigest()
            self.assertTrue(a.guardar("SD-V2-M", "000001.bin", datos, sha).nuevo)
            self.assertFalse(a.guardar("SD-V2-M", "000001.bin", datos, sha).nuevo)
            otro = b"otro"
            with self.assertRaises(ErrorAlmacen):
                a.guardar("SD-V2-M", "000001.bin", otro, hashlib.sha256(otro).hexdigest())
            with self.assertRaises(ErrorAlmacen):
                a.guardar("SD-V2-M", "000002.bin", datos, "0" * 64)
            with self.assertRaises(ErrorAlmacen):
                a.guardar("SD-V2-M", "../fuera.bin", datos, sha)
            self.assertEqual(a.leer("crudos/SD-V2-M/000001.bin"), datos)
            with self.assertRaises(ErrorAlmacen):
                a.leer("../../etc/passwd")


class Volumen(unittest.TestCase):
    def test_coincide_con_el_ejemplo_del_diseno(self):
        # diseno_tecnico.md §10: 3 ejes, 200 Hz, 4 bytes, margen 2,0 = 414,7 MB/día.
        v = crudo(200, "float32")
        sin_cabecera = (v.bytes_s - 256 / 10) * 86400 * 2 / 1e6
        self.assertAlmostEqual(sin_cabecera, 414.72, places=2)

    def test_resumen_no_depende_del_muestreo(self):
        self.assertLess(resumen_mb_mes(), 300)


class ColaPasarela(unittest.TestCase):
    def test_sobrevive_a_reinicio_y_conserva_orden(self):
        with tempfile.TemporaryDirectory() as d:
            ruta = Path(d) / "cola.jsonl"
            c = Cola(ruta)
            for i in range(3):
                c.poner(json.dumps({"n": i}))
            c.quitar_primero()
            c2 = Cola(ruta)
            self.assertEqual([json.loads(x)["n"] for x in c2.items], [1, 2])


if __name__ == "__main__":
    unittest.main()
