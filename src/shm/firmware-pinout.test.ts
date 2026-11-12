import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { PINOUT_HEADER_PATH, firmwarePinoutHeader } from './firmware-pinout';

const file = resolve(__dirname, '../..', PINOUT_HEADER_PATH);

describe('pinout.h del firmware', () => {
  it('coincide con los datos que dibujan el circuito', () => {
    const header = firmwarePinoutHeader();
    if (process.env.UPDATE_PINOUT) writeFileSync(file, header);
    expect(existsSync(file)).toBe(true);
    expect(readFileSync(file, 'utf8')).toBe(header);
  });

  it('el bus de sensores sale por SPI1 en AF5', () => {
    const h = firmwarePinoutHeader();
    expect(h).toMatch(/PIN_ACC_SCK_PORT  GPIOB\n#define PIN_ACC_SCK_PIN   3u\n#define PIN_ACC_SCK_MODE  2u\n#define PIN_ACC_SCK_AF    5u/);
    expect(h).toContain('#define SHM_DEBUG_JTAG  0');
  });
});
