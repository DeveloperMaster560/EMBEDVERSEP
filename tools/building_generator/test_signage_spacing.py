"""Las senales no pueden caer encima de un poste de alumbrado.

Las dos cosas se montan sobre la coronacion de la barrera, asi que comparten
sitio. La senalizacion intentaba apartarse desfasandose media separacion
NOMINAL de alumbrado (10 m, de los 20 m de la regla). Pero los postes se
reparten para encajar en la longitud del puente, y en el Viaducto de la Novena
su separacion real es de 19,671 m: el desfase no correspondia a nada y el error
se acumulaba hasta que una senal caia a 0,35 m de un poste, en el MISMO lado
del tablero. El poste atravesaba la senal.

Ahora las senales se situan en los PUNTOS MEDIOS entre postes reales, de modo
que no pueden coincidir por construccion.
"""

import unittest

import bridge_params as B
import bridge_model as BM
import validate as VAL
from catalog import ParametricModel
from oplog import OperationLog

CASOS = {
    "viaducto": {"bridge_type": "cable_stayed", "length_m": 550.8, "width_m": 30.0,
                 "deck_height_m": 72.0, "span_lengths": [129.2, 292.4, 129.2],
                 "tower_height_m": 60.0, "lanes": 6, "sidewalks": True},
    "vigas": {"bridge_type": "beam", "length_m": 120.0, "width_m": 12.0,
              "deck_height_m": 8.0, "span_count": 3, "lanes": 2, "sidewalks": True},
    "corto": {"bridge_type": "beam", "length_m": 32.0, "width_m": 9.0,
              "deck_height_m": 6.0, "span_count": 1, "lanes": 2},
    "arco": {"bridge_type": "arch", "length_m": 300.0, "width_m": 20.0,
             "deck_height_m": 40.0, "span_count": 3, "lanes": 4, "sidewalks": True},
}

# Un poste y una senal no pueden estar mas juntos que esto en el mismo lado.
SEPARACION_MINIMA = 2.0


def construir(spec):
    B.apply_spec(dict(spec))
    model = ParametricModel(
        OperationLog(), disciplines=B.DISCIPLINES, materials=B.MATERIALS,
        project={"id": B.PROJECT_ID, "name": B.PROJECT_NAME, "domain": "bridge"},
        clash_roles=B.CLASH_ROLES)
    BM.build(model, list(B.DISCIPLINES))
    return model


def separacion_minima(model):
    """Distancia longitudinal menor entre senal y poste en el mismo lado."""
    postes = [c.position for c in model.components.values()
              if c.component_id.startswith("ILU-POS")]
    senales = [c.position for c in model.components.values()
               if c.component_id.startswith("SEN-SEN")]
    pares = [abs(s[0] - p[0]) for s in senales for p in postes
             if abs(s[1] - p[1]) < 0.5]
    return min(pares) if pares else None


class TestSeparacion(unittest.TestCase):
    def test_ninguna_senal_cae_sobre_un_poste(self):
        for nombre, spec in CASOS.items():
            with self.subTest(nombre):
                d = separacion_minima(construir(spec))
                if d is None:
                    continue  # ese caso no lleva ambas cosas
                self.assertGreater(d, SEPARACION_MINIMA,
                                   "%s: senal a %.2f m de un poste" % (nombre, d))

    def test_en_el_viaducto_la_separacion_es_amplia(self):
        # Era 0,35 m. Debe quedar cerca de medio vano entre postes.
        self.assertGreater(separacion_minima(construir(CASOS["viaducto"])), 8.0)


class TestSinChoquesAccionables(unittest.TestCase):
    def test_el_viaducto_queda_sin_choques_accionables(self):
        model = construir(CASOS["viaducto"])
        _rep, clashes = VAL.clash_report(model)
        acc = [c for c in clashes if c.get("severity") in (
            "COLISION ESTRUCTURAL", "REVISAR TRAZADO", "REVISAR")]
        self.assertEqual([(c.get("a"), c.get("b")) for c in acc], [])

    def test_las_demas_tipologias_tampoco(self):
        for nombre in ("vigas", "corto", "arco"):
            with self.subTest(nombre):
                _rep, clashes = VAL.clash_report(construir(CASOS[nombre]))
                acc = [c for c in clashes if c.get("severity") in (
                    "COLISION ESTRUCTURAL", "REVISAR TRAZADO", "REVISAR")]
                self.assertEqual([(c.get("a"), c.get("b")) for c in acc], [])


class TestFuenteUnicaDePostes(unittest.TestCase):
    """Dos calculos equivalentes en sitios distintos fue justo el fallo."""

    def test_los_postes_construidos_coinciden_con_la_fuente(self):
        model = construir(CASOS["viaducto"])
        esperado = [x for x, _side in BM.light_pole_axes()]
        construido = sorted(c.position[0] for c in model.components.values()
                            if c.component_id.startswith("ILU-POS"))
        self.assertEqual(len(construido), len(esperado))
        for a, b in zip(construido, sorted(esperado)):
            self.assertAlmostEqual(a, b, places=3)

    def test_los_postes_alternan_lado(self):
        lados = [s for _x, s in BM.light_pole_axes()]
        self.assertEqual(lados[:4], ["L", "R", "L", "R"])

    def test_las_senales_siguen_existiendo(self):
        """Apartarlas no puede equivaler a suprimirlas."""
        model = construir(CASOS["viaducto"])
        senales = [c for c in model.components.values()
                   if c.component_id.startswith("SEN-SEN")]
        self.assertGreater(len(senales), 5)

    def test_las_senales_se_reparten_por_el_tablero(self):
        model = construir(CASOS["viaducto"])
        xs = sorted(c.position[0] for c in model.components.values()
                    if c.component_id.startswith("SEN-SEN"))
        self.assertLess(xs[0], B.REQ_LENGTH * 0.2)
        self.assertGreater(xs[-1], B.REQ_LENGTH * 0.8)

    def test_ninguna_senal_cae_sobre_un_apoyo(self):
        model = construir(CASOS["viaducto"])
        ejes = [ax for _tag, ax in BM.support_axes()]
        for c in model.components.values():
            if not c.component_id.startswith("SEN-SEN"):
                continue
            for ax in ejes:
                self.assertGreater(abs(c.position[0] - ax), 0.99,
                                   "%s sobre el apoyo en x=%.2f" % (c.component_id, ax))


if __name__ == "__main__":
    unittest.main()
