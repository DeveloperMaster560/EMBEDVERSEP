/**
 * Modelo de seguimiento vehicular IDM.
 *
 * REFERENCIA: Treiber, Hennecke y Helbing, «Congested traffic states in
 * empirical observations and microscopic simulations», Physical Review E 62,
 * 1805 (2000). Es un modelo publicado y contrastado, no una invención de este
 * proyecto. Se eligió porque es determinista, no produce colisiones si los
 * parámetros son sensatos, y reproduce el arranque y la detención en cola.
 *
 * La aceleración de cada vehículo es:
 *
 *     dv/dt = a · [ 1 − (v/v₀)^δ − (sd / s)² ]
 *
 *     sd = s₀ + v·T + v·Δv / (2·√(a·b))
 *
 * (en el artículo la separación deseada se escribe «s» con asterisco; aquí se
 * llama `sd` porque un asterisco seguido de barra cerraría este comentario)
 *
 * donde `s` es la separación libre al vehículo de delante (parachoques a
 * parachoques menos su longitud), `Δv` la diferencia de velocidades, `v₀` la
 * velocidad deseada, `T` el intervalo deseado, `a` la aceleración máxima, `b`
 * la deceleración cómoda, `s₀` la separación mínima parado y `δ = 4`.
 *
 * LO QUE ESTE MODELO NO HACE, y conviene saberlo antes de sacar conclusiones:
 *
 * - No hay cambio de carril. Cada vehículo se queda en el suyo. Para eso hace
 *   falta un modelo aparte (MOBIL, del mismo grupo).
 * - No hay adelantamiento ni circulación entre carriles, que en Bucaramanga es
 *   lo habitual en motocicletas.
 * - No hay semáforos, intersecciones ni peatones.
 * - No modela accidentes ni conducción agresiva.
 * - Los parámetros son hipótesis declaradas en `vehicles.ts`, no aforos.
 */

/** Exponente de aceleración del artículo original. */
export const IDM_DELTA = 4;

export interface IdmParams {
  /** Velocidad deseada, en m/s. */
  desiredSpeedMs: number;
  maxAccelMs2: number;
  comfortDecelMs2: number;
  minGapM: number;
  timeHeadwayS: number;
}

export interface Leader {
  /** Separación libre hasta el vehículo de delante, en metros. */
  gapM: number;
  /** Velocidad del vehículo de delante, en m/s. */
  speedMs: number;
}

/**
 * Aceleración que el modelo pide, en m/s².
 *
 * `leader` nulo significa vía libre: solo actúa el término de velocidad
 * deseada. Un hueco negativo o nulo (ya se le echó encima) devuelve la
 * deceleración más fuerte que el modelo admite, para que la integración no
 * explote.
 */
export function idmAcceleration(params: IdmParams, speedMs: number, leader: Leader | null): number {
  const { desiredSpeedMs, maxAccelMs2, comfortDecelMs2, minGapM, timeHeadwayS } = params;
  const v = Math.max(0, speedMs);
  const free = 1 - (desiredSpeedMs <= 0 ? 1 : Math.pow(v / desiredSpeedMs, IDM_DELTA));

  if (!leader) return maxAccelMs2 * free;

  // Un hueco que ya se ha cerrado no tiene solución dentro del modelo: la
  // fracción sd/s se dispara. Se devuelve el freno máximo en vez de un número
  // enorme que rompería la integración.
  if (leader.gapM <= 0) return -comfortDecelMs2 * 4;

  const deltaV = v - leader.speedMs;
  const desiredGap = minGapM
    + v * timeHeadwayS
    + (v * deltaV) / (2 * Math.sqrt(maxAccelMs2 * comfortDecelMs2));
  // sd no puede ser menor que la separación mínima: si el de delante va más
  // rápido, el término de aproximación es negativo y podría anularla.
  const interaction = Math.pow(Math.max(minGapM, desiredGap) / leader.gapM, 2);

  return maxAccelMs2 * (free - interaction);
}

/**
 * Integra un paso de tiempo.
 *
 * Integración de Euler explícita, que es lo que usa el artículo original. El
 * paso debe ser pequeño: por encima de unos 0,2 s el modelo deja de ser
 * estable y aparecen oscilaciones que no son físicas.
 */
export function idmStep(
  params: IdmParams,
  positionM: number,
  speedMs: number,
  leader: Leader | null,
  dtS: number,
): { positionM: number; speedMs: number; accelMs2: number } {
  const accelMs2 = idmAcceleration(params, speedMs, leader);
  // La velocidad no baja de cero: el modelo no contempla marcha atrás.
  const nextSpeed = Math.max(0, speedMs + accelMs2 * dtS);
  // Se avanza con la media de las velocidades: con Euler puro, un vehículo que
  // frena hasta parar seguiría retrocediendo una fracción de paso.
  const nextPosition = positionM + ((speedMs + nextSpeed) / 2) * dtS;
  return { positionM: nextPosition, speedMs: nextSpeed, accelMs2 };
}

/**
 * Separación de equilibrio del modelo, en metros.
 *
 * Es el hueco en el que un vehículo que va a `speedMs` detrás de otro a la
 * misma velocidad no acelera ni frena. Se obtiene igualando los dos términos
 * de la ecuación:
 *
 *     s_eq = (s₀ + v·T) / √(1 − (v/v₀)^δ)
 *
 * Conviene no confundirla con `s₀ + v·T`, que es menor: con ese hueco el
 * modelo todavía frena. Se usa para decidir si cabe un vehículo nuevo y para
 * contrastar el modelo contra su propia solución analítica en las pruebas.
 *
 * Devuelve infinito a la velocidad deseada o por encima: ahí no hay hueco que
 * permita mantenerla detrás de otro.
 */
export function idmEquilibriumGap(params: IdmParams, speedMs: number): number {
  const { desiredSpeedMs, minGapM, timeHeadwayS } = params;
  const v = Math.max(0, speedMs);
  const free = desiredSpeedMs <= 0 ? 0 : 1 - Math.pow(v / desiredSpeedMs, IDM_DELTA);
  if (free <= 0) return Number.POSITIVE_INFINITY;
  return (minGapM + v * timeHeadwayS) / Math.sqrt(free);
}

export const kmhToMs = (kmh: number): number => (kmh * 1000) / 3600;
export const msToKmh = (ms: number): number => (ms * 3600) / 1000;
