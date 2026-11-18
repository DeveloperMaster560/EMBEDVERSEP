/**
 * «Plataforma de datos (en vivo)»: lo que la plataforma SHM tiene guardado del
 * proyecto al que pertenece el token. Solo lectura. La app no decide qué se ve:
 * la plataforma solo devuelve lo del proyecto del token (el admin, todos).
 */

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';

import { ErrorPlataforma, plataforma, type Conexion } from './api';
import {
  TEXTO_ENLACE, TEXTO_ESTADO, disponibilidad, estadosActuales, filasEstaciones, gravedad, hace, horaCorta, retrasoEntrega,
  type Aviso, type EstacionDb, type FilaEstacion, type HoraDisponibilidad, type ProyectoDef, type ProyectoFicha,
  type ProyectoResumen, type Sesion, type Ventana,
} from './model';
import '../shm/shm-embedded.css';
import './plataforma.css';

const REFRESCO_MS = 10_000;

/* ─────────────────────────── piezas de presentación ─────────────────────────── */

export function FormularioConexion({ urlInicial, error, ocupado, onConectar }: {
  urlInicial: string; error: string | null; ocupado: boolean; onConectar: (url: string, token: string) => void;
}) {
  const [url, setUrl] = useState(urlInicial);
  const [token, setToken] = useState('');
  const enviar = (e: FormEvent) => {
    e.preventDefault();
    onConectar(url, token);
  };
  return (
    <section className="shm-card plat-conectar">
      <h3>Conectar con la plataforma de datos</h3>
      <p className="shm-note">
        El token decide qué ves: cada token pertenece a <b>un proyecto</b> y la plataforma no devuelve nada de otros.
        Se guarda solo en el servidor local de la app (<code>.embedverse/plataforma.json</code>, fuera del repositorio); el
        navegador no lo vuelve a ver.
      </p>
      <form onSubmit={enviar} className="plat-form">
        <label>Dirección de la plataforma
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="http://127.0.0.1:8000" />
        </label>
        <label>Token
          <input type="password" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" placeholder="pega aquí el token" />
        </label>
        <button type="submit" className="primary-button" disabled={ocupado || token.trim().length < 20}>
          {ocupado ? 'Comprobando…' : 'Conectar'}
        </button>
      </form>
      {error && <p className="shm-warn">{error}</p>}
      <details className="shm-note">
        <summary>¿De dónde saco un token?</summary>
        <p>Desde la carpeta <code>plataforma</code>, con la plataforma arrancada:</p>
        <pre className="shm-json">docker compose exec api python -m shm_plataforma.gestion token --rol lectura --proyecto novena --nombre "Mi equipo"</pre>
        <p>Cambia <code>novena</code> por el identificador de tu proyecto (<code>gestion proyectos</code> los lista).</p>
      </details>
    </section>
  );
}

export function AvisoIntegridad({ def }: { def: ProyectoDef | null }) {
  if (!def) return <p className="shm-warn">La plataforma no tiene la definición de este proyecto (proyecto.json). Reinicia la plataforma para importarla.</p>;
  const sinResponsable = !def.responsable_estructural;
  const sinCriterios = def.criterios.estado !== 'aprobados';
  if (!sinResponsable && !sinCriterios) return null;
  return (
    <p className="shm-warn">
      {sinResponsable && <><b>Sin ingeniero estructural responsable asignado</b>: ubicaciones y criterios están PENDIENTES. </>}
      {sinCriterios && <><b>Sin umbrales aprobados</b>: la plataforma solo clasifica comunicación y calidad de la medición; no
        emite juicios sobre el estado de la estructura (los niveles E3/E4 solo los asigna el ingeniero del proyecto).</>}
    </p>
  );
}

