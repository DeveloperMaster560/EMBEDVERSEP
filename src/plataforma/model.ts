/**
 * Lógica de la vista «Plataforma de datos»: tipos de lo que devuelve la API de
 * la plataforma y cálculos puros (sin red ni React) para poder probarlos.
 */

export type Rol = 'lectura' | 'operador' | 'ingeniero' | 'estacion' | 'admin';

export interface Sesion {
  nombre: string;
  rol: Rol;
  proyecto_id: string | null;
  station_id: string | null;
}

export interface ProyectoResumen {
  proyecto_id: string;
  nombre: string;
  tipo_estructura: 'puente' | 'edificio' | 'otro';
  estaciones_activas: number;
}

export interface SensorDef {
  id: string;
  modelo: string;
  magnitud: string;
  unidad: string;
  /** Solo en magnitudes de varios ejes (aceleración, inclinación). */
  ejes?: string[];
  muestreo_hz: number | null;
  rango?: number | null;
  rango_unidad?: string | null;
  calibracion?: string | null;
}

export type EstadoEstacion = 'diseno' | 'simulada' | 'instalada' | 'retirada';

export interface EstacionDef {
  id: string;
  tipo: string;
  nombre: string;
  estado: EstadoEstacion;
  ubicacion?: { descripcion?: string | null; elemento?: string | null; posicion?: unknown };
  hardware?: { placa?: string | null; firmware?: string | null; firmware_version?: string | null };
  comunicacion?: { protocolo?: string | null; periodo_s?: number };
  sensores?: SensorDef[];
  notas?: string | null;
}

export interface ProyectoDef {
  formato?: string;
  proyecto_id: string;
  nombre: string;
  estructura: { tipo: string; nombre?: string; modelo?: string | null };
  ubicacion?: { pais?: string; region?: string; municipio?: string; latitud?: number; longitud?: number; procedencia?: string } | null;
  institucion?: string | null;
  responsable_estructural: string | null;
  entidad_responsable: string | null;
  estaciones: EstacionDef[];
  criterios: { estado: 'sin_definir' | 'propuestos' | 'aprobados'; aprobados_por: string | null; fecha?: string | null; umbrales: unknown[] };
  notas?: string[];
}

export interface ProyectoFicha {
  proyecto_id: string;
  nombre: string;
  tipo_estructura: string;
  actualizado: string;
  definicion: ProyectoDef | null;
}

export interface EstacionDb {
  proyecto_id: string;
  station_id: string;
  tipo: string;
  nombre: string;
  simulada: boolean;
  activa: boolean;
  periodo_s: number;
  ultimo_visto: string | null;
  estado: { states?: string[] } | null;
  /** Estados de la última ventana recibida (la estación no siempre publica en «estado»). */
  ultimos_estados?: string[] | null;
}

/** Lo último que se sabe de los estados de calidad de la estación. */
export function estadosActuales(e: EstacionDb): string[] {
  return e.ultimos_estados ?? e.estado?.states ?? [];
}

/**
 * Retraso de entrega: desde que TERMINA la ventana (inicio + duración) hasta que
 * llega al servidor. Medirlo desde el inicio sumaría la propia duración.
 */
export function retrasoEntrega(v: { inicio: string; recibido: string; duracion_s: number | null }): number {
  return (Date.parse(v.recibido) - Date.parse(v.inicio)) / 1000 - (v.duracion_s ?? 0);
}

export function horaCorta(iso: string): string {
  return new Date(iso).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}

export interface Ventana {
  station_id: string;
  inicio: string;
  duracion_s: number | null;
  recibido: string;
  calidad_tiempo: string;
  estados: string[];
  muestras: number | null;
  huecos: number | null;
  saturadas: number | null;
  firmware_version: string | null;
  fuera_de_orden: boolean;
}

/** Una lectura de un sensor lento (contrato de MEDIDAS). valor null = la estación no leyó. */
export interface Medida {
  sensor_id: string;
  instante: string;
  magnitud: string;
  unidad: string;
  valor: number | null;
  error: string | null;
  calidad_tiempo: string;
}

/** Magnitudes que llegan como ventanas (registro de varios ejes); el resto llega como medidas. */
export const MAGNITUDES_DE_VENTANA = new Set(['aceleracion', 'inclinacion']);

/** Qué envía una estación según su definición: ventanas, medidas o ambas. */
export function tiposDeDatos(est: EstacionDef | undefined): { ventanas: boolean; medidas: boolean } {
  const mags = (est?.sensores ?? []).map((s) => s.magnitud);
  if (!mags.length) return { ventanas: true, medidas: false };
  return { ventanas: mags.some((m) => MAGNITUDES_DE_VENTANA.has(m)), medidas: mags.some((m) => !MAGNITUDES_DE_VENTANA.has(m)) };
}

export interface SerieSensor {
  sensor_id: string;
  magnitud: string;
  unidad: string;
  /** La lectura más reciente (puede ser null con su error). */
  ultima: Medida;
  /** Valores en orden de tiempo; null = hueco (no leyó). */
  puntos: { t: number; v: number | null }[];
}

