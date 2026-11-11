"""Parametros del puente de referencia.

Mismo criterio que `params.py` para edificacion: fuente unica de verdad
dimensional, todo lo derivado se recalcula desde la solicitud y nada se
rellena en silencio.

  REQ_*   valor entregado en la solicitud.
  HYP_*   hipotesis geometrica conceptual adoptada para poder modelar. No
          proviene de calculo estructural ni de norma.

Sistema de coordenadas
----------------------
  X  eje longitudinal del puente, de estribo a estribo (0 .. longitud)
  Y  eje transversal, centrado en el eje de calzada (-ancho/2 .. +ancho/2)
  Z  cota; 0.00 es el terreno bajo el puente

No existe en este modulo ningun resultado de calculo estructural, hidraulico
ni de trafico. Los parametros que lo requieren se registran como None en el
catalogo y aparecen en PENDING_PARAMETERS.
"""

from __future__ import annotations

import math
from typing import Any, Dict, List, Tuple

# ---------------------------------------------------------------------------
# Identidad
# ---------------------------------------------------------------------------

PROJECT_ID = "EMBEDVERSE_BRIDGE_001"
PROJECT_NAME = "Puente de referencia"
PROJECT_VERSION = "1.0.0"
UNITS_LENGTH = "m"

# ---------------------------------------------------------------------------
# REQ_* — solicitud
# ---------------------------------------------------------------------------

REQ_TYPE = "beam"           # beam | slab | cable_stayed
REQ_LENGTH = 60.0           # m, longitud total entre ejes de estribo
REQ_WIDTH = 10.0            # m, ancho total del tablero
REQ_DECK_HEIGHT = 7.0       # m, cota de la cara superior del tablero
REQ_SPAN_COUNT = 3          # numero de vanos
REQ_GIRDER_COUNT = 4        # vigas principales (solo en tipologia de vigas)
REQ_LANES = 2               # carriles de circulacion
REQ_SIDEWALKS = True        # aceras a ambos lados

# Reparto de vanos. Vacio = vanos iguales (longitud / numero de vanos). Con
# valores explicitos el generador respeta el reparto real de la obra, que en
# un atirantado nunca es uniforme: el vano central es mucho mayor que los
# laterales. La suma debe coincidir con REQ_LENGTH.
REQ_SPAN_LENGTHS: Tuple[float, ...] = ()

# Altura de torre SOBRE EL TABLERO. None = se deduce de la luz. Se admite
# explicita porque en una obra real es un dato de proyecto, no una proporcion.
REQ_TOWER_HEIGHT: Any = None
# La altura del estribo es un dato del TERRENO. None = no declarada.
REQ_ABUTMENT_HEIGHT: Any = None

# ---------------------------------------------------------------------------
# HYP_* — hipotesis geometricas conceptuales
# ---------------------------------------------------------------------------

# Tablero
HYP_SLAB_THICKNESS = 0.22           # losa del tablero
HYP_WEARING_THICKNESS = 0.07        # carpeta de rodadura
HYP_SIDEWALK_WIDTH = 1.20
HYP_SIDEWALK_RISE = 0.18            # resalte de la acera sobre la calzada
HYP_CURB_WIDTH = 0.25
HYP_CROSSFALL = 0.02                # bombeo transversal adoptado

# Vigas principales y diafragmas
HYP_GIRDER_WIDTH = 0.45
HYP_GIRDER_DEPTH_RATIO = 0.055      # canto = luz x ratio, acotado por min/max
HYP_GIRDER_DEPTH_MIN = 0.70
HYP_GIRDER_DEPTH_MAX = 2.60
HYP_DIAPHRAGM_WIDTH = 0.25
HYP_DIAPHRAGM_SPACING = 6.0         # separacion maxima entre diafragmas

# Losa maciza (tipologia de losa)
HYP_SLAB_DEPTH_RATIO = 0.045
HYP_SLAB_DEPTH_MIN = 0.45

# Pilas
HYP_PIER_COLUMN_DIAMETER = 1.20
HYP_PIER_COLUMNS_PER_AXIS = 2
HYP_PIER_CAP_DEPTH = 1.10
HYP_PIER_CAP_WIDTH = 1.40

# Estribos
HYP_ABUTMENT_THICKNESS = 1.00
HYP_ABUTMENT_WINGWALL_LENGTH = 4.00
HYP_ABUTMENT_WINGWALL_THICKNESS = 0.40

# Cimentacion conceptual
HYP_FOOTING_PLAN = (4.50, 4.50)
HYP_FOOTING_THICKNESS = 1.00
HYP_FOOTING_DEPTH = 2.00            # profundidad de la cara superior bajo el terreno

# Apoyos y juntas
HYP_BEARING_SIZE = (0.45, 0.45, 0.08)
HYP_BEARING_GAP = 0.01              # holgura entre el apoyo y el fondo de estructura

# Altura maxima de un estribo macizo convencional. Por encima de esto no se
# construyen asi: un estribo es una estructura de contencion que se situa donde
# el terreno encuentra al tablero, y en un viaducto sobre vaguada eso ocurre en
# el BORDE de la vaguada, no en su fondo. Las pilas si bajan al fondo.
#
# Sin esta cota, un tablero a 72 m producia un muro macizo de 71 m de altura,
# y los dos estribos sumaban el 29 % de la masa del modelo. Esa pieza no existe
# en ningun puente.
HYP_ABUTMENT_MAX_HEIGHT = 12.0
HYP_JOINT_GAP = 0.06
HYP_JOINT_DEPTH = 0.22   # igual al espesor de losa: la junta no invade las vigas

# Barreras
HYP_BARRIER_HEIGHT = 0.90
HYP_BARRIER_WIDTH = 0.40
HYP_RAILING_HEIGHT = 1.10

# Atirantado
HYP_TOWER_HEIGHT_RATIO = 0.22       # altura de torre sobre tablero = luz x ratio
HYP_TOWER_SECTION = (1.60, 2.20)
HYP_STAY_DIAMETER = 0.14
HYP_STAY_PAIRS_PER_TOWER = 8
HYP_STAY_DECK_SPACING = 6.0

