/* <util/atomic.h> de avr-libc: ATOMIC_BLOCK ejecuta su bloque sin
   interrupciones. En el simulador las interrupciones solo llegan entre
   eventos del reloj virtual, así que el bloque se ejecuta tal cual, una vez. */
#pragma once
#define ATOMIC_RESTORESTATE 0
#define ATOMIC_FORCEON 1
#define NONATOMIC_RESTORESTATE 0
#define NONATOMIC_FORCEOFF 1
#define ATOMIC_BLOCK(tipo) for (int _sim_atomico = 1; _sim_atomico; _sim_atomico = 0)
#define NONATOMIC_BLOCK(tipo) for (int _sim_atomico = 1; _sim_atomico; _sim_atomico = 0)
