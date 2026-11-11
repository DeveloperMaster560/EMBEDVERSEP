# Identificar una pieza a partir de su fotografía

Estado: **funciona y se puede probar**. No usa ningún servicio externo, no
descarga nada y no envía la imagen a ninguna parte: la medida se hace en el
navegador del usuario.

## El problema, antes de la solución

Una fotografía de un chip da **dos cosas distintas**, y conviene no mezclarlas:

1. **La forma.** El contorno del cuerpo y cuántas patas salen por cada lado.
   Eso **se mide**: son hechos geométricos de la imagen.
2. **El marcaje.** El texto serigrafiado encima. Eso **identifica** la pieza.

Lo que una foto **no puede dar nunca** es qué hace cada pata. Un DIP de 8 patas
puede ser un NE555, un LM393 o una EEPROM, y sus patillajes son incompatibles
entre sí. Deducir la función de la silueta sería inventarla.

Por eso el resultado es un **borrador**, no un componente terminado, y por eso
las patas sin identificar salen **con el nombre a `null`** en vez de con un
nombre plausible.

## Los tres resultados posibles

| Caso | Qué se entrega |
|---|---|
| **Pieza identificada** por su marcaje | El patillaje sale del catálogo, que es dato comprobado |
| **Sin identificar** | Las patas, contadas y situadas, **sin nombre** (`null`) |
| **Lo leído y lo medido no cuadran** | La contradicción, declarada |

El tercero es el más útil y el que más trabajo llevó. Si el marcaje dice
`DS3231` (16 patas) y en la foto hay 8, el sistema **no elige una de las dos
lecturas**: dice que una es incorrecta y deja al usuario comprobarlo. Resolver
eso por su cuenta sería quedarse con una mitad al azar.

## Lo que se descarta del marcaje, y por qué se enseña

El marcaje real de un ATmega328P no es solo la referencia:

```
ATMEL          <- el fabricante, no la pieza
ATMEGA328P     <- esto sí
-PU            <- sufijo de encapsulado
1735           <- código de lote o fecha
```

Se descarta por **forma**, no por una lista de piezas: cualquier chip puede
llevar cualquier lote. Y lo descartado **se le muestra al usuario con el
motivo**, para que nada desaparezca en silencio: si su referencia acaba ahí por
error, lo nota.

## Lo que NO hace, dicho claro

- **No propone «la más parecida».** Si el marcaje no corresponde a ninguna
  pieza del catálogo, lo dice. Montar un LM338 creyendo que es un LM358
  estropea el circuito; no proponer nada es mejor que proponer eso.
- **No lee el marcaje automáticamente.** Hoy el usuario lo teclea mirando la
  pieza. Un OCR exigiría una dependencia nueva de varios megas y una descarga
  en tiempo de ejecución; la decisión es del usuario y no se ha tomado por él.
  El lector de marcaje ya está hecho y acepta igual texto teclado que leído, así
  que añadir el OCR es enchufarlo, no rehacerlo.
- **No sitúa la pata 1.** La numeración de un encapsulado arranca en la pata 1,
  y lo único que la sitúa es la muesca o el punto del cuerpo. Mientras no se
  detecte o se indique, la numeración queda marcada como **provisional**.
- **No identifica un módulo completo** (una placa con varios chips). Mide un
  encapsulado.
- **No reconoce una pieza sin marcaje legible.** No hay de dónde.

## Cómo probarlo

*Componentes* → panel **«Identificar una pieza por su foto»**.

En `ejemplos/vision/` hay imágenes de prueba **sintéticas** con lo que debe
salir en cada una, verificado por `src/vision/examples.test.ts`. Sirven para
comprobar que la cadena funciona antes de pelearse con una foto real; no
demuestran que funcione con una foto real, que es más difícil.

Para una foto de verdad: cenital, la pieza sola sobre fondo claro y uniforme,
con las patas completas dentro del encuadre.

## Dos cosas que se arreglaron al probarlo

- **El umbral de Otsu dejaba fuera el cuerpo.** Otsu reparte la imagen en
  `[0..t]` y `[t+1..255]`, así que `t` pertenece a la clase oscura. Comparando
  con `<` en vez de `<=`, un cuerpo cuyo tono coincidía con el umbral producía
  una máscara **vacía**; que funcionase dependía de un redondeo en coma
  flotante.
- **Detectar que se ha fotografiado el fondo.** Estaba por porcentaje de
  ocupación, que es un umbral arbitrario: un primer plano legítimo llena tres
  cuartos del encuadre. Ahora por una propiedad real: el fondo **rodea** a la
  pieza, luego alcanza los cuatro bordes de la imagen, y una pieza que se ve
  entera no los alcanza todos.

## Archivos

| Archivo | Qué contiene |
|---|---|
| `src/vision/image-analysis.ts` | Umbral, máscara, región conexa, cuerpo y recuento de patas |
| `src/vision/marking.ts` | Separar el marcaje e identificar la pieza en el catálogo |
| `src/vision/component-draft.ts` | Juntar medida y marcaje; declarar contradicciones |
| `src/vision/load-image.ts` | Archivo → mapa de píxeles, reducido; dibujo del contorno |
| `src/vision/synthetic.ts` | Encapsulados de mentira, para poder probar contra una verdad conocida |
| `src/vision/PhotoIdentifier.tsx` | El panel |

**59 pruebas** en el módulo, de 455 del proyecto. Sin dependencias nuevas.
