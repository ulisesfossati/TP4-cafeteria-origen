# Informe · Navegador (XSS, CSRF, cabeceras y reseñas)

**Integrante:** Nacho · **Fallas:** #5, #6, #7, #8, #23 y E1

**Ramas:**

| Rama | Fallas |
|---|---|
| `feature/xss-en-el-front` | #5, #6, #7, E1 |
| `feature/protección-csrf` | #8 |
| `feature/cabeceras-de-seguridad` | #23 |

Todas las pruebas se hicieron contra la instalación local (`http://localhost:8080`), a mano y desde la interfaz o con F12. No se escribió ningún script que automatice ataques.

---

## #5 XSS reflejado en el buscador y en los mensajes de error

**Qué es y por qué importa:** el sitio devuelve en la página algo que escribió el usuario y lo inserta como HTML. Si ese texto trae etiquetas, el navegador las interpreta y ejecuta el código. Así un atacante puede armar un enlace o una búsqueda que corra JavaScript en el navegador de otra persona, por ejemplo para robarle datos o actuar en su nombre. OWASP A03:2021 (Inyección).

**Dónde está:**

- `src/public/js/app.js`, línea 130: `renderResultado` arma `Resultados para <strong>' + filtros.q + '</strong>` con `innerHTML`.
- `src/public/js/app.js`, líneas 137, 233 y 288: los mensajes de error del menú, del pedido y de la reseña se pintan con `innerHTML`.
- `src/public/js/admin.js`, línea 63: `feedback()` del panel pinta cualquier mensaje con `innerHTML`, incluido el error del login.
- `src/routes/productos.routes.ts`, línea 58: el 404 repite el id recibido (`No existe el producto "${req.params.id}"`).

**Cómo se observa:**

1. En el buscador del menú escribir `<img src=x onerror=alert(1)>`.
2. Aparece el `alert`: el texto buscado se insertó como una etiqueta `<img>` real.
3. Abrir `http://localhost:8080/api/productos/<script>alert(1)</script>`. La respuesta trae el `<script>` tal cual dentro de `error`.

Respuesta del servidor antes de la corrección (paso 3):

```json
{"error":"invalid input syntax for type integer: \"<script>alert(1)</script>\"","stack":"error: invalid input syntax for type integer: ..."}
```

**Por qué ocurre:** `innerHTML` le pide al navegador que *interprete* el string como HTML. Cuando ese string se arma concatenando datos del usuario o del servidor, el que controla los datos controla el HTML. Además el servidor repetía la entrada en sus mensajes de error, así que cualquier cliente que los pintara quedaba expuesto.

**Cómo se corrige:**

En el cliente se reemplazó todo `innerHTML` por nodos creados con `document.createElement` y texto asignado con `textContent`. `textContent` nunca interpreta HTML: `<img ...>` se ve escrito.

```js
// app.js — helper usado en todo el sitio
function crear(tag, clase, contenido) {
  var el = document.createElement(tag);
  if (clase) el.className = clase;
  if (Array.isArray(contenido)) {
    contenido.forEach(function (hijo) { if (hijo) el.appendChild(hijo); });
  } else if (contenido != null) {
    el.textContent = String(contenido);
  }
  return el;
}

// Buscador
reemplazar(el, [
  document.createTextNode('Resultados para '),
  crear('strong', null, filtros.q),
  document.createTextNode(' — ' + total + ' producto(s)'),
]);
```

En el servidor, el 404 del catálogo usa un mensaje fijo. Además el id se valida con una **lista blanca** (entero positivo) antes de consultar la base, así el error de Postgres tampoco puede repetir el payload:

```ts
if (!/^[1-9]\d{0,9}$/.test(req.params.id)) {
  return res.status(404).json({ error: 'Producto no encontrado.' });
}
```

Los mensajes de `auth.routes.ts` (login) y `middleware/errores.ts` (ruta no encontrada) también repiten la entrada. Se pasaron a Fede y a Ramiro, que son los dueños de esos archivos.

**Cómo se verifica:**

