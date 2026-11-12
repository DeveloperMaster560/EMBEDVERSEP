import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { ShmEmbeddedView } from '../ShmEmbeddedView';
import { ShmStationSimulator } from './ShmStationSimulator';
import { FAULTS } from './station-sim';

const count = (html: string, re: RegExp) => (html.match(re) ?? []).length;

describe('banco de simulación de la estación SHM', () => {
  it('se presenta como gemelo funcional con vibración sintética, con el circuito completo', () => {
    const html = renderToStaticMarkup(<ShmStationSimulator />);
    expect(html).toContain('Gemelo funcional, no emulación');
    expect(html).toContain('sintética');
    expect(count(html, /aria-label="Patilla \d+ /g)).toBe(100);
    expect(html).not.toContain('shm-part-fault');
    expect(count(html, /<option /g)).toBe(10);
  });

  it('cada falla tiene sitio en el circuito y se marca en rojo', () => {
    for (const [id, spec] of Object.entries(FAULTS)) {
      const html = renderToStaticMarkup(<ShmEmbeddedView faults={spec.circuit} simulated />);
      expect(html, id).toContain('shm-part-fault');
      expect(count(html, /shm-wire-fault/g), id).toBeGreaterThan(0);
    }
  });

  it('el PPS marca solo su red, no todo el receptor', () => {
    const html = renderToStaticMarkup(<ShmEmbeddedView faults={FAULTS.pps.circuit} simulated />);
    expect(count(html, /shm-wire-fault/g)).toBe(1);
    const all = renderToStaticMarkup(<ShmEmbeddedView faults={FAULTS.tiempo.circuit} simulated />);
    expect(count(all, /shm-wire-fault/g)).toBe(3);
  });
});
