import 'fake-indexeddb/auto';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { createPrimitive, createScene } from './scene';
import { loadBridgeScene, saveBridgeScene } from './persistence';

describe('bridge scene persistence', () => {
  beforeAll(() => {
    vi.stubGlobal('window', globalThis);
  });

  it('stores recoverable scene objects by project ID without mixing projects', async () => {
    const first = createScene('bridge-project-a', 'Bridge A');
    first.objects.push(createPrimitive('box'));
    const second = createScene('bridge-project-b', 'Bridge B');

    await saveBridgeScene(first);
    await saveBridgeScene(second);

    expect((await loadBridgeScene(first.projectId))?.objects[0].name).toBe('Box');
    expect((await loadBridgeScene(second.projectId))?.objects).toEqual([]);
    expect(await loadBridgeScene('missing-project')).toBeUndefined();
  });
});
