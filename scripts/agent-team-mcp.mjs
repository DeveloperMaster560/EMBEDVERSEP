import path from 'node:path';
import readline from 'node:readline';

const API = process.env.EMBEVERSE_AGENT_URL ?? 'http://127.0.0.1:5175/api/agent-team';
const agentIds = ['structural_engineer', 'software_engineer', 'mechatronics_engineer'];

const tools = [
  {
    name: 'embedverse_list_agents',
    description: 'Consulta los especialistas EMBEVERSE registrados y su disponibilidad real.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'embedverse_list_tasks',
    description: 'Consulta las tareas del equipo EMBEVERSE, opcionalmente filtradas por proyecto.',
    inputSchema: { type: 'object', properties: { projectId: { type: 'string', maxLength: 120 } }, additionalProperties: false },
  },
  {
    name: 'embedverse_get_task',
    description: 'Consulta una tarea existente por su identificador.',
    inputSchema: { type: 'object', required: ['taskId'], properties: { taskId: { type: 'string', format: 'uuid' } }, additionalProperties: false },
  },
  {
    name: 'embedverse_list_messages',
    description: 'Consulta comunicaciones reales entre los agentes por tarea o proyecto.',
    inputSchema: { type: 'object', properties: { taskId: { type: 'string' }, projectId: { type: 'string' } }, additionalProperties: false },
  },
  {
    name: 'embedverse_submit_task',
    description: 'Crea e inicia una tarea en el runtime local EMBEVERSE. El agente elegido puede inspeccionar el workspace, delegar y proponer cambios; los cambios de archivos requieren aprobación en la UI EMBEVERSE.',
    inputSchema: {
      type: 'object', required: ['agentId', 'goal'], additionalProperties: false,
      properties: {
        agentId: { type: 'string', enum: agentIds },
        goal: { type: 'string', minLength: 1, maxLength: 8_000 },
        expectedResult: { type: 'string', maxLength: 8_000 },
        projectId: { type: 'string', maxLength: 120 },
      },
    },
  },
  {
    name: 'embedverse_list_events',
    description: 'Consulta el registro de eventos (auditoría) de una tarea: herramientas usadas, resultados, errores y respuestas inválidas del modelo. Sirve para verificar evidencias, no solo el resumen del agente.',
    inputSchema: { type: 'object', required: ['taskId'], properties: { taskId: { type: 'string', format: 'uuid' } }, additionalProperties: false },
  },
  {
    name: 'embedverse_search_knowledge',
    description: 'Consulta la memoria de conocimiento compartida del equipo (decisiones, componentes, bibliotecas verificadas, errores y soluciones) con su nivel de verificación.',
    inputSchema: {
      type: 'object', additionalProperties: false,
      properties: {
        query: { type: 'string', maxLength: 500 },
        category: { type: 'string', enum: ['project', 'technical', 'component', 'error', 'solution', 'decision'] },
        projectId: { type: 'string', maxLength: 120 },
      },
    },
  },
  {
    name: 'embedverse_cancel_task',
    description: 'Cancela una tarea activa del equipo EMBEVERSE. Solo cancela tareas en estado activo indicado.',
    inputSchema: {
      type: 'object', required: ['taskId', 'expectedState'], additionalProperties: false,
      properties: {
        taskId: { type: 'string', format: 'uuid' },
        expectedState: { type: 'string', enum: ['PENDING', 'IN_PROGRESS', 'WAITING_FOR_AGENT', 'WAITING_FOR_HUMAN'] },
      },
    },
  },
];

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

async function api(pathname, init) {
  let response;
  try {
    response = await fetch(`${API}${pathname}`, { ...init, signal: AbortSignal.timeout(15_000) });
  } catch {
    throw new Error('El runtime EMBEVERSE no está activo. Ejecuta "npm run agent:start" en el repositorio y vuelve a intentarlo.');
  }
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error ?? `El runtime respondió HTTP ${response.status}.`);
  return result;
}

function requireObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Los argumentos deben ser un objeto JSON.');
  return value;
}

