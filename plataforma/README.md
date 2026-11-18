# Plataforma de datos SHM — puesta en marcha

Servidor que recibe, valida, guarda y muestra los datos de las estaciones de
**varios proyectos** (puentes, edificios) a la vez. Cada proyecto se describe en
`proyectos/<id>/proyecto.json` ([guía del formato](../proyectos/LEEME.md)) y cada
credencial ve **solo** su proyecto. El primero es el Viaducto de La Novena. Por
qué está hecho así: [`ARQUITECTURA.md`](ARQUITECTURA.md).

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

Cada credencial tiene un **alcance**. Fuera de él todo responde «no existe» (404),
para que nadie pueda averiguar qué tienen otros proyectos.

```sh
docker compose exec api python -m shm_plataforma.gestion token --rol ingeniero --proyecto novena --nombre "Ing. responsable"
docker compose exec api python -m shm_plataforma.gestion token --rol lectura   --proyecto novena --nombre "Consulta UTS"
docker compose exec api python -m shm_plataforma.gestion token --rol admin --nombre "Administración CIAI"
docker compose exec api python -m shm_plataforma.gestion credenciales
docker compose exec api python -m shm_plataforma.gestion proyectos
```

El token se muestra una sola vez. Uso:

```sh
curl -H "Authorization: Bearer <token>" http://127.0.0.1:8000/api/v1/sesion
curl -H "Authorization: Bearer <token>" http://127.0.0.1:8000/api/v1/estaciones
curl -H "Authorization: Bearer <token>" "http://127.0.0.1:8000/api/v1/avisos?abiertos=true"
```

| Rol | Alcance | Puede |
|---|---|---|
| `lectura` | un proyecto | consultar estaciones, ventanas, avisos y crudos |
| `operador` | un proyecto | además, reconocer avisos |
| `ingeniero` | un proyecto | además, elevar un aviso a E3/E4 (con justificación; queda auditado) |
| `estacion` | una estación | solo subir sus propios crudos |
| `admin` | todos | consultar y reconocer en todos los proyectos; **no** puede elevar a E3/E4 |

Las credenciales creadas antes de la versión multiproyecto quedaron asignadas a
La Novena.

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

## 5. Añadir un proyecto o una estación

Todo se hace en el archivo del proyecto; no se toca la base a mano.

1. Proyecto nuevo: crear `proyectos/<id>/proyecto.json` a partir de
   `proyectos/PLANTILLA.proyecto.json`. Estación nueva: añadirla a su proyecto
   con estado `simulada` o `instalada`.
2. Volver a ejecutar `iniciar`. Valida todos los proyectos, añade al `.env` la
   contraseña del broker de cada estación nueva (sin tocar las existentes), y el
   servicio `preparar-db` carga los cambios en la base.
3. Crear las credenciales del equipo (sección 3) y, para la subida de crudos, un
   token de rol `estacion`.

Si un proyecto tiene errores no arranca nada: `docker compose logs preparar-db`.

## Estado

- **Probado:** el contrato (las mismas reglas en Python y TypeScript), la ingesta
  (duplicados, conflictos, datos fuera de orden, huecos, estaciones calladas,
  suplantación), el almacén en disco, la API (roles, auditoría, subida de
  crudos, **aislamiento entre proyectos**), el archivo de proyecto y los
  registros del firmware real pasando por la ingesta.
- **Funcionando en Docker** (18/11/2026): en Windows la versión de un solo
  proyecto; en macOS la multiproyecto completa, con dos proyectos y tokens
  reales (cada uno ve solo lo suyo, lo ajeno da 404, admin ve todo), la
  migración de una base con datos del esquema anterior (se conserva todo) y
  Grafana leyendo la base.
- **Corregido ese día:** el usuario de lectura de Grafana nunca se creaba en
  Docker Desktop (el script `db/002_roles.sh` no se podía ejecutar). Ahora lo
  crea o repara `preparar-db` en cada arranque.
- **18/11/2026:** el tablero de Grafana tiene selector de proyecto y de
  estación. Es **comodidad, no aislamiento**: quien entra a Grafana ve todos
  los proyectos (es la herramienta del administrador). Cada ingeniero ve solo
  lo suyo en la app, con su token. Aislar Grafana de verdad exigiría una
  organización y un usuario de base por proyecto, con seguridad por filas.
- **18/11/2026:** el gemelo de la app publica por MQTT como el proyecto
  `novena-gemelo` (ver `proyectos/LEEME.md`). `iniciar` recarga el broker para
  que vea los usuarios nuevos.
- **Sin probar todavía:** el almacén en S3; el TLS del broker.
- **Pendiente con ingenierías:** el protocolo de la pasarela real, el formato
  del archivo en la SD, LoRaWAN y los umbrales.
