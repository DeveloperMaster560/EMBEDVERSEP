/**
 * Geometría de los vehículos que circulan por el tablero.
 *
 * Antes eran cajas: un bus y una moto se distinguían solo por el tamaño. Aquí
 * se construye la silueta de cada clase con piezas elementales —cuerpo,
 * cabina, cristales, ruedas— y se fusiona en una sola malla por clase, para
 * que siga dibujándose con `InstancedMesh` y un único material.
 *
 * NO SE DESCARGA NADA. Se construye en código a propósito: sin archivos de
 * terceros que mantener, sin licencias ajenas que documentar, sin depender de
 * una conexión. El acabado no es el de un videojuego, pero un bus se
 * reconoce como bus.
 *
 * LA REGLA QUE NO SE PUEDE ROMPER: la caja envolvente de cada clase mide
 * EXACTAMENTE lo que esa clase declara en `vehicles.ts`. El modelo de
 * seguimiento IDM calcula los huecos entre vehículos con esas longitudes, así
 * que un modelo más largo de lo declarado mostraría coches solapados donde la
 * simulación dice que no los hay. Hay una prueba por clase que lo comprueba.
 *
 * El color va por vértice, no por material, porque todas las piezas de una
 * clase comparten una sola malla instanciada: así las ruedas pueden ser
 * oscuras y los cristales translúcidos sin multiplicar los materiales.
 */

