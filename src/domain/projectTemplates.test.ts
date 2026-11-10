/**
 * Las plantillas tienen que entregar un proyecto que funcione, no un montaje
 * decorativo. Lo que se comprueba aquí es que el circuito de cada plantilla se
 * puede simular y que el del armario obedece al firmware verificado.
 */

import { describe, expect, it } from 'vitest';

import { PROJECT_TEMPLATES, templateById, templatesForBoard } from './projectTemplates';
import { bindCircuit } from '../simulation/binding';
import { SimulationSession } from '../simulation/session';

const firmware = import.meta.glob('../../public/firmware/puente-alumbrado.hex', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const hex = Object.values(firmware)[0];

describe('catálogo de plantillas', () => {
  it('todas tienen identificador único', () => {
    const ids = PROJECT_TEMPLATES.map((template) => template.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('filtra por placa', () => {
    const uno = templatesForBoard('arduino-uno').map((template) => template.id);
    const esp = templatesForBoard('esp32-devkit').map((template) => template.id);
    expect(uno).toContain('armario-puente');
    // El armario es de Arduino Uno: el motor no ejecuta ESP32.
    expect(esp).not.toContain('armario-puente');
    expect(esp.length).toBeGreaterThan(0);
  });

  it('un identificador desconocido no deja al usuario sin proyecto', () => {
    expect(templateById('no-existe').id).toBe(PROJECT_TEMPLATES[0].id);
  });

  it('ninguna entrega un archivo vacío', () => {
    for (const template of PROJECT_TEMPLATES) {
      expect(template.source('arduino-uno').trim().length).toBeGreaterThan(100);
    }
  });
});

describe('plantilla del armario del puente', () => {
  const template = templateById('armario-puente');
  const circuit = template.circuit('arduino-uno');

  it('su circuito se traza por completo', () => {
    const bound = bindCircuit(circuit);
    expect(bound.unresolved).toEqual([]);
    // Cuatro indicadores de zona, la fotocelda y el pulsador.
    expect(bound.devices).toHaveLength(6);
  });

  /**
   * Lo que de verdad importa: el circuito de la plantilla y el firmware
   * publicado tienen que entenderse. Si alguien cambia los pines en uno y no en
   * el otro, el usuario abriría un proyecto que no hace nada.
   */
  it('obedece al firmware verificado del armario', () => {
    const session = SimulationSession.fromHex(hex, circuit, { maxStepMillis: 400 });
    const fotocelda = session.photocells[0];
    const mando = session.buttons[0];
    expect(fotocelda).toBeDefined();
    expect(mando).toBeDefined();

    const encendidas = () => session.report().readings
      .filter((reading) => reading.kind === 'led' && reading.active).length;

    fotocelda.setLight(1);
    session.advance(50);
    expect(encendidas()).toBe(0);

    fotocelda.setLight(0.05);
    session.advance(50);
    expect(encendidas()).toBe(4);

    // Y el operador manda: una pulsación fuerza todo encendido con luz de día.
    fotocelda.setLight(1);
    session.advance(50);
    mando.setPressed(true);
    session.advance(80);
    mando.setPressed(false);
    session.advance(80);
    expect(encendidas()).toBe(4);
  });

  it('su código menciona los mismos pines que el circuito', () => {
    const source = template.source('arduino-uno');
    for (const pin of ['PIN_VIAL      = 4', 'PIN_TIRANTES  = 5', 'PIN_TORRES    = 6',
      'PIN_BARRERAS  = 7', 'PIN_MANDO     = 2']) {
      expect(source).toContain(pin);
    }
  });

  /**
   * El .ino es el equivalente legible del .S, que es el que se entrega
   * compilado. El código debe remitir a los dos sitios donde se comprueba eso,
   * o quien lo lea no sabría cuál manda ni dónde se verifica.
   */
  it('remite al firmware de referencia y a su prueba', () => {
    const source = template.source('arduino-uno');
    expect(source).toMatch(/puente-alumbrado\.S/);
    expect(source).toMatch(/bridge-firmware-cpp\.test\.ts/);
  });
});

describe('plantilla de práctica', () => {
  it('sigue entregando el circuito de siempre', () => {
    const circuit = templateById('practica').circuit('arduino-uno');
    const bound = bindCircuit(circuit);
    expect(bound.devices).toHaveLength(1);
    expect(bound.unresolved.map((item) => item.reason).join(' ')).toMatch(/MPU6050/);
  });

  it('avisa en el código de ESP32 de que no se simula', () => {
    expect(templateById('practica').source('esp32-devkit')).toMatch(/no se simula/);
  });
});
