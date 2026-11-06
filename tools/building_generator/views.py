"""Generacion de vistas 2D desde la geometria del modelo.

Ninguna vista se dibuja a mano. Cada una se calcula desde los mismos solidos
parametricos del modelo:

  planta        seccion horizontal a cota de corte + proyeccion de lo que
                queda por encima
  alzado        silueta ortografica sobre un plano vertical
  corte         interseccion con un plano vertical
  isometrico    proyeccion axonometrica de las aristas
  detalle       la misma planta o corte restringido a una ventana

Por eso un cambio en `params.py` se propaga simultaneamente al modelo 3D y a
todos los planos: es la condicion del apartado 11 de la solicitud.
"""

from __future__ import annotations

import math
from typing import Any, Callable, Dict, Iterable, List, Optional, Sequence, Tuple

from shapely.geometry import Polygon

import params as P
import solids as S
from drafting import Arc, Circle, Hatch, Line, LinearDim, PolyLine, Prim, Text

Point2 = Tuple[float, float]

# Correspondencia entre la capa del solido y la capa de dibujo.
LAYER_MAP_CUT = {
    "ARQ-MUROS": "ARQ-MUROS-CORTE",
    "ARQ-PUERTAS": "ARQ-CARPINTERIA",
    "ARQ-VENTANAS": "ARQ-CARPINTERIA",
    "ARQ-CUBIERTA": "ARQ-CUBIERTA",
    "ARQ-ESPACIOS": None,
}
LAYER_MAP_PROJ = {
    "ARQ-MUROS": "ARQ-MUROS-PROY",
    "ARQ-PUERTAS": "ARQ-CARPINTERIA",
    "ARQ-VENTANAS": "ARQ-CARPINTERIA",
    "ARQ-CUBIERTA": "ARQ-CUBIERTA",
    "ARQ-ESPACIOS": None,
}

ARCH_BACKGROUND = ("ARQ-MUROS", "ARQ-PUERTAS", "ARQ-VENTANAS", "ESTR-COLUMNAS",
                   "ESTR-ESCALERA")
STRUCT_LAYERS = ("ESTR-COLUMNAS", "ESTR-VIGAS", "ESTR-LOSAS", "ESTR-ESCALERA",
                 "ESTR-CIMENTACION")


def _draw_layer(solid_layer: str, cut: bool) -> Optional[str]:
    table = LAYER_MAP_CUT if cut else LAYER_MAP_PROJ
    if solid_layer in table:
        return table[solid_layer]
    return solid_layer


# ---------------------------------------------------------------------------
# Conversion de poligonos a primitivas
# ---------------------------------------------------------------------------


def polys_to_prims(polys: Iterable[Polygon], layer: str,
                   simplify: float = 0.0) -> List[Prim]:
    out: List[Prim] = []
    for poly in polys:
        if poly is None or poly.is_empty:
            continue
        geoms = poly.geoms if poly.geom_type.startswith("Multi") else [poly]
        for g in geoms:
            if g.is_empty or g.geom_type != "Polygon":
                continue
            if simplify > 0:
                g = g.simplify(simplify, preserve_topology=True)
                if g.is_empty or g.geom_type != "Polygon":
                    continue
            ext = [(round(x, 5), round(y, 5)) for x, y in list(g.exterior.coords)[:-1]]
            if len(ext) >= 3:
                out.append(PolyLine(layer, ext, closed=True))
            for ring in g.interiors:
                pts = [(round(x, 5), round(y, 5)) for x, y in list(ring.coords)[:-1]]
                if len(pts) >= 3:
                    out.append(PolyLine(layer, pts, closed=True))
    return out


def union_by_layer(items: Sequence[Tuple[str, Polygon]], simplify: float = 0.0) -> List[Prim]:
    """Une los poligonos de cada capa antes de dibujarlos.

    Los muros se modelan descompuestos en piezas (jambas, antepechos y
    dinteles). Si se dibujara el contorno de cada pieza, la planta y el alzado
    saldrian cruzados de lineas internas que no existen en el edificio. Al unir
    por capa se obtiene el contorno real: el muro continuo con sus huecos, ya
    que el hueco no pertenece a ninguna pieza.
    """
    from shapely.ops import unary_union

    grouped: Dict[str, List[Polygon]] = {}
    for layer, poly in items:
        if poly is None or poly.is_empty:
            continue
        grouped.setdefault(layer, []).append(poly)
    out: List[Prim] = []
    for layer in sorted(grouped):
        merged = unary_union(grouped[layer])
        out.extend(polys_to_prims([merged], layer, simplify=simplify))
    return out


