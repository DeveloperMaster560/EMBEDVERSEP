-- Esquema de la plataforma SHM (PostgreSQL 17 + TimescaleDB 2.32, edición Community).
-- Se ejecuta una sola vez, al crear el volumen de la base (docker-entrypoint-initdb.d).
-- Modelo explicado en plataforma/ARQUITECTURA.md §8.

CREATE EXTENSION IF NOT EXISTS timescaledb;

-- ── Inventario ────────────────────────────────────────────────────────────
CREATE TABLE estaciones (
  station_id   text PRIMARY KEY CHECK (station_id ~ '^[A-Z0-9][A-Z0-9-]{1,31}$'),
  tipo         text NOT NULL CHECK (tipo IN ('SD', 'SS', 'GW')),  -- dinámica, cuasiestática, pasarela
  nombre       text NOT NULL,
  ubicacion    text,              -- luz, posición (L/4, L/2…), viga; según el diseño aprobado
  simulada     boolean NOT NULL DEFAULT false,
  activa       boolean NOT NULL DEFAULT true,
  periodo_s    integer NOT NULL DEFAULT 10,   -- cada cuánto se espera un registro
  creada       timestamptz NOT NULL DEFAULT now(),
  notas        text
);

CREATE TABLE sensores (
  sensor_id    text PRIMARY KEY,
  station_id   text NOT NULL REFERENCES estaciones,
  modelo       text NOT NULL,     -- ADXL355, SCL3300-D01, PT100 clase A…
  serie        text,
  ejes         text[],
  instalado    timestamptz,
  retirado     timestamptz,
  notas        text
);

CREATE TABLE calibraciones (
  calibration_id text PRIMARY KEY,
  sensor_id      text NOT NULL REFERENCES sensores,
  fecha          date NOT NULL,
  documento      text,            -- certificado o informe
  parametros     jsonb NOT NULL,  -- sensibilidad, desfase, matriz de rotación…
  aprobada_por   text
);

-- ── Telemetría: una fila por ventana (10 s), no por muestra ───────────────
CREATE TABLE ventanas (
  station_id       text NOT NULL REFERENCES estaciones,
  inicio           timestamptz NOT NULL,      -- hora de MUESTREO (la de la estación)
  duracion_s       double precision,
  recibido         timestamptz NOT NULL,      -- hora de RECEPCIÓN (la del servidor); nunca la sustituye
  calidad_tiempo   text NOT NULL,
  estados          text[] NOT NULL DEFAULT '{}',
  crc32            text NOT NULL,
  muestras         integer,
  huecos           integer,
  saturadas        integer,
  firmware_version text,
  schema_version   text,
  fuera_de_orden   boolean NOT NULL DEFAULT false,
  registro         jsonb NOT NULL,            -- el mensaje completo, tal como llegó
  PRIMARY KEY (station_id, inicio)            -- clave de deduplicación
);
SELECT create_hypertable('ventanas', by_range('inicio', INTERVAL '7 days'));

CREATE TABLE estado_estacion (
  station_id   text PRIMARY KEY REFERENCES estaciones,
  estado       jsonb,
  recibido     timestamptz,
  ultimo_visto timestamptz
);

-- ── Crudos: la base guarda la FICHA; los bytes están en el almacén ────────
CREATE TABLE archivos_crudos (
  station_id     text NOT NULL REFERENCES estaciones,
  nombre         text NOT NULL,
  clave          text NOT NULL,
  bytes          bigint NOT NULL,
  sha256         text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  recibido       timestamptz NOT NULL DEFAULT now(),
  ventana_inicio timestamptz,
  PRIMARY KEY (station_id, nombre)
);

-- ── Avisos: comunicación, medición, continuidad, posible evento ───────────
-- La ingesta solo asigna E0–E2. E3/E4 los pone una persona con rol ingeniero.
CREATE TABLE avisos (
  id             bigserial PRIMARY KEY,
  station_id     text NOT NULL REFERENCES estaciones,
  categoria      text NOT NULL CHECK (categoria IN ('comunicacion', 'medicion', 'continuidad', 'posible_evento', 'integridad')),
  nivel          text NOT NULL CHECK (nivel IN ('E0', 'E1', 'E2', 'E3', 'E4')),
  codigo         text NOT NULL,
  detalle        text NOT NULL,
  desde          timestamptz,
  creado         timestamptz NOT NULL DEFAULT now(),
  abierto        boolean NOT NULL DEFAULT true,
  reconocido_por text,
  reconocido_en  timestamptz,
  nota           text
);
CREATE INDEX avisos_abiertos ON avisos (station_id, codigo) WHERE abierto;

-- Mensajes que no cumplieron el contrato: no se pierden, se guardan con el motivo.
CREATE TABLE rechazos (
  id        bigserial PRIMARY KEY,
  topic     text NOT NULL,
  payload   bytea NOT NULL,
  recibido  timestamptz NOT NULL,
  problemas text[] NOT NULL
);

-- ── Acceso y auditoría ────────────────────────────────────────────────────
CREATE TABLE credenciales (
  id           bigserial PRIMARY KEY,
  nombre       text NOT NULL,
  rol          text NOT NULL CHECK (rol IN ('lectura', 'operador', 'ingeniero', 'estacion')),
  station_id   text REFERENCES estaciones,     -- solo para rol estacion
  token_sha256 text NOT NULL UNIQUE,            -- nunca se guarda el token en claro
  activa       boolean NOT NULL DEFAULT true,
  creada       timestamptz NOT NULL DEFAULT now(),
  CHECK ((rol = 'estacion') = (station_id IS NOT NULL))
);

CREATE TABLE auditoria (
  id      bigserial PRIMARY KEY,
  cuando  timestamptz NOT NULL DEFAULT now(),
  quien   text NOT NULL,
  accion  text NOT NULL,
  objeto  text,
  detalle jsonb
);

-- Disponibilidad por estación y hora (lectura para Grafana y la API).
CREATE VIEW disponibilidad_horaria AS
SELECT station_id,
       time_bucket(INTERVAL '1 hour', inicio) AS hora,
       count(*)                                           AS ventanas,
       count(*) FILTER (WHERE estados = '{NORMAL}')       AS normales,
       count(*) FILTER (WHERE calidad_tiempo <> 'GNSS_LOCKED') AS sin_gnss,
       count(*) FILTER (WHERE fuera_de_orden)             AS fuera_de_orden
FROM ventanas
GROUP BY 1, 2;

-- El usuario de solo lectura de Grafana se crea en 002_roles.sh (necesita la contraseña del .env).
