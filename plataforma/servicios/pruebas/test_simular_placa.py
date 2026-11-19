"""Simulador de placas en el PC: compila sketches reales del repositorio contra el núcleo simulado."""
import json
import shutil
import tempfile
import unittest
from pathlib import Path

from shm_plataforma.simular_placa import RAIZ, ErrorSimulacion, compilar, ejecutar

AMBIENTE = RAIZ / "firmware" / "esp32-ambiente"
ESCENARIO = RAIZ / "firmware" / "simulador-host" / "escenarios" / "cacao-prueba.csv"


@unittest.skipIf(shutil.which("c++") is None and shutil.which("g++") is None, "sin compilador de C++")
class TestSimularPlaca(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="test-sim-"))

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def sketch(self, codigo: str) -> Path:
        d = self.tmp / "sk"
        d.mkdir()
        (d / "sk.ino").write_text(codigo, encoding="utf-8")
        return d

    def test_estacion_ambiental_sin_modificar(self):
        r = ejecutar(compilar(AMBIENTE, self.tmp / "b"), ESCENARIO, 600, 1_795_000_000_000)
        medidas = [json.loads(m.carga) for m in r.mensajes if m.topico.endswith("/medida")]
        self.assertGreaterEqual(len(medidas), 55)
        self.assertEqual([m.problemas for m in r.mensajes if m.problemas], [])
        # Escenario: el DHT22 falla entre 400 y 440 s → temperatura null, nunca -999.
        valores = [{x["quantity"]: x["value"] for x in m["measurements"]} for m in medidas]
        self.assertTrue(any(v["temperatura"] is None for v in valores))
        self.assertTrue(any(v["distancia"] is not None and v["distancia"] < 50 for v in valores))
        # Sin hora NTP no se mide: el primer mensaje es posterior a la sincronización (2 s).
        self.assertGreater(r.mensajes[0].t_s, 2)

    def test_un_sketch_con_topico_propio_se_detecta(self):
        d = self.sketch('#include <PubSubClient.h>\n#include <WiFi.h>\nWiFiClient w; PubSubClient m(w);\n'
                        'void setup(){ WiFi.begin("a","b"); m.connect("x"); }\n'
                        'void loop(){ m.publish("cacao/estacion001/telemetria", "{\\"t\\":-999}"); delay(10000); }\n')
        r = ejecutar(compilar(d, self.tmp / "b"), ESCENARIO, 30, 0)
        self.assertEqual(len(r.mensajes), 3)
        self.assertIn("fuera del esquema", r.mensajes[0].problemas[0])

    def test_biblioteca_de_hardware_no_imitada(self):
        d = self.sketch("#include <Adafruit_SCD30.h>\nvoid setup(){}\nvoid loop(){}\n")
        with self.assertRaises(ErrorSimulacion) as e:
            compilar(d, self.tmp / "b")
        self.assertIn("Adafruit_SCD30.h", str(e.exception))

    def test_bucle_sin_delay_avanza_igual(self):
        d = self.sketch("unsigned long n=0; void setup(){} void loop(){ n++; if (millis() % 1000 == 0) Serial.println(n); }\n")
        r = ejecutar(compilar(d, self.tmp / "b"), ESCENARIO, 3, 0)
        self.assertAlmostEqual(r.t_fin_s, 3, places=2)
        self.assertTrue(r.serie)

    def test_bucle_infinito_se_corta(self):
        d = self.sketch("void setup(){} void loop(){ while (true) {} }\n")
        with self.assertRaises(ErrorSimulacion) as e:
            ejecutar(compilar(d, self.tmp / "b"), ESCENARIO, 3, 0, limite_s=2)
        self.assertIn("bucle", str(e.exception))


if __name__ == "__main__":
    unittest.main()