# Drenaje
HYP_DRAIN_SPACING = 12.0            # separacion maxima entre sumideros
HYP_DRAIN_DIAMETER = 0.15
HYP_DRAIN_COLLECTOR_DIAMETER = 0.20

# Iluminacion
HYP_LIGHT_SPACING = 20.0
HYP_LIGHT_POLE_HEIGHT = 9.0
HYP_LIGHT_POLE_DIAMETER = 0.18
HYP_LUMINAIRE = {
    "model_ref": "luminaria vial LED (hipotesis de seleccion)",
    "nominal_power_w": 120.0,
    "nominal_voltage_v": 208.0,
    "phases": 1,
}
HYP_CONDUIT_DIAMETER = 0.0508

# Iluminacion arquitectonica (realce). Es la que da identidad nocturna a un
# puente singular y se gobierna por color, no por iluminancia de calzada: por
# eso va separada del alumbrado vial y no comparte ni circuito ni mando.
HYP_ARCH_LIGHTING = True
HYP_STAY_FIXTURE = {
    "model_ref": "proyector lineal RGBW para tirante (hipotesis de seleccion)",
    "nominal_power_w": 75.0,
    "nominal_voltage_v": 208.0,
    "body_m": (0.90, 0.12, 0.12),
}
HYP_TOWER_FLOODLIGHT = {
    "model_ref": "proyector de gran alcance RGBW para torre (hipotesis de seleccion)",
    "nominal_power_w": 310.0,
    "nominal_voltage_v": 208.0,
    "body_m": (0.36, 0.30, 0.40),
}
HYP_FLOODLIGHTS_PER_LEG = 4
HYP_BARRIER_ACCENT = {
    "model_ref": "bañador lineal RGB de barrera (hipotesis de seleccion)",
    "nominal_power_w": 24.0,
    "nominal_voltage_v": 208.0,
    "body_m": (1.20, 0.10, 0.08),
}
HYP_BARRIER_ACCENT_SPACING = 20.0

# Control y sistemas embebidos del alumbrado.
HYP_CONTROL = {
    # Un controlador gobierna un numero limitado de universos DMX; el reparto
    # real depende del numero de nodos direccionables, que no conocemos.
    "universes_per_controller": None,
    "nominal_voltage_v": 208.0,
    "data_protocol": "Ethernet con DMX512 sobre el bus local",
    "cabinet_box_m": (0.80, 0.40, 1.20),
    "controller_box_m": (0.44, 0.22, 0.18),
    "driver_box_m": (0.36, 0.22, 0.14),
    "photocell_box_m": (0.12, 0.12, 0.16),
}
HYP_CONTROL_ZONES = ("tirantes", "torres", "barreras", "vial")
HYP_DATA_CONDUIT_DIAMETER = 0.0381

# Senalizacion
HYP_SIGN_SPACING = 30.0
HYP_SIGN_SIZE = (0.90, 0.05, 0.90)
HYP_SIGN_POST_HEIGHT = 2.40
HYP_LANE_MARK_WIDTH = 0.12

# Instrumentacion estructural
HYP_SENSOR_PER_SPAN = 2
HYP_SENSOR_BOX = (0.12, 0.10, 0.06)

# Disposicion de la instrumentacion. "generic" reparte sensores por vano;
# "shm-novena-2026-11" aplica el diseno SHM del area de ingenierias
# (Planos/Diseno_SHM_Viaducto_Novena, 11/11/2026).
INSTRUMENTATION_LAYOUTS = ("generic", "shm-novena-2026-11")
REQ_INSTRUMENTATION_LAYOUT = "generic"

HYP_POWER_FACTOR = 0.90

# ---------------------------------------------------------------------------
# Limites del generador
# ---------------------------------------------------------------------------

MIN_LENGTH = 10.0
MAX_LENGTH = 600.0
MIN_WIDTH = 4.0
MAX_WIDTH = 40.0
MIN_SPANS = 1
MAX_SPANS = 20
MAX_SPAN_LENGTH = {"beam": 45.0, "slab": 25.0, "cable_stayed": 300.0,
                   # Los arcos de hormigon construidos superan los 400 m
                   # (Wanxian, 420 m). Se acota ahi.
                   "arch": 420.0}
MIN_DECK_HEIGHT = 1.5

SUPPORTED_TYPES = ("beam", "slab", "cable_stayed", "arch")
TYPE_LABEL = {
    "beam": "Puente de vigas",
    "slab": "Puente de losa",
    "cable_stayed": "Puente atirantado",
    "arch": "Puente en arco",
}

# ---------------------------------------------------------------------------
# Arco (tablero superior)
# ---------------------------------------------------------------------------
#
# Se construye UN arco sobre el vano mayor y se mantienen vigas en los vanos
# restantes, que hacen de viaductos de acceso. Es la disposicion habitual: el
# arco salva el obstaculo y el resto se resuelve con vigas.

HYP_ARCH_RIB_SECTION = (1.80, 2.40)     # ancho x canto del arco, en metros
HYP_ARCH_CLEARANCE = 0.60               # holgura entre la clave y el tablero
HYP_ARCH_SEGMENTS = 28                  # tramos rectos que aproximan la curva
HYP_ARCH_COLUMN_SECTION = (0.90, 0.90)  # montantes entre arco y tablero
HYP_ARCH_COLUMN_SPACING = 12.0          # separacion objetivo entre montantes
HYP_ARCH_SPRINGING_Z = 0.0              # los arranques nacen a cota de terreno
# Por debajo de esta flecha el arco deja de trabajar como tal y la pieza seria
# una viga curva. Si la cota del tablero no da para mas, se rechaza en vez de
# entregar un arco que no lo es.
HYP_ARCH_MIN_RISE_RATIO = 0.08

# Derivados en apply_spec. Vacios mientras no se pida un arco.
ARCH_SPAN = None            # (x_arranque_izq, x_arranque_der)
ARCH_RISE = 0.0             # flecha, de arranque a clave
ARCH_CROWN_Z = 0.0          # cota de la clave
ARCH_RIB_OFFSETS = ()       # separacion transversal de los nervios

