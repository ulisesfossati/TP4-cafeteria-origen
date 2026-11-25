/**
 * Gestión de sesiones.
 *
 * -----------------------------------------------------------------------------
 * CORRECCIONES (#13, #14, #15)
 * -----------------------------------------------------------------------------
 * #14 El identificador de sesión es aleatorio (256 bits, crypto.randomBytes):
 *     no se puede adivinar ni recorrer.
 * #15 Las sesiones expiran: por inactividad (30 min, se renueva con el uso) y
 *     de forma absoluta (8 h desde el login). Al vencer se borran del servidor
 *     y la petición recibe 401.
 * #13 La cookie se emite con httpOnly, sameSite 'lax', maxAge y secure. La
 *     bandera Secure se activa en producción (HTTPS); en desarrollo la demo
 *     local corre sobre HTTP y una cookie Secure no se guardaría.
 * Además, al iniciar sesión se descarta cualquier sesión anterior de esa
 * cookie (evita la fijación de sesión).
 * El logout borra la sesión del servidor con destruirSesion (ver auth.routes).
 * -----------------------------------------------------------------------------
 */

import { randomBytes } from 'node:crypto';
import type { Request, Response } from 'express';

import config from '../config';
import type { Sesion, UsuarioSesion } from '../tipos';

export const sesiones = new Map<string, Sesion>();

const INACTIVIDAD_MAX_MS = 30 * 60 * 1000; // 30 min sin usar la sesión
const DURACION_MAX_MS = 8 * 60 * 60 * 1000; // 8 h desde el login

/** Opciones de la cookie de sesión. */
export const OPCIONES_COOKIE = {
  path: '/',
  httpOnly: true,
  secure: config.nodeEnv === 'production',
  sameSite: 'lax' as const,
};

/** Lee las cookies de la petición (parser mínimo, sin dependencias). */
export function leerCookies(req: Request): Record<string, string> {
  const cookies: Record<string, string> = {};
  const header = req.headers.cookie;
  if (!header) return cookies;
  for (const parte of header.split(';')) {
    const separador = parte.indexOf('=');
    if (separador < 0) continue;
    const nombre = parte.slice(0, separador).trim();
    const valor = parte.slice(separador + 1).trim();
    if (nombre) cookies[nombre] = decodeURIComponent(valor);
  }
  return cookies;
}

/** Crea una sesión nueva para el usuario y setea la cookie. */
export function crearSesion(req: Request, res: Response, usuario: UsuarioSesion): string {
  // Si esta cookie ya tenía una sesión, se descarta (anti fijación de sesión).
  destruirSesion(req);

  // #14: identificador aleatorio e impredecible.
  const id = randomBytes(32).toString('hex');
  const ahora = Date.now();

  // #15: la sesión tiene vencimiento.
  sesiones.set(id, {
    usuario,
    creadaEn: ahora,
    expiraEn: ahora + INACTIVIDAD_MAX_MS,
  });

  // #13: cookie con httpOnly, secure (en producción), sameSite y duración.
  res.cookie('sid', id, { ...OPCIONES_COOKIE, maxAge: INACTIVIDAD_MAX_MS });

  return id;
}

/** Devuelve la sesión de la petición, si existe y no venció. */
export function obtenerSesion(req: Request): Sesion | null {
  const id = leerCookies(req).sid;
  if (!id) return null;

  const sesion = sesiones.get(id);
  if (!sesion) return null;

  // #15: vencimiento por inactividad y absoluto.
  const ahora = Date.now();
  const porInactividad = sesion.expiraEn !== null && ahora > sesion.expiraEn;
  const porDuracionMaxima = ahora - sesion.creadaEn > DURACION_MAX_MS;

  if (porInactividad || porDuracionMaxima) {
    sesiones.delete(id); // se borra del servidor, no solo se ignora
    return null;
  }

  // Se renueva con el uso: la inactividad se cuenta desde el último pedido.
  sesion.expiraEn = ahora + INACTIVIDAD_MAX_MS;
  return sesion;
}

/** Cierra la sesión en el servidor (se llama en el logout). */
export function destruirSesion(req: Request): void {
  const id = leerCookies(req).sid;
  if (id) sesiones.delete(id);
}