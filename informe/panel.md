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