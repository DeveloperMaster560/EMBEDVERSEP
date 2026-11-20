import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { KnowledgeStore } from './knowledgeStore.js';
import { AgentRuntime } from './runtime.js';

const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true }))); });
async function dir() { const d = await mkdtemp(join(tmpdir(), 'embedverse-knowledge-')); dirs.push(d); return d; }

const SHT31 = {
  category: 'component' as const, subject: 'SHT31 temperatura y humedad (I2C)',
  content: 'Alternativa al DHT22 en I2C; biblioteca Adafruit SHT31, licencia BSD.',
  sourceRefs: ['workspace://server/bibliotecas.lock.json#L10'], createdBy: 'software_engineer' as const,
};

describe('memoria de conocimiento del equipo', () => {
  it('guarda, busca por palabras (sin tildes) y sobrevive a un reinicio', async () => {
    const d = await dir();
    const k = await KnowledgeStore.open(d);
    const r = await k.record(SHT31);
    expect(r).toMatchObject({ version: 1, verificationLevel: 'UNVERIFIED', createdBy: 'software_engineer' });
    expect(k.search({ query: 'sht31 humedad' })[0].id).toBe(r.id);
    expect(k.search({ query: 'acelerometro' })).toEqual([]);
    const otra = await KnowledgeStore.open(d);
    expect(otra.get(r.id)?.subject).toBe(SHT31.subject);
  });

  it('corregir crea una versión nueva; la búsqueda devuelve solo la última y el historial las dos', async () => {
    const k = await KnowledgeStore.open(await dir());
    const v1 = await k.record(SHT31);
    const v2 = await k.record({ ...SHT31, content: 'Corregido: licencia BSD-3-Clause.', supersedes: v1.id });
    expect(v2.version).toBe(2);
    expect(k.search({ query: 'SHT31' }).map((r) => r.id)).toEqual([v2.id]);
    expect(k.history(v1.id).map((r) => r.version)).toEqual([1, 2]);
    await expect(k.record({ ...SHT31, supersedes: v1.id })).rejects.toThrow(/última/);
  });

  it('un agente no puede declarar verificación humana ni COMPUTATIONAL sin evidencia de una herramienta', async () => {
    const k = await KnowledgeStore.open(await dir());
    await expect(k.record({ ...SHT31, verificationLevel: 'HUMAN_REVIEWED' })).rejects.toThrow(/solo una persona/);
    await expect(k.record({ ...SHT31, verificationLevel: 'COMPUTATIONAL' })).rejects.toThrow(/COMPUTATIONAL/);
    const ok = await k.record({ ...SHT31, verificationLevel: 'COMPUTATIONAL' }, new Set(['workspace://server/bibliotecas.lock.json#L10']));
    expect(ok.verificationLevel).toBe('COMPUTATIONAL');
    await expect(k.record({ ...SHT31, createdBy: 'human', verificationLevel: 'HUMAN_REVIEWED' })).rejects.toThrow(/verifiedBy/);
    const h = await k.record({ ...SHT31, createdBy: 'human', verificationLevel: 'HUMAN_REVIEWED', verifiedBy: 'Ing. responsable', supersedes: ok.id });
    expect(h.verificationLevel).toBe('HUMAN_REVIEWED');
  });

  it('exige origen y rechaza credenciales', async () => {
    const k = await KnowledgeStore.open(await dir());
    await expect(k.record({ ...SHT31, sourceRefs: [] })).rejects.toThrow(/referencias de origen/);
    await expect(k.record({ ...SHT31, content: 'password=SuperSecreta123' })).rejects.toThrow(/credencial/);
  });

  it('detecta un archivo manipulado en lugar de usarlo', async () => {
    const d = await dir();
    const k = await KnowledgeStore.open(d);
    await k.record(SHT31);
    const ruta = join(d, 'knowledge.jsonl');
    await writeFile(ruta, (await readFile(ruta, 'utf8')).replace('BSD', 'GPL'));
    await expect(KnowledgeStore.open(d)).rejects.toThrow(/dañada/);
  });

  it('el runtime la abre junto al registro y deja constancia del aprendizaje en el registro de eventos', async () => {
    const d = await dir();
    const runtime = await AgentRuntime.open(d);
    const t = await runtime.createTask({ projectId: 'casa-demo', goal: 'x', assignedAgentId: 'software_engineer', expectedResult: 'y' });
    const r = await runtime.recordKnowledge(t.id, SHT31);
    expect(r.projectId).toBe('casa-demo');
    const ev = runtime.listEvents({ taskId: t.id }).find((e) => e.type === 'knowledge.recorded');
    expect(ev?.payload).toMatchObject({ knowledgeId: r.id, verificationLevel: 'UNVERIFIED' });
    expect(JSON.stringify(ev?.payload)).not.toContain('licencia BSD');
    await runtime.close();
  });
});
