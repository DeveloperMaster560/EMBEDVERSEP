import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AgentId, TaskState } from '../../src/agent-team/contracts.js';
import type { TaskPriority } from '../../src/agent-team/contracts.js';
import { AGENT_REGISTRY } from '../../src/agent-team/registry.js';
import { TASK_STATES } from '../../src/agent-team/contracts.js';
import { assertNoCredentialMaterial, CredentialMaterialError } from '../../src/agent-team/security.js';
import { AgentConflictError, AgentInputError, AgentNotFoundError, AgentRuntime } from './runtime.js';
import type { AgentOrchestrator } from './orchestrator.js';

const HOST = '127.0.0.1';
const MAX_BODY_BYTES = 64 * 1024;
const DEFAULT_UI_ORIGINS = [
  'http://127.0.0.1:5174',
  'http://localhost:5174',
  'http://127.0.0.1:4173',
  'http://localhost:4173',
];

export interface AgentApiOptions {
  allowedOrigins?: string[];
  orchestrator?: AgentOrchestrator;
}

function send(response: ServerResponse, status: number, body: unknown, origin?: string): void {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  };
  if (origin) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers.Vary = 'Origin';
  }
  response.writeHead(status, headers);
  response.end(JSON.stringify(body));
}

function hostIsLoopback(hostHeader: string | undefined): boolean {
  if (!hostHeader) return false;
  try {
    const url = new URL(`http://${hostHeader}`);
    return url.hostname === '127.0.0.1' || url.hostname === 'localhost';
  } catch {
    return false;
  }
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const part = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += part.byteLength;
    if (bytes > MAX_BODY_BYTES) throw Object.assign(new Error('La solicitud supera el límite de 64 KiB.'), { status: 413 });
    chunks.push(part);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch {
    throw Object.assign(new Error('El cuerpo debe contener JSON válido.'), { status: 400 });
  }
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw Object.assign(new Error('El cuerpo debe ser un objeto JSON.'), { status: 400 });
  }
  return value as Record<string, unknown>;
}

function taskState(value: unknown): value is TaskState {
  return typeof value === 'string' && TASK_STATES.includes(value as TaskState);
}

function taskPriority(value: unknown): value is TaskPriority {
  return value === 'LOW' || value === 'NORMAL' || value === 'HIGH' || value === 'URGENT';
}

function agentId(value: unknown): value is AgentId {
  return typeof value === 'string' && Object.hasOwn(AGENT_REGISTRY, value);
}

function projectContextFiles(value: unknown): { path: string; content: string }[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 10) throw Object.assign(new Error('contextFiles admite como máximo 10 archivos.'), { status: 400 });
  let totalChars = 0;
  const paths = new Set<string>();
  return value.map((item) => {
    const file = record(item);
    const path = typeof file.path === 'string' ? file.path.trim().replace(/\\/g, '/') : '';
    const content = typeof file.content === 'string' ? file.content : '';
    const segments = path.split('/');
    if (!path || path.length > 240 || path.startsWith('/') || /^[A-Za-z]:/.test(path)
      || segments.some((part) => !part || part === '.' || part === '..' || /(?:secret|credential|password|token)/i.test(part) || /^\.env(?:\.|$)/i.test(part))) {
      throw Object.assign(new Error('contextFiles contiene una ruta inválida o sensible.'), { status: 400 });
    }
    if (content.length > 14_000 || paths.has(path)) throw Object.assign(new Error('contextFiles contiene un archivo duplicado o demasiado grande.'), { status: 400 });
    paths.add(path);
    totalChars += content.length;
    if (totalChars > 14_000) throw Object.assign(new Error('El contexto compartido supera 14.000 caracteres.'), { status: 413 });
    assertNoCredentialMaterial(content);
    return { path, content };
  });
}

function errorStatus(error: unknown): number {
  if (typeof error === 'object' && error !== null && 'status' in error && typeof error.status === 'number') {
    return error.status;
  }
  if (error instanceof AgentInputError) return 400;
  if (error instanceof AgentConflictError) return 409;
  if (error instanceof AgentNotFoundError) return 404;
  if (error instanceof CredentialMaterialError) return 400;
  return 500;
}

