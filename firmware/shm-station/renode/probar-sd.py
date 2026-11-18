"""
Prueba del driver SDMMC1 en Renode con una microSD emulada, de punta a punta:

    make renode-sd && python3 renode/probar-sd.py [segundos] [ruta-a-renode]

Arranca el firmware, recoge los registros del puerto de servicio, cierra
Renode limpiamente (pause + quit: matarlo deja la imagen a medio volcar),
extrae la tarjeta con shm_plataforma.tarjeta y comprueba que cada registro
«sd:…» tiene su ventana en la tarjeta con el mismo CRC y sin huecos.
Sale con 0 si todo cuadra.
"""

import re
import socket
import subprocess
import sys
import tempfile
import time
from pathlib import Path

AQUI = Path(__file__).resolve().parent.parent
RAIZ = AQUI.parent.parent
sys.path.insert(0, str(RAIZ / "plataforma" / "servicios"))
from shm_plataforma.crudo import leer  # noqa: E402
from shm_plataforma.tarjeta import extraer  # noqa: E402

segundos = int(sys.argv[1]) if len(sys.argv) > 1 else 100
renode = sys.argv[2] if len(sys.argv) > 2 else str(RAIZ / ".tools/renode/Renode.app/Contents/MacOS/macos_run.command")
tmp = Path(tempfile.mkdtemp())
img = AQUI / "build" / "tarjeta-renode.img"   # la que monta shm-station-sd.resc
with img.open("wb") as f:
    f.truncate(64 * 1024 * 1024)

proc = subprocess.Popen([renode, "--disable-xwt", "--port", "12345", "renode/shm-station-sd.resc"],
                        cwd=AQUI, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def conectar(puerto):
    for _ in range(60):
        try:
            return socket.create_connection(("127.0.0.1", puerto))
        except OSError:
            time.sleep(1)
    raise SystemExit(f"Renode no abrió el puerto {puerto}")


serv = conectar(3456)
serv.settimeout(1)
salida = b""
t0 = time.time()
while time.time() - t0 < segundos:
    try:
        salida += serv.recv(4096)
    except socket.timeout:
        pass
mon = conectar(12345)
mon.sendall(b"pause\n")
time.sleep(2)
mon.sendall(b"quit\n")
proc.wait(timeout=60)

texto = salida.decode("utf-8", "replace")
print("\n".join(l for l in texto.splitlines() if l.startswith("#")))
regs = dict(re.findall(r'"samples_file":"sd:[^/]+/(\d+)","samples_crc32":"([0-9a-f]+)"', texto))
huecos = re.findall(r'"gaps":(\d+)', texto)
inf = extraer(img, tmp / "extraida")
en = {f"{s:08d}": leer(r.read_bytes(), con_datos=False).data_crc32 for s, r in inf.ventanas}
coinciden = sum(1 for k, v in regs.items() if en.get(k) == v)
print(f"registros «sd:»: {len(regs)} · ventanas en la tarjeta: {len(inf.ventanas)} · dañadas: {len(inf.danadas)} · "
      f"CRC iguales: {coinciden} · ventanas con huecos: {sum(1 for h in huecos if h != '0')}")
ok = regs and coinciden == len(regs) == len(inf.ventanas) and not inf.danadas and all(h == "0" for h in huecos)
print("BIEN" if ok else "FALLA")
sys.exit(0 if ok else 1)