export function TablaEstaciones({ filas, seleccion, ahora, onSeleccionar }: {
  filas: FilaEstacion[]; seleccion: string | null; ahora: number; onSeleccionar: (id: string) => void;
}) {
  if (filas.length === 0) return <p className="shm-note">Este proyecto todavía no tiene estaciones.</p>;
  return (
    <table className="shm-table plat-estaciones">
      <thead>
        <tr><th>Estación</th><th>Proyecto dice</th><th>Enlace</th><th>Último dato</th><th>Estados</th></tr>
      </thead>
      <tbody>
        {filas.map((f) => {
          const estados = f.db ? estadosActuales(f.db) : [];
          return (
            <tr key={f.id} className={f.id === seleccion ? 'plat-sel' : undefined}>
              <td>
                <button type="button" className="plat-link" onClick={() => onSeleccionar(f.id)} disabled={!f.db}>
                  <b>{f.id}</b>
                </button>
                <div className="shm-note" style={{ margin: 0 }}>{f.nombre} · {f.tipo}</div>
              </td>
              <td>{f.estadoProyecto ? TEXTO_ESTADO[f.estadoProyecto] : <span className="shm-st-bad">no está en el proyecto.json</span>}</td>
              <td><span className={`plat-enlace plat-${f.enlace}`}>{TEXTO_ENLACE[f.enlace]}</span></td>
              <td>{f.db ? hace(f.db.ultimo_visto, ahora) : '—'}</td>
              <td>{estados.length ? estados.map((s) => <span key={s} className={`plat-estado plat-g-${gravedad([s])}`}>{s}</span>) : '—'}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export function BarrasDisponibilidad({ horas, periodoS, ahora }: { horas: HoraDisponibilidad[]; periodoS: number; ahora: number }) {
  const datos = disponibilidad(horas, periodoS, ahora);
  if (datos.length === 0) return <p className="shm-note">Sin ventanas en las últimas 24 h.</p>;
  const W = 24 * 14;
  const H = 70;
  const ancho = W / 24;
  const fin = Math.floor(ahora / 3_600_000);
  return (
    <svg className="plat-barras" viewBox={`0 0 ${W} ${H + 14}`} role="img" aria-label="Disponibilidad por hora, últimas 24 horas">
      {datos.map((d) => {
        const k = 23 - (fin - Math.floor(Date.parse(d.hora) / 3_600_000));
        if (k < 0 || k > 23) return null;
        const h = (d.pct / 100) * H;
        return (
          <rect key={d.hora} x={k * ancho + 1} y={H - h} width={ancho - 2} height={h}
            className={d.pct >= 99 ? 'plat-b-ok' : d.pct >= 90 ? 'plat-b-aviso' : 'plat-b-falla'}>
            <title>{`${new Date(d.hora).toLocaleString()}: ${d.ventanas}/${d.esperadas} ventanas (${d.pct.toFixed(1)} %)`}</title>
          </rect>
        );
      })}
      <line x1={0} x2={W} y1={H} y2={H} className="plat-eje" />
      <text x={0} y={H + 12} className="plat-txt">−24 h</text>
      <text x={W} y={H + 12} className="plat-txt" textAnchor="end">ahora</text>
    </svg>
  );
}

export function FranjaVentanas({ ventanas }: { ventanas: Ventana[] }) {
  if (ventanas.length === 0) return <p className="shm-note">Sin ventanas en la última hora.</p>;
  const orden = [...ventanas].reverse();
  return (
    <div className="plat-franja" role="img" aria-label={`Calidad de las últimas ${ventanas.length} ventanas`}>
      {orden.map((v) => (
        <span key={v.inicio} className={`plat-celda plat-g-${gravedad(v.estados)}`} title={`${v.inicio} · ${v.estados.join(', ') || 'sin estados'}`} />
      ))}
    </div>
  );
}

export function TablaVentanas({ ventanas }: { ventanas: Ventana[] }) {
  return (
    <div className="plat-scroll">
    <table className="shm-table">
      <thead><tr><th>Inicio (estación)</th><th title="Desde que termina la ventana hasta que llega al servidor">Retraso</th><th>Tiempo</th><th>Muestras</th><th>Huecos</th><th>Sat.</th><th>Estados</th></tr></thead>
      <tbody>
        {ventanas.slice(0, 8).map((v) => {
          const retraso = retrasoEntrega(v);
          return (
            <tr key={v.inicio}>
              <td>{horaCorta(v.inicio)}{v.fuera_de_orden && <span className="plat-estado plat-g-aviso">fuera de orden</span>}</td>
              <td className={retraso < 0 ? 'plat-g-aviso' : undefined}
                title={retraso < 0 ? 'Llegó antes de que terminara la ventana según el reloj del servidor: el reloj de la estación va adelantado.' : undefined}>
                {retraso.toFixed(1).replace('.', ',')} s
              </td>
              <td>{v.calidad_tiempo}</td>
              <td>{v.muestras ?? '—'}</td>
              <td>{v.huecos ?? '—'}</td>
              <td>{v.saturadas ?? '—'}</td>
              <td>{v.estados.map((s) => <span key={s} className={`plat-estado plat-g-${gravedad([s])}`}>{s}</span>)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
    </div>
  );
}

export function ListaAvisos({ avisos, ahora }: { avisos: Aviso[]; ahora: number }) {
  if (avisos.length === 0) return <p className="shm-note">No hay avisos abiertos.</p>;
  return (
    <ul className="shm-log plat-avisos">
      {avisos.map((a) => (
        <li key={a.id}>
          <span className={`plat-nivel plat-${a.nivel}`}>{a.nivel}</span> <b>{a.station_id}</b> · {a.codigo}
          <span className="shm-note" style={{ marginLeft: 6 }}>{a.categoria} · {hace(a.creado, ahora)}</span>
          <div className="shm-note" style={{ margin: 0 }}>{a.detalle}</div>
        </li>
      ))}
    </ul>
  );
}

/* ─────────────────────────────────── vista ─────────────────────────────────── */

function mensaje(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function PlataformaView() {
  const [conexion, setConexion] = useState<Conexion | null>(null);
  const [sesion, setSesion] = useState<Sesion | null>(null);
  const [proyectos, setProyectos] = useState<ProyectoResumen[]>([]);
  const [proyectoId, setProyectoId] = useState<string | null>(null);
  const [ficha, setFicha] = useState<ProyectoFicha | null>(null);
  const [estaciones, setEstaciones] = useState<EstacionDb[]>([]);
  const [avisos, setAvisos] = useState<Aviso[]>([]);
  const [estacionId, setEstacionId] = useState<string | null>(null);
  const [ventanas, setVentanas] = useState<Ventana[]>([]);
  const [horas, setHoras] = useState<HoraDisponibilidad[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [ahora, setAhora] = useState(() => Date.now());

  const cargarSesion = useCallback(async () => {
    try {
      const c = await plataforma.conexion();
      setConexion(c);
      if (!c.configurada) return;
      const [s, ps] = await Promise.all([plataforma.sesion(), plataforma.proyectos()]);
      setSesion(s);
      setProyectos(ps);
      setProyectoId((actual) => actual ?? s.proyecto_id ?? ps[0]?.proyecto_id ?? null);
      setError(null);
    } catch (e) {
      setError(mensaje(e));
    }
  }, []);

  useEffect(() => {
    // Carga inicial: la sesión llega por red; el estado se fija al responder.
    // oxlint-disable-next-line react/set-state-in-effect
    void cargarSesion();
  }, [cargarSesion]);

  // Datos del proyecto, refrescados cada 10 s (el periodo de las ventanas).
  useEffect(() => {
    if (!sesion || !proyectoId) return;
    let vivo = true;
    const tick = async () => {
      try {
        const [f, es, av] = await Promise.all([plataforma.proyecto(proyectoId), plataforma.estaciones(), plataforma.avisos()]);
        if (!vivo) return;
        setFicha(f);
        setEstaciones(es.filter((e) => e.proyecto_id === proyectoId));
        setAvisos(av.filter((a) => a.proyecto_id === proyectoId));
        setAhora(Date.now());
        setError(null);
      } catch (e) {
        if (vivo) setError(mensaje(e));
      }
    };
    void tick();
    const t = setInterval(tick, REFRESCO_MS);
    return () => { vivo = false; clearInterval(t); };
  }, [sesion, proyectoId]);

  const filas = useMemo(() => filasEstaciones(ficha?.definicion ?? null, estaciones, ahora), [ficha, estaciones, ahora]);

  // La elegida si sigue teniendo datos; si no, la primera que los tenga.
  const estacionSel = filas.some((f) => f.id === estacionId && f.db) ? estacionId : (filas.find((f) => f.db)?.id ?? null);

  const ultimoVistoSel = estaciones.find((e) => e.station_id === estacionSel)?.ultimo_visto ?? null;
  useEffect(() => {
    if (!estacionSel) return;
    let vivo = true;
    Promise.all([plataforma.ventanas(estacionSel), plataforma.disponibilidad(estacionSel)])
      .then(([v, h]) => { if (vivo) { setVentanas(v); setHoras(h); } })
      .catch((e) => { if (vivo) setError(mensaje(e)); });
    return () => { vivo = false; };
  }, [estacionSel, ultimoVistoSel]);

  const conectar = async (url: string, token: string) => {
    setOcupado(true);
    try {
      await plataforma.conectar(url, token);
      setProyectoId(null);
      await cargarSesion();
    } catch (e) {
      setError(e instanceof ErrorPlataforma && e.status === 401 ? 'La plataforma no reconoce ese token (o está revocado).' : mensaje(e));
    } finally {
      setOcupado(false);
    }
  };

  const desconectar = async () => {
    await plataforma.desconectar().catch(() => undefined);
    setSesion(null); setFicha(null); setEstaciones([]); setAvisos([]); setProyectoId(null); setEstacionId(null);
    await cargarSesion();
  };

  if (!conexion) return <div className="shm-root"><p className="shm-note">Consultando la conexión…</p>{error && <p className="shm-warn">{error}</p>}</div>;
  if (!conexion.configurada) {
    return <div className="shm-root"><FormularioConexion urlInicial={conexion.url} error={error} ocupado={ocupado} onConectar={conectar} /></div>;
  }

  const def = ficha?.definicion ?? null;
  const periodo = estaciones.find((e) => e.station_id === estacionSel)?.periodo_s ?? 10;
  return (
    <div className="shm-root">
      <header className="shm-head">
        <div>
          <div className="shm-eyebrow">Plataforma de datos · {conexion.url}</div>
          <h2>{ficha?.nombre ?? proyectoId ?? '…'}</h2>
          {def && <p className="shm-intro">{def.estructura.tipo}{def.estructura.nombre ? ` · ${def.estructura.nombre}` : ''}</p>}
        </div>
        <div className="plat-sesion">
          {sesion && <span className="shm-badge" title={sesion.nombre}>{sesion.rol}{sesion.rol === 'admin' ? ' · todos los proyectos' : ''}</span>}
          {sesion?.rol === 'admin' && proyectos.length > 1 && (
            <select value={proyectoId ?? ''} onChange={(e) => { setProyectoId(e.target.value); setEstacionId(null); }} aria-label="Proyecto">
              {proyectos.map((p) => <option key={p.proyecto_id} value={p.proyecto_id}>{p.nombre}</option>)}
            </select>
          )}
          {conexion.fuente === 'archivo' && <button type="button" className="secondary-button" onClick={desconectar}>Desconectar</button>}
        </div>
      </header>

      {error && <p className="shm-warn">{error}</p>}
      {ficha && <AvisoIntegridad def={def} />}

      <div className="shm-layout">
        <section className="shm-card">
          <h3>Estaciones del proyecto</h3>
          <TablaEstaciones filas={filas} seleccion={estacionSel} ahora={ahora} onSeleccionar={setEstacionId} />
          <p className="shm-note">
            «Proyecto dice» viene del proyecto.json; el enlace y los estados, de lo que la estación ha enviado. Las estaciones
            en diseño no tienen alta en la plataforma hasta que se simulan o se instalan.
          </p>
        </section>
        <section className="shm-card">
          <h3>Avisos abiertos</h3>
          <ListaAvisos avisos={avisos} ahora={ahora} />
        </section>
      </div>

      {estacionSel && (
        <div className="shm-layout">
          <section className="shm-card">
            <h3>{estacionSel} · disponibilidad, últimas 24 h</h3>
            <BarrasDisponibilidad horas={horas} periodoS={periodo} ahora={ahora} />
            <p className="shm-note">Ventanas recibidas sobre las esperadas (una cada {periodo} s). Verde ≥ 99 %, ámbar ≥ 90 %.</p>
          </section>
          <section className="shm-card">
            <h3>{estacionSel} · ventanas de la última hora</h3>
            <FranjaVentanas ventanas={ventanas} />
            <TablaVentanas ventanas={ventanas} />
          </section>
        </div>
      )}
    </div>
  );
}
