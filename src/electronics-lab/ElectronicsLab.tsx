import { useMemo, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import {
  Cable,
  Check,
  Copy,
  Cpu,
  Redo2,
  RotateCw,
  Save,
  Trash2,
  Undo2,
  X,
  Zap,
} from 'lucide-react';
import { createCircuitComponent, getCircuitPins, validateCircuit } from '../domain/circuit';
import type { BoardId, CircuitComponent, CircuitConnection, ElectronicCircuit } from '../domain/types';
import './electronics-lab.css';

type Tool = 'select' | 'wire';
type CanvasMode = 'assembly' | 'schematic';
type Endpoint = { componentId: string; pinId: string };

const palette: { kind: CircuitComponent['kind']; label: string; icon: ReactNode }[] = [
  { kind: 'esp32', label: 'ESP32 DevKit', icon: <Cpu size={15} /> },
  { kind: 'mpu6050', label: 'MPU6050', icon: <Cpu size={15} /> },
  { kind: 'resistor', label: 'Resistencia', icon: <span className="el-palette-resistor" /> },
  { kind: 'capacitor', label: 'Condensador', icon: <span className="el-palette-capacitor" /> },
  { kind: 'led', label: 'LED', icon: <span className="el-palette-led" /> },
  { kind: 'button', label: 'Pulsador', icon: <span className="el-palette-button" /> },
  { kind: 'power', label: 'Alimentación', icon: <Zap size={15} /> },
  { kind: 'ground', label: 'Tierra (GND)', icon: <span className="el-palette-ground">⏚</span> },
];

function transformedPin(component: CircuitComponent, pin: { x: number; y: number }) {
  const radians = (component.rotation ?? 0) * Math.PI / 180;
  const x = component.x ?? 500;
  const y = component.y ?? 300;
  return {
    x: x + pin.x * Math.cos(radians) - pin.y * Math.sin(radians),
    y: y + pin.x * Math.sin(radians) + pin.y * Math.cos(radians),
  };
}

function ComponentGraphic({
  component,
  boardId,
  mode,
  selected,
}: {
  component: CircuitComponent;
  boardId: BoardId;
  mode: CanvasMode;
  selected: boolean;
}) {
  const pins = getCircuitPins(component, boardId);
  const title = component.value ? `${component.label} · ${component.value}` : component.label;
  const hitbox: [number, number, number, number] =
    component.kind === 'board' || component.kind === 'esp32' ? [-72, -58, 144, 116]
      : component.kind === 'mpu6050' ? [-43, -37, 86, 74]
        : component.kind === 'resistor' || component.kind === 'capacitor' ? [-53, -20, 106, 40]
          : component.kind === 'led' ? [-42, -39, 84, 78]
            : component.kind === 'button' ? [-34, -22, 68, 44]
              : [-25, -28, 50, 58];

  return (
    <g transform={`translate(${component.x ?? 500} ${component.y ?? 300}) rotate(${component.rotation ?? 0})`}
      className={`el-component${selected ? ' selected' : ''}`}>
      <rect x={hitbox[0]} y={hitbox[1]} width={hitbox[2]} height={hitbox[3]} className="el-component-hitbox" />
      {component.kind === 'board' || component.kind === 'esp32' ? (
        mode === 'assembly' ? (
          <>
            <rect x="-63" y="-44" width="126" height="88" rx="8" className="el-board-body" />
            <rect x="-18" y="-20" width="42" height="39" rx="3" className="el-board-chip" />
            <text x="3" y="3" className="el-chip-label">{component.kind === 'esp32' ? 'ESP32' : 'ATmega'}</text>
            <rect x="-8" y="-52" width="24" height="12" rx="2" className="el-usb" />
            <circle cx="-52" cy="-33" r="3" className="el-mount" /><circle cx="52" cy="-33" r="3" className="el-mount" />
            <circle cx="-52" cy="33" r="3" className="el-mount" /><circle cx="52" cy="33" r="3" className="el-mount" />
            <text x="0" y="34" className="el-board-title">{component.kind === 'esp32' ? 'ESP32 DEVKIT' : 'ARDUINO UNO R3'}</text>
            {pins.map((pin) => {
              const left = pin.x < 0;
              return <g key={pin.id}>
                <rect x={pin.x - 3} y={pin.y - 3} width="6" height="6" rx="1" className="el-header-pad" />
                <text x={pin.x + (left ? -7 : 7)} y={pin.y + 3} textAnchor={left ? 'end' : 'start'} className="el-pin-label">{pin.label}</text>
              </g>;
            })}
          </>
        ) : (
          <>
            <rect x="-65" y="-41" width="130" height="82" rx="4" className="el-schematic-symbol" />
            <text x="0" y="-8" className="el-schematic-label">{component.kind === 'esp32' ? 'ESP32' : 'ARDUINO'}</text>
            <text x="0" y="9" className="el-schematic-sub">{component.label}</text>
            {pins.map((pin) => <text key={pin.id} x={pin.x < 0 ? -58 : 58} y={pin.y * 0.64 + 2}
              textAnchor={pin.x < 0 ? 'start' : 'end'} className="el-schematic-pin">{pin.label}</text>)}
          </>
        )
      ) : component.kind === 'resistor' ? mode === 'schematic' ? (
        <><path d="M-49 0h12l7 -10 12 20 12 -20 12 20 12 -20 7 10h12" className="el-schematic-stroke" /><text x="0" y="27" className="el-value-label">{component.value ?? '220 Ω'}</text></>
        ) : (
        <>
          <line x1="-49" y1="0" x2="-28" y2="0" className="el-lead" />
          <rect x="-28" y="-10" width="56" height="20" rx="8" className="el-resistor-body" />
          <path d="M-16 -9v18 M-8 -9v18 M8 -9v18 M16 -9v18" className="el-resistor-band" />
          <line x1="28" y1="0" x2="49" y2="0" className="el-lead" />
          <text x="0" y="27" className="el-value-label">{component.value ?? '220 Ω'}</text>
        </>
      ) : component.kind === 'capacitor' ? (
        <>
          <line x1="-49" y1="0" x2="-5" y2="0" className="el-lead" /><line x1="5" y1="0" x2="49" y2="0" className="el-lead" />
          <path d="M-5 -16v32 M5 -16v32" className="el-capacitor-plate" />
          <text x="0" y="28" className="el-value-label">{component.value ?? '100 nF'}</text>
        </>
      ) : component.kind === 'led' ? (
        <>
          <line x1="-38" y1="0" x2="-20" y2="0" className="el-lead" /><line x1="20" y1="0" x2="38" y2="0" className="el-lead" />
          {mode === 'assembly' ? <path d="M-19 -13 Q0 -29 19 -13 L15 9 Q0 25 -15 9Z" className="el-led-lens" /> :
            <><path d="M-17 -15 L13 0 L-17 15Z" className="el-schematic-stroke" /><path d="M13 -16v32" className="el-schematic-stroke" /><path d="M1 -20l8 -8 M8 -13l8 -8" className="el-schematic-stroke" /></>}
          <text x="0" y="35" className="el-value-label">{component.label}</text>
        </>
      ) : component.kind === 'button' ? (
        <>
          <line x1="-31" y1="0" x2="-20" y2="0" className="el-lead" /><line x1="20" y1="0" x2="31" y2="0" className="el-lead" />
          {mode === 'assembly' ? <><rect x="-21" y="-13" width="42" height="26" rx="5" className="el-button-body" /><circle cx="0" cy="-2" r="7" className="el-button-cap" /></> :
            <><path d="M-20 0h9 M11 0h9 M-11 0l17 -12" className="el-schematic-stroke" /><circle cx="-11" cy="0" r="2" className="el-junction" /><circle cx="11" cy="0" r="2" className="el-junction" /></>}
          <text x="0" y="31" className="el-value-label">{component.label}</text>
        </>
      ) : component.kind === 'mpu6050' ? (
        <>
          <rect x="-37" y="-31" width="74" height="62" rx="5" className="el-sensor-board" />
          <rect x="-13" y="-12" width="26" height="25" rx="3" className="el-board-chip" />
          <text x="0" y="4" className="el-chip-label">MPU</text>
          {pins.map((pin) => <text key={pin.id} x={pin.x < 0 ? -31 : 31} y={pin.y + 3}
            textAnchor={pin.x < 0 ? 'start' : 'end'} className="el-pin-label">{pin.label}</text>)}
          <text x="0" y="44" className="el-value-label">{component.value ?? '0x68'}</text>
        </>
      ) : component.kind === 'ground' ? (
        <><path d="M0 -14v11 M-15 -3h30 M-10 3h20 M-5 9h10" className="el-ground-symbol" /><text x="0" y="25" className="el-value-label">GND</text></>
      ) : (
        <><path d="M0 -18L14 0L0 18L-14 0Z" className="el-power-symbol" /><text x="0" y="32" className="el-value-label">{component.label}</text></>
      )}
      {pins.map((pin) => {
        const board = component.kind === 'board' || component.kind === 'esp32';
        const sensor = component.kind === 'mpu6050';
        return <circle key={`terminal-${pin.id}`} cx={pin.x} cy={pin.y} r={board || sensor ? 3.8 : 4.5}
          className={`el-terminal el-terminal-${pin.type}`} data-pin={`${component.id}:${pin.id}`} />;
      })}
      <title>{title}</title>
    </g>
  );
}

function findPinPosition(circuit: ElectronicCircuit, componentId: string, pinId?: string) {
  const component = circuit.components.find((item) => item.id === componentId);
  if (!component) return null;
  const pin = getCircuitPins(component, circuit.boardId).find((item) => item.id === pinId);
  return pin ? transformedPin(component, pin) : { x: component.x ?? 500, y: component.y ?? 300 };
}

export function ElectronicsLab({
  circuit,
  boardId,
  onChange,
  saveState,
  onReset,
}: {
  circuit: ElectronicCircuit;
  boardId: BoardId;
  onChange: (circuit: ElectronicCircuit) => void;
  saveState: 'saved' | 'saving' | 'error';
  onReset: () => void;
}) {
  const [tool, setTool] = useState<Tool>('select');
  const [mode, setMode] = useState<CanvasMode>('assembly');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [wireStart, setWireStart] = useState<Endpoint | null>(null);
  const [wireColor, setWireColor] = useState('#e8a353');
  const [zoom, setZoom] = useState(1);
  const [history, setHistory] = useState<ElectronicCircuit[]>([]);
  const [future, setFuture] = useState<ElectronicCircuit[]>([]);
  const [activePanel, setActivePanel] = useState<'validation' | 'console' | 'simulation'>('validation');
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<{ id: string; offsetX: number; offsetY: number; before: ElectronicCircuit; moved: boolean } | null>(null);
  const validation = useMemo(() => validateCircuit(circuit), [circuit]);
  const selected = circuit.components.find((component) => component.id === selectedId) ?? null;

  const commit = (next: ElectronicCircuit) => {
    setHistory((previous) => [...previous.slice(-29), circuit]);
    setFuture([]);
    onChange(next);
  };

  const undo = () => {
    const previous = history.at(-1);
    if (!previous) return;
    setHistory((items) => items.slice(0, -1));
    setFuture((items) => [...items, circuit]);
    onChange(previous);
  };

  const redo = () => {
    const next = future.at(-1);
    if (!next) return;
    setFuture((items) => items.slice(0, -1));
    setHistory((items) => [...items.slice(-29), circuit]);
    onChange(next);
  };

  const updateComponent = (id: string, updates: Partial<CircuitComponent>) => {
    commit({ ...circuit, components: circuit.components.map((component) => component.id === id ? { ...component, ...updates } : component) });
  };

  const addComponent = (kind: CircuitComponent['kind']) => {
    const component = createCircuitComponent(kind, circuit.components.length + 1);
    commit({ ...circuit, components: [...circuit.components, component] });
    setSelectedId(component.id);
    setTool('select');
  };

  const deleteSelected = () => {
    if (!selected) return;
    commit({
      ...circuit,
      components: circuit.components.filter((component) => component.id !== selected.id),
      connections: circuit.connections.filter((connection) => connection.from !== selected.id && connection.to !== selected.id),
    });
    setSelectedId(null);
  };

  const clientToCanvas = (event: { clientX: number; clientY: number }) => {
    const svg = svgRef.current;
    const screenMatrix = svg?.getScreenCTM();
    if (!svg || !screenMatrix) return { x: 560, y: 310 };
    const point = svg.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    const local = point.matrixTransform(screenMatrix.inverse());
    return { x: local.x, y: local.y };
  };

  const startDrag = (event: PointerEvent<SVGGElement>, component: CircuitComponent) => {
    if (tool !== 'select') return;
    event.stopPropagation();
    setSelectedId(component.id);
    const point = clientToCanvas(event);
    dragRef.current = { id: component.id, offsetX: (component.x ?? 500) - point.x, offsetY: (component.y ?? 300) - point.y, before: circuit, moved: false };
    svgRef.current?.setPointerCapture(event.pointerId);
  };

  const moveOnCanvas = (event: PointerEvent<SVGSVGElement>) => {
    if (!dragRef.current) return;
    const point = clientToCanvas(event);
    const { id, offsetX, offsetY } = dragRef.current;
    dragRef.current.moved = true;
    onChange({
      ...circuit,
      components: circuit.components.map((component) => component.id === id
        ? { ...component, x: Math.max(75, Math.min(1045, point.x + offsetX)), y: Math.max(70, Math.min(550, point.y + offsetY)) }
        : component),
    });
  };

  const connectPins = (componentId: string, pinId: string) => {
    if (!wireStart) {
      setWireStart({ componentId, pinId });
      return;
    }
    if (wireStart.componentId === componentId && wireStart.pinId === pinId) return;
    const exists = circuit.connections.some((connection) =>
      (connection.from === wireStart.componentId && connection.fromPin === wireStart.pinId && connection.to === componentId && connection.toPin === pinId)
      || (connection.to === wireStart.componentId && connection.toPin === wireStart.pinId && connection.from === componentId && connection.fromPin === pinId));
    if (!exists) {
      const connection: CircuitConnection = {
        from: wireStart.componentId,
        fromPin: wireStart.pinId,
        to: componentId,
        toPin: pinId,
        color: wireColor,
      };
      commit({ ...circuit, connections: [...circuit.connections, connection] });
    }
    setWireStart(null);
    setTool('select');
  };

  const duplicateSelected = () => {
    if (!selected) return;
    const duplicate = { ...selected, id: crypto.randomUUID(), label: `${selected.label} copia`, x: (selected.x ?? 500) + 35, y: (selected.y ?? 300) + 35 };
    commit({ ...circuit, components: [...circuit.components, duplicate] });
    setSelectedId(duplicate.id);
  };

  const connectionPaths = circuit.connections.map((connection, index) => {
    const from = findPinPosition(circuit, connection.from, connection.fromPin);
    const to = findPinPosition(circuit, connection.to, connection.toPin);
    if (!from || !to) return null;
    const midX = Math.round((from.x + to.x) / 2);
    const path = `M ${from.x} ${from.y} H ${midX} V ${to.y} H ${to.x}`;
    return <g key={`${connection.from}-${connection.fromPin}-${connection.to}-${connection.toPin}-${index}`}
      className="el-wire-group" onClick={(event) => {
        event.stopPropagation();
        if (window.confirm('¿Eliminar este cable?')) commit({ ...circuit, connections: circuit.connections.filter((_, wireIndex) => wireIndex !== index) });
      }}>
      <path d={path} className="el-wire-hit" />
      <path d={path} className="el-wire" stroke={connection.color ?? '#e8a353'} />
    </g>;
  });

  return (
    <section className="electronics-lab" aria-label="EMBEDVERSE Electronics Lab">
      <header className="el-toolbar">
        <div className="el-product-mark"><span><Cpu size={17} /></span><div><strong>EMBEDVERSE</strong><small>ELECTRONICS LAB</small></div></div>
        <div className="el-project-name"><strong>{circuit.name}</strong><small>{circuit.components.length} componentes · guardado local</small></div>
        <div className={`el-save-state ${saveState}`}><span />{saveState === 'saving' ? 'Guardando' : saveState === 'error' ? 'Error al guardar' : 'Guardado'}</div>
        <div className="el-toolbar-divider" />
        <button type="button" className={tool === 'select' ? 'active' : ''} onClick={() => { setTool('select'); setWireStart(null); }}>Seleccionar</button>
        <button type="button" className={tool === 'wire' ? 'active' : ''} onClick={() => { setTool('wire'); setWireStart(null); }}><Cable size={14} /> Cablear</button>
        <button type="button" disabled={!history.length} title="Deshacer" onClick={undo}><Undo2 size={14} /></button>
        <button type="button" disabled={!future.length} title="Rehacer" onClick={redo}><Redo2 size={14} /></button>
        <button type="button" disabled={!selected} title="Duplicar componente" onClick={duplicateSelected}><Copy size={14} /></button>
        <button type="button" disabled={!selected} title="Eliminar componente" onClick={deleteSelected}><Trash2 size={14} /></button>
        <button type="button" title="Restablecer el circuito de ejemplo" onClick={() => { if (window.confirm('¿Restablecer el circuito de ejemplo? Se perderán los cambios actuales.')) onReset(); }}><RotateCw size={14} /></button>
        <button type="button" className="el-run-button" title="Simulación no disponible" disabled><Zap size={14} /> Simular</button>
      </header>

      <div className="el-workspace">
        <aside className="el-library">
          <div className="el-section-title"><span>Biblioteca</span><small>{palette.length} piezas</small></div>
          <p>Selecciona un componente para añadirlo al montaje.</p>
          {palette.map((item) => <button key={item.kind} type="button" className="el-library-item" onClick={() => addComponent(item.kind)}>
            <span className="el-library-icon">{item.icon}</span><span>{item.label}</span><span className="el-add-mark">+</span>
          </button>)}
          <div className="el-library-note"><strong>Representación técnica</strong><span>Ilustraciones vectoriales propias; no son modelos oficiales de fabricante.</span></div>
        </aside>

        <main className="el-canvas-area">
          <div className="el-canvas-toolbar">
            <div className="el-mode-switch" role="group" aria-label="Modo de diseño">
              <button type="button" className={mode === 'assembly' ? 'active' : ''} onClick={() => setMode('assembly')}>Montaje</button>
              <button type="button" className={mode === 'schematic' ? 'active' : ''} onClick={() => setMode('schematic')}>Esquemático</button>
            </div>
            <span className="el-canvas-hint">{tool === 'wire' ? wireStart ? 'Elige el pin de destino · Esc cancela' : 'Elige el pin inicial' : 'Arrastra componentes · selecciona un pin para cablear'}</span>
            {tool === 'wire' && <select className="el-wire-color" aria-label="Color de cable" value={wireColor} onChange={(event) => setWireColor(event.target.value)}>
              <option value="#e8a353">Naranja</option><option value="#e55562">Rojo</option><option value="#4b9ce2">Azul</option><option value="#6fbd8b">Verde</option><option value="#8394a8">Gris</option>
            </select>}
            <div className="el-zoom-control"><button type="button" aria-label="Alejar" onClick={() => setZoom((current) => Math.max(.65, current - .1))}>−</button><span>{Math.round(zoom * 100)}%</span><button type="button" aria-label="Acercar" onClick={() => setZoom((current) => Math.min(1.7, current + .1))}>+</button></div>
            {wireStart && <button type="button" className="el-cancel-wire" onClick={() => setWireStart(null)}><X size={13} /> Cancelar</button>}
          </div>
          <div className={`el-canvas ${mode}`} onPointerUp={() => {
            const drag = dragRef.current;
            if (drag?.moved) {
              setHistory((items) => [...items.slice(-29), drag.before]);
              setFuture([]);
            }
            dragRef.current = null;
          }}>
            <svg ref={svgRef} viewBox={`${(1120 - 1120 / zoom) / 2} ${(620 - 620 / zoom) / 2} ${1120 / zoom} ${620 / zoom}`} role="application" aria-label={`Editor de circuito, modo ${mode}`}
              onPointerMove={moveOnCanvas} onPointerCancel={() => { dragRef.current = null; }}
              onWheel={(event) => { event.preventDefault(); setZoom((current) => Math.max(.65, Math.min(1.7, current + (event.deltaY < 0 ? .08 : -.08)))); }}
              onPointerDown={() => { if (!dragRef.current) setSelectedId(null); }}>
              <defs>
                <pattern id="electronics-grid" width="20" height="20" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="1" fill="#334250" /></pattern>
                <pattern id="electronics-grid-major" width="100" height="100" patternUnits="userSpaceOnUse"><rect width="100" height="100" fill="url(#electronics-grid)" /><path d="M100 0H0V100" fill="none" stroke="#1b2834" strokeWidth="1" /></pattern>
              </defs>
              <rect width="1120" height="620" fill="url(#electronics-grid-major)" />
              {connectionPaths}
              {circuit.components.map((component) => (
                <g key={component.id} onPointerDown={(event) => startDrag(event, component)}
                  onClick={() => setSelectedId(component.id)} className={`el-component-hit${tool === 'select' ? ' draggable' : ''}`}>
                  <ComponentGraphic component={component} boardId={boardId} mode={mode} selected={selectedId === component.id} />
                  {getCircuitPins(component, boardId).map((pin) => {
                    const point = transformedPin(component, pin);
                    const pending = wireStart?.componentId === component.id && wireStart.pinId === pin.id;
                    return <circle key={`hit-${pin.id}`} cx={point.x} cy={point.y} r="12" className={`el-pin-hit${pending ? ' pending' : ''}`}
                      onPointerDown={(event) => event.stopPropagation()}
                      onClick={(event) => { event.stopPropagation(); if (tool === 'wire') connectPins(component.id, pin.id); else setSelectedId(component.id); }}>
                      <title>{`${component.label} · ${pin.label} · ${pin.type}`}</title>
                    </circle>;
                  })}
                </g>
              ))}
            </svg>
            {circuit.components.length === 0 && <div className="el-empty-canvas"><Cpu size={30} /><strong>El espacio de diseño está vacío</strong><span>Añade componentes desde la biblioteca para comenzar.</span></div>}
            <div className="el-canvas-scale">20 px / cuadrícula · las dimensiones físicas aún no están calibradas</div>
          </div>
        </main>

        <aside className="el-inspector">
          <div className="el-section-title"><span>Propiedades</span>{selected && <small>{selected.kind}</small>}</div>
          {!selected ? <div className="el-inspector-empty">Selecciona un componente para editar sus propiedades.</div> : (
            <div className="el-property-form">
              <div className={`el-selected-preview ${selected.kind}`}><ComponentGraphic component={{ ...selected, x: 90, y: 58 }} boardId={boardId} mode={mode} selected /></div>
              <label>Referencia / nombre<input value={selected.label} onChange={(event) => updateComponent(selected.id, { label: event.target.value })} /></label>
              {selected.value !== undefined && <label>{selected.kind === 'mpu6050' ? 'Dirección I²C (referencia)' : selected.kind === 'led' ? 'Color del encapsulado' : 'Valor nominal'}<input value={selected.value} onChange={(event) => updateComponent(selected.id, { value: event.target.value })} /></label>}
              <div className="el-property-row">
                <label>X<input type="number" value={Math.round(selected.x ?? 0)} onChange={(event) => updateComponent(selected.id, { x: Number(event.target.value) })} /></label>
                <label>Y<input type="number" value={Math.round(selected.y ?? 0)} onChange={(event) => updateComponent(selected.id, { y: Number(event.target.value) })} /></label>
              </div>
              <label>Rotación
                <div className="el-rotation-control"><input type="number" step="90" value={selected.rotation ?? 0} onChange={(event) => updateComponent(selected.id, { rotation: Number(event.target.value) })} /><button type="button" title="Rotar 90 grados" onClick={() => updateComponent(selected.id, { rotation: ((selected.rotation ?? 0) + 90) % 360 })}><RotateCw size={14} /></button></div>
              </label>
              <div className="el-property-description">{selected.description}</div>
              <div className="el-pin-list"><strong>Terminales</strong>{getCircuitPins(selected, boardId).map((pin) => <div key={pin.id}><span className={`el-pin-dot ${pin.type}`} />{pin.label}<small>{pin.type}</small></div>)}</div>
              <div className="el-inspector-actions">
                <button type="button" onClick={duplicateSelected}><Copy size={13} /> Duplicar</button>
                <button type="button" className="danger" onClick={deleteSelected}><Trash2 size={13} /> Eliminar</button>
              </div>
            </div>
          )}
        </aside>
      </div>

      <footer className="el-bottom-panel">
        <div className="el-bottom-tabs">
          <button type="button" className={activePanel === 'validation' ? 'active' : ''} onClick={() => setActivePanel('validation')}>Validación {validation.issues.length > 0 && <span>{validation.issues.length}</span>}</button>
          <button type="button" className={activePanel === 'console' ? 'active' : ''} onClick={() => setActivePanel('console')}>Consola</button>
          <button type="button" className={activePanel === 'simulation' ? 'active' : ''} onClick={() => setActivePanel('simulation')}>Simulación</button>
          <span className="el-bottom-note"><Save size={12} /> Se guarda con el proyecto</span>
        </div>
        <div className="el-bottom-content">
          {activePanel === 'validation' && (validation.valid
            ? <div className="el-validation-ok"><Check size={14} /> {validation.summary}</div>
            : <ul>{validation.issues.map((issue) => <li key={issue}>{issue}</li>)}</ul>)}
          {activePanel === 'console' && <span>Motor de conectividad local. No hay consola de firmware ni telemetría activa.</span>}
          {activePanel === 'simulation' && <span>Simulación eléctrica y de microcontroladores no disponible. El estado visual no representa resultados calculados.</span>}
        </div>
      </footer>
    </section>
  );
}
