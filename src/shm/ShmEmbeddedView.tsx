/**
 * Sistema embebido de la estación SHM: el STM32H743VIT6 con todo lo que tiene
 * conectado (sensores, ADC, almacenamiento, GNSS, Ethernet, RS-485, LoRa,
 * alimentación y depuración) y el estado del firmware.
 *
 * NO EMULA NADA. El motor de la aplicación solo ejecuta ATmega328P, y el
 * firmware de la estación no está escrito. Es una vista de diseño dibujada a
 * partir de `station-design.ts`, `engineering-proposal.ts` y `station-board.ts`.
 */

import { useMemo, useState } from 'react';

import { PROPOSED_SIGNALS, pinoutTable, type PinoutRow } from './engineering-proposal';
import {
  BOARD_NOT_DRAWN, BOARD_PARTS, BOARD_SIZE, CHIP_OFFSET, FIELD_BLOCKS,
  type BoardPart, type PartSide,
} from './station-board';
import { DEBUG_INTERFACE, LQFP100_PINOUT, RMII_PINS_LQFP100, gpioOfPin } from './station-design';
import './shm-embedded.css';

export type Group =
  | 'bus' | 'sensor' | 'gnss' | 'storage' | 'eth' | 'comms' | 'debug' | 'system' | 'power' | 'clock' | 'free';

const GROUP_LABEL: Record<Group, string> = {
  bus: 'Bus SPI1 de sensores',
  sensor: 'Control de sensores',
  gnss: 'GNSS y sincronía',
  storage: 'microSD',
  eth: 'Ethernet RMII',
  comms: 'RS-485 y LoRa',
  debug: 'Depuración SWD',
  system: 'Sistema',
  power: 'Alimentación y control',
  clock: 'Osciladores',
  free: 'Libre',
};

function groupOfSignal(signal: string): Group {
  if (/^ACC_(SCK|MISO|MOSI)$/.test(signal)) return 'bus';
  if (/^(ACC|TILT|ADC)_/.test(signal)) return 'sensor';
  if (/^GNSS_|^SENSOR_SYNC$/.test(signal)) return 'gnss';
  if (/^SDMMC_/.test(signal)) return 'storage';
  if (/^ETH_/.test(signal)) return 'eth';
  if (/^(RS485|LORA)_/.test(signal)) return 'comms';
  return 'system';
}

export interface PinInfo {
  number: number;
  name: string;
  gpio: string | null;
  group: Group;
  /** Red que sale por la patilla: señal del MCU, función RMII o SWD. */
  net: string | null;
  row?: PinoutRow;
  reserved?: string;
}

export function buildPins(rows: PinoutRow[]): PinInfo[] {
  const byGpio = new Map(rows.filter((r) => r.gpio).map((r) => [r.gpio!, r]));
  return LQFP100_PINOUT.map((name, i): PinInfo => {
    const gpio = gpioOfPin(name);
    const base = { number: i + 1, name, gpio };
    if (!gpio) return { ...base, net: null, group: /OSC/.test(name) ? 'clock' : 'power' };
    const row = byGpio.get(gpio);
    if (row) return { ...base, group: groupOfSignal(row.signal), row, net: row.signal };
    if (RMII_PINS_LQFP100[gpio]) return { ...base, group: 'eth', reserved: RMII_PINS_LQFP100[gpio], net: RMII_PINS_LQFP100[gpio] };
    if (gpio === DEBUG_INTERFACE.swd.swdio) return { ...base, group: 'debug', reserved: 'SWDIO', net: 'SWDIO' };
    if (gpio === DEBUG_INTERFACE.swd.swclk) return { ...base, group: 'debug', reserved: 'SWCLK', net: 'SWCLK' };
    if (/OSC/.test(name)) return { ...base, net: null, group: 'clock' };
    return { ...base, net: null, group: 'free' };
  });
}

interface PinGeo { x: number; y: number; w: number; h: number; lx: number; ly: number; anchor: 'start' | 'end'; rotate: number; tip: [number, number]; normal: [number, number] }

/** Geometría de la patilla n, ya desplazada a su sitio en el esquema. */
function pinGeometry(n: number): PinGeo {
  const { x: dx, y: dy } = CHIP_OFFSET;
  const step = 16;
  const k = (n - 1) % 25;
  const off = 120 + 8 + k * step;
  const rev = 120 + 8 + (24 - k) * step;
  if (n <= 25) return { x: 100 + dx, y: off - 4 + dy, w: 20, h: 8, lx: 96 + dx, ly: off + 3 + dy, anchor: 'end', rotate: 0, tip: [100 + dx, off + dy], normal: [-1, 0] };
  if (n <= 50) return { x: off - 4 + dx, y: 520 + dy, w: 8, h: 20, lx: off + 3 + dx, ly: 544 + dy, anchor: 'end', rotate: -90, tip: [off + dx, 540 + dy], normal: [0, 1] };
  if (n <= 75) return { x: 520 + dx, y: rev - 4 + dy, w: 20, h: 8, lx: 544 + dx, ly: rev + 3 + dy, anchor: 'start', rotate: 0, tip: [540 + dx, rev + dy], normal: [1, 0] };
  return { x: rev - 4 + dx, y: 100 + dy, w: 8, h: 20, lx: rev + 3 + dx, ly: 96 + dy, anchor: 'start', rotate: -90, tip: [rev + dx, 100 + dy], normal: [0, -1] };
}

