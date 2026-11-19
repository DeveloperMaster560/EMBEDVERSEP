"""Nada de la estructura del puente puede quedar apoyado en el aire.

Barrido del 19/11/2026:

  * Los fustes de las torres del atirantado arrancaban en la cota del cabezal
    de pila, pero van por fuera del tablero y del cabezal: quedaban colgados a
    la altura del tablero sin nada debajo. Con vanos iguales distintos de 3 las
    torres (en los tercios) caian ademas en mitad de un vano, a 12-37 m del
    suelo.
  * La zapata de pila medía 4.50 m de ancho fijo y las dos columnas se separan
    con el ancho del tablero: con 10 m de tablero las columnas (y = +-4 m)
    quedaban fuera de su zapata. Lo mismo el muro del estribo.
  * Valores no numericos o NaN llegaban hasta shapely y salian como un error
    ilegible en vez de un rechazo.
"""

import unittest

import bridge_model as BM
import bridge_params as B
import generate_bridge_scene as GB
from catalog import ParametricModel
from oplog import OperationLog


def _modelo(spec):
    import importlib
    importlib.reload(B)
    B.apply_spec(spec)
    importlib.reload(BM)
    model = ParametricModel(OperationLog(), disciplines=B.DISCIPLINES,
                            materials=B.MATERIALS,
                            project={"id": "T", "name": "T", "domain": "bridge"},
                            clash_roles=B.CLASH_ROLES)
    BM.build(model, ["structure"])
    return model


def _caja(model, cid):
    prims = model.solids[model.components[cid].geometry_reference].primitives
    xs, ys, zs = [], [], []
    for p in prims:
        (x0, y0, x1, y1) = p.plan_footprint()[0].bounds
        z0, z1 = p.z_range()
        xs += [x0, x1]
        ys += [y0, y1]
        zs += [z0, z1]
    return min(xs), min(ys), min(zs), max(xs), max(ys), max(zs)


def _apoyado_en_zapata(test, model, cid):
    x0, y0, z0, x1, y1, _ = _caja(model, cid)
    zapatas = [c for c in model.components.values() if c.type == "footing"]
    for z in zapatas:
        fx0, fy0, _fz0, fx1, fy1, fz1 = _caja(model, z.component_id)
        if (abs(fz1 - z0) < 1e-3 and fx0 - 1e-6 <= x0 and x1 <= fx1 + 1e-6
                and fy0 - 1e-6 <= y0 and y1 <= fy1 + 1e-6):
            return
    test.fail("%s (z0=%.2f, y %.2f..%.2f) no apoya sobre ninguna zapata" % (cid, z0, y0, y1))


class TestTorresApoyadas(unittest.TestCase):
    def _comprueba(self, spec):
        model = _modelo(spec)
        fustes = [c for c in model.components.values() if c.type == "tower"]
        self.assertEqual(len(fustes), 4)
        for f in fustes:
            _apoyado_en_zapata(self, model, f.component_id)

    def test_tres_vanos_torres_sobre_pila(self):
        self._comprueba({"bridge_type": "cable_stayed", "length_m": 240, "width_m": 20,
                         "deck_height_m": 20, "span_count": 3})

    def test_un_vano_torres_dentro_del_vano(self):
        self._comprueba({"bridge_type": "cable_stayed", "length_m": 150, "width_m": 15,
                         "deck_height_m": 15, "span_count": 1})

    def test_cinco_vanos_torres_fuera_de_las_pilas(self):
        self._comprueba({"bridge_type": "cable_stayed", "length_m": 600, "width_m": 30,
                         "deck_height_m": 40, "span_count": 5})


class TestColumnasYEstribosSobreSuZapata(unittest.TestCase):
    def test_columnas_de_pila(self):
        for ancho in (6.0, 10.0, 40.0):
            model = _modelo({"bridge_type": "beam", "length_m": 60, "width_m": ancho,
                             "deck_height_m": 7, "span_count": 3})
            for c in model.components.values():
                if c.type == "pier_column":
                    _apoyado_en_zapata(self, model, c.component_id)

    def test_muro_de_estribo(self):
        model = _modelo({"bridge_type": "beam", "length_m": 30, "width_m": 12,
                         "deck_height_m": 5, "span_count": 1})
        for tag in ("EA", "EB"):
            _x0, y0, _z0, _x1, y1, _ = _caja(model, "EST-EST-%s" % tag)
            _fx0, fy0, _fz0, _fx1, fy1, _ = _caja(model, "EST-ZAP-%s" % tag)
            self.assertLessEqual(fy0, y0 + 1e-6)
            self.assertGreaterEqual(fy1, y1 - 1e-6)


class TestRechazosClaros(unittest.TestCase):
    def test_valores_no_numericos(self):
        for spec in ({"length_m": "abc"}, {"deck_height_m": float("nan")},
                     {"span_count": 2.5}, {"width_m": True}):
            with self.assertRaises(B.SpecError):
                B.apply_spec(dict(spec, bridge_type="beam"))

    def test_spec_que_no_es_objeto(self):
        with self.assertRaises(B.SpecError):
            B.apply_spec([1, 2, 3])

    def test_tablero_por_encima_del_maximo(self):
        with self.assertRaises(B.SpecError) as ctx:
            B.apply_spec({"bridge_type": "beam", "length_m": 60, "deck_height_m": 1e6})
        self.assertIn("120", str(ctx.exception))

    def test_main_devuelve_rechazo_y_no_fallo(self):
        import io
        import json
        import sys
        entrada, salida = sys.stdin, sys.stdout
        try:
            sys.stdin = io.StringIO('{"bridge_type":"beam","length_m":60,"deck_height_m":NaN}')
            sys.stdout = io.StringIO()
            GB.main()
            out = json.loads(sys.stdout.getvalue())
        finally:
            sys.stdin, sys.stdout = entrada, salida
        self.assertFalse(out["ok"])
        self.assertTrue(out["spec_rejected"])
        self.assertIn("deck_height_m", out["detail"])


if __name__ == "__main__":
    unittest.main()
