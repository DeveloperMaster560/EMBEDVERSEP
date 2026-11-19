/**
 * Panel del puente en marcha.
 *
 * Aquí el usuario manda de verdad: el pulsador que acciona es el del armario
 * de control, y lo que se enciende en el modelo lo enciende el firmware
 * ejecutándose sobre un ATmega328P emulado.
 *
 * Se dice con claridad qué es simulación y qué no, porque en la misma pantalla
 * conviven las dos cosas.
 */

import { Car, Cpu, Lightbulb, Play, Power, Square } from 'lucide-react';

import { BRIDGE_CONTROL_MODES } from '../domain/bridgeLightingCircuit';
import { VEHICLE_CLASSES, VEHICLE_CLASS_IDS } from '../traffic/vehicles';
import type { FirmwareLightingState } from './firmware-lighting';
import type { DeckReference } from './traffic-placement';
import type { TrafficStats } from '../traffic/simulation';

const number = (value: number, digits = 0) =>
  value.toLocaleString('es-CO', { maximumFractionDigits: digits });

export function BridgeSimulationPanel({
  running, lighting, traffic, deck, trafficNote, light,
  onStart, onStop, onPressed, onLight,
  firmwareName, firmwareError, onFirmwareFile, onReferenceFirmware,
}: {
  /** Firmware que se ejecuta (o se ejecutará al poner en marcha). */
  firmwareName?: string;
  /** Por qué el firmware elegido no se puede ejecutar. */
  firmwareError?: string | null;
  /** El usuario elige su propio .hex (el que descargó de «Compilar» con Arduino Uno). */
  onFirmwareFile?: (file: File) => void;
  /** Volver al firmware de referencia del armario. */
  onReferenceFirmware?: () => void;
  running: boolean;
  lighting: FirmwareLightingState | null;
  traffic: TrafficStats | null;
  deck: DeckReference | null;
  trafficNote: string | null;
  light: number;
  onStart: () => void;
  onStop: () => void;
  onPressed: (pressed: boolean) => void;
  onLight: (light: number) => void;
}) {
  return (
    <section className="bs-section">
      <h3>El puente en marcha</h3>
      <p className="bs-note">
        Esto <strong>sí es una simulación</strong>: el alumbrado lo gobierna el firmware
        del armario de control, ejecutándose sobre un ATmega328P emulado, y los vehículos
        siguen el modelo de seguimiento IDM. No hay modelo eléctrico ni cargas de tráfico
        sobre la estructura: son dos cosas que ocurren a la vez sobre el mismo puente, no
        un modelo acoplado.
      </p>

      {onFirmwareFile && (
        <div className="bsim-firmware">
          <p className="bs-note">
            <Cpu size={12} /> Firmware: <strong>{firmwareName}</strong>
          </p>
          {!running && (
            <div className="bsim-controls">
              <label className="bsim-file">
                Usar mi firmware (.hex de Arduino Uno)
                <input
                  type="file"
                  accept=".hex,.bin,.uf2,.elf"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) onFirmwareFile(file);
                    event.target.value = '';
                  }}
                />
              </label>
              {onReferenceFirmware && (
                <button type="button" onClick={onReferenceFirmware}>Firmware de referencia</button>
              )}
            </div>
          )}
          <p className="bs-note">
            El armario espera: zonas en D4 (vial), D5 (tirantes), D6 (torres) y D7 (barreras),
            fotocelda en A0 y pulsador en D2 a masa. Solo se ejecuta el .hex del Arduino Uno:
            no hay emulador de ESP32 en el navegador.
          </p>
        </div>
      )}
      {firmwareError && <p className="bs-note bsim-error" role="alert">{firmwareError}</p>}

      <div className="bsim-controls">
        {running
          ? <button type="button" onClick={onStop}><Square size={13} /> Detener</button>
          : <button type="button" className="bsim-primary" onClick={onStart}>
              <Play size={13} /> Poner en marcha
            </button>}
      </div>

      {running && lighting && (
        <>
          <div className="bsim-mode">
            <span className="bsim-mode-tag">Modo {lighting.mode}</span>
            <div>
              <strong>{lighting.modeName}</strong>
              <small>{lighting.modeDetail}</small>
            </div>
          </div>

          <button
            type="button"
            className="bsim-press"
            onPointerDown={() => onPressed(true)}
            onPointerUp={() => onPressed(false)}
            onPointerLeave={() => onPointerLeaveSafe(onPressed)}
          >
            <Power size={14} /> Mantener el pulsador del armario
          </button>
          <p className="bs-note bsim-hint">
            Cada pulsación avanza un modo:{' '}
            {BRIDGE_CONTROL_MODES.map((mode) => mode.name).join(' → ')} → y vuelve a empezar.
          </p>

          <label className="bs-slider">
            Luz que ve la fotocelda <strong>{Math.round(light * 100)} %</strong>
            <input
              type="range" min={0} max={100} value={Math.round(light * 100)}
              onChange={(event) => onLight(Number(event.target.value) / 100)}
            />
          </label>

          <div className="bsim-zones">
            {lighting.zones.map((zone) => (
              <div
                key={zone.zone}
                className={`bsim-zone ${zone.energized && zone.presentInModel ? 'on' : 'off'}`}
              >
                <span className="bsim-zone-dot" aria-hidden="true" />
                <div>
                  <strong>{zone.modelLabel ?? zone.label}</strong>
                  <small>
                    {zone.pin} ·{' '}
                    {zone.presentInModel
                      ? <>
                          {zone.fixtureCount} luminarias
                          {zone.energized && zone.duty !== null && zone.duty > 0 && zone.duty < 1
                            ? ` · PWM ${Math.round(zone.duty * 100)} %`
                            : ''}
                          {zone.connectedPowerW !== null
                            ? ` · ${number(zone.connectedPowerW)} W declarados`
                            : ' · potencia no declarada'}
                        </>
                      // Salida energizada que no ilumina nada: hay que decirlo,
                      // no pintar una zona encendida que este puente no tiene.
                      : <>{zone.energized ? 'salida activa, pero ' : ''}esta zona no existe
                          en el modelo cargado</>}
                  </small>
                </div>
              </div>
            ))}
          </div>

          {lighting.firmwareWarnings.length > 0 && (
            <ul className="bs-validation bsim-warnings" role="status">
              {lighting.firmwareWarnings.map((warning) => <li key={warning}>⚠ {warning}</li>)}
            </ul>
          )}

          <ul className="bs-validation">
            <li>
              <Lightbulb size={12} /> Encendidas <strong>{lighting.litCount}</strong> luminarias
              {lighting.totalPowerW !== null
                ? <> · potencia conectada <strong>{number(lighting.totalPowerW / 1000, 2)} kW</strong></>
                : <> · potencia <strong>no determinada</strong></>}
            </li>
            {lighting.powerNote && <li>{lighting.powerNote}</li>}
            {lighting.energizedWithoutModelZone.length > 0 && (
              <li>
                El firmware tiene activas salidas que este modelo no usa:{' '}
                {lighting.energizedWithoutModelZone.join(', ')}. No encienden nada.
              </li>
            )}
            {lighting.unmatchedModelZones.length > 0 && (
              <li>
                Este firmware no gobierna: {lighting.unmatchedModelZones.join(', ')}.
              </li>
            )}
          </ul>

          <details className="bsim-serial">
            <summary>Puerto serie del armario</summary>
            <pre>{lighting.serial || 'Sin datos todavía.'}</pre>
          </details>
        </>
      )}

      {running && (
        <>
          <div className="bs-section-divider" />
          <div className="bsim-mode">
            <span className="bsim-mode-tag"><Car size={13} /></span>
            <div>
              <strong>Tráfico vehicular</strong>
              <small>
                {deck
                  ? `Calzada medida del modelo: ${number(deck.lengthM, 1)} m de largo por `
                    + `${number(deck.widthM, 1)} m de ancho, según la ${deck.source}.`
                  : 'Sin medida de calzada.'}
              </small>
            </div>
          </div>

          {trafficNote && <p className="bs-note">{trafficNote}</p>}

          {traffic && (
            <>
              <div className="bsim-zones">
                {VEHICLE_CLASS_IDS.map((id) => (
                  <div key={id} className="bsim-zone on">
                    <span
                      className="bsim-zone-dot"
                      style={{ background: VEHICLE_CLASSES[id].color }}
                      aria-hidden="true"
                    />
                    <div>
                      <strong>{traffic.countByClass[id]} {VEHICLE_CLASSES[id].label}</strong>
                      <small>
                        {number(VEHICLE_CLASSES[id].lengthM, 1)} m ·{' '}
                        {VEHICLE_CLASSES[id].desiredSpeedKmh} km/h deseados
                      </small>
                    </div>
                  </div>
                ))}
              </div>
              <ul className="bs-validation">
                <li>
                  <strong>{traffic.count}</strong> vehículos sobre el tablero ·{' '}
                  {traffic.completed} han cruzado
                  {traffic.meanSpeedKmh !== null && (
                    <> · velocidad media <strong>{number(traffic.meanSpeedKmh, 1)} km/h</strong></>
                  )}
                </li>
                {traffic.densityVehPerKmLane !== null && (
                  <li>
                    Densidad <strong>{number(traffic.densityVehPerKmLane, 1)}</strong> veh/km·carril
                  </li>
                )}
              </ul>
            </>
          )}

          <p className="bs-note">
            Las dimensiones de los vehículos y el reparto por tipo son{' '}
            <strong>hipótesis declaradas</strong>, no aforos de este puente: nadie ha
            contado vehículos aquí. No hay cambio de carril, ni adelantamiento, ni
            circulación entre carriles. Para capacidad o cargas de diseño hacen falta
            aforos reales y la norma que corresponda.
          </p>
        </>
      )}
    </section>
  );
}

/**
 * Soltar el pulsador si el puntero se va del botón.
 *
 * Sin esto, arrastrar fuera del botón dejaría el pulsador hundido para siempre
 * y el armario cambiando de modo sin que nadie lo tocara.
 */
function onPointerLeaveSafe(onPressed: (pressed: boolean) => void): void {
  onPressed(false);
}
