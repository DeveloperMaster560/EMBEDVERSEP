"""Catalogo de laminas del expediente.

Cada lamina se compone con el mismo procedimiento:

  1. se genera la geometria desde el modelo (views.py),
  2. se fija la escala encuadrando esa geometria,
  3. se anade la anotacion dimensionada para esa escala,
  4. se dibujan marco, leyenda, notas, norte y cajetin.

Las tablas (cuadros) se construyen desde el catalogo de componentes, no desde
listas escritas a mano, de modo que coinciden siempre con el modelo y con los
CSV del paquete.
"""

from __future__ import annotations

import math
from typing import Any, Callable, Dict, List, Optional, Sequence, Tuple

import drafting as D
import params as P
import views as V
from drafting import Circle, Line, PolyLine, Sheet, Text

DISCIPLINE_LABEL = {
    "architecture": "Arquitectura",
    "structure": "Estructura",
    "electrical": "Electrico",
    "telecommunications": "Telecomunicaciones",
    "hydrosanitary": "Hidrosanitario",
    "hvac": "Mecanico y climatizacion",
    "security": "Seguridad y proteccion",
    "model": "Modelo integral",
}

COMMON_NOTES = [
    "Geometria derivada del modelo parametrico unico; planta, alzado y corte proceden de los mismos solidos.",
    "Cotas en metros. Los valores se miden sobre el modelo, no se rotulan a mano.",
    "Documento conceptual: sin calculo de ingenieria ni revision profesional. No apto para construccion.",
]


# ---------------------------------------------------------------------------
# Composicion generica
# ---------------------------------------------------------------------------


def compose(sheet: Sheet, geometry: Sequence[D.Prim],
            annotate: Optional[Callable[[int], Sequence[D.Prim]]] = None,
            padding_mm: float = 34.0, refs: Optional[Sequence[str]] = None) -> Sheet:
    sheet.add(*geometry)
    sheet.fit(padding_mm=padding_mm)
    if annotate is not None:
        sheet.add(*annotate(sheet.scale))
        sheet.fit(allow_rescale=False, padding_mm=2.0)
    if refs:
        sheet.component_refs = list(dict.fromkeys(refs))
    D.finish(sheet, rescale=False)
    return sheet


def auto_legend(prims: Sequence[D.Prim], limit: int = 11) -> List[Tuple[str, str]]:
    seen: List[str] = []
    for p in prims:
        if p.layer not in seen and not p.layer.startswith("LAM-"):
            seen.append(p.layer)
    out: List[Tuple[str, str]] = []
    for name in seen[:limit]:
        lay = D.layer(name)
        out.append((name, lay.description or name))
    return out


def _new(code: str, title: str, discipline: str, view_kind: str, scale: int,
         level_label: str = "", subtitle: str = "", north: bool = False,
         notes: Optional[Sequence[str]] = None, paper: str = "A1") -> Sheet:
    return Sheet(
        sheet_id="%s-%s" % (P.PROJECT_ID, code), code=code, title=title,
        discipline=DISCIPLINE_LABEL.get(discipline, discipline),
        scale=scale, paper=paper, level_label=level_label, view_kind=view_kind,
        subtitle=subtitle, show_north=north,
        notes=list(notes) if notes else list(COMMON_NOTES),
        version=P.PROJECT_VERSION,
    )


def _grid_ann(scale: int) -> List[D.Prim]:
    return V.grid_annotations(scale, (0.0, P.REQ_LENGTH_X), (0.0, P.REQ_WIDTH_Y))


# ---------------------------------------------------------------------------
# ARQUITECTURA
# ---------------------------------------------------------------------------

SECTION_LINES = (
    {"label": "A", "axis": "y", "value": 9.00, "name": "Corte arquitectonico A-A (longitudinal)"},
    {"label": "B", "axis": "x", "value": 12.00, "name": "Corte arquitectonico B-B (transversal)"},
)


