/**
 * Lector de Intel HEX, el formato en el que `arduino-cli` entrega el firmware.
 *
 * Es estricto a propósito. Un `.hex` corrupto que se cargue «casi bien»
 * produce un programa que ejecuta basura, y el fallo aparece mucho después y
 * muy lejos de su causa. Aquí se rechaza en el momento y se dice en qué línea.
 */

export interface HexProgram {
  /** Memoria de programa, en bytes, lista para pasar a un Uint16Array. */
  bytes: Uint8Array;
  /** Byte más alto escrito + 1. Lo que ocupa el firmware de verdad. */
  usedBytes: number;
  /** Dirección de arranque si el archivo la declara. */
  startAddress: number | null;
  recordCount: number;
}

export class HexParseError extends Error {
  readonly line: number;

  constructor(message: string, line: number) {
    super(`Línea ${line}: ${message}`);
    this.name = 'HexParseError';
    this.line = line;
  }
}

const DATA = 0x00;
const END_OF_FILE = 0x01;
const EXTENDED_SEGMENT_ADDRESS = 0x02;
const START_SEGMENT_ADDRESS = 0x03;
const EXTENDED_LINEAR_ADDRESS = 0x04;
const START_LINEAR_ADDRESS = 0x05;

/**
 * Convierte un archivo Intel HEX en memoria de programa.
 *
 * `maxBytes` acota el tamaño: un registro con dirección disparatada no debe
 * poder reservar cientos de megabytes. Para un ATmega328P son 32 KiB.
 */
export function parseIntelHex(text: string, maxBytes = 32768): HexProgram {
  const bytes = new Uint8Array(maxBytes);
  let usedBytes = 0;
  let baseAddress = 0;
  let startAddress: number | null = null;
  let recordCount = 0;
  let sawEnd = false;

  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index].trim();
    const lineNumber = index + 1;
    if (raw.length === 0) continue;
    if (sawEnd) {
      throw new HexParseError('hay contenido después del registro de fin de archivo.', lineNumber);
    }
    if (!raw.startsWith(':')) {
      throw new HexParseError('todo registro debe empezar por ":".', lineNumber);
    }
    const body = raw.slice(1);
    if (body.length % 2 !== 0) {
      throw new HexParseError('el registro tiene un número impar de dígitos.', lineNumber);
    }
    if (!/^[0-9a-fA-F]*$/.test(body)) {
      throw new HexParseError('el registro contiene caracteres que no son hexadecimales.', lineNumber);
    }
    const data = new Uint8Array(body.length / 2);
    for (let i = 0; i < data.length; i += 1) {
      data[i] = Number.parseInt(body.slice(i * 2, i * 2 + 2), 16);
    }
    if (data.length < 5) {
      throw new HexParseError('el registro es más corto que la cabecera mínima.', lineNumber);
    }

    const length = data[0];
    const address = (data[1] << 8) | data[2];
    const type = data[3];
    if (data.length !== length + 5) {
      throw new HexParseError(
        `declara ${length} bytes de datos pero el registro contiene ${data.length - 5}.`,
        lineNumber,
      );
    }

    // La suma de TODOS los bytes, checksum incluido, debe dar cero.
    let sum = 0;
    for (const value of data) sum = (sum + value) & 0xff;
    if (sum !== 0) {
      throw new HexParseError('checksum incorrecto: el registro está corrupto.', lineNumber);
    }

    const payload = data.subarray(4, 4 + length);
    recordCount += 1;

    switch (type) {
      case DATA: {
        const target = baseAddress + address;
        if (target + length > maxBytes) {
          throw new HexParseError(
            `escribe en 0x${(target + length - 1).toString(16)}, fuera de los ${maxBytes} bytes de memoria de programa.`,
            lineNumber,
          );
        }
        bytes.set(payload, target);
        usedBytes = Math.max(usedBytes, target + length);
        break;
      }
      case END_OF_FILE:
        if (length !== 0) {
          throw new HexParseError('el registro de fin de archivo no lleva datos.', lineNumber);
        }
        sawEnd = true;
        break;
      case EXTENDED_SEGMENT_ADDRESS:
        if (length !== 2) throw new HexParseError('dirección de segmento mal formada.', lineNumber);
        baseAddress = ((payload[0] << 8) | payload[1]) << 4;
        break;
      case EXTENDED_LINEAR_ADDRESS:
        if (length !== 2) throw new HexParseError('dirección lineal mal formada.', lineNumber);
        baseAddress = ((payload[0] << 8) | payload[1]) << 16;
        break;
      case START_SEGMENT_ADDRESS: {
        // Tipo 03 es CS:IP, herencia del 8086, y NO un entero de 32 bits: la
        // dirección es (CS << 4) + IP. Leerlo plano da valores disparatados.
        // Los gestores de arranque de Arduino usan este tipo: el del
        // ATmega2560 declara CS=0x3000, IP=0xE000, que son 0x3E000.
        if (length !== 4) throw new HexParseError('dirección de arranque mal formada.', lineNumber);
        const cs = (payload[0] << 8) | payload[1];
        const ip = (payload[2] << 8) | payload[3];
        startAddress = (cs << 4) + ip;
        break;
      }
      case START_LINEAR_ADDRESS:
        if (length !== 4) throw new HexParseError('dirección de arranque mal formada.', lineNumber);
        startAddress =
          ((payload[0] << 24) | (payload[1] << 16) | (payload[2] << 8) | payload[3]) >>> 0;
        break;
      default:
        throw new HexParseError(`tipo de registro desconocido: 0x${type.toString(16)}.`, lineNumber);
    }
  }

  if (!sawEnd) {
    throw new HexParseError(
      'el archivo termina sin registro de fin (:00000001FF). Puede estar truncado.',
      lines.length,
    );
  }
  if (usedBytes === 0) {
    throw new HexParseError('el archivo no contiene ningún byte de programa.', lines.length);
  }

  return { bytes, usedBytes, startAddress, recordCount };
}

/** Memoria de programa como palabras de 16 bits, que es lo que espera la CPU. */
export function toProgramMemory(program: HexProgram): Uint16Array {
  return new Uint16Array(program.bytes.buffer, 0, program.bytes.length / 2);
}
