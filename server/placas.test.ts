import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buscarPlaca, comoInstalar, nucleoInstalado, PLACAS } from './placas';

describe('lista de placas del compilador', () => {
  it('tiene identificadores únicos y FQBN bien formados', () => {
    const ids = PLACAS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of PLACAS) {
      expect(p.fqbn, p.id).toMatch(/^[A-Za-z0-9_-]+:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+(:[A-Za-z0-9_=,-]+)?$/);
      expect(p.fqbn.startsWith(`${p.paquete}:`), p.id).toBe(true);
      if (p.indice !== null) expect(p.indice, p.id).toMatch(/^https:\/\//);
    }
  });

  it('conserva las dos placas que ya usaban los proyectos', () => {
    expect(buscarPlaca('arduino-uno')?.fqbn).toBe('arduino:avr:uno');
    expect(buscarPlaca('esp32-devkit')?.fqbn).toBe('esp32:esp32:esp32');
    expect(buscarPlaca('no-existe')).toBeUndefined();
  });

  it('detecta un núcleo instalado en el directorio de este sistema', async () => {
    const raiz = await mkdtemp(path.join(os.tmpdir(), 'placas-'));
    try {
      const esp32 = buscarPlaca('esp32-devkit')!;
      expect(await nucleoInstalado(raiz, esp32, 'win32')).toBeNull();
      const dir = path.join(raiz, '.tools', 'arduino-data', 'packages', 'esp32', 'hardware', 'esp32', '3.3.13');
      await mkdir(dir, { recursive: true });
      await writeFile(path.join(dir, 'platform.txt'), 'name=esp32\n');
      expect(await nucleoInstalado(raiz, esp32, 'win32')).toBe(path.join(raiz, '.tools', 'arduino-data'));
      expect(comoInstalar(esp32, 'win32')).toContain('scripts\\placas.ps1 nucleo esp32-devkit');
      expect(comoInstalar(esp32, 'darwin')).toContain('sh scripts/placas.sh nucleo esp32-devkit');
    } finally {
      await rm(raiz, { recursive: true, force: true });
    }
  });
});
