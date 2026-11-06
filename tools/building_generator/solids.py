"""Kernel geometrico parametrico.

Un `Solid` es una receta parametrica, no una malla. Desde la misma receta se
derivan:

  * malla triangulada (GLB / OBJ / deteccion de colisiones)
  * solido B-rep de OpenCascade (STEP)
  * solido de barrido IFC (IFC4)
  * vistas 2D: planta por seccion horizontal, alzado por silueta ortografica,
    corte por plano vertical, isometrico por aristas

Las vistas 2D NO se dibujan a mano: se calculan desde estas mismas primitivas.
Esa es la condicion que exige el apartado 11 de la solicitud.

Primitivas soportadas
---------------------
  Prism    poligono (con agujeros) extruido en Z
  Sweep    perfil circular o rectangular barrido por un segmento recto 3D
  Revolve  perfil (r, z) revolucionado alrededor de un eje vertical

Las tres son suficientes para muros, losas, columnas, vigas, escaleras,
tuberias, ductos, canalizaciones, conductores, bandejas y tanques.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

import numpy as np
from shapely.geometry import LineString, Polygon
from shapely.ops import unary_union

Point2 = Tuple[float, float]
Point3 = Tuple[float, float, float]

# Tesela unica para perfiles circulares. El mismo valor se usa en la malla y en
# las vistas 2D para que planos y modelo coincidan exactamente.
CIRCLE_SEGMENTS = 16

TOL = 1e-9


# ---------------------------------------------------------------------------
# Primitivas
# ---------------------------------------------------------------------------


class Primitive:
    """Base de las primitivas parametricas."""

    kind = "primitive"

    def describe(self) -> Dict[str, Any]:
        raise NotImplementedError

    def vertices(self) -> np.ndarray:
        raise NotImplementedError

    def to_trimesh(self):
        raise NotImplementedError

    def to_cadquery(self):
        raise NotImplementedError

    def plan_footprint(self) -> List[Polygon]:
        """Huella en planta (proyeccion sobre XY), exacta."""
        raise NotImplementedError

    def z_range(self) -> Tuple[float, float]:
        v = self.vertices()
        return (float(v[:, 2].min()), float(v[:, 2].max()))

    def silhouette(self, axis: str, flip: bool) -> List[Polygon]:
        """Silueta ortografica sobre un plano vertical.

        `axis` es el eje horizontal del plano de proyeccion ('x' o 'y').
        Devuelve poligonos en coordenadas (u, z).
        """
        raise NotImplementedError

    def edges(self) -> List[Tuple[Point3, Point3]]:
        raise NotImplementedError


def _as_poly(outer: Sequence[Point2], holes: Optional[Sequence[Sequence[Point2]]] = None) -> Polygon:
    p = Polygon(outer, holes or [])
    if not p.is_valid:
        p = p.buffer(0)
    return p


@dataclass
class Prism(Primitive):
    """Poligono extruido en Z. Admite agujeros (vacios de losa, ductos)."""

    outer: List[Point2]
    z0: float
    z1: float
    holes: List[List[Point2]] = field(default_factory=list)

    kind = "prism"

    def __post_init__(self) -> None:
        if self.z1 < self.z0:
            self.z0, self.z1 = self.z1, self.z0

    @property
    def height(self) -> float:
        return self.z1 - self.z0

    def polygon(self) -> Polygon:
        return _as_poly(self.outer, self.holes)

    def describe(self) -> Dict[str, Any]:
        return {
            "primitive": "prism",
            "operation": "extrude",
            "extrude_axis": "Z",
            "outer_vertex_count": len(self.outer),
            "hole_count": len(self.holes),
            "z0": round(self.z0, 6),
            "z1": round(self.z1, 6),
            "height": round(self.height, 6),
            "base_area_m2": round(self.polygon().area, 6),
            "outer": [[round(x, 6), round(y, 6)] for x, y in self.outer],
            "holes": [[[round(x, 6), round(y, 6)] for x, y in h] for h in self.holes],
        }

    def vertices(self) -> np.ndarray:
        pts = list(self.outer) + [p for h in self.holes for p in h]
        out = []
        for x, y in pts:
            out.append((x, y, self.z0))
            out.append((x, y, self.z1))
        return np.asarray(out, dtype=float)

    def to_trimesh(self):
        import trimesh

        mesh = trimesh.creation.extrude_polygon(self.polygon(), height=self.height)
        mesh.apply_translation((0.0, 0.0, self.z0))
        return mesh

    def to_cadquery(self):
        import cadquery as cq

        poly = self.polygon()
        ext = list(poly.exterior.coords)[:-1]
        wp = cq.Workplane("XY").polyline([(x, y) for x, y in ext]).close()
        solid = wp.extrude(self.height)
        for ring in poly.interiors:
            coords = list(ring.coords)[:-1]
            cutter = (
                cq.Workplane("XY").polyline([(x, y) for x, y in coords]).close().extrude(self.height)
            )
            solid = solid.cut(cutter)
        return solid.translate((0.0, 0.0, self.z0))

    def plan_footprint(self) -> List[Polygon]:
        return [self.polygon()]

    def silhouette(self, axis: str, flip: bool) -> List[Polygon]:
        idx = 0 if axis == "x" else 1
        us = [p[idx] for p in self.outer]
        u0, u1 = min(us), max(us)
        if flip:
            u0, u1 = -u1, -u0
        return [_as_poly([(u0, self.z0), (u1, self.z0), (u1, self.z1), (u0, self.z1)])]

    def edges(self) -> List[Tuple[Point3, Point3]]:
        out: List[Tuple[Point3, Point3]] = []
        rings = [list(self.outer)] + [list(h) for h in self.holes]
        for ring in rings:
            n = len(ring)
            for i in range(n):
                a, b = ring[i], ring[(i + 1) % n]
                out.append(((a[0], a[1], self.z0), (b[0], b[1], self.z0)))
                out.append(((a[0], a[1], self.z1), (b[0], b[1], self.z1)))
                out.append(((a[0], a[1], self.z0), (a[0], a[1], self.z1)))
        return out


@dataclass
class Sweep(Primitive):
    """Perfil barrido por un segmento recto. Tuberias, ductos, conductores."""

    p0: Point3
    p1: Point3
    profile: str                      # 'circle' | 'rect'
    diameter: Optional[float] = None  # perfil circular
    width: Optional[float] = None     # perfil rectangular
    height_p: Optional[float] = None  # perfil rectangular

    kind = "sweep"

    def __post_init__(self) -> None:
        if self.profile == "circle":
            if not self.diameter:
                raise ValueError("Sweep circular requiere diameter")
        elif self.profile == "rect":
            if not (self.width and self.height_p):
                raise ValueError("Sweep rectangular requiere width y height_p")
        else:
            raise ValueError("perfil no soportado: %r" % self.profile)

    # -- geometria del eje -------------------------------------------------

    @property
    def length(self) -> float:
        a, b = np.asarray(self.p0, float), np.asarray(self.p1, float)
        return float(np.linalg.norm(b - a))

    def _basis(self):
        """Terna ortonormal (d, right, up) del barrido. Deterministica."""
        a, b = np.asarray(self.p0, float), np.asarray(self.p1, float)
        d = b - a
        n = np.linalg.norm(d)
        if n < TOL:
            raise ValueError("Sweep de longitud nula: %r -> %r" % (self.p0, self.p1))
        d = d / n
        ref = np.array([0.0, 0.0, 1.0])
        if abs(float(np.dot(d, ref))) > 0.9999:
            ref = np.array([0.0, 1.0, 0.0])
        right = np.cross(ref, d)
        right /= np.linalg.norm(right)
        up = np.cross(d, right)
        up /= np.linalg.norm(up)
        return d, right, up

    def _profile_offsets(self) -> List[np.ndarray]:
        """Puntos del perfil en el plano (right, up) alrededor del eje."""
        _, right, up = self._basis()
        if self.profile == "circle":
            r = self.diameter / 2.0
            pts = []
            for i in range(CIRCLE_SEGMENTS):
                a = 2.0 * math.pi * i / CIRCLE_SEGMENTS
                pts.append(right * (r * math.cos(a)) + up * (r * math.sin(a)))
            return pts
        w, h = self.width / 2.0, self.height_p / 2.0
        return [
            right * (-w) + up * (-h),
            right * (w) + up * (-h),
            right * (w) + up * (h),
            right * (-w) + up * (h),
        ]

    def describe(self) -> Dict[str, Any]:
        d: Dict[str, Any] = {
            "primitive": "sweep",
            "operation": "sweep_along_segment",
            "p0": [round(v, 6) for v in self.p0],
            "p1": [round(v, 6) for v in self.p1],
            "length": round(self.length, 6),
            "profile": self.profile,
        }
        if self.profile == "circle":
            d["diameter"] = round(self.diameter, 6)
            d["circle_segments"] = CIRCLE_SEGMENTS
        else:
            d["width"] = round(self.width, 6)
            d["height"] = round(self.height_p, 6)
        return d

    def vertices(self) -> np.ndarray:
        a, b = np.asarray(self.p0, float), np.asarray(self.p1, float)
        offs = self._profile_offsets()
        return np.asarray([a + o for o in offs] + [b + o for o in offs], dtype=float)

    def to_trimesh(self):
        import trimesh

        a, b = np.asarray(self.p0, float), np.asarray(self.p1, float)
        offs = self._profile_offsets()
        n = len(offs)
        start = [a + o for o in offs]
        end = [b + o for o in offs]
        verts = np.asarray(start + end, dtype=float)
        faces: List[List[int]] = []
        for i in range(n):
            j = (i + 1) % n
            faces.append([i, j, n + j])
            faces.append([i, n + j, n + i])
        # tapas por abanico
        for i in range(1, n - 1):
            faces.append([0, i + 1, i])
            faces.append([n, n + i, n + i + 1])
        mesh = trimesh.Trimesh(vertices=verts, faces=np.asarray(faces), process=True)
        mesh.fix_normals()
        return mesh

    def to_cadquery(self):
        import cadquery as cq
        from cadquery.occ_impl.shapes import Solid as OccSolid

        a, b = np.asarray(self.p0, float), np.asarray(self.p1, float)
        d, right, up = self._basis()
        if self.profile == "circle":
            solid = OccSolid.makeCylinder(
                self.diameter / 2.0,
                self.length,
                pnt=cq.Vector(*a),
                dir=cq.Vector(*d),
            )
        else:
            offs = self._profile_offsets()
            pts = [cq.Vector(*(a + o)) for o in offs]
            wire = cq.Wire.makePolygon(pts + [pts[0]])
            face = cq.Face.makeFromWires(wire)
            solid = OccSolid.extrudeLinear(face, cq.Vector(*(d * self.length)))
        return cq.Workplane("XY").newObject([solid])

    def plan_footprint(self) -> List[Polygon]:
        a, b = np.asarray(self.p0, float), np.asarray(self.p1, float)
        if self.profile == "circle":
            half = self.diameter / 2.0
        else:
            half = max(self.width, self.height_p) / 2.0
        if abs(a[0] - b[0]) < TOL and abs(a[1] - b[1]) < TOL:
            # tramo vertical: la huella es la seccion del perfil
            return [self._section_at_axis_point(a)]
        line = LineString([(a[0], a[1]), (b[0], b[1])])
        return [line.buffer(half, cap_style=2, join_style=2)]

    def _section_at_axis_point(self, origin: np.ndarray) -> Polygon:
        offs = self._profile_offsets()
        pts = [(float((origin + o)[0]), float((origin + o)[1])) for o in offs]
        return _as_poly(pts)

    def silhouette(self, axis: str, flip: bool) -> List[Polygon]:
        from shapely.geometry import MultiPoint

        idx = 0 if axis == "x" else 1
        pts = []
        for v in self.vertices():
            u = float(v[idx])
            if flip:
                u = -u
            pts.append((u, float(v[2])))
        hull = MultiPoint(pts).convex_hull
        if hull.geom_type != "Polygon":
            hull = hull.buffer(1e-4)
        return [hull] if hull.geom_type == "Polygon" else []

    def edges(self) -> List[Tuple[Point3, Point3]]:
        a, b = np.asarray(self.p0, float), np.asarray(self.p1, float)
        offs = self._profile_offsets()
        n = len(offs)
        start = [a + o for o in offs]
        end = [b + o for o in offs]
        out: List[Tuple[Point3, Point3]] = []
        for i in range(n):
            j = (i + 1) % n
            out.append((tuple(start[i]), tuple(start[j])))
            out.append((tuple(end[i]), tuple(end[j])))
        step = 1 if n <= 4 else max(1, n // 4)
        for i in range(0, n, step):
            out.append((tuple(start[i]), tuple(end[i])))
        return out


@dataclass
class Revolve(Primitive):
    """Perfil (r, z) revolucionado alrededor de un eje vertical en `center`."""

    profile: List[Point2]            # lista de (radio, z) de abajo hacia arriba
    center: Point2
    segments: int = CIRCLE_SEGMENTS
    angle_deg: float = 360.0

    kind = "revolve"

    def describe(self) -> Dict[str, Any]:
        return {
            "primitive": "revolve",
            "operation": "revolve",
            "axis": "Z",
            "center": [round(v, 6) for v in self.center],
            "angle_deg": self.angle_deg,
            "segments": self.segments,
            "profile_rz": [[round(r, 6), round(z, 6)] for r, z in self.profile],
        }

    def vertices(self) -> np.ndarray:
        cx, cy = self.center
        out = []
        for i in range(self.segments):
            a = 2.0 * math.pi * i / self.segments
            ca, sa = math.cos(a), math.sin(a)
            for r, z in self.profile:
                out.append((cx + r * ca, cy + r * sa, z))
        return np.asarray(out, dtype=float)

    def to_trimesh(self):
        import trimesh

        cx, cy = self.center
        m = len(self.profile)
        n = self.segments
        verts: List[Point3] = []
        for i in range(n):
            a = 2.0 * math.pi * i / n
            ca, sa = math.cos(a), math.sin(a)
            for r, z in self.profile:
                verts.append((cx + r * ca, cy + r * sa, z))
        faces: List[List[int]] = []
        for i in range(n):
            j = (i + 1) % n
            for k in range(m - 1):
                a0 = i * m + k
                a1 = i * m + k + 1
                b0 = j * m + k
                b1 = j * m + k + 1
                faces.append([a0, b0, b1])
                faces.append([a0, b1, a1])
        # tapas inferior y superior si el perfil no cierra en el eje
        base_r, base_z = self.profile[0]
        top_r, top_z = self.profile[-1]
        if base_r > TOL:
            c = len(verts)
            verts.append((cx, cy, base_z))
            for i in range(n):
                j = (i + 1) % n
                faces.append([c, j * m, i * m])
        if top_r > TOL:
            c = len(verts)
            verts.append((cx, cy, top_z))
            for i in range(n):
                j = (i + 1) % n
                faces.append([c, i * m + (m - 1), j * m + (m - 1)])
        mesh = trimesh.Trimesh(vertices=np.asarray(verts), faces=np.asarray(faces), process=True)
        mesh.fix_normals()
        return mesh

    def to_cadquery(self):
        import cadquery as cq

        cx, cy = self.center
        pts = [(r, z) for r, z in self.profile]
        # cierre del contorno sobre el eje de revolucion
        ring = [(0.0, pts[0][1])] + pts + [(0.0, pts[-1][1])]
        wp = cq.Workplane("XZ").polyline(ring).close()
        solid = wp.revolve(self.angle_deg, (0, 0, 0), (0, 0, 1))
        return solid.translate((cx, cy, 0.0))

    def plan_footprint(self) -> List[Polygon]:
        rmax = max(r for r, _ in self.profile)
        cx, cy = self.center
        pts = []
        for i in range(self.segments):
            a = 2.0 * math.pi * i / self.segments
            pts.append((cx + rmax * math.cos(a), cy + rmax * math.sin(a)))
        return [_as_poly(pts)]

    def silhouette(self, axis: str, flip: bool) -> List[Polygon]:
        cu = self.center[0] if axis == "x" else self.center[1]
        if flip:
            cu = -cu
        right = [(cu + r, z) for r, z in self.profile]
        left = [(cu - r, z) for r, z in reversed(self.profile)]
        return [_as_poly(right + left)]

    def edges(self) -> List[Tuple[Point3, Point3]]:
        cx, cy = self.center
        out: List[Tuple[Point3, Point3]] = []
        n = self.segments
        for r, z in self.profile:
            if r <= TOL:
                continue
            for i in range(n):
                a0 = 2.0 * math.pi * i / n
                a1 = 2.0 * math.pi * ((i + 1) % n) / n
                out.append(
                    (
                        (cx + r * math.cos(a0), cy + r * math.sin(a0), z),
                        (cx + r * math.cos(a1), cy + r * math.sin(a1), z),
                    )
                )
        step = max(1, n // 4)
        for i in range(0, n, step):
            a = 2.0 * math.pi * i / n
            ca, sa = math.cos(a), math.sin(a)
            for k in range(len(self.profile) - 1):
                r0, z0 = self.profile[k]
                r1, z1 = self.profile[k + 1]
                out.append(((cx + r0 * ca, cy + r0 * sa, z0), (cx + r1 * ca, cy + r1 * sa, z1)))
        return out


# ---------------------------------------------------------------------------
# Solido compuesto
# ---------------------------------------------------------------------------


@dataclass
class Solid:
    """Conjunto de primitivas que representa un componente constructivo."""

    solid_id: str
    primitives: List[Primitive]
    material: str
    discipline: str
    level_id: Optional[str] = None
    layer: Optional[str] = None
    metadata: Dict[str, Any] = field(default_factory=dict)

    # -- malla -------------------------------------------------------------

    def to_trimesh(self):
        import trimesh

        meshes = [p.to_trimesh() for p in self.primitives]
        meshes = [m for m in meshes if m is not None and len(m.faces)]
        if not meshes:
            return None
        if len(meshes) == 1:
            return meshes[0]
        return trimesh.util.concatenate(meshes)

    def to_cadquery(self):
        import cadquery as cq

        solids = []
        for p in self.primitives:
            try:
                solids.extend(p.to_cadquery().vals())
            except Exception:
                continue
        if not solids:
            return None
        return cq.Workplane("XY").newObject(solids)

    # -- metricas ----------------------------------------------------------

    def bbox(self) -> Tuple[Point3, Point3]:
        v = np.vstack([p.vertices() for p in self.primitives])
        return (
            (float(v[:, 0].min()), float(v[:, 1].min()), float(v[:, 2].min())),
            (float(v[:, 0].max()), float(v[:, 1].max()), float(v[:, 2].max())),
        )

    def volume(self) -> float:
        """Volumen de la malla. Positivo para solidos cerrados."""
        m = self.to_trimesh()
        if m is None:
            return 0.0
        return abs(float(m.volume))

    def z_range(self) -> Tuple[float, float]:
        lo = min(p.z_range()[0] for p in self.primitives)
        hi = max(p.z_range()[1] for p in self.primitives)
        return (lo, hi)

    # -- vistas 2D ---------------------------------------------------------

    def plan_cut(self, z: float) -> List[Polygon]:
        """Seccion horizontal a cota `z`. Devuelve poligonos en XY.

        Si el solido es cortado por el plano, devuelve la seccion real. Es la
        base de los planos de planta.
        """
        out: List[Polygon] = []
        for p in self.primitives:
            lo, hi = p.z_range()
            if not (lo - TOL <= z <= hi + TOL):
                continue
            if isinstance(p, Prism):
                out.append(p.polygon())
            elif isinstance(p, Revolve):
                r = _radius_at(p.profile, z)
                if r > TOL:
                    cx, cy = p.center
                    pts = [
                        (cx + r * math.cos(2 * math.pi * i / p.segments),
                         cy + r * math.sin(2 * math.pi * i / p.segments))
                        for i in range(p.segments)
                    ]
                    out.append(_as_poly(pts))
            else:
                out.extend(_sweep_plan_cut(p, z))
        return [g for g in out if g.area > 1e-10]

    def plan_projection(self) -> List[Polygon]:
        """Huella proyectada en planta, sin cortar."""
        out: List[Polygon] = []
        for p in self.primitives:
            out.extend(p.plan_footprint())
        return [g for g in out if g.area > 1e-10]

    def elevation(self, axis: str, flip: bool = False) -> List[Polygon]:
        """Silueta ortografica sobre plano vertical. Coordenadas (u, z)."""
        out: List[Polygon] = []
        for p in self.primitives:
            out.extend(p.silhouette(axis, flip))
        return [g for g in out if g.area > 1e-10]

    def vertical_cut(self, axis: str, value: float, flip: bool = False) -> List[Polygon]:
        """Corte por plano vertical x=value (axis='x') o y=value (axis='y').

        Devuelve poligonos en coordenadas (u, z), donde u es el eje horizontal
        restante.
        """
        cut_idx = 0 if axis == "x" else 1
        keep_idx = 1 - cut_idx
        out: List[Polygon] = []
        for p in self.primitives:
            if isinstance(p, Prism):
                poly = p.polygon()
                minx, miny, maxx, maxy = poly.bounds
                lo = (minx, maxx) if cut_idx == 0 else (miny, maxy)
                if not (lo[0] - TOL <= value <= lo[1] + TOL):
                    continue
                if cut_idx == 0:
                    line = LineString([(value, miny - 1.0), (value, maxy + 1.0)])
                else:
                    line = LineString([(minx - 1.0, value), (maxx + 1.0, value)])
                inter = poly.intersection(line)
                for seg in _iter_lines(inter):
                    coords = list(seg.coords)
                    us = [c[keep_idx] for c in coords]
                    u0, u1 = min(us), max(us)
                    if u1 - u0 < 1e-9:
                        continue
                    if flip:
                        u0, u1 = -u1, -u0
                    out.append(
                        _as_poly([(u0, p.z0), (u1, p.z0), (u1, p.z1), (u0, p.z1)])
                    )
            else:
                out.extend(_generic_vertical_cut(p, axis, value, flip))
        return [g for g in out if g.area > 1e-10]

    def iso_edges(self) -> List[Tuple[Point3, Point3]]:
        out: List[Tuple[Point3, Point3]] = []
        for p in self.primitives:
            out.extend(p.edges())
        return out

    # -- descripcion -------------------------------------------------------

    def describe(self) -> Dict[str, Any]:
        lo, hi = self.bbox()
        return {
            "solid_id": self.solid_id,
            "discipline": self.discipline,
            "level_id": self.level_id,
            "material": self.material,
            "primitive_count": len(self.primitives),
            "primitives": [p.describe() for p in self.primitives],
            "bbox_min": [round(v, 6) for v in lo],
            "bbox_max": [round(v, 6) for v in hi],
            "volume_m3": round(self.volume(), 6),
        }


# ---------------------------------------------------------------------------
# Auxiliares de seccion
# ---------------------------------------------------------------------------


def _iter_lines(geom) -> Iterable[LineString]:
    if geom.is_empty:
        return []
    if geom.geom_type == "LineString":
        return [geom]
    if geom.geom_type in ("MultiLineString", "GeometryCollection"):
        out = []
        for g in geom.geoms:
            if g.geom_type == "LineString":
                out.append(g)
        return out
    return []


def _radius_at(profile: Sequence[Point2], z: float) -> float:
    """Radio interpolado del perfil de revolucion a cota z."""
    best = 0.0
    for k in range(len(profile) - 1):
        r0, z0 = profile[k]
        r1, z1 = profile[k + 1]
        lo, hi = min(z0, z1), max(z0, z1)
        if lo - TOL <= z <= hi + TOL:
            if abs(z1 - z0) < TOL:
                best = max(best, r0, r1)
            else:
                t = (z - z0) / (z1 - z0)
                best = max(best, r0 + t * (r1 - r0))
    return best


def _sweep_plan_cut(p: Sweep, z: float) -> List[Polygon]:
    """Seccion horizontal de un barrido, exacta para los casos del modelo."""
    a = np.asarray(p.p0, float)
    b = np.asarray(p.p1, float)
    dz = b[2] - a[2]
    horizontal = abs(a[0] - b[0]) > TOL or abs(a[1] - b[1]) > TOL

    if not horizontal:
        # tramo vertical
        if min(a[2], b[2]) - TOL <= z <= max(a[2], b[2]) + TOL:
            return [p._section_at_axis_point(np.array([a[0], a[1], z]))]
        return []

    # tramo horizontal o inclinado: se corta el eje con el plano y se evalua
    # el semiancho disponible del perfil a esa cota.
    if abs(dz) < TOL:
        z_axis_lo = z_axis_hi = a[2]
        u0, u1 = 0.0, 1.0
    else:
        # porcion del eje cuyo perfil alcanza la cota z
        half = _profile_half_height(p)
        t_lo = (z - half - a[2]) / dz
        t_hi = (z + half - a[2]) / dz
        u0, u1 = sorted((t_lo, t_hi))
        u0 = max(0.0, u0)
        u1 = min(1.0, u1)
        if u1 <= u0:
            return []
        z_axis_lo = a[2] + dz * u0
        z_axis_hi = a[2] + dz * u1

    half_w = _profile_half_width_at(p, z - (z_axis_lo + z_axis_hi) / 2.0)
    if half_w <= TOL:
        return []
    pa = a + (b - a) * u0
    pb = a + (b - a) * u1
    if math.hypot(pb[0] - pa[0], pb[1] - pa[1]) < TOL:
        return []
    line = LineString([(pa[0], pa[1]), (pb[0], pb[1])])
    return [line.buffer(half_w, cap_style=2, join_style=2)]


def _profile_half_height(p: Sweep) -> float:
    return (p.diameter / 2.0) if p.profile == "circle" else (p.height_p / 2.0)


def _profile_half_width_at(p: Sweep, dz_from_axis: float) -> float:
    """Semiancho del perfil a una distancia vertical `dz_from_axis` del eje."""
    if p.profile == "circle":
        r = p.diameter / 2.0
        d2 = r * r - dz_from_axis * dz_from_axis
        return math.sqrt(d2) if d2 > 0 else 0.0
    if abs(dz_from_axis) > p.height_p / 2.0 + TOL:
        return 0.0
    return p.width / 2.0


def _generic_vertical_cut(p: Primitive, axis: str, value: float, flip: bool) -> List[Polygon]:
    """Corte vertical de primitivas no prismaticas, via malla triangulada.

    Se usa la misma malla que se entrega en GLB/OBJ, de modo que el corte del
    plano coincide con la geometria exportada.
    """
    import trimesh

    try:
        mesh = p.to_trimesh()
    except Exception:
        return []
    if mesh is None or not len(mesh.faces):
        return []
    normal = [1.0, 0.0, 0.0] if axis == "x" else [0.0, 1.0, 0.0]
    origin = [value, 0.0, 0.0] if axis == "x" else [0.0, value, 0.0]
    lo, hi = p.z_range()
    bmin, bmax = mesh.bounds
    idx = 0 if axis == "x" else 1
    if not (bmin[idx] - TOL <= value <= bmax[idx] + TOL):
        return []
    try:
        section = mesh.section(plane_origin=origin, plane_normal=normal)
    except Exception:
        return []
    if section is None:
        return []
    keep = 1 if axis == "x" else 0
    out: List[Polygon] = []
    pts = []
    for entity in section.entities:
        coords = section.vertices[entity.points]
        for c in coords:
            u = float(c[keep])
            if flip:
                u = -u
            pts.append((u, float(c[2])))
    if len(pts) < 3:
        return []
    from shapely.geometry import MultiPoint

    hull = MultiPoint(pts).convex_hull
    if hull.geom_type == "Polygon":
        out.append(hull)
    return out


# ---------------------------------------------------------------------------
# Constructores de conveniencia
# ---------------------------------------------------------------------------


def rect_points(x0: float, y0: float, x1: float, y1: float) -> List[Point2]:
    return [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]


def box_prism(x0: float, y0: float, x1: float, y1: float, z0: float, z1: float) -> Prism:
    return Prism(outer=rect_points(min(x0, x1), min(y0, y1), max(x0, x1), max(y0, y1)), z0=z0, z1=z1)


def pipe(p0: Point3, p1: Point3, diameter: float) -> Sweep:
    return Sweep(p0=p0, p1=p1, profile="circle", diameter=diameter)


def duct(p0: Point3, p1: Point3, width: float, height: float) -> Sweep:
    return Sweep(p0=p0, p1=p1, profile="rect", width=width, height_p=height)


def polyline_pipe(points: Sequence[Point3], diameter: float) -> List[Sweep]:
    """Recorrido poligonal como serie de barridos rectos consecutivos."""
    out: List[Sweep] = []
    for a, b in zip(points, points[1:]):
        if math.dist(a, b) < 1e-6:
            continue
        out.append(pipe(a, b, diameter))
    return out


def polyline_duct(points: Sequence[Point3], width: float, height: float) -> List[Sweep]:
    out: List[Sweep] = []
    for a, b in zip(points, points[1:]):
        if math.dist(a, b) < 1e-6:
            continue
        out.append(duct(a, b, width, height))
    return out


def polyline_length(points: Sequence[Point3]) -> float:
    return float(sum(math.dist(a, b) for a, b in zip(points, points[1:])))


def union_polygons(polys: Sequence[Polygon]):
    polys = [p for p in polys if p is not None and not p.is_empty]
    if not polys:
        return None
    return unary_union(polys)
