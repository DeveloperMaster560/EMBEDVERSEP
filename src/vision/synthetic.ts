/**
 * Encapsulados de mentira, para poder probar la medida contra una verdad
 * conocida.
 *
 * No es codigo de adorno: sin esto solo podria comprobar el analisis con fotos
 * reales, donde no se sabe cual es la respuesta correcta y no hay nada que
 * afirmar en una prueba. Aqui SE SABE que un DIP-8 tiene 4 patas por lado,
 * asi que si el contador se equivoca, la prueba falla.
 *
 * Vive fuera del archivo de pruebas porque tambien sirve de banco de ensayo
 * para la interfaz.
 */

import type { Bitmap } from './image-analysis';

export function blankImage(width: number, height: number, gray = 235): Bitmap {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = gray;
    data[i + 1] = gray;
    data[i + 2] = gray;
    data[i + 3] = 255;
  }
  return { width, height, data };
}

export function fillRect(
  image: Bitmap, x0: number, y0: number, x1: number, y1: number, gray: number,
): void {
  for (let y = Math.max(0, y0); y <= Math.min(image.height - 1, y1); y += 1) {
    for (let x = Math.max(0, x0); x <= Math.min(image.width - 1, x1); x += 1) {
      const p = (y * image.width + x) * 4;
      image.data[p] = gray;
      image.data[p + 1] = gray;
      image.data[p + 2] = gray;
      image.data[p + 3] = 255;
    }
  }
}

export interface DipOptions {
  /** Patas por hilera. Un DIP-8 lleva 4 por hilera. */
  pinsPerRow: number;
  /** 'horizontal' deja las hileras arriba y abajo; 'vertical', a los lados. */
  orientation?: 'horizontal' | 'vertical';
  width?: number;
  height?: number;
  bodyGray?: number;
  backgroundGray?: number;
  /**
   * Suprime esta pata (indice desde 0) SOLO en la primera hilera, para
   * simular una que la foto perdio por sombra o desenfoque. Solo en una
   * hilera: si faltase en las dos, el recuento seguiria siendo simetrico y no
   * habria nada que detectar.
   */
  omitPin?: number | null;
}

/** Dibuja un encapsulado de doble hilera visto desde arriba. */
export function dipImage(options: DipOptions): Bitmap {
  const {
    pinsPerRow, orientation = 'horizontal',
    width = 240, height = 160, bodyGray = 40, backgroundGray = 235,
    omitPin = null,
  } = options;
  const image = blankImage(width, height, backgroundGray);

  // El cuerpo ocupa la franja central; las patas sobresalen 10 px.
  const salida = 10;
  const margen = 24;
  if (orientation === 'horizontal') {
    const bx0 = margen;
    const bx1 = width - margen;
    const by0 = Math.round(height / 2 - 26);
    const by1 = Math.round(height / 2 + 26);
    fillRect(image, bx0, by0, bx1, by1, bodyGray);
    const paso = (bx1 - bx0) / pinsPerRow;
    for (let i = 0; i < pinsPerRow; i += 1) {
      const cx = Math.round(bx0 + paso * (i + 0.5));
      const anchoPata = Math.max(2, Math.round(paso * 0.4));
      const x0 = cx - Math.floor(anchoPata / 2);
      const x1 = x0 + anchoPata - 1;
      if (i !== omitPin) fillRect(image, x0, by0 - salida, x1, by0 - 1, bodyGray);
      fillRect(image, x0, by1 + 1, x1, by1 + salida, bodyGray);
    }
  } else {
    const by0 = margen;
    const by1 = height - margen;
    const bx0 = Math.round(width / 2 - 26);
    const bx1 = Math.round(width / 2 + 26);
    fillRect(image, bx0, by0, bx1, by1, bodyGray);
    const paso = (by1 - by0) / pinsPerRow;
    for (let i = 0; i < pinsPerRow; i += 1) {
      const cy = Math.round(by0 + paso * (i + 0.5));
      const anchoPata = Math.max(2, Math.round(paso * 0.4));
      const y0 = cy - Math.floor(anchoPata / 2);
      const y1 = y0 + anchoPata - 1;
      if (i !== omitPin) fillRect(image, bx0 - salida, y0, bx0 - 1, y1, bodyGray);
      fillRect(image, bx1 + 1, y0, bx1 + salida, y1, bodyGray);
    }
  }
  return image;
}
