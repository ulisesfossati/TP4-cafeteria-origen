/**
 * Manejo de errores.
 *
 * FALLA — Exposición de información sensible:
 * la respuesta al cliente incluye el mensaje de error original y el stack
 * trace completo, que revela rutas internas del servidor, nombres de tablas,
 * fragmentos de consultas SQL y versiones de librerías.
 *
 * Corrección: responder con un mensaje genérico ("Error interno") y registrar
 * el detalle real en el log del servidor.
 */

import type { NextFunction, Request, Response } from 'express';

import type { ErrorHttp } from '../tipos';

export function rutaNoEncontrada(req: Request, res: Response): void {
  res.status(404).json({ error: 'Ruta no encontrada.' });
}

// Express reconoce al manejador de errores por sus CUATRO parámetros: `next`
// tiene que estar aunque no se use.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function manejadorErrores(err: ErrorHttp, req: Request, res: Response, next: NextFunction): void {
  console.error('[error]', err.message, err.stack);

  const estado = err.status && err.status >= 400 && err.status < 500 ? err.status : 500;
  const mensaje = estado === 500 ? 'Error interno del servidor.' : err.message;

  res.status(estado).json({ error: mensaje });
}