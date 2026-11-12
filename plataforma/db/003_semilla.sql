-- La única estación que existe hoy es la SIMULADA: el firmware de
-- firmware/shm-station ejecutándose en el ordenador o en Renode.
-- No hay ninguna estación instalada en el viaducto.
INSERT INTO estaciones (station_id, tipo, nombre, ubicacion, simulada, periodo_s, notas)
VALUES ('SD-V2-M', 'SD', 'Estación dinámica simulada', NULL, true, 10,
        'Firmware 0.1.0-esqueleto en el ordenador o en Renode. Señal sintética. No existe en el puente.');

INSERT INTO sensores (sensor_id, station_id, modelo, ejes, notas)
VALUES ('ADXL355-SD-V2-M', 'SD-V2-M', 'ADXL355', ARRAY['longitudinal', 'transversal', 'vertical'],
        'Modelo de Renode / placa simulada. Mapa de registros sin cotejar con la hoja de datos.');
