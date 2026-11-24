/**
 * Protección anti-CSRF (#8).
 *
 * Cómo funciona (patrón "double submit cookie" con token aleatorio):
 *
 *  1. El navegador pide GET /api/csrf-token. Si todavía no tiene token, el
 *     servidor genera uno con crypto.randomBytes (256 bits, imposible de
 *     adivinar), lo guarda en la cookie `csrf` (HttpOnly, SameSite=Strict) y
 *     lo devuelve en el JSON. Cada sesión del navegador tiene SU token: nunca
 *     hay un valor fijo.
 *  2. El sitio manda ese token en la cabecera `X-CSRF-Token` en cada
 *     POST/PUT/PATCH/DELETE (también se acepta el campo `_csrf`).
 *  3. Este middleware compara el token recibido con el de la cookie. Si falta
 *     o no coincide → 403.
 *
 * Por qué frena el CSRF: una página de otro sitio puede hacer que el navegador
 * mande la cookie, pero NO puede leer la respuesta de /api/csrf-token (la
 * política de mismo origen se lo impide), así que no sabe qué poner en la
 * cabecera. Además se rechaza cualquier petición cuyo `Origin` no sea el
 * propio sitio.
 *
 * Excepción: el login. Todavía no hay sesión que robar y la batería de
 * seguridad (fuerza bruta, enumeración) lo prueba sin token.
 */

import crypto from 'crypto';
import type { NextFunction, Request, Response } from 'express';

import config from '../config';
import { leerCookies } from './sesion';

const COOKIE_CSRF = 'csrf';
const FORMATO_TOKEN = /^[a-f0-9]{64}$/;
const METODOS_SEGUROS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Rutas (relativas a /api) que no exigen token. Lista blanca, no negra. */
const RUTAS_EXENTAS = new Set(['/auth/login']);

function generarToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

/** Comparación en tiempo constante (no filtra por cuánto tarda). */
function mismoToken(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

function tokenDeLaCookie(req: Request): string | null {
  const token = leerCookies(req)[COOKIE_CSRF];
  return token && FORMATO_TOKEN.test(token) ? token : null;
}

/** GET /api/csrf-token — entrega el token de esta sesión del navegador. */
export function entregarTokenCsrf(req: Request, res: Response): void {
  let token = tokenDeLaCookie(req);
  if (!token) {
    token = generarToken();
    res.cookie(COOKIE_CSRF, token, {
      httpOnly: true,
      sameSite: 'strict',
      // En HTTP local (docker / tests) una cookie Secure no se guardaría.
      secure: config.nodeEnv === 'production',
      path: '/',
    });
  }
  res.set('Cache-Control', 'no-store');
  res.json({ token });
}

/** Si el navegador manda Origin, tiene que ser el propio sitio. */
function origenPermitido(req: Request): boolean {
  const origen = req.get('origin');
  if (!origen) return true; // clientes que no mandan Origin (curl, tests)
  try {
    return new URL(origen).host === req.get('host');
  } catch {
    return false;
  }
}

/** Middleware: rechaza con 403 las peticiones que cambian estado sin token válido. */
export function verificarCsrf(req: Request, res: Response, next: NextFunction): void {
  if (METODOS_SEGUROS.has(req.method)) return next();
  if (RUTAS_EXENTAS.has(req.path)) return next();

  if (!origenPermitido(req)) {
    res.status(403).json({ error: 'Origen de la petición no permitido.' });
    return;
  }

  const esperado = tokenDeLaCookie(req);
  const cuerpo = req.body && typeof req.body === 'object' ? req.body : {};
  const recibido = req.get('x-csrf-token') || cuerpo._csrf || req.query._csrf;

  if (!esperado || typeof recibido !== 'string' || !mismoToken(esperado, recibido)) {
    res.status(403).json({ error: 'Token anti-CSRF ausente o inválido. Recargá la página.' });
    return;
  }

  // El token ya cumplió: que no llegue a los servicios como si fuera un dato.
  if ('_csrf' in cuerpo) delete cuerpo._csrf;
  next();
}
