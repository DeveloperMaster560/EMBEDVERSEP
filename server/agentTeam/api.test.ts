import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { AgentRuntime } from './runtime.js';
import { createAgentTeamServer } from './api.js';

const resources: { runtime: AgentRuntime; closeServer: () => Promise<void>; directory: string }[] = [];
const allowedOrigin = 'http://127.0.0.1:4173';

async function startRuntime() {
  const directory = await mkdtemp(join(tmpdir(), 'embedverse-agent-api-'));
  const runtime = await AgentRuntime.open(directory);
  const server = createAgentTeamServer(runtime, { allowedOrigins: [allowedOrigin] });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address() as AddressInfo;
  const closeServer = () => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
  const resource = { runtime, closeServer, directory };
  resources.push(resource);
  return { ...resource, baseUrl: `http://127.0.0.1:${address.port}` };
}

afterEach(async () => {
  await Promise.all(resources.splice(0).map(async ({ runtime, closeServer, directory }) => {
    await closeServer();
    await runtime.close();
    await rm(directory, { recursive: true, force: true });
  }));
});

describe('local agent runtime API', () => {
  it('exposes the three registered profiles and records tasks from the local UI origin', async () => {
    const { baseUrl } = await startRuntime();
    const agentsResponse = await fetch(`${baseUrl}/api/agent-team/agents`, {
      headers: { Origin: allowedOrigin },
    });
    expect(agentsResponse.status).toBe(200);
    expect(agentsResponse.headers.get('access-control-allow-origin')).toBe(allowedOrigin);
    const agents = await agentsResponse.json() as {
      agents: { id: string; availability: string }[];
    };
    expect(agents.agents.map(({ id }) => id)).toEqual([
      'structural_engineer', 'software_engineer', 'mechatronics_engineer',
    ]);
    expect(agents.agents.every((agent) => agent.availability === 'WAITING_FOR_PROVIDER')).toBe(true);

    const created = await fetch(`${baseUrl}/api/agent-team/tasks`, {
      method: 'POST',
      headers: { Origin: allowedOrigin, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: 'bridge-demo',
        goal: 'Revisar la ubicación del sensor.',
        assignedAgentId: 'mechatronics_engineer',
        expectedResult: 'Requisitos físicos del dispositivo.',
      }),
    });
    expect(created.status).toBe(201);
    const { task } = await created.json() as { task: { id: string; state: string } };
    expect(task.state).toBe('PENDING');

    const startAttempt = await fetch(`${baseUrl}/api/agent-team/tasks/${task.id}/transition`, {
      method: 'POST',
      headers: { Origin: allowedOrigin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: 'IN_PROGRESS', expectedState: 'PENDING' }),
    });
    expect(startAttempt.status).toBe(400);
    expect((await startAttempt.json() as { error: string }).error).toContain('orquestador');

    const cancelled = await fetch(`${baseUrl}/api/agent-team/tasks/${task.id}/transition`, {
      method: 'POST',
      headers: { Origin: allowedOrigin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: 'CANCELLED', expectedState: 'PENDING', reason: 'Prueba de cancelación.' }),
    });
    expect(cancelled.status).toBe(200);
    expect((await cancelled.json() as { task: { state: string } }).task.state).toBe('CANCELLED');
  });

  it('rejects browser origins outside the configured local UI allowlist', async () => {
    const { baseUrl } = await startRuntime();
    const response = await fetch(`${baseUrl}/api/agent-team/agents`, {
      headers: { Origin: 'https://untrusted.example' },
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'ORIGIN_NOT_ALLOWED' });
  });

  it('rejects malformed agent identifiers and unsupported user transitions', async () => {
    const { baseUrl } = await startRuntime();
    const invalidAgent = await fetch(`${baseUrl}/api/agent-team/tasks`, {
      method: 'POST',
      headers: { Origin: allowedOrigin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: 'p', goal: 'g', assignedAgentId: 'root', expectedResult: 'r' }),
    });
    expect(invalidAgent.status).toBe(400);

    const created = await fetch(`${baseUrl}/api/agent-team/tasks`, {
      method: 'POST',
      headers: { Origin: allowedOrigin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: 'p', goal: 'g', assignedAgentId: 'structural_engineer', expectedResult: 'r' }),
    });
    const { task } = await created.json() as { task: { id: string } };
    const unsupported = await fetch(`${baseUrl}/api/agent-team/tasks/${task.id}/transition`, {
      method: 'POST',
      headers: { Origin: allowedOrigin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: 'COMPLETED', expectedState: 'PENDING' }),
    });
    expect(unsupported.status).toBe(400);
  });

  it('rejects credential material in browser-supplied project context before creating a task', async () => {
    const { baseUrl } = await startRuntime();
    const response = await fetch(`${baseUrl}/api/agent-team/tasks`, {
      method: 'POST',
      headers: { Origin: allowedOrigin, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: 'demo', goal: 'Review selected project files.', assignedAgentId: 'software_engineer',
        expectedResult: 'Safe report.', contextFiles: [{ path: 'src/main.ts', content: 'const api_key = "Abcdefghijklmnopqrstuvwxyz123456";' }],
      }),
    });
    expect(response.status).toBe(400);
    expect((await response.json() as { error: string }).error).toContain('credencial');
    const tasks = await fetch(`${baseUrl}/api/agent-team/tasks`, { headers: { Origin: allowedOrigin } });
    expect((await tasks.json() as { tasks: unknown[] }).tasks).toHaveLength(0);
  });
});
