; Demostración de alumbrado conmutado — ATmega328P a 16 MHz
;
; Enciende y apaga el LED de D13 (PB5) y avisa por el puerto serie a 9600 bps.
; Es el firmware que acompaña al circuito de ejemplo del laboratorio, para
; poder simular sin tener Arduino CLI instalado.
;
; ADVERTENCIA SOBRE EL RETARDO: el tiempo se mide con bucles de espera, no con
; un temporizador. El periodo es APROXIMADO (unos 0,5 s por semiciclo) y
; depende del recuento de ciclos de cada instrucción. Para un reloj exacto hay
; que usar Timer1, no esto.
;
; Se ensambla con tools/make_demo_firmware.mjs

  ldi  r16, 0x20
  out  0x04, r16        ; DDRB = PB5 como salida

  ; USART0 a 9600 bps con reloj de 16 MHz: UBRR = 16e6/(16*9600) - 1 = 103
  ldi  r17, 103
  sts  0x00C4, r17      ; UBRR0L
  ldi  r17, 0
  sts  0x00C5, r17      ; UBRR0H
  ldi  r17, 0x08
  sts  0x00C1, r17      ; UCSR0B = TXEN0
  ldi  r17, 0x06
  sts  0x00C2, r17      ; UCSR0C = 8 bits, 1 de parada

ciclo:
  out  0x05, r16        ; PORTB alto: LED encendido
  ldi  r24, 49         ; '1' en ASCII; el ensamblador no acepta literales de carácter
  rcall enviar
  rcall salto
  rcall esperar

  ldi  r18, 0x00
  out  0x05, r18        ; PORTB bajo: LED apagado
  ldi  r24, 48         ; '0'
  rcall enviar
  rcall salto
  rcall esperar
  rjmp ciclo

; Envía el carácter de r24 cuando el registro de transmisión queda libre.
enviar:
  lds  r25, 0x00C0      ; UCSR0A
  sbrs r25, 5           ; UDRE0: ¿hay sitio en el buffer?
  rjmp enviar
  sts  0x00C6, r24      ; UDR0
  ret

salto:
  ldi  r24, 10          ; fin de línea
  rjmp enviar

; Retardo por bucles anidados. Aproximadamente 0,5 s a 16 MHz.
esperar:
  ldi  r20, 66
  retardo_a:
  ldi  r21, 200
  retardo_b:
  ldi  r22, 200
  retardo_c:
  dec  r22
  brne retardo_c
  dec  r21
  brne retardo_b
  dec  r20
  brne retardo_a
  ret
