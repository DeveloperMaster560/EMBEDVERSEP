/**
 * Panel de simulación del laboratorio.
 *
 * Muestra lo que el firmware está haciendo con los componentes del circuito y
 * permite accionar las entradas: pulsar un botón, variar la luz que ve una
 * fotocelda. Lo que no se puede simular aparece también, con el motivo, porque
 * un panel que solo enseña lo que funciona engaña sobre el alcance.
 */

import { useEffect, useRef, useState } from 'react';
import { CircleDot, Pause, Play, Square, Terminal, TriangleAlert, Upload, Zap } from 'lucide-react';

import { CAPABILITIES } from './avr-runner';
import type { DeviceReading } from './devices';
import type { SimulationStatus } from './useSimulation';
import type { ButtonDevice, PhotocellDevice } from './devices';
import type { SessionReport } from './session';

const STATUS_LABEL: Record<SimulationStatus, string> = {
  idle: 'Detenido',
  compiling: 'Compilando',
  running: 'Ejecutando',
  paused: 'En pausa',
  error: 'Detenido por error',
};

function DeviceRow({ reading }: { reading: DeviceReading }) {
  return (
    <li className={`sim-device ${reading.active ? 'on' : 'off'}`}>
      <span className="sim-device-dot" aria-hidden="true" />
      <span className="sim-device-body">
        <strong>{reading.label}</strong>
        <small>{reading.detail}</small>
      </span>
      {reading.duty !== null && reading.duty > 0.001 && reading.duty < 0.999 && (
        <span className="sim-device-duty">{(reading.duty * 100).toFixed(0)} %</span>
      )}
    </li>
  );
}

