/**
 * Placas que el compilador conoce (server/placas.json) y si su núcleo está
 * instalado en ESTE equipo.
 *
 * La lista es la misma que leen scripts/placas.ps1 y scripts/placas.sh para
 * instalar núcleos: así la app y los scripts no se pueden contradecir.
 */
import { access, readdir } from 'node:fs/promises';
import path from 'node:path';
import datos from './placas.json' with { type: 'json' };

export interface Placa {
  id: string;
  nombre: string;
  familia: string;
  /** Fully Qualified Board Name de arduino-cli: paquete:arquitectura:placa[:opciones]. */
  fqbn: string;
  /** paquete:arquitectura del núcleo que hay que instalar. */
  paquete: string;
  /** URL del índice del fabricante; null = está en el índice oficial de Arduino. */
  indice: string | null;
  descarga_mb: number | null;
  /** Compilación lenta (ESP32, STM32, RP2040): se le da más tiempo. */
  lento: boolean;
  notas: string | null;
}

export const PLACAS: readonly Placa[] = (datos as { placas: Placa[] }).placas;

export function buscarPlaca(id: unknown): Placa | undefined {
  return typeof id === 'string' ? PLACAS.find((p) => p.id === id) : undefined;
}

/**
 * Directorios de núcleos de este sistema, en orden. Igual que el compilador:
 * cada sistema operativo tiene el suyo (las herramientas son binarios
 * nativos) y `.tools/arduino-data` es el histórico (Windows).
 */
export function directoriosDeNucleos(raiz: string, plataforma: NodeJS.Platform = process.platform): string[] {
  const tools = path.join(raiz, '.tools');
  return [path.join(tools, `arduino-data-${plataforma}`), path.join(tools, 'arduino-data')];
}

/** ¿Hay en `dir` una versión instalada del núcleo `paquete` (vendedor:arquitectura)? */
async function nucleoEn(dir: string, paquete: string): Promise<boolean> {
  const [vendedor, arquitectura] = paquete.split(':');
  const base = path.join(dir, 'packages', vendedor, 'hardware', arquitectura);
  let versiones: string[];
  try {
    versiones = await readdir(base);
  } catch {
    return false;
  }
  for (const v of versiones) {
    try {
      await access(path.join(base, v, 'platform.txt'));
      return true;
    } catch {
      // versión incompleta: se prueba la siguiente
    }
  }
  return false;
}

/**
 * Directorio donde está instalado el núcleo de la placa, o null.
 *
 * El núcleo AVR tiene una comprobación más estricta en arduinoCompiler.ts
 * (exige el avr-gcc nativo). Para los demás basta con platform.txt: si el
 * núcleo se copió de otro sistema, arduino-cli lo dirá al compilar.
 */
export async function nucleoInstalado(raiz: string, placa: Placa, plataforma: NodeJS.Platform = process.platform): Promise<string | null> {
  for (const dir of directoriosDeNucleos(raiz, plataforma)) {
    if (await nucleoEn(dir, placa.paquete)) return dir;
  }
  return null;
}

/** Cómo instalarlo, para el mensaje de error. */
export function comoInstalar(placa: Placa, plataforma: NodeJS.Platform = process.platform): string {
  const orden = plataforma === 'win32'
    ? `powershell -ExecutionPolicy Bypass -File scripts\\placas.ps1 nucleo ${placa.id}`
    : `sh scripts/placas.sh nucleo ${placa.id}`;
  const peso = placa.descarga_mb ? ` (descarga de unos ${placa.descarga_mb} MB)` : '';
  return `Falta el núcleo ${placa.paquete} para ${placa.nombre}${peso}. Instálalo desde la carpeta del proyecto con:\n  ${orden}\nDespués vuelve a compilar.`;
}

export interface PlacaConEstado extends Placa {
  instalada: boolean;
}

/** GET /api/placas → la lista con «instalada» según este equipo. Solo lectura. */
export function createPlacasMiddleware(raiz: string) {
  return (request: import('node:http').IncomingMessage, response: import('node:http').ServerResponse, next: () => void): void => {
    if (request.method !== 'GET') {
      next();
      return;
    }
    void Promise.all(PLACAS.map(async (p) => ({ ...p, instalada: (await nucleoInstalado(raiz, p)) !== null })))
      .then((placas: PlacaConEstado[]) => {
        response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        response.end(JSON.stringify({ placas }));
      }, (error: unknown) => {
        response.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        response.end(JSON.stringify({ error: error instanceof Error ? error.message : 'error' }));
      });
  };
}
