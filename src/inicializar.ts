import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import * as db from './db';
import { CATALOGO } from './catalogo';
import { RONDAS_BCRYPT } from './services/usuarios.service';
import type { Rol } from './tipos';

interface UsuarioInicial {
  username: string;
  rol: Rol;
  nombre: string;
}

/**
 * Carga los datos iniciales (usuarios y catálogo) si la base está vacía.
 *
 * Las contraseñas se guardan hasheadas con bcrypt (cada hash lleva su propia
 * sal), nunca en texto plano: si la base se filtra, no se leen las claves.
 */

export const USUARIOS_INICIALES: UsuarioInicial[] = [
  {
    username: 'admin',
    rol: 'admin',
    nombre: 'Administración',
  },
  {
    username: 'valentina',
    rol: 'admin',
    nombre: 'Valentina',
  },
  {
    username: 'barista',
    rol: 'barista',
    nombre: 'Barista',
  },
  {
    username: 'mozo',
    rol: 'mozo',
    nombre: 'Mozo de sala',
  },
  {
    username: 'cliente',
    rol: 'cliente',
    nombre: 'Cliente',
  },
];

export async function inicializarBase(): Promise<void> {
  // --- Usuarios -------------------------------------------------------------
  // Las bases creadas antes de este cambio tienen las contraseñas en claro:
  // se reemplazan por su hash una sola vez (un hash de bcrypt empieza con "$2").
  const { rows: enClaro } = await db.query<{ id: number; password: string }>(
    "SELECT id, password FROM usuarios WHERE password NOT LIKE '$2%'"
  );
  for (const usuario of enClaro) {
    await db.query('UPDATE usuarios SET password = $1 WHERE id = $2', [
      await bcrypt.hash(usuario.password, RONDAS_BCRYPT),
      usuario.id,
    ]);
  }

  // bcrypt es lento a propósito: sólo se hashea para los usuarios que faltan.
  const { rows: existentes } = await db.query<{ username: string }>('SELECT username FROM usuarios');
  const yaCargados = new Set(existentes.map((u) => u.username));

  for (const usuario of USUARIOS_INICIALES) {
    if (yaCargados.has(usuario.username)) continue;

    // No hay claves de fábrica: cada una sale del entorno (CLAVE_ADMIN,
    // CLAVE_BARISTA, ...) y, si falta, se genera una al azar que se muestra
    // una sola vez en el log del servidor.
    const variable = `CLAVE_${usuario.username.toUpperCase()}`;
    const configurada = process.env[variable];
    const clave = configurada || crypto.randomBytes(12).toString('base64url');

    const { rowCount } = await db.query(
      `INSERT INTO usuarios (username, password, rol, nombre)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (username) DO NOTHING`,
      [usuario.username, await bcrypt.hash(clave, RONDAS_BCRYPT), usuario.rol, usuario.nombre]
    );
    if (rowCount && !configurada) {
      console.log(`[inicializar] Usuario "${usuario.username}" creado con la clave ${clave} (para elegirla, definí ${variable} en .env).`);
    }
  }

  // --- Catálogo -------------------------------------------------------------
  for (const producto of CATALOGO) {
    await db.query(
      `INSERT INTO productos
         (nombre, tipo, variedad, tamano, gramos, precio_base, precio_por_gramo, descripcion)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (nombre) DO NOTHING`,
      [
        producto.nombre,
        producto.tipo,
        producto.variedad,
        producto.tamano,
        producto.gramos,
        producto.precio_base,
        producto.precio_por_gramo,
        producto.descripcion,
      ]
    );
  }
}
