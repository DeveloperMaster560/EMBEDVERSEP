/**
 * Identificar una pieza por el MARCAJE impreso en su cuerpo.
 *
 * Por que esto y no reconocer la pieza por su aspecto: dos chips con la misma
 * silueta pueden no tener nada que ver. Un DIP de 8 patas puede ser un NE555,
 * un LM393 o una EEPROM, y sus patillajes son incompatibles entre si. Lo unico
 * que distingue a uno de otro en una fotografia es el texto serigrafiado.
 *
 * El marcaje real de un chip no es solo la referencia. Un ATmega328P lleva
 * encima algo como:
 *
 *     ATMEL
 *     ATMEGA328P
 *     -PU
 *     1735
 *
 * Hay el fabricante, la referencia, un sufijo de encapsulado y un codigo de
 * lote o fecha. Aqui se separa el grano de la paja de forma determinista y, si
 * no se reconoce nada, SE DICE: no se devuelve la pieza mas parecida.
 */

import type { ComponentDefinition } from '../domain/types';

export type MatchKind = 'exact' | 'suffix' | 'glyph';

export interface MarkingMatch {
  componentId: string;
  reference: string;
  name: string;
  /** El trozo de marcaje que produjo la coincidencia. */
  token: string;
  kind: MatchKind;
  /** Explicacion para el usuario de POR QUE se propone esta pieza. */
  reason: string;
}

export interface MarkingReading {
  /** Trozos que pueden ser una referencia. */
  tokens: string[];
  /** Lo descartado, con el motivo, para que nada desaparezca en silencio. */
  discarded: { token: string; why: string }[];
  /** Coincidencias, de la mas firme a la mas dudosa. */
  matches: MarkingMatch[];
}

/**
 * Codigos de lote y fecha: cuatro digitos, o semana+ano. No son referencias.
 *
 * Se descartan por FORMA, no por una lista: cualquier chip puede llevar
 * cualquier lote.
 */
const SOLO_DIGITOS = /^\d{3,6}$/;
/** Sufijos de encapsulado y rango: van detras de la referencia, no la forman. */
const SUFIJO_ENCAPSULADO = /^-?(PU|AU|MU|SN|SP|SO|DIP|SOIC|TSSOP|QFN|TQFP|P|N|D|DW|ST|PW|CN|CP)$/;
/** Nombres de fabricante: identifican quien la hizo, no que pieza es. */
const FABRICANTES = new Set([
  'ATMEL', 'MICROCHIP', 'MAXIM', 'MAXIMINTEGRATED', 'TI', 'TEXAS',
  'TEXASINSTRUMENTS', 'ST', 'STMICRO', 'STMICROELECTRONICS', 'NXP',
  'PHILIPS', 'MOTOROLA', 'ONSEMI', 'ON', 'FAIRCHILD', 'INFINEON',
  'ESPRESSIF', 'INVENSENSE', 'TDK', 'AOSONG', 'BOSCH', 'SPARKFUN',
  'ADAFRUIT', 'TOWERPRO', 'DALLAS', 'INTERSIL', 'RENESAS', 'TOSHIBA',
]);