import {
  BoxGeometry,
  BufferAttribute,
  Color,
  CylinderGeometry,
  type BufferGeometry,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

import type { VehicleClass } from './vehicles';

/** Negro del caucho. */
const RUEDA = '#15181c';
/** Cristal: azulado y oscuro, para que se lea como ventana a contraluz. */
const CRISTAL = '#2b3a4a';
/** Oscurecido del color de la clase, para cabinas y detalles. */
function oscurecer(color: string, factor: number): string {
  const c = new Color(color);
  c.multiplyScalar(factor);
  return `#${c.getHexString()}`;
}

/** Pinta una pieza entera de un color, vértice a vértice. */
function pintar(geometry: BufferGeometry, color: string): BufferGeometry {
  const c = new Color(color);
  const total = geometry.getAttribute('position').count;
  const colores = new Float32Array(total * 3);
  for (let i = 0; i < total; i += 1) {
    colores[i * 3] = c.r;
    colores[i * 3 + 1] = c.g;
    colores[i * 3 + 2] = c.b;
  }
  geometry.setAttribute('color', new BufferAttribute(colores, 3));
  return geometry;
}

/** Una caja situada por su centro. */
function caja(
  largo: number, alto: number, ancho: number,
  x: number, y: number, z: number,
  color: string,
): BufferGeometry {
  const g = new BoxGeometry(largo, alto, ancho);
  g.translate(x, y, z);
  return pintar(g, color);
}

/**
 * Una caja definida por las cotas que ocupa, no por su centro.
 *
 * Existe porque calcular el centro a mano se presta a error: la primera
 * version de estas siluetas tenia ocho piezas que sobresalian o no llegaban a
 * la medida declarada, y cada una era una suma mal hecha. Diciendo "de esta
 * cota a esta otra" el error desaparece.
 */
function cajaEntre(
  largo: number, ancho: number,
  yAbajo: number, yArriba: number,
  x: number, z: number,
  color: string,
): BufferGeometry {
  return caja(largo, yArriba - yAbajo, ancho, x, (yAbajo + yArriba) / 2, z, color);
}

/**
 * Una rueda. El eje del cilindro se gira para quedar en el eje transversal Z,
 * que es por donde va el ancho del vehículo.
 */
function rueda(radio: number, grosor: number, x: number, y: number, z: number): BufferGeometry {
  const g = new CylinderGeometry(radio, radio, grosor, 12);
  g.rotateX(Math.PI / 2);
  g.translate(x, y, z);
  return pintar(g, RUEDA);
}

/**
 * Construye la malla de una clase de vehículo.
 *
 * El resultado está centrado en el origen: X a lo largo, Y en vertical e
 * Y = -alto/2 es la rasante donde apoyan las ruedas, Z a lo ancho. Es el mismo
 * convenio que tenía la caja que sustituye, así que la colocación en el
 * tablero no cambia.
 */
export function createVehicleGeometry(vehicleClass: VehicleClass): BufferGeometry {
  const L = vehicleClass.lengthM;
  const A = vehicleClass.heightM;
  const W = vehicleClass.widthM;
  const suelo = -A / 2;
  const color = vehicleClass.color;
  const piezas: BufferGeometry[] = [];

  /** Eje de rueda pegado al extremo, sin sobresalir del largo declarado. */
  const ejeX = (radio: number, fraccion: number) =>
    Math.min(fraccion * L, L / 2 - radio);

  if (vehicleClass.id === 'motocicleta') {
    const radio = 0.30 * A;
    const grosorRueda = 0.22 * W;
    const x = ejeX(radio, 0.33);
    piezas.push(rueda(radio, grosorRueda, x, suelo + radio, 0));
    piezas.push(rueda(radio, grosorRueda, -x, suelo + radio, 0));
    // Chasis y motor, entre las dos ruedas.
    piezas.push(cajaEntre(L * 0.55, W * 0.42, suelo + A * 0.18, suelo + A * 0.42, 0, 0,
      oscurecer(color, 0.65)));
    // Deposito y carenado, que es lo que da el color.
    piezas.push(cajaEntre(L * 0.34, W * 0.52, suelo + A * 0.42, suelo + A * 0.64,
      -L * 0.02, 0, color));
    // Asiento.
    piezas.push(cajaEntre(L * 0.26, W * 0.45, suelo + A * 0.56, suelo + A * 0.64,
      -L * 0.24, 0, '#1b1e22'));
    // Conductor: el ancho total lo da el, que es lo que de verdad ocupa, y
    // tambien el alto, porque sobresale por encima de la moto.
    piezas.push(cajaEntre(L * 0.22, W, suelo + A * 0.60, suelo + A, -L * 0.10, 0,
      oscurecer(color, 0.45)));
    // Manillar.
    piezas.push(cajaEntre(L * 0.06, W * 0.92, suelo + A * 0.66, suelo + A * 0.74,
      x * 0.72, 0, '#1b1e22'));
  } else if (vehicleClass.id === 'bus') {
    const radio = 0.16 * A;
    const grosorRueda = 0.16 * W;
    // Carroceria: ocupa todo el largo, y llega justo al alto declarado.
    piezas.push(cajaEntre(L, W * 0.99, suelo + A * 0.20, suelo + A, 0, 0, color));
    // Franja de ventanas: es la pieza que marca el ancho total, para que se
    // lea de perfil sin sobresalir de la medida declarada.
    piezas.push(cajaEntre(L * 0.94, W, suelo + A * 0.55, suelo + A * 0.81,
      -L * 0.01, 0, CRISTAL));
    // Parabrisas, justo en el plano del morro.
    piezas.push(cajaEntre(L * 0.02, W * 0.88, suelo + A * 0.51, suelo + A * 0.81,
      L * 0.49, 0, CRISTAL));
    // Faldon inferior, mas oscuro.
    piezas.push(cajaEntre(L * 0.99, W * 0.985, suelo + A * 0.20, suelo + A * 0.32,
      0, 0, oscurecer(color, 0.6)));
    const delante = ejeX(radio, 0.36);
    const detras = ejeX(radio, 0.22);
    for (const z of [W * 0.40, -W * 0.40]) {
      piezas.push(rueda(radio, grosorRueda, delante, suelo + radio, z));
      piezas.push(rueda(radio, grosorRueda, -detras, suelo + radio, z));
      piezas.push(rueda(radio, grosorRueda, -detras - radio * 2.2, suelo + radio, z));
    }
  } else if (vehicleClass.id === 'camion') {
    const radio = 0.15 * A;
    const grosorRueda = 0.16 * W;
    // Cabina delante, mas baja que la caja de carga.
    piezas.push(cajaEntre(L * 0.26, W, suelo + A * 0.22, suelo + A * 0.74,
      L * 0.37, 0, color));
    piezas.push(cajaEntre(L * 0.03, W * 0.88, suelo + A * 0.50, suelo + A * 0.72,
      L * 0.485, 0, CRISTAL));
    // Caja de carga detras: es la que marca el alto declarado.
    piezas.push(cajaEntre(L * 0.68, W, suelo + A * 0.26, suelo + A, -L * 0.16, 0,
      oscurecer(color, 0.78)));
    // Chasis entre ejes.
    piezas.push(cajaEntre(L * 0.96, W * 0.72, suelo + A * 0.15, suelo + A * 0.25,
      0, 0, '#2a2e33'));
    const delante = ejeX(radio, 0.37);
    const detras = ejeX(radio, 0.22);
    for (const z of [W * 0.40, -W * 0.40]) {
      piezas.push(rueda(radio, grosorRueda, delante, suelo + radio, z));
      piezas.push(rueda(radio, grosorRueda, -detras, suelo + radio, z));
      piezas.push(rueda(radio, grosorRueda, -detras - radio * 2.3, suelo + radio, z));
    }
  } else {
    // Automovil: carroceria baja, habitaculo encima y cuatro ruedas.
    const radio = 0.22 * A;
    const grosorRueda = 0.14 * W;
    piezas.push(cajaEntre(L, W, suelo + A * 0.26, suelo + A * 0.60, 0, 0, color));
    // Habitaculo, retranqueado y algo mas estrecho. Llega al alto declarado.
    piezas.push(cajaEntre(L * 0.50, W * 0.90, suelo + A * 0.60, suelo + A,
      -L * 0.04, 0, color));
    // Cristales: una banda que recorre el habitaculo.
    piezas.push(cajaEntre(L * 0.46, W * 0.915, suelo + A * 0.63, suelo + A * 0.88,
      -L * 0.04, 0, CRISTAL));
    // Morro y zaga, un punto mas oscuros.
    piezas.push(cajaEntre(L * 0.99, W * 0.99, suelo + A * 0.26, suelo + A * 0.36,
      0, 0, oscurecer(color, 0.62)));
    const delante = ejeX(radio, 0.32);
    const detras = ejeX(radio, 0.30);
    for (const z of [W * 0.43, -W * 0.43]) {
      piezas.push(rueda(radio, grosorRueda, delante, suelo + radio, z));
      piezas.push(rueda(radio, grosorRueda, -detras, suelo + radio, z));
    }
  }

  const malla = mergeGeometries(piezas, false);
  for (const pieza of piezas) pieza.dispose();
  if (!malla) {
    throw new Error(`No se pudo construir la geometría de ${vehicleClass.id}.`);
  }
  malla.computeBoundingBox();
  return malla;
}
