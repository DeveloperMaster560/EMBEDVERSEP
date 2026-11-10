# Sistema embebido del puente, y el tráfico

Qué se entregó el 10 de noviembre de 2026: el armario de control del alumbrado
del Viaducto de la Novena, con firmware que se ejecuta de verdad, mando manual
por parte del operador, y circulación de vehículos sobre el tablero.

## 1. El sistema embebido

### El circuito

`src/domain/bridgeLightingCircuit.ts` construye el prototipo de banco del
armario: Arduino Uno, fotocelda LM393, pulsador de mando y un indicador por
cada zona de alumbrado.

| Pin | Qué lleva |
|---|---|
| A0 | salida analógica de la fotocelda |
| D2 | pulsador de mando (polarización interna; pulsar pone el pin a cero) |
| D4 | zona vial (calzada) |
| D5 | zona tirantes |
| D6 | zona torres |
| D7 | zona barreras |
| D13 | testigo: encendido si alguna zona está energizada |

Los cuatro indicadores representan **el estado de la salida** de cada zona, no
las luminarias. En el puente cada zona la gobierna un driver y un contactor.

Para poder cablear esto hubo que **ampliar la cabecera de la placa** en el
editor: antes solo exponía cuatro señales (D2, D13, A4, A5) y un mando de cuatro
zonas con fotocelda y pulsador necesita seis. Ahora expone A0, A1, A4, A5 y
D2–D9 más D13. Los identificadores antiguos no cambiaron, así que los circuitos
guardados siguen resolviéndose.

### El firmware

`public/firmware/puente-alumbrado.S`, ensamblado a `.hex` con
`tools/make_demo_firmware.mjs`. 282 bytes de programa.

Cuatro modos, que el pulsador recorre en orden:

| Modo | Nombre | Comportamiento |
|---|---|---|
| 0 | Automático | las cuatro zonas siguen a la fotocelda |
| 1 | Todo encendido | las cuatro encendidas, haya luz o no |
| 2 | Solo vial | la calzada sigue a la fotocelda; lo ornamental, apagado |
| 3 | Mantenimiento | todo apagado, incluida la calzada |

El modo 3 apaga también el alumbrado de la calzada. En una vía real eso es una
decisión de mantenimiento, no una comodidad: por eso está separado del modo 2 y
no se llega a él por descuido.

Por el puerto serie, a 9600 bps, sale una línea cada vez que algo cambia:
`M<modo> <vial><tirantes><torres><barreras>`, por ejemplo `M0 1111` o `M2 1000`.
Solo informa de los cambios, para no inundar el puerto.

**Advertencias del firmware, que están en su propia cabecera:** el antirrebote
y los tiempos se hacen con bucles de espera, no con temporizadores, así que son
aproximados; y no mide lux, el umbral es un recuento del convertidor, no una
medida fotométrica.

### Cómo se usa

En el estudio del puente, panel **«El puente en marcha»** → *Poner en marcha*.
Luego:

- **Mantener el pulsador del armario** avanza un modo por pulsación.
- El deslizador **«luz que ve la fotocelda»** simula el anochecer y el amanecer.
- Las luminarias del modelo 3D se encienden porque el microcontrolador puso un
  pin alto, no porque una regla lo dedujera.

Mientras la simulación está en marcha, el panel anterior de mando por reglas se
oculta: no se mezclan, porque serían dos verdades distintas sobre la misma
luminaria. `lighting-state.ts` sigue existiendo y sigue siendo útil —evalúa la
lógica declarada y la posición del sol—, pero **no ejecuta nada**.

## 2. El tráfico

`src/traffic/`. Movimiento longitudinal de vehículos en carriles
independientes, con el modelo de seguimiento **IDM**.

**Referencia:** Treiber, Hennecke y Helbing, «Congested traffic states in
empirical observations and microscopic simulations», Physical Review E 62, 1805
(2000). Es un modelo publicado y contrastado, no una invención de este proyecto.

Cuatro clases: automóvil, motocicleta, bus padrón de 12 m y camión de dos ejes.
El reparto por omisión carga de motocicletas (34 %) porque es lo característico
del área metropolitana de Bucaramanga.

### Esto no es un estudio de tráfico

Y conviene no confundirlo:

- Las dimensiones y los parámetros de conducción son **valores de diseño
  habituales**, no mediciones de este puente. Nadie ha contado vehículos en el
  Viaducto de la Novena para este modelo. Cada cifra lleva su procedencia
  anotada en `vehicles.ts`.
- El reparto por tipo es una **hipótesis declarada**, no un aforo. Un reparto
  real exige contar en el sitio, y cambia por hora y por sentido.
- **No hay cambio de carril**, ni adelantamiento, ni circulación entre carriles
  —que en Bucaramanga es lo habitual en motocicletas—, ni semáforos, ni
  intersecciones, ni peatones, ni accidentes.
