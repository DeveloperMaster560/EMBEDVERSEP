import { useCallback, useEffect, useState } from 'react';
import { Bot, MessageSquare, RefreshCw, Send, ShieldAlert, XCircle } from 'lucide-react';
import type { AgentDefinition, AgentMessage, AgentPatchProposal, AgentTask, CreateTaskInput, TaskState } from './contracts';
import type { EmbeddedProject } from '../domain/types';
import { applyExactReplacement, sha256Text } from './patch-utils';

const API = 'http://127.0.0.1:5175/api/agent-team';

interface ProviderStatus {
  provider: 'ollama';
  model: string;
  available: boolean;
  reason?: string;
}

interface OperationsProps {
  projects: EmbeddedProject[];
  onApplyPatch: (proposal: AgentPatchProposal) => Promise<void>;
}

const STATE_LABELS: Record<TaskState, string> = {
  PENDING: 'En cola', IN_PROGRESS: 'En curso', WAITING_FOR_AGENT: 'Esperando agente',
  WAITING_FOR_HUMAN: 'Requiere atención', COMPLETED: 'Completada', FAILED: 'Fallida', CANCELLED: 'Cancelada',
};

const AGENT_NAMES: Record<AgentDefinition['id'], string> = {
  structural_engineer: 'Ingeniería estructural',
  software_engineer: 'Ingeniería de software',
  mechatronics_engineer: 'Mecatrónica',
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  const body = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? `El runtime respondió ${response.status}.`);
  return body;
}

