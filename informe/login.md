# Informe · Login y sesión

**Integrante:** Fede · **Fallas:** #12, #13, #14, #15, #16 y #17

**Ramas:**

| Rama | Fallas |
|---|---|
| `feature/sesión-segura` | #13, #14, #15 |
| `feature/login-seguro` | #12, #16, #17 |

**Archivos:** `src/middleware/sesion.ts` y `src/routes/auth.routes.ts`.

> Las partes marcadas con **[COMPLETAR]** son la evidencia de lo que viste vos a mano (capturas, mensajes, valores). Hay que reemplazarlas con lo que realmente observaste antes de entregar.

---

## #12 Sin protección contra fuerza bruta

**Qué es y por qué importa:** Si el login deja probar contraseñas sin límite, un atacante puede probar miles de combinaciones hasta dar con la correcta. Cuanto más débil es la clave, menos tarda.

**Dónde está:** `src/routes/auth.routes.ts`, ruta `POST /login`.

**Cómo se observa:** En el formulario del panel, equivocarse diez veces seguidas con el mismo usuario. Todas las respuestas son `401` con el mismo mensaje y nunca aparece un bloqueo, un retardo ni un aviso. Se hizo a mano, sin scripts. **[COMPLETAR: captura de F12 → Red con los 10 intentos, `informe/img/12-antes.png`]**

**Por qué ocurre:** El endpoint no lleva la cuenta de los intentos fallidos ni limita la frecuencia de las peticiones.

**Cómo se corrige:** Se agregaron dos límites con `express-rate-limit` sobre `/login`, que cuentan solo los intentos fallidos (`skipSuccessfulRequests: true`): 5 fallos cada 15 minutos por cuenta y 20 por IP. Pasado el tope, el servidor responde `429`. El límite por cuenta frena a quien prueba muchas claves contra un usuario; el límite por IP frena a quien prueba muchos usuarios desde un mismo lugar.

```ts
const limitePorCuenta = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  skipSuccessfulRequests: true,
  keyGenerator: (req) => 'cuenta:' + String(req.body?.username ?? '').toLowerCase(),
  message: MENSAJE_BLOQUEO,
});

router.post('/login', limitePorIp, limitePorCuenta, async (req, res, next) => { ... });
```

**Cómo se verifica:** Pasó el test *"el login bloquea o limita los intentos repetidos"* en `npm run test:seguridad` y el control `AUTH-04` en `npm run check:security`. A mano: en el sexto intento fallido seguido el servidor responde `429`. **[COMPLETAR: captura, `informe/img/12-despues.png`]**

**Reflexión:** El límite en memoria se pierde al reiniciar la app y no se comparte entre varias instancias. En un proyecto real conviene guardarlo en un almacén compartido (por ejemplo Redis) y sumar un captcha, alertas por intentos sospechosos y un segundo factor de autenticación.

---

## #13 Cookie de sesión sin HttpOnly, Secure ni SameSite

**Qué es y por qué importa:** La cookie `sid` es la llave de la sesión. Sin `HttpOnly`, cualquier JavaScript de la página (por ejemplo, el de un XSS) puede leerla y robarla. Sin `Secure`, viaja en texto plano por HTTP. Sin `SameSite`, el navegador la manda también en peticiones que salen de otros sitios, lo que facilita el CSRF.

**Dónde está:** `src/middleware/sesion.ts`, función `crearSesion`.

**Cómo se observa:** En F12 → Aplicación → Cookies, la cookie `sid` tenía vacías las columnas HttpOnly, Secure y SameSite. En la consola, `document.cookie` mostraba el valor del ID de sesión. **[COMPLETAR: capturas, `informe/img/13-antes.png`]**

**Por qué ocurre:** La cookie se creaba con `res.cookie('sid', id, { path: '/' })`, sin ninguna opción de seguridad.

**Cómo se corrige:** Se definieron las opciones en un solo lugar y se usan al crear la cookie:

