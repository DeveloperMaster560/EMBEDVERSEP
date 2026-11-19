/**
 * Compilación de verdad (núcleo AVR del Uno) a través del middleware, con la
 * biblioteca oficial. Se omite si este equipo no tiene la cadena instalada.
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createArduinoCompileMiddleware, hasUsableToolchain } from './arduinoCompiler';

const RAIZ = path.resolve(__dirname, '..');
const hayCadena = await hasUsableToolchain(RAIZ);

describe.skipIf(!hayCadena)('compilar con la biblioteca oficial (Arduino Uno real)', () => {
  let servidor: http.Server;
  let base = '';

  beforeAll(async () => {
    const mw = createArduinoCompileMiddleware(RAIZ);
    servidor = http.createServer((req, res) => mw(req, res, () => { res.statusCode = 404; res.end(); }));
    await new Promise<void>((ok) => servidor.listen(0, '127.0.0.1', ok));
    base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((ok) => servidor.close(() => ok())));

  async function compilar(codigo: string, archivo = 'src/main.cpp') {
    const r = await fetch(base, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: base },
      body: JSON.stringify({ boardId: 'arduino-uno', files: [{ path: archivo, content: codigo }] }),
    });
    return { status: r.status, cuerpo: await r.json() as { success: boolean; code?: string; error?: string } };
  }

  it('lo del núcleo (Wire) compila sin bibliotecas instaladas', async () => {
    const r = await compilar('#include <Wire.h>\nvoid setup(){ Wire.begin(); }\nvoid loop(){}\n');
    expect(r.status, JSON.stringify(r.cuerpo)).toBe(200);
    expect(r.cuerpo.success).toBe(true);
  }, 120_000);

  it('un .ino con cualquier nombre (cacao.ino) es el principal', async () => {
    const r = await compilar('void setup(){}\nvoid loop(){}\n', 'cacao.ino');
    expect(r.status, JSON.stringify(r.cuerpo)).toBe(200);
  }, 120_000);

  it('una biblioteca que no es oficial se rechaza antes de compilar, con su nombre', async () => {
    const r = await compilar('#include <FastLED.h>\nvoid setup(){}\nvoid loop(){}\n');
    expect(r.status).toBe(422);
    expect(r.cuerpo.code).toBe('BIBLIOTECA_NO_OFICIAL');
    expect(r.cuerpo.error).toContain('FastLED.h → la dan: FastLED');
  }, 60_000);
});
