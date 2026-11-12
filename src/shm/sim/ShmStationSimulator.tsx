/**
 * Banco de simulación de la estación SHM: el gemelo funcional
 * (`station-sim.ts`) corriendo sobre el esquema del sistema embebido.
 *
 * Se eligen una estación y unas fallas; el esquema marca en rojo el componente
 * afectado, y la tabla, el registro y el último JSON muestran qué hace la
 * cadena de datos con ello. No se ejecuta código del STM32.
 */

import { useCallback, useEffect, useState } from 'react';

import { ShmEmbeddedView, type CircuitFault } from '../ShmEmbeddedView';
import { RenodeChipPanel } from './RenodeChipPanel';
import { FAULTS, ShmStationSimulation, TEST_SCENARIO, type FaultId, type SimSnapshot } from './station-sim';

const TICK_MS = 100;
const SPEEDS = [1, 5, 20] as const;
const FAULT_IDS = Object.keys(FAULTS) as FaultId[];

function fmtTime(s: number): string {
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, '0')}:${(s - m * 60).toFixed(1).padStart(4, '0')}`;
}

function fmtBytes(b: number): string {
  if (b >= 1e6) return `${(b / 1e6).toFixed(1)} MB`;
  return `${(b / 1e3).toFixed(0)} kB`;
}

/** Traza de los últimos 10 s del eje vertical (sin la gravedad); los huecos cortan la línea. */
function Trace({ data }: { data: Float32Array }): React.JSX.Element {
  const W = 600;
  const H = 120;
  let max = 0;
  for (const v of data) if (Number.isFinite(v)) max = Math.max(max, Math.abs(v));
  const scale = max > 0 ? max * 1.1 : 0.01;
  const step = Math.max(1, Math.floor(data.length / W));
  let d = '';
  let pen = false;
  for (let i = 0; i < data.length; i += step) {
    const v = data[i];
    if (!Number.isFinite(v)) {
      pen = false;
      continue;
    }
    const x = (i / data.length) * W;
    const y = H / 2 - (v / scale) * (H / 2 - 12);
    d += `${pen ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`;
    pen = true;
  }
  return (
    <svg className="shm-trace" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="Aceleración vertical de los últimos 10 segundos">
      <line x1="0" y1={H / 2} x2={W} y2={H / 2} />
      {d && <path d={d} />}
      <text x="6" y="12">±{scale.toFixed(3)} m/s²</text>
      {!d && <text x={W / 2} y={H / 2 - 6} textAnchor="middle">Sin datos: hueco marcado, no ceros</text>}
    </svg>
  );
}

export function ShmStationSimulator(): React.JSX.Element {
  // La simulación es un objeto mutable; se guarda en estado (no en una ref)
  // y la vista solo lee la instantánea que `refresh` saca de ella.
  const [sim, setSim] = useState(() => new ShmStationSimulation());
  const [stationId, setStationId] = useState('SD-V2-M');
  const [view, setView] = useState<{ snap: SimSnapshot; recent: Float32Array }>(() => ({
    snap: sim.snapshot(), recent: sim.recentZ('SD-V2-M'),
  }));
  const [running, setRunning] = useState(false);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(1);

  const refresh = useCallback(
    (target: ShmStationSimulation = sim, id: string = stationId) => setView({ snap: target.snapshot(), recent: target.recentZ(id) }),
    [sim, stationId],
  );

  useEffect(() => {
    if (!running) return undefined;
    const id = window.setInterval(() => {
      sim.step((TICK_MS / 1000) * speed);
      refresh();
    }, TICK_MS);
    return () => window.clearInterval(id);
  }, [running, speed, sim, refresh]);

  const { snap, recent } = view;
  const station = snap.stations.find((s) => s.id === stationId) ?? snap.stations[0];
  const selectStation = (id: string) => {
    setStationId(id);
    refresh(sim, id);
  };

  const circuitFaults: CircuitFault[] = (station?.faults ?? []).flatMap((f) => FAULTS[f].circuit);

  const toggle = (fault: FaultId, on: boolean) => {
    sim.setFault(station.id, fault, on);
    refresh();
  };
  const reset = () => {
    const fresh = new ShmStationSimulation();
    setSim(fresh);
    setRunning(false);
    refresh(fresh);
  };

  if (!station) {
    return <p className="shm-warn">No hay vanos publicados de La Novena: sin ellos no se pueden situar las estaciones.</p>;
  }

  const record = station.lastRecord;

  return (
    <div className="shm-root">
      <p className="shm-warn">
        <strong>Gemelo funcional, no emulación.</strong> Reproduce lo que el diseño exige al firmware (200 Hz, ventanas,
        CRC-32, microSD, cola Ethernet, estados de calidad) y pasa cada registro por el mismo contrato y las mismas reglas
        que usará la plataforma. La vibración es <strong>sintética</strong>: modo de {TEST_SCENARIO.syntheticModeHz} Hz,{' '}
        {TEST_SCENARIO.dampingRatio * 100} % de amortiguamiento y respuesta a vehículos elegidos para la prueba, no
        medidos ni calculados para el viaducto. No sirve para sacar conclusiones del puente.
      </p>

      <RenodeChipPanel />

      <section className="shm-card">
        <div className="shm-sim-controls">
          <button type="button" className={running ? 'shm-on' : ''} onClick={() => setRunning((r) => !r)}>
            {running ? 'Pausar' : 'Iniciar'}
          </button>
          <button type="button" onClick={() => { sim.step(TEST_SCENARIO.windowS); refresh(); }} disabled={running}>
            +1 ventana ({TEST_SCENARIO.windowS} s)
          </button>
          {SPEEDS.map((s) => (
            <button key={s} type="button" className={speed === s ? 'shm-on' : ''} onClick={() => setSpeed(s)} aria-pressed={speed === s}>
              ×{s}
            </button>
          ))}
          <button type="button" onClick={reset}>Reiniciar</button>
          <label className="shm-sim-clock">
            Estación{' '}
            <select value={station.id} onChange={(e) => selectStation(e.target.value)}>
              {snap.stations.map((s) => <option key={s.id} value={s.id}>{s.id}{s.torsion ? ' (torsión)' : ''}</option>)}
            </select>
          </label>
          <span className="shm-sim-clock">
            t = {fmtTime(snap.timeS)} · {snap.utc.slice(11, 19)} UTC simulado · {snap.vehiclesOnBridge} vehículos en el puente ({snap.vehiclesTotal} en total)
          </span>
        </div>
      </section>

      <div className="shm-layout">
        <section className="shm-card">
          <h3>Fallas en {station.id}</h3>
          <div className="shm-faults">
            {FAULT_IDS.map((f) => (
              <label key={f}>
                {f === 'impacto' ? (
                  <button type="button" onClick={() => toggle(f, true)}>Golpe</button>
                ) : (
                  <input type="checkbox" checked={station.faults.includes(f)} onChange={(e) => toggle(f, e.target.checked)} />
                )}
                <span>
                  {FAULTS[f].label}
                  <small>{FAULTS[f].expected}</small>
                </span>
              </label>
            ))}
          </div>
        </section>

        <section className="shm-card">
          <h3>{station.id} · vertical, últimos 10 s</h3>
          <Trace data={recent} />
          <dl className="shm-dl" style={{ marginTop: 10 }}>
            <dt>Estados</dt>
            <dd>{station.states.map((s) => <span key={s} className={`shm-st ${s === 'NORMAL' ? 'shm-st-ok' : 'shm-st-bad'}`}>{s}</span>)}</dd>
            <dt>Tiempo</dt><dd>{station.timeQuality}</dd>
            <dt>Ventanas</dt><dd>{station.windows}</dd>
            <dt>microSD</dt><dd>{fmtBytes(station.storageUsedBytes)}</dd>
            <dt>Entregados / en cola</dt><dd>{station.deliveredRecords} / {station.pendingRecords}</dd>
            <dt>RMS / pico z</dt>
            <dd>{station.lastRmsZ === null ? '—' : `${station.lastRmsZ.toFixed(4)} / ${station.lastPeakZ!.toFixed(4)} m/s²`}</dd>
            <dt>Alimentación</dt><dd>{station.supplyV} V</dd>
          </dl>
          {station.notEvaluated.length > 0 && (
            <p className="shm-note">No evaluado: {station.notEvaluated.join(' ')}</p>
          )}
        </section>
      </div>

      <ShmEmbeddedView faults={circuitFaults} simulated />

      <div className="shm-layout">
        <section className="shm-card">
          <h3>Las diez estaciones</h3>
          <table className="shm-table shm-stations">
            <thead><tr><th>Estación</th><th>Estados</th><th>Entreg./cola</th></tr></thead>
            <tbody>
              {snap.stations.map((s) => (
                <tr key={s.id} className={s.id === station.id ? 'shm-row-on' : ''} onClick={() => selectStation(s.id)}>
                  <td>{s.id}</td>
                  <td>{s.states.map((x) => <span key={x} className={`shm-st ${x === 'NORMAL' ? 'shm-st-ok' : 'shm-st-bad'}`}>{x}</span>)}</td>
                  <td>{s.deliveredRecords} / {s.pendingRecords}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="shm-note">
            Clasificación estructural (E3/E4): <strong>{snap.structural.level ?? 'no se clasifica'}</strong>.{' '}
            {snap.structural.blocked ?? ''} La estación no decide nada sobre el puente.
          </p>
        </section>

        <section className="shm-card">
          <h3>Cambios de estado</h3>
          {snap.log.length === 0 ? (
            <p className="shm-note">Sin cambios todavía. Inicia la simulación e inyecta una falla.</p>
          ) : (
            <ul className="shm-log">
              {snap.log.slice(0, 40).map((e, i) => (
                <li key={`${e.timeS}-${e.stationId}-${i}`}>
                  <time>{fmtTime(e.timeS)}</time>
                  <strong>{e.stationId}</strong> → {e.states.join(', ')}
                  <div className="shm-note" style={{ margin: 0 }}>{e.detail}</div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="shm-card">
          <h3>Último registro entregado de {station.id}</h3>
          {record ? (
            <>
              <p className="shm-note" style={{ marginTop: 0 }}>
                Contrato de datos: {station.contractProblems.length === 0
                  ? 'válido.'
                  : station.contractProblems.join(' ')}
              </p>
              <pre className="shm-json">{JSON.stringify(record, null, 2)}</pre>
            </>
          ) : (
            <p className="shm-note">Aún no se ha entregado ningún registro (o el enlace está caído).</p>
          )}
        </section>
      </div>
    </div>
  );
}
