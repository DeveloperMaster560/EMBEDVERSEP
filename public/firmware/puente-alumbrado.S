; Mando del alumbrado del Viaducto de la Novena — ATmega328P a 16 MHz
;
; Gobierna cuatro zonas de alumbrado desde una fotocelda y un pulsador de
; mando. Es el firmware que se ejecuta en el armario de control del puente.
;
;   PD2  entrada  pulsador de mando (resistencia de polarizacion interna,
;                 pulsar pone el pin a CERO)
;   PD4  salida   zona vial        (alumbrado de la calzada)
;   PD5  salida   zona tirantes
;   PD6  salida   zona torres
;   PD7  salida   zona barreras
;   PB5  salida   testigo: encendido si alguna zona esta energizada
;   ADC0 entrada  fotocelda; se considera oscuridad por debajo de 256 cuentas
;
; CUATRO MODOS, que el pulsador recorre en orden:
;   0  AUTOMATICO     las cuatro zonas siguen a la fotocelda
;   1  TODO ENCENDIDO las cuatro zonas encendidas, haya luz o no
;   2  SOLO VIAL      la calzada sigue a la fotocelda; lo ornamental, apagado
;   3  MANTENIMIENTO  todo apagado, incluida la calzada
;
; El modo 3 apaga tambien el alumbrado de la calzada. Eso en una via real es
; una decision de mantenimiento, no una comodidad: por eso esta separado del
; modo 2 y no se llega a el por descuido.
;
; Por el puerto serie, a 9600 bps, sale una linea cada vez que algo cambia:
;   M<modo> <vial><tirantes><torres><barreras>
; por ejemplo "M0 1111" o "M2 1000".
;
; ADVERTENCIA: el antirrebote y los tiempos se hacen con bucles de espera, no
; con temporizadores. Son APROXIMADOS. Este firmware tampoco mide lux: el
; umbral es un recuento del convertidor, no una medida fotometrica.
;
; Se ensambla con tools/make_demo_firmware.mjs

  ; ---- puertos ----
  ldi  r16, 0xF0
  out  0x0A, r16        ; DDRD: PD4..PD7 salidas, PD2 entrada
  ldi  r16, 0x04
  out  0x0B, r16        ; PORTD: polarizacion de PD2, salidas en bajo
  ldi  r16, 0x20
  out  0x04, r16        ; DDRB: PB5 salida

  ; ---- USART0 a 9600 bps con reloj de 16 MHz ----
  ldi  r16, 103
  sts  0x00C4, r16      ; UBRR0L = 16e6/(16*9600) - 1
  ldi  r16, 0
  sts  0x00C5, r16      ; UBRR0H
  ldi  r16, 0x08
  sts  0x00C1, r16      ; UCSR0B = TXEN0
  ldi  r16, 0x06
  sts  0x00C2, r16      ; UCSR0C = 8 bits, 1 de parada

  ; ---- convertidor analogico, canal 0 ----
  ldi  r16, 0x00
  sts  0x007C, r16      ; ADMUX = canal 0
  ldi  r16, 0x87
  sts  0x007A, r16      ; ADCSRA = habilitado, division por 128

  ; ---- estado ----
  ldi  r16, 0
  mov  r2, r16          ; modo = AUTOMATICO
  ldi  r16, 0x04
  mov  r3, r16          ; pulsador: suelto
  ldi  r16, 0
  mov  r4, r16          ; salidas
  ldi  r16, 0xFF
  mov  r5, r16          ; informe anterior imposible: fuerza el primero

bucle:
  ; ---- pulsador, por flanco de bajada ----
  in   r17, 0x09        ; PIND
  andi r17, 0x04        ; aislar PD2
  mov  r18, r3
  mov  r3, r17
  cpi  r17, 0
  brne sin_pulsacion    ; ahora esta suelto
  cpi  r18, 0
  breq sin_pulsacion    ; ya estaba pulsado: no es flanco
  inc  r2
  mov  r19, r2
  cpi  r19, 4
  brlo modo_valido
  ldi  r19, 0
  mov  r2, r19
modo_valido:
  rcall antirrebote
sin_pulsacion:

  ; ---- fotocelda ----
  lds  r20, 0x007A
  ori  r20, 0x40
  sts  0x007A, r20      ; arranca la conversion
espera_adc:
  lds  r20, 0x007A
  sbrc r20, 6
  rjmp espera_adc
  lds  r21, 0x0078      ; ADCL primero: leerlo bloquea la pareja
  lds  r22, 0x0079      ; ADCH
  ldi  r23, 0
  cpi  r22, 0
  brne hay_luz
  ldi  r23, 1           ; oscuridad: menos de 256 cuentas
hay_luz:

  ; ---- que zonas deben quedar encendidas ----
  ldi  r24, 0
  mov  r19, r2
  cpi  r19, 1
  breq todo_encendido
  cpi  r19, 3
  breq zonas_listas     ; mantenimiento: nada
  cpi  r19, 2
  breq solo_vial
  cpi  r23, 1           ; automatico
  brne zonas_listas
  ldi  r24, 0xF0
  rjmp zonas_listas
todo_encendido:
  ldi  r24, 0xF0
  rjmp zonas_listas
solo_vial:
  cpi  r23, 1
  brne zonas_listas
  ldi  r24, 0x10
zonas_listas:

  ; ---- aplicar ----
  mov  r25, r24
  ori  r25, 0x04        ; conservar la polarizacion de PD2
  out  0x0B, r25
  mov  r4, r24

  ldi  r25, 0
  cpi  r24, 0
  breq testigo_listo
  ldi  r25, 0x20
testigo_listo:
  out  0x05, r25        ; PORTB: testigo

  ; ---- informar solo si cambio ----
  mov  r19, r5
  cp   r19, r24
  breq bucle
  mov  r5, r24
  rcall informar
  rjmp bucle

; Envia por el serie: M<modo> <cuatro digitos> y fin de linea.
informar:
  ldi  r24, 77          ; 'M'
  rcall enviar
  mov  r26, r2
  ldi  r24, 48          ; '0'
  add  r24, r26
  rcall enviar
  ldi  r24, 32          ; espacio
  rcall enviar
  mov  r26, r4
  ldi  r24, 48
  sbrc r26, 4
  ldi  r24, 49
  rcall enviar
  ldi  r24, 48
  sbrc r26, 5
  ldi  r24, 49
  rcall enviar
  ldi  r24, 48
  sbrc r26, 6
  ldi  r24, 49
  rcall enviar
  ldi  r24, 48
  sbrc r26, 7
  ldi  r24, 49
  rcall enviar
  ldi  r24, 10          ; fin de linea
  rcall enviar
  ret

; Envia el caracter de r24 cuando el registro de transmision queda libre.
enviar:
  lds  r30, 0x00C0      ; UCSR0A
  sbrs r30, 5           ; UDRE0
  rjmp enviar
  sts  0x00C6, r24      ; UDR0
  ret

; Antirrebote por bucles anidados. Aproximadamente 45 ms a 16 MHz.
antirrebote:
  ldi  r20, 10
ar_a:
  ldi  r21, 200
ar_b:
  ldi  r22, 120
ar_c:
  dec  r22
  brne ar_c
  dec  r21
  brne ar_b
  dec  r20
  brne ar_a
  ret
