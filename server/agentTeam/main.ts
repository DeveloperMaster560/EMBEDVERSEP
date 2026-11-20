import { createAgentTeamServer, AGENT_RUNTIME_HOST } from './api.js';
import { defaultAgentDataDirectory } from './localDataDirectory.js';
import { AgentOrchestrator } from './orchestrator.js';
import { AgentRuntime } from './runtime.js';

const port = Number(process.env.EMBEDVERSE_AGENT_PORT ?? '5175');
if (!Number.isInteger(port) || port < 1024 || port > 65535) {
  throw new Error('EMBEDVERSE_AGENT_PORT debe ser un puerto entre 1024 y 65535.');
}

const runtime = await AgentRuntime.open(defaultAgentDataDirectory());
const orchestrator = new AgentOrchestrator({ runtime, workspaceRoot: process.cwd() });
await orchestrator.start();
const server = createAgentTeamServer(runtime, { orchestrator });
server.listen(port, AGENT_RUNTIME_HOST, () => {
  console.log(`EMBEVERSE Agent Runtime disponible en http://${AGENT_RUNTIME_HOST}:${port}`);
  console.log(`Datos locales: ${defaultAgentDataDirectory()}`);
  console.log(`Proveedor local: Ollama · ${orchestrator.status().model} · ${orchestrator.status().available ? 'disponible' : 'esperando configuración'}`);
});

let closing = false;
async function shutdown(): Promise<void> {
  if (closing) return;
  closing = true;
  if (server.listening) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  await orchestrator.close();
  await runtime.close();
}

server.once('error', (error) => {
  console.error(`No se pudo iniciar el runtime local: ${error.message}`);
  process.exitCode = 1;
  void shutdown();
});
process.once('SIGINT', () => { void shutdown(); });
process.once('SIGTERM', () => { void shutdown(); });
