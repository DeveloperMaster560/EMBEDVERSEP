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
