/**
 * Lo que vio la primera prueba real con llama3.2 (20/11/2026): tareas
 * «COMPLETED» cuyo resultado era una llamada a herramienta inventada, y una
 * evidencia previa que leía proyecto.js en lugar de proyecto.json.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AgentOrchestrator, looksLikeUnexecutedAction } from './orchestrator.js';
import { AgentRuntime } from './runtime.js';
import type { AgentModelProvider, ChatMessage } from './providers/ollama.js';

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

const FALSA = '{"action": "tool_call", "name": "project_propose_exact_edit", "arguments": {"file": "x.ino", "commit_hash": "1234567890"';

function proveedor(respuestas: string[], vistos: ChatMessage[][] = []): AgentModelProvider {
  let i = 0;
  return {
    name: 'ollama', model: 'prueba',
    async status() { return { provider: 'ollama', model: 'prueba', available: true }; },
    async chat(input) {
      vistos.push([...input.messages]);
      const content = respuestas[Math.min(i++, respuestas.length - 1)];
      return { message: { role: 'assistant', content }, promptTokens: 10, completionTokens: 10 };
    },
  };
}

async function correr(goal: string, provider: AgentModelProvider) {
  const directory = await mkdtemp(join(tmpdir(), 'embedverse-agent-valid-'));
  directories.push(directory);
  const runtime = await AgentRuntime.open(directory);
  const orchestrator = new AgentOrchestrator({ runtime, workspaceRoot: process.cwd(), provider });
  await orchestrator.start();
  const task = await runtime.createTask({ projectId: 'casa-demo', goal, assignedAgentId: 'structural_engineer', expectedResult: 'Informe.' });
  orchestrator.enqueue(task.id);
  await orchestrator.waitForIdle();
  return { runtime, task: runtime.getTask(task.id)! };
}

describe('validación del resultado de un agente', () => {
  it('reconoce una llamada a herramienta escrita como texto', () => {
    expect(looksLikeUnexecutedAction(FALSA)).toBe(true);
    expect(looksLikeUnexecutedAction('{"name": "workspace_search", "arguments": {"query": "x"}}')).toBe(true);
    expect(looksLikeUnexecutedAction('La estación CASA-TAB-01 está en ELE-TAB-TG (workspace://proyectos/casa-demo/proyecto.json).')).toBe(false);
    expect(looksLikeUnexecutedAction('{"elemento": "ELE-TAB-TG"} es lo que dice el proyecto.')).toBe(false);
  });

  it('no completa con una llamada inventada: la rechaza, lo registra y acepta el informe siguiente', async () => {
    const { runtime, task } = await correr(
      'Qué elemento tiene la estación en proyectos/casa-demo/proyecto.json',
      proveedor([FALSA, 'La estación CASA-TAB-01 está en ELE-TAB-TG según workspace://proyectos/casa-demo/proyecto.json.']),
    );
    expect(task.state).toBe('COMPLETED');
    expect(task.result?.summary).toContain('ELE-TAB-TG');
    expect(task.result?.summary).not.toContain('tool_call');
    expect(runtime.listEvents({ taskId: task.id }).filter((e) => e.type === 'agent.invalid_response')).toHaveLength(1);
  });

  it('tras tres respuestas inválidas la tarea pasa a supervisión humana, no a completada', async () => {
    const { task } = await correr('Revisa proyectos/casa-demo/proyecto.json', proveedor([FALSA]));
    expect(task.state).toBe('WAITING_FOR_HUMAN');
  });

  it('la evidencia previa lee proyecto.json, no proyecto.js', async () => {
    const { runtime, task } = await correr('Revisa proyectos/casa-demo/proyecto.json y cita la línea.', proveedor(['Informe con workspace://proyectos/casa-demo/proyecto.json.']));
    const leidos = runtime.listEvents({ taskId: task.id })
      .filter((e) => e.type === 'tool.requested' && e.payload.toolId === 'workspace.read_file')
      .map((e) => (e.payload.arguments as { path: string }).path);
    expect(leidos).toContain('proyectos/casa-demo/proyecto.json');
    expect(runtime.listEvents({ taskId: task.id }).some((e) => e.type === 'tool.failed')).toBe(false);
  });

  it('la búsqueda previa usa lo que la persona puso entre comillas', async () => {
    const { runtime, task } = await correr('Comprobación técnica: busca "shm/v1" en la plataforma.', proveedor(['Encontrado en workspace://x.']));
    const q = runtime.listEvents({ taskId: task.id })
      .find((e) => e.type === 'tool.requested' && e.payload.toolId === 'workspace.search')?.payload.arguments as { query: string } | undefined;
    expect(q?.query).toBe('shm/v1');
  });
});

describe('auditoría del runtime (20/11/2026)', () => {
  it('una respuesta cortada por el límite de tokens no se acepta como resultado', async () => {
    let i = 0;
    const provider: AgentModelProvider = {
      name: 'ollama', model: 'prueba',
      async status() { return { provider: 'ollama', model: 'prueba', available: true }; },
      async chat() {
        i += 1;
        return i === 1
          ? { message: { role: 'assistant', content: 'La estación está en ELE-' }, promptTokens: 10, completionTokens: 1024, truncated: true }
          : { message: { role: 'assistant', content: 'La estación está en ELE-TAB-TG (workspace://proyectos/casa-demo/proyecto.json).' }, promptTokens: 10, completionTokens: 20 };
      },
    };
    const { runtime, task } = await correr('Lee proyectos/casa-demo/proyecto.json', provider);
    expect(task.state).toBe('COMPLETED');
    expect(task.result?.summary).toContain('ELE-TAB-TG');
    expect(runtime.listEvents({ taskId: task.id }).find((e) => e.type === 'agent.invalid_response')?.payload.reason).toMatch(/cortó/);
  });

  it('una delegación inválida se devuelve al agente para que la corrija, sin abortar la tarea', async () => {
    let i = 0;
    const provider: AgentModelProvider = {
      name: 'ollama', model: 'prueba',
      async status() { return { provider: 'ollama', model: 'prueba', available: true }; },
      async chat() {
        i += 1;
        if (i === 1) return { message: { role: 'assistant', content: '', tool_calls: [{ function: { name: 'team_delegate_task', arguments: { agentId: 'admin', goal: 'x', expectedResult: 'y' } } }] }, promptTokens: 10, completionTokens: 10 };
        return { message: { role: 'assistant', content: 'Sin delegar: ELE-TAB-TG según workspace://proyectos/casa-demo/proyecto.json.' }, promptTokens: 10, completionTokens: 10 };
      },
    };
    const { runtime, task } = await correr('Lee proyectos/casa-demo/proyecto.json', provider);
    expect(task.state).toBe('COMPLETED');
    expect(runtime.listEvents({ taskId: task.id }).some((e) => e.type === 'tool.failed' && e.payload.toolId === 'team_delegate_task')).toBe(true);
  });

  it('el prompt de sistema dice al agente quién es y a quién puede delegar', async () => {
    const vistos: ChatMessage[][] = [];
    await correr('Lee proyectos/casa-demo/proyecto.json', proveedor(['Informe workspace://x.'], vistos));
    const sistema = vistos[0][0].content;
    expect(sistema).toContain('Tu identificador es structural_engineer');
    expect(sistema).toContain('software_engineer');
    expect(sistema).toContain('mechatronics_engineer');
    expect(sistema).toMatch(/no puedes delegarte a ti mismo/);
  });
});

describe('criterios objetivos de cierre', () => {
  it('si el objetivo nombra a otro agente, no se cierra sin haberle delegado', async () => {
    const vistos: ChatMessage[][] = [];
    const { runtime, task } = await correr(
      'Pide a software_engineer que verifique la biblioteca del sensor (lee proyectos/casa-demo/proyecto.json).',
      proveedor(['No hay registros; investiga tú (workspace://proyectos/casa-demo/proyecto.json).'], vistos),
    );
    expect(task.state).toBe('WAITING_FOR_HUMAN');
    const razones = runtime.listEvents({ taskId: task.id }).filter((e) => e.type === 'agent.invalid_response').map((e) => String(e.payload.reason));
    expect(razones[0]).toMatch(/software_engineer/);
    expect(vistos[1].at(-1)?.content).toMatch(/team_delegate_task/);
  });

  it('un informe sin ninguna referencia no se acepta cuando la tarea exige evidencia', async () => {
    const { task } = await correr('Lee proyectos/casa-demo/proyecto.json', proveedor(['Todo correcto.', 'Todo correcto según workspace://proyectos/casa-demo/proyecto.json.']));
    expect(task.state).toBe('COMPLETED');
    expect(task.result?.summary).toContain('workspace://');
  });
});

describe('ausencias sin confirmar', () => {
  it('tras leer un tramo parcial, «no se encontró» exige una búsqueda propia antes de cerrar', async () => {
    const { runtime, task } = await correr(
      'Comprueba en server/bibliotecas.lock.json la biblioteca del DHT22.',
      proveedor(['No se encontró biblioteca para el DHT22 (workspace://server/bibliotecas.lock.json).']),
    );
    expect(task.state).toBe('WAITING_FOR_HUMAN');
    expect(runtime.listEvents({ taskId: task.id }).find((e) => e.type === 'agent.invalid_response')?.payload.reason).toMatch(/tramos parciales/);
  });
});

describe('delegación pendiente', () => {
  it('tras rechazar el cierre por una delegación pendiente, el turno siguiente solo ofrece team_delegate_task', async () => {
    const ofrecidas: string[][] = [];
    let i = 0;
    const provider: AgentModelProvider = {
      name: 'ollama', model: 'prueba',
      async status() { return { provider: 'ollama', model: 'prueba', available: true }; },
      async chat(input) {
        ofrecidas.push(input.tools.map((t) => t.function.name));
        i += 1;
        return { message: { role: 'assistant', content: 'Se ha delegado a software_engineer (workspace://x).' }, promptTokens: 1, completionTokens: 1 };
      },
    };
    const { task } = await correr('Delega a software_engineer que revise proyectos/casa-demo/proyecto.json.', provider);
    expect(task.state).toBe('WAITING_FOR_HUMAN');
    expect(ofrecidas[0]).toContain('workspace_read_file');
    expect(ofrecidas[1]).toEqual(['team_delegate_task']);
    expect(i).toBe(3);
  });
});

describe('ausencia contradicha por la búsqueda', () => {
  it('si la búsqueda previa encontró el término, «no se encuentra» se rechaza citando la línea', async () => {
    const { runtime, task } = await correr(
      'Busca la biblioteca del SHT31 en server/bibliotecas.lock.json.',
      proveedor(['La biblioteca del SHT31 no se encuentra (workspace://server/bibliotecas.lock.json).']),
    );
    expect(task.state).toBe('WAITING_FOR_HUMAN');
    const r = runtime.listEvents({ taskId: task.id }).find((e) => e.type === 'agent.invalid_response')?.payload.reason;
    expect(r).toMatch(/bibliotecas\.lock\.json:\d+/);
    const pre = runtime.listEvents({ taskId: task.id }).find((e) => e.type === 'tool.requested');
    expect(pre?.payload.arguments).toEqual({ query: 'SHT31', path: 'server/bibliotecas.lock.json' });
  });
});

describe('memoria pedida', () => {
  it('si el objetivo pide guardar en la memoria y no se hizo, no se cierra y se ofrece solo team_knowledge_record', async () => {
    const ofrecidas: string[][] = [];
    const provider: AgentModelProvider = {
      name: 'ollama', model: 'prueba',
      async status() { return { provider: 'ollama', model: 'prueba', available: true }; },
      async chat(input) {
        ofrecidas.push(input.tools.map((t) => t.function.name));
        return { message: { role: 'assistant', content: 'Hecho (workspace://proyectos/casa-demo/proyecto.json).' }, promptTokens: 1, completionTokens: 1 };
      },
    };
    const { task } = await correr('Revisa proyectos/casa-demo/proyecto.json y guarda lo verificado en la memoria del equipo.', provider);
    expect(task.state).toBe('WAITING_FOR_HUMAN');
    expect(ofrecidas[1]).toEqual(['team_knowledge_record']);
  });
});
