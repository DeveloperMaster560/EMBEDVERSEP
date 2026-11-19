import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { AvisoIntegridad, BarrasDisponibilidad, FormularioConexion, ListaAvisos, TablaEstaciones, TablaMedidas } from './PlataformaView';
import {
  disponibilidad, enlace, estadosActuales, filasEstaciones, gravedad, hace, retrasoEntrega, seriesPorSensor, tiposDeDatos,
  type EstacionDb, type Medida, type ProyectoDef,
} from './model';
import casa from '../../proyectos/casa-demo/proyecto.json';
import novena from '../../proyectos/novena/proyecto.json';

const AHORA = Date.parse('2026-11-18T18:00:00Z');
const hace_s = (s: number) => new Date(AHORA - s * 1000).toISOString();

const db = (id: string, visto: string | null, extra: Partial<EstacionDb> = {}): EstacionDb => ({
  proyecto_id: 'novena', station_id: id, tipo: 'SD', nombre: id, simulada: true, activa: true, periodo_s: 10,
  ultimo_visto: visto, estado: { states: ['STORAGE_FAULT'] }, ...extra,
});

describe('plataforma: cálculos', () => {
  it('el enlace se lee contra el periodo de la estación', () => {
    expect(enlace(hace_s(15), 10, AHORA)).toBe('en-linea');
    expect(enlace(hace_s(45), 10, AHORA)).toBe('retrasada');
    expect(enlace(hace_s(300), 10, AHORA)).toBe('callada');
    expect(enlace(null, 10, AHORA)).toBe('nunca');
    expect(hace(hace_s(90), AHORA)).toBe('hace 1 min');
  });

  it('la hora en curso solo espera las ventanas que ya debieron llegar', () => {
    const [completa, enCurso] = disponibilidad([
      { hora: '2026-11-18T16:00:00Z', ventanas: 360, normales: 0, sin_gnss: 0, fuera_de_orden: 0 },
      { hora: '2026-11-18T17:30:00Z', ventanas: 150, normales: 0, sin_gnss: 0, fuera_de_orden: 0 },
    ], 10, AHORA);
    expect(completa).toMatchObject({ esperadas: 360, pct: 100 });
    expect(enCurso).toMatchObject({ esperadas: 180 });
    expect(enCurso.pct).toBeCloseTo(83.33, 1);
  });

  it('une el proyecto.json con la base: diseño sin alta y estaciones que el archivo no conoce', () => {
    const def = structuredClone(novena) as unknown as ProyectoDef;
    def.estaciones.push({ ...def.estaciones[0], id: 'SD-V1-Q1', estado: 'diseno' });
    const filas = filasEstaciones(def, [db('SD-V2-M', hace_s(5)), db('HUERFANA', null)], AHORA);
    expect(filas.map((f) => [f.id, f.estadoProyecto, f.enlace])).toEqual([
      ['SD-V2-M', 'simulada', 'en-linea'],
      ['SD-V1-Q1', 'diseno', 'sin-alta'],
      ['HUERFANA', null, 'nunca'],
    ]);
  });

  it('estados de la última ventana y retraso desde el final de la ventana', () => {
    expect(estadosActuales(db('A', null, { estado: null, ultimos_estados: ['STORAGE_FAULT'] }))).toEqual(['STORAGE_FAULT']);
    expect(estadosActuales(db('A', null, { estado: null }))).toEqual([]);
    expect(retrasoEntrega({ inicio: '2026-11-18T17:00:00Z', recibido: '2026-11-18T17:00:10.300Z', duracion_s: 10 })).toBeCloseTo(0.3);
  });

  it('gravedad de una ventana', () => {
    expect(gravedad(['NORMAL'])).toBe('ok');
    expect(gravedad(['STORAGE_FAULT'])).toBe('aviso');
    expect(gravedad(['STORAGE_FAULT', 'SENSOR_FAULT'])).toBe('falla');
  });
});

