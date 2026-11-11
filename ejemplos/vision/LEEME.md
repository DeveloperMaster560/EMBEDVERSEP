# Imágenes para probar la identificación desde foto

Son **sintéticas**, dibujadas a propósito para esta prueba. Sirven para
comprobar que la cadena funciona de punta a punta antes de pelearse con una
foto real; **no** demuestran que funcione con una foto real, que es bastante
más difícil (sombras, reflejos en el plástico, fondo con grano).

Arrástrelas al panel «Identificar una pieza por su foto», en *Componentes*.

| Archivo | Qué debe salir |
|---|---|
| `dip-8.png` | doble hilera, 8 patas · 4 arriba y 4 abajo · sin avisos |
| `dip-16.png` | doble hilera, 16 patas · 8 y 8 · sin avisos |
| `dip-16-girado.png` | lo mismo, contadas a izquierda y derecha |
| `dip-16-pata-perdida.png` | 7 arriba y 8 abajo, **y un aviso** de que el recuento no cuadra |
| `fondo-oscuro.png` | **un aviso** de que la mancha llega a los cuatro bordes: se ha tomado el fondo por la pieza |

Para probar el marcaje, escriba en el cuadro de texto una referencia que esté
en el catálogo. Pruebe también una que no esté, como `LM338T`: debe decir que
no la reconoce, **no** proponer la más parecida.

Con `dip-8.png` y un marcaje de una pieza de 16 patas verá lo más útil del
panel: la **contradicción** entre lo leído y lo medido, declarada en vez de
resuelta a la ligera.
