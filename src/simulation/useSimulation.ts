/**
 * Gobierno de una sesión de simulación desde la interfaz.
 *
 * Compila el proyecto con Arduino CLI, monta la sesión con el circuito que hay
 * dibujado y la hace avanzar con el reloj de la pantalla. El tiempo simulado
 * sigue al tiempo real, con un tope por paso: si la pestaña se va a segundo
 * plano y vuelve, no se intenta recuperar el retraso de golpe.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import type { BoardId, ElectronicCircuit, ProjectFile } from '../domain/types';
import { CAPABILITIES } from './avr-runner';
import { HexParseError } from './intel-hex';
import { SimulationSession, type SessionReport } from './session';
import type { ButtonDevice, PhotocellDevice } from './devices';

export type SimulationStatus = 'idle' | 'compiling' | 'running' | 'paused' | 'error';

export interface SimulationState {
  status: SimulationStatus;
  report: SessionReport | null;
  /** Salida del compilador o motivo del fallo. Nunca se oculta. */
  message: string;
  buttons: ButtonDevice[];
  photocells: PhotocellDevice[];
}

interface CompileArtifact {
  name: string;
  bytes: number;
  downloadBase64?: string;
}

interface CompileResult {
  success: boolean;
  output: string;
  error?: string;
  artifacts?: CompileArtifact[];
}

/** Periodo del lazo de refresco, en milisegundos de reloj de pantalla. */
const TICK_MS = 33;

export function useSimulation(circuit: ElectronicCircuit, boardId: BoardId, files: ProjectFile[]) {
  const [status, setStatus] = useState<SimulationStatus>('idle');
  const [report, setReport] = useState<SessionReport | null>(null);
  const [message, setMessage] = useState('');
  // Los mandos se guardan en estado, no se leen de la referencia al pintar: si
  // se derivaran de la sesión durante el renderizado, cambiar de sesión no
  // actualizaría los mandos hasta que algo más provocase un repintado.
  const [inputs, setInputs] = useState<{ buttons: ButtonDevice[]; photocells: PhotocellDevice[] }>(
    { buttons: [], photocells: [] },
  );
  const sessionRef = useRef<SimulationSession | null>(null);
  const timerRef = useRef<number | null>(null);
  const lastTickRef = useRef(0);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const tick = useCallback(() => {
    const session = sessionRef.current;
    if (!session) return;
    const now = performance.now();
    const elapsed = now - lastTickRef.current;
    lastTickRef.current = now;
    try {
      setReport(session.advance(elapsed));
    } catch (error) {
      clearTimer();
      setStatus('error');
      setMessage(error instanceof Error ? error.message : 'La ejecución se detuvo por un error.');
    }
  }, [clearTimer]);

  const startTimer = useCallback(() => {
    clearTimer();
    lastTickRef.current = performance.now();
    timerRef.current = window.setInterval(tick, TICK_MS);
  }, [clearTimer, tick]);

  /**
   * Carga un firmware ya compilado y arranca.
   *
   * Es el único camino que de verdad ejecuta algo: el motor no interpreta
   * código fuente, ejecuta el binario. Compilar es solo la forma de obtenerlo.
   */
  const load = useCallback((hex: string, origin: string) => {
    try {
      const session = SimulationSession.fromHex(hex, circuit);
      sessionRef.current = session;
      setInputs({ buttons: session.buttons, photocells: session.photocells });
      setReport(session.report());
      if (!session.simulable) {
        setStatus('error');
        setMessage(
          `${origin}\n\nEl firmware se cargó, pero ningún componente del circuito se puede `
          + 'simular. Los motivos están abajo: hasta resolverlos, ejecutar no mostraría nada.',
        );
        return;
      }
      setStatus('running');
      setMessage(`${origin} cargados.`);
      startTimer();
    } catch (error) {
      setStatus('error');
      setMessage(error instanceof HexParseError
        ? `El .hex no se puede leer. ${error.message}`
        : error instanceof Error ? error.message : 'No se pudo cargar el firmware.');
    }
  }, [circuit, startTimer]);

  /**
   * Carga un .hex que el usuario trae de fuera.
   *
   * Hace falta porque el compilador depende del sistema: en un equipo sin
   * Arduino CLI instalado esta es la única manera de simular, y además permite
   * ejecutar firmware compilado con cualquier otra herramienta.
   */
  const loadHexFile = useCallback(async (file: File) => {
    clearTimer();
    sessionRef.current = null;
    setInputs({ buttons: [], photocells: [] });
    setReport(null);
    setStatus('compiling');
    setMessage(`Leyendo ${file.name}…`);
    try {
      load(await file.text(), `${file.name} · ${file.size.toLocaleString('es-CO')} bytes`);
    } catch (error) {
      setStatus('error');
      setMessage(error instanceof Error ? error.message : 'No se pudo leer el archivo.');
    }
  }, [clearTimer, load]);

  /** Compila y arranca. Si no hay compilador, lo dice con la salida entera. */
  const start = useCallback(async () => {
    if (boardId !== 'arduino-uno') {
      setStatus('error');
      setMessage(
        `El motor ejecuta ${CAPABILITIES.mcu}. La placa de este proyecto es otra arquitectura `
        + 'y no hay emulador para ella.',
      );
      return;
    }

    clearTimer();
    sessionRef.current = null;
    setInputs({ buttons: [], photocells: [] });
    setReport(null);
    setStatus('compiling');
    setMessage('Compilando el proyecto con Arduino CLI…');

    let result: CompileResult;
    try {
      const response = await fetch('/api/compile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          boardId,
          files: files.map(({ path, content }) => ({ path, content })),
        }),
      });
      result = await response.json() as CompileResult;
      if (!response.ok || !result.success) {
        setStatus('error');
        setMessage([result.error, result.output].filter(Boolean).join('\n')
          || 'El compilador no devolvió ningún motivo.');
        return;
      }
    } catch (error) {
      setStatus('error');
      setMessage(
        (error instanceof Error ? error.message : 'No se pudo contactar al compilador local.')
        + '\n\nSin compilador no hay firmware que ejecutar: el motor no simula código fuente, '
        + 'ejecuta el binario.',
      );
      return;
    }

    const artifact = result.artifacts?.find((item) => item.name.endsWith('.hex') && item.downloadBase64);
    if (!artifact?.downloadBase64) {
      setStatus('error');
      setMessage('La compilación terminó bien pero no devolvió el .hex, así que no hay nada que cargar.');
      return;
    }

    load(atob(artifact.downloadBase64), `${artifact.name} · ${artifact.bytes.toLocaleString('es-CO')} bytes`);
  }, [boardId, clearTimer, files, load]);

  const pause = useCallback(() => {
    clearTimer();
    setStatus((current) => (current === 'running' ? 'paused' : current));
  }, [clearTimer]);

  const resume = useCallback(() => {
    if (!sessionRef.current) return;
    setStatus('running');
    startTimer();
  }, [startTimer]);

  const stop = useCallback(() => {
    clearTimer();
    sessionRef.current = null;
    setInputs({ buttons: [], photocells: [] });
    setReport(null);
    setStatus('idle');
    setMessage('');
  }, [clearTimer]);

  // Un intervalo que sobreviva al desmontaje seguiría ejecutando firmware
  // contra una sesión que ya nadie mira.
  useEffect(() => clearTimer, [clearTimer]);

  const state: SimulationState = {
    status,
    report,
    message,
    buttons: inputs.buttons,
    photocells: inputs.photocells,
  };

  return { ...state, start, loadHexFile, pause, resume, stop };
}
