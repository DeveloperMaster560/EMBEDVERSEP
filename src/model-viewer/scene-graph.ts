/**
 * Convenio de nombres del GLB generado y orden de las zonas.
 *
 * El generador nombra cada nodo `disciplina__zona__component_id`. Esa cadena es
 * el único vínculo entre la malla y el catálogo de componentes, así que se
 * aísla aquí para poder probarla sin montar el visor.
 *
 * La «zona» significa algo distinto en cada dominio: en un edificio es el nivel
 * (NF, N1, N2…, NC) y en un puente es el conjunto constructivo (CIM, EA, P1,
 * V1, TAB, T1…). El visor es el mismo; solo cambia cómo se ordenan y cómo se
 * separan en la vista explosionada.
 */

export type ModelDomain = 'building' | 'bridge';

export interface ParsedNode {
  discipline: string;
  level: string;
  componentId: string;
}

export const NODE_SEPARATOR = '__';

/** Marca que usa el generador cuando un componente no pertenece a una zona. */
export const LEVELLESS = 'SIN';

export function parseNodeName(name: string): ParsedNode | null {
  if (!name) return null;
  const parts = name.split(NODE_SEPARATOR);
  if (parts.length < 3) return null;
  const [discipline, level, ...rest] = parts;
  const componentId = rest.join(NODE_SEPARATOR);
  if (!discipline || !componentId) return null;
  return {
    discipline,
    level: level === LEVELLESS ? '' : level,
    componentId,
  };
}

/**
 * Orden vertical de un nivel de edificio, para separar las plantas.
 * Cimentación va por debajo, cubierta por encima de todos los niveles.
 */
export function levelOrder(level: string): number {
  if (level === 'NF') return 0;
  if (level === 'NC') return 999;
  const match = /^N(\d+)$/.exec(level);
  return match ? Number.parseInt(match[1], 10) : 500;
}

/**
 * Estrato constructivo de una zona de puente.
 *
 *   -1  cimentación (baja)
 *    0  subestructura y torres (no se mueven: son la referencia)
 *    1  superestructura de cada vano (sube)
 *    2  tablero y acabados (sube el doble)
 */
export function bridgeTier(zone: string): number {
  if (zone === 'CIM') return -1;
  if (/^(?:EA|EB|P\d+|T\d+)$/.test(zone)) return 0;
  if (/^V\d+$/.test(zone)) return 1;
  if (zone === 'TAB') return 2;
  return 0;
}

/** Orden de presentación de las zonas en la lista lateral. */
export function zoneOrder(domain: ModelDomain, zone: string): number {
  if (domain === 'building') return levelOrder(zone);
  if (zone === 'CIM') return 0;
  if (zone === 'EA') return 1;
  const pier = /^P(\d+)$/.exec(zone);
  if (pier) return 10 + Number.parseInt(pier[1], 10);
  if (zone === 'EB') return 100;
  const span = /^V(\d+)$/.exec(zone);
  if (span) return 200 + Number.parseInt(span[1], 10);
  if (zone === 'TAB') return 400;
  const tower = /^T(\d+)$/.exec(zone);
  if (tower) return 500 + Number.parseInt(tower[1], 10);
  return 900;
}

/** Desplazamiento vertical de una zona en la vista explosionada, en metros. */
export function explodeOffset(
  level: string,
  step: number,
  levelCount: number,
  domain: ModelDomain = 'building',
): number {
  // `step === 0` se trata aparte: `-0` no es `0` en comparaciones estrictas.
  if (step === 0) return 0;

  if (domain === 'bridge') {
    return bridgeTier(level) * step;
  }

  const order = levelOrder(level);
  if (order === 0) return -step; // la cimentación baja
  if (order === 999) return step * levelCount; // la cubierta sube del todo
  if (order === 500) return 0; // sin nivel asignado: no se mueve
  return step * (order - 1);
}
