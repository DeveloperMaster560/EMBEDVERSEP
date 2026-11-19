import { describe, expect, it } from 'vitest';
import { CompileRequestError, validateCompileRequest } from './arduinoCompiler';

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
