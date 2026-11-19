import json
from pathlib import Path
import unittest

from shm_plataforma.contrato import validate_for_server
from shm_plataforma.pasarela_serie import Pasarela, Ventanero, extraer_registro


def ventana_de_prueba():
    """La misma ventana que firmware/esp32-mpu6050/prueba/prueba_ventana.cpp."""
    lineas = []
    for i in range(1000):
        z = 40.0 if i == 10 else 9.81
        lineas.append("x" if i == 500 else f"{0.1 if i % 2 else -0.1},0,{z}")
    return lineas


class TestVentanero(unittest.TestCase):
    def test_mismo_crc_que_el_esp32(self):
        v = Ventanero("LAB-SERIE-01", "MPU6050-LAB-SERIE-01", 100, "m/s2", 4, reloj=lambda: 1795000000.123)
        regs = [r for r in (v.linea(l) for l in ventana_de_prueba()) if r]
        self.assertEqual(len(regs), 1)
        r = regs[0]
        self.assertEqual(r["samples_crc32"], "b78e9015")          # el del código C del ESP32
        self.assertEqual((r["samples"], r["gaps"], r["saturated"]), (1000, 1, 1))
        self.assertEqual(r["states"], ["DATA_GAP", "SATURATED"])
        self.assertEqual(r["stats"]["max"][2], 40.0)
        self.assertEqual(r["timestamp_utc"], "2026-11-18T11:06:40.123Z")
        self.assertEqual(validate_for_server(r), [])

    def test_unidad_g_y_separadores(self):
        v = Ventanero("LAB-SERIE-01", "S", 1, "g", None, reloj=lambda: 0.0)
        for l in ["0;0;1"] * 5 + ["0 0 1"] * 4:
            self.assertIsNone(v.linea(l))
        r = v.linea("0\t0\t1")
        self.assertAlmostEqual(r["stats"]["mean"][2], 9.80665, places=4)
        self.assertEqual(r["states"], ["NORMAL"])

    def test_ventanas_seguidas_encadenan_la_hora(self):
        horas = iter([100.0, 110.03, 135.0])        # 2.ª llega con 30 ms de retraso USB; 3.ª tras un corte
        v = Ventanero("LAB-SERIE-01", "S", 1, "m/s2", None, reloj=lambda: next(horas))
        regs = [r for r in (v.linea("0,0,9.8") for _ in range(30)) if r]
        self.assertEqual([r["timestamp_utc"][-10:] for r in regs], ["01:40.000Z", "01:50.000Z", "02:15.000Z"])

    def test_basura_antes_de_empezar_no_abre_ventana(self):
        v = Ventanero("LAB-SERIE-01", "S", 1, "m/s2", None)
        self.assertIsNone(v.linea("Iniciando..."))
        self.assertEqual(v.muestras, [])


class TestPasarela(unittest.TestCase):
    def setUp(self):
        self.enviados, self.fallar, self.texto = [], False, []

    def publicar(self, topico, carga):
        if self.fallar:
            raise ConnectionError("caído")
        self.enviados.append((topico, json.loads(carga)))

    def test_registro_completo_con_prefijo_y_cola_si_cae_el_broker(self):
        base = Ventanero("LAB-ESP32-01", "MPU6050-LAB-ESP32-01", 1, "m/s2", None)
        reg = None
        for _ in range(10):
            reg = base.linea("0,0,9.8") or reg
        p = Pasarela("LAB-ESP32-01", self.publicar, None, salida=self.texto.append)
        self.fallar = True
        p.linea("SHM " + json.dumps(reg))
        self.assertEqual((self.enviados, len(p.cola)), ([], 1))
        self.fallar = False
        p.linea("# MQTT conectado")                     # mensaje de la placa: se muestra, no se envía
        p.vaciar()
        self.assertEqual(self.enviados[0][0], "shm/v1/LAB-ESP32-01/registro")
        self.assertEqual(len(p.cola), 0)
        self.assertTrue(any("placa:" in t for t in self.texto))

    def test_medidas_de_sensores_lentos_van_a_su_topico(self):
        casos = json.loads((Path(__file__).resolve().parents[2] / "contrato" / "casos-medidas.json").read_text(encoding="utf-8"))["casos"]
        msg = casos[0]["mensaje"]
        p = Pasarela("LAB-AMB-01", self.publicar, None, salida=self.texto.append)
        p.linea("MEDIDA " + json.dumps(msg))
        self.assertEqual(self.enviados[0][0], "shm/v1/LAB-AMB-01/medida")
        malo = json.loads(json.dumps(msg))
        malo["measurements"][0]["value"] = -999
        p.linea("MEDIDA " + json.dumps(malo))
        self.assertEqual((len(self.enviados), p.rechazados), (1, 1))
        self.assertIn("envíe null", self.texto[-1])

    def test_no_publica_por_otra_estacion_ni_registros_invalidos(self):
        p = Pasarela("LAB-SERIE-01", self.publicar, None, salida=self.texto.append)
        v = Ventanero("LAB-ESP32-01", "S", 1, "m/s2", None)
        reg = [v.linea("1,2,3") for _ in range(10)][-1]
        p.linea(json.dumps(reg))
        reg2 = dict(reg, station_id="LAB-SERIE-01", time_quality="RELOJ")
        p.linea(json.dumps(reg2))
        self.assertEqual(self.enviados, [])
        self.assertEqual(p.rechazados, 2)

    def test_extraer(self):
        self.assertIsNone(extraer_registro("1,2,3"))
        self.assertIsNone(extraer_registro("SHM {roto"))
        self.assertEqual(extraer_registro('SHM {"a":1}'), {"a": 1})


if __name__ == "__main__":
    unittest.main()
