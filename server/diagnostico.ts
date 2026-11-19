/**
 * Diagnóstico completo antes de compilar.
 *
 * Antes se paraba en el primer problema: el cliente arreglaba uno (o esperaba
 * a que lo arreglara el administrador) y al volver a compilar aparecía el
 * siguiente. Ahora se revisa todo de una vez —placa, núcleo y cada #include—
 * y cada problema dice A QUIÉN le toca:
 *
 *   cliente        puede arreglarlo él (otra placa, otra biblioteca, otro entorno)
 *   administrador  lo arregla quien opera el servidor (instalar un núcleo o una
 *                  biblioteca oficial). Al cliente solo se le dice que el
 *                  servicio aún no lo tiene; las órdenes de instalación no son
 *                  para él. En modo público (EMBEDVERSE_PUBLICO=1) ni siquiera
 *                  se le muestran; quedan en .tools/avisos-administrador.jsonl.
 */
import { appendFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { analizar, type Analisis, type InclusionAnalizada } from './bibliotecaOficial.js';
import { comoInstalar, PLACAS, type Placa } from './placas.js';

export type Destinatario = 'cliente' | 'administrador';

export interface Problema {
  codigo: string;
  para: Destinatario;
  mensaje: string;
}

export interface Archivo {
  path: string;
  content: string;
}

/**
 * Lo que trae el núcleo de cada familia, para revisar bibliotecas cuando el
 * núcleo aún no está instalado (o la placa no es conocida). Es una
 * aproximación: con el núcleo instalado se leen sus cabeceras reales.
 */
const COMUN = ['Arduino.h', 'Wire.h', 'SPI.h', 'EEPROM.h', 'SoftwareSerial.h', 'Print.h', 'Stream.h', 'HardwareSerial.h'];
const POR_ARQUITECTURA: Record<string, string[]> = {
  esp32: ['WiFi.h', 'WiFiClient.h', 'WiFiClientSecure.h', 'WiFiUdp.h', 'WiFiMulti.h', 'HTTPClient.h', 'WebServer.h',
    'Preferences.h', 'BluetoothSerial.h', 'BLEDevice.h', 'SPIFFS.h', 'LittleFS.h', 'FS.h', 'SD.h', 'SD_MMC.h',
    'Update.h', 'ESPmDNS.h', 'ArduinoOTA.h', 'Ticker.h', 'ETH.h', 'NetworkClient.h'],
  esp8266: ['ESP8266WiFi.h', 'ESP8266WebServer.h', 'ESP8266HTTPClient.h', 'ESP8266mDNS.h', 'WiFiClient.h',
    'WiFiClientSecure.h', 'WiFiUdp.h', 'LittleFS.h', 'FS.h', 'SD.h', 'Ticker.h', 'ArduinoOTA.h', 'Servo.h'],
  rp2040: ['WiFi.h', 'WiFiClient.h', 'WiFiUdp.h', 'HTTPClient.h', 'WebServer.h', 'LittleFS.h', 'FS.h', 'SD.h',
    'Servo.h', 'PicoOTA.h', 'BluetoothSerial.h'],
  stm32: ['SrcWrapper.h', 'Servo.h', 'SD.h'],
  avr: ['Servo.h'],
  megaavr: ['Servo.h'],
  samd: ['USBHost.h'],
  renesas_uno: ['WiFiS3.h', 'Arduino_LED_Matrix.h', 'RTC.h'],
};

export function nucleoAproximado(placa: Placa | undefined): Set<string> {
  const arq = placa?.paquete.split(':')[1] ?? '';
  return new Set([...COMUN, ...(POR_ARQUITECTURA[arq] ?? [])]);
}

/** Código que no es Arduino: otro compilador, otro entorno. */
interface Entorno {
  nombre: string;
  herramienta: string;
}

const ENTORNOS: { prueba: RegExp; entorno: Entorno }[] = [
  { prueba: /#\s*include\s*[<"]xc\.h[>"]|#\s*pragma\s+config\s+\w+\s*=/,
    entorno: { nombre: 'Microchip PIC/dsPIC (XC8/XC16)', herramienta: 'MPLAB X con el compilador XC8/XC16' } },
  { prueba: /#\s*include\s*[<"]stm32\w*_hal\.h[>"]|\bHAL_Init\s*\(/,
    entorno: { nombre: 'STM32 con HAL (STM32Cube)', herramienta: 'STM32CubeIDE' } },
  { prueba: /#\s*include\s*[<"]pico\/stdlib\.h[>"]/,
    entorno: { nombre: 'Raspberry Pi Pico C SDK', herramienta: 'el Pico SDK (CMake)' } },
  { prueba: /\bvoid\s+app_main\s*\(/,
    entorno: { nombre: 'ESP-IDF', herramienta: 'ESP-IDF (idf.py)' } },
  { prueba: /#\s*include\s*[<"]msp430\w*\.h[>"]/,
    entorno: { nombre: 'TI MSP430', herramienta: 'Code Composer Studio o msp430-gcc' } },
  { prueba: /#\s*include\s*[<"](reg51|8051|at89\w*)\.h[>"]/i,
    entorno: { nombre: '8051', herramienta: 'SDCC o Keil C51' } },
];

export function otroEntorno(files: Archivo[]): Entorno | null {
  const todo = files.map((f) => f.content).join('\n');
  for (const { prueba, entorno } of ENTORNOS) if (prueba.test(todo)) return entorno;
  // main() propio y sin setup/loop: no es un sketch de Arduino.
  if (/\b(int|void)\s+main\s*\(/.test(todo) && !/\bvoid\s+setup\s*\(/.test(todo)) {
    return { nombre: 'C/C++ sin Arduino (tiene main() y no setup/loop)', herramienta: 'la herramienta del fabricante de tu microcontrolador' };
  }
  return null;
}

/** Placas que el compilador conoce, resumidas por familia (para sugerir). */
export function familias(): string {
  const f = new Map<string, number>();
  for (const p of PLACAS) f.set(p.familia, (f.get(p.familia) ?? 0) + 1);
  return [...f].map(([n, c]) => `${n} (${c})`).join(', ');
}

function lista(xs: InclusionAnalizada[], f: (x: InclusionAnalizada) => string): string {
  return xs.map((x) => `  · ${f(x)}`).join('\n');
}

/** Problemas de bibliotecas, separados por destinatario. */
export function problemasDeBibliotecas(a: Analisis, provisional: boolean): Problema[] {
  const res: Problema[] = [];
  if (a.ajenas.length) {
    res.push({
      codigo: 'BIBLIOTECA_NO_OFICIAL',
      para: 'cliente',
      mensaje: [
        'Tu código usa bibliotecas que EMBEDVERSE aún no ofrece:',
        lista(a.ajenas, (x) => x.biblioteca
          ? `${x.cabecera} → ${x.biblioteca}`
          : `${x.cabecera} → la dan: ${(x.sugerencias ?? []).slice(0, 4).join(', ')}${(x.sugerencias ?? []).length > 4 ? '…' : ''}`),
        'Quedó registrada la petición: las más pedidas se revisan (licencia, que compile) y se incorporan. '
          + 'Mientras tanto puedes usar una equivalente de la lista (GET /api/bibliotecas).'
          + (provisional ? ' (Revisión provisional: falta el núcleo de la placa en el servidor.)' : ''),
      ].join('\n'),
    });
  }
  if (a.pendientes.length) {
    res.push({
      codigo: 'BIBLIOTECA_OFICIAL_NO_INSTALADA',
      para: 'cliente',
      mensaje: 'Estas bibliotecas son de EMBEDVERSE pero este servidor aún no las tiene preparadas: '
        + a.pendientes.map((x) => x.biblioteca).join(', ') + '. Ya se avisó al administrador; no tienes que hacer nada.',
    });
    res.push({
      codigo: 'BIBLIOTECA_OFICIAL_NO_INSTALADA',
      para: 'administrador',
      mensaje: [
        'Faltan bibliotecas oficiales:',
        lista(a.pendientes, (x) => `${x.biblioteca} ${x.version} (${x.cabecera})`),
        'Instálelas con  sh scripts/placas.sh oficial  (y  verificadas )  —  Windows: '
          + 'powershell -ExecutionPolicy Bypass -File scripts\\placas.ps1 oficial',
      ].join('\n'),
    });
  }
  if (a.versionesDistintas.length) {
    res.push({
      codigo: 'BIBLIOTECA_VERSION_DISTINTA',
      para: 'cliente',
      mensaje: 'El servidor tiene bibliotecas en una versión que no es la fijada; se avisó al administrador.',
    });
    res.push({
      codigo: 'BIBLIOTECA_VERSION_DISTINTA',
      para: 'administrador',
      mensaje: [
        'Versiones distintas de las fijadas (el resultado no sería reproducible):',
        ...a.versionesDistintas.map((v) => `  · ${v.nombre}: instalada ${v.instalada}, fijada ${v.oficial}`),
        'Déjelas como en el lock con  sh scripts/placas.sh oficial',
      ].join('\n'),
    });
  }
  return res;
}

export interface Resultado {
  problemas: Problema[];
  analisis: Analisis;
}

/**
 * Revisa todo lo que impide compilar. `placa` undefined = id desconocido;
 * `nucleo` null = núcleo no instalado (se usa la aproximación de la familia).
 */
export function diagnosticar(opciones: {
  boardId: string;
  placa: Placa | undefined;
  files: Archivo[];
  nucleo: Set<string> | null;
  instaladas: Parameters<typeof analizar>[2];
}): Resultado {
  const { boardId, placa, files } = opciones;
  const problemas: Problema[] = [];
  const entorno = otroEntorno(files);

  if (entorno) {
    problemas.push({
      codigo: 'NO_ES_ARDUINO',
      para: 'cliente',
      mensaje: `Este código es para ${entorno.nombre}, no para Arduino: se compila con ${entorno.herramienta}. `
        + 'EMBEDVERSE compila sketches de Arduino (setup() y loop()). Quedó registrada la petición.',
    });
  }
  if (!placa) {
    problemas.push({
      codigo: 'UNSUPPORTED_BOARD',
      para: 'cliente',
      mensaje: `La placa «${boardId}» aún no está en EMBEDVERSE. Quedó registrada la petición. `
        + `Placas disponibles: ${familias()}.`,
    });
  } else if (!opciones.nucleo) {
    problemas.push({
      codigo: 'CORE_NOT_INSTALLED',
      para: 'cliente',
      mensaje: `El servidor aún no tiene preparada la placa ${placa.nombre}. Ya se avisó al administrador; no tienes que hacer nada.`,
    });
    problemas.push({ codigo: 'CORE_NOT_INSTALLED', para: 'administrador', mensaje: comoInstalar(placa) });
  }

  // Bibliotecas: se revisan aunque falte la placa o el núcleo, para decirlo todo de una vez.
  // Si el código ni siquiera es Arduino, no tiene sentido.
  const analisis = entorno
    ? { inclusiones: [], ajenas: [], pendientes: [], versionesDistintas: [] }
    : analizar(files, opciones.nucleo ?? nucleoAproximado(placa), opciones.instaladas);
  problemas.push(...problemasDeBibliotecas(analisis, !opciones.nucleo));
  return { problemas, analisis };
}

/** Prioridad del código de respuesta: primero lo que el cliente puede arreglar. */
const ORDEN = ['NO_ES_ARDUINO', 'UNSUPPORTED_BOARD', 'BIBLIOTECA_NO_OFICIAL', 'CORE_NOT_INSTALLED',
  'BIBLIOTECA_OFICIAL_NO_INSTALADA', 'BIBLIOTECA_VERSION_DISTINTA'];

export function codigoPrincipal(problemas: Problema[]): string {
  return [...problemas].sort((a, b) => ORDEN.indexOf(a.codigo) - ORDEN.indexOf(b.codigo))[0].codigo;
}

/** 422 si el cliente tiene algo que cambiar; 503 si todo depende del administrador. */
export function estadoHttp(problemas: Problema[]): number {
  const delCliente = new Set(['NO_ES_ARDUINO', 'UNSUPPORTED_BOARD', 'BIBLIOTECA_NO_OFICIAL']);
  return problemas.some((p) => delCliente.has(p.codigo)) ? 422 : 503;
}

export function esPublico(): boolean {
  return process.env.EMBEDVERSE_PUBLICO === '1';
}

/** Texto para el cliente; en modo local añade la parte del administrador. */
export function mensaje(problemas: Problema[], publico = esPublico()): string {
  // Primero lo que el cliente puede cambiar; luego lo que espera del servidor.
  const cliente = problemas.filter((p) => p.para === 'cliente').sort((a, b) => ORDEN.indexOf(a.codigo) - ORDEN.indexOf(b.codigo));
  const admin = problemas.filter((p) => p.para === 'administrador');
  const partes = [
    cliente.length > 1 ? `Hay ${cliente.length} cosas que impiden compilar:` : '',
    cliente.map((p, i) => (cliente.length > 1 ? `${i + 1}. ` : '') + p.mensaje).join('\n\n'),
  ].filter(Boolean);
  if (!publico && admin.length) {
    partes.push('— Para el administrador de este servidor —\n' + admin.map((p) => p.mensaje).join('\n\n'));
  }
  return partes.join('\n\n');
}

/** Lo que va en la respuesta: en modo público, sin los avisos del administrador. */
export function paraRespuesta(problemas: Problema[], publico = esPublico()): Problema[] {
  return publico ? problemas.filter((p) => p.para === 'cliente') : problemas;
}

/**
 * Registros para el administrador (nada del código del cliente):
 *   solicitudes-placas.jsonl     placas o entornos que piden y no tenemos
 *   avisos-administrador.jsonl   lo que hay que instalar
 */
export async function registrar(raiz: string, boardId: string, problemas: Problema[], entorno: Entorno | null): Promise<void> {
  if (process.env.VITEST) return;
  const dir = path.join(raiz, '.tools');
  await mkdir(dir, { recursive: true });
  const fecha = new Date().toISOString();
  if (problemas.some((p) => p.codigo === 'UNSUPPORTED_BOARD' || p.codigo === 'NO_ES_ARDUINO')) {
    await appendFile(path.join(dir, 'solicitudes-placas.jsonl'),
      JSON.stringify({ fecha, placa: boardId.slice(0, 80), entorno: entorno?.nombre ?? null }) + '\n', 'utf8');
  }
  const admin = problemas.filter((p) => p.para === 'administrador');
  if (admin.length) {
    await appendFile(path.join(dir, 'avisos-administrador.jsonl'),
      admin.map((p) => JSON.stringify({ fecha, placa: boardId.slice(0, 80), codigo: p.codigo, mensaje: p.mensaje }) + '\n').join(''), 'utf8');
  }
}
