import type { BridgeObject, BridgeSceneDocument } from './types';

type Point3 = [number, number, number];
type ProjectedPoint = [number, number];
type ViewPlane = 'plan' | 'elevation' | 'end';

const sheetWidth = 1600;
const sheetHeight = 1100;

function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&apos;',
  })[character] ?? character);
}

function rotatePoint(point: Point3, rotation: Point3): Point3 {
  const [xAngle, yAngle, zAngle] = rotation;
  const [sinX, cosX] = [Math.sin(xAngle), Math.cos(xAngle)];
  const [sinY, cosY] = [Math.sin(yAngle), Math.cos(yAngle)];
  const [sinZ, cosZ] = [Math.sin(zAngle), Math.cos(zAngle)];
  const x1 = point[0];
  const y1 = point[1] * cosX - point[2] * sinX;
  const z1 = point[1] * sinX + point[2] * cosX;
  const x2 = x1 * cosY + z1 * sinY;
  const y2 = y1;
  const z2 = -x1 * sinY + z1 * cosY;
  return [x2 * cosZ - y2 * sinZ, x2 * sinZ + y2 * cosZ, z2];
}

function objectCorners(object: BridgeObject): Point3[] {
  const half = object.dimensions.map((dimension, index) => dimension * object.scale[index] / 2);
  return Array.from({ length: 8 }, (_, index) => {
    const local: Point3 = [
      (index & 1 ? 1 : -1) * half[0],
      (index & 2 ? 1 : -1) * half[1],
      (index & 4 ? 1 : -1) * half[2],
    ];
    const rotated = rotatePoint(local, object.rotation);
    return [
      rotated[0] + object.position[0],
      rotated[1] + object.position[1],
      rotated[2] + object.position[2],
    ];
  });
}

function project(point: Point3, plane: ViewPlane): ProjectedPoint {
  if (plane === 'plan') return [point[0], point[2]];
  if (plane === 'elevation') return [point[0], point[1]];
  return [point[2], point[1]];
}

function convexHull(points: ProjectedPoint[]): ProjectedPoint[] {
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (sorted.length <= 2) return sorted;
  const cross = (origin: ProjectedPoint, a: ProjectedPoint, b: ProjectedPoint) =>
    (a[0] - origin[0]) * (b[1] - origin[1]) - (a[1] - origin[1]) * (b[0] - origin[0]);
  const lower: ProjectedPoint[] = [];
  for (const point of sorted) {
    while (lower.length >= 2 && cross(lower.at(-2)!, lower.at(-1)!, point) <= 0) lower.pop();
    lower.push(point);
  }
  const upper: ProjectedPoint[] = [];
  for (const point of [...sorted].reverse()) {
    while (upper.length >= 2 && cross(upper.at(-2)!, upper.at(-1)!, point) <= 0) upper.pop();
    upper.push(point);
  }
  lower.pop();
  upper.pop();
  return [...lower, ...upper];
}

function colorFor(object: BridgeObject): string {
  if (object.name.startsWith('StayCable_')) return '#007f9f';
  if (object.name.startsWith('Tower_')) return '#145d83';
  if (object.name.includes('Girder') || object.name.includes('Beam')) return '#345b70';
  if (object.name.startsWith('Foundation_')) return '#71818a';
  if (object.name.startsWith('Abutment_')) return '#556b78';
  return object.color;
}

function projectionGeometry(object: BridgeObject, plane: ViewPlane, map: (point: ProjectedPoint) => ProjectedPoint): string {
  const corners = objectCorners(object).map((point) => map(project(point, plane)));
  const color = colorFor(object);
  const opacity = object.opacity ?? 1;
  if (object.kind === 'cylinder') {
    const axisStart = rotatePoint([0, -object.dimensions[1] * object.scale[1] / 2, 0], object.rotation);
    const axisEnd = rotatePoint([0, object.dimensions[1] * object.scale[1] / 2, 0], object.rotation);
    const start = map(project([
      axisStart[0] + object.position[0],
      axisStart[1] + object.position[1],
      axisStart[2] + object.position[2],
    ], plane));
    const end = map(project([
      axisEnd[0] + object.position[0],
      axisEnd[1] + object.position[1],
      axisEnd[2] + object.position[2],
    ], plane));
    const length = Math.hypot(end[0] - start[0], end[1] - start[1]);
    if (length < 0.1) {
      return `<circle cx="${start[0]}" cy="${start[1]}" r="2" fill="${color}" fill-opacity="${opacity}" />`;
    }
    return `<line x1="${start[0]}" y1="${start[1]}" x2="${end[0]}" y2="${end[1]}" stroke="${color}" stroke-opacity="${opacity}" stroke-width="2.4" />`;
  }
  const hull = convexHull(corners);
  if (hull.length < 3) return '';
  const points = hull.map(([x, y]) => `${x},${y}`).join(' ');
  return `<polygon points="${points}" fill="${color}" fill-opacity="${Math.min(opacity * 0.17, 0.28)}" stroke="${color}" stroke-opacity="${opacity}" stroke-width="1.5" />`;
}

