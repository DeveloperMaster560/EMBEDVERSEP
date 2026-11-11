/**
 * Cómo se enuncia la masa que calcula el generador.
 *
 * Se mostraba como «Masa estructural: 23 287 t». Leído ante un comité, eso es
 * el peso del puente — y no lo es. Para el Viaducto de la Novena la prensa
 * publica 7 536 t: tres veces menos. La diferencia no es un error de cálculo,
 * es de qué se ha modelado:
 *
 *  - El generador construye vigas y fustes MACIZOS. El viaducto real tiene
 *    cajón hueco postesado. La ficha de la obra ya lo advierte antes de
 *    generar, pero la cifra se mostraba después sin recordarlo.
 *  - No se modelan armadura ni tendones, que sumarían.
 *
 * La aritmética es correcta: volumen real por densidad declarada. Lo que
 * estaba mal era el nombre. Aquí se fija uno que no se puede malinterpretar, y
 * la salvedad viaja con el número en vez de quedarse en otra pantalla.
 *
 * Existe como módulo único porque la cifra sale en tres sitios —el estudio de
 * puentes, el de edificios y el visor— y tienen que decir lo mismo.
 */

/** Nunca «del puente» ni «de la obra»: es la masa de la geometría modelada. */
export const MODELLED_MASS_LABEL = 'Masa de lo modelado';

/** La salvedad que acompaña siempre al número. */
export const MASS_BASIS_NOTE =
  'Suma de los sólidos del modelo por su densidad nominal. No es el peso de la '
  + 'obra: no incluye armadura, tendones ni pavimento, y donde el modelo hace '
  + 'secciones macizas en lugar de cajón hueco, sobreestima.';

/** Versión corta, para donde no cabe la larga. */
export const MASS_BASIS_SHORT = 'geometría modelada, no peso de obra';

/** Formatea la masa en toneladas, en castellano. */
export function formatModelledMass(totalMassKg: number, fractionDigits = 1): string {
  if (!Number.isFinite(totalMassKg) || totalMassKg <= 0) return '—';
  return `${(totalMassKg / 1000).toLocaleString('es', {
    maximumFractionDigits: fractionDigits,
  })} t`;
}

/**
 * Compara lo modelado con una cifra publicada, cuando la hay.
 *
 * Devuelve `null` si no hay dato publicado: callar es mejor que insinuar una
 * coincidencia que nadie ha comprobado.
 */
export function compareWithPublished(
  totalMassKg: number,
  publishedMassKg: number | null | undefined,
): { ratio: number; text: string } | null {
  if (!Number.isFinite(totalMassKg) || totalMassKg <= 0) return null;
  if (!publishedMassKg || !Number.isFinite(publishedMassKg) || publishedMassKg <= 0) {
    return null;
  }
  const ratio = totalMassKg / publishedMassKg;
  return {
    ratio,
    text: `El modelo pesa ${ratio.toFixed(1)} veces la cifra publicada `
      + `(${formatModelledMass(publishedMassKg, 0)}), por las secciones macizas.`,
  };
}
