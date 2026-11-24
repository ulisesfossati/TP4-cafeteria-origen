import express from 'express';
import * as comentarios from '../services/comentarios.service';

const router = express.Router();

/**
 * GET /api/comentarios — reseñas públicas de la cafetería.
 * El sitio las pinta con innerHTML: por eso son un vector de XSS almacenado.
 */
router.get('/', async (req, res, next) => {
  try {
    res.json({ comentarios: await comentarios.listar() });
  } catch (err) {
    next(err);
  }
});

/** Límites de una reseña (E1). */
const AUTOR_MIN = 2;
const AUTOR_MAX = 40;
const TEXTO_MIN = 3;
const TEXTO_MAX = 280;
const MENSAJE_RESENA_INVALIDA =
  'Reseña inválida: el nombre debe tener de 2 a 40 caracteres, el mensaje de 3 a 280 ' +
  'y la calificación ser un entero de 1 a 5.';

/**
 * Valida el cuerpo de una reseña. Devuelve los datos limpios o null.
 * Lista blanca de lo que SÍ se acepta: strings con longitud acotada y una
 * calificación entera de 1 a 5. Cualquier otra cosa se rechaza.
 */
function validarResena(cuerpo: unknown): comentarios.NuevoComentario | null {
  if (!cuerpo || typeof cuerpo !== 'object') return null;
  const { autor, texto, calificacion } = cuerpo as Record<string, unknown>;

  if (typeof autor !== 'string' || typeof texto !== 'string') return null;
  const autorLimpio = autor.trim();
  const textoLimpio = texto.trim();
  if (autorLimpio.length < AUTOR_MIN || autorLimpio.length > AUTOR_MAX) return null;
  if (textoLimpio.length < TEXTO_MIN || textoLimpio.length > TEXTO_MAX) return null;

  const nota = typeof calificacion === 'string' ? Number(calificacion) : calificacion;
  if (typeof nota !== 'number' || !Number.isInteger(nota) || nota < 1 || nota > 5) return null;

  return { autor: autorLimpio, texto: textoLimpio, calificacion: nota };
}

/**
 * POST /api/comentarios
 *
 * Corrección E1: el servidor valida longitud y rango antes de guardar.
 * (El XSS almacenado, #6, se corrige en el cliente pintando con textContent.)
 */
router.post('/', async (req, res, next) => {
  try {
    const datos = validarResena(req.body);
    if (!datos) {
      // Mensaje fijo: no se repite nada de lo que mandó el cliente.
      return res.status(400).json({ error: MENSAJE_RESENA_INVALIDA });
    }
    const comentario = await comentarios.crear(datos);
    res.status(201).json(comentario);
  } catch (err) {
    next(err);
  }
});

/** DELETE /api/comentarios/:id */
router.delete('/:id', async (req, res, next) => {
  try {
    // FALLA: sin verificación de rol — cualquiera puede borrar reseñas.
    const comentario = await comentarios.eliminar(req.params.id);
    if (!comentario) {
      return res.status(404).json({ error: 'Comentario no encontrado.' });
    }
    res.json(comentario);
  } catch (err) {
    next(err);
  }
});

export default router;
