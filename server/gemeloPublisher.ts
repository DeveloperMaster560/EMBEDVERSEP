/**
 * Publicación del gemelo funcional de la app en la plataforma, como si fuera
 * una estación más (MQTT, mismo tópico y mismo contrato que el firmware).
 *
 * Límites deliberados:
 *  - Solo puede publicar estaciones que un proyecto.json declara «simuladas» y
 *    con `hardware.placa = "gemelo-app"`. La app nunca puede hacerse pasar por
 *    una estación instalada ni por la estación simulada del firmware.
 *  - Cada registro pasa por el validador del contrato antes de salir.
 *  - La contraseña de cada estación es la de su usuario del broker, que
 *    `plataforma/scripts/preparar.py` dejó en `plataforma/.env`. Se lee aquí, en
 *    el servidor; el navegador nunca la ve. Por eso solo funciona cuando la app
 *    y la plataforma corren en el mismo equipo.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { validateStationRecord } from '../src/shm/data-contract.js';
import { publicar as publicarMqtt, type MensajeMqtt, type MqttCredenciales } from './mqttLite.js';

export const PLACA_GEMELO = 'gemelo-app';
export const MAX_REGISTROS = 60;

export interface EstacionGemelo {
  proyecto: string;
  sensorId: string | null;
}

/** Estaciones que la app puede publicar, leídas de proyectos/*\/proyecto.json. */
export function estacionesGemelo(root: string): Map<string, EstacionGemelo> {
  const out = new Map<string, EstacionGemelo>();
  const dir = join(root, 'proyectos');
  if (!existsSync(dir)) return out;
  for (const sub of readdirSync(dir, { withFileTypes: true })) {
    if (!sub.isDirectory()) continue;
    const f = join(dir, sub.name, 'proyecto.json');
    if (!existsSync(f)) continue;
    try {
      const d = JSON.parse(readFileSync(f, 'utf8')) as {
        proyecto_id: string;
        estaciones?: { id: string; estado: string; hardware?: { placa?: string | null }; sensores?: { id: string }[] }[];
      };
      for (const e of d.estaciones ?? []) {
        if (e.estado === 'simulada' && e.hardware?.placa === PLACA_GEMELO) {
          out.set(e.id, { proyecto: d.proyecto_id, sensorId: e.sensores?.[0]?.id ?? null });
        }
      }
    } catch {
      /* un proyecto ilegible no habilita nada; la plataforma ya lo rechaza al arrancar */
    }
  }
  return out;
}

export function variableClave(stationId: string): string {
  return `MQTT_${stationId.replaceAll('-', '_')}_PASSWORD`;
}

export function leerEnv(texto: string): Map<string, string> {
  const m = new Map<string, string>();
  for (const linea of texto.split(/\r?\n/)) {
    if (!linea.includes('=') || linea.trimStart().startsWith('#')) continue;
    const i = linea.indexOf('=');
    m.set(linea.slice(0, i).trim(), linea.slice(i + 1).trim());
  }
  return m;
}

export interface Resultado {
  publicados: number;
  rechazados: { station_id: string; motivo: string }[];
}

type Publicador = (c: MqttCredenciales, m: MensajeMqtt[]) => Promise<number>;

export async function publicarRegistros(
  root: string,
  registros: unknown[],
  opciones: { env?: NodeJS.ProcessEnv; publicador?: Publicador } = {},
): Promise<Resultado> {
  const env = opciones.env ?? process.env;
  const publicador = opciones.publicador ?? publicarMqtt;
  if (registros.length > MAX_REGISTROS) throw new Error(`Como mucho ${MAX_REGISTROS} registros por envío.`);

  const permitidas = estacionesGemelo(root);
  const envFile = join(root, 'plataforma', '.env');
  const claves = existsSync(envFile) ? leerEnv(readFileSync(envFile, 'utf8')) : new Map<string, string>();
  const rechazados: Resultado['rechazados'] = [];
  const porEstacion = new Map<string, MensajeMqtt[]>();

  for (const r of registros) {
    const sid = typeof r === 'object' && r && typeof (r as { station_id?: unknown }).station_id === 'string'
      ? (r as { station_id: string }).station_id : '(sin station_id)';
    const permitida = permitidas.get(sid);
    if (!permitida) {
      rechazados.push({ station_id: sid, motivo: 'No es una estación del gemelo (proyecto.json: estado «simulada» y placa «gemelo-app»).' });
      continue;
    }
    const problemas = validateStationRecord(r);
    if (problemas.length) {
      rechazados.push({ station_id: sid, motivo: `No cumple el contrato: ${problemas.join(' ')}` });
      continue;
    }
    const sensor = (r as { sensor_id?: string }).sensor_id;
    if (permitida.sensorId && sensor !== permitida.sensorId) {
      rechazados.push({ station_id: sid, motivo: `El sensor debe ser «${permitida.sensorId}», no «${sensor}».` });
      continue;
    }
    const lista = porEstacion.get(sid) ?? [];
    lista.push({ topic: `shm/v1/${sid}/registro`, payload: JSON.stringify(r) });
    porEstacion.set(sid, lista);
  }

  let publicados = 0;
  const host = env.PLATAFORMA_MQTT_HOST ?? '127.0.0.1';
  const port = Number(env.PLATAFORMA_MQTT_PORT ?? 1883);
  for (const [sid, mensajes] of porEstacion) {
    const clave = claves.get(variableClave(sid));
    if (!clave) {
      rechazados.push(...mensajes.map(() => ({
        station_id: sid,
        motivo: `La estación no tiene usuario en el broker (${variableClave(sid)} en plataforma/.env). Ejecuta scripts/iniciar de la plataforma.`,
      })));
      continue;
    }
    try {
      publicados += await publicador({ host, port, usuario: sid, clave, clientId: `embedverse-app-${sid}` }, mensajes);
    } catch (e) {
      rechazados.push(...mensajes.map(() => ({ station_id: sid, motivo: e instanceof Error ? e.message : String(e) })));
    }
  }
  return { publicados, rechazados };
}
