/**
 * Plantillas de proyecto.
 *
 * Existen para que lo que el sistema sabe hacer esté a mano. Sin una plantilla,
 * para llegar al armario del puente había que dibujar el circuito pin a pin y
 * escribir el firmware desde cero, y eso deja el trabajo enterrado.
 */

import { createArduinoPracticeCircuit } from './circuit';
import { createBridgeLightingCircuit } from './bridgeLightingCircuit';
import type { BoardId, ElectronicCircuit } from './types';

export interface ProjectTemplate {
  id: string;
  label: string;
  description: string;
  /** Placas para las que tiene sentido. Vacío = todas. */
  boards: BoardId[];
  circuit: (boardId: BoardId) => ElectronicCircuit;
  /** Contenido del archivo principal. */
  source: (boardId: BoardId) => string;
}

/**
 * Firmware del armario, en Arduino C++.
 *
 * Es el **equivalente legible** del firmware de referencia
 * `public/firmware/puente-alumbrado.S`, que es el `.hex` que se entrega.
 *
 * Los dos están verificados. `src/simulation/bridge-firmware-cpp.test.ts`
 * compila este C++ de verdad y ejecuta el `.hex` resultante sobre el mismo
 * circuito, exigiéndole la misma conducta en los cuatro modos. Esa prueba se
 * salta cuando no hay cadena de herramientas Arduino para el sistema, así que
 * en un equipo recién clonado no se comprueba: para tenerla, ejecute
 * `./scripts/setup-arduino.sh`.
 *
 * Si alguna vez discrepan, manda el `.S`: es el que se entrega compilado.
 */
const BRIDGE_CABINET_SOURCE = `/*
 * Armario de mando del alumbrado · Viaducto de la Novena
 * Arduino Uno R3 (ATmega328P a 16 MHz)
 *
 * Gobierna cuatro zonas de alumbrado desde una fotocelda y un pulsador.
 *
 *   A0  fotocelda (salida analogica del modulo LM393)
 *   D2  pulsador de mando, con polarizacion interna: pulsar pone el pin a CERO
 *   D4  zona vial (calzada)
 *   D5  zona tirantes
 *   D6  zona torres
 *   D7  zona barreras
 *   D13 testigo: encendido si alguna zona esta energizada
 *
 * NOTA SOBRE LA VERIFICACION: el firmware que se entrega compilado es
 * public/firmware/puente-alumbrado.S. Este archivo es su equivalente legible
 * en C++, y se compila y se contrasta contra la misma conducta en
 * src/simulation/bridge-firmware-cpp.test.ts, siempre que haya cadena de
 * herramientas Arduino instalada. Si discrepan, manda el .S.
 *
 * Lo que este firmware NO hace: no mide lux (el umbral es un recuento del
 * convertidor, no una medida fotometrica) y no usa temporizadores para el
 * antirrebote, asi que los tiempos son aproximados.
 */

const uint8_t PIN_MANDO     = 2;
const uint8_t PIN_VIAL      = 4;
const uint8_t PIN_TIRANTES  = 5;
const uint8_t PIN_TORRES    = 6;
const uint8_t PIN_BARRERAS  = 7;
const uint8_t PIN_TESTIGO   = 13;
const uint8_t PIN_FOTOCELDA = A0;

// Por debajo de 256 cuentas (de 1024) se considera oscuridad. Es el mismo
// criterio que el firmware en ensamblador, que comprueba si ADCH quedo a cero.
const int UMBRAL_OSCURIDAD = 256;

const unsigned long ANTIRREBOTE_MS = 45;

// Modos, en el orden en que el pulsador los recorre.
enum Modo : uint8_t {
  AUTOMATICO     = 0,  // las cuatro zonas siguen a la fotocelda
  TODO_ENCENDIDO = 1,  // las cuatro encendidas, haya luz o no
  SOLO_VIAL      = 2,  // la calzada sigue a la fotocelda; lo ornamental, apagado
  MANTENIMIENTO  = 3,  // todo apagado, incluida la calzada
  TOTAL_MODOS    = 4
};

uint8_t modo = AUTOMATICO;
bool anteriorSuelto = true;
uint8_t ultimoInforme = 0xFF;  // imposible: fuerza el primer informe

void setup() {
  pinMode(PIN_MANDO, INPUT_PULLUP);
  pinMode(PIN_VIAL, OUTPUT);
  pinMode(PIN_TIRANTES, OUTPUT);
  pinMode(PIN_TORRES, OUTPUT);
  pinMode(PIN_BARRERAS, OUTPUT);
  pinMode(PIN_TESTIGO, OUTPUT);
  Serial.begin(9600);
}

void loop() {
  // --- pulsador, por flanco de bajada ---
  // Cuenta el FLANCO, no el nivel: mantenerlo pulsado no debe recorrer los
  // modos uno tras otro.
  bool suelto = digitalRead(PIN_MANDO) == HIGH;
  if (anteriorSuelto && !suelto) {
    modo = (modo + 1) % TOTAL_MODOS;
    delay(ANTIRREBOTE_MS);
  }
  anteriorSuelto = suelto;

  // --- fotocelda ---
  bool oscuro = analogRead(PIN_FOTOCELDA) < UMBRAL_OSCURIDAD;

  // --- que zonas deben quedar encendidas ---
  bool vial = false, ornamental = false;
  switch (modo) {
    case AUTOMATICO:     vial = oscuro; ornamental = oscuro; break;
    case TODO_ENCENDIDO: vial = true;   ornamental = true;   break;
    case SOLO_VIAL:      vial = oscuro; ornamental = false;  break;
    case MANTENIMIENTO:  vial = false;  ornamental = false;  break;
  }

  digitalWrite(PIN_VIAL, vial);
  digitalWrite(PIN_TIRANTES, ornamental);
  digitalWrite(PIN_TORRES, ornamental);
  digitalWrite(PIN_BARRERAS, ornamental);
  digitalWrite(PIN_TESTIGO, vial || ornamental);

  // --- informar solo cuando algo cambia, para no inundar el puerto ---
  uint8_t estado = (vial ? 1 : 0) | (ornamental ? 2 : 0) | (modo << 4);
  if (estado != ultimoInforme) {
    ultimoInforme = estado;
    Serial.print('M');
    Serial.print(modo);
    Serial.print(' ');
    Serial.print(vial ? '1' : '0');
    Serial.print(ornamental ? '1' : '0');
    Serial.print(ornamental ? '1' : '0');
    Serial.println(ornamental ? '1' : '0');
  }
}
`;

