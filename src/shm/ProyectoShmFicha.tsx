/**
 * Ficha del proyecto SHM vinculado: lo que dice su proyecto.json, para
 * cualquier puente o edificio. Solo muestra; lo que falta se dice que falta.
 */

import '../plataforma/plataforma.css';
import './shm-embedded.css';

import type { ProyectoDef } from '../plataforma/model';
import { AvisoIntegridad } from '../plataforma/PlataformaView';
import { PROYECTOS_SHM, TEXTO_ESTADO_ESTACION, TEXTO_ESTRUCTURA, pendientes, type ProyectoCargado } from './proyectos';

const nd = (v: unknown) => (v === null || v === undefined || v === '' ? <span className="shm-muted">PENDIENTE</span> : String(v));

export function SelectorProyectoShm({ valor, onCambiar, lista = PROYECTOS_SHM }: {
  valor: string | undefined;
  onCambiar: (id: string | undefined) => void;
  lista?: ProyectoCargado[];
}) {
  const validos = lista.filter((p) => p.def);
  const invalidos = lista.filter((p) => !p.def);
  return (
    <div className="plat-sesion">
      <label>
        Estructura monitorizada{' '}
        <select value={valor ?? ''} onChange={(e) => onCambiar(e.target.value || undefined)}>
          <option value="">— sin vincular —</option>
          {validos.map((p) => (
            <option key={p.carpeta} value={p.def!.proyecto_id}>
              {p.def!.nombre} ({TEXTO_ESTRUCTURA[p.def!.estructura.tipo] ?? p.def!.estructura.tipo})
            </option>
          ))}
        </select>
      </label>
      {valor && !validos.some((p) => p.def!.proyecto_id === valor) && (
        <span className="plat-g-falla">El proyecto «{valor}» ya no está en proyectos/.</span>
      )}
      {invalidos.length > 0 && (
        <span className="plat-g-aviso" title={invalidos.map((p) => `${p.carpeta}: ${p.problemas.join(' ')}`).join('\n')}>
          {invalidos.length} proyecto(s) con errores en proyectos/ (no se muestran)
        </span>
      )}
    </div>
  );
}

export function ProyectoShmFicha({ def }: { def: ProyectoDef }) {
  const falta = pendientes(def);
  const u = def.ubicacion;
  return (
    <div className="shm-root">
      <header>
        <div className="shm-eyebrow">proyectos/{def.proyecto_id}/proyecto.json</div>
        <h2 style={{ margin: '2px 0' }}>{def.nombre}</h2>
        <div className="shm-muted">
          {TEXTO_ESTRUCTURA[def.estructura.tipo] ?? def.estructura.tipo} · {def.estructura.nombre ?? def.nombre}
          {u ? ` · ${[u.municipio, u.region, u.pais].filter(Boolean).join(', ')}` : ''}
        </div>
      </header>

      <AvisoIntegridad def={def} />

      <div className="shm-layout">
        <section className="shm-card">
          <h3>Responsables y criterios</h3>
          <table className="shm-table">
            <tbody>
              <tr><th>Ingeniero estructural</th><td>{nd(def.responsable_estructural)}</td></tr>
              <tr><th>Entidad responsable</th><td>{nd(def.entidad_responsable)}</td></tr>
              <tr><th>Institución</th><td>{nd(def.institucion)}</td></tr>
              <tr><th>Criterios</th><td>
                {def.criterios.estado === 'aprobados'
                  ? `aprobados por ${def.criterios.aprobados_por} (${def.criterios.fecha ?? 'sin fecha'}) · ${def.criterios.umbrales.length} umbrales`
                  : def.criterios.estado === 'propuestos' ? 'propuestos, sin aprobar' : 'sin definir'}
              </td></tr>
              {u && <tr><th>Ubicación</th><td>{u.latitud ?? '—'}, {u.longitud ?? '—'}{u.procedencia ? ` · ${u.procedencia}` : ''}</td></tr>}
            </tbody>
          </table>
        </section>

        <section className="shm-card">
          <h3>Lo que falta para operar</h3>
          {falta.length ? <ul>{falta.map((f) => <li key={f}>{f}</li>)}</ul> : <p className="plat-g-ok">Nada: el proyecto está completo.</p>}
          {def.notas?.length ? <><h3>Notas</h3><ul>{def.notas.map((n) => <li key={n}>{n}</li>)}</ul></> : null}
        </section>
      </div>

      <section className="shm-card">
        <h3>Estaciones ({def.estaciones.length})</h3>
        {def.estaciones.length === 0 ? <p className="shm-note">Este proyecto todavía no tiene estaciones.</p> : (
          <div className="plat-scroll">
            <table className="shm-table">
              <thead><tr><th>Estación</th><th>Estado</th><th>Ubicación</th><th>Hardware</th><th>Comunicación</th><th>Sensores</th></tr></thead>
              <tbody>
                {def.estaciones.map((e) => (
                  <tr key={e.id}>
                    <td><b>{e.id}</b><br /><span className="shm-muted">{e.nombre} · {e.tipo}</span></td>
                    <td>{TEXTO_ESTADO_ESTACION[e.estado] ?? e.estado}</td>
                    <td>{e.ubicacion?.elemento ?? e.ubicacion?.descripcion ?? nd(null)}</td>
                    <td>{nd(e.hardware?.placa)}<br /><span className="shm-muted">{e.hardware?.firmware_version ?? ''}</span></td>
                    <td>{e.comunicacion?.protocolo ?? '—'}{e.comunicacion?.periodo_s ? ` · cada ${e.comunicacion.periodo_s} s` : ''}</td>
                    <td>
                      {(e.sensores ?? []).map((s) => (
                        <div key={s.id}>
                          {s.modelo} · {s.magnitud} ({s.unidad}){s.muestreo_hz ? ` · ${s.muestreo_hz} Hz` : ''}
                          {!s.calibracion && <span className="plat-g-aviso"> · sin calibrar</span>}
                        </div>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="shm-note">
          Para cambiar algo, edita el proyecto.json (ver proyectos/LEEME.md) y reinicia la plataforma; la app lo relee sola.
        </p>
      </section>
    </div>
  );
}
