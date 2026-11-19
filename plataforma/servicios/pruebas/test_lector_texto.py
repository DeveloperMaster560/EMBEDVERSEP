import json
import unittest

from shm_plataforma.contrato_medidas import validate_measurement_message
from shm_plataforma.lector_texto import LectorTexto, problemas_de_lectura
from shm_plataforma.pasarela_serie import Pasarela
from shm_plataforma.proyecto import validar

T = 1_795_000_000.0   # 2026-11-18T…Z


def sensor(sid, magnitud, unidad, **lectura):
    return {"id": sid, "modelo": "prueba", "magnitud": magnitud, "unidad": unidad, "lectura": lectura}


UNO = {  # Arduino Uno + PT100 + INA219 que imprime «t=24.31 mA=12.70» (nodo 5 de la prueba)
    "id": "LAB-UNO-01", "hardware": {"firmware_version": "uno-pt100-0.1"},
    "sensores": [sensor("PT100-1", "temperatura", "degC", campo="t"), sensor("INA219-1", "corriente", "mA", campo="mA")],
}
AGUA = {  # STM32 por LoRa: «AGUA,19.5,3.2,7.1» (nodo 2)
    "id": "RIO-AGUA-01", "comunicacion": {"protocolo": "lora", "periodo_s": 60, "prefijo": "AGUA"},
    "sensores": [sensor("DS18B20-1", "temperatura", "degC", columna=0, sin_lectura=[-127, 85]),
                 sensor("TURB-1", "turbidez", "NTU", columna=1), sensor("PH-1", "ph", "pH", columna=2)],
}
AIRE = {
    "id": "RIO-AIRE-01", "comunicacion": {"protocolo": "lora", "periodo_s": 60, "prefijo": "AIRE"},
    "sensores": [sensor("SCD41-1", "co2", "ppm", campo="co2")],
}


class TestLectorTexto(unittest.TestCase):
    def test_clave_valor(self):
        m = LectorTexto(UNO).medida("t=24.31 mA=12.70\r\n", T)
        self.assertEqual(validate_measurement_message(m), [])
        self.assertEqual([x["value"] for x in m["measurements"]], [24.31, 12.7])
        self.assertEqual((m["station_id"], m["firmware_version"], m["time_quality"]), ("LAB-UNO-01", "uno-pt100-0.1", "NTP"))

    def test_otras_formas_de_clave_valor(self):
        lec = LectorTexto(UNO)
        for linea in ("T: 24.31, MA: 12.7", "t = 24.31; mA = 12.7", "lectura t=24.31 mA=12.7 ok"):
            self.assertEqual([x["value"] for x in lec.medida(linea, T)["measurements"]], [24.31, 12.7], linea)

    def test_nada_se_inventa(self):
        m = LectorTexto(UNO).medida("t=nan mA=abc", T)
        self.assertEqual(validate_measurement_message(m), [])
        self.assertEqual([x["value"] for x in m["measurements"]], [None, None])
        self.assertIn("no leyó", m["measurements"][0]["error"])
        self.assertIn("no es un número", m["measurements"][1]["error"])
        falta = LectorTexto(UNO).medida("t=20.5", T)["measurements"][1]
        self.assertEqual((falta["value"], falta["error"]), (None, "la línea no trae «mA»"))

    def test_un_centinela_no_tira_las_demas_medidas(self):
        m = LectorTexto(UNO).medida("t=-999 mA=12.7", T)
        self.assertEqual(validate_measurement_message(m), [])
        self.assertEqual([x["value"] for x in m["measurements"]], [None, 12.7])
        self.assertIn("centinela", m["measurements"][0]["error"])

    def test_un_valor_imposible_tampoco(self):
        # Nodo 2 de la prueba: el STM32 lee 10 bits y el sketch divide entre 4095.
        m = LectorTexto(AGUA).medida("AGUA,19.50,-1838.3,18.11", T)
        self.assertEqual(validate_measurement_message(m), [])
        self.assertEqual([x["value"] for x in m["measurements"]], [19.5, None, None])
        self.assertIn("mínimo 0", m["measurements"][1]["error"])
        self.assertIn("conversión del firmware", m["measurements"][2]["error"])

    def test_lineas_sin_sensores_se_ignoran(self):
        self.assertIsNone(LectorTexto(UNO).medida("Iniciando sensores...", T))
        self.assertIsNone(LectorTexto(UNO).medida("ets Jun  8 2016 00:22:57", T))

    def test_columnas_prefijo_y_sin_lectura_del_fabricante(self):
        lec = LectorTexto(AGUA)
        m = lec.medida("AGUA,19.50,3.2,7.10", T)
        self.assertEqual(validate_measurement_message(m), [])
        self.assertEqual([x["value"] for x in m["measurements"]], [19.5, 3.2, 7.1])
        m = lec.medida("AGUA,-127.00,3.2", T)["measurements"]
        self.assertIsNone(m[0]["value"])
        self.assertIn("«sin lectura»", m[0]["error"])
        self.assertEqual(m[2]["error"], "la línea no trae la columna 2")
        self.assertIsNone(lec.medida("AIRE,co2=600", T))
        self.assertIsNone(lec.medida("AGUADULCE,1,2,3", T))
        self.assertEqual([x["value"] for x in lec.medida("AGUA 19.5 3.2 7.1", T)["measurements"]], [19.5, 3.2, 7.1])

    def test_validacion_de_lectura(self):
        self.assertEqual(problemas_de_lectura({"campo": "t"}), [])
        self.assertEqual(problemas_de_lectura({"columna": 0, "sin_lectura": [-127]}), [])
        self.assertTrue(problemas_de_lectura({"campo": "t", "columna": 1}))
        self.assertTrue(problemas_de_lectura({}))
        self.assertTrue(problemas_de_lectura({"columna": -1}))
        self.assertTrue(problemas_de_lectura({"campo": "t", "factor": 10}))

    def test_proyecto_valida_lectura_y_prefijo(self):
        with open("../../proyectos/laboratorio/proyecto.json", encoding="utf-8") as f:
            d = json.load(f)
        e = d["estaciones"][0]
        e["comunicacion"] = {"protocolo": "lora", "periodo_s": 60, "prefijo": "AGUA"}
        e["sensores"][0]["lectura"] = {"columna": 0}
        self.assertEqual(validar(d), [])
        e["comunicacion"]["prefijo"] = "con espacios"
        e["sensores"][0]["lectura"] = {"columna": "0"}
        problemas = " ".join(validar(d))
        self.assertIn("prefijo", problemas)
        self.assertIn("lectura.columna", problemas)


