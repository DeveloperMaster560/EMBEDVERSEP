"""Parametros del edificio de referencia EMBEDVERSE_BUILDING_001.

Fuente unica de verdad dimensional. Todo el modelo 3D, los planos y el dataset
se derivan de este modulo. Ningun otro archivo debe declarar dimensiones.

ESTADO DE LOS VALORES
---------------------
Cada parametro declara su procedencia mediante el prefijo de su constante:

  REQ_*   valor entregado por la solicitud de la administracion.
  HYP_*   hipotesis geometrica conceptual adoptada para poder construir el
          modelo. No proviene de calculo ni de norma. Debe revisarla un
          profesional competente antes de cualquier uso constructivo.

No existen en este modulo resultados de calculo estructural, electrico,
hidraulico ni termico. Los parametros que requieren calculo se registran como
None en el catalogo de componentes y aparecen en PENDING_PARAMETERS.
"""

from __future__ import annotations

# ---------------------------------------------------------------------------
# Identidad del proyecto
# ---------------------------------------------------------------------------

PROJECT_ID = "EMBEDVERSE_BUILDING_001"
PROJECT_NAME = "Edificio institucional y administrativo de referencia"
PROJECT_VERSION = "1.0.0"
DATASET_SCHEMA_VERSION = "embedverse-building-dataset/1.0"
UNITS_LENGTH = "m"
UNITS_ANGLE = "deg"
NORTH_ANGLE_DEG = 0.0  # +Y del modelo apunta al norte del proyecto.

# ---------------------------------------------------------------------------
# REQ_* — parametros entregados en la solicitud
# ---------------------------------------------------------------------------

REQ_BUILDING_USE = "institucional-administrativo"
REQ_LEVEL_COUNT = 3
REQ_LENGTH_X = 24.0          # m, longitud
REQ_WIDTH_Y = 18.0           # m, ancho
REQ_CLEAR_HEIGHT = 3.20      # m, altura libre por piso
REQ_FLOOR_TO_FLOOR = 3.60    # m, altura entre niveles
REQ_AREA_PER_LEVEL = 432.0   # m2 declarados (24 x 18)
REQ_TOTAL_AREA = 1296.0      # m2 declarados (432 x 3)
REQ_STRUCTURAL_SYSTEM = "porticos de concreto armado (hipotesis conceptual)"
REQ_ROOF = "losa superior"
REQ_STAIR_POSITION = "nucleo central"

# ---------------------------------------------------------------------------
# HYP_* — hipotesis geometricas conceptuales
# ---------------------------------------------------------------------------

# Canto total del conjunto viga+losa. Se adopta para que la altura libre bajo
# viga coincida exactamente con REQ_CLEAR_HEIGHT:
#   3.60 (entre niveles) - 0.40 (canto) = 3.20 (libre bajo viga)
HYP_STRUCTURAL_DEPTH = 0.40
HYP_SLAB_THICKNESS = 0.12
HYP_BEAM_WIDTH = 0.30
HYP_BEAM_DEPTH = HYP_STRUCTURAL_DEPTH          # 0.40, medido desde cara superior de losa
HYP_COLUMN_SIZE = (0.40, 0.40)

# Cimentacion conceptual. Sin estudio de suelos no hay dimension valida.
HYP_FOOTING_PLAN = (1.60, 1.60)
HYP_FOOTING_THICKNESS = 0.40
HYP_FOOTING_TOP_LEVEL = -1.20
HYP_PEDESTAL_SIZE = (0.50, 0.50)

# Muros
HYP_WALL_EXTERIOR = 0.25
HYP_WALL_INTERIOR = 0.10
HYP_WALL_CORE = 0.20
HYP_PARAPET_HEIGHT = 1.00
HYP_PARAPET_THICKNESS = 0.20

# Nucleo central de escaleras: 6.00 x 6.00 centrado en la planta.
HYP_CORE_SIZE = (6.00, 6.00)

# Escalera de dos tramos con descanso intermedio.
#   20 contrahuellas x 0.180 = 3.600 m = REQ_FLOOR_TO_FLOOR  (exacto)
#   9 huellas por tramo x 0.280 = 2.520 m de desarrollo por tramo
HYP_STAIR_RISER = 0.180
HYP_STAIR_TREAD = 0.280
HYP_STAIR_RISERS_PER_FLIGHT = 10
HYP_STAIR_FLIGHTS_PER_LEVEL = 2
HYP_STAIR_FLIGHT_WIDTH = 1.50
HYP_STAIR_LANDING_DEPTH = 1.40
HYP_STAIR_SLAB_THICKNESS = 0.15

# Carpinteria
HYP_DOOR_HEIGHT = 2.10
HYP_DOOR_WIDTH_OFFICE = 0.90
HYP_DOOR_WIDTH_BATH = 0.80
HYP_DOOR_WIDTH_TECH = 0.90
HYP_DOOR_WIDTH_DOUBLE = 1.80
HYP_DOOR_LEAF_THICKNESS = 0.045
HYP_WINDOW_SILL = 0.90
HYP_WINDOW_HEIGHT = 1.50
HYP_WINDOW_MODULE = 1.80
HYP_FRAME_DEPTH = 0.06

# Circulacion
HYP_CORRIDOR_WIDTH = 2.00
HYP_PERIMETER_BAND_SOUTH = 3.75   # profundidad de la franja de recintos sur
HYP_PERIMETER_BAND_NORTH = 3.75
HYP_PERIMETER_BAND_WEST = 6.75
HYP_PERIMETER_BAND_EAST = 6.75

# Cielo tecnico: vacio entre el cielo raso y el fondo de viga (3.20 m) para el
# paso de instalaciones.
HYP_CEILING_HEIGHT = 2.55        # cara inferior de cielo raso sobre nivel de piso
HYP_PLENUM_ROUTING_Z = 2.68      # cota de referencia del vacio tecnico

# Cada disciplina recorre el vacio tecnico a una cota distinta, para que los
# trazados horizontales no se invadan entre si. El orden es el habitual en
# obra: los ductos, que son los elementos de mayor seccion, van pegados al
# fondo de viga, y debajo bajan las tuberias, la bandeja electrica y los
# cableados debiles.
#
#   fondo de viga            3.20
#   ductos de climatizacion  3.01   (seccion maxima 0.50 x 0.30 -> 2.86 .. 3.16)
#   tuberia hidrosanitaria   2.80   (diametro maximo 0.102   -> 2.749 .. 2.851)
#   bandeja y conduit        2.68   (bandeja 0.30 x 0.10     -> 2.63  .. 2.73)
#   cableado de datos        2.60   (conduit 0.025           -> 2.587 .. 2.613)
#   cableado de seguridad    2.57   (conduit 0.013           -> 2.564 .. 2.576)
#   cielo raso               2.55
HYP_ROUTING_Z = {
    "hvac": 3.01,
    "hydrosanitary": 2.80,
    "electrical": 2.68,
    "telecommunications": 2.60,
    "security": 2.57,
}

# ---------------------------------------------------------------------------
# Catalogo de tipos de recinto
# ---------------------------------------------------------------------------
# Anchos de referencia para repartir una banda. Son criterios de reparto
# GEOMETRICO, no superficies minimas normativas: el area util por puesto y el
# aforo dependen de la norma aplicable y quedan como parametros pendientes.

ROOM_TYPES = {
    "recepcion":        {"min_w": 4.0, "target_w": 7.5, "max_w": 12.0, "label": "Recepcion"},
    "oficina":          {"min_w": 3.0, "target_w": 4.5, "max_w": 6.5,  "label": "Oficina"},
    "sala_reuniones":   {"min_w": 4.0, "target_w": 5.5, "max_w": 8.0,  "label": "Sala de reuniones"},
    "sala_juntas":      {"min_w": 5.0, "target_w": 6.8, "max_w": 10.0, "label": "Sala de juntas"},
    "bano":             {"min_w": 2.6, "target_w": 3.0, "max_w": 4.0,  "label": "Bano"},
    "aseo":             {"min_w": 1.6, "target_w": 2.0, "max_w": 2.6,  "label": "Cuarto de aseo"},
    "cuarto_electrico": {"min_w": 2.8, "target_w": 3.5, "max_w": 4.5,  "label": "Cuarto electrico"},
    "cuarto_telecom":   {"min_w": 2.5, "target_w": 3.0, "max_w": 4.0,  "label": "Cuarto de telecomunicaciones"},
    "cuarto_hvac":      {"min_w": 2.5, "target_w": 3.0, "max_w": 4.5,  "label": "Cuarto tecnico de climatizacion"},
    "zona_tecnica":     {"min_w": 2.5, "target_w": 4.0, "max_w": 6.0,  "label": "Zona tecnica"},
    "archivo":          {"min_w": 2.0, "target_w": 2.8, "max_w": 4.5,  "label": "Archivo"},
    "laboratorio":      {"min_w": 4.0, "target_w": 6.0, "max_w": 9.0,  "label": "Laboratorio"},
    "aula":             {"min_w": 5.0, "target_w": 7.0, "max_w": 10.0, "label": "Aula"},
    "deposito":         {"min_w": 2.0, "target_w": 3.0, "max_w": 5.0,  "label": "Deposito"},
}

