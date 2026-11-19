"""Pruebas de la tipologia de vivienda (casa unifamiliar).

Hasta el 19/11/2026 una casa no se podia generar: el unico esquema era el de
oficinas (nucleo central, anillo de circulacion y cuatro bandas), que exige
15 m de lado. «Casa unifamiliar de 2 pisos de 12 x 9 m» se rechazaba con
«La longitud debe estar entre 15 y 120».

Se comprueba que la casa de ese enunciado genera un GLB valido con la
instalacion electrica (tablero y circuitos), que se rechaza con un mensaje
claro lo que la tipologia no puede construir, y que no se inventan recintos.
"""

import base64
import io
import math
import unittest

import numpy as np
import trimesh

import generate_scene as G

CASA = {
    "project_name": "Casa unifamiliar de 2 pisos",
    "building_use": "vivienda",
    "levels": 2, "length_x_m": 12, "width_y_m": 9,
    "clear_height_m": 2.5, "floor_to_floor_m": 2.8,
    "residential_program": {"dormitorio": 3, "cocina": 1, "sala": 1, "bano": 2},
    "disciplines": ["electrical"],
}


def _rechazo(spec):
    with unittest.TestCase().assertRaises(ValueError) as ctx:
        G.build_scene(spec)
    return str(ctx.exception)


class TestCasaDelEnunciado(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.r = G.build_scene(dict(CASA))
        cls.scene = trimesh.load(io.BytesIO(base64.b64decode(cls.r["glb_base64"])),
                                 file_type="glb")

    def test_glb_valido_sin_nan_y_con_las_dimensiones_pedidas(self):
        for geom in self.scene.geometry.values():
            self.assertTrue(np.isfinite(geom.vertices).all())
        # glTF es Y-arriba; la planta queda en X y en -Z.
        arch = [n for n in self.scene.graph.nodes_geometry if "EXT-" in n]
        self.assertTrue(arch)
        lo, hi = self.scene.bounds
        self.assertGreaterEqual(hi[0], 12.0 - 1e-6)
        self.assertLessEqual(lo[2], -9.0 + 1e-6)

    def test_programa_pedido_y_nada_mas(self):
        usos = [s["use"] for s in self.r["spaces"]]
        self.assertEqual(usos.count("dormitorio"), 3)
        self.assertEqual(usos.count("bano"), 2)
        self.assertEqual(usos.count("cocina"), 1)
        self.assertEqual(usos.count("sala"), 1)
        # Lo que sobra se rotula como libre, no como un recinto inventado.
        self.assertTrue(set(usos) <= {"dormitorio", "bano", "cocina", "sala",
                                       "espacio_libre", "circulacion", "escalera"})

    def test_tablero_y_circuitos_estan_en_la_escena(self):
        nodos = set(self.scene.graph.nodes_geometry)
        self.assertIn("electrical__N1__ELE-TAB-TG", nodos)
        circuitos = [c for c in self.r["components"] if c["type"] == "circuit"]
        self.assertGreaterEqual(len(circuitos), 4)
        for c in circuitos:
            self.assertIn("electrical__%s__%s" % (c["level_id"], c["component_id"]), nodos)

    def test_sin_colisiones_que_revisar(self):
        self.assertEqual(self.r["validation"]["consistency_errors"], 0)
        self.assertEqual(self.r["validation"]["actionable_clashes"], 0)

    def test_instalaciones_bajo_el_fondo_de_viga(self):
        # Con 2.50 m libres las cotas de oficina (vacio tecnico a 2.68 m)
        # quedaban dentro de las vigas.
        import params as P
        self.assertLess(P.HYP_PLENUM_ROUTING_Z, P.REQ_CLEAR_HEIGHT)
        self.assertLess(P.HYP_CEILING_HEIGHT, P.REQ_CLEAR_HEIGHT)


class TestLimitesDeLaVivienda(unittest.TestCase):
    def test_casa_demasiado_estrecha_se_rechaza_con_el_minimo(self):
        msg = _rechazo(dict(CASA, width_y_m=6.0))
        self.assertIn("al menos", msg)
        self.assertIn("vivienda", msg.lower())

    def test_disciplina_no_cubierta_se_rechaza_si_se_pide(self):
        msg = _rechazo(dict(CASA, disciplines=["hvac"]))
        self.assertIn("hvac", msg)

    def test_sin_disciplinas_se_generan_las_cubiertas_y_se_avisa(self):
        spec = dict(CASA)
        spec.pop("disciplines")
        r = G.build_scene(spec)
        self.assertEqual(set(r["counts"]["by_discipline"]),
                         {"architecture", "structure", "electrical"})
        self.assertTrue(any("no se modelan" in a for a in r["adjustments"]))

    def test_recintos_que_no_caben_se_rechazan_no_se_omiten(self):
        msg = _rechazo(dict(CASA, residential_program={"dormitorio": 12}))
        self.assertIn("No caben", msg)

    def test_una_planta_sin_programa(self):
        spec = dict(CASA, levels=1)
        spec.pop("residential_program")
        r = G.build_scene(spec)
        self.assertTrue(all(s["use"] in ("espacio_libre", "circulacion", "escalera")
                            for s in r["spaces"]))


class TestValoresInvalidos(unittest.TestCase):
    def test_texto_y_nan_dan_mensaje_claro(self):
        for valor in ("tres", float("nan"), True):
            msg = _rechazo({"levels": valor})
            self.assertIn("levels", msg)
        self.assertIn("entero", _rechazo({"levels": 2.7}))

    def test_planta_enorme_se_rechaza_antes_de_construir(self):
        self.assertIn("120", _rechazo({"levels": 1, "length_x_m": 1e6, "width_y_m": 1e6}))


class TestPuertaDelCaseton(unittest.TestCase):
    """La puerta del caseton iba fija en y = 8.10..9.90 m (planta de 18 m)."""

    def test_puerta_sobre_el_muro_en_una_planta_distinta(self):
        import params as P
        r = G.build_scene({"levels": 1, "length_x_m": 30, "width_y_m": 26,
                           "disciplines": ["architecture"]})
        self.assertTrue(r["ok"])
        scene = trimesh.load(io.BytesIO(base64.b64decode(r["glb_base64"])), file_type="glb")
        T, g = scene.graph["architecture__NC__ARQ-PUE-NC-CAS"]
        door = scene.geometry[g].copy()
        door.apply_transform(T)
        # Y del modelo es -Z en glTF.
        y0, y1 = sorted((-door.bounds[0][2], -door.bounds[1][2]))
        self.assertGreaterEqual(y0, P.CORE_Y0 - 1e-6)
        self.assertLessEqual(y1, P.CORE_Y1 + 1e-6)
        self.assertTrue(math.isclose((y0 + y1) / 2, (P.CORE_Y0 + P.CORE_Y1) / 2, abs_tol=1e-3))


if __name__ == "__main__":
    unittest.main()