# ---------------------------------------------------------------------------
# Disciplinas y materiales
# ---------------------------------------------------------------------------

DISCIPLINES = (
    "structure",        # vigas, pilas, estribos, cimentacion, apoyos, juntas
    "deck",             # losa, carpeta, aceras, bordillos
    "barriers",         # barreras y barandas
    "drainage",         # sumideros, bajantes, colector
    "lighting",         # postes, luminarias, canalizacion
    "signage",          # senales y marcas viales
    "instrumentation",  # sensores estructurales y su cableado
    "control",          # controladores, fuentes y mando del alumbrado
)

DISCIPLINE_LABEL = {
    "structure": "Estructura",
    "deck": "Tablero",
    "barriers": "Barreras",
    "drainage": "Drenaje",
    "lighting": "Iluminacion",
    "signage": "Senalizacion",
    "instrumentation": "Instrumentacion",
    "control": "Control y sistemas embebidos",
}

# Los servicios son las disciplinas que discurren POR la estructura: si una de
# ellas ocupa el mismo volumen que una viga o una pila, es un error de trazado.
SERVICE_DISCIPLINES = {"drainage", "lighting", "signage", "instrumentation",
                       "control"}

MATERIALS = {
    "concreto_estructural": {
        "name": "Concreto estructural", "category": "concreto",
        "specified_strength_mpa": None, "density_kg_m3": 2400.0,
        "color": [0.70, 0.70, 0.68], "provenance": "especificacion pendiente",
    },
    "concreto_pretensado": {
        "name": "Concreto pretensado", "category": "concreto",
        "specified_strength_mpa": None, "prestress_force_kN": None,
        "density_kg_m3": 2500.0, "color": [0.76, 0.75, 0.71],
        "provenance": "especificacion pendiente",
    },
    "acero_estructural": {
        "name": "Acero estructural", "category": "acero",
        "specified_yield_mpa": None, "density_kg_m3": 7850.0,
        "color": [0.45, 0.47, 0.52], "provenance": "especificacion pendiente",
    },
    "acero_tirante": {
        "name": "Acero de tirante", "category": "acero",
        "breaking_load_kN": None, "color": [0.82, 0.84, 0.88],
        "provenance": "especificacion pendiente",
    },
    "neopreno": {
        "name": "Neopreno de apoyo", "category": "elastomero",
        "allowable_load_kN": None, "color": [0.17, 0.17, 0.19],
        "provenance": "especificacion pendiente",
    },
    "asfalto": {
        "name": "Carpeta asfaltica", "category": "asfalto",
        "density_kg_m3": 2300.0, "color": [0.22, 0.22, 0.24],
        "provenance": "especificacion pendiente",
    },
    "acero_galvanizado": {
        "name": "Acero galvanizado", "category": "metal",
        "color": [0.72, 0.74, 0.76], "provenance": "especificacion pendiente",
    },
    "pvc": {
        "name": "PVC", "category": "polimero",
        "color": [0.90, 0.90, 0.86], "provenance": "especificacion pendiente",
    },
    "pintura_vial": {
        "name": "Pintura vial", "category": "recubrimiento",
        "color": [0.95, 0.95, 0.90], "provenance": "especificacion pendiente",
    },
    "senal_vial": {
        "name": "Senal vial", "category": "metal",
        "color": [0.20, 0.45, 0.80], "provenance": "especificacion pendiente",
    },
    "luminaria": {
        "name": "Luminaria", "category": "equipo",
        "color": [0.98, 0.94, 0.70], "provenance": "especificacion pendiente",
    },
    "equipo_generico": {
        "name": "Equipo", "category": "equipo",
        "color": [0.30, 0.62, 0.70], "provenance": "especificacion pendiente",
    },
    "junta_dilatacion": {
        "name": "Junta de dilatacion", "category": "metal",
        "movement_range_mm": None, "color": [0.35, 0.36, 0.38],
        "provenance": "especificacion pendiente",
    },
}

CLASH_ROLES = {
    # El arco y sus montantes son estructura de hormigon unida monoliticamente
    # a pilas y tablero: que se toquen es la union, no un choque. Sin
    # declararlo aqui, cada arranque de arco se contaba como error a revisar.
    "frame": {"EST-VIGAS", "EST-PILAS", "EST-ESTRIBOS", "EST-CIMENTACION",
              "EST-TORRES", "EST-TIRANTES", "EST-DIAFRAGMAS", "EST-ARCO"},
    # La losa maciza se atraviesa con pasatubos, igual que la losa del
    # tablero: una perforacion ahi es un pase previsto, no un error.
    "slab": {"TAB-LOSA", "EST-LOSA-MACIZA"},
    "enclosure": {"BAR-BARRERAS", "TAB-ACERAS"},
    "service_disciplines": SERVICE_DISCIPLINES,
    "non_material_layers": set(),
}

# ---------------------------------------------------------------------------
# Parametros pendientes a nivel de proyecto
# ---------------------------------------------------------------------------

