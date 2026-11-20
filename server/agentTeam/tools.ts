import { createHash } from 'node:crypto';
import { lstat, readFile, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import type { AgentId } from '../../src/agent-team/contracts.js';
import { assertNoCredentialMaterial } from '../../src/agent-team/security.js';
import type { ChatToolSchema } from './providers/ollama.js';

const MAX_FILE_BYTES = 128 * 1024;
const MAX_FILE_CHARS = 2_000;
const MAX_SEARCH_FILES = 500;
const MAX_SEARCH_BYTES = 12 * 1024 * 1024;
const MAX_SEARCH_MATCHES = 30;
const SKIP_DIRECTORY_NAMES = new Set([
  '.git', '.aws', '.codex', '.agents', '.embedverse', '.tools', '.venv', 'node_modules', 'dist',
  'coverage', 'secretos', 'secrets', 'datos', '__pycache__',
]);
const SKIP_FILE_NAMES = /^(?:\.env(?:\..*)?|.*(?:secret|credential|password|token).*)$|\.(?:pem|p12|pfx|key)$/i;
const TEXT_EXTENSIONS = new Set([
  '.c', '.cc', '.cpp', '.css', '.h', '.hpp', '.html', '.ino', '.js', '.json', '.md', '.mjs', '.ps1',
  '.py', '.sh', '.sql', '.svg', '.toml', '.ts', '.tsx', '.txt', '.xml', '.yaml', '.yml',
]);

export interface ToolEvidence {
  text: string;
  evidenceRefs: string[];
  summary: string;
}

interface RegisteredTool {
  schema: ChatToolSchema;
  allowedAgents: readonly AgentId[];
  execute(args: Record<string, unknown>): Promise<ToolEvidence>;
}

export class ToolExecutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ToolExecutionError';
  }
}

function requireString(args: Record<string, unknown>, name: string, maxLength: number): string {
  const value = args[name];
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength) {
    throw new ToolExecutionError(`${name} debe ser texto entre 1 y ${maxLength} caracteres.`);
  }
  return value.trim();
}

