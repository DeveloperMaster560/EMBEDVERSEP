"""
Almacén de archivos crudos (bloques de muestras que sube cada estación).

Los crudos NO van a la base de datos muestra por muestra: van como archivos
inmutables a un almacén de objetos, y la base guarda solo su ficha (estación,
ventana, tamaño, SHA-256, configuración). Dos implementaciones con la misma
interfaz:

  - `AlmacenDisco`: una carpeta. Desarrollo en Windows/macOS y servidor propio.
  - `AlmacenS3`: Amazon S3 u otro servicio compatible (necesita boto3).

Los archivos son inmutables: volver a subir el mismo contenido no hace nada;
subir otro contenido con el mismo nombre es un error.
"""

from __future__ import annotations

import hashlib
import os
import re
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

NOMBRE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")
ESTACION = re.compile(r"^[A-Z0-9][A-Z0-9-]{1,31}$")


class ErrorAlmacen(Exception):
    pass


@dataclass
class Ficha:
    station_id: str
    nombre: str
    clave: str        # ruta dentro del almacén
    bytes: int
    sha256: str
    nuevo: bool       # False si ya estaba (subida repetida)


def _validar(station_id: str, nombre: str, sha256_declarado: str) -> None:
    if not ESTACION.match(station_id):
        raise ErrorAlmacen("Identificador de estación no válido.")
    if not NOMBRE.match(nombre) or ".." in nombre:
        raise ErrorAlmacen("Nombre de archivo no válido.")
    if not re.match(r"^[0-9a-f]{64}$", sha256_declarado or ""):
        raise ErrorAlmacen("Falta el SHA-256 declarado (64 cifras hexadecimales en minúscula).")


def clave_de(station_id: str, nombre: str) -> str:
    return f"crudos/{station_id}/{nombre}"


class AlmacenDisco:
    def __init__(self, raiz: str | os.PathLike):
        self.raiz = Path(raiz)
        self.raiz.mkdir(parents=True, exist_ok=True)

    def guardar(self, station_id: str, nombre: str, datos: bytes, sha256_declarado: str) -> Ficha:
        _validar(station_id, nombre, sha256_declarado)
        real = hashlib.sha256(datos).hexdigest()
        if real != sha256_declarado:
            raise ErrorAlmacen(f"El SHA-256 no coincide: declarado {sha256_declarado}, recibido {real}.")
        clave = clave_de(station_id, nombre)
        destino = self.raiz / clave
        if destino.exists():
            previo = hashlib.sha256(destino.read_bytes()).hexdigest()
            if previo == real:
                return Ficha(station_id, nombre, clave, len(datos), real, nuevo=False)
            raise ErrorAlmacen("Ya existe un archivo con ese nombre y otro contenido: los crudos son inmutables.")
        destino.parent.mkdir(parents=True, exist_ok=True)
        # Escritura atómica: un corte a medias nunca deja un archivo truncado con el nombre final.
        fd, tmp = tempfile.mkstemp(dir=destino.parent, prefix=".subiendo-")
        try:
            with os.fdopen(fd, "wb") as f:
                f.write(datos)
                f.flush()
                os.fsync(f.fileno())
            os.replace(tmp, destino)
        except BaseException:
            if os.path.exists(tmp):
                os.unlink(tmp)
            raise
        return Ficha(station_id, nombre, clave, len(datos), real, nuevo=True)

    def leer(self, clave: str) -> bytes:
        ruta = (self.raiz / clave).resolve()
        if self.raiz.resolve() not in ruta.parents:
            raise ErrorAlmacen("Clave fuera del almacén.")
        return ruta.read_bytes()


class AlmacenS3:
    """S3 o compatible. La integridad se comprueba antes de subir y S3 la vuelve a comprobar (ChecksumSHA256)."""

    def __init__(self, bucket: str, endpoint: Optional[str] = None, region: Optional[str] = None):
        import boto3  # dependencia opcional: solo con ALMACEN=s3
        self.bucket = bucket
        self.s3 = boto3.client("s3", endpoint_url=endpoint or None, region_name=region or None)

    def guardar(self, station_id: str, nombre: str, datos: bytes, sha256_declarado: str) -> Ficha:
        import base64
        from botocore.exceptions import ClientError
        _validar(station_id, nombre, sha256_declarado)
        real = hashlib.sha256(datos).hexdigest()
        if real != sha256_declarado:
            raise ErrorAlmacen(f"El SHA-256 no coincide: declarado {sha256_declarado}, recibido {real}.")
        clave = clave_de(station_id, nombre)
        try:
            cab = self.s3.head_object(Bucket=self.bucket, Key=clave)
            if cab.get("Metadata", {}).get("sha256") == real:
                return Ficha(station_id, nombre, clave, len(datos), real, nuevo=False)
            raise ErrorAlmacen("Ya existe un archivo con ese nombre y otro contenido: los crudos son inmutables.")
        except ClientError as e:
            if e.response.get("Error", {}).get("Code") not in ("404", "NoSuchKey", "NotFound"):
                raise
        self.s3.put_object(
            Bucket=self.bucket, Key=clave, Body=datos,
            ChecksumSHA256=base64.b64encode(bytes.fromhex(real)).decode(),
            Metadata={"sha256": real, "station_id": station_id},
            IfNoneMatch="*",
        )
        return Ficha(station_id, nombre, clave, len(datos), real, nuevo=True)

    def leer(self, clave: str) -> bytes:
        return self.s3.get_object(Bucket=self.bucket, Key=clave)["Body"].read()


def desde_entorno():
    """ALMACEN=disco (por omisión) o s3, según las variables de entorno."""
    tipo = os.environ.get("ALMACEN", "disco")
    if tipo == "s3":
        return AlmacenS3(os.environ["S3_BUCKET"], os.environ.get("S3_ENDPOINT"), os.environ.get("AWS_REGION"))
    return AlmacenDisco(os.environ.get("ALMACEN_DIR", "datos/crudos"))
