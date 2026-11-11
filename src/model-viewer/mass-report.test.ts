/**
 * La masa es la cifra del sistema que más fácilmente se malinterpreta: se
 * lee como el peso de la obra y no lo es. Estas pruebas vigilan el enunciado,
 * no la aritmética.
 */

import { describe, expect, it } from 'vitest';

import {
  MASS_BASIS_NOTE, MODELLED_MASS_LABEL, compareWithPublished, formatModelledMass,
} from './mass-report';

describe('cómo se enuncia la masa', () => {
  it('la etiqueta no afirma que sea el peso de la obra', () => {
    expect(MODELLED_MASS_LABEL).toMatch(/modelado/i);
    expect(MODELLED_MASS_LABEL).not.toMatch(/puente|obra|estructural/i);
  });

  it('la salvedad dice en qué se queda corta y en qué se pasa', () => {
    expect(MASS_BASIS_NOTE).toMatch(/no es el peso de la obra/i);
    // Lo que falta y sumaría.
    expect(MASS_BASIS_NOTE).toMatch(/armadura/i);
    expect(MASS_BASIS_NOTE).toMatch(/tendones/i);
    // Lo que sobra y resta.
    expect(MASS_BASIS_NOTE).toMatch(/macizas|sobreestima/i);
  });
});

describe('formato', () => {
  it('pasa a toneladas', () => {
    expect(formatModelledMass(23_287_000)).toMatch(/^23\.287/);
    expect(formatModelledMass(23_287_000)).toMatch(/t$/);
  });

  it('una masa que no existe no se dibuja como cero', () => {
    // Un cero se lee como «no pesa»; la raya se lee como «no hay dato».
    expect(formatModelledMass(0)).toBe('—');
    expect(formatModelledMass(Number.NaN)).toBe('—');
    expect(formatModelledMass(-1)).toBe('—');
  });
});

describe('comparación con la cifra publicada', () => {
  it('pone número a la discrepancia del viaducto', () => {
    // 23.287 t modeladas frente a 7.536 t publicadas por la prensa.
    const c = compareWithPublished(23_287_000, 7_536_000);
    expect(c).not.toBeNull();
    expect(c!.ratio).toBeCloseTo(3.09, 2);
    expect(c!.text).toMatch(/3,1|3\.1/);
    expect(c!.text).toMatch(/macizas/);
  });

  it('calla cuando no hay cifra publicada', () => {
    // Insinuar una coincidencia que nadie ha comprobado es peor que callar.
    expect(compareWithPublished(23_287_000, null)).toBeNull();
    expect(compareWithPublished(23_287_000, undefined)).toBeNull();
    expect(compareWithPublished(23_287_000, 0)).toBeNull();
  });

  it('calla también si no hay masa modelada', () => {
    expect(compareWithPublished(0, 7_536_000)).toBeNull();
  });
});