const SIDE_NORMAL: Record<PartSide, [number, number]> = { top: [0, -1], bottom: [0, 1], left: [-1, 0], right: [1, 0] };

/** Punto de anclaje del terminal i de una parte. */
function partPinPoint(part: BoardPart, i: number): [number, number] {
  const n = part.pins.length;
  if (part.side === 'top' || part.side === 'bottom') {
    const x = part.x + (part.w * (i + 1)) / (n + 1);
    return [x, part.side === 'top' ? part.y : part.y + part.h];
  }
  const top = part.y + 34;
  const y = top + ((part.h - 40) * (i + 0.5)) / n;
  return [part.side === 'left' ? part.x : part.x + part.w, y];
}

function wirePath(a: [number, number], na: [number, number], b: [number, number], nb: [number, number]): string {
  const d = 120;
  return `M${a[0]} ${a[1]} C${a[0] + na[0] * d} ${a[1] + na[1] * d} ${b[0] + nb[0] * d} ${b[1] + nb[1] * d} ${b[0]} ${b[1]}`;
}

const FIRMWARE: { module: string; detail: string; state: 'sin escribir' | 'en la plataforma' }[] = [
  { module: 'Arranque y relojes', detail: 'Relojes, SysTick y watchdog externo por WDG_KICK.', state: 'sin escribir' },
  { module: 'SPI1: ADXL355, SCL3300 y ADS1262', detail: '200 muestras/s del acelerómetro (ODR ≥ 500 Hz) e interrupciones en INT1/INT2; un CS por dispositivo.', state: 'sin escribir' },
  { module: 'PPS por TIM2', detail: 'Captura del PPS en TIM2_CH1 y SENSOR_SYNC en TIM2_CH4.', state: 'sin escribir' },
  { module: 'GNSS por USART1', detail: 'Hora UTC y estado; el UART no sustituye al PPS.', state: 'sin escribir' },
  { module: 'microSD por SDMMC1', detail: 'Bloques crudos con CRC32 y retención de 7 días.', state: 'sin escribir' },
  { module: 'Ethernet RMII', detail: 'Envío de archivos al gateway; reset del PHY en ETH_PHY_RST_N.', state: 'sin escribir' },
  { module: 'RS-485 y LoRaWAN', detail: 'USART3 con DE por hardware; UART7 al módulo LoRa, solo estado.', state: 'sin escribir' },
  { module: 'Calidad E1, línea base y alarmas', detail: 'Contrato de datos, reglas E1 y clasificación que se niega sin umbrales firmados (src/shm).', state: 'en la plataforma' },
];

