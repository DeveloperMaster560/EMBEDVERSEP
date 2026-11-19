import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { OFICIAL, VERIFICADAS, analizar, bibliotecasEn, esDelSistema, inclusiones, mensajeAjenas } from './bibliotecaOficial';

const version = (n: string) => OFICIAL.find((b) => b.nombre === n)!.version;

const CACAO = {
  path: 'cacao.ino',
  content: [
    '#include <WiFi.h>', '#include <PubSubClient.h>', '#include <DHT.h>', '#include <Wire.h>',
    '#include <BH1750.h>', '#include <ArduinoJson.h>', '#include "config.h"', '#include <math.h>',
    'void setup(){} void loop(){}',
  ].join('\n'),
};
const NUCLEO_ESP32 = new Set(['Arduino.h', 'WiFi.h', 'Wire.h', 'SPI.h']);
const INSTALADAS = [
  { nombre: 'PubSubClient', version: version('PubSubClient'), cabeceras: ['PubSubClient.h'] },
  { nombre: 'DHT sensor library', version: version('DHT sensor library'), cabeceras: ['DHT.h', 'DHT_U.h'] },
  { nombre: 'BH1750', version: version('BH1750'), cabeceras: ['BH1750.h'] },
  { nombre: 'ArduinoJson', version: version('ArduinoJson'), cabeceras: ['ArduinoJson.h', 'ArduinoJson.hpp'] },
];

