/**
 * De punta a punta: código fuente → arduino-cli (Arduino Uno, de verdad) →
 * .hex → ATmega328P emulado → luminarias del modelo 3D del puente, y la luz de
 * la escena → A0 → firmware.
 *
 * También se comprueba que el .hex se puede grabar en la placa real: sumas de
 * control Intel HEX, tamaño frente a la flash del Uno y una carga simulada con
 * avrdude (programador «dryboot», que emula el gestor de arranque).
 *
 * Se salta entera si este equipo no tiene la cadena AVR (`scripts/setup-arduino.sh`).
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createArduinoCompileMiddleware, hasUsableToolchain, type CompileResponse } from '../../server/arduinoCompiler';
import { templateById } from '../domain/projectTemplates';
import { unsupportedBoardMessage } from '../simulation/useSimulation';
import { BridgeFirmwareError, FirmwareLightingController, readBridgeFirmware } from './firmware-lighting';
import type { LightingControl, LightingZone } from './lighting-state';

const root = process.cwd();
const toolchainAvailable = await hasUsableToolchain(root);

function zona(zone: string, fixtures: string[], power: number): LightingZone {
  return {
    zone, label: `Zona ${zone}`, purpose: 'prueba',
    circuitId: `C-${zone}`, switchedBy: 'K1', controllerId: null, driverId: null,
    fixtures, fixtureCount: fixtures.length,
    connectedPowerW: power, nominalVoltageV: 230,
    dimmable: false, colorCapability: null,
  };
}

/** Potencias que devuelve el generador para el Viaducto de la Novena (ver firmware-lighting.test). */
const control: LightingControl = {
  cabinetId: 'ARM-01', sensorId: 'FOT-01', sensorThresholds: null, clockId: null,
  latitudeDeg: 7.1193, longitudeDeg: -73.1227, contactorId: 'K1',
  zones: [
    zona('vial', ['LUM-001', 'LUM-002'], 3480),
    zona('tirantes', ['PROY-001'], 4800),
    zona('torres', ['FOCO-001'], 4960),
    zona('barreras', ['BAN-001'], 1296),
  ],
  totalFixtures: 5, undetermined: [], notSimulated: [],
};

/** Programa 2, escrito a mano: PWM por temporizador en D5/D6 según la luz, y D4 que alterna con el pulsador. */
const PWM_SKETCH = `#include <Arduino.h>
const int VIAL = 4, TIRANTES = 5, TORRES = 6, BOTON = 2;
bool vial = false;
int anterior = HIGH;
void setup() {
  pinMode(VIAL, OUTPUT); pinMode(TIRANTES, OUTPUT); pinMode(TORRES, OUTPUT);
  pinMode(BOTON, INPUT_PULLUP);
  Serial.begin(9600);
}
void loop() {
  int luz = analogRead(A0);
  int brillo = luz < 512 ? map(luz, 0, 511, 255, 0) : 0;
  analogWrite(TIRANTES, brillo);
  analogWrite(TORRES, brillo / 4);
  int b = digitalRead(BOTON);
  if (anterior == HIGH && b == LOW) {
    vial = !vial;
    digitalWrite(VIAL, vial ? HIGH : LOW);
    Serial.println(vial ? "vial ON" : "vial OFF");
    delay(20);
  }
  anterior = b;
  delay(5);
}
`;

/** Programa 3: no usa los pines del armario (D8–D11 y A1). Debe avisar, no quedarse callado. */
const WRONG_PINS_SKETCH = `#include <Arduino.h>
void setup() { for (int p = 8; p <= 11; p++) pinMode(p, OUTPUT); }
void loop() {
  int v = analogRead(A1);
  for (int p = 8; p <= 11; p++) digitalWrite(p, v < 512 ? HIGH : LOW);
  delay(10);
}
`;

const servers: ReturnType<typeof createServer>[] = [];
let origin = '';

async function compile(source: string, boardId = 'arduino-uno'): Promise<{ status: number; body: CompileResponse }> {
  const response = await fetch(`${origin}/api/compile`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify({ boardId, files: [{ path: 'src/main.cpp', content: source }] }),
  });
  return { status: response.status, body: await response.json() as CompileResponse };
}

