/**
 * Biblioteca oficial de EMBEDVERSE.
 *
 * Los clientes no instalan bibliotecas: compilan en el servidor con las que
 * fija server/bibliotecas.lock.json (versión exacta de cada una). Antes de
 * compilar se mira cada #include del cliente y se decide de dónde sale:
 *
 *   propia     un archivo del propio proyecto
 *   nucleo     el núcleo de la placa (Wire, SPI, WiFi en ESP32, Arduino.h…)
 *   sistema    C/C++ estándar o el SDK del fabricante (string.h, esp_timer.h…)
 *   oficial    una biblioteca de la oficial, instalada en ESTE servidor
 *   pendiente  es de la oficial pero el servidor aún no la tiene (lo arregla
 *              el administrador con «placas oficial»)
 *   ajena      la da una biblioteca que NO está en la oficial: se rechaza con
 *              el nombre de la biblioteca y queda anotada como solicitud
 *   desconocida no se sabe: se deja que el compilador lo diga
 */
import { appendFile, mkdir, readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import lock from './bibliotecas.lock.json' with { type: 'json' };
import indice from './cabeceras-indice.json' with { type: 'json' };
import type { Placa } from './placas.js';

export interface BibliotecaFijada {
  nombre: string;
  version: string;
  grupo: string | null;
  requerida_por: string[];
  cabeceras: string[];
  /** Deducidas del nombre cuando el índice no declara las cabeceras. */
  cabeceras_probables: string[];
  repositorio: string | null;
  licencia: string | null;
}

export const OFICIAL: readonly BibliotecaFijada[] = (lock as unknown as { bibliotecas: BibliotecaFijada[] }).bibliotecas;
const POR_NOMBRE = new Map(OFICIAL.map((b) => [b.nombre, b]));
const INDICE: Record<string, string[]> = (indice as { cabeceras: Record<string, string[]> }).cabeceras;

export type Origen = 'propia' | 'nucleo' | 'sistema' | 'oficial' | 'pendiente' | 'ajena' | 'desconocida';

export interface InclusionAnalizada {
  cabecera: string;
  origen: Origen;
  biblioteca?: string;
  version?: string;
  /** ajena: bibliotecas del índice de Arduino que la dan. */
  sugerencias?: string[];
  detalle?: string;
}

export interface Instalada {
  nombre: string;
  version: string;
  cabeceras: string[];
}

const INCLUDE = /^\s*#\s*include\s*[<"]([^>"]+)[>"]/gm;

export function inclusiones(files: { path: string; content: string }[]): string[] {
  const vistas = new Set<string>();
  for (const f of files) {
    for (const m of f.content.matchAll(INCLUDE)) vistas.add(m[1].trim());
  }
  return [...vistas].sort();
}

/** C y C++ estándar, y los SDK que los núcleos traen en su cadena de herramientas. */
const ESTANDAR = new Set([
  'assert.h', 'ctype.h', 'errno.h', 'float.h', 'inttypes.h', 'limits.h', 'math.h', 'setjmp.h', 'signal.h',
  'stdarg.h', 'stdbool.h', 'stddef.h', 'stdint.h', 'stdio.h', 'stdlib.h', 'string.h', 'time.h', 'wchar.h',
]);
const PREFIJOS_SDK = ['esp_', 'freertos', 'driver', 'soc', 'hal', 'lwip', 'nvs', 'sdkconfig', 'rom', 'mbed', 'pico', 'hardware', 'stm32', 'pgmspace'];

export function esDelSistema(cabecera: string): boolean {
  if (cabecera.includes('/')) return true;            // avr/io.h, sys/time.h, freertos/task.h…
  if (!/\.(h|hpp|hh)$/i.test(cabecera)) return true;  // <string>, <vector>, <cmath>…
  if (ESTANDAR.has(cabecera)) return true;
  const base = cabecera.toLowerCase();
  return PREFIJOS_SDK.some((p) => base.startsWith(p));
}

async function existe(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function cabecerasDeCarpeta(dir: string): Promise<string[]> {
  try {
    return (await readdir(dir)).filter((n) => /\.(h|hpp)$/i.test(n));
  } catch {
    return [];
  }
}

function propiedad(texto: string, clave: string): string | undefined {
  const m = texto.match(new RegExp(`^${clave}\\s*=\\s*(.*)$`, 'm'));
  return m ? m[1].trim() : undefined;
}

/** Bibliotecas en una carpeta «libraries» (del usuario o de un núcleo) y sus cabeceras. */
export async function bibliotecasEn(carpeta: string): Promise<Instalada[]> {
  let dirs: string[];
  try {
    dirs = await readdir(carpeta);
  } catch {
    return [];
  }
  const res: Instalada[] = [];
  for (const d of dirs) {
    const base = path.join(carpeta, d);
    let props = '';
    try {
      props = await readFile(path.join(base, 'library.properties'), 'utf8');
    } catch {
      if (!(await existe(path.join(base, 'src'))) && (await cabecerasDeCarpeta(base)).length === 0) continue;
    }
    const declaradas = (propiedad(props, 'includes') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    // Las cabeceras pueden estar en la raíz, en src/ o en las dos.
    const propias = [...await cabecerasDeCarpeta(base), ...await cabecerasDeCarpeta(path.join(base, 'src'))];
    res.push({
      nombre: propiedad(props, 'name') ?? d,
      version: propiedad(props, 'version') ?? '',
      cabeceras: [...new Set([...declaradas, ...propias])],
    });
  }
  return res;
}

/** Cabeceras que da el núcleo instalado de la placa (cores/ y libraries/ del núcleo). */
export async function cabecerasDelNucleo(dataDir: string, placa: Placa): Promise<Set<string>> {
  const [vendedor, arquitectura] = placa.paquete.split(':');
  const raiz = path.join(dataDir, 'packages', vendedor, 'hardware', arquitectura);
  const res = new Set<string>();
  let versiones: string[] = [];
  try {
    versiones = await readdir(raiz);
  } catch {
    return res;
  }
  for (const v of versiones) {
    try {
      for (const nucleo of await readdir(path.join(raiz, v, 'cores'))) {
        for (const h of await cabecerasDeCarpeta(path.join(raiz, v, 'cores', nucleo))) res.add(h);
      }
    } catch {
      /* sin cores/ */
    }
    for (const lib of await bibliotecasEn(path.join(raiz, v, 'libraries'))) {
      for (const h of lib.cabeceras) res.add(h);
    }
  }
  return res;
}

export interface Analisis {
  inclusiones: InclusionAnalizada[];
  /** Cabeceras que impiden compilar, por tipo. */
  ajenas: InclusionAnalizada[];
  pendientes: InclusionAnalizada[];
  /** Bibliotecas instaladas con otra versión que la oficial. */
  versionesDistintas: { nombre: string; instalada: string; oficial: string }[];
}

export function analizar(
  files: { path: string; content: string }[],
  nucleo: Set<string>,
  instaladas: Instalada[],
): Analisis {
  const propios = new Set(files.map((f) => path.posix.basename(f.path)));
  const instaladaPorCabecera = new Map<string, Instalada>();
  for (const lib of instaladas) for (const h of lib.cabeceras) if (!instaladaPorCabecera.has(h)) instaladaPorCabecera.set(h, lib);
  const oficialPorCabecera = new Map<string, BibliotecaFijada>();
  for (const b of OFICIAL) for (const h of [...b.cabeceras, ...b.cabeceras_probables]) oficialPorCabecera.set(h, b);

  const res: InclusionAnalizada[] = [];
  const usadas = new Set<string>();
  for (const cabecera of inclusiones(files)) {
    const base = path.posix.basename(cabecera);
    if (propios.has(base)) {
      res.push({ cabecera, origen: 'propia' });
      continue;
    }
    if (nucleo.has(base)) {
      res.push({ cabecera, origen: 'nucleo' });
      continue;
    }
    const inst = instaladaPorCabecera.get(base);
    if (inst && POR_NOMBRE.has(inst.nombre)) {
      usadas.add(inst.nombre);
      res.push({ cabecera, origen: 'oficial', biblioteca: inst.nombre, version: inst.version });
      continue;
    }
    if (inst) {
      res.push({
        cabecera, origen: 'ajena', biblioteca: inst.nombre,
        detalle: `«${inst.nombre}» está instalada en el servidor pero no forma parte de la biblioteca oficial.`,
      });
      continue;
    }
    const of = oficialPorCabecera.get(base);
    if (of) {
      res.push({ cabecera, origen: 'pendiente', biblioteca: of.nombre, version: of.version });
      continue;
    }
    if (esDelSistema(cabecera)) {
      res.push({ cabecera, origen: 'sistema' });
      continue;
    }
    const sugerencias = INDICE[base];
    if (sugerencias?.length) {
      res.push({ cabecera, origen: 'ajena', sugerencias });
      continue;
    }
    res.push({ cabecera, origen: 'desconocida' });
  }

  const versionesDistintas = instaladas
    .filter((i) => usadas.has(i.nombre))
    .map((i) => ({ nombre: i.nombre, instalada: i.version, oficial: POR_NOMBRE.get(i.nombre)!.version }))
    .filter((v) => v.instalada !== v.oficial);

  return {
    inclusiones: res,
    ajenas: res.filter((r) => r.origen === 'ajena'),
    pendientes: res.filter((r) => r.origen === 'pendiente'),
    versionesDistintas,
  };
}

/** Mensaje para el cliente cuando su código pide algo que no está en la oficial. */
export function mensajeAjenas(ajenas: InclusionAnalizada[]): string {
  const lineas = ajenas.map((a) => {
    if (a.biblioteca) return `  ${a.cabecera} → ${a.biblioteca} (no es oficial)`;
    const s = a.sugerencias ?? [];
    return `  ${a.cabecera} → la dan: ${s.slice(0, 4).join(', ')}${s.length > 4 ? '…' : ''}`;
  });
  return [
    'Tu código usa bibliotecas que no están en la biblioteca oficial de EMBEDVERSE:',
    ...lineas,
    'Quedó registrada la solicitud. Mientras tanto puedes usar una equivalente de la lista oficial '
      + '(GET /api/bibliotecas) o pedir al administrador que la incorpore.',
  ].join('\n');
}

export function mensajePendientes(p: InclusionAnalizada[]): string {
  return [
    'Estas bibliotecas son oficiales pero este servidor aún no las tiene instaladas:',
    ...p.map((x) => `  ${x.cabecera} → ${x.biblioteca} ${x.version}`),
    'Administrador: ejecute desde la carpeta del proyecto  sh scripts/placas.sh oficial  '
      + '(Windows: powershell -ExecutionPolicy Bypass -File scripts\\placas.ps1 oficial).',
  ].join('\n');
}

export function mensajeVersiones(v: Analisis['versionesDistintas']): string {
  return [
    'Hay bibliotecas instaladas con una versión distinta de la oficial (el resultado no sería reproducible):',
    ...v.map((x) => `  ${x.nombre}: instalada ${x.instalada}, oficial ${x.oficial}`),
    'Administrador: ejecute  sh scripts/placas.sh oficial  para dejar las versiones oficiales.',
  ].join('\n');
}

/**
 * Anota lo que los clientes piden y no tenemos (solo la cabecera y la fecha:
 * nada del código del cliente). Sirve para decidir qué incorporar.
 */
export async function anotarSolicitudes(raiz: string, ajenas: InclusionAnalizada[], placa: string): Promise<void> {
  if (!ajenas.length) return;
  const dir = path.join(raiz, '.tools');
  await mkdir(dir, { recursive: true });
  const ahora = new Date().toISOString();
  const lineas = ajenas.map((a) => JSON.stringify({
    fecha: ahora, placa, cabecera: a.cabecera, biblioteca: a.biblioteca ?? null, sugerencias: a.sugerencias ?? [],
  }) + '\n').join('');
  await appendFile(path.join(dir, 'solicitudes-bibliotecas.jsonl'), lineas, 'utf8');
}

/** GET /api/bibliotecas → la oficial, con lo que tiene instalado este servidor. */
export function createBibliotecasMiddleware(raiz: string) {
  return (request: import('node:http').IncomingMessage, response: import('node:http').ServerResponse, next: () => void): void => {
    if (request.method !== 'GET') {
      next();
      return;
    }
    void bibliotecasEn(path.join(raiz, '.tools', 'arduino-user', 'libraries')).then((inst) => {
      const porNombre = new Map(inst.map((i) => [i.nombre, i]));
      const bibliotecas = OFICIAL.map((b) => {
        const i = porNombre.get(b.nombre);
        return {
          nombre: b.nombre, version: b.version, grupo: b.grupo, requerida_por: b.requerida_por,
          cabeceras: i ? i.cabeceras : b.cabeceras, repositorio: b.repositorio, licencia: b.licencia,
          estado: !i ? 'no_instalada' : i.version === b.version ? 'instalada' : 'version_distinta',
        };
      });
      response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      response.end(JSON.stringify({ generado: (lock as { generado: string }).generado, bibliotecas }));
    }, (error: unknown) => {
      response.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({ error: error instanceof Error ? error.message : 'error' }));
    });
  };
}
