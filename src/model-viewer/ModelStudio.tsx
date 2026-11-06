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
import { DISCIPLINE_COLOR } from './materials';
import { zoneOrder, type ModelDomain } from './scene-graph';
import { buildEditorHandoff, sendToEditor, type HandoffResult } from './to-editor';
import './model-studio.css';

export interface StudioStat {
  label: string;
  value: string;
}

/** Todo lo que distingue un dominio del otro. */
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

  const [visibleDisciplines, setVisibleDisciplines] = useState<Set<string>>(() => new Set());
  const [visibleLevels, setVisibleLevels] = useState<Set<string>>(() => new Set());
  const [explode, setExplode] = useState(0);
  const [section, setSection] = useState<SectionState>({ enabled: false, x: 1, y: 1, z: 1 });
  const [colorMode, setColorMode] = useState<ColorMode>('material');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [handoff, setHandoff] = useState<HandoffResult | null>(null);
  const [sending, setSending] = useState(false);

  const viewportRef = useRef<ModelViewportHandle | null>(null);

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
