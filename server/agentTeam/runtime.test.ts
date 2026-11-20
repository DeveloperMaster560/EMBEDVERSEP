import { appendFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { enforceBudget } from '../../src/agent-team/policy.js';
import { AgentEventStore, EventLogCorruptionError, RuntimeLockedError } from './eventStore.js';
import { AgentRuntime } from './runtime.js';

const directories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'embedverse-agent-team-'));
  directories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('AgentRuntime', () => {
  it('persists tasks and recovers their latest state from the event log', async () => {
    const directory = await temporaryDirectory();
    const runtime = await AgentRuntime.open(directory);
    const task = await runtime.createTask({
      projectId: 'bridge-demo',
      goal: 'Revisar ubicación del acelerómetro.',
      assignedAgentId: 'mechatronics_engineer',
      expectedResult: 'Informe de ubicación y requisitos físicos.',
      contextRefs: ['project:bridge-demo', 'circuit:main'],
    });
    await runtime.transitionTask(task.id, 'IN_PROGRESS', { expectedState: 'PENDING' });
    await runtime.transitionTask(task.id, 'WAITING_FOR_AGENT', { reason: 'Falta confirmar espacio de montaje.' });
    await runtime.close();

    const recovered = await AgentRuntime.open(directory);
    expect(recovered.getTask(task.id)?.state).toBe('WAITING_FOR_AGENT');
    expect(recovered.listEvents({ taskId: task.id }).map((event) => event.type)).toEqual([
      'task.created', 'task.state_changed', 'task.state_changed',
    ]);
    await recovered.close();
  });

  it('rejects illegal transitions, stale expected states, and budget escalation', async () => {
    const runtime = await AgentRuntime.open(await temporaryDirectory());
    const task = await runtime.createTask({
      projectId: 'bridge-demo',
      goal: 'Inspeccionar un circuito.',
      assignedAgentId: 'mechatronics_engineer',
      expectedResult: 'Hallazgos con evidencia.',
    });
    await expect(runtime.transitionTask(task.id, 'COMPLETED')).rejects.toThrow('Transición de tarea no permitida');
    await expect(runtime.transitionTask(task.id, 'IN_PROGRESS', { expectedState: 'FAILED' })).rejects.toThrow('La tarea cambió');
    await expect(runtime.createTask({
      projectId: 'bridge-demo', goal: 'Escalar presupuesto.', assignedAgentId: 'software_engineer',
      expectedResult: 'No debe exceder la política.', budget: { maxToolCalls: 21 },
    })).rejects.toThrow('supera el máximo permitido');
    await expect(Promise.resolve().then(() => enforceBudget({ maxRetries: -1 }))).rejects.toThrow('entero igual o mayor que 0');
    expect(enforceBudget({ maxRetries: 0 }).maxRetries).toBe(0);
    await runtime.close();
  });

  it('persists append-only agent messages and their state changes', async () => {
    const directory = await temporaryDirectory();
    const runtime = await AgentRuntime.open(directory);
    const task = await runtime.createTask({
      projectId: 'bridge-demo', goal: 'Coordinate a specialist review.',
      assignedAgentId: 'software_engineer', expectedResult: 'Combined report.',
    });
    const message = await runtime.recordMessage({
      projectId: task.projectId, taskId: task.id, senderAgentId: 'software_engineer',
      recipientAgentId: 'structural_engineer', requestType: 'delegation.request',
      description: 'Review the bridge model.', expectedResult: 'List limitations.',
      technicalContext: { childTaskId: 'child' }, resourceRefs: [], priority: 'NORMAL', correlationId: task.id,
    });
    await runtime.updateMessageState(message.id, 'IN_PROGRESS', task.id, 'software_engineer');
    await runtime.updateMessageState(message.id, 'COMPLETED', task.id, 'structural_engineer');
    await runtime.close();

    const recovered = await AgentRuntime.open(directory);
    expect(recovered.listMessages({ taskId: task.id })).toMatchObject([{ id: message.id, state: 'COMPLETED' }]);
    expect(recovered.listEvents({ taskId: task.id }).map(({ type }) => type)).toContain('agent.message_updated');
    await recovered.close();
  });

  it('persists patch proposals and enforces human approval before marking them applied', async () => {
    const directory = await temporaryDirectory();
    const runtime = await AgentRuntime.open(directory);
    const task = await runtime.createTask({ projectId: 'patch-demo', goal: 'Proponer un cambio.', assignedAgentId: 'software_engineer', expectedResult: 'Propuesta exacta.' });
    await runtime.transitionTask(task.id, 'IN_PROGRESS', { expectedState: 'PENDING' });
    const proposal = await runtime.recordPatchProposal({
      taskId: task.id, agentId: 'software_engineer', path: 'src/main.ts', summary: 'Ajusta el valor.',
      searchText: 'const value = 1;', replaceText: 'const value = 2;', originalSha256: 'a'.repeat(64), proposedSha256: 'b'.repeat(64),
    });
    expect(proposal.state).toBe('PENDING_APPROVAL');
    await expect(runtime.decidePatchProposal(proposal.id, 'APPLIED', 'human', { appliedSha256: 'b'.repeat(64) })).rejects.toThrow('No se puede cambiar');
    await runtime.decidePatchProposal(proposal.id, 'APPROVED', 'human');
    await runtime.decidePatchProposal(proposal.id, 'APPLIED', 'human', { appliedSha256: 'b'.repeat(64) });
    await runtime.close();
    const recovered = await AgentRuntime.open(directory);
    expect(recovered.getPatchProposal(proposal.id)).toMatchObject({ state: 'APPLIED', appliedSha256: 'b'.repeat(64) });
    expect(recovered.listEvents({ taskId: task.id }).map(({ type }) => type)).toContain('approval.decided');
    await recovered.close();
  });

  it('allows only one runtime writer per data directory', async () => {
    const directory = await temporaryDirectory();
    const runtime = await AgentRuntime.open(directory);
    await expect(AgentEventStore.open(directory)).rejects.toBeInstanceOf(RuntimeLockedError);
    await runtime.close();
    const next = await AgentRuntime.open(directory);
    await next.close();
  });

  it('detects a modified event and preserves the original log for recovery', async () => {
    const directory = await temporaryDirectory();
    const runtime = await AgentRuntime.open(directory);
    await runtime.createTask({
      projectId: 'bridge-demo', goal: 'Crear evento auditable.', assignedAgentId: 'structural_engineer',
      expectedResult: 'Evento persistido.',
    });
    await runtime.close();
    const eventPath = join(directory, 'events.jsonl');
    const before = await readFile(eventPath, 'utf8');
    const event = JSON.parse(before) as { payload: { task: { goal: string } } };
    event.payload.task.goal = 'contenido alterado';
    await writeFile(eventPath, `${JSON.stringify(event)}\n`, 'utf8');
    const tampered = await readFile(eventPath, 'utf8');

    await expect(AgentRuntime.open(directory)).rejects.toBeInstanceOf(EventLogCorruptionError);
    expect(await readFile(eventPath, 'utf8')).toBe(tampered);
  });

  it('refuses an incomplete final record instead of truncating it', async () => {
    const directory = await temporaryDirectory();
    const store = await AgentEventStore.open(directory);
    await store.close();
    const eventPath = join(directory, 'events.jsonl');
    await appendFile(eventPath, '{partial');
    const before = await readFile(eventPath, 'utf8');

    await expect(AgentEventStore.open(directory)).rejects.toBeInstanceOf(EventLogCorruptionError);
    expect(await readFile(eventPath, 'utf8')).toBe(before);
  });

  it('rejects credential-like task content before it reaches the disk log', async () => {
    const directory = await temporaryDirectory();
    const runtime = await AgentRuntime.open(directory);
    await expect(runtime.createTask({
      projectId: 'bridge-demo',
      goal: 'Use api_key=Abcdefghijklmnop12345678 for the provider.',
      assignedAgentId: 'software_engineer',
      expectedResult: 'Informe de diagnóstico.',
    })).rejects.toThrow('parece incluir una clave o credencial');
    await runtime.close();
    expect(await readFile(join(directory, 'events.jsonl'), 'utf8')).toBe('');
  });
});
