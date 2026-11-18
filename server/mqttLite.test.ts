import { createServer, type Server } from 'node:net';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';

import { connectPacket, publicar, remainingLength } from './mqttLite';

describe('MQTT mínimo: paquetes', () => {
  it('longitud restante en varint', () => {
    expect([...remainingLength(0)]).toEqual([0]);
    expect([...remainingLength(127)]).toEqual([127]);
    expect([...remainingLength(128)]).toEqual([0x80, 0x01]);
    expect([...remainingLength(16384)]).toEqual([0x80, 0x80, 0x01]);
  });

  it('CONNECT 3.1.1 con usuario, contraseña y sesión limpia', () => {
    const p = connectPacket({ usuario: 'GEM-SD-V2-M', clave: 'x', clientId: 'c' });
    expect(p[0]).toBe(0x10);
    expect(p.subarray(2, 8).toString('latin1')).toBe('\x00\x04MQTT');
    expect(p[8]).toBe(4);
    expect(p[9]).toBe(0xc2);
  });
});

describe('MQTT mínimo: contra un broker falso', () => {
  let server: Server;
  const recibidos: { topic: string; payload: string }[] = [];

  async function broker(rc: number): Promise<number> {
    recibidos.length = 0;
    server = createServer((s) => {
      s.on('data', (d: Buffer) => {
        let i = 0;
        while (i < d.length) {
          const tipo = d[i] >> 4;
          let len = 0; let mult = 1; let j = i + 1;
          for (;;) { const b = d[j++]; len += (b & 0x7f) * mult; mult *= 128; if (!(b & 0x80)) break; }
          const cuerpo = d.subarray(j, j + len);
          if (tipo === 1) s.write(Buffer.from([0x20, 2, 0, rc]));
          if (tipo === 3) {
            const tl = cuerpo.readUInt16BE(0);
            const topic = cuerpo.subarray(2, 2 + tl).toString();
            const id = cuerpo.readUInt16BE(2 + tl);
            recibidos.push({ topic, payload: cuerpo.subarray(4 + tl).toString() });
            s.write(Buffer.from([0x40, 2, id >> 8, id & 0xff]));
          }
          i = j + len;
        }
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    return (server.address() as AddressInfo).port;
  }

  afterEach(() => server?.close());

  it('publica con QoS 1 y espera cada PUBACK', async () => {
    const port = await broker(0);
    const n = await publicar({ host: '127.0.0.1', port, usuario: 'GEM-SD-V2-M', clave: 'k', clientId: 'c' },
      [{ topic: 'shm/v1/GEM-SD-V2-M/registro', payload: '{"a":1}' }, { topic: 'shm/v1/GEM-SD-V2-M/registro', payload: '{"a":2}' }]);
    expect(n).toBe(2);
    expect(recibidos.map((r) => r.payload)).toEqual(['{"a":1}', '{"a":2}']);
  });

  it('una contraseña rechazada se explica', async () => {
    const port = await broker(4);
    await expect(publicar({ host: '127.0.0.1', port, usuario: 'X1', clave: 'mal', clientId: 'c' }, [{ topic: 't', payload: '1' }]))
      .rejects.toThrow('usuario o contraseña incorrectos');
  });

  it('un broker apagado se explica', async () => {
    await expect(publicar({ host: '127.0.0.1', port: 1, usuario: 'X1', clave: 'k', clientId: 'c' }, [{ topic: 't', payload: '1' }]))
      .rejects.toThrow('No se pudo hablar con el broker');
  });
});