def edges_to_prims(edges: Sequence[Tuple[Tuple[float, float, float],
                                         Tuple[float, float, float]]],
                   project: Callable[[Tuple[float, float, float]], Point2],
                   layer: str) -> List[Prim]:
    out: List[Prim] = []
    seen = set()
    for a, b in edges:
        pa, pb = project(a), project(b)
        key = (round(pa[0], 4), round(pa[1], 4), round(pb[0], 4), round(pb[1], 4))
        rkey = (key[2], key[3], key[0], key[1])
        if key in seen or rkey in seen:
            continue
        if abs(pa[0] - pb[0]) < 1e-7 and abs(pa[1] - pb[1]) < 1e-7:
            continue
        seen.add(key)
        out.append(Line(layer, pa, pb))
    return out


# ---------------------------------------------------------------------------
# Seleccion de solidos
# ---------------------------------------------------------------------------


def select(model, *, layers: Optional[Sequence[str]] = None,
           level_ids: Optional[Sequence[str]] = None,
           disciplines: Optional[Sequence[str]] = None,
           levelless: bool = False) -> List[S.Solid]:
    out: List[S.Solid] = []
    for s in model.solids.values():
        if layers is not None and s.layer not in layers:
            continue
        if disciplines is not None and s.discipline not in disciplines:
            continue
        if level_ids is not None:
            if s.level_id in level_ids:
                pass
            elif levelless and s.level_id is None:
                pass
            else:
                continue
        out.append(s)
    return sorted(out, key=lambda s: s.solid_id)


# ---------------------------------------------------------------------------
# Ejes, cotas y rotulos
# ---------------------------------------------------------------------------


def grid_annotations(scale: int, x_range: Tuple[float, float],
                     y_range: Tuple[float, float]) -> List[Prim]:
    """Ejes estructurales con burbujas, cotas parciales y cota total."""
    mm = lambda v: v * scale / 1000.0
    overhang = mm(14.0)
    bubble_r = mm(4.2)
    bubble_off = mm(22.0)
    txt = 2.6

    out: List[Prim] = []
    y0, y1 = y_range
    x0, x1 = x_range

    for label, gx in zip(P.GRID_X_LABELS, P.GRID_X):
        out.append(Line("EJES", (gx, y0 - overhang), (gx, y1 + overhang)))
        for sign in (-1, +1):
            cy = (y0 - bubble_off) if sign < 0 else (y1 + bubble_off)
            out.append(Circle("EJES", (gx, cy), bubble_r))
            out.append(Text("EJES-TEXTO", (gx, cy), label, height_mm=txt,
                            anchor="center", vertical="middle"))
    for label, gy in zip(P.GRID_Y_LABELS, P.GRID_Y):
        out.append(Line("EJES", (x0 - overhang, gy), (x1 + overhang, gy)))
        for sign in (-1, +1):
            cx = (x0 - bubble_off) if sign < 0 else (x1 + bubble_off)
            out.append(Circle("EJES", (cx, gy), bubble_r))
            out.append(Text("EJES-TEXTO", (cx, gy), label, height_mm=txt,
                            anchor="center", vertical="middle"))

    # cotas parciales entre ejes y cota total
    d1 = mm(9.0)
    for i in range(len(P.GRID_X) - 1):
        out.append(LinearDim("COTAS", (P.GRID_X[i], y0), (P.GRID_X[i + 1], y0),
                             offset=-d1, direction="h"))
    out.append(LinearDim("COTAS", (P.GRID_X[0], y0), (P.GRID_X[-1], y0),
                         offset=-d1 - mm(9.0), direction="h"))
    for j in range(len(P.GRID_Y) - 1):
        out.append(LinearDim("COTAS", (x0, P.GRID_Y[j]), (x0, P.GRID_Y[j + 1]),
                             offset=-d1, direction="v"))
    out.append(LinearDim("COTAS", (x0, P.GRID_Y[0]), (x0, P.GRID_Y[-1]),
                         offset=-d1 - mm(9.0), direction="v"))
    return out


