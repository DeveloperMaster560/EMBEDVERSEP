/**
 * Puente en marcha: el firmware del armario gobernando el alumbrado y el
 * tráfico circulando por la calzada.
 *
 * Reúne las dos simulaciones y las hace avanzar con el reloj de la pantalla.
 * Las dos son deterministas por separado; aquí se las alimenta con el tiempo
 * real transcurrido, de modo que lo que se ve va al ritmo del reloj y no al de
 * los fotogramas que consiga dar la máquina.
 *
 * No hay acoplamiento físico entre ambas: el tráfico no carga la estructura y
 * el alumbrado no ilumina los vehículos. Son dos cosas que pasan a la vez
 * sobre el mismo puente, y conviene no confundir eso con un modelo acoplado.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import firmwareHex from '../../public/firmware/puente-alumbrado.hex?raw';
import { VEHICLE_CLASSES } from '../traffic/vehicles';
import { TrafficSimulation, laneLayout } from '../traffic/simulation';
import { FirmwareLightingController, type FirmwareLightingState } from './firmware-lighting';
import type { LightingControl } from './lighting-state';
import type { DeckReference } from './traffic-placement';
import type { ModelViewportHandle, TrafficRenderItem } from './ModelViewport';
import type { TrafficStats } from '../traffic/simulation';

/** Ancho de carril habitual en vía urbana, en metros. */
const LANE_WIDTH_M = 3.5;

/** Periodo del lazo de refresco, en milisegundos de reloj de pantalla. */
const TICK_MS = 40;

/**
 * Tope de tiempo por paso, en segundos.
 *
 * Si la pestaña vuelve de segundo plano con medio minuto acumulado, se
 * descarta el retraso en vez de intentar recuperarlo: simular treinta
 * segundos de golpe bloquearía el hilo.
 */
const MAX_STEP_S = 0.25;

export interface BridgeSimulationOptions {
  control: LightingControl | null;
  /** Carriles por sentido. Si el modelo no lo declara, lo decide quien llama. */
  lanesPerDirection?: number;
  /** Intensidad por carril, en vehículos por hora. */
  flowVehPerHour?: number;
  /** Límite de velocidad del puente, en km/h, o null si no se declara. */
  speedLimitKmh?: number | null;
  seed?: number;
  /**
   * Luz que ve la fotocelda al arrancar, de 0 a 1.
   *
   * Hace falta pasarla: el modelo de la fotocelda arranca a plena luz, y si no
   * se fija, el deslizador de la interfaz diría una cosa y el firmware vería
   * otra.
   */
  initialLight?: number;
}

export interface BridgeSimulationState {
  running: boolean;
  lighting: FirmwareLightingState | null;
  traffic: TrafficStats | null;
  /** Referencia del tablero medida del modelo, o null si no se pudo medir. */
  deck: DeckReference | null;
  /** Por qué no hay tráfico, cuando no lo hay. */
  trafficNote: string | null;
}

