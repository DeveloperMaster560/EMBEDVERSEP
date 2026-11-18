import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { ProyectoDef } from '../plataforma/model';
import { AvisoVinculo } from '../plataforma/PlataformaView';
import { ProyectoShmFicha, SelectorProyectoShm } from './ProyectoShmFicha';
import { PROYECTOS_SHM, admiteGemelo, buscarProyecto, cargarProyectos, pendientes } from './proyectos';
import plantilla from '../../proyectos/PLANTILLA.proyecto.json';

describe('proyectos SHM en la app', () => {
  it('lee los mismos proyectos que la plataforma', () => {
    const ids = PROYECTOS_SHM.map((p) => p.def?.proyecto_id);
    expect(ids).toContain('novena');
    expect(ids).toContain('novena-gemelo');
    expect(PROYECTOS_SHM.every((p) => p.problemas.length === 0)).toBe(true);
  });

  it('un archivo inválido o en carpeta equivocada no se muestra y dice por qué', () => {
    const l = cargarProyectos({
      '../../proyectos/roto/proyecto.json': { default: { nombre: 'x' } },
      '../../proyectos/otra/proyecto.json': { default: { ...plantilla } },
    });
    expect(l.every((p) => p.def === null)).toBe(true);
    expect(l.find((p) => p.carpeta === 'roto')!.problemas.join(' ')).toContain('formato');
    expect(l.find((p) => p.carpeta === 'otra')!.problemas.join(' ')).toContain('debe coincidir con la carpeta');
  });

  it('el gemelo funcional solo con La Novena', () => {
    expect(admiteGemelo(buscarProyecto('novena'))).toBe(true);
    expect(admiteGemelo(buscarProyecto('novena-gemelo'))).toBe(true);
    expect(admiteGemelo({ ...(plantilla as unknown as ProyectoDef) })).toBe(false);
    expect(admiteGemelo(null)).toBe(false);
  });

  it('La Novena hoy: lo pendiente se dice, no se inventa', () => {
    const f = pendientes(buscarProyecto('novena')!);
    expect(f).toContain('Ingeniero estructural responsable');
    expect(f).toContain('Umbrales aprobados y firmados');
    expect(f).toContain('Ubicación exacta de 1 estación');
    expect(f).toContain('Calibración de 1 sensor');
  });

  it('ficha de cualquier estructura, por ejemplo un edificio', () => {
    const edificio = { ...(plantilla as unknown as ProyectoDef), estructura: { tipo: 'edificio', nombre: 'Bloque A' } };
    const html = renderToStaticMarkup(<ProyectoShmFicha def={edificio} />);
    expect(html).toContain('Edificio · Bloque A');
    expect(html).toContain('PLA-SD-N1');
    expect(html).toContain('PENDIENTE');
    expect(renderToStaticMarkup(<SelectorProyectoShm valor="borrado" onCambiar={() => undefined} />)).toContain('ya no está en proyectos/');
  });

  it('avisa si el token conectado no ve el proyecto vinculado', () => {
    const sesion = { nombre: 'x', rol: 'lectura' as const, proyecto_id: 'novena', station_id: null };
    expect(renderToStaticMarkup(<AvisoVinculo vinculado="novena-gemelo" sesion={sesion} visibles={['novena']} />)).toContain('no lo ve');
    expect(renderToStaticMarkup(<AvisoVinculo vinculado="novena" sesion={sesion} visibles={['novena']} />)).toBe('');
  });
});
