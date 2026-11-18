/**
 * Puente entre la app y la plataforma de datos SHM (`plataforma/`).
 *
 * El navegador nunca ve el token: lo guarda este servidor local, en
 * `.embedverse/plataforma.json` (fuera del repositorio) o en las variables de
 * entorno PLATAFORMA_URL y PLATAFORMA_TOKEN. El navegador solo pide rutas de
 * LECTURA de una lista cerrada, y este servidor las reenvía con el token.
 *
 * Qué ve el usuario lo decide la plataforma, no la app: el token pertenece a un
 * proyecto y la plataforma responde 404 a todo lo que está fuera de él.
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import type { IncomingMessage } from 'node:http';
import { join } from 'node:path';
import type { Connect } from 'vite';

import { MAX_REGISTROS, publicarRegistros } from './gemeloPublisher.js';

export const DEFAULT_PLATFORM_URL = 'http://127.0.0.1:8000';
const TIMEOUT_MS = 8000;
const MAX_BODY = 256 * 1024;

/** Rutas de la API de la plataforma que la app puede leer. Nada que modifique. */
const READ_ROUTES: RegExp[] = [
  /^\/v1\/sesion$/,
  /^\/v1\/proyectos$/,
  /^\/v1\/proyectos\/[a-z0-9][a-z0-9-]{1,39}$/,
  /^\/v1\/estaciones$/,
  /^\/v1\/estaciones\/[A-Z0-9][A-Z0-9-]{1,31}\/(ventanas|disponibilidad)$/,
  /^\/v1\/avisos$/,
];
const QUERY_PARAMS = new Set(['desde', 'hasta', 'limite', 'completo', 'horas', 'abiertos']);

export function isReadRoute(path: string): boolean {
  return READ_ROUTES.some((r) => r.test(path));
}

/** Solo pasan los parámetros conocidos, para no reenviar nada inesperado. */
export function filterQuery(search: URLSearchParams): string {
  const out = new URLSearchParams();
  for (const [k, v] of search) if (QUERY_PARAMS.has(k) && v.length <= 64) out.append(k, v);
  const s = out.toString();
  return s ? `?${s}` : '';
}

export function normalizeUrl(raw: string): string {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    throw new Error('La dirección de la plataforma no es una URL válida.');
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('La dirección debe empezar por http:// o https://.');
  if (u.username || u.password) throw new Error('La dirección no debe llevar usuario ni contraseña.');
  return u.origin;
}

export interface Connection {
  url: string;
  token: string;
  source: 'entorno' | 'archivo';
}

export class ConnectionStore {
  readonly file: string;
  private readonly env: NodeJS.ProcessEnv;

  constructor(root: string, env: NodeJS.ProcessEnv = process.env) {
    this.file = join(root, '.embedverse', 'plataforma.json');
    this.env = env;
  }

  get(): Connection | null {
    if (this.env.PLATAFORMA_TOKEN) {
      return { url: normalizeUrl(this.env.PLATAFORMA_URL ?? DEFAULT_PLATFORM_URL), token: this.env.PLATAFORMA_TOKEN, source: 'entorno' };
    }
    if (!existsSync(this.file)) return null;
    try {
      const d = JSON.parse(readFileSync(this.file, 'utf8')) as { url?: string; token?: string };
      if (!d.token) return null;
      return { url: normalizeUrl(d.url ?? DEFAULT_PLATFORM_URL), token: d.token, source: 'archivo' };
    } catch {
      return null;
    }
  }

  save(url: string, token: string): void {
    mkdirSync(join(this.file, '..'), { recursive: true });
    writeFileSync(this.file, JSON.stringify({ url, token }, null, 2), { encoding: 'utf8', mode: 0o600 });
  }

  clear(): void {
    rmSync(this.file, { force: true });
  }

  /** Lo que se le puede contar al navegador: nunca el token. */
  describe(): { url: string; configurada: boolean; fuente: Connection['source'] | null } {
    const c = this.get();
    return { url: c?.url ?? this.env.PLATAFORMA_URL ?? DEFAULT_PLATFORM_URL, configurada: c !== null, fuente: c?.source ?? null };
  }
}

