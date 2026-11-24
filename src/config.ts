import crypto from 'crypto';
import path from 'path';

/**
 * Configuración de la aplicación.
 *
 * Los secretos (credenciales de la base y secreto de sesión) salen de
 * variables de entorno y nunca se escriben en el código: el repositorio no
 * conoce ninguno. En Docker los pone docker-compose.yml a partir del .env
 * (ver .env.example).
 */

/** Lee una variable de entorno obligatoria; sin ella la app no arranca. */
function requerida(nombre: string): string {
  const valor = process.env[nombre];
  if (!valor) {
    throw new Error(`Falta la variable de entorno ${nombre} (ver .env.example).`);
  }
  return valor;
}

export default {
  port: Number(process.env.PORT || 3000),
  nodeEnv: process.env.NODE_ENV || 'development',

  db: {
    host: process.env.DB_HOST || 'db',
    port: Number(process.env.DB_PORT || 5432),
    database: process.env.DB_NAME || 'origen',
    // Usuario de aplicación con permisos reducidos (origen_app), nunca el superusuario.
    user: requerida('DB_USER'),
    password: requerida('DB_PASSWORD'),
  },

  // Firma el token anti-CSRF. Si no se define, se genera uno al azar en cada
  // arranque (los tokens emitidos antes de reiniciar dejan de valer).
  sessionSecret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),

  uploadsDir: process.env.UPLOADS_DIR || path.join(__dirname, '..', 'uploads'),
};
