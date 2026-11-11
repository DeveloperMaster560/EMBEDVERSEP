/**
 * Medir un encapsulado a partir de una fotografia.
 *
 * Lo que esto hace y lo que NO hace, porque la diferencia es todo:
 *
 *  - SE MIDE: el contorno del cuerpo, cuantas patas salen por cada lado y en
 *    que posicion. Son hechos geometricos de la imagen.
 *  - NO SE DEDUCE: que hace cada pata. Eso no esta en la silueta de un chip.
 *    Un DIP de 8 patas puede ser un NE555, un LM393 o una EEPROM, y sus
 *    patillajes no se parecen en nada. Inventarlo seria mentir.
 *
 * Por eso el resultado trae las patas CONTADAS y SITUADAS, con el nombre a
 * null. Ponerles nombre exige identificar la pieza por su marcaje, que es otro
 * problema y vive en `catalog-match`.
 *
 * Todo opera sobre un mapa de pixeles RGBA, sin canvas ni DOM, para poder
 * probarlo con imagenes sinteticas.
 */

export interface Bitmap {
  width: number;
  height: number;
  /** RGBA, 4 bytes por pixel, como `ImageData.data`. */
  data: Uint8ClampedArray;
}

export interface DetectedPin {
  /** Lado del cuerpo por el que sale. */
  side: 'left' | 'right' | 'top' | 'bottom';
  /** Posicion a lo largo de ese lado, de 0 a 1. */
  position: number;
  /** Ancho de la pata en pixeles. */
  widthPx: number;
}

export interface BodyBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface Analysis {
  /** null cuando no se distingue ningun cuerpo del fondo. */
  body: BodyBox | null;
  pins: DetectedPin[];
  /** Umbral de luminancia que separo cuerpo y fondo. */
  threshold: number;
  /** Fraccion de la imagen ocupada por el cuerpo. */
  coverage: number;
  /**
   * Por que el resultado puede no ser fiable. Vacio significa que la medida
   * se sostiene; con entradas, NO debe usarse sin que el usuario lo revise.
   */
  warnings: string[];
}

