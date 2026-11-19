/**
 * POST /api/simular: ejecuta el proyecto en el simulador de placas del PC
 * (firmware/simulador-host, con las bibliotecas oficiales reales) contra un
 * escenario CSV, y devuelve lo que la placa imprimió, lo que publicó y si
 * cumple el contrato de la plataforma.
 *
 * SEGURIDAD: compilar no ejecuta el código del cliente; simular SÍ (es un
 * programa nativo en este equipo). Por eso solo funciona en modo local
 * (el usuario ejecuta su propio código en su propio PC) y con solicitudes
 * del mismo origen. En modo público (EMBEDVERSE_PUBLICO=1) se rechaza hasta
 * que haya un entorno aislado para ejecutar código ajeno.
 */
import { spawn } from 'node:child_process';
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Connect } from 'vite';
import { CompileRequestError, isLocalRequest, validarArchivos } from './arduinoCompiler.js';
import { esPublico } from './diagnostico.js';
import { buscarPlaca } from './placas.js';
import { pythonCandidates } from './generatorRuntime.js';

const maxEscenarioBytes = 200 * 1024;
const maxDuracionS = 3600;
/** La primera simulación con una biblioteca grande la compila entera (RadioLib: ~1 min). */
const maxTiempoMs = 300_000;
const maxSalidaBytes = 4 * 1024 * 1024;

export interface SimulacionPedida {
  boardId: string;
  files: { path: string; content: string }[];
  escenario: string;
  duracion_s: number;
  conexiones: string[];
}

export interface SimulacionResultado {
  ok: boolean;
  error?: string;
  code?: string;
  mensajes?: number;
  con_problemas?: number;
  primer_problema?: string[] | null;
  notas?: string[];
  tiempo_simulado_s?: number;
  serie?: string[];
  /** Segundo simulado en que la placa imprimió cada línea de `serie`. */
  serie_t?: number[];
  serie_total?: number;
  mensajes_detalle?: { t_s: number; topico: string; carga: string; problemas: string[] }[];
}

export function validarSimulacion(value: unknown): SimulacionPedida {
  if (!value || typeof value !== 'object') throw new CompileRequestError('Falta el cuerpo de la solicitud.', 400, 'INVALID_BODY');
  const v = value as Record<string, unknown>;
  const files = validarArchivos(value);
  if (typeof v.boardId !== 'string' || !buscarPlaca(v.boardId)) {
    throw new CompileRequestError('Placa desconocida para el simulador.', 422, 'UNSUPPORTED_BOARD');
  }
  if (typeof v.escenario !== 'string' || !v.escenario.trim()) {
    throw new CompileRequestError('Falta el escenario (CSV con la columna t_s).', 400, 'INVALID_SCENARIO');
  }
  if (Buffer.byteLength(v.escenario) > maxEscenarioBytes) {
    throw new CompileRequestError(`El escenario supera ${maxEscenarioBytes / 1024} KB.`, 413, 'SCENARIO_TOO_LARGE');
  }
  const primera = v.escenario.split(/\r?\n/).find((l) => l.trim() && !l.trimStart().startsWith('#'));
  if (!primera?.split(',')[0]?.trim().startsWith('t_s')) {
    throw new CompileRequestError('La primera fila del escenario (sin contar las líneas #) debe empezar por t_s.', 422, 'INVALID_SCENARIO');
  }
  const duracion = Number(v.duracion_s);
  if (!Number.isFinite(duracion) || duracion <= 0 || duracion > maxDuracionS) {
    throw new CompileRequestError(`La duración debe estar entre 1 y ${maxDuracionS} s simulados.`, 422, 'INVALID_DURATION');
  }
  const conexiones = Array.isArray(v.conexiones) ? v.conexiones : [];
  if (!conexiones.every((c) => typeof c === 'string' && /^[A-Za-z0-9_]+( [A-Za-z0-9_]+=[A-Za-z0-9_.*-]+)*$/.test(c))) {
    throw new CompileRequestError('Cada conexión es «MODELO clave=valor…» (p. ej. «MAX31865 cs=10»).', 422, 'INVALID_CONNECTION');
  }
  if (!files.some((f) => /\.(ino|cpp)$/i.test(f.path))) {
    throw new CompileRequestError('El proyecto no tiene un .ino ni un .cpp que simular.', 422, 'NO_SKETCH');
  }
  return { boardId: v.boardId, files, escenario: v.escenario, duracion_s: duracion, conexiones: conexiones as string[] };
}

async function python(raiz: string): Promise<string> {
  const venv = path.join(raiz, '.tools', 'venv-plataforma', process.platform === 'win32' ? 'Scripts' : 'bin',
    process.platform === 'win32' ? 'python.exe' : 'python3');
  for (const c of [venv, ...pythonCandidates(raiz)]) {
    if (!path.isAbsolute(c)) return c;
    try {
      await access(c);
      return c;
    } catch { /* siguiente */ }
  }
  throw new CompileRequestError('No se encontró Python para el simulador.', 503, 'PYTHON_NOT_FOUND');
}

