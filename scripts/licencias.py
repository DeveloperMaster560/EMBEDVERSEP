"""
Licencia de una biblioteca de Arduino leída de su propio .zip (el mismo que se
verificó con su checksum): archivos LICENSE/COPYING de la raíz, identificadores
SPDX en el código y, si no hay nada de eso, el texto de las cabeceras.

No es asesoría legal. Clasifica en tres grupos, por lo que obliga al ENTREGAR
un firmware compilado (Arduino enlaza todo en un solo binario):

  permisiva  MIT, BSD, Apache-2.0, Zlib…: basta con incluir el aviso de copyright.
  lgpl       LGPL: además, el código de la biblioteca y la forma de volver a
             enlazar el firmware con una versión modificada de ella.
  gpl        GPL: quien distribuya el equipo debe entregar el código fuente de
             TODO el firmware bajo GPL.
  propia     texto propio del autor (p. ej. «úsese sin modificar»): leerlo.
  desconocida  sin licencia encontrada: legalmente, «todos los derechos
             reservados» hasta que el autor diga otra cosa.

Uso:  python3 scripts/licencias.py           informe de la biblioteca oficial
      (scripts/biblioteca_oficial.py la usa para llenar «licencia» en el lock)
"""
from __future__ import annotations

import re
import zipfile
from pathlib import Path
from typing import Optional

PERMISIVAS = {"MIT", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "ISC", "Zlib", "Unlicense", "CC0-1.0",
              "BSL-1.0", "0BSD", "MIT-0", "PJRC", "Beerware"}

ARCHIVO = re.compile(r"[^/]+/(LICEN[CS]E|COPYING|UNLICENSE)(\.(txt|md|markdown|rst))?$", re.I)
SPDX = re.compile(r"SPDX-License-Identifier:\s*([A-Za-z0-9.+-]+(?:\s+(?:OR|AND|WITH)\s+[A-Za-z0-9.+-]+)*)")

# (patrón, SPDX). El orden importa: LGPL antes que GPL, versiones antes que la genérica.
# Títulos: un archivo de licencia empieza por el suyo (el texto de la GPL-3.0 NOMBRA la
# «GNU Affero General Public License» en su sección 13; por eso primero el título).
TITULOS = [
    (r"GNU AFFERO GENERAL PUBLIC LICENSE\s+Version 3", "AGPL-3.0"),
    (r"GNU LESSER GENERAL PUBLIC LICENSE\s+Version 3", "LGPL-3.0"),
    (r"GNU LESSER GENERAL PUBLIC LICENSE\s+Version 2\.1", "LGPL-2.1"),
    (r"GNU LIBRARY GENERAL PUBLIC LICENSE\s+Version 2", "LGPL-2.0"),
    (r"GNU GENERAL PUBLIC LICENSE\s+Version 3", "GPL-3.0"),
    (r"GNU GENERAL PUBLIC LICENSE\s+Version 2", "GPL-2.0"),
    (r"Mozilla Public License Version 2\.0", "MPL-2.0"),
    (r"Apache License\s+Version 2\.0", "Apache-2.0"),
]

