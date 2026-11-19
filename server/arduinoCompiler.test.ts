import { describe, expect, it } from 'vitest';
import { CompileRequestError, leerSalidaCompilador, validateCompileRequest } from './arduinoCompiler';

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