- `npm run test:seguridad`: pasan a verde `el servidor NO devuelve HTML sin escapar en los errores` y `el cliente NO inserta datos con innerHTML`.
- `npm run check:security`: **XSS-01** ✔.
- A mano: el buscador con el mismo payload muestra `Resultados para <img src=x onerror=alert(1)> — 0 producto(s)` como texto y no aparece el alert. `GET /api/productos/<script>…` responde `{"error":"Producto no encontrado."}`.

**Reflexión:** en un proyecto real conviene no tener `innerHTML` en el código de la aplicación: un linter (por ejemplo `no-unsanitized`) puede prohibirlo, y conviene usar un framework que escape por defecto (React, Vue). Los mensajes de error deberían ser genéricos y salir de una lista fija, nunca de la entrada del usuario.

---

## #6 XSS almacenado en las reseñas

**Qué es y por qué importa:** es la versión persistente del #5. El código malicioso se *guarda* en la base y se ejecuta en el navegador de **cada** persona que abre la página, incluida la dueña cuando entra al sitio con sesión de admin. No hace falta engañar a nadie con un enlace. OWASP A03:2021.

**Dónde está:** `src/public/js/app.js`, líneas 259 a 270: `cargarReseñas` arma cada reseña concatenando `c.autor` y `c.texto` y la inserta con `innerHTML`. El servidor (`routes/comentarios.routes.ts`, línea 27) guarda el texto sin ningún control.

**Cómo se observa:**

1. En "Dejá tu reseña" poner como opinión `<img src=x onerror=alert(document.cookie)>` y publicar.
2. Aparece el alert con las cookies. Al recargar la página vuelve a aparecer, y lo mismo pasa en cualquier otro navegador que abra el sitio.

**Por qué ocurre:** el texto de la reseña es entrada de cualquier visitante anónimo. Se guarda tal cual y después se trata como HTML de confianza al mostrarlo.

**Cómo se corrige:** las reseñas se pintan con `textContent`. La calificación se acota a 0–5 antes de dibujar las estrellas, por si en la base quedó un valor raro:

```js
reemplazar(cont, resp.data.comentarios.map(function (c) {
  var n = Math.max(0, Math.min(5, Math.floor(Number(c.calificacion) || 0)));
  return crear('article', 'review', [
    crear('div', 'review-head', [
      crear('span', 'review-author', c.autor),
      crear('span', 'review-stars', '★'.repeat(n)),
    ]),
    crear('p', 'review-text', c.texto),
  ]);
}));
```

Como segunda capa, la CSP del #23 bloquea los manejadores inline (`onerror=`) aunque algo llegara al DOM.

**Cómo se verifica:**

- `npm run test:seguridad`: `el cliente NO inserta datos con innerHTML` ✔.
- A mano: la reseña de prueba que ya estaba guardada ahora se lee como texto (`<img src=x onerror=…>`) y no aparece ningún alert.

**Reflexión:** todo lo que escribe un usuario es dato y nunca código, sin importar dónde se guarde. En un proyecto real se escapa siempre en la salida (o se usa un sanitizador como DOMPurify si de verdad hace falta HTML enriquecido), se valida en la entrada (E1) y se agrega CSP como red de seguridad.

---

## #7 XSS de DOM en el panel

**Qué es y por qué importa:** el ataque ocurre entero en el navegador: el JavaScript del panel lee un valor de la URL y lo mete en la página como HTML. Basta con que el admin abra un enlace preparado, y el código corre con su sesión de administrador. El servidor nunca ve nada raro. OWASP A03:2021.

**Dónde está:** `src/public/js/admin.js`, línea 427:

```js
var objetivo = params.get('vista');
if (objetivo) {
  $('#panel-bienvenida').innerHTML = 'Panel ' + objetivo;
}
```

**Cómo se observa:**

1. Abrir `http://localhost:8080/admin.html?vista=<img src=x onerror=alert(1)>`.
2. Aparece el alert. Con F12 → Elements se ve el `<img>` dentro de `#panel-bienvenida`.

**Por qué ocurre:** `location.search` lo controla quien arma el enlace, no la aplicación. Se usaba sin validar como si fuera HTML confiable.

