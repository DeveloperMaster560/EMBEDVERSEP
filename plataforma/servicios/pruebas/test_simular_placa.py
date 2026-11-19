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

    # ------------------------------------------------ SPI y puertos serie
    def test_max31865_por_spi_de_software_con_adafruit(self):
        # Nodo 5 de la prueba de arquitectura: Uno con el MAX31865 en pines sueltos (SPI a mano).
        d = self.sketch("#include <Adafruit_MAX31865.h>\nAdafruit_MAX31865 pt(10, 11, 12, 13);\n"
                        "void setup(){ Serial.begin(115200); pt.begin(MAX31865_3WIRE); }\n"
                        "void loop(){ Serial.print(\"t=\"); Serial.println(pt.temperature(100.0, 430.0)); delay(1000); }\n")
        esc = self.escenario("#@ conectar MAX31865 cs=10 mosi=11 miso=12 sck=13\nt_s,rtd\n0,21.5\n2,\n4,-40\n")
        r = ejecutar(compilar(d, self.tmp / "b", placa="arduino-uno"), esc, 5.5, 0)
        t = [float(l.strip()[2:]) for l in r.serie if l.startswith("t=")]
        self.assertAlmostEqual(t[0], 21.5, delta=0.05)
        self.assertGreater(t[2], 900)                 # RTD abierto: fondo de escala, como el real
        self.assertAlmostEqual(t[-1], -40, delta=0.1)

    def test_lora_de_un_nodo_simulado_a_otro(self):
        # Transmisor y receptor con RadioLib real; el receptor por interrupción en DIO0.
        tx = self.sketch("#include <RadioLib.h>\nSX1276 radio = new Module(10, 2, 9);\n"
                         "void setup(){ Serial.begin(115200); Serial.println(radio.begin(915.0)); }\n"
                         "void loop(){ char m[24]; snprintf(m, sizeof m, \"N1,%lu\", millis()/1000); "
                         "radio.transmit(m); delay(10000); }\n")
        aire = self.tmp / "aire.txt"
        r = ejecutar(compilar(tx, self.tmp / "b", placa="arduino-uno"),
                     self.escenario("t_s\n0\n"), 25, 0, conexiones=["SX1276 cs=10 dio0=2 rst=9"], aire=aire, nombre="n1")
        self.assertEqual(r.serie[0].strip(), "0")
        self.assertEqual(len(aire.read_text().splitlines()), 3)
        rx = RAIZ / "firmware" / "lora-receptor"
        esc = self.escenario("#@ conectar SX1276 cs=18 dio0=26 rst=14\nt_s,rssi,snr\n0,-101,-3.5\n")
        r = ejecutar(compilar(rx, self.tmp / "c"), esc, 25, 0, aire=aire, nombre="receptor")
        recibidos = [l.strip() for l in r.serie if l.startswith("N1,")]
        self.assertEqual(recibidos, ["N1,0", "N1,10", "N1,20"])
        # El registro guarda el RSSI en pasos de 1 dB: -101 se informa como -100,5.
        self.assertIn("# rssi -100 dBm  snr -3.5 dB", [l.strip() for l in r.serie])
        # Otra configuración (SF12) no recibe nada, y lo dice.
        otra = self.escenario("#@ conectar SX1276 cs=18 dio0=26 rst=14\nt_s\n0\n")
        (self.tmp / "rx12").mkdir()
        for f in rx.iterdir():
            (self.tmp / "rx12" / f.name).write_text(f.read_text().replace("LORA_SF     9", "LORA_SF     12"))
        r = ejecutar(compilar(self.tmp / "rx12", self.tmp / "d"), otra, 25, 0, aire=aire, nombre="receptor")
        self.assertFalse([l for l in r.serie if l.startswith("N1,")])
        self.assertTrue(any("factor de dispersión" in n for n in r.notas))

    def test_gps_por_softwareserial_con_tinygpsplus(self):
        d = self.sketch("#include <SoftwareSerial.h>\n#include <TinyGPSPlus.h>\nSoftwareSerial g(4, 3); TinyGPSPlus gps;\n"
                        "void setup(){ Serial.begin(115200); g.begin(9600); }\n"
                        "void loop(){ while (g.available()) gps.encode(g.read());\n"
                        "  static unsigned long u = 0; if (millis() - u < 3000) return; u = millis();\n"
                        "  if (gps.location.isValid()) { Serial.print(gps.location.lat(), 5); Serial.print(' ');\n"
                        "    Serial.println(gps.location.lng(), 5); } else Serial.println(\"sin fix\"); }\n")
        esc = self.escenario("#@ conectar GPS rx=4\nt_s,latitud,longitud,altitud,satelites,hdop\n0,,,,0,99\n"
                             "4,7.06500,-73.85400,960,7,1.1\n")
        r = ejecutar(compilar(d, self.tmp / "b", placa="arduino-uno"), esc, 10, 1_795_000_000_000)
        lineas = [l.strip() for l in r.serie]
        self.assertEqual(lineas[0], "sin fix")        # arranque sin posición
        self.assertEqual(lineas[-1], "7.06500 -73.85400")

    def test_gps_a_otra_velocidad_da_basura(self):
        d = self.sketch("#include <TinyGPSPlus.h>\nTinyGPSPlus gps;\n"
                        "void setup(){ Serial.begin(115200); Serial2.begin(4800); }\n"
                        "void loop(){ while (Serial2.available()) gps.encode(Serial2.read()); delay(10); }\n")
        esc = self.escenario("#@ conectar GPS serie=Serial2 baudios=9600\nt_s,latitud,longitud\n0,7,-73\n")
        r = ejecutar(compilar(d, self.tmp / "b"), esc, 3, 0)
        self.assertTrue(any("4800 baudios y GPS 9600" in n for n in r.notas))

    def test_bufer_serie_se_desborda_si_no_se_lee(self):
        d = self.sketch("void setup(){ Serial.begin(115200); Serial2.begin(9600); delay(3000); "
                        "int n = 0; while (Serial2.available()) { Serial2.read(); n++; } Serial.println(n); }\n"
                        "void loop(){ delay(1000); }\n")
        esc = self.escenario("#@ conectar GPS serie=Serial2\nt_s,latitud,longitud\n0,7,-73\n")
        r = ejecutar(compilar(d, self.tmp / "b", placa="arduino-uno"), esc, 4, 0)
        self.assertEqual(r.serie[0].strip(), "64")    # búfer del AVR
        self.assertTrue(any("se perdieron bytes" in n for n in r.notas))

    def test_pzem004t_y_modbus_generico(self):
        d = self.sketch("#include <PZEM004Tv30.h>\nPZEM004Tv30 pzem(Serial2, 16, 17);\n"
                        "void setup(){ Serial.begin(115200); }\n"
                        "void loop(){ Serial.printf(\"%.1f %.3f %.3f\\n\", pzem.voltage(), pzem.current(), pzem.energy()); delay(2000); }\n")
        esc = self.escenario("#@ conectar PZEM004T serie=Serial2\nt_s,tension,corriente,energia\n0,121.3,2.512,12.345\n3,\n")
        r = ejecutar(compilar(d, self.tmp / "b"), esc, 5, 0)
        # Comportamiento REAL de PZEM004Tv30 1.2.1 (el simulador ejecuta su código):
        #  · antes de 200 ms desde el arranque no pregunta y devuelve ceros (_lastRead = -1);
        #  · tras una lectura fallida, voltage() da NaN pero current()/energy() devuelven los
        #    valores VIEJOS durante 200 ms, como si fueran nuevos.
        self.assertEqual([l.strip() for l in r.serie], ["0.0 0.000 0.000", "121.3 2.512 12.345", "nan 2.512 12.345"])
        d = self.tmp / "mb"
        d.mkdir()
        (d / "mb.ino").write_text(
            "#include <ModbusMaster.h>\nModbusMaster n;\nvoid setup(){ Serial.begin(115200); Serial2.begin(9600); n.begin(1, Serial2); }\n"
            "void loop(){ uint8_t r = n.readHoldingRegisters(0, 2);\n"
            "  if (r) Serial.printf(\"error %d\\n\", r); else Serial.printf(\"%d %d\\n\", (int16_t)n.getResponseBuffer(0), (int16_t)n.getResponseBuffer(1));\n"
            "  r = n.readHoldingRegisters(7, 1); Serial.printf(\"error %d\\n\", r); delay(3000); }\n", encoding="utf-8")
        esc = self.escenario("#@ conectar MODBUS serie=Serial2 dir=1 r0=caudal*10 r1=temperatura*100\n"
                             "t_s,caudal,temperatura\n0,12.5,-3.25\n2,,1\n")
        r = ejecutar(compilar(d, self.tmp / "c"), esc, 4, 0)
        # 0x02 = dirección ilegal (registro 7 no declarado); 0x04 = falla del equipo (columna vacía)
        self.assertEqual([l.strip() for l in r.serie], ["125 -325", "error 2", "error 4", "error 2"])

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