export function useBridgeSimulation(
  viewportRef: { current: ModelViewportHandle | null },
  options: BridgeSimulationOptions,
) {
  const {
    control, lanesPerDirection = 2, flowVehPerHour = 700,
    speedLimitKmh = null, seed = 2026, initialLight = 1,
  } = options;

  const [running, setRunning] = useState(false);
  const [lighting, setLighting] = useState<FirmwareLightingState | null>(null);
  const [traffic, setTraffic] = useState<TrafficStats | null>(null);
  const [deck, setDeck] = useState<DeckReference | null>(null);
  const [trafficNote, setTrafficNote] = useState<string | null>(null);

  const lightingRef = useRef<FirmwareLightingController | null>(null);
  const trafficRef = useRef<TrafficSimulation | null>(null);
  const timerRef = useRef<number | null>(null);
  const lastTickRef = useRef(0);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  /** Pasa la circulación al visor para que la dibuje. */
  const paint = useCallback(() => {
    const viewport = viewportRef.current;
    const simulation = trafficRef.current;
    if (!viewport) return;
    if (!simulation) {
      viewport.renderTraffic(null);
      return;
    }
    const laneById = new Map(simulation.lanes.map((lane) => [lane.id, lane]));
    const items: TrafficRenderItem[] = [];
    for (const vehicle of simulation.all) {
      const spec = VEHICLE_CLASSES[vehicle.classId];
      const lane = laneById.get(vehicle.laneId);
      if (!lane) continue;
      items.push({
        id: vehicle.id,
        classId: vehicle.classId,
        positionM: vehicle.positionM,
        offsetM: lane.offsetM,
        lengthM: spec.lengthM,
        widthM: spec.widthM,
        heightM: spec.heightM,
        color: spec.color,
      });
    }
    viewport.renderTraffic({ items });
  }, [viewportRef]);

  const tick = useCallback(() => {
    const now = performance.now();
    const elapsedS = Math.min(MAX_STEP_S, (now - lastTickRef.current) / 1000);
    lastTickRef.current = now;

    if (lightingRef.current) setLighting(lightingRef.current.advance(elapsedS * 1000));
    if (trafficRef.current) {
      trafficRef.current.advance(elapsedS);
      setTraffic(trafficRef.current.stats());
      paint();
    }
  }, [paint]);

  const start = useCallback(() => {
    clearTimer();

    lightingRef.current = new FirmwareLightingController(firmwareHex, control);
    lightingRef.current.setLight(initialLight);
    setLighting(lightingRef.current.state());

    const reference = viewportRef.current?.deckReference() ?? null;
    setDeck(reference);
    if (reference) {
      // Los carriles se reparten sobre el ancho MEDIDO del tablero. Si no cabe
      // la calzada doble pedida, se reduce en vez de sacar vehículos del borde.
      const fit = Math.max(1, Math.floor(reference.widthM / (LANE_WIDTH_M * 2)));
      const perDirection = Math.min(lanesPerDirection, fit);
      trafficRef.current = new TrafficSimulation({
        deckLengthM: reference.lengthM,
        lanes: laneLayout(perDirection, LANE_WIDTH_M, flowVehPerHour),
        speedLimitKmh,
        seed,
      });
      setTraffic(trafficRef.current.stats());
      setTrafficNote(perDirection < lanesPerDirection
        ? `El tablero mide ${reference.widthM.toFixed(1)} m de ancho: caben `
          + `${perDirection} carriles por sentido, no ${lanesPerDirection}.`
        : null);
    } else {
      trafficRef.current = null;
      setTraffic(null);
      setTrafficNote(
        'No se pudo medir la calzada del modelo, así que no se dibuja tráfico. '
        + 'Colocar vehículos sin esa medida los dejaría flotando.',
      );
    }

    setRunning(true);
    lastTickRef.current = performance.now();
    timerRef.current = window.setInterval(tick, TICK_MS);
  }, [clearTimer, control, flowVehPerHour, initialLight, lanesPerDirection, seed, speedLimitKmh, tick, viewportRef]);

  const stop = useCallback(() => {
    clearTimer();
    lightingRef.current = null;
    trafficRef.current = null;
    setRunning(false);
    setLighting(null);
    setTraffic(null);
    viewportRef.current?.renderTraffic(null);
  }, [clearTimer, viewportRef]);

  /** Mantener o soltar el pulsador del armario, como haría el operador. */
  const setPressed = useCallback((pressed: boolean) => {
    lightingRef.current?.setPressed(pressed);
  }, []);

  /** Luz ambiente que ve la fotocelda, de 0 (noche cerrada) a 1 (pleno día). */
  const setLight = useCallback((light: number) => {
    lightingRef.current?.setLight(light);
  }, []);

  // Un intervalo que sobreviva al desmontaje seguiría ejecutando firmware y
  // moviendo coches contra una escena que ya no existe.
  useEffect(() => clearTimer, [clearTimer]);

  const state: BridgeSimulationState = { running, lighting, traffic, deck, trafficNote };
  return { ...state, start, stop, setPressed, setLight };
}
