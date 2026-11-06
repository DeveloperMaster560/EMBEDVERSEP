"""Catalogo de componentes, registro de conexiones y contenedor del modelo.

Reglas de honestidad de datos que este modulo impone por construccion:

  * Un parametro que requiere calculo se almacena como None y su nombre se
    registra en `requires_calculation`. Nunca se rellena con un valor inventado.
  * Cada parametro con valor declara su procedencia en `provenance`:
        request    -> dato entregado por la administracion
        hypothesis -> hipotesis conceptual adoptada para poder modelar
        derived    -> obtenido por aritmetica o geometria desde los anteriores
        measured   -> medido sobre la geometria del modelo
  * `professional_review` vale siempre "not_reviewed". Ningun componente de
    este paquete ha sido revisado ni aprobado por un profesional competente.
  * `validation_status` solo refleja comprobacion GEOMETRICA automatica. No
    equivale a revision tecnica ni a aprobacion.
"""

from __future__ import annotations

from dataclasses import dataclass, field, asdict
from typing import Any, Dict, List, Optional, Sequence, Tuple

PROVENANCE = ("request", "hypothesis", "derived", "measured", "pending")

VALIDATION_PENDING = "pending"
VALIDATION_GEOMETRY_OK = "geometry_checked"
VALIDATION_GEOMETRY_FAIL = "geometry_failed"


@dataclass
class Component:
    component_id: str
    discipline: str
    type: str
    name: str
    parameters: Dict[str, Any] = field(default_factory=dict)
    connections: List[str] = field(default_factory=list)
    geometry_reference: Optional[str] = None
    drawing_reference: List[str] = field(default_factory=list)
    level_id: Optional[str] = None
    space_id: Optional[str] = None
    material: Optional[str] = None
    position: Optional[List[float]] = None
    dimensions: Optional[Dict[str, Any]] = None
    relationships: List[Dict[str, str]] = field(default_factory=list)
    operations: List[str] = field(default_factory=list)
    requires_calculation: List[str] = field(default_factory=list)
    provenance: str = "hypothesis"
    validation_status: str = VALIDATION_PENDING
    validation_notes: List[str] = field(default_factory=list)
    professional_review: str = "not_reviewed"
    ifc_class: Optional[str] = None
    tags: List[str] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class Connection:
    connection_id: str
    discipline: str
    type: str
    origin: str
    destination: str
    medium: str
    technology: Optional[str] = None
    parameters: Dict[str, Any] = field(default_factory=dict)
    geometry_reference: Optional[str] = None
    length_m: Optional[float] = None
    flow_direction: Optional[str] = None
    requires_calculation: List[str] = field(default_factory=list)
    provenance: str = "hypothesis"
    validation_status: str = VALIDATION_PENDING
    professional_review: str = "not_reviewed"

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class Space:
    space_id: str
    code: str
    name: str
    use: str
    level_id: str
    rect: List[float]                 # bbox: x0, y0, x1, y1
    area_m2: float
    perimeter_m: float
    clear_height: float
    shape: str = "rectangle"          # rectangle | ring | polygon
    polygon: Optional[List[List[List[float]]]] = None   # [exterior, hueco1, ...]
    occupancy: Optional[int] = None   # requiere criterio normativo -> None
    geometry_reference: Optional[str] = None
    provenance: str = "derived"
    requires_calculation: List[str] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


# Papeles de capa que usa la deteccion de colisiones para decidir si una
# interferencia es esperada o hay que corregirla. Cada dominio declara los
# suyos; estos son los de edificacion.
DEFAULT_CLASH_ROLES: Dict[str, Any] = {
    "frame": {"ESTR-COLUMNAS", "ESTR-VIGAS", "ESTR-CIMENTACION", "ESTR-ESCALERA"},
    "slab": {"ESTR-LOSAS"},
    "enclosure": {"ARQ-MUROS", "ARQ-CUBIERTA"},
    "service_disciplines": {"electrical", "telecommunications", "hydrosanitary",
                            "hvac", "security"},
    "non_material_layers": {"ARQ-ESPACIOS"},
}

BUILDING_DISCIPLINES = (
    "architecture",
    "structure",
    "electrical",
    "telecommunications",
    "hydrosanitary",
    "hvac",
    "security",
)


