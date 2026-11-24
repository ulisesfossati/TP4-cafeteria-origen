import * as db from '../db';
import { calcularPrecio } from '../catalogo';
import type { Pedido, PedidoConItems, PedidoItem, Producto } from '../tipos';
import { entero, errorDeValidacion, texto } from '../validacion';

/** Topes de un pedido: lo que una mesa puede pedir de verdad. */
const MAX_ITEMS = 30;
const MAX_CANTIDAD = 50;
/** Mayor id que entra en una columna INTEGER de PostgreSQL. */
const MAX_ID = 2147483647;

/** Un renglón del pedido, tal como llega en el cuerpo de la petición. */
export interface ItemPedido {
  productoId: number;
  cantidad: number;
}

/** Pedido nuevo, tal como llega en el cuerpo de la petición. */
export interface NuevoPedido {
  mesa: string;
  cliente: string;
  items: ItemPedido[];
}

/** Id tal como llega en la URL (texto) o ya convertido. */
type Id = number | string;

/**
 * Servicio de pedidos.
 *
 * -----------------------------------------------------------------------------
 * FALLA — Validación de entrada débil o insuficiente (OWASP A04:2021)
 * -----------------------------------------------------------------------------
 * No se valida nada de lo que llega en el cuerpo de la petición:
 *  - `cantidad` puede ser negativa (el total del pedido queda negativo),
 *    cero, un número decimal o un texto.
 *  - No hay un máximo de items ni de cantidad (DoS / facturas absurdas).
 *  - `mesa` y `cliente` no se validan ni se acotan en longitud.
 *  - Si el productoId no existe, la excepción sube y se filtra el stack.
 *
 * La corrección es validar TIPO (entero), RANGO (1..N), LONGITUD y FORMATO
 * de cada campo en el servidor, usando listas blancas.
 * -----------------------------------------------------------------------------
 */

/**
 * Crea un pedido a partir de una lista de items { productoId, cantidad }.
 * Total = suma de calcularPrecio(producto) x cantidad
 */
export async function crear(datos: NuevoPedido): Promise<PedidoConItems | null> {
  // Los tipos de `NuevoPedido` no alcanzan: el cuerpo llega como `any` y en
  // ejecución puede traer cualquier cosa, así que cada campo se valida acá.
  const mesa = texto(datos.mesa, 'La mesa', 1, 10);
  const cliente = texto(datos.cliente, 'El nombre', 2, 40);
  const items: unknown = datos.items;
  if (!Array.isArray(items) || items.length < 1 || items.length > MAX_ITEMS) {
    throw errorDeValidacion(`El pedido tiene que tener entre 1 y ${MAX_ITEMS} productos.`);
  }

  const filas: { productoId: number; cantidad: number; precioUnitario: number }[] = [];

  for (const item of items) {
    const productoId = entero(item?.productoId, 'El producto', 1, MAX_ID);
    const cantidad = entero(item?.cantidad, 'La cantidad', 1, MAX_CANTIDAD);
    const producto = await buscarProducto(productoId);
    if (!producto) throw errorDeValidacion('Uno de los productos del pedido no existe.');
    filas.push({
      productoId: producto.id,
      cantidad,
      precioUnitario: calcularPrecio(producto),
    });
  }

  const total = filas.reduce(
    (acc, f) => acc + f.precioUnitario * f.cantidad,
    0
  );

  const { rows } = await db.query<Pedido>(
    `INSERT INTO pedidos (mesa, cliente, estado, total)
     VALUES ($1, $2, 'abierto', $3)
     RETURNING *`,
    [mesa, cliente, total]
  );
  const pedido = rows[0];

  for (const fila of filas) {
    await db.query(
      `INSERT INTO pedido_items (pedido_id, producto_id, cantidad, precio_unitario)
       VALUES ($1, $2, $3, $4)`,
      [pedido.id, fila.productoId, fila.cantidad, fila.precioUnitario]
    );
  }

  return obtenerConItems(pedido.id);
}

/** Busca un producto por id (helper interno). */
async function buscarProducto(productoId: number): Promise<Producto> {
  const { rows } = await db.query<Producto>('SELECT * FROM productos WHERE id = $1', [productoId]);
  return rows[0];
}

/** Lista pedidos (con filtro opcional por mesa). */
export async function listar(mesa?: string): Promise<Pedido[]> {
  // FALLA: inyección SQL en el filtro de mesa.
  let sql = 'SELECT * FROM pedidos';
  if (mesa) sql += ` WHERE mesa = '${mesa}'`;
  sql += ' ORDER BY id DESC';

  const { rows } = await db.query<Pedido>(sql);
  return rows;
}

/** Devuelve un pedido con sus items. */
export async function obtenerConItems(id: Id): Promise<PedidoConItems | null> {
  const { rows: pedidos } = await db.query<Pedido>(
    'SELECT * FROM pedidos WHERE id = $1',
    [id]
  );
  const pedido = pedidos[0];
  if (!pedido) return null;

  const { rows: items } = await db.query<PedidoItem>(
    `SELECT pi.*, pr.nombre AS producto_nombre
       FROM pedido_items pi
       JOIN productos pr ON pr.id = pi.producto_id
      WHERE pi.pedido_id = $1`,
    [id]
  );

  return { ...pedido, items };
}

/** Cambia el estado de un pedido. */
export async function cambiarEstado(id: Id, estado: string): Promise<Pedido | null> {
  const { rows } = await db.query<Pedido>(
    'UPDATE pedidos SET estado = $1 WHERE id = $2 RETURNING *',
    [estado, id]
  );
  return rows[0] || null;
}
