/**
 * Presentación física de los materiales declarados por el generador.
 *
 * El generador declara QUÉ es cada componente (concreto, vidrio, neopreno,
 * asfalto…). Aquí se decide CÓMO se ve. Son parámetros de presentación: no
 * describen propiedades físicas reales del material ni sustituyen a una
 * especificación técnica.
 *
 * La tabla cubre los dos dominios (edificio y puente) porque el visor es el
 * mismo; una clave que no esté declarada cae en `DEFAULT_PRESET` y se ve
 * claramente como "sin material declarado".
 */

export interface MaterialPreset {
  label: string;
  color: string;
  roughness: number;
  metalness: number;
  /** Vidrio y similares: se renderizan con transmisión. */
  transmission?: number;
  opacity?: number;
  emissive?: string;
  emissiveIntensity?: number;
}

export const MATERIAL_PRESETS: Record<string, MaterialPreset> = {
  // --- comunes y de edificación ---
  concreto_estructural: {
    label: 'Concreto estructural',
    color: '#b4b2ab', roughness: 0.93, metalness: 0.0,
  },
  acero_refuerzo: {
    label: 'Acero de refuerzo',
    color: '#6f737a', roughness: 0.55, metalness: 0.85,
  },
  muro_mamposteria: {
    label: 'Mampostería',
    color: '#e6dfd1', roughness: 0.95, metalness: 0.0,
  },
  vidrio: {
    label: 'Vidrio',
    color: '#bfe2ee', roughness: 0.06, metalness: 0.0,
    transmission: 0.92, opacity: 0.35,
  },
  aluminio: {
    label: 'Aluminio',
    color: '#c6cacf', roughness: 0.32, metalness: 0.88,
  },
  madera_puerta: {
    label: 'Madera',
    color: '#8d5f39', roughness: 0.72, metalness: 0.0,
  },
  cobre: {
    label: 'Cobre',
    color: '#c67a33', roughness: 0.34, metalness: 1.0,
  },
  pvc: {
    label: 'PVC',
    color: '#ebe8df', roughness: 0.52, metalness: 0.0,
  },
  pvc_sanitario: {
    label: 'PVC sanitario',
    color: '#f3f1ea', roughness: 0.5, metalness: 0.0,
  },
  cpvc: {
    label: 'CPVC',
    color: '#d6c06a', roughness: 0.48, metalness: 0.0,
  },
  acero_galvanizado: {
    label: 'Acero galvanizado',
    color: '#b6bbc1', roughness: 0.34, metalness: 0.8,
  },
  equipo_generico: {
    label: 'Equipo',
    color: '#4f8ea2', roughness: 0.55, metalness: 0.25,
  },
  luminaria: {
    label: 'Luminaria',
    color: '#fff6d4', roughness: 0.3, metalness: 0.0,
    emissive: '#ffeead', emissiveIntensity: 1.1,
  },

  // --- específicos de puente ---
  concreto_pretensado: {
    label: 'Concreto pretensado',
    color: '#c3c0b7', roughness: 0.86, metalness: 0.0,
  },
  acero_estructural: {
    label: 'Acero estructural',
    color: '#7c838c', roughness: 0.45, metalness: 0.9,
  },
  acero_tirante: {
    label: 'Acero de tirante',
    color: '#9fa7b0', roughness: 0.24, metalness: 0.95,
  },
  neopreno: {
    label: 'Neopreno',
    color: '#2f3237', roughness: 0.96, metalness: 0.0,
  },
  asfalto: {
    label: 'Carpeta asfáltica',
    color: '#34373c', roughness: 0.98, metalness: 0.0,
  },
  junta_dilatacion: {
    label: 'Junta de dilatación',
    color: '#5b6066', roughness: 0.6, metalness: 0.55,
  },
  pintura_vial: {
    label: 'Demarcación vial',
    color: '#f2f3f0', roughness: 0.68, metalness: 0.0,
  },
  senal_vial: {
    label: 'Señal vial',
    color: '#1f5fa8', roughness: 0.42, metalness: 0.2,
  },
};

export const DEFAULT_PRESET: MaterialPreset = {
  label: 'Sin material declarado',
  color: '#9aa0a6', roughness: 0.7, metalness: 0.1,
};

/** Color de identificación de cada disciplina, para el modo por disciplina. */
export const DISCIPLINE_COLOR: Record<string, string> = {
  // edificación
  architecture: '#d8cfc0',
  structure: '#9aa0a6',
  electrical: '#f2b134',
  telecommunications: '#b06ad1',
  hydrosanitary: '#3f8ddb',
  hvac: '#27b9b0',
  security: '#e2574c',
  // puentes (`structure` es común a los dos dominios)
  deck: '#d8cfc0',
  barriers: '#e2574c',
  drainage: '#3f8ddb',
  lighting: '#f2b134',
  signage: '#b06ad1',
  instrumentation: '#27b9b0',
  control: '#7a86f0',
};

export function presetFor(materialKey: string | null | undefined): MaterialPreset {
  if (!materialKey) return DEFAULT_PRESET;
  return MATERIAL_PRESETS[materialKey] ?? DEFAULT_PRESET;
}
