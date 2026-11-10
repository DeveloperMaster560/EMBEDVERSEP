/**
 * Circuito del armario de mando del alumbrado del puente.
 *
 * Es el prototipo de banco del armario real: el microcontrolador, la fotocelda
 * que detecta el anochecer, el pulsador de mando y un indicador por cada una
 * de las cuatro zonas de alumbrado.
 *
 * Qué representa y qué no:
 *
 * - Los cuatro indicadores representan el ESTADO de la salida de cada zona, no
 *   las luminarias. En el puente cada zona la gobierna un driver y un
 *   contactor; aquí se ve si la orden está dada o no.
 * - No hay modelo eléctrico, así que este circuito no dice nada sobre
 *   corrientes, secciones de cable ni potencia instalada. Para eso está el
 *   bloque `lighting_control` del modelo del puente, que sí lleva las
 *   potencias declaradas.
 *
 * El firmware que lo gobierna es `public/firmware/puente-alumbrado.S`.
 */

import lightingLibrary from '../../public/libraries/EMBEDVERSE-Control-Alumbrado.evcl.json';
import type { CircuitLibraryPackage, ElectronicCircuit } from './types';

/** Zonas en el orden en que el firmware las coloca en PD4..PD7. */
export const BRIDGE_ZONE_PINS = [
  { zone: 'vial', pin: 'D4', label: 'Zona vial', color: '#ffd9a0' },
  { zone: 'tirantes', pin: 'D5', label: 'Zona tirantes', color: '#4ea8ff' },
  { zone: 'torres', pin: 'D6', label: 'Zona torres', color: '#ff9f4e' },
  { zone: 'barreras', pin: 'D7', label: 'Zona barreras', color: '#7ee0c0' },
] as const;

/** Modos que el pulsador recorre, en el mismo orden que el firmware. */
export const BRIDGE_CONTROL_MODES = [
  { mode: 0, name: 'Automático', detail: 'Las cuatro zonas siguen a la fotocelda.' },
  { mode: 1, name: 'Todo encendido', detail: 'Las cuatro zonas encendidas, haya luz o no.' },
  { mode: 2, name: 'Solo vial', detail: 'La calzada sigue a la fotocelda; lo ornamental, apagado.' },
  {
    mode: 3,
    name: 'Mantenimiento',
    detail: 'Todo apagado, incluida la calzada. En una vía real es una decisión '
      + 'de mantenimiento, no una comodidad.',
  },
] as const;

export function createBridgeLightingCircuit(): ElectronicCircuit {
  const components: ElectronicCircuit['components'] = [
    {
      id: 'board', kind: 'board', label: 'Arduino Uno R3',
      description: 'Controlador del armario de mando. Las zonas salen por PD4 a PD7.',
      x: 230, y: 330,
    },
    {
      id: 'fotocelda', kind: 'custom', label: 'LDR1 · Fotocelda',
      description: 'Detección de anochecer. La salida analógica entra por A0. El umbral '
        + 'del módulo es un potenciómetro: es un ajuste del montaje, no un valor calculado.',
      libraryComponentId: 'fotocelda-lm393', x: 500, y: 150,
    },
    {
      id: 'mando', kind: 'button', label: 'SW1 · Mando',
      description: 'Recorre los cuatro modos. Pulsar pone PD2 a cero.',
      x: 500, y: 270,
    },
  ];

  const connections: ElectronicCircuit['connections'] = [
    { from: 'board', fromPin: '5V', to: 'fotocelda', toPin: 'VCC', color: '#e8a353' },
    { from: 'board', fromPin: 'GND', to: 'fotocelda', toPin: 'GND', color: '#8394a8' },
    { from: 'fotocelda', fromPin: 'AO', to: 'board', toPin: 'A0', color: '#4b9ce2' },
    { from: 'board', fromPin: 'D2', to: 'mando', toPin: '1', color: '#d184c6' },
    { from: 'mando', fromPin: '2', to: 'board', toPin: 'GND', color: '#8394a8' },
  ];

  BRIDGE_ZONE_PINS.forEach((zone, index) => {
    const y = 390 + index * 95;
    components.push({
      id: `r-${zone.zone}`, kind: 'resistor', label: `R${index + 1} · 220 Ω`,
      description: `Limitadora del indicador de la ${zone.label.toLowerCase()}.`,
      value: '220 Ω', x: 500, y,
    });
    components.push({
      id: `led-${zone.zone}`, kind: 'led', label: `${zone.label}`,
      description: `Estado de la salida ${zone.pin}. Representa la orden dada a la zona, `
        + 'no las luminarias.',
      value: zone.label, x: 700, y,
    });
    connections.push(
      { from: 'board', fromPin: zone.pin, to: `r-${zone.zone}`, toPin: '1', color: zone.color },
      { from: `r-${zone.zone}`, fromPin: '2', to: `led-${zone.zone}`, toPin: 'A', color: zone.color },
      { from: `led-${zone.zone}`, fromPin: 'K', to: 'board', toPin: 'GND', color: '#8394a8' },
    );
  });

  return {
    name: 'Armario de mando del alumbrado · Viaducto de la Novena',
    boardId: 'arduino-uno',
    components,
    connections,
    // Se reutiliza la biblioteca publicada en vez de repetir la definición de
    // la fotocelda: así hay una sola fuente para sus pines.
    componentLibraries: [lightingLibrary as CircuitLibraryPackage],
  };
}
