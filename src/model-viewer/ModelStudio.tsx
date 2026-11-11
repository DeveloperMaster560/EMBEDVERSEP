/**
 * Armazón del estudio paramétrico, común a edificios y puentes.
 *
 * Flujo: un enunciado en español se interpreta localmente, se muestra lo que el
 * sistema entendió y lo que no, y solo entonces se genera el modelo
 * multidisciplinario. El resultado se explora por disciplina, zona, corte y
 * despiece.
 *
 * Lo propio de cada dominio —vocabulario, intérprete, endpoint, qué estadísticas
 * tienen sentido— llega en `StudioDomainConfig`. Aquí no hay nada que sepa si lo
 * que se está generando es un edificio o un puente.
 *
 * El modelo generado es geometría conceptual. No contiene cálculo de ingeniería
 * ni revisión profesional, y la interfaz lo dice en todo momento.
 */

import { useCallback, useMemo, useRef, useState } from 'react';

import {
  ModelViewport,
  type ColorMode,
  type ModelViewportHandle,
  type SectionState,
  type ViewPreset,
} from './ModelViewport';
import { normalizeResult, type ModelGenerationResult } from './contracts';
import { clock, dayOfYear, evaluateLighting } from './lighting-state';
import { DISCIPLINE_COLOR } from './materials';
import { zoneOrder, type ModelDomain } from './scene-graph';
import { buildEditorHandoff, sendToEditor, type HandoffResult } from './to-editor';
import './model-studio.css';

export interface StudioStat {
  label: string;
  value: string;
}

/** Todo lo que distingue un dominio del otro. */
/**
 * Color con el que se pinta cada zona encendida. Es presentación: no describe
 * la temperatura de color real de ninguna luminaria.
 */
import { lanesPerDirectionFrom } from '../traffic/simulation';
import { MASS_BASIS_NOTE, MODELLED_MASS_LABEL, formatModelledMass } from './mass-report';
import { BridgeSimulationPanel } from './BridgeSimulationPanel';
import { useBridgeSimulation } from './useBridgeSimulation';

const ZONE_LIGHT_COLOR: Record<string, string> = {
  vial: '#ffd9a0',
  tirantes: '#4ea8ff',
  torres: '#ff9f4e',
  barreras: '#7ee0c0',
  default: '#ffe9c4',
};

export interface StudioDomainConfig<S> {
  domain: ModelDomain;
  eyebrow: string;
  title: string;
  intro: string;
  promptLabel: string;
  promptPlaceholder: string;
  examples: string[];
  endpoint: string;
  /** Cómo se llaman las agrupaciones verticales en este dominio. */
  zoneTitle: string;
  explodeLabel: string;
  explodeMax: number;
  emptyHint: string;
  disciplineLabel: Record<string, string>;
  interpret: (prompt: string) => S;
  describe: (spec: S) => string[];
  questionsOf: (spec: S) => string[];
  assumptionsOf: (spec: S) => string[];
  validate: (spec: S) => string[];
  ready: (spec: S) => boolean;
  toGeneratorSpec: (spec: S) => Record<string, unknown>;
  /** Estadísticas de cabecera propias del dominio. */
  headlineStats: (result: ModelGenerationResult) => StudioStat[];
  /**
   * Vista propia del dominio que se abre sobre el visor 3D cuando el modelo la
   * tiene (p. ej. el circuito de las estaciones SHM de un puente instrumentado).
   */
  extraView?: {
    label: string;
    available: (result: ModelGenerationResult) => boolean;
    render: () => React.ReactNode;
  };
}

interface LoadInfo {
  meshes: number;
  triangles: number;
  bounds: [number, number, number];
}

export interface ModelStudioProps<S> {
  config: StudioDomainConfig<S>;
  /** Proyecto al que pertenece la escena del editor 3D. */
  projectId?: string;
  projectName?: string;
  /** Abre la pestaña del editor. Sin ella el envío funciona, pero no navega. */
  onOpenEditor?: () => void;
}

