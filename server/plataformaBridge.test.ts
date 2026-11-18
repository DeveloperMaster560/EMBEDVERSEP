import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ConnectionStore, createPlataformaMiddleware, filterQuery, forward, isReadRoute, normalizeUrl } from './plataformaBridge';

const TOKEN = 'tok_abcdefghijklmnopqrstuvwxyz012345';

describe('puente app → plataforma: reglas', () => {
  it('solo deja pasar rutas de lectura conocidas', () => {
    for (const ok of ['/v1/sesion', '/v1/proyectos', '/v1/proyectos/novena', '/v1/estaciones',
      '/v1/estaciones/SD-V2-M/ventanas', '/v1/estaciones/SD-V2-M/disponibilidad', '/v1/avisos']) {
      expect(isReadRoute(ok), ok).toBe(true);
    }
    for (const no of ['/v1/avisos/7/reconocer', '/v1/avisos/7/nivel', '/v1/crudos/SD-V2-M', '/v1/estaciones/../salud',
      '/v1/estaciones/sd-v2-m/ventanas', '/docs', '/v1/proyectos/Novena']) {
      expect(isReadRoute(no), no).toBe(false);
    }
  });

  it('filtra los parámetros de la consulta', () => {
    expect(filterQuery(new URLSearchParams('horas=24&token=x&abiertos=true'))).toBe('?horas=24&abiertos=true');
    expect(filterQuery(new URLSearchParams('otra=1'))).toBe('');
  });

  it('acepta solo http/https sin credenciales en la URL', () => {
    expect(normalizeUrl('http://127.0.0.1:8000/api/docs')).toBe('http://127.0.0.1:8000');
    expect(() => normalizeUrl('file:///etc/passwd')).toThrow();
    expect(() => normalizeUrl('http://u:p@host')).toThrow();
  });

  it('una plataforma apagada da un 502 que dice qué hacer', async () => {
    const caida = (async () => { throw new TypeError('fetch failed'); }) as unknown as typeof fetch;
    const r = await forward({ url: 'http://127.0.0.1:1', token: TOKEN }, '/v1/sesion', '', caida);
    expect(r.status).toBe(502);
    expect(JSON.stringify(r.body)).toContain('scripts/iniciar');
  });
});

describe('puente app → plataforma: servidor', () => {
  let dir: string;
  let store: ConnectionStore;
  let server: Server;
  let base: string;
  const llamadas: { url: string; auth: string | null }[] = [];

  // Plataforma falsa: acepta un solo token.
  const plataforma = (async (input: string | URL, init?: RequestInit) => {
    const auth = new Headers(init?.headers).get('Authorization');
    llamadas.push({ url: String(input), auth });
    const ok = auth === `Bearer ${TOKEN}`;
    const body = ok ? { rol: 'lectura', proyecto_id: 'novena', url: String(input) } : { detail: 'Token no válido o revocado.' };
    return new Response(JSON.stringify(body), { status: ok ? 200 : 401 });
  }) as typeof fetch;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'plat-'));
    store = new ConnectionStore(dir, {});
    llamadas.length = 0;
    const mw = createPlataformaMiddleware(dir, store, plataforma);
    server = createServer((req, res) => {
      req.url = req.url!.replace(/^\/api\/plataforma/, '') || '/';
      void mw(req, res, () => undefined);
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/plataforma`;
  });

  afterEach(() => {
    server.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('sin conexión pide configurarla', async () => {
    const r = await fetch(`${base}/v1/estaciones`);
    expect(r.status).toBe(428);
  });

  it('un token rechazado no se guarda', async () => {
    const r = await fetch(`${base}/conexion`, { method: 'POST', body: JSON.stringify({ token: 'malo_malo_malo_malo_malo_1' }) });
    expect(r.status).toBe(401);
    expect(store.get()).toBeNull();
  });

  it('guarda el token, nunca lo devuelve y lo usa al reenviar', async () => {
    const r = await fetch(`${base}/conexion`, { method: 'POST', body: JSON.stringify({ url: 'http://plataforma:8000', token: TOKEN }) });
    expect(r.status).toBe(200);
    const texto = await r.text();
    expect(texto).not.toContain(TOKEN);
    expect(JSON.parse(texto).sesion.proyecto_id).toBe('novena');
    expect(readFileSync(store.file, 'utf8')).toContain(TOKEN);

    const desc = await (await fetch(`${base}/conexion`)).text();
    expect(desc).not.toContain(TOKEN);
    expect(JSON.parse(desc)).toMatchObject({ configurada: true, fuente: 'archivo', url: 'http://plataforma:8000' });

    const e = await fetch(`${base}/v1/estaciones/SD-V2-M/ventanas?limite=5&token=robado`);
    expect(e.status).toBe(200);
    expect(llamadas.at(-1)).toEqual({ url: 'http://plataforma:8000/api/v1/estaciones/SD-V2-M/ventanas?limite=5', auth: `Bearer ${TOKEN}` });
  });

  it('no deja escribir ni salir de la lista', async () => {
    store.save('http://plataforma:8000', TOKEN);
    expect((await fetch(`${base}/v1/avisos/7/reconocer`, { method: 'POST', body: '{}' })).status).toBe(405);
    expect((await fetch(`${base}/v1/crudos/SD-V2-M`)).status).toBe(404);
    expect(llamadas).toHaveLength(0);
  });

  it('desconectar borra el token', async () => {
    store.save('http://plataforma:8000', TOKEN);
    const r = await fetch(`${base}/conexion`, { method: 'DELETE' });
    expect((await r.json()).configurada).toBe(false);
    expect(store.get()).toBeNull();
  });
});
