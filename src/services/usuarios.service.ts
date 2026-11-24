import * as db from '../db';
import type { Usuario } from '../tipos';

/**
 * Servicio de usuarios.
 *
 * -----------------------------------------------------------------------------
 * FALLA — Inyección SQL (OWASP A03:2021)
 * -----------------------------------------------------------------------------
 * La consulta del login concatena el usuario y la contraseña directamente
 * dentro del texto SQL. El motor de PostgreSQL interpreta las comillas y los
 * operadores que venga en la entrada, de modo que la condición se puede
 * reescribir por completo y devolver una fila válida sin conocer la clave.
 *
 * Además:
 *  - La contraseña se compara en texto plano (almacenamiento inseguro).
 *  - El mensaje de error distingue "usuario inexistente" de "contraseña
 *    incorrecta" (enumeración de usuarios).
 *  - No hay límite de intentos (fuerza bruta).
 *
 * Corrección: consultas parametrizadas (`WHERE username = $1 AND password = $2`
 * con bcrypt.compare), mensaje genérico de error, y rate limiting + bloqueo
 * temporal en el endpoint de login.
 * -----------------------------------------------------------------------------
 */

/** Busca un usuario por nombre de usuario exacto (query parametrizada). */
export async function buscarPorUsername(username: string): Promise<Usuario | null> {
  const { rows } = await db.query<Usuario>(
    'SELECT * FROM usuarios WHERE username = $1',
    [username]
  );
  return rows[0] || null;
}

/**
 * Autentica a un usuario comparando usuario y contraseña.
 * Devuelve el usuario o null.
 */
export async function autenticar(username: string, password: string): Promise<Usuario | null> {
  // El cuerpo de la petición puede traer cualquier cosa (un array, un objeto).
  if (typeof username !== 'string' || typeof password !== 'string') return null;

  const { rows } = await db.query<Usuario>(
    'SELECT * FROM usuarios WHERE username = $1 AND password = $2',
    [username, password]
  );
  return rows[0] || null;
}

/** Lista todos los usuarios (para el panel de administración). */
export async function listar(): Promise<Usuario[]> {
  const { rows } = await db.query<Usuario>('SELECT * FROM usuarios ORDER BY id');
  return rows;
}

/**
 * Actualiza un usuario.
 * FALLA — Asignación masiva / escalada de privilegios: se actualiza el rol
 * sin verificar que quien llama tenga permiso para hacerlo.
 */
export async function actualizar(id: number | string, cambios: Partial<Usuario>): Promise<Usuario | null> {
  const campos: string[] = [];
  const valores: unknown[] = [];
  let i = 1;
  for (const [campo, valor] of Object.entries(cambios)) {
    campos.push(`${campo} = $${i}`);
    valores.push(valor);
    i += 1;
  }
  if (campos.length === 0) return null;
  valores.push(id);
  const { rows } = await db.query<Usuario>(
    `UPDATE usuarios SET ${campos.join(', ')} WHERE id = $${i} RETURNING *`,
    valores
  );
  return rows[0] || null;
}

/** Cambia la contraseña de un usuario (se guarda en texto plano). */
export async function cambiarPassword(id: number, nuevaPassword: string): Promise<Usuario | null> {
  const { rows } = await db.query<Usuario>(
    'UPDATE usuarios SET password = $1 WHERE id = $2 RETURNING *',
    [nuevaPassword, id]
  );
  return rows[0] || null;
}
