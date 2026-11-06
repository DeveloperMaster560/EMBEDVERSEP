import { parseBridgeSpecification } from './ai-contracts';
import type { BridgeSpecification, BridgeComponentType } from './ai-contracts';

const numberWords: Record<string, number> = {
  un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5,
  seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, once: 11,
  doce: 12, trece: 13, catorce: 14, quince: 15, dieciseis: 16,
  diecisiete: 17, dieciocho: 18, diecinueve: 19, veinte: 20,
};

function normalizedText(text: string): string {
  return text.toLocaleLowerCase('es').normalize('NFD').replace(/\p{Diacritic}/gu, '');
}

function toMeters(value: string, unit: string): number {
  const numeric = Number(value.replace(',', '.'));
  if (unit === 'cm') return numeric / 100;
  if (unit === 'mm') return numeric / 1000;
  return numeric;
}

function measurement(text: string, labels: string): number | null {
  const unit = '(mm|cm|m|metros?|centimetros?|milimetros?)';
  const number = '(\\d+(?:[.,]\\d+)?)';
  const patterns = [
    new RegExp(`(?:${labels})\\s*(?:(?:esta|queda|se encuentra)\\s+)?(?:de|es|a|:)?\\s*${number}\\s*${unit}\\b`, 'i'),
    new RegExp(`${number}\\s*${unit}\\s*(?:de\\s+)?(?:${labels})\\b`, 'i'),
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;
    const captures = match.slice(1);
    const numericValue = captures.find((item) => /^\d/.test(item));
    const unitValue = captures.find((item) => /^(mm|cm|m|metros?|centimetros?|milimetros?)$/i.test(item));
    if (numericValue && unitValue) {
      const shortUnit = unitValue.startsWith('cent') ? 'cm' : unitValue.startsWith('mili') ? 'mm' : unitValue.startsWith('metro') ? 'm' : unitValue;
      const result = toMeters(numericValue, shortUnit);
      if (Number.isFinite(result) && result > 0) return result;
    }
  }
  return null;
}

function supportMeasurement(text: string, dimension: 'ancho' | 'profundidad'): number | null {
  const unit = '(mm|cm|m|metros?|centimetros?|milimetros?)';
  const number = '(\\d+(?:[.,]\\d+)?)';
  const support = '(?:cada\\s+)?(?:los\\s+)?apoyos?';
  const patterns = [
    new RegExp(`\\b${dimension}\\s+(?:de\\s+)?${support}\\s*(?:es|mide|de|:)?\\s*${number}\\s*${unit}\\b`, 'i'),
    new RegExp(`\\b${support}\\b[^.]{0,100}?${number}\\s*${unit}\\s*(?:de\\s+)?${dimension}\\b`, 'i'),
    new RegExp(`${number}\\s*${unit}\\s*(?:de\\s+)?${dimension}\\s+(?:de\\s+)?${support}\\b`, 'i'),
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;
    const numericValue = match.slice(1).find((item) => /^\d/.test(item));
    const unitValue = match.slice(1).find((item) => /^(mm|cm|m|metros?|centimetros?|milimetros?)$/i.test(item));
    if (!numericValue || !unitValue) continue;
    const shortUnit = unitValue.startsWith('cent') ? 'cm' : unitValue.startsWith('mili') ? 'mm' : unitValue.startsWith('metro') ? 'm' : unitValue;
    const result = toMeters(numericValue, shortUnit);
    if (Number.isFinite(result) && result > 0) return result;
  }
  return null;
}