/** Deja un trozo de texto en forma comparable: mayusculas y solo A-Z0-9. */
export function normalizeToken(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/**
 * Colapsa los glifos que un lector confunde sistematicamente.
 *
 * No es una comparacion difusa: son confusiones CONOCIDAS de la tipografia
 * serigrafiada (el cero ranurado contra la O, el uno sin remates contra la I).
 * Aun asi, una coincidencia obtenida solo asi se marca como dudosa, porque
 * tambien podria unir dos piezas distintas de verdad.
 */
export function collapseGlyphs(token: string): string {
  return token
    .replace(/[O]/g, '0')
    .replace(/[IL]/g, '1')
    .replace(/[S]/g, '5')
    .replace(/[B]/g, '8')
    .replace(/[Z]/g, '2')
    .replace(/[G]/g, '6')
    .replace(/[Q]/g, '0')
    .replace(/[U]/g, 'V');
}

/** Separa el marcaje en trozos candidatos y aparta lo que no puede ser. */
export function splitMarking(text: string): Pick<MarkingReading, 'tokens' | 'discarded'> {
  const tokens: string[] = [];
  const discarded: { token: string; why: string }[] = [];
  const vistos = new Set<string>();

  for (const bruto of text.split(/[\s,;/|]+/)) {
    const limpio = bruto.trim();
    if (limpio === '') continue;
    const norm = normalizeToken(limpio);
    if (norm === '') {
      discarded.push({ token: limpio, why: 'No contiene letras ni cifras.' });
      continue;
    }
    // El sufijo se comprueba ANTES del largo minimo: "-PU" o "-N" tienen dos
    // caracteres, y descartarlos por cortos le daria al usuario un motivo
    // equivocado de por que no se ha usado ese trozo del marcaje.
    if (SUFIJO_ENCAPSULADO.test(limpio.toUpperCase())) {
      discarded.push({ token: limpio, why: 'Es un sufijo de encapsulado, no la referencia.' });
      continue;
    }
    if (SOLO_DIGITOS.test(norm)) {
      discarded.push({ token: limpio, why: 'Parece un codigo de lote o de fecha.' });
      continue;
    }
    if (norm.length < 3) {
      discarded.push({ token: limpio, why: 'Demasiado corto para ser una referencia.' });
      continue;
    }
    if (FABRICANTES.has(norm)) {
      discarded.push({ token: limpio, why: 'Es el fabricante, no la pieza.' });
      continue;
    }
    if (vistos.has(norm)) continue;
    vistos.add(norm);
    tokens.push(norm);
  }
  return { tokens, discarded };
}

/** Las formas con las que una pieza del catalogo puede aparecer impresa. */
function referenciasDe(c: ComponentDefinition): string[] {
  const out = [c.reference, c.name, c.id];
  return [...new Set(out.map(normalizeToken).filter((v) => v.length >= 3))];
}

/**
 * Lee un marcaje y propone piezas del catalogo.
 *
 * El orden importa: primero lo seguro, luego lo probable, luego lo dudoso. Lo
 * que no encaja de ninguna de las tres formas NO se propone. Devolver "la mas
 * parecida" seria peor que no devolver nada: montar un LM338 creyendo que es
 * un LM358 destruye el circuito.
 */
export function readMarking(
  text: string, catalog: ComponentDefinition[],
): MarkingReading {
  const { tokens, discarded } = splitMarking(text);
  const exactas: MarkingMatch[] = [];
  const porSufijo: MarkingMatch[] = [];
  const porGlifo: MarkingMatch[] = [];
  const yaPropuesto = new Set<string>();

  for (const token of tokens) {
    for (const c of catalog) {
      if (yaPropuesto.has(c.id)) continue;
      const refs = referenciasDe(c);
      const base = { componentId: c.id, reference: c.reference, name: c.name, token };

      if (refs.includes(token)) {
        exactas.push({ ...base, kind: 'exact', reason: `El marcaje «${token}» coincide exactamente con la referencia.` });
        yaPropuesto.add(c.id);
        continue;
      }
      // El marcaje impreso suele llevar el sufijo pegado: ATMEGA328P-PU, DS3231SN.
      const conSufijo = refs.find((r) => token.startsWith(r) && token.length - r.length <= 4);
      if (conSufijo) {
        porSufijo.push({
          ...base, kind: 'suffix',
          reason: `«${token}» es «${conSufijo}» con el sufijo de encapsulado «${token.slice(conSufijo.length)}».`,
        });
        yaPropuesto.add(c.id);
        continue;
      }
      const tg = collapseGlyphs(token);
      const porLectura = refs.find((r) => collapseGlyphs(r) === tg);
      if (porLectura) {
        porGlifo.push({
          ...base, kind: 'glyph',
          reason: `«${token}» coincide con «${porLectura}» solo al resolver confusiones `
            + 'tipicas de lectura (O/0, I/1, S/5, B/8). CONFIRMELO mirando la pieza.',
        });
        yaPropuesto.add(c.id);
      }
    }
  }
  return { tokens, discarded, matches: [...exactas, ...porSufijo, ...porGlifo] };
}
