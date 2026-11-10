/**
 * Dónde van los vehículos dentro del modelo del puente.
 *
 * El problema que resuelve: la simulación de tráfico trabaja en abscisas sobre
 * el tablero (metros desde el estribo), pero el visor trabaja en coordenadas
 * del modelo, y **no se puede suponer la orientación**.
 *
 * Aquí hubo un error que conviene recordar: se supuso que el modelo venía con
 * Y hacia arriba, que es lo que dice la especificación de glTF. El generador
 * exporta con trimesh y los modelos salen con **Z hacia arriba**, sin ninguna
 * rotación en la raíz. Con la suposición equivocada el tablero del Viaducto de
 * la Novena medía 7 cm de ancho y los coches habrían salido tumbados.
 *
 * La solución no es cambiar una suposición por otra, sino DEDUCIR los tres ejes
 * de la propia geometría:
 *
 * - el eje VERTICAL es el de menor extensión, porque una carpeta de rodadura es
 *   una losa delgada: centímetros de espesor frente a metros de ancho y
 *   centenares de largo;
 * - el LONGITUDINAL es el de mayor extensión, porque un tablero es mucho más
 *   largo que ancho;
 * - el TRANSVERSAL es el que queda.
 *
 * Eso vale con cualquier convenio de exportación. Si la medida no se puede
 * obtener, no se colocan vehículos: dejarlos flotando sería peor que no
 * dibujarlos.
 */

/** Identificador del componente de la carpeta de rodadura en el generador. */
export const WEARING_COURSE_ID = 'TAB-CAR';

/** Disciplina del tablero, usada como respaldo si no hay carpeta. */
export const DECK_DISCIPLINE = 'deck';

export type Axis = 'x' | 'y' | 'z';

export interface DeckReference {
  /** Eje a lo largo del cual se circula. */
  longitudinal: Axis;
  /** Eje en el que se separan los carriles. */
  transverse: Axis;
  /** Eje hacia arriba. */
  vertical: Axis;
  /** Longitud medida, en metros. */
  lengthM: number;
  /** Ancho medido, en metros. */
  widthM: number;
  /** Espesor medido, en metros. Sirve para comprobar que la medida es sensata. */
  thicknessM: number;
  /** Coordenada donde empieza el tablero, sobre el eje longitudinal. */
  startAlong: number;
  /** Centro del tablero sobre el eje transversal. */
  transverseCenter: number;
  /** Cota de la superficie de rodadura, sobre el eje vertical. */
  surfaceLevel: number;
  /** De dónde salió la medida, para poder decirlo en la interfaz. */
  source: string;
}

export interface Box {
  min: { x: number; y: number; z: number };
  max: { x: number; y: number; z: number };
}

const AXES: Axis[] = ['x', 'y', 'z'];

/** Vector unitario de un eje. */
export function axisVector(axis: Axis): [number, number, number] {
  return axis === 'x' ? [1, 0, 0] : axis === 'y' ? [0, 1, 0] : [0, 0, 1];
}

/**
 * Deduce la referencia del tablero a partir de su caja envolvente.
 *
 * Devuelve null si la caja no sirve: alguna extensión nula o no finita, o un
 * reparto de extensiones que no corresponde a una losa de calzada.
 */
export function deckReferenceFromBox(box: Box, source: string): DeckReference | null {
  const spans: Record<Axis, number> = {
    x: box.max.x - box.min.x,
    y: box.max.y - box.min.y,
    z: box.max.z - box.min.z,
  };
  for (const axis of AXES) {
    if (!Number.isFinite(spans[axis]) || spans[axis] <= 0) return null;
  }

  const ordered = [...AXES].sort((a, b) => spans[b] - spans[a]);
  const longitudinal = ordered[0];
  const transverse = ordered[1];
  const vertical = ordered[2];

  // Una calzada es claramente más larga que ancha y más ancha que gruesa. Si no
  // lo es, esto no es una carpeta de rodadura y más vale no colocar nada.
  if (spans[longitudinal] <= spans[transverse] || spans[transverse] <= spans[vertical]) {
    return null;
  }

  return {
    longitudinal,
    transverse,
    vertical,
    lengthM: spans[longitudinal],
    widthM: spans[transverse],
    thicknessM: spans[vertical],
    startAlong: box.min[longitudinal],
    transverseCenter: (box.min[transverse] + box.max[transverse]) / 2,
    surfaceLevel: box.max[vertical],
    source,
  };
}

export interface VehiclePlacement {
  position: [number, number, number];
  /** Columnas de la base de rotación: largo, alto y ancho del vehículo. */
  basis: {
    length: [number, number, number];
    height: [number, number, number];
    width: [number, number, number];
  };
}

/**
 * Sitúa y orienta un vehículo.
 *
 * `positionM` es la abscisa sobre el tablero y `offsetM` el desplazamiento
 * lateral del carril. La base de rotación lleva el largo del vehículo al eje
 * longitudinal, su alto al vertical y su ancho al transversal, de modo que
 * queda apoyado sobre la calzada con cualquier orientación de modelo.
 *
 * La base se construye derecha a propósito: con una base izquierda, three.js
 * dibujaría los vehículos reflejados.
 */
export function vehicleTransform(
  reference: DeckReference,
  positionM: number,
  offsetM: number,
  heightM: number,
): VehiclePlacement {
  const position: [number, number, number] = [0, 0, 0];
  const index: Record<Axis, 0 | 1 | 2> = { x: 0, y: 1, z: 2 };

  position[index[reference.longitudinal]] = reference.startAlong + positionM;
  position[index[reference.transverse]] = reference.transverseCenter + offsetM;
  // El cubo que representa al vehículo está centrado, así que se sube media
  // altura para que se apoye sobre la superficie en vez de hundirse.
  position[index[reference.vertical]] = reference.surfaceLevel + heightM / 2;

  const length = axisVector(reference.longitudinal);
  const height = axisVector(reference.vertical);
  let width = axisVector(reference.transverse);

  // Producto mixto: si sale negativo la base es izquierda y hay que invertir
  // el ancho para no dibujar los vehículos del revés.
  const determinant =
    length[0] * (height[1] * width[2] - height[2] * width[1])
    - length[1] * (height[0] * width[2] - height[2] * width[0])
    + length[2] * (height[0] * width[1] - height[1] * width[0]);
  if (determinant < 0) width = [-width[0], -width[1], -width[2]];

  return { position, basis: { length, height, width } };
}