export function AgentOperations({ projects, onApplyPatch }: OperationsProps) {
  const [provider, setProvider] = useState<ProviderStatus | null>(null);
  const [agents, setAgents] = useState<AgentDefinition[]>([]);
  const [tasks, setTasks] = useState<AgentTask[]>([]);
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [patchProposals, setPatchProposals] = useState<AgentPatchProposal[]>([]);
  const [projectId, setProjectId] = useState(projects[0]?.id ?? '');
  const [selectedFilePaths, setSelectedFilePaths] = useState<string[]>([]);
  const [assignedAgentId, setAssignedAgentId] = useState<AgentDefinition['id']>('software_engineer');
  const [goal, setGoal] = useState('');
  const [expectedResult, setExpectedResult] = useState('Informe breve con hallazgos verificados, referencias y limitaciones.');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const selectedProjectId = projects.some((project) => project.id === projectId) ? projectId : projects[0]?.id ?? '';
  const selectedProject = projects.find((project) => project.id === selectedProjectId);
  const selectedFiles = selectedProject?.files.filter((file) => selectedFilePaths.includes(file.path)) ?? [];
  const selectedContextChars = selectedFiles.reduce((total, file) => total + file.content.length, 0);

  const refresh = useCallback(async () => {
    const [providerResult, agentResult, taskResult, messageResult, patchResult] = await Promise.all([
      request<{ provider: ProviderStatus | null }>('/provider'),
      request<{ agents: AgentDefinition[] }>('/agents'),
      request<{ tasks: AgentTask[] }>('/tasks'),
      request<{ messages: AgentMessage[] }>('/messages'),
      request<{ proposals: AgentPatchProposal[] }>('/patch-proposals'),
    ]);
    setProvider(providerResult.provider);
    setAgents(agentResult.agents);
    setTasks(taskResult.tasks);
    setMessages(messageResult.messages);
    setPatchProposals(patchResult.proposals);
    setError('');
  }, []);

  useEffect(() => {
    let active = true;
    const load = () => refresh().catch((reason: unknown) => {
      if (active) setError(reason instanceof Error ? reason.message : 'No se pudo conectar con el runtime local.');
    });
    void load();
    const timer = window.setInterval(() => void load(), 5_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [refresh]);

  const submitTask = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedProjectId || !goal.trim()) return;
    setBusy(true);
    try {
      const input: CreateTaskInput = { projectId: selectedProjectId, assignedAgentId, goal: goal.trim(), expectedResult: expectedResult.trim() };
      const contextFiles = selectedFiles.map(({ path, content }) => ({ path, content }));
      await request<{ task: AgentTask }>('/tasks', { method: 'POST', body: JSON.stringify({ ...input, contextFiles, boardId: selectedProject?.boardId }) });
      setGoal('');
      setSelectedFilePaths([]);
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se pudo crear la tarea.');
    } finally {
      setBusy(false);
    }
  };

  const cancelTask = async (task: AgentTask) => {
    setBusy(true);
    try {
      await request(`/tasks/${task.id}/transition`, {
        method: 'POST', body: JSON.stringify({ to: 'CANCELLED', expectedState: task.state, reason: 'Cancelada desde Centro de operaciones.' }),
      });
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se pudo cancelar la tarea.');
    } finally {
      setBusy(false);
    }
  };

  const resumeTask = async (task: AgentTask) => {
    setBusy(true);
    try {
      await request(`/tasks/${task.id}/resume`, {
        method: 'POST', body: JSON.stringify({ expectedState: 'WAITING_FOR_HUMAN' }),
      });
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se pudo reanudar la tarea.');
    } finally {
      setBusy(false);
    }
  };

  const rejectPatch = async (proposal: AgentPatchProposal) => {
    setBusy(true);
    try {
      await request(`/patch-proposals/${proposal.id}/decision`, { method: 'POST', body: JSON.stringify({ decision: 'REJECTED', reason: 'Rechazada por revisión humana.' }) });
      await refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'No se pudo rechazar la propuesta.'); }
    finally { setBusy(false); }
  };

  const applyPatch = async (proposal: AgentPatchProposal) => {
    setBusy(true);
    try {
      const project = projects.find((item) => item.id === proposal.projectId);
      const file = project?.files.find((item) => item.path === proposal.path);
      if (!file || await sha256Text(file.content) !== proposal.originalSha256) throw new Error('PATCH_STALE: El archivo cambió desde que se creó la propuesta.');
      const updated = applyExactReplacement(file.content, proposal.searchText, proposal.replaceText);
      if (await sha256Text(updated) !== proposal.proposedSha256) throw new Error('PATCH_STALE: El resultado no coincide con el hash propuesto.');
      if (proposal.state === 'PENDING_APPROVAL') await request(`/patch-proposals/${proposal.id}/decision`, { method: 'POST', body: JSON.stringify({ decision: 'APPROVED' }) });
      await onApplyPatch(proposal);
      await request(`/patch-proposals/${proposal.id}/applied`, { method: 'POST', body: JSON.stringify({ appliedSha256: proposal.proposedSha256 }) });
      await refresh();
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'No se pudo aplicar la propuesta.';
      if (message.startsWith('PATCH_STALE:')) {
        try { await request(`/patch-proposals/${proposal.id}/decision`, { method: 'POST', body: JSON.stringify({ decision: 'STALE', reason: message.slice(12) }) }); } catch { /* Keep original error visible. */ }
      }
      setError(message.replace('PATCH_STALE: ', ''));
      await refresh().catch(() => undefined);
    } finally { setBusy(false); }
  };

  const activeTasks = tasks.filter((task) => !['COMPLETED', 'FAILED', 'CANCELLED'].includes(task.state));
  const canCreate = provider?.available && Boolean(selectedProjectId) && !busy;

  return (
    <section className="agent-operations standard-page">
      <div className="page-heading-row">
        <div><div className="eyebrow"><span className="eyebrow-line" /> EQUIPO LOCAL</div><h1>Centro de operaciones</h1><p>Asigna trabajo a los especialistas que se ejecutan en este PC.</p></div>
        <button className="secondary-button" onClick={() => void refresh()} disabled={busy}><RefreshCw size={14} /> Actualizar</button>
      </div>

      <section className="agent-panel agent-patches">
        <div className="agent-panel-heading"><div><h2>Propuestas de cambio</h2><p>El agente no modifica los archivos. Cada reemplazo requiere aprobación y una comprobación del archivo vigente.</p></div></div>
        {!patchProposals.length && <div className="agent-empty">Las propuestas aparecerán aquí para revisión.</div>}
        {patchProposals.slice().reverse().map((proposal) => <article className="agent-patch-card" key={proposal.id}>
          <div className="agent-task-card-top"><strong>{proposal.path}</strong><span className={`agent-patch-state patch-${proposal.state.toLowerCase()}`}>{proposal.state === 'PENDING_APPROVAL' ? 'Pendiente de aprobación' : proposal.state}</span></div>
          <p>{proposal.summary}</p>
          <div className="agent-patch-diff"><div><strong>Antes</strong><pre>{proposal.searchText}</pre></div><div><strong>Propuesto</strong><pre>{proposal.replaceText || '(vacío; elimina el fragmento)'}</pre></div></div>
          {proposal.decisionReason && <small>Motivo: {proposal.decisionReason}</small>}
          {(proposal.state === 'PENDING_APPROVAL' || proposal.state === 'APPROVED') && <div className="agent-task-actions">
            <button className="primary-button" disabled={busy} onClick={() => void applyPatch(proposal)}>{proposal.state === 'APPROVED' ? 'Aplicar aprobado' : 'Aprobar y aplicar'}</button>
            {proposal.state === 'PENDING_APPROVAL' && <button className="secondary-button" disabled={busy} onClick={() => void rejectPatch(proposal)}>Rechazar</button>}
          </div>}
        </article>)}
      </section>

      {error && <div className="agent-alert" role="alert"><ShieldAlert size={16} />{error}</div>}
      <div className={`agent-provider ${provider?.available ? 'is-ready' : 'is-offline'}`}>
        <span className="agent-provider-dot" />
        {provider?.available ? `Ollama activo · ${provider.model}` : provider?.reason ?? 'Conectando con el runtime local…'}
        {!provider?.available && <code>npm run agent:runtime</code>}
      </div>

      <div className="agent-roster">
        {agents.map((agent) => <article className="agent-card" key={agent.id}>
          <span className="agent-card-icon"><Bot size={18} /></span>
          <div><strong>{AGENT_NAMES[agent.id]}</strong><small>{agent.specialty}</small></div>
          <span className={`agent-state ${agent.availability === 'ACTIVE' ? 'is-ready' : 'is-offline'}`}>{agent.availability === 'ACTIVE' ? 'Disponible' : 'En espera'}</span>
        </article>)}
      </div>

      <div className="agent-columns">
        <section className="agent-panel">
          <div className="agent-panel-heading"><div><h2>Nueva tarea</h2><p>La ejecución requiere evidencia del repositorio.</p></div></div>
          <form className="agent-task-form" onSubmit={(event) => void submitTask(event)}>
            <label>Proyecto<select value={selectedProjectId} onChange={(event) => { setProjectId(event.target.value); setSelectedFilePaths([]); }} required>
              <option value="" disabled>Selecciona un proyecto</option>
              {projects.map((project) => <option value={project.id} key={project.id}>{project.name}</option>)}
            </select></label>
            <label>Especialista<select value={assignedAgentId} onChange={(event) => setAssignedAgentId(event.target.value as AgentDefinition['id'])}>
              {agents.map((agent) => <option value={agent.id} key={agent.id}>{AGENT_NAMES[agent.id]}</option>)}
            </select></label>
            <label>Objetivo<textarea value={goal} onChange={(event) => setGoal(event.target.value)} maxLength={8_000} rows={4} required placeholder="Describe qué debe investigar o resolver el agente." /></label>
            <label>Resultado esperado<textarea value={expectedResult} onChange={(event) => setExpectedResult(event.target.value)} maxLength={8_000} rows={2} required /></label>
            {!!selectedProject?.files.length && <fieldset className="agent-context-picker"><legend>Archivos de contexto opcionales</legend>
              {selectedProject.files.map((file) => <label className="agent-context-file" key={file.id}>
                <input type="checkbox" checked={selectedFilePaths.includes(file.path)} disabled={!selectedFilePaths.includes(file.path) && (selectedFilePaths.length >= 10 || selectedContextChars + file.content.length > 14_000)} onChange={(event) => setSelectedFilePaths((current) => event.target.checked ? [...current, file.path] : current.filter((path) => path !== file.path))} />
                <span>{file.path}</span><small>{file.content.length.toLocaleString()} caracteres</small>
              </label>)}
              <small>{selectedFiles.length} seleccionados · {selectedContextChars.toLocaleString()} / 14.000 caracteres</small>
            </fieldset>}
            <p className="agent-form-note">Solo se envían al runtime local los archivos que selecciones. Se mantienen en memoria para la tarea y no se escriben en el historial. Si no eliges archivos, el agente buscará evidencia en el repositorio.</p>
            <button className="primary-button" type="submit" disabled={!canCreate || !goal.trim() || !expectedResult.trim() || selectedFiles.length > 10 || selectedContextChars > 14_000}><Send size={14} /> Asignar tarea</button>
            {!projects.length && <small className="agent-form-note">Crea primero un proyecto para asignarle una tarea.</small>}
          </form>
        </section>

        <section className="agent-panel">
          <div className="agent-panel-heading"><div><h2>Tareas activas</h2><p>{activeTasks.length} en curso o en espera</p></div></div>
          <div className="agent-task-list">
            {tasks.length === 0 && <div className="agent-empty">Todavía no hay tareas en este runtime.</div>}
            {tasks.map((task) => <article className="agent-task-card" key={task.id}>
              <div className="agent-task-card-top"><span className={`agent-task-state state-${task.state.toLowerCase()}`}>{STATE_LABELS[task.state]}</span><small>{AGENT_NAMES[task.assignedAgentId]}</small></div>
              <strong>{task.goal}</strong>
              {task.error && <p className="agent-task-error">{task.error.message}</p>}
              {task.state === 'COMPLETED' && typeof task.result?.summary === 'string' && <p>{task.result.summary}</p>}
              {task.parentTaskId && <small>Subtarea de {task.parentTaskId.slice(0, 8)}</small>}
              <div className="agent-task-actions">
                {task.state === 'WAITING_FOR_HUMAN' && !patchProposals.some((proposal) => proposal.taskId === task.id && proposal.state === 'PENDING_APPROVAL') && <button className="secondary-button" disabled={busy || !provider?.available} onClick={() => void resumeTask(task)}>Reanudar</button>}
                {['PENDING', 'IN_PROGRESS', 'WAITING_FOR_AGENT', 'WAITING_FOR_HUMAN'].includes(task.state) && <button className="agent-cancel-button" disabled={busy} onClick={() => void cancelTask(task)}><XCircle size={14} /> Cancelar</button>}
              </div>
            </article>)}
          </div>
        </section>
      </div>

      <section className="agent-panel agent-messages-panel">
        <div className="agent-panel-heading"><div><h2><MessageSquare size={16} /> Comunicaciones</h2><p>Solicitudes y respuestas entre especialistas.</p></div></div>
        <div className="agent-message-list">
          {messages.length === 0 && <div className="agent-empty">Los mensajes de delegación aparecerán aquí.</div>}
          {[...messages].reverse().map((message) => <article className="agent-message" key={message.id}>
            <span className={`agent-message-mark ${message.requestType.endsWith('.response') ? 'is-response' : ''}`}><MessageSquare size={15} /></span>
            <div><div className="agent-message-meta"><strong>{AGENT_NAMES[message.senderAgentId as AgentDefinition['id']] ?? message.senderAgentId} → {AGENT_NAMES[message.recipientAgentId as AgentDefinition['id']] ?? message.recipientAgentId}</strong><span>{message.state}</span></div><p>{message.description}</p><small>{message.requestType} · tarea {message.taskId.slice(0, 8)}</small></div>
          </article>)}
        </div>
      </section>
    </section>
  );
}
