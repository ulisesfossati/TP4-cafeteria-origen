import type { ErrorHttp } from './tipos';

/**
 * Validación de entrada en el servidor.
 *
 * Lo que llega en `req.body`, `req.query` o `req.params` lo controla el
 * cliente: el HTML (`required`, `maxlength`, `type="number"`) se saltea con
 * el devtools. Cada función comprueba tipo, longitud o rango y, si el valor
 * no cumple, lanza un error con status 400 que el manejador de errores
 * devuelve como `{ error: mensaje }`.
 *
 * Los mensajes nunca repiten el valor recibido (así no son un vector de XSS).
 */

export function errorDeValidacion(mensaje: string): ErrorHttp {
  return Object.assign(new Error(mensaje), { status: 400 });
}

/** Entero entre `min` y `max` (acepta "4" como 4, nunca "4.5", "abc" ni -1). */
export function entero(valor: unknown, campo: string, min: number, max: number): number {
  const numero = typeof valor === 'string' && /^-?\d+$/.test(valor) ? Number(valor) : valor;
  if (typeof numero !== 'number' || !Number.isInteger(numero) || numero < min || numero > max) {
    throw errorDeValidacion(`${campo} tiene que ser un número entero entre ${min} y ${max}.`);
  }
  return numero;
}

/** Texto de entre `min` y `max` caracteres, sin los espacios de los bordes. */
export function texto(valor: unknown, campo: string, min: number, max: number): string {
  const limpio = typeof valor === 'string' ? valor.trim() : '';
  if (limpio.length < min || limpio.length > max) {
    throw errorDeValidacion(`${campo} tiene que tener entre ${min} y ${max} caracteres.`);
  }
  return limpio;
}