export interface Forwarded {
  status: number;
  body: unknown;
}

/** GET a la plataforma con el token. Los fallos de red se traducen a un 502 claro. */
export async function forward(conn: { url: string; token: string }, path: string, query = '', fetchImpl: typeof fetch = fetch): Promise<Forwarded> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetchImpl(`${conn.url}/api${path}${query}`, {
      headers: { Authorization: `Bearer ${conn.token}`, Accept: 'application/json' },
      signal: ctrl.signal,
    });
    const text = await r.text();
    let body: unknown;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = { detail: text.slice(0, 300) };
    }
    return { status: r.status, body };
  } catch (e) {
    const why = e instanceof Error && e.name === 'AbortError' ? 'no respondió a tiempo' : 'no responde';
    return { status: 502, body: { detail: `La plataforma en ${conn.url} ${why}. ¿Está arrancada (scripts/iniciar)?` } };
  } finally {
    clearTimeout(timer);
  }
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > MAX_BODY) throw new Error('Cuerpo demasiado grande.');
    chunks.push(c as Buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

type Publicar = typeof publicarRegistros;

export function createPlataformaMiddleware(
  root: string,
  store = new ConnectionStore(root),
  fetchImpl: typeof fetch = fetch,
  publicar: Publicar = publicarRegistros,
): Connect.NextHandleFunction {
  return async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://local');
    const send = (code: number, body: unknown) => {
      res.statusCode = code;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.end(JSON.stringify(body));
    };
    try {
      if (url.pathname === '/conexion') {
        if (req.method === 'GET') return send(200, store.describe());
        if (req.method === 'DELETE') {
          if (store.get()?.source === 'entorno') return send(409, { detail: 'La conexión viene de PLATAFORMA_TOKEN; quítala del entorno.' });
          store.clear();
          return send(200, store.describe());
        }
        if (req.method === 'POST') {
          const b = (await readJson(req)) as { url?: string; token?: string };
          const token = (b.token ?? '').trim();
          if (!/^[A-Za-z0-9_-]{20,200}$/.test(token)) return send(400, { detail: 'El token no tiene el formato esperado.' });
          const base = normalizeUrl(b.url || DEFAULT_PLATFORM_URL);
          // Solo se guarda si la plataforma lo acepta.
          const check = await forward({ url: base, token }, '/v1/sesion', '', fetchImpl);
          if (check.status !== 200) {
            const detail = check.status === 401 ? 'La plataforma no reconoce ese token (o está revocado).' : (check.body as { detail?: string })?.detail;
            return send(check.status === 401 ? 401 : 502, { detail });
          }
          store.save(base, token);
          return send(200, { ...store.describe(), sesion: check.body });
        }
        return send(405, { detail: 'Método no permitido.' });
      }

      // La única escritura: el gemelo funcional publica por MQTT como sus
      // estaciones (solo las declaradas «gemelo-app»; ver gemeloPublisher.ts).
      if (url.pathname === '/publicar') {
        if (req.method !== 'POST') return send(405, { detail: 'Método no permitido.' });
        const b = (await readJson(req)) as { registros?: unknown };
        if (!Array.isArray(b.registros)) return send(400, { detail: 'Falta «registros» (lista).' });
        if (b.registros.length > MAX_REGISTROS) return send(413, { detail: `Como mucho ${MAX_REGISTROS} registros por envío.` });
        return send(200, await publicar(root, b.registros));
      }

      if (req.method !== 'GET') return send(405, { detail: 'La app solo lee de la plataforma.' });
      if (!isReadRoute(url.pathname)) return send(404, { detail: 'Ruta no disponible desde la app.' });
      const conn = store.get();
      if (!conn) return send(428, { detail: 'Falta conectar la app con la plataforma (token).' });
      const r = await forward(conn, url.pathname, filterQuery(url.searchParams), fetchImpl);
      return send(r.status, r.body);
    } catch (e) {
      return send(400, { detail: e instanceof Error ? e.message : String(e) });
    }
  };
}
