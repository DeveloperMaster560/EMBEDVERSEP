"""
Pasarela SIMULADA: lleva al broker los registros que produce el firmware.

El firmware de la estación todavía no tiene Ethernet ni MQTT (el protocolo
de la pasarela está pendiente con ingeniería). Mientras tanto esta pasarela
hace ese papel: ejecuta el firmware compilado para el ordenador
(`firmware/shm-station/build/shm-sim`), lee los registros JSON que saca por
su puerto de servicio y los publica en MQTT.

Tiene lo que debe tener la pasarela real:
  - cola persistente en disco: si no hay broker, guarda y reenvía después
    (almacenar y reenviar), sin perder ni reordenar;
  - QoS 1 y borrado de la cola solo tras la confirmación del broker;
  - «testamento» (LWT): si la pasarela muere, el broker publica que está fuera de línea.

Uso:
  python -m shm_plataforma.pasarela_sim --estacion SD-V2-M -- build/shm-sim señal.csv --seconds 600 --realtime
  python -m shm_plataforma.pasarela_sim --estacion SD-V2-M --archivo registros.jsonl
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import queue
import subprocess
import sys
import threading
import time
from collections import deque
from datetime import datetime, timezone
from pathlib import Path

log = logging.getLogger("pasarela")


class Cola:
    """Cola FIFO que sobrevive a reinicios (un JSON por línea)."""

    def __init__(self, ruta: Path):
        self.ruta = ruta
        self.items: deque[str] = deque()
        if ruta.exists():
            self.items.extend(l for l in ruta.read_text(encoding="utf-8").splitlines() if l.strip())

    def _guardar(self) -> None:
        tmp = self.ruta.with_suffix(".tmp")
        tmp.write_text("".join(i + "\n" for i in self.items), encoding="utf-8")
        os.replace(tmp, self.ruta)

    def poner(self, item: str) -> None:
        self.items.append(item)
        with self.ruta.open("a", encoding="utf-8") as f:
            f.write(item + "\n")

    def primero(self):
        return self.items[0] if self.items else None

    def quitar_primero(self) -> None:
        self.items.popleft()
        self._guardar()

    def __len__(self) -> int:
        return len(self.items)


def lineas_de(proc_args: list[str] | None, archivo: str | None, salida: queue.Queue) -> None:
    if archivo:
        for l in Path(archivo).read_text(encoding="utf-8").splitlines():
            salida.put(l)
        salida.put(None)
        return
    p = subprocess.Popen(proc_args, stdout=subprocess.PIPE, stdin=subprocess.PIPE, text=True, bufsize=1)
    assert p.stdout is not None
    for l in p.stdout:
        salida.put(l.rstrip("\n"))
    salida.put(None)


def main(argv: list[str] | None = None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    comando: list[str] = []
    if "--" in argv:
        i = argv.index("--")
        argv, comando = argv[:i], argv[i + 1:]
    ap = argparse.ArgumentParser(description="Pasarela simulada estación → MQTT")
    ap.add_argument("--estacion", required=True)
    ap.add_argument("--archivo", help="registros JSON, uno por línea, en vez de ejecutar el firmware")
    ap.add_argument("--cola", default="datos/pasarela-cola.jsonl")
    ap.add_argument("--host", default=os.environ.get("MQTT_HOST", "localhost"))
    ap.add_argument("--puerto", type=int, default=int(os.environ.get("MQTT_PORT", "1883")))
    a = ap.parse_args(argv)
    if not comando and not a.archivo:
        ap.error("indica el comando del firmware tras «--» o un --archivo")
    # «{ahora}» en el comando se sustituye por la hora actual (segundos Unix),
    # para que la hora simulada del firmware arranque en el presente.
    ahora = str(int(time.time()))
    comando = [x.replace("{ahora}", ahora) for x in comando]

    import paho.mqtt.client as mqtt

    logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO"), format="%(asctime)s %(name)s %(message)s")
    Path(a.cola).parent.mkdir(parents=True, exist_ok=True)
    cola = Cola(Path(a.cola))
    t_estado = f"shm/v1/{a.estacion}/estado"
    t_registro = f"shm/v1/{a.estacion}/registro"

    c = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id=f"pasarela-{a.estacion}", protocol=mqtt.MQTTv311)
    c.username_pw_set(os.environ.get("MQTT_USER", a.estacion), os.environ["MQTT_PASSWORD"])
    c.will_set(t_estado, json.dumps({"en_linea": False, "origen": "pasarela-simulada"}), qos=1, retain=True)
    c.reconnect_delay_set(1, 30)

    def on_connect(cl, _u, _f, rc, _p):
        log.info("broker: %s", rc)
        if not rc.is_failure:
            cl.publish(t_estado, json.dumps({
                "en_linea": True, "origen": "pasarela-simulada",
                "desde": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
            }), qos=1, retain=True)

    c.on_connect = on_connect
    c.connect_async(a.host, a.puerto, keepalive=30)
    c.loop_start()

    entrada: queue.Queue = queue.Queue()
    threading.Thread(target=lineas_de, args=(comando or None, a.archivo, entrada), daemon=True).start()

    fin = False
    enviados = 0
    while not (fin and len(cola) == 0):
        try:
            while True:
                l = entrada.get(timeout=0.2)
                if l is None:
                    fin = True
                    break
                if l.startswith("{"):
                    try:
                        json.loads(l)
                    except json.JSONDecodeError:
                        log.warning("línea JSON incompleta descartada: %s", l[:80])
                        continue
                    cola.poner(l)
                elif l.startswith("#"):
                    log.info("firmware: %s", l)
        except queue.Empty:
            pass
        if c.is_connected() and len(cola):
            info = c.publish(t_registro, cola.primero(), qos=1)
            try:
                info.wait_for_publish(timeout=5)
            except (RuntimeError, ValueError):
                pass
            if info.is_published():
                cola.quitar_primero()
                enviados += 1
            else:
                time.sleep(1)
        elif len(cola):
            time.sleep(0.5)
    log.info("terminado: %d registros enviados", enviados)
    c.publish(t_estado, json.dumps({"en_linea": False, "origen": "pasarela-simulada"}), qos=1, retain=True).wait_for_publish(5)
    c.loop_stop()
    c.disconnect()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
