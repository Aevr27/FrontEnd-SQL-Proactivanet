/* =========================================================================
   admin/categorias-alta.js

   Pestaña "Administración" de admin/iniciativas.html (solo ADM), seccion
   "Alta de categoría en Proactivanet". PREPARACION SIN LLAMADA EXTERNA:
   "Validar alta" manda el formulario a handlers/admin_categorias_alta.ashx,
   que valida contra el espejo local (dbo.Categorias) y devuelve el cuerpo
   que se MANDARIA a POST /api/Categories, con los bloqueos. Ni ese handler
   ni este archivo hablan con Proactivanet: nada se crea.

   No es el mapeo de dueños (admin/categorias-duenos.js): crear la
   categoria y asignarle dueños son operaciones distintas.

   RESPUESTAS (nunca hay exito: la integracion no esta habilitada)
     no_habilitada  501 IntegracionNoHabilitada: valida, NO enviada
     invalida       422: errores por campo
     denegado       403
     no_disponible  503: no se pudo leer el catalogo local
     error          red, 500, respuesta ilegible

   PIEZAS
     FormularioAlta   valores y validacion local (la misma forma que el
                      servidor: nombre sin "/", orden entero), sin DOM
     RespuestaAlta    estado de la respuesta del handler, sin DOM
     VistaAlta        el DOM de la seccion

   Se prueba en node: tools/tests/CategoriasAltaSmoke.js.
   ========================================================================= */