TEXTOS = [
    # Licencias propias de un autor (texto suyo, no una licencia conocida).
    (r"derivitive works are NOT permitted|derivative works are NOT permitted", "LicenseRef-uso-sin-modificar"),
    (r"Beerware|beer-ware", "Beerware"),
    (r"two-clause bsd|new-bsd license|BSD-2-Clause", "BSD-2-Clause"),
    (r"GNU LESSER GENERAL PUBLIC LICENSE\s+Version 3", "LGPL-3.0"),
    (r"GNU LESSER GENERAL PUBLIC LICENSE\s+Version 2\.1", "LGPL-2.1"),
    (r"GNU LIBRARY GENERAL PUBLIC LICENSE\s+Version 2", "LGPL-2.0"),
    (r"GNU Lesser General Public\s+License.{0,200}?version 3", "LGPL-3.0"),
    (r"GNU Lesser General Public\s+License.{0,200}?version 2\.1", "LGPL-2.1"),
    (r"GNU Lesser General Public", "LGPL-2.1"),
    (r"GNU GENERAL PUBLIC LICENSE\s+Version 3", "GPL-3.0"),
    (r"GNU GENERAL PUBLIC LICENSE\s+Version 2", "GPL-2.0"),
    (r"GNU General Public License.{0,200}?version 3", "GPL-3.0"),
    (r"GNU General Public License.{0,200}?version 2", "GPL-2.0"),
    (r"\bGNU GPL v?3\b|\bGPL[- ]?v?3\b|GPLv3", "GPL-3.0"),
    (r"\bGNU GPL v?2\b|\bGPL[- ]?v?2\b|GPLv2", "GPL-2.0"),
    (r"GNU General Public License", "GPL-2.0"),
    (r"Mozilla Public License,?\s+(v\.|version)\s*2\.0", "MPL-2.0"),
    (r"Apache License,?\s+Version 2\.0", "Apache-2.0"),
    (r"Boost Software License", "BSL-1.0"),
    (r"This is free and unencumbered software released into the public domain", "Unlicense"),
    (r"CC0 1\.0 Universal", "CC0-1.0"),
    (r"PJRC\.COM.{0,800}?similar target\s+devices manufactured by PJRC", "PJRC"),
    (r"Permission is hereby granted, free of charge, to any person obtaining", "MIT"),
    (r"Permission to use, copy, modify, and/or distribute this software for any\s+purpose with or without fee", "ISC"),
    (r"This software is provided 'as-is', without any express or implied\s+warranty", "Zlib"),
    (r"Redistribution and use in source and binary forms.{0,1500}?(Neither the name|endorse or promote)", "BSD-3-Clause"),
    (r"Redistribution and use in source and binary forms", "BSD-2-Clause"),
    (r"\bMIT License\b|\bMIT license\b|licen[cs]ed under (the )?MIT", "MIT"),
    (r"\bBSD license\b|\bBSD License\b", "BSD-3-Clause"),
    (r"\bLGPL\b", "LGPL-2.1"),
    (r"\bGPL\b", "GPL-2.0"),
]


ORDEN = ["permisiva", "lgpl", "propia", "desconocida", "gpl"]   # de menos a más restrictiva


def grupo(spdx: Optional[str]) -> str:
    if not spdx:
        return "desconocida"
    if " AND " in spdx:            # archivos con licencias distintas: manda la más restrictiva
        return max((grupo(x) for x in spdx.split(" AND ")), key=ORDEN.index)
    if spdx.startswith("LicenseRef-"):
        return "propia"
    partes = re.split(r"\s+OR\s+", spdx)
    # «X OR Y»: se puede elegir la más favorable.
    if any(p.strip() in PERMISIVAS for p in partes):
        return "permisiva"
    if any(p.startswith("LGPL") or p.startswith("MPL") for p in partes):
        return "lgpl"          # MPL-2.0 obliga por archivo, parecido a LGPL en la práctica
    if any("GPL" in p for p in partes):
        return "gpl"
    return "desconocida"


def _del_texto(texto: str, archivo_de_licencia: bool = False) -> Optional[str]:
    m = SPDX.search(texto)
    if m:
        return m.group(1).strip()
    plano = re.sub(r"[ \t]*(//|\*|#)[ \t]?", " ", texto)      # comentarios de cabecera
    if archivo_de_licencia:
        inicio = plano.lstrip()[:400]
        for patron, spdx in TITULOS:
            if re.search(patron, inicio, re.I):
                return spdx
    # En un archivo de licencia manda la que se declara primero (U8g2: «código BSD; una
    # fuente derivada es GPL»); en una cabecera, la primera regla que encaja.
    hallazgos = [(m.start(), i, spdx) for i, (patron, spdx) in enumerate(TEXTOS)
                 if (m := re.search(patron, plano, re.I | re.S))]
    if not hallazgos:
        return None
    return min(hallazgos)[2] if archivo_de_licencia else min(hallazgos, key=lambda h: h[1])[2]


