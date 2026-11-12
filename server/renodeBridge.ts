/**
 * Puente entre la aplicación y Renode, que ejecuta el firmware REAL de la
 * estación (firmware/shm-station/build/shm-station.elf) en un STM32H743
 * emulado.
 *
 * El puente gobierna el tiempo: avanza la emulación de segundo en segundo
 * (`emulation RunFor`) y, al empezar cada segundo virtual, entrega la trama
 * RMC por USART1 y el flanco PPS en PA0. Así el PPS va con el reloj del chip
 * emulado y no con el del ordenador.
 *
 *   GET  /api/shm-renode/status   qué falta y en qué estado está
 *   POST /api/shm-renode/start    arranca Renode
 *   POST /api/shm-renode/stop
 *   POST /api/shm-renode/fault    { fault, on }
 *   GET  /api/shm-renode/lines?since=N   líneas del puerto de servicio
 */

import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createConnection, type Socket } from 'node:net';
import { join } from 'node:path';
import type { Connect } from 'vite';

const SERVICE_PORT = 3456;
const GNSS_PORT = 3457;
const MONITOR_PORT = 12345;
const MAX_LINES = 500;

export type RenodeFault = 'sensor' | 'pps' | 'tiempo' | 'impacto';

/**
 * renode: el ELF para ARM en el STM32H743 emulado.
 * host:   el mismo app.c compilado para este ordenador con la placa
 *         simulada (board_host.c). Ejecuta el firmware, NO emula el chip.
 */
export type RunMode = 'renode' | 'host';

export interface RenodeStatus {
  renodeBin: string | null;
  elf: string | null;
  missing: string[];
  /** Se puede ejecutar el firmware en el ordenador (hay compilador de C). */
  hostAvailable: boolean;
  mode: RunMode | null;
  running: boolean;
  virtualSeconds: number;
  lines: number;
  faults: RenodeFault[];
  error: string | null;
}

export function renodeCandidates(root: string, env = process.env): string[] {
  return [
    env.RENODE_BIN ?? '',
    join(root, '.tools/renode/Renode.app/Contents/MacOS/macos_run.command'),
    join(root, '.tools/renode/renode'),
    '/Applications/Renode.app/Contents/MacOS/macos_run.command',
  ].filter(Boolean);
}

/** Trama RMC con su suma de control (NMEA 0183). `valid` = estado A. */
export function rmcSentence(utc: Date, valid: boolean): string {
  const p = (n: number) => String(n).padStart(2, '0');
  const time = `${p(utc.getUTCHours())}${p(utc.getUTCMinutes())}${p(utc.getUTCSeconds())}.00`;
  const date = `${p(utc.getUTCDate())}${p(utc.getUTCMonth() + 1)}${p(utc.getUTCFullYear() % 100)}`;
  // Posición aproximada de Bucaramanga; el firmware no la usa.
  const body = `GNRMC,${time},${valid ? 'A' : 'V'},0707.000,N,07307.000,W,0.0,0.0,${date},,,A`;
  let sum = 0;
  for (const ch of body) sum ^= ch.charCodeAt(0);
  return `$${body}*${sum.toString(16).toUpperCase().padStart(2, '0')}\r\n`;
}

class RenodeSession {
  private proc: ChildProcess | null = null;
  private monitor: Socket | null = null;
  private service: Socket | null = null;
  private gnss: Socket | null = null;
  private monitorBuf = '';
  private serviceBuf = '';
  private lines: { n: number; text: string }[] = [];
  private lineCount = 0;
  private faults = new Set<RenodeFault>();
  private virtualSeconds = 0;
  private stopping = false;
  private mode: RunMode | null = null;
  error: string | null = null;
  private readonly startUtc = Date.UTC(2026, 10, 12, 12, 0, 0);

  private readonly root: string;

  constructor(root: string) {
    this.root = root;
  }

  status(): RenodeStatus {
    const bin = renodeCandidates(this.root).find((c) => existsSync(c)) ?? null;
    const elfPath = join(this.root, 'firmware/shm-station/build/shm-station.elf');
    const elf = existsSync(elfPath) ? elfPath : null;
    const missing: string[] = [];
    if (!bin) missing.push('Renode (no está en .tools/renode ni en /Applications)');
    if (!elf) missing.push('firmware compilado (make en firmware/shm-station; falta arm-none-eabi-gcc)');
    return {
      renodeBin: bin, elf, missing, hostAvailable: hasCommand('cc'), mode: this.mode, running: this.proc !== null,
      virtualSeconds: this.virtualSeconds, lines: this.lineCount, faults: [...this.faults], error: this.error,
    };
  }