class ParametricModel:
    """Contenedor unico del modelo: componentes, conexiones, solidos y espacios.

    No asume un dominio. Las disciplinas admitidas, los materiales, los
    metadatos del proyecto y los papeles de capa para colisiones los declara
    quien construye el modelo, de modo que el mismo nucleo sirve para una
    edificacion y para un puente.
    """

    DISCIPLINES = BUILDING_DISCIPLINES   # compatibilidad con el codigo existente

    def __init__(
        self,
        oplog,
        disciplines: Optional[Sequence[str]] = None,
        materials: Optional[Dict[str, Any]] = None,
        project: Optional[Dict[str, Any]] = None,
        clash_roles: Optional[Dict[str, Any]] = None,
    ) -> None:
        self.oplog = oplog
        self.disciplines: Tuple[str, ...] = tuple(disciplines or BUILDING_DISCIPLINES)
        self.materials: Dict[str, Any] = dict(materials or {})
        self.project: Dict[str, Any] = dict(project or {})
        self.clash_roles: Dict[str, Any] = {
            key: set(value) if isinstance(value, (set, list, tuple)) else value
            for key, value in (clash_roles or DEFAULT_CLASH_ROLES).items()
        }
        self.components: Dict[str, Component] = {}
        self.connections: Dict[str, Connection] = {}
        self.spaces: Dict[str, Space] = {}
        self.solids: Dict[str, Any] = {}
        self.sheets: List[Any] = []
        self._counters: Dict[str, int] = {}

    # -- identificadores ---------------------------------------------------

    def next_id(self, prefix: str) -> str:
        n = self._counters.get(prefix, 0) + 1
        self._counters[prefix] = n
        return "%s-%03d" % (prefix, n)

    # -- altas -------------------------------------------------------------

    def add_component(self, component: Component) -> Component:
        if component.component_id in self.components:
            raise ValueError("component_id duplicado: %s" % component.component_id)
        if component.discipline not in self.disciplines:
            raise ValueError(
                "disciplina no declarada en este modelo: %s (admitidas: %s)"
                % (component.discipline, ", ".join(self.disciplines)))
        self.components[component.component_id] = component
        return component

    def add_connection(self, connection: Connection) -> Connection:
        if connection.connection_id in self.connections:
            raise ValueError("connection_id duplicado: %s" % connection.connection_id)
        self.connections[connection.connection_id] = connection
        for end in (connection.origin, connection.destination):
            comp = self.components.get(end)
            if comp is not None and connection.connection_id not in comp.connections:
                comp.connections.append(connection.connection_id)
        return connection

    def add_space(self, space: Space) -> Space:
        if space.space_id in self.spaces:
            raise ValueError("space_id duplicado: %s" % space.space_id)
        self.spaces[space.space_id] = space
        return space

    def add_solid(self, solid) -> Any:
        if solid.solid_id in self.solids:
            raise ValueError("solid_id duplicado: %s" % solid.solid_id)
        self.solids[solid.solid_id] = solid
        return solid

    # -- relaciones --------------------------------------------------------

    def relate(self, source_id: str, relation: str, target_id: str) -> None:
        comp = self.components.get(source_id)
        if comp is None:
            raise KeyError("componente inexistente: %s" % source_id)
        entry = {"relation": relation, "target": target_id}
        if entry not in comp.relationships:
            comp.relationships.append(entry)

    # -- consultas ---------------------------------------------------------

    def by_discipline(self, discipline: str) -> List[Component]:
        return [c for c in self.components.values() if c.discipline == discipline]

    def by_level(self, level_id: str) -> List[Component]:
        return [c for c in self.components.values() if c.level_id == level_id]

    def by_type(self, type_name: str) -> List[Component]:
        return [c for c in self.components.values() if c.type == type_name]

    def spaces_of_level(self, level_id: str) -> List[Space]:
        return [s for s in self.spaces.values() if s.level_id == level_id]

    def solids_of(self, predicate) -> List[Any]:
        return [s for s in self.solids.values() if predicate(s)]

    def connections_of_discipline(self, discipline: str) -> List[Connection]:
        return [c for c in self.connections.values() if c.discipline == discipline]

    def attach_drawing(self, component_id: str, sheet_id: str) -> None:
        comp = self.components.get(component_id)
        if comp is not None and sheet_id not in comp.drawing_reference:
            comp.drawing_reference.append(sheet_id)

    # -- resumen -----------------------------------------------------------

    def counts(self) -> Dict[str, int]:
        out: Dict[str, int] = {}
        for c in self.components.values():
            out[c.discipline] = out.get(c.discipline, 0) + 1
        return dict(sorted(out.items()))

    def counts_by_type(self) -> Dict[str, int]:
        out: Dict[str, int] = {}
        for c in self.components.values():
            key = "%s/%s" % (c.discipline, c.type)
            out[key] = out.get(key, 0) + 1
        return dict(sorted(out.items()))

    def summary(self) -> Dict[str, Any]:
        return {
            "components": len(self.components),
            "connections": len(self.connections),
            "spaces": len(self.spaces),
            "solids": len(self.solids),
            "operations": len(self.oplog),
            "by_discipline": self.counts(),
        }


# El nombre anterior se conserva para no romper los modulos de edificacion.
BuildingModel = ParametricModel