describe('plataforma: vista', () => {
  it('el formulario explica que el token decide el alcance y no pide nada más', () => {
    const html = renderToStaticMarkup(<FormularioConexion urlInicial="http://127.0.0.1:8000" error={null} ocupado={false} onConectar={() => undefined} />);
    expect(html).toContain('un proyecto');
    expect(html).toContain('type="password"');
    expect(html).toContain('gestion token --rol lectura --proyecto');
  });

  it('La Novena, hoy, avisa de que faltan ingeniero responsable y umbrales', () => {
    const html = renderToStaticMarkup(<AvisoIntegridad def={novena as unknown as ProyectoDef} />);
    expect(html).toContain('Sin ingeniero estructural responsable');
    expect(html).toContain('Sin umbrales aprobados');
    const firmado = { ...novena, responsable_estructural: 'Ing. X', criterios: { ...novena.criterios, estado: 'aprobados', aprobados_por: 'Ing. X' } };
    expect(renderToStaticMarkup(<AvisoIntegridad def={firmado as unknown as ProyectoDef} />)).toBe('');
  });

  it('la tabla muestra lo que dice el proyecto y lo que dice la estación', () => {
    const filas = filasEstaciones(novena as unknown as ProyectoDef, [db('SD-V2-M', hace_s(5))], AHORA);
    const html = renderToStaticMarkup(<TablaEstaciones filas={filas} seleccion="SD-V2-M" ahora={AHORA} onSeleccionar={() => undefined} />);
    expect(html).toContain('simulada');
    expect(html).toContain('en línea');
    expect(html).toContain('STORAGE_FAULT');
    expect(html).toContain('plat-sel');
  });

  it('barras de 24 h y avisos', () => {
    const svg = renderToStaticMarkup(<BarrasDisponibilidad periodoS={10} ahora={AHORA}
      horas={[{ hora: '2026-11-18T16:00:00Z', ventanas: 300, normales: 0, sin_gnss: 0, fuera_de_orden: 0 }]} />);
    expect(svg).toContain('plat-b-falla'); // 300/360 = 83 %
    const lista = renderToStaticMarkup(<ListaAvisos ahora={AHORA} avisos={[{ id: 1, station_id: 'SD-V2-M', proyecto_id: 'novena',
      categoria: 'medicion', nivel: 'E1', codigo: 'STORAGE_FAULT', detalle: 'La microSD no guarda.', creado: hace_s(60), abierto: true }]} />);
    expect(lista).toContain('plat-E1');
    expect(lista).toContain('hace 1 min');
  });
});

describe('plataforma: medidas (sensores lentos)', () => {
  const m = (sensor: string, t: string, valor: number | null, error: string | null = null): Medida => ({
    sensor_id: sensor, instante: t, magnitud: 'tension', unidad: 'V', valor, error, calidad_tiempo: 'NTP',
  });

  it('cada estación dice si manda ventanas, medidas o ambas', () => {
    const est = (id: string) => (novena as unknown as ProyectoDef).estaciones.find((e) => e.id === id);
    expect(tiposDeDatos(est('SD-V2-M'))).toEqual({ ventanas: true, medidas: false });
    expect(tiposDeDatos((casa as unknown as ProyectoDef).estaciones[0])).toEqual({ ventanas: false, medidas: true });
  });

  it('agrupa por sensor en orden de tiempo y conserva los huecos', () => {
    const s = seriesPorSensor([m('V', '2026-11-19T10:00:20Z', null, 'PZEM sin respuesta'), m('V', '2026-11-19T10:00:00Z', 120.9), m('V', '2026-11-19T10:00:10Z', 118.4)]);
    expect(s).toHaveLength(1);
    expect(s[0].puntos.map((p) => p.v)).toEqual([120.9, 118.4, null]);
    expect(s[0].ultima.error).toBe('PZEM sin respuesta');
  });

  it('la tabla muestra el último valor y, si no leyó, el motivo (nunca un 0)', () => {
    const html = renderToStaticMarkup(<TablaMedidas medidas={[m('V', '2026-11-19T09:59:50Z', 121.0), m('V', '2026-11-19T10:00:00Z', 120.9), m('V', '2026-11-19T10:00:10Z', null, 'PZEM sin respuesta')]} />);
    expect(html).toContain('sin lectura · PZEM sin respuesta');
    expect(html).toContain('<path');
    expect(renderToStaticMarkup(<TablaMedidas medidas={[]} />)).toContain('Sin medidas');
  });
});

describe('enlace modelo 3D ↔ estación', () => {
  it('la estación del tablero de la casa está en el componente ELE-TAB-TG del modelo', async () => {
    const { estacionesEn } = await import('./DatosDelComponente');
    const est = (casa as unknown as ProyectoDef).estaciones;
    expect(estacionesEn(est, 'ELE-TAB-TG').map((e) => e.id)).toEqual(['CASA-TAB-01']);
    expect(estacionesEn(est, 'ELE-CIR-001')).toEqual([]);
    // Las de La Novena no tienen elemento del modelo todavía (lo fija el ingeniero): nada que enlazar, nada inventado.
    expect(estacionesEn((novena as unknown as ProyectoDef).estaciones, 'null')).toEqual([]);
  });
});
