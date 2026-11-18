/**
 * Proyectos SHM que conoce la app: los mismos `proyectos/<id>/proyecto.json`
 * que importa la plataforma. Vite los incorpora al compilar (y los recarga al
 * editarlos con `npm run dev`).
 *
 * La comprobación de aquí es la mínima para poder mostrarlos; la que manda es
 * la de la plataforma (`shm_plataforma/proyecto.py`), que se niega a arrancar
 * con un proyecto inválido.
 */

import type { EstacionDef, ProyectoDef } from '../plataforma/model';

export const FORMATO = 'embedverse-proyecto-shm/1';

/** Modelo de La Novena: el único con el que funciona el gemelo funcional (su geometría es la de ese puente). */
export const MODELO_NOVENA = '../../Planos/viaducto-novena-solicitud.json';

export interface ProyectoCargado {
  carpeta: string;
  def: ProyectoDef | null;
  problemas: string[];
}

export function revisar(d: unknown): string[] {
  if (!d || typeof d !== 'object') return ['No es un objeto JSON.'];
  const p = d as Partial<ProyectoDef>;
  const out: string[] = [];
  if (p.formato !== FORMATO) out.push(`«formato» debe ser «${FORMATO}».`);
  if (typeof p.proyecto_id !== 'string' || !p.proyecto_id) out.push('Falta «proyecto_id».');
  if (typeof p.nombre !== 'string' || !p.nombre) out.push('Falta «nombre».');
  if (!p.estructura || typeof p.estructura.tipo !== 'string') out.push('Falta «estructura.tipo».');
  if (!Array.isArray(p.estaciones)) out.push('«estaciones» debe ser una lista.');
  if (!p.criterios || typeof p.criterios !== 'object') out.push('Falta «criterios».');
  return out;
}

export function cargarProyectos(archivos: Record<string, unknown>): ProyectoCargado[] {
  return Object.entries(archivos)
    .map(([ruta, mod]) => {
      const carpeta = ruta.split('/').at(-2) ?? ruta;
      const d = (mod as { default?: unknown })?.default ?? mod;
      const problemas = revisar(d);
      if (!problemas.length && (d as ProyectoDef).proyecto_id !== carpeta) {
        problemas.push(`«proyecto_id» («${(d as ProyectoDef).proyecto_id}») debe coincidir con la carpeta («${carpeta}»).`);
      }
      return { carpeta, def: problemas.length ? null : (d as ProyectoDef), problemas };
    })
    .sort((a, b) => a.carpeta.localeCompare(b.carpeta));
}

export const PROYECTOS_SHM: ProyectoCargado[] = cargarProyectos(
  import.meta.glob('../../proyectos/*/proyecto.json', { eager: true }),
);

export function buscarProyecto(id: string | undefined, lista = PROYECTOS_SHM): ProyectoDef | null {
  if (!id) return null;
  return lista.find((p) => p.def?.proyecto_id === id)?.def ?? null;
}

export function admiteGemelo(def: ProyectoDef | null): boolean {
  return def?.estructura.modelo === MODELO_NOVENA;
}

export const TEXTO_ESTRUCTURA: Record<string, string> = {
  puente: 'Puente',
  edificio: 'Edificio',
};

export const TEXTO_ESTADO_ESTACION: Record<EstacionDef['estado'], string> = {
  diseno: 'en diseño',
  simulada: 'simulada',
  instalada: 'instalada',
  retirada: 'retirada',
};

/** Lo que falta para que el proyecto pase de diseño a operación: nada se rellena por defecto. */
export function pendientes(def: ProyectoDef): string[] {
  const out: string[] = [];
  if (!def.responsable_estructural) out.push('Ingeniero estructural responsable');
  if (!def.entidad_responsable) out.push('Entidad responsable de la estructura');
  if (def.criterios.estado !== 'aprobados') out.push('Umbrales aprobados y firmados');
  const sinUbicar = def.estaciones.filter((e) => e.estado !== 'retirada' && !e.ubicacion?.elemento).length;
  if (sinUbicar) out.push(`Ubicación exacta de ${sinUbicar} ${sinUbicar === 1 ? 'estación' : 'estaciones'}`);
  const sinCal = def.estaciones.flatMap((e) => e.sensores ?? []).filter((s) => !s.calibracion).length;
  if (sinCal) out.push(`Calibración de ${sinCal} ${sinCal === 1 ? 'sensor' : 'sensores'}`);
  return out;
}
