import { describe, expect, it } from 'vitest';
import { createPrimitive, createScene } from './scene';
import { parseBridgeScene } from './serialization';

describe('bridge project serialization', () => {
  it('restores a valid evbridge scene for the requested host project', () => {
    const scene = createScene('old-project', 'Bridge');
    scene.objects.push(createPrimitive('box'));

    const restored = parseBridgeScene(JSON.stringify(scene), 'host-project');

    expect(restored.projectId).toBe('host-project');
    expect(restored.objects).toHaveLength(1);
  });

  it('loads legacy scenes without groups and validates persistent group membership', () => {
    const scene = createScene('p', 'Grouped');
    const group = { id: 'group-1', name: 'Vigas principales' };
    const member = { ...createPrimitive('box'), groupId: group.id };
    scene.objects.push(member);
    scene.groups = [group];

    const restored = parseBridgeScene(JSON.stringify(scene), 'p');
    expect(restored.groups).toEqual([group]);
    expect(restored.objects[0].groupId).toBe(group.id);

    const legacy = { ...scene, groups: undefined, objects: [{ ...member, groupId: undefined }] };
    expect(parseBridgeScene(JSON.stringify(legacy), 'p').groups).toEqual([]);
    expect(() => parseBridgeScene(JSON.stringify({ ...scene, groups: [] }), 'p')).toThrow(/grupo inexistente/);
  });

  it('rejects invalid scene records and malformed geometry', () => {
    expect(() => parseBridgeScene('{bad json', 'p')).toThrow(/JSON válido/);
    const scene = createScene('p', 'Bad');
    scene.objects.push({ ...createPrimitive('box'), kind: 'custom' });
    expect(() => parseBridgeScene(JSON.stringify(scene), 'p')).toThrow(/evbridge válido/);
  });
});
