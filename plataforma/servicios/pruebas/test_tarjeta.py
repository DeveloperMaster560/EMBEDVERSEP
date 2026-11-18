"""Extracción de una tarjeta escrita por el anillo del firmware (make ring-test)."""

import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

from shm_plataforma.crudo import leer
from shm_plataforma.tarjeta import TarjetaInvalida, extraer

FW = Path(__file__).resolve().parents[3] / "firmware" / "shm-station"


@unittest.skipIf(shutil.which("cc") is None, "sin cc")
class TarjetaDelFirmware(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = Path(tempfile.mkdtemp())
        cls.img = cls.tmp / "tarjeta.img"
        (FW / "build").mkdir(exist_ok=True)
        subprocess.run(["cc", "-std=c11", "-Wall", "-Wextra", "-Werror", "-O1", "-Iinclude", "src/station.c", "src/shmbin.c",
                        "src/sdring.c", "src/sdring_test.c", "-lm", "-o", "build/sdring_test"], cwd=FW, check=True)
        subprocess.run([str(FW / "build" / "sdring_test"), str(cls.img)], cwd=FW, check=True, capture_output=True)

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.tmp, ignore_errors=True)

    def test_extrae_la_ultima_vuelta_y_marca_lo_danado(self):
        inf = extraer(self.img, self.tmp / "salida")
        self.assertEqual((inf.estacion, inf.ranuras), ("SD-V2-M", 20))
        # La prueba del anillo deja: 41..60 en sus ranuras, salvo la 47 reescrita tras el corte.
        self.assertEqual([s for s, _ in inf.ventanas], list(range(41, 61)))
        self.assertEqual(inf.danadas, [])
        seq, ruta = inf.ventanas[-1]
        self.assertEqual(ruta.relative_to(self.tmp / "salida").as_posix(), "SHM/SD-V2-M/SINHORA/00000060.bin")
        v = leer(ruta.read_bytes())
        self.assertEqual((v.secuencia, v.muestras), (60, 2000))

    def test_ranura_danada_se_informa_y_no_se_extrae(self):
        img = self.tmp / "danada.img"
        b = bytearray(self.img.read_bytes())
        b[(2048 + 5 * 48) * 512 + 3000] ^= 0xFF   # datos de la ranura 5
        img.write_bytes(bytes(b))
        inf = extraer(img, self.tmp / "salida2")
        self.assertEqual(len(inf.ventanas), 19)
        self.assertEqual(inf.danadas[0][0], 5)
        self.assertIn("CRC de los datos", inf.danadas[0][1])

    def test_lo_que_no_es_una_tarjeta_de_estacion(self):
        otro = self.tmp / "otro.img"
        otro.write_bytes(b"\0" * 4096)
        with self.assertRaises(TarjetaInvalida):
            extraer(otro, self.tmp / "nada")