def space_labels(model, level_id: str, scale: int, with_area: bool = True) -> List[Prim]:
    out: List[Prim] = []
    for sp in sorted(model.spaces_of_level(level_id), key=lambda s: s.code):
        x0, y0, x1, y1 = sp.rect
        if sp.shape == "ring":
            cx = round((P.RING_X0 + P.CORE_X0) / 2, 3)
            cy = round((P.RING_Y0 + P.CORE_Y0) / 2, 3)
        else:
            cx, cy = (x0 + x1) / 2.0, (y0 + y1) / 2.0
        dy = scale / 1000.0 * 3.4
        out.append(Text("ARQ-TEXTO", (cx, cy + dy), "%s %s" % (sp.code, sp.name[:26]),
                        height_mm=2.4, anchor="center"))
        if with_area:
            out.append(Text("ARQ-TEXTO", (cx, cy - dy), "%.2f m2  h=%.2f m"
                            % (sp.area_m2, sp.clear_height), height_mm=2.0, anchor="center"))
    return out


def level_mark(level_id: str, scale: int, position: Point2) -> List[Prim]:
    lv = P.level_by_id(level_id)
    mm = lambda v: v * scale / 1000.0
    x, y = position
    s = mm(3.2)
    return [
        PolyLine("NIVELES", [(x, y), (x - s, y + s * 1.6), (x + s, y + s * 1.6)], closed=True),
        Line("NIVELES", (x - s * 3.4, y + s * 1.6), (x + s * 3.4, y + s * 1.6)),
        Text("NIVELES", (x + s * 3.8, y + s * 1.9),
             "%s  N %+0.2f m" % (lv["level_id"], lv["elevation"]), height_mm=2.4),
    ]


# ---------------------------------------------------------------------------
# PLANTA
# ---------------------------------------------------------------------------


def plan(
    model, level_id: str, *,
    cut_offset: float = 1.20,
    background_layers: Sequence[str] = ARCH_BACKGROUND,
    projection_layers: Sequence[str] = (),
    foreground_layers: Sequence[str] = (),
    include_levelless_foreground: bool = False,
    show_spaces: bool = True,
) -> Tuple[List[Prim], List[str]]:
    """Planta del nivel: seccion horizontal del fondo + proyeccion del resto."""
    level = P.level_by_id(level_id)
    e = level["elevation"]
    cut_z = round(e + cut_offset, 4)
    prims: List[Prim] = []
    refs: List[str] = []
    merged: List[Tuple[str, Polygon]] = []

    # fondo seccionado
    for s in select(model, layers=list(background_layers), level_ids=[level_id]):
        dl = _draw_layer(s.layer, cut=True)
        if dl is None:
            continue
        polys = s.plan_cut(cut_z)
        if polys:
            merged.extend((dl, p) for p in polys)
            refs.append(s.solid_id)

    # elementos proyectados (por encima del corte)
    for s in select(model, layers=list(projection_layers), level_ids=[level_id]):
        dl = _draw_layer(s.layer, cut=False)
        if dl is None:
            continue
        polys = s.plan_projection()
        if polys:
            merged.extend((dl, p) for p in polys)
            refs.append(s.solid_id)

    prims.extend(union_by_layer(merged))

    # instalaciones u otros elementos de la disciplina de la lamina
    if foreground_layers:
        sel = select(model, layers=list(foreground_layers), level_ids=[level_id],
                     levelless=include_levelless_foreground)
        for s in sel:
            polys = s.plan_projection()
            if polys:
                prims.extend(polys_to_prims(polys, s.layer))
                refs.append(s.solid_id)

    if show_spaces:
        for sp in model.spaces_of_level(level_id):
            if sp.shape == "ring" and sp.polygon:
                prims.append(PolyLine("ARQ-ESPACIOS",
                                      [(p[0], p[1]) for p in sp.polygon[0]], closed=True))
            else:
                x0, y0, x1, y1 = sp.rect
                prims.append(PolyLine("ARQ-ESPACIOS",
                                      [(x0, y0), (x1, y0), (x1, y1), (x0, y1)], closed=True))
    return prims, refs


# ---------------------------------------------------------------------------
# ALZADO
# ---------------------------------------------------------------------------


FACADES = {
    "S": {"axis": "x", "flip": False, "name": "Fachada frontal (sur)"},
    "N": {"axis": "x", "flip": True, "name": "Fachada posterior (norte)"},
    "E": {"axis": "y", "flip": False, "name": "Fachada lateral derecha (este)"},
    "W": {"axis": "y", "flip": True, "name": "Fachada lateral izquierda (oeste)"},
}


# Capas que se dibujan en alzado aunque no esten junto al plano de fachada,
# porque su silueta SI corresponde a lo que se ve (cantos de losa, cubierta).
ELEVATION_ALWAYS = {"ESTR-LOSAS", "ARQ-CUBIERTA"}


