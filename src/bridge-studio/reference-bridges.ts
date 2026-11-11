/**
 * Obras reales documentadas.
 *
 * Un enunciado en lenguaje natural no puede llevar el reparto de vanos de una
 * obra concreta, su altura de torre de proyecto ni sus coordenadas: son datos
 * de obra, no frases que se deduzcan. Este catálogo los guarda ya cargados y
 * con su procedencia, de modo que nombrar la obra baste para reproducirla.
 *
 * Reglas que se aplican a toda ficha de este archivo:
 *
 *  1. Cada dato dimensional lleva su fuente en `sources`. Ninguno se adopta
 *     «porque parece razonable».
 *  2. Lo que las fuentes no dicen se queda en `null` y el generador lo contará
 *     como pendiente. Nunca se rellena por simetría ni por analogía.
 *  3. Las fuentes públicas no son un levantamiento. Una ficha reproduce la
 *     geometría PUBLICADA de la obra, que es un punto de partida verificable,
 *     no un gemelo digital de lo construido.
 *  4. Donde las fuentes se contradicen, se dice en `caveats` en vez de elegir
 *     en silencio.
 */

import type { BridgeSpecification } from './contracts';

export interface ReferenceBridge {
  id: string;
  /** Nombre que se muestra. */
  name: string;
  /** Cómo puede nombrarla el usuario, en minúsculas y sin tildes. */
  aliases: string[];
  /** De dónde sale cada dato. Se vuelcan en los supuestos de la solicitud. */
  sources: string[];
  /** Discrepancias entre fuentes y límites de la reproducción. */
  caveats: string[];
  specification: BridgeSpecification;
}