class TestPasarelaVariasEstaciones(unittest.TestCase):
    """Un receptor LoRa por USB que recibe de dos estaciones."""

    def test_reparte_por_prefijo_y_publica_cada_una_en_lo_suyo(self):
        enviados, texto = [], []
        p = Pasarela(["RIO-AGUA-01", "RIO-AIRE-01"], lambda t, c: enviados.append((t, json.loads(c))),
                     None, salida=texto.append, lectores=[LectorTexto(AGUA), LectorTexto(AIRE)], reloj=lambda: T)
        for linea in ("# rssi -97", "AGUA,19.5,3.2,7.1", "AIRE co2=612", "basura", "AGUA,85,3.3,7.0"):
            p.linea(linea)
        self.assertEqual([t for t, _ in enviados],
                         ["shm/v1/RIO-AGUA-01/medida", "shm/v1/RIO-AIRE-01/medida", "shm/v1/RIO-AGUA-01/medida"])
        self.assertEqual(enviados[1][1]["measurements"][0]["value"], 612.0)
        self.assertIsNone(enviados[2][1]["measurements"][0]["value"])     # 85 = DS18B20 recién encendido
        self.assertIn("placa: # rssi -97", texto)
        self.assertTrue(any(x.startswith("(ignorada") and "basura" in x for x in texto))

    def test_un_registro_json_de_otra_estacion_no_se_publica(self):
        enviados, texto = [], []
        p = Pasarela(["RIO-AGUA-01"], lambda t, c: enviados.append(t), None, salida=texto.append,
                     lectores=[LectorTexto(AGUA)], reloj=lambda: T)
        otro = LectorTexto(AIRE).medida("AIRE co2=600", T)
        p.linea("MEDIDA " + json.dumps(otro))
        self.assertEqual(enviados, [])
        self.assertTrue(any("RIO-AIRE-01" in x for x in texto))


if __name__ == "__main__":
    unittest.main()
