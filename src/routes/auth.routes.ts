import express from 'express';
import rateLimit from 'express-rate-limit';
import * as usuarios from '../services/usuarios.service';
import { crearSesion, destruirSesion, obtenerSesion } from '../middleware/sesion';

const router = express.Router();

/**
 * Protección contra fuerza bruta (#12).
 *
 * Dos límites que cuentan solo los intentos FALLIDOS (los logins correctos no
 * suman, por eso skipSuccessfulRequests):
 *  - por cuenta: 5 fallos cada 15 minutos, vengan de la IP que vengan.
 *  - por IP: 20 fallos cada 15 minutos, aunque prueben cuentas distintas.
 * Pasado el tope se responde 429 (Too Many Requests).
 */
const MENSAJE_BLOQUEO = {
  error: 'Demasiados intentos fallidos. Probá de nuevo en unos minutos.',
};

const limitePorIp = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: MENSAJE_BLOQUEO,
});

const limitePorCuenta = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => 'cuenta:' + String(req.body?.username ?? '').toLowerCase(),
  message: MENSAJE_BLOQUEO,
});

/**
 * Inicio de sesión.
 *
 * CORRECCIONES:
 *  - #12: límite de intentos fallidos por IP y por cuenta (429).
 *  - #17: la respuesta es idéntica (mismo código y mismo texto) para un
 *    usuario que no existe y para una clave equivocada, y no repite lo que
 *    escribió quien llama.
 */
router.post('/login', limitePorIp, limitePorCuenta, async (req, res, next) => {
  try {
    const { username, password } = req.body || {};

    if (!username || !password) {
      return res.status(400).json({ error: 'Falta usuario o contraseña.' });
    }

    const usuario = await usuarios.autenticar(username, password);

    if (!usuario) {
      // #17: mensaje único, sin pistas sobre qué cuentas existen.
      return res.status(401).json({ error: 'Usuario o contraseña incorrectos.' });
    }

    crearSesion(req, res, {
      id: usuario.id,
      username: usuario.username,
      rol: usuario.rol,
      nombre: usuario.nombre,
    });

    res.json({
      mensaje: `¡Bienvenido, ${usuario.nombre}!`,
      usuario: {
        id: usuario.id,
        username: usuario.username,
        rol: usuario.rol,
        nombre: usuario.nombre,
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * Cierre de sesión.
 *
 * CORRECCIÓN (#16): se borra la sesión del almacén del servidor (antes solo se
 * borraba la cookie del navegador) y además se limpia la cookie.
 */
router.post('/logout', (req, res) => {
  destruirSesion(req);
  res.clearCookie('sid', { path: '/' });
  res.json({ mensaje: 'Sesión cerrada.' });
});

/** Devuelve el usuario de la sesión actual. */
router.get('/yo', (req, res) => {
  const sesion = obtenerSesion(req);
  if (!sesion) {
    return res.status(401).json({ error: 'Necesitás iniciar sesión.' });
  }
  res.json({ usuario: sesion.usuario });
});

export default router;