```ts
export const OPCIONES_COOKIE = {
  path: '/',
  httpOnly: true,
  secure: config.nodeEnv === 'production',
  sameSite: 'lax' as const,
};

res.cookie('sid', id, { ...OPCIONES_COOKIE, maxAge: INACTIVIDAD_MAX_MS });
```

La bandera `Secure` se activa en producción, donde el sitio se sirve por HTTPS. En desarrollo la demo corre por HTTP y una cookie `Secure` no se guarda ni se reenvía, lo que rompía el test funcional de `/api/auth/yo`. Es el mismo criterio que ya usa `middleware/csrf.ts` con la cookie anti-CSRF.

**Cómo se verifica:** Pasó el test *"la cookie de sesión lleva HttpOnly, Secure y SameSite"* y los controles `AUTH-05`, `AUTH-06` y `CSRF-02`. En F12 la cookie ahora muestra HttpOnly y SameSite=Lax, y `document.cookie` ya no devuelve el `sid`. **[COMPLETAR: captura, `informe/img/13-despues.png`]**

**Reflexión:** En un proyecto real el sitio se sirve siempre por HTTPS, con `Secure` activo y HSTS, y las cookies de sesión llevan el prefijo `__Host-`. Además, `HttpOnly` reduce el daño de un XSS pero no lo elimina: sigue siendo necesario evitar el XSS.

---

## #14 ID de sesión predecible

**Qué es y por qué importa:** Si el ID de sesión se puede adivinar, cualquiera puede hacerse pasar por otro usuario sin conocer su contraseña.

**Dónde está:** `src/middleware/sesion.ts`, función `crearSesion`.

**Cómo se observa:** Se inició sesión con dos usuarios, uno en una ventana normal y otro en una privada. Los valores de la cookie eran `sesion_1` y `sesion_2`. Al pegar en una ventana el valor de la otra, la sesión pasaba a ser la del otro usuario. **[COMPLETAR: capturas con los dos valores, `informe/img/14-antes.png`]**

**Por qué ocurre:** El ID salía de un contador que se incrementaba en cada login, no de un generador aleatorio.

**Cómo se corrige:** El ID se genera con el generador criptográfico de Node, con 256 bits de aleatoriedad. Además, al iniciar sesión se descarta la sesión que pudiera traer la cookie anterior, para evitar la fijación de sesión.

```ts
destruirSesion(req);                          // anti fijación de sesión
const id = randomBytes(32).toString('hex');   // 64 caracteres hexadecimales
```

**Cómo se verifica:** Pasó el test *"el identificador de sesión es aleatorio y no predecible"* y los controles `AUTH-07` y `AUTH-08`. A mano, la cookie ahora es un valor largo e irrepetible, y cambiarlo por otro inventado devuelve `401`. **[COMPLETAR: captura, `informe/img/14-despues.png`]**

**Reflexión:** En un proyecto real no se programa a mano el manejo de sesiones: se usa una librería probada (como `express-session`) con un almacén externo, que ya resuelve la generación del ID, la expiración y la regeneración tras el login.

---

## #15 Sesiones que nunca expiran

**Qué es y por qué importa:** Una sesión eterna sirve para siempre si alguien se queda con la cookie: en una computadora compartida, un navegador olvidado o una cookie robada.

**Dónde está:** `src/middleware/sesion.ts`, funciones `crearSesion` y `obtenerSesion`.

**Cómo se observa:** En el código, la sesión se guardaba con `expiraEn: null` y nunca se comparaba con ninguna hora. En F12 → Cookies, la cookie no tenía fecha de vencimiento. **[COMPLETAR: captura, `informe/img/15-antes.png`]**

**Por qué ocurre:** No se definió ninguna duración para la sesión ni se verificaba al usarla.

**Cómo se corrige:** Se definieron dos límites. Por inactividad: 30 minutos, que se renuevan cada vez que se usa la sesión. Absoluto: 8 horas desde el login, sin importar la actividad. Al vencer, la sesión se borra del servidor y la petición recibe `401`. La cookie también lleva `maxAge`.

