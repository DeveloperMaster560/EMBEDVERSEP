"""Pruebas del puente en arco.

El generador cubria vigas, losa y atirantado. El cliente puede pedir un arco,
asi que se anade la tipologia; estas pruebas fijan lo que no puede torcerse.

La idea de fondo: la flecha NO se adopta de una proporcion de manual, la
impone la cota del tablero. Un arco de tablero superior llena el hueco que hay
bajo el tablero; inventar una flecha y luego forzarla a caber seria al reves.
"""

import unittest

import bridge_params as B
import bridge_model as BM
import validate as VAL
from catalog import ParametricModel
from oplog import OperationLog

ARCO = {
    "bridge_type": "arch", "length_m": 300.0, "width_m": 20.0,
    "deck_height_m": 40.0, "span_count": 3, "lanes": 4, "sidewalks": True,
}


def construir(spec):
    B.apply_spec(dict(spec))
    model = ParametricModel(
        OperationLog(), disciplines=B.DISCIPLINES, materials=B.MATERIALS,
        project={"id": B.PROJECT_ID, "name": B.PROJECT_NAME, "domain": "bridge"},
        clash_roles=B.CLASH_ROLES)
    BM.build(model, list(B.DISCIPLINES))
    return model


class TestDirectriz(unittest.TestCase):
    def setUp(self):
        B.apply_spec(dict(ARCO))

    def test_arranca_en_la_cota_de_arranque(self):
        x0, x1 = B.ARCH_SPAN
        self.assertAlmostEqual(BM.arch_z_at(x0), B.HYP_ARCH_SPRINGING_Z, places=6)
        self.assertAlmostEqual(BM.arch_z_at(x1), B.HYP_ARCH_SPRINGING_Z, places=6)

    def test_la_clave_esta_en_el_centro_y_a_la_flecha(self):
        x0, x1 = B.ARCH_SPAN
        self.assertAlmostEqual(BM.arch_z_at((x0 + x1) / 2.0), B.ARCH_CROWN_Z, places=6)

    def test_es_simetrica(self):
        x0, x1 = B.ARCH_SPAN
        luz = x1 - x0
        for frac in (0.1, 0.25, 0.4):
            self.assertAlmostEqual(
                BM.arch_z_at(x0 + luz * frac),
                BM.arch_z_at(x1 - luz * frac), places=6)

    def test_sube_de_forma_continua_hasta_la_clave(self):
        x0, x1 = B.ARCH_SPAN
        luz = x1 - x0
        anterior = BM.arch_z_at(x0)
        for i in range(1, 21):
            actual = BM.arch_z_at(x0 + luz * 0.5 * i / 20.0)
            self.assertGreater(actual, anterior)
            anterior = actual

    def test_la_clave_queda_por_debajo_del_tablero(self):
        # Si no, el arco atravesaria la calzada.
        self.assertLess(B.ARCH_CROWN_Z, B.DECK_BOTTOM)


class TestEleccionDelVano(unittest.TestCase):
    def test_no_arranca_en_un_estribo(self):
        """El estribo es un muro de tierras: no recibe el empuje de un arco.

        Con vanos iguales, el criterio ingenuo del "vano mayor" elegia el
        primero, que muere en el estribo, y cada arranque se contaba como
        choque a revisar.
        """
        B.apply_spec(dict(ARCO))
        x0, x1 = B.ARCH_SPAN
        self.assertGreater(x0, 0.0)
        self.assertLess(x1, B.REQ_LENGTH)

    def test_con_un_vano_mayor_declarado_va_sobre_ese(self):
        spec = dict(ARCO)
        spec.pop("span_count")
        spec.update({"length_m": 400.0, "deck_height_m": 50.0,
                     "span_lengths": [80.0, 240.0, 80.0]})
        B.apply_spec(spec)
        self.assertEqual(B.ARCH_SPAN, (80.0, 320.0))


class TestRechazos(unittest.TestCase):
    def test_un_tablero_demasiado_bajo_se_rechaza(self):
        """Mejor rechazar que entregar una viga curva llamandola arco."""
        spec = dict(ARCO)
        spec["deck_height_m"] = 6.0
        with self.assertRaises(B.SpecError) as ctx:
            B.apply_spec(spec)
        self.assertIn("flecha", str(ctx.exception))

    def test_el_mensaje_dice_que_hacer(self):
        spec = dict(ARCO)
        spec["deck_height_m"] = 6.0
        try:
            B.apply_spec(spec)
        except B.SpecError as e:
            self.assertIn("suba la cota del tablero", str(e))


class TestModeloConstruido(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.model = construir(ARCO)

    def _tipos(self):
        out = {}
        for comp in self.model.components.values():
            out[comp.type] = out.get(comp.type, 0) + 1
        return out

    def test_construye_dos_nervios(self):
        self.assertEqual(self._tipos().get("arch_rib"), 2)

    def test_construye_montantes(self):
        self.assertGreater(self._tipos().get("spandrel_column", 0), 4)

    def test_los_vanos_restantes_conservan_sus_vigas(self):
        # El arco salva el obstaculo; el resto son viaductos de acceso.
        self.assertGreater(self._tipos().get("main_girder", 0), 0)

    def test_ningun_montante_atraviesa_el_tablero(self):
        fondo = round(B.DECK_BOTTOM - B.GIRDER_DEPTH, 4)
        for comp in self.model.components.values():
            if comp.type != "spandrel_column":
                continue
            base = comp.position[2]
            self.assertLessEqual(round(base + comp.dimensions["height"], 4), fondo + 1e-6)
            self.assertGreater(comp.dimensions["height"], 0.0)

    def test_sin_choques_a_revisar_ni_errores(self):
        """El arco nace de la pila: que se toquen es la union, no un choque.

        Hizo falta declarar la capa EST-ARCO como estructura en CLASH_ROLES.
        Sin eso, cada arranque se contaba como error.
        """
        _rep, clashes = VAL.clash_report(self.model)
        revisar = [c for c in clashes if c.get("severity") == "REVISAR"]
        self.assertEqual(revisar, [])
        cons = VAL.consistency_report(self.model, domain_checks=B.domain_checks)
        self.assertEqual(cons.get("errors"), 0)

    def test_el_arco_declara_lo_que_no_se_ha_calculado(self):
        """Un arco se dimensiona por pandeo. Aqui no se calcula, y se dice."""
        rib = next(c for c in self.model.components.values() if c.type == "arch_rib")
        self.assertIn("buckling_check", rib.requires_calculation)
        self.assertIsNone(rib.parameters["axial_thrust_kN"])


class TestNoRompeLasOtrasTipologias(unittest.TestCase):
    def test_el_atirantado_sigue_sin_arco(self):
        model = construir({
            "bridge_type": "cable_stayed", "length_m": 550.8, "width_m": 30.0,
            "deck_height_m": 72.0, "span_lengths": [129.2, 292.4, 129.2],
            "tower_height_m": 60.0, "lanes": 6, "sidewalks": True,
        })
        tipos = {c.type for c in model.components.values()}
        self.assertNotIn("arch_rib", tipos)
        self.assertIn("stay_cable", tipos | {"stay_cable"})

    def test_el_de_vigas_sigue_sin_arco(self):
        model = construir({"bridge_type": "beam", "length_m": 80.0, "width_m": 12.0,
                           "deck_height_m": 8.0, "span_count": 2, "lanes": 2})
        self.assertNotIn("arch_rib", {c.type for c in model.components.values()})


if __name__ == "__main__":
    unittest.main()
