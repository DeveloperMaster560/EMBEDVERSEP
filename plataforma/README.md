# Plataforma de datos SHM — puesta en marcha

Servidor que recibe, valida, guarda y muestra los datos de las estaciones del
Viaducto de La Novena. Por qué está hecho así: [`ARQUITECTURA.md`](ARQUITECTURA.md).

| Servicio | Dirección en tu equipo |
|---|---|
| API y su documentación interactiva | http://127.0.0.1:8000/api/docs |
| Grafana (operación) | http://127.0.0.1:3000 |
| Broker MQTT | 127.0.0.1:1883 |

Nada queda expuesto a la red: todos los puertos escuchan solo en `127.0.0.1`.

**Usarlo desde otro equipo por Tailscale.** En el equipo que corre el servidor,
añadir a `.env` la línea `PUERTOS_IP=<IP de Tailscale de ese equipo>` (la que
muestra `tailscale ip -4`, del tipo `100.x.y.z`) y volver a ejecutar `iniciar`.
Así los puertos quedan visibles solo dentro de la red privada de Tailscale, no
en el Wi‑Fi ni en Internet. Nunca poner `0.0.0.0`. Si se reinstala Tailscale y
cambia la IP, Docker no arrancará esos puertos hasta corregir `.env`.

## 1. Requisitos (una vez)

**Windows 10/11**
1. Instalar Docker Desktop con WSL 2: https://docs.docker.com/desktop/setup/install/windows-install/
2. Instalar Python 3.9 o posterior desde https://www.python.org/downloads/windows/ (marcar «Add to PATH»).

**macOS (Intel o Apple silicon)**
1. Instalar Docker Desktop: https://docs.docker.com/desktop/setup/install/mac-install/
2. Python 3 ya viene con las herramientas de línea de órdenes de Xcode (`python3`).

Abrir Docker Desktop y esperar a que diga que está en marcha.

## 2. Arrancar

Desde la carpeta `plataforma/`:

| | Windows (PowerShell) | macOS / Linux |
|---|---|---|
| Servicios | `powershell -ExecutionPolicy Bypass -File scripts\iniciar.ps1` | `sh scripts/iniciar.sh` |
| Servicios + estación simulada | `powershell -ExecutionPolicy Bypass -File scripts\iniciar.ps1 demo` | `sh scripts/iniciar.sh demo` |
| Parar | `docker compose --profile demo down` | igual |
| Ver registros | `docker compose logs -f ingesta` | igual |

La primera vez, `scripts/preparar.py` crea `.env` y `secretos/` con contraseñas
aleatorias. **No se suben al repositorio.** La contraseña de Grafana (usuario
`admin`) es `GRAFANA_ADMIN_PASSWORD`, en `.env`.

Con `demo`, el contenedor `pasarela-sim` compila el firmware real de la
estación (`firmware/shm-station`) para Linux y lo ejecuta como la estación
`SD-V2-M`, con su hora simulada empezando en el momento del arranque: publica
un registro cada 10 s. **La señal es sintética; no es una medida del puente.**

## 3. Crear credenciales de la API

```sh
docker compose exec api python -m shm_plataforma.gestion token --rol lectura --nombre "Consulta UTS"
docker compose exec api python -m shm_plataforma.gestion token --rol ingeniero --nombre "Ing. responsable"
docker compose exec api python -m shm_plataforma.gestion credenciales
```

El token se muestra una sola vez. Uso:

```sh
curl -H "Authorization: Bearer <token>" http://127.0.0.1:8000/api/v1/estaciones
curl -H "Authorization: Bearer <token>" "http://127.0.0.1:8000/api/v1/avisos?abiertos=true"
```

| Rol | Puede |
|---|---|
| `lectura` | consultar estaciones, ventanas, avisos y crudos |
| `operador` | además, reconocer avisos |
| `ingeniero` | además, elevar un aviso a E3/E4 (con justificación; queda auditado) |
| `estacion` | solo subir los crudos de su propia estación |

## 4. Pruebas

No hace falta Docker. Con cualquier Python 3.9 o posterior:

```sh
cd plataforma/servicios
python -m unittest discover -s pruebas -t .
```

Las pruebas de la API necesitan `fastapi` y `httpx`; si no están instalados, se
omiten. La prueba de punta a punta del firmware necesita `make` y `cc` (en
Windows se omite). El contrato de datos se comprueba también desde la app
(`npx vitest run src/shm/data-contract-shared.test.ts`) con los mismos casos:
`contrato/casos.json`.

## 5. Añadir una estación

1. Darla de alta en la base:
   `docker compose exec db psql -U shm -d shm -c "INSERT INTO estaciones (station_id, tipo, nombre) VALUES ('SD-L2-1','SD','Luz 2, L/4')"`
2. Añadir su identificador a `ESTACIONES` en `scripts/preparar.py`, añadir a
   `.env` la línea `MQTT_SD_L2_1_PASSWORD=<aleatoria>` y volver a ejecutar
   `iniciar` (el broker vuelve a cifrar los usuarios al arrancar).
3. Crearle un token de rol `estacion` para la subida de crudos.

## Estado

- **Probado:** el contrato (las mismas reglas en Python y TypeScript), la ingesta
  (duplicados, conflictos, datos fuera de orden, huecos, estaciones calladas,
  suplantación), el almacén en disco, la API (roles, auditoría, subida de
  crudos) y los registros del firmware real pasando por la ingesta.
- **Sin probar todavía:** el arranque con Docker, porque el equipo donde se
  escribió no lo tiene instalado; el almacén en S3; el TLS del broker.
- **Pendiente con ingenierías:** el protocolo de la pasarela real, el formato
  del archivo en la SD, LoRaWAN y los umbrales.