const PRACTICE_SOURCE = `// Punto de partida del proyecto.
//
// El circuito que lo acompana lleva un LED en una salida digital y un MPU6050
// en el bus I2C. El LED se simula; el MPU6050 no, porque no hay modelo del
// sensor, y el panel de simulacion lo declara en vez de inventar lecturas.

const uint8_t PIN_LED = 13;

void setup() {
  pinMode(PIN_LED, OUTPUT);
  Serial.begin(9600);
  Serial.println("EMBEDVERSE listo");
}

void loop() {
  digitalWrite(PIN_LED, HIGH);
  delay(500);
  digitalWrite(PIN_LED, LOW);
  delay(500);
}
`;

const ESP32_SOURCE = `// Punto de partida para ESP32.
//
// AVISO: el motor de simulacion ejecuta ATmega328P. El ESP32 es otra
// arquitectura y no se simula: este codigo se puede escribir y guardar, pero
// no ejecutar dentro del sistema.

void setup() {
  Serial.begin(115200);
}

void loop() {
}
`;

export const PROJECT_TEMPLATES: ProjectTemplate[] = [
  {
    id: 'practica',
    label: 'Práctica de vibraciones',
    description: 'LED en una salida digital y MPU6050 en el bus I²C. El punto de partida de siempre.',
    boards: [],
    circuit: (boardId) => createArduinoPracticeCircuit(boardId),
    source: (boardId) => (boardId === 'arduino-uno' ? PRACTICE_SOURCE : ESP32_SOURCE),
  },
  {
    id: 'armario-puente',
    label: 'Armario de alumbrado del puente',
    description:
      'Fotocelda, pulsador de mando y cuatro zonas de alumbrado. Es el circuito que '
      + 'gobierna las luminarias del Viaducto de la Novena en el estudio de puentes.',
    boards: ['arduino-uno'],
    circuit: () => createBridgeLightingCircuit(),
    source: () => BRIDGE_CABINET_SOURCE,
  },
];

export function templateById(id: string): ProjectTemplate {
  return PROJECT_TEMPLATES.find((template) => template.id === id) ?? PROJECT_TEMPLATES[0];
}

/** Plantillas aplicables a una placa. */
export function templatesForBoard(boardId: BoardId): ProjectTemplate[] {
  return PROJECT_TEMPLATES.filter(
    (template) => template.boards.length === 0 || template.boards.includes(boardId),
  );
}
