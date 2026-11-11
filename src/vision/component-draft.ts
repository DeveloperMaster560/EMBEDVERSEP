/**
 * Convierte lo medido en la foto y lo leido en el marcaje en un BORRADOR de
 * componente.
 *
 * Borrador, no componente: la foto da la forma y, con suerte, la referencia.
 * Lo que la foto NO puede dar nunca es la funcion de cada pata. Si la pieza se
 * identifica, el patillaje sale del catalogo, que es dato comprobado. Si no se
 * identifica, las patas se entregan CONTADAS Y SITUADAS pero SIN NOMBRE
 * (`name: null`), para que el usuario las nombre. Rellenarlas a ojo seria
 * inventar un patillaje.
 *
 * Hay un tercer caso, el mas util de los tres: que lo leido y lo medido NO
 * cuadren. Si el marcaje dice ATmega328P y en la foto hay 8 patas, algo esta
 * mal, y eso se le dice al usuario en vez de elegir uno de los dos por el.
 */

import type { ComponentDefinition } from '../domain/types';
import type { Analysis, DetectedPin } from './image-analysis';
import { readMarking, type MarkingMatch } from './marking';

export interface DraftPin {
  /** Numero provisional. Vease `pinOneLocated`. */
  number: number;
  side: DetectedPin['side'];
  position: number;
  /** null cuando la pieza no se ha identificado: no se sabe que hace la pata. */
  name: string | null;
  type: string | null;
}

export interface ComponentDraft {
  /** De donde sale el patillaje: del catalogo, o solo de la medida. */
  source: 'catalog' | 'measured';
  /** Pieza del catalogo, si se ha identificado. */
  componentId: string | null;
  name: string;
  pinCount: number;
  pins: DraftPin[];
  /** Encapsulado deducido de la geometria, p. ej. "doble hilera, 8 patas". */
  packageGuess: string | null;
  /**
   * false salvo que el usuario diga donde esta la muesca. La numeracion de un
   * encapsulado arranca en la pata 1, y la muesca es lo unico que la situa.
   */
  pinOneLocated: boolean;
  /** Otras piezas que el marcaje podria designar. */
  candidates: MarkingMatch[];
  /** Contradicciones entre lo leido y lo medido. Nunca se resuelven solas. */
  conflicts: string[];
  warnings: string[];
  /** Lo que falta por decidir antes de poder usar el componente. */
  pending: string[];
  /**
   * Trozos del marcaje que no se han usado, con el motivo. Se exponen para que
   * el usuario vea que NADA se ha ignorado en silencio: si su referencia acaba
   * aqui por error, lo nota.
   */
  discarded: { token: string; why: string }[];
}

/** Describe el encapsulado a partir del recuento por lado. */
export function describePackage(pins: DetectedPin[]): string | null {
  if (pins.length === 0) return null;
  const n = (s: DetectedPin['side']) => pins.filter((p) => p.side === s).length;
  const arriba = n('top');
  const abajo = n('bottom');
  const izq = n('left');
  const der = n('right');
  const dosHileras = (arriba > 0 && abajo > 0 && izq === 0 && der === 0)
    || (izq > 0 && der > 0 && arriba === 0 && abajo === 0);
  if (dosHileras) return `doble hilera, ${pins.length} patas`;
  const lados = [arriba, abajo, izq, der].filter((v) => v > 0).length;
  if (lados >= 3) return `patas en ${lados} lados, ${pins.length} en total`;
  return `una hilera, ${pins.length} patas`;
}

/**
 * Ordena las patas en el sentido en que se numeran los encapsulados.
 *
 * Visto desde arriba se numera en sentido antihorario a partir de la pata 1:
 * se baja por un lado y se vuelve por el otro. Aqui se respeta ese RECORRIDO,
 * pero el punto de partida es arbitrario mientras no se localice la muesca.
 */
export function orderPins(pins: DetectedPin[]): DetectedPin[] {
  const porLado = (s: DetectedPin['side']) => pins
    .filter((p) => p.side === s)
    .sort((a, b) => a.position - b.position);
  const izq = porLado('left');
  const der = porLado('right');
  const arriba = porLado('top');
  const abajo = porLado('bottom');
  if (izq.length > 0 || der.length > 0) {
    // Se baja por la izquierda y se sube por la derecha.
    return [...izq, ...[...der].reverse(), ...arriba, ...abajo];
  }
  // Girado: se avanza por abajo y se vuelve por arriba.
  return [...abajo, ...[...arriba].reverse()];
}

