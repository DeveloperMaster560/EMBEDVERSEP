import { describe, expect, it } from 'vitest';

import { renodeCandidates, rmcSentence } from './renodeBridge';

describe('puente con Renode', () => {
  it('la trama RMC lleva su suma de control y el estado', () => {
    const s = rmcSentence(new Date(Date.UTC(2026, 10, 12, 12, 0, 5)), true);
    expect(s).toMatch(/^\$GNRMC,120005\.00,A,.*,121126,,,A\*[0-9A-F]{2}\r\n$/);
    const body = s.slice(1, s.indexOf('*'));
    let sum = 0;
    for (const ch of body) sum ^= ch.charCodeAt(0);
    expect(s.slice(s.indexOf('*') + 1, s.indexOf('*') + 3)).toBe(sum.toString(16).toUpperCase().padStart(2, '0'));
    expect(rmcSentence(new Date(0), false)).toContain(',V,');
  });

  it('busca Renode dentro del proyecto antes que en el sistema', () => {
    const c = renodeCandidates('/p', {});
    expect(c[0]).toBe('/p/.tools/renode/Renode.app/Contents/MacOS/macos_run.command');
  });
});
