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

    def escenario(self, texto: str) -> Path:
        f = self.tmp / "esc.csv"
        f.write_text(texto, encoding="utf-8")
        return f

    def test_chip_sin_modelo_se_ve_desconectado(self):
        # Adafruit SCD30 se compila con su biblioteca REAL; aún no hay modelo del chip:
        # la placa lo ve como un sensor desconectado (NACK), nunca con datos inventados.
        d = self.sketch("#include <Adafruit_SCD30.h>\nAdafruit_SCD30 s;\n"
                        "void setup(){ Serial.begin(115200); Serial.println(s.begin() ? \"SI\" : \"NO\"); }\n"
                        "void loop(){ delay(1000); }\n")
        r = ejecutar(compilar(d, self.tmp / "b"), ESCENARIO, 1, 0)
        self.assertIn("NO", r.serie)

    def test_mpu6050_con_la_biblioteca_real_de_adafruit(self):
        d = self.sketch("#include <Adafruit_MPU6050.h>\nAdafruit_MPU6050 m;\n"
                        "void setup(){ Serial.begin(115200); if(!m.begin()){ Serial.println(\"SIN\"); }\n"
                        "  m.setAccelerometerRange(MPU6050_RANGE_4_G); }\n"
                        "void loop(){ sensors_event_t a,g,t; m.getEvent(&a,&g,&t);\n"
                        "  Serial.printf(\"%.3f %.3f %.4f %.2f\\n\", a.acceleration.x, a.acceleration.z, g.gyro.z, t.temperature);"
                        " delay(1000); }\n")
        esc = self.escenario("t_s,acel_x,acel_y,acel_z,giro_x,giro_y,giro_z,temperatura\n0,0.5,0,9.81,0,0,10,25\n10,0.5,0,9.81,0,0,10,25\n")
        r = ejecutar(compilar(d, self.tmp / "b"), esc, 3, 0)
        self.assertNotIn("SIN", r.serie)
        x, z, gz, t = map(float, r.serie[-1].split())
        self.assertAlmostEqual(x, 0.5, delta=0.01)      # ±4 g: 8192 cuentas/g
        self.assertAlmostEqual(z, 9.81, delta=0.01)
        self.assertAlmostEqual(gz, 10 * 3.14159265 / 180, delta=0.002)   # Adafruit da rad/s
        self.assertAlmostEqual(t, 25, delta=0.01)

    def test_scd41_con_la_biblioteca_real_de_sensirion(self):
        d = self.sketch("#include <SensirionI2cScd4x.h>\n#include <Wire.h>\nSensirionI2cScd4x s;\n"
                        "void setup(){ Serial.begin(115200); Wire.begin(); s.begin(Wire, 0x62); s.startPeriodicMeasurement(); }\n"
                        "void loop(){ uint16_t c=0; float t=0, h=0; int16_t e = s.readMeasurement(c, t, h);\n"
                        "  Serial.print(e); Serial.print(' '); Serial.print(c); Serial.print(' '); Serial.print(t, 2);"
                        " Serial.print(' '); Serial.println(h, 2); delay(1000); }\n")
        esc = self.escenario("t_s,co2,temperatura,humedad\n0,612,23.5,55\n30,612,23.5,55\n")
        r = ejecutar(compilar(d, self.tmp / "b"), esc, 8, 0)
        lineas = [l.split() for l in r.serie]
        self.assertNotEqual(lineas[0][0], "0")         # antes de 5 s no hay dato: error de lectura (NACK)
        bien = [l for l in lineas if l[0] == "0"]
        self.assertTrue(bien)
        self.assertEqual(bien[0][1], "612")
        self.assertAlmostEqual(float(bien[0][2]), 23.5, delta=0.01)
        self.assertAlmostEqual(float(bien[0][3]), 55, delta=0.01)

    def test_la_placa_importa(self):
        wifi = self.sketch("#include <WiFi.h>\nvoid setup(){ WiFi.begin(\"a\",\"b\"); }\nvoid loop(){}\n")
        with self.assertRaises(ErrorSimulacion) as e:
            compilar(wifi, self.tmp / "b", placa="arduino-uno")
        self.assertIn("no tiene Wi-Fi", str(e.exception))
        # Serial.printf no existe en un Uno (sí en un ESP32).
        pf = self.tmp / "pf"
        pf.mkdir()
        (pf / "pf.ino").write_text('void setup(){ Serial.printf("%d", 1); }\nvoid loop(){}\n', encoding="utf-8")
        with self.assertRaises(ErrorSimulacion):
            compilar(pf, self.tmp / "c", placa="arduino-uno")
        # El búfer I2C del AVR es de 32 bytes: una escritura de 40 falla (endTransmission = 1).
        i2c = self.tmp / "i2c"
        i2c.mkdir()
        (i2c / "i2c.ino").write_text("#include <Wire.h>\nvoid setup(){ Serial.begin(9600); Wire.begin(); Wire.beginTransmission(0x23);"
                                     " for(int i=0;i<40;i++) Wire.write(0x10); Serial.println(Wire.endTransmission()); }\n"
                                     "void loop(){ delay(1000); }\n", encoding="utf-8")
        self.assertEqual(ejecutar(compilar(i2c, self.tmp / "d", placa="arduino-uno"), ESCENARIO, 1, 0).serie, ["1"])
        self.assertEqual(ejecutar(compilar(i2c, self.tmp / "e", placa="esp32-devkit"), ESCENARIO, 1, 0).serie, ["0"])

    def test_lo_que_no_se_puede_simular_lo_dice(self):
        d = self.sketch("#include <avr/io.h>\n#include <AsyncMqttClient.h>\nvoid setup(){}\nvoid loop(){}\n")
        with self.assertRaises(ErrorSimulacion) as e:
            compilar(d, self.tmp / "b", placa="arduino-uno")
        self.assertIn("registros del microcontrolador (avr/io.h)", str(e.exception))

    def test_biblioteca_no_oficial_con_sugerencia(self):
        d = self.sketch("#include <AsyncMqttClient.h>\nvoid setup(){}\nvoid loop(){}\n")
        with self.assertRaises(ErrorSimulacion) as e:
            compilar(d, self.tmp / "b")
        self.assertIn("AsyncMqttClient.h", str(e.exception))
        self.assertIn("no es de la biblioteca oficial (la dan: AsyncMqttClient", str(e.exception))

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