/** Agrupa las medidas por sensor, del más antiguo al más nuevo. */
export function seriesPorSensor(medidas: Medida[]): SerieSensor[] {
  const por = new Map<string, Medida[]>();
  for (const m of medidas) (por.get(m.sensor_id) ?? por.set(m.sensor_id, []).get(m.sensor_id)!).push(m);
  return [...por.values()].map((ms) => {
    const orden = [...ms].sort((a, b) => Date.parse(a.instante) - Date.parse(b.instante));
    const u = orden[orden.length - 1];
    return { sensor_id: u.sensor_id, magnitud: u.magnitud, unidad: u.unidad, ultima: u, puntos: orden.map((m) => ({ t: Date.parse(m.instante), v: m.valor })) };
  }).sort((a, b) => a.sensor_id.localeCompare(b.sensor_id));
}

export interface HoraDisponibilidad {
  hora: string;
  ventanas: number;
  normales: number;
  sin_gnss: number;
  fuera_de_orden: number;
}

export interface Aviso {
  id: number;
  station_id: string;
  proyecto_id: string;
  categoria: string;
  nivel: 'E0' | 'E1' | 'E2' | 'E3' | 'E4';
  codigo: string;
  detalle: string;
  creado: string;
  abierto: boolean;
}

export type Enlace = 'en-linea' | 'retrasada' | 'callada' | 'nunca' | 'sin-alta';

/**
 * Estado del enlace según cuándo habló por última vez.
 * En línea: dentro de 2 periodos. Retrasada: hasta 6. Callada: más.
 * (La plataforma abre el aviso ESTACION_SILENCIOSA con su propio criterio;
 * esto es solo la lectura visual.)
 */
export function enlace(ultimoVisto: string | null, periodoS: number, ahora: number): Enlace {
  if (!ultimoVisto) return 'nunca';
  const t = Date.parse(ultimoVisto);
  if (Number.isNaN(t)) return 'nunca';
  const s = (ahora - t) / 1000;
  if (s <= 2 * periodoS) return 'en-linea';
  if (s <= 6 * periodoS) return 'retrasada';
  return 'callada';
}

export function hace(iso: string | null, ahora: number): string {
  if (!iso) return 'nunca';
  const s = Math.max(0, Math.round((ahora - Date.parse(iso)) / 1000));
  if (s < 60) return `hace ${s} s`;
  if (s < 3600) return `hace ${Math.floor(s / 60)} min`;
  if (s < 86400) return `hace ${Math.floor(s / 3600)} h`;
  return `hace ${Math.floor(s / 86400)} d`;
}

/**
 * Porcentaje de ventanas recibidas sobre las esperadas en cada hora.
 * La hora en curso solo espera las ventanas que ya debieron llegar.
 */
export function disponibilidad(horas: HoraDisponibilidad[], periodoS: number, ahora: number): { hora: string; pct: number; ventanas: number; esperadas: number }[] {
  return horas.map((h) => {
    const transcurrido = Math.min(3600, Math.max(0, (ahora - Date.parse(h.hora)) / 1000));
    const esperadas = Math.max(1, Math.floor(transcurrido / periodoS));
    return { hora: h.hora, ventanas: h.ventanas, esperadas, pct: Math.min(100, (100 * h.ventanas) / esperadas) };
  });
}

export interface FilaEstacion {
  id: string;
  nombre: string;
  tipo: string;
  /** Estado declarado en el proyecto.json; null si la base la tiene y el archivo no. */
  estadoProyecto: EstacionDef['estado'] | null;
  sensores: SensorDef[];
  db: EstacionDb | null;
  enlace: Enlace;
}

/**
 * Une lo que dice el proyecto (incluidas las estaciones en diseño, que no
 * existen en la base) con lo que la base sabe de cada una.
 */
export function filasEstaciones(def: ProyectoDef | null, db: EstacionDb[], ahora: number): FilaEstacion[] {
  const porId = new Map(db.map((e) => [e.station_id, e]));
  const filas: FilaEstacion[] = [];
  for (const e of def?.estaciones ?? []) {
    const d = porId.get(e.id) ?? null;
    porId.delete(e.id);
    filas.push({
      id: e.id, nombre: e.nombre, tipo: e.tipo, estadoProyecto: e.estado, sensores: e.sensores ?? [], db: d,
      enlace: d ? enlace(d.ultimo_visto, d.periodo_s, ahora) : 'sin-alta',
    });
  }
  for (const d of porId.values()) {
    filas.push({ id: d.station_id, nombre: d.nombre, tipo: d.tipo, estadoProyecto: null, sensores: [], db: d, enlace: enlace(d.ultimo_visto, d.periodo_s, ahora) });
  }
  return filas;
}

/** Estados de calidad de una ventana, en orden de gravedad para pintarla. */
export function gravedad(estados: string[]): 'ok' | 'aviso' | 'falla' {
  if (estados.some((s) => ['SENSOR_FAULT', 'TIME_INVALID', 'DATA_GAP', 'COMM_LOST'].includes(s))) return 'falla';
  if (estados.length === 0 || (estados.length === 1 && estados[0] === 'NORMAL')) return 'ok';
  return 'aviso';
}

export const TEXTO_ENLACE: Record<Enlace, string> = {
  'en-linea': 'en línea',
  retrasada: 'retrasada',
  callada: 'callada',
  nunca: 'nunca ha comunicado',
  'sin-alta': 'sin alta (en diseño)',
};

export const TEXTO_ESTADO: Record<EstacionDef['estado'], string> = {
  diseno: 'en diseño',
  simulada: 'simulada',
  instalada: 'instalada',
  retirada: 'retirada',
};