export function createAgentTeamServer(
  runtime: AgentRuntime,
  options: AgentApiOptions = {},
): Server {
  const allowedOrigins = new Set(options.allowedOrigins ?? DEFAULT_UI_ORIGINS);

  const server = createServer(async (request, response) => {
    const origin = request.headers.origin;
    if (!hostIsLoopback(request.headers.host)) {
      send(response, 403, { error: 'HOST_NOT_ALLOWED' });
      return;
    }
    if (origin && !allowedOrigins.has(origin)) {
      send(response, 403, { error: 'ORIGIN_NOT_ALLOWED' });
      return;
    }
    const allowedOrigin = origin && allowedOrigins.has(origin) ? origin : undefined;
    if (request.method === 'OPTIONS') {
      response.writeHead(204, {
        ...(allowedOrigin ? { 'Access-Control-Allow-Origin': allowedOrigin, Vary: 'Origin' } : {}),
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Max-Age': '600',
      });
      response.end();
      return;
    }

    const url = new URL(request.url ?? '/', `http://${HOST}`);
    try {
      if (request.method === 'GET' && url.pathname === '/health') {
        send(response, 200, { status: 'ok', host: HOST, provider: options.orchestrator?.status() ?? null }, allowedOrigin);
        return;
      }
      if (request.method === 'GET' && url.pathname === '/api/agent-team/agents') {
        send(response, 200, { agents: options.orchestrator?.agents() ?? Object.values(AGENT_REGISTRY) }, allowedOrigin);
        return;
      }
      if (request.method === 'GET' && url.pathname === '/api/agent-team/provider') {
        send(response, 200, { provider: options.orchestrator?.status() ?? null }, allowedOrigin);
        return;
      }
      if (request.method === 'GET' && url.pathname === '/api/agent-team/tasks') {
        send(response, 200, { tasks: runtime.listTasks(url.searchParams.get('projectId') ?? undefined) }, allowedOrigin);
        return;
      }
      if (request.method === 'GET' && url.pathname === '/api/agent-team/events') {
        const after = Number(url.searchParams.get('afterSequence') ?? '0');
        if (!Number.isSafeInteger(after) || after < 0) throw Object.assign(new Error('afterSequence debe ser un entero no negativo.'), { status: 400 });
        send(response, 200, {
          events: runtime.listEvents({
            afterSequence: after,
            projectId: url.searchParams.get('projectId') ?? undefined,
            taskId: url.searchParams.get('taskId') ?? undefined,
          }),
        }, allowedOrigin);
        return;
      }
      if (request.method === 'GET' && url.pathname === '/api/agent-team/messages') {
        send(response, 200, {
          messages: runtime.listMessages({
            projectId: url.searchParams.get('projectId') ?? undefined,
            taskId: url.searchParams.get('taskId') ?? undefined,
          }),
        }, allowedOrigin);
        return;
      }
      if (request.method === 'GET' && url.pathname === '/api/agent-team/patch-proposals') {
        send(response, 200, { proposals: runtime.listPatchProposals({ projectId: url.searchParams.get('projectId') ?? undefined, taskId: url.searchParams.get('taskId') ?? undefined }) }, allowedOrigin);
        return;
      }
      const patchDecisionMatch = request.method === 'POST' ? url.pathname.match(/^\/api\/agent-team\/patch-proposals\/([0-9a-f-]{36})\/decision$/i) : null;
      if (patchDecisionMatch) {
        if (!options.orchestrator) throw Object.assign(new Error('El orquestador todavía no está disponible.'), { status: 503 });
        if (!request.headers['content-type']?.toLowerCase().startsWith('application/json')) throw Object.assign(new Error('Content-Type debe ser application/json.'), { status: 415 });
        const body = record(await readJson(request));
        let proposal;
        if (body.decision === 'APPROVED') proposal = await options.orchestrator.approvePatchProposal(patchDecisionMatch[1]);
        else if (body.decision === 'REJECTED') proposal = await options.orchestrator.rejectPatchProposal(patchDecisionMatch[1], typeof body.reason === 'string' ? body.reason : undefined);
        else if (body.decision === 'STALE') proposal = await runtime.decidePatchProposal(patchDecisionMatch[1], 'STALE', 'human', { reason: typeof body.reason === 'string' ? body.reason : 'El archivo cambió desde que se propuso el parche.' });
        else throw Object.assign(new Error('decision debe ser APPROVED, REJECTED o STALE.'), { status: 400 });
        send(response, 200, { proposal }, allowedOrigin);
        return;
      }
      const patchAppliedMatch = request.method === 'POST' ? url.pathname.match(/^\/api\/agent-team\/patch-proposals\/([0-9a-f-]{36})\/applied$/i) : null;
      if (patchAppliedMatch) {
        if (!options.orchestrator) throw Object.assign(new Error('El orquestador todavía no está disponible.'), { status: 503 });
        if (!request.headers['content-type']?.toLowerCase().startsWith('application/json')) throw Object.assign(new Error('Content-Type debe ser application/json.'), { status: 415 });
        const body = record(await readJson(request));
        if (typeof body.appliedSha256 !== 'string') throw Object.assign(new Error('appliedSha256 es obligatorio.'), { status: 400 });
        const task = await options.orchestrator.markPatchApplied(patchAppliedMatch[1], body.appliedSha256);
        send(response, 200, { task, proposal: runtime.getPatchProposal(patchAppliedMatch[1]) }, allowedOrigin);
        return;
      }
      if (request.method === 'POST' && url.pathname === '/api/agent-team/tasks') {
        if (!request.headers['content-type']?.toLowerCase().startsWith('application/json')) {
          throw Object.assign(new Error('Content-Type debe ser application/json.'), { status: 415 });
        }
        const body = record(await readJson(request));
        if (!agentId(body.assignedAgentId)) throw Object.assign(new Error('assignedAgentId no es un agente registrado.'), { status: 400 });
        if (typeof body.projectId !== 'string' || typeof body.goal !== 'string' || typeof body.expectedResult !== 'string') {
          throw Object.assign(new Error('projectId, goal y expectedResult son obligatorios.'), { status: 400 });
        }
        if (body.priority !== undefined && !taskPriority(body.priority)) {
          throw Object.assign(new Error('priority no es una prioridad reconocida.'), { status: 400 });
        }
        if (body.contextRefs !== undefined
          && (!Array.isArray(body.contextRefs) || !body.contextRefs.every((ref) => typeof ref === 'string'))) {
          throw Object.assign(new Error('contextRefs debe ser una lista de referencias de texto.'), { status: 400 });
        }
        if (body.requiresEvidence !== undefined && typeof body.requiresEvidence !== 'boolean') {
          throw Object.assign(new Error('requiresEvidence debe ser verdadero o falso.'), { status: 400 });
        }
        const contextFiles = projectContextFiles(body.contextFiles);
        if (contextFiles.length && body.boardId !== 'arduino-uno' && body.boardId !== 'esp32-devkit') {
          throw Object.assign(new Error('boardId debe identificar una placa compatible cuando se adjunta firmware.'), { status: 400 });
        }
        if (contextFiles.length && !options.orchestrator) {
          throw Object.assign(new Error('El runtime todavía no puede recibir contexto de archivos del proyecto.'), { status: 503 });
        }
        const task = await runtime.createTask({
          projectId: body.projectId,
          goal: body.goal,
          assignedAgentId: body.assignedAgentId,
          expectedResult: body.expectedResult,
          ...(typeof body.requiresEvidence === 'boolean' ? { requiresEvidence: body.requiresEvidence } : {}),
          requestedBy: 'human',
          ...(body.priority ? { priority: body.priority } : {}),
          ...(body.contextRefs ? { contextRefs: body.contextRefs as string[] } : {}),
        });
        if (contextFiles.length) options.orchestrator?.attachProjectContext(task.id, contextFiles, body.boardId as string);
        options.orchestrator?.enqueue(task.id);
        send(response, 201, { task }, allowedOrigin);
        return;
      }

      const resumeMatch = request.method === 'POST'
        ? url.pathname.match(/^\/api\/agent-team\/tasks\/([0-9a-f-]{36})\/resume$/i)
        : null;
      if (resumeMatch) {
        if (!options.orchestrator) throw Object.assign(new Error('El orquestador todavía no está disponible.'), { status: 503 });
        if (!request.headers['content-type']?.toLowerCase().startsWith('application/json')) {
          throw Object.assign(new Error('Content-Type debe ser application/json.'), { status: 415 });
        }
        const body = record(await readJson(request));
        if (body.expectedState !== 'WAITING_FOR_HUMAN') {
          throw Object.assign(new Error('expectedState debe ser WAITING_FOR_HUMAN.'), { status: 400 });
        }
        const task = await options.orchestrator.resumeTask(resumeMatch[1], 'WAITING_FOR_HUMAN');
        send(response, 202, { task }, allowedOrigin);
        return;
      }

      const transitionMatch = request.method === 'POST'
        ? url.pathname.match(/^\/api\/agent-team\/tasks\/([0-9a-f-]{36})\/transition$/i)
        : null;
      if (transitionMatch) {
        if (!request.headers['content-type']?.toLowerCase().startsWith('application/json')) {
          throw Object.assign(new Error('Content-Type debe ser application/json.'), { status: 415 });
        }
        const body = record(await readJson(request));
        if (body.to !== 'CANCELLED') {
          throw Object.assign(new Error('Esta fase solo permite cancelar tareas; la ejecución se habilitará al integrar el orquestador.'), { status: 400 });
        }
        if (!taskState(body.expectedState)) throw Object.assign(new Error('expectedState debe ser un estado conocido.'), { status: 400 });
        const task = options.orchestrator
          ? await options.orchestrator.cancelTask(
            transitionMatch[1], body.expectedState,
            typeof body.reason === 'string' ? body.reason : undefined,
          )
          : await runtime.transitionTask(transitionMatch[1], body.to, {
            actor: 'human', expectedState: body.expectedState,
            ...(typeof body.reason === 'string' ? { reason: body.reason } : {}),
          });
        send(response, 200, { task }, allowedOrigin);
        return;
      }
      send(response, 404, { error: 'NOT_FOUND' }, allowedOrigin);
    } catch (error) {
      send(response, errorStatus(error), { error: error instanceof Error ? error.message : 'Error interno del runtime.' }, allowedOrigin);
    }
  });
  server.headersTimeout = 10_000;
  server.requestTimeout = 15_000;
  server.keepAliveTimeout = 5_000;
  server.maxRequestsPerSocket = 100;
  return server;
}

export { HOST as AGENT_RUNTIME_HOST };
