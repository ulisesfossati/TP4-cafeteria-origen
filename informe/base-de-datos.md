# Informe · Base de datos (inyección SQL, validación, contraseñas y Docker)

**Integrante:** Ulises · **Fallas:** #1, #2, #3, #4, #9, #11, #24, E2 y E3

**Ramas:**

| Rama | Fallas |
|---|---|
| `feature/inyección-sql` | #1, #2, #3, #4 |
| `feature/validación-de-pedidos` | #9 |
| `feature/contraseñas-con-hash` | #11, E2 |
| `feature/base-de-datos-segura` | #24, E3 |
| `feature/script-de-la-base-en-windows` | #24 (arranque en Windows) |
| `feature/cuentas-de-prueba-sin-claves` | E2 (cierre) |

Todas las pruebas se hicieron contra la instalación local (`http://localhost:8080`), a mano desde la interfaz, con `curl` y con `psql`. No se escribió ningún script que automatice ataques.

> 📷 = lugar para pegar la captura tomada al reproducir la falla.

---

## #1 Inyección SQL en el login

**Qué es y por qué importa:** el login arma la consulta SQL pegando lo que el usuario escribe en el formulario. Si el usuario escribe comillas y operadores de SQL, cambia la consulta y entra al panel sin saber ninguna contraseña. Es la puerta de entrada a todo lo demás: con el panel abierto se ven pedidos, usuarios y herramientas internas. OWASP A03:2021 (Inyección).

**Dónde está:** `src/services/usuarios.service.ts`, línea 42:

```ts
const sql = `SELECT * FROM usuarios WHERE username = '${username}' AND password = '${password}'`;
const { rows } = await db.query<Usuario>(sql);
```

**Cómo se observa:**

1. Abrir `http://localhost:8080/admin.html`.
2. En usuario escribir `' OR 1=1 --` y en contraseña `cualquiera`.
3. Se entra al panel como **Administración** (rol admin): `OR 1=1` hace verdadera la condición y `--` comenta el resto, incluida la contraseña.
4. Con `admin'--` pasa lo mismo: entra como `admin` sin contraseña.

📷 formulario con el payload · 📷 panel abierto como Administración

