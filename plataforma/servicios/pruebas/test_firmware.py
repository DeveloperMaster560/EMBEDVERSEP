"""
De punta a punta sin red: el firmware real (compilado para el ordenador) →
registros → núcleo de ingesta. Se omite si no hay compilador de C.
"""

import json
import shutil
import subprocess
import unittest
from datetime import datetime, timezone
from pathlib import Path

from shm_plataforma.ingesta import Ingestor, RepositorioMemoria

FW = Path(__file__).resolve().parents[3] / "firmware" / "shm-station"
SIM = FW / "build" / "shm-sim"
FEED = FW / "renode" / "feeds" / "sd-v2-m.csv"


@unittest.skipIf(shutil.which("make") is None or shutil.which("cc") is None, "sin make/cc")
class FirmwareAIngesta(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        subprocess.run(["make", "-s", "sim"], cwd=FW, check=True)
        out = subprocess.run([str(SIM), str(FEED), "--seconds", "60", "--fault", "sensor@15-25", "--fault", "pps@32-45"],
                             cwd=FW, check=True, capture_output=True, text=True).stdout
        cls.lineas = [l for l in out.splitlines() if l.startswith("{")]

    def test_todo_registro_del_firmware_entra(self):
        repo = RepositorioMemoria(["SD-V2-M"])
        ing = Ingestor(repo)
        ahora = datetime.now(timezone.utc)
        acciones = [ing.procesar("shm/v1/SD-V2-M/registro", l.encode(), ahora).accion for l in self.lineas]
        self.assertGreaterEqual(len(self.lineas), 5)
        self.assertEqual(set(acciones), {"guardado"}, repo.rechazos)
        codigos = {a.codigo for a in repo.avisos}
        self.assertIn("SENSOR_FAULT", codigos)
        self.assertIn("TIME_HOLDOVER", codigos)
        # Las ventanas del firmware son contiguas: no debe haber huecos ni solapes.
        self.assertFalse({"HUECO_TEMPORAL", "SOLAPE_TEMPORAL"} & codigos, [a.detalle for a in repo.avisos])
        # Ninguna ventana sale con un estado que la ingesta clasifique como evento estructural.
        self.assertTrue(all(a.nivel in ("E0", "E1", "E2") for a in repo.avisos))

    def test_reenvio_completo_es_idempotente(self):
        repo = RepositorioMemoria(["SD-V2-M"])
        ing = Ingestor(repo)
        ahora = datetime.now(timezone.utc)
        for l in self.lineas:
            ing.procesar("shm/v1/SD-V2-M/registro", l.encode(), ahora)
        n = len(repo.ventanas)
        segunda = [ing.procesar("shm/v1/SD-V2-M/registro", l.encode(), ahora).accion for l in self.lineas]
        self.assertEqual(set(segunda), {"duplicado"})
        self.assertEqual(len(repo.ventanas), n)
        json.loads(self.lineas[0])


if __name__ == "__main__":
    unittest.main()
