/**
 * Cliente MQTT 3.1.1 mínimo: conectar con usuario y contraseña, publicar con
 * QoS 1 (esperando el PUBACK de cada mensaje) y desconectar.
 *
 * Es todo lo que necesita el servidor de la app para que el gemelo funcional
 * publique como una estación más, sin añadir dependencias al proyecto.
 * No suscribe, no reconecta y no usa TLS (el broker local escucha en 127.0.0.1).
 */

import { connect, type Socket } from 'node:net';

const TIMEOUT_MS = 5000;

export interface MqttCredenciales {
  host: string;
  port: number;
  usuario: string;
  clave: string;
  clientId: string;
}

export interface MensajeMqtt {
  topic: string;
  payload: string;
}

export function remainingLength(n: number): Buffer {
  const out: number[] = [];
  do {
    let byte = n % 128;
    n = Math.floor(n / 128);
    if (n > 0) byte |= 0x80;
    out.push(byte);
  } while (n > 0);
  return Buffer.from(out);
}

function str(s: string): Buffer {
  const b = Buffer.from(s, 'utf8');
  if (b.length > 0xffff) throw new Error('Cadena MQTT demasiado larga.');
  const len = Buffer.alloc(2);
  len.writeUInt16BE(b.length);
  return Buffer.concat([len, b]);
}

function packet(first: number, body: Buffer): Buffer {
  return Buffer.concat([Buffer.from([first]), remainingLength(body.length), body]);
}

export function connectPacket(c: Pick<MqttCredenciales, 'usuario' | 'clave' | 'clientId'>, keepAliveS = 30): Buffer {
  const ka = Buffer.alloc(2);
  ka.writeUInt16BE(keepAliveS);
  // usuario (0x80) + contraseña (0x40) + sesión limpia (0x02)
  const varHeader = Buffer.concat([str('MQTT'), Buffer.from([4, 0x80 | 0x40 | 0x02]), ka]);
  return packet(0x10, Buffer.concat([varHeader, str(c.clientId), str(c.usuario), str(c.clave)]));
}

export function publishPacket(m: MensajeMqtt, packetId: number): Buffer {
  const id = Buffer.alloc(2);
  id.writeUInt16BE(packetId);
  return packet(0x32, Buffer.concat([str(m.topic), id, Buffer.from(m.payload, 'utf8')])); // PUBLISH, QoS 1
}

const CONNACK_RAZON: Record<number, string> = {
  1: 'versión de protocolo no aceptada',
  2: 'identificador de cliente rechazado',
  3: 'servidor no disponible',
  4: 'usuario o contraseña incorrectos',
  5: 'no autorizado',
};

/** Lee paquetes completos del flujo TCP (pueden llegar partidos o juntos). */
class Lector {
  private buf = Buffer.alloc(0);

  push(chunk: Buffer): { tipo: number; cuerpo: Buffer }[] {
    this.buf = Buffer.concat([this.buf, chunk]);
    const out: { tipo: number; cuerpo: Buffer }[] = [];
    for (;;) {
      if (this.buf.length < 2) break;
      let mult = 1;
      let len = 0;
      let i = 1;
      let completo = false;
      while (i < this.buf.length && i <= 4) {
        const b = this.buf[i];
        len += (b & 0x7f) * mult;
        mult *= 128;
        i++;
        if ((b & 0x80) === 0) { completo = true; break; }
      }
      if (!completo || this.buf.length < i + len) break;
      out.push({ tipo: this.buf[0] >> 4, cuerpo: this.buf.subarray(i, i + len) });
      this.buf = this.buf.subarray(i + len);
    }
    return out;
  }
}

/**
 * Conecta, publica todos los mensajes con QoS 1 y desconecta.
 * Resuelve cuando el broker confirmó (PUBACK) cada mensaje.
 *
 * Ojo: con MQTT 3.1.1, Mosquitto confirma también lo que la ACL le prohíbe
 * (y lo descarta en silencio). La confirmación significa «entregado al
 * broker», no «aceptado»: eso se comprueba en la plataforma.
 */
export function publicar(c: MqttCredenciales, mensajes: MensajeMqtt[]): Promise<number> {
  return new Promise((resolve, reject) => {
    const sock: Socket = connect({ host: c.host, port: c.port });
    const lector = new Lector();
    const pendientes = new Set<number>();
    let terminado = false;
    const fin = (err?: Error) => {
      if (terminado) return;
      terminado = true;
      clearTimeout(timer);
      if (!err) sock.end(Buffer.from([0xe0, 0x00])); // DISCONNECT
      else sock.destroy();
      if (err) reject(err);
      else resolve(mensajes.length);
    };
    const timer = setTimeout(() => fin(new Error(`El broker MQTT en ${c.host}:${c.port} no respondió a tiempo.`)), TIMEOUT_MS);

    sock.on('connect', () => sock.write(connectPacket(c)));
    sock.on('error', (e) => fin(new Error(`No se pudo hablar con el broker MQTT en ${c.host}:${c.port}: ${e.message}`)));
    sock.on('close', () => fin(new Error('El broker cerró la conexión antes de confirmar.')));
    sock.on('data', (chunk: Buffer) => {
      for (const p of lector.push(chunk)) {
        if (p.tipo === 2) { // CONNACK
          const rc = p.cuerpo[1];
          if (rc !== 0) return fin(new Error(`El broker rechazó la conexión de «${c.usuario}»: ${CONNACK_RAZON[rc] ?? `código ${rc}`}.`));
          if (mensajes.length === 0) return fin();
          mensajes.forEach((m, i) => {
            pendientes.add(i + 1);
            sock.write(publishPacket(m, i + 1));
          });
        } else if (p.tipo === 4) { // PUBACK
          pendientes.delete(p.cuerpo.readUInt16BE(0));
          if (pendientes.size === 0) fin();
        }
      }
    });
  });
}