async function compileHex(source: string): Promise<{ hex: string; body: CompileResponse }> {
  const { body } = await compile(source);
  if (!body.success) throw new Error(`No compila: ${body.error ?? body.output}`);
  const artifact = body.artifacts?.find((a) => a.name === body.carga?.archivo);
  if (!artifact?.downloadBase64) throw new Error('La compilación no devolvió el archivo de carga.');
  return { hex: Buffer.from(artifact.downloadBase64, 'base64').toString('utf8'), body };
}

/** Comprobación independiente del lector de la app: cada registro suma 0 módulo 256. */
function intelHexChecks(hex: string): { dataBytes: number; badLines: number[]; hasEof: boolean } {
  const lines = hex.split(/\r?\n/).filter((l) => l.length > 0);
  let dataBytes = 0;
  const badLines: number[] = [];
  lines.forEach((line, index) => {
    const bytes = Buffer.from(line.slice(1), 'hex');
    const sum = bytes.reduce((acc, b) => (acc + b) & 0xff, 0);
    if (!line.startsWith(':') || sum !== 0 || bytes.length !== bytes[0] + 5) badLines.push(index + 1);
    if (bytes[3] === 0x00) dataBytes += bytes[0];
  });
  return { dataBytes, badLines, hasEof: lines.at(-1) === ':00000001FF' };
}

function avrdudeBinary(): { bin: string; conf: string } | null {
  for (const dir of [`arduino-data-${process.platform}`, 'arduino-data']) {
    const base = path.join(root, '.tools', dir, 'packages', 'arduino', 'tools', 'avrdude');
    if (!existsSync(base)) continue;
    for (const version of readdirSync(base)) {
      const bin = path.join(base, version, 'bin', process.platform === 'win32' ? 'avrdude.exe' : 'avrdude');
      const conf = path.join(base, version, 'etc', 'avrdude.conf');
      if (existsSync(bin) && existsSync(conf)) return { bin, conf };
    }
  }
  return null;
}

/** Una pulsación completa: el firmware cuenta el flanco, así que hay que soltar. */
function press(c: FirmwareLightingController): void {
  c.setPressed(true);
  c.advance(50); c.advance(50);
  c.setPressed(false);
  c.advance(50); c.advance(50);
}

