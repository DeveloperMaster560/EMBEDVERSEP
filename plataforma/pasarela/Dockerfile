# Pasarela SIMULADA: compila el firmware de la estación para Linux y lo
# ejecuta, publicando sus registros en el broker. Así la demostración es la
# misma en Windows y en macOS (no hace falta compilador en el equipo).
# Contexto: plataforma/; contexto adicional «firmware»: firmware/shm-station.
FROM python:3.12.16-slim-trixie

RUN apt-get update && apt-get install -y --no-install-recommends gcc libc6-dev make \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
RUN pip install --no-cache-dir paho-mqtt==2.2.0
COPY --from=firmware . /app/firmware
# El build/ del equipo (binarios de macOS o Windows) no sirve aquí: se recompila.
RUN rm -rf /app/firmware/build && make -C /app/firmware sim
COPY servicios/shm_plataforma ./shm_plataforma

RUN useradd --system --uid 10001 shm && mkdir -p /datos && chown shm /datos
USER shm
