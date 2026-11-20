import { createHash } from 'node:crypto';
import type { AgentDefinition, AgentId, AgentMessage, AgentPatchProposal, AgentTask, KnowledgeRecord, TaskState } from '../../src/agent-team/contracts.js';
import { AGENT_REGISTRY } from '../../src/agent-team/registry.js';
import type { AgentRuntime } from './runtime.js';
import { AgentInputError } from './runtime.js';
import {
  OllamaProvider,
  type AgentModelProvider,
  type ChatMessage,
  type ChatToolSchema,
  type ProviderStatus,
} from './providers/ollama.js';
import { WorkspaceToolRegistry } from './tools.js';
import type { ToolEvidence } from './tools.js';
import { LocalFirmwareCompiler, type FirmwareCompiler } from './firmwareCompiler.js';
import { assertNoCredentialMaterial } from '../../src/agent-team/security.js';

const MAX_TOOL_CALLS_PER_RESPONSE = 3;
const MAX_TOOL_RESULT_CHARS = 4_000;
const MAX_FINAL_TEXT_CHARS = 14_000;
/** Por turno: cabe una llamada a herramienta en JSON o un informe breve. Antes eran 128 y se cortaban. */
const MAX_OUTPUT_TOKENS_PER_TURN = 1_024;
/** Respuestas inválidas seguidas que se toleran antes de pasar la tarea a supervisión humana. */
const MAX_INVALID_FINAL_TURNS = 3;

/**
 * Un informe final no puede ser una llamada a herramienta que no se ejecutó: el
 * modelo escribió el JSON de una acción (cortado, o de una herramienta que no
 * tiene) y el texto llegó aquí como si fuera el resultado.
 */
export function looksLikeUnexecutedAction(text: string): boolean {
  const t = text.trimStart();
  if (!t.startsWith('{') && !t.startsWith('```')) return false;
  return /"action"\s*:\s*"(?:tool_call|final)"|"name"\s*:\s*"[a-z_.]+"\s*,\s*"arguments"/.test(t.slice(0, 400));
}
const MAX_PROJECT_CONTEXT_CHARS = 20_000;
const MAX_DELEGATION_DEPTH = 2;
const MAX_CHILD_TASKS = 3;
const DELEGATE_TOOL: ChatToolSchema = {
  type: 'function',
  function: {
    name: 'team_delegate_task',
    description: 'Solicita trabajo a otro agente EMBEDVERSE. La tarea actual esperará la respuesta; úsalo solo si la especialidad del otro agente es necesaria.',
    parameters: {
      type: 'object', required: ['agentId', 'goal', 'expectedResult'], additionalProperties: false,
      properties: {
        agentId: { type: 'string', description: 'Identificador del agente especialista receptor.', enum: ['structural_engineer', 'software_engineer', 'mechatronics_engineer'] },
        goal: { type: 'string', description: 'Solicitud concreta, acotada y con contexto suficiente.' },
        expectedResult: { type: 'string', description: 'Formato o evidencia que debe devolver.' },
      },
    },
  },
};
const KNOWLEDGE_SEARCH_TOOL: ChatToolSchema = {
  type: 'function',
  function: {
    name: 'team_knowledge_search',
    description: 'Consulta la memoria compartida del equipo: decisiones, componentes investigados, bibliotecas verificadas, compatibilidades, errores y soluciones, resultados de pruebas. Devuelve la última versión de cada registro con su nivel de verificación.',
    parameters: {
      type: 'object', required: ['query'], additionalProperties: false,
      properties: {
        query: { type: 'string', description: 'Palabras clave (p. ej. «SHT31 licencia», «DHT22 ESP32»).' },
        category: { type: 'string', description: 'Opcional: filtra por categoría.', enum: ['project', 'technical', 'component', 'error', 'solution', 'decision'] },
      },
    },
  },
};
const KNOWLEDGE_RECORD_TOOL: ChatToolSchema = {
  type: 'function',
  function: {
    name: 'team_knowledge_record',
    description: 'Guarda en la memoria compartida algo que el equipo debe poder reutilizar. Cita su origen. Usa COMPUTATIONAL solo si citas una referencia que una herramienta te devolvió en esta tarea; si no, UNVERIFIED. No inventes datos.',
    parameters: {
      type: 'object', required: ['category', 'subject', 'content', 'sourceRefs'], additionalProperties: false,
      properties: {
        category: { type: 'string', description: 'Tipo de conocimiento.', enum: ['project', 'technical', 'component', 'error', 'solution', 'decision'] },
        subject: { type: 'string', description: 'Asunto corto y buscable.' },
        content: { type: 'string', description: 'Lo aprendido, con datos concretos y sus límites.' },
        sourceRefs: { type: 'array', description: 'Referencias de origen (workspace://…, project://…, task://…).' },
        verificationLevel: { type: 'string', description: 'UNVERIFIED o COMPUTATIONAL.', enum: ['UNVERIFIED', 'COMPUTATIONAL'] },
        supersedes: { type: 'string', description: 'Opcional: id del registro que esta versión corrige.' },
      },
    },
  },
};
const FIRMWARE_COMPILE_TOOL: ChatToolSchema = {
  type: 'function',
  function: {
    name: 'firmware_compile_selected',
    description: 'Compila los archivos de firmware seleccionados para este proyecto con el Arduino CLI local. No ejecuta ni carga el firmware en una placa.',
    parameters: { type: 'object', required: [], properties: {}, additionalProperties: false },
  },
};
const PROJECT_PROPOSE_EDIT_TOOL: ChatToolSchema = {
  type: 'function',
  function: {
    name: 'project_propose_exact_edit',
    description: 'Propone un reemplazo exacto y único en un archivo seleccionado. El cambio queda pendiente de aprobación humana y no se aplica automáticamente.',
    parameters: {
      type: 'object', required: ['path', 'summary', 'searchText', 'replaceText'], additionalProperties: false,
      properties: {
        path: { type: 'string', description: 'Ruta exacta de un archivo seleccionado.' },
        summary: { type: 'string', description: 'Qué cambia y por qué.' },
        searchText: { type: 'string', description: 'Fragmento exacto y único que se reemplazará.' },
        replaceText: { type: 'string', description: 'Texto que reemplazará el fragmento.' },
      },
    },
  },
};
const SEARCH_STOP_WORDS = new Set([
  'para', 'sobre', 'desde', 'hasta', 'entre', 'donde', 'cuando', 'como', 'este', 'esta', 'estos', 'estas',
  'con', 'sin', 'del', 'las', 'los', 'una', 'uno', 'que', 'por', 'the', 'this', 'that', 'with', 'from',
  'inspecciona', 'inspeccionar', 'revisa', 'revisar', 'analiza', 'analizar', 'consulta', 'consultar',
  'busca', 'buscar', 'identifica', 'identificar', 'reporta', 'reportar', 'debes', 'utiliza', 'utilizar',
]);

