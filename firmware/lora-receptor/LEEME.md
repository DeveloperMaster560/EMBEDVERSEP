# Receptor LoRa → USB

Recibe los paquetes de los nodos LoRa y los imprime por USB, una línea por
paquete, sin interpretarlos. La pasarela del PC hace el resto:

```
python -m shm_plataforma.pasarela_serie --proyecto ../../proyectos/<proyecto>/proyecto.json \
    --estacion RIO-AGUA-01 --estacion RIO-AIRE-01 --puerto COM7
```

En `proyecto.json`, cada estación lleva `"comunicacion": {"protocolo": "lora",
"periodo_s": 60, "prefijo": "AGUA"}` y cada sensor su `"lectura"` (campo o
columna). Ver «Texto libre y LoRa» en `plataforma/CONECTAR_EQUIPOS.md`.

- Placa: ESP32 + SX1276/SX1278. Pines y frecuencia en `config.h`.
- Biblioteca: RadioLib (está en la biblioteca oficial).
- Los emisores deben usar la misma frecuencia, ancho de banda, SF, CR y
  palabra de sincronía.
- **Estado:** escrito, sin compilar ni probar con radio.

La radio no es segura: cualquiera en la banda puede enviar «AGUA,…». La
pasarela solo valida el formato. Si eso importa, los nodos deben firmar los
paquetes (pendiente).
