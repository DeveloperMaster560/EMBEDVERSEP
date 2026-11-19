import json
import unittest
from pathlib import Path

from datetime import datetime, timezone

from shm_plataforma.contrato_medidas import MAGNITUDES, validate_measurement_message
from shm_plataforma.ingesta import Ingestor, RepositorioMemoria

CASOS = json.loads((Path(__file__).resolve().parents[2] / "contrato" / "casos-medidas.json").read_text(encoding="utf-8"))["casos"]


class TestContratoMedidas(unittest.TestCase):
    def test_casos_compartidos(self):
        for c in CASOS:
            with self.subTest(c["nombre"]):
                p = validate_measurement_message(c["mensaje"])
                self.assertEqual(p == [], c["valido"], p)
                if c["problema_contiene"]:
                    self.assertTrue(any(c["problema_contiene"] in x for x in p), p)

    def test_catalogo(self):
        for nombre, m in MAGNITUDES.items():
            self.assertTrue(m["unidades"], nombre)
            if m["min"] is not None and m["max"] is not None:
                self.assertLess(m["min"], m["max"], nombre)


class TestIngestaMedidas(unittest.TestCase):
    AHORA = datetime(2026, 11, 19, 14, 0, 5, tzinfo=timezone.utc)

    def setUp(self):
        self.repo = RepositorioMemoria(["LAB-AMB-01"])
        self.ing = Ingestor(self.repo)
        self.msg = CASOS[0]["mensaje"]

    def enviar(self, msg, estacion="LAB-AMB-01"):
        return self.ing.procesar(f"shm/v1/{estacion}/medida", json.dumps(msg).encode(), self.AHORA)

    def test_guarda_una_fila_por_sensor_y_el_null_tambien(self):
        self.assertEqual(self.enviar(self.msg).accion, "guardado")
        self.assertEqual(len(self.repo.medidas), 5)
        sin = [m for m in self.repo.medidas.values() if m["value"] is None]
        self.assertEqual(len(sin), 1)
        self.assertEqual(sin[0]["error"], "sin eco")

    def test_reenviar_no_duplica(self):
        self.enviar(self.msg)
        self.assertEqual(self.enviar(self.msg).accion, "duplicado")
        self.assertEqual(len(self.repo.medidas), 5)

    def test_otra_estacion_por_mi_topico_se_rechaza(self):
        self.repo.estaciones.add("OTRA-01")
        r = self.enviar(self.msg, "OTRA-01")
        self.assertEqual(r.accion, "rechazado")
        self.assertIn("llegó por el tópico", r.problemas[0])

    def test_menos_999_se_rechaza_y_queda_anotado(self):
        malo = json.loads(json.dumps(self.msg))
        malo["measurements"][0]["value"] = -999
        self.assertEqual(self.enviar(malo).accion, "rechazado")
        self.assertEqual(len(self.repo.rechazos), 1)
        self.assertEqual(self.repo.medidas, {})


if __name__ == "__main__":
    unittest.main()
