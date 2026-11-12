"""
Servicio de ingesta: MQTT → contrato → TimescaleDB.

- Sesión persistente (clean_session=False) y QoS 1: si este servicio se cae,
  el broker guarda los mensajes y los entrega al volver.
- Confirmación manual: un mensaje solo se confirma (PUBACK) después de
  escribirlo en la base. Si la base falla, no se confirma, se corta la
  conexión y el broker lo vuelve a entregar.
- Un hilo aparte vigila las estaciones que dejaron de hablar.
"""

from __future__ import annotations

import logging
import os
import ssl
import threading
import time
from datetime import datetime, timezone

import paho.mqtt.client as mqtt

from .db import RepositorioPg, conectar
from .ingesta import Ingestor, estaciones_silenciosas

log = logging.getLogger("ingesta")

SUSCRIPCIONES = [("shm/v1/+/registro", 1), ("shm/v1/+/estado", 1), ("shm/v1/+/evento", 1)]
# Una estación es «silenciosa» tras este número de periodos sin mensajes.
PERIODOS_SILENCIO = int(os.environ.get("PERIODOS_SILENCIO", "6"))


def vigilante(parar: threading.Event) -> None:
    repo = None
    while not parar.wait(30):
        try:
            repo = repo or RepositorioPg(conectar())
            ahora = datetime.now(timezone.utc)
            vistos = repo.ultimo_visto()
            for sid, (visto, periodo) in vistos.items():
                for a in estaciones_silenciosas({sid: visto}, ahora, periodo * PERIODOS_SILENCIO):
                    repo.guardar_aviso(a)
        except Exception:  # noqa: BLE001 — el vigilante no debe morir
            log.exception("vigilante: error; se reintenta")
            repo = None


def main() -> None:
    logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO"), format="%(asctime)s %(name)s %(levelname)s %(message)s")
    estado = {"repo": None}

    def repo() -> RepositorioPg:
        if estado["repo"] is None:
            estado["repo"] = RepositorioPg(conectar())
        return estado["repo"]

    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id="shm-ingesta",
                         clean_session=False, protocol=mqtt.MQTTv311)
    client.manual_ack_set(True)
    client.username_pw_set(os.environ["MQTT_USER"], os.environ["MQTT_PASSWORD"])
    if os.environ.get("MQTT_TLS") == "1":
        client.tls_set(ca_certs=os.environ.get("MQTT_CA"), tls_version=ssl.PROTOCOL_TLS_CLIENT)
    client.reconnect_delay_set(min_delay=1, max_delay=30)

    def on_connect(c, _u, _flags, reason_code, _props):
        log.info("conectado al broker: %s", reason_code)
        if not reason_code.is_failure:
            c.subscribe(SUSCRIPCIONES)

    def on_message(c, _u, msg):
        recibido = datetime.now(timezone.utc)
        try:
            res = Ingestor(repo()).procesar(msg.topic, msg.payload, recibido)
        except Exception:  # noqa: BLE001
            log.exception("no se pudo guardar %s; NO se confirma y se reconecta", msg.topic)
            estado["repo"] = None
            c.disconnect()   # el broker reentregará lo no confirmado
            return
        c.ack(msg.mid, msg.qos)
        nivel = logging.WARNING if res.accion in ("rechazado", "conflicto") else logging.DEBUG
        log.log(nivel, "%s %s %s", msg.topic, res.accion, "; ".join(res.problemas))

    client.on_connect = on_connect
    client.on_message = on_message

    parar = threading.Event()
    threading.Thread(target=vigilante, args=(parar,), daemon=True).start()

    host, port = os.environ.get("MQTT_HOST", "broker"), int(os.environ.get("MQTT_PORT", "1883"))
    while True:
        try:
            client.connect(host, port, keepalive=30)
            client.loop_forever(retry_first_connection=True)
        except Exception:  # noqa: BLE001
            log.exception("conexión MQTT perdida; reintento en 5 s")
            time.sleep(5)


if __name__ == "__main__":
    main()