- **No hay cargas de tráfico sobre la estructura.** Los vehículos no pesan sobre
  el tablero. Para capacidad o cargas de diseño hacen falta aforos reales y la
  norma que corresponda (en Colombia, el CCP-14).
- El alumbrado y el tráfico **no están acoplados**: son dos cosas que ocurren a
  la vez sobre el mismo puente, no un modelo acoplado.

### Dónde se colocan los vehículos

`src/model-viewer/traffic-placement.ts`. Esto tuvo un error que vale la pena
dejar escrito:

Se supuso que el modelo venía con **Y hacia arriba**, que es lo que dice la
especificación de glTF. El generador exporta con trimesh y los modelos salen con
**Z hacia arriba**, sin ninguna rotación en la raíz. Con esa suposición, la
carpeta de rodadura del viaducto medía **7 cm de ancho** —era su espesor— y los
vehículos habrían salido tumbados.

La solución no fue cambiar una suposición por otra, sino **deducir los tres ejes
de la geometría**: el vertical es el de menor extensión (una carpeta es una losa
delgada), el longitudinal el de mayor, y el transversal el que queda. Eso vale
con cualquier convenio de exportación, y si la proporción no es de losa, no se
coloca nada: dejar vehículos flotando sería peor que no dibujarlos.

La caja real del viaducto, leída del GLB, está en las pruebas tal cual:
`x: 0…550`, `y: −3.8…3.8`, `z: 7.0…7.07`.

## 3. Verificación

**64 pruebas nuevas**, dentro de las 323 del proyecto: 12 del firmware del
armario contra su circuito, 11 del firmware gobernando las luminarias del
modelo, 25 del tráfico y 16 de la colocación de los vehículos.

| Afirmación | Cómo se comprueba |
|---|---|
| El firmware enciende las zonas al oscurecer | se baja la fotocelda al 5 % y las cuatro salidas se activan |
| El operador manda de verdad | una pulsación fuerza todo encendido **aunque sea de día** |
| Los modos van en el orden documentado | dos pulsaciones dejan solo la calzada; tres, todo apagado; cuatro, vuelta a automático |
| Mantener pulsado no recorre los modos | medio segundo sin soltar y el modo no cambia: cuenta el flanco, no el nivel |
| Se encienden luminarias concretas del puente | se comprueban los identificadores: `LUM-001`, `PROY-001`, `FOCO-001`, `BAN-001` |
| Las potencias son las del modelo | 3480 + 4800 + 4960 + 1296 = **14 536 W**, las que devuelve el generador |
| El IDM es el del artículo | en el hueco de equilibrio la aceleración es exactamente cero, contra la solución analítica |
| Los vehículos no se solapan | 2200 veh/h en 250 m durante dos minutos, comprobando el hueco en cada paso |
| La circulación es reproducible | misma semilla, mismas posiciones con seis decimales |
| Los vehículos se apoyan en la calzada | con la caja real del viaducto, un bus de 3,2 m queda centrado en z = 8,67 m |

### Verificado contra el modelo real

Se generó el viaducto por el endpoint real (`POST /api/bridge/generate`,
HTTP 200, 11 s, 635 componentes, 0 errores de consistencia, 0 colisiones
accionables) y se comprobó en la respuesta:

- la carpeta de rodadura existe (`TAB-CAR`) y el GLB la nombra
  `deck__TAB__TAB-CAR`, que es el patrón que el visor interpreta;
- el mando declara **las cuatro zonas** que gobierna el firmware, con 163
  luminarias en total y potencia declarada en todas.

Dos cosas que salieron de esa comprobación y conviene saber:

1. El campo del tipo de puente se llama **`bridge_type`**, no `type`. Una
   petición con `type` se ignora en silencio y sale un puente de vigas: sin
   tirantes ni torres, y entonces el mando solo declara dos zonas. El firmware
   lo soporta —las zonas que el modelo no tiene aportan cero y quedan
   declaradas—, pero el modelo no es el que se pidió.
2. La carpeta de rodadura mide **7,6 m de ancho**, no los 18 m del tablero. Con
   carriles de 3,5 m solo cabe **un carril por sentido**, y el panel lo dice en
   vez de sacar vehículos fuera de la calzada.

### Lo que sigue sin verificarse

Para compilar en macOS o Linux: `./scripts/setup-arduino.sh`.

**No hay comprobación visual en navegador.** Las 323 pruebas se ejecutan sin
navegador. En este equipo la extensión de Chrome no consigue abrir el servidor
de desarrollo —devuelve página de error con `localhost`, con `127.0.0.1` y con
`[::1]`, aunque el servidor responde HTTP 200 a `curl`—, así que **nadie ha
visto todavía los coches moverse ni las luces encenderse en pantalla**. La
colocación está comprobada contra la geometría real del GLB, que es lo más
cerca que se puede llegar sin abrir la página.
