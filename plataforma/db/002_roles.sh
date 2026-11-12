#!/bin/sh
# Usuario de solo lectura para Grafana. La contraseña llega del .env por el
# entorno del contenedor; no se escribe en ningún archivo del repositorio.
set -eu
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" -v pw="$GRAFANA_DB_PASSWORD" <<'SQL'
CREATE ROLE grafana_lectura LOGIN PASSWORD :'pw';
GRANT USAGE ON SCHEMA public TO grafana_lectura;
GRANT SELECT ON estaciones, sensores, ventanas, estado_estacion, avisos, archivos_crudos, disponibilidad_horaria TO grafana_lectura;
SQL
