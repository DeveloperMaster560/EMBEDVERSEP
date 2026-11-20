import { randomUUID } from 'node:crypto';
import type {
  AgentEvent,
  AgentMessage,
  AgentPatchProposal,
  AgentPatchState,
  AgentId,
  AgentTask,
  CreateTaskInput,
  TaskState,
} from '../../src/agent-team/contracts.js';
import { getAgentDefinition } from '../../src/agent-team/registry.js';
import { enforceBudget } from '../../src/agent-team/policy.js';
import { assertTaskTransition } from '../../src/agent-team/task-state.js';
import { AgentEventStore, type AgentEventDraft } from './eventStore.js';

const MAX_TEXT_LENGTH = 8_000;
const MAX_CONTEXT_REFS = 100;

function isPatchState(value: unknown): value is AgentPatchState {
  return value === 'PENDING_APPROVAL' || value === 'APPROVED' || value === 'REJECTED'
    || value === 'APPLIED' || value === 'STALE' || value === 'CANCELLED';
}

export class AgentInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AgentInputError';
  }
}

export class AgentConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AgentConflictError';
  }
}

export class AgentNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AgentNotFoundError';
  }
}

function boundedText(value: string, label: string, maxLength = MAX_TEXT_LENGTH): string {
  const result = value.trim();
  if (!result || result.length > maxLength) {
    throw new AgentInputError(`${label} debe tener entre 1 y ${maxLength} caracteres.`);
  }
  return result;
}

function boundedExactText(value: string, label: string, maxLength: number, allowEmpty = false): string {
  if ((!allowEmpty && !value.length) || value.length > maxLength) {
    throw new AgentInputError(`${label} debe tener ${allowEmpty ? 'como máximo' : 'entre 1 y'} ${maxLength} caracteres.`);
  }
  return value;
}

function validDate(value: string, label: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new AgentInputError(`${label} no es una fecha válida.`);
  return date.toISOString();
}

function readTask(value: unknown): AgentTask {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('El evento contiene una tarea inválida.');
  }
  const task = value as Omit<AgentTask, 'schemaVersion' | 'requiresEvidence'> & {
    schemaVersion: 1 | 2;
    requiresEvidence?: boolean;
  };
  if ((task.schemaVersion !== 1 && task.schemaVersion !== 2)
    || typeof task.id !== 'string' || typeof task.projectId !== 'string') {
    throw new Error('El evento contiene una tarea con versión o identidad inválida.');
  }
  return {
    ...structuredClone(task),
    schemaVersion: 2,
    requiresEvidence: task.requiresEvidence ?? true,
  };
}

export interface TransitionTaskOptions {
  actor?: AgentId | 'human' | 'system';
  reason?: string;
  expectedState?: TaskState;
  result?: Record<string, unknown>;
  error?: { code: string; message: string };
}

/** Núcleo de tareas y proyección reconstruible desde el registro append-only. */
export class AgentRuntime {
  private readonly tasks = new Map<string, AgentTask>();
  private readonly patchProposals = new Map<string, AgentPatchProposal>();
  private readonly store: AgentEventStore;

  private constructor(store: AgentEventStore) {
    this.store = store;
    this.replay();
  }

  static async open(dataDirectory: string): Promise<AgentRuntime> {
    return new AgentRuntime(await AgentEventStore.open(dataDirectory));
  }

