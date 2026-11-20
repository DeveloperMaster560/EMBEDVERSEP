/**
 * Memoria de conocimiento compartida por los tres ingenieros.
 *
 * NO es el registro de eventos: aquel cuenta qué pasó (auditoría); esto guarda
 * lo que el equipo SABE y puede reutilizar (decisiones, componentes,
 * bibliotecas verificadas, compatibilidades, errores y soluciones, resultados
 * de pruebas). Vive en su propio archivo, `knowledge.jsonl`, junto al registro.
 *
 * Reglas:
 * - Solo se añade. Corregir es crear una versión nueva con `supersedes`; la
 *   consulta devuelve la última versión de cada cadena.
 * - Cada registro lleva origen (`createdBy`, `sourceRefs`), fecha, versión y
 *   nivel de verificación. Un agente solo puede declarar UNVERIFIED o
 *   COMPUTATIONAL (este último solo citando evidencia de una herramienta);
 *   HUMAN_REVIEWED y PHYSICALLY_VERIFIED los asigna una persona.
 * - Huella SHA-256 encadenada, como el registro: detecta corrupción
 *   accidental, no a alguien que reescriba el archivo entero.
 * - Se rechaza contenido con credenciales reconocibles.
 */
import { createHash, randomUUID } from 'node:crypto';
import { open, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AgentId, KnowledgeRecord, VerificationLevel } from '../../src/agent-team/contracts.js';
import { assertNoCredentialMaterial } from '../../src/agent-team/security.js';
import { AgentInputError } from './runtime.js';

export const KNOWLEDGE_CATEGORIES: readonly KnowledgeRecord['category'][] = [
  'project', 'technical', 'component', 'error', 'solution', 'decision',
];
const LEVELS: readonly VerificationLevel[] = ['UNVERIFIED', 'COMPUTATIONAL', 'HUMAN_REVIEWED', 'PHYSICALLY_VERIFIED'];
const HUMAN_ONLY: readonly VerificationLevel[] = ['HUMAN_REVIEWED', 'PHYSICALLY_VERIFIED'];
const MAX_SUBJECT = 200;
const MAX_CONTENT = 4_000;
const MAX_REFS = 20;
const GENESIS = '0'.repeat(64);

interface StoredRecord extends KnowledgeRecord { previousHash: string; hash: string }

export interface NewKnowledge {
  projectId?: string;
  category: KnowledgeRecord['category'];
  subject: string;
  content: string;
  sourceRefs: string[];
  createdBy: AgentId | 'human';
  verificationLevel?: VerificationLevel;
  verifiedBy?: string;
  supersedes?: string;
}

function huella(r: Omit<StoredRecord, 'hash'>): string {
  return createHash('sha256').update(JSON.stringify(r)).digest('hex');
}

function palabras(texto: string): string[] {
  return texto.toLocaleLowerCase('es').normalize('NFD').replace(/\p{M}/gu, '')
    .split(/[^\p{L}\p{N}_.-]+/u).filter((w) => w.length >= 3);
}

export class KnowledgeStore {
  private readonly records: StoredRecord[] = [];
  private readonly byId = new Map<string, StoredRecord>();
  private readonly supersededIds = new Set<string>();
  private lastHash = GENESIS;

  private readonly path: string;

  private constructor(path: string) {
    this.path = path;
  }

  /** Abre (o crea) `knowledge.jsonl`. Debe llamarse con el bloqueo del runtime ya tomado. */
  static async open(directory: string): Promise<KnowledgeStore> {
    const store = new KnowledgeStore(join(directory, 'knowledge.jsonl'));
    let raw = '';
    try { raw = await readFile(store.path, 'utf8'); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
    let n = 0;
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      n += 1;
      const r = JSON.parse(line) as StoredRecord;
      const { hash, ...sinHuella } = r;
      if (r.previousHash !== store.lastHash || huella(sinHuella) !== hash) {
        throw new Error(`La memoria de conocimiento está dañada en el registro ${n} (${store.path}). Conserva una copia y revísala a mano.`);
      }
      store.index(r);
    }
    return store;
  }

  private index(r: StoredRecord): void {
    this.records.push(r);
    this.byId.set(r.id, r);
    if (r.supersedes) this.supersededIds.add(r.supersedes);
    this.lastHash = r.hash;
  }

  get(id: string): KnowledgeRecord | undefined {
    const r = this.byId.get(id);
    return r ? this.publico(r) : undefined;
  }

  private publico(r: StoredRecord): KnowledgeRecord {
    const { previousHash: _p, hash: _h, ...rest } = r;
    return structuredClone(rest);
  }

