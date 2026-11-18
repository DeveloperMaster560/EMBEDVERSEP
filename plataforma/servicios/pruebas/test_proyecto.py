"""El archivo de proyecto: el de La Novena es válido y los errores típicos se detectan."""

import copy
import json
import tempfile
import unittest
from pathlib import Path

from shm_plataforma.proyecto import ProyectoInvalido, cargar, cargar_carpeta, validar

RAIZ = Path(__file__).resolve().parents[3]
NOVENA = RAIZ / "proyectos" / "novena" / "proyecto.json"
PLANTILLA = RAIZ / "proyectos" / "PLANTILLA.proyecto.json"


def base() -> dict:
    return json.loads(NOVENA.read_text(encoding="utf-8"))


def problemas(d) -> str:
    return " | ".join(validar(d))


class ArchivosDelRepositorio(unittest.TestCase):
    def test_novena_es_valido(self):
        self.assertEqual(validar(base()), [])

    def test_plantilla_es_valida(self):
        self.assertEqual(validar(json.loads(PLANTILLA.read_text(encoding="utf-8"))), [])

    def test_la_carpeta_carga_sin_choques(self):
        ids = [p.id for p in cargar_carpeta(RAIZ / "proyectos")]
        self.assertIn("novena", ids)
        self.assertNotIn("plantilla", ids)  # la plantilla no es un proyecto real

    def test_solo_simuladas_e_instaladas_tienen_alta(self):
        d = base()
        d["estaciones"].append({**copy.deepcopy(d["estaciones"][0]), "id": "SD-V1-Q1", "estado": "diseno",
                                "sensores": []})
        pr = cargar(json.dumps(d))
        self.assertEqual([e["id"] for e in pr.estaciones_con_alta()], ["SD-V2-M"])


class Errores(unittest.TestCase):
    def test_umbral_sin_firma_se_rechaza(self):
        d = base()
        d["criterios"]["umbrales"] = [{"magnitud": "aceleracion", "valor": 0.5}]
        self.assertIn("firmado por el ingeniero", problemas(d))
        d["criterios"].update(aprobados_por="Ing. X, matrícula 123", fecha="2026-12-01", estado="aprobados")
        self.assertEqual(validar(d), [])

    def test_unidad_debe_corresponder_a_la_magnitud(self):
        d = base()
        d["estaciones"][0]["sensores"][0]["unidad"] = "degC"
        self.assertIn("la unidad de aceleracion", problemas(d))

    def test_identificadores(self):
        d = base()
        d["proyecto_id"] = "La Novena"
        d["estaciones"][0]["id"] = "sd minúscula"
        t = problemas(d)
        self.assertIn("proyecto_id", t)
        self.assertIn("MAYÚSCULAS", t)

    def test_estacion_repetida_entre_proyectos(self):
        with tempfile.TemporaryDirectory() as tmp:
            for pid in ("uno", "dos"):
                d = base()
                d["proyecto_id"] = pid
                d["estaciones"][0]["sensores"][0]["id"] = f"S-{pid}"
                (Path(tmp) / pid).mkdir()
                (Path(tmp) / pid / "proyecto.json").write_text(json.dumps(d), encoding="utf-8")
            with self.assertRaises(ProyectoInvalido) as e:
                cargar_carpeta(Path(tmp))
            self.assertIn("únicos en todo el servidor", str(e.exception))

    def test_json_roto(self):
        with self.assertRaises(ProyectoInvalido):
            cargar("{ no es json")


if __name__ == "__main__":
    unittest.main()