def licencia_del_zip(zip_path: Path) -> tuple[Optional[str], str]:
    """(SPDX o None, de dónde salió). Si algún archivo del código trae una licencia más
    restrictiva que la declarada, se suman con AND (Ethernet: MIT + Apache + LGPL)."""
    with zipfile.ZipFile(zip_path) as z:
        nombres = z.namelist()
        declarada, fuente = None, None
        vistas: list[str] = []
        for n in sorted((n for n in nombres if ARCHIVO.match(n)), key=len):
            spdx = _del_texto(z.read(n).decode("utf-8", "replace"), archivo_de_licencia=True)
            if spdx:
                declarada, fuente = spdx, n.split("/", 1)[1]
                break
            vistas.append(n.split("/", 1)[1])
        props = next((n for n in nombres if re.fullmatch(r"[^/]+/library\.properties", n)), None)
        if declarada is None and props:
            m = re.search(r"^license\s*=\s*(.+)$", z.read(props).decode("utf-8", "replace"), re.M)
            if m:
                declarada, fuente = m.group(1).strip(), "library.properties"
        # Solo el código de la biblioteca: ejemplos, pruebas y extras no van al firmware.
        fuentes = sorted((n for n in nombres if re.search(r"\.(h|hpp|c|cpp)$", n)
                          and not re.search(r"/(examples?|extras|tests?|docs?|tools)/", n, re.I)),
                         key=lambda n: (n.count("/"), len(n)))
        por_archivo: dict[str, str] = {}
        for n in fuentes:
            spdx = _del_texto(z.read(n).decode("utf-8", "replace")[:30000])
            if spdx and spdx not in por_archivo:
                por_archivo[spdx] = n.split("/", 1)[1]
    if declarada is None and por_archivo:
        # Sin archivo de licencia: la del archivo más importante (el primero) y las más restrictivas.
        declarada = next(iter(por_archivo))
        fuente = f"cabecera de {por_archivo[declarada]}"
    if declarada is None:
        return None, ("archivo de licencia sin texto reconocible: " + ", ".join(vistas)) if vistas \
            else "sin archivo de licencia ni aviso en las cabeceras"
    peores = [x for x in por_archivo if ORDEN.index(grupo(x)) > ORDEN.index(grupo(declarada))]
    if peores:
        return " AND ".join([declarada, *peores]), fuente + "; además " + ", ".join(
            f"{x} en {por_archivo[x]}" for x in peores)
    return declarada, fuente


OBLIGACIONES = {
    "permisiva": "Incluir el aviso de copyright y la licencia con el firmware que se entrega.",
    "lgpl": "Aviso y licencia; además entregar (o ofrecer) el código de la biblioteca y la forma de volver a "
            "enlazar el firmware con una versión modificada de ella (en Arduino: el proyecto completo y la versión exacta).",
    "gpl": "Quien entregue el equipo debe entregar el código fuente de TODO el firmware bajo la GPL. "
           "Para un producto cerrado: cambiar de biblioteca o pedir otra licencia al autor.",
    "propia": "Licencia escrita por el autor: vale lo que diga su texto. NewPing: se puede usar tal cual "
              "(privado y comercial), pero no modificarla ni publicar versiones derivadas.",
    "desconocida": "Sin licencia no hay permiso: pedírsela al autor o cambiar de biblioteca antes de vender equipos.",
}


def informe(lock: dict) -> str:
    libs = lock["bibliotecas"]
    filas = sorted(libs.items() if isinstance(libs, dict) else [(b["nombre"], b) for b in libs],
                   key=lambda kv: ({"gpl": 0, "desconocida": 1, "propia": 2, "lgpl": 3, "permisiva": 4}[grupo(kv[1].get("licencia"))], kv[0].lower()))
    cuenta: dict[str, int] = {}
    for _, b in filas:
        g = grupo(b.get("licencia"))
        cuenta[g] = cuenta.get(g, 0) + 1
    t = ["# Licencias de la biblioteca oficial", "",
         "Generado por `scripts/biblioteca_oficial.py` (con `scripts/licencias.py`) a partir del `.zip` verificado "
         "de cada biblioteca. **No es asesoría legal**: es el inventario para que lo revise un abogado antes de "
         "abrir el servicio al público.", "",
         "| Grupo | Bibliotecas | Qué obliga al entregar un firmware |", "|---|---|---|"]
    for g in ("gpl", "desconocida", "propia", "lgpl", "permisiva"):
        t.append(f"| {g} | {cuenta.get(g, 0)} | {OBLIGACIONES[g]} |")
    t += ["", "| Biblioteca | Versión | Licencia | Grupo | De dónde |", "|---|---|---|---|---|"]
    for n, b in filas:
        t.append(f"| {n} | {b['version']} | {b.get('licencia') or '—'} | {grupo(b.get('licencia'))} | "
                 f"{b.get('licencia_fuente', '—')} |")
    return "\n".join(t) + "\n"


if __name__ == "__main__":
    import json
    import sys
    raiz = Path(__file__).resolve().parents[1]
    lock = json.loads((raiz / "server" / "bibliotecas.lock.json").read_text(encoding="utf-8"))
    sys.stdout.write(informe(lock))
