import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { CompileRequestError } from './arduinoCompiler';
import { createSimuladorMiddleware, simular, validarSimulacion } from './simulador';

const raiz = process.cwd();
const hayCompilador = (() => {
  try { execFileSync('c++', ['--version'], { stdio: 'ignore' }); return true; } catch { return false; }
})();
const base = {
  boardId: 'esp32-devkit', files: [{ path: 'main.ino', content: 'void setup(){}\nvoid loop(){}\n' }],
  escenario: 't_s,temperatura\n0,20\n', duracion_s: 5,
};

describe('validar una simulación', () => {
  it('acepta lo mínimo y rechaza lo que no se puede simular', () => {
    expect(validarSimulacion(base).duracion_s).toBe(5);
    const falla = (v: object) => { try { validarSimulacion({ ...base, ...v }); return null; } catch (e) { return (e as CompileRequestError).code; } };
    expect(falla({ boardId: 'placa-inventada' })).toBe('UNSUPPORTED_BOARD');
    expect(falla({ escenario: 'temperatura\n20\n' })).toBe('INVALID_SCENARIO');
    expect(falla({ duracion_s: 99999 })).toBe('INVALID_DURATION');
    expect(falla({ conexiones: ['MAX31865 cs=10; rm -rf /'] })).toBe('INVALID_CONNECTION');
    expect(falla({ escenario: '#@ conectar MAX31865 cs=10\nt_s,rtd\n0,21\n' })).toBeNull();
  });
});

describe('modo público', () => {
  const servidores: ReturnType<typeof createServer>[] = [];
  afterEach(async () => {
    delete process.env.EMBEDVERSE_PUBLICO;
    await Promise.all(servidores.splice(0).map((s) => new Promise<void>((r) => s.close(() => r()))));
  });

  it('no ejecuta código ajeno en el servidor', async () => {
    process.env.EMBEDVERSE_PUBLICO = '1';
    const s = createServer((req, res) => createSimuladorMiddleware(raiz)(req, res, () => res.end()));
    servidores.push(s);
    await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
    const { port } = s.address() as { port: number };
    const url = `http://127.0.0.1:${port}`;
    const r = await fetch(`${url}/api/simular`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Origin: url }, body: JSON.stringify(base),
    });
    expect(r.status).toBe(403);
    expect((await r.json() as { code: string }).code).toBe('SIMULACION_SOLO_LOCAL');
  });
});

describe.skipIf(!hayCompilador)('simular de verdad', () => {
  it('un sketch con main.cpp corre contra el escenario y devuelve lo que imprimió', async () => {
    const r = await simular(raiz, validarSimulacion({
      ...base,
      files: [{ path: 'src/main.cpp', content: '#include <Arduino.h>\nvoid setup(){ Serial.begin(115200); }\n'
        + 'void loop(){ Serial.println(analogRead(34)); delay(1000); }\n' }],
      escenario: 't_s,A34\n0,1000\n10,2000\n',
    }));
    expect(r.ok, r.error).toBe(true);
    expect(r.serie?.slice(0, 3)).toEqual(['1000', '1100', '1200']);
  }, 120_000);
});
