import path from 'path';
import express from 'express';
import helmet from 'helmet';

import config from './config';
import { rutaNoEncontrada, manejadorErrores } from './middleware/errores';
import authRoutes from './routes/auth.routes';
import productosRoutes from './routes/productos.routes';
import pedidosRoutes from './routes/pedidos.routes';
import reportesRoutes from './routes/reportes.routes';
import comentariosRoutes from './routes/comentarios.routes';
import adminRoutes from './routes/admin.routes';
import debugRoutes from './routes/debug.routes';

const app = express();

/**
 * Cabeceras de seguridad (#23) con helmet.
 *
 * Content-Security-Policy: el navegador sólo ejecuta scripts y carga estilos
 * que vengan del propio sitio ('self'). Un <script> inline, un onclick="" o
 * un script de otro dominio inyectado por XSS queda bloqueado aunque llegue
 * al DOM: es la segunda capa detrás del textContent (#5, #6, #7).
 *
 * helmet además agrega X-Content-Type-Options: nosniff, Referrer-Policy,
 * X-Frame-Options / frame-ancestors (anti-clickjacking), HSTS, etc.
 */
const enProduccion = config.nodeEnv === 'production';

app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        'default-src': ["'self'"],
        'script-src': ["'self'"],
        'script-src-attr': ["'none'"], // sin onclick="..." ni similares
        'style-src': ["'self'"],
        'img-src': ["'self'", 'data:'], // data: para el favicon SVG
        'font-src': ["'self'"],
        'connect-src': ["'self'"], // fetch sólo a la propia API
        'object-src': ["'none'"],
        'base-uri': ["'self'"],
        'form-action': ["'self'"],
        'frame-ancestors': ["'none'"],
        // Sólo en producción (con HTTPS): en localhost por HTTP rompería todo.
        ...(enProduccion ? { 'upgrade-insecure-requests': [] } : {}),
      },
    },
    // HSTS sólo tiene sentido servido por HTTPS.
    strictTransportSecurity: enProduccion,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  })
);

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