export function SimulationPanel({
  status, report, message, buttons, photocells,
  onStart, onLoadHexFile, onPause, onResume, onStop,
}: {
  status: SimulationStatus;
  report: SessionReport | null;
  message: string;
  buttons: ButtonDevice[];
  photocells: PhotocellDevice[];
  onStart: () => void;
  onLoadHexFile: (file: File) => void;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
}) {
  // Accionar una entrada cambia el objeto del dispositivo, no el estado de
  // React. Mientras corre, el refresco periódico ya repinta; en pausa hace
  // falta este empujón para que el mando no parezca muerto.
  const [, nudge] = useState(0);
  const [light, setLight] = useState<Record<string, number>>({});
  const [threshold, setThreshold] = useState<Record<string, number>>({});
  const serialRef = useRef<HTMLPreElement>(null);
  const hexInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const node = serialRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [report?.serial]);

  const running = status === 'running';
  const active = running || status === 'paused';

  return (
    <section className="sim-panel" aria-label="Simulación del circuito">
      <header className="sim-panel-head">
        <div className="sim-status">
          <span className={`sim-status-dot ${status}`} aria-hidden="true" />
          <div>
            <strong>{STATUS_LABEL[status]}</strong>
            <small>
              {report
                ? `${report.millis.toFixed(1)} ms simulados · ${report.cycles.toLocaleString('es-CO')} ciclos`
                : `${CAPABILITIES.mcu} a ${(CAPABILITIES.clockHz / 1e6).toFixed(0)} MHz`}
            </small>
          </div>
        </div>
        <div className="sim-controls">
          {!active && (
            <>
              <button type="button" className="sim-primary" onClick={onStart} disabled={status === 'compiling'}>
                <Zap size={14} /> {status === 'compiling' ? 'Compilando…' : 'Compilar y simular'}
              </button>
              {/* El compilador depende del sistema; un .hex ya compilado, no. */}
              <button type="button" onClick={() => hexInputRef.current?.click()} title="Ejecutar un firmware .hex ya compilado">
                <Upload size={13} /> Cargar .hex
              </button>
              <input
                ref={hexInputRef} type="file" accept=".hex,text/plain" hidden
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  // Se limpia el valor para que elegir el mismo archivo otra vez vuelva a disparar.
                  event.target.value = '';
                  if (file) onLoadHexFile(file);
                }}
              />
            </>
          )}
          {running && <button type="button" onClick={onPause}><Pause size={14} /> Pausar</button>}
          {status === 'paused' && <button type="button" onClick={onResume}><Play size={14} /> Continuar</button>}
          {active && <button type="button" onClick={onStop}><Square size={13} /> Detener</button>}
        </div>
      </header>

      {message && (
        <pre className={`sim-message ${status === 'error' ? 'error' : ''}`}>{message}</pre>
      )}

      {report && (
        <div className="sim-body">
          <div className="sim-column">
            <div className="sim-section-title">
              <CircleDot size={13} /> <span>Componentes</span>
              <small>{report.readings.length}</small>
            </div>
            {report.readings.length > 0 ? (
              <ul className="sim-devices">
                {report.readings.map((reading) => <DeviceRow key={reading.id} reading={reading} />)}
              </ul>
            ) : (
              <p className="sim-empty">Ningún componente del circuito tiene modelo de simulación.</p>
            )}

            {(buttons.length > 0 || photocells.length > 0) && (
              <>
                <div className="sim-section-title"><span>Entradas</span><small>las accionas tú</small></div>
                <div className="sim-inputs">
                  {buttons.map((button) => (
                    <button
                      key={button.id}
                      type="button"
                      className="sim-press"
                      onPointerDown={() => { button.setPressed(true); nudge((n) => n + 1); }}
                      onPointerUp={() => { button.setPressed(false); nudge((n) => n + 1); }}
                      onPointerLeave={() => { button.setPressed(false); nudge((n) => n + 1); }}
                    >
                      Mantener {button.label}
                    </button>
                  ))}
                  {photocells.map((cell) => {
                    const value = light[cell.id] ?? 100;
                    const level = threshold[cell.id] ?? Math.round(cell.threshold * 100);
                    return (
                      <div key={cell.id} className="sim-slider">
                        <label>
                          <span>{cell.label} · luz {value} %</span>
                          <input
                            type="range" min={0} max={100} value={value}
                            onChange={(event) => {
                              const next = Number(event.target.value);
                              setLight((current) => ({ ...current, [cell.id]: next }));
                              cell.setLight(next / 100);
                              nudge((n) => n + 1);
                            }}
                          />
                        </label>
                        <label>
                          {/* En el módulo real este ajuste es un potenciómetro;
                              aquí también es una decisión del montaje, no un
                              valor que el sistema calcule. */}
                          <span>Umbral del potenciómetro {level} %</span>
                          <input
                            type="range" min={0} max={100} value={level}
                            onChange={(event) => {
                              const next = Number(event.target.value);
                              setThreshold((current) => ({ ...current, [cell.id]: next }));
                              cell.setThreshold(next / 100);
                              nudge((n) => n + 1);
                            }}
                          />
                        </label>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>

          <div className="sim-column">
            <div className="sim-section-title"><Terminal size={13} /> <span>Puerto serie</span></div>
            <pre className="sim-serial" ref={serialRef}>
              {report.serial || 'El firmware no ha escrito nada por el puerto serie.'}
            </pre>

            {report.unresolved.length > 0 && (
              <>
                <div className="sim-section-title warn">
                  <TriangleAlert size={13} /> <span>Sin simular</span>
                  <small>{report.unresolved.length}</small>
                </div>
                <ul className="sim-unresolved">
                  {report.unresolved.map((item) => (
                    <li key={item.componentId}>
                      <strong>{item.label}</strong>
                      <small>{item.reason}</small>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </div>
      )}

      <footer className="sim-foot">
        Se emula {CAPABILITIES.mcu}: {CAPABILITIES.supported.join(', ')}.
        No se emula: {CAPABILITIES.unsupported.join(', ')}.
      </footer>
    </section>
  );
}
