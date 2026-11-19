-- Medidas de sensores lentos (temperatura, humedad, luz, suelo, distancia…):
-- un valor por sensor y por instante. Contrato en shm_plataforma/contrato_medidas.py.
-- value NULL = el sensor no leyó (se guarda: el hueco también es un dato).

CREATE TABLE medidas (
  station_id   text NOT NULL REFERENCES estaciones,
  sensor_id    text NOT NULL,             -- puede no estar en «sensores» si el proyecto aún no lo declara
  instante     timestamptz NOT NULL,      -- hora de MEDIDA (la de la estación)
  magnitud     text NOT NULL,
  unidad       text NOT NULL,
  valor        double precision,          -- NULL = sin lectura
  error        text,                      -- lo que dijo la estación si no leyó
  calidad_tiempo text NOT NULL,
  recibido     timestamptz NOT NULL,      -- hora de RECEPCIÓN (la del servidor)
  PRIMARY KEY (sensor_id, instante)       -- deduplicación: reenviar no duplica
);
SELECT create_hypertable('medidas', by_range('instante', INTERVAL '7 days'));
CREATE INDEX medidas_estacion ON medidas (station_id, instante DESC);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'grafana_lectura') THEN
    GRANT SELECT ON medidas TO grafana_lectura;
  END IF;
END $$;
