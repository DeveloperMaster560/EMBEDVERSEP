import 'fake-indexeddb/auto';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { EmbeddedProject } from '../domain/types';
import { deleteProject, duplicateProject, exportProject, importProjectFromJson, listProjects, saveProject } from './projectRepository';

function project(id: string, name: string, updatedAt: string): EmbeddedProject {
  return {
    id,
    name,
    boardId: 'arduino-uno',
    description: 'test',
    files: [{ id: `${id}-file`, path: 'src/main.cpp', content: 'void setup() {}' }],
    activeFileId: `${id}-file`,
    createdAt: updatedAt,
    updatedAt,
  };
}

describe('projectRepository', () => {
  beforeAll(() => {
    vi.stubGlobal('window', globalThis);
  });

  it('creates, updates, sorts, and deletes local projects', async () => {
    await saveProject(project('older', 'Older', '2026-01-01T00:00:00.000Z'));
    await saveProject(project('newer', 'Newer', '2026-01-02T00:00:00.000Z'));
    await saveProject(project('older', 'Renamed', '2026-01-03T00:00:00.000Z'));

    const savedProjects = await listProjects();
    expect(savedProjects.map(({ id, name }) => [id, name])).toEqual([
      ['older', 'Renamed'],
      ['newer', 'Newer'],
    ]);

    await deleteProject('older');
    expect((await listProjects()).map(({ id }) => id)).toEqual(['newer']);
  });

  it('persists imported 3D model binaries with the project', async () => {
    const saved = project('twin', 'Bridge twin', '2026-01-04T00:00:00.000Z');
    saved.digitalTwin = {
      kind: 'imported',
      name: 'bridge.glb',
      assets: [{ name: 'bridge.glb', type: 'model/gltf-binary', data: new Uint8Array([0x67, 0x6c, 0x54, 0x46]).buffer }],
    };

    await saveProject(saved);
    const restored = await listProjects();

    expect(new Uint8Array(restored[0].digitalTwin?.assets?.[0].data ?? new ArrayBuffer(0))).toEqual(
      new Uint8Array([0x67, 0x6c, 0x54, 0x46]),
    );
  });

  it('duplicates projects without sharing component ids or binary assets', () => {
    const original = project('source', 'Source', '2026-01-05T00:00:00.000Z');
    original.digitalTwin = {
      kind: 'imported',
      name: 'bridge.glb',
      assets: [{ name: 'bridge.glb', type: 'model/gltf-binary', data: new Uint8Array([0x10, 0x20, 0x30]).buffer }],
    };
    original.electronicLab = {
      name: 'Sensor node',
      boardId: 'arduino-uno',
      components: [
        { id: 'board-1', kind: 'board', label: 'Arduino Uno', description: 'Main board', x: 120, y: 120 },
        { id: 'sensor-1', kind: 'mpu6050', label: 'MPU6050', description: 'Sensor', x: 260, y: 180 },
      ],
      connections: [{ from: 'board-1', fromPin: 'A0', to: 'sensor-1', toPin: 'SDA' }],
    };

    const duplicated = duplicateProject(original);

    expect(duplicated.id).not.toBe(original.id);
    expect(duplicated.name).toBe('Source copia');
    expect(duplicated.files[0].id).not.toBe(original.files[0].id);
    expect(duplicated.electronicLab?.components[0].id).not.toBe(original.electronicLab?.components[0].id);
    expect(duplicated.electronicLab?.connections[0].from).toBe(duplicated.electronicLab?.components[0].id);
    expect(new Uint8Array(duplicated.digitalTwin?.assets?.[0].data ?? new ArrayBuffer(0))).toEqual(new Uint8Array([0x10, 0x20, 0x30]));
  });

  it('serializes and restores projects with embedded binary assets', () => {
    const projectToExport = project('exported', 'Exported', '2026-01-06T00:00:00.000Z');
    projectToExport.digitalTwin = {
      kind: 'generated',
      name: 'Bridge',
      assets: [{ name: 'Bridge.glb', type: 'model/gltf-binary', data: new Uint8Array([0x01, 0x02, 0x03, 0x04]).buffer }],
    };

    const serialized = exportProject(projectToExport);
    const restored = importProjectFromJson(serialized);

    expect(restored.name).toBe('Exported');
    expect(new Uint8Array(restored.digitalTwin?.assets?.[0].data ?? new ArrayBuffer(0))).toEqual(new Uint8Array([0x01, 0x02, 0x03, 0x04]));
  });
});
