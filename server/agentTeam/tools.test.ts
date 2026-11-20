import { describe, expect, it } from 'vitest';
import { WorkspaceToolRegistry } from './tools.js';

const registry = new WorkspaceToolRegistry(process.cwd());

describe('WorkspaceToolRegistry', () => {
  it('returns bounded read-only evidence for repository files', async () => {
    const result = await registry.execute('software_engineer', 'workspace.read_file', { path: 'README.md' });
    expect(result.summary).toContain('README.md');
    expect(result.evidenceRefs[0]).toMatch(/^workspace:\/\/README\.md#sha256=/);
    expect(result.text).toContain('EMBEDVERSE STUDIO');
  });

  it('rejects traversal, absolute paths and local secrets', async () => {
    await expect(registry.execute('software_engineer', 'workspace.read_file', { path: '../../README.md' }))
      .rejects.toThrow('no puede subir');
    await expect(registry.execute('software_engineer', 'workspace.read_file', { path: '.env' }))
      .rejects.toThrow('sensibles excluidos');
    await expect(registry.execute('software_engineer', 'workspace.read_file', { path: 'README.md', extra: true }))
      .rejects.toThrow('Argumento no permitido');
  });

  it('searches literal code and refuses tools for unregistered agents', async () => {
    const result = await registry.execute('structural_engineer', 'workspace.search', { query: 'ElectronicCircuit', path: 'src' });
    expect(result.summary).toContain('Búsqueda literal');
    expect(result.text).toContain('src/domain/types.ts');
    await expect(registry.execute('structural_engineer', 'workspace.write_file', { path: 'README.md' }))
      .rejects.toThrow('no tiene permiso');
  });
});

describe('lectura por tramos (auditoría 20/11/2026)', () => {
  it('un archivo largo avisa de que solo se ve un tramo y se puede leer otro', async () => {
    const { WorkspaceToolRegistry } = await import('./tools.js');
    const tools = new WorkspaceToolRegistry(process.cwd());
    const primero = JSON.parse((await tools.execute('software_engineer', 'workspace.read_file', { path: 'server/bibliotecas.lock.json' })).text);
    expect(primero.truncated).toBe(true);
    expect(primero.aviso).toMatch(/No concluyas que algo falta/);
    const linea = (await import('node:fs')).readFileSync('server/bibliotecas.lock.json', 'utf8').split('\n').findIndex((l) => l.includes('"DHT sensor library"')) + 1;
    expect(linea).toBeGreaterThan(primero.lines.to);
    const tramo = JSON.parse((await tools.execute('software_engineer', 'workspace.read_file', { path: 'server/bibliotecas.lock.json', startLine: linea, lineCount: 5 })).text);
    expect(tramo.content).toContain('DHT sensor library');
    const busqueda = JSON.parse((await tools.execute('software_engineer', 'workspace.search', { query: 'DHT sensor library', path: 'server/bibliotecas.lock.json' })).text);
    expect(busqueda.matches.length).toBeGreaterThan(0);
  });
});
