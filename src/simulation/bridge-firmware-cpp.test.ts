/**
 * El C++ del armario tiene que comportarse como el ensamblador verificado.
 *
 * `public/firmware/puente-alumbrado.S` es el firmware probado. La plantilla de
 * proyecto entrega su equivalente legible en Arduino C++, que hasta ahora
 * nadie habia compilado nunca: se entregaba con una advertencia diciendo
 * justamente eso. Esta prueba lo compila de verdad y ejecuta el .hex
 * resultante sobre el mismo circuito, exigiendole la misma conducta.
 *
 * Se salta entera si no hay cadena de herramientas para este sistema, que es
 * lo normal en un equipo recien clonado. Para tenerla:
 * `./scripts/setup-arduino.sh` (macOS y Linux) o `scripts/setup-arduino.ps1`.
 */

import { createServer } from 'node:http';
import { afterAll, describe, expect, it } from 'vitest';

import { createArduinoCompileMiddleware, hasUsableToolchain } from '../../server/arduinoCompiler';
import { createBridgeLightingCircuit } from '../domain/bridgeLightingCircuit';
import { templateById } from '../domain/projectTemplates';
import { SimulationSession } from './session';

const root = process.cwd();
const toolchainAvailable = await hasUsableToolchain(root);

const servers: ReturnType<typeof createServer>[] = [];

afterAll(async () => {
  await Promise.all(servers.splice(0).map(
    (server) => new Promise<void>((resolve) => server.close(() => resolve())),
  ));
});

async function compileBridgeSource(): Promise<string> {
  const server = createServer((request, response) => {
    createArduinoCompileMiddleware(root)(request, response, () => {
      response.writeHead(404);
      response.end();
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No se pudo iniciar el servidor.');
  const origin = `http://127.0.0.1:${address.port}`;

  const response = await fetch(`${origin}/api/compile`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify({
      boardId: 'arduino-uno',
      files: [{ path: 'src/main.cpp', content: templateById('armario-puente').source('arduino-uno') }],
    }),
  });
  const payload = await response.json() as {
    success: boolean;
    output?: string;
    error?: string;
    artifacts?: { name: string; downloadBase64?: string }[];
  };
  if (!payload.success) {
    throw new Error(`El firmware del armario no compila: ${payload.error ?? payload.output ?? ''}`);
  }
  const hex = payload.artifacts?.find(
    (artifact) => artifact.name.endsWith('.hex')
      && !artifact.name.includes('bootloader')
      && artifact.downloadBase64,
  );
  if (!hex?.downloadBase64) throw new Error('La compilación no devolvió un .hex.');
  return Buffer.from(hex.downloadBase64, 'base64').toString('utf8');
}

describe.skipIf(!toolchainAvailable)('firmware del armario en C++', () => {
  it('compila y obedece como el ensamblador verificado', async () => {
    const hex = await compileBridgeSource();
    const session = SimulationSession.fromHex(hex, createBridgeLightingCircuit(), {
      maxStepMillis: 400,
    });
    const fotocelda = session.photocells[0];
    const mando = session.buttons[0];
    expect(fotocelda).toBeDefined();
    expect(mando).toBeDefined();

    const encendidas = () => session.report().readings
      .filter((reading) => reading.kind === 'led' && reading.active).length;

    /** Una pulsación completa: contar el flanco exige soltar el botón. */
    const pulsar = () => {
      mando.setPressed(true);
      session.advance(120);
      mando.setPressed(false);
      session.advance(120);
    };

    // Modo 0, automático.
    fotocelda.setLight(1);
    session.advance(80);
    expect(encendidas()).toBe(0);
    fotocelda.setLight(0.05);
    session.advance(80);
    expect(encendidas()).toBe(4);

    // Modo 1, todo encendido: manda el operador aunque sea de día.
    fotocelda.setLight(1);
    session.advance(80);
    pulsar();
    expect(encendidas()).toBe(4);

    // Modo 2, solo vial: de noche se enciende la calzada y nada más.
    pulsar();
    fotocelda.setLight(0.05);
    session.advance(80);
    expect(encendidas()).toBe(1);

    // Modo 3, mantenimiento: todo apagado, incluida la calzada, de noche.
    pulsar();
    expect(encendidas()).toBe(0);

    // Y vuelve a automático.
    pulsar();
    expect(encendidas()).toBe(4);
  }, 180_000);

  it('cabe de sobra en el Arduino Uno', async () => {
    const hex = await compileBridgeSource();
    // El .hex es texto Intel HEX; lo que importa es que el programa entre en
    // los 32 256 bytes utiles del Uno, y entra con holgura.
    const dataBytes = hex.split('\n')
      .filter((line) => line.startsWith(':'))
      .reduce((total, line) => total + Number.parseInt(line.slice(1, 3), 16), 0);
    expect(dataBytes).toBeGreaterThan(0);
    expect(dataBytes).toBeLessThan(32256);
  }, 180_000);
});