window.CategoriasAlta = (function () {
  'use strict';

  var URL_ALTA = '../handlers/admin_categorias_alta.ashx';
  var APLICA = [
    { clave: 'incidentes', rotulo: 'Incidentes' }, { clave: 'problemas', rotulo: 'Problemas' },
    { clave: 'cambios', rotulo: 'Cambios (RFC)' }, { clave: 'kb', rotulo: 'Base de conocimiento' }
  ];

  function texto(v) { return String(v === null || v === undefined ? '' : v).trim(); }

  class FormularioAlta {
    constructor() {
      this.valores = { padre: '', nombre: '', descripcion: '', orden: '' };
      this.aplica = { incidentes: false, problemas: false, cambios: false, kb: false };
    }

    capturar(clave, valor) {
      if (Object.prototype.hasOwnProperty.call(this.valores, clave)) this.valores[clave] = String(valor || '');
      else if (Object.prototype.hasOwnProperty.call(this.aplica, clave)) this.aplica[clave] = !!valor;
    }

    errores() {
      var e = [], nombre = texto(this.valores.nombre), orden = texto(this.valores.orden);
      if (!nombre) e.push({ campo: 'nombre', mensaje: 'Falta el nombre de la categoría.' });
      else if (nombre.indexOf('/') >= 0) e.push({ campo: 'nombre', mensaje: 'El nombre no puede llevar "/": es el separador de la ruta.' });
      if (orden && !/^-?\d{1,9}$/.test(orden)) e.push({ campo: 'orden', mensaje: 'El orden debe ser un número entero.' });
      return e;
    }

    // Ruta que tendria (vista previa local; la autoridad es el servidor).
    ruta() {
      var padre = texto(this.valores.padre).replace(/^\/+|\/+$/g, ''), nombre = texto(this.valores.nombre);
      return nombre ? (padre ? '/' + padre : '') + '/' + nombre : '';
    }

    paraEnviar() {
      var self = this, pares = [['padre', this.valores.padre], ['nombre', this.valores.nombre],
        ['descripcion', this.valores.descripcion], ['orden', texto(this.valores.orden)]];
      APLICA.forEach(function (a) { if (self.aplica[a.clave]) pares.push([a.clave, '1']); });
      return pares;
    }
  }

  var RespuestaAlta = {
    desde: function (estado, json) {
      json = json && typeof json === 'object' ? json : null;
      var e = estado === 501 && json && json.tipo === 'IntegracionNoHabilitada' && json.valida === true &&
              json.enviada === false && json.creada === false ? 'no_habilitada'
        : estado === 422 && json && json.valida === false ? 'invalida'
        : estado === 403 ? 'denegado'
        : estado === 503 ? 'no_disponible'
        : 'error';
      return {
        estado: e, creada: false,
        errores: e === 'invalida' && Array.isArray(json.errores) ? json.errores : [],
        advertencias: json && Array.isArray(json.advertencias) ? json.advertencias : [],
        bloqueos: json && Array.isArray(json.bloqueos) ? json.bloqueos : [],
        envio: e === 'no_habilitada' ? json.envio : null,
        ruta: json && json.ruta_resultante,
        mensaje: (json && (json.integracion_motivo || json.error)) ||
          (estado ? 'El servidor respondió ' + estado + '.' : 'No se pudo contactar al servidor.')
      };
    },
    titulo: function (r) {
      return {
        no_habilitada: 'Validada contra el catálogo local. No se creó: la integración con Proactivanet no está habilitada.',
        invalida: 'El servidor rechazó los datos:',
        denegado: 'Sin permiso: solo un administrador (ADM) puede hacerlo.',
        no_disponible: 'No se pudo validar (catálogo local no disponible). No se envió nada.',
        error: 'No se pudo completar la validación. No se envió nada.'
      }[r.estado];
    }
  };

  function htmlRespuesta(r) {
    var lista = function (xs) { return xs.length ? '<ul>' + xs.map(function (x) { return '<li>' + Escape.html(x) + '</li>'; }).join('') + '</ul>' : ''; };
    var partes = ['<strong class="ini-prototipo-marca">' + Escape.html(RespuestaAlta.titulo(r)) + '</strong>'];
    partes.push(lista(r.errores.map(function (e) { return e.mensaje; })));
    partes.push(lista(r.advertencias));
    if (r.envio) {
      partes.push('<p>Lo que se enviaría (no se envió): <code>' + Escape.html(r.envio.metodo + ' ' + r.envio.ruta) + '</code></p>' +
        '<pre class="ini-ca-json">' + Escape.html(JSON.stringify(r.envio.cuerpo, null, 2)) + '</pre>');
    }
    if (r.estado !== 'invalida') partes.push('<p class="ini-prototipo-aviso">' + Escape.html(r.mensaje) + '</p>');
    if (r.estado === 'no_habilitada' && r.bloqueos.length) {
      partes.push('<details class="ini-ed-otros"><summary>Qué falta para poder crearla</summary>' + lista(r.bloqueos) + '</details>');
    }
    return partes.join('');
  }

  class VistaAlta {
    // pedir: fetch por omision; las pruebas pasan uno propio.
    constructor(doc, pedir) {
      this.doc = doc;
      this.pedir = pedir || function (url, op) { return fetch(url, op); };
      this.form = new FormularioAlta();
      this.rutas = null;
      this.carga = null;
      this.enviando = false;
      this.cableado = false;
    }

    $(id) { return this.doc.getElementById(id); }

    // La lista de padres se pide la primera vez que se abre Administracion.
    abrir() {
      this.cablear();
      if (!this.carga) this.carga = this.cargarRutas();
      return this.carga;
    }

    cargarRutas() {
      var self = this;
      this.$('caRutasEstado').textContent = 'Cargando categorías…';
      return Promise.resolve()
        .then(function () { return self.pedir(URL_ALTA, { cache: 'no-store' }); })
        .then(function (r) {
          return r.json().catch(function () { return null; }).then(function (json) {
            if (!r.ok || !json || !Array.isArray(json.rutas)) throw new Error((json && json.error) || ('El servidor respondió ' + r.status + '.'));
            return json.rutas;
          });
        })
        .then(function (rutas) {
          self.rutas = rutas;
          self.$('caPadres').innerHTML = rutas.map(function (x) { return '<option value="' + Escape.attr(x) + '"></option>'; }).join('');
          self.$('caRutasEstado').textContent = rutas.length + ' categorías activas para elegir el padre.';
        }, function (err) {
          self.carga = null;   // se vuelve a intentar al reabrir
          self.$('caRutasEstado').textContent = 'No se pudo cargar la lista de categorías: ' + ((err && err.message) || '') +
            ' Puedes escribir la ruta del padre; el servidor la valida.';
        });
    }

    cablear() {
      if (this.cableado) return;
      this.cableado = true;
      var self = this;
      ['padre', 'nombre', 'descripcion', 'orden'].forEach(function (k) {
        self.$('ca-' + k).addEventListener('input', function (e) { self.form.capturar(k, e.target.value); self.pintarRuta(); });
      });
      APLICA.forEach(function (a) {
        self.$('ca-' + a.clave).addEventListener('change', function (e) { self.form.capturar(a.clave, e.target.checked); });
      });
      this.$('caValidar').addEventListener('click', function () { self.validar(); });
    }

    pintarRuta() { this.$('caRuta').textContent = this.form.ruta() || '—'; }

    validar() {
      if (this.enviando) return Promise.resolve(null);
      var self = this, caja = this.$('caResultado'), boton = this.$('caValidar');
      var errores = this.form.errores();
      caja.hidden = false;
      caja.classList.remove('ok', 'aviso', 'mal');
      if (errores.length) {
        caja.classList.add('mal');
        caja.innerHTML = '<strong class="ini-prototipo-marca">Corrige el formulario:</strong><ul>' +
          errores.map(function (e) { return '<li>' + Escape.html(e.mensaje) + '</li>'; }).join('') + '</ul>';
        return Promise.resolve(null);
      }
      var datos = new FormData();
      this.form.paraEnviar().forEach(function (p) { datos.append(p[0], p[1]); });
      this.enviando = true;
      boton.disabled = true;
      caja.innerHTML = '<span>Validando en el servidor…</span>';
      return Promise.resolve()
        .then(function () { return self.pedir(URL_ALTA, { method: 'POST', body: datos, cache: 'no-store' }); })
        .then(function (r) {
          return r.json().catch(function () { return null; }).then(function (json) { return RespuestaAlta.desde(r.status, json); });
        }, function () { return RespuestaAlta.desde(0, null); })
        .then(function (r) {
          caja.classList.add(r.estado === 'no_habilitada' ? 'aviso' : 'mal');
          caja.innerHTML = htmlRespuesta(r);
          self.enviando = false;
          boton.disabled = false;
          return r;
        });
    }
  }

  return {
    URL_ALTA: URL_ALTA,
    APLICA: APLICA,
    FormularioAlta: FormularioAlta,
    RespuestaAlta: RespuestaAlta,
    htmlRespuesta: htmlRespuesta,
    VistaAlta: VistaAlta
  };
})();
