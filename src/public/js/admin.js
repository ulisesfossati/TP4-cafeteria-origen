/* =============================================================================
   Cafetería Origen — lógica del panel de administración
   ============================================================================= */
(function () {
  'use strict';

  var API = '/api';
  var usuario = null;
  var productosCache = {};

  function $(sel) { return document.querySelector(sel); }
  function $$(sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); }

  function money(valor) {
    return Number(valor || 0).toLocaleString('es-AR', { style: 'currency', currency: 'ARS' });
  }

  /* --------------------------------------------------------- DOM seguro */
  // Todo lo que viene del servidor o de la URL entra al DOM con textContent
  // (a través de estos helpers). Nunca se arma HTML concatenando strings.

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

  function reemplazar(nodo, hijos) {
    nodo.replaceChildren.apply(nodo, hijos || []);
  }

  /** Celda de tabla: acepta texto o un nodo ya armado. */
  function celda(contenido, clase, tag) {
    if (contenido instanceof Node) return crear(tag || 'td', clase, [contenido]);
    return crear(tag || 'td', clase, contenido == null ? '' : contenido);
  }

  /** Arma <thead> a partir de una lista de títulos ('Total|num' → clase num). */
  function encabezado(titulos) {
    return crear('thead', null, [crear('tr', null, titulos.map(function (t) {
      var partes = t.split('|');
      return celda(partes[0], partes[1] || null, 'th');
    }))]);
  }

  /** <select> con opciones fijas (lista blanca) y la actual seleccionada. */
  function selector(clase, atributo, id, opciones, actual) {
    var sel = crear('select', clase);
    sel.setAttribute(atributo, String(id));
    opciones.forEach(function (valor) {
      var op = crear('option', null, valor);
      op.value = valor;
      if (valor === actual) op.selected = true;
      sel.appendChild(op);
    });
    return sel;
  }

  function renderKpis(contenedor, kpis) {
    reemplazar(contenedor, kpis.map(function (k) {
      return crear('div', 'kpi', [
        crear('div', 'kpi-label', k.label),
        crear('div', 'kpi-value', k.value),
      ]);
    }));
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

  function putJSON(url, cuerpo) {
    return api(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cuerpo || {}),
    });
  }

  function patchJSON(url, cuerpo) {
    return api(url, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cuerpo || {}),
    });
  }

  function feedback(el, mensaje, ok) {
    el.className = 'form-feedback ' + (ok ? 'is-ok' : 'is-error');
    // Corrección XSS reflejado (#5): los mensajes (que pueden traer texto del
    // servidor o del usuario) se muestran como texto plano.
    el.textContent = mensaje;
  }

  /* ------------------------------------------------------------------ login */
  function iniciarSesion(evento) {
    evento.preventDefault();
    var caja = $('#login-feedback');
    caja.className = 'form-feedback';

    postJSON('/auth/login', {
      username: $('#login-usuario').value,
      password: $('#login-password').value,
    }).then(function (resp) {
      if (!resp.ok) {
        // feedback() usa textContent: aunque el servidor repitiera el usuario
        // enviado, no se interpreta como HTML.
        feedback(caja, 'No pudimos iniciar sesión: ' + (resp.data.error || 'error desconocido'), false);
        return;
      }
      usuario = resp.data.usuario;
      mostrarPanel();
    });
  }

  function cerrarSesion() {
    postJSON('/auth/logout', {}).then(function () {
      usuario = null;
      $('#vista-login').hidden = false;
      $('#vista-panel').hidden = true;
      reemplazar($('#admin-user'), []);
    });
  }

  function mostrarPanel() {
    $('#vista-login').hidden = true;
    $('#vista-panel').hidden = false;
    reemplazar($('#admin-user'), [
      document.createTextNode('Sesión de '),
      crear('strong', null, usuario.nombre),
      document.createTextNode(' · rol: '),
      crear('strong', null, usuario.rol),
    ]);
    $('#panel-bienvenida').textContent = 'Hola, ' + usuario.nombre;
    cargarTodo();
  }

  function cargarTodo() {
    cargarResumen();
    cargarPedidos();
    cargarProductos();
    cargarReportes();
    cargarUsuarios();
  }

  /* ---------------------------------------------------------------- resumen */
  function cargarResumen() {
    api('/reportes/facturacion').then(function (f) {
      api('/reportes/mas-vendido').then(function (m) {
        api('/reportes/cantidad-vendida').then(function (c) {
          var mas = m.data.producto;
          var kpis = [
            { label: 'Facturación total', value: money(f.data.facturado) },
            { label: 'Pedidos registrados', value: f.data.pedidos },
            {
              label: 'Producto más vendido',
              value: mas ? mas.nombre : '—',
            },
            {
              label: 'Unidades por tipo',
              value: Object.keys(c.data.cantidadVendida || {})
                .map(function (k) { return k + ': ' + c.data.cantidadVendida[k]; })
                .join(' · ') || '—',
            },
          ];

          renderKpis($('#kpis'), kpis);
        });
      });
    });
  }

  /* --------------------------------------------------------------- pedidos */
  var ESTADOS_PEDIDO = ['abierto', 'preparando', 'listo', 'entregado'];

  function tablaPedidos(filas, conAcciones) {
    if (!filas || filas.length === 0) return [crear('p', 'empty', 'No hay pedidos.')];

    var titulos = ['#', 'Mesa', 'Cliente', 'Estado', 'Total|num', 'Fecha'];
    if (conAcciones) titulos.push('Acciones');

    var cuerpo = crear('tbody', null, filas.map(function (p) {
      // La clase del badge sólo se arma con un estado de la lista blanca.
      var claseEstado = ESTADOS_PEDIDO.indexOf(p.estado) >= 0 ? ' badge-' + p.estado : '';
      var celdas = [
        celda(p.id),
        celda(p.mesa),
        celda(p.cliente),
        celda(crear('span', 'badge' + claseEstado, p.estado)),
        celda(money(p.total), 'num'),
        celda(new Date(p.creado_en).toLocaleString('es-AR')),
      ];
      if (conAcciones) {
        celdas.push(celda(selector('sel-estado', 'data-pedido', p.id, ESTADOS_PEDIDO, p.estado)));
      }
      return crear('tr', null, celdas);
    }));

    return [encabezado(titulos), cuerpo];
  }

  function cargarPedidos() {
    api('/pedidos').then(function (resp) {
      var pedidos = resp.data.pedidos || [];
      reemplazar($('#tabla-pedidos'), tablaPedidos(pedidos, true));
      reemplazar($('#tabla-ultimos'), tablaPedidos(pedidos.slice(0, 5), false));
    });
  }

  function cambiarEstado(evento) {
    var select = evento.target.closest('.sel-estado');
    if (!select) return;
    var id = select.getAttribute('data-pedido');
    patchJSON('/pedidos/' + id + '/estado', { estado: select.value }).then(function (resp) {
      if (!resp.ok) {
        alert('No se pudo cambiar el estado: ' + (resp.data.error || 'error'));
      }
      cargarPedidos();
    });
  }

  /* ------------------------------------------------------------- productos */
  function cargarProductos() {
    api('/productos').then(function (resp) {
      var productos = resp.data.productos || [];
      productosCache = {};

      var cuerpo = crear('tbody', null, productos.map(function (p) {
        productosCache[p.id] = p;
        var borrar = crear('button', 'link-danger', 'Borrar');
        borrar.setAttribute('data-borrar', String(p.id));
        return crear('tr', null, [
          celda(p.id),
          celda(p.nombre),
          celda(p.tipo),
          celda(p.variedad || '—'),
          celda(money(p.precio), 'num'),
          celda(borrar),
        ]);
      }));

      reemplazar($('#tabla-productos'), [
        encabezado(['#', 'Nombre', 'Tipo', 'Origen', 'Precio|num', 'Acciones']),
        cuerpo,
      ]);
    });
  }

  function guardarProducto(evento) {
    evento.preventDefault();
    var caja = $('#producto-feedback');
    var id = $('#producto-id').value;

    var cuerpo = {
      nombre: $('#p-nombre').value,
      tipo: $('#p-tipo').value,
      variedad: $('#p-variedad').value || null,
      tamano: $('#p-tamano').value || null,
      gramos: $('#p-gramos').value ? Number($('#p-gramos').value) : null,
      precio_base: Number($('#p-precio-base').value || 0),
      precio_por_gramo: Number($('#p-precio-gramo').value || 0),
      descripcion: $('#p-descripcion').value,
    };

    var peticion = id ? putJSON('/admin/productos/' + id, cuerpo) : postJSON('/admin/productos', cuerpo);

    peticion.then(function (resp) {
      if (!resp.ok) {
        feedback(caja, 'No se pudo guardar: ' + (resp.data.error || 'error desconocido'), false);
        return;
      }
      feedback(caja, 'Producto guardado correctamente.', true);
      $('#form-producto').reset();
      $('#producto-id').value = '';
      cargarProductos();
    });
  }

  function borrarProducto(evento) {
    var btn = evento.target.closest('[data-borrar]');
    if (!btn) return;
    var id = btn.getAttribute('data-borrar');
    if (!confirm('¿Borrar el producto #' + id + '?')) return;

    api('/admin/productos/' + id, { method: 'DELETE' }).then(function (resp) {
      if (!resp.ok) alert('No se pudo borrar: ' + (resp.data.error || 'error'));
      cargarProductos();
    });
  }

  function limpiarFormularioProducto() {
    $('#form-producto').reset();
    $('#producto-id').value = '';
  }

  /* ---------------------------------------------------------------- upload */
  function subirArchivo(evento) {
    evento.preventDefault();
    var caja = $('#upload-feedback');
    var input = $('#archivo-subida');
    if (!input.files || !input.files[0]) {
      feedback(caja, 'Elegí un archivo primero.', false);
      return;
    }

    var archivo = input.files[0];
    var lector = new FileReader();

    lector.onload = function () {
      var base64 = String(lector.result).split(',')[1] || '';
      postJSON('/admin/subir-archivo', {
        nombre: archivo.name,
        contenidoBase64: base64,
      }).then(function (resp) {
        if (!resp.ok) {
          feedback(caja, 'No se pudo subir: ' + (resp.data.error || 'error desconocido'), false);
          return;
        }
        feedback(caja, 'Archivo subido a ' + resp.data.url, true);
      });
    };

    lector.readAsDataURL(archivo);
  }

  /* -------------------------------------------------------------- reportes */
  function cargarReportes() {
    api('/reportes/facturacion').then(function (f) {
      api('/reportes/ticket-promedio').then(function (t) {
        api('/reportes/mas-vendido').then(function (m) {
          var mas = m.data.producto;
          var kpis = [
            { label: 'Facturación', value: money(f.data.facturado) },
            { label: 'Pedidos', value: f.data.pedidos },
            { label: 'Ticket promedio', value: money(t.data.promedio) },
            { label: 'Más vendido', value: mas ? mas.nombre + ' (' + mas.unidades + ')' : '—' },
          ];
          renderKpis($('#kpis-reportes'), kpis);
        });
      });
    });
  }

  function consultarVentas() {
    var caja = $('#reporte-feedback');
    var variedad = $('#reporte-variedad').value;

    api('/reportes/ventas-por-variedad?variedad=' + encodeURIComponent(variedad)).then(function (resp) {
      if (!resp.ok) {
        feedback(caja, 'Error: ' + (resp.data.error || 'desconocido'), false);
        reemplazar($('#tabla-ventas'), []);
        return;
      }
      var ventas = resp.data.ventas || [];
      reemplazar($('#tabla-ventas'), [
        encabezado(['Origen', 'Producto', 'Unidades|num', 'Total|num']),
        crear('tbody', null, ventas.map(function (v) {
          return crear('tr', null, [
            celda(v.variedad),
            celda(v.nombre),
            celda(v.unidades, 'num'),
            celda(money(v.total), 'num'),
          ]);
        })),
      ]);
      feedback(caja, 'Consulta realizada.', true);
    });
  }

  /* -------------------------------------------------------------- usuarios */
  function cargarUsuarios() {
    api('/admin/usuarios').then(function (resp) {
      var usuarios = resp.data.usuarios || [];
      reemplazar($('#tabla-usuarios'), [
        encabezado(['#', 'Usuario', 'Nombre', 'Rol', 'Acciones']),
        crear('tbody', null, usuarios.map(function (u) {
          return crear('tr', null, [
            celda(u.id),
            celda(u.username),
            celda(u.nombre),
            celda(crear('span', 'badge' + (u.rol === 'admin' ? ' badge-admin' : ''), u.rol)),
            celda(selector('sel-rol', 'data-usuario', u.id, ['cliente', 'mozo', 'barista', 'admin'], u.rol)),
          ]);
        })),
      ]);
    });
  }

  function cambiarRol(evento) {
    var select = evento.target.closest('.sel-rol');
    if (!select) return;
    var id = select.getAttribute('data-usuario');

    putJSON('/admin/usuarios/' + id, { rol: select.value }).then(function (resp) {
      if (!resp.ok) alert('No se pudo actualizar: ' + (resp.data.error || 'error'));
      cargarUsuarios();
    });
  }

  function cambiarPassword(evento) {
    evento.preventDefault();
    var caja = $('#password-feedback');
    postJSON('/admin/cambiar-contrasena', { nueva: $('#nueva-password').value }).then(function (resp) {
      if (!resp.ok) {
        feedback(caja, 'No se pudo cambiar: ' + (resp.data.error || 'error desconocido'), false);
        return;
      }
      feedback(caja, 'Contraseña actualizada.', true);
      $('#nueva-password').value = '';
    });
  }

  /* ----------------------------------------------------------- herramientas */
  function probarConexion(evento) {
    evento.preventDefault();
    var salida = $('#salida-conexion');
    salida.textContent = 'Probando…';

    postJSON('/admin/probar-conexion', { host: $('#conexion-host').value }).then(function (resp) {
      if (!resp.ok) {
        salida.textContent = 'Error: ' + (resp.data.error || 'desconocido');
        return;
      }
      salida.textContent =
        '$ ' + resp.data.comando + '\n\n' +
        (resp.data.salida || '') +
        (resp.data.error ? '\n[stderr]\n' + resp.data.error : '');
    });
  }

  function verDiagnostico() {
    var salida = $('#salida-diagnostico');
    salida.textContent = 'Cargando…';
    api('/_diagnostico').then(function (resp) {
      salida.textContent = JSON.stringify(resp.data, null, 2);
    });
  }

  /* ------------------------------------------------------------------ tabs */
  function activarTab(evento) {
    var tab = evento.target.closest('.tab');
    if (!tab) return;
    mostrarVista(tab.getAttribute('data-vista'));
  }

  // Lista blanca de vistas del panel: lo único que se acepta desde la URL.
  var VISTAS = {
    resumen: 'Resumen',
    pedidos: 'Pedidos',
    productos: 'Productos',
    reportes: 'Reportes',
    usuarios: 'Usuarios',
    herramientas: 'Herramientas',
  };

  function mostrarVista(vista) {
    if (!Object.prototype.hasOwnProperty.call(VISTAS, vista)) return;
    var tab = $('.tab[data-vista="' + vista + '"]');
    $$('.tab').forEach(function (t) { t.classList.remove('is-active'); });
    tab.classList.add('is-active');
    $$('.tab-panel').forEach(function (p) {
      p.classList.toggle('is-active', p.getAttribute('data-panel') === vista);
    });
  }

  /* ------------------------------------------------------------------ init */
  function init() {
    // Corrección XSS de DOM (#7): el parámetro ?vista= de la URL sólo se usa
    // si está en la lista blanca VISTAS, y el título se arma con el nombre
    // de la lista (no con lo que vino en la URL), asignado con textContent.
    var params = new URLSearchParams(window.location.search);
    var objetivo = params.get('vista');
    if (objetivo && Object.prototype.hasOwnProperty.call(VISTAS, objetivo)) {
      $('#panel-bienvenida').textContent = 'Panel ' + VISTAS[objetivo];
      mostrarVista(objetivo);
    }

    $('#form-login').addEventListener('submit', iniciarSesion);
    $('#btn-logout').addEventListener('click', cerrarSesion);
    $('#btn-refrescar').addEventListener('click', cargarTodo);
    $('#tabs').addEventListener('click', activarTab);
    $('#tabla-pedidos').addEventListener('change', cambiarEstado);
    $('#tabla-productos').addEventListener('click', borrarProducto);
    $('#form-producto').addEventListener('submit', guardarProducto);
    $('#btn-limpiar-producto').addEventListener('click', limpiarFormularioProducto);
    $('#form-upload').addEventListener('submit', subirArchivo);
    $('#form-password').addEventListener('submit', cambiarPassword);
    $('#btn-reporte-variedad').addEventListener('click', consultarVentas);
    $('#tabla-usuarios').addEventListener('change', cambiarRol);
    $('#form-conexion').addEventListener('submit', probarConexion);
    $('#btn-diagnostico').addEventListener('click', verDiagnostico);

    // ¿Ya hay sesión?
    api('/auth/yo').then(function (resp) {
      if (resp.ok) {
        usuario = resp.data.usuario;
        mostrarPanel();
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
