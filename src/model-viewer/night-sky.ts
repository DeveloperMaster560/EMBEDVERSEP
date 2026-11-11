/**
 * Cómo cambia la luz de la escena entre el día y la noche.
 *
 * El deslizador de la fotocelda simulaba el anochecer para el FIRMWARE, pero
 * su valor no llegaba al visor: la escena seguía a pleno día. Resultado: el
 * firmware encendía las cuatro zonas y no se veía nada, porque una luminaria
 * de unos centímetros, vista desde los cientos de metros a los que hay que
 * ponerse para abarcar un puente de 550 m, y contra un fondo iluminado, no se
 * distingue por mucho que emita.
 *
 * Un alumbrado solo se ve cuando es de noche. Eso no es un efecto: es la
 * condición en la que el alumbrado tiene sentido.
 *
 * Sin dependencias de three, para poder probarlo.
 */

/** Intensidades y colores de la escena a plena luz. Son los que había. */
export const DAY = {
  hemisphere: 1.0,
  key: 2.6,
  fill: 0.7,
  environment: 1.0,
  background: '#0e1116',
  groundOpacity: 0.32,
} as const;

/**
 * Y de noche cerrada.
 *
 * No se baja a cero: una oscuridad absoluta dejaría el puente invisible y no
 * se sabría si el alumbrado está apagado o si el modelo ha desaparecido.
 * Queda la silueta, que es lo que pasa de noche.
 */
export const NIGHT = {
  hemisphere: 0.10,
  key: 0.07,
  fill: 0.05,
  environment: 0.10,
  background: '#04060a',
  groundOpacity: 0.55,
} as const;

export interface SkyState {
  hemisphere: number;
  key: number;
  fill: number;
  environment: number;
  background: string;
  groundOpacity: number;
}

const clamp01 = (v: number) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 1);

/** Interpola dos colores en hexadecimal, canal a canal. */
export function mixHex(a: string, b: string, t: number): string {
  const parse = (hex: string) => {
    const n = Number.parseInt(hex.replace('#', ''), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  const [ar, ag, ab] = parse(a);
  const [br, bg, bb] = parse(b);
  const k = clamp01(t);
  const mix = (x: number, y: number) => Math.round(x + (y - x) * k);
  return `#${[mix(ar, br), mix(ag, bg), mix(ab, bb)]
    .map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/**
 * Estado de la escena para un nivel de luz de 0 (noche) a 1 (pleno día).
 *
 * La interpolación no es lineal: se eleva el nivel a 1,35. Oscurece antes de
 * la mitad del recorrido, que es lo que hace la luz natural al caer la tarde
 * y lo que permite ver el alumbrado encendido sin tener que llevar el
 * deslizador al extremo.
 */
export function skyFor(light: number): SkyState {
  const t = clamp01(light) ** 1.35;
  const lerp = (a: number, b: number) => a + (b - a) * t;
  return {
    hemisphere: lerp(NIGHT.hemisphere, DAY.hemisphere),
    key: lerp(NIGHT.key, DAY.key),
    fill: lerp(NIGHT.fill, DAY.fill),
    environment: lerp(NIGHT.environment, DAY.environment),
    background: mixHex(NIGHT.background, DAY.background, t),
    groundOpacity: lerp(NIGHT.groundOpacity, DAY.groundOpacity),
  };
}
