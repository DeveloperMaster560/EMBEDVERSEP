/**
 * El firmware de la estación (`firmware/shm-station`) en marcha, de una de
 * dos maneras:
 *  - en el ordenador: app.c compilado para este equipo con la placa simulada.
 *    Ejecuta el código del firmware, pero NO emula el STM32H743;
 *  - en Renode: el ELF para ARM en un STM32H743 emulado.
 * Lo que sale por el puerto de servicio se pasa por el contrato de datos.
 */

import { useCallback, useEffect, useState } from 'react';

import { validateStationRecord } from '../data-contract';

interface Status {
  missing: string[];
  hostAvailable: boolean;
  mode: 'renode' | 'host' | null;
  running: boolean;
  virtualSeconds: number;
  lines: number;
  faults: string[];
  error: string | null;
}

interface Line {
  n: number;
  text: string;
}

const FAULTS: { id: string; label: string }[] = [
  { id: 'sensor', label: 'Desconectar el ADXL355' },
  { id: 'pps', label: 'Quitar el PPS' },
  { id: 'tiempo', label: 'GNSS sin hora válida' },
];

const API = '/api/shm-renode';

export function RenodeChipPanel(): React.JSX.Element {
  const [status, setStatus] = useState<Status | null>(null);
  const [unreachable, setUnreachable] = useState(false);
  const [lines, setLines] = useState<Line[]>([]);
  const [busy, setBusy] = useState(false);

  const call = useCallback(async (path: string, body?: unknown) => {
    const res = await fetch(`${API}${path}`, body === undefined ? undefined : {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const data = await res.json();
    if (data.status) setStatus(data.status);
    else if (!data.error) setStatus(data);
    else setStatus((s) => (s ? { ...s, error: data.error } : s));
    return data;
  }, []);

  useEffect(() => {
    call('/status').catch(() => setUnreachable(true));
  }, [call]);

  const running = status?.running ?? false;
  useEffect(() => {
    if (!running) return undefined;
    const id = window.setInterval(() => {
      const since = lines.length ? lines[lines.length - 1].n : 0;
      call(`/lines?since=${since}`).then((d) => {
        if (d.lines?.length) setLines((old) => [...old, ...d.lines].slice(-200));
      }).catch(() => setUnreachable(true));
    }, 1000);
    return () => window.clearInterval(id);
  }, [running, lines, call]);

  const act = async (path: string, body: unknown = {}) => {
    setBusy(true);
    try {
      await call(path, body);
    } finally {
      setBusy(false);
    }
  };

  const records = lines.filter((l) => l.text.startsWith('{')).map((l) => {
    try {
      const r = JSON.parse(l.text);
      return { n: l.n, r, problems: validateStationRecord(r) };
    } catch {
      return { n: l.n, r: null, problems: ['La línea no es JSON válido.'] };
    }
  });
  const last = records[records.length - 1];
  const banners = lines.filter((l) => l.text.startsWith('#')).slice(-6);

  return (
    <section className="shm-card">
      <h3>Firmware de la estación en marcha</h3>
      {unreachable ? (
        <p className="shm-note">El servidor de la aplicación no responde: abre la app con <code>npm run dev</code>.</p>
      ) : !status ? (
        <p className="shm-note">Consultando…</p>
      ) : (
        <>
          <div className="shm-sim-controls">
            {running ? (
              <button type="button" disabled={busy} className="shm-on" onClick={() => act('/stop')}>
                Detener ({status.mode === 'host' ? 'en el ordenador' : 'Renode'})
              </button>
            ) : (
              <>
                <button type="button" disabled={busy || !status.hostAvailable} onClick={() => { setLines([]); void act('/start', { mode: 'host' }); }}>
                  Ejecutar en el ordenador
                </button>
                <button type="button" disabled={busy || status.missing.length > 0} onClick={() => { setLines([]); void act('/start', { mode: 'renode' }); }}>
                  Arrancar el chip en Renode
                </button>
              </>
            )}
            {FAULTS.map((f) => (
              <label key={f.id} className="shm-sim-clock">
                <input type="checkbox" disabled={!running || busy} checked={status.faults.includes(f.id)}
                  onChange={(e) => act('/fault', { fault: f.id, on: e.target.checked })} /> {f.label}
              </label>
            ))}
            <button type="button" disabled={!running || busy} onClick={() => act('/fault', { fault: 'impacto', on: true })}>Golpe</button>
            <span className="shm-sim-clock">t simulado = {status.virtualSeconds} s · {records.length} registros</span>
          </div>
          <p className="shm-note">
            <strong>En el ordenador</strong>: el código C del firmware (app.c, station.c) compilado para este equipo,
            con una placa simulada en lugar de los registros del chip. <strong>En Renode</strong>: el mismo firmware
            compilado para ARM, en un STM32H743 emulado.
            {status.missing.length > 0 && <> Renode aún no está disponible: falta {status.missing.join('; ')}.</>}
          </p>
          {status.error && <p className="shm-warn" style={{ marginTop: 10 }}>{status.error}</p>}
          {banners.length > 0 && (
            <pre className="shm-json" style={{ marginTop: 10 }}>{banners.map((b) => b.text).join('\n')}</pre>
          )}
          {last && (
            <>
              <p className="shm-note">
                Último registro del firmware · estados{' '}
                {(last.r?.states ?? []).map((s: string) => (
                  <span key={s} className={`shm-st ${s === 'NORMAL' ? 'shm-st-ok' : 'shm-st-bad'}`}>{s}</span>
                ))}
                · contrato de datos: {last.problems.length ? last.problems.join(' ') : 'válido'}
              </p>
              <pre className="shm-json">{JSON.stringify(last.r, null, 2)}</pre>
            </>
          )}
        </>
      )}
      <p className="shm-note">
        La microSD sale siempre como STORAGE_FAULT: su driver no está escrito y el firmware lo declara en vez de
        ocultarlo. El mapa de registros del ADXL355 está sin cotejar con la hoja de datos.
      </p>
    </section>
  );
}
