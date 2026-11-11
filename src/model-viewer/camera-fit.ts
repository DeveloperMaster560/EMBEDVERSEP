/**
 * Cuánto hay que alejar la cámara para que un modelo entre entero.
 *
 * El encuadre anterior trataba el modelo como un cubo: tomaba la dimensión
 * mayor y la dividía por la tangente del campo de visión. Con un puente de
 * 550 m de largo, 135 de alto y 36 de ancho eso no encuadra nada, porque
 *
 *  - la dimensión mayor no es el tamaño que la cámara ve desde un ángulo, y
 *  - `fov` en three.js es el campo VERTICAL: una ventana apaisada ve más a lo
 *    ancho y una estrecha ve menos, y el cálculo no miraba la proporción.
 *
 * Aquí se usa la esfera que envuelve al modelo. Es algo conservadora —deja
 * más aire del estrictamente necesario— pero tiene una propiedad que importa
 * más: entra SIEMPRE, se mire desde donde se mire y con cualquier proporción
 * de ventana. Para un visor que el usuario puede orbitar libremente, eso vale
 * más que apurar el encuadre.
 *
 * Todo en metros y grados; sin dependencias de three, para poder probarlo.
 */

/** Aire que se deja alrededor del modelo. 1 = la esfera toca los bordes. */
export const DEFAULT_MARGIN = 1.12;

/**
 * Semiángulo que de verdad limita el encuadre.
 *
 * Una ventana apaisada (aspect > 1) está limitada por la vertical; una
 * estrecha, por la horizontal. Se queda con el menor de los dos, que es el
 * que recorta.
 */
export function limitingHalfAngle(fovDeg: number, aspect: number): number {
  const verticalHalf = (fovDeg * Math.PI) / 360;
  const horizontalHalf = Math.atan(Math.tan(verticalHalf) * aspect);
  return Math.min(verticalHalf, horizontalHalf);
}

/**
 * Distancia del centro del modelo a la que hay que poner la cámara.
 *
 * Sale de la condición de tangencia: una esfera de radio r cabe en un cono de
 * semiángulo a cuando la distancia al vértice es r / sen(a).
 */
export function fitDistance(
  radiusM: number,
  fovDeg: number,
  aspect: number,
  margin: number = DEFAULT_MARGIN,
): number {
  if (!Number.isFinite(radiusM) || radiusM <= 0) return 0;
  const half = limitingHalfAngle(fovDeg, Math.max(aspect, 1e-6));
  const seno = Math.sin(half);
  // Un campo de visión degenerado mandaría la cámara al infinito.
  if (!Number.isFinite(seno) || seno <= 1e-6) return 0;
  return (radiusM / seno) * margin;
}

/**
 * Planos de recorte proporcionados al modelo.
 *
 * Fijarlos a mano se rompe por los dos lados: con un modelo de 550 m, un
 * `far` corto lo parte por la mitad; con uno de 3 m, un `near` grande se
 * come la pieza al acercarse.
 */
export function clippingPlanes(
  distanceM: number,
  radiusM: number,
): { near: number; far: number } {
  const alcance = Math.max(distanceM + radiusM * 3, radiusM * 4, 1);
  // El near se ata al tamaño del modelo, no a la distancia, para que acercarse
  // a una pieza pequeña siga siendo posible sin que desaparezca.
  const near = Math.max(radiusM / 5000, 0.01);
  return { near, far: alcance };
}

/**
 * Comprueba la condición de encuadre: ¿entra la esfera a esta distancia?
 *
 * Es la misma desigualdad que usa `fitDistance`, escrita al derecho. Sirve
 * para que las pruebas verifiquen el resultado en vez de repetir la fórmula.
 */
export function fitsInView(
  distanceM: number,
  radiusM: number,
  fovDeg: number,
  aspect: number,
): boolean {
  return distanceM * Math.sin(limitingHalfAngle(fovDeg, aspect)) >= radiusM;
}
