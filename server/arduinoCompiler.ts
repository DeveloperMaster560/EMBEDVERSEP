import { spawn } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Connect } from 'vite';

const maxRequestBytes = 2 * 1024 * 1024;
const maxProjectBytes = 1024 * 1024;
const maxFiles = 40;
const maxCompileTimeMs = 120_000;
const maxOutputBytes = 512 * 1024;
const allowedExtensions = new Set(['.ino', '.cpp', '.c', '.h', '.hpp', '.s']);

export interface CompileRequest {
  boardId: string;
  files: { path: string; content: string }[];
}

export interface CompileResponse {
  success: boolean;
  board: string;
  output: string;
  artifacts?: { name: string; bytes: number; downloadBase64?: string }[];
  error?: string;
  code?: string;
}

export class CompileRequestError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(
    message: string,
    statusCode: number,
    code: string,
  ) {
    super(message);
    this.name = 'CompileRequestError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

export function validateCompileRequest(value: unknown): CompileRequest {
  if (!value || typeof value !== 'object') {
    throw new CompileRequestError('El cuerpo de la solicitud no es válido.', 400, 'INVALID_REQUEST');
  }

  const request = value as Partial<CompileRequest>;
  if (request.boardId !== 'arduino-uno') {
    throw new CompileRequestError(
      'Este compilador solo está configurado para Arduino Uno. El core ESP32 no está instalado.',
      422,
      'UNSUPPORTED_BOARD',
    );
  }

  if (!Array.isArray(request.files) || request.files.length === 0 || request.files.length > maxFiles) {
    throw new CompileRequestError('El proyecto debe contener entre 1 y 40 archivos.', 400, 'INVALID_FILES');
  }

  let totalBytes = 0;
  const normalizedPaths = new Set<string>();
  const files = request.files.map((file) => {
    if (!file || typeof file.path !== 'string' || typeof file.content !== 'string') {
      throw new CompileRequestError('Cada archivo debe incluir ruta y contenido de texto.', 400, 'INVALID_FILE');
    }

    const relativePath = file.path.replaceAll('\\', '/');
    const segments = relativePath.split('/');
    const extension = path.posix.extname(relativePath).toLowerCase();
    if (
      relativePath.length > 180 ||
      relativePath.startsWith('/') ||
      segments.some((segment) => !segment || segment === '.' || segment === '..' || segment.includes(':')) ||
      !allowedExtensions.has(extension)
    ) {
      throw new CompileRequestError(`Ruta o tipo de archivo no permitido: ${file.path}`, 400, 'INVALID_PATH');
    }

    const collisionKey = relativePath.toLowerCase();
    if (normalizedPaths.has(collisionKey)) {
      throw new CompileRequestError(`El archivo está duplicado: ${file.path}`, 400, 'DUPLICATE_PATH');
    }
    normalizedPaths.add(collisionKey);
    totalBytes += Buffer.byteLength(file.content, 'utf8');
    if (totalBytes > maxProjectBytes) {
      throw new CompileRequestError('El código del proyecto supera el límite de 1 MiB.', 413, 'PROJECT_TOO_LARGE');
    }

    return { path: relativePath, content: file.content };
  });

  const sketches = files.filter((file) => path.posix.extname(file.path).toLowerCase() === '.ino');
  if (sketches.some((file) => file.path.includes('/')) || sketches.length > 1) {
    throw new CompileRequestError('Arduino requiere un único archivo .ino en la raíz del proyecto.', 400, 'INVALID_SKETCH');
  }

  if (sketches.length === 0 && !files.some((file) => path.posix.basename(file.path).toLowerCase() === 'main.cpp')) {
    throw new CompileRequestError(
      'El proyecto necesita un archivo .ino o un main.cpp para compilar en Arduino.',
      400,
      'MISSING_SKETCH',
    );
  }

  return { boardId: 'arduino-uno', files };
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > maxRequestBytes) {
      throw new CompileRequestError('La solicitud supera el límite de 2 MiB.', 413, 'REQUEST_TOO_LARGE');
    }
    chunks.push(buffer);
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch {
    throw new CompileRequestError('El cuerpo JSON no se pudo interpretar.', 400, 'INVALID_JSON');
  }
}

function sendJson(response: ServerResponse, statusCode: number, body: CompileResponse): void {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(JSON.stringify(body));
}