BANDS = ("SOUTH", "NORTH", "WEST", "EAST")

# Recinto que ocupa el ultimo lugar libre de la banda cuando sobra longitud.
FILLER_USE = "oficina"

# Geometria minima para que el nucleo, el anillo de circulacion y las bandas
# de recintos quepan a la vez.
MIN_FOOTPRINT_X = 15.0
MIN_FOOTPRINT_Y = 15.0
MIN_BAND_DEPTH = 2.40

# ---------------------------------------------------------------------------
# Vivienda (casa unifamiliar)
# ---------------------------------------------------------------------------
# La tipologia de oficinas (nucleo central rodeado por un anillo de
# circulacion y cuatro bandas de recintos) no cabe en una casa: con una
# escalera de dos tramos, dos pasillos y dos bandas utiles necesita al menos
# 15 m de lado. Una vivienda se resuelve con OTRA topologia:
#
#     +------------------------------------------+  INNER_Y1
#     | nucleo  |  banda NORTE (recintos)        |
#     | escalera|                                |
#     +---------+--------------------------------+  RING_Y1 = CORE_Y0
#     |  pasillo (circulacion, de fachada a fachada)
#     +------------------------------------------+  RING_Y0
#     |  banda SUR (recintos)                    |
#     +------------------------------------------+  INNER_Y0
#
# No hay bandas oeste ni este. El nucleo de la escalera ocupa el arranque de
# la banda norte y abre al pasillo por su muro sur.
#
# Los valores siguientes son HIPOTESIS geometricas conceptuales de vivienda,
# no requisitos de una norma: ancho de tramo, muros y pasillo deben
# verificarse con la norma aplicable antes de cualquier uso constructivo.
RESIDENTIAL_USES = ("vivienda", "residencial", "vivienda-unifamiliar")
HYP_RESIDENTIAL = {
    "HYP_WALL_EXTERIOR": 0.15,
    "HYP_WALL_INTERIOR": 0.10,
    "HYP_WALL_CORE": 0.12,
    "HYP_COLUMN_SIZE": (0.30, 0.30),
    "HYP_STAIR_FLIGHT_WIDTH": 0.90,
    "HYP_STAIR_LANDING_DEPTH": 0.90,
    # El pasillo aloja el ducto tecnico (1.40 x 0.80 m con 0.20 m de holgura),
    # de ahi su ancho; no es un minimo normativo de circulacion.
    "HYP_CORRIDOR_WIDTH": 1.20,
}
# Zona libre delante del arranque de la escalera, dentro del nucleo.
HYP_RESIDENTIAL_STAIR_ARRIVAL = 0.90

# Recintos de vivienda. Igual que ROOM_TYPES: anchos de reparto GEOMETRICO,
# no superficies minimas normativas.
RESIDENTIAL_ROOM_TYPES = {
    "sala":        {"min_w": 3.0, "target_w": 4.5, "max_w": 7.0, "label": "Sala"},
    "comedor":     {"min_w": 2.7, "target_w": 3.5, "max_w": 5.5, "label": "Comedor"},
    "cocina":      {"min_w": 2.4, "target_w": 3.0, "max_w": 4.5, "label": "Cocina"},
    "dormitorio":  {"min_w": 2.7, "target_w": 3.3, "max_w": 5.0, "label": "Habitacion"},
    "bano":        {"min_w": 1.6, "target_w": 2.0, "max_w": 3.0, "label": "Bano"},
    "estudio":     {"min_w": 2.4, "target_w": 3.0, "max_w": 4.5, "label": "Estudio"},
    "lavanderia":  {"min_w": 1.6, "target_w": 2.0, "max_w": 3.0, "label": "Zona de ropas"},
    # Lo que sobra de una banda sin programa pedido. NO es un recinto
    # inventado: se rotula como espacio sin uso asignado.
    "espacio_libre": {"min_w": 1.0, "target_w": 4.0, "max_w": 99.0,
                      "label": "Espacio sin uso asignado"},
}
# Zona dia en el nivel de acceso; zona noche en los superiores. Es un
# criterio de reparto declarado, no una regla de diseno.
RESIDENTIAL_DAY_USES = ("sala", "comedor", "cocina", "lavanderia")
RESIDENTIAL_PROGRAM: dict = {}

# ---------------------------------------------------------------------------
# Valores derivados
# ---------------------------------------------------------------------------
# Todo lo que sigue se RECALCULA desde los parametros REQ_* y HYP_*. No hay
# tablas fijas: cambiar la solicitud cambia la rejilla, los niveles, la
# zonificacion y el programa de recintos. `apply_spec()` es el unico punto de
# entrada para modificar la solicitud.

GRID_X_LABELS: tuple = ()
GRID_Y_LABELS: tuple = ()
GRID_X: tuple = ()
GRID_Y: tuple = ()
LEVELS: tuple = ()
ROOF_LEVEL: dict = {}
FOUNDATION_LEVEL: dict = {}
ALL_LEVELS: tuple = ()
CORE_X0 = CORE_X1 = CORE_Y0 = CORE_Y1 = 0.0
RING_X0 = RING_X1 = RING_Y0 = RING_Y1 = 0.0
INNER_X0 = INNER_X1 = INNER_Y0 = INNER_Y1 = 0.0
BAND_SOUTH: tuple = ()
BAND_NORTH: tuple = ()
BAND_WEST: tuple = ()
BAND_EAST: tuple = ()
SPACE_PROGRAM: dict = {}
WET_SPACES: dict = {}
SPEC_ADJUSTMENTS: list = []
PROGRAM_REQUEST: dict = {}

_GRID_LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ"   # sin I ni O, como es habitual en planos


def is_residential() -> bool:
    return str(REQ_BUILDING_USE).lower() in RESIDENTIAL_USES


def room_type(use: str) -> dict:
    """Ficha de reparto de un uso de recinto en la tipologia vigente."""
    if is_residential() and use in RESIDENTIAL_ROOM_TYPES:
        return RESIDENTIAL_ROOM_TYPES[use]
    return ROOM_TYPES[use]


def _level_elevation(index: int) -> float:
    """Cota de acabado de piso del nivel `index` (1-based)."""
    return round((index - 1) * REQ_FLOOR_TO_FLOOR, 3)


def _grid_axis(total: float, target_bay: float = 6.0):
    """Reparte el lado en vanos lo mas proximos posible a `target_bay`."""
    bays = max(1, int(round(total / target_bay)))
    step = total / bays
    return tuple(round(i * step, 4) for i in range(bays + 1))


def _recompute_grid() -> None:
    global GRID_X, GRID_Y, GRID_X_LABELS, GRID_Y_LABELS
    GRID_X = _grid_axis(REQ_LENGTH_X)
    GRID_Y = _grid_axis(REQ_WIDTH_Y)
    GRID_X_LABELS = tuple(str(i + 1) for i in range(len(GRID_X)))
    GRID_Y_LABELS = tuple(_GRID_LETTERS[i % len(_GRID_LETTERS)] for i in range(len(GRID_Y)))


def _recompute_levels() -> None:
    global LEVELS, ROOF_LEVEL, FOUNDATION_LEVEL, ALL_LEVELS
    LEVELS = tuple(
        {
            "level_id": "N%d" % i,
            "name": "Nivel %d" % i,
            "index": i,
            "elevation": _level_elevation(i),
            "floor_to_floor": REQ_FLOOR_TO_FLOOR,
            "clear_height": REQ_CLEAR_HEIGHT,
            "slab_soffit": round(_level_elevation(i) + REQ_FLOOR_TO_FLOOR - HYP_SLAB_THICKNESS, 3),
        }
        for i in range(1, REQ_LEVEL_COUNT + 1)
    )
    ROOF_LEVEL = {
        "level_id": "NC",
        "name": "Cubierta",
        "index": REQ_LEVEL_COUNT + 1,
        "elevation": _level_elevation(REQ_LEVEL_COUNT + 1),
        "floor_to_floor": None,
        "clear_height": None,
        "slab_soffit": None,
    }
    FOUNDATION_LEVEL = {
        "level_id": "NF",
        "name": "Cimentacion (conceptual)",
        "index": 0,
        "elevation": HYP_FOOTING_TOP_LEVEL,
    }
    ALL_LEVELS = LEVELS + (ROOF_LEVEL,)


