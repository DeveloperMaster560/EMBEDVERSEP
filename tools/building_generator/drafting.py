"""Primitivas de dibujo, capas y composicion de laminas.

Separacion de sistemas de coordenadas
-------------------------------------
Cada lamina maneja dos espacios:

  ESPACIO MODELO   metros. Contiene la geometria de la vista, calculada desde
                   los solidos del modelo. Nada se dibuja a mano aqui.
  ESPACIO PAPEL    milimetros de lamina. Contiene marco, cajetin, leyenda y
                   tablas, que son elementos de presentacion.

La transformacion entre ambos es una unica semejanza determinada por la escala
de la lamina:

    papel_mm = viewport_mm + (modelo_m - origen_m) * 1000 / escala

Los exportadores usan esa transformacion en un sentido u otro:

  DXF   escribe en METROS (1 unidad = 1 m). El marco y el cajetin se convierten
        a metros, de modo que el archivo es medible a tamano real.
  PDF   escribe en puntos de papel. La geometria del modelo se convierte a mm.
  SVG   escribe en milimetros de papel, igual que el PDF.

Por eso las tres salidas de una misma lamina son geometricamente identicas.

Las alturas de texto y los grosores de linea se declaran en MILIMETROS DE
PLOTEO, no en metros: es lo que hace que el resultado sea legible a cualquier
escala.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Sequence, Tuple

Point2 = Tuple[float, float]

# ---------------------------------------------------------------------------
# Formatos de papel (mm)
# ---------------------------------------------------------------------------

PAPER = {
    "A0": (1189.0, 841.0),
    "A1": (841.0, 594.0),
    "A2": (594.0, 420.0),
    "A3": (420.0, 297.0),
}

MARGIN_MM = 10.0
TITLEBLOCK_W_MM = 185.0
TITLEBLOCK_H_MM = 62.0


# ---------------------------------------------------------------------------
# Capas
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class Layer:
    name: str
    aci: int                 # color index de AutoCAD, para DXF
    rgb: Tuple[int, int, int]
    linetype: str = "CONTINUOUS"
    lineweight_mm: float = 0.18
    description: str = ""


def _L(name, aci, rgb, lt="CONTINUOUS", lw=0.18, desc=""):
    return Layer(name, aci, rgb, lt, lw, desc)


LAYERS: Dict[str, Layer] = {l.name: l for l in [
    # presentacion
    _L("LAM-MARCO", 7, (30, 30, 30), lw=0.50, desc="Marco de lamina"),
    _L("LAM-CAJETIN", 7, (30, 30, 30), lw=0.35, desc="Cajetin tecnico"),
    _L("LAM-TEXTO", 7, (20, 20, 20), lw=0.18, desc="Texto de presentacion"),
    _L("LAM-LEYENDA", 7, (40, 40, 40), lw=0.18, desc="Leyenda"),
    _L("LAM-TABLA", 7, (40, 40, 40), lw=0.20, desc="Tablas y cuadros"),
    _L("LAM-NORTE", 7, (20, 20, 20), lw=0.25, desc="Simbolo de norte"),
    # referencia
    _L("EJES", 6, (170, 70, 170), "CENTER", 0.13, "Ejes estructurales"),
    _L("EJES-TEXTO", 6, (140, 50, 140), lw=0.13, desc="Rotulos de eje"),
    _L("COTAS", 4, (0, 150, 160), lw=0.13, desc="Cotas"),
    _L("NIVELES", 4, (0, 140, 150), lw=0.13, desc="Marcas de nivel"),
    _L("CORTE-TRAZA", 1, (200, 40, 40), "DASHED", 0.30, "Traza de corte"),
    # arquitectura
    _L("ARQ-MUROS-CORTE", 7, (25, 25, 25), lw=0.50, desc="Muros seccionados"),
    _L("ARQ-MUROS-PROY", 8, (120, 120, 120), lw=0.18, desc="Muros proyectados"),
    _L("ARQ-CARPINTERIA", 3, (0, 140, 70), lw=0.25, desc="Puertas y ventanas"),
    _L("ARQ-ESPACIOS", 9, (190, 190, 190), "DASHED", 0.09, "Limite de recinto"),
    _L("ARQ-TEXTO", 7, (20, 20, 20), lw=0.18, desc="Rotulos de recinto"),
    _L("ARQ-CUBIERTA", 8, (110, 110, 110), lw=0.25, desc="Elementos de cubierta"),
    # estructura
    _L("ESTR-COLUMNAS", 1, (190, 30, 30), lw=0.50, desc="Columnas"),
    _L("ESTR-VIGAS", 2, (200, 120, 0), "DASHED", 0.25, "Vigas"),
    _L("ESTR-LOSAS", 8, (130, 130, 130), lw=0.20, desc="Losas"),
    _L("ESTR-CIMENTACION", 1, (160, 40, 40), lw=0.35, desc="Cimentacion"),
    _L("ESTR-ESCALERA", 2, (190, 110, 0), lw=0.30, desc="Escaleras"),
    _L("ESTR-TEXTO", 1, (150, 30, 30), lw=0.18, desc="Rotulos estructurales"),
    # electrico
    _L("ELE-ILUMINACION", 2, (210, 160, 0), lw=0.25, desc="Luminarias"),
    _L("ELE-TOMACORRIENTES", 5, (0, 90, 200), lw=0.25, desc="Tomacorrientes"),
    _L("ELE-CIRCUITOS", 5, (0, 110, 220), lw=0.18, desc="Circuitos ramales"),
    _L("ELE-FUERZA", 5, (0, 70, 170), lw=0.30, desc="Circuitos de fuerza"),
    _L("ELE-TABLEROS", 1, (190, 30, 30), lw=0.35, desc="Tableros"),
    _L("ELE-ALIMENTADORES", 1, (170, 30, 60), lw=0.35, desc="Alimentadores"),
    _L("ELE-CANALIZACIONES", 4, (0, 150, 160), lw=0.25, desc="Canalizaciones y bandejas"),
    _L("ELE-ACOMETIDA", 1, (150, 20, 20), lw=0.40, desc="Acometida"),
    _L("ELE-TIERRA", 3, (0, 130, 60), lw=0.30, desc="Puesta a tierra"),
    _L("ELE-EQUIPOS", 1, (180, 40, 40), lw=0.30, desc="Equipos electricos"),
    _L("ELE-TEXTO", 5, (0, 80, 180), lw=0.18, desc="Rotulos electricos"),
    # telecomunicaciones
    _L("TEL-EQUIPOS", 6, (150, 0, 150), lw=0.35, desc="Rack, switches y router"),
    _L("TEL-TOMAS", 6, (170, 30, 170), lw=0.25, desc="Tomas de red"),
    _L("TEL-WIFI", 6, (190, 60, 190), lw=0.25, desc="Puntos de acceso"),
    _L("TEL-CANALIZACIONES", 6, (160, 80, 170), lw=0.20, desc="Canalizaciones de datos"),
    _L("TEL-TEXTO", 6, (140, 0, 140), lw=0.18, desc="Rotulos de datos"),
    # hidrosanitario
    _L("HID-AGUA", 5, (0, 110, 220), lw=0.30, desc="Agua potable"),
    _L("HID-DESAGUE", 2, (150, 90, 0), lw=0.35, desc="Desague"),
    _L("HID-VENTILACION", 3, (0, 140, 90), "DASHED", 0.25, "Ventilacion sanitaria"),
    _L("HID-PLUVIAL", 4, (0, 150, 170), lw=0.30, desc="Red pluvial"),
    _L("HID-APARATOS", 7, (60, 60, 60), lw=0.25, desc="Aparatos sanitarios"),
    _L("HID-EQUIPOS", 1, (180, 60, 40), lw=0.30, desc="Tanques, bombas, medidores"),
    _L("HID-TEXTO", 5, (0, 90, 190), lw=0.18, desc="Rotulos hidrosanitarios"),
    # climatizacion
    _L("CLI-EQUIPOS", 4, (0, 140, 150), lw=0.35, desc="Unidades y ventiladores"),
    _L("CLI-DUCTOS", 4, (0, 160, 170), lw=0.30, desc="Ductos"),
    _L("CLI-FRIGORIFICA", 2, (190, 130, 0), lw=0.25, desc="Tuberia frigorifica"),
    _L("CLI-REJILLAS", 3, (0, 150, 100), lw=0.25, desc="Rejillas y difusores"),
    _L("CLI-TEXTO", 4, (0, 120, 130), lw=0.18, desc="Rotulos de climatizacion"),
    # seguridad
    _L("SEG-DETECCION", 1, (210, 40, 40), lw=0.25, desc="Deteccion"),
    _L("SEG-CCTV", 6, (150, 40, 150), lw=0.25, desc="CCTV"),
    _L("SEG-ACCESO", 5, (0, 80, 190), lw=0.25, desc="Control de acceso"),
    _L("SEG-EMERGENCIA", 2, (200, 140, 0), lw=0.25, desc="Alumbrado de emergencia"),
    _L("SEG-SENALIZACION", 3, (0, 140, 80), lw=0.25, desc="Senalizacion"),
    _L("SEG-INCENDIO", 1, (200, 30, 30), lw=0.30, desc="Proteccion contra incendios"),
    _L("SEG-CANALIZACIONES", 1, (170, 60, 60), lw=0.20, desc="Canalizaciones de seguridad"),
    _L("SEG-EQUIPOS", 1, (190, 40, 40), lw=0.35, desc="Paneles de seguridad"),
    _L("SEG-TEXTO", 1, (170, 30, 30), lw=0.18, desc="Rotulos de seguridad"),
    # generico
    _L("DIAGRAMA", 7, (30, 30, 30), lw=0.25, desc="Diagramas y esquemas"),
    _L("DIAGRAMA-TEXTO", 7, (20, 20, 20), lw=0.18, desc="Texto de diagrama"),
    _L("ISO-ARISTAS", 8, (90, 90, 90), lw=0.13, desc="Aristas de isometrico"),
]}


def layer(name: str) -> Layer:
    if name not in LAYERS:
        raise KeyError("capa no declarada: %s" % name)
    return LAYERS[name]


# ---------------------------------------------------------------------------
# Primitivas de dibujo
# ---------------------------------------------------------------------------


@dataclass
class Prim:
    layer: str


@dataclass
class PolyLine(Prim):
    points: List[Point2]
    closed: bool = False


@dataclass
class Line(Prim):
    a: Point2
    b: Point2


@dataclass
class Circle(Prim):
    center: Point2
    radius: float


@dataclass
class Arc(Prim):
    center: Point2
    radius: float
    start_deg: float
    end_deg: float


@dataclass
class Text(Prim):
    position: Point2
    text: str
    height_mm: float = 2.5
    rotation: float = 0.0
    anchor: str = "left"      # left | center | right
    vertical: str = "baseline"  # baseline | middle | top


@dataclass
class LinearDim(Prim):
    p1: Point2
    p2: Point2
    offset: float             # desplazamiento en unidades de modelo
    direction: str = "h"      # h | v
    text_height_mm: float = 2.2
    override_text: Optional[str] = None


@dataclass
class Hatch(Prim):
    rings: List[List[Point2]]
    pattern: str = "SOLID"
    scale: float = 1.0
    angle: float = 45.0


# ---------------------------------------------------------------------------
# Lamina
# ---------------------------------------------------------------------------


@dataclass
class Sheet:
    sheet_id: str
    code: str
    title: str
    discipline: str
    scale: int                       # denominador: 50 -> 1:50; 1 -> sin escala
    paper: str = "A1"
    subtitle: str = ""
    level_label: str = ""
    view_kind: str = "plan"
    notes: List[str] = field(default_factory=list)
    legend: List[Tuple[str, str]] = field(default_factory=list)
    show_north: bool = False
    version: str = "1.0.0"
    model_prims: List[Prim] = field(default_factory=list)
    paper_prims: List[Prim] = field(default_factory=list)
    component_refs: List[str] = field(default_factory=list)
    origin_model: Point2 = (0.0, 0.0)
    viewport_mm: Point2 = (0.0, 0.0)

    # -- geometria del papel ----------------------------------------------

    @property
    def size_mm(self) -> Point2:
        return PAPER[self.paper]

    @property
    def drawing_area_mm(self) -> Tuple[float, float, float, float]:
        w, h = self.size_mm
        return (MARGIN_MM + 10.0, MARGIN_MM, w - MARGIN_MM, h - MARGIN_MM)

    @property
    def content_area_mm(self) -> Tuple[float, float, float, float]:
        """Zona libre para la vista, excluyendo el cajetin."""
        x0, y0, x1, y1 = self.drawing_area_mm
        return (x0 + 4.0, y0 + TITLEBLOCK_H_MM + 8.0, x1 - 4.0, y1 - 6.0)

    # -- transformacion ----------------------------------------------------

    def model_to_paper(self, p: Point2) -> Point2:
        k = 1000.0 / self.scale
        return (self.viewport_mm[0] + (p[0] - self.origin_model[0]) * k,
                self.viewport_mm[1] + (p[1] - self.origin_model[1]) * k)

    def paper_to_model(self, p: Point2) -> Point2:
        k = self.scale / 1000.0
        return (self.origin_model[0] + (p[0] - self.viewport_mm[0]) * k,
                self.origin_model[1] + (p[1] - self.viewport_mm[1]) * k)

    def mm_to_model(self, mm: float) -> float:
        return mm * self.scale / 1000.0

    # -- composicion -------------------------------------------------------

    def add(self, *prims: Prim) -> None:
        self.model_prims.extend(prims)

    def add_paper(self, *prims: Prim) -> None:
        self.paper_prims.extend(prims)

    def model_bbox(self) -> Optional[Tuple[float, float, float, float]]:
        xs: List[float] = []
        ys: List[float] = []
        for p in self.model_prims:
            for pt in _prim_points(p):
                xs.append(pt[0])
                ys.append(pt[1])
        if not xs:
            return None
        return (min(xs), min(ys), max(xs), max(ys))

    def fit(self, allow_rescale: bool = True, padding_mm: float = 0.0) -> None:
        """Centra la vista en la zona libre y, si no cabe, reduce la escala.

        `padding_mm` reserva un margen alrededor de la geometria para ejes,
        cotas y rotulos que se anaden despues de fijar la escala. El margen se
        incorpora al encuadre, de modo que esa anotacion cae dentro del area
        util y no desborda la lamina.

        La escala resultante se escribe en el cajetin, por lo que lo rotulado
        siempre corresponde a lo dibujado.
        """
        bbox = self.model_bbox()
        cx0, cy0, cx1, cy1 = self.content_area_mm
        avail_w, avail_h = cx1 - cx0, cy1 - cy0
        if bbox is None:
            self.origin_model = (0.0, 0.0)
            self.viewport_mm = (cx0 + avail_w / 2, cy0 + avail_h / 2)
            return
        bw = max(bbox[2] - bbox[0], 1e-6)
        bh = max(bbox[3] - bbox[1], 1e-6)

        if allow_rescale:
            for cand in _SCALE_LADDER:
                if cand < self.scale:
                    continue
                k = 1000.0 / cand
                if bw * k + 2 * padding_mm <= avail_w and bh * k + 2 * padding_mm <= avail_h:
                    self.scale = cand
                    break
            else:
                self.scale = _SCALE_LADDER[-1]

        k = 1000.0 / self.scale
        pad_m = padding_mm * self.scale / 1000.0
        ex0, ey0 = bbox[0] - pad_m, bbox[1] - pad_m
        used_w, used_h = (bw + 2 * pad_m) * k, (bh + 2 * pad_m) * k
        ox = cx0 + max(0.0, (avail_w - used_w) / 2.0)
        oy = cy0 + max(0.0, (avail_h - used_h) / 2.0)
        self.origin_model = (ex0, ey0)
        self.viewport_mm = (ox, oy)

    def fits(self) -> bool:
        """True si toda la geometria del modelo cae dentro del area util."""
        bbox = self.model_bbox()
        if bbox is None:
            return True
        cx0, cy0, cx1, cy1 = self.content_area_mm
        p0 = self.model_to_paper((bbox[0], bbox[1]))
        p1 = self.model_to_paper((bbox[2], bbox[3]))
        return bool(float(p0[0]) >= cx0 - 0.5 and float(p0[1]) >= cy0 - 0.5
                    and float(p1[0]) <= cx1 + 0.5 and float(p1[1]) <= cy1 + 0.5)


_SCALE_LADDER = (5, 10, 20, 25, 50, 75, 100, 125, 150, 200, 250, 500, 1000)


def _prim_points(p: Prim) -> List[Point2]:
    if isinstance(p, PolyLine):
        return list(p.points)
    if isinstance(p, Line):
        return [p.a, p.b]
    if isinstance(p, Circle):
        return [(p.center[0] - p.radius, p.center[1] - p.radius),
                (p.center[0] + p.radius, p.center[1] + p.radius)]
    if isinstance(p, Arc):
        return [(p.center[0] - p.radius, p.center[1] - p.radius),
                (p.center[0] + p.radius, p.center[1] + p.radius)]
    if isinstance(p, Text):
        return [p.position]
    if isinstance(p, LinearDim):
        return [p.p1, p.p2]
    if isinstance(p, Hatch):
        return [pt for ring in p.rings for pt in ring]
    return []


# ---------------------------------------------------------------------------
# Marco, cajetin y simbolos de presentacion
# ---------------------------------------------------------------------------


PROJECT_HEADER = {
    "project": "EMBEDVERSE_BUILDING_001",
    "project_name": "Edificio institucional y administrativo de referencia",
    "client": "Administracion - paquete maestro de planos",
    "author": "Generador parametrico EMBEDVERSE (software)",
    "review": "NO REVISADO POR PROFESIONAL COMPETENTE",
}


def draw_frame(sheet: Sheet) -> None:
    w, h = sheet.size_mm
    x0, y0, x1, y1 = sheet.drawing_area_mm
    sheet.add_paper(
        PolyLine("LAM-MARCO", [(MARGIN_MM / 2, MARGIN_MM / 2), (w - MARGIN_MM / 2, MARGIN_MM / 2),
                               (w - MARGIN_MM / 2, h - MARGIN_MM / 2),
                               (MARGIN_MM / 2, h - MARGIN_MM / 2)], closed=True),
        PolyLine("LAM-MARCO", [(x0, y0), (x1, y0), (x1, y1), (x0, y1)], closed=True),
    )
    # marcas de doblado / referencia de borde
    for frac in (0.25, 0.5, 0.75):
        sheet.add_paper(
            Line("LAM-MARCO", (x0 + (x1 - x0) * frac, y0), (x0 + (x1 - x0) * frac, y0 + 3.0)),
            Line("LAM-MARCO", (x0 + (x1 - x0) * frac, y1 - 3.0), (x0 + (x1 - x0) * frac, y1)),
        )


def draw_titleblock(sheet: Sheet) -> None:
    x0, y0, x1, y1 = sheet.drawing_area_mm
    tx1, ty0 = x1, y0
    tx0, ty1 = x1 - TITLEBLOCK_W_MM, y0 + TITLEBLOCK_H_MM

    sheet.add_paper(PolyLine("LAM-CAJETIN", [(tx0, ty0), (tx1, ty0), (tx1, ty1), (tx0, ty1)],
                             closed=True))

    rows = [
        ("PROYECTO", PROJECT_HEADER["project"]),
        ("EDIFICIO", PROJECT_HEADER["project_name"][:46]),
        ("DISCIPLINA", sheet.discipline),
        ("LAMINA", "%s  -  %s" % (sheet.code, sheet.title[:34])),
        ("NIVEL / VISTA", "%s   %s" % (sheet.level_label or "-", sheet.view_kind)),
        ("ESCALA", scale_label(sheet.scale) + "    FORMATO %s" % sheet.paper),
        ("IDENTIFICADOR", sheet.sheet_id),
        ("VERSION", "%s        UNIDADES: metros" % sheet.version),
        ("GENERADO POR", PROJECT_HEADER["author"]),
        ("ESTADO", PROJECT_HEADER["review"]),
    ]
    rh = TITLEBLOCK_H_MM / len(rows)
    for i, (k, v) in enumerate(rows):
        yy = ty1 - (i + 1) * rh
        if i:
            sheet.add_paper(Line("LAM-CAJETIN", (tx0, yy + rh), (tx1, yy + rh)))
        sheet.add_paper(
            Text("LAM-TEXTO", (tx0 + 2.0, yy + rh * 0.30), k, height_mm=1.8),
            Text("LAM-TEXTO", (tx0 + 40.0, yy + rh * 0.30), v, height_mm=2.1),
        )
    sheet.add_paper(Line("LAM-CAJETIN", (tx0 + 38.0, ty0), (tx0 + 38.0, ty1)))

    # Aviso permanente de alcance
    sheet.add_paper(Text(
        "LAM-TEXTO", (x0 + 3.0, y0 + 3.0),
        "DOCUMENTO CONCEPTUAL GENERADO AUTOMATICAMENTE. SIN CALCULO DE INGENIERIA NI "
        "REVISION PROFESIONAL. NO APTO PARA CONSTRUCCION.",
        height_mm=2.4))


def draw_sheet_header(sheet: Sheet) -> None:
    x0, y0, x1, y1 = sheet.drawing_area_mm
    sheet.add_paper(
        Text("LAM-TEXTO", (x0 + 3.0, y1 - 7.0), sheet.title.upper(), height_mm=5.0),
    )
    if sheet.subtitle:
        sheet.add_paper(Text("LAM-TEXTO", (x0 + 3.0, y1 - 13.0), sheet.subtitle, height_mm=2.6))


def draw_legend(sheet: Sheet) -> None:
    if not sheet.legend:
        return
    x0, y0, x1, y1 = sheet.drawing_area_mm
    bw, rh = 86.0, 4.6
    bh = rh * (len(sheet.legend) + 1) + 3.0
    lx = x0 + 2.0
    ly = y0 + TITLEBLOCK_H_MM + 4.0
    sheet.add_paper(
        PolyLine("LAM-LEYENDA", [(lx, ly), (lx + bw, ly), (lx + bw, ly + bh), (lx, ly + bh)],
                 closed=True),
        Text("LAM-TEXTO", (lx + 2.0, ly + bh - 4.2), "LEYENDA", height_mm=2.6),
    )
    for i, (sym, desc) in enumerate(sheet.legend):
        yy = ly + bh - 4.2 - (i + 1) * rh
        sheet.add_paper(
            Text("LAM-TEXTO", (lx + 2.5, yy), sym, height_mm=2.1),
            Text("LAM-TEXTO", (lx + 22.0, yy), desc[:56], height_mm=2.1),
        )


def draw_notes(sheet: Sheet) -> None:
    if not sheet.notes:
        return
    x0, y0, x1, y1 = sheet.drawing_area_mm
    nx = x1 - TITLEBLOCK_W_MM + 2.0
    ny = y0 + TITLEBLOCK_H_MM + 6.0
    sheet.add_paper(Text("LAM-TEXTO", (nx, ny + 4.4 * (len(sheet.notes) + 1)),
                         "NOTAS", height_mm=2.6))
    for i, n in enumerate(sheet.notes):
        sheet.add_paper(Text("LAM-TEXTO", (nx, ny + 4.4 * (len(sheet.notes) - i - 1)),
                             "%d. %s" % (i + 1, n[:96]), height_mm=2.0))


def draw_north(sheet: Sheet) -> None:
    if not sheet.show_north:
        return
    x0, y0, x1, y1 = sheet.drawing_area_mm
    cx, cy, r = x1 - 20.0, y1 - 24.0, 9.0
    sheet.add_paper(
        Circle("LAM-NORTE", (cx, cy), r),
        PolyLine("LAM-NORTE", [(cx, cy + r), (cx - r * 0.34, cy - r * 0.55),
                               (cx, cy - r * 0.22), (cx + r * 0.34, cy - r * 0.55)],
                 closed=True),
        Text("LAM-NORTE", (cx, cy + r + 2.2), "N", height_mm=3.2, anchor="center"),
    )


def scale_label(scale: int) -> str:
    return "SIN ESCALA" if scale <= 1 else "1:%d" % scale


def finish(sheet: Sheet, rescale: bool = True) -> Sheet:
    """Ajusta la vista y dibuja todos los elementos de presentacion."""
    sheet.fit(allow_rescale=rescale)
    draw_frame(sheet)
    draw_sheet_header(sheet)
    draw_legend(sheet)
    draw_notes(sheet)
    draw_north(sheet)
    draw_titleblock(sheet)
    return sheet


# ---------------------------------------------------------------------------
# Expansion de cotas a geometria explicita
# ---------------------------------------------------------------------------


def expand_dim(d: LinearDim, scale: int) -> List[Prim]:
    """Convierte una cota en lineas y texto explicitos.

    Se expande antes de exportar para que DXF, PDF y SVG contengan exactamente
    la misma geometria y el mismo valor numerico. El valor se mide sobre las
    coordenadas del modelo, no se escribe a mano.
    """
    mm = lambda v: v * scale / 1000.0
    (x1, y1), (x2, y2) = d.p1, d.p2
    tick = mm(1.4)
    ext = mm(1.6)
    out: List[Prim] = []

    if d.direction == "h":
        value = abs(x2 - x1)
        yl = y1 + d.offset
        a, b = (min(x1, x2), yl), (max(x1, x2), yl)
        out.append(Line(d.layer, a, b))
        out.append(Line(d.layer, (x1, y1), (x1, yl + (ext if d.offset < 0 else -ext))))
        out.append(Line(d.layer, (x2, y2), (x2, yl + (ext if d.offset < 0 else -ext))))
        for px in (x1, x2):
            out.append(Line(d.layer, (px - tick, yl - tick), (px + tick, yl + tick)))
        label = d.override_text or ("%.2f" % value)
        out.append(Text(d.layer, ((x1 + x2) / 2.0, yl + mm(0.9)), label,
                        height_mm=d.text_height_mm, anchor="center"))
    else:
        value = abs(y2 - y1)
        xl = x1 + d.offset
        a, b = (xl, min(y1, y2)), (xl, max(y1, y2))
        out.append(Line(d.layer, a, b))
        out.append(Line(d.layer, (x1, y1), (xl + (ext if d.offset < 0 else -ext), y1)))
        out.append(Line(d.layer, (x2, y2), (xl + (ext if d.offset < 0 else -ext), y2)))
        for py in (y1, y2):
            out.append(Line(d.layer, (xl - tick, py - tick), (xl + tick, py + tick)))
        label = d.override_text or ("%.2f" % value)
        out.append(Text(d.layer, (xl - mm(0.9), (y1 + y2) / 2.0), label,
                        height_mm=d.text_height_mm, rotation=90.0, anchor="center"))
    return out


def flatten(prims: Sequence[Prim], scale: int) -> List[Prim]:
    """Expande cotas y deja solo primitivas basicas."""
    out: List[Prim] = []
    for p in prims:
        if isinstance(p, LinearDim):
            out.extend(expand_dim(p, scale))
        else:
            out.append(p)
    return out


# ---------------------------------------------------------------------------
# Tablas (cuadros) en espacio papel
# ---------------------------------------------------------------------------


def draw_table(
    sheet: Sheet, headers: Sequence[str], rows: Sequence[Sequence[str]],
    col_widths_mm: Sequence[float], origin_mm: Point2, row_h_mm: float = 5.0,
    title: Optional[str] = None, max_rows: Optional[int] = None,
) -> float:
    """Dibuja una tabla en espacio papel. Devuelve la altura ocupada en mm."""
    x0, y_top = origin_mm
    total_w = float(sum(col_widths_mm))
    shown = list(rows) if max_rows is None else list(rows[:max_rows])
    truncated = max_rows is not None and len(rows) > max_rows

    y = y_top
    if title:
        sheet.add_paper(Text("LAM-TEXTO", (x0, y - 3.4), title, height_mm=3.0))
        y -= 6.5

    # cabecera
    sheet.add_paper(PolyLine("LAM-TABLA", [(x0, y - row_h_mm), (x0 + total_w, y - row_h_mm),
                                           (x0 + total_w, y), (x0, y)], closed=True))
    cx = x0
    for h, w in zip(headers, col_widths_mm):
        sheet.add_paper(Text("LAM-TEXTO", (cx + 1.2, y - row_h_mm + 1.5), str(h)[:int(w / 1.35)],
                             height_mm=1.9))
        cx += w
        if cx < x0 + total_w - 0.01:
            sheet.add_paper(Line("LAM-TABLA", (cx, y - row_h_mm), (cx, y)))
    y -= row_h_mm

    for r in shown:
        sheet.add_paper(PolyLine("LAM-TABLA", [(x0, y - row_h_mm), (x0 + total_w, y - row_h_mm),
                                               (x0 + total_w, y), (x0, y)], closed=True))
        cx = x0
        for cell, w in zip(r, col_widths_mm):
            txt = "-" if cell is None else str(cell)
            sheet.add_paper(Text("LAM-TEXTO", (cx + 1.2, y - row_h_mm + 1.5),
                                 txt[:int(w / 1.30)], height_mm=1.8))
            cx += w
            if cx < x0 + total_w - 0.01:
                sheet.add_paper(Line("LAM-TABLA", (cx, y - row_h_mm), (cx, y)))
        y -= row_h_mm

    if truncated:
        sheet.add_paper(Text(
            "LAM-TEXTO", (x0, y - 4.0),
            "Tabla abreviada en lamina: se muestran %d de %d filas. El listado completo "
            "esta en el CSV y el JSON del paquete." % (len(shown), len(rows)),
            height_mm=2.0))
        y -= 6.0
    return y_top - y