def _faces_facade(solid: S.Solid, facade: str, band: float) -> bool:
    """True si el solido pertenece al plano de fachada visible.

    Un alzado muestra lo que se ve desde fuera, no la silueta de todo el
    edificio. Sin este filtro, los muros interiores y la fachada opuesta se
    proyectarian sobre el mismo plano y el dibujo seria ilegible.
    """
    if solid.layer in ELEVATION_ALWAYS:
        return True
    lo, hi = solid.bbox()
    if facade == "S":
        return lo[1] <= band
    if facade == "N":
        return hi[1] >= P.REQ_WIDTH_Y - band
    if facade == "W":
        return lo[0] <= band
    return hi[0] >= P.REQ_LENGTH_X - band


def elevation(model, facade: str, *, layers: Optional[Sequence[str]] = None,
              band: float = 0.80) -> Tuple[List[Prim], List[str]]:
    cfg = FACADES[facade]
    axis, flip = cfg["axis"], cfg["flip"]
    sel_layers = list(layers) if layers else [
        "ARQ-MUROS", "ARQ-VENTANAS", "ARQ-PUERTAS", "ARQ-CUBIERTA",
        "ESTR-LOSAS", "ESTR-COLUMNAS",
    ]
    merged: List[Tuple[str, Polygon]] = []
    refs: List[str] = []
    for s in select(model, layers=sel_layers):
        dl = _draw_layer(s.layer, cut=False)
        if dl is None or not _faces_facade(s, facade, band):
            continue
        polys = s.elevation(axis, flip)
        if polys:
            merged.extend((dl, p) for p in polys)
            refs.append(s.solid_id)
    return union_by_layer(merged), refs


def elevation_annotations(scale: int, u_range: Tuple[float, float],
                          facade: str) -> List[Prim]:
    mm = lambda v: v * scale / 1000.0
    out: List[Prim] = []
    u0, u1 = u_range
    labels = P.GRID_X_LABELS if FACADES[facade]["axis"] == "x" else P.GRID_Y_LABELS
    coords = P.GRID_X if FACADES[facade]["axis"] == "x" else P.GRID_Y
    flip = FACADES[facade]["flip"]

    top = round(P.ROOF_LEVEL["elevation"] + P.HYP_PARAPET_HEIGHT, 3)
    for label, c in zip(labels, coords):
        u = -c if flip else c
        out.append(Line("EJES", (u, -mm(10.0)), (u, top + mm(14.0))))
        cy = top + mm(22.0)
        out.append(Circle("EJES", (u, cy), mm(4.2)))
        out.append(Text("EJES-TEXTO", (u, cy), label, height_mm=2.6,
                        anchor="center", vertical="middle"))

    # marcas de nivel a la izquierda
    for lv in list(P.LEVELS) + [P.ROOF_LEVEL]:
        z = lv["elevation"]
        out.append(Line("NIVELES", (u0 - mm(12.0), z), (u1 + mm(4.0), z)))
        out.append(Text("NIVELES", (u0 - mm(12.0), z + mm(1.4)),
                        "%s  N %+0.2f" % (lv["level_id"], z), height_mm=2.2))
    # cota total de altura
    out.append(LinearDim("COTAS", (u1, 0.0), (u1, top), offset=mm(10.0), direction="v"))
    for i in range(len(P.LEVELS)):
        z0 = P.LEVELS[i]["elevation"]
        z1 = round(z0 + P.REQ_FLOOR_TO_FLOOR, 3)
        out.append(LinearDim("COTAS", (u1, z0), (u1, z1), offset=mm(4.0), direction="v"))
    return out


# ---------------------------------------------------------------------------
# CORTE
# ---------------------------------------------------------------------------


def section(model, axis: str, value: float, *,
            layers: Optional[Sequence[str]] = None,
            flip: bool = False) -> Tuple[List[Prim], List[str]]:
    sel_layers = list(layers) if layers else [
        "ARQ-MUROS", "ARQ-PUERTAS", "ARQ-VENTANAS", "ARQ-CUBIERTA",
        "ESTR-COLUMNAS", "ESTR-VIGAS", "ESTR-LOSAS", "ESTR-ESCALERA",
        "ESTR-CIMENTACION",
    ]
    merged: List[Tuple[str, Polygon]] = []
    refs: List[str] = []
    for s in select(model, layers=sel_layers):
        dl = _draw_layer(s.layer, cut=True)
        if dl is None:
            continue
        polys = s.vertical_cut(axis, value, flip)
        if polys:
            merged.extend((dl, p) for p in polys)
            refs.append(s.solid_id)
    return union_by_layer(merged), refs


