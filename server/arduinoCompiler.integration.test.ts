import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { createArduinoCompileMiddleware } from './arduinoCompiler';

const root = process.cwd();
const cliName = process.platform === 'win32' ? 'arduino-cli.exe' : 'arduino-cli';
const toolchainAvailable =
  existsSync(`${root}/.tools/arduino-cli/${cliName}`) &&
  existsSync(`${root}/.tools/arduino-data/packages/arduino/hardware/avr/1.8.8/platform.txt`);
const servers: ReturnType<typeof createServer>[] = [];

async function startCompileServer(): Promise<string> {
  const server = createServer((request, response) => {
    createArduinoCompileMiddleware(root)(request, response, () => {
      response.writeHead(404);
      response.end();
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No se pudo iniciar el servidor de prueba.');
  return `http://127.0.0.1:${address.port}`;
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

describe('Arduino compile endpoint', () => {
  it('rejects compile requests from another origin', async () => {
    const origin = await startCompileServer();
    const rejected = await fetch(`${origin}/api/compile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://untrusted.example' },
      body: JSON.stringify({ boardId: 'arduino-uno', files: [{ path: 'main.ino', content: '' }] }),
    });
    expect(rejected.status).toBe(403);
  });

  it.skipIf(toolchainAvailable)('reports a missing host-compatible toolchain as unavailable', async () => {
    const origin = await startCompileServer();
    const response = await fetch(`${origin}/api/compile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: origin },
      body: JSON.stringify({
        boardId: 'arduino-uno',
        files: [{ path: 'main.ino', content: 'void setup() {} void loop() {}' }],
      }),
    });
    const result = await response.json() as { code?: string };

    expect(response.status).toBe(503);
    expect(result.code).toBe('TOOLCHAIN_NOT_INSTALLED');
  });

  it.skipIf(!toolchainAvailable)('compiles an Arduino Uno sketch and returns a downloadable HEX artifact', async () => {
    const origin = await startCompileServer();
    const response = await fetch(`${origin}/api/compile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: origin },
      body: JSON.stringify({
        boardId: 'arduino-uno',
        files: [{
          path: 'src/main.cpp',
          content: '#include <Arduino.h>\nvoid setup(){ pinMode(LED_BUILTIN, OUTPUT); }\nvoid loop(){ digitalWrite(LED_BUILTIN, !digitalRead(LED_BUILTIN)); delay(500); }',
        }],
      }),
    });
    const result = await response.json() as {
      success: boolean;
      artifacts?: { name: string; downloadBase64?: string }[];
    };

    expect(response.status).toBe(200);
    expect(result.success).toBe(true);
    const firmware = result.artifacts?.find((artifact) => artifact.name.endsWith('.ino.hex'));
    expect(firmware?.downloadBase64).toMatch(/^[A-Za-z0-9+/]+=*$/);
  }, 30_000);
});
