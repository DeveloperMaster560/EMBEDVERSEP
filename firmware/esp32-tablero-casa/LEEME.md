# Tablero eléctrico de una casa (ESP32)

Prueba de punta a punta del sistema eléctrico de una casa: medidor PZEM-004T v3.0
en la acometida y DHT22 dentro del tablero, enviando al contrato de **medidas**
de la plataforma (`shm/v1/CASA-TAB-01/medida`). Es un solo `.ino` para poder
pegarlo en el editor de la app.

| Mide | Magnitud | Unidad |
|---|---|---|
| Tensión de la red | `tension` | V |
| Corriente total | `corriente` | A |
| Potencia activa | `potencia` | W |
| Energía acumulada | `energia` | kWh |
| Frecuencia | `frecuencia` | Hz |
| Factor de potencia | `factor_potencia` | 1 |
| Temperatura en el tablero | `temperatura` | °C |

**No protege ni da alarmas.** La protección la dan los interruptores
automáticos y el diferencial. Los umbrales de aviso los firma el ingeniero en el
proyecto y los aplica la plataforma.

## Lo que enseñó la simulación con la biblioteca real (PZEM004Tv30 1.2.1)

- En los primeros 200 ms devuelve ceros sin preguntar al medidor: se espera 1 s.
- Tras una lectura fallida, `voltage()` da NaN pero `current()`, `energy()`…
  devuelven los valores **viejos**. Por eso, si la tensión es NaN, todo va como
  `null` con su motivo, nunca un valor repetido ni un 0.
- El PZEM se alimenta del lado de AC: sin red no responde.

## Probarlo

```sh
cd plataforma/servicios
python -m shm_plataforma.simular_placa ../../firmware/esp32-tablero-casa \
  --placa esp32-devkit --escenario ../../firmware/esp32-tablero-casa/escenario-casa.csv --duracion 185
# con la plataforma corriendo, --enviar --env ../.env lo manda como la estación CASA-TAB-01
```

El escenario (`escenario-casa.csv`) es **inventado**: consumo base, ducha
eléctrica de 3,5 kW, un corte de energía de 30 s y el sensor del tablero
fallando 10 s. El proyecto de la plataforma es `proyectos/casa-demo` (datos
sintéticos; la casa no existe).

Resultado el 19/11/2026: 18 mensajes, todos dentro del contrato; la ingesta
los guardó con los `null` del corte y del sensor; la app los muestra en
«Sistema embebido → Plataforma de datos».

Para compilarlo hace falta el núcleo `esp32:esp32` y las bibliotecas oficiales
«PZEM004Tv30», «DHT sensor library» y «PubSubClient» (las instala el
administrador). Lo secreto (Wi-Fi, clave MQTT) va en `secretos.h`, que no se
sube; sin él compila y se simula, pero no se conecta.
