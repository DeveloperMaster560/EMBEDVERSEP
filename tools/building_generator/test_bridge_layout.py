"""Pruebas del reparto explicito de vanos, el emplazamiento y el control.

El caso de referencia es el Viaducto Provincial de Bucaramanga, cuyo reparto
real (129,2 + 292,4 + 129,2 m) no es uniforme. Antes de esta funcion el
generador solo sabia hacer vanos iguales y las torres caian 46 m fuera de sitio.
"""

import unittest

import bridge_params as B

NOVENA = {
    "bridge_type": "cable_stayed",
    "span_lengths": [129.2, 292.4, 129.2],
    "length_m": 550.8, "width_m": 30.0,
    "deck_height_m": 72.0, "tower_height_m": 60.0,
    "lanes": 6, "sidewalks": True,
}


class TestRepartoDeVanos(unittest.TestCase):
    def test_respeta_el_reparto_declarado(self):
        B.apply_spec(dict(NOVENA))
        self.assertEqual(B.SPAN_EDGES, (0.0, 129.2, 421.6, 550.8))
        self.assertEqual(B.REQ_SPAN_COUNT, 3)
        self.assertAlmostEqual(B.REQ_LENGTH, 550.8, places=6)

    def test_no_ajusta_el_numero_de_vanos(self):
        """Un reparto explicito no se puede repartir de nuevo: destruiria el dato.

        Se mira si hay algun ajuste SOBRE LOS VANOS, no si la lista esta vacia.
        Afirmar que esta vacia ataba esta prueba a cualquier otro ajuste que el
        generador llegara a emitir por motivos ajenos al reparto.
        """
        report = B.apply_spec(dict(NOVENA))
        sobre_vanos = [a for a in report["adjustments"]
                       if "vano" in a.lower() or "luz" in a.lower()]
        self.assertEqual(sobre_vanos, [])

    def test_las_torres_flanquean_el_vano_principal(self):
        B.apply_spec(dict(NOVENA))
        self.assertEqual(B.TOWER_AXES, (129.2, 421.6))
        # Es justo lo que NO ocurria con vanos iguales:
        self.assertNotEqual(B.TOWER_AXES, (round(550.8 / 3, 4), round(2 * 550.8 / 3, 4)))

    def test_altura_de_torre_explicita_manda_sobre_la_proporcion(self):
        B.apply_spec(dict(NOVENA))
        self.assertAlmostEqual(B.TOWER_HEIGHT, 60.0, places=6)

    def test_el_vano_mayor_gobierna_el_dimensionado(self):
        B.apply_spec(dict(NOVENA))
        self.assertAlmostEqual(B.SPAN_LENGTH, 292.4, places=6)

    def test_rechaza_suma_incoherente(self):
        spec = dict(NOVENA, length_m=600.0)
        with self.assertRaises(B.SpecError) as ctx:
            B.apply_spec(spec)
        self.assertIn("550.80", str(ctx.exception))

    def test_rechaza_vano_sobre_la_luz_maxima(self):
        spec = dict(NOVENA, span_lengths=[129.2, 420.0, 129.2], length_m=678.4)
        with self.assertRaises(B.SpecError):
            B.apply_spec(spec)

    def test_rechaza_vano_no_positivo(self):
        spec = dict(NOVENA, span_lengths=[129.2, -292.4, 129.2], length_m=-34.0)
        with self.assertRaises(B.SpecError):
            B.apply_spec(spec)

    def test_sin_reparto_explicito_sigue_habiendo_vanos_iguales(self):
        B.apply_spec({"bridge_type": "beam", "length_m": 90.0, "span_count": 3,
                      "width_m": 10.0, "deck_height_m": 7.0})
        self.assertEqual(B.REQ_SPAN_LENGTHS, ())
        self.assertEqual(B.SPAN_EDGES, (0.0, 30.0, 60.0, 90.0))

    def test_las_comprobaciones_de_dominio_pasan(self):
        B.apply_spec(dict(NOVENA))
        fallidas = [nombre for nombre, ok, _ in B.domain_checks() if not ok]
        self.assertEqual(fallidas, [])