def _recompute_zoning() -> None:
    """Nucleo centrado, anillo de circulacion y bandas perimetrales de recintos."""
    global CORE_X0, CORE_X1, CORE_Y0, CORE_Y1
    global RING_X0, RING_X1, RING_Y0, RING_Y1
    global INNER_X0, INNER_X1, INNER_Y0, INNER_Y1
    global BAND_SOUTH, BAND_NORTH, BAND_WEST, BAND_EAST
    global HYP_PERIMETER_BAND_SOUTH, HYP_PERIMETER_BAND_NORTH
    global HYP_PERIMETER_BAND_WEST, HYP_PERIMETER_BAND_EAST

    ew = HYP_WALL_EXTERIOR
    if is_residential():
        _recompute_zoning_residential()
        return
    CORE_X0 = round((REQ_LENGTH_X - HYP_CORE_SIZE[0]) / 2.0, 3)
    CORE_X1 = round(CORE_X0 + HYP_CORE_SIZE[0], 3)
    CORE_Y0 = round((REQ_WIDTH_Y - HYP_CORE_SIZE[1]) / 2.0, 3)
    CORE_Y1 = round(CORE_Y0 + HYP_CORE_SIZE[1], 3)

    RING_X0 = round(CORE_X0 - HYP_CORRIDOR_WIDTH, 3)
    RING_X1 = round(CORE_X1 + HYP_CORRIDOR_WIDTH, 3)
    RING_Y0 = round(CORE_Y0 - HYP_CORRIDOR_WIDTH, 3)
    RING_Y1 = round(CORE_Y1 + HYP_CORRIDOR_WIDTH, 3)

    INNER_X0 = round(ew, 3)
    INNER_X1 = round(REQ_LENGTH_X - ew, 3)
    INNER_Y0 = round(ew, 3)
    INNER_Y1 = round(REQ_WIDTH_Y - ew, 3)

    BAND_SOUTH = (INNER_X0, INNER_Y0, INNER_X1, RING_Y0)
    BAND_NORTH = (INNER_X0, RING_Y1, INNER_X1, INNER_Y1)
    BAND_WEST = (INNER_X0, RING_Y0, RING_X0, RING_Y1)
    BAND_EAST = (RING_X1, RING_Y0, INNER_X1, RING_Y1)

    HYP_PERIMETER_BAND_SOUTH = round(RING_Y0 - INNER_Y0, 3)
    HYP_PERIMETER_BAND_NORTH = round(INNER_Y1 - RING_Y1, 3)
    HYP_PERIMETER_BAND_WEST = round(RING_X0 - INNER_X0, 3)
    HYP_PERIMETER_BAND_EAST = round(INNER_X1 - RING_X1, 3)


def residential_band_depths() -> tuple:
    """Fondos (sur, norte) de las bandas de una vivienda.

    El norte debe alojar el nucleo de la escalera; el resto se reparte a
    partes iguales, sin bajar ninguna banda de MIN_BAND_DEPTH.
    """
    inner = REQ_WIDTH_Y - 2 * HYP_WALL_EXTERIOR - HYP_CORRIDOR_WIDTH
    north = max(HYP_CORE_SIZE[1], inner / 2.0)
    south = inner - north
    return round(south, 4), round(north, 4)


def _recompute_zoning_residential() -> None:
    global CORE_X0, CORE_X1, CORE_Y0, CORE_Y1
    global RING_X0, RING_X1, RING_Y0, RING_Y1
    global INNER_X0, INNER_X1, INNER_Y0, INNER_Y1
    global BAND_SOUTH, BAND_NORTH, BAND_WEST, BAND_EAST
    global HYP_PERIMETER_BAND_SOUTH, HYP_PERIMETER_BAND_NORTH
    global HYP_PERIMETER_BAND_WEST, HYP_PERIMETER_BAND_EAST

    ew = HYP_WALL_EXTERIOR
    INNER_X0 = round(ew, 3)
    INNER_X1 = round(REQ_LENGTH_X - ew, 3)
    INNER_Y0 = round(ew, 3)
    INNER_Y1 = round(REQ_WIDTH_Y - ew, 3)
    south, _north = residential_band_depths()

    RING_X0, RING_X1 = INNER_X0, INNER_X1
    RING_Y0 = round(INNER_Y0 + south, 3)
    RING_Y1 = round(RING_Y0 + HYP_CORRIDOR_WIDTH, 3)

    CORE_X0 = INNER_X0
    CORE_X1 = round(INNER_X0 + HYP_CORE_SIZE[0], 3)
    CORE_Y0 = RING_Y1
    CORE_Y1 = INNER_Y1

    BAND_SOUTH = (INNER_X0, INNER_Y0, INNER_X1, RING_Y0)
    BAND_NORTH = (CORE_X1, RING_Y1, INNER_X1, INNER_Y1)
    # Sin bandas laterales: rectangulos de ancho nulo sobre la fachada.
    BAND_WEST = (INNER_X0, RING_Y0, INNER_X0, RING_Y1)
    BAND_EAST = (INNER_X1, RING_Y0, INNER_X1, RING_Y1)

    HYP_PERIMETER_BAND_SOUTH = round(RING_Y0 - INNER_Y0, 3)
    HYP_PERIMETER_BAND_NORTH = round(INNER_Y1 - RING_Y1, 3)
    HYP_PERIMETER_BAND_WEST = 0.0
    HYP_PERIMETER_BAND_EAST = 0.0


def bands_in_use() -> tuple:
    return ("SOUTH", "NORTH") if is_residential() else BANDS


def band_span(band: str):
    """Intervalo util de una banda sobre su eje largo: (inicio, fin)."""
    x0, y0, x1, y1 = band_rect(band)
    return (x0, x1) if band in ("SOUTH", "NORTH") else (y0, y1)


# ---------------------------------------------------------------------------
# Programa de espacios procedural
# ---------------------------------------------------------------------------


def _fixed_rooms(level_index: int, band: str, is_top: bool) -> list:
    """Recintos de posicion obligada en una banda y nivel.

    Los nucleos humedos se repiten en la misma banda en todos los niveles para
    que los montantes sanitarios queden alineados en vertical. Los cuartos
    tecnicos de acometida van en el nivel de acceso.
    """
    out = []
    if band == "NORTH":
        out += [("bano", "Bano mujeres"), ("bano", "Bano hombres"), ("aseo", None)]
    if band == "WEST":
        if level_index == 1:
            out += [("cuarto_electrico", None), ("cuarto_telecom", None)]
        else:
            out += [("sala_reuniones", None)]
    if band == "EAST":
        out += [("archivo", None)]
        if is_top:
            out += [("cuarto_hvac", None)]
    if band == "SOUTH":
        if level_index == 1:
            out += [("recepcion", None), ("sala_reuniones", None)]
        elif is_top:
            out += [("sala_juntas", None)]
        else:
            out += [("sala_reuniones", None)]
    return out


