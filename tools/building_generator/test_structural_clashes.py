"""Las instalaciones de una oficina no invaden la estructura.

Hasta el 19/11/2026 la oficina de 3 pisos de 24 x 18 m salia con 11
«COLISION ESTRUCTURAL» y 2 «REVISAR», y otras plantas con decenas:

  - detector de humo y cableado de seguridad dentro del tramo de escalera
    (el reparto en reticula del recinto de escalera caia sobre el tramo);
  - medidor electrico dentro de la columna de fachada, y la acometida
    enterrada atravesando su pedestal (el centro del cuarto caia en un eje);
  - ramales pluviales en diagonal a traves de una columna, y bajadas de
    sumidero a traves de una viga;
  - luminarias, tomas, unidades interiores, puntos Wi-Fi y senales sobre
    columnas cuando la luz entre ejes no coincide con el reparto;
  - circuito de fuerza de la bomba a 1.60 m, atravesando dos puertas.

Se corrigio la COLOCACION de origen; el validador y sus severidades no se
tocaron. Los cruces entre instalaciones de distinta disciplina («REVISAR
TRAZADO») no son objetivo: son lo que la coordinacion debe reportar.
"""

import unittest

import generate_scene as G

BASE = {"clear_height_m": 3.2, "floor_to_floor_m": 3.6}

CASOS = [
    dict(BASE, levels=1, length_x_m=24, width_y_m=18),
    dict(BASE, levels=3, length_x_m=24, width_y_m=18),
    dict(BASE, levels=6, length_x_m=24, width_y_m=18),
    dict(BASE, levels=3, length_x_m=30, width_y_m=20),
    # Ejes que no caen en multiplos del reparto, y una columna en el ojo de
    # la escalera (36 x 24).
    dict(BASE, levels=2, length_x_m=36, width_y_m=24),
    dict(BASE, levels=3, length_x_m=27, width_y_m=21),
    dict(BASE, levels=2, length_x_m=20, width_y_m=15),
]

NO_ADMITIDAS = ("COLISION ESTRUCTURAL", "REVISAR")


_CACHE = {}


def _choques(spec, fresco=False):
    clave = repr(sorted(spec.items()))
    if not fresco and clave in _CACHE:
        return _CACHE[clave]
    built = G.build_model(dict(spec))
    import validate as VAL

    model = built["model"]
    _, clashes = VAL.clash_report(model)
    por_solido = {c.geometry_reference: cid for cid, c in model.components.items()
                  if isinstance(c.geometry_reference, str)}
    if not fresco:
        _CACHE[clave] = (model, clashes, por_solido)
    return model, clashes, por_solido


class TestOficinaSinColisionesEstructurales(unittest.TestCase):
    def test_ningun_caso_tiene_colision_estructural_ni_revisar(self):
        for spec in CASOS:
            with self.subTest(spec=spec):
                _, clashes, por_solido = _choques(spec)
                malos = ["%s: %s x %s" % (c["severity"], por_solido.get(c["a"], c["a"]),
                                          por_solido.get(c["b"], c["b"]))
                         for c in clashes if c["severity"] in NO_ADMITIDAS]
                self.assertEqual(malos, [])

    def test_el_validador_sigue_detectando_lo_estructural(self):
        # Guarda contra «arreglarlo» silenciando el validador: una tuberia
        # metida a proposito en una columna sigue saliendo como colision.
        import solids as S
        import validate as VAL

        model, _, _ = _choques(CASOS[1], fresco=True)
        col = next(s for s in model.solids.values() if s.layer == "ESTR-COLUMNAS")
        (x0, y0), (x1, y1) = col.bbox()[0][:2], col.bbox()[1][:2]
        cx, cy = (x0 + x1) / 2.0, (y0 + y1) / 2.0
        pipe = S.Solid("SOL-PRUEBA", S.polyline_pipe([(cx - 1, cy, 1.0), (cx + 1, cy, 1.0)],
                                                     0.05),
                       "pvc", "hydrosanitary", "N1", "HID-AGUA")
        model.add_solid(pipe)
        resumen, _ = VAL.clash_report(model)
        self.assertGreaterEqual(resumen["by_severity"].get("COLISION ESTRUCTURAL", 0), 1)

    def test_detector_de_escalera_fuera_de_los_tramos(self):
        # fresco: stair_geometry lee los parametros de la ultima solicitud.
        model, _, _ = _choques(CASOS[1], fresco=True)
        import discipline_structure as ST

        g = ST.stair_geometry()
        detectores = [c for c in model.components.values()
                      if c.type == "smoke_detector" and c.space_id.endswith("ESC")]
        self.assertTrue(detectores)
        for d in detectores:
            x, y = d.position[0], d.position[1]
            sobre_tramo = g["xa0"] <= x <= g["xb1"] and g["y0"] <= y <= g["y_top_flight"]
            self.assertFalse(sobre_tramo, d.component_id)

    def test_medidor_fuera_de_la_columna_y_dentro_del_cuarto(self):
        model, _, _ = _choques(CASOS[1], fresco=True)
        import params as P

        med = model.components["ELE-MED-001"]
        y = med.position[1]
        for gy in P.GRID_Y:
            self.assertGreaterEqual(abs(y - gy), 0.25 + 0.25 - 1e-9)

    def test_ramales_pluviales_ortogonales_o_rectos_sin_columnas(self):
        model, clashes, por_solido = _choques(CASOS[1])
        pluviales = {cid for cid, c in model.components.items() if c.type == "rain_branch"}
        self.assertTrue(pluviales)
        for c in clashes:
            ids = {por_solido.get(c["a"]), por_solido.get(c["b"])}
            if ids & pluviales:
                self.assertNotEqual(c["severity"], "COLISION ESTRUCTURAL")


if __name__ == "__main__":
    unittest.main()
