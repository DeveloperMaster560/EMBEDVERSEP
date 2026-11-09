"""Comprueba que las propiedades derivadas son exactas y que no se inventa nada."""

import math
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import engineering as ENG


class TestSeccionesLineales(unittest.TestCase):
    def test_viga_usa_el_alma_y_lo_declara(self):
        dims = {"span": 6.0, "width": 0.30, "web_depth": 0.28,
                "total_depth_with_slab": 0.40}
        s = ENG.section_properties("beam", dims)
        self.assertEqual(s["shape"], "rectangular")
        self.assertAlmostEqual(s["width_m"], 0.30)
        self.assertAlmostEqual(s["height_m"], 0.28)
        self.assertAlmostEqual(s["area_m2"], 0.30 * 0.28, places=9)
        self.assertAlmostEqual(s["inertia_x_m4"], 0.30 * 0.28 ** 3 / 12, places=9)
        # El canto con losa no debe colarse como si fuera la seccion.
        self.assertNotAlmostEqual(s["height_m"], 0.40)
        self.assertIn("ancho eficaz", s["note"])

    def test_columna_cuadrada(self):
        s = ENG.section_properties("column", {"width": 0.4, "depth": 0.4, "height": 3.2})
        self.assertAlmostEqual(s["inertia_x_m4"], 0.4 ** 4 / 12, places=9)
        self.assertAlmostEqual(s["section_modulus_x_m3"], 0.4 ** 4 / 12 / 0.2, places=9)

    def test_pila_circular(self):
        s = ENG.section_properties("pier_column", {"diameter": 1.2, "height": 20.0})
        self.assertEqual(s["shape"], "circular")
        self.assertAlmostEqual(s["inertia_x_m4"], math.pi * 1.2 ** 4 / 64, places=9)
        self.assertAlmostEqual(s["area_m2"], math.pi * 1.2 ** 2 / 4, places=7)
        self.assertAlmostEqual(s["inertia_x_m4"], s["inertia_y_m4"])


class TestPlacas(unittest.TestCase):
    def test_losa_da_propiedades_por_metro_no_una_seccion_inventada(self):
        dims = {"length": 24.0, "width": 18.0, "thickness": 0.12}
        s = ENG.section_properties("floor_slab", dims)
        self.assertEqual(s["shape"], "placa")
        self.assertAlmostEqual(s["inertia_per_m_width_m4_per_m"], 0.12 ** 3 / 12, places=9)
        self.assertAlmostEqual(s["plan_area_m2"], 24.0 * 18.0, places=6)
        # No debe aparecer una seccion rectangular de 0.12 x 18 m.
        self.assertNotIn("inertia_x_m4", s)
        self.assertIn("no tiene", s["note"])

    def test_tramo_de_escalera_usa_el_espesor_de_losa(self):
        s = ENG.section_properties("stair_flight",
                                   {"width": 1.5, "run": 2.52, "rise": 1.8, "waist": 0.15})
        self.assertAlmostEqual(s["thickness_m"], 0.15)


class TestNoInventar(unittest.TestCase):
    def test_tipos_sin_seccion_util_devuelven_nada(self):
        for tipo in ("beam_column_joint", "expansion_joint", "bearing"):
            self.assertIsNone(ENG.section_properties(tipo, {"width": 1.0, "depth": 1.0}))

    def test_tipo_desconocido_no_se_calcula_a_ojo(self):
        self.assertIsNone(ENG.section_properties("pieza_inventada",
                                                 {"width": 1.0, "depth": 2.0, "length": 3.0}))

    def test_faltan_medidas_devuelve_nada(self):
        self.assertIsNone(ENG.section_properties("column", {"height": 3.0}))
        self.assertIsNone(ENG.section_properties("floor_slab", {"length": 5.0}))

    def test_medidas_no_positivas_devuelven_nada(self):
        self.assertIsNone(ENG.section_properties("column", {"width": 0.0, "depth": 0.4}))
        self.assertIsNone(ENG.section_properties("pier_column", {"diameter": -1.2}))


class TestPesoPropio(unittest.TestCase):
    def test_masa_y_peso_exactos(self):
        w = ENG.self_weight(10.0, 2400.0)
        self.assertAlmostEqual(w["mass_kg"], 24000.0, places=3)
        self.assertAlmostEqual(w["weight_kN"], 24000.0 * 9.80665 / 1000, places=4)

    def test_sin_densidad_declarada_no_hay_peso(self):
        self.assertIsNone(ENG.self_weight(10.0, None))
        self.assertIsNone(ENG.self_weight(10.0, 0))

    def test_sin_volumen_no_hay_peso(self):
        self.assertIsNone(ENG.self_weight(0.0, 2400.0))
        self.assertIsNone(ENG.self_weight(None, 2400.0))


class TestBarras(unittest.TestCase):
    def test_area_nominal_de_barra(self):
        # Una barra de 12 mm tiene 113.1 mm2 nominales.
        self.assertAlmostEqual(ENG.rebar_nominal_area_mm2(12.0), math.pi * 12.0 ** 2 / 4, places=3)

    def test_diametro_invalido(self):
        self.assertIsNone(ENG.rebar_nominal_area_mm2(0))
        self.assertIsNone(ENG.rebar_nominal_area_mm2(-8))


class TestCobertura(unittest.TestCase):
    def test_ningun_tipo_esta_en_dos_mapas_a_la_vez(self):
        lineales = set(ENG.LINEAR_SECTIONS)
        placas = set(ENG.PLATE_THICKNESS)
        self.assertEqual(lineales & placas, set())
        self.assertEqual(lineales & ENG.NO_SECTION, set())
        self.assertEqual(placas & ENG.NO_SECTION, set())

    def test_lo_pendiente_sigue_declarado(self):
        for clave in ("specified_concrete_strength_fc", "design_loads",
                      "load_combinations", "reinforcement_layout"):
            self.assertIn(clave, ENG.STILL_PENDING)


class TestSinEmbedlib(unittest.TestCase):
    """Sin la biblioteca de calculo no se rellena nada a medias."""

    def setUp(self):
        self._guardado = ENG._EMBEDLIB
        ENG._EMBEDLIB = None

    def tearDown(self):
        ENG._EMBEDLIB = self._guardado

    def test_no_devuelve_secciones(self):
        self.assertIsNone(ENG.section_properties("column", {"width": 0.4, "depth": 0.4}))
        self.assertIsNone(ENG.section_properties("floor_slab",
                                                 {"length": 5.0, "width": 4.0, "thickness": 0.12}))
        self.assertIsNone(ENG.rebar_nominal_area_mm2(12.0))

    def test_el_informe_dice_por_que_falta(self):
        class ModeloVacio:
            components = {}
            solids = {}

        informe = ENG.enrich_structural(ModeloVacio(), {})
        self.assertFalse(informe["embedlib_available"])
        self.assertIn("note", informe)
        self.assertIn("pendientes", informe["note"])
        self.assertEqual(informe["section_properties_added"], 0)

    def test_el_peso_propio_es_aritmetica_propia_y_sigue_disponible(self):
        # No depende de embedlib: volumen por densidad. Debe seguir calculandose.
        self.assertIsNotNone(ENG.self_weight(2.0, 2400.0))


if __name__ == "__main__":
    unittest.main(verbosity=2)
