import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { pinoutTable } from './engineering-proposal';
import { ShmEmbeddedView, buildPins } from './ShmEmbeddedView';
import { BOARD_PARTS } from './station-board';

describe('sistema embebido de la estación SHM', () => {
  const html = renderToStaticMarkup(<ShmEmbeddedView />);
  const pins = buildPins(pinoutTable());

  it('dibuja las 100 patillas', () => {
    expect(html.match(/aria-label="Patilla \d+ /g)).toHaveLength(100);
  });

  it('dice qué parte del firmware existe y qué falta', () => {
    expect(html).toContain('Vista de diseño');
    expect(html).not.toContain('todavía no está escrito');
    expect(html).toContain('esqueleto');
    expect(html).toContain('sin escribir');
  });

  it('cada terminal de componente llega a una patilla real del chip', () => {
    const nets = new Set(pins.map((p) => p.net).filter(Boolean));
    for (const part of BOARD_PARTS) {
      for (const pin of part.pins) if (pin.net) expect(nets.has(pin.net), `${part.id}.${pin.label}`).toBe(true);
    }
  });

  it('todo el circuito sale: ninguna patilla usada queda sin su componente', () => {
    const drawn = new Set(BOARD_PARTS.flatMap((p) => p.pins.map((x) => x.net)));
    for (const p of pins.filter((x) => x.net)) expect(drawn.has(p.net), `${p.number} ${p.net}`).toBe(true);
  });

  it('el bus SPI llega a los tres dispositivos que lo comparten', () => {
    const onBus = BOARD_PARTS.filter((p) => p.pins.some((x) => x.net === 'ACC_SCK')).map((p) => p.id).sort();
    expect(onBus).toEqual(['ads1262', 'adxl355', 'scl3300']);
  });
});