def architecture_sheets(model) -> List[Sheet]:
    out: List[Sheet] = []

    for level in P.LEVELS:
        lid = level["level_id"]
        prims, refs = V.plan(model, lid, projection_layers=("ESTR-VIGAS",))
        sh = _new("ARQ-P-%s" % lid, "Planta arquitectonica %s" % level["name"].lower(),
                  "architecture", "planta", 50,
                  level_label="%s (N %+0.2f)" % (lid, level["elevation"]),
                  subtitle="Seccion horizontal a 1.20 m sobre el nivel de piso terminado",
                  north=True)
        sh.legend = auto_legend(prims) + [("CORTE-TRAZA", "Traza de los cortes A-A y B-B")]

        def ann(scale, lid=lid):
            a = _grid_ann(scale)
            a += V.space_labels(model, lid, scale)
            for sl in SECTION_LINES:
                a += V.section_trace(scale, sl["axis"], sl["value"], sl["label"])
            a += V.level_mark(lid, scale, (1.0, -scale / 1000.0 * 30.0))
            return a

        out.append(compose(sh, prims, ann, refs=refs))

    # Planta de cubierta
    prims, refs = V.plan(
        model, "NC", cut_offset=0.50,
        background_layers=("ARQ-CUBIERTA",),
        foreground_layers=("CLI-EQUIPOS", "HID-EQUIPOS", "HID-PLUVIAL", "TEL-EQUIPOS",
                           "SEG-CCTV", "ESTR-LOSAS"),
        include_levelless_foreground=False, show_spaces=False)
    sh = _new("ARQ-P-NC", "Planta de cubierta", "architecture", "planta", 50,
              level_label="Cubierta (N %+0.2f)" % P.ROOF_LEVEL["elevation"],
              subtitle="Losa superior, parapeto, caseton de escalera y equipos en cubierta",
              north=True)
    sh.legend = auto_legend(prims)
    out.append(compose(sh, prims, lambda s: _grid_ann(s) + V.level_mark(
        "NC", s, (1.0, -s / 1000.0 * 30.0)), refs=refs))

    # Fachadas
    for fac in ("S", "N", "E", "W"):
        cfg = V.FACADES[fac]
        prims, refs = V.elevation(model, fac)
        sh = _new("ARQ-F-%s" % fac, cfg["name"], "architecture", "alzado", 75,
                  level_label="Conjunto", subtitle="Proyeccion ortografica de la envolvente")
        sh.legend = auto_legend(prims)
        span = P.REQ_LENGTH_X if cfg["axis"] == "x" else P.REQ_WIDTH_Y
        u0, u1 = (-span, 0.0) if cfg["flip"] else (0.0, span)
        out.append(compose(sh, prims,
                           lambda s, f=fac, r=(u0, u1): V.elevation_annotations(s, r, f),
                           refs=refs))

    # Cortes arquitectonicos
    for sl in SECTION_LINES:
        prims, refs = V.section(model, sl["axis"], sl["value"])
        sh = _new("ARQ-C-%s" % sl["label"], sl["name"], "architecture", "corte", 75,
                  level_label="Conjunto",
                  subtitle="Plano de corte %s = %.2f m" % (sl["axis"].upper(), sl["value"]))
        sh.legend = auto_legend(prims)
        span = P.REQ_WIDTH_Y if sl["axis"] == "x" else P.REQ_LENGTH_X
        out.append(compose(sh, prims,
                           lambda s, a=sl["axis"], r=(0.0, span): V.section_annotations(s, r, a),
                           refs=refs))

    out.append(_stair_detail_sheet(model))
    out.append(_opening_detail_sheet(model))
    out.append(_area_schedule_sheet(model))
    out.append(_opening_schedule_sheet(model))
    return out


