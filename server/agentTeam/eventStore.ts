import { createHash, randomUUID } from 'node:crypto';
import { open, mkdir, readFile, rm } from 'node:fs/promises';
import { hostname } from 'node:os';
import { join } from 'node:path';
import type { AgentEvent, AgentEventType, AgentId } from '../../src/agent-team/contracts.js';
import { assertNoCredentialMaterial } from '../../src/agent-team/security.js';

const GENESIS_HASH = '0'.repeat(64);

export interface AgentEventDraft {
  projectId: string;
  taskId: string;
  type: AgentEventType;
  actor: AgentId | 'human' | 'system';
  timestamp?: string;
  payload: Record<string, unknown>;
  evidenceRefs?: string[];
  correlationId: string;
}

export class RuntimeLockedError extends Error {
  readonly lockPath: string;

  constructor(lockPath: string) {
    super(`Ya existe un runtime de agentes activo o bloqueado: ${lockPath}`);
    this.name = 'RuntimeLockedError';
    this.lockPath = lockPath;
  }
}

export class EventLogCorruptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EventLogCorruptionError';
  }
}

function hashEvent(event: Omit<AgentEvent, 'hash'>): string {
  return createHash('sha256').update(JSON.stringify(event)).digest('hex');
}

function validateEvent(value: unknown, expectedSequence: number, previousHash: string): AgentEvent {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new EventLogCorruptionError(`El evento ${expectedSequence} no es un objeto.`);
  }
  const event = value as AgentEvent;
  if (event.schemaVersion !== 1 || event.sequence !== expectedSequence) {
    throw new EventLogCorruptionError(`Versión o secuencia inválida en el evento ${expectedSequence}.`);
  }
  if (event.previousHash !== previousHash || typeof event.hash !== 'string') {
    throw new EventLogCorruptionError(`La cadena de integridad no coincide en el evento ${expectedSequence}.`);
  }
  const { hash, ...unsigned } = event;
  if (hashEvent(unsigned) !== hash) {
    throw new EventLogCorruptionError(`La huella del evento ${expectedSequence} no coincide.`);
  }
  return event;
}

/** Event log append-only con un único escritor local y huellas encadenadas. */
export class AgentEventStore {
  readonly filePath: string;
  readonly lockPath: string;
  private readonly token: string;
  private readonly lockHandle;
  private readonly fileHandle;
  private readonly events: AgentEvent[];
  private writeTail: Promise<void> = Promise.resolve();
  private closed = false;

  private constructor(
    directory: string,
    token: string,
    lockHandle: Awaited<ReturnType<typeof open>>,
    fileHandle: Awaited<ReturnType<typeof open>>,
    events: AgentEvent[],
  ) {
    this.token = token;
    this.filePath = join(directory, 'events.jsonl');
    this.lockPath = join(directory, 'runtime.lock');
    this.lockHandle = lockHandle;
    this.fileHandle = fileHandle;
    this.events = events;
  }

  static async open(directory: string): Promise<AgentEventStore> {
    await mkdir(directory, { recursive: true });
    const lockPath = join(directory, 'runtime.lock');
    let lockHandle: Awaited<ReturnType<typeof open>>;
    try {
      lockHandle = await open(lockPath, 'wx', 0o600);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new RuntimeLockedError(lockPath);
      throw error;
    }

    const lockToken = randomUUID();
    try {
      await lockHandle.writeFile(JSON.stringify({
        token: lockToken,
        pid: process.pid,
        host: hostname(),
        startedAt: new Date().toISOString(),
      }));
      await lockHandle.sync();

      const filePath = join(directory, 'events.jsonl');
      const fileHandle = await open(filePath, 'a+', 0o600);
      try {
        let text: string;
        try {
          text = await readFile(filePath, 'utf8');
        } catch (error) {
          await fileHandle.close();
          throw error;
        }
        if (text && !text.endsWith('\n')) {
          throw new EventLogCorruptionError('El registro termina con una línea incompleta; se conserva intacto para recuperación.');
        }
        const lines = text.split('\n').filter(Boolean);
        const events: AgentEvent[] = [];
        let previousHash = GENESIS_HASH;
        for (let index = 0; index < lines.length; index += 1) {
          let parsed: unknown;
          try {
            parsed = JSON.parse(lines[index]);
          } catch {
            throw new EventLogCorruptionError(`JSON inválido en la línea ${index + 1}; el registro se conserva intacto.`);
          }
          const event = validateEvent(parsed, index + 1, previousHash);
          events.push(event);
          previousHash = event.hash;
        }
        return new AgentEventStore(directory, lockToken, lockHandle, fileHandle, events);
      } catch (error) {
        await fileHandle.close().catch(() => undefined);
        throw error;
      }
    } catch (error) {
      await lockHandle.close().catch(() => undefined);
      // A failed initialization owns this just-created lock, so it is safe to remove.
      await rm(lockPath, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  async append(draft: AgentEventDraft): Promise<AgentEvent> {
    if (this.closed) throw new Error('El registro de eventos está cerrado.');
    assertNoCredentialMaterial(draft.payload);
    const operation = this.writeTail.then(async () => {
      const previousHash = this.events.at(-1)?.hash ?? GENESIS_HASH;
      const unsigned: Omit<AgentEvent, 'hash'> = {
        schemaVersion: 1,
        id: randomUUID(),
        sequence: this.events.length + 1,
        projectId: draft.projectId,
        taskId: draft.taskId,
        type: draft.type,
        actor: draft.actor,
        timestamp: draft.timestamp ?? new Date().toISOString(),
        payload: structuredClone(draft.payload),
        evidenceRefs: [...(draft.evidenceRefs ?? [])],
        correlationId: draft.correlationId,
        previousHash,
      };
      const event: AgentEvent = { ...unsigned, hash: hashEvent(unsigned) };
      await this.fileHandle.writeFile(`${JSON.stringify(event)}\n`, 'utf8');
      await this.fileHandle.sync();
      this.events.push(event);
      return structuredClone(event);
    });
    this.writeTail = operation.then(() => undefined, () => undefined);
    return operation;
  }

  list(options: { afterSequence?: number; projectId?: string; taskId?: string } = {}): AgentEvent[] {
    return this.events
      .filter((event) => event.sequence > (options.afterSequence ?? 0))
      .filter((event) => !options.projectId || event.projectId === options.projectId)
      .filter((event) => !options.taskId || event.taskId === options.taskId)
      .map((event) => structuredClone(event));
  }

  async close(): Promise<void> {
    if (this.closed) return;
    await this.writeTail;
    this.closed = true;
    await this.fileHandle.sync();
    await this.fileHandle.close();
    let lock: { token?: string } | undefined;
    try {
      lock = JSON.parse(await readFile(this.lockPath, 'utf8')) as { token?: string };
    } catch {
      // Preserve an unexpected lock file rather than deleting an unknown owner's lock.
    }
    await this.lockHandle.close();
    if (lock?.token === this.token) {
      await rm(this.lockPath, { force: true });
    }
  }
}