/** Luminancia perceptual, de 0 (negro) a 255 (blanco). */
export function luminance(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Histograma de luminancia de 256 cubetas. */
export function histogram(image: Bitmap): Uint32Array {
  const out = new Uint32Array(256);
  const { data } = image;
  for (let i = 0; i < data.length; i += 4) {
    out[Math.round(luminance(data[i], data[i + 1], data[i + 2]))] += 1;
  }
  return out;
}

/**
 * Umbral de Otsu: el valor que mejor separa la imagen en dos poblaciones.
 *
 * Se elige por ser automatico y determinista. Un umbral fijo fallaria con
 * cualquier cambio de iluminacion, y ajustarlo a mano por foto no es viable.
 */
export function otsuThreshold(image: Bitmap): number {
  const hist = histogram(image);
  const total = image.width * image.height;
  if (total === 0) return 128;
  let suma = 0;
  for (let i = 0; i < 256; i += 1) suma += i * hist[i];

  let sumaFondo = 0;
  let pesoFondo = 0;
  let mejorVarianza = -1;
  let mejorUmbral = 128;
  for (let t = 0; t < 256; t += 1) {
    pesoFondo += hist[t];
    if (pesoFondo === 0) continue;
    const pesoFrente = total - pesoFondo;
    if (pesoFrente === 0) break;
    sumaFondo += t * hist[t];
    const mediaFondo = sumaFondo / pesoFondo;
    const mediaFrente = (suma - sumaFondo) / pesoFrente;
    const varianza = pesoFondo * pesoFrente * (mediaFondo - mediaFrente) ** 2;
    if (varianza > mejorVarianza) {
      mejorVarianza = varianza;
      mejorUmbral = t;
    }
  }
  return mejorUmbral;
}

/**
 * Mascara de lo que es "pieza": los pixeles hasta el umbral, incluido.
 *
 * El umbral va INCLUIDO a proposito. Otsu reparte en [0..t] y [t+1..255], asi
 * que t pertenece a la clase oscura. Comparando con "<" en vez de "<=", un
 * cuerpo cuyo tono coincide justo con el umbral se quedaba fuera y la mascara
 * salia vacia; que funcionase dependia de un redondeo en coma flotante.
 *
 * Se asume pieza oscura sobre fondo claro, que es como se fotografia un
 * componente sobre una mesa o una hoja. Si la foto viene al reves, el cuerpo
 * detectado seria el fondo, y de eso avisa `analyze` por el tamano.
 */
export function darkMask(image: Bitmap, threshold: number): Uint8Array {
  const { width, height, data } = image;
  const mask = new Uint8Array(width * height);
  for (let i = 0, p = 0; i < data.length; i += 4, p += 1) {
    mask[p] = luminance(data[i], data[i + 1], data[i + 2]) <= threshold ? 1 : 0;
  }
  return mask;
}

/**
 * Mayor region conexa de la mascara, por vecindad de 4.
 *
 * Es el cuerpo del encapsulado: en una foto de un chip es, con diferencia, la
 * mancha oscura mas grande. Se recorre con una pila propia en vez de
 * recursion, porque una imagen de un megapixel desbordaria la pila.
 */
export function largestRegion(
  mask: Uint8Array, width: number, height: number,
): { pixels: number; box: BodyBox } | null {
  const visto = new Uint8Array(mask.length);
  const pila: number[] = [];
  let mejor: { pixels: number; box: BodyBox } | null = null;

  for (let inicio = 0; inicio < mask.length; inicio += 1) {
    if (mask[inicio] === 0 || visto[inicio] === 1) continue;
    pila.length = 0;
    pila.push(inicio);
    visto[inicio] = 1;
    let cuenta = 0;
    let x0 = width;
    let y0 = height;
    let x1 = -1;
    let y1 = -1;
    while (pila.length > 0) {
      const p = pila.pop() as number;
      const x = p % width;
      const y = (p - x) / width;
      cuenta += 1;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      if (x > 0 && mask[p - 1] === 1 && visto[p - 1] === 0) { visto[p - 1] = 1; pila.push(p - 1); }
      if (x < width - 1 && mask[p + 1] === 1 && visto[p + 1] === 0) { visto[p + 1] = 1; pila.push(p + 1); }
      if (y > 0 && mask[p - width] === 1 && visto[p - width] === 0) { visto[p - width] = 1; pila.push(p - width); }
      if (y < height - 1 && mask[p + width] === 1 && visto[p + width] === 0) {
        visto[p + width] = 1; pila.push(p + width);
      }
    }
    if (!mejor || cuenta > mejor.pixels) mejor = { pixels: cuenta, box: { x0, y0, x1, y1 } };
  }
  return mejor;
}

/**
 * Separa el CUERPO de las PATAS dentro de la region detectada.
 *
 * La region conexa mas grande incluye las dos cosas, porque las patas salen
 * del cuerpo. Para distinguirlos se cuenta cuantos pixeles de pieza hay en
 * cada fila y en cada columna: las filas del cuerpo estan casi llenas, las de
 * las patas solo tienen los dientes. El salto entre unas y otras es el borde.
 */
export function coreBody(
  mask: Uint8Array, width: number, outer: BodyBox,
): BodyBox {
  const filas = new Int32Array(outer.y1 - outer.y0 + 1);
  const columnas = new Int32Array(outer.x1 - outer.x0 + 1);
  for (let y = outer.y0; y <= outer.y1; y += 1) {
    for (let x = outer.x0; x <= outer.x1; x += 1) {
      if (mask[y * width + x] === 1) {
        filas[y - outer.y0] += 1;
        columnas[x - outer.x0] += 1;
      }
    }
  }
  // Se considera cuerpo lo que supera el 60 % del maximo. Las patas de un
  // encapsulado ocupan muy por debajo de eso: son dientes sueltos.
  const banda = (cuenta: Int32Array, origen: number): [number, number] => {
    let maximo = 0;
    for (const v of cuenta) if (v > maximo) maximo = v;
    const corte = maximo * 0.6;
    let inicio = 0;
    let fin = cuenta.length - 1;
    while (inicio < cuenta.length && cuenta[inicio] < corte) inicio += 1;
    while (fin >= 0 && cuenta[fin] < corte) fin -= 1;
    if (inicio > fin) return [origen, origen + cuenta.length - 1];
    return [origen + inicio, origen + fin];
  };
  const [y0, y1] = banda(filas, outer.y0);
  const [x0, x1] = banda(columnas, outer.x0);
  return { x0, y0, x1, y1 };
}

/** Tramos continuos de pieza en una linea, con su centro y su ancho. */
function runs(
  mask: Uint8Array, width: number,
  fixed: number, from: number, to: number, horizontal: boolean,
): { center: number; width: number }[] {
  const out: { center: number; width: number }[] = [];
  let inicio = -1;
  for (let i = from; i <= to + 1; i += 1) {
    const dentro = i <= to
      && mask[horizontal ? fixed * width + i : i * width + fixed] === 1;
    if (dentro && inicio === -1) inicio = i;
    if (!dentro && inicio !== -1) {
      out.push({ center: (inicio + i - 1) / 2, width: i - inicio });
      inicio = -1;
    }
  }
  return out;
}

/**
 * Patas que salen por un lado, leidas a media altura del saliente.
 *
 * Se mide a MEDIA altura y no justo en el borde: en el borde las patas aun
 * tocan el cuerpo y se leerian como un solo tramo, y en la punta la foto suele
 * perderlas por desenfoque o sombra.
 */
export function pinsOnSide(
  mask: Uint8Array, width: number,
  side: DetectedPin['side'], core: BodyBox, outer: BodyBox,
): DetectedPin[] {
  let linea: number;
  let desde: number;
  let hasta: number;
  let horizontal: boolean;
  if (side === 'top') {
    if (core.y0 - outer.y0 < 2) return [];
    linea = Math.round((outer.y0 + core.y0) / 2);
    [desde, hasta, horizontal] = [core.x0, core.x1, true];
  } else if (side === 'bottom') {
    if (outer.y1 - core.y1 < 2) return [];
    linea = Math.round((outer.y1 + core.y1) / 2);
    [desde, hasta, horizontal] = [core.x0, core.x1, true];
  } else if (side === 'left') {
    if (core.x0 - outer.x0 < 2) return [];
    linea = Math.round((outer.x0 + core.x0) / 2);
    [desde, hasta, horizontal] = [core.y0, core.y1, false];
  } else {
    if (outer.x1 - core.x1 < 2) return [];
    linea = Math.round((outer.x1 + core.x1) / 2);
    [desde, hasta, horizontal] = [core.y0, core.y1, false];
  }
  const largo = Math.max(1, hasta - desde);
  return runs(mask, width, linea, desde, hasta, horizontal).map((r) => ({
    side,
    position: Math.min(1, Math.max(0, (r.center - desde) / largo)),
    widthPx: r.width,
  }));
}

/** Mide el encapsulado de una fotografia. */
export function analyze(image: Bitmap): Analysis {
  const warnings: string[] = [];
  if (image.width < 16 || image.height < 16) {
    return {
      body: null, pins: [], threshold: 0, coverage: 0,
      warnings: ['La imagen es demasiado pequena para medir nada.'],
    };
  }
  const threshold = otsuThreshold(image);
  const mask = darkMask(image, threshold);
  const region = largestRegion(mask, image.width, image.height);
  const total = image.width * image.height;
  if (!region || region.pixels < total * 0.005) {
    return {
      body: null, pins: [], threshold, coverage: region ? region.pixels / total : 0,
      warnings: ['No se distingue ninguna pieza del fondo. Hace falta una foto '
        + 'cenital con la pieza sobre un fondo claro y uniforme.'],
    };
  }
  const coverage = region.pixels / total;
  // Un porcentaje de ocupacion seria un umbral arbitrario: un primer plano
  // legitimo puede llenar tres cuartos del encuadre. La senal fiable es otra:
  // el fondo RODEA a la pieza, luego alcanza los cuatro bordes de la imagen.
  // Una pieza que se ve entera, por definicion, no los alcanza todos.
  const tocaTodosLosBordes = region.box.x0 === 0 && region.box.y0 === 0
    && region.box.x1 === image.width - 1 && region.box.y1 === image.height - 1;
  if (tocaTodosLosBordes) {
    warnings.push('La mancha detectada llega a los cuatro bordes de la imagen. '
      + 'O se ha tomado el fondo por la pieza (use un fondo mas claro que el '
      + 'chip), o la pieza no cabe en el encuadre y se le han cortado las patas.');
  } else if (coverage > 0.8) {
    warnings.push('La mancha detectada ocupa casi toda la imagen: puede que se '
      + 'haya tomado el fondo por la pieza. Use un fondo mas claro que el chip.');
  }
  const core = coreBody(mask, image.width, region.box);
  const pins = (['top', 'bottom', 'left', 'right'] as const)
    .flatMap((side) => pinsOnSide(mask, image.width, side, core, region.box));

  if (pins.length === 0) {
    warnings.push('No se ha detectado ninguna pata. Puede ser un modulo con '
      + 'tira de pines sin soldar, o que el recorte deje las patas fuera.');
  }
  const porLado = (s: DetectedPin['side']) => pins.filter((p) => p.side === s).length;
  const arriba = porLado('top');
  const abajo = porLado('bottom');
  const izq = porLado('left');
  const der = porLado('right');
  // Un encapsulado de dos hileras tiene el mismo numero a cada lado. Si no
  // cuadra, lo mas probable es que una pata se haya perdido en la foto.
  if (arriba > 0 && abajo > 0 && arriba !== abajo) {
    warnings.push(`Se han contado ${arriba} patas arriba y ${abajo} abajo. En un `
      + 'encapsulado de dos hileras deberian ser iguales: revise el recuento.');
  }
  if (izq > 0 && der > 0 && izq !== der) {
    warnings.push(`Se han contado ${izq} patas a la izquierda y ${der} a la derecha. `
      + 'En un encapsulado de dos hileras deberian ser iguales: revise el recuento.');
  }
  return { body: core, pins, threshold, coverage, warnings };
}
