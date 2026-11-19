/** Llamadas del navegador al puente local `/api/plataforma` (server/plataformaBridge.ts). */

import type { Aviso, EstacionDb, HoraDisponibilidad, Medida, ProyectoFicha, ProyectoResumen, Sesion, Ventana } from './model';

const BASE = '/api/plataforma';

export interface Conexion {
  url: string;
  configurada: boolean;
  fuente: 'entorno' | 'archivo' | null;
}

export class ErrorPlataforma extends Error {
  readonly status: number;

  constructor(status: number, mensaje: string) {
    super(mensaje);
    this.status = status;
  }
}

async function pedir<T>(ruta: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${BASE}${ruta}`, { ...init, headers: { 'Content-Type': 'application/json', ...init?.headers } });
  const cuerpo = (await r.json().catch(() => ({}))) as { detail?: unknown };
  if (!r.ok) {
    const d = cuerpo.detail;
    const msg = typeof d === 'string' ? d : `La plataforma respondió ${r.status}.`;
    throw new ErrorPlataforma(r.status, msg);
  }
  return cuerpo as T;
}

export const plataforma = {
  conexion: () => pedir<Conexion>('/conexion'),
  conectar: (url: string, token: string) =>
    pedir<Conexion & { sesion: Sesion }>('/conexion', { method: 'POST', body: JSON.stringify({ url, token }) }),
  desconectar: () => pedir<Conexion>('/conexion', { method: 'DELETE' }),
  sesion: () => pedir<Sesion>('/v1/sesion'),
  proyectos: () => pedir<ProyectoResumen[]>('/v1/proyectos'),
  proyecto: (id: string) => pedir<ProyectoFicha>(`/v1/proyectos/${encodeURIComponent(id)}`),
  estaciones: () => pedir<EstacionDb[]>('/v1/estaciones'),
  ventanas: (id: string, limite = 90) => pedir<Ventana[]>(`/v1/estaciones/${encodeURIComponent(id)}/ventanas?limite=${limite}`),
  medidas: (id: string, limite = 2000) => pedir<Medida[]>(`/v1/estaciones/${encodeURIComponent(id)}/medidas?limite=${limite}`),
  disponibilidad: (id: string, horas = 24) =>
    pedir<HoraDisponibilidad[]>(`/v1/estaciones/${encodeURIComponent(id)}/disponibilidad?horas=${horas}`),
  avisos: () => pedir<Aviso[]>('/v1/avisos?abiertos=true&limite=100'),
};