/**
 * Arma el borrador.
 *
 * `marking` es el texto del marcaje: lo que lea un OCR o lo que el usuario
 * teclee mirando la pieza. Se acepta vacio, y entonces solo cuenta la medida.
 */
export function buildDraft(
  analysis: Analysis, marking: string, catalog: ComponentDefinition[],
): ComponentDraft {
  const reading = readMarking(marking, catalog);
  const ordenadas = orderPins(analysis.pins);
  const medidas = ordenadas.length;
  const packageGuess = describePackage(analysis.pins);
  const conflicts: string[] = [];
  const pending: string[] = [];
  const warnings = [...analysis.warnings];

  const firmes = reading.matches.filter((m) => m.kind !== 'glyph');
  const elegida = firmes.length === 1 ? firmes[0] : null;
  const pieza = elegida
    ? catalog.find((c) => c.id === elegida.componentId) ?? null
    : null;

  if (pieza && medidas > 0 && pieza.pins.length !== medidas) {
    conflicts.push(
      `El marcaje identifica «${pieza.name}», que tiene ${pieza.pins.length} patas, `
      + `pero en la fotografia se han contado ${medidas}. Una de las dos lecturas `
      + 'es incorrecta: compruebe la pieza antes de usar este componente.');
  }
  if (firmes.length > 1) {
    pending.push(`El marcaje encaja con ${firmes.length} piezas del catalogo. `
      + 'Elija cual es.');
  }
  if (firmes.length === 0 && reading.matches.length > 0) {
    pending.push('Ninguna coincidencia es firme: las propuestas solo encajan al '
      + 'resolver confusiones de lectura. Confirmelas mirando la pieza.');
  }
  if (reading.tokens.length === 0) {
    pending.push('No se ha leido ningun marcaje. Teclee lo que diga el chip para '
      + 'poder identificarlo.');
  }

  // --- caso 1: pieza identificada, el patillaje sale del catalogo ---
  if (pieza && conflicts.length === 0) {
    const pins: DraftPin[] = pieza.pins.map((p, i) => ({
      number: i + 1,
      side: ordenadas[i]?.side ?? 'left',
      position: ordenadas[i]?.position ?? i / Math.max(1, pieza.pins.length - 1),
      name: p.name,
      type: p.type,
    }));
    if (medidas === 0) {
      pending.push('Las patas no se han podido medir en la foto; su posicion '
        + 'procede del catalogo, no de la imagen.');
    }
    return {
      source: 'catalog', componentId: pieza.id, name: pieza.name,
      pinCount: pieza.pins.length, pins, packageGuess, pinOneLocated: false,
      candidates: reading.matches.filter((m) => m.componentId !== pieza.id),
      conflicts, warnings, discarded: reading.discarded,
      pending: [...pending, 'Situe la pata 1 (la muesca o el punto del encapsulado): '
        + 'sin ella la numeracion es provisional.'],
    };
  }

  // --- caso 2: sin identificar. Se entrega la forma, no la funcion ---
  const pins: DraftPin[] = ordenadas.map((p, i) => ({
    number: i + 1, side: p.side, position: p.position, name: null, type: null,
  }));
  if (medidas > 0) {
    pending.push(`Las ${medidas} patas estan contadas y situadas, pero sin nombre: `
      + 'la fotografia no dice que hace cada una. Nombrelas o identifique la pieza '
      + 'por su marcaje.');
    pending.push('Situe la pata 1 (la muesca o el punto del encapsulado): '
      + 'sin ella la numeracion es provisional.');
  }
  return {
    source: 'measured', componentId: null,
    name: packageGuess ? `Pieza sin identificar (${packageGuess})` : 'Pieza sin identificar',
    pinCount: medidas, pins, packageGuess, pinOneLocated: false,
    candidates: reading.matches, conflicts, warnings, pending,
    discarded: reading.discarded,
  };
}
