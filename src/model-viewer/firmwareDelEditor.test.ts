import { describe, expect, it } from 'vitest';

import { firmwareDelEditor, guardarFirmwareDelEditor } from './firmwareDelEditor';

const HEX = ':0400000001020304F2\n:00000001FF\n';

describe('firmware del editor → puente 3D', () => {
  it('un .hex de Uno queda disponible para el visor del mismo proyecto, y solo de ese', () => {
    expect(guardarFirmwareDelEditor('p1', new TextEncoder().encode(HEX), 'alumbrado.hex')).toEqual({ ok: true });
    expect(firmwareDelEditor('p1')?.name).toBe('alumbrado.hex');
    expect(firmwareDelEditor('p1')?.hex).toContain(':00000001FF');
    expect(firmwareDelEditor('p2')).toBeNull();
    expect(firmwareDelEditor(undefined)).toBeNull();
  });

  it('un binario de ESP32 no se ofrece al puente y borra el .hex anterior del proyecto', () => {
    guardarFirmwareDelEditor('p3', new TextEncoder().encode(HEX), 'a.hex');
    const r = guardarFirmwareDelEditor('p3', new Uint8Array([0xe9, 0x03, 0x02, 0x20, 0, 0, 0, 0]), 'estacion.ino.bin');
    expect(r.ok).toBe(false);
    expect(firmwareDelEditor('p3')).toBeNull();
  });
});
