import { createServer } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { createBridgeAiMiddleware, createBridgeAiStatusMiddleware } from './bridgeAi';

const servers: ReturnType<typeof createServer>[] = [];
const originalApiKey = process.env.GEMINI_API_KEY;

afterEach(async () => {
  if (originalApiKey === undefined) delete process.env.GEMINI_API_KEY;
  else process.env.GEMINI_API_KEY = originalApiKey;
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

describe('Gemini bridge API', () => {
  it('reports a missing key without invoking Gemini or generating a fallback', async () => {
    delete process.env.GEMINI_API_KEY;
    const server = createServer((request, response) => {
      if (request.url === '/api/ai/bridge/status') {
        createBridgeAiStatusMiddleware()(request, response, () => response.writeHead(404).end());
        return;
      }
      createBridgeAiMiddleware()(request, response, () => response.writeHead(404).end());
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('No se pudo iniciar el servidor de prueba.');

    const origin = `http://127.0.0.1:${address.port}`;
    const statusResponse = await fetch(`${origin}/api/ai/bridge/status`);
    expect(await statusResponse.json()).toEqual({ configured: false });

    const response = await fetch(`${origin}/api/ai/bridge/interpret`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: origin },
      body: JSON.stringify({ prompt: 'Genera un puente conceptual' }),
    });
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      status: 'error',
      error: { code: 'GEMINI_API_KEY_MISSING' },
    });
  });

  it('rejects a request from an untrusted origin before contacting Gemini', async () => {
    const server = createServer((request, response) => {
      createBridgeAiMiddleware()(request, response, () => response.writeHead(404).end());
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('No se pudo iniciar el servidor de prueba.');

    const response = await fetch(`http://127.0.0.1:${address.port}/api/ai/bridge/interpret`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://untrusted.example' },
      body: JSON.stringify({ prompt: 'Genera un puente conceptual' }),
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      status: 'error',
      error: { code: 'LOCAL_ORIGIN_REQUIRED' },
    });
  });
});
