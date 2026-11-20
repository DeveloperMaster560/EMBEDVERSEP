import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AgentOrchestrator } from './orchestrator.js';
import { AgentRuntime } from './runtime.js';
import type { AgentModelProvider } from './providers/ollama.js';

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('AgentOrchestrator', () => {
  it('runs a bounded tool loop, stores evidence references, and completes the task', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'embedverse-agent-orchestrator-'));
    directories.push(directory);
    const runtime = await AgentRuntime.open(directory);
    let call = 0;
    const provider: AgentModelProvider = {
      name: 'ollama',
      model: 'test-local-model',
      async status() { return { provider: 'ollama', model: this.model, available: true }; },
      async chat() {
        call += 1;
        if (call === 1) return {
          message: {
            role: 'assistant', content: '',
            tool_calls: [{ function: { name: 'workspace.read_file', arguments: { path: 'README.md' } } }],
          },
          promptTokens: 50,
          completionTokens: 10,
        };
        return {
          message: { role: 'assistant', content: 'Hallazgo documentado con referencia workspace://README.md.' },
          promptTokens: 100,
          completionTokens: 30,
        };
      },
    };
    const orchestrator = new AgentOrchestrator({ runtime, workspaceRoot: process.cwd(), provider });
    await orchestrator.start();
    const task = await runtime.createTask({
      projectId: 'demo', goal: 'Inspecciona la guía del repositorio.',
      assignedAgentId: 'software_engineer', expectedResult: 'Resumen basado en evidencia.',
    });
    orchestrator.enqueue(task.id);
    await orchestrator.waitForIdle();

    expect(runtime.getTask(task.id)).toMatchObject({
      state: 'COMPLETED',
      result: { model: 'test-local-model', toolCalls: 2, turns: 2 },
    });
    expect(runtime.getTask(task.id)?.result?.summary).toContain('workspace://README.md');
    expect(runtime.listEvents({ taskId: task.id }).map(({ type }) => type)).toContain('tool.completed');
    expect(runtime.listEvents({ taskId: task.id }).find((event) => (
      event.type === 'tool.completed' && event.payload.toolId === 'workspace.read_file'
    ))?.evidenceRefs[0])
      .toMatch(/^workspace:\/\/README\.md#sha256=/);
    expect(call).toBe(2);
    await orchestrator.close();
    await runtime.close();
  });

  it('moves a task to human review when the local model is unavailable', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'embedverse-agent-orchestrator-'));
    directories.push(directory);
    const runtime = await AgentRuntime.open(directory);
    const provider: AgentModelProvider = {
      name: 'ollama', model: 'missing-model',
      async status() { return { provider: 'ollama', model: this.model, available: false, reason: 'Modelo no instalado.' }; },
      async chat() { throw new Error('No debe invocar chat si falta el modelo.'); },
    };
    const orchestrator = new AgentOrchestrator({ runtime, workspaceRoot: process.cwd(), provider });
    await orchestrator.start();
    const task = await runtime.createTask({
      projectId: 'demo', goal: 'Revisar el circuito.',
      assignedAgentId: 'mechatronics_engineer', expectedResult: 'Informe técnico.',
    });
    orchestrator.enqueue(task.id);
    await orchestrator.waitForIdle();
    expect(runtime.getTask(task.id)).toMatchObject({
      state: 'WAITING_FOR_HUMAN',
      error: { code: 'AGENT_EXECUTION_FAILED', message: 'Modelo no instalado.' },
    });
    await orchestrator.close();
    await runtime.close();
  });

  it('records exact project edits for approval without changing the selected source', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'embedverse-agent-orchestrator-'));
    directories.push(directory);
    const runtime = await AgentRuntime.open(directory);
    const provider: AgentModelProvider = {
      name: 'ollama', model: 'test-local-model',
      async status() { return { provider: 'ollama', model: this.model, available: true }; },
      async chat() {
        return { message: { role: 'assistant', content: '', tool_calls: [{ function: { name: 'project_propose_exact_edit', arguments: { path: 'src/main.ts', summary: 'Corrige valor.', searchText: 'const value = 1;', replaceText: 'const value = 2;' } } }] }, promptTokens: 20, completionTokens: 12 };
      },
    };
    const orchestrator = new AgentOrchestrator({ runtime, workspaceRoot: process.cwd(), provider });
    await orchestrator.start();
    const task = await runtime.createTask({ projectId: 'patch-demo', goal: 'Corrige el valor en el archivo.', assignedAgentId: 'software_engineer', expectedResult: 'Propuesta revisable.' });
    const source = 'const value = 1;\n';
    orchestrator.attachProjectContext(task.id, [{ path: 'src/main.ts', content: source }]);
    orchestrator.enqueue(task.id);
    await orchestrator.waitForIdle();
    const proposal = runtime.listPatchProposals({ taskId: task.id })[0];
    expect(runtime.getTask(task.id)?.state).toBe('WAITING_FOR_HUMAN');
    expect(proposal).toMatchObject({ path: 'src/main.ts', searchText: 'const value = 1;', replaceText: 'const value = 2;', state: 'PENDING_APPROVAL' });
    expect(source).toBe('const value = 1;\n');
    expect(runtime.listEvents({ taskId: task.id }).map(({ type }) => type)).toContain('approval.requested');
    await orchestrator.close();
    await runtime.close();
  });

  it('delegates to a specialist, records the reply, and resumes the parent task', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'embedverse-agent-orchestrator-'));
    directories.push(directory);
    const runtime = await AgentRuntime.open(directory);
    let call = 0;
    const provider: AgentModelProvider = {
      name: 'ollama', model: 'test-local-model',
      async status() { return { provider: 'ollama', model: this.model, available: true }; },
      async chat() {
        call += 1;
        if (call === 1) return {
          message: { role: 'assistant', content: '', tool_calls: [{ function: { name: 'team_delegate_task', arguments: {
            agentId: 'structural_engineer', goal: 'Inspect README.md for the bridge model limitations.',
            expectedResult: 'Report the documented limitations.',
          } } }] },
          promptTokens: 30, completionTokens: 10,
        };
        return {
          message: { role: 'assistant', content: call === 2 ? 'README evidence reviewed: workspace://README.md.' : 'Combined result from the structural specialist.' },
          promptTokens: 40, completionTokens: 15,
        };
      },
    };
    const orchestrator = new AgentOrchestrator({ runtime, workspaceRoot: process.cwd(), provider });
    await orchestrator.start();
    const parent = await runtime.createTask({
      projectId: 'demo', goal: 'Review the bridge approach and ask structural engineering for limitations.',
      assignedAgentId: 'software_engineer', expectedResult: 'A combined report.', requiresEvidence: false,
    });
    orchestrator.enqueue(parent.id);
    await orchestrator.waitForIdle();

    const child = runtime.listTasks().find((task) => task.parentTaskId === parent.id);
    expect(child).toMatchObject({ assignedAgentId: 'structural_engineer', state: 'COMPLETED' });
    expect(runtime.getTask(parent.id)).toMatchObject({ state: 'COMPLETED', result: { summary: 'Combined result from the structural specialist.' } });
    expect(runtime.listMessages({ taskId: parent.id }).map(({ requestType, state }) => [requestType, state])).toEqual([
      ['delegation.request', 'COMPLETED'], ['delegation.response', 'COMPLETED'],
    ]);
    expect(runtime.listEvents({ taskId: parent.id }).some((event) => event.type === 'task.state_changed'
      && event.payload.to === 'WAITING_FOR_AGENT')).toBe(true);
    expect(call).toBe(3);
    await orchestrator.close();
    await runtime.close();
  });

  it('uses selected project context as evidence without writing file contents to the event log', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'embedverse-agent-orchestrator-'));
    directories.push(directory);
    const runtime = await AgentRuntime.open(directory);
    let sawProjectContent = false;
    const provider: AgentModelProvider = {
      name: 'ollama', model: 'test-local-model',
      async status() { return { provider: 'ollama', model: this.model, available: true }; },
      async chat({ messages }) {
        sawProjectContent = messages.some((message) => message.content.includes('SENSOR_SAMPLE_RATE = 100'));
        return { message: { role: 'assistant', content: 'The selected project uses a 100 Hz sample rate (project://demo/firmware/sensor.ts).' }, promptTokens: 20, completionTokens: 10 };
      },
    };
    const orchestrator = new AgentOrchestrator({ runtime, workspaceRoot: process.cwd(), provider });
    await orchestrator.start();
    const task = await runtime.createTask({
      projectId: 'demo', goal: 'Inspect the selected sensor configuration.',
      assignedAgentId: 'software_engineer', expectedResult: 'Summarize the configured sample rate.',
    });
    orchestrator.attachProjectContext(task.id, [{ path: 'firmware/sensor.ts', content: 'const SENSOR_SAMPLE_RATE = 100;' }]);
    orchestrator.enqueue(task.id);
    await orchestrator.waitForIdle();

    expect(sawProjectContent).toBe(true);
    expect(runtime.getTask(task.id)?.state).toBe('COMPLETED');
    expect(runtime.getTask(task.id)?.result?.evidenceRefs).toEqual([
      expect.stringMatching(/^project:\/\/demo\/firmware\/sensor\.ts#sha256=[a-f0-9]{64}$/),
    ]);
    const persistedEvents = JSON.stringify(runtime.listEvents({ taskId: task.id }));
    expect(persistedEvents).not.toContain('SENSOR_SAMPLE_RATE = 100');
    expect(persistedEvents).toContain('project.context_snapshot');
    await orchestrator.close();
    await runtime.close();
  });

  it('offers the existing firmware compiler for selected Arduino sources and records its result', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'embedverse-agent-orchestrator-'));
    directories.push(directory);
    const runtime = await AgentRuntime.open(directory);
    let compileCall: { boardId: string; files: { path: string; content: string }[] } | undefined;
    let responseCount = 0;
    const provider: AgentModelProvider = {
      name: 'ollama', model: 'test-local-model',
      async status() { return { provider: 'ollama', model: this.model, available: true }; },
      async chat({ tools }) {
        responseCount += 1;
        if (responseCount === 1) {
          expect(tools.map((tool) => tool.function.name)).toContain('firmware_compile_selected');
          return { message: { role: 'assistant', content: '', tool_calls: [{ function: { name: 'firmware_compile_selected', arguments: {} } }] }, promptTokens: 20, completionTokens: 5 };
        }
        return { message: { role: 'assistant', content: 'Compilación confirmada con evidencia (project://demo/main.ino).' }, promptTokens: 30, completionTokens: 10 };
      },
    };
    const orchestrator = new AgentOrchestrator({
      runtime, workspaceRoot: process.cwd(), provider,
      firmwareCompiler: {
        async compile(boardId, files) {
          compileCall = { boardId, files };
          return { text: '{"success":true,"board":"Arduino Uno R3"}', summary: 'Compilación satisfactoria para Arduino Uno R3.', evidenceRefs: ['firmware://compile/arduino-uno#sha256=abc'] };
        },
      },
    });
    await orchestrator.start();
    const task = await runtime.createTask({
      projectId: 'demo', goal: 'Compile selected firmware and report errors.',
      assignedAgentId: 'mechatronics_engineer', expectedResult: 'Compiler result and diagnostics.',
    });
    const files = [{ path: 'main.ino', content: 'void setup() {}\nvoid loop() {}' }];
    orchestrator.attachProjectContext(task.id, files, 'arduino-uno');
    orchestrator.enqueue(task.id);
    await orchestrator.waitForIdle();

    expect(compileCall).toEqual({ boardId: 'arduino-uno', files });
    expect(runtime.getTask(task.id)?.state).toBe('COMPLETED');
    expect(runtime.getTask(task.id)?.result?.evidenceRefs).toContain('firmware://compile/arduino-uno#sha256=abc');
    expect(runtime.listEvents({ taskId: task.id }).some((event) => event.type === 'tool.completed' && event.payload.toolId === 'firmware_compile_selected')).toBe(true);
    await orchestrator.close();
    await runtime.close();
  });
});