def _distribute_band(band: str, level_index: int, is_top: bool,
                     requested: dict, adjustments: list) -> list:
    """Reparte los recintos de una banda sobre su longitud util.

    Primero se colocan los recintos obligados con su ancho de referencia; la
    longitud restante se reparte entre recintos de relleno del mismo ancho,
    acotado por el minimo y el maximo del tipo. Si no cabe ni un recinto, la
    banda se deja como circulacion y se anota el ajuste.
    """
    start, end = band_span(band)
    length = end - start
    if length < ROOM_TYPES[FILLER_USE]["min_w"]:
        adjustments.append(
            "La banda %s del nivel %d mide %.2f m y no admite recintos; queda libre."
            % (band, level_index, length))
        return []

    planned = []
    for use, label in _fixed_rooms(level_index, band, is_top):
        planned.append({"use": use, "label": label, "w": ROOM_TYPES[use]["target_w"]})

    # Recintos adicionales pedidos explicitamente para esta banda.
    for use, count in requested.get(band, {}).items():
        for _ in range(count):
            planned.append({"use": use, "label": None, "w": ROOM_TYPES[use]["target_w"]})

    fixed_w = sum(p["w"] for p in planned)
    if fixed_w > length:
        # No caben todos: se recortan al minimo y, si aun no caben, se eliminan.
        for p in planned:
            p["w"] = ROOM_TYPES[p["use"]]["min_w"]
        while planned and sum(p["w"] for p in planned) > length:
            dropped = planned.pop()
            adjustments.append(
                "No cabe %s en la banda %s del nivel %d; se omite."
                % (dropped["use"], band, level_index))
        fixed_w = sum(p["w"] for p in planned)

    remaining = length - fixed_w
    filler = ROOM_TYPES[FILLER_USE]
    # Se busca el numero de recintos de relleno cuyo ancho quede mas cerca del
    # ancho de referencia, sin salirse del minimo ni del maximo del tipo.
    n_filler = max(0, int(round(remaining / filler["target_w"])))
    while n_filler > 0 and remaining / n_filler < filler["min_w"]:
        n_filler -= 1
    while n_filler > 0 and remaining / n_filler > filler["max_w"]:
        n_filler += 1
    if n_filler > 0:
        width = remaining / n_filler
        for _ in range(n_filler):
            planned.append({"use": FILLER_USE, "label": None, "w": width})
    elif remaining > 0.01 and planned:
        # El sobrante se reparte entre los recintos ya planificados.
        extra = remaining / len(planned)
        for p in planned:
            p["w"] = min(p["w"] + extra, ROOM_TYPES[p["use"]]["max_w"])

    # Ajuste final para que la suma cierre exactamente con la longitud.
    total = sum(p["w"] for p in planned)
    if planned and abs(total - length) > 1e-6:
        planned[-1]["w"] += length - total

    cursor = start
    laid = []
    for p in planned:
        w = p["w"]
        laid.append({"use": p["use"], "label": p["label"],
                     "start": round(cursor, 4), "end": round(cursor + w, 4)})
        cursor += w
    return laid


def residential_level_program() -> dict:
    """Reparte el programa de la vivienda entre niveles.

    Zona dia (sala, comedor, cocina, ropas) en el nivel de acceso; habitaciones
    y estudios en los superiores, a partes iguales. Los banos: uno en el
    acceso si hay mas de un nivel, el resto con las habitaciones. En una casa
    de un nivel todo va en el nivel 1. Solo se reparte lo pedido.
    """
    req = {k: int(v) for k, v in RESIDENTIAL_PROGRAM.items() if int(v) > 0}
    levels = [lv["index"] for lv in LEVELS]
    out = {i: [] for i in levels}
    if len(levels) == 1:
        for use in ("sala", "comedor", "cocina", "lavanderia", "dormitorio",
                    "estudio", "bano"):
            out[1] += [use] * req.get(use, 0)
        return out
    for use in RESIDENTIAL_DAY_USES:
        out[1] += [use] * req.get(use, 0)
    banos = req.get("bano", 0)
    if banos:
        out[1].append("bano")
        banos -= 1
    upper = levels[1:]
    night = (["dormitorio"] * req.get("dormitorio", 0)
             + ["estudio"] * req.get("estudio", 0)
             + ["bano"] * banos)
    for k, use in enumerate(night):
        out[upper[k % len(upper)]].append(use)
    return out


def _lay_band(band: str, uses: list) -> list:
    """Coloca recintos en una banda: ancho proporcional al de referencia.

    Lo que sobra queda como `espacio_libre`, rotulado como tal; no se
    convierte en un recinto que nadie pidio.
    """
    start, end = band_span(band)
    length = end - start
    if not uses:
        return [{"use": "espacio_libre", "label": None,
                 "start": round(start, 4), "end": round(end, 4)}]
    widths = [room_type(u)["target_w"] for u in uses]
    total = sum(widths)
    if total > length:
        widths = [room_type(u)["min_w"] for u in uses]
        if sum(widths) > length + 1e-6:
            raise SpecError(
                "No caben %s en la banda %s: necesitan al menos %.2f m y la banda "
                "mide %.2f m. Amplia la planta o reparte los recintos en mas niveles."
                % (", ".join(uses), band, sum(widths), length))
        scale = length / sum(widths)
        widths = [w * scale for w in widths]
    else:
        # Se estira cada recinto hasta su maximo; el resto queda libre.
        spare = length - total
        grown = []
        for u, w in zip(uses, widths):
            extra = min(spare / len(uses), room_type(u)["max_w"] - w)
            grown.append(w + max(0.0, extra))
        widths = grown
    laid, cursor = [], start
    for u, w in zip(uses, widths):
        laid.append({"use": u, "label": None,
                     "start": round(cursor, 4), "end": round(cursor + w, 4)})
        cursor += w
    if end - cursor > room_type("espacio_libre")["min_w"]:
        laid.append({"use": "espacio_libre", "label": None,
                     "start": round(cursor, 4), "end": round(end, 4)})
    elif laid:
        laid[-1]["end"] = round(end, 4)
    return laid


def _residential_program_for_level(index: int) -> dict:
    """Asigna los recintos de un nivel a las bandas sur y norte.

    Cada recinto va a la banda con mas longitud libre en ese momento, de
    modo que ninguna se sature mientras la otra queda vacia.
    """
    uses = residential_level_program()[index]
    free = {b: band_span(b)[1] - band_span(b)[0] for b in ("SOUTH", "NORTH")}
    chosen = {"SOUTH": [], "NORTH": []}
    # Los grandes primero: reparto mas equilibrado.
    for use in sorted(uses, key=lambda u: -room_type(u)["target_w"]):
        band = max(free, key=lambda b: free[b])
        chosen[band].append(use)
        free[band] -= room_type(use)["target_w"]
    return {band: _lay_band(band, chosen[band]) for band in ("SOUTH", "NORTH")}


def _recompute_space_program() -> None:
    """Construye SPACE_PROGRAM y WET_SPACES por reglas, no por tabla fija."""
    global SPACE_PROGRAM, WET_SPACES, SPEC_ADJUSTMENTS
    if is_residential():
        _recompute_space_program_residential()
        return
    program = {}
    wet = {}
    adjustments = list(SPEC_ADJUSTMENTS)

    for level in LEVELS:
        idx = level["index"]
        lid = level["level_id"]
        is_top = idx == REQ_LEVEL_COUNT
        rooms = []
        wet_codes = []
        seq = 0
        for band in BANDS:
            for item in _distribute_band(band, idx, is_top, PROGRAM_REQUEST, adjustments):
                seq += 1
                code = "%d%02d" % (idx, seq)
                use = item["use"]
                label = item["label"] or ROOM_TYPES[use]["label"]
                name = "%s %s" % (label, code) if use in ("oficina", "sala_reuniones",
                                                          "sala_juntas", "zona_tecnica",
                                                          "archivo", "laboratorio",
                                                          "aula", "deposito") else label
                rooms.append((code, name, use, band, item["start"], item["end"]))
                if use in ("bano", "aseo"):
                    wet_codes.append(code)
        program[lid] = rooms
        wet[lid] = tuple(wet_codes)

    SPACE_PROGRAM = program
    WET_SPACES = wet
    SPEC_ADJUSTMENTS = adjustments


def _recompute_space_program_residential() -> None:
    global SPACE_PROGRAM, WET_SPACES
    program, wet = {}, {}
    for level in LEVELS:
        idx, lid = level["index"], level["level_id"]
        rooms, wet_codes, seq = [], [], 0
        counters: dict = {}
        for band, laid in _residential_program_for_level(idx).items():
            for item in laid:
                seq += 1
                code = "%d%02d" % (idx, seq)
                use = item["use"]
                counters[use] = counters.get(use, 0) + 1
                label = room_type(use)["label"]
                name = "%s %s" % (label, code)
                rooms.append((code, name, use, band, item["start"], item["end"]))
                if use == "bano":
                    wet_codes.append(code)
        program[lid] = rooms
        wet[lid] = tuple(wet_codes)
    SPACE_PROGRAM = program
    WET_SPACES = wet