def section_annotations(scale: int, u_range: Tuple[float, float], axis: str,
                        flip: bool = False) -> List[Prim]:
    mm = lambda v: v * scale / 1000.0
    out: List[Prim] = []
    u0, u1 = u_range
    labels = P.GRID_Y_LABELS if axis == "x" else P.GRID_X_LABELS
    coords = P.GRID_Y if axis == "x" else P.GRID_X
    top = round(P.ROOF_LEVEL["elevation"] + P.HYP_PARAPET_HEIGHT, 3)

    for label, c in zip(labels, coords):
        u = -c if flip else c
        out.append(Line("EJES", (u, -mm(10.0)), (u, top + mm(14.0))))
        cy = top + mm(22.0)
        out.append(Circle("EJES", (u, cy), mm(4.2)))
        out.append(Text("EJES-TEXTO", (u, cy), label, height_mm=2.6,
                        anchor="center", vertical="middle"))

    for lv in list(P.LEVELS) + [P.ROOF_LEVEL]:
        z = lv["elevation"]
        out.append(Line("NIVELES", (u0 - mm(12.0), z), (u1 + mm(4.0), z)))
        out.append(Text("NIVELES", (u0 - mm(12.0), z + mm(1.4)),
                        "%s  N %+0.2f" % (lv["level_id"], z), height_mm=2.2))
    for i in range(len(P.LEVELS)):
        z0 = P.LEVELS[i]["elevation"]
        out.append(LinearDim("COTAS", (u1, z0), (u1, round(z0 + P.REQ_CLEAR_HEIGHT, 3)),
                             offset=mm(5.0), direction="v",
                             override_text="h libre %.2f" % P.REQ_CLEAR_HEIGHT))
        out.append(LinearDim("COTAS", (u1, z0), (u1, round(z0 + P.REQ_FLOOR_TO_FLOOR, 3)),
                             offset=mm(13.0), direction="v"))
    out.append(LinearDim("COTAS", (u1, 0.0), (u1, top), offset=mm(22.0), direction="v"))
    return out


def section_trace(scale: int, axis: str, value: float, label: str) -> List[Prim]:
    """Traza del plano de corte para dibujar sobre una planta."""
    mm = lambda v: v * scale / 1000.0
    out: List[Prim] = []
    if axis == "x":
        a, b = (value, -mm(16.0)), (value, P.REQ_WIDTH_Y + mm(16.0))
    else:
        a, b = (-mm(16.0), value), (P.REQ_LENGTH_X + mm(16.0), value)
    out.append(Line("CORTE-TRAZA", a, b))
    for pt in (a, b):
        out.append(Circle("CORTE-TRAZA", pt, mm(4.0)))
        out.append(Text("LAM-TEXTO", pt, label, height_mm=2.6, anchor="center",
                        vertical="middle"))
    return out


# ---------------------------------------------------------------------------
# ISOMETRICO
# ---------------------------------------------------------------------------


def iso_projector(elev_deg: float = 30.0, azim_deg: float = 45.0) -> Callable:
    ca, sa = math.cos(math.radians(azim_deg)), math.sin(math.radians(azim_deg))
    ce, se = math.cos(math.radians(elev_deg)), math.sin(math.radians(elev_deg))

    def project(p):
        x, y, z = p
        u = x * ca - y * sa
        v = (x * sa + y * ca) * se + z * ce
        return (round(u, 5), round(v, 5))
    return project


def isometric(model, *, layers: Optional[Sequence[str]] = None,
              level_ids: Optional[Sequence[str]] = None,
              elev_deg: float = 30.0, azim_deg: float = 45.0,
              layer_override: Optional[str] = None,
              max_edges: int = 60000) -> Tuple[List[Prim], List[str]]:
    project = iso_projector(elev_deg, azim_deg)
    prims: List[Prim] = []
    refs: List[str] = []
    count = 0
    for s in select(model, layers=list(layers) if layers else None,
                    level_ids=list(level_ids) if level_ids else None, levelless=True):
        dl = layer_override or _draw_layer(s.layer, cut=False)
        if dl is None:
            continue
        edges = s.iso_edges()
        if not edges:
            continue
        if count + len(edges) > max_edges:
            break
        count += len(edges)
        prims.extend(edges_to_prims(edges, project, dl))
        refs.append(s.solid_id)
    return prims, refs


