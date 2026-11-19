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


class TestExpedienteSinBibliotecas(unittest.TestCase):
    """build.py moria a mitad del expediente con un ImportError de ifcopenshell."""

    def test_se_detiene_antes_de_escribir_y_lo_explica(self):
        import contextlib
        import io
        import os
        import tempfile

        import build

        original = build.missing_package_libraries
        build.missing_package_libraries = lambda: ["ifcopenshell"]
        salida = io.StringIO()
        try:
            with tempfile.TemporaryDirectory() as tmp, contextlib.redirect_stdout(salida):
                code = build.main(["build.py", tmp])
                self.assertEqual(os.listdir(tmp), [])
        finally:
            build.missing_package_libraries = original
        self.assertEqual(code, 2)
        self.assertIn("ifcopenshell", salida.getvalue())
        self.assertIn("IFC4", salida.getvalue())


if __name__ == "__main__":
    unittest.main()