function systemPrompt(agentId: AgentId): string {
  const common = [
    'Eres un agente de ingeniería dentro de EMBEDVERSE que trabaja en el PC local del usuario.',
    'Usa las herramientas disponibles para inspeccionar evidencia antes de afirmar hechos sobre el repositorio.',
    'Cada tarea exige al menos una llamada exitosa a una herramienta de inspección antes de marcarse completada. Delegar no cuenta como evidencia.',
    'Puedes delegar una subtarea a otro especialista solo cuando sea necesaria. La tarea principal se pausará hasta recibir la respuesta.',
    'Si se seleccionaron fuentes de firmware y el objetivo requiere comprobar compilación, usa firmware_compile_selected. Esta herramienta solo compila; nunca carga firmware a hardware.',
    'Si se te pide cambiar un archivo seleccionado, usa project_propose_exact_edit para proponer un reemplazo pequeño. No afirmes que aplicaste el cambio: solo una persona puede aprobarlo y aplicarlo.',
    'No tienes herramienta para instalar dependencias, ejecutar comandos, desplegar o acceder a hardware. No afirmes que hiciste esas acciones.',
    'Si faltan datos o el proveedor devuelve una respuesta incierta, dilo y solicita la información necesaria.',
    'Al terminar, entrega un informe breve con hallazgos, referencias workspace://, verificaciones y limitaciones.',
    'Formato de cada respuesta: para usar una herramienta {"action":"tool_call","name":"<herramienta>","arguments":{...},"content":""}; para terminar {"action":"final","content":"<informe>"}. Solo puedes llamar a las herramientas que se te ofrecen en este turno; nunca inventes una ni sus resultados.',
  ];
  const otros = (Object.keys(AGENT_REGISTRY) as AgentId[]).filter((id) => id !== agentId)
    .map((id) => `${id} (${AGENT_REGISTRY[id].specialty})`);
  common.unshift(
    `Tu identificador es ${agentId}. Tus compañeros, a los que puedes delegar con team_delegate_task (campo agentId), son: ${otros.join('; ')}. No existe ningún otro agente y no puedes delegarte a ti mismo.`,
  );
  const specialty: Record<AgentId, string[]> = {
    structural_engineer: [
      'Especialidad: modelado e integración estructural conceptual.',
      'Nunca declares una estructura segura por inspección de archivos o geometría. Distingue evidencia computacional de revisión profesional y normativa.',
    ],
    software_engineer: [
      'Especialidad: arquitectura, diagnóstico e integración de software.',
      'Separa observaciones verificadas de hipótesis. No recomiendes instalar una biblioteca sin fuente, versión, compatibilidad y licencia verificables.',
    ],
    mechatronics_engineer: [
      'Especialidad: sensores, electrónica y sistemas embebidos.',
      'Distingue validación del modelo de circuito, compilación, simulación y comprobación física. Nunca afirmes que hay una conexión de hardware real.',
    ],
  };
  return [...common, ...specialty[agentId]].join('\n');
}

function resumenConocimiento(r: KnowledgeRecord) {
  return { id: r.id, category: r.category, subject: r.subject, content: r.content.slice(0, 800), verificationLevel: r.verificationLevel, version: r.version, createdBy: r.createdBy, createdAt: r.createdAt, sourceRefs: r.sourceRefs.slice(0, 5) };
}

function parseToolArguments(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new AgentInputError('La llamada del modelo contiene argumentos que no son un objeto.');
  }
  return value as Record<string, unknown>;
}

export class AgentOrchestrator {
  readonly provider: AgentModelProvider;
  readonly tools: WorkspaceToolRegistry;
  private readonly runtime: AgentRuntime;
  private readonly projectContexts = new Map<string, { boardId: string; files: { path: string; content: string }[] }>();
  /** Milisegundos de trabajo consumidos por tarea (en memoria: tras un reinicio no se reanuda nada solo). */
  private readonly activeMs = new Map<string, number>();
  private readonly firmwareCompiler: FirmwareCompiler;
  private readonly queue: string[] = [];
  private readonly queued = new Set<string>();
  private readonly active = new Set<string>();
  private providerStatus: ProviderStatus;
  private drainPromise?: Promise<void>;
  private activeController?: AbortController;
  private stopping = false;

  constructor(options: { runtime: AgentRuntime; workspaceRoot: string; provider?: AgentModelProvider; firmwareCompiler?: FirmwareCompiler }) {
    this.runtime = options.runtime;
    this.provider = options.provider ?? new OllamaProvider();
    this.tools = new WorkspaceToolRegistry(options.workspaceRoot);
    this.firmwareCompiler = options.firmwareCompiler ?? new LocalFirmwareCompiler(options.workspaceRoot);
    this.providerStatus = {
      provider: 'ollama', model: this.provider.model, available: false, reason: 'El runtime aún no ha comprobado Ollama.',
    };
  }

  async start(): Promise<void> {
    this.providerStatus = await this.provider.status();
    for (const task of this.runtime.listTasks()) {
      if (task.state === 'IN_PROGRESS') {
        await this.runtime.transitionTask(task.id, 'WAITING_FOR_HUMAN', {
          actor: 'system',
          reason: 'El runtime se reinició durante la tarea; no se reanudó una llamada a modelo automáticamente.',
          error: { code: 'RUNTIME_RESTARTED', message: 'Revisa el historial y reanuda manualmente la tarea.' },
        });
      } else if (task.state === 'PENDING') {
        this.enqueue(task.id);
      }
    }
  }

  status(): ProviderStatus {
    return structuredClone(this.providerStatus);
  }

  agents(): AgentDefinition[] {
    return Object.values(AGENT_REGISTRY).map((agent) => ({
      ...agent,
      toolIds: this.tools.listToolIdsForAgent(agent.id),
      availability: this.providerStatus.available ? 'ACTIVE' : 'WAITING_FOR_PROVIDER',
    }));
  }

  enqueue(taskId: string): void {
    if (this.stopping || this.queued.has(taskId) || this.active.has(taskId)) return;
    const task = this.runtime.getTask(taskId);
    if (!task || task.state !== 'PENDING') return;
    this.queued.add(taskId);
    this.queue.push(taskId);
    void this.drain();
  }