  since(n: number): { n: number; text: string }[] {
    return this.lines.filter((l) => l.n > n);
  }

  async start(mode: RunMode = 'renode'): Promise<void> {
    if (this.proc) return;
    this.error = null;
    this.stopping = false;
    this.virtualSeconds = 0;
    this.faults.clear();
    this.lines = [];
    const cwd = join(this.root, 'firmware/shm-station');
    if (mode === 'host') return this.startHost(cwd);
    const st = this.status();
    if (st.missing.length) throw new Error(`Falta: ${st.missing.join('; ')}`);
    this.mode = 'renode';
    // Sin --console y con la entrada abierta: con stdin cerrado, Renode
    // interpreta fin de entrada y se cierra solo.
    this.proc = spawn(st.renodeBin!, ['--disable-xwt', '--plain', '--port', String(MONITOR_PORT), '-e', 'include @renode/shm-station.resc; pause'], {
      cwd, stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.proc.stdout?.resume();
    this.proc.stderr?.resume();
    this.proc.on('exit', (code) => {
      if (!this.stopping) this.error = `Renode terminó (código ${code ?? '?'}).`;
      this.cleanup();
    });
    this.monitor = await connectRetry(MONITOR_PORT);
    this.monitor.on('data', (d) => { this.monitorBuf += d.toString('utf8'); });
    await this.waitPrompt(60000);
    this.service = await connectRetry(SERVICE_PORT);
    this.service.on('data', (d) => this.onService(d.toString('utf8')));
    this.gnss = await connectRetry(GNSS_PORT);
    void this.loop();
  }

  /** El firmware en el ordenador: compila con `make sim` y lo ejecuta en tiempo real. */
  private async startHost(cwd: string): Promise<void> {
    if (!hasCommand('cc')) throw new Error('No hay compilador de C en este equipo.');
    await run('make', ['sim'], cwd);
    this.mode = 'host';
    const proc = spawn(join(cwd, 'build/shm-sim'), ['renode/feeds/sd-v2-m.csv', '--seconds', '86400', '--realtime'], {
      cwd, stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.proc = proc;
    proc.stdout?.on('data', (d: Buffer) => this.onService(d.toString('utf8')));
    proc.stderr?.on('data', (d: Buffer) => { this.error = d.toString('utf8').trim(); });
    proc.on('exit', (code) => {
      if (!this.stopping) this.error = `El firmware terminó (código ${code ?? '?'}).`;
      this.cleanup();
    });
  }

  stop(): void {
    this.stopping = true;
    this.proc?.kill();
    this.cleanup();
  }

  async setFault(fault: RenodeFault, on: boolean): Promise<void> {
    if (on && fault !== 'impacto') this.faults.add(fault);
    else this.faults.delete(fault);
    if (this.mode === 'host') {
      this.proc?.stdin?.write(fault === 'impacto' ? 'impacto\n' : `${fault} ${on ? 1 : 0}\n`);
      return;
    }
    if (fault === 'impacto') this.faults.add('impacto');
    if (!this.monitor) return;
    if (fault === 'sensor') await this.command(`sysbus.spi1.adxl355 Disconnected ${on}`);
  }

  private onService(text: string): void {
    this.serviceBuf += text;
    let i: number;
    while ((i = this.serviceBuf.indexOf('\n')) >= 0) {
      const line = this.serviceBuf.slice(0, i).replace(/\r$/, '');
      this.serviceBuf = this.serviceBuf.slice(i + 1);
      if (!line) continue;
      const tick = /^@t (\d+)$/.exec(line);
      if (tick) {
        this.virtualSeconds = Number(tick[1]);
        continue;
      }
      this.lineCount++;
      this.lines.push({ n: this.lineCount, text: line });
      if (this.lines.length > MAX_LINES) this.lines.shift();
    }
  }

  /** Un segundo virtual por vuelta: RMC + PPS, y luego RunFor 1 s. */
  private async loop(): Promise<void> {
    while (this.proc && !this.stopping) {
      const utc = new Date(this.startUtc + this.virtualSeconds * 1000);
      this.gnss?.write(rmcSentence(utc, !this.faults.has('tiempo')));
      if (!this.faults.has('pps') && !this.faults.has('tiempo')) {
        await this.command('sysbus.gpioPortA OnGPIO 0 true');
        await this.command('sysbus.gpioPortA OnGPIO 0 false');
      }
      if (this.faults.has('impacto')) {
        await this.command('sysbus.spi1.adxl355 SetAcceleration 0 0 3');
        await this.command('emulation RunFor "0.05"');
        await this.command('sysbus.spi1.adxl355 LoadFeed @renode/feeds/sd-v2-m.csv');
        this.faults.delete('impacto');
        await this.command('emulation RunFor "0.95"');
      } else {
        await this.command('emulation RunFor "1"');
      }
      this.virtualSeconds++;
    }
  }

  private command(cmd: string): Promise<void> {
    if (!this.monitor) return Promise.resolve();
    this.monitorBuf = '';
    this.monitor.write(`${cmd}\n`);
    return this.waitPrompt(120000);
  }

  private waitPrompt(timeoutMs: number): Promise<void> {
    const t0 = Date.now();
    return new Promise((resolve, reject) => {
      const check = () => {
        if (/\([^)]*\) $/.test(this.monitorBuf)) return resolve();
        if (Date.now() - t0 > timeoutMs) return reject(new Error('Renode no respondió en el monitor.'));
        setTimeout(check, 20);
      };
      check();
    });
  }

  private cleanup(): void {
    for (const s of [this.monitor, this.service, this.gnss]) s?.destroy();
    this.monitor = this.service = this.gnss = null;
    this.proc = null;
    this.mode = null;
  }
}

function hasCommand(cmd: string): boolean {
  try {
    execFileSync(cmd, ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function run(cmd: string, args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { cwd, stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr?.on('data', (d: Buffer) => { err += d.toString('utf8'); });
    p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} ${args.join(' ')} falló: ${err.trim()}`))));
  });
}

function connectRetry(port: number, tries = 150): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const attempt = (left: number) => {
      const s = createConnection({ port, host: '127.0.0.1' });
      s.once('connect', () => resolve(s));
      s.once('error', () => {
        s.destroy();
        if (left <= 0) reject(new Error(`No se pudo conectar con Renode en el puerto ${port}.`));
        else setTimeout(() => attempt(left - 1), 200);
      });
    };
    attempt(tries);
  });
}

async function readJson(req: Connect.IncomingMessage): Promise<unknown> {
  let body = '';
  for await (const chunk of req) body += chunk;
  return body ? JSON.parse(body) : {};
}

export function createRenodeBridgeMiddleware(root: string): Connect.NextHandleFunction {
  const session = new RenodeSession(root);
  return async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://local');
    const send = (code: number, body: unknown) => {
      res.statusCode = code;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify(body));
    };
    try {
      if (req.method === 'GET' && url.pathname === '/status') return send(200, session.status());
      if (req.method === 'GET' && url.pathname === '/lines') {
        return send(200, { lines: session.since(Number(url.searchParams.get('since') ?? 0)), status: session.status() });
      }
      if (req.method === 'POST' && url.pathname === '/start') {
        const body = (await readJson(req)) as { mode?: string };
        await session.start(body.mode === 'host' ? 'host' : 'renode');
        return send(200, session.status());
      }
      if (req.method === 'POST' && url.pathname === '/stop') {
        session.stop();
        return send(200, session.status());
      }
      if (req.method === 'POST' && url.pathname === '/fault') {
        const body = (await readJson(req)) as { fault?: string; on?: boolean };
        const allowed: RenodeFault[] = ['sensor', 'pps', 'tiempo', 'impacto'];
        if (!allowed.includes(body.fault as RenodeFault)) return send(400, { error: 'Falla no soportada en Renode.' });
        await session.setFault(body.fault as RenodeFault, Boolean(body.on));
        return send(200, session.status());
      }
      return send(404, { error: 'Ruta desconocida.' });
    } catch (e) {
      session.error = e instanceof Error ? e.message : String(e);
      return send(500, { error: session.error, status: session.status() });
    }
  };
}