export function ShmEmbeddedView(): React.JSX.Element {
  const rows = useMemo(() => pinoutTable(), []);
  const pins = useMemo(() => buildPins(rows), [rows]);
  const pinByNet = useMemo(() => new Map(pins.filter((p) => p.net).map((p) => [p.net!, p])), [pins]);
  const [selected, setSelected] = useState<number>(pins.find((p) => p.net === 'ACC_SCK')?.number ?? 1);
  const pin = pins[selected - 1];
  const selectedNet = pin.net;
  const proposal = pin.row ? PROPOSED_SIGNALS.find((p) => p.signal === pin.row!.signal) : undefined;
  const connectedParts = BOARD_PARTS.filter((part) => part.pins.some((pp) => pp.net && pp.net === selectedNet));
  const groups = (Object.keys(GROUP_LABEL) as Group[]).filter((g) => g !== 'free' && g !== 'power' && g !== 'clock');

  const selectNet = (net: string | null) => {
    const target = net ? pinByNet.get(net) : undefined;
    if (target) setSelected(target.number);
  };
  const keyActivate = (fn: () => void) => (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      fn();
    }
  };

  const wires = BOARD_PARTS.flatMap((part) =>
    part.pins.flatMap((pp, i) => {
      const chip = pp.net ? pinByNet.get(pp.net) : undefined;
      if (!chip) return [];
      const g = pinGeometry(chip.number);
      return [{
        key: `${part.id}-${i}`,
        d: wirePath(g.tip, g.normal, partPinPoint(part, i), SIDE_NORMAL[part.side]),
        group: chip.group,
        on: pp.net === selectedNet,
      }];
    }),
  );

  return (
    <div className="shm-root">
      <header className="shm-head">
        <div>
          <div className="shm-eyebrow">Estación SHM · Viaducto de La Novena</div>
          <h2>Sistema embebido de la estación · STM32H743VIT6</h2>
        </div>
        <span className="shm-badge">Sin emulación</span>
      </header>
      <p className="shm-intro">
        Esquema completo de la estación: el microcontrolador y todo lo que lleva conectado. Es una vista del diseño, no
        una simulación: el motor de la aplicación solo ejecuta el ATmega328P del Arduino Uno, y el firmware de la estación
        todavía no está escrito. Pulsa una patilla o un terminal para resaltar su conexión. En amarillo, lo que es
        propuesta sin firmar; en gris discontinuo, lo que el diseño no define.
      </p>

      <div className="shm-board-wrap">
        <svg className="shm-board" viewBox={`0 0 ${BOARD_SIZE.w} ${BOARD_SIZE.h}`} role="img" aria-label="Esquema de conexiones de la estación SHM">
          {/* Conexiones de campo y de potencia */}
          {FIELD_BLOCKS.filter((b) => b.link).map((b) => (
            <line key={`l-${b.id}`} className={b.power ? 'shm-link shm-link-pwr' : 'shm-link'} x1={b.link![0]} y1={b.link![1]} x2={b.link![2]} y2={b.link![3]} />
          ))}

          {/* Conexiones con el MCU */}
          {wires.filter((w) => !w.on).map((w) => (
            <path key={w.key} className={`shm-wire shm-g-${w.group}`} d={w.d} />
          ))}
          {wires.filter((w) => w.on).map((w) => (
            <path key={w.key} className={`shm-wire shm-wire-on shm-g-${w.group}`} d={w.d} />
          ))}

          {/* Chip */}
          <rect className="shm-body" x={120 + CHIP_OFFSET.x} y={120 + CHIP_OFFSET.y} width="400" height="400" rx="6" />
          <circle className="shm-dot1" cx={140 + CHIP_OFFSET.x} cy={140 + CHIP_OFFSET.y} r="6" />
          <text className="shm-chip-name" x={320 + CHIP_OFFSET.x} y={300 + CHIP_OFFSET.y} textAnchor="middle">STM32H743VIT6</text>
          <text className="shm-chip-sub" x={320 + CHIP_OFFSET.x} y={324 + CHIP_OFFSET.y} textAnchor="middle">LQFP100 · Cortex-M7 480 MHz</text>
          <text className="shm-chip-sel" x={320 + CHIP_OFFSET.x} y={370 + CHIP_OFFSET.y} textAnchor="middle">{pin.number} · {pin.name}</text>
          <text className="shm-chip-sub" x={320 + CHIP_OFFSET.x} y={392 + CHIP_OFFSET.y} textAnchor="middle">
            {pin.net ?? GROUP_LABEL[pin.group]}
          </text>
          {pins.map((p) => {
            const g = pinGeometry(p.number);
            const interactive = p.group !== 'free';
            return (
              <g
                key={p.number}
                className={`shm-pin shm-g-${p.group}${p.number === selected ? ' shm-sel' : ''}${p.row?.origin === 'propuesta' ? ' shm-prop' : ''}`}
                onClick={() => setSelected(p.number)}
                onKeyDown={keyActivate(() => setSelected(p.number))}
                tabIndex={interactive ? 0 : -1}
                role="button"
                aria-label={`Patilla ${p.number} ${p.name}${p.row ? `, ${p.row.signal}` : ''}`}
              >
                <rect x={g.x} y={g.y} width={g.w} height={g.h} />
                <text x={g.lx} y={g.ly} textAnchor={g.anchor} transform={g.rotate ? `rotate(${g.rotate} ${g.lx} ${g.ly})` : undefined}>
                  {p.row ? p.row.signal : p.name}
                </text>
              </g>
            );
          })}

          {/* Bloques sin conexión directa al MCU */}
          {FIELD_BLOCKS.map((b) => (
            <g key={b.id} className={`shm-part shm-o-${b.origin}${b.power ? ' shm-pwr' : ''}`}>
              <rect x={b.x} y={b.y} width={b.w} height={b.h} rx="5" />
              <text className="shm-part-title" x={b.x + 10} y={b.y + 19}>{b.title}</text>
              {b.h >= 44 && <text className="shm-part-sub" x={b.x + 10} y={b.y + 36}>{b.subtitle}</text>}
              {b.h < 44 && <title>{b.subtitle}</title>}
            </g>
          ))}

          {/* Componentes conectados al MCU */}
          {BOARD_PARTS.map((part) => (
            <g key={part.id} className={`shm-part shm-o-${part.origin}${connectedParts.includes(part) ? ' shm-part-on' : ''}`}>
              <rect x={part.x} y={part.y} width={part.w} height={part.h} rx="6" />
              {/* Con los terminales arriba, el título va abajo para no pisarlos. */}
              <text className="shm-part-title" x={part.x + 10} y={part.side === 'top' ? part.y + part.h - 26 : part.y + 20}>{part.title}</text>
              <text className="shm-part-sub" x={part.x + 10} y={part.side === 'top' ? part.y + part.h - 10 : part.y + 36}>{part.subtitle}</text>
              {part.pins.map((pp, i) => {
                const [px, py] = partPinPoint(part, i);
                const chip = pp.net ? pinByNet.get(pp.net) : undefined;
                const text = chip ? `${pp.label} · ${chip.gpio}/${chip.number}` : pp.label;
                const on = pp.net !== null && pp.net === selectedNet;
                let tx = px;
                let ty = py;
                let anchor: 'start' | 'end' = 'start';
                let rotate = 0;
                if (part.side === 'bottom') { ty = py - 8; tx = px + 4; rotate = -90; }
                if (part.side === 'top') { ty = py + 8; tx = px - 4; rotate = 90; }
                if (part.side === 'right') { tx = px - 10; ty = py + 4; anchor = 'end'; }
                if (part.side === 'left') { tx = px + 10; ty = py + 4; }
                return (
                  <g
                    key={pp.label}
                    className={`shm-tpin${on ? ' shm-tpin-on' : ''}${chip ? ` shm-g-${chip.group}` : ''}`}
                    onClick={() => selectNet(pp.net)}
                    onKeyDown={keyActivate(() => selectNet(pp.net))}
                    tabIndex={chip ? 0 : -1}
                    role={chip ? 'button' : undefined}
                    aria-label={chip ? `${part.title} ${pp.label}, a la patilla ${chip.number}` : undefined}
                  >
                    <circle cx={px} cy={py} r="4" />
                    <text x={tx} y={ty} textAnchor={anchor} transform={rotate ? `rotate(${rotate} ${tx} ${ty})` : undefined}>{text}</text>
                  </g>
                );
              })}
            </g>
          ))}

          <text className="shm-part-sub" x="20" y={BOARD_SIZE.h - 14}>{BOARD_NOT_DRAWN}</text>
        </svg>
      </div>

      <div className="shm-layout">
        <section className="shm-card">
          <h3>Patilla {pin.number} · {pin.name}</h3>
          <dl className="shm-dl">
            <dt>Uso</dt><dd>{pin.net ?? GROUP_LABEL[pin.group]}</dd>
            {pin.row && (<><dt>Función</dt><dd>{pin.row.fn}</dd></>)}
            {pin.row && (<><dt>Dirección</dt><dd>{pin.row.direction}</dd></>)}
            {pin.row && (<><dt>Origen</dt><dd>{pin.row.origin === 'propuesta' ? 'Propuesta sin firmar' : pin.row.origin === 'corregido' ? 'Corregido (RV-01)' : 'Diseño de ingenierías'}</dd></>)}
            {pin.reserved && (<><dt>Estado</dt><dd>Reservado</dd></>)}
            <dt>Conecta con</dt>
            <dd>{connectedParts.length ? connectedParts.map((p) => p.title).join(', ') : '—'}</dd>
          </dl>
          {pin.row?.changedFrom && <p className="shm-note">{pin.row.changedFrom}</p>}
          {proposal && <p className="shm-note">{proposal.rationale}</p>}
          {pin.group === 'free' && <p className="shm-note">Patilla libre: el diseño no la usa.</p>}
        </section>

        <section className="shm-card">
          <h3>Patillas por función</h3>
          <ul className="shm-groups">
            {groups.map((g) => {
              const members = pins.filter((p) => p.group === g);
              if (!members.length) return null;
              return (
                <li key={g}>
                  <span className={`shm-swatch shm-g-${g}`} />
                  <strong>{GROUP_LABEL[g]}</strong>
                  <span className="shm-chips">
                    {members.map((m) => (
                      <button key={m.number} type="button" className={m.number === selected ? 'shm-on' : ''} onClick={() => setSelected(m.number)}>
                        {m.gpio}
                      </button>
                    ))}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      </div>

      <section className="shm-card">
        <h3>Firmware de la estación</h3>
        <table className="shm-table">
          <thead><tr><th>Módulo</th><th>Qué hace</th><th>Estado</th></tr></thead>
          <tbody>
            {FIRMWARE.map((f) => (
              <tr key={f.module}>
                <td>{f.module}</td>
                <td>{f.detail}</td>
                <td><span className={`shm-state ${f.state === 'sin escribir' ? 'shm-todo' : 'shm-done'}`}>{f.state}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