def _validate() -> None:
    """Comprobaciones de coherencia. Fallan ruidosamente, no en silencio."""
    assert abs(REQ_FLOOR_TO_FLOOR - HYP_STRUCTURAL_DEPTH - REQ_CLEAR_HEIGHT) < 1e-9, (
        "La altura libre no es coherente con la altura entre niveles y el canto.")
    assert abs(
        HYP_STAIR_RISER * HYP_STAIR_RISERS_PER_FLIGHT * HYP_STAIR_FLIGHTS_PER_LEVEL
        - REQ_FLOOR_TO_FLOOR
    ) < 1e-9, "Las contrahuellas no suman la altura entre niveles."
    assert abs(REQ_LENGTH_X * REQ_WIDTH_Y - REQ_AREA_PER_LEVEL) < 1e-6
    assert abs(REQ_AREA_PER_LEVEL * REQ_LEVEL_COUNT - REQ_TOTAL_AREA) < 1e-6
    assert GRID_X[-1] == REQ_LENGTH_X and GRID_Y[-1] == REQ_WIDTH_Y
    assert len(GRID_X) == len(GRID_X_LABELS) and len(GRID_Y) == len(GRID_Y_LABELS)
    assert set(SPACE_PROGRAM) == {lv["level_id"] for lv in LEVELS}
    for band in bands_in_use():
        x0, y0, x1, y1 = band_rect(band)
        depth = (y1 - y0) if band in ("SOUTH", "NORTH") else (x1 - x0)
        assert depth >= MIN_BAND_DEPTH - 1e-6, (
            "La banda %s tiene %.2f m de fondo, por debajo del minimo %.2f m."
            % (band, depth, MIN_BAND_DEPTH))


def _recompute_grid_residential() -> None:
    """Ejes en Y de la vivienda: fachadas y muro sur del pasillo.

    La rejilla regular de 6 m ponia una linea de columnas en mitad del
    pasillo de 1.20 m, que lo obstruia y chocaba con la puerta de acceso. Las
    columnas se llevan al muro del pasillo.
    """
    global GRID_Y, GRID_Y_LABELS
    GRID_Y = (0.0, round(RING_Y0, 4), REQ_WIDTH_Y)
    GRID_Y_LABELS = tuple(_GRID_LETTERS[i] for i in range(len(GRID_Y)))


def recompute() -> None:
    _recompute_grid()
    _recompute_levels()
    _recompute_zoning()
    if is_residential():
        _recompute_grid_residential()
    _recompute_space_program()
    _validate()


# ---------------------------------------------------------------------------
# Entrada de la solicitud
# ---------------------------------------------------------------------------

SPEC_FIELDS = {
    "levels": "REQ_LEVEL_COUNT",
    "length_x_m": "REQ_LENGTH_X",
    "width_y_m": "REQ_WIDTH_Y",
    "clear_height_m": "REQ_CLEAR_HEIGHT",
    "floor_to_floor_m": "REQ_FLOOR_TO_FLOOR",
    "building_use": "REQ_BUILDING_USE",
    "project_name": "PROJECT_NAME",
    "project_id": "PROJECT_ID",
    "core_size_m": "HYP_CORE_SIZE",
    "corridor_width_m": "HYP_CORRIDOR_WIDTH",
    "column_size_m": "HYP_COLUMN_SIZE",
    "slab_thickness_m": "HYP_SLAB_THICKNESS",
    "wall_exterior_m": "HYP_WALL_EXTERIOR",
    "wall_interior_m": "HYP_WALL_INTERIOR",
    "window_module_m": "HYP_WINDOW_MODULE",
    "window_sill_m": "HYP_WINDOW_SILL",
    "window_height_m": "HYP_WINDOW_HEIGHT",
}


class SpecError(ValueError):
    """La solicitud no se puede materializar en geometria coherente."""


def apply_spec(spec: dict) -> dict:
    """Aplica una solicitud y recalcula todo lo derivado.

    Devuelve un informe con los valores adoptados, los ajustes que hubo que
    hacer y los supuestos. Lanza SpecError si la solicitud no admite una
    geometria coherente; nunca produce un modelo silenciosamente degradado.
    """
    global REQ_AREA_PER_LEVEL, REQ_TOTAL_AREA, SPEC_ADJUSTMENTS, PROGRAM_REQUEST
    global HYP_STRUCTURAL_DEPTH, HYP_BEAM_DEPTH, HYP_CORE_SIZE, HYP_CORRIDOR_WIDTH
    global HYP_STAIR_RISER, HYP_STAIR_RISERS_PER_FLIGHT, RESIDENTIAL_PROGRAM

    g = globals()
    adjustments: list = []

    if not isinstance(spec, dict):
        raise SpecError("La especificacion debe ser un objeto JSON.")
    for key in ("levels", "length_x_m", "width_y_m", "clear_height_m", "floor_to_floor_m"):
        value = spec.get(key)
        if value is not None and (isinstance(value, bool)
                                  or not isinstance(value, (int, float))
                                  or value != value or value in (float("inf"), float("-inf"))):
            raise SpecError("%s debe ser un numero finito (se recibio %r)." % (key, value))
    if spec.get("levels") is not None and spec["levels"] != int(spec["levels"]):
        raise SpecError("levels debe ser entero (se recibio %r)." % spec["levels"])

    # La tipologia de vivienda cambia las hipotesis por defecto ANTES de leer
    # la solicitud, de modo que un valor pedido explicitamente sigue mandando.
    use = spec.get("building_use")
    if isinstance(use, str) and use.lower() in RESIDENTIAL_USES:
        for const, value in HYP_RESIDENTIAL.items():
            g[const] = value

    for key, const in SPEC_FIELDS.items():
        if key in spec and spec[key] is not None:
            value = spec[key]
            if isinstance(g.get(const), tuple) and isinstance(value, (list, tuple)):
                value = tuple(float(v) for v in value)
            elif isinstance(g.get(const), float):
                value = float(value)
            elif isinstance(g.get(const), int) and not isinstance(g.get(const), bool):
                value = int(value)
            g[const] = value

    if REQ_LEVEL_COUNT < 1:
        raise SpecError("El numero de niveles debe ser al menos 1.")
    if REQ_LEVEL_COUNT > 12:
        raise SpecError(
            "Este generador cubre hasta 12 niveles. Por encima, el sistema "
            "estructural y la evacuacion dejan de ser una extrapolacion razonable "
            "de la hipotesis de porticos y un solo nucleo.")
    if REQ_LENGTH_X > 120.0 or REQ_WIDTH_Y > 120.0:
        raise SpecError(
            "La planta de %.2f x %.2f m supera los 120 m de lado que resuelve este "
            "generador." % (REQ_LENGTH_X, REQ_WIDTH_Y))
    if is_residential():
        RESIDENTIAL_PROGRAM = _read_residential_program(spec.get("residential_program"))
    elif spec.get("residential_program"):
        raise SpecError("residential_program solo se admite con building_use 'vivienda'.")
    if not is_residential() and (
            REQ_LENGTH_X < MIN_FOOTPRINT_X or REQ_WIDTH_Y < MIN_FOOTPRINT_Y):
        raise SpecError(
            "La planta de %.2f x %.2f m no admite nucleo central, anillo de "
            "circulacion y bandas de recintos a la vez. El minimo es %.0f x %.0f m."
            % (REQ_LENGTH_X, REQ_WIDTH_Y, MIN_FOOTPRINT_X, MIN_FOOTPRINT_Y))

    # El canto se mantiene coherente: altura libre = entre niveles - canto.
    # No se redondea: el redondeo rompe la igualdad exacta que comprueba
    # _validate(), y esa igualdad es justamente lo que garantiza que la altura
    # libre rotulada en los planos sea la que realmente tiene el modelo.
    depth = REQ_FLOOR_TO_FLOOR - REQ_CLEAR_HEIGHT
    if depth < HYP_SLAB_THICKNESS + 0.08:
        raise SpecError(
            "Entre la altura libre (%.2f m) y la altura entre niveles (%.2f m) solo "
            "quedan %.2f m para viga y losa. Se necesitan al menos %.2f m."
            % (REQ_CLEAR_HEIGHT, REQ_FLOOR_TO_FLOOR, depth, HYP_SLAB_THICKNESS + 0.08))
    if abs(depth - HYP_STRUCTURAL_DEPTH) > 1e-9:
        adjustments.append(
            "Canto viga+losa ajustado a %.2f m para que la altura libre pedida "
            "(%.2f m) sea exacta." % (depth, REQ_CLEAR_HEIGHT))
    HYP_STRUCTURAL_DEPTH = depth
    HYP_BEAM_DEPTH = depth

    # La escalera debe cerrar exactamente la altura entre niveles.
    risers = max(2, int(round(REQ_FLOOR_TO_FLOOR / (2 * 0.180))))
    riser = REQ_FLOOR_TO_FLOOR / (2.0 * risers)   # sin redondear, por la misma razon
    if riser < 0.14 or riser > 0.20:
        raise SpecError(
            "Con %.2f m entre niveles la contrahuella resultante seria de %.3f m, "
            "fuera del rango geometrico razonable de 0.14 a 0.20 m."
            % (REQ_FLOOR_TO_FLOOR, riser))
    if abs(riser - HYP_STAIR_RISER) > 1e-9 or risers != HYP_STAIR_RISERS_PER_FLIGHT:
        adjustments.append(
            "Escalera ajustada a %d contrahuellas por tramo de %.3f m para cerrar "
            "exactamente los %.2f m entre niveles." % (risers, riser, REQ_FLOOR_TO_FLOOR))
    HYP_STAIR_RISER = riser
    HYP_STAIR_RISERS_PER_FLIGHT = risers

    if is_residential():
        _apply_residential_geometry(adjustments)
        _apply_residential_heights(adjustments)
        return _finish_apply(adjustments, spec)

    _apply_office_heights(adjustments)

    # El nucleo no puede ser mas pequeno que la escalera que contiene.
    run = 0.280 * (risers - 1)
    min_core_y = round(run + HYP_STAIR_LANDING_DEPTH + 2 * HYP_WALL_CORE + 0.40, 2)
    min_core_x = round(2 * HYP_STAIR_FLIGHT_WIDTH + 0.40 + 2 * HYP_WALL_CORE + 0.40, 2)
    cx, cy = HYP_CORE_SIZE
    if cx < min_core_x or cy < min_core_y:
        HYP_CORE_SIZE = (max(cx, min_core_x), max(cy, min_core_y))
        adjustments.append(
            "Nucleo ampliado a %.2f x %.2f m para alojar la escalera de dos tramos."
            % HYP_CORE_SIZE)

    # Las bandas perimetrales deben conservar un fondo util.
    for _ in range(12):
        band_y = (REQ_WIDTH_Y - HYP_CORE_SIZE[1]) / 2.0 - HYP_CORRIDOR_WIDTH - HYP_WALL_EXTERIOR
        band_x = (REQ_LENGTH_X - HYP_CORE_SIZE[0]) / 2.0 - HYP_CORRIDOR_WIDTH - HYP_WALL_EXTERIOR
        if band_y >= MIN_BAND_DEPTH and band_x >= MIN_BAND_DEPTH:
            break
        if HYP_CORRIDOR_WIDTH > 1.60:
            HYP_CORRIDOR_WIDTH = round(HYP_CORRIDOR_WIDTH - 0.10, 2)
            adjustments.append("Circulacion reducida a %.2f m para conservar fondo "
                               "util en las bandas." % HYP_CORRIDOR_WIDTH)
        else:
            raise SpecError(
                "Con %.2f x %.2f m de planta no quedan bandas de recintos utiles "
                "alrededor del nucleo y la circulacion."
                % (REQ_LENGTH_X, REQ_WIDTH_Y))

    return _finish_apply(adjustments, spec)


