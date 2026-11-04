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

  it('rejects invalid scene records and malformed geometry', () => {
    expect(() => parseBridgeScene('{bad json', 'p')).toThrow(/JSON válido/);
    const scene = createScene('p', 'Bad');
    scene.objects.push({ ...createPrimitive('box'), kind: 'custom' });
    expect(() => parseBridgeScene(JSON.stringify(scene), 'p')).toThrow(/evbridge válido/);
  });
});
