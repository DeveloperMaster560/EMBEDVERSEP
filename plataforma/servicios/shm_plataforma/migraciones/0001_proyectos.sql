-- Plataforma multiproyecto: varios ingenieros comparten el servidor y cada
-- credencial ve SOLO su proyecto. Se aplica una vez (shm_plataforma.migrar la
-- registra en schema_migraciones) y vale para bases nuevas y para las que ya
-- tienen datos.

CREATE TABLE proyectos (
  proyecto_id             text PRIMARY KEY CHECK (proyecto_id ~ '^[a-z0-9][a-z0-9-]{1,39}$'),
  nombre                  text NOT NULL,
  tipo_estructura         text NOT NULL CHECK (tipo_estructura IN ('puente', 'edificio', 'otro')),
  institucion             text,
  entidad_responsable     text,
  responsable_estructural text,
  activo                  boolean NOT NULL DEFAULT true,
  archivo_sha256          text,          -- huella del proyecto.json importado
  definicion              jsonb,         -- el proyecto.json tal como se importó
  creado                  timestamptz NOT NULL DEFAULT now(),
  actualizado             timestamptz NOT NULL DEFAULT now()
);

-- Los datos anteriores a esta migración eran todos del Viaducto de La Novena
-- (la estación simulada SD-V2-M). Se le asignan para no dejar huérfanos; el
-- importador completa luego la ficha desde proyectos/novena/proyecto.json.
INSERT INTO proyectos (proyecto_id, nombre, tipo_estructura)
SELECT 'novena', 'Viaducto de La Novena — monitoreo estructural', 'puente'
WHERE EXISTS (SELECT 1 FROM estaciones);

ALTER TABLE estaciones ADD COLUMN proyecto_id text REFERENCES proyectos;
UPDATE estaciones SET proyecto_id = 'novena' WHERE proyecto_id IS NULL;
ALTER TABLE estaciones ALTER COLUMN proyecto_id SET NOT NULL;
CREATE INDEX estaciones_proyecto ON estaciones (proyecto_id);

-- SR (referencia de tiempo/ambiental) existía en el diseño pero no en la base.
ALTER TABLE estaciones DROP CONSTRAINT IF EXISTS estaciones_tipo_check;
ALTER TABLE estaciones ADD CONSTRAINT estaciones_tipo_check CHECK (tipo IN ('SD', 'SS', 'SR', 'GW'));

ALTER TABLE sensores ADD COLUMN magnitud text;
ALTER TABLE sensores ADD COLUMN unidad text;
ALTER TABLE sensores ADD COLUMN muestreo_hz double precision;

-- Credenciales con alcance:
--   admin                       → el administrador del servidor (CIAI); todos los proyectos;
--                                 no puede elevar avisos a E3/E4.
--   lectura/operador/ingeniero  → un solo proyecto.
--   estacion                    → una sola estación (y su proyecto).
ALTER TABLE credenciales ADD COLUMN proyecto_id text REFERENCES proyectos;
UPDATE credenciales c SET proyecto_id = e.proyecto_id
  FROM estaciones e WHERE c.station_id = e.station_id;
UPDATE credenciales SET proyecto_id = 'novena'
  WHERE proyecto_id IS NULL AND EXISTS (SELECT 1 FROM proyectos WHERE proyecto_id = 'novena');
-- Si quedara alguna sin proyecto (base sin La Novena), se desactiva en vez de
-- darle acceso a todo.
UPDATE credenciales SET activa = false WHERE proyecto_id IS NULL;

ALTER TABLE credenciales DROP CONSTRAINT IF EXISTS credenciales_rol_check;
ALTER TABLE credenciales DROP CONSTRAINT IF EXISTS credenciales_check;
ALTER TABLE credenciales ADD CONSTRAINT credenciales_rol_check
  CHECK (rol IN ('admin', 'lectura', 'operador', 'ingeniero', 'estacion'));
ALTER TABLE credenciales ADD CONSTRAINT credenciales_alcance_check CHECK (
  CASE rol
    WHEN 'admin'    THEN proyecto_id IS NULL AND station_id IS NULL
    WHEN 'estacion' THEN proyecto_id IS NOT NULL AND station_id IS NOT NULL
    ELSE                 proyecto_id IS NOT NULL AND station_id IS NULL
  END OR NOT activa);

ALTER TABLE auditoria ADD COLUMN proyecto_id text;

-- Disponibilidad por proyecto, para Grafana y la API.
DROP VIEW IF EXISTS disponibilidad_horaria;
CREATE VIEW disponibilidad_horaria AS
SELECT e.proyecto_id,
       v.station_id,
       time_bucket(INTERVAL '1 hour', v.inicio) AS hora,
       count(*)                                             AS ventanas,
       count(*) FILTER (WHERE v.estados = '{NORMAL}')       AS normales,
       count(*) FILTER (WHERE v.calidad_tiempo <> 'GNSS_LOCKED') AS sin_gnss,
       count(*) FILTER (WHERE v.fuera_de_orden)             AS fuera_de_orden
FROM ventanas v JOIN estaciones e USING (station_id)
GROUP BY 1, 2, 3;

-- Al rehacer la vista se pierde su permiso: se repone para el usuario de Grafana.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'grafana_lectura') THEN
    GRANT SELECT ON disponibilidad_horaria, proyectos TO grafana_lectura;
  END IF;
END $$;