export function ModelStudio<S>({
  config,
  projectId,
  projectName,
  onOpenEditor,
}: ModelStudioProps<S>): React.JSX.Element {
  const [prompt, setPrompt] = useState(config.examples[0] ?? '');
  const [spec, setSpec] = useState<S | null>(null);
  const [result, setResult] = useState<ModelGenerationResult | null>(null);
  const [status, setStatus] = useState<'idle' | 'generating'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [loadInfo, setLoadInfo] = useState<LoadInfo | null>(null);
  const [extraOpen, setExtraOpen] = useState(false);

  const [visibleDisciplines, setVisibleDisciplines] = useState<Set<string>>(() => new Set());
  const [visibleLevels, setVisibleLevels] = useState<Set<string>>(() => new Set());
  const [explode, setExplode] = useState(0);
  const [section, setSection] = useState<SectionState>({ enabled: false, x: 1, y: 1, z: 1 });
  const [colorMode, setColorMode] = useState<ColorMode>('material');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Mando del alumbrado. 19:30 por defecto: a esa hora ya es de noche en
  // cualquier latitud habitada, así que el panel abre mostrando algo.
  const [minutesOfDay, setMinutesOfDay] = useState(19 * 60 + 30);
  // Luz que ve la fotocelda del armario. Arranca de noche cerrada para que al
  // poner en marcha se vea algo encendido.
  const [photocellLight, setPhotocellLight] = useState(0.05);
  const [accentZonesOn, setAccentZonesOn] = useState<Set<string>>(
    () => new Set(['tirantes', 'torres', 'barreras']),
  );
  // La fecha se fija una vez al montar. Leer el reloj durante el render haría
  // que la evaluación cambiara sola entre repintados, y el orto y el ocaso
  // dependen del día del año, así que no es un detalle menor.
  const [evaluationDate] = useState(() => new Date());

  const [handoff, setHandoff] = useState<HandoffResult | null>(null);
  const [sending, setSending] = useState(false);

  const viewportRef = useRef<ModelViewportHandle | null>(null);

  /**
   * Evaluación del mando. No es una simulación: resuelve la lógica declarada
   * en el modelo, no la física de la instalación.
   */
  const lighting = useMemo(() => {
    const control = result?.lightingControl;
    if (!control) return null;
    return evaluateLighting(control, {
      minutesOfDay,
      year: evaluationDate.getUTCFullYear(),
      dayNumber: dayOfYear(evaluationDate),
      accentZonesOn,
    });
  }, [result, minutesOfDay, accentZonesOn, evaluationDate]);

  /**
   * Qué piezas se pintan encendidas y de qué color. El Map se memoriza porque
   * su identidad es la señal de cambio que usa el visor.
   */
  const litComponents = useMemo(() => {
    if (!lighting) return null;
    const map = new Map<string, string>();
    for (const zone of lighting.zones) {
      if (!zone.energized) continue;
      const color = ZONE_LIGHT_COLOR[zone.zone] ?? ZONE_LIGHT_COLOR.default;
      for (const fixture of zone.fixtures) map.set(fixture, color);
    }
    return map;
  }, [lighting]);

  /**
   * El puente en marcha: firmware del armario y tráfico.
   *
   * Solo tiene sentido en el dominio de puentes; en un edificio no hay calzada
   * ni armario de alumbrado vial.
   */
  const simulation = useBridgeSimulation(viewportRef, {
    control: config.domain === 'bridge' ? result?.lightingControl ?? null : null,
    initialLight: photocellLight,
    // Los carriles los declara el puente generado, no una constante: el
    // Viaducto de la Novena tiene seis y se circulaba por cuatro.
    lanesPerDirection: lanesPerDirectionFrom(
      typeof result?.applied?.lanes === 'number' ? result.applied.lanes : null,
    ),
  });

  /**
   * Qué manda sobre las luces del visor.
   *
   * Con la simulación en marcha manda el FIRMWARE, porque entonces las zonas
   * están encendidas porque un pin está alto. Parada, se vuelve al evaluador
   * de reglas, que es lo que había. No se mezclan: serían dos verdades
   * distintas sobre la misma luminaria.
   */
  const effectiveLit = simulation.running && simulation.lighting
    ? simulation.lighting.litComponents
    : litComponents;

  /** Lleva lo que se está viendo al editor 3D, donde sí se puede modificar. */
  const openInEditor = useCallback(async () => {
    const viewport = viewportRef.current;
    if (!viewport || !result) return;
    if (!projectId) {
      setError(
        'El editor 3D guarda la escena por proyecto, y este Studio se abrió sin proyecto. Entra desde un proyecto para poder enviar el modelo.',
      );
      return;
    }
    setSending(true);
    setError(null);
    try {
      const extracted = viewport.extractVisible();
      if (extracted.length === 0) {
        setError('No hay nada visible que enviar. Enciende alguna disciplina.');
        return;
      }
      const payload = buildEditorHandoff(
        extracted,
        result.components,
        result.levels,
        config.domain,
        config.disciplineLabel,
      );
      setHandoff(await sendToEditor(projectId, projectName ?? config.title, payload));
    } catch (cause) {
      setError(
        cause instanceof Error
          ? `No se pudo enviar el modelo al editor: ${cause.message}`
          : 'No se pudo enviar el modelo al editor.',
      );
    } finally {
      setSending(false);
    }
  }, [config, projectId, projectName, result]);

  const interpret = useCallback(() => {
    setError(null);
    setSpec(config.interpret(prompt));
  }, [config, prompt]);

  const generate = useCallback(async () => {
    const current = spec ?? config.interpret(prompt);
    setSpec(current);
    const problems = config.validate(current);
    if (problems.length > 0) {
      setError(problems.join(' '));
      return;
    }
    if (!config.ready(current)) {
      setError(
        'Faltan datos obligatorios. Responde las preguntas pendientes antes de generar; el sistema no los inventa.',
      );
      return;
    }

    setStatus('generating');
    setError(null);
    try {
      const response = await fetch(config.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config.toGeneratorSpec(current)),
      });
      const payload = (await response.json()) as Record<string, unknown>;
      if (!response.ok || payload.ok !== true) {
        const detail = (payload.detail as string) ?? (payload.error as string) ?? 'Error desconocido.';
        setError(detail);
        setStatus('idle');
        return;
      }
      const generated = normalizeResult(payload, config.domain);
      setResult(generated);
      // Se abre sola al generar un modelo que la tiene; se cierra para ver el 3D.
      setExtraOpen(Boolean(config.extraView?.available(generated)));
      setVisibleDisciplines(new Set(Object.keys(generated.counts.byDiscipline)));
      setVisibleLevels(new Set());
      setSelectedId(null);
      setHandoff(null);
      setStatus('idle');
    } catch (cause) {
      setError(
        cause instanceof Error
          ? `No se pudo contactar con el generador local: ${cause.message}`
          : 'No se pudo contactar con el generador local.',
      );
      setStatus('idle');
    }
  }, [config, prompt, spec]);

  const toggleDiscipline = (key: string) => {
    setVisibleDisciplines((previous) => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleLevel = (levelId: string) => {
    setVisibleLevels((previous) => {
      const all = result?.levels.map((l) => l.level_id) ?? [];
      const next = new Set(previous.size === 0 ? all : previous);
      if (next.has(levelId)) next.delete(levelId);
      else next.add(levelId);
      return next.size === all.length ? new Set() : next;
    });
  };

  const selected = useMemo(
    () => result?.components.find((c) => c.component_id === selectedId) ?? null,
    [result, selectedId],
  );

  const disciplineRows = useMemo(() => {
    if (!result) return [];
    return Object.entries(result.counts.byDiscipline)
      .map(([key, count]) => ({ key, count }))
      .sort((a, b) => b.count - a.count);
  }, [result]);

  // Las zonas llegan en el orden en que las declara el generador; se ordenan
  // aquí para que la lista se lea de abajo arriba en los dos dominios.
  const zones = useMemo(() => {
    if (!result) return [];
    return [...result.levels].sort(
      (a, b) => zoneOrder(config.domain, a.level_id) - zoneOrder(config.domain, b.level_id),
    );
  }, [config.domain, result]);

  const specQuestions = spec ? config.questionsOf(spec) : [];
  const specAssumptions = spec ? config.assumptionsOf(spec) : [];

  return (
    <div className="bs-root">
      <aside className="bs-panel">
        <header className="bs-header">
          <div className="bs-eyebrow">{config.eyebrow}</div>
          <h2>{config.title}</h2>
          <p>{config.intro}</p>
        </header>

        <section className="bs-section">
          <label className="bs-label" htmlFor="bs-prompt">
            {config.promptLabel}
          </label>
          <textarea
            id="bs-prompt"
            className="bs-textarea"
            rows={5}
            value={prompt}
            onChange={(event) => {
              setPrompt(event.target.value);
              setSpec(null);
            }}
            placeholder={config.promptPlaceholder}
          />
          <div className="bs-examples">
            {config.examples.map((example, index) => (
              <button
                key={example}
                type="button"
                className="bs-chip"
                onClick={() => {
                  setPrompt(example);
                  setSpec(null);
                }}
              >
                Ejemplo {index + 1}
              </button>
            ))}
          </div>
          <div className="bs-actions">
            <button type="button" className="bs-button" onClick={interpret}>
              Interpretar
            </button>
            <button
              type="button"
              className="bs-button bs-primary"
              onClick={() => void generate()}
              disabled={status === 'generating'}
            >
              {status === 'generating' ? 'Generando…' : 'Generar modelo'}
            </button>
          </div>
        </section>

        {error && (
          <div className="bs-error" role="alert">
            {error}
          </div>
        )}

        {spec && (
          <section className="bs-section">
            <h3>Lo que el sistema entendió</h3>
            <ul className="bs-readout">
              {config.describe(spec).map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            {specQuestions.length > 0 && (
              <div className="bs-questions">
                <strong>Falta por definir</strong>
                <ul>
                  {specQuestions.map((question) => (
                    <li key={question}>{question}</li>
                  ))}
                </ul>
              </div>
            )}
            <details className="bs-details">
              <summary>Supuestos declarados ({specAssumptions.length})</summary>
              <ul>
                {specAssumptions.map((assumption) => (
                  <li key={assumption}>{assumption}</li>
                ))}
              </ul>
            </details>
          </section>
        )}

        {result && (
          <>
            <section className="bs-section">
              <h3>Modelo generado</h3>
              <div className="bs-stats">
                <Stat label="Componentes" value={result.counts.components.toLocaleString('es')} />
                <Stat label="Conexiones" value={result.counts.connections.toLocaleString('es')} />
                <Stat label="Operaciones" value={result.counts.operations.toLocaleString('es')} />
                {config.headlineStats(result).map((stat) => (
                  <Stat key={stat.label} label={stat.label} value={stat.value} />
                ))}
                <Stat label="Generación" value={`${(result.generationMs / 1000).toFixed(1)} s`} />
              </div>
              {result.adjustments.length > 0 && (
                <div className="bs-adjustments">
                  <strong>Ajustes que hizo el generador</strong>
                  <ul>
                    {result.adjustments.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
              )}
            </section>

            {config.extraView?.available(result) && (
              <section className="bs-section">
                <h3>{config.extraView.label}</h3>
                <button
                  type="button"
                  className="bs-button bs-wide"
                  onClick={() => setExtraOpen((open) => !open)}
                >
                  {extraOpen ? 'Volver al modelo 3D' : `Ver ${config.extraView.label.toLowerCase()}`}
                </button>
              </section>
            )}

            <section className="bs-section">
              <h3>Editar el modelo</h3>
              <p className="bs-hint">
                El Studio genera y comprueba; no modifica. Envía el modelo al editor 3D y allí
                podrás mover, rotar, escalar, duplicar, agrupar, cambiar materiales, añadir piezas
                nuevas, importar, exportar y guardar.
              </p>
              <button
                type="button"
                className="bs-button bs-primary bs-wide"
                onClick={() => void openInEditor()}
                disabled={sending}
              >
                {sending ? 'Enviando…' : 'Enviar al editor 3D'}
              </button>
              <p className="bs-hint">
                Se envía <strong>lo que está visible</strong>: apaga disciplinas o aísla zonas para
                enviar solo una parte. Reenviar reemplaza lo enviado antes y conserva todo lo que
                hayas añadido tú.
              </p>
              {handoff && (
                <div className="bs-handoff" role="status">
                  <strong>{handoff.added.toLocaleString('es')} componentes en el editor</strong>
                  <ul>
                    <li>{handoff.triangles.toLocaleString('es')} triángulos</li>
                    {handoff.replaced > 0 && (
                      <li>{handoff.replaced.toLocaleString('es')} del envío anterior reemplazados</li>
                    )}
                    <li>
                      {handoff.kept > 0
                        ? `${handoff.kept.toLocaleString('es')} objetos tuyos conservados`
                        : 'No había objetos propios que conservar'}
                    </li>
                  </ul>
                  {onOpenEditor ? (
                    <button type="button" className="bs-button" onClick={onOpenEditor}>
                      Abrir el editor 3D
                    </button>
                  ) : (
                    <p>Abre la pestaña «Modelos 3D» para editarlo.</p>
                  )}
                </div>
              )}
            </section>

            <section className="bs-section">
              <h3>Disciplinas</h3>
              <div className="bs-layers">
                {disciplineRows.map(({ key, count }) => (
                  <button
                    key={key}
                    type="button"
                    className={`bs-layer${visibleDisciplines.has(key) ? ' bs-on' : ''}`}
                    onClick={() => toggleDiscipline(key)}
                  >
                    <span
                      className="bs-swatch"
                      style={{ background: DISCIPLINE_COLOR[key] ?? '#9aa0a6' }}
                    />
                    <span className="bs-layer-name">{config.disciplineLabel[key] ?? key}</span>
                    <span className="bs-layer-count">{count}</span>
                  </button>
                ))}
              </div>
            </section>

            <section className="bs-section">
              <h3>{config.zoneTitle}</h3>
              <div className="bs-levels">
                {zones.map((zone) => {
                  const on = visibleLevels.size === 0 || visibleLevels.has(zone.level_id);
                  return (
                    <button
                      key={zone.level_id}
                      type="button"
                      className={`bs-level${on ? ' bs-on' : ''}`}
                      onClick={() => toggleLevel(zone.level_id)}
                      title={zone.name}
                    >
                      {zone.level_id}
                      <small>{zone.caption ?? `${zone.elevation.toFixed(2)} m`}</small>
                    </button>
                  );
                })}
              </div>
            </section>

            <section className="bs-section">
              <h3>Exploración</h3>
              <Slider
                label={config.explodeLabel}
                value={explode}
                min={0}
                max={config.explodeMax}
                step={0.5}
                suffix=" m"
                onChange={setExplode}
              />
              <label className="bs-toggle">
                <input
                  type="checkbox"
                  checked={section.enabled}
                  onChange={(event) =>
                    setSection((previous) => ({ ...previous, enabled: event.target.checked }))
                  }
                />
                Corte del volumen
              </label>
              {section.enabled && (
                <>
                  <Slider
                    label="Corte en X"
                    value={section.x}
                    min={0}
                    max={1}
                    step={0.01}
                    onChange={(value) => setSection((p) => ({ ...p, x: value }))}
                  />
                  <Slider
                    label="Corte en altura"
                    value={section.y}
                    min={0}
                    max={1}
                    step={0.01}
                    onChange={(value) => setSection((p) => ({ ...p, y: value }))}
                  />
                  <Slider
                    label="Corte en Y"
                    value={section.z}
                    min={0}
                    max={1}
                    step={0.01}
                    onChange={(value) => setSection((p) => ({ ...p, z: value }))}
                  />
                </>
              )}
              <div className="bs-row">
                <span className="bs-label">Color por</span>
                <div className="bs-segmented">
                  {(['material', 'discipline'] as ColorMode[]).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      className={colorMode === mode ? 'bs-on' : ''}
                      onClick={() => setColorMode(mode)}
                    >
                      {mode === 'material' ? 'Material' : 'Disciplina'}
                    </button>
                  ))}
                </div>
              </div>
            </section>

            {config.domain === 'bridge' && result.lightingControl && (
              <BridgeSimulationPanel
                running={simulation.running}
                lighting={simulation.lighting}
                traffic={simulation.traffic}
                deck={simulation.deck}
                trafficNote={simulation.trafficNote}
                light={photocellLight}
                onStart={simulation.start}
                onStop={simulation.stop}
                onPressed={simulation.setPressed}
                onLight={(value) => { setPhotocellLight(value); simulation.setLight(value); }}
              />
            )}

            {lighting && result.lightingControl && !simulation.running && (
              <section className="bs-section">
                <h3>Mando del alumbrado</h3>
                <p className="bs-note">
                  Esto <strong>no es una simulación</strong>. Evalúa la lógica de mando
                  declarada en el modelo y dice por qué cada zona queda encendida o
                  apagada. No resuelve corrientes ni fotometría.
                </p>

                <label className="bs-slider">
                  Hora local <strong>{clock(lighting.minutesOfDay)}</strong>
                  <input
                    type="range"
                    min={0}
                    max={1439}
                    step={5}
                    value={minutesOfDay}
                    onChange={(event) => setMinutesOfDay(Number(event.target.value))}
                  />
                </label>

                <ul className="bs-validation">
                  <li>
                    {lighting.night ? 'Es de noche' : 'Es de día'} · orto{' '}
                    <strong>{clock(lighting.sunriseMinutes)}</strong> · ocaso{' '}
                    <strong>{clock(lighting.sunsetMinutes)}</strong>
                  </li>
                  <li>
                    Encendidas:{' '}
                    <strong>{litComponents ? litComponents.size : 0}</strong> de{' '}
                    {result.lightingControl.totalFixtures} luminarias
                    {lighting.totalPowerW !== null && (
                      <>
                        {' '}· potencia conectada{' '}
                        <strong>
                          {(lighting.totalPowerW / 1000).toLocaleString('es', {
                            maximumFractionDigits: 2,
                          })}{' '}
                          kW
                        </strong>
                      </>
                    )}
                  </li>
                </ul>

                <ul className="bs-zones">
                  {lighting.zones.map((zone) => (
                    <li key={zone.zone}>
                      <label>
                        <input
                          type="checkbox"
                          checked={zone.energized}
                          disabled={zone.zone === 'vial'}
                          onChange={(event) => {
                            const next = new Set(accentZonesOn);
                            if (event.target.checked) next.add(zone.zone);
                            else next.delete(zone.zone);
                            setAccentZonesOn(next);
                          }}
                        />
                        <span
                          className="bs-zone-dot"
                          style={{
                            background:
                              ZONE_LIGHT_COLOR[zone.zone] ?? ZONE_LIGHT_COLOR.default,
                            opacity: zone.energized ? 1 : 0.25,
                          }}
                        />
                        <strong>{zone.label}</strong> · {zone.fixtureCount}
                      </label>
                      <small>{zone.reason}</small>
                    </li>
                  ))}
                </ul>
                <p className="bs-note">
                  El alumbrado vial no se puede conmutar a mano: lo manda el
                  crepúsculo, que es su razón de existir.
                </p>

                {lighting.undetermined.length > 0 && (
                  <>
                    <h4>No se puede determinar</h4>
                    <ul className="bs-pending">
                      {lighting.undetermined.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </>
                )}

                <h4>Fuera del alcance de esta evaluación</h4>
                <ul className="bs-pending">
                  {lighting.notSimulated.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
                <p className="bs-note">{lighting.utcOffsetSource}</p>
              </section>
            )}

            {result.engineering && (
              <section className="bs-section">
                <h3>Propiedades derivadas</h3>
                {result.engineering.embedlibAvailable ? (
                  <>
                    <ul className="bs-validation">
                      <li>
                        Secciones calculadas:{' '}
                        <strong>{result.engineering.sectionPropertiesAdded}</strong> de{' '}
                        {result.engineering.componentsExamined} piezas estructurales
                      </li>
                      <li>
                        Peso propio calculado:{' '}
                        <strong>{result.engineering.selfWeightAdded}</strong> piezas
                        {result.engineering.skippedNoVolume > 0 &&
                          ` · ${result.engineering.skippedNoVolume} sin densidad declarada`}
                      </li>
                      <li>
                        {MODELLED_MASS_LABEL}:{' '}
                        <strong>{formatModelledMass(result.engineering.totalMassKg)}</strong>{' '}
                        ({result.engineering.totalWeightKN.toLocaleString('es', {
                          maximumFractionDigits: 0,
                        })}{' '}
                        kN)
                        <br />
                        <small>{MASS_BASIS_NOTE}</small>
                      </li>
                    </ul>
                    <p className="bs-hint">
                      Solo se deduce lo que se sigue de la geometría y de una densidad declarada.
                      Sigue sin calcularse: {result.engineering.stillPending.join(', ')}.
                    </p>
                  </>
                ) : (
                  <p className="bs-hint">
                    No se calcularon secciones ni peso propio porque falta embedlib.{' '}
                    {result.engineering.reasonUnavailable}
                  </p>
                )}
              </section>
            )}

            <section className="bs-section">
              <h3>Validación</h3>
              <ul className="bs-validation">
                <li>
                  Errores de consistencia: <strong>{result.validation.consistencyErrors}</strong>
                </li>
                <li>
                  Interferencias detectadas: <strong>{result.validation.clashCount}</strong>, de
                  ellas <strong>{result.validation.actionableClashes}</strong> requieren coordinación
                </li>
                <li>
                  Parámetros pendientes declarados:{' '}
                  <strong>{result.pending.declarations.toLocaleString('es')}</strong>
                </li>
              </ul>
              <p className="bs-warning">
                Geometría conceptual generada automáticamente. Sin cálculo estructural, eléctrico,
                hidráulico ni térmico, y sin revisión profesional. No es apta para construir.
              </p>
            </section>
          </>
        )}
      </aside>

      <main className="bs-stage">
        <div className="bs-toolbar">
          <div className="bs-views">
            {(['iso', 'top', 'front', 'side'] as ViewPreset[]).map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => viewportRef.current?.setView(preset)}
                disabled={!result}
              >
                {preset === 'iso'
                  ? 'Isométrica'
                  : preset === 'top'
                    ? 'Planta'
                    : preset === 'front'
                      ? 'Frontal'
                      : 'Lateral'}
              </button>
            ))}
            <button type="button" onClick={() => viewportRef.current?.frameAll()} disabled={!result}>
              Encuadrar
            </button>
          </div>
          {loadInfo && (
            <div className="bs-meta">
              {loadInfo.meshes.toLocaleString('es')} mallas ·{' '}
              {loadInfo.triangles.toLocaleString('es')} triángulos ·{' '}
              {loadInfo.bounds.map((v) => v.toFixed(1)).join(' × ')} m
            </div>
          )}
        </div>

        {extraOpen && result && config.extraView?.available(result) && (
          <div className="bs-overlay" role="region" aria-label={config.extraView.label}>
            <div className="bs-overlay-bar">
              <button type="button" onClick={() => setExtraOpen(false)}>
                Volver al modelo 3D
              </button>
            </div>
            {config.extraView.render()}
          </div>
        )}

        {!result && status !== 'generating' && (
          <div className="bs-empty">
            <h3>Sin modelo todavía</h3>
            <p>{config.emptyHint}</p>
          </div>
        )}
        {status === 'generating' && (
          <div className="bs-empty">
            <h3>Generando el modelo…</h3>
            <p>
              Se están creando los componentes de cada disciplina, trazando las instalaciones y
              comprobando interferencias. Puede tardar varios segundos.
            </p>
          </div>
        )}

        <ModelViewport
          ref={viewportRef}
          domain={config.domain}
          glbBase64={result?.glbBase64 ?? null}
          components={result?.components ?? []}
          visibleDisciplines={visibleDisciplines}
          visibleLevels={visibleLevels}
          explode={explode}
          section={section}
          colorMode={colorMode}
          selectedId={selectedId}
          litComponents={effectiveLit}
          // La fotocelda ya no gobierna solo al firmware: tambien anochece la
          // escena. Un alumbrado encendido a pleno dia no se ve.
          ambientLight={config.domain === 'bridge' ? photocellLight : 1}
          onSelect={setSelectedId}
          onLoaded={setLoadInfo}
          onError={setError}
        />

        {selected && (
          <div className="bs-inspector">
            <header>
              <strong>{selected.name}</strong>
              <button type="button" onClick={() => setSelectedId(null)} aria-label="Cerrar">
                ×
              </button>
            </header>
            <dl>
              <dt>Identificador</dt>
              <dd>{selected.component_id}</dd>
              <dt>Disciplina</dt>
              <dd>{config.disciplineLabel[selected.discipline] ?? selected.discipline}</dd>
              <dt>Tipo</dt>
              <dd>{selected.type}</dd>
              <dt>{config.zoneTitle.replace(/e?s$/, '')}</dt>
              <dd>{selected.level_id ?? '—'}</dd>
              <dt>Material</dt>
              <dd>{selected.material ?? 'sin declarar'}</dd>
              <dt>Parámetros pendientes</dt>
              <dd>{selected.pending_count}</dd>
            </dl>
            <button
              type="button"
              className="bs-button"
              onClick={() => viewportRef.current?.focus(selected.component_id)}
            >
              Centrar en el componente
            </button>
          </div>
        )}
      </main>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div className="bs-stat">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  suffix = '',
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix?: string;
  onChange: (value: number) => void;
}): React.JSX.Element {
  return (
    <label className="bs-slider">
      <span>
        {label}
        <em>
          {value.toFixed(step < 1 ? 2 : 1)}
          {suffix}
        </em>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number.parseFloat(event.target.value))}
      />
    </label>
  );
}
