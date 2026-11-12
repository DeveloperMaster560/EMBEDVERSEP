# Imagen única para ingesta, API y pasarela simulada.
FROM python:3.12.16-slim-trixie

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY shm_plataforma ./shm_plataforma

RUN useradd --system --uid 10001 shm && mkdir -p /datos && chown shm /datos
USER shm
