import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { StationCircuit } from './StationCircuit';

describe('panel del circuito de la estación', () => {
  const html = renderToStaticMarkup(<StationCircuit />);

  it('dibuja el bus corregido con sus pines físicos, leídos de los datos', () => {
    expect(html).toContain('PB3·PB4·PB5 (89·90·91)');
    expect(html).toContain('SPI1 AF5');
    expect(html).not.toContain('PB13 (52)');
  });

  it('marca la propuesta como sin firmar', () => {
    expect(html).toContain('propuesta sin firmar');
    expect(html).toContain('PD4·PD5 (85·86)');
  });

  it('no deja ninguna señal sin pin', () => {
    expect(html).not.toContain('sin pin');
  });
});
