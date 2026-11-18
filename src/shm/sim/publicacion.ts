/**
 * El gemelo funcional publicando en la plataforma como el proyecto
 * «novena-gemelo» (estaciones GEM-…), nunca como «novena».
 *
 * Dos cosas cambian al salir del navegador:
 *  - la identidad: SD-V2-M → GEM-SD-V2-M, y su sensor ADXL355-GEM-SD-V2-M,
 *    tal como los declara proyectos/novena-gemelo/proyecto.json;
 *  - la hora: el gemelo vive en una fecha simulada fija; se traslada a la hora
 *    real con un desfase que se fija al empezar a publicar. Por eso solo se
 *    publica a ×1: a ×5 la plataforma recibiría ventanas «del futuro».
 */

import { useEffect, useRef, useState } from 'react';

import type { StationRecord } from '../data-contract';
import type { ShmStationSimulation } from './station-sim';

export const PREFIJO = 'GEM-';
export const PROYECTO_GEMELO = 'novena-gemelo';
const ENVIO_MS = 2000;
const LOTE = 60;

export function aPlataforma(r: StationRecord, desfaseMs: number): StationRecord {
  const sid = `${PREFIJO}${r.station_id}`;
  const out: StationRecord = {
    ...r,
    station_id: sid,
    sensor_id: `ADXL355-${sid}`,
    timestamp_utc: new Date(Date.parse(r.timestamp_utc) + desfaseMs).toISOString(),
    samples_file: r.samples_file ? String(r.samples_file).replace(`/${r.station_id}/`, `/${sid}/`) : r.samples_file,
    simulated: true,
  };
  // La hora de recepción la pone la plataforma, no quien envía.
  delete out.received_utc;
  return out;
}

export interface EstadoPublicacion {
  activo: boolean;
  enviados: number;
  rechazados: number;
  ultimoProblema: string | null;
  /** Activo pero sin enviar porque la simulación no va a ×1 o está en pausa. */
  enEspera: string | null;
}

export function usePublicacionGemelo(sim: ShmStationSimulation, running: boolean, speed: number) {
  const [activo, setActivo] = useState(false);
  const [cuenta, setCuenta] = useState({ enviados: 0, rechazados: 0, ultimoProblema: null as string | null });
  const desfase = useRef(0);

  const puede = activo && running && speed === 1;

  useEffect(() => {
    if (!puede) return undefined;
    // Se ancla al reanudar: si la simulación estuvo en pausa, la plataforma ve
    // un hueco, igual que si la estación hubiera estado apagada.
    desfase.current = Date.now() - sim.nowUtcMs;
    sim.takeDelivered(); // lo anterior a empezar a publicar no sale
    const ctl = { vivo: true };
    const t = window.setInterval(async () => {
      const regs = sim.takeDelivered().map((r) => aPlataforma(r, desfase.current));
      for (let i = 0; i < regs.length && ctl.vivo; i += LOTE) {
        try {
          const resp = await fetch('/api/plataforma/publicar', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ registros: regs.slice(i, i + LOTE) }),
          });
          const b = (await resp.json().catch(() => ({}))) as { publicados?: number; rechazados?: { motivo: string }[]; detail?: string };
          if (!ctl.vivo) return;
          setCuenta((c) => ({
            enviados: c.enviados + (b.publicados ?? 0),
            rechazados: c.rechazados + (b.rechazados?.length ?? (resp.ok ? 0 : regs.length)),
            ultimoProblema: b.rechazados?.[0]?.motivo ?? b.detail ?? (resp.ok ? c.ultimoProblema : `Respuesta ${resp.status}`),
          }));
        } catch (e) {
          if (ctl.vivo) setCuenta((c) => ({ ...c, rechazados: c.rechazados + regs.length, ultimoProblema: e instanceof Error ? e.message : String(e) }));
        }
      }
    }, ENVIO_MS);
    return () => { ctl.vivo = false; window.clearInterval(t); };
  }, [puede, sim]);

  const estado: EstadoPublicacion = {
    activo,
    ...cuenta,
    enEspera: !activo ? null : !running ? 'simulación en pausa' : speed !== 1 ? 'solo se publica a ×1 (hora real)' : null,
  };
  return { estado, setActivo };
}