def _read_residential_program(raw) -> dict:
    if raw is None:
        return {}
    if not isinstance(raw, dict):
        raise SpecError("residential_program debe ser un objeto uso -> cantidad.")
    out = {}
    for use, qty in raw.items():
        if use not in RESIDENTIAL_ROOM_TYPES or use == "espacio_libre":
            raise SpecError("Recinto de vivienda no reconocido: %r. Opciones: %s."
                            % (use, ", ".join(u for u in RESIDENTIAL_ROOM_TYPES
                                              if u != "espacio_libre")))
        if isinstance(qty, bool) or not isinstance(qty, (int, float)) or qty != int(qty) \
                or not 0 <= qty <= 20:
            raise SpecError("La cantidad de %s debe ser un entero entre 0 y 20." % use)
        out[use] = int(qty)
    return out


def residential_minimum_footprint() -> tuple:
    """Planta minima (largo, ancho) que esta tipologia de vivienda construye.

    No es un limite normativo: es lo que necesita la geometria para alojar
    nucleo de escalera, pasillo y dos bandas de recintos de MIN_BAND_DEPTH.
    """
    ew = HYP_WALL_EXTERIOR
    min_x = 2 * ew + HYP_CORE_SIZE[0] + RESIDENTIAL_ROOM_TYPES["cocina"]["min_w"]
    min_y = 2 * ew + MIN_BAND_DEPTH + HYP_CORRIDOR_WIDTH + max(MIN_BAND_DEPTH, HYP_CORE_SIZE[1])
    return round(min_x, 2), round(min_y, 2)


def _apply_residential_geometry(adjustments: list) -> None:
    """Nucleo de escalera ajustado a la escalera, y comprobacion de planta."""
    global HYP_CORE_SIZE
    wc = HYP_WALL_CORE
    run = HYP_STAIR_TREAD * (HYP_STAIR_RISERS_PER_FLIGHT - 1)
    # Mismo ojo de 0.40 m entre tramos que usa stair_geometry().
    core_x = 2 * HYP_STAIR_FLIGHT_WIDTH + 0.40 + 2 * wc
    core_y = run + HYP_STAIR_LANDING_DEPTH + HYP_RESIDENTIAL_STAIR_ARRIVAL + 2 * wc
    HYP_CORE_SIZE = (round(core_x, 3), round(core_y, 3))
    adjustments.append(
        "Vivienda: nucleo de escalera de %.2f x %.2f m (tramos de %.2f m, descanso de "
        "%.2f m), pasillo de %.2f m y muros de fachada de %.2f m. Son hipotesis "
        "geometricas, no verificadas contra norma."
        % (HYP_CORE_SIZE[0], HYP_CORE_SIZE[1], HYP_STAIR_FLIGHT_WIDTH,
           HYP_STAIR_LANDING_DEPTH, HYP_CORRIDOR_WIDTH, HYP_WALL_EXTERIOR))
    min_x, min_y = residential_minimum_footprint()
    # El lado mayor se toma como longitud: la escalera y el pasillo corren a lo largo.
    if REQ_LENGTH_X < min_x or REQ_WIDTH_Y < min_y:
        raise SpecError(
            "La vivienda de %.2f x %.2f m no aloja nucleo de escalera, pasillo y dos "
            "bandas de recintos. Con %.2f m entre niveles esta tipologia necesita al "
            "menos %.2f x %.2f m (largo x ancho)."
            % (REQ_LENGTH_X, REQ_WIDTH_Y, REQ_FLOOR_TO_FLOOR, min_x, min_y))


# Cielo raso mas bajo que se admite en la tipologia de oficinas. Es la altura
# libre minima que acepta el propio API (server/buildingGenerator.ts).
MIN_OFFICE_CEILING = 2.20
# Altura libre para la que estan escritas las cotas del vacio tecnico.
_OFFICE_REFERENCE_CLEAR = 3.20


def _apply_office_heights(adjustments: list) -> None:
    """Baja el vacio tecnico con la altura libre.

    Las cotas de instalaciones (cielo raso 2.55 m, ductos a 3.01 m...) estan
    escritas para 3.20 m libres. Con menos altura quedaban DENTRO de las vigas:
    con 2.50 m libres el modelo salia con cientos de colisiones estructurales.
    Se conserva el espesor del vacio tecnico bajo el fondo de viga y se baja
    todo el conjunto; si el cielo raso quedara por debajo de MIN_OFFICE_CEILING,
    se rechaza.
    """
    global HYP_CEILING_HEIGHT, HYP_PLENUM_ROUTING_Z, HYP_ROUTING_Z
    shift = REQ_CLEAR_HEIGHT - _OFFICE_REFERENCE_CLEAR
    if shift >= -1e-9:
        return
    ceiling = round(HYP_CEILING_HEIGHT + shift, 3)
    if ceiling < MIN_OFFICE_CEILING - 1e-9:
        minimum = _OFFICE_REFERENCE_CLEAR - (HYP_CEILING_HEIGHT - MIN_OFFICE_CEILING)
        raise SpecError(
            "Con %.2f m de altura libre no cabe el vacio tecnico de %.2f m de esta "
            "tipologia sobre un cielo raso de al menos %.2f m. La altura libre minima "
            "es %.2f m (o indica que es una vivienda, que no lleva cielo falso)."
            % (REQ_CLEAR_HEIGHT, _OFFICE_REFERENCE_CLEAR - HYP_CEILING_HEIGHT,
               MIN_OFFICE_CEILING, minimum))
    HYP_CEILING_HEIGHT = ceiling
    HYP_PLENUM_ROUTING_Z = round(HYP_PLENUM_ROUTING_Z + shift, 3)
    HYP_ROUTING_Z = {k: round(v + shift, 3) for k, v in HYP_ROUTING_Z.items()}
    adjustments.append(
        "Vacio tecnico bajado %.2f m para quedar bajo el fondo de viga: cielo raso a "
        "%.2f m." % (-shift, HYP_CEILING_HEIGHT))


