"""Estaciones SHM del Viaducto de la Novena segun el diseno de ingenierias.

Diseno: Planos/Diseno_SHM_Viaducto_Novena/diseno_tecnico.md §4.2. Se comprueba
que la REGLA del diseno (L/4, L/2, 3L/4 por vano, duplicada a media luz,
temperatura en apoyos) se cumple sobre los vanos publicados, y que lo que el
diseno deja abierto sigue declarado como pendiente.
"""

import unittest

import bridge_params as B
import bridge_model as BM
import validate as VAL
from catalog import ParametricModel
from oplog import OperationLog

NOVENA = {"bridge_type": "cable_stayed", "length_m": 550.8, "width_m": 30.0,
          "deck_height_m": 72.0, "span_lengths": [129.2, 292.4, 129.2],
          "tower_height_m": 60.0, "lanes": 6, "sidewalks": True,
          "instrumentation_layout": "shm-novena-2026-11"}


def construir(spec):
    B.apply_spec(dict(spec))
    model = ParametricModel(
        OperationLog(), disciplines=B.DISCIPLINES, materials=B.MATERIALS,
        project={"id": B.PROJECT_ID, "name": B.PROJECT_NAME, "domain": "bridge"},
        clash_roles=B.CLASH_ROLES)
    BM.build(model, list(B.DISCIPLINES))
    return model


class TestDisposicionShm(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.model = construir(NOVENA)
        cls.comps = cls.model.components

    def acelerometros(self):
        return [c for c in self.comps.values() if c.type == "accelerometer"]

    def test_tres_estaciones_por_vano_en_los_cuartos(self):
        edges = [0.0, 129.2, 421.6, 550.8]
        for s in range(3):
            xs = sorted(c.position[0] for c in self.acelerometros()
                        if c.parameters.get("span_index") == s + 1
                        and "torsion" not in c.tags)
            L = edges[s + 1] - edges[s]
            esperado = [edges[s] + L * f for f in (0.25, 0.5, 0.75)]
            for x, e in zip(xs, esperado):
                self.assertAlmostEqual(x, e, places=3)

    def test_la_duplicada_esta_a_media_luz_del_vano_mayor_en_otra_viga(self):
        dup = [c for c in self.acelerometros() if "torsion" in c.tags]
        self.assertEqual(len(dup), 1)
        mid = [c for c in self.acelerometros()
               if c.parameters["station_id"] == "SD-V2-M"][0]
        self.assertAlmostEqual(dup[0].position[0], (129.2 + 421.6) / 2, places=3)
        self.assertNotAlmostEqual(dup[0].position[1], mid.position[1], places=2)

    def test_temperatura_en_cada_apoyo(self):
        ss = sorted(c.parameters["station_id"] for c in self.comps.values()
                    if c.type == "temperature_probe")
        self.assertEqual(ss, ["SS-EA", "SS-EB", "SS-P1", "SS-P2"])

    def test_el_sensor_no_va_en_el_gabinete(self):
        for c in self.acelerometros():
            gab = self.comps["SHM-%s-GAB" % c.parameters["station_id"]]
            self.assertGreater(abs(gab.position[1] - c.position[1]) + abs(gab.position[2] - c.position[2]), 0.3)

    def test_lo_abierto_sigue_pendiente(self):
        for c in self.acelerometros():
            self.assertIsNone(c.parameters["range_g"])
            self.assertIsNone(c.parameters["alarm_threshold"])
            self.assertIn("alarm_threshold", c.requires_calculation)
        self.assertIsNone(self.comps["SHM-SR-001"].parameters["receiver_model"])

    def test_sin_choques_accionables_ni_errores(self):
        _rep, clashes = VAL.clash_report(self.model)
        acc = [c for c in clashes if c.get("severity") in (
            "COLISION ESTRUCTURAL", "REVISAR TRAZADO", "REVISAR")]
        self.assertEqual(acc, [])
        cons = VAL.consistency_report(self.model, domain_checks=B.domain_checks)
        self.assertEqual(cons["errors"], 0, cons)

    def test_otros_puentes_conservan_la_instrumentacion_generica(self):
        spec = dict(NOVENA)
        del spec["instrumentation_layout"]
        model = construir(spec)
        self.assertIn("INS-GAB-001", model.components)
        self.assertFalse(any(k.startswith("SHM-") for k in model.components))

    def test_disposicion_desconocida_se_rechaza(self):
        with self.assertRaises(B.SpecError):
            B.apply_spec(dict(NOVENA, instrumentation_layout="inventada"))


if __name__ == "__main__":
    unittest.main()