function countStayCables(text: string): number | null {
  const match = text.match(/\b(\d+|uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\s+(?:cables?|tirantes?)(?:\s+en\s+total|\s+total)\b/);
  if (!match) return null;
  const count = /^\d+$/.test(match[1]) ? Number(match[1]) : numberWords[match[1]];
  return Number.isInteger(count) && count >= 8 && count <= 400 && count % 8 === 0 ? count : null;
}

function section(text: string, title: string): string {
  const start = text.search(new RegExp(`^\\s*#{0,4}\\s*\\d*\\s*\\.?\\s*${title}\\b`, 'im'));
  if (start < 0) return '';
  const body = text.slice(start);
  const contentStart = body.indexOf('\n') + 1;
  if (contentStart === 0) return body;
  const nextHeading = body.slice(contentStart).search(/^\s*#{1,4}\s*\d+[.)]?/m);
  return nextHeading < 0 ? body : body.slice(0, contentStart + nextHeading);
}

function objectCount(text: string, label: string): number | null {
  const words = Object.keys(numberWords).sort((a, b) => b.length - a.length).join('|');
  const match = text.match(new RegExp(`\\b(\\d+|${words})\\s+${label}\\b`, 'i'));
  if (!match) return null;
  const count = /^\d+$/.test(match[1]) ? Number(match[1]) : numberWords[match[1]];
  return Number.isInteger(count) && count > 0 ? count : null;
}

function tripleDimensions(text: string, label: string): [number, number, number] | null {
  const unit = '(mm|cm|m|metros?|centimetros?|milimetros?)';
  const number = '(\\d+(?:[.,]\\d+)?)';
  const match = text.match(new RegExp(`${label}[^.\\n]{0,80}?${number}\\s*[x×]\\s*${number}\\s*[x×]\\s*${number}\\s*${unit}\\b`, 'i'));
  if (!match) return null;
  const factor = match[4].startsWith('cent') ? 0.01 : match[4].startsWith('mili') ? 0.001 : 1;
  return [Number(match[1].replace(',', '.')) * factor, Number(match[2].replace(',', '.')) * factor, Number(match[3].replace(',', '.')) * factor];
}

function pairDimensions(text: string, label: string): [number, number] | null {
  const unit = '(mm|cm|m|metros?|centimetros?|milimetros?)';
  const number = '(\\d+(?:[.,]\\d+)?)';
  const match = text.match(new RegExp(`${label}[^.\\n]{0,80}?${number}\\s*[x×]\\s*${number}\\s*${unit}\\b`, 'i'));
  if (!match) return null;
  const factor = match[3].startsWith('cent') ? 0.01 : match[3].startsWith('mili') ? 0.001 : 1;
  return [Number(match[1].replace(',', '.')) * factor, Number(match[2].replace(',', '.')) * factor];
}

function dimensionValue(text: string, label: string): number | null {
  return measurement(text, label);
}

function countSupports(text: string): { quantity: number | null; paired: boolean } {
  if (/\bsin (?:ningun[oa]? )?(?:apoyos?|pilas?|columnas?)\b/.test(text)) {
    return { quantity: 0, paired: false };
  }
  const words = Object.keys(numberWords).sort((left, right) => right.length - left.length).join('|');
  const countPattern = new RegExp(`\\b(\\d+|${words})\\s+(?:apoyos?|pilas?|columnas?)\\b`, 'i');
  const countMatch = text.match(countPattern);
  const quantity = countMatch
    ? /^\d+$/.test(countMatch[1]) ? Number(countMatch[1]) : numberWords[countMatch[1]]
    : null;
  const perSide = /\b(?:a cada lado|por lado|en cada lado)\b/.test(text);
  const paired = perSide
    || /\b(?:en pares|por pares|pares a ambos lados|a ambos lados)\b/.test(text);
  return { quantity: quantity === null ? null : perSide ? quantity * 2 : quantity, paired };
}

function componentsFor(
  text: string,
  structureType: 'beam' | 'slab' | 'cable_stayed',
  supportCount: number | null,
) {
  const selected: Record<BridgeComponentType, boolean> = {
    deck: true,
    support: structureType === 'cable_stayed' || supportCount !== 0,
    abutment: structureType === 'cable_stayed' || /\b(?:estribos?|abutments?)\b/.test(text),
    main_girder: structureType !== 'slab',
    cross_beam: structureType === 'cable_stayed' || (structureType === 'beam' && /\b(?:vigas? transversales?|diafragmas?)\b/.test(text)),
    guardrail: structureType === 'cable_stayed' || /\b(?:barandas?|barandillas?|guardarrailes?)\b/.test(text),
    tower: structureType === 'cable_stayed',
    stay_cable: structureType === 'cable_stayed',
    foundation: structureType === 'cable_stayed',
    decoration: /\b(?:decoracion|luminarias?|ornamentos?)\b/.test(text),
  };
  if (!selected.abutment && !selected.guardrail && !selected.cross_beam && !selected.tower && !selected.decoration) {
    selected.abutment = true;
    selected.guardrail = true;
  }
  return Object.entries(selected).map(([type, included]) => ({
    id: type,
    type: type as BridgeComponentType,
    included,
  }));
}

/**
 * True si el enunciado describe una edificación en vez de un puente.
 *
 * Basta con un indicio inequívoco de edificio y ninguna palabra de puente:
 * así un texto que mezcle ambos («puente peatonal de acceso al edificio») no
 * se desvía por error.
 */
function describesBuilding(text: string): boolean {
  const buildingHints =
    /\b(?:edificio|edificaci[oó]n|niveles?|pisos?|plantas?|oficinas?|aulas?|apartament|vivienda|torre de \d)\b/;
  const bridgeHints = /\b(?:puente|tablero|viaducto|pasarela|estribos?|atirantad)\b/;
  return buildingHints.test(text) && !bridgeHints.test(text);
}

export function interpretBridgePromptLocally(prompt: string): BridgeSpecification {
  const text = normalizedText(prompt);
  const requestedCableStayed = /\b(?:atirantad[oa]s?|cable[- ]estay(?:ed)?|puente de cables? inclinados)\b/.test(text);
  const structureType = requestedCableStayed
    ? 'cable_stayed'
    : /\b(?:puente de )?losa\b/.test(text) ? 'slab' : 'beam';
  const lengthM = measurement(text, 'longitud|largo') ?? (requestedCableStayed ? 300 : null);
  const widthM = measurement(text, 'ancho(?:\\s+(?:del\\s+)?(?:puente|tablero))?') ?? (requestedCableStayed ? 30 : null);
  const heightLabels = requestedCableStayed
    ? 'altura\\s+(?:del\\s+)?tablero|cota\\s+(?:del\\s+)?tablero|tablero\\s+(?:esta|queda|se\\s+encuentra|a)'
    : 'altura(?:\\s+del\\s+tablero)?|tablero';
  const towerSectionStart = text.indexOf('torres principales');
  const heightSource = requestedCableStayed
    ? (towerSectionStart >= 0 ? text.slice(0, towerSectionStart) : text)
      .replace(/\b(?:ancho|espesor)\s+(?:del\s+)?tablero\b[^.]*/g, '')
    : text;
  const parsedHeightM = measurement(heightSource, heightLabels);
  const deckHeightExplicit = /\b(?:tablero|altura)\b.{0,50}\b(?:sobre|desde|respecto al nivel de|por encima del)\s+(?:el\s+)?(?:terreno|suelo|nivel de referencia)\b/.test(text)
    || /\b(?:sobre|desde|por encima del)\s+(?:el\s+)?(?:terreno|suelo)\b/.test(text);
  const heightM = parsedHeightM ?? (requestedCableStayed ? 25 : null);
  const heightReference = deckHeightExplicit
    ? /\b(?:terreno|suelo)\b/.test(text) ? 'Terreno indicado por el usuario' : 'Referencia indicada por el usuario'
    : requestedCableStayed && parsedHeightM === null ? 'Supuesto conceptual; confirmar antes de aprobar' : null;
  const unsupportedType = /\b(?:colgante|suspension|arco|cercha|reticulad[oa])\b/.test(text);
  const supportCounts = countSupports(text);
  const quantity = requestedCableStayed ? 0 : supportCounts.quantity;
  const paired = supportCounts.paired;
  const supportDistribution = quantity === 0
    ? 'unknown'
    : paired ? 'paired_across_width'
      : /\b(?:una fila|en fila|a lo largo del puente|alineados a lo largo)\b/.test(text)
        ? 'along_length' : 'unknown';
  const questions: string[] = [];
  // Un texto de edificio encaja sin problema en los patrones de longitud y
  // ancho, así que el asistente lo aceptaría en silencio y devolvería un
  // puente absurdo. Se detecta y se redirige al módulo que corresponde.
  if (describesBuilding(text)) {
    questions.push(
      'El texto describe un edificio, no un puente. Usa la pestaña Edificación (EMBEDVERSE BUILDING STUDIO) para generar un modelo multidisciplinario.',
    );
  }
  if (unsupportedType) questions.push('La tipología indicada no está disponible en el generador local. Elige un puente de vigas, de losa o atirantado.');
  const assumptions = [
    'Interpretación local por reglas y patrones de texto; no se usó un modelo de IA ni se envió información a un servicio externo.',
  ];
  const stayCableCount = requestedCableStayed ? countStayCables(text) ?? 40 : null;
  const dimensionsSection = section(text, 'dimensiones generales');
  const deckSection = section(text, 'tablero');
  const towerSection = section(text, 'torres principales');
  const cableSection = section(text, 'sistema de atirantamiento');
  const girderSection = section(text, 'vigas');
  const foundationSection = section(text, 'cimentaciones y apoyos');
  const towerSectionSize = pairDimensions(towerSection, 'seccion transversal');
  const footingSize = tripleDimensions(foundationSection, 'dimensiones de cada zapata');
  const guardrailHeight = measurement(deckSection, 'barandas?(?: laterales)? de');
  const cableStayed = requestedCableStayed ? {
    towerHeightM: dimensionValue(towerSection, 'altura'),
    towerSpacingM: dimensionValue(towerSection, 'separacion longitudinal entre torres')
      ?? dimensionValue(dimensionsSection, 'separacion longitudinal entre torres'),
    towerSectionWidthM: towerSectionSize?.[0] ?? null,
    towerSectionDepthM: towerSectionSize?.[1] ?? null,
    stayCableDiameterM: dimensionValue(cableSection, 'diametro conceptual'),
    mainGirderCount: objectCount(girderSection, 'vigas longitudinales principales'),
    mainGirderHeightM: dimensionValue(girderSection, 'altura de seccion'),
    mainGirderWidthM: dimensionValue(girderSection, 'ancho de seccion'),
    crossBeamSpacingM: dimensionValue(girderSection, 'vigas transversales cada'),
    crossBeamWidthM: dimensionValue(girderSection, 'ancho de cada viga transversal'),
    crossBeamHeightM: dimensionValue(girderSection, 'altura de cada viga transversal'),
    foundationLengthM: footingSize?.[0] ?? null,
    foundationWidthM: footingSize?.[1] ?? null,
    foundationDepthM: footingSize?.[2] ?? null,
    guardrailHeightM: guardrailHeight,
  } : undefined;
  if (requestedCableStayed) {
    if (measurement(text, 'longitud|largo') === null) assumptions.push('Longitud inicial de 300 m asumida solo para visualizar el concepto; edítala o confírmala antes de aprobar.');
    if (measurement(text, 'ancho(?:\\s+(?:del\\s+)?(?:puente|tablero))?') === null) assumptions.push('Ancho inicial de 30 m asumido solo para visualizar el concepto; edítalo o confírmalo antes de aprobar.');
    if (parsedHeightM === null) assumptions.push('Cota inicial del tablero de 25 m sobre el terreno asumida solo para visualizar el concepto; edítala o confírmala antes de aprobar.');
    if (measurement(text, 'espesor(?:\\s+del\\s+tablero)?') === null) assumptions.push('Espesor inicial del tablero de 2 m asumido solo para visualización; no es una dimensión calculada.');
    const towerHeight = cableStayed?.towerHeightM ?? Math.max((lengthM ?? 300) * 0.25, 30);
    assumptions.push(`Se proponen dos torres portal de ${towerHeight} m sobre el tablero, cuatro zapatas y ${stayCableCount} tirantes cilíndricos distribuidos simétricamente; son proporciones gráficas, no dimensiones calculadas.`);
    if (cableStayed?.towerHeightM === null) assumptions.push('Altura de torre asumida proporcionalmente para la visualización; no se indicó en la propuesta.');
    if (cableStayed?.towerSpacingM === null) assumptions.push('Separación entre torres asumida como el 36 % de la longitud total; no se indicó en la propuesta.');
    if (cableStayed?.towerSectionWidthM === null) assumptions.push('Sección de las torres asumida proporcionalmente; no se indicó en la propuesta.');
    if (cableStayed?.stayCableDiameterM === null) assumptions.push('Diámetro de los cables asumido proporcionalmente; no se indicó en la propuesta.');
    if (cableStayed?.mainGirderCount === null) assumptions.push('Se usan cuatro vigas longitudinales conceptuales porque no se indicó su cantidad.');
    if (cableStayed?.crossBeamSpacingM === null) assumptions.push('Separación de vigas transversales asumida en 12 m para la visualización.');
    if (cableStayed?.foundationLengthM === null) assumptions.push('Dimensiones de zapatas asumidas proporcionalmente; no se indicaron en la propuesta.');
  }
  if (!/\b(?:vigas?|losa|atirantad[oa]s?|cable[- ]estay(?:ed)?)\b/.test(text)) {
    assumptions.push('Se eligió un puente de vigas porque la descripción no especificó una tipología soportada.');
  }
  if (heightM !== null && !deckHeightExplicit && !(requestedCableStayed && parsedHeightM === null)) {
    questions.push('¿La altura indicada corresponde al tablero sobre el terreno, a la altura total o a otra referencia?');
  }
  if (quantity !== null && quantity > 0 && supportDistribution === 'unknown') {
    questions.push('¿Cómo se distribuyen los apoyos: en una fila a lo largo del puente o en pares a ambos lados?');
  }

  const raw = {
    schemaVersion: 1,
    structureType,
    bridgeName: 'Puente conceptual',
    units: 'm',
    overallDimensions: {
      lengthM,
      widthM,
      heightM,
      heightMeaning: deckHeightExplicit || (requestedCableStayed && parsedHeightM === null) ? 'deck_above_ground' : 'unknown',
      heightReference,
    },
    stayCableCount,
    ...(cableStayed ? { cableStayed } : {}),
    deck: { thicknessM: measurement(text, 'espesor(?:\\s+del\\s+tablero)?') ?? (requestedCableStayed ? 2 : null) },
    supports: {
      type: /\bcolumnas?\b/.test(text) ? 'column' : /\bpilas?\b/.test(text) ? 'pier' : 'unknown',
      orientation: /\bvertical(?:es)?\b/.test(text) ? 'vertical' : 'unknown',
      distribution: supportDistribution,
      quantity,
      widthM: supportMeasurement(text, 'ancho'),
      depthM: supportMeasurement(text, 'profundidad'),
      material: /\b(?:acero|metal)\b/.test(text) ? 'steel' : /\b(?:concreto|hormigon)\b/.test(text) ? 'concrete' : 'unknown',
    },
    components: componentsFor(text, structureType, quantity),
    assumptions,
    unresolvedQuestions: questions,
    warnings: unsupportedType
      ? ['La tipología solicitada no se puede generar localmente; no se sustituirá silenciosamente por otra.']
      : [],
    generationStatus: 'needs_clarification',
    conceptualModel: true,
  };
  return parseBridgeSpecification(raw);
}
