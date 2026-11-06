"""Registro de procedimientos parametricos.

El objetivo del dataset no es solo el resultado geometrico, sino la cadena

    SOLICITUD -> PARAMETROS -> PROCEDIMIENTO -> GEOMETRIA -> PLANOS

Este modulo registra cada operacion que produce o modifica geometria, con sus
entradas, sus salidas y el parametro de `params.py` del que deriva. El registro
es deterministico: no usa reloj ni aleatoriedad, de modo que dos ejecuciones del
generador producen el mismo log byte a byte.
"""

from __future__ import annotations

from dataclasses import dataclass, field, asdict
from typing import Any, Dict, List, Optional


@dataclass
class Operation:
    op_id: str
    sequence: int
    operation: str                       # create_prism, extrude, revolve, sweep, boolean_difference, transform...
    category: str                        # creation | dimension | transform | boolean | connection | material | modification
    description: str
    component_id: Optional[str] = None
    solid_id: Optional[str] = None
    inputs: Dict[str, Any] = field(default_factory=dict)
    outputs: Dict[str, Any] = field(default_factory=dict)
    derived_from: List[str] = field(default_factory=list)   # nombres de constantes de params.py
    implementation: Optional[str] = None                     # como se ejecuto realmente
    parent_op: Optional[str] = None


class OperationLog:
    """Acumulador ordenado de operaciones parametricas."""

    def __init__(self) -> None:
        self._ops: List[Operation] = []

    def record(
        self,
        operation: str,
        category: str,
        description: str,
        component_id: Optional[str] = None,
        solid_id: Optional[str] = None,
        inputs: Optional[Dict[str, Any]] = None,
        outputs: Optional[Dict[str, Any]] = None,
        derived_from: Optional[List[str]] = None,
        implementation: Optional[str] = None,
        parent_op: Optional[str] = None,
    ) -> str:
        seq = len(self._ops) + 1
        op = Operation(
            op_id="OP-%06d" % seq,
            sequence=seq,
            operation=operation,
            category=category,
            description=description,
            component_id=component_id,
            solid_id=solid_id,
            inputs=dict(inputs or {}),
            outputs=dict(outputs or {}),
            derived_from=list(derived_from or []),
            implementation=implementation,
            parent_op=parent_op,
        )
        self._ops.append(op)
        return op.op_id

    # -- consultas ---------------------------------------------------------

    def __len__(self) -> int:
        return len(self._ops)

    @property
    def operations(self) -> List[Operation]:
        return list(self._ops)

    def for_component(self, component_id: str) -> List[Operation]:
        return [o for o in self._ops if o.component_id == component_id]

    def counts_by_operation(self) -> Dict[str, int]:
        out: Dict[str, int] = {}
        for o in self._ops:
            out[o.operation] = out.get(o.operation, 0) + 1
        return dict(sorted(out.items()))

    def counts_by_category(self) -> Dict[str, int]:
        out: Dict[str, int] = {}
        for o in self._ops:
            out[o.category] = out.get(o.category, 0) + 1
        return dict(sorted(out.items()))

    def to_dict(self) -> Dict[str, Any]:
        return {
            "schema": "embedverse-operation-log/1.0",
            "deterministic": True,
            "note": (
                "Secuencia completa de operaciones parametricas que produjeron la "
                "geometria. 'derived_from' referencia constantes de params.py."
            ),
            "operation_count": len(self._ops),
            "counts_by_operation": self.counts_by_operation(),
            "counts_by_category": self.counts_by_category(),
            "operations": [asdict(o) for o in self._ops],
        }