function isLocalRequest(request: IncomingMessage): boolean {
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

async function compileProject(project: CompileRequest, rootDirectory: string): Promise<CompileResponse> {
  const executable = path.join(rootDirectory, '.tools', 'arduino-cli', 'arduino-cli.exe');
  const configFile = path.join(rootDirectory, '.tools', 'arduino-cli-config', 'arduino-cli.yaml');
  try {
    await Promise.all([access(executable), access(configFile)]);
  } catch {
    throw new CompileRequestError(
      'No encuentro Arduino CLI o su configuración local. Reinstala el toolchain AVR desde la guía del proyecto.',
      503,
      'TOOLCHAIN_NOT_INSTALLED',
    );
  }

  const workspace = await mkdtemp(path.join(os.tmpdir(), 'embedverse-compile-'));
  const sketchDirectory = path.join(workspace, 'EmbedverseSketch');
  const outputDirectory = path.join(workspace, 'output');
  await Promise.all([mkdir(sketchDirectory), mkdir(outputDirectory)]);

  try {
    const sketchFile = project.files.find((file) => file.path.toLowerCase().endsWith('.ino'));
    for (const file of project.files) {
      const sourcePath =
        !sketchFile && path.posix.basename(file.path).toLowerCase() === 'main.cpp'
          ? 'EmbedverseSketch.ino'
          : file.path;
      const destination = path.resolve(sketchDirectory, ...sourcePath.split('/'));
      if (!destination.startsWith(`${sketchDirectory}${path.sep}`)) {
        throw new CompileRequestError('La ruta del archivo sale del directorio del proyecto.', 400, 'INVALID_PATH');
      }
      await mkdir(path.dirname(destination), { recursive: true });
      await writeFile(destination, file.content, { encoding: 'utf8', flag: 'wx' });
    }

    const args = [
      'compile',
      '--config-file',
      configFile,
      '--fqbn',
      'arduino:avr:uno',
      '--output-dir',
      outputDirectory,
      sketchDirectory,
    ];

    return await new Promise<CompileResponse>((resolve, reject) => {
      const child = spawn(executable, args, {
        cwd: workspace,
        shell: false,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          PATH: process.env.PATH ?? '',
          SYSTEMROOT: process.env.SYSTEMROOT ?? '',
          TEMP: process.env.TEMP ?? os.tmpdir(),
          TMP: process.env.TMP ?? os.tmpdir(),
        },
      });

      let output = '';
      let outputBytes = 0;
      let timedOut = false;
      let overflow = false;
      let settled = false;
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill();
      }, maxCompileTimeMs);

      const collect = (chunk: Buffer) => {
        outputBytes += chunk.length;
        if (outputBytes > maxOutputBytes) {
          overflow = true;
          child.kill();
          return;
        }
        output += chunk.toString('utf8');
      };

      child.stdout.on('data', collect);
      child.stderr.on('data', collect);
      child.once('error', (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(new CompileRequestError(`No se pudo iniciar Arduino CLI: ${error.message}`, 500, 'COMPILER_START_FAILED'));
      });
      child.once('close', (exitCode) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (timedOut) {
          reject(new CompileRequestError('La compilación excedió el límite de 120 segundos.', 408, 'COMPILE_TIMEOUT'));
          return;
        }
        if (overflow) {
          reject(new CompileRequestError('La salida del compilador superó el límite permitido.', 413, 'OUTPUT_TOO_LARGE'));
          return;
        }
        if (exitCode !== 0) {
          resolve({ success: false, board: 'Arduino Uno R3', output, code: 'COMPILE_FAILED' });
          return;
        }

        void readdir(outputDirectory)
          .then(async (names) => {
            const hexName = names.find((name) => name.endsWith('.ino.hex') && !name.includes('bootloader'));
            return {
              success: true,
              board: 'Arduino Uno R3',
              output,
              artifacts: await Promise.all(
                names.map(async (name) => ({
                  name,
                  bytes: (await stat(path.join(outputDirectory, name))).size,
                  ...(name === hexName
                    ? { downloadBase64: (await readFile(path.join(outputDirectory, name))).toString('base64') }
                    : {}),
                })),
              ),
            };
          })
          .then(resolve, reject);
      });
    });
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}

export function createArduinoCompileMiddleware(rootDirectory: string): Connect.NextHandleFunction {
  let compilationInProgress = false;

  return (request, response, next) => {
    if (request.method !== 'POST') {
      next();
      return;
    }

    if (!isLocalRequest(request)) {
      sendJson(response, 403, {
        success: false,
        board: 'Arduino Uno R3',
        output: '',
        error: 'La compilación solo acepta solicitudes locales del mismo origen.',
        code: 'LOCAL_ORIGIN_REQUIRED',
      });
      return;
    }

    if (compilationInProgress) {
      sendJson(response, 429, {
        success: false,
        board: 'Arduino Uno R3',
        output: '',
        error: 'Ya hay una compilación en curso.',
        code: 'COMPILATION_IN_PROGRESS',
      });
      return;
    }

    compilationInProgress = true;
    void (async () => {
      try {
        const contentType = request.headers['content-type'] ?? '';
        if (!contentType.toLowerCase().startsWith('application/json')) {
          throw new CompileRequestError('El tipo de contenido debe ser application/json.', 415, 'INVALID_CONTENT_TYPE');
        }

        const body = await readJsonBody(request);
        const project = validateCompileRequest(body);
        const result = await compileProject(project, rootDirectory);
        sendJson(response, result.success ? 200 : 422, result);
      } catch (error) {
        if (error instanceof CompileRequestError) {
          sendJson(response, error.statusCode, {
            success: false,
            board: 'Arduino Uno R3',
            output: '',
            error: error.message,
            code: error.code,
          });
          return;
        }
        const message = error instanceof Error ? error.message : 'Error interno del compilador.';
        sendJson(response, 500, {
          success: false,
          board: 'Arduino Uno R3',
          output: '',
          error: message,
          code: 'INTERNAL_ERROR',
        });
      } finally {
        compilationInProgress = false;
      }
    })();
  };
}