def _apply_residential_heights(adjustments: list) -> None:
    """Cotas de instalaciones de una vivienda: sin cielo falso.

    Las cotas de oficina (cielo raso a 2.55 m, vacio tecnico hasta 3.20 m)
    suponen una altura libre de 3.20 m. Con la altura libre de una casa
    quedarian DENTRO de las vigas. Se adopta canalizacion a la vista bajo el
    fondo de viga, escalonada por disciplina, y el plano de luminarias justo
    debajo. Es una hipotesis geometrica declarada.
    """
    global HYP_CEILING_HEIGHT, HYP_PLENUM_ROUTING_Z, HYP_ROUTING_Z
    top = REQ_CLEAR_HEIGHT
    HYP_ROUTING_Z = {
        "hvac": round(top - 0.20, 3),
        "hydrosanitary": round(top - 0.12, 3),
        "electrical": round(top - 0.04, 3),
        "telecommunications": round(top - 0.07, 3),
        "security": round(top - 0.09, 3),
    }
    HYP_PLENUM_ROUTING_Z = HYP_ROUTING_Z["electrical"]
    HYP_CEILING_HEIGHT = round(top - 0.10, 3)
    adjustments.append(
        "Vivienda sin cielo falso: canalizaciones a la vista bajo el fondo de viga "
        "(electrica a %.2f m) y luminarias a %.2f m sobre el piso terminado."
        % (HYP_PLENUM_ROUTING_Z, HYP_CEILING_HEIGHT))


def _finish_apply(adjustments: list, spec: dict) -> dict:
    global REQ_AREA_PER_LEVEL, REQ_TOTAL_AREA, SPEC_ADJUSTMENTS, PROGRAM_REQUEST
    REQ_AREA_PER_LEVEL = round(REQ_LENGTH_X * REQ_WIDTH_Y, 4)
    REQ_TOTAL_AREA = round(REQ_AREA_PER_LEVEL * REQ_LEVEL_COUNT, 4)
    PROGRAM_REQUEST = dict(spec.get("rooms_by_band") or {})
    if is_residential() and PROGRAM_REQUEST:
        raise SpecError("En vivienda el programa se pide con residential_program, "
                        "no con rooms_by_band.")
    SPEC_ADJUSTMENTS = adjustments

    recompute()

    return {
        "applied": {
            "levels": REQ_LEVEL_COUNT,
            "length_x_m": REQ_LENGTH_X,
            "width_y_m": REQ_WIDTH_Y,
            "clear_height_m": REQ_CLEAR_HEIGHT,
            "floor_to_floor_m": REQ_FLOOR_TO_FLOOR,
            "area_per_level_m2": REQ_AREA_PER_LEVEL,
            "total_area_m2": REQ_TOTAL_AREA,
            "structural_depth_m": HYP_STRUCTURAL_DEPTH,
            "core_size_m": list(HYP_CORE_SIZE),
            "corridor_width_m": HYP_CORRIDOR_WIDTH,
            "grid_x": list(GRID_X),
            "grid_y": list(GRID_Y),
            "stair_riser_m": HYP_STAIR_RISER,
            "stair_risers_per_flight": HYP_STAIR_RISERS_PER_FLIGHT,
            "typology": "vivienda" if is_residential() else "nucleo-anillo-bandas",
            "residential_program": dict(RESIDENTIAL_PROGRAM) if is_residential() else None,
        },
        "adjustments": list(SPEC_ADJUSTMENTS),
        "space_count": sum(len(v) for v in SPACE_PROGRAM.values()),
        "spaces_by_level": {k: len(v) for k, v in SPACE_PROGRAM.items()},
    }


# ---------------------------------------------------------------------------
# Hipotesis declaradas de seleccion de equipos
# ---------------------------------------------------------------------------
# Estos valores son SELECCIONES DE PRODUCTO adoptadas como hipotesis, no
# resultados de calculo. Permiten sumar potencia conectada por aritmetica
# trazable. La verificacion de idoneidad queda pendiente.

HYP_LUMINAIRE = {
    "model_ref": "panel LED empotrado 600x600 (hipotesis de seleccion)",
    "nominal_power_w": 36.0,
    "nominal_voltage_v": 120.0,
    "area_per_luminaire_m2": 9.0,   # criterio de reparto geometrico, no fotometrico
}
HYP_OUTLET = {
    "model_ref": "tomacorriente doble con polo a tierra (hipotesis de seleccion)",
    "nominal_voltage_v": 120.0,
    "declared_demand_w": 180.0,     # valor declarado por salida para sumar carga
    "spacing_m": 4.0,
}
HYP_SYSTEM_VOLTAGES = {
    "iluminacion": {"voltage_v": 120.0, "phases": 1, "system": "1F+N+T"},
    "tomacorrientes": {"voltage_v": 120.0, "phases": 1, "system": "1F+N+T"},
    "fuerza_equipos": {"voltage_v": 208.0, "phases": 3, "system": "3F+N+T"},
    "climatizacion": {"voltage_v": 208.0, "phases": 3, "system": "3F+N+T"},
    "bombeo": {"voltage_v": 208.0, "phases": 3, "system": "3F+N+T"},
    "acometida": {"voltage_v": 208.0, "phases": 3, "system": "3F+N+T"},
}
HYP_POWER_FACTOR = 0.90   # hipotesis para derivar corriente; no es medicion.
HYP_MAX_POINTS_PER_CIRCUIT = 12

# Diametros nominales adoptados como hipotesis de trazado (sin calculo hidraulico).
HYP_PIPE_DIAMETERS = {
    "acometida_agua": 0.0381,       # 1-1/2"
    "montante_agua": 0.0318,        # 1-1/4"
    "ramal_agua": 0.0127,           # 1/2"
    "distribucion_agua": 0.0191,    # 3/4"
    "bajante_sanitaria": 0.1016,    # 4"
    "ramal_sanitario": 0.0508,      # 2"
    "ramal_inodoro": 0.1016,        # 4"
    "ventilacion_sanitaria": 0.0508,
    "bajante_pluvial": 0.1016,
}
HYP_DRAIN_SLOPE = 0.02              # 2% adoptado para el trazado geometrico.

HYP_CONDUIT_DIAMETERS = {
    "acometida": 0.0635,            # 2-1/2"
    "alimentador": 0.0508,          # 2"
    "circuito_ramal": 0.0191,       # 3/4"
    "telecom_horizontal": 0.0254,   # 1"
    "telecom_backbone": 0.0381,     # 1-1/2"
    "control": 0.0127,              # 1/2"
}
HYP_CABLE_TRAY = {"width": 0.30, "height": 0.10}
HYP_DUCT_SECTIONS = {
    "principal": (0.50, 0.30),
    "secundario": (0.35, 0.25),
    "ramal": (0.25, 0.20),
    "extraccion_bano": (0.25, 0.20),
}

# ---------------------------------------------------------------------------
# Materiales declarados
# ---------------------------------------------------------------------------

