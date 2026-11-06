/**
 * Infraestructura común de los generadores paramétricos locales.
 *
 * Misma postura de seguridad que el compilador Arduino, por las mismas razones:
 * son endpoints de DESARROLLO que ejecutan un proceso en el host.
 *
 *   - solo aceptan solicitudes locales del mismo origen,
 *   - invocan el intérprete con `spawn` sin shell y con argumentos fijos,
 *   - validan y acotan la especificación antes de pasarla,
 *   - limitan cuerpo de petición, tiempo de ejecución y tamaño de salida,
 *   - serializan las generaciones: UNA a la vez en todo el servidor, no una por
 *     dominio. Cada generación es un proceso de Python que consume CPU y varios
 *     cientos de MB; dos a la vez dejarían la máquina inservible.
 *
 * NO es un servicio de producción: no tiene sandbox del sistema operativo ni
 * cuota de memoria del proceso. No debe publicarse en una red.
 */

import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Connect } from 'vite';

const maxRequestBytes = 64 * 1024;
const maxGenerationTimeMs = 180_000;
const maxOutputBytes = 80 * 1024 * 1024; // el GLB en base64 domina el tamaño
const maxStderrBytes = 64 * 1024;

export class GenerateRequestError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(message: string, statusCode: number, code: string) {
    super(message);
    this.name = 'GenerateRequestError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

export function requireFiniteInRange(
  value: unknown,
  label: string,
  min: number,
  max: number,
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new GenerateRequestError(`${label} debe ser un número.`, 400, 'INVALID_NUMBER');
  }
  if (value < min || value > max) {
    throw new GenerateRequestError(
      `${label} debe estar entre ${min} y ${max}.`,
      422,
      'OUT_OF_RANGE',
    );
  }
  return value;
}

export function requireInteger(value: unknown, label: string, min: number, max: number): number {
  const n = requireFiniteInRange(value, label, min, max);
  if (!Number.isInteger(n)) {
    throw new GenerateRequestError(`${label} debe ser entero.`, 400, 'INVALID_NUMBER');
  }
  return n;
}

/**
 * Texto corto y sin caracteres de control.
 *
 * El valor acaba dentro de un JSON que se escribe por stdin al proceso de
 * Python; los caracteres de control podrían romper el encuadre de esa entrada.
 */
export function requireShortText(value: unknown, label: string, maxLength = 120): string {
  if (typeof value !== 'string' || value.length > maxLength) {
    throw new GenerateRequestError(
      `El campo ${label} debe ser texto de hasta ${maxLength} caracteres.`,
      400,
      'INVALID_TEXT',
    );
  }
  // oxlint-disable-next-line no-control-regex -- el objetivo es justamente esos caracteres
  return value.replace(/[\u0000-\u001f\u007f]/g, '').trim();
}

export function requireBoolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') {
    throw new GenerateRequestError(`${label} debe ser verdadero o falso.`, 400, 'INVALID_BOOLEAN');
  }
  return value;
}

export function requireDisciplines(value: unknown, allowed: ReadonlySet<string>): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new GenerateRequestError('Indica al menos una disciplina.', 400, 'INVALID_DISCIPLINES');
  }
  const list = value.map((d) => {
    if (typeof d !== 'string' || !allowed.has(d)) {
      throw new GenerateRequestError(`Disciplina no reconocida: ${String(d)}`, 400, 'INVALID_DISCIPLINE');
    }
    return d;
  });
  return Array.from(new Set(list));
}

export function sendJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(JSON.stringify(body));
}

export function isLocalRequest(request: IncomingMessage): boolean {
  const address = request.socket.remoteAddress?.replace(/^::ffff:/, '');
  if (address !== '127.0.0.1' && address !== '::1') return false;

  const origin = request.headers.origin;
  const host = request.headers.host;
  if (!origin || !host) return false;

  try {
    const originUrl = new URL(origin);
    return originUrl.protocol === 'http:' && originUrl.host === host;
  } catch {
    return false;
  }
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.byteLength;
    if (total > maxRequestBytes) {
      throw new GenerateRequestError('La solicitud supera el límite de 64 KiB.', 413, 'REQUEST_TOO_LARGE');
    }
    chunks.push(buffer);
  }
  if (total === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new GenerateRequestError('El cuerpo de la solicitud no es JSON válido.', 400, 'INVALID_JSON');
  }
}

/** Intérpretes de Python admitidos, en orden de preferencia. */
export function pythonCandidates(rootDirectory: string): string[] {
  const fromEnv = process.env.EMBEDVERSE_PYTHON;
  const list = [
    ...(fromEnv ? [fromEnv] : []),
    path.join(rootDirectory, '.venv', 'bin', 'python'),
    path.join(rootDirectory, 'tools', 'venv', 'bin', 'python'),
    '/usr/bin/python3',
    'python3',
  ];
  return Array.from(new Set(list));
}

async function resolvePython(rootDirectory: string): Promise<string> {
  for (const candidate of pythonCandidates(rootDirectory)) {
    if (!path.isAbsolute(candidate)) return candidate; // se resuelve por PATH
    try {
      await access(candidate);
      return candidate;
    } catch {
      /* siguiente candidato */
    }
  }
  throw new GenerateRequestError(
    'No se encontró un intérprete de Python. Define EMBEDVERSE_PYTHON con la ruta del entorno que tiene trimesh e ifcopenshell.',
    503,
    'PYTHON_NOT_FOUND',
  );
}

