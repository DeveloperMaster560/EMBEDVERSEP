"""Trazado de recorridos de instalaciones en 3D.

Todos los recorridos son polilineas ortogonales (Manhattan) en el vacio
tecnico bajo losa. El vacio tecnico se sitia a cota `HYP_PLENUM_ROUTING_Z`
sobre el piso del nivel, por debajo del fondo de viga, de modo que el trazado
horizontal no interfiere con las vigas:

    cota de trazado          E + 2.95
    fondo de viga            E + 3.20
    fondo de losa            E + 3.48

Los recorridos SI atraviesan particiones interiores. Esas intersecciones son
pases de muro que requieren manguito y coordinacion en obra; el informe de
consistencia las enumera en lugar de ocultarlas.
"""

from __future__ import annotations

import math
from typing import Dict, List, Sequence, Tuple

import params as P

Point3 = Tuple[float, float, float]

TOL = 1e-6


def plenum_z(level: Dict, discipline: str = None) -> float:
    """Cota de trazado horizontal del nivel para una disciplina.

    Cada disciplina recorre el vacio tecnico a su propia cota (HYP_ROUTING_Z)
    para no invadir el trazado de las demas.
    """
    offset = P.HYP_ROUTING_Z.get(discipline, P.HYP_PLENUM_ROUTING_Z)
    return round(level["elevation"] + offset, 4)


# Huellas de columna, infladas, que los recorridos deben rodear.
def column_obstacles(clearance: float = 0.06) -> List[Tuple[float, float, float, float]]:
    hw = P.HYP_COLUMN_SIZE[0] / 2.0 + clearance
    hd = P.HYP_COLUMN_SIZE[1] / 2.0 + clearance
    return [(gx - hw, gy - hd, gx + hw, gy + hd)
            for gx in P.GRID_X for gy in P.GRID_Y]


def _crosses(a: Point3, b: Point3, rect: Tuple[float, float, float, float]) -> bool:
    rx0, ry0, rx1, ry1 = rect
    if abs(a[1] - b[1]) < TOL and abs(a[0] - b[0]) > TOL:          # tramo en X
        if not (ry0 < a[1] < ry1):
            return False
        lo, hi = sorted((a[0], b[0]))
        return lo < rx1 and hi > rx0
    if abs(a[0] - b[0]) < TOL and abs(a[1] - b[1]) > TOL:          # tramo en Y
        if not (rx0 < a[0] < rx1):
            return False
        lo, hi = sorted((a[1], b[1]))
        return lo < ry1 and hi > ry0
    return False


def avoid_obstacles(points: Sequence[Point3],
                    rects: Sequence[Tuple[float, float, float, float]],
                    margin: float = 0.10) -> List[Point3]:
    """Inserta rodeos ortogonales en los tramos horizontales que cruzan un obstaculo.

    Un conducto no puede atravesar una columna. Cuando un tramo recto la cruza,
    se sustituye por un quiebre que la bordea por el lado mas corto, a la misma
    cota. Si el extremo del tramo cae dentro del obstaculo no se puede rodear y
    el tramo se deja intacto: esa interferencia se reportara en el informe de
    colisiones en lugar de ocultarse.
    """
    if len(points) < 2:
        return list(points)
    out: List[Point3] = [tuple(points[0])]
    for a, b in zip(points, points[1:]):
        a = tuple(a)
        b = tuple(b)
        seg = [a, b]
        changed = True
        guard = 0
        while changed and guard < 8:
            changed = False
            guard += 1
            new_seg = [seg[0]]
            for p, q in zip(seg, seg[1:]):
                hit = next((r for r in rects if _crosses(p, q, r)), None)
                if hit is None:
                    new_seg.append(q)
                    continue
                rx0, ry0, rx1, ry1 = hit
                z = p[2]
                if abs(p[1] - q[1]) < TOL:                       # tramo en X
                    if ry0 < p[1] < ry1 and (rx0 < p[0] < rx1 or rx0 < q[0] < rx1):
                        new_seg.append(q)
                        continue
                    side = ry0 - margin if (p[1] - ry0) < (ry1 - p[1]) else ry1 + margin
                    s = -1 if q[0] < p[0] else 1
                    x_in = rx0 - margin if s > 0 else rx1 + margin
                    x_out = rx1 + margin if s > 0 else rx0 - margin
                    new_seg += [(x_in, p[1], z), (x_in, side, z),
                                (x_out, side, z), (x_out, p[1], z), q]
                else:                                            # tramo en Y
                    if rx0 < p[0] < rx1 and (ry0 < p[1] < ry1 or ry0 < q[1] < ry1):
                        new_seg.append(q)
                        continue
                    side = rx0 - margin if (p[0] - rx0) < (rx1 - p[0]) else rx1 + margin
                    s = -1 if q[1] < p[1] else 1
                    y_in = ry0 - margin if s > 0 else ry1 + margin
                    y_out = ry1 + margin if s > 0 else ry0 - margin
                    new_seg += [(p[0], y_in, z), (side, y_in, z),
                                (side, y_out, z), (p[0], y_out, z), q]
                changed = True
            seg = new_seg
        out.extend(seg[1:])
    return _dedupe(out)


def ceiling_z(level: Dict) -> float:
    return round(level["elevation"] + P.HYP_CEILING_HEIGHT, 4)


def _dedupe(points: Sequence[Point3]) -> List[Point3]:
    out: List[Point3] = []
    for p in points:
        if not out or math.dist(p, out[-1]) > TOL:
            out.append(tuple(round(v, 4) for v in p))
    return out


