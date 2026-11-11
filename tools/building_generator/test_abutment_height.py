"""La altura del estribo la fija el terreno, no la cota del tablero.

El generador llevaba el estribo desde la cota del tablero hasta el plano de
referencia. Con el Viaducto de la Novena (tablero a 72 m) eso producia un muro
MACIZO de 71,49 m de altura por 30 m de ancho y 2 m de espesor. Los dos
estribos sumaban 10.237 t: el 29 % de la masa del modelo, en una pieza que no
existe en ninguna obra.

La geometria correcta de un cruce de vaguada es la contraria: las PILAS bajan
al fondo y los ESTRIBOS se quedan en el borde, cerca de la cota del tablero.
"""

import unittest

import bridge_params as B
import bridge_model as BM
import validate as VAL
from catalog import ParametricModel
from oplog import OperationLog

ALTO = {"bridge_type": "cable_stayed", "length_m": 550.8, "width_m": 30.0,
        "deck_height_m": 72.0, "span_lengths": [129.2, 292.4, 129.2],
        "tower_height_m": 60.0, "lanes": 6, "sidewalks": True}
BAJO = {"bridge_type": "beam", "length_m": 120.0, "width_m": 12.0,
        "deck_height_m": 8.0, "span_count": 3, "lanes": 2}


def construir(spec):
    B.apply_spec(dict(spec))
    model = ParametricModel(
        OperationLog(), disciplines=B.DISCIPLINES, materials=B.MATERIALS,
        project={"id": B.PROJECT_ID, "name": B.PROJECT_NAME, "domain": "bridge"},
        clash_roles=B.CLASH_ROLES)
    BM.build(model, list(B.DISCIPLINES))
    return model


def masa_por_tipo(model):
    out = {}
    for c in model.components.values():
        if c.discipline not in ("structure", "deck"):
            continue
        solid = model.solids.get(c.geometry_reference) if c.geometry_reference else None
        dens = (B.MATERIALS.get(c.material) or {}).get("density_kg_m3")
        if solid is None or not dens:
            continue
        try:
            vol = solid.volume()
        except Exception:
            continue
        out[c.type] = out.get(c.type, 0.0) + vol * float(dens) / 1000.0
    return out


class TestViaductoAlto(unittest.TestCase):
    def setUp(self):
        B.apply_spec(dict(ALTO))

    def test_el_estribo_queda_acotado(self):
        self.assertAlmostEqual(B.ABUTMENT_HEIGHT, B.HYP_ABUTMENT_MAX_HEIGHT, places=4)

    def test_no_llega_al_plano_de_referencia(self):
        # Lo que antes pasaba: arrancaba en -2 m con el tablero a 72 m.
        self.assertGreater(B.ABUTMENT_BASE_Z, 10.0)

    def test_se_declara_que_el_terreno_es_una_suposicion(self):
        self.assertTrue(B.ABUTMENT_GROUND_ASSUMED)

    def test_el_ajuste_lo_explica_y_no_lo_esconde(self):
        texto = " ".join(B.SPEC_ADJUSTMENTS)
        self.assertIn("estribo", texto.lower())
        self.assertIn("SE SUPONE", texto)
        self.assertIn("no esta verificada", texto)

    def test_la_altura_declarada_se_respeta(self):
        spec = dict(ALTO)
        spec["abutment_height_m"] = 18.0
        B.apply_spec(spec)
        self.assertAlmostEqual(B.ABUTMENT_HEIGHT, 18.0, places=4)
        self.assertFalse(B.ABUTMENT_GROUND_ASSUMED)

    def test_una_altura_absurda_se_rechaza(self):
        for valor in (0.0, -5.0, 500.0):
            spec = dict(ALTO)
            spec["abutment_height_m"] = valor
            with self.assertRaises(B.SpecError):
                B.apply_spec(spec)


class TestPuenteBajoSinCambios(unittest.TestCase):
    """Un puente bajo no debe cambiar: ahi el estribo SI llega al terreno."""

    def test_sigue_llegando_a_la_cimentacion(self):
        B.apply_spec(dict(BAJO))
        self.assertAlmostEqual(B.ABUTMENT_BASE_Z, -B.HYP_FOOTING_DEPTH, places=4)

    def test_no_se_supone_nada_del_terreno(self):
        B.apply_spec(dict(BAJO))
        self.assertFalse(B.ABUTMENT_GROUND_ASSUMED)
        self.assertEqual(
            [a for a in B.SPEC_ADJUSTMENTS if "estribo" in a.lower()], [])


class TestModeloConstruido(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.model = construir(ALTO)
        cls.masas = masa_por_tipo(cls.model)

    def test_los_estribos_dejan_de_dominar_la_masa(self):
        total = sum(self.masas.values())
        estribos = self.masas.get("abutment", 0.0)
        # Eran el 29 %. Un estribo no puede ser la pieza mas pesada de un
        # viaducto de 550 m.
        self.assertLess(estribos / total, 0.10)

    def test_el_estribo_pesa_mucho_menos_que_antes(self):
        # 10.237 t con el muro de 71 m.
        self.assertLess(self.masas.get("abutment", 0.0), 3000.0)

    def test_la_zapata_del_estribo_lo_acompana(self):
        """Si la zapata se quedara en la cota 0, el estribo volaria sobre ella."""
        zapata = self.model.components["EST-ZAP-EA"]
        cima = zapata.position[2] + zapata.dimensions["thickness"]
        self.assertAlmostEqual(cima, B.ABUTMENT_BASE_Z, places=3)

    def test_la_pila_si_baja_al_fondo(self):
        """Las pilas no se tocan: en una vaguada bajan hasta el fondo."""
        zapata = self.model.components["EST-ZAP-P1"]
        cima = zapata.position[2] + zapata.dimensions["thickness"]
        self.assertAlmostEqual(cima, -B.HYP_FOOTING_DEPTH, places=3)

    def test_el_estribo_declara_que_no_conoce_la_cota_del_terreno(self):
        est = self.model.components["EST-EST-EA"]
        self.assertIsNone(est.parameters["ground_elevation_m"])
        self.assertIn("ground_elevation_m", est.requires_calculation)
        self.assertTrue(est.parameters["ground_level_assumed"])

    def test_el_modelo_sigue_siendo_coherente(self):
        _rep, clashes = VAL.clash_report(self.model)
        self.assertEqual([c for c in clashes if c.get("severity") == "REVISAR"], [])
        cons = VAL.consistency_report(self.model, domain_checks=B.domain_checks)
        self.assertEqual(cons.get("errors"), 0)

    def test_el_apoyo_sigue_sobre_el_estribo(self):
        """Mover el arranque no debe descolgar el apoyo de su coronacion."""
        apoyo = self.model.components["EST-APO-EA-01"]
        self.assertAlmostEqual(apoyo.position[2], B.CAP_TOP, places=3)


if __name__ == "__main__":
    unittest.main()
