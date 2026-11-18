# Proyectos de monitoreo

Cada estructura instrumentada (un puente, un edificio) es un **proyecto**: una
carpeta con un `proyecto.json` que la describe completa. La plataforma de datos
se configura a partir de estos archivos; ningún proyecto está escrito en el
código. Varios ingenieros comparten el mismo servidor y **cada uno ve solo su
proyecto**.

| Carpeta | Proyecto |
|---|---|
| `novena/` | Viaducto de La Novena, Bucaramanga (el primero; hoy solo con una estación simulada) |
| `PLANTILLA.proyecto.json` | Punto de partida para un proyecto nuevo. No se carga: no está en una subcarpeta |

## Crear un proyecto nuevo

1. Crea `proyectos/<id>/` y copia ahí la plantilla con el nombre `proyecto.json`.
   El `<id>` va en minúsculas, cifras y guiones: `puente-chicamocha`, `edificio-uts-b`.
2. Rellena los datos. Lo que no se sepa se deja en `null`: **nunca se inventa**.
3. Arranca o reinicia la plataforma (`scripts/iniciar.ps1` o `scripts/iniciar.sh`). Al
   arrancar se validan todos los proyectos, se crean los usuarios del broker de
   las estaciones nuevas y se cargan en la base.
4. Crea las credenciales del equipo de ese proyecto:
   ```
   docker compose exec api python -m shm_plataforma.gestion token --rol ingeniero --proyecto <id> --nombre "Ing. responsable"
   docker compose exec api python -m shm_plataforma.gestion token --rol lectura   --proyecto <id> --nombre "Consulta"
   ```
   Cada token ve **solo** su proyecto. Lo de otros proyectos responde «no existe».

## Campos

| Campo | Qué es |
|---|---|
| `formato` | Siempre `embedverse-proyecto-shm/1` |
| `proyecto_id` | Identificador del proyecto (minúsculas, cifras, guiones) |
| `estructura.tipo` | `puente`, `edificio` u `otro` |
| `estructura.modelo` | Ruta a la solicitud del modelo 3D paramétrico, si existe |
| `responsable_estructural` | Quien firma ubicaciones y criterios. `null` mientras no haya |
| `estaciones[].id` | En MAYÚSCULAS. **Único en todo el servidor**: es su usuario y su tópico MQTT. Conviene empezar con un prefijo del proyecto (`CHI-SD-L1-M`) |
| `estaciones[].tipo` | `SD` dinámica · `SS` cuasiestática · `SR` referencia de tiempo/ambiental · `GW` pasarela |
| `estaciones[].estado` | `diseno` (en papel) · `simulada` (firmware sin hardware) · `instalada` · `retirada`. Solo las **simuladas e instaladas** se dan de alta en la plataforma |
| `sensores[].magnitud` y `unidad` | `aceleracion` (m/s2, g), `inclinacion` (deg, mrad), `deformacion` (microdeformacion), `temperatura` (degC), `desplazamiento` (mm), `humedad` (%HR) |
| `criterios` | Umbrales de alerta. **Un umbral no se acepta sin `aprobados_por` y `fecha`**: los criterios estructurales los firma el ingeniero del proyecto, no el software |

## Reglas que la plataforma hace cumplir

- Un proyecto con errores **no arranca nada**: `docker compose logs preparar-db` dice qué corregir.
- Una estación no puede estar en dos proyectos. Si se intenta, se rechaza todo el archivo.
- Quitar una estación del archivo la **desactiva**, no la borra: sus datos se conservan.
- Solo el rol `ingeniero` **del propio proyecto** puede elevar un aviso a E3/E4. El
  administrador del servidor (`admin`) ve todos los proyectos, pero no puede hacerlo.

## Estaciones que publica la app (`hardware.placa = "gemelo-app"`)

El gemelo funcional de la app (Sistema embebido) puede publicar en la
plataforma, pero **solo** como estaciones declaradas `"estado": "simulada"` y
`"hardware": {"placa": "gemelo-app"}`. Así la app nunca puede hacerse pasar por
una estación instalada ni por la del firmware. Ejemplo: `novena-gemelo/`, un
proyecto aparte para que los datos sintéticos no se mezclen con los de `novena`.
