import { describe, expect, it } from 'vitest';
import { CompileRequestError, elegirCarga, leerSalidaCompilador, validateCompileRequest } from './arduinoCompiler';
import { PLACAS } from './placas';

describe('Arduino compile request validation', () => {
  it('accepts a source sketch for the supported Arduino Uno target', () => {
    expect(
      validateCompileRequest({
        boardId: 'arduino-uno',
        files: [{ path: 'src/main.cpp', content: 'void setup() {} void loop() {}' }],
      }),
    ).toEqual({
      boardId: 'arduino-uno',
      files: [{ path: 'src/main.cpp', content: 'void setup() {} void loop() {}' }],
    });
  });

  it('rejects boards that are not in the registry', () => {
    expect(() => validateCompileRequest({ boardId: 'pic16f877a', files: [{ path: 'main.ino', content: '' }] }))
      .toThrowError(/«pic16f877a» aún no está en EMBEDVERSE/);
  });

  it('accepts any registry board; whether its core is installed is checked when compiling', () => {
    expect(validateCompileRequest({ boardId: 'esp32-devkit', files: [{ path: 'main.ino', content: '' }] }).boardId)
      .toBe('esp32-devkit');
  });

  it.each(['../outside.ino', 'folder/../../outside.cpp', 'C:\\outside.ino', 'script.exe'])(
    'rejects unsafe or unsupported file paths: %s',
    (filePath) => {
      expect(() => validateCompileRequest({
        boardId: 'arduino-uno',
        files: [{ path: filePath, content: 'void setup() {} void loop() {}' }],
      })).toThrowError(CompileRequestError);
    },
  );

  it('requires a sketch entry point and rejects duplicate paths case-insensitively', () => {
    expect(() => validateCompileRequest({
      boardId: 'arduino-uno',
      files: [{ path: 'notes.h', content: '' }],
    })).toThrowError(/main\.cpp/);

    expect(() => validateCompileRequest({
      boardId: 'arduino-uno',
      files: [
        { path: 'main.ino', content: '' },
        { path: 'MAIN.INO', content: '' },
      ],
    })).toThrowError(/duplicado/i);
  });
});

describe('salida de arduino-cli --format json', () => {
  it('el texto es el del compilador y se leen las bibliotecas enlazadas', () => {
    const json = JSON.stringify({
      compiler_out: 'El Sketch usa 2024 bytes\n', compiler_err: 'aviso: x\n', success: true,
      builder_result: { used_libraries: [{ name: 'Wire', version: '1.0', container_platform: 'arduino:avr@1.8.8' }] },
    });
    const r = leerSalidaCompilador(json, '');
    expect(r.texto).toBe('El Sketch usa 2024 bytes\naviso: x\n');
    expect(r.usadas.map((u) => u.name)).toEqual(['Wire']);
  });

  it('si no es JSON (un error antes de compilar) se muestra tal cual', () => {
    expect(leerSalidaCompilador('Error: placa desconocida', ' más')).toEqual({ texto: 'Error: placa desconocida más', usadas: [] });
  });
});