  /**
   * Añade un registro. `evidenceRefs` son las referencias que una herramienta
   * devolvió en la tarea del agente: COMPUTATIONAL solo se acepta si el
   * registro cita al menos una de ellas.
   */
  async record(input: NewKnowledge, evidenceRefs: ReadonlySet<string> = new Set()): Promise<KnowledgeRecord> {
    if (!KNOWLEDGE_CATEGORIES.includes(input.category)) {
      throw new AgentInputError(`Categoría no válida. Usa: ${KNOWLEDGE_CATEGORIES.join(', ')}.`);
    }
    const subject = typeof input.subject === 'string' ? input.subject.trim() : '';
    const content = typeof input.content === 'string' ? input.content.trim() : '';
    if (!subject || subject.length > MAX_SUBJECT) throw new AgentInputError(`El asunto es obligatorio (máx. ${MAX_SUBJECT} caracteres).`);
    if (!content || content.length > MAX_CONTENT) throw new AgentInputError(`El contenido es obligatorio (máx. ${MAX_CONTENT} caracteres).`);
    const sourceRefs = Array.isArray(input.sourceRefs) ? input.sourceRefs.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim()) : [];
    if (!sourceRefs.length || sourceRefs.length > MAX_REFS) {
      throw new AgentInputError(`Todo registro necesita entre 1 y ${MAX_REFS} referencias de origen (workspace://, project://, task://, una URL de la documentación…).`);
    }
    const level = input.verificationLevel ?? 'UNVERIFIED';
    if (!LEVELS.includes(level)) throw new AgentInputError('Nivel de verificación no válido.');
    if (input.createdBy !== 'human') {
      if (HUMAN_ONLY.includes(level)) throw new AgentInputError(`Un agente no puede declarar ${level}: solo una persona.`);
      if (level === 'COMPUTATIONAL' && !sourceRefs.some((ref) => evidenceRefs.has(ref))) {
        throw new AgentInputError('COMPUTATIONAL exige citar una referencia que una herramienta devolvió en esta tarea; si no, registra UNVERIFIED.');
      }
    } else if (HUMAN_ONLY.includes(level) && !input.verifiedBy?.trim()) {
      throw new AgentInputError(`${level} exige indicar quién verificó (verifiedBy).`);
    }
    let version = 1;
    if (input.supersedes) {
      const anterior = this.byId.get(input.supersedes);
      if (!anterior) throw new AgentInputError('El registro que se quiere corregir no existe.');
      if (this.supersededIds.has(anterior.id)) throw new AgentInputError('Ese registro ya tiene una versión posterior; corrige la última.');
      version = anterior.version + 1;
    }
    const draft: Omit<StoredRecord, 'hash'> = {
      schemaVersion: 1,
      id: randomUUID(),
      ...(input.projectId ? { projectId: input.projectId } : {}),
      category: input.category,
      subject,
      content,
      sourceRefs,
      createdBy: input.createdBy,
      createdAt: new Date().toISOString(),
      version,
      verificationLevel: level,
      ...(input.verifiedBy ? { verifiedBy: input.verifiedBy.trim().slice(0, 200) } : {}),
      ...(input.supersedes ? { supersedes: input.supersedes } : {}),
      previousHash: this.lastHash,
    };
    assertNoCredentialMaterial(draft);
    const stored: StoredRecord = { ...draft, hash: huella(draft) };
    const fh = await open(this.path, 'a');
    try {
      await fh.appendFile(`${JSON.stringify(stored)}\n`, 'utf8');
      await fh.sync();
    } finally {
      await fh.close();
    }
    this.index(stored);
    return this.publico(stored);
  }

  /** Últimas versiones que coinciden, las más pertinentes y mejor verificadas primero. */
  search(filter: { query?: string; category?: KnowledgeRecord['category']; projectId?: string; limit?: number } = {}): KnowledgeRecord[] {
    const terminos = palabras(filter.query ?? '');
    const peso: Record<VerificationLevel, number> = { UNVERIFIED: 0, COMPUTATIONAL: 1, HUMAN_REVIEWED: 2, PHYSICALLY_VERIFIED: 3 };
    return this.records
      .filter((r) => !this.supersededIds.has(r.id))
      .filter((r) => !filter.category || r.category === filter.category)
      .filter((r) => !filter.projectId || !r.projectId || r.projectId === filter.projectId)
      .map((r) => {
        const texto = new Set(palabras(`${r.subject} ${r.content} ${r.category}`));
        const aciertos = terminos.filter((t) => texto.has(t) || [...texto].some((w) => w.startsWith(t))).length;
        return { r, aciertos };
      })
      .filter(({ aciertos }) => !terminos.length || aciertos > 0)
      .sort((a, b) => b.aciertos - a.aciertos || peso[b.r.verificationLevel] - peso[a.r.verificationLevel] || b.r.createdAt.localeCompare(a.r.createdAt))
      .slice(0, Math.max(1, Math.min(filter.limit ?? 10, 50)))
      .map(({ r }) => this.publico(r));
  }

  /** Historial completo de una cadena de versiones, de la primera a la última. */
  history(id: string): KnowledgeRecord[] {
    const cadena: StoredRecord[] = [];
    let actual = this.byId.get(id);
    while (actual) { cadena.unshift(actual); actual = actual.supersedes ? this.byId.get(actual.supersedes) : undefined; }
    let ultimo = cadena.at(-1);
    while (ultimo) {
      const siguiente = this.records.find((r) => r.supersedes === ultimo!.id);
      if (siguiente) cadena.push(siguiente);
      ultimo = siguiente;
    }
    return cadena.map((r) => this.publico(r));
  }

  get size(): number { return this.records.length; }
}
