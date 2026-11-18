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
  ejes: string[];
  muestreo_hz: number | null;
}

export interface EstacionDef {
  id: string;
  tipo: string;
  nombre: string;
  estado: 'diseno' | 'simulada' | 'instalada' | 'retirada';
  ubicacion?: { descripcion?: string | null };
  comunicacion?: { periodo_s?: number };
  sensores?: SensorDef[];
}

export interface ProyectoDef {
  proyecto_id: string;
  nombre: string;
  estructura: { tipo: string; nombre?: string };
  responsable_estructural: string | null;
  entidad_responsable: string | null;
  estaciones: EstacionDef[];
  criterios: { estado: 'sin_definir' | 'propuestos' | 'aprobados'; aprobados_por: string | null; umbrales: unknown[] };
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