function validateKeys(args: Record<string, unknown>, allowed: readonly string[]): void {
  for (const key of Object.keys(args)) {
    if (!allowed.includes(key)) throw new ToolExecutionError(`Argumento no permitido: ${key}.`);
  }
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function blockedPath(relativePath: string): boolean {
  const segments = relativePath.split(/[\\/]+/).filter(Boolean);
  return segments.some((segment) => SKIP_DIRECTORY_NAMES.has(segment.toLowerCase()) || SKIP_FILE_NAMES.test(segment));
}

function withinRoot(root: string, absolute: string): boolean {
  const relative = path.relative(root, absolute);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

export class WorkspaceToolRegistry {
  private readonly rootPromise: Promise<string>;
  private readonly tools: ReadonlyMap<string, RegisteredTool>;

  constructor(workspaceRoot: string) {
    this.rootPromise = realpath(workspaceRoot);
    const agents: readonly AgentId[] = ['structural_engineer', 'software_engineer', 'mechatronics_engineer'];
    this.tools = new Map<string, RegisteredTool>([
      ['workspace.read_file', {
        schema: {
          type: 'function',
          function: {
            name: 'workspace_read_file',
            description: 'Lee un archivo de texto del repositorio actual. No accede a secretos, dependencias ni archivos fuera del repositorio.',
            parameters: {
              type: 'object', required: ['path'], additionalProperties: false,
              properties: { path: { type: 'string', description: 'Ruta relativa al repositorio, por ejemplo src/domain/circuit.ts.' } },
            },
          },
        },
        allowedAgents: agents,
        execute: (args) => this.readFileTool(args),
      }],
      ['workspace.search', {
        schema: {
          type: 'function',
          function: {
            name: 'workspace_search',
            description: 'Busca una frase literal en archivos de código y documentación del repositorio; no ejecuta comandos.',
            parameters: {
              type: 'object', required: ['query'], additionalProperties: false,
              properties: {
                query: { type: 'string', description: 'Texto literal que se quiere localizar.' },
                path: { type: 'string', description: 'Subcarpeta relativa opcional para limitar la búsqueda.' },
              },
            },
          },
        },
        allowedAgents: agents,
        execute: (args) => this.searchTool(args),
      }],
    ]);
  }

  listForAgent(agentId: AgentId): ChatToolSchema[] {
    return [...this.tools.values()]
      .filter((tool) => tool.allowedAgents.includes(agentId))
      .map((tool) => structuredClone(tool.schema));
  }

  listToolIdsForAgent(agentId: AgentId): string[] {
    return [...this.tools.entries()]
      .filter(([, tool]) => tool.allowedAgents.includes(agentId))
      .map(([id]) => id);
  }

  canonicalId(functionName: string): string {
    return [...this.tools.entries()]
      .find(([id, tool]) => id === functionName || tool.schema.function.name === functionName)?.[0] ?? functionName;
  }

  async execute(agentId: AgentId, id: string, args: Record<string, unknown>): Promise<ToolEvidence> {
    const tool = this.tools.get(id) ?? [...this.tools.values()].find((candidate) => candidate.schema.function.name === id);
    if (!tool || !tool.allowedAgents.includes(agentId)) {
      throw new ToolExecutionError(`El agente ${agentId} no tiene permiso para usar ${id}.`);
    }
    assertNoCredentialMaterial(args);
    const result = await tool.execute(args);
    assertNoCredentialMaterial(result.text);
    return result;
  }

  private async resolvePath(relativePath: string): Promise<{ absolute: string; display: string }> {
    const root = await this.rootPromise;
    if (path.isAbsolute(relativePath) || /^[A-Za-z]:/.test(relativePath) || relativePath.startsWith('\\\\')) {
      throw new ToolExecutionError('La herramienta solo acepta rutas relativas al repositorio.');
    }
    if (relativePath.split(/[\\/]+/).includes('..')) {
      throw new ToolExecutionError('La ruta no puede subir por encima de su carpeta.');
    }
    const absolute = path.resolve(root, relativePath);
    if (!withinRoot(root, absolute)) throw new ToolExecutionError('La ruta está fuera del repositorio.');
    const display = path.relative(root, absolute).split(path.sep).join('/');
    if (blockedPath(display)) throw new ToolExecutionError('La ruta pertenece a datos locales o sensibles excluidos de las herramientas.');
    await this.assertNoSymlinkComponents(root, absolute);
    let resolved: string;
    try {
      resolved = await realpath(absolute);
    } catch {
      throw new ToolExecutionError(`No existe el archivo ${display}.`);
    }
    if (!withinRoot(root, resolved)) throw new ToolExecutionError('La ruta resuelve fuera del repositorio.');
    const info = await lstat(absolute);
    if (info.isSymbolicLink() || !info.isFile()) throw new ToolExecutionError('Solo se admiten archivos regulares del repositorio.');
    return { absolute, display };
  }

  private async readFileTool(args: Record<string, unknown>): Promise<ToolEvidence> {
    validateKeys(args, ['path']);
    const { absolute, display } = await this.resolvePath(requireString(args, 'path', 500));
    const info = await lstat(absolute);
    if (info.size > MAX_FILE_BYTES) throw new ToolExecutionError(`El archivo supera el límite de ${MAX_FILE_BYTES} bytes.`);
    const content = await readFile(absolute, 'utf8');
    if (content.includes('\0')) throw new ToolExecutionError('El archivo parece binario y no se devuelve al modelo.');
    assertNoCredentialMaterial(content);
    const shown = content.slice(0, MAX_FILE_CHARS);
    const truncated = shown.length < content.length;
    const hash = digest(content);
    const text = JSON.stringify({ path: display, sha256: hash, content: shown, truncated, totalCharacters: content.length });
    return {
      text,
      evidenceRefs: [`workspace://${display}#sha256=${hash}`],
      summary: `Lectura de ${display}; ${content.length} caracteres${truncated ? ' (respuesta recortada)' : ''}.`,
    };
  }

  private async searchTool(args: Record<string, unknown>): Promise<ToolEvidence> {
    validateKeys(args, ['query', 'path']);
    const query = requireString(args, 'query', 160);
    const startPath = typeof args.path === 'string' && args.path.trim() ? args.path.trim() : '.';
    const start = await this.resolveSearchDirectory(startPath);
    const root = await this.rootPromise;
    const matches: { path: string; line: number; text: string }[] = [];
    let filesScanned = 0;
    let bytesScanned = 0;
    let truncated = false;

    const walk = async (directory: string, depth: number): Promise<void> => {
      if (depth > 12 || matches.length >= MAX_SEARCH_MATCHES || filesScanned >= MAX_SEARCH_FILES
        || bytesScanned >= MAX_SEARCH_BYTES) {
        truncated = true;
        return;
      }
      const entries = await readdir(directory, { withFileTypes: true });
      for (const entry of entries) {
        if (matches.length >= MAX_SEARCH_MATCHES || filesScanned >= MAX_SEARCH_FILES || bytesScanned >= MAX_SEARCH_BYTES) {
          truncated = true;
          return;
        }
        const absolute = path.join(directory, entry.name);
        const display = path.relative(root, absolute).split(path.sep).join('/');
        if (blockedPath(display)) continue;
        if (entry.isSymbolicLink()) continue;
        if (entry.isDirectory()) {
          await walk(absolute, depth + 1);
          continue;
        }
        if (!entry.isFile() || !TEXT_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;
        const info = await lstat(absolute);
        if (info.size > MAX_FILE_BYTES || bytesScanned + info.size > MAX_SEARCH_BYTES) {
          truncated = true;
          continue;
        }
        filesScanned += 1;
        bytesScanned += info.size;
        const content = await readFile(absolute, 'utf8');
        if (content.includes('\0')) continue;
        const lines = content.split(/\r?\n/);
        for (let index = 0; index < lines.length; index += 1) {
          if (lines[index].toLocaleLowerCase().includes(query.toLocaleLowerCase())) {
            if (!/(?:api[_-]?key|password|secret|token)\s*[:=]/i.test(lines[index])) {
              matches.push({ path: display, line: index + 1, text: lines[index].slice(0, 500) });
            }
            if (matches.length >= MAX_SEARCH_MATCHES) {
              truncated = true;
              break;
            }
          }
        }
      }
    };

    if (start.kind === 'file') {
      const { absolute, display } = start;
      if (!TEXT_EXTENSIONS.has(path.extname(absolute).toLowerCase())) throw new ToolExecutionError('Tipo de archivo no permitido para búsqueda.');
      const info = await lstat(absolute);
      if (info.size > MAX_FILE_BYTES) throw new ToolExecutionError('El archivo supera el tamaño máximo de búsqueda.');
      filesScanned = 1;
      bytesScanned = info.size;
      const content = await readFile(absolute, 'utf8');
      const lines = content.split(/\r?\n/);
      for (let index = 0; index < lines.length && matches.length < MAX_SEARCH_MATCHES; index += 1) {
        if (lines[index].toLocaleLowerCase().includes(query.toLocaleLowerCase())
          && !/(?:api[_-]?key|password|secret|token)\s*[:=]/i.test(lines[index])) {
          matches.push({ path: display, line: index + 1, text: lines[index].slice(0, 500) });
        }
      }
    } else {
      await walk(start.absolute, 0);
    }
    const text = JSON.stringify({ query, matches, filesScanned, bytesScanned, truncated });
    assertNoCredentialMaterial(text);
    const evidenceRefs = matches.map(({ path: matchPath, line, text: lineText }) => (
      `workspace://${matchPath}#L${line}&sha256=${digest(lineText)}`
    ));
    return { text, evidenceRefs, summary: `Búsqueda literal: ${matches.length} coincidencias en ${filesScanned} archivos.` };
  }

  private async resolveSearchDirectory(relativePath: string): Promise<
    { kind: 'directory'; absolute: string } | { kind: 'file'; absolute: string; display: string }
  > {
    const root = await this.rootPromise;
    if (path.isAbsolute(relativePath) || /^[A-Za-z]:/.test(relativePath) || relativePath.split(/[\\/]+/).includes('..')) {
      throw new ToolExecutionError('La búsqueda acepta rutas relativas dentro del repositorio.');
    }
    const absolute = path.resolve(root, relativePath);
    if (!withinRoot(root, absolute)) throw new ToolExecutionError('La ruta de búsqueda está fuera del repositorio.');
    const display = path.relative(root, absolute).split(path.sep).join('/') || '.';
    if (blockedPath(display)) throw new ToolExecutionError('La búsqueda excluye carpetas sensibles o de datos locales.');
    await this.assertNoSymlinkComponents(root, absolute);
    const resolved = await realpath(absolute).catch(() => {
      throw new ToolExecutionError(`No existe la ruta ${display}.`);
    });
    if (!withinRoot(root, resolved)) throw new ToolExecutionError('La ruta de búsqueda resuelve fuera del repositorio.');
    const info = await lstat(absolute);
    if (info.isSymbolicLink()) throw new ToolExecutionError('No se permite buscar a través de enlaces simbólicos.');
    if (info.isDirectory()) return { kind: 'directory', absolute };
    if (info.isFile()) return { kind: 'file', absolute, display };
    throw new ToolExecutionError('La búsqueda requiere una carpeta o archivo regular.');
  }

  private async assertNoSymlinkComponents(root: string, absolute: string): Promise<void> {
    const relative = path.relative(root, absolute);
    let current = root;
    for (const segment of relative.split(path.sep).filter(Boolean)) {
      current = path.join(current, segment);
      let info;
      try {
        info = await lstat(current);
      } catch {
        throw new ToolExecutionError('No existe una parte de la ruta solicitada.');
      }
      if (info.isSymbolicLink()) throw new ToolExecutionError('No se permite acceder a través de enlaces simbólicos.');
    }
  }
}