  attachProjectContext(taskId: string, files: { path: string; content: string }[], boardId = ''): void {
    if (!this.runtime.getTask(taskId)) throw new AgentInputError('No existe la tarea para asociar el contexto del proyecto.');
    this.projectContexts.set(taskId, { boardId, files: structuredClone(files) });
  }

  async waitForIdle(): Promise<void> {
    while (this.drainPromise || this.queue.length) {
      if (this.drainPromise) await this.drainPromise;
      else await this.drain();
    }
  }

  async resumeTask(taskId: string, expectedState: TaskState): Promise<AgentTask> {
    if (expectedState !== 'WAITING_FOR_HUMAN') throw new AgentInputError('Solo se reanudan tareas que esperan supervisión humana.');
    const health = await this.provider.status();
    this.providerStatus = health;
    if (!health.available) throw new AgentInputError(health.reason ?? 'El proveedor local no está disponible.');
    const task = await this.runtime.transitionTask(taskId, 'IN_PROGRESS', {
      actor: 'human',
      expectedState,
      reason: 'Reanudada por supervisión humana.',
    });
    this.enqueueStarted(taskId);
    return task;
  }

  private enqueueStarted(taskId: string): void {
    if (this.stopping || this.queued.has(taskId) || this.active.has(taskId)) return;
    this.queued.add(taskId);
    this.queue.push(taskId);
    void this.drain();
  }

  async cancelTask(taskId: string, expectedState: TaskState, reason?: string): Promise<AgentTask> {
    const task = await this.runtime.transitionTask(taskId, 'CANCELLED', {
      actor: 'human', expectedState, ...(reason ? { reason } : {}),
    });
    for (const proposal of this.runtime.listPatchProposals({ taskId })) {
      if (proposal.state === 'PENDING_APPROVAL' || proposal.state === 'APPROVED') {
        await this.runtime.decidePatchProposal(proposal.id, 'CANCELLED', 'human', { reason: reason ?? 'La tarea fue cancelada.' });
      }
    }
    if (this.active.has(taskId)) this.activeController?.abort(new Error('La tarea fue cancelada por supervisión humana.'));
    this.projectContexts.delete(taskId);
    await this.cancelDescendants(taskId, reason ?? 'Cancelada junto con la tarea padre.');
    return task;
  }

  private async cancelDescendants(parentTaskId: string, reason: string): Promise<void> {
    for (const child of this.runtime.listTasks().filter((item) => item.parentTaskId === parentTaskId)) {
      this.projectContexts.delete(child.id);
      if (['PENDING', 'IN_PROGRESS', 'WAITING_FOR_AGENT', 'WAITING_FOR_HUMAN'].includes(child.state)) {
        await this.runtime.transitionTask(child.id, 'CANCELLED', {
          actor: 'system', expectedState: child.state, reason,
        });
        for (const proposal of this.runtime.listPatchProposals({ taskId: child.id })) {
          if (proposal.state === 'PENDING_APPROVAL' || proposal.state === 'APPROVED') {
            await this.runtime.decidePatchProposal(proposal.id, 'CANCELLED', 'system', { reason });
          }
        }
        if (this.active.has(child.id)) this.activeController?.abort(new Error(reason));
        await this.cancelDescendants(child.id, reason);
      }
    }
  }

  private async drain(): Promise<void> {
    if (this.drainPromise) return this.drainPromise;
    this.drainPromise = (async () => {
      while (!this.stopping && this.queue.length) {
        const taskId = this.queue.shift();
        if (!taskId) continue;
        this.queued.delete(taskId);
        this.active.add(taskId);
        await this.runTask(taskId).catch(() => undefined);
        this.active.delete(taskId);
        this.activeController = undefined;
      }
    })().finally(() => { this.drainPromise = undefined; });
    return this.drainPromise;
  }