MATERIALS = {
    "concreto_estructural": {
        "name": "Concreto estructural",
        "category": "concreto",
        "specified_strength_mpa": None,      # requiere diseno estructural
        "density_kg_m3": 2400.0,
        "color": [0.68, 0.68, 0.66],
        "provenance": "especificacion pendiente",
    },
    "acero_refuerzo": {
        "name": "Acero de refuerzo",
        "category": "acero",
        "specified_yield_mpa": None,
        "density_kg_m3": 7850.0,
        "color": [0.45, 0.45, 0.48],
        "provenance": "especificacion pendiente",
    },
    "muro_mamposteria": {
        "name": "Mamposteria de particion",
        "category": "mamposteria",
        "density_kg_m3": 1600.0,
        "color": [0.88, 0.86, 0.80],
        "provenance": "especificacion pendiente",
    },
    "vidrio": {
        "name": "Vidrio de ventana",
        "category": "vidrio",
        "density_kg_m3": 2500.0,
        "color": [0.60, 0.78, 0.86],
        "opacity": 0.35,
        "provenance": "especificacion pendiente",
    },
    "aluminio": {
        "name": "Perfil de aluminio",
        "category": "metal",
        "color": [0.75, 0.76, 0.78],
        "provenance": "especificacion pendiente",
    },
    "madera_puerta": {
        "name": "Hoja de puerta",
        "category": "madera",
        "color": [0.55, 0.38, 0.24],
        "provenance": "especificacion pendiente",
    },
    "cobre": {
        "name": "Conductor de cobre",
        "category": "metal",
        "color": [0.78, 0.45, 0.20],
        "provenance": "especificacion pendiente",
    },
    "pvc": {
        "name": "PVC",
        "category": "polimero",
        "color": [0.92, 0.92, 0.88],
        "provenance": "especificacion pendiente",
    },
    "pvc_sanitario": {
        "name": "PVC sanitario",
        "category": "polimero",
        "color": [0.95, 0.95, 0.92],
        "provenance": "especificacion pendiente",
    },
    "cpvc": {
        "name": "CPVC agua potable",
        "category": "polimero",
        "color": [0.85, 0.80, 0.55],
        "provenance": "especificacion pendiente",
    },
    "acero_galvanizado": {
        "name": "Acero galvanizado",
        "category": "metal",
        "color": [0.72, 0.74, 0.76],
        "provenance": "especificacion pendiente",
    },
    "equipo_generico": {
        "name": "Equipo",
        "category": "equipo",
        "color": [0.35, 0.60, 0.70],
        "provenance": "especificacion pendiente",
    },
    "luminaria": {
        "name": "Luminaria",
        "category": "equipo",
        "color": [0.98, 0.94, 0.70],
        "provenance": "especificacion pendiente",
    },
}

# ---------------------------------------------------------------------------
# Parametros declarados explicitamente como pendientes
# ---------------------------------------------------------------------------

PENDING_PARAMETERS = [
    {
        "parameter": "resistencia especificada del concreto (f'c)",
        "discipline": "structure",
        "blocked_by": "diseno estructural y verificacion normativa",
        "affects": ["columnas", "vigas", "losas", "escaleras", "cimentaciones"],
    },
    {
        "parameter": "refuerzo (cuantia, diametros, despiece, estribos)",
        "discipline": "structure",
        "blocked_by": "analisis y diseno estructural",
        "affects": ["todos los elementos de concreto"],
    },
    {
        "parameter": "dimensiones definitivas de cimentacion",
        "discipline": "structure",
        "blocked_by": "estudio geotecnico y capacidad portante del suelo",
        "affects": ["zapatas", "pedestales"],
    },
    {
        "parameter": "cargas de diseno y combinaciones",
        "discipline": "structure",
        "blocked_by": "definicion de uso, sismicidad del sitio y norma aplicable",
        "affects": ["modelo estructural completo"],
    },
    {
        "parameter": "calibre de conductores",
        "discipline": "electrical",
        "blocked_by": "calculo de corriente, caida de tension, agrupamiento y temperatura",
        "affects": ["todos los circuitos y alimentadores"],
    },
    {
        "parameter": "capacidad y curva de protecciones",
        "discipline": "electrical",
        "blocked_by": "coordinacion de protecciones y corriente de cortocircuito",
        "affects": ["tablero general", "tableros secundarios", "circuitos ramales"],
    },
    {
        "parameter": "demanda maxima y factores de demanda",
        "discipline": "electrical",
        "blocked_by": "cuadro de cargas verificado por profesional",
        "affects": ["acometida", "medidor", "tablero general"],
    },
    {
        "parameter": "resistencia de puesta a tierra",
        "discipline": "electrical",
        "blocked_by": "medicion de resistividad del terreno",
        "affects": ["sistema de puesta a tierra"],
    },
    {
        "parameter": "niveles de iluminancia verificados",
        "discipline": "electrical",
        "blocked_by": "calculo fotometrico por recinto",
        "affects": ["luminarias", "circuitos de iluminacion"],
    },
    {
        "parameter": "diametros definitivos de tuberia de agua potable",
        "discipline": "hydrosanitary",
        "blocked_by": "calculo hidraulico por unidades de consumo y presion disponible",
        "affects": ["acometida", "montantes", "ramales"],
    },
    {
        "parameter": "diametros definitivos de desague y ventilacion",
        "discipline": "hydrosanitary",
        "blocked_by": "calculo por unidades de descarga",
        "affects": ["bajantes", "ramales sanitarios", "ventilacion"],
    },
    {
        "parameter": "capacidad de tanque y curva de la bomba",
        "discipline": "hydrosanitary",
        "blocked_by": "dotacion, reserva requerida y calculo de presion",
        "affects": ["tanque", "equipo de bombeo"],
    },
    {
        "parameter": "capacidad de refrigeracion de equipos",
        "discipline": "hvac",
        "blocked_by": "calculo de carga termica por recinto",
        "affects": ["unidades interiores", "unidades exteriores"],
    },
    {
        "parameter": "caudales de aire y dimensionamiento de ductos",
        "discipline": "hvac",
        "blocked_by": "calculo de caudal de ventilacion y perdida de carga",
        "affects": ["ductos", "rejillas", "difusores", "extractores"],
    },
    {
        "parameter": "dimensionamiento de proteccion contra incendio",
        "discipline": "security",
        "blocked_by": "evaluacion de riesgo y norma aplicable",
        "affects": ["deteccion", "senalizacion", "alumbrado de emergencia"],
    },
    {
        "parameter": "ancho de escalera y evacuacion verificados",
        "discipline": "architecture",
        "blocked_by": "calculo de carga de ocupacion y norma de evacuacion",
        "affects": ["escalera del nucleo", "puertas de salida", "circulaciones"],
    },
]

def band_rect(band: str) -> tuple:
    return {"SOUTH": BAND_SOUTH, "NORTH": BAND_NORTH, "WEST": BAND_WEST, "EAST": BAND_EAST}[band]


def space_rect(band: str, start: float, end: float) -> tuple:
    """Rectangulo (x0, y0, x1, y1) de un recinto dentro de su banda."""
    bx0, by0, bx1, by1 = band_rect(band)
    if band in ("SOUTH", "NORTH"):
        return (start, by0, end, by1)
    return (bx0, start, bx1, end)


def level_by_id(level_id: str) -> dict:
    for lv in ALL_LEVELS:
        if lv["level_id"] == level_id:
            return lv
    raise KeyError(level_id)


# ---------------------------------------------------------------------------
# Localizacion de recintos
# ---------------------------------------------------------------------------
# Las disciplinas de instalaciones no pueden referirse a un recinto por un
# codigo fijo: el programa se genera por reglas y los codigos cambian con la
# solicitud. Se localiza por USO.


def spaces_with_use(level_id: str, use: str) -> list:
    return [r for r in SPACE_PROGRAM.get(level_id, ()) if r[2] == use]


def find_space(level_id: str, use: str, index: int = 0):
    """Devuelve la tupla de programa del recinto `index` con ese uso, o None."""
    found = spaces_with_use(level_id, use)
    return found[index] if index < len(found) else None


def find_space_any(level_id: str, uses, index: int = 0):
    """Primer recinto cuyo uso aparezca en `uses`, respetando el orden dado."""
    for use in uses:
        got = find_space(level_id, use, index)
        if got is not None:
            return got
    return None


def space_rect_of(entry) -> tuple:
    """Rectangulo (x0, y0, x1, y1) de una tupla de programa."""
    _code, _name, _use, band, start, end = entry
    return space_rect(band, start, end)


def space_center(entry) -> tuple:
    x0, y0, x1, y1 = space_rect_of(entry)
    return (round((x0 + x1) / 2.0, 4), round((y0 + y1) / 2.0, 4))


def space_code(entry) -> str:
    return entry[0]


def space_id_of(entry) -> str:
    return "ARQ-ESP-%s" % entry[0]


def inset_point(entry, du: float, dv: float) -> tuple:
    """Punto dentro del recinto, medido desde su esquina inferior izquierda."""
    x0, y0, x1, y1 = space_rect_of(entry)
    return (round(min(max(x0 + du, x0), x1), 4), round(min(max(y0 + dv, y0), y1), 4))


# Primer calculo con los valores por defecto de la solicitud.
recompute()