**Cómo se corrige:** con una **lista blanca** de vistas. Si `?vista=` no es una de las seis pestañas existentes, se ignora. Si lo es, el título se arma con el nombre de la lista (no con lo que vino en la URL) usando `textContent`, y de paso se abre esa pestaña:

```js
var VISTAS = {
  resumen: 'Resumen', pedidos: 'Pedidos', productos: 'Productos',
  reportes: 'Reportes', usuarios: 'Usuarios', herramientas: 'Herramientas',
};

var objetivo = params.get('vista');
if (objetivo && Object.prototype.hasOwnProperty.call(VISTAS, objetivo)) {
  $('#panel-bienvenida').textContent = 'Panel ' + VISTAS[objetivo];
  mostrarVista(objetivo);
}
```

Las tablas, KPIs y mensajes del panel también se pasaron a `createElement`/`textContent`. Los `<select>` de estado y de rol se arman con opciones fijas, y la clase del badge de estado sólo se compone con un estado de la lista.

**Cómo se verifica:**

- `npm run test:seguridad`: `el cliente NO inserta datos con innerHTML` ✔.
- A mano: la misma URL ya no dispara nada y el título queda como estaba. `admin.html?vista=reportes` abre la pestaña Reportes.

**Reflexión:** todo lo que llega por la URL (query, hash, `document.referrer`) es entrada del atacante. En un proyecto real se valida contra valores conocidos y se usa una CSP con Trusted Types para que el navegador rechace las asignaciones peligrosas a `innerHTML`.

---

## #8 CSRF en los formularios que cambian estado

**Qué es y por qué importa:** el navegador manda las cookies de un sitio en *cualquier* petición a ese sitio, aunque la haya disparado otra página. Una página maliciosa puede hacer que el navegador de un admin con sesión abierta mande un `POST` a la cafetería (cambiar un rol, borrar un producto, crear pedidos) sin que se entere. OWASP A01:2021.

**Dónde está:** ninguna ruta que cambia estado verificaba de dónde venía la petición: `routes/pedidos.routes.ts` líneas 18 y 61, `routes/comentarios.routes.ts` línea 24 y `routes/admin.routes.ts` líneas 49, 69, 83, 101, 119, 149 y 180. En `src/app.ts` no había ningún middleware anti-CSRF.

**Cómo se observa:**

1. Con F12 → Network, publicar una reseña: el `POST /api/comentarios` sólo lleva la cookie y el JSON. No hay ningún dato que una página ajena no pueda adivinar.
2. Con *Copy as cURL* y sacando todo menos el cuerpo, la petición se repite desde la terminal y se acepta (`201`). Cualquier origen puede generarla.

**Por qué ocurre:** el servidor identifica al usuario sólo por la cookie, y la cookie la pone el navegador automáticamente. No había nada en la petición que demostrara que salió del propio sitio.

**Cómo se corrige:** con un **token anti-CSRF aleatorio por sesión del navegador** (patrón *double submit cookie*), en `src/middleware/csrf.ts`:

1. `GET /api/csrf-token` genera el token con `crypto.randomBytes(32)` (nunca un valor fijo), lo guarda en la cookie `csrf` (`HttpOnly`, `SameSite=Strict`, `Secure` en producción) y lo devuelve en el JSON.
2. `app.js` y `admin.js` lo piden una vez y lo mandan en la cabecera `X-CSRF-Token` en cada POST, PUT, PATCH y DELETE.
3. El middleware `verificarCsrf` (montado en `app.ts` sobre `/api`) compara cabecera y cookie en tiempo constante. Si falta o no coincide responde **403**. También rechaza las peticiones cuyo `Origin` no sea el propio sitio (control CSRF-03).

```ts
export function verificarCsrf(req: Request, res: Response, next: NextFunction): void {
  if (METODOS_SEGUROS.has(req.method)) return next();
  if (RUTAS_EXENTAS.has(req.path)) return next(); // sólo /auth/login

  if (!origenPermitido(req)) {
    res.status(403).json({ error: 'Origen de la petición no permitido.' });
    return;
  }

  const esperado = tokenDeLaCookie(req);
  const recibido = req.get('x-csrf-token') || cuerpo._csrf || req.query._csrf;
  if (!esperado || typeof recibido !== 'string' || !mismoToken(esperado, recibido)) {
    res.status(403).json({ error: 'Token anti-CSRF ausente o inválido. Recargá la página.' });
    return;
  }
  delete cuerpo._csrf; // que no llegue a los servicios como dato
  next();
}
```