/** Quita tildes y pasa a minúsculas para comparar nombres escritos a mano. */
function fold(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

export const REFERENCE_BRIDGES: ReferenceBridge[] = [
  {
    id: 'viaducto-provincial-bucaramanga',
    name: 'Viaducto Provincial Alejandro Galvis Ramírez (La Novena), Bucaramanga',
    aliases: [
      'viaducto de la novena',
      'viaducto la novena',
      'puente de la novena',
      'viaducto provincial',
      'viaducto alejandro galvis',
      'viaducto carrera novena',
      'la novena',
    ],
    sources: [
      'Reparto de vanos 129,20 + 292,40 + 129,20 m y vano principal de 292,40 m: memoria del proyectista Carlos Fernández Casado S.L. y ficha de Wikipedia. La suma, 550,80 m, coincide con la longitud publicada por El Tiempo.',
      'Pilonos de 112 y 132 m de altura total, de los cuales 52 y 72 m van de cimentación a la rasante del tablero: prensa técnica. De ahí se deduce que ambos sobresalen 60 m sobre el tablero.',
      'Ancho de 30 m y 6 carriles: El Tiempo.',
      'Coordenadas 7,10817 N / −73,12984 W: base de datos Structurae.',
      'Tipología atirantada con tablero de cajón de hormigón postesado: Carlos Fernández Casado S.L.',
      'Instrumentación SHM según el diseño preliminar del área de ingenierías (11/11/2026, Planos/Diseno_SHM_Viaducto_Novena): estaciones dinámicas ADXL355 en L/4, L/2 y 3L/4 de cada vano, una duplicada a media luz para torsión, temperatura Pt100 en apoyos, referencia GNSS y gateway.',
    ],
    caveats: [
      'Las fuentes discrepan en la altura: 130 m y 132 m según el medio. Se adopta el par 112/132 m porque es el único que viene acompañado de la altura hasta el tablero (52 y 72 m) y cierra con la geometría.',
      'El modelo usa UN SOLO plano de terreno a cota 0. En la obra real el terreno cae, y por eso los dos pilonos miden distinto por debajo del tablero. Se adopta la cota del pilono más alto (72 m), que es la condición más desfavorable.',
      'El tablero real es un cajón de hormigón postesado con un eje CENTRAL de tirantes. Este generador construye vigas y dos planos laterales de tirantes: la silueta y el reparto son los de la obra, la sección transversal no.',
      'Las 7.820 luminarias LED publicadas no se modelan una a una. Cada proyector del modelo es una UNIDAD DIRECCIONABLE; cuántos nodos LED lleva dentro queda pendiente.',
      'Ninguna dimensión procede de planos de proyecto ni de un levantamiento. Son cifras publicadas, verificables pero no contrastadas en campo.',
      'Las estaciones SHM aplican la REGLA del diseño sobre los vanos publicados. El propio diseño exige planos conforme a obra y análisis modal antes de fijar posiciones. La viga instrumentada, el vano de la estación duplicada (se toma el mayor) y la ubicación del gateway y de la antena GNSS son hipótesis.',
    ],
    specification: {
      schemaVersion: 1,
      projectName: 'Viaducto Provincial Alejandro Galvis Ramírez (La Novena)',
      bridgeType: 'cable_stayed',
      units: 'm',
      lengthM: 550.8,
      widthM: 30,
      deckHeightM: 72,
      spanCount: 3,
      girderCount: null,
      lanes: 6,
      sidewalks: true,
      spanLengthsM: [129.2, 292.4, 129.2],
      towerHeightM: 60,
      instrumentationLayout: 'shm-novena-2026-11',
      site: {
        country: 'Colombia',
        region: 'Santander',
        municipality: 'Bucaramanga',
        description: 'Conecta la Calle 45 con la Carrera 9 y la Ciudadela Real de Minas',
        crosses: 'Cañadas de La Rosita y El Loro',
        latitudeDeg: 7.10817,
        longitudeDeg: -73.12984,
        coordinateSystem: 'WGS84 (grados decimales)',
        provenance: {
          country: 'fuentes públicas',
          region: 'fuentes públicas',
          municipality: 'fuentes públicas',
          description: 'prensa local (El Tiempo, El Universal)',
          crosses: 'memoria de Carlos Fernández Casado S.L.',
          latitude_deg: 'Structurae, aproximada — PENDIENTE de levantamiento',
          longitude_deg: 'Structurae, aproximada — PENDIENTE de levantamiento',
          coordinate_system: 'adoptado',
        },
      },
      disciplines: [
        'structure', 'deck', 'barriers', 'drainage', 'lighting', 'signage',
        'instrumentation', 'control',
      ],
      assumptions: [],
      questions: [],
      unrecognized: [],
    },
  },
];

/** Busca una obra de referencia nombrada en el enunciado. */
export function matchReferenceBridge(prompt: string): ReferenceBridge | null {
  const text = fold(prompt);
  let best: ReferenceBridge | null = null;
  let bestLength = 0;
  for (const bridge of REFERENCE_BRIDGES) {
    for (const alias of bridge.aliases) {
      // Se queda con el alias más largo que encaje: «viaducto de la novena»
      // debe ganar a «la novena», que podría aparecer por casualidad.
      if (text.includes(alias) && alias.length > bestLength) {
        best = bridge;
        bestLength = alias.length;
      }
    }
  }
  return best;
}

/**
 * Devuelve la especificación de la obra con su trazabilidad ya incorporada.
 *
 * Las fuentes van a `assumptions` y las discrepancias a `questions`: así
 * aparecen en pantalla antes de generar, y nadie puede presentar el modelo
 * creyendo que procede de planos de proyecto.
 */
export function specificationFor(bridge: ReferenceBridge): BridgeSpecification {
  return {
    ...bridge.specification,
    site: bridge.specification.site ? { ...bridge.specification.site } : null,
    spanLengthsM: bridge.specification.spanLengthsM
      ? [...bridge.specification.spanLengthsM]
      : null,
    disciplines: [...bridge.specification.disciplines],
    assumptions: [
      `Obra de referencia documentada: ${bridge.name}. Las dimensiones no se han interpretado del enunciado, se han cargado de su ficha.`,
      ...bridge.sources,
    ],
    questions: [...bridge.caveats],
    unrecognized: [],
  };
}
