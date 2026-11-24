import path from 'path';

/**
 * Configuración de la aplicación.
 *
 * -----------------------------------------------------------------------------
 * FALLA 1 — Cifrado de datos y gestión de secretos (Ajustes de configuración)
 * -----------------------------------------------------------------------------
 * Las credenciales de la base de datos y el secreto de sesión están escritos
 * a mano en el código fuente. Cualquiera que clone el repositorio las conoce.
 *
 * Corrección: leer todo desde variables de entorno (ver .env.example) o desde
 * un gestor de secretos, y no versionar ningún secreto.
 * -----------------------------------------------------------------------------
 */
export default {
  port: Number(process.env.PORT || 3000),
  nodeEnv: process.env.NODE_ENV || 'development',

  db: {
    host: process.env.DB_HOST || 'db',
    port: Number(process.env.DB_PORT || 5432),
    database: process.env.DB_NAME || 'origen',
    // FALLA: la aplicación se conecta con el superusuario de la base de datos
    // (mínimos privilegios). Existe un usuario `origen_app` con permisos
    // reducidos para usar como corrección.
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
  },

  // FALLA: secreto fijo y predecible, escrito en el código.
  // Se necesita para firmar el token anti-CSRF (corrección del CSRF).
  sessionSecret: 'origen-cafe-2024',

  uploadsDir: process.env.UPLOADS_DIR || path.join(__dirname, '..', 'uploads'),
};