export interface GenerateOutcome {
  statusCode: number;
  body: unknown;
}

/** Ejecuta un script del generador pasándole la especificación por stdin. */
export async function runGeneratorScript(
  spec: Record<string, unknown>,
  rootDirectory: string,
  scriptName: string,
): Promise<GenerateOutcome> {
  const python = await resolvePython(rootDirectory);
  const scriptDirectory = path.join(rootDirectory, 'tools', 'building_generator');
  const script = path.join(scriptDirectory, scriptName);
  try {
    await access(script);
  } catch {
    throw new GenerateRequestError(
      `No se encontró el generador en tools/building_generator/${scriptName}.`,
      503,
      'GENERATOR_NOT_FOUND',
    );
  }

  return await new Promise<GenerateOutcome>((resolve, reject) => {
    const child = spawn(python, [script], {
      cwd: scriptDirectory,
      shell: false,
      windowsHide: true,
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
    });

    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGKILL');
      reject(
        new GenerateRequestError(
          `La generación superó el límite de ${maxGenerationTimeMs / 1000} s y se detuvo.`,
          504,
          'GENERATION_TIMEOUT',
        ),
      );
    }, maxGenerationTimeMs);

    child.stdout.on('data', (chunk: Buffer) => {
      stdoutBytes += chunk.byteLength;
      if (stdoutBytes > maxOutputBytes) {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          child.kill('SIGKILL');
          reject(
            new GenerateRequestError(
              'El modelo generado supera el límite de tamaño de la respuesta.',
              413,
              'RESULT_TOO_LARGE',
            ),
          );
        }
        return;
      }
      stdout.push(chunk);
    });

    child.stderr.on('data', (chunk: Buffer) => {
      if (stderrBytes >= maxStderrBytes) return;
      stderrBytes += chunk.byteLength;
      stderr.push(chunk);
    });

    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(
        new GenerateRequestError(
          `No se pudo ejecutar el generador: ${error.message}`,
          503,
          'SPAWN_FAILED',
        ),
      );
    });

    child.on('close', () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);

      const text = Buffer.concat(stdout).toString('utf8');
      const errorText = Buffer.concat(stderr).toString('utf8').slice(-2000);
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(text) as Record<string, unknown>;
      } catch {
        reject(
          new GenerateRequestError(
            `El generador no devolvió un resultado legible. ${errorText.slice(-400)}`.trim(),
            500,
            'INVALID_GENERATOR_OUTPUT',
          ),
        );
        return;
      }

      if (parsed.ok === true) {
        resolve({ statusCode: 200, body: parsed });
        return;
      }
      // Una solicitud imposible es 422: el sistema funcionó y la rechazó.
      const rejected = parsed.spec_rejected === true;
      resolve({ statusCode: rejected ? 422 : 500, body: parsed });
    });

    child.stdin.on('error', () => {
      /* el proceso puede cerrarse antes de leer; el cierre se maneja arriba */
    });
    child.stdin.end(JSON.stringify(spec));
  });
}

/**
 * Candado compartido por todos los generadores del servidor.
 *
 * Es deliberadamente global al módulo: edificios y puentes compiten por la
 * misma CPU, así que una generación en curso bloquea también a la otra.
 */
let generationInProgress = false;

export interface GeneratorEndpoint {
  /** Nombre del script dentro de tools/building_generator. */
  script: string;
  /** Valida y normaliza la especificación. Debe rechazar lo que no reconoce. */
  validate: (value: unknown) => Record<string, unknown>;
}

export function createGeneratorMiddleware(
  rootDirectory: string,
  endpoint: GeneratorEndpoint,
): Connect.NextHandleFunction {
  return (request, response, next) => {
    if (request.method !== 'POST') {
      next();
      return;
    }

    if (!isLocalRequest(request)) {
      sendJson(response, 403, {
        ok: false,
        error: 'La generación solo acepta solicitudes locales del mismo origen.',
        code: 'LOCAL_ORIGIN_REQUIRED',
        spec_rejected: false,
      });
      return;
    }

    if (generationInProgress) {
      sendJson(response, 429, {
        ok: false,
        error: 'Ya hay una generación en curso. Espera a que termine.',
        code: 'GENERATION_IN_PROGRESS',
        spec_rejected: false,
      });
      return;
    }

    generationInProgress = true;
    void (async () => {
      try {
        const contentType = request.headers['content-type'] ?? '';
        if (!contentType.toLowerCase().startsWith('application/json')) {
          throw new GenerateRequestError(
            'El tipo de contenido debe ser application/json.',
            415,
            'INVALID_CONTENT_TYPE',
          );
        }
        const body = await readJsonBody(request);
        const spec = endpoint.validate(body);
        const outcome = await runGeneratorScript(spec, rootDirectory, endpoint.script);
        sendJson(response, outcome.statusCode, outcome.body);
      } catch (error) {
        if (error instanceof GenerateRequestError) {
          sendJson(response, error.statusCode, {
            ok: false,
            error: error.message,
            code: error.code,
            spec_rejected: error.statusCode === 422,
          });
          return;
        }
        const message = error instanceof Error ? error.message : 'Error interno del generador.';
        sendJson(response, 500, {
          ok: false,
          error: message,
          code: 'INTERNAL_ERROR',
          spec_rejected: false,
        });
      } finally {
        generationInProgress = false;
      }
    })();
  };
}