function viewMarkup(
  objects: BridgeObject[],
  plane: ViewPlane,
  frame: { x: number; y: number; width: number; height: number },
  title: string,
  unit: string,
): string {
  const projected = objects.flatMap((object) => objectCorners(object).map((point) => project(point, plane)));
  const minX = Math.min(...projected.map(([x]) => x));
  const maxX = Math.max(...projected.map(([x]) => x));
  const minY = Math.min(...projected.map(([, y]) => y));
  const maxY = Math.max(...projected.map(([, y]) => y));
  const rangeX = Math.max(maxX - minX, 1);
  const rangeY = Math.max(maxY - minY, 1);
  const padding = 44;
  const scale = Math.min((frame.width - 2 * padding) / rangeX, (frame.height - 2 * padding) / rangeY);
  const offsetX = frame.x + (frame.width - rangeX * scale) / 2 - minX * scale;
  const offsetY = frame.y + (frame.height - rangeY * scale) / 2 + maxY * scale;
  const map = ([x, y]: ProjectedPoint): ProjectedPoint => [offsetX + x * scale, offsetY - y * scale];
  const geometry = objects.map((object) => projectionGeometry(object, plane, map)).join('');
  const topLeft = map([minX, maxY]);
  const bottomLeft = map([minX, minY]);
  const bottomRight = map([maxX, minY]);
  const dimensionY = Math.min(frame.y + frame.height - 12, Math.max(bottomLeft[1], bottomRight[1]) + 24);
  const verticalX = Math.max(frame.x + 12, Math.min(topLeft[0], bottomLeft[0]) - 20);
  const axisLabels = plane === 'plan' ? 'X · longitud / Z · ancho' : plane === 'elevation' ? 'X · longitud / Y · altura' : 'Z · ancho / Y · altura';
  const primaryDimension = plane === 'plan' || plane === 'elevation' ? rangeX : rangeY;
  const dimensionLine = plane === 'end'
    ? `<line x1="${verticalX}" y1="${topLeft[1]}" x2="${verticalX}" y2="${bottomLeft[1]}" class="dimension" /><text x="${verticalX - 7}" y="${(topLeft[1] + bottomLeft[1]) / 2}" class="dimension-text" text-anchor="end">${rangeY.toFixed(2)} ${escapeXml(unit)}</text>`
    : `<line x1="${bottomLeft[0]}" y1="${dimensionY}" x2="${bottomRight[0]}" y2="${dimensionY}" class="dimension" /><text x="${(bottomLeft[0] + bottomRight[0]) / 2}" y="${dimensionY - 5}" class="dimension-text" text-anchor="middle">${primaryDimension.toFixed(2)} ${escapeXml(unit)}</text>`;
  const edgeLines = plane === 'end'
    ? `<line x1="${topLeft[0]}" y1="${topLeft[1]}" x2="${verticalX}" y2="${topLeft[1]}" class="extension" /><line x1="${bottomLeft[0]}" y1="${bottomLeft[1]}" x2="${verticalX}" y2="${bottomLeft[1]}" class="extension" />`
    : `<line x1="${bottomLeft[0]}" y1="${bottomLeft[1]}" x2="${bottomLeft[0]}" y2="${dimensionY}" class="extension" /><line x1="${bottomRight[0]}" y1="${bottomRight[1]}" x2="${bottomRight[0]}" y2="${dimensionY}" class="extension" />`;
  return `<g>
    <rect x="${frame.x}" y="${frame.y}" width="${frame.width}" height="${frame.height}" class="frame" />
    <text x="${frame.x + 14}" y="${frame.y + 24}" class="view-title">${escapeXml(title)}</text>
    <text x="${frame.x + frame.width - 14}" y="${frame.y + 24}" class="axis-label" text-anchor="end">${axisLabels}</text>
    ${geometry}
    ${edgeLines}
    ${dimensionLine}
    <text x="${frame.x + 14}" y="${frame.y + frame.height - 12}" class="axis-label">Dimensiones generales · ${objects.length} objetos visibles</text>
  </g>`;
}