  private replay(): void {
    for (const event of this.store.list()) {
      if (event.type === 'task.created') {
        const task = readTask(event.payload.task);
        if (this.tasks.has(task.id)) throw new Error(`La tarea ${task.id} aparece duplicada en el registro.`);
        this.tasks.set(task.id, task);
      } else if (event.type === 'task.state_changed') {
        const task = this.tasks.get(event.taskId);
        const from = event.payload.from;
        const to = event.payload.to;
        if (!task || task.state !== from || typeof to !== 'string') {
          throw new Error(`Transición inconsistente en el evento ${event.sequence}.`);
        }
        assertTaskTransition(task.state, to as TaskState);
        task.state = to as TaskState;
        task.updatedAt = event.timestamp;
        if (typeof event.payload.result === 'object' && event.payload.result !== null && !Array.isArray(event.payload.result)) {
          task.result = structuredClone(event.payload.result as Record<string, unknown>);
        }
        if (to === 'IN_PROGRESS') delete task.error;
        if (typeof event.payload.error === 'object' && event.payload.error !== null && !Array.isArray(event.payload.error)) {
          task.error = structuredClone(event.payload.error as { code: string; message: string });
        }
      } else if (event.type === 'approval.requested') {
        const task = this.tasks.get(event.taskId);
        if (task && typeof event.payload.approvalId === 'string' && !task.approvalIds.includes(event.payload.approvalId)) {
          task.approvalIds.push(event.payload.approvalId);
        }
      } else if (event.type === 'patch.proposed') {
        const proposal = event.payload.proposal;
        if (typeof proposal === 'object' && proposal !== null && !Array.isArray(proposal)) {
          const value = structuredClone(proposal as AgentPatchProposal);
          this.patchProposals.set(value.id, value);
        }
      } else if (event.type === 'patch.state_changed' && typeof event.payload.proposalId === 'string') {
        const proposal = this.patchProposals.get(event.payload.proposalId);
        if (proposal && isPatchState(event.payload.state)) {
          proposal.state = event.payload.state;
          proposal.updatedAt = event.timestamp;
          if (typeof event.payload.reason === 'string') proposal.decisionReason = event.payload.reason;
          if (typeof event.payload.appliedSha256 === 'string') proposal.appliedSha256 = event.payload.appliedSha256;
        }
      }
    }
  }

  private append(event: Omit<AgentEventDraft, 'timestamp'>): Promise<AgentEvent> {
    return this.store.append({ ...event, timestamp: new Date().toISOString() });
  }

  async createTask(input: CreateTaskInput): Promise<AgentTask> {
    const projectId = boundedText(input.projectId, 'El identificador del proyecto', 120);
    const goal = boundedText(input.goal, 'El objetivo');
    const expectedResult = boundedText(input.expectedResult, 'El resultado esperado');
    const agent = getAgentDefinition(input.assignedAgentId);
    if (!agent) throw new AgentInputError(`No existe el agente ${input.assignedAgentId}.`);
    if (input.requestedBy && input.requestedBy !== 'human' && !getAgentDefinition(input.requestedBy)) {
      throw new AgentInputError(`No existe el agente solicitante ${input.requestedBy}.`);
    }
    if (input.contextRefs && input.contextRefs.length > MAX_CONTEXT_REFS) {
      throw new AgentInputError(`Una tarea admite como máximo ${MAX_CONTEXT_REFS} referencias de contexto.`);
    }
    if (input.parentTaskId) {
      const parent = this.tasks.get(input.parentTaskId);
      if (!parent) throw new AgentInputError('La tarea padre indicada no existe.');
      if (parent.projectId !== projectId) throw new AgentInputError('La subtarea debe pertenecer al mismo proyecto que su tarea padre.');
      if (parent.state !== 'IN_PROGRESS') throw new AgentConflictError('Solo se puede delegar desde una tarea en ejecución.');
      if (input.requestedBy !== parent.assignedAgentId) throw new AgentInputError('El agente solicitante debe coincidir con el responsable de la tarea padre.');
    }
    const now = new Date();
    const deadlineAt = input.deadlineAt
      ? validDate(input.deadlineAt, 'La fecha límite')
      : new Date(now.getTime() + agent.budget.maxDurationMs).toISOString();
    if (new Date(deadlineAt).getTime() <= now.getTime()) throw new AgentInputError('La fecha límite debe estar en el futuro.');
    let budget;
    try {
      budget = enforceBudget({ ...agent.budget, ...input.budget });
    } catch (error) {
      throw new AgentInputError(error instanceof Error ? error.message : 'El presupuesto de tarea no es válido.');
    }
    const task: AgentTask = {
      schemaVersion: 2,
      id: randomUUID(),
      projectId,
      goal,
      requestedBy: input.requestedBy ?? 'human',
      assignedAgentId: input.assignedAgentId,
      state: 'PENDING',
      priority: input.priority ?? 'NORMAL',
      contextRefs: [...(input.contextRefs ?? [])],
      expectedResult,
      requiresEvidence: input.requiresEvidence ?? true,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      deadlineAt,
      budget,
      attempt: 0,
      ...(input.parentTaskId ? { parentTaskId: input.parentTaskId } : {}),
      ...(input.cycleKey ? { cycleKey: boundedText(input.cycleKey, 'La clave de ciclo', 240) } : {}),
      approvalIds: [],
    };
    await this.append({
      projectId,
      taskId: task.id,
      type: 'task.created',
      actor: task.requestedBy,
      payload: { task },
      correlationId: task.id,
    });
    this.tasks.set(task.id, task);
    return structuredClone(task);
  }

