"""Paquete arquitectonico: espacios, muros, carpinteria, parapeto y caseton.

Las aperturas de puertas y ventanas se resuelven por DESCOMPOSICION del muro en
prismas (jamba izquierda, jamba derecha, antepecho y dintel). El resultado
geometrico es identico a una diferencia booleana y ademas es exacto en las
secciones, por lo que planta, alzado y corte coinciden sin tolerancias.

Nada de este paquete constituye verificacion de evacuacion, accesibilidad,
iluminacion natural, ventilacion ni cumplimiento normativo.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple

import params as P
import solids as S
from catalog import Component, Connection, Space
from discipline_structure import stair_geometry, stair_void, _shaft_rects

BAND_AXIS = {"SOUTH": "x", "NORTH": "x", "WEST": "y", "EAST": "y"}
BAND_FACADE = {"SOUTH": "S", "NORTH": "N", "WEST": "W", "EAST": "E"}

DOOR_WIDTH_BY_USE = {
    "bano": P.HYP_DOOR_WIDTH_BATH,
    "aseo": P.HYP_DOOR_WIDTH_BATH,
    "cuarto_electrico": P.HYP_DOOR_WIDTH_TECH,
    "cuarto_telecom": P.HYP_DOOR_WIDTH_TECH,
    "zona_tecnica": P.HYP_DOOR_WIDTH_TECH,
    "cuarto_hvac": P.HYP_DOOR_WIDTH_TECH,
    "archivo": P.HYP_DOOR_WIDTH_TECH,
    "sala_reuniones": P.HYP_DOOR_WIDTH_OFFICE,
    "sala_juntas": P.HYP_DOOR_WIDTH_DOUBLE,
    "recepcion": P.HYP_DOOR_WIDTH_DOUBLE,
}

# Recintos sin ventana exterior por su posicion (ninguno en este programa, se
# conserva el mecanismo por si cambia la zonificacion).
NO_WINDOW_USES: Tuple[str, ...] = ()


# ---------------------------------------------------------------------------
# Descomposicion de muros con aperturas
# ---------------------------------------------------------------------------


def decompose_wall(
    axis: str, line: float, u0: float, u1: float, z0: float, z1: float,
    thickness: float, openings: List[Dict[str, float]],
) -> List[S.Prism]:
    """Devuelve los prismas de un muro con sus aperturas descontadas.

    `axis` = 'x' -> el muro corre sobre X y `line` es su coordenada Y.
    `axis` = 'y' -> el muro corre sobre Y y `line` es su coordenada X.
    Cada apertura es {'u0','u1','z0','z1'} en el sistema del muro.
    """
    half = thickness / 2.0
    prisms: List[S.Prism] = []

    def piece(a: float, b: float, za: float, zb: float) -> None:
        if (b - a) < 1e-6 or (zb - za) < 1e-6:
            return
        if axis == "x":
            prisms.append(S.box_prism(a, line - half, b, line + half, za, zb))
        else:
            prisms.append(S.box_prism(line - half, a, line + half, b, za, zb))

    ordered = sorted(openings, key=lambda o: o["u0"])
    cursor = u0
    for o in ordered:
        a = max(u0, o["u0"])
        b = min(u1, o["u1"])
        if b <= a:
            continue
        piece(cursor, a, z0, z1)
        if o["z0"] > z0 + 1e-9:
            piece(a, b, z0, o["z0"])
        if o["z1"] < z1 - 1e-9:
            piece(a, b, o["z1"], z1)
        cursor = max(cursor, b)
    piece(cursor, u1, z0, z1)
    return prisms


def window_slots(u0: float, u1: float, module: float = P.HYP_WINDOW_MODULE,
                 min_pier: float = 0.60) -> List[Tuple[float, float]]:
    """Reparte ventanas de ancho `module` en el tramo [u0, u1].

    Criterio puramente geometrico de reparto uniforme con machon minimo. No es
    un calculo de iluminacion ni de ventilacion natural.
    """
    length = u1 - u0
    n = int((length - min_pier) // (module + min_pier))
    if n < 1:
        return []
    gap = (length - n * module) / (n + 1)
    out: List[Tuple[float, float]] = []
    cur = u0 + gap
    for _ in range(n):
        out.append((round(cur, 4), round(cur + module, 4)))
        cur += module + gap
    return out


def _free_subspans(u0: float, u1: float, taken: List[Tuple[float, float]]) -> List[Tuple[float, float]]:
    """Tramos libres de [u0, u1] tras descontar los rangos ocupados.

    Los rangos ocupados se RECORTAN al intervalo antes de descontarlos. Sin ese
    recorte, un rango situado fuera del intervalo arrastraba el cursor y
    devolvia un tramo libre mucho mayor que el real.
    """
    clipped = []
    for a, b in taken:
        a2, b2 = max(u0, min(a, u1)), max(u0, min(b, u1))
        if b2 - a2 > 1e-9:
            clipped.append((a2, b2))
    out: List[Tuple[float, float]] = []
    cur = u0
    for a, b in sorted(clipped):
        if a > cur:
            out.append((cur, a))
        cur = max(cur, b)
    if cur < u1:
        out.append((cur, u1))
    return out


def column_exclusions(axis: str) -> List[Tuple[float, float]]:
    """Rangos ocupados por columnas sobre el eje de un muro.

    Un muro no puede existir donde hay una columna, y una ventana tampoco
    puede abrirse sobre ella.
    """
    half = P.HYP_COLUMN_SIZE[0] / 2.0
    coords = P.GRID_X if axis == "x" else P.GRID_Y
    return [(round(c - half, 4), round(c + half, 4)) for c in coords]


def _shift_clear_of(center: float, width: float, lines: Sequence[float],
                    lo: float, hi: float, clearance: float = 0.09) -> float:
    """Desplaza un hueco para que no caiga sobre un encuentro de muros."""
    a, b = center - width / 2.0, center + width / 2.0
    for ln in lines:
        if a - clearance < ln < b + clearance:
            left = ln - clearance - width / 2.0
            right = ln + clearance + width / 2.0
            cand = [c for c in (left, right)
                    if lo + 0.05 + width / 2.0 <= c <= hi - 0.05 - width / 2.0]
            if not cand:
                continue
            center = min(cand, key=lambda c: abs(c - center))
            a, b = center - width / 2.0, center + width / 2.0
    return round(center, 4)


# ---------------------------------------------------------------------------
# Espacios
# ---------------------------------------------------------------------------


def build_spaces(model) -> None:
    g = stair_geometry()
    for level in P.LEVELS:
        lid = level["level_id"]
        e = level["elevation"]

        for code, name, use, band, start, end in P.SPACE_PROGRAM[lid]:
            x0, y0, x1, y1 = P.space_rect(band, start, end)
            area = round((x1 - x0) * (y1 - y0), 4)
            perim = round(2 * ((x1 - x0) + (y1 - y0)), 4)
            sid = "SOL-ARQ-ESP-%s" % code
            solid = S.Solid(
                sid, [S.box_prism(x0, y0, x1, y1, e, round(e + P.HYP_CEILING_HEIGHT, 3))],
                "equipo_generico", "architecture", lid, "ARQ-ESPACIOS",
            )
            op = model.oplog.record(
                "extrude", "creation",
                "Volumen del recinto %s (%s) en %s: %.2f x %.2f hasta cielo raso %.2f m."
                % (code, name, lid, x1 - x0, y1 - y0, P.HYP_CEILING_HEIGHT),
                component_id="ARQ-ESP-%s" % code, solid_id=sid,
                inputs={"band": band, "span": [start, end], "rect": [x0, y0, x1, y1],
                        "z0": e, "z1": round(e + P.HYP_CEILING_HEIGHT, 3)},
                outputs={"area_m2": area, "perimeter_m": perim,
                         "volume_m3": round(area * P.HYP_CEILING_HEIGHT, 4)},
                derived_from=["SPACE_PROGRAM", "BAND_SOUTH", "BAND_NORTH", "BAND_WEST", "BAND_EAST",
                              "HYP_CEILING_HEIGHT"],
                implementation="solids.Prism (extrusion en Z)",
            )
            model.add_solid(solid)
            model.add_space(Space(
                space_id="ARQ-ESP-%s" % code, code=code, name=name, use=use, level_id=lid,
                rect=[x0, y0, x1, y1], area_m2=area, perimeter_m=perim,
                clear_height=P.REQ_CLEAR_HEIGHT, geometry_reference=sid,
                provenance="derived",
                requires_calculation=["occupancy_load", "egress_check", "daylight_check",
                                      "ventilation_rate"],
            ))
            comp = Component(
                component_id="ARQ-ESP-%s" % code, discipline="architecture", type="space",
                name=name, level_id=lid, space_id="ARQ-ESP-%s" % code,
                ifc_class="IfcSpace", position=[x0, y0, e],
                dimensions={"length": round(x1 - x0, 3), "width": round(y1 - y0, 3),
                            "clear_height": P.REQ_CLEAR_HEIGHT},
                parameters={
                    "code": code, "use": use, "band": band,
                    "area_m2": area, "perimeter_m": perim,
                    "clear_height_m": P.REQ_CLEAR_HEIGHT,
                    "ceiling_height_m": P.HYP_CEILING_HEIGHT,
                    "occupancy_load": None,
                    "required_egress_width_m": None,
                    "ventilation_rate_m3_h": None,
                    "illuminance_target_lux": None,
                },
                requires_calculation=["occupancy_load", "required_egress_width_m",
                                      "ventilation_rate_m3_h", "illuminance_target_lux"],
                provenance="derived", tags=["espacio", use],
            )
            comp.operations.append(op)
            comp.geometry_reference = sid
            model.add_component(comp)

        # --- circulacion: anillo alrededor del nucleo ---
        ring_outer = S.rect_points(P.RING_X0, P.RING_Y0, P.RING_X1, P.RING_Y1)
        ring_hole = S.rect_points(P.CORE_X0, P.CORE_Y0, P.CORE_X1, P.CORE_Y1)
        ring_area = round(
            (P.RING_X1 - P.RING_X0) * (P.RING_Y1 - P.RING_Y0)
            - (P.CORE_X1 - P.CORE_X0) * (P.CORE_Y1 - P.CORE_Y0), 4)
        code = "%sCIRC" % lid
        sid = "SOL-ARQ-ESP-%s" % code
        solid = S.Solid(
            sid, [S.Prism(outer=ring_outer, holes=[ring_hole], z0=e,
                          z1=round(e + P.HYP_CEILING_HEIGHT, 3))],
            "equipo_generico", "architecture", lid, "ARQ-ESPACIOS",
        )
        op = model.oplog.record(
            "extrude_with_voids", "boolean",
            "Circulacion del %s: anillo de %.2f m de ancho obtenido restando el nucleo "
            "%.2fx%.2f del rectangulo %.2fx%.2f." % (
                lid, P.HYP_CORRIDOR_WIDTH, P.CORE_X1 - P.CORE_X0, P.CORE_Y1 - P.CORE_Y0,
                P.RING_X1 - P.RING_X0, P.RING_Y1 - P.RING_Y0),
            component_id="ARQ-ESP-%s" % code, solid_id=sid,
            inputs={"outer": [P.RING_X0, P.RING_Y0, P.RING_X1, P.RING_Y1],
                    "void": [P.CORE_X0, P.CORE_Y0, P.CORE_X1, P.CORE_Y1]},
            outputs={"area_m2": ring_area},
            derived_from=["HYP_CORRIDOR_WIDTH", "HYP_CORE_SIZE"],
            implementation="solids.Prism con anillo interior",
        )
        model.add_solid(solid)
        model.add_space(Space(
            space_id="ARQ-ESP-%s" % code, code=code, name="Circulacion %s" % lid,
            use="circulacion", level_id=lid,
            rect=[P.RING_X0, P.RING_Y0, P.RING_X1, P.RING_Y1],
            area_m2=ring_area,
            perimeter_m=round(2 * ((P.RING_X1 - P.RING_X0) + (P.RING_Y1 - P.RING_Y0))
                              + 2 * ((P.CORE_X1 - P.CORE_X0) + (P.CORE_Y1 - P.CORE_Y0)), 4),
            clear_height=P.REQ_CLEAR_HEIGHT, shape="ring",
            polygon=[[list(p) for p in ring_outer], [list(p) for p in ring_hole]],
            geometry_reference=sid, provenance="derived",
            requires_calculation=["occupancy_load", "egress_check"],
        ))
        comp = Component(
            component_id="ARQ-ESP-%s" % code, discipline="architecture", type="space",
            name="Circulacion %s" % lid, level_id=lid, space_id="ARQ-ESP-%s" % code,
            ifc_class="IfcSpace", position=[P.RING_X0, P.RING_Y0, e],
            dimensions={"corridor_width": P.HYP_CORRIDOR_WIDTH, "clear_height": P.REQ_CLEAR_HEIGHT},
            parameters={"code": code, "use": "circulacion", "shape": "anillo",
                        "area_m2": ring_area, "corridor_width_m": P.HYP_CORRIDOR_WIDTH,
                        "required_egress_width_m": None, "occupancy_load": None},
            requires_calculation=["required_egress_width_m", "occupancy_load"],
            provenance="derived", tags=["espacio", "circulacion"],
        )
        comp.operations.append(op)
        comp.geometry_reference = sid
        model.add_component(comp)

        # --- nucleo de escaleras ---
        code = "%sESC" % lid
        sid = "SOL-ARQ-ESP-%s" % code
        core_rect = [g["int_x0"], g["int_y0"], g["int_x1"], g["int_y1"]]
        area = round((core_rect[2] - core_rect[0]) * (core_rect[3] - core_rect[1]), 4)
        solid = S.Solid(
            sid, [S.box_prism(*core_rect[:2], *core_rect[2:], e, round(e + P.REQ_CLEAR_HEIGHT, 3))],
            "equipo_generico", "architecture", lid, "ARQ-ESPACIOS",
        )
        op = model.oplog.record(
            "extrude", "creation",
            "Nucleo de escaleras del %s: recinto interior %.2fx%.2f." % (
                lid, core_rect[2] - core_rect[0], core_rect[3] - core_rect[1]),
            component_id="ARQ-ESP-%s" % code, solid_id=sid,
            inputs={"rect": core_rect, "z0": e, "z1": round(e + P.REQ_CLEAR_HEIGHT, 3)},
            outputs={"area_m2": area},
            derived_from=["HYP_CORE_SIZE", "HYP_WALL_CORE"],
            implementation="solids.Prism (extrusion en Z)",
        )
        model.add_solid(solid)
        model.add_space(Space(
            space_id="ARQ-ESP-%s" % code, code=code, name="Nucleo de escaleras %s" % lid,
            use="escalera", level_id=lid, rect=core_rect, area_m2=area,
            perimeter_m=round(2 * ((core_rect[2] - core_rect[0]) + (core_rect[3] - core_rect[1])), 4),
            clear_height=P.REQ_CLEAR_HEIGHT, geometry_reference=sid, provenance="derived",
            requires_calculation=["egress_capacity", "fire_rating"],
        ))
        comp = Component(
            component_id="ARQ-ESP-%s" % code, discipline="architecture", type="space",
            name="Nucleo de escaleras %s" % lid, level_id=lid, space_id="ARQ-ESP-%s" % code,
            ifc_class="IfcSpace", position=[core_rect[0], core_rect[1], e],
            parameters={"code": code, "use": "escalera", "area_m2": area,
                        "egress_capacity": None, "fire_rating": None,
                        "pressurization_required": None},
            requires_calculation=["egress_capacity", "fire_rating", "pressurization_required"],
            provenance="derived", tags=["espacio", "escalera", "nucleo"],
        )
        comp.operations.append(op)
        comp.geometry_reference = sid
        model.add_component(comp)


# ---------------------------------------------------------------------------
# Planificacion de aperturas
# ---------------------------------------------------------------------------


def plan_openings(model, level: Dict[str, Any]) -> Tuple[Dict[str, List[Dict[str, float]]], List[Dict[str, Any]]]:
    """Calcula puertas y ventanas del nivel y las agrupa por muro."""
    lid = level["level_id"]
    e = level["elevation"]
    dz0, dz1 = e, round(e + P.HYP_DOOR_HEIGHT, 3)
    wz0 = round(e + P.HYP_WINDOW_SILL, 3)
    wz1 = round(e + P.HYP_WINDOW_SILL + P.HYP_WINDOW_HEIGHT, 3)

    by_wall: Dict[str, List[Dict[str, float]]] = {}
    records: List[Dict[str, Any]] = []

    def add(wall: str, u0: float, u1: float, z0: float, z1: float) -> None:
        by_wall.setdefault(wall, []).append({"u0": u0, "u1": u1, "z0": z0, "z1": z1})

    facade_doors: Dict[str, List[Tuple[float, float]]] = {"S": [], "N": [], "W": [], "E": []}

    # Acceso principal (solo N1) en la fachada sur, dentro de la recepcion.
    reception = P.find_space_any(lid, ("recepcion",)) if lid == "N1" else None
    exit_room = (P.SPACE_PROGRAM[lid][-1] if lid == "N1" and P.SPACE_PROGRAM.get(lid)
                 else None)
    north_exit = None
    if lid == "N1":
        for entry in reversed(P.SPACE_PROGRAM[lid]):
            if entry[3] == "NORTH":
                north_exit = entry
                break
    if lid == "N1" and reception is not None:
        cx = P.space_center(reception)[0]
        w = P.HYP_DOOR_WIDTH_DOUBLE
        a, b = round(cx - w / 2, 4), round(cx + w / 2, 4)
        add("EXT-S", a, b, dz0, dz1)
        facade_doors["S"].append((a, b))
        records.append({
            "kind": "door", "code": "P-%s-ACC" % lid, "wall": "EXT-S", "axis": "x",
            "line": P.HYP_WALL_EXTERIOR / 2.0, "u0": a, "u1": b, "z0": dz0, "z1": dz1,
            "width": w, "height": P.HYP_DOOR_HEIGHT, "leaves": 2,
            "space": P.space_id_of(reception),
            "type_label": "Puerta de acceso principal", "exterior": True,
            "thickness": P.HYP_WALL_EXTERIOR,
        })
        # Salida secundaria en la fachada norte, en el ultimo recinto de la banda.
        cx = P.space_center(north_exit)[0] if north_exit is not None else P.REQ_LENGTH_X * 0.85
        a, b = round(cx - w / 2, 4), round(cx + w / 2, 4)
        add("EXT-N", a, b, dz0, dz1)
        facade_doors["N"].append((a, b))
        records.append({
            "kind": "door", "code": "P-%s-SAL" % lid, "wall": "EXT-N", "axis": "x",
            "line": round(P.REQ_WIDTH_Y - P.HYP_WALL_EXTERIOR / 2.0, 4), "u0": a, "u1": b,
            "z0": dz0, "z1": dz1, "width": w, "height": P.HYP_DOOR_HEIGHT, "leaves": 2,
            "space": (P.space_id_of(north_exit) if north_exit is not None else None),
            "type_label": "Puerta de salida secundaria",
            "exterior": True, "thickness": P.HYP_WALL_EXTERIOR,
        })

    # Reserva en la fachada oeste para el medidor y el tablero general del N1:
    # no debe abrirse una ventana donde van esos equipos. La franja se deduce
    # del recinto que los aloja, no de una coordenada fija.
    if lid == "N1":
        tech = P.find_space_any("N1", ("cuarto_electrico", "zona_tecnica"))
        if tech is not None and tech[3] == "WEST":
            ty = P.space_center(tech)[1]
            facade_doors["W"].append((round(ty - 0.60, 3), round(ty + 0.60, 3)))

    # Lineas de encuentro de muros perpendiculares, para no poner una puerta
    # justo sobre un cruce.
    cross_lines = {"x": [P.RING_X0, P.RING_X1], "y": [P.RING_Y0, P.RING_Y1]}

    # Puertas de recinto hacia la circulacion + ventanas de fachada.
    for code, name, use, band, start, end in P.SPACE_PROGRAM[lid]:
        axis = BAND_AXIS[band]
        wdoor = DOOR_WIDTH_BY_USE.get(use, P.HYP_DOOR_WIDTH_OFFICE)
        center = _shift_clear_of((start + end) / 2.0, wdoor, cross_lines[axis], start, end)
        a, b = round(center - wdoor / 2, 4), round(center + wdoor / 2, 4)
        corridor_wall = "COR-%s" % BAND_FACADE[band]
        add(corridor_wall, a, b, dz0, dz1)
        cor_line = {"SOUTH": P.RING_Y0, "NORTH": P.RING_Y1,
                    "WEST": P.RING_X0, "EAST": P.RING_X1}[band]
        records.append({
            "kind": "door", "code": "P-%s" % code, "wall": corridor_wall, "axis": axis,
            "line": cor_line, "u0": a, "u1": b, "z0": dz0, "z1": dz1,
            "width": wdoor, "height": P.HYP_DOOR_HEIGHT,
            "leaves": 2 if wdoor >= P.HYP_DOOR_WIDTH_DOUBLE else 1,
            "space": "ARQ-ESP-%s" % code, "type_label": "Puerta de recinto",
            "exterior": False, "thickness": P.HYP_WALL_INTERIOR,
        })

        # ventanas en la fachada correspondiente
        if use in NO_WINDOW_USES:
            continue
        fac = BAND_FACADE[band]
        wall = "EXT-%s" % fac
        line = {"S": P.HYP_WALL_EXTERIOR / 2.0,
                "N": round(P.REQ_WIDTH_Y - P.HYP_WALL_EXTERIOR / 2.0, 4),
                "W": P.HYP_WALL_EXTERIOR / 2.0,
                "E": round(P.REQ_LENGTH_X - P.HYP_WALL_EXTERIOR / 2.0, 4)}[fac]
        blocked = list(facade_doors[fac]) + column_exclusions(axis)
        for sa, sb in _free_subspans(start, end, blocked):
            for (wa, wb) in window_slots(sa, sb):
                add(wall, wa, wb, wz0, wz1)
                records.append({
                    "kind": "window", "code": "V-%s-%d" % (code, len(records)), "wall": wall,
                    "axis": axis, "line": line, "u0": wa, "u1": wb, "z0": wz0, "z1": wz1,
                    "width": round(wb - wa, 4), "height": P.HYP_WINDOW_HEIGHT,
                    "sill": P.HYP_WINDOW_SILL, "space": "ARQ-ESP-%s" % code,
                    "type_label": "Ventana de fachada", "exterior": True,
                    "thickness": P.HYP_WALL_EXTERIOR,
                })

    # Puerta del nucleo de escaleras hacia la circulacion (muro oeste del nucleo).
    g = stair_geometry()
    w = P.HYP_DOOR_WIDTH_DOUBLE
    cy = (P.CORE_Y0 + P.CORE_Y1) / 2.0
    a, b = round(cy - w / 2, 4), round(cy + w / 2, 4)
    add("CORE-W", a, b, dz0, dz1)
    records.append({
        "kind": "door", "code": "P-%sESC" % lid, "wall": "CORE-W", "axis": "y",
        "line": round(P.CORE_X0 + P.HYP_WALL_CORE / 2.0, 4), "u0": a, "u1": b,
        "z0": dz0, "z1": dz1, "width": w, "height": P.HYP_DOOR_HEIGHT, "leaves": 2,
        "space": "ARQ-ESP-%sESC" % lid, "type_label": "Puerta de escalera",
        "exterior": False, "thickness": P.HYP_WALL_CORE,
    })

    return by_wall, records


# ---------------------------------------------------------------------------
# Muros
# ---------------------------------------------------------------------------


def _wall_definitions(level: Dict[str, Any]) -> List[Dict[str, Any]]:
    e = level["elevation"]
    z1 = round(e + P.REQ_CLEAR_HEIGHT, 3)
    ew, iw, cw = P.HYP_WALL_EXTERIOR, P.HYP_WALL_INTERIOR, P.HYP_WALL_CORE
    g = stair_geometry()

    defs: List[Dict[str, Any]] = [
        {"key": "EXT-S", "axis": "x", "line": ew / 2.0, "u0": 0.0, "u1": P.REQ_LENGTH_X,
         "thickness": ew, "kind": "exterior", "name": "Muro de fachada sur"},
        {"key": "EXT-N", "axis": "x", "line": round(P.REQ_WIDTH_Y - ew / 2.0, 4),
         "u0": 0.0, "u1": P.REQ_LENGTH_X, "thickness": ew, "kind": "exterior",
         "name": "Muro de fachada norte"},
        {"key": "EXT-W", "axis": "y", "line": ew / 2.0, "u0": P.INNER_Y0, "u1": P.INNER_Y1,
         "thickness": ew, "kind": "exterior", "name": "Muro de fachada oeste"},
        {"key": "EXT-E", "axis": "y", "line": round(P.REQ_LENGTH_X - ew / 2.0, 4),
         "u0": P.INNER_Y0, "u1": P.INNER_Y1, "thickness": ew, "kind": "exterior",
         "name": "Muro de fachada este"},

        {"key": "COR-S", "axis": "x", "line": P.RING_Y0, "u0": P.INNER_X0, "u1": P.INNER_X1,
         "thickness": iw, "kind": "partition", "name": "Muro de circulacion sur"},
        {"key": "COR-N", "axis": "x", "line": P.RING_Y1, "u0": P.INNER_X0, "u1": P.INNER_X1,
         "thickness": iw, "kind": "partition", "name": "Muro de circulacion norte"},
        {"key": "COR-W", "axis": "y", "line": P.RING_X0, "u0": P.RING_Y0, "u1": P.RING_Y1,
         "thickness": iw, "kind": "partition", "name": "Muro de circulacion oeste"},
        {"key": "COR-E", "axis": "y", "line": P.RING_X1, "u0": P.RING_Y0, "u1": P.RING_Y1,
         "thickness": iw, "kind": "partition", "name": "Muro de circulacion este"},

        {"key": "CORE-S", "axis": "x", "line": round(P.CORE_Y0 + cw / 2.0, 4),
         "u0": P.CORE_X0, "u1": P.CORE_X1, "thickness": cw, "kind": "core",
         "name": "Muro del nucleo sur"},
        {"key": "CORE-N", "axis": "x", "line": round(P.CORE_Y1 - cw / 2.0, 4),
         "u0": P.CORE_X0, "u1": P.CORE_X1, "thickness": cw, "kind": "core",
         "name": "Muro del nucleo norte"},
        {"key": "CORE-W", "axis": "y", "line": round(P.CORE_X0 + cw / 2.0, 4),
         "u0": g["int_y0"], "u1": g["int_y1"], "thickness": cw, "kind": "core",
         "name": "Muro del nucleo oeste"},
        {"key": "CORE-E", "axis": "y", "line": round(P.CORE_X1 - cw / 2.0, 4),
         "u0": g["int_y0"], "u1": g["int_y1"], "thickness": cw, "kind": "core",
         "name": "Muro del nucleo este"},
    ]

    # Particiones entre recintos de una misma banda.
    lid = level["level_id"]
    for band in ("SOUTH", "NORTH", "WEST", "EAST"):
        rooms = [r for r in P.SPACE_PROGRAM[lid] if r[3] == band]
        rooms.sort(key=lambda r: r[4])
        bx0, by0, bx1, by1 = P.band_rect(band)
        for idx in range(len(rooms) - 1):
            boundary = rooms[idx][5]
            if band in ("SOUTH", "NORTH"):
                defs.append({
                    "key": "PART-%s-%s-%d" % (lid, band, idx), "axis": "y", "line": boundary,
                    "u0": by0, "u1": by1, "thickness": iw, "kind": "partition",
                    "name": "Particion %s %s entre %s y %s" % (band, lid, rooms[idx][0], rooms[idx + 1][0]),
                })
            else:
                defs.append({
                    "key": "PART-%s-%s-%d" % (lid, band, idx), "axis": "x", "line": boundary,
                    "u0": bx0, "u1": bx1, "thickness": iw, "kind": "partition",
                    "name": "Particion %s %s entre %s y %s" % (band, lid, rooms[idx][0], rooms[idx + 1][0]),
                })

    for d in defs:
        d["z0"] = e
        d["z1"] = z1
    return defs


MATERIAL_BY_WALL_KIND = {
    "exterior": "muro_mamposteria",
    "partition": "muro_mamposteria",
    "core": "concreto_estructural",
}
IFC_BY_WALL_KIND = {
    "exterior": "IfcWall",
    "partition": "IfcWall",
    "core": "IfcWall",
}


def _column_interruptions(axis: str, line: float, thickness: float,
                          z0: float, z1: float) -> List[Dict[str, float]]:
    """Tramos del muro ocupados por una columna.

    El muro se interrumpe en esos tramos: la columna de concreto ocupa el
    espesor completo. Asi no se contabiliza dos veces el mismo volumen ni
    aparece una falsa interferencia entre muro y columna.
    """
    half_col = P.HYP_COLUMN_SIZE[0] / 2.0
    half_wall = thickness / 2.0
    along = P.GRID_X if axis == "x" else P.GRID_Y
    across = P.GRID_Y if axis == "x" else P.GRID_X
    out: List[Dict[str, float]] = []
    for c_across in across:
        if abs(line - c_across) >= half_col + half_wall:
            continue
        for c_along in along:
            out.append({"u0": round(c_along - half_col, 4),
                        "u1": round(c_along + half_col, 4),
                        "z0": z0, "z1": z1})
    return out


def build_walls(model, level: Dict[str, Any], by_wall: Dict[str, List[Dict[str, float]]]) -> None:
    lid = level["level_id"]
    for d in _wall_definitions(level):
        openings = list(by_wall.get(d["key"], []))
        interruptions = _column_interruptions(d["axis"], d["line"], d["thickness"],
                                              d["z0"], d["z1"])
        prisms = decompose_wall(d["axis"], d["line"], d["u0"], d["u1"], d["z0"], d["z1"],
                                d["thickness"], openings + interruptions)
        if not prisms:
            continue
        cid = "ARQ-MUR-%s-%s" % (lid, d["key"])
        sid = "SOL-%s" % cid
        solid = S.Solid(sid, list(prisms), MATERIAL_BY_WALL_KIND[d["kind"]], "architecture",
                        lid, "ARQ-MUROS")
        gross = (d["u1"] - d["u0"]) * (d["z1"] - d["z0"])
        open_area = sum((o["u1"] - o["u0"]) * (o["z1"] - o["z0"]) for o in openings)
        op = model.oplog.record(
            "boolean_difference", "boolean",
            ("Muro %s del %s: longitud %.2f m, altura %.2f m, espesor %.2f m, con %d aperturas "
             "descontadas (%.2f m2 de %.2f m2 brutos).")
            % (d["key"], lid, d["u1"] - d["u0"], d["z1"] - d["z0"], d["thickness"],
               len(openings), open_area, gross),
            component_id=cid, solid_id=sid,
            inputs={"axis": d["axis"], "line": d["line"], "u0": d["u0"], "u1": d["u1"],
                    "z0": d["z0"], "z1": d["z1"], "thickness": d["thickness"],
                    "openings": openings},
            outputs={"pieces": len(prisms), "gross_face_area_m2": round(gross, 4),
                     "opening_area_m2": round(open_area, 4),
                     "net_face_area_m2": round(gross - open_area, 4)},
            derived_from=["HYP_WALL_EXTERIOR", "HYP_WALL_INTERIOR", "HYP_WALL_CORE",
                          "REQ_CLEAR_HEIGHT", "SPACE_PROGRAM"],
            implementation=("descomposicion analitica del muro en prismas (jambas, antepecho y "
                            "dintel); equivale a una diferencia booleana y es exacta en seccion"),
        )
        comp = Component(
            component_id=cid, discipline="architecture",
            type="exterior_wall" if d["kind"] == "exterior" else (
                "core_wall" if d["kind"] == "core" else "partition_wall"),
            name="%s (%s)" % (d["name"], lid), level_id=lid,
            material=MATERIAL_BY_WALL_KIND[d["kind"]], ifc_class=IFC_BY_WALL_KIND[d["kind"]],
            position=[d["u0"] if d["axis"] == "x" else d["line"],
                      d["line"] if d["axis"] == "x" else d["u0"], d["z0"]],
            dimensions={"length": round(d["u1"] - d["u0"], 3), "height": round(d["z1"] - d["z0"], 3),
                        "thickness": d["thickness"]},
            parameters={
                "wall_key": d["key"], "axis": d["axis"], "centerline": d["line"],
                "length_m": round(d["u1"] - d["u0"], 3),
                "height_m": round(d["z1"] - d["z0"], 3),
                "thickness_m": d["thickness"],
                "opening_count": len(openings),
                "net_face_area_m2": round(gross - open_area, 4),
                "piece_count": len(prisms),
                "fire_rating": None,
                "acoustic_rating": None,
                "load_bearing": None,
            },
            requires_calculation=["fire_rating", "acoustic_rating", "load_bearing"],
            provenance="hypothesis", tags=["muro", d["kind"]],
        )
        comp.operations.append(op)
        comp.geometry_reference = sid
        model.add_solid(solid)
        model.add_component(comp)


# ---------------------------------------------------------------------------
# Carpinteria
# ---------------------------------------------------------------------------


def build_openings(model, level: Dict[str, Any], records: List[Dict[str, Any]]) -> None:
    lid = level["level_id"]
    for rec in records:
        axis, line = rec["axis"], rec["line"]
        th = rec["thickness"]
        if rec["kind"] == "door":
            leaf_t = P.HYP_DOOR_LEAF_THICKNESS
            if axis == "x":
                prim = S.box_prism(rec["u0"], line - leaf_t / 2, rec["u1"], line + leaf_t / 2,
                                   rec["z0"], rec["z1"])
            else:
                prim = S.box_prism(line - leaf_t / 2, rec["u0"], line + leaf_t / 2, rec["u1"],
                                   rec["z0"], rec["z1"])
            cid = "ARQ-PUE-%s" % rec["code"].replace("P-", "")
            sid = "SOL-%s" % cid
            solid = S.Solid(sid, [prim], "madera_puerta", "architecture", lid, "ARQ-PUERTAS")
            op = model.oplog.record(
                "extrude", "creation",
                "Hoja de puerta %s: %.2f x %.2f m, %d hoja(s), en muro %s."
                % (rec["code"], rec["width"], rec["height"], rec["leaves"], rec["wall"]),
                component_id=cid, solid_id=sid,
                inputs={"wall": rec["wall"], "u0": rec["u0"], "u1": rec["u1"],
                        "z0": rec["z0"], "z1": rec["z1"], "leaf_thickness": leaf_t},
                outputs={"width_m": rec["width"], "height_m": rec["height"]},
                derived_from=["HYP_DOOR_HEIGHT", "HYP_DOOR_WIDTH_OFFICE", "HYP_DOOR_WIDTH_BATH",
                              "HYP_DOOR_WIDTH_DOUBLE", "HYP_DOOR_LEAF_THICKNESS"],
                implementation="solids.Prism (extrusion en Z) dentro de la apertura del muro",
            )
            comp = Component(
                component_id=cid, discipline="architecture", type="door",
                name="%s %s" % (rec["type_label"], rec["code"]), level_id=lid,
                space_id=rec.get("space"), material="madera_puerta", ifc_class="IfcDoor",
                position=[rec["u0"] if axis == "x" else line, line if axis == "x" else rec["u0"],
                          rec["z0"]],
                dimensions={"width": rec["width"], "height": rec["height"], "wall_thickness": th},
                parameters={
                    "schedule_code": rec["code"], "width_m": rec["width"],
                    "height_m": rec["height"], "leaf_count": rec["leaves"],
                    "wall": rec["wall"], "exterior": rec["exterior"],
                    "wall_thickness_m": th,
                    "fire_rating": None, "hardware_set": None,
                    "egress_capacity": None, "accessibility_check": None,
                },
                requires_calculation=["fire_rating", "hardware_set", "egress_capacity",
                                      "accessibility_check"],
                provenance="hypothesis", tags=["carpinteria", "puerta"],
            )
            comp.operations.append(op)
            comp.geometry_reference = sid
            model.add_solid(solid)
            model.add_component(comp)
            if rec.get("space") and rec["space"] in model.components:
                model.relate(cid, "serves_space", rec["space"])
            model.relate(cid, "hosted_in", "ARQ-MUR-%s-%s" % (lid, rec["wall"]))

        else:
            glass_t = 0.008
            frame = P.HYP_FRAME_DEPTH
            prims: List[S.Primitive] = []
            if axis == "x":
                prims.append(S.box_prism(rec["u0"] + frame, line - glass_t / 2,
                                         rec["u1"] - frame, line + glass_t / 2,
                                         rec["z0"] + frame, rec["z1"] - frame))
            else:
                prims.append(S.box_prism(line - glass_t / 2, rec["u0"] + frame,
                                         line + glass_t / 2, rec["u1"] - frame,
                                         rec["z0"] + frame, rec["z1"] - frame))
            cid = "ARQ-VEN-%s" % rec["code"].replace("V-", "")
            sid = "SOL-%s" % cid
            solid = S.Solid(sid, prims, "vidrio", "architecture", lid, "ARQ-VENTANAS")
            op = model.oplog.record(
                "extrude", "creation",
                "Ventana %s: %.2f x %.2f m, antepecho %.2f m, en muro %s."
                % (rec["code"], rec["width"], rec["height"], rec["sill"], rec["wall"]),
                component_id=cid, solid_id=sid,
                inputs={"wall": rec["wall"], "u0": rec["u0"], "u1": rec["u1"],
                        "z0": rec["z0"], "z1": rec["z1"], "frame_depth": frame,
                        "glass_thickness": glass_t},
                outputs={"width_m": rec["width"], "height_m": rec["height"],
                         "glass_area_m2": round((rec["width"] - 2 * frame) * (rec["height"] - 2 * frame), 4)},
                derived_from=["HYP_WINDOW_MODULE", "HYP_WINDOW_SILL", "HYP_WINDOW_HEIGHT",
                              "HYP_FRAME_DEPTH"],
                implementation="solids.Prism (pano de vidrio dentro del marco)",
            )
            comp = Component(
                component_id=cid, discipline="architecture", type="window",
                name="%s %s" % (rec["type_label"], rec["code"]), level_id=lid,
                space_id=rec.get("space"), material="vidrio", ifc_class="IfcWindow",
                position=[rec["u0"] if axis == "x" else line, line if axis == "x" else rec["u0"],
                          rec["z0"]],
                dimensions={"width": rec["width"], "height": rec["height"], "sill": rec["sill"]},
                parameters={
                    "schedule_code": rec["code"], "width_m": rec["width"],
                    "height_m": rec["height"], "sill_height_m": rec["sill"],
                    "wall": rec["wall"], "frame_material": "aluminio",
                    "glass_area_m2": round((rec["width"] - 2 * frame) * (rec["height"] - 2 * frame), 4),
                    "glazing_specification": None, "u_value": None,
                    "solar_factor": None, "daylight_contribution": None,
                },
                requires_calculation=["glazing_specification", "u_value", "solar_factor",
                                      "daylight_contribution"],
                provenance="hypothesis", tags=["carpinteria", "ventana"],
            )
            comp.operations.append(op)
            comp.geometry_reference = sid
            model.add_solid(solid)
            model.add_component(comp)
            if rec.get("space") and rec["space"] in model.components:
                model.relate(cid, "serves_space", rec["space"])
            model.relate(cid, "hosted_in", "ARQ-MUR-%s-%s" % (lid, rec["wall"]))


# ---------------------------------------------------------------------------
# Cubierta: parapeto y caseton de escalera
# ---------------------------------------------------------------------------


def build_parapet(model) -> None:
    z0 = P.ROOF_LEVEL["elevation"]
    z1 = round(z0 + P.HYP_PARAPET_HEIGHT, 3)
    t = P.HYP_PARAPET_THICKNESS
    L, W = P.REQ_LENGTH_X, P.REQ_WIDTH_Y
    outer = S.rect_points(0, 0, L, W)
    inner = S.rect_points(t, t, L - t, W - t)
    sid = "SOL-ARQ-PAR-NC"
    solid = S.Solid(sid, [S.Prism(outer=outer, holes=[inner], z0=z0, z1=z1)],
                    "muro_mamposteria", "architecture", "NC", "ARQ-CUBIERTA")
    op = model.oplog.record(
        "extrude_with_voids", "boolean",
        "Parapeto de cubierta: anillo de %.2f m de espesor y %.2f m de altura sobre la losa."
        % (t, P.HYP_PARAPET_HEIGHT),
        component_id="ARQ-PAR-NC", solid_id=sid,
        inputs={"outer": [0, 0, L, W], "inner": [t, t, L - t, W - t], "z0": z0, "z1": z1},
        outputs={"length_m": round(2 * (L + W), 3),
                 "volume_m3": round((L * W - (L - 2 * t) * (W - 2 * t)) * P.HYP_PARAPET_HEIGHT, 4)},
        derived_from=["HYP_PARAPET_HEIGHT", "HYP_PARAPET_THICKNESS", "REQ_LENGTH_X", "REQ_WIDTH_Y"],
        implementation="solids.Prism con anillo interior",
    )
    comp = Component(
        component_id="ARQ-PAR-NC", discipline="architecture", type="parapet",
        name="Parapeto de cubierta", level_id="NC", material="muro_mamposteria",
        ifc_class="IfcWall", position=[0, 0, z0],
        dimensions={"height": P.HYP_PARAPET_HEIGHT, "thickness": t,
                    "perimeter": round(2 * (L + W), 3)},
        parameters={"height_m": P.HYP_PARAPET_HEIGHT, "thickness_m": t,
                    "perimeter_m": round(2 * (L + W), 3),
                    "guardrail_required": None, "code_compliance_check": None},
        requires_calculation=["guardrail_required", "code_compliance_check"],
        provenance="hypothesis", tags=["cubierta", "parapeto"],
    )
    comp.operations.append(op)
    comp.geometry_reference = sid
    model.add_solid(solid)
    model.add_component(comp)


def build_penthouse(model) -> None:
    """Caseton de acceso a cubierta sobre el nucleo de escaleras."""
    z0 = P.ROOF_LEVEL["elevation"]
    h = 2.60
    z1 = round(z0 + h, 3)
    cw = P.HYP_WALL_CORE
    x0, y0, x1, y1 = P.CORE_X0, P.CORE_Y0, P.CORE_X1, P.CORE_Y1

    outer = S.rect_points(x0, y0, x1, y1)
    inner = S.rect_points(x0 + cw, y0 + cw, x1 - cw, y1 - cw)
    sid = "SOL-ARQ-CAS-NC-MUROS"
    # apertura de puerta en el muro oeste del caseton
    walls = decompose_wall("y", round(x0 + cw / 2, 4), y0, y1, z0, z1, cw,
                           [{"u0": 8.10, "u1": 9.90, "z0": z0, "z1": round(z0 + P.HYP_DOOR_HEIGHT, 3)}])
    walls += decompose_wall("y", round(x1 - cw / 2, 4), y0, y1, z0, z1, cw, [])
    walls += decompose_wall("x", round(y0 + cw / 2, 4), x0 + cw, x1 - cw, z0, z1, cw, [])
    walls += decompose_wall("x", round(y1 - cw / 2, 4), x0 + cw, x1 - cw, z0, z1, cw, [])
    solid = S.Solid(sid, walls, "muro_mamposteria", "architecture", "NC", "ARQ-CUBIERTA")
    op = model.oplog.record(
        "boolean_difference", "boolean",
        "Muros del caseton de escalera en cubierta, %.2f m de altura, con puerta de acceso." % h,
        component_id="ARQ-CAS-NC-MUROS", solid_id=sid,
        inputs={"core_rect": [x0, y0, x1, y1], "thickness": cw, "z0": z0, "z1": z1,
                "door": [8.10, 9.90]},
        outputs={"pieces": len(walls)},
        derived_from=["HYP_CORE_SIZE", "HYP_WALL_CORE", "HYP_DOOR_HEIGHT"],
        implementation="descomposicion analitica en prismas por muro",
    )
    comp = Component(
        component_id="ARQ-CAS-NC-MUROS", discipline="architecture", type="penthouse_wall",
        name="Muros del caseton de escalera", level_id="NC", material="muro_mamposteria",
        ifc_class="IfcWall", position=[x0, y0, z0],
        dimensions={"height": h, "thickness": cw},
        parameters={"height_m": h, "thickness_m": cw, "access_door": "P-NC-CAS",
                    "fire_rating": None},
        requires_calculation=["fire_rating"], provenance="hypothesis",
        tags=["cubierta", "caseton"],
    )
    comp.operations.append(op)
    comp.geometry_reference = sid
    model.add_solid(solid)
    model.add_component(comp)

    # losa del caseton
    sid = "SOL-ARQ-CAS-NC-LOSA"
    solid = S.Solid(sid, [S.box_prism(x0, y0, x1, y1, z1, round(z1 + P.HYP_SLAB_THICKNESS, 3))],
                    "concreto_estructural", "architecture", "NC", "ARQ-CUBIERTA")
    op = model.oplog.record(
        "extrude", "creation",
        "Losa de cubierta del caseton a cota %.2f m." % z1,
        component_id="ARQ-CAS-NC-LOSA", solid_id=sid,
        inputs={"rect": [x0, y0, x1, y1], "z0": z1, "z1": round(z1 + P.HYP_SLAB_THICKNESS, 3)},
        outputs={"area_m2": round((x1 - x0) * (y1 - y0), 3)},
        derived_from=["HYP_CORE_SIZE", "HYP_SLAB_THICKNESS"],
        implementation="solids.Prism (extrusion en Z)",
    )
    comp = Component(
        component_id="ARQ-CAS-NC-LOSA", discipline="architecture", type="penthouse_slab",
        name="Losa del caseton de escalera", level_id="NC", material="concreto_estructural",
        ifc_class="IfcSlab", position=[x0, y0, z1],
        dimensions={"length": round(x1 - x0, 3), "width": round(y1 - y0, 3),
                    "thickness": P.HYP_SLAB_THICKNESS},
        parameters={"elevation_m": z1, "thickness_m": P.HYP_SLAB_THICKNESS,
                    "specified_concrete_strength_fc": None, "reinforcement_layout": None},
        requires_calculation=["specified_concrete_strength_fc", "reinforcement_layout"],
        provenance="hypothesis", tags=["cubierta", "caseton"],
    )
    comp.operations.append(op)
    comp.geometry_reference = sid
    model.add_solid(solid)
    model.add_component(comp)

    # puerta del caseton
    sid = "SOL-ARQ-PUE-NC-CAS"
    solid = S.Solid(sid, [S.box_prism(round(x0 + cw / 2 - 0.0225, 4), 8.10,
                                      round(x0 + cw / 2 + 0.0225, 4), 9.90,
                                      z0, round(z0 + P.HYP_DOOR_HEIGHT, 3))],
                    "madera_puerta", "architecture", "NC", "ARQ-PUERTAS")
    model.add_solid(solid)
    op = model.oplog.record(
        "extrude", "creation",
        "Hoja de puerta de acceso a cubierta: 1.80 x %.2f m en el muro oeste del caseton."
        % P.HYP_DOOR_HEIGHT,
        component_id="ARQ-PUE-NC-CAS", solid_id=sid,
        inputs={"wall": "ARQ-CAS-NC-MUROS", "u0": 8.10, "u1": 9.90, "z0": z0,
                "z1": round(z0 + P.HYP_DOOR_HEIGHT, 3),
                "leaf_thickness": P.HYP_DOOR_LEAF_THICKNESS},
        outputs={"width_m": 1.80, "height_m": P.HYP_DOOR_HEIGHT},
        derived_from=["HYP_DOOR_HEIGHT", "HYP_DOOR_WIDTH_DOUBLE", "HYP_DOOR_LEAF_THICKNESS"],
        implementation="solids.Prism (extrusion en Z) dentro de la apertura del caseton",
    )
    comp = Component(
        component_id="ARQ-PUE-NC-CAS", discipline="architecture", type="door",
        name="Puerta de acceso a cubierta", level_id="NC", material="madera_puerta",
        ifc_class="IfcDoor", position=[round(x0 + cw / 2, 4), 8.10, z0],
        dimensions={"width": 1.80, "height": P.HYP_DOOR_HEIGHT},
        parameters={"schedule_code": "P-NC-CAS", "width_m": 1.80,
                    "height_m": P.HYP_DOOR_HEIGHT, "leaf_count": 2, "exterior": True,
                    "fire_rating": None, "hardware_set": None},
        requires_calculation=["fire_rating", "hardware_set"],
        provenance="hypothesis", tags=["carpinteria", "puerta", "cubierta"],
    )
    comp.operations.append(op)
    comp.geometry_reference = sid
    model.add_component(comp)
    model.relate("ARQ-PUE-NC-CAS", "hosted_in", "ARQ-CAS-NC-MUROS")


# ---------------------------------------------------------------------------
# Orquestador
# ---------------------------------------------------------------------------


def build(model) -> None:
    build_spaces(model)
    for level in P.LEVELS:
        by_wall, records = plan_openings(model, level)
        build_walls(model, level, by_wall)
        build_openings(model, level, records)
    build_parapet(model)
    build_penthouse(model)