```ts
const porInactividad = sesion.expiraEn !== null && ahora > sesion.expiraEn;
const porDuracionMaxima = ahora - sesion.creadaEn > DURACION_MAX_MS;
if (porInactividad || porDuracionMaxima) {
  sesiones.delete(id);   // se borra del servidor, no solo se ignora
  return null;
}
sesion.expiraEn = ahora + INACTIVIDAD_MAX_MS;   // se renueva con el uso
```

**Cómo se verifica:** Pasaron los controles `AUTH-09` y `AUTH-10` del checklist, y en F12 la cookie ahora muestra una fecha de vencimiento. **[COMPLETAR: captura, `informe/img/15-despues.png`]**

**Reflexión:** Los tiempos de expiración deberían ser configurables por entorno y ajustados al riesgo de la aplicación (un panel de administración justifica sesiones más cortas). Además, conviene limpiar periódicamente las sesiones vencidas que nadie volvió a usar, para que no se acumulen en memoria.

---

## #16 Logout que no invalida la sesión

**Qué es y por qué importa:** Si "cerrar sesión" solo borra la cookie del navegador, quien haya copiado esa cookie antes sigue dentro. Cerrar sesión no cierra nada.

**Dónde está:** `src/routes/auth.routes.ts`, ruta `POST /logout`.

**Cómo se observa:** Se copió el valor de la cookie `sid`, se cerró sesión y se volvió a pegar ese valor a mano en F12 → Cookies. Al recargar, `/api/auth/yo` seguía devolviendo el usuario. **[COMPLETAR: capturas, `informe/img/16-antes.png`]**

**Por qué ocurre:** El logout llamaba a `res.clearCookie`, que solo le dice al navegador que borre su copia. La sesión seguía en el `Map` del servidor.

**Cómo se corrige:** El logout borra la sesión del almacén del servidor y además limpia la cookie:

```ts
router.post('/logout', (req, res) => {
  destruirSesion(req);
  res.clearCookie('sid', { path: '/' });
  res.json({ mensaje: 'Sesión cerrada.' });
});
```

**Cómo se verifica:** Pasó el test *"el logout invalida la sesión en el servidor"* y el control `AUTH-11`. A mano, repetir la prueba devuelve `401`. **[COMPLETAR: captura, `informe/img/16-despues.png`]**

**Reflexión:** La invalidación tiene que ocurrir siempre del lado del servidor. En un proyecto real también convendría poder cerrar todas las sesiones de un usuario (por ejemplo, al cambiar su contraseña o ante una sospecha de robo).

---

## #17 Enumeración de usuarios

**Qué es y por qué importa:** Si el login responde distinto cuando el usuario no existe y cuando la clave es incorrecta, un atacante puede averiguar qué cuentas existen y concentrar ahí sus intentos.

**Dónde está:** `src/routes/auth.routes.ts`, ruta `POST /login`.

**Cómo se observa:** Se probó `noexiste` / `123` y `barista` / `123`. Los mensajes eran distintos, y el del usuario inexistente incluso repetía el nombre escrito. **[COMPLETAR: captura de las dos respuestas, `informe/img/17-antes.png`]**

**Por qué ocurre:** Cuando la verificación fallaba, el código consultaba si el usuario existía y devolvía un mensaje diferente en cada caso.

**Cómo se corrige:** Un único mensaje y un único código para los dos casos, sin repetir lo que escribió quien llama. Esto además elimina un XSS reflejado: el mensaje viejo devolvía el nombre de usuario tal cual.

```ts
if (!usuario) {
  return res.status(401).json({ error: 'Usuario o contraseña incorrectos.' });
}
```

**Cómo se verifica:** Pasaron los tests *"los mensajes de login son genéricos"* y *"el login NO devuelve HTML sin escapar en el mensaje de error"*, y el control `AUTH-12`. A mano, las dos pruebas devuelven la misma respuesta. **[COMPLETAR: captura, `informe/img/17-despues.png`]**

**Reflexión:** Para que la respuesta no delate nada, también deberían parecerse los tiempos de respuesta: el login de un usuario inexistente no debería ser notablemente más rápido que el de uno existente. Lo mismo vale para los formularios de registro y de recuperación de contraseña.
