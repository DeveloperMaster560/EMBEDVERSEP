/**
 * Catálogo de vehículos del tráfico del puente.
 *
 * PROCEDENCIA DE LAS CIFRAS. Esto es importante y no se debe perder de vista:
 * las dimensiones y los parámetros de conducción son **valores de diseño
 * habituales**, no mediciones del tráfico del Viaducto de la Novena. Nadie ha
 * contado vehículos en ese puente para este modelo. Sirven para que la
 * circulación se comporte de forma plausible, no para dimensionar nada.
 *
 * Para un estudio de capacidad o de cargas de tráfico hacen falta aforos
 * reales y la norma que corresponda (en Colombia, el CCP-14 para cargas de
 * diseño). Nada de lo que hay aquí sustituye eso.
 *
 * Los parámetros de conducción son los del modelo IDM; su significado está en
 * `idm.ts`, junto con la referencia del artículo original.
 */

export type VehicleClassId = 'automovil' | 'motocicleta' | 'bus' | 'camion';

export interface VehicleClass {
  id: VehicleClassId;
  label: string;
  /** Largo, ancho y alto en metros. */
  lengthM: number;
  widthM: number;
  heightM: number;
  /** Velocidad a la que el conductor quiere ir, en km/h. */
  desiredSpeedKmh: number;
  /** Aceleración máxima cómoda, en m/s². */
  maxAccelMs2: number;
  /** Deceleración cómoda, en m/s². No es la de frenada de emergencia. */
  comfortDecelMs2: number;
  /** Separación mínima parachoques a parachoques, parado, en metros. */
  minGapM: number;
  /** Intervalo de seguridad deseado, en segundos. */
  timeHeadwayS: number;
  /** De dónde sale cada cifra. Se guarda para que nadie la tome por medida. */
  provenance: string;
  /** Color de referencia para pintarlo. */
  color: string;
}

/**
 * Clases de vehículo.
 *
 * El bus de 12 m corresponde al padrón habitual del transporte público urbano,
 * que es el que circula por el viaducto (Metrolínea). No se modela el
 * articulado de 18 m: haría falta un modelo de vehículo con dos cuerpos.
 */
export const VEHICLE_CLASSES: Record<VehicleClassId, VehicleClass> = {
  automovil: {
    id: 'automovil',
    label: 'Automóvil',
    lengthM: 4.4, widthM: 1.8, heightM: 1.5,
    desiredSpeedKmh: 60,
    maxAccelMs2: 1.4, comfortDecelMs2: 2.0,
    minGapM: 2.0, timeHeadwayS: 1.5,
    provenance: 'Dimensiones de turismo medio y parámetros IDM de uso corriente en la '
      + 'literatura de flujo de tráfico. Hipótesis, no medición.',
    color: '#c8d4e0',
  },
  motocicleta: {
    id: 'motocicleta',
    label: 'Motocicleta',
    lengthM: 2.1, widthM: 0.8, heightM: 1.3,
    desiredSpeedKmh: 65,
    maxAccelMs2: 2.2, comfortDecelMs2: 2.5,
    minGapM: 1.2, timeHeadwayS: 1.1,
    provenance: 'Dimensiones de motocicleta urbana. Aceleración y separación menores que '
      + 'el automóvil, coherente con lo observado, pero sin aforo propio. Hipótesis. '
      + 'NO se modela el circular entre carriles, que en Bucaramanga es frecuente.',
    color: '#e0b36a',
  },
  bus: {
    id: 'bus',
    label: 'Bus padrón',
    lengthM: 12.0, widthM: 2.55, heightM: 3.2,
    desiredSpeedKmh: 45,
    maxAccelMs2: 0.8, comfortDecelMs2: 1.6,
    minGapM: 3.0, timeHeadwayS: 1.8,
    provenance: 'Bus padrón de 12 m, el habitual del transporte público urbano. '
      + 'Dimensiones normalizadas; parámetros de conducción, hipótesis.',
    color: '#5aa9e6',
  },
  camion: {
    id: 'camion',
    label: 'Camión de dos ejes',
    lengthM: 8.5, widthM: 2.5, heightM: 3.5,
    desiredSpeedKmh: 40,
    maxAccelMs2: 0.6, comfortDecelMs2: 1.4,
    minGapM: 3.5, timeHeadwayS: 2.0,
    provenance: 'Camión rígido de dos ejes. Dimensiones de diseño habituales; parámetros '
      + 'de conducción, hipótesis.',
    color: '#9aa7b4',
  },
};

export const VEHICLE_CLASS_IDS: VehicleClassId[] = ['automovil', 'motocicleta', 'bus', 'camion'];

/**
 * Reparto por tipo de vehículo.
 *
 * **Esto es una hipótesis, no un aforo.** Un reparto realista exige contar en
 * el sitio, y además cambia por hora del día y por sentido. Se expone para que
 * quien lo use pueda sustituirlo por datos reales.
 */
export interface VehicleMix {
  automovil: number;
  motocicleta: number;
  bus: number;
  camion: number;
}

/**
 * Reparto por omisión.
 *
 * Carga alta de motocicletas porque es lo característico del área
 * metropolitana de Bucaramanga. Sigue siendo una hipótesis declarada.
 */
export const DEFAULT_MIX: VehicleMix = {
  automovil: 0.52,
  motocicleta: 0.34,
  bus: 0.08,
  camion: 0.06,
};

/** Elige una clase según el reparto, con el número aleatorio ya dado. */
export function pickClass(mix: VehicleMix, random: number): VehicleClassId {
  const total = VEHICLE_CLASS_IDS.reduce((sum, id) => sum + Math.max(0, mix[id]), 0);
  if (total <= 0) return 'automovil';
  let threshold = random * total;
  for (const id of VEHICLE_CLASS_IDS) {
    threshold -= Math.max(0, mix[id]);
    if (threshold <= 0) return id;
  }
  return VEHICLE_CLASS_IDS[VEHICLE_CLASS_IDS.length - 1];
}
