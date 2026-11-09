import { describe, expect, it } from 'vitest';
import { parseComponentLibrary } from './componentLibrary';

/**
 * Los paquetes de `public/libraries` se descargan desde la barra lateral del
 * laboratorio. Si uno no pasa el propio validador del laboratorio, el usuario
 * se encuentra un error al importar justo lo que nosotros le dimos.
 *
 * Se cargan con `import.meta.glob` y no con `node:fs` para que la prueba viva
 * en el mismo proyecto de TypeScript que la aplicación.
 */
const packages = import.meta.glob('../../public/libraries/*.json', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const entries = Object.entries(packages);

describe('paquetes de componentes distribuidos', () => {
  it('se distribuye al menos un paquete', () => {
    expect(entries.length).toBeGreaterThan(0);
  });

  it.each(entries)('%s pasa el validador del laboratorio', (_path, contents) => {
    const parsed = parseComponentLibrary(contents);
    expect(parsed.components.length).toBeGreaterThan(0);
    for (const component of parsed.components) {
      // Sin pin de masa un componente no se puede cablear de forma útil.
      expect(component.pins.some((pin) => pin.type === 'ground')).toBe(true);
      // Alimentar fuera de rango destruye hardware: el rango es obligatorio.
      expect(component.operatingVoltage).not.toBeNull();
    }
  });
});