def _stair_detail_sheet(model) -> Sheet:
    from discipline_structure import stair_geometry
    g = stair_geometry()
    win = (g["int_x0"] - 0.6, g["int_y0"] - 0.6, g["int_x1"] + 0.6, g["int_y1"] + 0.6)
    prims, refs = V.detail_plan(model, "N1", win,
                               layers=("ARQ-MUROS", "ARQ-PUERTAS", "ESTR-ESCALERA",
                                       "ESTR-COLUMNAS"))
    sec, refs2 = V.detail_section(
        model, "x", round((g["xa0"] + g["xa1"]) / 2, 3),
        (g["int_y0"] - 0.6, -0.4, g["int_y1"] + 0.6, P.LEVELS[1]["elevation"] + 0.6),
        layers=("ESTR-ESCALERA", "ESTR-LOSAS", "ARQ-MUROS"))
    # el corte se desplaza a la derecha de la planta para convivir en la lamina
    dx = (win[2] - win[0]) + 2.0
    shifted = []
    for p in sec:
        if isinstance(p, PolyLine):
            shifted.append(PolyLine(p.layer, [(x + win[0] + dx, y + win[1]) for x, y in p.points],
                                    p.closed))
    sh = _new("ARQ-D-ESC", "Detalles de escaleras", "architecture", "detalle", 25,
              level_label="Nucleo central",
              subtitle="Planta del nucleo (izquierda) y corte del tramo (derecha)")
    sh.legend = auto_legend(prims + shifted)

    def ann(scale):
        mm = lambda v: v * scale / 1000.0
        a: List[D.Prim] = []
        a.append(Text("LAM-TEXTO", (win[0], win[3] + mm(6.0)),
                      "PLANTA DEL NUCLEO DE ESCALERAS", height_mm=3.0))
        a.append(Text("LAM-TEXTO", (win[0] + dx, win[3] + mm(6.0)),
                      "CORTE DEL TRAMO", height_mm=3.0))
        a.append(D.LinearDim("COTAS", (g["xa0"], g["y0"]), (g["xb1"], g["y0"]),
                             offset=-mm(8.0), direction="h"))
        a.append(D.LinearDim("COTAS", (g["xa0"], g["y0"]), (g["xa0"], g["y_landing_end"]),
                             offset=-mm(8.0), direction="v"))
        a.append(Text("LAM-TEXTO", (win[0], win[1] - mm(14.0)),
                      "Contrahuella %.3f m  Huella %.3f m  %d contrahuellas por tramo  "
                      "Desarrollo %.3f m  Ancho de tramo %.2f m"
                      % (P.HYP_STAIR_RISER, P.HYP_STAIR_TREAD, P.HYP_STAIR_RISERS_PER_FLIGHT,
                         g["run"], P.HYP_STAIR_FLIGHT_WIDTH), height_mm=2.4))
        a.append(Text("LAM-TEXTO", (win[0], win[1] - mm(19.0)),
                      "Comprobacion geometrica: %d x %.3f x %d tramos = %.3f m = altura entre "
                      "niveles" % (P.HYP_STAIR_RISERS_PER_FLIGHT, P.HYP_STAIR_RISER,
                                   P.HYP_STAIR_FLIGHTS_PER_LEVEL, P.REQ_FLOOR_TO_FLOOR),
                      height_mm=2.4))
        return a

    sh.notes = list(COMMON_NOTES) + [
        "Huella y contrahuella son geometria conceptual; su validez depende de la norma de "
        "evacuacion aplicable, que no se ha verificado.",
        "Pasamanos, barandas y acabados no estan definidos.",
    ]
    return compose(sh, prims + shifted, ann, refs=list(refs) + list(refs2))


def _opening_detail_sheet(model) -> Sheet:
    """Detalles de puertas y ventanas: alzados tipo generados desde el modelo."""
    prims: List[D.Prim] = []
    refs: List[str] = []
    x = 0.0
    gap = 0.9

    samples: List[Tuple[str, Any]] = []
    seen_w: set = set()
    for c in sorted(model.by_type("door"), key=lambda c: c.component_id):
        key = (c.parameters.get("width_m"), c.parameters.get("height_m"),
               c.parameters.get("leaf_count"))
        if key in seen_w:
            continue
        seen_w.add(key)
        samples.append(("PUERTA", c))
    seen_v: set = set()
    for c in sorted(model.by_type("window"), key=lambda c: c.component_id):
        key = (c.parameters.get("width_m"), c.parameters.get("height_m"),
               c.parameters.get("sill_height_m"))
        if key in seen_v:
            continue
        seen_v.add(key)
        samples.append(("VENTANA", c))

    labels: List[Tuple[float, float, str, str]] = []
    for kind, c in samples:
        w = float(c.parameters.get("width_m") or 0.9)
        h = float(c.parameters.get("height_m") or 2.1)
        sill = float(c.parameters.get("sill_height_m") or 0.0)
        prims.append(PolyLine("ARQ-CARPINTERIA",
                              [(x, sill), (x + w, sill), (x + w, sill + h), (x, sill + h)],
                              closed=True))
        prims.append(Line("ARQ-MUROS-PROY", (x - 0.25, 0.0), (x + w + 0.25, 0.0)))
        if kind == "PUERTA":
            leaves = int(c.parameters.get("leaf_count") or 1)
            for i in range(1, leaves):
                prims.append(Line("ARQ-CARPINTERIA", (x + w * i / leaves, sill),
                                  (x + w * i / leaves, sill + h)))
        else:
            prims.append(Line("ARQ-CARPINTERIA", (x, sill + h / 2), (x + w, sill + h / 2)))
        code = c.parameters.get("schedule_code", c.component_id)
        labels.append((x, w, code, "%s  %.2f x %.2f m%s"
                       % (kind, w, h, ("  antepecho %.2f" % sill) if kind == "VENTANA" else "")))
        refs.append(c.geometry_reference or c.component_id)
        x += w + gap

    sh = _new("ARQ-D-CAR", "Detalles de puertas y ventanas", "architecture", "detalle", 25,
              level_label="Tipos", subtitle="Alzados tipo de carpinteria, uno por cada tipo "
                                            "geometrico presente en el modelo")

    def ann(scale):
        mm = lambda v: v * scale / 1000.0
        a: List[D.Prim] = []
        for x0, w, code, desc in labels:
            a.append(Text("ARQ-TEXTO", (x0 + w / 2, -mm(5.0)), code, height_mm=2.6,
                          anchor="center"))
            a.append(Text("ARQ-TEXTO", (x0 + w / 2, -mm(9.5)), desc, height_mm=2.0,
                          anchor="center"))
            a.append(D.LinearDim("COTAS", (x0, 0.0), (x0 + w, 0.0), offset=-mm(14.0),
                                 direction="h"))
        return a

    sh.legend = [("ARQ-CARPINTERIA", "Hoja / pano de carpinteria"),
                 ("ARQ-MUROS-PROY", "Nivel de piso terminado")]
    sh.notes = list(COMMON_NOTES) + [
        "Vidrio, herrajes, marcos, resistencia al fuego y accesibilidad no estan "
        "especificados: figuran como parametros pendientes en el catalogo.",
    ]
    return compose(sh, prims, ann, refs=refs)