describe('qué se graba en la placa real (elegirCarga)', () => {
  const placa = (id: string) => {
    const p = PLACAS.find((x) => x.id === id);
    if (!p) throw new Error(`no existe ${id}`);
    return p;
  };

  it('todas las placas conocidas tienen archivo e instrucciones si el núcleo da su formato', () => {
    // Nombres de muestra con los tres formatos; cada familia elige el suyo.
    const nombres = ['S.ino.bin', 'S.ino.elf', 'S.ino.hex', 'S.ino.map', 'S.ino.uf2'];
    for (const p of PLACAS) {
      const { carga, descargables } = elegirCarga(p, nombres);
      expect(carga, p.id).not.toBeNull();
      expect(descargables[0], p.id).toBe(carga!.archivo);
      expect(carga!.pasos.length, p.id).toBeGreaterThan(0);
      expect(carga!.comandoArduinoCli, p.id).toContain(`--fqbn ${p.fqbn}`);
    }
  });

  it('AVR (salida real de arduino:avr 1.8.8): el .ino.hex, nunca el .with_bootloader', () => {
    const nombres = ['S.ino.eep', 'S.ino.elf', 'S.ino.hex', 'S.ino.with_bootloader.bin', 'S.ino.with_bootloader.hex'];
    const { carga, descargables } = elegirCarga(placa('arduino-uno'), nombres);
    expect(descargables).toEqual(['S.ino.hex']);
    expect(carga!.pasos).toContain('avrdude -p atmega328p -c arduino -P <PUERTO> -b 115200 -D -U flash:w:S.ino.hex:i');
    // Los clones con el gestor de arranque viejo van a 57 600 bps (boards.txt).
    expect(elegirCarga(placa('arduino-nano-clon'), nombres).carga!.pasos.join('\n')).toContain('-b 57600');
    expect(elegirCarga(placa('arduino-mega'), nombres).carga!.pasos.join('\n')).toContain('-p atmega2560 -c wiring');
  });

  it('ESP32: la imagen completa en 0x0, no la aplicación sola', () => {
    // Nombres que deja arduino-esp32 3.x en --output-dir (no comprobado en este equipo: núcleo no instalado).
    const nombres = ['S.ino.bin', 'S.ino.bootloader.bin', 'S.ino.elf', 'S.ino.map', 'S.ino.merged.bin', 'S.ino.partitions.bin'];
    const { carga, descargables } = elegirCarga(placa('esp32-devkit'), nombres);
    expect(carga!.archivo).toBe('S.ino.merged.bin');
    expect(carga!.direccion).toBe('0x0');
    expect(descargables).toEqual(['S.ino.merged.bin', 'S.ino.bin']);
    expect(carga!.advertencias.join(' ')).toMatch(/en 0x0 la placa no arranca/);
  });

  it('ESP32 sin imagen completa: la aplicación va en 0x10000 y se advierte', () => {
    const { carga } = elegirCarga(placa('esp32-s3'), ['S.ino.bin', 'S.ino.bootloader.bin', 'S.ino.partitions.bin']);
    expect(carga!.archivo).toBe('S.ino.bin');
    expect(carga!.direccion).toBe('0x10000');
    expect(carga!.advertencias[0]).toMatch(/gestor de arranque/);
  });

  it('RP2040 da el .uf2; STM32 y SAMD el .bin', () => {
    const nombres = ['S.ino.bin', 'S.ino.hex', 'S.ino.uf2'];
    expect(elegirCarga(placa('rp-pico'), nombres).carga!.archivo).toBe('S.ino.uf2');
    const stm = elegirCarga(placa('stm32-nucleo-f446re'), nombres).carga!;
    expect(stm.archivo).toBe('S.ino.bin');
    expect(stm.direccion).toBe('0x08000000');
    expect(elegirCarga(placa('arduino-zero'), nombres).carga!.archivo).toBe('S.ino.bin');
    expect(elegirCarga(placa('teensy-41'), nombres).carga!.archivo).toBe('S.ino.hex');
  });

  it('sin nada grabable no inventa instrucciones', () => {
    expect(elegirCarga(placa('arduino-uno'), ['S.ino.elf'])).toEqual({ descargables: [], carga: null });
  });
});

describe('rutas del servidor en la salida del compilador', () => {
  it('el cliente ve sus nombres de archivo, no las carpetas del servidor', async () => {
    const { limpiarRutas } = await import('./arduinoCompiler');
    const tmp = '/private/var/folders/x/T/embedverse-compile-abc';
    const texto = `${tmp}/EmbedverseSketch/EmbedverseSketch.ino:1:23: error: expected primary-expression\n`
      + `${tmp}/EmbedverseSketch/src/sensor.cpp:4:1: error: x\n/repo/.tools/arduino-user/libraries/DHT/DHT.h:5: nota\n`;
    const r = limpiarRutas(texto, [tmp, '/repo'], 'EmbedverseSketch.ino', 'main.ino');
    expect(r).toBe('main.ino:1:23: error: expected primary-expression\nsrc/sensor.cpp:4:1: error: x\n.tools/arduino-user/libraries/DHT/DHT.h:5: nota\n');
  });
});