PENDING_PARAMETERS: List[Dict[str, Any]] = [
    {"parameter": "cargas de diseno y combinaciones", "discipline": "structure",
     "blocked_by": "norma de puentes aplicable y categoria de via",
     "affects": ["tablero", "vigas", "pilas", "estribos", "cimentacion"]},
    {"parameter": "resistencia especificada del concreto (f'c)", "discipline": "structure",
     "blocked_by": "diseno estructural", "affects": ["todos los elementos de concreto"]},
    {"parameter": "fuerza y trazado del pretensado", "discipline": "structure",
     "blocked_by": "diseno de la viga pretensada", "affects": ["vigas principales"]},
    {"parameter": "refuerzo (cuantia, despiece, estribos)", "discipline": "structure",
     "blocked_by": "analisis y diseno estructural", "affects": ["todos los elementos"]},
    {"parameter": "dimensiones definitivas de cimentacion", "discipline": "structure",
     "blocked_by": "estudio geotecnico y capacidad portante",
     "affects": ["zapatas", "pilotes"]},
    {"parameter": "socavacion y proteccion de pilas", "discipline": "structure",
     "blocked_by": "estudio hidraulico del cauce", "affects": ["pilas", "cimentacion"]},
    {"parameter": "capacidad y rango de movimiento de apoyos", "discipline": "structure",
     "blocked_by": "calculo de reacciones y movimientos termicos",
     "affects": ["apoyos de neopreno", "juntas de dilatacion"]},
    {"parameter": "galibo vertical y horizontal verificado", "discipline": "structure",
     "blocked_by": "definicion del obstaculo salvado", "affects": ["rasante", "pilas"]},
    {"parameter": "tension y numero de torones por tirante", "discipline": "structure",
     "blocked_by": "analisis del sistema atirantado", "affects": ["tirantes", "torres"]},
    {"parameter": "caudal de escorrentia e intensidad de lluvia", "discipline": "drainage",
     "blocked_by": "estudio hidrologico", "affects": ["sumideros", "colector"]},
    {"parameter": "niveles de iluminancia y uniformidad", "discipline": "lighting",
     "blocked_by": "calculo fotometrico vial", "affects": ["luminarias", "separacion de postes"]},
    {"parameter": "calibre de conductores y protecciones", "discipline": "lighting",
     "blocked_by": "calculo de corriente y caida de tension",
     "affects": ["circuito de alumbrado"]},
    {"parameter": "senalizacion segun manual vigente", "discipline": "signage",
     "blocked_by": "manual de senalizacion de la jurisdiccion",
     "affects": ["senales", "marcas viales"]},
    {"parameter": "plan de monitoreo y umbrales de alarma", "discipline": "instrumentation",
     "blocked_by": "definicion del sistema de monitoreo estructural",
     "affects": ["sensores", "adquisicion"]},
]

# ---------------------------------------------------------------------------
# Emplazamiento
# ---------------------------------------------------------------------------

# Un puente no es un objeto abstracto: su sismo, su viento, su lluvia y hasta
# la hora a la que se enciende dependen de DONDE esta. Cada campo lleva su
# procedencia para que nadie confunda un dato publicado con uno levantado en
# campo, y lo que no se sabe se queda en None.
SITE: Dict[str, Any] = {
    "country": None, "region": None, "municipality": None,
    "description": None, "crosses": None,
    "latitude_deg": None, "longitude_deg": None,
    "ground_elevation_m": None, "coordinate_system": None,
    "seismic_hazard_zone": None, "design_wind_speed_kmh": None,
    "rainfall_intensity_mm_h": None, "soil_profile_type": None,
    "provenance": {},
}

SITE_NUMERIC = {"latitude_deg": (-90.0, 90.0), "longitude_deg": (-180.0, 180.0),
                "ground_elevation_m": (-500.0, 6000.0),
                "design_wind_speed_kmh": (0.0, 400.0),
                "rainfall_intensity_mm_h": (0.0, 500.0)}


def apply_site(raw: Any) -> List[str]:
    """Carga el emplazamiento declarado. No inventa ni completa campos."""
    notes: List[str] = []
    if not raw:
        return notes
    if not isinstance(raw, dict):
        raise SpecError("site debe ser un objeto con los datos del emplazamiento.")
    for key, value in raw.items():
        if key == "provenance":
            if not isinstance(value, dict):
                raise SpecError("site.provenance debe ser un objeto campo -> origen.")
            SITE["provenance"] = {str(k)[:60]: str(v)[:200] for k, v in value.items()}
            continue
        if key not in SITE:
            notes.append("Campo de emplazamiento ignorado por desconocido: %s." % key)
            continue
        if value is None:
            continue
        if key in SITE_NUMERIC:
            lo, hi = SITE_NUMERIC[key]
            try:
                number = float(value)
            except (TypeError, ValueError):
                raise SpecError("site.%s debe ser numerico." % key)
            if not (lo <= number <= hi) or not math.isfinite(number):
                raise SpecError("site.%s = %r esta fuera del rango %s a %s."
                                % (key, value, lo, hi))
            SITE[key] = number
        else:
            SITE[key] = str(value)[:300]
    # Lo que se declara sin decir de donde viene no es trazable.
    sin_origen = [k for k, v in SITE.items()
                  if k not in ("provenance",) and v is not None
                  and k not in SITE["provenance"]]
    if sin_origen:
        notes.append(
            "Emplazamiento: %d campos declarados sin procedencia (%s). Se conservan, "
            "pero no son trazables." % (len(sin_origen), ", ".join(sorted(sin_origen)[:6])))
    return notes


def site_pending() -> List[str]:
    """Campos del emplazamiento que siguen sin determinar."""
    return sorted(k for k, v in SITE.items() if k != "provenance" and v is None)


# ---------------------------------------------------------------------------
# Derivados
# ---------------------------------------------------------------------------

SPAN_LENGTH = 0.0
SPAN_EDGES: Tuple[float, ...] = ()
PIER_AXES: Tuple[float, ...] = ()
GIRDER_DEPTH = 0.0
GIRDER_OFFSETS: Tuple[float, ...] = ()
BEARING_TOP = 0.0
CAP_TOP = 0.0
ABUTMENT_BASE_Z = 0.0
ABUTMENT_HEIGHT = 0.0
# True cuando la altura del estribo se ha acotado y, por tanto, se SUPONE que
# el terreno sube a su encuentro. Es una suposicion sobre el terreno, y como
# tal se declara entre los pendientes del emplazamiento.
ABUTMENT_GROUND_ASSUMED = False
# Aviso que _recompute deja listo para que apply_spec lo publique.
ABUTMENT_ADJUSTMENT: Any = None
DECK_TOP = 0.0
DECK_BOTTOM = 0.0
STRUCTURE_BOTTOM = 0.0
CARRIAGEWAY_WIDTH = 0.0
TOWER_AXES: Tuple[float, ...] = ()
TOWER_HEIGHT = 0.0
SPEC_ADJUSTMENTS: List[str] = []


class SpecError(ValueError):
    """La solicitud no admite una geometria de puente coherente."""