describe.skipIf(!toolchainAvailable)('firmware compilado de verdad ↔ modelo 3D del puente', () => {
  beforeAll(async () => {
    const server = createServer((request, response) => {
      createArduinoCompileMiddleware(root)(request, response, () => {
        response.writeHead(404);
        response.end();
      });
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('sin servidor');
    origin = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await Promise.all(servers.splice(0).map((s) => new Promise<void>((ok) => s.close(() => ok()))));
  });

  describe('carga en la placa real', () => {
    it('entrega el .hex de la aplicación, con instrucciones de avrdude, y es un Intel HEX válido que cabe en el Uno', async () => {
      const { hex, body } = await compileHex(templateById('armario-puente').source('arduino-uno'));
      expect(body.carga).toMatchObject({ formato: 'hex', direccion: null });
      expect(body.carga!.archivo).toMatch(/\.ino\.hex$/);
      expect(body.carga!.archivo).not.toMatch(/bootloader/);
      expect(body.carga!.pasos.join('\n')).toContain('avrdude -p atmega328p -c arduino -P <PUERTO> -b 115200');
      // El recomendado va primero en la lista: la app descarga el primero que puede.
      expect(body.artifacts![0].name).toBe(body.carga!.archivo);

      const check = intelHexChecks(hex);
      expect(check.badLines).toEqual([]);
      expect(check.hasEof).toBe(true);
      expect(check.dataBytes).toBeGreaterThan(0);
      // upload.maximum_size del Uno en boards.txt (arduino:avr 1.8.8): 32 256 bytes.
      expect(check.dataBytes).toBeLessThanOrEqual(32256);
    }, 180_000);

    it('avrdude lo graba y lo verifica a través del gestor de arranque emulado (dryboot)', async (ctx) => {
      const avrdude = avrdudeBinary();
      if (!avrdude) ctx.skip();
      const { hex } = await compileHex(PWM_SKETCH);
      const dir = mkdtempSync(path.join(os.tmpdir(), 'embedverse-avrdude-'));
      try {
        const file = path.join(dir, 'firmware.hex');
        writeFileSync(file, hex);
        const out = execFileSync(avrdude!.bin, [
          `-C${avrdude!.conf}`, '-cdryboot', '-pm328p', '-D', `-Uflash:w:${file}:i`,
        ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).toString();
        void out;
      } catch (error) {
        throw new Error(`avrdude rechazó el .hex: ${String((error as { stderr?: string }).stderr ?? error)}`);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }, 180_000);

    it('un programa que no cabe en el Uno no se entrega: lo rechaza el compilador', async () => {
      // 2 × 17 000 bytes en flash: más que los 32 256 que deja el gestor de arranque.
      const big = '#include <Arduino.h>\nconst uint8_t a[17000] PROGMEM = {1};\nconst uint8_t b[17000] PROGMEM = {2};\n'
        + 'void setup(){ Serial.begin(9600); }\n'
        + 'void loop(){ static uint16_t i; i = (i + 1) % 17000; Serial.write(pgm_read_byte(&a[i]) + pgm_read_byte(&b[i])); }\n';
      const { body } = await compile(big);
      expect(body.success).toBe(false);
      expect(body.artifacts).toBeUndefined();
      expect(body.output).toMatch(/32256/);
    }, 180_000);
  });

  describe('programa 1: firmware del armario (plantilla armario-puente)', () => {
    it('el firmware enciende las luminarias del modelo y la luz de la escena le llega por A0', async () => {
      const { hex } = await compileHex(templateById('armario-puente').source('arduino-uno'));
      const c = new FirmwareLightingController(hex, control);
      c.setLight(1);
      c.advance(50);
      let state = c.advance(50);
      expect(state.litCount).toBe(0);

      // La escena oscurece (modelo → firmware) y el firmware enciende (firmware → modelo).
      c.setLight(0.05);
      c.advance(50);
      state = c.advance(50);
      expect([...state.litComponents.keys()].sort()).toEqual(['BAN-001', 'FOCO-001', 'LUM-001', 'LUM-002', 'PROY-001']);
      expect(state.totalPowerW).toBe(14536);
      expect(state.firmwareWarnings).toEqual([]);

      // El pulsador del armario: dos pulsaciones = solo vial.
      press(c);
      press(c);
      state = c.advance(50);
      expect([...state.litComponents.keys()].sort()).toEqual(['LUM-001', 'LUM-002']);
    }, 180_000);
  });

  describe('programa 2: escrito a mano, con PWM', () => {
    it('el brillo PWM sigue a la luz de la escena y el pulsador alterna la calzada', async () => {
      const { hex } = await compileHex(PWM_SKETCH);
      const c = new FirmwareLightingController(hex, control);

      c.setLight(1);
      c.advance(50);
      let state = c.advance(50);
      expect(state.litCount).toBe(0);

      // Noche: tirantes y torres modulados, con brillos distintos.
      c.setLight(0.05);
      c.advance(50);
      state = c.advance(50);
      const tirantes = state.zones.find((z) => z.zone === 'tirantes')!;
      const torres = state.zones.find((z) => z.zone === 'torres')!;
      expect(tirantes.energized).toBe(true);
      expect(torres.energized).toBe(true);
      expect(tirantes.duty).toBeGreaterThan(0.8);
      expect(tirantes.duty).toBeLessThan(0.99);
      expect(torres.duty).toBeGreaterThan(0.15);
      expect(torres.duty).toBeLessThan(0.3);
      expect(state.litComponents.has('PROY-001')).toBe(true);
      expect(state.litComponents.has('FOCO-001')).toBe(true);
      expect(state.litComponents.has('LUM-001')).toBe(false);

      // Penumbra: menos brillo que de noche.
      c.setLight(0.3);
      c.advance(50);
      const penumbra = c.advance(50).zones.find((z) => z.zone === 'tirantes')!;
      expect(penumbra.duty).toBeLessThan(tirantes.duty!);
      expect(penumbra.duty).toBeGreaterThan(0.2);

      // El pulsador (entrada del operador) llega al firmware y enciende la calzada.
      press(c);
      state = c.advance(50);
      expect(state.litComponents.has('LUM-001')).toBe(true);
      expect(state.serial).toContain('vial ON');

      // D7 nunca se configura: el armario lo dice.
      expect(state.firmwareWarnings).toEqual([
        'Pines de zona que el firmware no configura como salida: D7 (barreras). Esas zonas no se encenderán.',
      ]);
    }, 180_000);
  });

  describe('programa 3: no usa los pines del armario', () => {
    it('no enciende nada y explica por qué, con los pines que sí usa', async () => {
      const { hex } = await compileHex(WRONG_PINS_SKETCH);
      const c = new FirmwareLightingController(hex, control);
      c.setLight(0.05);
      let state = c.advance(50);
      // Antes de 100 ms simulados no se acusa a nadie: setup() puede no haber terminado.
      expect(state.firmwareWarnings).toEqual([]);
      c.advance(50);
      state = c.advance(50);
      expect(state.litCount).toBe(0);
      expect(state.firmwareWarnings).toHaveLength(2);
      expect(state.firmwareWarnings[0]).toMatch(/ninguno de los pines de zona/);
      expect(state.firmwareWarnings[0]).toContain('Usa como salida D8, D9, D10, D11');
      expect(state.firmwareWarnings[1]).toMatch(/no ha leído A0/);
    }, 180_000);
  });

  describe('un proyecto ESP32', () => {
    it('en este equipo no compila (núcleo no instalado) y lo dice con un código claro', async () => {
      const { status, body } = await compile('#include <Arduino.h>\nvoid setup(){}\nvoid loop(){}\n', 'esp32-devkit');
      if (body.success) {
        // Si alguien instaló el núcleo, al menos debe entregar la imagen completa y su dirección.
        expect(body.carga?.archivo).toMatch(/\.merged\.bin$/);
        expect(body.carga?.direccion).toBe('0x0');
        return;
      }
      expect(status).toBeGreaterThanOrEqual(400);
      expect(body.code).toBeTruthy();
      expect(body.error).toMatch(/ESP32|esp32/);
      // Antes la respuesta de error decía siempre «Arduino Uno R3».
      expect(body.board).toBe('ESP32 DevKit (ESP32 Dev Module)');
    }, 60_000);
  });
});

describe('el armario rechaza con explicación lo que no es firmware del Uno', () => {
  it('un proyecto ESP32 en el laboratorio: no se emula, y se dice qué hacer en su lugar', () => {
    expect(unsupportedBoardMessage('arduino-uno')).toBeNull();
    const message = unsupportedBoardMessage('esp32-devkit')!;
    expect(message).toMatch(/ATmega328P/);
    expect(message).toMatch(/no hay emulador/);
    expect(message).toMatch(/«Compilar»/);
    expect(message).toMatch(/«Simular»/);
  });

  it('una imagen de ESP32 (.bin) dice que no hay emulador de ESP32', () => {
    // Cabecera de imagen de aplicación de Espressif: primer byte 0xE9.
    const imagen = new Uint8Array(64);
    imagen[0] = 0xe9;
    expect(() => readBridgeFirmware(imagen, 'estacion.ino.bin')).toThrow(BridgeFirmwareError);
    expect(() => readBridgeFirmware(imagen, 'estacion.ino.bin')).toThrow(/no hay emulador de ESP32/i);
  });

  it('la imagen completa de un ESP32 clásico (gestor de arranque en 0x1000) también se reconoce', () => {
    const merged = new Uint8Array(0x1100).fill(0xff);
    merged[0x1000] = 0xe9;
    expect(() => readBridgeFirmware(merged, 'estacion.ino.merged.bin')).toThrow(/ESP32/);
  });

  it('un .uf2 y un ELF se reconocen por su firma', () => {
    expect(() => readBridgeFirmware(new Uint8Array([0x55, 0x46, 0x32, 0x0a, 0, 0]), 'pico.uf2')).toThrow(/uf2/);
    expect(() => readBridgeFirmware(new Uint8Array([0x7f, 0x45, 0x4c, 0x46, 1]), 'x.elf')).toThrow(/ELF/);
  });

  it('un Intel HEX corrupto da un error legible, no una excepción cualquiera', () => {
    const hex = readBridgeFirmware(new TextEncoder().encode(':0400000001020304F1\n:00000001FF\n'), 'roto.hex');
    expect(() => new FirmwareLightingController(hex, control)).toThrow(BridgeFirmwareError);
    expect(() => new FirmwareLightingController(hex, control)).toThrow(/checksum/);
  });
});
