import { describe, expect, it } from 'vitest';
import { analizar } from './bibliotecaOficial';
import { codigoPrincipal, diagnosticar, estadoHttp, mensaje, otroEntorno, paraRespuesta } from './diagnostico';
import { buscarPlaca } from './placas';

const PICO_AIRE = {
  path: 'aire.ino',
  content: '#include <WiFi.h>\n#include <PubSubClient.h>\n#include <SensirionI2cScd4x.h>\n#include <SensirionI2cSps30.h>\n'
    + 'void setup(){}\nvoid loop(){}\n',
};
const PIC = { path: 'pic.ino', content: '#include <xc.h>\n#pragma config FOSC = HSPLL_HS\nvoid main(void) { while (1); }\n' };

describe('diagnóstico completo antes de compilar', () => {
  it('núcleo ausente: lo dice junto con TODAS las bibliotecas, cada cosa para quien le toca', () => {
    const { problemas } = diagnosticar({
      boardId: 'rp-pico-w', placa: buscarPlaca('rp-pico-w'), files: [PICO_AIRE], nucleo: null, instaladas: [],
    });
    expect(problemas.map((p) => `${p.para}:${p.codigo}`)).toEqual([
      'cliente:CORE_NOT_INSTALLED', 'administrador:CORE_NOT_INSTALLED',
      'cliente:BIBLIOTECA_NO_OFICIAL',
      'cliente:BIBLIOTECA_OFICIAL_NO_INSTALADA', 'administrador:BIBLIOTECA_OFICIAL_NO_INSTALADA',
    ]);
    // WiFi.h la da el núcleo del Pico W aunque no esté instalado.
    expect(problemas.find((p) => p.codigo === 'BIBLIOTECA_NO_OFICIAL')!.mensaje).toContain('SensirionI2cSps30.h → la dan: Sensirion I2C SPS30');
    expect(codigoPrincipal(problemas)).toBe('BIBLIOTECA_NO_OFICIAL');
    expect(estadoHttp(problemas)).toBe(422);
  });

  it('al cliente no le llegan órdenes de instalación en modo público', () => {
    const { problemas } = diagnosticar({
      boardId: 'rp-pico-w', placa: buscarPlaca('rp-pico-w'), files: [PICO_AIRE], nucleo: null, instaladas: [],
    });
    const publico = mensaje(problemas, true);
    expect(publico).not.toMatch(/placas\.(sh|ps1)/);
    expect(publico).toContain('Ya se avisó al administrador');
    expect(publico).toMatch(/^Hay 3 cosas que impiden compilar:/);
    expect(paraRespuesta(problemas, true).every((p) => p.para === 'cliente')).toBe(true);
    expect(mensaje(problemas, false)).toContain('— Para el administrador de este servidor —\nFalta el núcleo rp2040:rp2040');
  });

  it('solo falta preparar el servidor: 503, no es culpa del cliente', () => {
    const { problemas } = diagnosticar({
      boardId: 'arduino-uno', placa: buscarPlaca('arduino-uno'),
      files: [{ path: 'a.ino', content: '#include <Adafruit_MAX31865.h>\nvoid setup(){}\nvoid loop(){}' }],
      nucleo: new Set(['Arduino.h']), instaladas: [],
    });
    expect(estadoHttp(problemas)).toBe(503);
    expect(codigoPrincipal(problemas)).toBe('BIBLIOTECA_OFICIAL_NO_INSTALADA');
  });

  it('código que no es Arduino (PIC con XC8): lo dice y no inventa problemas de bibliotecas', () => {
    expect(otroEntorno([PIC])?.nombre).toMatch(/PIC/);
    const { problemas } = diagnosticar({ boardId: 'pic18f4550', placa: undefined, files: [PIC], nucleo: null, instaladas: [] });
    expect(problemas.map((p) => p.codigo)).toEqual(['NO_ES_ARDUINO', 'UNSUPPORTED_BOARD']);
    expect(problemas[0].mensaje).toContain('MPLAB X');
  });

  it('otros entornos y el caso normal', () => {
    expect(otroEntorno([{ path: 'm.c', content: '#include "pico/stdlib.h"\nint main(){}' }])?.nombre).toMatch(/Pico C SDK/);
    expect(otroEntorno([{ path: 'm.c', content: 'void app_main(void) {}' }])?.nombre).toBe('ESP-IDF');
    expect(otroEntorno([{ path: 'm.cpp', content: 'int main() { return 0; }' }])?.nombre).toMatch(/sin Arduino/);
    expect(otroEntorno([PICO_AIRE])).toBeNull();
    expect(otroEntorno([{ path: 'a.ino', content: 'void setup(){}\nvoid loop(){}\nint main_helper(){return 0;}' }])).toBeNull();
  });

  it('placa desconocida (Teensy): también revisa las bibliotecas, y reconoce TinyGPS++.h', () => {
    const files = [{ path: 't.ino', content: '#include <HX711.h>\n#include <TinyGPS++.h>\n#include <AsyncMqttClient.h>\nvoid setup(){}\nvoid loop(){}' }];
    const { problemas, analisis } = diagnosticar({ boardId: 'teensy41', placa: undefined, files, nucleo: null, instaladas: [] });
    expect(analisis.inclusiones.find((i) => i.cabecera === 'TinyGPS++.h')).toMatchObject({ origen: 'pendiente', biblioteca: 'TinyGPSPlus' });
    expect(analisis.inclusiones.find((i) => i.cabecera === 'HX711.h')).toMatchObject({ biblioteca: 'HX711 Arduino Library' });
    expect(problemas.map((p) => p.codigo)).toContain('UNSUPPORTED_BOARD');
    expect(problemas.map((p) => p.codigo)).toContain('BIBLIOTECA_NO_OFICIAL');
  });

  it('una cabecera interna de una biblioteca (config.h de HX711_ADC) no se confunde con la del cliente', () => {
    const a = analizar([{ path: 'a.ino', content: '#include "config.h"' }], new Set(), []);
    expect(a.inclusiones[0]).toMatchObject({ cabecera: 'config.h', origen: 'desconocida' });
    const inst = analizar([{ path: 'a.ino', content: '#include "config.h"' }], new Set(),
      [{ nombre: 'HX711_ADC', version: '1.2.12', cabeceras: ['HX711_ADC.h', 'config.h'] }]);
    expect(inst.inclusiones[0].origen).toBe('desconocida');
  });
});