async function callTool(name, rawArgs) {
  const args = requireObject(rawArgs ?? {});
  switch (name) {
    case 'embedverse_list_agents':
      return api('/agents');
    case 'embedverse_list_tasks': {
      const query = new URLSearchParams();
      if (args.projectId) query.set('projectId', String(args.projectId));
      return api(`/tasks${query.size ? `?${query}` : ''}`);
    }
    case 'embedverse_get_task': {
      if (!args.taskId) throw new Error('taskId es obligatorio.');
      const { tasks } = await api('/tasks');
      const task = tasks.find((item) => item.id === args.taskId);
      if (!task) throw new Error('No existe esa tarea.');
      return { task };
    }
    case 'embedverse_list_messages': {
      const query = new URLSearchParams();
      if (args.taskId) query.set('taskId', String(args.taskId));
      if (args.projectId) query.set('projectId', String(args.projectId));
      return api(`/messages${query.size ? `?${query}` : ''}`);
    }
    case 'embedverse_submit_task': {
      if (!agentIds.includes(args.agentId)) throw new Error('agentId debe ser uno de los tres agentes registrados.');
      if (typeof args.goal !== 'string' || !args.goal.trim()) throw new Error('goal es obligatorio.');
      const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
      const inferredId = path.basename(path.resolve(root)).toLowerCase().replace(/[^a-z0-9_-]+/g, '-').slice(0, 120) || 'claude-code';
      return api('/tasks', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          projectId: typeof args.projectId === 'string' && args.projectId.trim() ? args.projectId.trim() : inferredId,
          assignedAgentId: args.agentId,
          goal: args.goal.trim(),
          expectedResult: typeof args.expectedResult === 'string' && args.expectedResult.trim() ? args.expectedResult.trim() : 'Informe breve con hallazgos verificados, referencias, acciones y limitaciones.',
          requiresEvidence: true,
        }),
      });
    }
    case 'embedverse_list_events': {
      if (!args.taskId) throw new Error('taskId es obligatorio.');
      return api(`/events?taskId=${encodeURIComponent(String(args.taskId))}`);
    }
    case 'embedverse_search_knowledge': {
      const query = new URLSearchParams();
      for (const k of ['query', 'category', 'projectId']) if (typeof args[k] === 'string' && args[k]) query.set(k, args[k]);
      return api(`/knowledge${query.size ? `?${query}` : ''}`);
    }
    case 'embedverse_cancel_task': {
      if (!args.taskId) throw new Error('taskId es obligatorio.');
      const activeStates = ['PENDING', 'IN_PROGRESS', 'WAITING_FOR_AGENT', 'WAITING_FOR_HUMAN'];
      if (!activeStates.includes(args.expectedState)) throw new Error('expectedState no es un estado activo válido.');
      return api(`/tasks/${encodeURIComponent(args.taskId)}/transition`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ to: 'CANCELLED', expectedState: args.expectedState, reason: 'Cancelada desde Claude Code por solicitud del usuario.' }),
      });
    }
    default:
      throw new Error(`Herramienta MCP desconocida: ${name}`);
  }
}

async function handle(message) {
  if (message.jsonrpc !== '2.0') return send({ jsonrpc: '2.0', id: message.id ?? null, error: { code: -32600, message: 'Se requiere JSON-RPC 2.0.' } });
  if (message.method?.startsWith('notifications/')) return;
  const id = message.id;
  try {
    let result;
    switch (message.method) {
      case 'initialize':
        result = {
          protocolVersion: typeof message.params?.protocolVersion === 'string' ? message.params.protocolVersion : '2025-03-26',
          capabilities: { tools: {} },
          serverInfo: { name: 'embedverse-agent-team', version: '1.0.0' },
        };
        break;
      case 'ping':
        result = {};
        break;
      case 'tools/list':
        result = { tools };
        break;
      case 'tools/call': {
        const value = await callTool(message.params?.name, message.params?.arguments);
        result = { content: [{ type: 'text', text: JSON.stringify(value) }], structuredContent: value, isError: false };
        break;
      }
      default:
        if (id === undefined) return;
        send({ jsonrpc: '2.0', id, error: { code: -32601, message: `Método no disponible: ${message.method}` } });
        return;
    }
    if (id !== undefined) send({ jsonrpc: '2.0', id, result });
  } catch (error) {
    if (message.method === 'tools/call') {
      if (id !== undefined) send({
        jsonrpc: '2.0', id,
        result: { content: [{ type: 'text', text: error instanceof Error ? error.message : 'La herramienta falló.' }], isError: true },
      });
      return;
    }
    if (id !== undefined) send({ jsonrpc: '2.0', id, error: { code: -32603, message: error instanceof Error ? error.message : 'Error interno.' } });
  }
}

const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity, terminal: false });
input.on('line', (line) => {
  try {
    const message = JSON.parse(line);
    void handle(message);
  } catch {
    send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'JSON inválido.' } });
  }
});