  async transitionTask(
    taskId: string,
    to: TaskState,
    options: TransitionTaskOptions = {},
  ): Promise<AgentTask> {
    const task = this.tasks.get(taskId);
    if (!task) throw new AgentNotFoundError(`No existe la tarea ${taskId}.`);
    if (options.expectedState && options.expectedState !== task.state) {
      throw new AgentConflictError(`La tarea cambió: se esperaba ${options.expectedState} y ahora está ${task.state}.`);
    }
    try {
      assertTaskTransition(task.state, to);
    } catch (error) {
      throw new AgentConflictError(error instanceof Error ? error.message : 'Transición de tarea no permitida.');
    }
    const from = task.state;
    const reason = options.reason ? boundedText(options.reason, 'El motivo', 1_000) : undefined;
    const result = options.result ? structuredClone(options.result) : undefined;
    const error = options.error ? {
      code: boundedText(options.error.code, 'El código de error', 120),
      message: boundedText(options.error.message, 'El error', 2_000),
    } : undefined;
    const event = await this.append({
      projectId: task.projectId,
      taskId,
      type: 'task.state_changed',
      actor: options.actor ?? 'system',
      payload: {
        from,
        to,
        ...(reason ? { reason } : {}),
        ...(result ? { result } : {}),
        ...(error ? { error } : {}),
      },
      correlationId: task.id,
    });
    const updated = {
      ...task,
      state: to,
      updatedAt: event.timestamp,
      ...(result ? { result } : {}),
      ...(error ? { error } : {}),
    };
    if (to === 'IN_PROGRESS') delete updated.error;
    this.tasks.set(taskId, updated);
    return structuredClone(updated);
  }

  getTask(taskId: string): AgentTask | undefined {
    const task = this.tasks.get(taskId);
    return task ? structuredClone(task) : undefined;
  }

  listTasks(projectId?: string): AgentTask[] {
    return [...this.tasks.values()]
      .filter((task) => !projectId || task.projectId === projectId)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .map((task) => structuredClone(task));
  }

  listEvents(options: { afterSequence?: number; projectId?: string; taskId?: string } = {}): AgentEvent[] {
    return this.store.list(options);
  }

