## #10 Subida de archivos sin restricciones
**Qué es y por qué importa:** Permitir subir archivos arbitrarios con nombres controlados por el usuario habilita ataques de XSS almacenado (subiendo archivos `.html` o `.svg` ejecutables en el mismo origen) y (`../` para escribir fuera de la carpeta de destino).
**Dónde está:** `src/routes/admin.routes.ts`, (`POST /api/admin/subir-archivo`).
**Cómo se observa:** Subiendo un archivo `prueba.html` con contenido `<script>alert(1)</script>` desde el panel y abriendo `/uploads/prueba.html`, el navegador ejecuta el código JavaScript bajo el dominio de la aplicación.
**Por qué ocurre:** El endpoint decodificaba el Base64 y escribía el archivo directamente usando `path.join(config.uploadsDir, nombre)` sin verificar extensión, firma real de bytes, tamaño máximo ni sanear rutas relativas.
**Cómo se corrige:** Se implementó una lista blanca de extensiones de imagen (`.png`, `.jpg`, `.jpeg`, `.webp`), validación de cabecera binaria (*magic numbers*), límite de tamaño de 2 MB y generación de nombres aleatorios mediante `crypto.randomUUID()`.
**Cómo se verifica:** Pasó el test *"no se aceptan archivos ejecutables ni se escribe fuera de uploads"* en `npm run test:seguridad` y los controles `VAL-04` y `VAL-05` en `npm run check:security`.
**Reflexión:** Nunca se debe confiar en el nombre ni en la extensión declarada por el cliente al subir archivos; siempre se debe validar la firma binaria real, limitar el peso y renombrar el recurso en el servidor.

## #18 Autorización ausente: cualquiera entra al panel
**Qué es y por qué importa:** Es una falla de control de acceso. Aunque la interfaz oculte opciones, si el servidor no verifica los permisos en cada endpoint, cualquier usuario autenticado puede ejecutar acciones administrativas críticas.
**Dónde está:** `src/routes/admin.routes.ts`.
**Cómo se observa:** Iniciando sesión con el usuario `cliente` y navegando manualmente a `http://localhost:8080/admin.html` (o consultando `GET /api/admin/usuarios`), el servidor responde con estado `200` y entrega toda la información del panel.
**Por qué ocurre:** El enrutador aplicaba únicamente el middleware `requiereSesion` (que valida que exista una sesión activa), omitiendo el uso del middleware `requiereRol('admin')` que ya estaba definido en `src/middleware/auth.ts`.
**Cómo se corrige:** Se agregó `router.use(requiereRol('admin'))` inmediatamente después de `requiereSesion` en `src/routes/admin.routes.ts`, garantizando que solo los usuarios con rol `admin` accedan a las rutas del panel y devolviendo `403 Forbidden` al resto.
**Cómo se verifica:** Se ejecutó `npm run test:seguridad` pasando el test *"un usuario sin rol admin NO puede entrar al panel"* y `npm run check:security` aprobando el control `AUTH-14`. Manualmente, al intentar acceder con `cliente`, la API devuelve `403`.
**Reflexión:** Nunca se debe confiar en ocultar vistas o botones en el frontend; toda autorización debe aplicarse de forma centralizada en el backend siguiendo el principio de denegación por defecto.

## #19 Escalada de privilegios en actualización de usuarios
**Qué es y por qué importa:** Permite que un usuario sin privilegios modifique su propio rol a `admin` (asignación masiva / escalada vertical de privilegios), tomando control total de la aplicación.
**Dónde está:** `src/routes/admin.routes.ts`, (`PUT /api/admin/usuarios/:id`).
**Cómo se observa:** Estando autenticado como `cliente`, al enviar una petición `PUT /api/admin/usuarios/<id>` con el cuerpo `{"rol": "admin"}`, el servidor aceptaba el cambio sin verificar quién lo solicitaba.
**Por qué ocurre:** El endpoint tomaba `rol` directamente de `req.body` y lo pasaba al servicio de actualización sin validar la identidad/rol del solicitante, sin restringir los valores admitidos y sin impedir la auto-modificación de privilegios.
**Cómo se corrige:** Además de proteger todo el router con `requiereRol('admin')`, en `PUT /api/admin/usuarios/:id` se verifica explícitamente `req.usuario.rol === 'admin'`, se valida el `id` como entero positivo, se controla que el rol nuevo pertenezca a la lista blanca `['admin', 'barista', 'mozo', 'cliente']` y se bloquea que un usuario modifique su propio rol.
**Cómo se verifica:** Pasó el test *"un usuario NO puede cambiar su propio rol a admin"* en `npm run test:seguridad` y el control `AUTH-15` en `npm run check:security`.
**Reflexión:** Los endpoints de edición nunca deben volcar propiedades arbitrarias del `req.body` hacia la base de datos; los campos sensibles como roles o permisos deben validarse con listas blancas y reglas estrictas de negocio.

## #21 Exposición de secretos por /api/_diagnostico
**Qué es y por qué importa:** Es una falla de control de acceso y mala configuración de seguridad. Exponer variables de entorno revela credenciales de la base de datos y secretos internos a cualquier usuario sin autenticar.
**Dónde está:** `src/routes/debug.routes.ts`, (`GET /api/_diagnostico`).
**Cómo se observa:** Accediendo sin sesión a `http://localhost:8080/api/_diagnostico`, el servidor devolvía el objeto `process.env` completo junto con `DB_PASSWORD` y `DB_USER`.
**Por qué ocurre:** La ruta carecía de middlewares de autenticación/autorización y serializaba `process.env` directamente en la respuesta JSON.
**Cómo se corrige:** Se protegieron las rutas con `requiereSesion` y `requiereRol('admin')`, y se eliminó la exposición de `process.env` y datos de conexión de la base de datos, devolviendo únicamente métricas básicas de estado.
**Cómo se verifica:** Pasó el test *"el endpoint de diagnóstico NO expone secretos"* en `npm run test:seguridad` y los controles `CFG-03` y `CFG-04` en `npm run check:security`.
**Reflexión:** Los endpoints de depuración deben eliminarse en entornos productivos o restringirse estrictamente a administradores, sin volcar nunca variables de entorno en respuestas HTTP.

## #22 Stack traces enviados al cliente
**Qué es y por qué importa:** Filtrar trazas de error revela rutas internas del servidor, estructura de carpetas, librerías utilizadas y detalles de consultas SQL, facilitando ataques posteriores.
**Dónde está:** `src/middleware/errores.ts`, (`manejadorErrores`).
**Cómo se observa:** Al provocar un error interno (por ejemplo, creando un pedido con un `productoId` inexistente), la respuesta HTTP devolvía la propiedad `"stack"` con toda la pila de llamadas.
**Por qué ocurre:** El middleware global de errores enviaba `err.message` y `err.stack` en el JSON de respuesta sin distinguir errores de cliente (`4xx`) de fallos internos (`500`).
**Cómo se corrige:** Se registra `err.stack` únicamente en los logs internos del servidor (`console.error`) y se responde al cliente con el mensaje genérico `"Error interno del servidor."` para errores `500`, además de evitar reflejar la URL en el error `404`.
**Cómo se verifica:** Pasó el test *"la API NO devuelve stack traces al cliente"* en `npm run test:seguridad` y el control `VAL-06` en `npm run check:security`.
**Reflexión:** Los detalles técnicos de las excepciones pertenecen exclusivamente a los registros de auditoría del servidor; el cliente solo debe recibir códigos HTTP adecuados y mensajes controlados.