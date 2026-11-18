"""El lector de crudos contra el archivo que escribe el firmware (make host-test)."""

import json
import shutil
import struct
import subprocess
import unittest
import zlib
from pathlib import Path

from shm_plataforma.crudo import CrudoInvalido, contrastar, leer

FW = Path(__file__).resolve().parents[3] / "firmware" / "shm-station"
EJEMPLO = FW / "pruebas" / "ventana-ejemplo.bin"


class ArchivoDelFirmware(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.bin = EJEMPLO.read_bytes()
        cls.meta = json.loads((FW / "pruebas" / "ventana-ejemplo.bin.json").read_text())

    def test_se_lee_y_cuadra_con_su_registro(self):
        v = leer(self.bin)
        self.assertEqual((v.station_id, v.secuencia, v.muestras, v.ejes), ("SD-V2-M", 12345, 2000, 3))
        self.assertEqual(v.calidad_tiempo, "GNSS_LOCKED")
        self.assertEqual(v.muestreo_hz, 200.0)
        self.assertEqual(v.inicio_rfc3339, "2026-11-18T12:00:00.000Z")
        self.assertEqual(contrastar(v, self.meta["registro"]), [])

    def test_los_huecos_son_nan_y_no_cero(self):
        v = leer(self.bin)
        self.assertEqual(v.huecos, 21)  # 0, 97, …, 1940
        self.assertEqual(v.huecos_en_datos(), 21)
        self.assertNotEqual(v.datos[1], (0.0, 0.0, 0.0))
        self.assertEqual(v.saturadas, 1)

    def test_archivo_a_medias(self):
        with self.assertRaisesRegex(CrudoInvalido, "incompleto"):
            leer(self.bin[:-100])
        with self.assertRaisesRegex(CrudoInvalido, "Cabecera incompleta"):
            leer(self.bin[:100])

    def test_datos_o_cabecera_alterados(self):
        b = bytearray(self.bin)
        b[5000] ^= 0xFF
        with self.assertRaisesRegex(CrudoInvalido, "CRC de los datos"):
            leer(bytes(b))
        b = bytearray(self.bin)
        b[30] ^= 0x01  # sample_count
        with self.assertRaisesRegex(CrudoInvalido, "CRC de la cabecera"):
            leer(bytes(b))
        with self.assertRaisesRegex(CrudoInvalido, "firma"):
            leer(b"PK\x03\x04" + self.bin[4:])

    def test_version_desconocida(self):
        b = bytearray(self.bin)
        struct.pack_into("<H", b, 4, 2)
        struct.pack_into("<I", b, 156, zlib.crc32(bytes(b[:156])) & 0xFFFFFFFF)
        with self.assertRaisesRegex(CrudoInvalido, "Versión SHMW 2"):
            leer(bytes(b))

    def test_registro_que_no_es_de_este_archivo(self):
        r = dict(self.meta["registro"], samples_crc32="00000000", station_id="SD-V1-Q1")
        problemas = contrastar(leer(self.bin), r)
        self.assertEqual(len(problemas), 2)


@unittest.skipIf(shutil.which("make") is None or shutil.which("cc") is None, "sin make/cc")
class FirmwareRegeneraElMismoArchivo(unittest.TestCase):
    def test_el_firmware_actual_escribe_exactamente_el_ejemplo(self):
        salida = FW / "build" / "ventana-actual.bin"
        salida.parent.mkdir(exist_ok=True)
        subprocess.run(["cc", "-std=c11", "-Wall", "-Wextra", "-Werror", "-O1", "-Iinclude", "src/station.c",
                        "src/shmbin.c", "src/host_test.c", "-lm", "-o", "build/host_test"], cwd=FW, check=True)
        subprocess.run(["build/host_test", str(salida)], cwd=FW, check=True, capture_output=True)
        self.assertEqual(salida.read_bytes(), EJEMPLO.read_bytes(),
                         "El formato cambió: si es a propósito, sube la versión y regenera con make host-test.")