def _area_schedule_sheet(model) -> Sheet:
    sh = _new("ARQ-T-ARE", "Cuadro de areas", "architecture", "cuadro", 1,
              level_label="Todos los niveles",
              subtitle="Areas calculadas sobre la geometria del modelo")
    rows: List[List[str]] = []
    total = 0.0
    for level in P.LEVELS:
        lid = level["level_id"]
        sub = 0.0
        for sp in sorted(model.spaces_of_level(lid), key=lambda s: s.code):
            rows.append([lid, sp.code, sp.name[:30], sp.use, "%.2f" % sp.area_m2,
                         "%.2f" % sp.perimeter_m, "%.2f" % sp.clear_height])
            sub += sp.area_m2
        rows.append([lid, "", "SUBTOTAL UTIL %s" % lid, "", "%.2f" % sub, "", ""])
        total += sub
    rows.append(["", "", "TOTAL UTIL", "", "%.2f" % total, "", ""])
    rows.append(["", "", "AREA BRUTA DECLARADA (3 x 432.00)", "",
                 "%.2f" % P.REQ_TOTAL_AREA, "", ""])

    x0, y_top = 24.0, sh.size_mm[1] - 34.0
    D.draw_table(sh, ["NIVEL", "COD", "RECINTO", "USO", "AREA m2", "PERIM m", "h LIBRE m"],
                 rows, [20.0, 16.0, 78.0, 44.0, 26.0, 26.0, 26.0], (x0, y_top),
                 title="CUADRO DE AREAS POR RECINTO", max_rows=78)
    sh.add_paper(Text("LAM-TEXTO", (x0, 86.0),
                      "El area util es inferior al area bruta porque descuenta muros. "
                      "La ocupacion y el aforo no estan calculados.", height_mm=2.4))
    D.finish(sh, rescale=False)
    return sh