def _recompute() -> None:
    global SPAN_LENGTH, SPAN_EDGES, PIER_AXES, GIRDER_DEPTH, GIRDER_OFFSETS
    global DECK_TOP, DECK_BOTTOM, STRUCTURE_BOTTOM, CARRIAGEWAY_WIDTH
    global BEARING_TOP, CAP_TOP, ABUTMENT_BASE_Z, ABUTMENT_HEIGHT
    global ABUTMENT_GROUND_ASSUMED, ABUTMENT_ADJUSTMENT
    global TOWER_AXES, TOWER_HEIGHT
    global ARCH_SPAN, ARCH_RISE, ARCH_CROWN_Z, ARCH_RIB_OFFSETS

    if REQ_SPAN_LENGTHS:
        edges = [0.0]
        for length in REQ_SPAN_LENGTHS:
            edges.append(round(edges[-1] + length, 4))
        SPAN_EDGES = tuple(edges)
        # Con vanos desiguales el canto, la altura de torre y las comprobaciones
        # se gobiernan por el vano MAYOR: es el que manda en el dimensionado.
        SPAN_LENGTH = max(REQ_SPAN_LENGTHS)
    else:
        SPAN_LENGTH = REQ_LENGTH / REQ_SPAN_COUNT
        SPAN_EDGES = tuple(round(i * SPAN_LENGTH, 4)
                           for i in range(REQ_SPAN_COUNT + 1))
    PIER_AXES = SPAN_EDGES[1:-1]

    DECK_TOP = REQ_DECK_HEIGHT
    DECK_BOTTOM = round(DECK_TOP - HYP_SLAB_THICKNESS, 4)

    if REQ_TYPE == "slab":
        GIRDER_DEPTH = max(HYP_SLAB_DEPTH_MIN, SPAN_LENGTH * HYP_SLAB_DEPTH_RATIO)
        GIRDER_OFFSETS = ()
        STRUCTURE_BOTTOM = round(DECK_TOP - GIRDER_DEPTH, 4)
    else:
        GIRDER_DEPTH = min(
            HYP_GIRDER_DEPTH_MAX,
            max(HYP_GIRDER_DEPTH_MIN, SPAN_LENGTH * HYP_GIRDER_DEPTH_RATIO),
        )
        usable = REQ_WIDTH - 2 * (HYP_SIDEWALK_WIDTH if REQ_SIDEWALKS else 0.0)
        count = max(2, REQ_GIRDER_COUNT)
        step = usable / count
        GIRDER_OFFSETS = tuple(
            round(-usable / 2 + step * (i + 0.5), 4) for i in range(count))
        STRUCTURE_BOTTOM = round(DECK_BOTTOM - GIRDER_DEPTH, 4)

    # --- cotas de apoyo y arranque del estribo ---
    BEARING_TOP = round(STRUCTURE_BOTTOM - HYP_BEARING_GAP, 4)
    CAP_TOP = round(BEARING_TOP - HYP_BEARING_SIZE[2], 4)

    # El estribo es una estructura de CONTENCION: su altura la fija el terreno
    # donde el tablero lo encuentra, no la cota del tablero. Llevarlo siempre
    # hasta el plano de cota 0 produce, en un viaducto alto, un muro macizo de
    # decenas de metros que no existe en ninguna obra.
    natural_base = -HYP_FOOTING_DEPTH
    natural_height = round(CAP_TOP - natural_base, 4)
    ABUTMENT_GROUND_ASSUMED = False
    ABUTMENT_ADJUSTMENT = None
    if REQ_ABUTMENT_HEIGHT is not None:
        # Declarada por quien conoce el emplazamiento: se respeta.
        ABUTMENT_HEIGHT = round(min(REQ_ABUTMENT_HEIGHT, natural_height), 4)
    elif natural_height > HYP_ABUTMENT_MAX_HEIGHT:
        ABUTMENT_HEIGHT = HYP_ABUTMENT_MAX_HEIGHT
        ABUTMENT_GROUND_ASSUMED = True
        # No se toca SPEC_ADJUSTMENTS aqui: apply_spec la REASIGNA despues de
        # llamar a _recompute, asi que un append se perderia. Se deja el aviso
        # en una variable y lo recoge quien publica la lista.
        ABUTMENT_ADJUSTMENT = (
            "El estribo se ha acotado a %.2f m de altura. Con el tablero a %.2f m "
            "sobre el plano de referencia, llevarlo hasta ese plano daria un muro "
            "macizo de %.2f m, que no es como se construye: un estribo se situa "
            "donde el terreno encuentra al tablero. SE SUPONE que el terreno sube "
            "a su encuentro, y esa suposicion no esta verificada."
            % (HYP_ABUTMENT_MAX_HEIGHT, DECK_TOP, natural_height))
    else:
        ABUTMENT_HEIGHT = natural_height
    ABUTMENT_BASE_Z = round(CAP_TOP - ABUTMENT_HEIGHT, 4)

    # La calzada util descuenta lo que ocupa el borde: la acera si la hay y,
    # si no, la propia barrera, que tambien se apoya sobre el tablero.
    edge = max(HYP_SIDEWALK_WIDTH if REQ_SIDEWALKS else 0.0, HYP_BARRIER_WIDTH)
    CARRIAGEWAY_WIDTH = round(REQ_WIDTH - 2 * edge - 2 * HYP_CURB_WIDTH, 4)

    if REQ_TYPE == "cable_stayed":
        if REQ_SPAN_LENGTHS:
            # Las torres flanquean el vano principal: es donde van en una obra
            # real, porque son ellas las que lo sostienen. Si el vano mayor
            # muere en un estribo no hay dos pilas que las reciban y se vuelve
            # al reparto en tercios.
            main = max(range(len(REQ_SPAN_LENGTHS)),
                       key=lambda i: REQ_SPAN_LENGTHS[i])
            left, right = SPAN_EDGES[main], SPAN_EDGES[main + 1]
            if left > 0.0 and right < REQ_LENGTH:
                TOWER_AXES = (left, right)
            else:
                TOWER_AXES = (round(REQ_LENGTH / 3.0, 4),
                              round(2.0 * REQ_LENGTH / 3.0, 4))
        else:
            # Dos torres, en los tercios de la longitud total.
            TOWER_AXES = (round(REQ_LENGTH / 3.0, 4),
                          round(2.0 * REQ_LENGTH / 3.0, 4))
        if REQ_TOWER_HEIGHT is not None:
            TOWER_HEIGHT = float(REQ_TOWER_HEIGHT)
        else:
            TOWER_HEIGHT = round(SPAN_LENGTH * HYP_TOWER_HEIGHT_RATIO * 3.0, 4)
    else:
        TOWER_AXES = ()
        TOWER_HEIGHT = 0.0

    # --- arco -------------------------------------------------------------
    # La flecha NO se adopta de una proporcion: la fija la cota del tablero.
    # Un arco de tablero superior llena el hueco que hay bajo el tablero, asi
    # que inventar una flecha y luego forzarla a caber seria al reves.
    if REQ_TYPE == "arch":
        # El arco va sobre el vano mayor, pero entre dos PILAS, no muriendo en
        # un estribo: el estribo es un muro de tierras y no recibe el empuje
        # del arco. Con vanos iguales el criterio del mayor elegiria el
        # primero, que arranca en el estribo; por eso, a igualdad de luz, se
        # prefiere el mas centrado. Es el mismo razonamiento que ya hacian las
        # torres del atirantado.
        centro_puente = REQ_LENGTH / 2.0
        candidatos = list(range(len(SPAN_EDGES) - 1))
        interiores = [i for i in candidatos
                      if SPAN_EDGES[i] > 0.0 and SPAN_EDGES[i + 1] < REQ_LENGTH]
        elegibles = interiores or candidatos
        main = max(
            elegibles,
            key=lambda i: (
                round(SPAN_EDGES[i + 1] - SPAN_EDGES[i], 6),
                -abs((SPAN_EDGES[i] + SPAN_EDGES[i + 1]) / 2.0 - centro_puente),
            ),
        )
        ARCH_SPAN = (SPAN_EDGES[main], SPAN_EDGES[main + 1])
        ARCH_CROWN_Z = round(
            DECK_BOTTOM - GIRDER_DEPTH - HYP_ARCH_CLEARANCE - HYP_ARCH_RIB_SECTION[1], 4)
        ARCH_RISE = round(ARCH_CROWN_Z - HYP_ARCH_SPRINGING_Z, 4)
        luz = ARCH_SPAN[1] - ARCH_SPAN[0]
        if ARCH_RISE <= 0.0 or ARCH_RISE / luz < HYP_ARCH_MIN_RISE_RATIO:
            raise SpecError(
                "Con el tablero a %.2f m y una luz de %.2f m, el arco tendria una "
                "flecha de %.2f m (relacion 1:%.0f). Por debajo de 1:%.0f la pieza "
                "deja de trabajar como arco y seria una viga curva: suba la cota del "
                "tablero o reduzca la luz."
                % (REQ_DECK_HEIGHT, luz, max(ARCH_RISE, 0.0),
                   (luz / ARCH_RISE) if ARCH_RISE > 0 else 999,
                   1.0 / HYP_ARCH_MIN_RISE_RATIO))
        # Los nervios van bajo los bordes del tablero, apartados de las vigas.
        offset = round(REQ_WIDTH / 2.0 - HYP_ARCH_RIB_SECTION[0] / 2.0 - 0.40, 4)
        ARCH_RIB_OFFSETS = (-offset, offset)
    else:
        ARCH_SPAN = None
        ARCH_RISE = 0.0
        ARCH_CROWN_Z = 0.0
        ARCH_RIB_OFFSETS = ()


