/* =============================================================================
   Cafetería Origen — lógica del sitio público
   ============================================================================= */
(function () {
  'use strict';

  var API = '/api';
  var CARRITO_KEY = 'origen.carrito';

  var estado = {
    tipo: '',
    variedad: '',
    q: '',
    carrito: cargarCarrito(),
  };

  /* ---------------------------------------------------------------- utils */
  function $(sel) { return document.querySelector(sel); }

  function money(valor) {
    var n = Number(valor || 0);
    return n.toLocaleString('es-AR', { style: 'currency', currency: 'ARS' });
  }

  /**
   * Crea un elemento del DOM. El texto se asigna SIEMPRE con textContent:
   * el navegador lo trata como texto plano y nunca lo interpreta como HTML,
   * así que un "<script>" o un "<img onerror>" se ve escrito, no se ejecuta.
   *
   *   crear('span', 'tag', p.tipo)
   *   crear('div', 'fila', [hijo1, hijo2])
   */
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

  /** Reemplaza todo el contenido de un nodo por los hijos dados. */
  function reemplazar(nodo, hijos) {
    nodo.replaceChildren.apply(nodo, hijos || []);
  }

  /** Párrafo de "lista vacía" con el estilo del sitio. */
  function vacio(texto) {
    return crear('p', 'empty', texto);
  }

  function api(url, opciones) {
    return fetch(API + url, opciones).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        return { ok: res.ok, status: res.status, data: data };
      });
    });
  }

  function postJSON(url, cuerpo) {
    return api(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cuerpo || {}),
    });
  }

  function guardarCarrito() {
    try {
      localStorage.setItem(CARRITO_KEY, JSON.stringify(estado.carrito));
    } catch (e) { /* almacenamiento no disponible */ }
  }

  function cargarCarrito() {
    try {
      return JSON.parse(localStorage.getItem(CARRITO_KEY)) || [];
    } catch (e) {
      return [];
    }
  }

  /* ------------------------------------------------------------- catálogo */
  function urlCatalogo() {
    var params = new URLSearchParams();
    if (estado.tipo) params.set('tipo', estado.tipo);
    if (estado.variedad) params.set('variedad', estado.variedad);
    if (estado.q) params.set('q', estado.q);
    var s = params.toString();
    return '/productos' + (s ? '?' + s : '');
  }

  function cargarProductos() {
    return api(urlCatalogo()).then(function (resp) {
      if (!resp.ok) {
        renderErrorProductos(resp.data && resp.data.error);
        return;
      }
      renderProductos(resp.data.productos);
      renderResultado(resp.data.filtros, resp.data.total);
    });
  }

  function renderProductos(productos) {
    var grid = $('#productos-grid');

    if (!productos || productos.length === 0) {
      reemplazar(grid, [vacio('No encontramos productos con esos filtros.')]);
      return;
    }

    // Corrección XSS (#5): cada dato del servidor entra al DOM con
    // textContent (a través de crear()), nunca concatenado en un string HTML.
    reemplazar(grid, productos.map(function (p) {
      window.__productos[p.id] = p;

      var tags = [crear('span', 'tag', p.tipo)];
      if (p.variedad) tags.push(crear('span', 'tag tag-origen', p.variedad));
      if (p.tamano) tags.push(crear('span', 'tag', p.tamano));

      var boton = crear('button', 'btn btn-ghost btn-agregar', 'Agregar');
      boton.setAttribute('data-id', String(p.id));

      return crear('article', 'product-card', [
        crear('div', 'product-top', [
          crear('h3', 'product-name', p.nombre),
          crear('span', 'product-price', money(p.precio)),
        ]),
        crear('div', 'product-tags', tags),
        crear('p', 'product-desc', p.descripcion),
        boton,
      ]);
    }));
  }

  function renderResultado(filtros, total) {
    var el = $('#resultado-busqueda');

    // Corrección XSS reflejado (#5): el texto buscado va dentro de un
    // <strong> creado a mano y asignado con textContent.
    if (filtros && filtros.q) {
      reemplazar(el, [
        document.createTextNode('Resultados para '),
        crear('strong', null, filtros.q),
        document.createTextNode(' — ' + total + ' producto(s)'),
      ]);
    } else {
      el.textContent = total + ' producto(s) en el menú';
    }
  }

  function renderErrorProductos() {
    // No se repite el mensaje del servidor: un texto fijo no se puede inyectar.
    reemplazar($('#productos-grid'), [vacio('No se pudo cargar el menú. Probá de nuevo en un momento.')]);
  }

  /* --------------------------------------------------------------- carrito */
  function agregarAlCarrito(productoId) {
    var existente = null;
    for (var i = 0; i < estado.carrito.length; i++) {
      if (String(estado.carrito[i].id) === String(productoId)) existente = estado.carrito[i];
    }
    if (existente) {
      existente.cantidad += 1;
    } else {
      estado.carrito.push({
        id: productoId,
        nombre: window.__productos[productoId] ? window.__productos[productoId].nombre : 'Producto',
        precio: window.__productos[productoId] ? window.__productos[productoId].precio : 0,
        cantidad: 1,
      });
    }
    guardarCarrito();
    renderCarrito();
  }

  function cambiarCantidad(indice, delta) {
    var item = estado.carrito[indice];
    if (!item) return;
    item.cantidad += delta;
    if (item.cantidad <= 0) estado.carrito.splice(indice, 1);
    guardarCarrito();
    renderCarrito();
  }

  function quitarDelCarrito(indice) {
    estado.carrito.splice(indice, 1);
    guardarCarrito();
    renderCarrito();
  }

  function renderCarrito() {
    var cont = $('#carrito');
    var lista = $('#resumen-carrito');
    var total = 0;

    if (estado.carrito.length === 0) {
      reemplazar(cont, [vacio('El carrito está vacío.')]);
      reemplazar(lista, []);
      $('#resumen-total').textContent = money(0);
      return;
    }

    // El carrito sale de localStorage: también es entrada no confiable.
    function botonCarrito(accion, i, texto, clase) {
      var b = crear('button', clase || null, texto);
      b.type = 'button';
      b.setAttribute('data-acc', accion);
      b.setAttribute('data-i', String(i));
      return b;
    }

    reemplazar(cont, estado.carrito.map(function (item, i) {
      var subtotal = item.precio * item.cantidad;
      total += subtotal;
      return crear('div', 'cart-item', [
        crear('div', null, [
          crear('div', 'cart-item-name', item.nombre),
          crear('div', 'cart-item-meta', money(item.precio) + ' c/u'),
        ]),
        crear('div', 'qty-control', [
          botonCarrito('menos', i, '−'),
          crear('span', null, item.cantidad),
          botonCarrito('mas', i, '+'),
        ]),
        crear('div', null, [
          crear('div', 'cart-item-price', money(subtotal)),
          botonCarrito('quitar', i, 'Quitar', 'link-danger'),
        ]),
      ]);
    }));

    reemplazar(lista, estado.carrito.map(function (item) {
      return crear('li', null, [
        crear('span', null, item.nombre + ' × ' + item.cantidad),
        crear('span', null, money(item.precio * item.cantidad)),
      ]);
    }));

    $('#resumen-total').textContent = money(total);
  }

  /* ---------------------------------------------------------------- pedidos */
  function enviarPedido(evento) {
    evento.preventDefault();
    var feedback = $('#pedido-feedback');
    feedback.className = 'form-feedback';
    feedback.textContent = 'Enviando…';

    postJSON('/pedidos', {
      mesa: $('#pedido-mesa').value,
      cliente: $('#pedido-cliente').value,
      items: estado.carrito.map(function (item) {
        return { productoId: item.id, cantidad: item.cantidad };
      }),
    }).then(function (resp) {
      if (!resp.ok) {
        // Corrección XSS reflejado (#5): el mensaje del servidor va como texto.
        feedback.className = 'form-feedback is-error';
        feedback.textContent = 'No pudimos enviar el pedido: ' + (resp.data.error || 'error desconocido');
        return;
      }
      feedback.className = 'form-feedback is-ok';
      feedback.textContent = '¡Pedido #' + resp.data.id + ' recibido! Total ' + money(resp.data.total) +
        '. Te atendemos en la mesa ' + resp.data.mesa + '.';
      estado.carrito = [];
      guardarCarrito();
      renderCarrito();
      $('#form-pedido').reset();
    }).catch(function () {
      feedback.className = 'form-feedback is-error';
      feedback.textContent = 'Error de conexión con el servidor.';
    });
  }

  /* --------------------------------------------------------------- reseñas */
  function cargarReseñas() {
    return api('/comentarios').then(function (resp) {
      var cont = $('#lista-resenas');
      if (!resp.ok || !resp.data.comentarios || resp.data.comentarios.length === 0) {
        reemplazar(cont, [vacio('Todavía no hay reseñas. ¡Sé el primero!')]);
        return;
      }
      // Corrección XSS almacenado (#6): autor y texto vienen de la base,
      // escritos por cualquier visitante. Se pintan con textContent, así que
      // una reseña con "<script>" se lee como texto y no se ejecuta.
      reemplazar(cont, resp.data.comentarios.map(function (c) {
        // La calificación se acota a 0..5 por si en la base quedó algo raro.
        var n = Math.max(0, Math.min(5, Math.floor(Number(c.calificacion) || 0)));
        return crear('article', 'review', [
          crear('div', 'review-head', [
            crear('span', 'review-author', c.autor),
            crear('span', 'review-stars', '★'.repeat(n)),
          ]),
          crear('p', 'review-text', c.texto),
        ]);
      }));
    });
  }

  function enviarReseña(evento) {
    evento.preventDefault();
    var feedback = $('#resena-feedback');
    feedback.className = 'form-feedback';
    feedback.textContent = 'Publicando…';

    postJSON('/comentarios', {
      autor: $('#resena-autor').value,
      texto: $('#resena-texto').value,
      calificacion: Number($('#resena-calificacion').value),
    }).then(function (resp) {
      if (!resp.ok) {
        feedback.className = 'form-feedback is-error';
        feedback.textContent = 'No se pudo publicar: ' + (resp.data.error || 'error desconocido');
        return;
      }
      feedback.className = 'form-feedback is-ok';
      feedback.textContent = '¡Gracias por tu reseña!';
      $('#form-resena').reset();
      cargarReseñas();
    });
  }

  /* ------------------------------------------------------------- listeners */
  function init() {
    window.__productos = {};

    // Filtros
    document.querySelectorAll('.chip').forEach(function (chip) {
      chip.addEventListener('click', function () {
        document.querySelectorAll('.chip').forEach(function (c) { c.classList.remove('is-active'); });
        chip.classList.add('is-active');
        estado.tipo = chip.getAttribute('data-tipo');
        cargarProductos();
      });
    });

    $('#filtro-variedad').addEventListener('change', function (e) {
      estado.variedad = e.target.value;
      cargarProductos();
    });

    var temporizador = null;
    $('#filtro-busqueda').addEventListener('input', function (e) {
      estado.q = e.target.value;
      clearTimeout(temporizador);
      temporizador = setTimeout(cargarProductos, 250);
    });

    // Carrito (delegación de eventos)
    $('#productos-grid').addEventListener('click', function (e) {
      var btn = e.target.closest('.btn-agregar');
      if (!btn) return;
      agregarAlCarrito(btn.getAttribute('data-id'));
    });

    $('#carrito').addEventListener('click', function (e) {
      var btn = e.target.closest('button');
      if (!btn) return;
      var i = Number(btn.getAttribute('data-i'));
      var accion = btn.getAttribute('data-acc');
      if (accion === 'mas') cambiarCantidad(i, 1);
      else if (accion === 'menos') cambiarCantidad(i, -1);
      else if (accion === 'quitar') quitarDelCarrito(i);
    });

    $('#form-pedido').addEventListener('submit', enviarPedido);
    $('#form-resena').addEventListener('submit', enviarReseña);

    // Carga inicial
    api(urlCatalogo()).then(function (resp) {
      if (resp.ok) {
        (resp.data.productos || []).forEach(function (p) { window.__productos[p.id] = p; });
        renderProductos(resp.data.productos);
        renderResultado(resp.data.filtros, resp.data.total);
      } else {
        renderErrorProductos(resp.data.error);
      }
    });
    cargarReseñas();
    renderCarrito();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