def _opening_schedule_sheet(model) -> Sheet:
    sh = _new("ARQ-T-CAR", "Cuadro de puertas y ventanas", "architecture", "cuadro", 1,
              level_label="Todos los niveles",
              subtitle="Carpinteria extraida del catalogo de componentes")
    rows: List[List[str]] = []
    for c in sorted(model.by_type("door"), key=lambda c: c.component_id):
        p = c.parameters
        rows.append(["PUERTA", p.get("schedule_code", ""), c.level_id or "", "%.2f" % p["width_m"],
                     "%.2f" % p["height_m"], str(p.get("leaf_count", "")),
                     "SI" if p.get("exterior") else "NO",
                     "pendiente" if p.get("fire_rating") is None else str(p["fire_rating"])])
    for c in sorted(model.by_type("window"), key=lambda c: c.component_id):
        p = c.parameters
        rows.append(["VENTANA", p.get("schedule_code", ""), c.level_id or "",
                     "%.2f" % p["width_m"], "%.2f" % p["height_m"],
                     "%.2f" % p.get("sill_height_m", 0.0), "SI",
                     "pendiente" if p.get("u_value") is None else str(p["u_value"])])
    x0, y_top = 24.0, sh.size_mm[1] - 34.0
    D.draw_table(sh, ["TIPO", "CODIGO", "NIVEL", "ANCHO m", "ALTO m",
                      "HOJAS / ANTEPECHO", "EXTERIOR", "RESIST. / U"],
                 rows, [30.0, 40.0, 20.0, 26.0, 26.0, 40.0, 24.0, 32.0],
                 (x0, y_top), title="CUADRO DE PUERTAS Y VENTANAS", max_rows=78)
    sh.add_paper(Text("LAM-TEXTO", (x0, 86.0),
                      "Total en el modelo: %d puertas y %d ventanas. Resistencia al fuego, "
                      "herrajes y prestaciones del vidrio quedan pendientes de especificacion."
                      % (len(model.by_type("door")), len(model.by_type("window"))),
                      height_mm=2.4))
    D.finish(sh, rescale=False)
    return sh


# ---------------------------------------------------------------------------
# ESTRUCTURA
# ---------------------------------------------------------------------------


