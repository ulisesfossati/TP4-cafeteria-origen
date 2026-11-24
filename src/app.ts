import path from 'path';
import express from 'express';

import config from './config';
import { rutaNoEncontrada, manejadorErrores } from './middleware/errores';
import { entregarTokenCsrf, verificarCsrf } from './middleware/csrf';
import authRoutes from './routes/auth.routes';
import productosRoutes from './routes/productos.routes';
import pedidosRoutes from './routes/pedidos.routes';
import reportesRoutes from './routes/reportes.routes';
import comentariosRoutes from './routes/comentarios.routes';
import adminRoutes from './routes/admin.routes';
import debugRoutes from './routes/debug.routes';

const app = express();

/**
 * FALLA — Ajustes de configuración (OWASP A05:2021)
 *
 * Faltan:
 *  - helmet (cabeceras de seguridad: CSP, X-Content-Type-Options, HSTS...)
 *  - límite de tamaño del cuerpo más estricto por ruta
 *  - rate limiting global
 *  - política de CORS restringida al propio origen
 *  - helmet CSP además sirve como capa extra frente al XSS
 */
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// Archivos subidos por el panel de administración.
app.use('/uploads', express.static(config.uploadsDir));

// Sitio web estático
app.use(express.static(path.join(__dirname, 'public')));

// --- API --------------------------------------------------------------------
app.get('/api/salud', (req, res) => {
  res.json({ ok: true, servicio: 'cafeteria-origen', hora: new Date().toISOString() });
});

// Anti-CSRF (#8): token aleatorio por sesión del navegador. Todo POST, PUT,
// PATCH y DELETE de la API tiene que traerlo en X-CSRF-Token (o _csrf);
// si falta o no coincide, 403. Ver middleware/csrf.ts.
app.get('/api/csrf-token', entregarTokenCsrf);
app.use('/api', verificarCsrf);

app.use('/api/auth', authRoutes);
app.use('/api/productos', productosRoutes);
app.use('/api/pedidos', pedidosRoutes);
app.use('/api/reportes', reportesRoutes);
app.use('/api/comentarios', comentariosRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/_diagnostico', debugRoutes);

app.use('/api', rutaNoEncontrada);

app.use(manejadorErrores);

export default app;
