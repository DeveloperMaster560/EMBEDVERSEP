/**
 * Enlace modelo 3D ↔ sistema embebido: al seleccionar un componente del modelo
 * (p. ej. el tablero general ELE-TAB-TG de una casa), muestra lo que miden las
 * estaciones que el proyecto ubica en ese componente (proyecto.json →
 * estaciones[].ubicacion.elemento), con los datos reales de la plataforma.
 *
 * Solo lee, con el token del servidor local (el navegador no lo ve). Si la app
 * no está conectada a la plataforma, o ninguna estación está en ese componente,
 * no muestra nada: el visor funciona igual sin plataforma.
 */
import { useEffect, useState } from 'react';

import { plataforma } from './api';
import { TablaMedidas } from './PlataformaView';
import { tiposDeDatos, type EstacionDef, type Medida } from './model';

const REFRESCO_MS = 10_000;

interface Enlazada {
  estacion: EstacionDef;
  proyecto: string;
  medidas: Medida[];
}

/** Las estaciones de un proyecto que están en el componente del modelo. */
export function estacionesEn(estaciones: EstacionDef[], componentId: string): EstacionDef[] {
  return estaciones.filter((e) => e.ubicacion?.elemento && e.ubicacion.elemento === componentId);
}

export function DatosDelComponente({ componentId }: { componentId: string }) {
  const [enlazadas, setEnlazadas] = useState<Enlazada[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    const cargar = async () => {
      try {
        const c = await plataforma.conexion();
        if (!c.configurada) { if (vivo) setEnlazadas([]); return; }
        const proyectos = await plataforma.proyectos();
        const fichas = await Promise.all(proyectos.map((p) => plataforma.proyecto(p.proyecto_id)));
        const aqui = fichas.flatMap((f) => estacionesEn(f.definicion?.estaciones ?? [], componentId).map((e) => ({ estacion: e, proyecto: f.nombre })));
        const conDatos = await Promise.all(aqui.map(async (x) => ({
          ...x,
          medidas: tiposDeDatos(x.estacion).medidas ? await plataforma.medidas(x.estacion.id, 500) : [],
        })));
        if (vivo) { setEnlazadas(conDatos); setError(null); }
      } catch (e) {
        if (vivo) setError(e instanceof Error ? e.message : 'No se pudo leer la plataforma.');
      }
    };
    void cargar();
    const t = setInterval(cargar, REFRESCO_MS);
    return () => { vivo = false; clearInterval(t); };
  }, [componentId]);

  if (error) return <p className="shm-note">Plataforma: {error}</p>;
  if (!enlazadas.length) return null;
  return (
    <div className="bs-envivo">
      {enlazadas.map((x) => (
        <section key={x.estacion.id}>
          <h4>Estación {x.estacion.id} · en vivo</h4>
          <small>{x.estacion.nombre} · {x.proyecto}</small>
          {tiposDeDatos(x.estacion).medidas
            ? <TablaMedidas medidas={x.medidas} compacta />
            : <p className="shm-note">Envía ventanas de aceleración: ver «Sistema embebido → Plataforma de datos».</p>}
        </section>
      ))}
    </div>
  );
}

/** Componentes del modelo donde el proyecto ubica alguna estación: elemento → estaciones. */
export function useEstacionesUbicadas(): Map<string, EstacionDef[]> {
  const [mapa, setMapa] = useState<Map<string, EstacionDef[]>>(new Map());
  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const c = await plataforma.conexion();
        if (!c.configurada) return;
        const proyectos = await plataforma.proyectos();
        const fichas = await Promise.all(proyectos.map((p) => plataforma.proyecto(p.proyecto_id)));
        const m = new Map<string, EstacionDef[]>();
        for (const e of fichas.flatMap((f) => f.definicion?.estaciones ?? [])) {
          const el = e.ubicacion?.elemento;
          if (el) m.set(el, [...(m.get(el) ?? []), e]);
        }
        if (vivo) setMapa(m);
      } catch { /* sin plataforma: el visor funciona igual */ }
    })();
    return () => { vivo = false; };
  }, []);
  return mapa;
}

/** Lista de los componentes del modelo que tienen una estación; al pulsar, se seleccionan. */
export function EstacionesEnElModelo({ componentes, onElegir }: {
  componentes: { component_id: string; name: string }[];
  onElegir: (componentId: string) => void;
}) {
  const ubicadas = useEstacionesUbicadas();
  const aqui = componentes.filter((c) => ubicadas.has(c.component_id));
  if (!aqui.length) return null;
  return (
    <section className="bs-section">
      <h3>Estaciones en el modelo</h3>
      <p className="bs-note">Componentes donde el proyecto de la plataforma ubica un equipo embebido. Al elegirlo se ven sus datos reales.</p>
      {aqui.map((c) => (
        <button key={c.component_id} type="button" className="bs-button" onClick={() => onElegir(c.component_id)}>
          {c.name} ({c.component_id}) · {ubicadas.get(c.component_id)!.map((e) => e.id).join(', ')}
        </button>
      ))}
    </section>
  );
}
