/**
 * Pasar un archivo de imagen a mapa de pixeles.
 *
 * Se reduce la foto antes de medirla. No es por rendimiento solamente: una
 * foto de movil trae doce millones de pixeles y, a ese detalle, el grano del
 * sensor y la textura del plastico del chip se leen como manchas sueltas. Al
 * reducir, esa textura se promedia y queda lo que interesa, que es la silueta.
 */

import type { Bitmap } from './image-analysis';

/** Lado maximo tras reducir. Por debajo de esto una pata fina se pierde. */
export const MAX_SIDE = 900;

/** Tamano al que se reduce, conservando la proporcion. Nunca amplia. */
export function scaleToFit(
  width: number, height: number, maxSide = MAX_SIDE,
): { width: number; height: number } {
  const mayor = Math.max(width, height);
  if (mayor <= maxSide || mayor === 0) return { width, height };
  const k = maxSide / mayor;
  return {
    width: Math.max(1, Math.round(width * k)),
    height: Math.max(1, Math.round(height * k)),
  };
}

export class ImageLoadError extends Error {}

/** Lee un archivo de imagen y devuelve su mapa de pixeles ya reducido. */
export async function loadBitmap(file: Blob, maxSide = MAX_SIDE): Promise<Bitmap> {
  if (typeof createImageBitmap !== 'function') {
    throw new ImageLoadError('Este navegador no permite leer imagenes por codigo.');
  }
  let origen: ImageBitmap;
  try {
    origen = await createImageBitmap(file);
  } catch {
    throw new ImageLoadError('El archivo no es una imagen que el navegador sepa abrir. '
      + 'Use JPEG, PNG o WebP.');
  }
  const { width, height } = scaleToFit(origen.width, origen.height, maxSide);
  const lienzo = document.createElement('canvas');
  lienzo.width = width;
  lienzo.height = height;
  const ctx = lienzo.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    origen.close();
    throw new ImageLoadError('No se ha podido preparar el lienzo para medir la imagen.');
  }
  ctx.drawImage(origen, 0, 0, width, height);
  origen.close();
  const datos = ctx.getImageData(0, 0, width, height);
  return { width, height, data: datos.data };
}

/** Dibuja la medida sobre la foto: contorno del cuerpo y patas detectadas. */
export function drawOverlay(
  canvas: HTMLCanvasElement, image: Bitmap,
  body: { x0: number; y0: number; x1: number; y1: number } | null,
  pins: { side: string; position: number }[],
): void {
  canvas.width = image.width;
  canvas.height = image.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  // Copia propia: ImageData exige un ArrayBuffer, y el mapa puede venir de un
  // buffer compartido.
  const pixeles = new ImageData(
    new Uint8ClampedArray(image.data), image.width, image.height);
  ctx.putImageData(pixeles, 0, 0);
  if (!body) return;

  ctx.strokeStyle = '#27d17f';
  ctx.lineWidth = Math.max(1.5, image.width / 400);
  ctx.strokeRect(body.x0, body.y0, body.x1 - body.x0, body.y1 - body.y0);

  ctx.fillStyle = '#ffb02e';
  const r = Math.max(2.5, image.width / 220);
  for (const pin of pins) {
    let x: number;
    let y: number;
    if (pin.side === 'top' || pin.side === 'bottom') {
      x = body.x0 + (body.x1 - body.x0) * pin.position;
      y = pin.side === 'top' ? body.y0 : body.y1;
    } else {
      y = body.y0 + (body.y1 - body.y0) * pin.position;
      x = pin.side === 'left' ? body.x0 : body.x1;
    }
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
}