class TestEmplazamiento(unittest.TestCase):
    def test_carga_y_declara_lo_que_falta(self):
        B.apply_spec(dict(NOVENA, site={
            "municipality": "Bucaramanga", "latitude_deg": 7.10817,
            "longitude_deg": -73.12984,
            "provenance": {"municipality": "fuentes publicas",
                           "latitude_deg": "Structurae", "longitude_deg": "Structurae"}}))
        self.assertEqual(B.SITE["municipality"], "Bucaramanga")
        self.assertIn("seismic_hazard_zone", B.site_pending())
        self.assertNotIn("latitude_deg", B.site_pending())

    def test_no_arrastra_el_emplazamiento_anterior(self):
        B.apply_spec(dict(NOVENA, site={"municipality": "Bucaramanga"}))
        B.apply_spec(dict(NOVENA))
        self.assertIsNone(B.SITE["municipality"])

    def test_avisa_de_los_campos_sin_procedencia(self):
        report = B.apply_spec(dict(NOVENA, site={"municipality": "Bucaramanga"}))
        self.assertTrue(any("sin procedencia" in a for a in report["adjustments"]))

    def test_rechaza_latitud_imposible(self):
        with self.assertRaises(B.SpecError):
            B.apply_spec(dict(NOVENA, site={"latitude_deg": 120.0}))


class TestControlYRealce(unittest.TestCase):
    def setUp(self):
        import importlib
        import bridge_model
        importlib.reload(bridge_model)
        self.BM = bridge_model
        from catalog import ParametricModel
        from oplog import OperationLog
        B.apply_spec(dict(NOVENA, site={
            "latitude_deg": 7.10817, "longitude_deg": -73.12984,
            "provenance": {"latitude_deg": "Structurae", "longitude_deg": "Structurae"}}))
        self.model = ParametricModel(
            OperationLog(), disciplines=B.DISCIPLINES, materials=B.MATERIALS,
            project={"id": B.PROJECT_ID, "name": B.PROJECT_NAME, "domain": "bridge"},
            clash_roles=B.CLASH_ROLES)
        self.BM.build(self.model, list(B.DISCIPLINES))

    def test_hay_un_proyector_por_tirante(self):
        tirantes = [c for c in self.model.components.values() if c.type == "stay_cable"]
        proyectores = [c for c in self.model.components.values()
                       if c.component_id.startswith("ILU-ARQ-TIR-")]
        self.assertGreater(len(tirantes), 0)
        self.assertEqual(len(proyectores), len(tirantes))

    def test_ningun_proyector_invade_un_elemento_portante(self):
        import validate as VAL
        _, clashes = VAL.clash_report(self.model)
        estructurales = [c for c in clashes if c["severity"] == "COLISION ESTRUCTURAL"]
        self.assertEqual(estructurales, [])

    def test_la_cadena_de_mando_esta_completa(self):
        """Fotocelda -> contactor -> circuito vial. Sin un eslabon no enciende."""
        ids = set(self.model.components)
        self.assertIn("CTL-FOT-001", ids)
        self.assertIn("CTL-CON-001", ids)
        self.assertIn("ILU-CIR-001", ids)
        conexiones = {c.connection_id for c in self.model.connections.values()}
        self.assertIn("CNX-FOT-CTL", conexiones)
        self.assertIn("CNX-CTL-CIR", conexiones)

    def test_el_reloj_hereda_las_coordenadas_del_emplazamiento(self):
        reloj = self.model.components["CTL-RLJ-001"]
        self.assertAlmostEqual(reloj.parameters["latitude_deg"], 7.10817, places=5)
        self.assertNotIn("latitude_deg", reloj.requires_calculation)

    def test_sin_emplazamiento_el_reloj_declara_la_coordenada_pendiente(self):
        from catalog import ParametricModel
        from oplog import OperationLog
        B.apply_spec(dict(NOVENA))
        model = ParametricModel(
            OperationLog(), disciplines=B.DISCIPLINES, materials=B.MATERIALS,
            project={"id": B.PROJECT_ID, "name": B.PROJECT_NAME, "domain": "bridge"},
            clash_roles=B.CLASH_ROLES)
        self.BM.build(model, list(B.DISCIPLINES))
        reloj = model.components["CTL-RLJ-001"]
        self.assertIsNone(reloj.parameters["latitude_deg"])
        self.assertIn("latitude_deg", reloj.requires_calculation)

    def test_no_se_inventan_direcciones_dmx(self):
        proyectores = [c for c in self.model.components.values()
                       if c.component_id.startswith("ILU-ARQ-")]
        self.assertTrue(proyectores)
        for p in proyectores:
            self.assertIsNone(p.parameters["dmx_address"])
            self.assertIsNone(p.parameters["led_node_count"])

    def test_el_realce_no_comparte_circuito_con_el_vial(self):
        vial = self.model.components["ILU-CIR-001"]
        realce = [c for c in self.model.components.values()
                  if c.type == "led_driver"]
        self.assertTrue(realce)
        for fuente in realce:
            self.assertNotEqual(fuente.component_id, vial.component_id)


if __name__ == "__main__":
    unittest.main()