def exploded_isometric(model, *, layers: Sequence[str], spacing: float = 6.0,
                       elev_deg: float = 30.0, azim_deg: float = 45.0
                       ) -> Tuple[List[Prim], List[str]]:
    """Vista explosionada: cada nivel se desplaza verticalmente."""
    project = iso_projector(elev_deg, azim_deg)
    order = [lv["level_id"] for lv in P.ALL_LEVELS]
    prims: List[Prim] = []
    refs: List[str] = []
    for i, lid in enumerate(order):
        dz = spacing * i
        for s in select(model, layers=list(layers), level_ids=[lid]):
            dl = _draw_layer(s.layer, cut=False)
            if dl is None:
                continue
            edges = [((a[0], a[1], a[2] + dz), (b[0], b[1], b[2] + dz))
                     for a, b in s.iso_edges()]
            if not edges:
                continue
            prims.extend(edges_to_prims(edges, project, dl))
            refs.append(s.solid_id)
    return prims, refs


# ---------------------------------------------------------------------------
# DETALLE
# ---------------------------------------------------------------------------


def detail_plan(model, level_id: str, window: Tuple[float, float, float, float], *,
                cut_offset: float = 1.20,
                layers: Sequence[str] = ARCH_BACKGROUND) -> Tuple[List[Prim], List[str]]:
    """Planta restringida a una ventana rectangular (x0, y0, x1, y1)."""
    from shapely.geometry import box as sbox

    level = P.level_by_id(level_id)
    cut_z = round(level["elevation"] + cut_offset, 4)
    clip = sbox(*window)
    prims: List[Prim] = []
    refs: List[str] = []
    for s in select(model, layers=list(layers), level_ids=[level_id]):
        dl = _draw_layer(s.layer, cut=True)
        if dl is None:
            continue
        clipped = []
        for poly in s.plan_cut(cut_z):
            inter = poly.intersection(clip)
            if not inter.is_empty:
                clipped.append(inter)
        if clipped:
            prims.extend(polys_to_prims(clipped, dl))
            refs.append(s.solid_id)
    prims.append(PolyLine("CORTE-TRAZA",
                          [(window[0], window[1]), (window[2], window[1]),
                           (window[2], window[3]), (window[0], window[3])], closed=True))
    return prims, refs


def detail_section(model, axis: str, value: float,
                   window: Tuple[float, float, float, float], *,
                   layers: Optional[Sequence[str]] = None,
                   flip: bool = False) -> Tuple[List[Prim], List[str]]:
    from shapely.geometry import box as sbox

    clip = sbox(*window)
    prims, refs = [], []
    sel_layers = list(layers) if layers else [
        "ARQ-MUROS", "ARQ-PUERTAS", "ARQ-VENTANAS", "ESTR-COLUMNAS", "ESTR-VIGAS",
        "ESTR-LOSAS", "ESTR-ESCALERA",
    ]
    for s in select(model, layers=sel_layers):
        dl = _draw_layer(s.layer, cut=True)
        if dl is None:
            continue
        clipped = []
        for poly in s.vertical_cut(axis, value, flip):
            inter = poly.intersection(clip)
            if not inter.is_empty:
                clipped.append(inter)
        if clipped:
            prims.extend(polys_to_prims(clipped, dl))
            refs.append(s.solid_id)
    return prims, refs


# ---------------------------------------------------------------------------
# DIAGRAMAS (topologia desde el grafo de conexiones)
# ---------------------------------------------------------------------------


def node_box(x: float, y: float, w: float, h: float, label: str,
             sublabel: str = "", layer: str = "DIAGRAMA",
             text_layer: str = "DIAGRAMA-TEXTO") -> List[Prim]:
    out: List[Prim] = [
        PolyLine(layer, [(x, y), (x + w, y), (x + w, y + h), (x, y + h)], closed=True),
        Text(text_layer, (x + w / 2, y + h * 0.58), label, height_mm=2.4, anchor="center"),
    ]
    if sublabel:
        out.append(Text(text_layer, (x + w / 2, y + h * 0.22), sublabel, height_mm=1.9,
                        anchor="center"))
    return out


def ortho_connector(a: Point2, b: Point2, layer: str = "DIAGRAMA") -> List[Prim]:
    mx = (a[0] + b[0]) / 2.0
    return [
        Line(layer, a, (mx, a[1])),
        Line(layer, (mx, a[1]), (mx, b[1])),
        Line(layer, (mx, b[1]), b),
    ]