def structure_sheets(model) -> List[Sheet]:
    out: List[Sheet] = []

    # Planta de ejes
    sh = _new("EST-P-EJE", "Planta de ejes", "structure", "planta", 50,
              level_label="Conjunto",
              subtitle="Rejilla estructural: %d ejes en X y %d ejes en Y, vanos de 6.00 m"
                       % (len(P.GRID_X), len(P.GRID_Y)), north=True)
    geom: List[D.Prim] = [PolyLine("ESTR-LOSAS",
                                   [(0, 0), (P.REQ_LENGTH_X, 0),
                                    (P.REQ_LENGTH_X, P.REQ_WIDTH_Y), (0, P.REQ_WIDTH_Y)],
                                   closed=True)]
    for gx in P.GRID_X:
        for gy in P.GRID_Y:
            cw, cd = P.HYP_COLUMN_SIZE
            geom.append(PolyLine("ESTR-COLUMNAS",
                                 [(gx - cw / 2, gy - cd / 2), (gx + cw / 2, gy - cd / 2),
                                  (gx + cw / 2, gy + cd / 2), (gx - cw / 2, gy + cd / 2)],
                                 closed=True))
    sh.legend = [("EJES", "Ejes estructurales"), ("ESTR-COLUMNAS", "Posicion de columnas"),
                 ("COTAS", "Cotas entre ejes")]
    out.append(compose(sh, geom, _grid_ann))

    # Plantas estructurales por nivel
    for level in P.LEVELS:
        lid = level["level_id"]
        prims, refs = V.plan(model, lid, cut_offset=1.20,
                             background_layers=("ESTR-COLUMNAS",),
                             projection_layers=("ESTR-VIGAS", "ESTR-ESCALERA"),
                             show_spaces=False)
        sh = _new("EST-P-%s" % lid, "Planta estructural %s" % level["name"].lower(),
                  "structure", "planta", 50,
                  level_label="%s (N %+0.2f)" % (lid, level["elevation"]),
                  subtitle="Columnas seccionadas, vigas y escalera proyectadas", north=True)
        sh.legend = auto_legend(prims)
        out.append(compose(sh, prims, _grid_ann, refs=refs))

    # Planta de columnas / vigas / losas
    specs = [
        ("EST-P-COL", "Planta de columnas", ("ESTR-COLUMNAS",), (), "Columnas de todos los niveles"),
        ("EST-P-VIG", "Planta de vigas", (), ("ESTR-VIGAS",), "Vigas de entrepiso y cubierta"),
        ("EST-P-LOS", "Planta de losas", (), ("ESTR-LOSAS",), "Losas con sus vacios"),
    ]
    for code, title, bg, proj, sub in specs:
        allp: List[D.Prim] = []
        allr: List[str] = []
        for level in P.LEVELS:
            p, r = V.plan(model, level["level_id"], background_layers=bg,
                          projection_layers=proj, show_spaces=False)
            allp.extend(p)
            allr.extend(r)
        if code == "EST-P-LOS":
            p, r = V.plan(model, "NC", background_layers=(), projection_layers=("ESTR-LOSAS",),
                          show_spaces=False)
            allp.extend(p)
            allr.extend(r)
        sh = _new(code, title, "structure", "planta", 50, level_label="Superpuesto",
                  subtitle=sub, north=True)
        sh.legend = auto_legend(allp)
        out.append(compose(sh, allp, _grid_ann, refs=allr))

    # Planta de cimentacion
    prims: List[D.Prim] = []
    refs: List[str] = []
    for s in V.select(model, layers=["ESTR-CIMENTACION"]):
        polys = s.plan_projection()
        if polys:
            prims.extend(V.polys_to_prims(polys, "ESTR-CIMENTACION"))
            refs.append(s.solid_id)
    sh = _new("EST-P-CIM", "Planta de cimentacion conceptual", "structure", "planta", 50,
              level_label="NF (N %+0.2f)" % P.HYP_FOOTING_TOP_LEVEL,
              subtitle="Zapatas y pedestales conceptuales. Dimensiones sin estudio geotecnico",
              north=True)
    sh.legend = [("ESTR-CIMENTACION", "Zapatas y pedestales conceptuales")]
    sh.notes = list(COMMON_NOTES) + [
        "Las dimensiones de zapata NO proceden de calculo: requieren estudio de suelos, "
        "capacidad portante y verificacion de asentamientos.",
    ]
    out.append(compose(sh, prims, _grid_ann, refs=refs))

    # Elevaciones y cortes estructurales
    struct_layers = ("ESTR-COLUMNAS", "ESTR-VIGAS", "ESTR-LOSAS", "ESTR-ESCALERA",
                     "ESTR-CIMENTACION")
    for fac in ("S", "W"):
        cfg = V.FACADES[fac]
        prims, refs = V.elevation(model, fac, layers=struct_layers)
        sh = _new("EST-E-%s" % fac, "Elevacion estructural %s" % cfg["name"].lower(),
                  "structure", "alzado", 75, level_label="Conjunto",
                  subtitle="Porticos vistos en proyeccion ortografica")
        sh.legend = auto_legend(prims)
        span = P.REQ_LENGTH_X if cfg["axis"] == "x" else P.REQ_WIDTH_Y
        u0, u1 = (-span, 0.0) if cfg["flip"] else (0.0, span)
        out.append(compose(sh, prims,
                           lambda s, f=fac, r=(u0, u1): V.elevation_annotations(s, r, f),
                           refs=refs))

    for sl in SECTION_LINES:
        prims, refs = V.section(model, sl["axis"], sl["value"], layers=struct_layers)
        sh = _new("EST-C-%s" % sl["label"], "Corte estructural %s-%s" % (sl["label"], sl["label"]),
                  "structure", "corte", 75, level_label="Conjunto",
                  subtitle="Plano de corte %s = %.2f m" % (sl["axis"].upper(), sl["value"]))
        sh.legend = auto_legend(prims)
        span = P.REQ_WIDTH_Y if sl["axis"] == "x" else P.REQ_LENGTH_X
        out.append(compose(sh, prims,
                           lambda s, a=sl["axis"], r=(0.0, span): V.section_annotations(s, r, a),
                           refs=refs))

    out.append(_joint_detail_sheet(model))
    out.append(_structure_schedule_sheet(model))
    return out