/** Ejecuta simular_placa.py --json y devuelve su resumen. */
export async function simular(raiz: string, p: SimulacionPedida): Promise<SimulacionResultado> {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'embedverse-sim-'));
  try {
    // La carpeta del sketch se llama como el proyecto: el simulador une todos sus .ino.
    const sketch = path.join(tmp, 'proyecto');
    await mkdir(sketch);
    const hayIno = p.files.some((f) => /\.ino$/i.test(f.path));
    for (const f of p.files) {
      const nombre = path.posix.basename(f.path);
      const destino = !hayIno && nombre.toLowerCase() === 'main.cpp' ? 'proyecto.ino' : nombre;
      await writeFile(path.join(sketch, destino), f.content, { encoding: 'utf8', flag: 'wx' });
    }
    const escenario = path.join(tmp, 'escenario.csv');
    await writeFile(escenario, p.escenario, 'utf8');
    const args = ['-m', 'shm_plataforma.simular_placa', sketch, '--placa', p.boardId, '--escenario', escenario,
      '--duracion', String(p.duracion_s), '--json', ...p.conexiones.flatMap((c) => ['--conectar', c])];
    const exe = await python(raiz);
    return await new Promise<SimulacionResultado>((resolve, reject) => {
      const child = spawn(exe, args, {
        cwd: path.join(raiz, 'plataforma', 'servicios'),
        shell: false,
        windowsHide: true,
        env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1', PYTHONIOENCODING: 'utf-8' },
      });
      let out = '';
      let err = '';
      let bytes = 0;
      const timer = setTimeout(() => child.kill('SIGKILL'), maxTiempoMs);
      const tomar = (dest: 'out' | 'err') => (b: Buffer) => {
        bytes += b.length;
        if (bytes > maxSalidaBytes) { child.kill('SIGKILL'); return; }
        if (dest === 'out') out += b.toString('utf8'); else err += b.toString('utf8');
      };
      child.stdout.on('data', tomar('out'));
      child.stderr.on('data', tomar('err'));
      child.once('error', (e) => { clearTimeout(timer); reject(new CompileRequestError(`No se pudo iniciar el simulador: ${e.message}`, 500, 'SIMULATOR_START_FAILED')); });
      child.once('close', () => {
        clearTimeout(timer);
        const linea = out.trim().split('\n').pop() ?? '';
        try {
          const r = JSON.parse(linea) as SimulacionResultado & { error?: string };
          if (r.error) resolve({ ok: false, error: r.error, code: 'SIMULATION_FAILED' });
          else resolve({ ...r, ok: true });
        } catch {
          resolve({
            ok: false,
            code: bytes > maxSalidaBytes ? 'OUTPUT_TOO_LARGE' : 'SIMULATION_FAILED',
            error: bytes > maxSalidaBytes ? 'La simulación produjo demasiada salida.'
              : (err.trim() || out.trim() || `La simulación no terminó en ${maxTiempoMs / 1000} s.`).slice(-2000),
          });
        }
      });
    });
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

function enviar(res: ServerResponse, estado: number, cuerpo: SimulacionResultado): void {
  res.writeHead(estado, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(cuerpo));
}

async function leerJson(req: IncomingMessage): Promise<unknown> {
  let total = 0;
  const partes: Buffer[] = [];
  for await (const c of req) {
    total += (c as Buffer).length;
    if (total > 3 * 1024 * 1024) throw new CompileRequestError('La solicitud es demasiado grande.', 413, 'REQUEST_TOO_LARGE');
    partes.push(c as Buffer);
  }
  try {
    return JSON.parse(Buffer.concat(partes).toString('utf8'));
  } catch {
    throw new CompileRequestError('El cuerpo no es JSON válido.', 400, 'INVALID_JSON');
  }
}

export function createSimuladorMiddleware(raiz: string): Connect.NextHandleFunction {
  let ocupado = false;
  return (req, res, next) => {
    if (req.method !== 'POST') { next(); return; }
    if (esPublico()) {
      enviar(res, 403, {
        ok: false, code: 'SIMULACION_SOLO_LOCAL',
        error: 'La simulación todavía no está disponible en el servicio en línea: ejecutar tu programa en el servidor '
          + 'exige un entorno aislado que aún no está listo. Compilar y descargar el firmware sí funcionan.',
      });
      return;
    }
    if (!isLocalRequest(req)) {
      enviar(res, 403, { ok: false, code: 'LOCAL_ORIGIN_REQUIRED', error: 'El simulador solo acepta solicitudes locales del mismo origen.' });
      return;
    }
    if (ocupado) {
      enviar(res, 429, { ok: false, code: 'SIMULATION_IN_PROGRESS', error: 'Ya hay una simulación en curso.' });
      return;
    }
    ocupado = true;
    void (async () => {
      try {
        if (!(req.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) {
          throw new CompileRequestError('El tipo de contenido debe ser application/json.', 415, 'INVALID_CONTENT_TYPE');
        }
        const pedida = validarSimulacion(await leerJson(req));
        const r = await simular(raiz, pedida);
        enviar(res, r.ok ? 200 : 422, r);
      } catch (e) {
        if (e instanceof CompileRequestError) enviar(res, e.statusCode, { ok: false, error: e.message, code: e.code });
        else enviar(res, 500, { ok: false, error: e instanceof Error ? e.message : 'Error del simulador', code: 'SIMULATION_ERROR' });
      } finally {
        ocupado = false;
      }
    })();
  };
}