  private async runTask(taskId: string): Promise<void> {
    let task = this.runtime.getTask(taskId);
    if (!task || !['PENDING', 'IN_PROGRESS'].includes(task.state)) return;
    if (task.state === 'PENDING') {
      try {
        task = await this.runtime.transitionTask(task.id, 'IN_PROGRESS', { actor: 'system', expectedState: 'PENDING' });
      } catch {
        return;
      }
    }

    const controller = new AbortController();
    this.activeController = controller;
    // El presupuesto de duración es tiempo de TRABAJO: lo que la tarea pasa esperando
    // a un especialista (WAITING_FOR_AGENT) no se descuenta. Con el plazo de reloj, una
    // tarea padre volvía de su subtarea ya vencida y se abortaba en 1 ms.
    const usadoMs = this.activeMs.get(task.id) ?? 0;
    const remainingMs = Math.max(1, task.budget.maxDurationMs - usadoMs);
    const inicioMs = Date.now();
    const timeout = setTimeout(() => controller.abort(new Error('Se agotó el tiempo máximo de trabajo de la tarea.')), remainingMs);
    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt(task.assignedAgentId) },
      {
        role: 'user',
        content: [
          `Objetivo de la tarea: ${task.goal}`,
          `Resultado esperado: ${task.expectedResult}`,
          `Proyecto: ${task.projectId}`,
          ...this.rejectedPatchNotes(task),
          task.contextRefs.length ? `Referencias de contexto declaradas: ${task.contextRefs.join(', ')}` : '',
          ...this.memoriaRelevante(task),
          ...this.incomingMessages(task).map((message) => `Respuesta del agente ${message.senderAgentId}: ${message.description}\nDatos: ${JSON.stringify(message.technicalContext)}\nReferencias: ${message.resourceRefs.join(', ') || 'ninguna'}`),
          'Si una referencia no es una ruta del repositorio, informa que esta primera versión no puede abrirla.',
        ].filter(Boolean).join('\n'),
      },
    ];
    let turns = 0;
    let toolCalls = 0;
    let successfulToolCalls = 0;
    let toolReminderTurns = 0;
    let invalidFinalTurns = 0;
    let tokens = 0;
    const evidenceRefs = new Set<string>();

    try {
      this.providerStatus = await this.provider.status(controller.signal);
      await this.runtime.recordEvent({
        taskId,
        type: 'agent.turn_started',
        actor: task.assignedAgentId,
        payload: { provider: this.provider.name, model: this.provider.model },
      });
      if (!this.providerStatus.available) throw new Error(this.providerStatus.reason ?? 'El proveedor local no está disponible.');

      const initialEvidence = task.requiresEvidence ? await this.captureInitialEvidence(task) : null;
      if (initialEvidence) {
        successfulToolCalls += 1;
        toolCalls += 1;
        for (const reference of initialEvidence.evidenceRefs) evidenceRefs.add(reference);
        messages.push({
          role: 'user',
          content: `Evidencia obtenida mediante una herramienta local de solo lectura. Úsala y cita sus referencias.\n${initialEvidence.text}`,
        });
      }

      while (turns < task.budget.maxTurns) {
        if (controller.signal.aborted) throw controller.signal.reason ?? new Error('La tarea fue interrumpida.');
        const current = this.runtime.getTask(taskId);
        if (!current || current.state !== 'IN_PROGRESS') return;
        turns += 1;
        const response = await this.provider.chat({
          messages,
          tools: [
            ...(initialEvidence ? [] : this.tools.listForAgent(task.assignedAgentId)),
            ...(this.canCompileProject(task) ? [FIRMWARE_COMPILE_TOOL] : []),
            ...(this.canProposePatch(task) ? [PROJECT_PROPOSE_EDIT_TOOL] : []),
            KNOWLEDGE_SEARCH_TOOL,
            KNOWLEDGE_RECORD_TOOL,
            DELEGATE_TOOL,
          ],
          signal: controller.signal,
          maxOutputTokens: Math.max(32, Math.min(MAX_OUTPUT_TOKENS_PER_TURN, task.budget.maxTokens ?? MAX_OUTPUT_TOKENS_PER_TURN, (task.budget.maxTokens ?? MAX_OUTPUT_TOKENS_PER_TURN) - tokens)),
        });
        tokens += response.promptTokens + response.completionTokens;
        if (tokens > (task.budget.maxTokens ?? Number.MAX_SAFE_INTEGER)) {
          throw new Error('Se agotó el presupuesto de tokens de la tarea.');
        }
        messages.push(response.message);
        await this.runtime.recordEvent({
          taskId,
          type: 'agent.turn_completed',
          actor: task.assignedAgentId,
          payload: {
            turn: turns,
            promptTokens: response.promptTokens,
            completionTokens: response.completionTokens,
            toolCalls: response.message.tool_calls?.length ?? 0,
          },
        });

        if (response.truncated || response.contextSaturated) {
          invalidFinalTurns += 1;
          const motivo = response.truncated
            ? 'La respuesta se cortó por el límite de tokens de salida.'
            : 'El prompt llenó la ventana de contexto: el modelo pudo no ver sus instrucciones.';
          await this.runtime.recordEvent({
            taskId, type: 'agent.invalid_response', actor: task.assignedAgentId,
            payload: { turn: turns, reason: motivo, promptTokens: response.promptTokens, completionTokens: response.completionTokens },
          });
          if (invalidFinalTurns >= MAX_INVALID_FINAL_TURNS) throw new Error(`${motivo} La tarea necesita supervisión humana.`);
          messages.pop();
          messages.push({ role: 'user', content: `${motivo} Responde de nuevo de forma más breve: una sola llamada a herramienta o un informe final conciso.` });
          continue;
        }
        const calls = response.message.tool_calls ?? [];
        if (!calls.length) {
          const summary = response.message.content.trim();
          if (!summary) throw new Error('El modelo terminó sin texto de resultado ni llamadas a herramientas.');
          if (looksLikeUnexecutedAction(summary)) {
            invalidFinalTurns += 1;
            await this.runtime.recordEvent({
              taskId, type: 'agent.invalid_response', actor: task.assignedAgentId,
              payload: { turn: turns, reason: 'Llamada a herramienta no ejecutable presentada como resultado.', excerpt: summary.slice(0, 200) },
            });
            if (invalidFinalTurns >= MAX_INVALID_FINAL_TURNS) {
              throw new Error('El modelo devolvió llamadas a herramientas inválidas en lugar de un resultado; la tarea necesita supervisión humana.');
            }
            const disponibles = [
              ...(initialEvidence ? [] : this.tools.listForAgent(task.assignedAgentId).map((t) => t.function.name)),
              ...(this.canCompileProject(task) ? [FIRMWARE_COMPILE_TOOL.function.name] : []),
              ...(this.canProposePatch(task) ? [PROJECT_PROPOSE_EDIT_TOOL.function.name] : []),
              KNOWLEDGE_SEARCH_TOOL.function.name,
              KNOWLEDGE_RECORD_TOOL.function.name,
              DELEGATE_TOOL.function.name,
            ];
            messages.push({
              role: 'user',
              content: `Tu respuesta no es válida: escribiste una llamada a herramienta que no se ejecutó (incompleta o de una herramienta que no tienes). Herramientas disponibles: ${disponibles.join(', ')}. Llama a una de ellas con argumentos JSON completos, o entrega el resultado final como texto normal que cite las referencias de la evidencia.`,
            });
            continue;
          }
          if (task.requiresEvidence && successfulToolCalls === 0) {
            toolReminderTurns += 1;
            if (toolReminderTurns >= 3) {
              throw new Error('El modelo no usó una herramienta para consultar evidencia; la tarea necesita intervención humana.');
            }
            messages.push({
              role: 'user',
              content: 'Aún no hay evidencia del repositorio. Antes de contestar, llama a workspace_read_file o workspace_search y basa el resultado en su salida.',
            });
            continue;
          }
          const now = this.runtime.getTask(taskId);
          if (!now || now.state !== 'IN_PROGRESS') return;
          await this.runtime.transitionTask(taskId, 'COMPLETED', {
            actor: task.assignedAgentId,
            expectedState: 'IN_PROGRESS',
            result: {
              summary: summary.slice(0, MAX_FINAL_TEXT_CHARS),
              provider: this.provider.name,
              model: this.provider.model,
              toolCalls,
              turns,
              tokens,
              evidenceRefs: [...evidenceRefs],
            },
          });
          this.projectContexts.delete(task.id);
          await this.notifyParent(task, 'COMPLETED');
          return;
        }
        if (calls.length > MAX_TOOL_CALLS_PER_RESPONSE) throw new Error('El modelo excedió el límite de llamadas simultáneas.');

        for (const call of calls) {
          if (++toolCalls > task.budget.maxToolCalls) throw new Error('Se agotó el presupuesto de llamadas a herramientas.');
          const functionName = call.function.name;
          const toolId = this.tools.canonicalId(functionName);
          const args = parseToolArguments(call.function.arguments);
          await this.runtime.recordEvent({
            taskId,
            type: 'tool.requested',
            actor: task.assignedAgentId,
            payload: { toolId, arguments: args },
          });
          if (toolId === 'team_delegate_task') {
            await this.runtime.recordEvent({
              taskId,
              type: 'tool.started',
              actor: task.assignedAgentId,
              payload: { toolId },
            });
            let child: Awaited<ReturnType<AgentOrchestrator['delegate']>>;
            try {
              child = await this.delegate(task, args);
            } catch (error) {
              if (!(error instanceof AgentInputError)) throw error;
              await this.runtime.recordEvent({ taskId, type: 'tool.failed', actor: task.assignedAgentId, payload: { toolId, error: error.message } });
              messages.push({ role: 'tool', tool_name: functionName, content: `Delegación rechazada: ${error.message} Corrige los argumentos (agentId, goal, expectedResult) o continúa sin delegar.` });
              continue;
            }
            await this.runtime.recordEvent({
              taskId,
              type: 'tool.completed',
              actor: task.assignedAgentId,
              payload: { toolId, childTaskId: child.id, messageId: child.message.id },
            });
            messages.push({ role: 'tool', tool_name: functionName, content: `Subtarea ${child.id} enviada al agente ${child.assignedAgentId}; la tarea principal queda esperando la respuesta.` });
            return;
          }
          if (toolId === 'team_knowledge_search' || toolId === 'team_knowledge_record') {
            await this.runtime.recordEvent({ taskId, type: 'tool.started', actor: task.assignedAgentId, payload: { toolId } });
            try {
              let texto: string;
              if (toolId === 'team_knowledge_search') {
                const hallados = this.runtime.knowledge.search({
                  query: typeof args.query === 'string' ? args.query : '',
                  ...(typeof args.category === 'string' ? { category: args.category as KnowledgeRecord['category'] } : {}),
                  projectId: task.projectId, limit: 8,
                });
                texto = hallados.length ? JSON.stringify(hallados.map(resumenConocimiento)) : 'La memoria del equipo no tiene registros sobre eso.';
                await this.runtime.recordEvent({ taskId, type: 'tool.completed', actor: task.assignedAgentId, payload: { toolId, summary: `${hallados.length} registros de la memoria.`, knowledgeIds: hallados.map((r) => r.id) } });
              } else {
                const allowed = ['category', 'subject', 'content', 'sourceRefs', 'verificationLevel', 'supersedes'];
                if (Object.keys(args).some((k) => !allowed.includes(k))) throw new AgentInputError(`Campos permitidos: ${allowed.join(', ')}.`);
                const record = await this.runtime.recordKnowledge(task.id, {
                  category: args.category as KnowledgeRecord['category'],
                  subject: String(args.subject ?? ''),
                  content: String(args.content ?? ''),
                  sourceRefs: Array.isArray(args.sourceRefs) ? args.sourceRefs.map(String) : typeof args.sourceRefs === 'string' ? [args.sourceRefs] : [],
                  createdBy: task.assignedAgentId,
                  ...(typeof args.verificationLevel === 'string' ? { verificationLevel: args.verificationLevel as KnowledgeRecord['verificationLevel'] } : {}),
                  ...(typeof args.supersedes === 'string' && args.supersedes ? { supersedes: args.supersedes } : {}),
                }, evidenceRefs);
                texto = `Guardado en la memoria: ${record.id} (versión ${record.version}, ${record.verificationLevel}).`;
                await this.runtime.recordEvent({ taskId, type: 'tool.completed', actor: task.assignedAgentId, payload: { toolId, summary: texto, knowledgeId: record.id } });
              }
              messages.push({ role: 'tool', tool_name: functionName, content: texto.slice(0, MAX_TOOL_RESULT_CHARS) });
            } catch (error) {
              if (!(error instanceof AgentInputError) && !(error instanceof Error && error.name === 'CredentialMaterialError')) throw error;
              await this.runtime.recordEvent({ taskId, type: 'tool.failed', actor: task.assignedAgentId, payload: { toolId, error: error.message } });
              messages.push({ role: 'tool', tool_name: functionName, content: `Herramienta no ejecutada: ${error.message}` });
            }
            continue;
          }
          if (toolId === 'firmware_compile_selected') {
            await this.runtime.recordEvent({ taskId, type: 'tool.started', actor: task.assignedAgentId, payload: { toolId } });
            try {
              const context = this.projectContexts.get(task.id);
              if (!context || !this.canCompileProject(task)) throw new AgentInputError('No hay un firmware seleccionado que pueda compilarse.');
              const evidence = await this.firmwareCompiler.compile(context.boardId, context.files);
              successfulToolCalls += 1;
              for (const reference of evidence.evidenceRefs) evidenceRefs.add(reference);
              await this.runtime.recordEvent({
                taskId, type: 'tool.completed', actor: task.assignedAgentId,
                payload: { toolId, summary: evidence.summary, evidenceRefs: evidence.evidenceRefs },
                evidenceRefs: evidence.evidenceRefs,
              });
              messages.push({ role: 'tool', tool_name: functionName, content: evidence.text.slice(0, MAX_TOOL_RESULT_CHARS) });
            } catch (error) {
              const message = error instanceof Error ? error.message : 'La compilación falló.';
              await this.runtime.recordEvent({
                taskId, type: 'tool.failed', actor: task.assignedAgentId,
                payload: { toolId, error: message.slice(0, 1_000) },
              });
              messages.push({ role: 'tool', tool_name: functionName, content: `Compilador no ejecutado: ${message}` });
            }
            continue;
          }
          if (toolId === 'project_propose_exact_edit') {
            await this.runtime.recordEvent({ taskId, type: 'tool.started', actor: task.assignedAgentId, payload: { toolId } });
            try {
              const proposal = await this.proposePatch(task, args);
              await this.runtime.recordEvent({ taskId, type: 'tool.completed', actor: task.assignedAgentId, payload: { toolId, proposalId: proposal.id, path: proposal.path, originalSha256: proposal.originalSha256, proposedSha256: proposal.proposedSha256 } });
              await this.notifyParent(task, 'WAITING_FOR_HUMAN', 'Hay una propuesta de cambio pendiente de aprobación.');
            } catch (error) {
              const message = error instanceof Error ? error.message : 'La propuesta de cambio no es válida.';
              await this.runtime.recordEvent({ taskId, type: 'tool.failed', actor: task.assignedAgentId, payload: { toolId, error: message.slice(0, 1_000) } });
              messages.push({ role: 'tool', tool_name: functionName, content: `Propuesta rechazada: ${message}` });
              continue;
            }
            return;
          }
          await this.runtime.recordEvent({
            taskId,
            type: 'tool.started',
            actor: task.assignedAgentId,
            payload: { toolId },
          });
          try {
            const evidence = await this.tools.execute(task.assignedAgentId, toolId, args);
            for (const reference of evidence.evidenceRefs) evidenceRefs.add(reference);
            successfulToolCalls += 1;
            await this.runtime.recordEvent({
              taskId,
              type: 'tool.completed',
              actor: task.assignedAgentId,
              payload: { toolId, summary: evidence.summary, evidenceRefs: evidence.evidenceRefs },
              evidenceRefs: evidence.evidenceRefs,
            });
            messages.push({ role: 'tool', tool_name: functionName, content: evidence.text.slice(0, MAX_TOOL_RESULT_CHARS) });
          } catch (error) {
            const message = error instanceof Error ? error.message : 'La herramienta falló.';
            await this.runtime.recordEvent({
              taskId,
              type: 'tool.failed',
              actor: task.assignedAgentId,
              payload: { toolId, error: message.slice(0, 1_000) },
            });
            messages.push({ role: 'tool', tool_name: functionName, content: `Herramienta no ejecutada: ${message}` });
          }
        }
      }
      throw new Error(`Se agotó el límite de ${task.budget.maxTurns} turnos.`);
    } catch (error) {
      const current = this.runtime.getTask(taskId);
      if (current?.state === 'IN_PROGRESS') {
        const message = error instanceof Error ? error.message : 'La ejecución del agente falló.';
        await this.runtime.transitionTask(taskId, 'WAITING_FOR_HUMAN', {
          actor: 'system',
          expectedState: 'IN_PROGRESS',
          reason: 'La tarea requiere revisión o recuperación humana.',
          error: {
            code: controller.signal.aborted ? 'EXECUTION_INTERRUPTED' : 'AGENT_EXECUTION_FAILED',
            message: message.slice(0, 2_000),
          },
        });
        await this.notifyParent(current, 'WAITING_FOR_HUMAN', message.slice(0, 1_000));
      }
    } finally {
      clearTimeout(timeout);
      this.activeMs.set(task.id, usadoMs + (Date.now() - inicioMs));
    }
  }

  /** Lo que la memoria del equipo ya sabe sobre el objetivo, para no repetir descubrimientos. */
  private memoriaRelevante(task: AgentTask): string[] {
    const hallados = this.runtime.knowledge.search({ query: `${task.goal} ${task.expectedResult}`, projectId: task.projectId, limit: 5 });
    if (!hallados.length) return [];
    return [
      `Memoria del equipo (consulta antes de repetir trabajo; respeta el nivel de verificación, UNVERIFIED no es un hecho comprobado):\n${JSON.stringify(hallados.map(resumenConocimiento))}`,
    ];
  }

  private incomingMessages(task: AgentTask): AgentMessage[] {
    return this.runtime.listMessages({ taskId: task.id })
      .filter((message) => message.recipientAgentId === task.assignedAgentId
        && message.senderAgentId !== task.assignedAgentId
        && (message.state === 'COMPLETED' || message.state === 'FAILED'));
  }

  private rejectedPatchNotes(task: AgentTask): string[] {
    return this.runtime.listPatchProposals({ taskId: task.id })
      .filter((proposal) => proposal.state === 'REJECTED')
      .map((proposal) => `Una propuesta anterior para ${proposal.path} fue rechazada. Motivo: ${proposal.decisionReason ?? 'sin motivo indicado'}. Revisa el motivo antes de proponer otra.`);
  }

  private canProposePatch(task: AgentTask): boolean {
    return (this.projectContexts.get(task.id)?.files.length ?? 0) > 0;
  }

  private async proposePatch(task: AgentTask, args: Record<string, unknown>): Promise<AgentPatchProposal> {
    const allowed = ['path', 'summary', 'searchText', 'replaceText'];
    if (Object.keys(args).some((key) => !allowed.includes(key))) throw new AgentInputError('La propuesta contiene campos no permitidos.');
    const path = typeof args.path === 'string' ? args.path : '';
    const summary = typeof args.summary === 'string' ? args.summary.trim() : '';
    const searchText = typeof args.searchText === 'string' ? args.searchText : '';
    const replaceText = typeof args.replaceText === 'string' ? args.replaceText : '';
    const file = this.projectContexts.get(task.id)?.files.find((item) => item.path === path);
    if (!file) throw new AgentInputError('La ruta no coincide con un archivo seleccionado para esta tarea.');
    if (!summary || summary.length > 500 || !searchText || searchText.length > 1_000 || replaceText.length > 2_500 || file.content.length > 14_000) {
      throw new AgentInputError('La propuesta excede los límites de texto permitidos.');
    }
    const index = file.content.indexOf(searchText);
    if (index < 0 || file.content.indexOf(searchText, index + searchText.length) >= 0) {
      throw new AgentInputError('El fragmento debe aparecer exactamente una vez en el archivo seleccionado.');
    }
    const proposed = file.content.slice(0, index) + replaceText + file.content.slice(index + searchText.length);
    if (proposed.length > 14_000) throw new AgentInputError('El resultado propuesto excede 14.000 caracteres.');
    assertNoCredentialMaterial(proposed);
    const proposal = await this.runtime.recordPatchProposal({
      taskId: task.id, agentId: task.assignedAgentId, path, summary, searchText, replaceText,
      originalSha256: createHash('sha256').update(file.content).digest('hex'),
      proposedSha256: createHash('sha256').update(proposed).digest('hex'),
    });
    await this.runtime.transitionTask(task.id, 'WAITING_FOR_HUMAN', {
      actor: task.assignedAgentId, expectedState: 'IN_PROGRESS', reason: 'Propuesta de cambio pendiente de aprobación humana.',
      error: { code: 'PATCH_REVIEW_REQUIRED', message: `Revisar propuesta ${proposal.id} para ${path}.` },
    });
    return proposal;
  }

  async approvePatchProposal(proposalId: string): Promise<AgentPatchProposal> {
    const proposal = this.runtime.getPatchProposal(proposalId);
    if (!proposal || proposal.state !== 'PENDING_APPROVAL') throw new AgentInputError('La propuesta ya no está pendiente de aprobación.');
    return this.runtime.decidePatchProposal(proposalId, 'APPROVED', 'human');
  }

  async rejectPatchProposal(proposalId: string, reason?: string): Promise<AgentPatchProposal> {
    const proposal = await this.runtime.decidePatchProposal(proposalId, 'REJECTED', 'human', { reason });
    const task = this.runtime.getTask(proposal.taskId);
    if (task?.state === 'WAITING_FOR_HUMAN') {
      try { await this.resumeTask(task.id, 'WAITING_FOR_HUMAN'); } catch { /* Remains available for manual resume when provider is ready. */ }
    }
    return proposal;
  }

  async markPatchApplied(proposalId: string, appliedSha256: string): Promise<AgentTask> {
    const proposal = this.runtime.getPatchProposal(proposalId);
    if (!proposal || proposal.state !== 'APPROVED' || appliedSha256 !== proposal.proposedSha256) throw new AgentInputError('El hash aplicado no coincide con una propuesta aprobada.');
    const task = this.runtime.getTask(proposal.taskId);
    if (!task || task.state !== 'WAITING_FOR_HUMAN') throw new AgentInputError('La tarea ya no espera la aplicación de esta propuesta.');
    await this.runtime.decidePatchProposal(proposalId, 'APPLIED', 'human', { appliedSha256 });
    const completed = await this.runtime.transitionTask(task.id, 'COMPLETED', {
      actor: 'human', expectedState: 'WAITING_FOR_HUMAN', reason: 'Propuesta aprobada y aplicada en el proyecto local.',
      result: { summary: proposal.summary, patchProposalId: proposal.id, path: proposal.path, appliedSha256, evidenceRefs: [`project://${proposal.projectId}/${proposal.path}#sha256=${appliedSha256}`] },
    });
    this.projectContexts.delete(task.id);
    await this.notifyParent(task, 'COMPLETED');
    return completed;
  }

  private async delegate(task: AgentTask, args: Record<string, unknown>): Promise<{ id: string; assignedAgentId: AgentId; message: AgentMessage }> {
    const allowed = ['agentId', 'goal', 'expectedResult'];
    if (Object.keys(args).some((key) => !allowed.includes(key))) throw new AgentInputError('La delegación contiene campos no permitidos.');
    const recipient = args.agentId;
    const goal = typeof args.goal === 'string' ? args.goal.trim() : '';
    const expectedResult = typeof args.expectedResult === 'string' ? args.expectedResult.trim() : '';
    if (typeof recipient !== 'string' || !Object.hasOwn(AGENT_REGISTRY, recipient)) throw new AgentInputError('La delegación debe seleccionar un agente registrado.');
    if (!goal || goal.length > 2_000 || !expectedResult || expectedResult.length > 1_000) throw new AgentInputError('La solicitud delegada requiere objetivo (máx. 2.000 caracteres) y resultado esperado (máx. 1.000).');
    if (recipient === task.assignedAgentId) throw new AgentInputError('Un agente no puede delegarse una tarea a sí mismo.');
    const contextRefs = task.contextRefs.slice(0, 10);
    let depth = 0;
    let ancestorId = task.parentTaskId;
    while (ancestorId) {
      depth += 1;
      const ancestor = this.runtime.getTask(ancestorId);
      ancestorId = ancestor?.parentTaskId;
      if (depth >= MAX_DELEGATION_DEPTH) throw new AgentInputError('Se alcanzó el máximo de profundidad de delegación.');
      if (ancestor?.assignedAgentId === recipient && ancestor.goal.trim().toLocaleLowerCase() === goal.toLocaleLowerCase()) {
        throw new AgentInputError('La delegación repetiría el mismo agente y objetivo de la cadena; se bloqueó el ciclo.');
      }
    }
    const children = this.runtime.listTasks().filter((item) => item.parentTaskId === task.id);
    if (children.length >= MAX_CHILD_TASKS) throw new AgentInputError(`Una tarea puede crear como máximo ${MAX_CHILD_TASKS} subtareas.`);
    const child = await this.runtime.createTask({
      projectId: task.projectId,
      goal,
      expectedResult,
      requestedBy: task.assignedAgentId,
      assignedAgentId: recipient as AgentId,
      priority: task.priority,
      contextRefs: contextRefs as string[],
      parentTaskId: task.id,
      cycleKey: `${recipient}:${goal.toLocaleLowerCase().replace(/\s+/g, ' ').slice(0, 180)}`,
      budget: { maxTurns: Math.min(4, task.budget.maxTurns), maxToolCalls: Math.min(4, task.budget.maxToolCalls), maxRetries: 0 },
    });
    const message = await this.runtime.recordMessage({
      projectId: task.projectId,
      taskId: task.id,
      senderAgentId: task.assignedAgentId,
      recipientAgentId: recipient as AgentId,
      requestType: 'delegation.request',
      description: goal,
      expectedResult,
      technicalContext: { expectedResult, childTaskId: child.id },
      resourceRefs: contextRefs as string[],
      priority: task.priority,
      correlationId: task.id,
    });
    const projectContext = this.projectContexts.get(task.id);
    if (projectContext) this.attachProjectContext(child.id, projectContext.files, projectContext.boardId);
    await this.runtime.updateMessageState(message.id, 'IN_PROGRESS', task.id, task.assignedAgentId);
    await this.runtime.transitionTask(task.id, 'WAITING_FOR_AGENT', {
      actor: task.assignedAgentId,
      expectedState: 'IN_PROGRESS',
      reason: `Esperando respuesta de ${recipient}.`,
    });
    this.enqueue(child.id);
    return { id: child.id, assignedAgentId: recipient as AgentId, message };
  }

  private async notifyParent(task: AgentTask, outcome: 'COMPLETED' | 'WAITING_FOR_HUMAN', reason?: string): Promise<void> {
    if (!task.parentTaskId) return;
    const parent = this.runtime.getTask(task.parentTaskId);
    if (!parent || parent.state !== 'WAITING_FOR_AGENT') return;
    const request = this.runtime.listMessages({ taskId: parent.id }).find((message) => (
      message.requestType === 'delegation.request'
      && message.technicalContext.childTaskId === task.id
      && message.recipientAgentId === task.assignedAgentId
    ));
    if (!request) return;
    const result = this.runtime.getTask(task.id)?.result;
    const replyState: AgentMessage['state'] = outcome === 'COMPLETED' ? 'COMPLETED' : 'FAILED';
    await this.runtime.updateMessageState(request.id, replyState, parent.id, task.assignedAgentId);
    const response = await this.runtime.recordMessage({
      projectId: parent.projectId,
      taskId: parent.id,
      senderAgentId: task.assignedAgentId,
      recipientAgentId: parent.assignedAgentId,
      requestType: 'delegation.response',
      description: outcome === 'COMPLETED'
        ? String(result?.summary ?? 'La subtarea terminó sin resumen.')
        : `La subtarea requiere intervención humana${reason ? `: ${reason}` : '.'}`,
      expectedResult: request.expectedResult,
      technicalContext: { childTaskId: task.id, childState: outcome, result: result ?? null },
      resourceRefs: Array.isArray(result?.evidenceRefs) ? result.evidenceRefs.filter((ref): ref is string => typeof ref === 'string') : [],
      priority: task.priority,
      correlationId: parent.id,
      causationId: request.id,
    });
    await this.runtime.updateMessageState(response.id, replyState, parent.id, task.assignedAgentId);
    await this.runtime.transitionTask(parent.id, 'IN_PROGRESS', {
      actor: 'system',
      expectedState: 'WAITING_FOR_AGENT',
      reason: `Respuesta recibida de ${task.assignedAgentId}.`,
    });
    this.enqueueStarted(parent.id);
  }

  private async captureInitialEvidence(task: AgentTask): Promise<ToolEvidence | null> {
    const projectFiles = this.projectContexts.get(task.id)?.files;
    if (projectFiles?.length) {
      const evidenceRefs = projectFiles.map((file) => {
        const hash = createHash('sha256').update(file.content).digest('hex');
        return `project://${task.projectId}/${file.path}#sha256=${hash}`;
      });
      const text = JSON.stringify({
        source: 'selected_project_files',
        files: projectFiles.map((file) => ({ path: file.path, content: file.content })),
      }).slice(0, MAX_PROJECT_CONTEXT_CHARS);
      await this.runtime.recordEvent({
        taskId: task.id, type: 'tool.requested', actor: task.assignedAgentId,
        payload: { toolId: 'project.context_snapshot', fileCount: projectFiles.length },
      });
      await this.runtime.recordEvent({
        taskId: task.id, type: 'tool.started', actor: task.assignedAgentId,
        payload: { toolId: 'project.context_snapshot' },
      });
      await this.runtime.recordEvent({
        taskId: task.id, type: 'tool.completed', actor: task.assignedAgentId,
        payload: { toolId: 'project.context_snapshot', summary: `Recibidos ${projectFiles.length} archivos seleccionados desde el proyecto local; el contenido no se guarda en el registro.`, evidenceRefs },
        evidenceRefs,
      });
      return { text, evidenceRefs, summary: `Contexto de ${projectFiles.length} archivos seleccionados del proyecto local.` };
    }
    const goalPaths = [...task.goal.matchAll(/(?:[A-Za-z0-9_.-]+[\\/])*[A-Za-z0-9_.-]+\.(?:md|txt|tsx|ts|json|js|py|ino|cpp|h|yaml|yml|ps1)(?![A-Za-z0-9_])/gi)]
      .map((match) => match[0].replace(/\\/g, '/'));
    const referencedPaths = [...task.contextRefs, ...goalPaths]
      .filter((value) => /\.(?:md|txt|tsx|ts|json|js|py|ino|cpp|h|yaml|yml|ps1)$/i.test(value))
      .slice(0, 5);
    const queryWords = task.goal.match(/[\p{L}][\p{L}\p{N}_-]{3,}/gu) ?? [];
    // Lo que la persona escribe entre comillas («medida», "shm/v1") es lo que hay que buscar;
    // si no hay, la primera palabra con contenido.
    const quoted = [...task.goal.matchAll(/["“«']([^"”»'\n]{3,60})["”»']/gu)].map((m) => m[1].trim()).filter(Boolean);
    const query = quoted[0] ?? queryWords.find((word) => !SEARCH_STOP_WORDS.has(word.toLocaleLowerCase()));
    const actions = [
      ...[...new Set(referencedPaths)].map((filePath) => ({ toolId: 'workspace.read_file', args: { path: filePath } })),
      ...(query ? [{ toolId: 'workspace.search', args: { query } }] : []),
    ].slice(0, 2);
    if (!actions.length) return null;

    const evidenceList: ToolEvidence[] = [];
    for (const action of actions) {
      await this.runtime.recordEvent({
        taskId: task.id,
        type: 'tool.requested',
        actor: task.assignedAgentId,
        payload: { toolId: action.toolId, arguments: action.args, source: 'evidence_preflight' },
      });
      await this.runtime.recordEvent({
        taskId: task.id,
        type: 'tool.started',
        actor: task.assignedAgentId,
        payload: { toolId: action.toolId, source: 'evidence_preflight' },
      });
      try {
        const evidence = await this.tools.execute(task.assignedAgentId, action.toolId, action.args);
        await this.runtime.recordEvent({
          taskId: task.id,
          type: 'tool.completed',
          actor: task.assignedAgentId,
          payload: { toolId: action.toolId, summary: evidence.summary, source: 'evidence_preflight' },
          evidenceRefs: evidence.evidenceRefs,
        });
        if (evidence.evidenceRefs.length) evidenceList.push(evidence);
      } catch (error) {
        await this.runtime.recordEvent({
          taskId: task.id,
          type: 'tool.failed',
          actor: task.assignedAgentId,
          payload: {
            toolId: action.toolId,
            error: error instanceof Error ? error.message.slice(0, 1_000) : 'La herramienta falló.',
            source: 'evidence_preflight',
          },
        });
      }
    }
    if (!evidenceList.length) return null;
    return {
      text: evidenceList.map((item) => item.text).join('\n').slice(0, MAX_TOOL_RESULT_CHARS),
      evidenceRefs: evidenceList.flatMap((item) => item.evidenceRefs),
      summary: evidenceList.map((item) => item.summary).join(' '),
    };
  }

  private canCompileProject(task: AgentTask): boolean {
    if (task.assignedAgentId === 'structural_engineer') return false;
    const context = this.projectContexts.get(task.id);
    if (!context || !['arduino-uno', 'esp32-devkit'].includes(context.boardId) || !context.files.length) return false;
    const supported = /\.(?:ino|cpp|c|h|hpp|s)$/i;
    if (context.files.some((file) => !supported.test(file.path))) return false;
    const sketches = context.files.filter((file) => file.path.toLowerCase().endsWith('.ino'));
    return (sketches.length === 1 && !sketches[0].path.includes('/'))
      || (sketches.length === 0 && context.files.some((file) => file.path.split('/').at(-1)?.toLowerCase() === 'main.cpp'));
  }

  async close(): Promise<void> {
    this.stopping = true;
    this.activeController?.abort(new Error('El runtime se está cerrando.'));
    if (this.drainPromise) await this.drainPromise;
  }
}
