/**
 * Circuito de la estación SHM (diagrama de conexiones), dibujado a partir de
 * los datos: `station-design.ts` (diseño de ingenierías y corrección de SPI1)
 * y `engineering-proposal.ts` (propuesta sin firmar). Si cambia un pin en esos
 * datos, cambia aquí. No es el esquemático de fabricación.
 */

import {
  PART_SELECTIONS,
  PROPOSAL,
  PROPOSED_CONNECTORS,
  pinoutTable,
  type PinOrigin,
  type PinoutRow,
} from './engineering-proposal';
import { REVIEW_FINDINGS, RMII_PINS_LQFP100, STATION_CONNECTORS, DEBUG_INTERFACE, LQFP100_PIN } from './station-design';
import './station-circuit.css';

const ORIGIN_LABEL: Record<PinOrigin, string> = {
  diseño: 'Diseño',
  corregido: 'Corregido (RV-01)',
  propuesta: 'Propuesta sin firmar',
};

function useRows(): Map<string, PinoutRow> {
  return new Map(pinoutTable().map((r) => [r.signal, r]));
}

export function StationCircuit(): React.JSX.Element {
  const rows = useRows();
  const pin = (signal: string): string => {
    const r = rows.get(signal);
    if (!r?.gpio) return 'sin pin';
    return r.lqfp100Pin ? `${r.gpio} (${r.lqfp100Pin})` : r.gpio;
  };
  const cls = (signal: string): string => {
    const o = rows.get(signal)?.origin;
    return o === 'corregido' ? 'sc-chg' : o === 'propuesta' ? 'sc-prop' : '';
  };
  const gpios = (signals: string[]): string => signals.map((s) => rows.get(s)?.gpio ?? '?').join('·');
  const pins = (signals: string[]): string => signals.map((s) => rows.get(s)?.lqfp100Pin ?? '?').join('·');
  const busSignals = ['ACC_SCK', 'ACC_MISO', 'ACC_MOSI'];
  const busPeripheral = (rows.get('ACC_SCK')?.fn ?? '').split('_')[0];
  const busAf = /AF\d+/.exec(rows.get('ACC_SCK')?.fn ?? '')?.[0] ?? '';
  const rv02 = REVIEW_FINDINGS.find((f) => f.id === 'RV-02');
  const connectors = [
    ...STATION_CONNECTORS.map((c) => ({ id: c.id, serves: c.serves, pins: c.pins, proposed: false })),
    ...PROPOSED_CONNECTORS.map((c) => ({ id: c.id, serves: c.serves, pins: c.pins, proposed: true })),
  ];

  return (
    <div className="sc-root">
      <header className="sc-head">
        <div className="sc-eyebrow">Viaducto de La Novena · estación dinámica SD</div>
        <h3>Circuito de la estación SHM</h3>
        <p>
          Diagrama de conexiones con el pinout corregido. En amarillo, la {PROPOSAL.status} de{' '}
          {PROPOSAL.author.toLowerCase()}: {PROPOSAL.requires} No es el esquemático de fabricación:
          faltan footprints y pasivos.
        </p>
        <div className="sc-legend">
          <span><i style={{ background: 'var(--sc-bus)' }} />Bus {busPeripheral} compartido</span>
          <span><i style={{ background: 'var(--sc-chg)' }} />Corregido por RV-01</span>
          <span><i style={{ background: 'var(--sc-wire)' }} />Señal del diseño</span>
          <span><i style={{ background: 'var(--sc-pwr)' }} />Alimentación</span>
          <span><i style={{ background: 'var(--sc-prop)' }} />Propuesta sin firmar</span>
        </div>
      </header>

      <div className="sc-scroll">
        <svg className="sc-svg" viewBox="0 0 1240 790" role="img" aria-label="Diagrama de conexiones de la estación SHM">
          {/* Alimentación */}
          <rect className="sc-box" x="20" y="20" width="160" height="112" rx="4" />
          <text className="sc-t" x="32" y="42">J6 · Entrada</text>
          <text x="32" y="64">1 VIN+ 12/24 VDC</text>
          <text x="32" y="82">2 VIN−/RTN</text>
          <text x="32" y="100">3 PE/CHASSIS</text>
          <text x="32" y="118" className="sc-prop">4 PWR_GOOD → {pin('PWR_GOOD')}</text>
          <path className="sc-p" d="M180 64 H220" />
          <rect className="sc-box" x="220" y="40" width="170" height="54" rx="4" />
          <text x="232" y="62">Fusible · inversión</text>
          <text x="232" y="80">TVS · filtro EMI</text>
          <path className="sc-p" d="M390 67 H420 M420 40 V162 M420 40 H450 M420 101 H450 M420 162 H450" />
          <rect className="sc-box" x="450" y="20" width="180" height="40" rx="4" /><text x="462" y="45">DC/DC 5 V</text>
          <rect className="sc-box" x="450" y="81" width="180" height="40" rx="4" /><text x="462" y="106">DC/DC 3V3 digital</text>
          <rect className="sc-box" x="450" y="142" width="180" height="40" rx="4" /><text x="462" y="167">DC/DC analógico</text>
          <text x="642" y="45" className="sc-m">→ GNSS / módem</text>
          <text x="642" y="106" className="sc-m">→ STM32H743</text>
          <text x="642" y="167" className="sc-m">→ ADS1262 / excitación</text>
          <text x="820" y="45" className="sc-m">Rails de sensor: +3V3_A (J1-1) y +3V3_S (J2-1).</text>
          <text x="820" y="63" className="sc-m">Prohibido 5 V en STM32, ADXL355 y SCL3300.</text>

          {/* MCU */}
          <rect className="sc-mcu" x="470" y="240" width="300" height="530" rx="6" />
          <text className="sc-t" x="520" y="268">STM32H743VIT6</text>
          <text x="520" y="286" className="sc-m">LQFP100 · (n) = pin físico</text>
          <text x="480" y="316" className={cls('ACC_SCK')}>{gpios(busSignals)} ({pins(busSignals)})</text>
          <text x="480" y="349" className={cls('ACC_CS_N')}>{pin('ACC_CS_N')}</text>
          <text x="480" y="376" className={cls('ACC_INT1')}>{gpios(['ACC_INT1', 'ACC_INT2'])} ({pins(['ACC_INT1', 'ACC_INT2'])})</text>
          <text x="480" y="474" className={cls('TILT_CS_N')}>{pin('TILT_CS_N')}</text>
          <text x="480" y="499" className={cls('TILT_INT')}>{pin('TILT_INT')}</text>
          <text x="480" y="594" className={cls('ADC_CS_N')}>{pin('ADC_CS_N')}</text>
          <text x="480" y="624" className={cls('ADC_DRDY_N')}>{pin('ADC_DRDY_N')}</text>
          <text x="480" y="654" className={cls('ADC_RESET_N')}>{pin('ADC_RESET_N')}</text>
          <text x="480" y="704" className={cls('PWR_GOOD')}>PWR_GOOD ← {pin('PWR_GOOD')}</text>
          <text x="480" y="722" className={cls('WDG_KICK')}>WDG_KICK → {pin('WDG_KICK')}</text>
          <text x="480" y="740" className={cls('ETH_PHY_RST_N')}>PHY_RST → {pin('ETH_PHY_RST_N')}</text>
          <text x="480" y="758" className={cls('LORA_RST_N')}>LORA_RST → {pin('LORA_RST_N')}</text>

          <text x="760" y="304" textAnchor="end" className={cls('GNSS_PPS')}>{pin('GNSS_PPS')}</text>
          <text x="760" y="329" textAnchor="end" className={cls('GNSS_TX')}>{pin('GNSS_TX')}</text>
          <text x="760" y="354" textAnchor="end" className={cls('GNSS_RX')}>{pin('GNSS_RX')}</text>
          <text x="760" y="394" textAnchor="end" className={cls('SENSOR_SYNC')}>{pin('SENSOR_SYNC')}</text>
          <text x="760" y="444" textAnchor="end">{gpios(['SDMMC_D0', 'SDMMC_CK', 'SDMMC_CMD'])}…</text>
          <text x="760" y="534" textAnchor="end">RMII · {Object.keys(RMII_PINS_LQFP100).length} pines</text>
          <text x="760" y="624" textAnchor="end">
            {DEBUG_INTERFACE.swd.swdio} ({LQFP100_PIN[DEBUG_INTERFACE.swd.swdio]}) · {DEBUG_INTERFACE.swd.swclk} ({LQFP100_PIN[DEBUG_INTERFACE.swd.swclk]})
          </text>
          <text x="760" y="684" textAnchor="end" className={cls('RS485_TX')}>{gpios(['RS485_TX', 'RS485_RX', 'RS485_DE'])}</text>
          <text x="760" y="744" textAnchor="end" className={cls('LORA_TX')}>{gpios(['LORA_TX', 'LORA_RX'])}</text>

          {/* Bus SPI */}
          <path className="sc-busc" d="M470 312 H380" />
          <path className="sc-bus" d="M380 312 V566 M380 312 H320 M380 442 H320 M380 566 H320" />
          <circle className="sc-dot" cx="380" cy="312" r="5" />
          <circle className="sc-dot" cx="380" cy="442" r="5" />
          <circle className="sc-dot" cx="380" cy="566" r="5" />
          <text x="392" y="300" className="sc-chg">{busPeripheral} {busAf}</text>
          <text x="330" y="304" className="sc-m sc-s">SCK·MISO·MOSI</text>
          <path className="sc-w" d="M470 345 H320" /><text x="392" y="340" className="sc-s">ACC_CS_N</text>
          <path className="sc-w sc-wp" d="M320 372 H470" /><text x="392" y="367" className="sc-s sc-prop">ACC_INT1/2</text>
          <path className="sc-w" d="M470 470 H320" /><text x="392" y="465" className="sc-s">TILT_CS_N</text>
          <path className="sc-w sc-wp" d="M320 495 H470" /><text x="392" y="490" className="sc-s sc-prop">TILT_INT</text>
          <path className="sc-w" d="M470 590 H320" /><text x="392" y="585" className="sc-s">ADC_CS_N</text>
          <path className="sc-w" d="M320 620 H470" /><text x="392" y="615" className="sc-s">ADC_DRDY_N</text>
          <path className="sc-w" d="M470 650 H320" /><text x="392" y="645" className="sc-s">ADC_RESET_N</text>

          {/* Sensores */}
          <rect className="sc-box" x="150" y="290" width="170" height="92" rx="4" />
          <text className="sc-t" x="162" y="312">ADXL355</text>
          <text x="162" y="331" className="sc-m">acelerómetro · vía J1</text>
          <text x="162" y="350" className="sc-m">3V3 · SPI · CS propio</text>
          <text x="162" y="370" className="sc-prop">INT1/INT2 → {gpios(['ACC_INT1', 'ACC_INT2']).replace('·', '/')}</text>
          <rect className="sc-box" x="150" y="415" width="170" height="92" rx="4" />
          <text className="sc-t" x="162" y="437">SCL3300-D01</text>
          <text x="162" y="456" className="sc-m">inclinómetro · vía J2</text>
          <text x="162" y="475" className="sc-m">si se usa en el sitio</text>
          <text x="162" y="495" className="sc-prop">DRDY/INT → {rows.get('TILT_INT')?.gpio} (opc.)</text>
          <rect className="sc-box" x="150" y="540" width="170" height="130" rx="4" />
          <text className="sc-t" x="162" y="562">ADS1262</text>
          <text x="162" y="581" className="sc-m">ADC de precisión</text>
          <text x="162" y="600" className="sc-m">rail analógico</text>
          <rect className="sc-box" x="16" y="545" width="104" height="34" rx="3" /><text x="24" y="567">J3 galgas</text>
          <rect className="sc-box" x="16" y="590" width="104" height="34" rx="3" /><text x="24" y="612">J4 Pt100</text>
          <rect className="sc-box" x="16" y="635" width="104" height="34" rx="3" />
          <text x="24" y="652" className="sc-s">J5 4–20 mA</text>
          <text x="24" y="665" className="sc-m sc-xs">receptor aislado</text>
          <path className="sc-w" d="M120 562 H150 M120 607 H150 M120 652 H150" />

          {/* Periféricos */}
          <path className="sc-w" d="M770 300 H880 M770 325 H880 M880 350 H770" />
          <text x="790" y="295" className="sc-s">PPS · TIM2_CH1</text>
          <text x="790" y="320" className="sc-s">TX · USART1</text>
          <text x="790" y="345" className="sc-s">RX · USART1</text>
          <rect className="sc-box" x="880" y="280" width="200" height="90" rx="4" />
          <text className="sc-t" x="892" y="302">Receptor GNSS · J7</text>
          <text x="892" y="322" className="sc-prop">{PART_SELECTIONS.find((p) => p.role.startsWith('Receptor GNSS'))?.choice.split(' o ')[0]}</text>
          <text x="892" y="342" className="sc-m">antena externa</text>
          <text x="892" y="360" className="sc-m">PPS a captura de timer</text>

          <path className="sc-w sc-wp" d="M770 390 H880" />
          <text x="790" y="385" className="sc-s sc-prop">SENSOR_SYNC</text>
          <text x="886" y="394" className="sc-s sc-prop">→ trigger cableado (opc.)</text>

          <path className="sc-bundle" d="M770 440 H880" />
          <text x="790" y="432" className="sc-s">SDMMC1 AF12</text>
          <rect className="sc-box" x="880" y="410" width="200" height="62" rx="4" />
          <text className="sc-t" x="892" y="434">microSD / eMMC</text>
          <text x="892" y="454" className="sc-m">industrial · STOR-01</text>

          <path className="sc-bundle" d="M770 530 H880" />
          <text x="790" y="522" className="sc-s">ETH RMII AF11</text>
          <rect className="sc-box" x="880" y="500" width="200" height="62" rx="4" />
          <text className="sc-t" x="892" y="524">PHY Ethernet</text>
          <text x="892" y="544" className="sc-prop">{PART_SELECTIONS.find((p) => p.role === 'PHY Ethernet')?.choice.split(' ')[1]}</text>
          <path className="sc-w" d="M1080 531 H1110" />
          <rect className="sc-box" x="1110" y="506" width="114" height="50" rx="4" />
          <text className="sc-t" x="1122" y="528">J8 RJ45</text>
          <text x="1122" y="546" className="sc-m sc-s">10/100</text>

          <path className="sc-w" d="M770 620 H880" />
          <rect className="sc-box" x="880" y="598" width="200" height="50" rx="4" />
          <text className="sc-t" x="892" y="620">Depuración SWD</text>
          <text x="892" y="638" className="sc-m">sin JTAG ni SWO</text>

          <path className="sc-w sc-wp" d="M770 680 H880" />
          <text x="790" y="675" className="sc-s sc-prop">USART3 + DE</text>
          <rect className="sc-dash" x="880" y="660" width="200" height="44" rx="4" />
          <text x="892" y="680" className="sc-prop">ADM2587E</text>
          <text x="892" y="697" className="sc-m sc-s">RS-485 aislado</text>
          <path className="sc-w" d="M1080 682 H1110" />
          <rect className="sc-box" x="1110" y="662" width="114" height="40" rx="4" />
          <text className="sc-t" x="1122" y="687">J9 A/B</text>

          <path className="sc-w sc-wp" d="M770 740 H880" />
          <text x="790" y="735" className="sc-s sc-prop">UART7</text>
          <rect className="sc-dash" x="880" y="720" width="200" height="44" rx="4" />
          <text x="892" y="740" className="sc-prop">RAK3172</text>
          <text x="892" y="757" className="sc-m sc-s">LoRaWAN, solo estado</text>
          <path className="sc-w" d="M1080 742 H1110" />
          <rect className="sc-box" x="1110" y="722" width="114" height="40" rx="4" />
          <text className="sc-t" x="1122" y="747">J10 SMA</text>
        </svg>
      </div>

      <div className="sc-grid">
        <section>
          <h4>Pinout del MCU</h4>
          <div className="sc-scroll">
            <table className="sc-table">
              <thead><tr><th>Señal</th><th>GPIO</th><th>Pin</th><th>Función</th><th>Origen</th></tr></thead>
              <tbody>
                {pinoutTable().map((r) => (
                  <tr key={r.signal} className={r.origin === 'corregido' ? 'sc-chg' : r.origin === 'propuesta' ? 'sc-prop' : ''}>
                    <td className="sc-mono">{r.signal}</td>
                    <td className="sc-mono">{r.gpio}</td>
                    <td>{r.lqfp100Pin}</td>
                    <td className="sc-mono">{r.fn}</td>
                    <td>{ORIGIN_LABEL[r.origin]}</td>
                  </tr>
                ))}
                <tr>
                  <td className="sc-mono">Ethernet RMII</td>
                  <td className="sc-mono" colSpan={2}>{Object.keys(RMII_PINS_LQFP100).join(', ')}</td>
                  <td className="sc-mono">ETH AF11</td>
                  <td>Reservados</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="sc-note">Pines y funciones verificados en ST DS12110 Rev 11, figura 5 y tablas 9 y 10.</p>
        </section>

        <section>
          <h4>Conectores</h4>
          <div className="sc-scroll">
            <table className="sc-table">
              <thead><tr><th>Conector</th><th>Pines</th></tr></thead>
              <tbody>
                {connectors.map((c) => (
                  <tr key={c.id} className={c.proposed ? 'sc-prop' : ''}>
                    <td className="sc-mono">{c.id} · {c.serves}</td>
                    <td className="sc-mono">{c.pins.map((p) => `${p.pin} ${p.signal}`).join(' · ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <h4>Componentes propuestos</h4>
          <ul className="sc-list">
            {PART_SELECTIONS.map((p) => (
              <li key={p.role}>
                <strong>{p.role}:</strong> {p.choice}. <span className="sc-muted">Verificar: {p.verifyBefore}</span>
              </li>
            ))}
            {rv02 && rv02.status !== 'resuelto' && (
              <li><strong>Placa de pruebas (RV-02, {rv02.status}):</strong> <span className="sc-muted">{rv02.finding}</span></li>
            )}
          </ul>
        </section>
      </div>
    </div>
  );
}