  listMessages(options: { projectId?: string; taskId?: string } = {}): AgentMessage[] {
    const messages = new Map<string, AgentMessage>();
    for (const event of this.store.list(options)) {
      if (event.type === 'agent.message_sent') {
        const value = event.payload.message;
        if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
          const message = structuredClone(value as AgentMessage);
          messages.set(message.id, message);
        }
      } else if (event.type === 'agent.message_updated'
        && typeof event.payload.messageId === 'string'
        && (event.payload.state === 'IN_PROGRESS' || event.payload.state === 'COMPLETED'
          || event.payload.state === 'FAILED' || event.payload.state === 'CANCELLED')) {
        const message = messages.get(event.payload.messageId);
        if (message) message.state = event.payload.state;
      }
    }
    return [...messages.values()].map((message) => structuredClone(message));
  }

  async recordMessage(input: Omit<AgentMessage, 'schemaVersion' | 'id' | 'createdAt' | 'state'>): Promise<AgentMessage> {
    const parentTask = this.tasks.get(input.taskId);
    if (!parentTask) throw new AgentNotFoundError(`No existe la tarea ${input.taskId}.`);
    if (parentTask.projectId !== input.projectId) throw new AgentInputError('El mensaje debe pertenecer al proyecto de la tarea.');
    const message: AgentMessage = {
      ...structuredClone(input),
      schemaVersion: 1,
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      state: 'PENDING',
    };
    await this.append({
      projectId: message.projectId,
      taskId: message.taskId,
      type: 'agent.message_sent',
      actor: message.senderAgentId,
      payload: { message },
      correlationId: message.correlationId,
    });
    return structuredClone(message);
  }

  async updateMessageState(messageId: string, state: AgentMessage['state'], taskId: string, actor: AgentId | 'human' | 'system'): Promise<void> {
    const message = this.listMessages({ taskId }).find((item) => item.id === messageId);
    if (!message) throw new AgentNotFoundError(`No existe el mensaje ${messageId}.`);
    await this.append({
      projectId: message.projectId,
      taskId: message.taskId,
      type: 'agent.message_updated',
      actor,
      payload: { messageId, state },
      correlationId: message.correlationId,
    });
  }

  listPatchProposals(options: { projectId?: string; taskId?: string } = {}): AgentPatchProposal[] {
    return [...this.patchProposals.values()]
      .filter((proposal) => (!options.projectId || proposal.projectId === options.projectId)
        && (!options.taskId || proposal.taskId === options.taskId))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .map((proposal) => structuredClone(proposal));
  }

  getPatchProposal(proposalId: string): AgentPatchProposal | undefined {
    const proposal = this.patchProposals.get(proposalId);
    return proposal ? structuredClone(proposal) : undefined;
  }

  async recordPatchProposal(input: {
    taskId: string;
    agentId: AgentId;
    path: string;
    summary: string;
    searchText: string;
    replaceText: string;
    originalSha256: string;
    proposedSha256: string;
  }): Promise<AgentPatchProposal> {
    const task = this.tasks.get(input.taskId);
    if (!task) throw new AgentNotFoundError(`No existe la tarea ${input.taskId}.`);
    if (task.state !== 'IN_PROGRESS') throw new AgentConflictError('Solo se puede proponer un cambio durante una tarea en ejecución.');
    if (task.assignedAgentId !== input.agentId) throw new AgentInputError('Solo el agente responsable puede proponer el cambio.');
    const pathValue = boundedText(input.path, 'La ruta del archivo', 240).replace(/\\/g, '/');
    if (pathValue.startsWith('/') || pathValue.split('/').some((part) => !part || part === '.' || part === '..')) {
      throw new AgentInputError('La ruta propuesta debe ser relativa al proyecto.');
    }
    if (!/^[a-f0-9]{64}$/i.test(input.originalSha256) || !/^[a-f0-9]{64}$/i.test(input.proposedSha256)) {
      throw new AgentInputError('La propuesta debe incluir huellas SHA-256 válidas.');
    }
    const now = new Date().toISOString();
    const proposal: AgentPatchProposal = {
      schemaVersion: 1,
      id: randomUUID(),
      projectId: task.projectId,
      taskId: task.id,
      agentId: input.agentId,
      path: pathValue,
      summary: boundedText(input.summary, 'El resumen', 500),
      searchText: boundedExactText(input.searchText, 'El texto original', 1_000),
      replaceText: boundedExactText(input.replaceText, 'El texto propuesto', 2_500, true),
      originalSha256: input.originalSha256.toLowerCase(),
      proposedSha256: input.proposedSha256.toLowerCase(),
      state: 'PENDING_APPROVAL',
      createdAt: now,
      updatedAt: now,
    };
    await this.append({
      projectId: proposal.projectId, taskId: task.id, type: 'patch.proposed', actor: proposal.agentId,
      payload: { proposal }, evidenceRefs: [`project://${proposal.projectId}/${pathValue}#sha256=${proposal.originalSha256}`],
      correlationId: task.id,
    });
    this.patchProposals.set(proposal.id, proposal);
    await this.append({
      projectId: proposal.projectId, taskId: task.id, type: 'approval.requested', actor: proposal.agentId,
      payload: {
        approvalId: proposal.id, operation: 'project.exact_replacement', path: proposal.path,
        originalSha256: proposal.originalSha256, proposedSha256: proposal.proposedSha256,
      }, correlationId: task.id,
    });
    task.approvalIds.push(proposal.id);
    return structuredClone(proposal);
  }

  async decidePatchProposal(
    proposalId: string,
    state: AgentPatchState,
    actor: 'human' | 'system',
    options: { reason?: string; appliedSha256?: string } = {},
  ): Promise<AgentPatchProposal> {
    const proposal = this.patchProposals.get(proposalId);
    if (!proposal) throw new AgentNotFoundError(`No existe la propuesta ${proposalId}.`);
    const valid = proposal.state === 'PENDING_APPROVAL'
      ? ['APPROVED', 'REJECTED', 'STALE', 'CANCELLED'].includes(state)
      : proposal.state === 'APPROVED' && ['APPLIED', 'STALE', 'CANCELLED'].includes(state);
    if (!valid) throw new AgentConflictError(`No se puede cambiar una propuesta de ${proposal.state} a ${state}.`);
    const reason = options.reason ? boundedText(options.reason, 'El motivo de decisión', 1_000) : undefined;
    if (state === 'APPLIED' && options.appliedSha256?.toLowerCase() !== proposal.proposedSha256) {
      throw new AgentInputError('La huella aplicada no coincide con el contenido aprobado.');
    }
    await this.append({
      projectId: proposal.projectId, taskId: proposal.taskId, type: 'patch.state_changed', actor,
      payload: {
        proposalId, state, ...(reason ? { reason } : {}),
        ...(options.appliedSha256 ? { appliedSha256: options.appliedSha256.toLowerCase() } : {}),
      }, correlationId: proposal.taskId,
    });
    proposal.state = state;
    proposal.updatedAt = new Date().toISOString();
    if (reason) proposal.decisionReason = reason;
    if (options.appliedSha256) proposal.appliedSha256 = options.appliedSha256.toLowerCase();
    if (state === 'APPROVED' || state === 'REJECTED') {
      await this.append({
        projectId: proposal.projectId, taskId: proposal.taskId, type: 'approval.decided', actor,
        payload: { approvalId: proposal.id, decision: state, ...(reason ? { reason } : {}) },
        correlationId: proposal.taskId,
      });
    }
    return structuredClone(proposal);
  }

  async recordEvent(input: {
    taskId: string;
    type: AgentEventDraft['type'];
    actor: AgentEventDraft['actor'];
    payload: Record<string, unknown>;
    evidenceRefs?: string[];
  }): Promise<AgentEvent> {
    const task = this.tasks.get(input.taskId);
    if (!task) throw new AgentNotFoundError(`No existe la tarea ${input.taskId}.`);
    return this.append({
      projectId: task.projectId,
      taskId: task.id,
      type: input.type,
      actor: input.actor,
      payload: input.payload,
      evidenceRefs: input.evidenceRefs,
      correlationId: task.id,
    });
  }

  close(): Promise<void> {
    return this.store.close();
  }
}