SPEC_FIELDS = {
    "bridge_type": "REQ_TYPE",
    "length_m": "REQ_LENGTH",
    "width_m": "REQ_WIDTH",
    "deck_height_m": "REQ_DECK_HEIGHT",
    "span_count": "REQ_SPAN_COUNT",
    "girder_count": "REQ_GIRDER_COUNT",
    "lanes": "REQ_LANES",
    "sidewalks": "REQ_SIDEWALKS",
    "project_name": "PROJECT_NAME",
}

# Campos que no son escalares y se validan aparte en apply_spec.
SPEC_FIELDS_SPECIAL = ("span_lengths", "tower_height_m", "abutment_height_m",
                       "instrumentation_layout")


def apply_spec(spec: Dict[str, Any]) -> Dict[str, Any]:
    """Aplica una solicitud de puente y recalcula lo derivado.

    Devuelve los valores adoptados y los ajustes. Lanza SpecError si la
    solicitud no admite geometria coherente; nunca produce un puente
    silenciosamente degradado.
    """
    global REQ_TYPE, REQ_LENGTH, REQ_WIDTH, REQ_DECK_HEIGHT, REQ_SPAN_COUNT
    global REQ_GIRDER_COUNT, REQ_LANES, REQ_SIDEWALKS, PROJECT_NAME, SPEC_ADJUSTMENTS
    global REQ_SPAN_LENGTHS, REQ_TOWER_HEIGHT, REQ_ABUTMENT_HEIGHT
    global REQ_INSTRUMENTATION_LAYOUT

    g = globals()
    adjustments: List[str] = []

    # El emplazamiento no se arrastra de una generacion a la anterior.
    for key in SITE:
        SITE[key] = {} if key == "provenance" else None
    adjustments.extend(apply_site(spec.get("site")))

    for key, const in SPEC_FIELDS.items():
        if key in spec and spec[key] is not None:
            value = spec[key]
            current = g.get(const)
            if isinstance(current, bool):
                value = bool(value)
            elif isinstance(current, int) and not isinstance(current, bool):
                value = int(value)
            elif isinstance(current, float):
                value = float(value)
            g[const] = value

    # Como el emplazamiento, no se arrastra de una generacion a otra.
    layout = spec.get("instrumentation_layout") or "generic"
    if layout not in INSTRUMENTATION_LAYOUTS:
        raise SpecError("instrumentation_layout %r no existe. Opciones: %s."
                        % (layout, ", ".join(INSTRUMENTATION_LAYOUTS)))
    REQ_INSTRUMENTATION_LAYOUT = layout

    # --- reparto explicito de vanos -------------------------------------
    # Se lee antes que nada porque fija a la vez el numero de vanos y la
    # longitud total, y las comprobaciones posteriores dependen de ambos.
    if "span_lengths" in spec and spec["span_lengths"]:
        raw = spec["span_lengths"]
        if not isinstance(raw, (list, tuple)):
            raise SpecError("span_lengths debe ser una lista de longitudes de vano.")
        try:
            lengths = [float(v) for v in raw]
        except (TypeError, ValueError):
            raise SpecError("span_lengths contiene un valor que no es numerico.")
        if not lengths:
            raise SpecError("span_lengths esta vacio.")
        if len(lengths) > MAX_SPANS:
            raise SpecError(
                "span_lengths define %d vanos, por encima del limite de %d."
                % (len(lengths), MAX_SPANS))
        for i, length in enumerate(lengths, start=1):
            if not (length > 0.0) or not math.isfinite(length):
                raise SpecError(
                    "El vano %d de span_lengths (%r) no es una longitud positiva."
                    % (i, raw[i - 1]))
        total = round(sum(lengths), 4)
        if "length_m" in spec and spec["length_m"] is not None:
            # No se corrige en silencio: o coinciden, o es un error de la
            # solicitud que el usuario debe resolver.
            if abs(total - float(spec["length_m"])) > 0.05:
                raise SpecError(
                    "Los vanos suman %.2f m pero la longitud declarada es %.2f m. "
                    "Corrige uno de los dos datos; el generador no elige por ti."
                    % (total, float(spec["length_m"])))
        REQ_LENGTH = total
        REQ_SPAN_COUNT = len(lengths)
        REQ_SPAN_LENGTHS = tuple(round(v, 4) for v in lengths)
    else:
        REQ_SPAN_LENGTHS = ()

    if "tower_height_m" in spec and spec["tower_height_m"] is not None:
        try:
            REQ_TOWER_HEIGHT = float(spec["tower_height_m"])
        except (TypeError, ValueError):
            raise SpecError("tower_height_m debe ser un numero en metros.")
        if not (0.0 < REQ_TOWER_HEIGHT <= 400.0) or not math.isfinite(REQ_TOWER_HEIGHT):
            raise SpecError(
                "La altura de torre sobre el tablero (%r m) esta fuera del rango "
                "admisible de 0 a 400 m." % spec["tower_height_m"])
    else:
        REQ_TOWER_HEIGHT = None

    # La altura del estribo la fija el TERRENO, no el tablero. Se admite
    # declararla; si no se declara, se acota (vease HYP_ABUTMENT_MAX_HEIGHT).
    if "abutment_height_m" in spec and spec["abutment_height_m"] is not None:
        try:
            REQ_ABUTMENT_HEIGHT = float(spec["abutment_height_m"])
        except (TypeError, ValueError):
            raise SpecError("abutment_height_m debe ser un numero en metros.")
        if not math.isfinite(REQ_ABUTMENT_HEIGHT) or not (
                0.5 <= REQ_ABUTMENT_HEIGHT <= 60.0):
            raise SpecError(
                "La altura de estribo (%r m) esta fuera del rango admisible de "
                "0,5 a 60 m." % spec["abutment_height_m"])
    else:
        REQ_ABUTMENT_HEIGHT = None

    if REQ_TYPE not in SUPPORTED_TYPES:
        raise SpecError(
            "Tipologia no soportada: %s. El generador cubre %s."
            % (REQ_TYPE, ", ".join(TYPE_LABEL[t].lower() for t in SUPPORTED_TYPES)))
    if not (MIN_LENGTH <= REQ_LENGTH <= MAX_LENGTH):
        raise SpecError(
            "La longitud de %.2f m esta fuera del rango que resuelve este generador "
            "(%.0f a %.0f m)." % (REQ_LENGTH, MIN_LENGTH, MAX_LENGTH))
    if not (MIN_WIDTH <= REQ_WIDTH <= MAX_WIDTH):
        raise SpecError(
            "El ancho de tablero de %.2f m esta fuera del rango admitido "
            "(%.0f a %.0f m)." % (REQ_WIDTH, MIN_WIDTH, MAX_WIDTH))
    if REQ_DECK_HEIGHT < MIN_DECK_HEIGHT:
        raise SpecError(
            "La altura del tablero (%.2f m) es menor que el minimo de %.2f m "
            "necesario para alojar vigas, apoyos y pilas."
            % (REQ_DECK_HEIGHT, MIN_DECK_HEIGHT))

    # El ancho debe dejar calzada util tras aceras y bordillos.
    side = HYP_SIDEWALK_WIDTH if REQ_SIDEWALKS else 0.0
    carriageway = REQ_WIDTH - 2 * max(side, HYP_BARRIER_WIDTH) - 2 * HYP_CURB_WIDTH
    if carriageway < 2.8:
        if REQ_SIDEWALKS and REQ_WIDTH - 2 * HYP_BARRIER_WIDTH - 2 * HYP_CURB_WIDTH >= 2.8:
            REQ_SIDEWALKS = False
            adjustments.append(
                "Se suprimieron las aceras: con %.2f m de ancho total no quedaba "
                "calzada util." % REQ_WIDTH)
        else:
            raise SpecError(
                "Con %.2f m de ancho no queda calzada util tras aceras y bordillos."
                % REQ_WIDTH)

    # El numero de vanos se ajusta para no superar la luz maxima de la tipologia.
    if not (MIN_SPANS <= REQ_SPAN_COUNT <= MAX_SPANS):
        raise SpecError(
            "El numero de vanos debe estar entre %d y %d." % (MIN_SPANS, MAX_SPANS))
    limit = MAX_SPAN_LENGTH[REQ_TYPE]
    if REQ_SPAN_LENGTHS:
        # Con reparto explicito no se reajusta el numero de vanos: se comprueba
        # vano a vano. Repartir de nuevo destruiria el dato que da el usuario.
        for i, length in enumerate(REQ_SPAN_LENGTHS, start=1):
            if length > limit:
                raise SpecError(
                    "El vano %d mide %.2f m y supera la luz maxima conceptual de "
                    "%.0f m que este generador resuelve para un %s."
                    % (i, length, limit, TYPE_LABEL[REQ_TYPE].lower()))
    needed = max(1, int(math.ceil(REQ_LENGTH / limit)))
    if not REQ_SPAN_LENGTHS and needed > REQ_SPAN_COUNT:
        if needed > MAX_SPANS:
            raise SpecError(
                "Un %s de %.2f m exigiria %d vanos para no superar la luz maxima "
                "conceptual de %.0f m, por encima del limite de %d."
                % (TYPE_LABEL[REQ_TYPE].lower(), REQ_LENGTH, needed, limit, MAX_SPANS))
        adjustments.append(
            "Vanos ajustados de %d a %d: con %d la luz seria de %.2f m, por encima "
            "de la luz maxima conceptual de %.0f m para un %s."
            % (REQ_SPAN_COUNT, needed, REQ_SPAN_COUNT, REQ_LENGTH / REQ_SPAN_COUNT,
               limit, TYPE_LABEL[REQ_TYPE].lower()))
        REQ_SPAN_COUNT = needed

    if REQ_TYPE == "beam":
        usable = REQ_WIDTH - 2 * (HYP_SIDEWALK_WIDTH if REQ_SIDEWALKS else 0.0)
        max_girders = max(2, int(usable // (HYP_GIRDER_WIDTH + 0.45)))
        if REQ_GIRDER_COUNT > max_girders:
            adjustments.append(
                "Vigas principales ajustadas de %d a %d: no caben mas en %.2f m "
                "de ancho util." % (REQ_GIRDER_COUNT, max_girders, usable))
            REQ_GIRDER_COUNT = max_girders
        if REQ_GIRDER_COUNT < 2:
            REQ_GIRDER_COUNT = 2

    if REQ_LANES < 1:
        REQ_LANES = 1
    max_lanes = max(1, int(carriageway // 3.0))
    if REQ_LANES > max_lanes:
        adjustments.append(
            "Carriles ajustados de %d a %d: la calzada util mide %.2f m."
            % (REQ_LANES, max_lanes, carriageway))
        REQ_LANES = max_lanes

    _recompute()

    # La altura debe dejar sitio bajo la estructura para apoyos y cabezal.
    if STRUCTURE_BOTTOM < 1.2:
        raise SpecError(
            "Con el tablero a %.2f m, el fondo de la estructura queda a %.2f m y no "
            "deja espacio para apoyos, cabezal y pila. Sube la altura del tablero."
            % (REQ_DECK_HEIGHT, STRUCTURE_BOTTOM))

    if ABUTMENT_ADJUSTMENT:
        adjustments.append(ABUTMENT_ADJUSTMENT)

    SPEC_ADJUSTMENTS = adjustments
    return {
        "applied": {
            "bridge_type": REQ_TYPE,
            "bridge_type_label": TYPE_LABEL[REQ_TYPE],
            "length_m": REQ_LENGTH,
            "width_m": REQ_WIDTH,
            "deck_height_m": REQ_DECK_HEIGHT,
            "span_count": REQ_SPAN_COUNT,
            "span_length_m": round(SPAN_LENGTH, 4),
            "span_lengths_m": ([round(v, 3) for v in REQ_SPAN_LENGTHS]
                               if REQ_SPAN_LENGTHS else None),
            "span_layout": ("explicito" if REQ_SPAN_LENGTHS else "vanos iguales"),
            "girder_count": REQ_GIRDER_COUNT if REQ_TYPE == "beam" else 0,
            "girder_depth_m": round(GIRDER_DEPTH, 4),
            "pier_axes": [round(v, 3) for v in PIER_AXES],
            "deck_top_m": DECK_TOP,
            "structure_bottom_m": STRUCTURE_BOTTOM,
            "carriageway_width_m": CARRIAGEWAY_WIDTH,
            "lanes": REQ_LANES,
            "sidewalks": REQ_SIDEWALKS,
            "tower_axes": [round(v, 3) for v in TOWER_AXES],
            "tower_height_m": TOWER_HEIGHT,
            "site": dict(SITE),
            "site_pending": site_pending(),
            "instrumentation_layout": REQ_INSTRUMENTATION_LAYOUT,
        },
        "adjustments": list(SPEC_ADJUSTMENTS),
    }


def domain_checks() -> List[Tuple[str, bool, Any]]:
    """Comprobaciones dimensionales propias de un puente."""
    return [
        ("unidades de longitud declaradas en metros", UNITS_LENGTH == "m", ""),
        # Se comprueba sobre los bordes, no sobre luz x numero: con vanos
        # desiguales ese producto no significa nada.
        ("los vanos suman la longitud total",
         bool(SPAN_EDGES) and abs(SPAN_EDGES[-1] - REQ_LENGTH) < 1e-3,
         "borde final %.4f vs longitud %.4f"
         % (SPAN_EDGES[-1] if SPAN_EDGES else -1.0, REQ_LENGTH)),
        ("hay un borde de vano mas que vanos",
         len(SPAN_EDGES) == REQ_SPAN_COUNT + 1,
         "%d bordes, %d vanos" % (len(SPAN_EDGES), REQ_SPAN_COUNT)),
        ("hay una pila menos que vanos",
         len(PIER_AXES) == REQ_SPAN_COUNT - 1,
         "%d pilas, %d vanos" % (len(PIER_AXES), REQ_SPAN_COUNT)),
        ("la luz no supera la maxima conceptual de la tipologia",
         SPAN_LENGTH <= MAX_SPAN_LENGTH[REQ_TYPE] + 1e-6,
         "%.2f m <= %.2f m" % (SPAN_LENGTH, MAX_SPAN_LENGTH[REQ_TYPE])),
        ("el fondo de la estructura queda bajo el tablero",
         STRUCTURE_BOTTOM < DECK_TOP, ""),
        ("la calzada util es positiva", CARRIAGEWAY_WIDTH > 0, ""),
        ("las vigas caben en el ancho util",
         REQ_TYPE != "beam" or all(abs(o) <= REQ_WIDTH / 2 for o in GIRDER_OFFSETS), ""),
    ]


_recompute()