def _joint_detail_sheet(model) -> Sheet:
    """Detalle geometrico del nudo viga-columna, derivado del modelo."""
    gx, gy = P.GRID_X[1], P.GRID_Y[1]
    win = (gx - 1.6, gy - 1.6, gx + 1.6, gy + 1.6)
    plan_p, r1 = V.detail_plan(model, "N1", win, cut_offset=3.30,
                               layers=("ESTR-COLUMNAS", "ESTR-VIGAS"))
    sec_p, r2 = V.detail_section(model, "y", gy, (gx - 1.6, 2.6, gx + 1.6, 4.0),
                                 layers=("ESTR-COLUMNAS", "ESTR-VIGAS", "ESTR-LOSAS"))
    dx = 4.2
    shifted = [PolyLine(p.layer, [(x + gx - 1.6 + dx - (gx - 1.6), y) for x, y in p.points],
                        p.closed) for p in sec_p if isinstance(p, PolyLine)]

    sh = _new("EST-D-NUD", "Detalles geometricos de conexiones", "structure", "detalle", 20,
              level_label="Nudo tipo %s%s" % (P.GRID_X_LABELS[1], P.GRID_Y_LABELS[1]),
              subtitle="Planta del nudo a cota de viga (izquierda) y corte vertical (derecha)")

    def ann(scale):
        mm = lambda v: v * scale / 1000.0
        cw, cd = P.HYP_COLUMN_SIZE
        stem = round(P.HYP_BEAM_DEPTH - P.HYP_SLAB_THICKNESS, 3)
        a: List[D.Prim] = [
            Text("LAM-TEXTO", (win[0], win[3] + mm(6.0)), "PLANTA DEL NUDO", height_mm=3.0),
            Text("LAM-TEXTO", (win[0] + dx, win[3] + mm(6.0)), "CORTE DEL NUDO", height_mm=3.0),
            D.LinearDim("COTAS", (gx - cw / 2, gy - cd / 2), (gx + cw / 2, gy - cd / 2),
                        offset=-mm(7.0), direction="h"),
            D.LinearDim("COTAS", (gx - cw / 2, gy - cd / 2), (gx - cw / 2, gy + cd / 2),
                        offset=-mm(7.0), direction="v"),
            Text("LAM-TEXTO", (win[0], win[1] - mm(13.0)),
                 "Columna %.2f x %.2f m   Alma de viga %.2f x %.2f m   Losa %.2f m   "
                 "Canto total viga+losa %.2f m"
                 % (cw, cd, P.HYP_BEAM_WIDTH, stem, P.HYP_SLAB_THICKNESS, P.HYP_BEAM_DEPTH),
                 height_mm=2.4),
            Text("LAM-TEXTO", (win[0], win[1] - mm(18.0)),
                 "El detalle es GEOMETRICO. No incluye refuerzo, estribos de confinamiento, "
                 "longitudes de anclaje ni verificacion de cortante en el nudo.", height_mm=2.4),
        ]
        return a

    sh.legend = auto_legend(plan_p + shifted)
    sh.notes = list(COMMON_NOTES) + [
        "El despiece de refuerzo y la verificacion del nudo requieren diseno estructural.",
    ]
    return compose(sh, plan_p + shifted, ann, refs=list(r1) + list(r2))


def _structure_schedule_sheet(model) -> Sheet:
    sh = _new("EST-T-ELE", "Cuadro de elementos estructurales", "structure", "cuadro", 1,
              level_label="Todos los niveles",
              subtitle="Resumen por tipo con parametros pendientes declarados")
    groups: Dict[Tuple[str, str, str], Dict[str, Any]] = {}
    for c in model.by_discipline("structure"):
        if c.type == "beam_column_joint":
            dims = "-"
        elif c.dimensions:
            dims = " x ".join("%.2f" % v for k, v in sorted(c.dimensions.items())
                              if isinstance(v, (int, float)))
        else:
            dims = "-"
        key = (c.type, c.level_id or "-", dims)
        g = groups.setdefault(key, {"count": 0, "material": c.material,
                                    "pending": set(c.requires_calculation)})
        g["count"] += 1
    rows: List[List[str]] = []
    for (typ, lid, dims), g in sorted(groups.items()):
        rows.append([typ, lid, dims[:30], str(g["count"]), g["material"] or "-",
                     "pendiente", "pendiente", str(len(g["pending"]))])
    x0, y_top = 24.0, sh.size_mm[1] - 34.0
    D.draw_table(sh, ["TIPO", "NIVEL", "DIMENSIONES m", "CANT", "MATERIAL",
                      "f'c", "REFUERZO", "N PARAM PEND"],
                 rows, [40.0, 20.0, 60.0, 18.0, 46.0, 24.0, 28.0, 32.0],
                 (x0, y_top), title="CUADRO DE ELEMENTOS ESTRUCTURALES", max_rows=70)
    sh.add_paper(Text("LAM-TEXTO", (x0, 92.0),
                      "Las dimensiones son HIPOTESIS GEOMETRICAS CONCEPTUALES. La resistencia "
                      "especificada del concreto y el refuerzo no estan determinados y figuran "
                      "como pendientes en todos los elementos.", height_mm=2.4))
    sh.add_paper(Text("LAM-TEXTO", (x0, 86.0),
                      "Volumen de concreto estructural medido sobre el modelo: %.2f m3."
                      % sum(s.volume() for s in model.solids.values()
                            if s.discipline == "structure"
                            and s.material == "concreto_estructural"),
                      height_mm=2.4))
    D.finish(sh, rescale=False)
    return sh