**Por qué ocurre:** el usuario y la contraseña se concatenan al texto SQL. La comilla que abre la cadena en el código se cierra con la comilla del atacante, y todo lo que sigue Postgres lo lee como SQL. Además la contraseña se comparaba dentro de la consulta, en texto plano (ver #11).

**Cómo se corrige:** la consulta pasa a ser parametrizada (`$1`): el valor viaja aparte del texto SQL y Postgres nunca lo interpreta como código. La contraseña ya no se compara en SQL sino con `bcrypt.compare` contra el hash guardado. También se descarta lo que no sea texto, porque el cuerpo JSON puede traer un array u objeto:

```ts
export async function buscarPorUsername(username: string): Promise<Usuario | null> {
  const { rows } = await db.query<Usuario>(
    'SELECT * FROM usuarios WHERE username = $1',
    [username]
  );
  return rows[0] || null;
}

export async function autenticar(username: string, password: string): Promise<Usuario | null> {
  if (typeof username !== 'string' || typeof password !== 'string') return null;

  const usuario = await buscarPorUsername(username);
  if (!usuario) return null;
  return (await bcrypt.compare(password, usuario.password)) ? usuario : null;
}
```

**Cómo se verifica:**

- `npm run test:seguridad`: pasan `el login NO acepta el bypass con payload SQL` y `el login NO acepta el payload que comenta la contraseña`.
- `npm run check:security`: **SQLI-01** ✔, **SQLI-02** ✔ y **AUTH-03** ✔.
- A mano: el mismo payload en el login responde `401` y el panel no se abre. El texto del mensaje de error lo corrige Fede en el #17 (enumeración de usuarios).

📷 login rechazado con el payload

**Reflexión:** nunca hay que armar SQL concatenando texto, aunque el dato "parezca" inofensivo. En un proyecto real se usan siempre consultas parametrizadas o un ORM o query builder que las use por defecto, y una regla de linter o una revisión de código que rechace cualquier template string con `SELECT`, `INSERT` o `UPDATE`.

---

## #2 Inyección SQL en los filtros del catálogo

**Qué es y por qué importa:** los filtros del menú (tipo, origen y buscador) se agregan a la consulta pegando el texto que manda el visitante. Es la misma inyección del #1, pero en una página pública: cualquiera, sin cuenta, puede alterar la consulta. Con un `UNION` podría leer otras tablas de la base. OWASP A03:2021.

**Dónde está:** `src/services/catalogo.service.ts`, líneas 40, 41 y 43 (filtros) y línea 55 (producto por id):

```ts
if (tipo) sql += ` AND tipo = '${tipo}'`;
if (variedad) sql += ` AND variedad = '${variedad}'`;
if (q) {
  sql += ` AND (nombre ILIKE '%${q}%' OR descripcion ILIKE '%${q}%')`;
}
// ...
const { rows } = await db.query<Producto>(`SELECT * FROM productos WHERE id = '${id}'`);
```

**Cómo se observa:**

1. En el menú del sitio, escribir en el buscador `' OR '1'='1`.
2. La página dice `Resultados para ' OR '1'='1 — 20 producto(s)`: muestra **todo el catálogo**, cuando ningún producto contiene ese texto.

📷 buscador con los 20 productos

**Por qué ocurre:** igual que en el #1, el texto del buscador termina dentro del SQL. La comilla cierra el `ILIKE` y el `OR '1'='1'` vuelve verdadera la condición para todas las filas.

**Cómo se corrige:** la consulta se arma con un array de valores y cada filtro agrega su marcador (`$1`, `$2`, `$3`). Los `%` del `ILIKE` van dentro del valor, no en el SQL. El producto por id, además, se valida como entero antes de consultar:

```ts
const valores: unknown[] = [];
let sql = 'SELECT * FROM productos WHERE activo = true';
if (tipo) {
  valores.push(tipo);
  sql += ` AND tipo = $${valores.length}`;
}
if (variedad) {
  valores.push(variedad);
  sql += ` AND variedad = $${valores.length}`;
}
if (q) {
  valores.push(`%${q}%`);
  sql += ` AND (nombre ILIKE $${valores.length} OR descripcion ILIKE $${valores.length})`;
}
sql += ' ORDER BY tipo, variedad NULLS FIRST, id';

const { rows } = await db.query<Producto>(sql, valores);
```

```ts
// Un id que no es entero haría fallar la consulta con un 500: es un producto que no existe.
if (!/^\d{1,9}$/.test(String(id))) return null;
const { rows } = await db.query<Producto>('SELECT * FROM productos WHERE id = $1', [id]);
```

**Cómo se verifica:**

- `npm run test:seguridad`: pasan `la búsqueda del catálogo NO se puede ampliar con SQL` y `el filtro por origen NO se puede ampliar con SQL`.
- `npm run check:security`: **SQLI-01** ✔, **SQLI-02** ✔ y **VAL-01** ✔.
- A mano: el mismo texto en el buscador devuelve `0 producto(s)`, porque ahora se busca literalmente esa frase. Las búsquedas normales ("Brasil", "espresso") siguen funcionando igual.

📷 buscador con 0 productos

**Reflexión:** que un formulario sea público no lo hace inofensivo, al contrario: es lo primero que se prueba. En un proyecto real se arma la consulta con un query builder (o con un array de condiciones como acá) y nunca concatenando strings, aunque sea "sólo un filtro".

---

## #3 Inyección SQL en el filtro por mesa

**Qué es y por qué importa:** el listado de pedidos acepta `?mesa=` y lo pega en la consulta. Con una inyección se ven los pedidos de **todas** las mesas, con el nombre de cada cliente, cuando sólo deberían verse los de una. Es una fuga de datos personales. OWASP A03:2021.

**Dónde está:** `src/services/pedidos.service.ts`, línea 95:

```ts
let sql = 'SELECT * FROM pedidos';
if (mesa) sql += ` WHERE mesa = '${mesa}'`;
sql += ' ORDER BY id DESC';
```

**Cómo se observa:**

```bash
curl -s -G http://localhost:8080/api/pedidos --data-urlencode "mesa=' OR '1'='1"
```

La respuesta trae los 3 pedidos de la base, de las mesas 7, 5 y 2, aunque ninguna mesa se llama `' OR '1'='1`.

📷 respuesta con los pedidos de todas las mesas

**Por qué ocurre:** el valor de la URL se mete entre comillas dentro del SQL sin ningún control, igual que en el #1 y el #2.

**Cómo se corrige:** dos consultas fijas, una con el parámetro `$1` y otra sin filtro:

```ts
export async function listar(mesa?: string): Promise<Pedido[]> {
  const { rows } = mesa
    ? await db.query<Pedido>('SELECT * FROM pedidos WHERE mesa = $1 ORDER BY id DESC', [mesa])
    : await db.query<Pedido>('SELECT * FROM pedidos ORDER BY id DESC');
  return rows;
}
```

**Cómo se verifica:**

- `npm run test:seguridad`: pasa `el filtro por mesa NO se puede ampliar con SQL`.
- `npm run check:security`: **SQLI-01** ✔ y **SQLI-02** ✔.
- A mano: el mismo `curl` devuelve una lista vacía, y `?mesa=7` sigue trayendo sólo los pedidos de la mesa 7.

📷 respuesta vacía

**Reflexión:** el parámetro de una URL es tan peligroso como un campo de formulario, aunque el usuario común nunca lo vea. En un proyecto real, además de parametrizar, este listado debería pedir sesión y devolver sólo lo que le corresponde a quien pregunta (es la extra E4, IDOR).

---

## #4 Inyección SQL en el reporte por origen

**Qué es y por qué importa:** es la inyección con más impacto de la lista. Con un `UNION`, el reporte de ventas devuelve filas de **otra tabla**: los usuarios con sus contraseñas. Demuestra que una sola consulta vulnerable expone toda la base, no sólo la tabla que usa. OWASP A03:2021.

**Dónde está:** `src/services/reportes.service.ts`, línea 88 (consulta de las líneas 83 a 88):

```ts
const sql = `
  SELECT pr.variedad, pr.nombre, SUM(pi.cantidad) AS unidades,
         SUM(pi.cantidad * pi.precio_unitario) AS total
    FROM pedido_items pi
    JOIN productos pr ON pr.id = pi.producto_id
   GROUP BY pr.variedad, pr.nombre
  HAVING pr.variedad = '${variedad}'`;
```

**Cómo se observa:**

1. Entrar al panel como `valentina` → pestaña **Reportes** → "Ventas por origen".
2. En Origen escribir `Brasil' UNION SELECT username, password, 1, 1 FROM usuarios--` y tocar **Consultar**.
3. La tabla del reporte muestra, debajo de la venta real de Brasil, una fila por usuario con su contraseña en las columnas Origen y Producto: `admin / admin`, `valentina / origen2024`, `barista / cafe123`, `cliente / cliente`.

📷 reporte con los usuarios y contraseñas

**Por qué ocurre:** el origen se pega en el `HAVING`. La comilla cierra la cadena, el `UNION SELECT` agrega filas de la tabla `usuarios` con la misma cantidad de columnas y el `--` comenta el resto. Como las contraseñas estaban en texto plano (#11), se leen directo.

**Cómo se corrige:** dos capas. Primero una **lista blanca**: los orígenes son tres y cualquier otro valor se rechaza con `400` antes de tocar la base. Después, la consulta parametrizada:

```ts
export const ORIGENES_PERMITIDOS = ['Brasil', 'Colombia', 'Etiopía'];

export async function ventasPorVariedad(variedad: string): Promise<VentaPorVariedad[]> {
  if (!ORIGENES_PERMITIDOS.includes(variedad)) {
    throw Object.assign(new Error('El origen tiene que ser Brasil, Colombia o Etiopía.'), { status: 400 });
  }

  const { rows } = await db.query<VentaPorVariedad>(
    `SELECT pr.variedad, pr.nombre, SUM(pi.cantidad) AS unidades,
            SUM(pi.cantidad * pi.precio_unitario) AS total
       FROM pedido_items pi
       JOIN productos pr ON pr.id = pi.producto_id
      WHERE pr.variedad = $1
      GROUP BY pr.variedad, pr.nombre`,
    [variedad]
  );
  return rows;
}
```

**Cómo se verifica:**

- `npm run test:seguridad`: pasa `el reporte por origen NO filtra otras tablas con UNION`.
- `npm run check:security`: **SQLI-01** ✔, **SQLI-02** ✔ y **VAL-03** ✔.
- A mano: el mismo texto muestra `Error: El origen tiene que ser Brasil, Colombia o Etiopía.` y no aparece ninguna fila. Consultar `Brasil` sigue mostrando sus ventas.

📷 reporte con el error de origen

**Reflexión:** cuando los valores posibles son pocos y conocidos, la lista blanca es la defensa más simple y más fuerte: no hay que adivinar qué es "malo", sólo aceptar lo que existe. Y este caso muestra por qué las defensas se suman: con hash (#11) y un usuario sin privilegios (#24), aunque una inyección se escape, el daño es mucho menor.

---

## #9 Validación débil en los pedidos

**Qué es y por qué importa:** el servidor aceptaba cualquier cosa al crear un pedido: cantidades negativas, texto en lugar de números, cantidades enormes y mesa o cliente vacíos o gigantes. Un pedido con cantidad negativa da un total negativo, o sea una factura en la que la cafetería le paga al cliente. OWASP A04:2021 (Diseño inseguro).

**Dónde está:** `src/services/pedidos.service.ts`, líneas 43 a 64 (`crear`):

```ts
export async function crear({ mesa, cliente, items }: NuevoPedido) {
  for (const item of items) {
    const producto = await buscarProducto(item.productoId);
    filas.push({ productoId: producto.id, cantidad: item.cantidad, precioUnitario: calcularPrecio(producto) });
  }
  const total = filas.reduce((acc, f) => acc + f.precioUnitario * f.cantidad, 0);
  // ...
}
```

No se controla el tipo, el rango ni la longitud de ningún campo.

**Cómo se observa:** el formulario del carrito no deja poner números negativos, pero eso es sólo el navegador. Mandando el pedido directo a la API:

```bash
curl -s -X POST http://localhost:8080/api/pedidos -H "Content-Type: application/json" \
  -d '{"mesa":"4","cliente":"Ana","items":[{"productoId":4,"cantidad":-5}]}'
```

Responde `201` y el pedido se guarda con `"total": "-28700.00"`. Con `"cantidad":"muchos"` responde `500` y muestra el error interno de Postgres (`invalid input syntax for type integer: "muchos"`).

📷 pedido con total negativo · 📷 error 500 con el mensaje de Postgres

**Por qué ocurre:** la validación estaba sólo en el HTML del formulario (`type="number"`, `min`), que el usuario controla. El servidor confiaba en que los datos llegaban bien.

**Cómo se corrige:** se creó `src/validacion.ts` con funciones de tipo, longitud y rango que lanzan un error `400` con un mensaje fijo, y `crear` valida cada campo antes de calcular nada:

```ts
// src/validacion.ts
export function entero(valor: unknown, campo: string, min: number, max: number): number {
  const numero = typeof valor === 'string' && /^-?\d+$/.test(valor) ? Number(valor) : valor;
  if (typeof numero !== 'number' || !Number.isInteger(numero) || numero < min || numero > max) {
    throw errorDeValidacion(`${campo} tiene que ser un número entero entre ${min} y ${max}.`);
  }
  return numero;
}

export function texto(valor: unknown, campo: string, min: number, max: number): string {
  const limpio = typeof valor === 'string' ? valor.trim() : '';
  if (limpio.length < min || limpio.length > max) {
    throw errorDeValidacion(`${campo} tiene que tener entre ${min} y ${max} caracteres.`);
  }
  return limpio;
}
```

```ts
// src/services/pedidos.service.ts
const mesa = texto(datos.mesa, 'La mesa', 1, 10);
const cliente = texto(datos.cliente, 'El nombre', 2, 40);
const items: unknown = datos.items;
if (!Array.isArray(items) || items.length < 1 || items.length > MAX_ITEMS) {
  throw errorDeValidacion(`El pedido tiene que tener entre 1 y ${MAX_ITEMS} productos.`);
}

for (const item of items) {
  const productoId = entero(item?.productoId, 'El producto', 1, MAX_ID);
  const cantidad = entero(item?.cantidad, 'La cantidad', 1, MAX_CANTIDAD);
  const producto = await buscarProducto(productoId);
  if (!producto) throw errorDeValidacion('Uno de los productos del pedido no existe.');
  // ...
}
```

Los límites son: hasta 30 productos por pedido, cantidad entre 1 y 50, mesa de 1 a 10 caracteres y nombre de 2 a 40. Los mensajes nunca repiten el valor recibido, así no sirven para un XSS.

**Cómo se verifica:**

- `npm run test:seguridad`: pasan `no se aceptan cantidades negativas` y `no se aceptan cantidades no numéricas`.
- `npm run check:security`: **VAL-01** ✔, **VAL-02** ✔ y **VAL-03** ✔.
- `npm test` sigue en verde: los pedidos normales se calculan igual.
- A mano: los dos `curl` de arriba responden `400` con `La cantidad tiene que ser un número entero entre 1 y 50.` y no se guarda nada. Un pedido normal desde el carrito se sigue creando.

📷 los dos pedidos rechazados con 400

**Reflexión:** la validación del navegador es para que el usuario no se equivoque; la del servidor es la que protege el negocio. En un proyecto real se define un esquema por endpoint (zod, joi) con tipo, rango y longitud de cada campo, y todo lo que no cumple se rechaza antes de llegar a la lógica.

---

## #11 Contraseñas en texto plano

**Qué es y por qué importa:** las contraseñas se guardaban tal cual en la tabla `usuarios`. Cualquiera que llegue a la base (una inyección como la del #4, un backup, un dump o alguien con acceso al servidor) las lee directamente, y como la gente repite contraseñas, también le sirven para otras cuentas de esas personas. OWASP A02:2021 (Fallas criptográficas).

**Dónde está:**

- `src/inicializar.ts`, líneas 23 a 48: las cuentas de ejemplo con su contraseña escrita, y línea 59, el `INSERT` que las guarda sin hashear.
- `src/services/usuarios.service.ts`, línea 42: el login compara la contraseña dentro del SQL, en claro.
- `src/services/usuarios.service.ts`, líneas 58 a 83: `actualizar` y `cambiarPassword` guardan la contraseña nueva sin hashear.

**Cómo se observa:**

```bash
docker compose exec db psql -U postgres -d origen -c "SELECT username, password FROM usuarios"
```

Se leen todas: `admin | admin`, `valentina | origen2024`, `barista | cafe123`, `mozo | mozo123`, `cliente | cliente`.

📷 tabla de usuarios con las contraseñas a la vista

**Por qué ocurre:** nadie aplicó un hash al guardar. La contraseña se trataba como un dato más de la fila.

**Cómo se corrige:** con `bcrypt` (`bcryptjs`, ya instalado), con 12 rondas. bcrypt agrega una sal distinta a cada hash y es lento a propósito, así que probar millones de contraseñas contra un hash robado lleva muchísimo tiempo.

- Al crear las cuentas de ejemplo se guarda `bcrypt.hash(clave, 12)`.
- El login compara con `bcrypt.compare` (ver #1), nunca con `===`.
- `actualizar` y `cambiarPassword` hashean la contraseña nueva.
- Las bases que ya existían se migran solas al arrancar: toda contraseña que no empieza con `$2` (no es un hash de bcrypt) se reemplaza por su hash.

```ts
// src/services/usuarios.service.ts
export const RONDAS_BCRYPT = 12;

export async function cambiarPassword(id: number, nuevaPassword: string) {
  const { rows } = await db.query<Usuario>(
    'UPDATE usuarios SET password = $1 WHERE id = $2 RETURNING *',
    [await bcrypt.hash(nuevaPassword, RONDAS_BCRYPT), id]
  );
  return rows[0] || null;
}
```

```ts
// src/inicializar.ts — migración de bases viejas
const { rows: enClaro } = await db.query<{ id: number; password: string }>(
  "SELECT id, password FROM usuarios WHERE password NOT LIKE '$2%'"
);
for (const usuario of enClaro) {
  await db.query('UPDATE usuarios SET password = $1 WHERE id = $2', [
    await bcrypt.hash(usuario.password, RONDAS_BCRYPT),
    usuario.id,
  ]);
}
```

**Cómo se verifica:**

- `npm run test:seguridad`: pasa `las contraseñas NO se guardan en texto plano`.
- `npm run check:security`: **AUTH-01** ✔, **AUTH-02** ✔ y **AUTH-03** ✔.
- A mano: la misma consulta muestra hashes del tipo `$2a$12$T4gft7sCbbya1HgUUcgfu.Efk/…`, distintos para cada usuario. El login con la contraseña correcta sigue funcionando.

📷 tabla de usuarios con los hashes

**Reflexión:** una contraseña no se guarda, se guarda algo que permite comprobarla. En un proyecto real se usa bcrypt, scrypt o Argon2 (nunca MD5 ni SHA sin sal) y se diseña pensando que la base se puede filtrar algún día: si pasa, lo que se filtra no sirve para entrar.

---

## #24 Base de datos sin contraseña y con el superusuario

**Qué es y por qué importa:** la base aceptaba conexiones sin contraseña (`trust`) y la aplicación se conectaba como `postgres`, el superusuario. Juntas, estas dos cosas hacen que cualquier inyección SQL (#1 a #4) pueda borrar tablas, crear usuarios o tirar la base entera, y que cualquier proceso que llegue al puerto de la base entre sin clave. OWASP A05:2021 (Configuración insegura).

**Dónde está:** `docker-compose.yml`:

```yaml
POSTGRES_PASSWORD: postgres            # línea 25
POSTGRES_HOST_AUTH_METHOD: trust       # línea 29: acepta conexiones sin clave
DB_USER: postgres                      # línea 60: la app es superusuario
DB_PASSWORD: postgres                  # línea 61
```

El usuario `origen_app` existía en `docker/initdb/02-usuario-aplicacion.sql`, pero nadie lo usaba y su contraseña (`origen_app_2024`) estaba escrita en el repo.

**Cómo se observa:**

```bash
docker compose exec app printenv DB_USER
# postgres
docker compose exec db psql -h db -U postgres -d origen -c "SELECT current_user"
# entra sin pedir contraseña y responde: postgres
docker compose exec db psql -U postgres -d origen -c "SELECT rolname, rolsuper FROM pg_roles WHERE rolname IN ('postgres', 'origen_app')"
# postgres | t   ← superusuario
```

📷 la app conectada como postgres y la conexión sin contraseña

**Por qué ocurre:** es la configuración cómoda para desarrollar: sin claves y con todos los permisos nada "falla". Pero es la misma configuración que llega a producción si nadie la cambia.

**Cómo se corrige:**

1. Se sacó `POSTGRES_HOST_AUTH_METHOD: trust`. Sin esa línea, la imagen de Postgres exige contraseña (`scram-sha-256`) a toda conexión por red.
2. La app se conecta como `origen_app`, que sólo tiene `SELECT`, `INSERT`, `UPDATE` y `DELETE` sobre las tablas: no puede borrar tablas, tocar el esquema ni crear usuarios.
3. Las contraseñas salen de un `.env` que no se sube al repo (hay un `.env.example` de modelo). Si falta alguna, Docker no arranca y avisa cuál.
4. El `.sql` que creaba `origen_app` con la clave escrita se reemplazó por un `.sh` que la toma de una variable de entorno:

```yaml
# docker-compose.yml
db:
  environment:
    POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?Falta POSTGRES_PASSWORD en el .env (copiá .env.example a .env)}
    APP_DB_PASSWORD: ${DB_PASSWORD:?Falta DB_PASSWORD en el .env (copiá .env.example a .env)}
app:
  environment:
    DB_USER: origen_app
    DB_PASSWORD: ${DB_PASSWORD:?Falta DB_PASSWORD en el .env (copiá .env.example a .env)}
```

```bash
# docker/initdb/02-usuario-aplicacion.sh
psql -v ON_ERROR_STOP=1 -v clave="$APP_DB_PASSWORD" \
     --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<'SQL'
CREATE ROLE origen_app LOGIN PASSWORD :'clave';
GRANT CONNECT ON DATABASE origen TO origen_app;
GRANT USAGE ON SCHEMA public TO origen_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO origen_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO origen_app;
SQL
```

Después de unir este cambio, cada integrante hizo `cp .env.example .env`, completó las claves y recreó la base con `docker compose down -v && docker compose up -d --build`, porque los scripts de `initdb` sólo corren con el volumen vacío.

**Arreglo para Windows** (rama `feature/script-de-la-base-en-windows`): al clonar en Windows, git convertía los saltos de línea del `.sh` a CRLF y el contenedor fallaba con `/bin/bash^M: bad interpreter`, así que `origen_app` no se creaba. Se agregó un `.gitattributes` que fuerza LF en los `.sh`:

```
*.sh text eol=lf
```

**Cómo se verifica:**

- `npm run test:seguridad`: pasa `la aplicación NO se conecta con un superusuario de la base`.
- `npm run check:security`: **SQLI-03** ✔ y **SQLI-05** ✔ (**SQLI-04**, el puerto de la base sin publicar, ya venía bien y se mantuvo).
- A mano: `printenv DB_USER` devuelve `origen_app`, y `psql -h db -U postgres` sin clave falla con `fe_sendauth: no password supplied`.
- Se probó un clon nuevo con `core.autocrlf=true` (como en Windows): el `.sh` queda con LF y la base se crea bien.

📷 la app conectada como origen_app y la conexión sin clave rechazada

**Reflexión:** el principio de mínimo privilegio limita el daño de los errores que todavía no encontramos. En un proyecto real cada servicio tiene su propio usuario de base con los permisos justos, las migraciones corren con otro usuario aparte y las claves viven en un gestor de secretos, nunca en el repo ni en el `docker-compose.yml`.

---

## E2 Credenciales por defecto

**Qué es y por qué importa:** la aplicación venía con cuentas de ejemplo con contraseñas triviales (`admin/admin`, `cliente/cliente`, `barista/cafe123`…), escritas en el código y además **mostradas en pantalla**, debajo del login del panel. Una cuenta admin con contraseña conocida es la forma más común de entrar a un sistema. OWASP A07:2021.

**Dónde está:**

- `src/config.ts`, líneas 36 a 39: `credencialesPorDefecto: { username: 'admin', password: 'admin' }`.
- `src/inicializar.ts`, líneas 23 a 48: las cinco cuentas con su contraseña escrita.
- `src/public/admin.html`, línea 45: el cartel `Usuarios de prueba: admin/admin · valentina/origen2024 · …`.
- `README.md`: la tabla de usuarios con cada contraseña.

**Cómo se observa:** en `http://localhost:8080/admin.html`, entrar con `admin` / `admin` (las mismas que muestra la pantalla). Se abre el panel completo.

📷 panel abierto con admin/admin

**Por qué ocurre:** las cuentas pensadas para probar quedaron con claves fáciles y publicadas, y no hay nada que obligue a cambiarlas.

**Cómo se corrige:**

- No hay claves de fábrica. Cada cuenta toma su clave de una variable del `.env` (`CLAVE_ADMIN`, `CLAVE_VALENTINA`, `CLAVE_BARISTA`, `CLAVE_MOZO`, `CLAVE_CLIENTE`). Si queda vacía, la app genera una al azar (`crypto.randomBytes`) y la muestra una sola vez en `docker compose logs app`.
- Se borró `credencialesPorDefecto` de `config.ts` (nadie la usaba).
- Se sacó el cartel del login del panel y la tabla del README ahora dice de qué variable sale cada clave.

```ts
// src/inicializar.ts
const variable = `CLAVE_${usuario.username.toUpperCase()}`;
const configurada = process.env[variable];
const clave = configurada || crypto.randomBytes(12).toString('base64url');
// ... se guarda bcrypt.hash(clave, RONDAS_BCRYPT)
if (rowCount && !configurada) {
  console.log(`[inicializar] Usuario "${usuario.username}" creado con la clave ${clave} (para elegirla, definí ${variable} en .env).`);
}
```

**Cómo se verifica:**

- `npm run check:security`: **AUTH-13** ✔.
- A mano: `admin` / `admin` responde `401` y no entra. El login del panel ya no muestra ninguna clave. Con la clave del `.env` se entra normalmente.

📷 login del panel sin el cartel · 📷 admin/admin rechazado

**Reflexión:** una cuenta de prueba es una cuenta real si el sistema está en línea. En un proyecto real no se entregan contraseñas por defecto: se generan al instalar o se pide crearlas en el primer ingreso, y nunca se publican en la interfaz ni en la documentación.

---

## E3 Secretos escritos en `config.ts`

**Qué es y por qué importa:** el usuario y la contraseña de la base y el secreto de sesión estaban escritos en el código. Todo el que tenga acceso al repositorio (o a una copia, un fork o un backup) tiene esas credenciales, y cambiarlas obliga a tocar el código. OWASP A05:2021.

**Dónde está:** `src/config.ts`:

```ts
user: process.env.DB_USER || 'postgres',          // línea 27
password: process.env.DB_PASSWORD || 'postgres',  // línea 28
sessionSecret: 'origen-cafe-2024',                // línea 33
```

**Cómo se observa:**

```bash
grep -n "postgres\|sessionSecret\|password" src/config.ts
```

Aparecen las credenciales `postgres` / `postgres` y el secreto `origen-cafe-2024`, que quedan para siempre en el historial de git.

📷 grep mostrando los secretos

**Por qué ocurre:** los valores por defecto "para que ande sin configurar nada" terminan siendo los secretos reales.

**Cómo se corrige:** `config.ts` lee las credenciales sólo del entorno y, si faltan, la app no arranca y dice cuál falta. El secreto de sesión, si no se define, se genera al azar en cada arranque:

```ts
function requerida(nombre: string): string {
  const valor = process.env[nombre];
  if (!valor) {
    throw new Error(`Falta la variable de entorno ${nombre} (ver .env.example).`);
  }
  return valor;
}

db: {
  // Usuario de aplicación con permisos reducidos (origen_app), nunca el superusuario.
  user: requerida('DB_USER'),
  password: requerida('DB_PASSWORD'),
},
sessionSecret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
```

`.env` está en `.gitignore`. En el repo sólo queda `.env.example`, con las variables vacías.

**Cómo se verifica:**

- `npm run check:security`: **CFG-02** ✔.
- A mano: el mismo `grep` ya no muestra ninguna clave. Sin `DB_PASSWORD` en el `.env`, `docker compose up` no levanta y avisa `Falta DB_PASSWORD en el .env`; corriendo la app fuera de Docker, tampoco arranca: `Falta la variable de entorno DB_PASSWORD (ver .env.example).`

📷 grep sin secretos

**Reflexión:** un secreto que entra al repo hay que darlo por filtrado, aunque después se borre, porque queda en el historial. En un proyecto real los secretos se cargan desde variables de entorno o un gestor (Vault, AWS Secrets Manager, los secretos del CI), se usa un escáner (gitleaks) antes de cada push y, si alguno se filtra, se rota.