def manhattan(start: Point3, end: Point3, via_z: float, order: str = "xy",
              avoid: bool = False) -> List[Point3]:
    """Recorrido ortogonal: vertical hasta `via_z`, horizontal, vertical al destino."""
    sx, sy, sz = start
    ex, ey, ez = end
    pts: List[Point3] = [(sx, sy, sz), (sx, sy, via_z)]
    if order == "xy":
        pts.append((ex, sy, via_z))
        pts.append((ex, ey, via_z))
    else:
        pts.append((sx, ey, via_z))
        pts.append((ex, ey, via_z))
    pts.append((ex, ey, ez))
    pts = _dedupe(pts)
    if avoid:
        pts = avoid_obstacles(pts, column_obstacles())
    return pts


def trunk_and_drops(
    origin: Point3, devices: Sequence[Point3], via_z: float, order: str = "xy",
    avoid: bool = True,
) -> List[List[Point3]]:
    """Troncal desde el origen que visita cada dispositivo, con bajada a cada uno.

    Devuelve una lista de polilineas. La primera es el troncal en el vacio
    tecnico; las siguientes son las derivaciones a cada dispositivo. Si
    `avoid` esta activo, el troncal rodea las columnas.
    """
    if not devices:
        return []
    ox, oy, oz = origin
    trunk: List[Point3] = [(ox, oy, oz), (ox, oy, via_z)]
    drops: List[List[Point3]] = []
    cur = (ox, oy, via_z)
    for dx, dy, dz in devices:
        if order == "xy":
            mid = (dx, cur[1], via_z)
        else:
            mid = (cur[0], dy, via_z)
        trunk.append(mid)
        trunk.append((dx, dy, via_z))
        cur = (dx, dy, via_z)
        if abs(dz - via_z) > TOL:
            drops.append(_dedupe([(dx, dy, via_z), (dx, dy, dz)]))
    trunk = _dedupe(trunk)
    if avoid:
        trunk = avoid_obstacles(trunk, column_obstacles())
    return [trunk] + drops


def riser(x: float, y: float, z0: float, z1: float) -> List[Point3]:
    return [(round(x, 4), round(y, 4), round(z0, 4)), (round(x, 4), round(y, 4), round(z1, 4))]


def total_length(polylines: Sequence[Sequence[Point3]]) -> float:
    return round(sum(
        math.dist(a, b) for pl in polylines for a, b in zip(pl, pl[1:])
    ), 4)


def sloped_run(start: Point3, end_xy: Tuple[float, float], slope: float) -> List[Point3]:
    """Tramo con pendiente constante desde `start` hasta la vertical de `end_xy`.

    Se usa en desagues: la cota de llegada se deduce de la longitud horizontal
    y de la pendiente adoptada, no se elige a mano.
    """
    sx, sy, sz = start
    ex, ey = end_xy
    run = math.hypot(ex - sx, ey - sy)
    ez = round(sz - run * slope, 4)
    return [(round(sx, 4), round(sy, 4), round(sz, 4)), (round(ex, 4), round(ey, 4), ez)]


def grid_in_rect(
    rect: Sequence[float], count: int, margin: float = 0.60,
) -> List[Tuple[float, float]]:
    """Reparte `count` puntos en una retícula uniforme dentro del rectangulo.

    Criterio geometrico de reparto, no calculo fotometrico ni de cobertura.
    """
    x0, y0, x1, y1 = rect
    ax0, ay0 = x0 + margin, y0 + margin
    ax1, ay1 = x1 - margin, y1 - margin
    if ax1 <= ax0 or ay1 <= ay0:
        return [(round((x0 + x1) / 2, 4), round((y0 + y1) / 2, 4))] * max(1, count)
    w, h = ax1 - ax0, ay1 - ay0

    # Se elige el reparto nx x ny cuyas celdas quedan mas proximas a un cuadrado.
    nx, ny, best_ratio = 1, count, float("inf")
    for cand_nx in range(1, count + 1):
        cand_ny = math.ceil(count / cand_nx)
        cw, ch = w / cand_nx, h / cand_ny
        ratio = max(cw, ch) / min(cw, ch)
        if ratio < best_ratio:
            nx, ny, best_ratio = cand_nx, cand_ny, ratio

    pts: List[Tuple[float, float]] = []
    for j in range(ny):
        for i in range(nx):
            if len(pts) >= count:
                break
            px = ax0 + (w * (i + 0.5) / nx)
            py = ay0 + (h * (j + 0.5) / ny)
            pts.append((round(px, 4), round(py, 4)))
    return pts


def perimeter_points(
    rect: Sequence[float], spacing: float, inset: float = 0.12, start_offset: float = 0.80,
) -> List[Tuple[float, float, str]]:
    """Puntos repartidos sobre el perimetro interior de un recinto.

    Devuelve (x, y, cara) con cara en {'S','E','N','W'} para orientar el
    dispositivo contra el muro correspondiente.
    """
    x0, y0, x1, y1 = rect
    ix0, iy0, ix1, iy1 = x0 + inset, y0 + inset, x1 - inset, y1 - inset
    edges = [
        ((ix0, iy0), (ix1, iy0), "S"),
        ((ix1, iy0), (ix1, iy1), "E"),
        ((ix1, iy1), (ix0, iy1), "N"),
        ((ix0, iy1), (ix0, iy0), "W"),
    ]
    out: List[Tuple[float, float, str]] = []
    for (ax, ay), (bx, by), face in edges:
        seg = math.hypot(bx - ax, by - ay)
        if seg <= 2 * start_offset:
            continue
        usable = seg - 2 * start_offset
        n = int(usable // spacing) + 1
        for k in range(n):
            t = (start_offset + k * spacing) / seg
            out.append((round(ax + (bx - ax) * t, 4), round(ay + (by - ay) * t, 4), face))
    return out