function titleBlock(scene: BridgeSceneDocument, objectCount: number): string {
  return `<g>
    <rect x="1050" y="806" width="500" height="226" class="title-frame" />
    <line x1="1050" y1="860" x2="1550" y2="860" class="title-line" />
    <line x1="1050" y1="914" x2="1550" y2="914" class="title-line" />
    <line x1="1050" y1="968" x2="1550" y2="968" class="title-line" />
    <text x="1070" y="838" class="title-label">PROYECTO</text>
    <text x="1070" y="852" class="title-value">${escapeXml(scene.name)}</text>
    <text x="1070" y="884" class="title-label">DOCUMENTO</text>
    <text x="1070" y="906" class="title-value">Vistas conceptuales · ${scene.bridgeType ?? 'modelo 3D'}</text>
    <text x="1070" y="938" class="title-label">ESCALA / UNIDADES</text>
    <text x="1070" y="960" class="title-value">Esquemático · coordenadas ${scene.unit} · ${objectCount} objetos</text>
    <text x="1070" y="992" class="warning">NO VALIDADO PARA CONSTRUCCIÓN</text>
    <text x="1070" y="1015" class="axis-label">Sin cálculo estructural, normativa ni cotas certificadas.</text>
  </g>`;
}

export function createBridgeDrawingSvg(scene: BridgeSceneDocument): string {
  const objects = scene.objects.filter((object) => object.visible && object.role !== 'iot');
  if (!objects.length) throw new Error('No hay geometría visible para generar las láminas.');
  const safeName = escapeXml(scene.name);
  const views = [
    viewMarkup(objects, 'elevation', { x: 50, y: 80, width: 1500, height: 330 }, 'ALZADO LONGITUDINAL', scene.unit),
    viewMarkup(objects, 'plan', { x: 50, y: 450, width: 930, height: 570 }, 'PLANTA', scene.unit),
    viewMarkup(objects, 'end', { x: 1000, y: 450, width: 500, height: 300 }, 'SECCIÓN TRANSVERSAL', scene.unit),
  ].join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="420mm" height="297mm" viewBox="0 0 ${sheetWidth} ${sheetHeight}" role="img" aria-labelledby="sheet-title sheet-description">
  <title id="sheet-title">${safeName} · planos conceptuales</title>
  <desc id="sheet-description">Lámina vectorial con alzado, planta y sección del modelo 3D. Vistas esquemáticas, no aptas para construcción.</desc>
  <style>
    text { font-family: Arial, Helvetica, sans-serif; fill: #17364b; }
    .sheet { fill: #fff; stroke: #23465d; stroke-width: 2; }
    .frame, .title-frame { fill: none; stroke: #7892a2; stroke-width: 1.2; }
    .view-title { font-size: 15px; font-weight: 700; letter-spacing: 1px; }
    .axis-label { font-size: 10px; fill: #587486; }
    .dimension { stroke: #174e6c; stroke-width: 1.1; marker-start: url(#arrow); marker-end: url(#arrow); }
    .extension { stroke: #648295; stroke-width: .8; stroke-dasharray: 4 3; }
    .dimension-text { font-size: 11px; font-weight: 700; fill: #12577a; }
    .title-line { stroke: #9aadb8; stroke-width: 1; }
    .title-label { font-size: 9px; fill: #607989; letter-spacing: 1px; }
    .title-value { font-size: 13px; font-weight: 600; }
    .warning { font-size: 13px; font-weight: 800; fill: #a12e31; letter-spacing: .5px; }
  </style>
  <defs>
    <marker id="arrow" markerWidth="7" markerHeight="7" refX="3.5" refY="3.5" orient="auto-start-reverse"><path d="M 0 0 L 7 3.5 L 0 7 z" fill="#174e6c" /></marker>
    <pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse"><path d="M 20 0 L 0 0 0 20" fill="none" stroke="#e8eef2" stroke-width=".6" /></pattern>
  </defs>
  <rect x="24" y="24" width="1552" height="1052" class="sheet" />
  <rect x="25" y="25" width="1550" height="1050" fill="url(#grid)" />
  <text x="52" y="56" font-size="21" font-weight="700">${safeName}</text>
  <text x="1548" y="56" class="axis-label" text-anchor="end">EMBEDVERSE STUDIO · DOCUMENTACIÓN CONCEPTUAL</text>
  ${views}
  ${titleBlock(scene, objects.length)}
  <text x="54" y="1050" class="warning">MODELO GEOMÉTRICO CONCEPTUAL · NO USAR PARA CONSTRUCCIÓN</text>
</svg>`;
}

export function createPrintableBridgeDrawingHtml(scene: BridgeSceneDocument): string {
  const svg = createBridgeDrawingSvg(scene);
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${escapeXml(scene.name)} · Planos conceptuales</title>
  <style>@page{size:A3 landscape;margin:0}html,body{margin:0;width:420mm;height:297mm}svg{display:block;width:420mm;height:297mm}@media screen{body{margin:24px auto;box-shadow:0 2px 18px #52616a}}@media print{body{print-color-adjust:exact;-webkit-print-color-adjust:exact}}</style></head>
  <body>${svg}<script>window.addEventListener('load',()=>window.setTimeout(()=>window.print(),300))</script></body></html>`;
}