describe('biblioteca oficial', () => {
  it('fija versión y no repite cabeceras entre bibliotecas oficiales', () => {
    expect(OFICIAL.length).toBeGreaterThanOrEqual(100);
    for (const b of OFICIAL) expect(b.version).toMatch(/^\d/);
    const vistas = new Map<string, string>();
    for (const b of OFICIAL) {
      for (const h of b.cabeceras.filter((x) => !b.cabeceras_internas?.includes(x))) {
        expect(vistas.get(h), `${h} en ${b.nombre} y ${vistas.get(h)}`).toBeUndefined();
        vistas.set(h, b.nombre);
      }
    }
  });

  it('lee los #include, sin repetir', () => {
    expect(inclusiones([CACAO, { path: 'b.h', content: '#include <DHT.h>\n  #  include "x.h"' }]))
      .toEqual(['ArduinoJson.h', 'BH1750.h', 'DHT.h', 'PubSubClient.h', 'WiFi.h', 'Wire.h', 'config.h', 'math.h', 'x.h']);
  });

  it('el sketch del cacao compila con la oficial instalada', () => {
    const a = analizar([CACAO, { path: 'config.h', content: '' }], NUCLEO_ESP32, INSTALADAS);
    const origen = Object.fromEntries(a.inclusiones.map((i) => [i.cabecera, i.origen]));
    expect(origen).toEqual({
      'ArduinoJson.h': 'oficial', 'BH1750.h': 'oficial', 'DHT.h': 'oficial', 'PubSubClient.h': 'oficial',
      'WiFi.h': 'nucleo', 'Wire.h': 'nucleo', 'config.h': 'propia', 'math.h': 'sistema',
    });
    expect([a.ajenas, a.pendientes, a.versionesDistintas]).toEqual([[], [], []]);
  });

  it('sin instalar: dice qué bibliotecas oficiales faltan en el servidor', () => {
    const a = analizar([CACAO], NUCLEO_ESP32, []);
    expect(a.pendientes.map((p) => p.biblioteca).sort())
      .toEqual(['ArduinoJson', 'BH1750', 'DHT sensor library', 'PubSubClient']);
  });

  it('una biblioteca que no es oficial se rechaza con su nombre', () => {
    const a = analizar([{ path: 'a.ino', content: '#include <AsyncMqttClient.h>\n#include <WiFiManager.h>' }],
      NUCLEO_ESP32, INSTALADAS);
    expect(a.ajenas.map((x) => x.cabecera)).toEqual(['AsyncMqttClient.h']);
    expect(a.ajenas[0].sugerencias?.[0]).toBe('AsyncMqttClient');
    // WiFiManager sí es oficial: falta instalarla en el servidor, no es del cliente.
    expect(a.pendientes.map((x) => x.biblioteca)).toEqual(['WiFiManager']);
    expect(mensajeAjenas(a.ajenas)).toContain('AsyncMqttClient.h → la dan: AsyncMqttClient');
  });

  it('nivel verificada: se acepta instalada y se pide al administrador si falta', () => {
    const v = VERIFICADAS.find((b) => b.cabeceras.length && !b.requerida_por.length);
    if (!v) return;   // aún no hay ninguna verificada
    const codigo = [{ path: 'a.ino', content: `#include <${v.cabeceras[0]}>` }];
    expect(analizar(codigo, NUCLEO_ESP32, [{ nombre: v.nombre, version: v.version, cabeceras: v.cabeceras }]).inclusiones[0])
      .toMatchObject({ origen: 'verificada', biblioteca: v.nombre });
    expect(analizar(codigo, NUCLEO_ESP32, []).pendientes[0]).toMatchObject({ biblioteca: v.nombre });
  });

  it('instalada pero fuera de la oficial también se rechaza', () => {
    const a = analizar([{ path: 'a.ino', content: '#include <Rara.h>' }], NUCLEO_ESP32,
      [...INSTALADAS, { nombre: 'Rara', version: '1.0.0', cabeceras: ['Rara.h'] }]);
    expect(a.ajenas[0]).toMatchObject({ origen: 'ajena', biblioteca: 'Rara' });
  });

  it('otra versión instalada: no es reproducible y se avisa', () => {
    const otras = INSTALADAS.map((i) => (i.nombre === 'BH1750' ? { ...i, version: '0.0.1' } : i));
    const a = analizar([CACAO], NUCLEO_ESP32, otras);
    expect(a.versionesDistintas).toEqual([{ nombre: 'BH1750', instalada: '0.0.1', oficial: version('BH1750') }]);
  });

  it('distingue cabeceras del sistema y del SDK', () => {
    for (const h of ['string.h', 'vector', 'avr/io.h', 'freertos/task.h', 'esp_timer.h', 'sys/time.h']) expect(esDelSistema(h), h).toBe(true);
    for (const h of ['DHT.h', 'FastLED.h']) expect(esDelSistema(h), h).toBe(false);
  });

  describe('lee las bibliotecas instaladas', () => {
    let dir = '';
    afterEach(async () => { if (dir) await rm(dir, { recursive: true, force: true }); });

    it('nombre, versión y cabeceras de library.properties y src/', async () => {
      dir = await mkdtemp(path.join(os.tmpdir(), 'libs-'));
      await mkdir(path.join(dir, 'DHT_sensor_library', 'src'), { recursive: true });
      await writeFile(path.join(dir, 'DHT_sensor_library', 'library.properties'), 'name=DHT sensor library\nversion=1.4.7\n');
      await writeFile(path.join(dir, 'DHT_sensor_library', 'DHT.h'), '');
      await mkdir(path.join(dir, 'ArduinoJson', 'src'), { recursive: true });
      await writeFile(path.join(dir, 'ArduinoJson', 'library.properties'), 'name=ArduinoJson\nversion=7.4.3\nincludes=ArduinoJson.h\n');
      await writeFile(path.join(dir, 'ArduinoJson', 'src', 'ArduinoJson.hpp'), '');
      const r = await bibliotecasEn(dir);
      expect(r.sort((a, b) => a.nombre.localeCompare(b.nombre))).toEqual([
        { nombre: 'ArduinoJson', version: '7.4.3', cabeceras: ['ArduinoJson.h', 'ArduinoJson.hpp'] },
        { nombre: 'DHT sensor library', version: '1.4.7', cabeceras: ['DHT.h'] },
      ]);
    });
  });
});
