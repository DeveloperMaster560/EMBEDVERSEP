"""El generador explica qué falta y cómo arreglarlo cuando el Python no tiene sus bibliotecas."""
import unittest

import deps


class MensajeDependencia(unittest.TestCase):
    def test_modulo_ausente_nombra_paquete_interprete_y_arreglo(self):
        exc = ModuleNotFoundError("No module named 'mapbox_earcut'", name="mapbox_earcut")
        m = deps.mensaje_dependencia(exc)
        self.assertIn("mapbox-earcut", m)          # nombre de pip, no del módulo
        self.assertIn("setup_generator", m)
        self.assertIn("Python ", m)

    def test_submodulo_se_reduce_al_paquete(self):
        exc = ModuleNotFoundError("No module named 'shapely.geometry'", name="shapely.geometry")
        self.assertIn("«shapely»", deps.mensaje_dependencia(exc))

    def test_otros_errores_no_se_disfrazan(self):
        self.assertIsNone(deps.mensaje_dependencia(ValueError("luz negativa")))
        self.assertIsNone(deps.mensaje_dependencia(ImportError("sin nombre")))


if __name__ == "__main__":
    unittest.main()
