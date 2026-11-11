/**
 * Panel para identificar una pieza a partir de su fotografia.
 *
 * El panel insiste en la misma distincion que el resto del modulo: lo que se
 * MIDE en la foto (contorno y recuento de patas) se muestra aparte de lo que
 * se DEDUCE del marcaje (que pieza es). Cuando las dos cosas no cuadran, se
 * ensena la contradiccion en vez de elegir una.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Check, Cpu, ImageUp, Loader2, ScanLine } from 'lucide-react';

import { componentCatalog } from '../domain/catalog';
import { buildDraft, type ComponentDraft } from './component-draft';
import { analyze, type Analysis, type Bitmap } from './image-analysis';
import { drawOverlay, ImageLoadError, loadBitmap } from './load-image';

interface Props {
  /** Se llama cuando el usuario acepta el borrador. */
  onAccept?: (draft: ComponentDraft) => void;
}

export function PhotoIdentifier({ onAccept }: Props) {
  const [bitmap, setBitmap] = useState<Bitmap | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [marking, setMarking] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [accepted, setAccepted] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const draft: ComponentDraft | null = analysis
    ? buildDraft(analysis, marking, componentCatalog)
    : null;

  useEffect(() => {
    if (canvasRef.current && bitmap && analysis) {
      drawOverlay(canvasRef.current, bitmap, analysis.body, analysis.pins);
    }
  }, [bitmap, analysis]);

  const tomar = useCallback(async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    setAccepted(false);
    try {
      const bm = await loadBitmap(file);
      setBitmap(bm);
      setAnalysis(analyze(bm));
    } catch (e) {
      setBitmap(null);
      setAnalysis(null);
      setError(e instanceof ImageLoadError ? e.message
        : 'No se ha podido leer la imagen.');
    } finally {
      setBusy(false);
    }
  }, []);

  const porLado = (s: string) => analysis?.pins.filter((p) => p.side === s).length ?? 0;

  return (
    <section className="photo-identifier">
      <header className="pi-head">
        <div>
          <div className="eyebrow"><span className="eyebrow-line" /> DESDE FOTOGRAFÍA</div>
          <h2>Identificar una pieza por su foto</h2>
          <p>
            La fotografía da dos cosas distintas: la <strong>forma</strong> del
            encapsulado, que se mide, y el <strong>marcaje</strong> impreso, que
            identifica la pieza. Lo que una foto no puede decir es qué hace cada
            pata: eso sale del catálogo, o lo pone usted.
          </p>
        </div>
      </header>

      <div
        className="pi-drop"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); void tomar(e.dataTransfer.files?.[0]); }}
      >
        <input
          ref={fileRef} type="file" accept="image/*" hidden
          onChange={(e) => void tomar(e.target.files?.[0])}
        />
        <button type="button" className="pi-drop-btn" onClick={() => fileRef.current?.click()}>
          {busy ? <Loader2 size={18} className="spin" /> : <ImageUp size={18} />}
          <span>{busy ? 'Midiendo…' : 'Elegir una foto o arrastrarla aquí'}</span>
        </button>
        <small>
          Cenital, la pieza sola sobre un fondo claro y uniforme, y que se vean
          las patas completas. Nada sale de su equipo: la medida se hace aquí.
        </small>
      </div>

      {error && (
        <p className="pi-error"><AlertTriangle size={15} /> {error}</p>
      )}

      {bitmap && analysis && (
        <div className="pi-body">
          <div className="pi-canvas-wrap">
            <canvas ref={canvasRef} className="pi-canvas" />
            <span className="pi-legend">
              <i className="pi-dot pi-dot-body" /> cuerpo medido
              <i className="pi-dot pi-dot-pin" /> patas detectadas
            </span>
          </div>

          <div className="pi-readout">
            <h3><ScanLine size={15} /> Lo que se ha medido</h3>
            {analysis.body ? (
              <dl className="pi-facts">
                <div><dt>Encapsulado</dt><dd>{draft?.packageGuess ?? '—'}</dd></div>
                <div><dt>Patas contadas</dt><dd>{analysis.pins.length}</dd></div>
                <div><dt>Por lado</dt><dd>
                  {['top', 'bottom', 'left', 'right']
                    .filter((s) => porLado(s) > 0)
                    .map((s) => `${porLado(s)} ${
                      { top: 'arriba', bottom: 'abajo', left: 'izquierda', right: 'derecha' }[s as 'top']
                    }`).join(' · ') || '—'}
                </dd></div>
                <div><dt>Cuerpo</dt><dd>
                  {analysis.body.x1 - analysis.body.x0} × {analysis.body.y1 - analysis.body.y0} px
                </dd></div>
              </dl>
            ) : (
              <p className="pi-none">No se ha distinguido ninguna pieza del fondo.</p>
            )}

            {analysis.warnings.length > 0 && (
              <ul className="pi-warnings">
                {analysis.warnings.map((w) => (
                  <li key={w}><AlertTriangle size={14} /> {w}</li>
                ))}
              </ul>
            )}

            <h3><Cpu size={15} /> El marcaje</h3>
            <label className="pi-field">
              <span>Escriba lo que diga impreso el chip, tal cual</span>
              <textarea
                value={marking} rows={3}
                placeholder={'ATMEL\nATMEGA328P\n-PU\n1735'}
                onChange={(e) => { setMarking(e.target.value); setAccepted(false); }}
              />
            </label>

            {draft && marking.trim() !== '' && (
              <div className="pi-marking-result">
                {draft.candidates.length === 0 && draft.componentId === null && (
                  <p className="pi-none">
                    Ninguna pieza del catálogo corresponde a ese marcaje. No se
                    propone «la más parecida»: equivocar una referencia por otra
                    estropea el circuito.
                  </p>
                )}
                {draft.componentId && (
                  <p className="pi-hit"><Check size={15} /> {draft.name}</p>
                )}
                {draft.candidates.map((m) => (
                  <p className="pi-candidate" key={m.componentId}>
                    <strong>{m.name}</strong> — {m.reason}
                  </p>
                ))}
                {draft.discarded.length > 0 && (
                  <ul className="pi-discarded">
                    {draft.discarded.map((d) => (
                      <li key={d.token}><code>{d.token}</code> {d.why}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {draft && draft.conflicts.length > 0 && (
              <ul className="pi-conflicts">
                {draft.conflicts.map((c) => (
                  <li key={c}><AlertTriangle size={14} /> {c}</li>
                ))}
              </ul>
            )}

            {draft && draft.pending.length > 0 && (
              <>
                <h3>Queda por decidir</h3>
                <ul className="pi-pending">
                  {draft.pending.map((p) => <li key={p}>{p}</li>)}
                </ul>
              </>
            )}

            {draft && draft.pinCount > 0 && (
              <>
                <h3>Patas del borrador</h3>
                <ol className="pi-pins">
                  {draft.pins.map((p) => (
                    <li key={p.number}>
                      <span className="pi-pin-n">{p.number}</span>
                      <span className={p.name ? 'pi-pin-name' : 'pi-pin-null'}>
                        {p.name ?? 'sin nombre'}
                      </span>
                    </li>
                  ))}
                </ol>
                <p className="pi-note">
                  La numeración es provisional mientras no se sitúe la pata 1
                  por la muesca del encapsulado.
                </p>
              </>
            )}

            {draft && onAccept && draft.pinCount > 0 && (
              <button
                type="button" className="pi-accept"
                onClick={() => { onAccept(draft); setAccepted(true); }}
              >
                {accepted ? 'Borrador añadido' : 'Usar este borrador'}
              </button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
