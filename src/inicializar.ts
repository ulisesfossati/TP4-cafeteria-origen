import bcrypt from 'bcryptjs';
import * as db from './db';
import { CATALOGO } from './catalogo';
import { RONDAS_BCRYPT } from './services/usuarios.service';
import type { Rol } from './tipos';

interface UsuarioInicial {
  username: string;
  password: string;
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
    password: 'admin',
    rol: 'admin',
    nombre: 'Administración',
  },
  {
    username: 'valentina',
    password: 'origen2024',
    rol: 'admin',
    nombre: 'Valentina',
  },
  {
    username: 'barista',
    password: 'cafe123',
    rol: 'barista',
    nombre: 'Barista',
  },
  {
    username: 'mozo',
    password: 'mozo123',
    rol: 'mozo',
    nombre: 'Mozo de sala',
  },
  {
    username: 'cliente',
    password: 'cliente',
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
    await db.query(
      `INSERT INTO usuarios (username, password, rol, nombre)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (username) DO NOTHING`,
      [usuario.username, await bcrypt.hash(usuario.password, RONDAS_BCRYPT), usuario.rol, usuario.nombre]
    );
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