```js
// app.js / admin.js
return (cambiaEstado ? obtenerTokenCsrf() : Promise.resolve(null)).then(function (token) {
  if (token) opciones.headers = Object.assign({}, opciones.headers, { 'X-CSRF-Token': token });
  return fetch(API + url, opciones);
});
```

Funciona porque otra página puede hacer que el navegador *mande* la cookie, pero no puede *leer* la respuesta de `/api/csrf-token` (lo impide la política de mismo origen). Sin leerla no sabe qué token poner en la cabecera.

El login queda exento: todavía no hay sesión que aprovechar, y los tests de fuerza bruta y enumeración lo prueban sin token. El `SameSite` de la cookie de sesión (#13, Fede) suma, pero no reemplaza al token.

**Cómo se verifica:**

- `npm run test:seguridad`: `existe un token anti-CSRF y las peticiones sin token se rechazan` ✔.
- `npm run check:security`: **CSRF-01** ✔ y **CSRF-03** ✔.
- `npm test` sigue verde: los helpers ya buscan `/api/csrf-token` y mandan el token.
- A mano con curl contra localhost:

| Petición | Resultado |
|---|---|
| `POST /api/comentarios` sin token | `403` |
| Con un token inventado | `403` |
| Con el token correcto pero `Origin: http://evil.example` | `403` |
| Con el token correcto desde el propio sitio | `201` |
| Dos pedidos de token en la misma sesión | mismo token |
| Otra sesión | token distinto |

- En el navegador: publicar reseña, hacer un pedido y, en el panel, cambiar el estado de un pedido siguen funcionando. En Network se ve la cabecera `X-CSRF-Token`.

**Reflexión:** en un proyecto real se usa la protección CSRF que ya trae el framework (no una casera), con cookies `SameSite=Lax/Strict` y verificación de `Origin`, y nunca se usan peticiones GET para cambiar estado. Lo más importante es entender que la cookie *sola* no prueba la intención del usuario.

---

## #23 Sin cabeceras de seguridad (helmet, CSP)

**Qué es y por qué importa:** las cabeceras HTTP le dicen al navegador qué puede hacer con la página: de dónde cargar scripts, si puede mostrarse dentro de un `<iframe>`, si puede adivinar el tipo de un archivo. Sin ellas, cualquier XSS que se escape corre sin límites, el sitio se puede embeber para *clickjacking* y el navegador puede ejecutar como script un archivo subido. OWASP A05:2021.

**Dónde está:** `src/app.ts`, líneas 15 a 26: el propio código marca que falta helmet, y la app arranca directo con `express.json`.

**Cómo se observa:**

1. F12 → Network → la petición a `/` → Response Headers.
2. No hay `Content-Security-Policy`, `X-Content-Type-Options` ni `X-Frame-Options`, y aparece `X-Powered-By: Express`, que le dice al atacante qué tecnología se usa.

Con `curl -I http://localhost:8080/` sobre la versión original, de todas estas cabeceras la única que aparece es:

```
X-Powered-By: Express
```

**Por qué ocurre:** Express no agrega cabeceras de seguridad por defecto y nadie las configuró.

**Cómo se corrige:** con `helmet()` en `app.ts`, antes de servir los archivos estáticos, y una CSP que sólo permite el propio origen:

```ts
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      'default-src': ["'self'"],
      'script-src': ["'self'"],
      'script-src-attr': ["'none'"],   // sin onclick="..." ni onerror="..."
      'style-src': ["'self'"],
      'img-src': ["'self'", 'data:'],  // data: para el favicon SVG
      'font-src': ["'self'"],
      'connect-src': ["'self'"],
      'object-src': ["'none'"],
      'base-uri': ["'self'"],
      'form-action': ["'self'"],
      'frame-ancestors': ["'none'"],
      ...(enProduccion ? { 'upgrade-insecure-requests': [] } : {}),
    },
  },
  strictTransportSecurity: enProduccion,
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
}));
```

Se revisaron `index.html` y `admin.html`: no tienen `<script>` inline, `onclick` ni `style=`, y todo el JS ya estaba en `public/js/`, así que la CSP estricta no rompe ninguna pantalla. HSTS y `upgrade-insecure-requests` quedan sólo para producción, porque en `localhost` por HTTP romperían el sitio.

**Cómo se verifica:**

- `npm run test:seguridad`: `el sitio envía cabeceras de seguridad` ✔.
- `npm run check:security`: **XSS-03** ✔ y **CFG-01** ✔.
- A mano, cabeceras de `GET /`:

```
Content-Security-Policy: default-src 'self';script-src 'self';script-src-attr 'none';style-src 'self';img-src 'self' data:;font-src 'self';connect-src 'self';object-src 'none';base-uri 'self';form-action 'self';frame-ancestors 'none'
Referrer-Policy: strict-origin-when-cross-origin
X-Content-Type-Options: nosniff
X-Frame-Options: SAMEORIGIN
```

`X-Powered-By` desaparece.

- Recorrida de todas las pantallas con la consola abierta (inicio, buscador, carrito y pedido, reseñas, login del panel y cada pestaña) sin errores de CSP.

**Reflexión:** las cabeceras no reemplazan escribir código seguro, pero hacen que un error no termine en desastre. En un proyecto real se activan desde el primer día, empezando por `Content-Security-Policy-Report-Only` para ver qué se rompería, y se prohíbe el JS inline desde el diseño.

---

## E1 Reseñas sin límite

**Qué es y por qué importa:** el servidor guardaba cualquier cosa como reseña: textos de miles de caracteres, autor vacío, calificación `-3` o `"hola"`. Eso permite llenar la base, romper el diseño de la página y es la puerta de entrada del XSS almacenado (#6). OWASP A04:2021.

**Dónde está:** `src/routes/comentarios.routes.ts`, líneas 24 a 31: el `POST` pasa `autor`, `texto` y `calificacion` directo al servicio. El formulario tiene `maxlength`, pero eso sólo frena al navegador, no a quien manda el JSON a mano.

**Cómo se observa:** en F12 → Console, con la página abierta, mandar a mano (con el token si ya está la rama de CSRF) un `fetch('/api/comentarios', {method:'POST', …})` con `texto` de 5000 caracteres y `calificacion: 99`. Se guarda y responde `201`.

**Por qué ocurre:** la validación estaba sólo en el HTML del cliente, que el usuario controla.

**Cómo se corrige:** se valida en el servidor con una lista blanca de lo que *sí* se acepta. Si no cumple, **400** con un mensaje fijo:

```ts
function validarResena(cuerpo: unknown): comentarios.NuevoComentario | null {
  if (!cuerpo || typeof cuerpo !== 'object') return null;
  const { autor, texto, calificacion } = cuerpo as Record<string, unknown>;

  if (typeof autor !== 'string' || typeof texto !== 'string') return null;
  const autorLimpio = autor.trim();
  const textoLimpio = texto.trim();
  if (autorLimpio.length < 2 || autorLimpio.length > 40) return null;
  if (textoLimpio.length < 3 || textoLimpio.length > 280) return null;

  const nota = typeof calificacion === 'string' ? Number(calificacion) : calificacion;
  if (typeof nota !== 'number' || !Number.isInteger(nota) || nota < 1 || nota > 5) return null;

  return { autor: autorLimpio, texto: textoLimpio, calificacion: nota };
}
```

**Cómo se verifica:**

- `npm run test:seguridad`: `no se aceptan reseñas sin límite de longitud` ✔.
- `npm run check:security`: **XSS-04** ✔.
- A mano: `{"autor":"A","texto":"hola","calificacion":7}` responde `400 Reseña inválida: …`. Una reseña normal desde el formulario se sigue publicando.

**Reflexión:** la validación del cliente es para la comodidad del usuario y la del servidor es para la seguridad. En un proyecto real se define un esquema por endpoint (zod, joi) y se rechaza todo lo que no esté en él, en lugar de intentar detectar lo "malo".
