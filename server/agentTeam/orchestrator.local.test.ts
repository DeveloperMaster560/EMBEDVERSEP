import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AgentOrchestrator } from './orchestrator.js';
import { AgentRuntime } from './runtime.js';
import { OllamaProvider } from './providers/ollama.js';

const localInferenceTest = process.env.EMBEDVERSE_TEST_OLLAMA === '1' ? it : it.skip;
const resources: { runtime: AgentRuntime; orchestrator: AgentOrchestrator; directory: string }[] = [];

afterEach(async () => {
  await Promise.all(resources.splice(0).map(async ({ runtime, orchestrator, directory }) => {
    await orchestrator.close();
    await runtime.close();
    await rm(directory, { recursive: true, force: true });
  }));
});

describe('local Ollama agent integration', () => {
  localInferenceTest('reads a real repository file through the restricted tool and records its evidence', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'embedverse-agent-local-'));
    const runtime = await AgentRuntime.open(directory);
    const orchestrator = new AgentOrchestrator({
      runtime,
      workspaceRoot: process.cwd(),
      provider: new OllamaProvider(),
    });
    resources.push({ runtime, orchestrator, directory });
    await orchestrator.start();
    expect(orchestrator.status().available, orchestrator.status().reason).toBe(true);
    const task = await runtime.createTask({
      projectId: 'local-agent-smoke',
      goal: 'Debes usar workspace_read_file con la ruta README.md antes de responder. Reporta el primer encabezado Markdown del archivo.',
      assignedAgentId: 'software_engineer',
      expectedResult: 'Primer encabezado de README.md y referencia verificable.',
    });
    orchestrator.enqueue(task.id);
    await orchestrator.waitForIdle();

    expect(runtime.getTask(task.id)?.state, JSON.stringify(runtime.getTask(task.id)?.error)).toBe('COMPLETED');
    const toolEvents = runtime.listEvents({ taskId: task.id }).filter((event) => event.type === 'tool.completed');
    expect(toolEvents.length).toBeGreaterThan(0);
    expect(toolEvents[0].evidenceRefs[0]).toMatch(/^workspace:\/\/README\.md#sha256=/);
    expect(runtime.getTask(task.id)?.result?.summary).toContain('README');
    expect(runtime.getTask(task.id)?.result?.evidenceRefs).toContain(toolEvents[0].evidenceRefs[0]);
  }, 180_000);
});
