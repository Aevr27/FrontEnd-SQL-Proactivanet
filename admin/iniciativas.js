/* =========================================================================
   admin/iniciativas.js

   Pagina oculta de administracion de iniciativas. Segundo hito: pestañas de
   navegacion y "Nueva solicitud" con

       Tipo de iniciativa -> Product Owner -> Service Owner -> Categoria
                                                              -> Director (derivado)

   mas los campos de captura. No envia ni guarda nada.

   DE DONDE SALE CADA COSA
   -----------------------
   Seleccion (lo elige quien solicita)
     Tipo de iniciativa   dbo.Problem.TipoIniciativa en uso
                          (DashboardCatalogos.TiposIniciativa). Solo habilita
                          la cascada: en los datos no hay relacion tipo ->
                          categoria, asi que no filtra ninguna lista.
     PO / SO / Categoria  filas vigentes de dbo.CatCategoriaDueno con sus
                          dueños resueltos (DirectorioOrganizacional
                          .AsignacionesVigentes). No hay arbol de personas:
                          cada select ofrece los valores de las filas que
                          cumplen TODO lo elegido arriba, asi que cualquier
                          opcion lleva a una categoria real.
   Derivado (lo pone el sistema, no se edita)
     Director             el de la fila de la categoria elegida. Si las filas
                          que quedan no coinciden en uno solo, no se adivina.
   Captura (lo escribe quien solicita)
     CAMPOS_COMUNES y DEFINICIONES_TIPO, abajo.

   Ni el Manager (jerarquia del Service Owner en CatPersona) ni el Lider de
   Backlog/QARE (el de un Grupo, CatLiderGrupo) entran en esta cascada.

   PIEZAS
   ------
     CatalogoIniciativas   el JSON del handler, validado
     CascadaOrganizacional PO -> SO -> Categoria y el Director derivado
     SolicitudNueva        el formulario sin DOM: tipo, cascada, valores
     PaginaIniciativas     el DOM: pestañas, carga, estados, campos, ayuda
   Las cuatro se prueban en node: tools/tests/IniciativasCascadaSmoke.js.
   ========================================================================= */
window.Iniciativas = (function () {
  'use strict';

  var URL_CATALOGO = '../handlers/admin_iniciativas_catalogos.ashx';

  // ---------------------------------------------------------------------
  // Campos de captura
  // ---------------------------------------------------------------------
  //
  // Un campo:
  //   clave      identificador (id del control: 'campo-' + clave)
  //   etiqueta   texto del rotulo
  //   control    'texto' | 'multilinea'
  //   ayuda      opcional { texto, nota? }: el rotulo entero se vuelve
  //              destino de GloboAyuda (patron "Pregunta" de QARE)
  //   reiniciaConCascada  opcional, solo en campos de tipo: se vacia si
  //              cambia PO, SO o Categoria (un campo que dependa de la
  //              categoria)
  //
  // Comunes a todos los tipos. Salen de las columnas que toda iniciativa
  // ya tiene en dbo.Problem: Titulo y Descripcion (el analisis de lo que se
  // pide). Cambiar de tipo NO los borra: no dependen del tipo.
  var CAMPOS_COMUNES = [
    { clave: 'titulo', etiqueta: 'Título', control: 'texto',
      ayuda: { texto: 'Escribe un título breve y claro que identifique qué se busca crear, mejorar o resolver.' } },
    { clave: 'analisis', etiqueta: 'Análisis de la solicitud', control: 'multilinea' }
  ];

  // Campos propios de cada Tipo de iniciativa, por nombre exacto del tipo:
  //
  //   'Nombre del tipo': { campos: [ <campo>, ... ] }
  //
  // VACIO A PROPOSITO: ni el modelo en la base ni el codigo del sitio dicen
  // hoy que campo cambia segun el tipo, y el libro de Excel no esta en el
  // repo. Un tipo sin entrada solo lleva los comunes. Al definirlos, basta
  // con agregarlos aqui: la pagina los pinta y los limpia al cambiar el tipo.
  var DEFINICIONES_TIPO = {};

  function igualTexto(a, b) { return a < b ? -1 : a > b ? 1 : 0; }

  // ---------------------------------------------------------------------
  // CatalogoIniciativas
  // ---------------------------------------------------------------------
  class CatalogoIniciativas {
    constructor(tipos, asignaciones, omitidas) {
      this.tipos = tipos;
      this.asignaciones = asignaciones;
      this.omitidas = omitidas;
    }

    // El JSON del handler -> catalogo. Sin las dos listas lanza; filas o
    // tipos que no sean texto no vacio se descartan, sin corregirlos.
    static desdeJson(json) {
      if (!json || !Array.isArray(json.asignaciones) || !Array.isArray(json.tipos)) {
        throw new Error('La respuesta del servidor no trae el catálogo esperado.');
      }
      var claves = ['director', 'po', 'so', 'categoria'];
      var filas = json.asignaciones.filter(function (f) {
        return f && claves.every(function (c) { return typeof f[c] === 'string' && f[c] !== ''; });
      });
      var vistos = {};
      var tipos = json.tipos.filter(function (t) {
        if (typeof t !== 'string' || t === '' || vistos[t]) return false;
        vistos[t] = true;
        return true;
      });
      return new CatalogoIniciativas(tipos, filas, Number(json.omitidas) || 0);
    }

    tieneTipo(valor) { return this.tipos.indexOf(valor) >= 0; }
  }

  // ---------------------------------------------------------------------
  // CascadaOrganizacional
  // ---------------------------------------------------------------------
  class CascadaOrganizacional {
    constructor(filas) {
      this.filas = filas;
      this.seleccion = CascadaOrganizacional.NIVELES.map(function () { return ''; });
    }

    // Filas que cumplen lo elegido en los niveles 0..hasta-1.
    filasHasta(hasta) {
      var niveles = CascadaOrganizacional.NIVELES, sel = this.seleccion;
      return this.filas.filter(function (f) {
        for (var i = 0; i < hasta; i++) {
          if (sel[i] && f[niveles[i].clave] !== sel[i]) return false;
        }
        return true;
      });
    }

    // Valores distintos del nivel, ordenados como el directorio (ordinal).
    opciones(nivel) {
      var clave = CascadaOrganizacional.NIVELES[nivel].clave;
      var vistos = {}, salida = [];
      this.filasHasta(nivel).forEach(function (f) {
        var v = f[clave];
        if (v && !Object.prototype.hasOwnProperty.call(vistos, v)) {
          vistos[v] = true;
          salida.push(v);
        }
      });
      return salida.sort(igualTexto);
    }

    // Limpia el nivel `desde` y todos los de abajo.
    limpiar(desde) {
      for (var i = desde; i < this.seleccion.length; i++) this.seleccion[i] = '';
    }

    // Elegir limpia los niveles de abajo. Un valor que no esta entre las
    // opciones validas no se acepta (el nivel queda vacio). Devuelve si se
    // acepto.
    elegir(nivel, valor) {
      this.limpiar(nivel);
      if (valor && this.opciones(nivel).indexOf(valor) >= 0) {
        this.seleccion[nivel] = valor;
        return true;
      }
      return false;
    }

    completa() {
      return this.seleccion.every(function (v) { return v !== ''; });
    }

    // Director de la categoria elegida, o '' si falta elegir algo o si las
    // filas que quedan no coinciden en uno solo (no se adivina).
    director() {
      if (!this.completa()) return '';
      var directores = {};
      this.filasHasta(this.seleccion.length).forEach(function (f) { directores[f.director] = true; });
      var lista = Object.keys(directores);
      return lista.length === 1 ? lista[0] : '';
    }

    // Lo que pinta cada select. `raizHabilitada`: si el primer nivel puede
    // usarse (depende del tipo, que vive fuera de la cascada).
    estado(raizHabilitada, motivoRaiz) {
      var self = this;
      return CascadaOrganizacional.NIVELES.map(function (n, i) {
        var padre = i > 0 ? CascadaOrganizacional.NIVELES[i - 1] : null;
        if (!padre && !raizHabilitada) {
          return { habilitado: false, opciones: [], valor: '', motivo: motivoRaiz };
        }
        if (padre && !self.seleccion[i - 1]) {
          return { habilitado: false, opciones: [], valor: '',
                   motivo: 'Elige primero ' + padre.articulo + ' ' + padre.etiqueta + '.' };
        }
        var ops = self.opciones(i);
        if (!ops.length) {
          return { habilitado: false, opciones: [], valor: '',
                   motivo: padre ? 'Sin valores para el ' + padre.etiqueta + ' elegido.'
                                 : 'Sin valores en el catálogo.' };
        }
        return { habilitado: true, opciones: ops, valor: self.seleccion[i], motivo: '' };
      });
    }
  }

  CascadaOrganizacional.NIVELES = [
    { clave: 'po',        etiqueta: 'Product Owner', articulo: 'un' },
    { clave: 'so',        etiqueta: 'Service Owner', articulo: 'un' },
    { clave: 'categoria', etiqueta: 'Categoría',     articulo: 'una' }
  ];

  // ---------------------------------------------------------------------
  // SolicitudNueva
  // ---------------------------------------------------------------------
  class SolicitudNueva {
    constructor(catalogo, definiciones, comunes) {
      this.catalogo = catalogo;
      this.definiciones = definiciones || DEFINICIONES_TIPO;
      this.comunes = comunes || CAMPOS_COMUNES;
      this.tipo = '';
      this.cascada = new CascadaOrganizacional(catalogo.asignaciones);
      this.valores = {};       // campos comunes
      this.valoresTipo = {};   // campos del tipo
    }

    camposTipo() {
      var d = this.tipo && Object.prototype.hasOwnProperty.call(this.definiciones, this.tipo)
        ? this.definiciones[this.tipo] : null;
      return (d && Array.isArray(d.campos)) ? d.campos : [];
    }

    // Cambiar de tipo limpia la cascada completa y los campos del tipo. Un
    // tipo fuera del catalogo no se acepta (queda sin tipo).
    elegirTipo(valor) {
      this.tipo = (valor && this.catalogo.tieneTipo(valor)) ? valor : '';
      this.cascada.limpiar(0);
      this.valoresTipo = {};
      return this.tipo !== '';
    }

    // Un cambio en la cascada limpia los niveles de abajo (y con ellos el
    // Director) y los campos del tipo que dependan de la categoria.
    elegir(nivel, valor) {
      var aceptado = this.tipo ? this.cascada.elegir(nivel, valor) : false;
      var vt = this.valoresTipo;
      this.camposTipo().forEach(function (c) { if (c.reiniciaConCascada) delete vt[c.clave]; });
      return aceptado;
    }

    capturar(clave, texto) {
      var esTipo = this.camposTipo().some(function (c) { return c.clave === clave; });
      var esComun = this.comunes.some(function (c) { return c.clave === clave; });
      if (esTipo) this.valoresTipo[clave] = texto;
      else if (esComun) this.valores[clave] = texto;
    }

    estado() {
      var hayTipos = this.catalogo.tipos.length > 0;
      var director = this.cascada.director();
      return {
        tipo: hayTipos
          ? { habilitado: true, opciones: this.catalogo.tipos, valor: this.tipo, motivo: '' }
          : { habilitado: false, opciones: [], valor: '', motivo: 'Sin tipos de iniciativa en el catálogo.' },
        niveles: this.cascada.estado(this.tipo !== '',
          hayTipos ? 'Elige primero un Tipo de iniciativa.' : 'Sin tipos de iniciativa en el catálogo.'),
        director: {
          valor: director,
          motivo: director ? 'Derivado de la categoría.'
            : this.cascada.completa() ? 'La categoría no tiene un Director único.'
            : 'Se completa al elegir la Categoría.'
        },
        camposVisibles: this.tipo !== ''
      };
    }
  }

  // ---------------------------------------------------------------------
  // PaginaIniciativas
  // ---------------------------------------------------------------------
  var SELECTS = [
    { sel: 'selPo',        mot: 'motPo' },
    { sel: 'selSo',        mot: 'motSo' },
    { sel: 'selCategoria', mot: 'motCategoria' }
  ];

  class PaginaIniciativas {
    constructor(doc) {
      this.doc = doc;
      this.solicitud = null;
      this.cargaId = 0;      // descarta la respuesta de una carga ya superada
      this.globo = null;
    }

    $(id) { return this.doc.getElementById(id); }

    // ---- arranque ----
    iniciar() {
      var self = this;
      this.cablearPestanas();
      this.cablearSelects();
      this.cablearCampos();
      this.globo = new GloboAyuda(this.$('panel-nueva'), '.ayuda-destino', function (d) {
        return self.ayudaDe(d.getAttribute('data-ayuda'));
      }).conectar();
      this.$('iniReintentar').addEventListener('click', function () { self.cargar(); });
      return this.cargar();
    }

    // ---- pestañas: solo navegacion ----
    activarPestana(tab) {
      var self = this;
      Array.prototype.forEach.call(this.doc.querySelectorAll('.ini-tab'), function (t) {
        var activa = t === tab;
        t.classList.toggle('activa', activa);
        t.setAttribute('aria-selected', activa ? 'true' : 'false');
        t.tabIndex = activa ? 0 : -1;
        self.$(t.getAttribute('aria-controls')).hidden = !activa;
      });
    }

    cablearPestanas() {
      var self = this;
      var tabs = Array.prototype.slice.call(this.doc.querySelectorAll('.ini-tab'));
      tabs.forEach(function (t, i) {
        t.addEventListener('click', function () { self.activarPestana(t); });
        t.addEventListener('keydown', function (e) {
          var paso = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
          if (!paso) return;
          var sig = tabs[(i + paso + tabs.length) % tabs.length];
          self.activarPestana(sig);
          sig.focus();
        });
      });
    }

    // ---- selects ----
    cablearSelects() {
      var self = this;
      this.$('selTipo').addEventListener('change', function (e) {
        if (!self.solicitud) return;
        self.solicitud.elegirTipo(e.target.value);
        self.pintarCamposTipo();
        self.pintar();
      });
      SELECTS.forEach(function (ids, i) {
        self.$(ids.sel).addEventListener('change', function (e) {
          if (!self.solicitud) return;
          self.solicitud.elegir(i, e.target.value);
          if (self.solicitud.camposTipo().some(function (c) { return c.reiniciaConCascada; })) {
            self.pintarCamposTipo();
          }
          self.pintar();
        });
      });
    }

    pintarSelect(sel, mot, e) {
      Catalogos.llenar(sel, e.opciones, e.habilitado ? '— Elige —' : '—');
      sel.value = e.valor;
      sel.disabled = !e.habilitado;
      mot.textContent = e.motivo;
    }

    pintar() {
      var self = this;
      var est = this.solicitud.estado();
      this.pintarSelect(this.$('selTipo'), this.$('motTipo'), est.tipo);
      est.niveles.forEach(function (e, i) {
        self.pintarSelect(self.$(SELECTS[i].sel), self.$(SELECTS[i].mot), e);
      });
      this.$('outDirector').textContent = est.director.valor || '—';
      this.$('motDirector').textContent = est.director.motivo;
      this.$('iniBloqueCampos').hidden = !est.camposVisibles;
    }

    // Todos bloqueados con el mismo motivo (cargando / error / vacio).
    bloquearTodo(motivo) {
      var self = this;
      [{ sel: 'selTipo', mot: 'motTipo' }].concat(SELECTS).forEach(function (ids) {
        var sel = self.$(ids.sel);
        Catalogos.llenar(sel, [], '—');
        sel.disabled = true;
        self.$(ids.mot).textContent = motivo;
      });
      this.$('outDirector').textContent = '—';
      this.$('motDirector').textContent = '';
      this.$('iniBloqueCampos').hidden = true;
    }

    // ---- campos de captura ----
    ayudaDe(clave) {
      var todos = CAMPOS_COMUNES.concat(this.solicitud ? this.solicitud.camposTipo() : []);
      for (var i = 0; i < todos.length; i++) if (todos[i].clave === clave) return todos[i].ayuda || null;
      return null;
    }

    htmlCampo(campo, valor) {
      var id = 'campo-' + campo.clave;
      var v = valor || '';
      var ayuda = campo.ayuda && campo.ayuda.texto;
      var rotulo = ayuda
        ? '<label for="' + id + '" class="ini-rotulo ayuda-destino" data-ayuda="' + Escape.attr(campo.clave) + '">' +
            Escape.html(campo.etiqueta) + '</label>'
        : '<label for="' + id + '" class="ini-rotulo">' + Escape.html(campo.etiqueta) + '</label>';
      var describe = ayuda ? ' aria-describedby="' + id + '-ayuda"' : '';
      var control = campo.control === 'multilinea'
        ? '<textarea id="' + id + '" data-campo="' + Escape.attr(campo.clave) + '" rows="6"' + describe + '>' +
            Escape.html(v) + '</textarea>'
        : '<input type="text" id="' + id + '" data-campo="' + Escape.attr(campo.clave) + '"' + describe +
            ' value="' + Escape.attr(v) + '">';
      var oculto = ayuda ? '<span class="ini-sr" id="' + id + '-ayuda">' + Escape.html(ayuda) + '</span>' : '';
      return '<div class="ini-campo ini-campo-captura">' + rotulo + control + oculto + '</div>';
    }

    pintarCamposComunes() {
      var self = this, s = this.solicitud;
      this.$('iniCamposComunes').innerHTML = CAMPOS_COMUNES.map(function (c) {
        return self.htmlCampo(c, s ? s.valores[c.clave] : '');
      }).join('');
    }

    pintarCamposTipo() {
      var self = this, s = this.solicitud;
      var campos = s ? s.camposTipo() : [];
      var cont = this.$('iniCamposTipo');
      cont.innerHTML = campos.map(function (c) { return self.htmlCampo(c, s.valoresTipo[c.clave]); }).join('');
      cont.hidden = campos.length === 0;
    }

    // Un solo oyente para los dos contenedores: los controles se vuelven a
    // pintar y no conviene colgarles eventos uno por uno.
    cablearCampos() {
      var self = this;
      ['iniCamposComunes', 'iniCamposTipo'].forEach(function (id) {
        self.$(id).addEventListener('input', function (e) {
          var clave = e.target && e.target.getAttribute && e.target.getAttribute('data-campo');
          if (clave && self.solicitud) self.solicitud.capturar(clave, e.target.value);
        });
      });
    }

    mostrarError(texto) {
      this.$('iniErrorTexto').textContent = texto;
      this.$('iniError').hidden = false;
    }

    // ---- carga ----
    // `pedir` es fetch por omision; las pruebas le pasan uno propio.
    cargar(pedir) {
      var self = this;
      pedir = pedir || function (url) { return fetch(url, { cache: 'no-store' }); };
      var mia = ++this.cargaId;

      this.solicitud = null;
      if (this.globo) this.globo.ocultar();
      this.$('iniError').hidden = true;
      this.$('iniOmitidas').hidden = true;
      this.$('iniEstado').textContent = 'Cargando catálogos…';
      this.bloquearTodo('Cargando…');

      return Promise.resolve()
        .then(function () {
          return Promise.resolve(pedir(URL_CATALOGO)).catch(function () {
            throw new Error('No se pudo conectar con el servidor.');
          });
        })
        .then(function (r) {
          return r.json().catch(function () { return null; }).then(function (json) {
            if (!r.ok) {
              throw new Error((json && json.error) || ('El servidor respondió ' + r.status + '.'));
            }
            return json;
          });
        })
        .then(function (json) {
          if (mia !== self.cargaId) return;
          var catalogo = CatalogoIniciativas.desdeJson(json);
          self.$('iniEstado').textContent = '';

          if (catalogo.omitidas > 0) {
            var n = catalogo.omitidas;
            self.$('iniOmitidas').textContent = n + (n === 1
              ? ' categoría vigente no aparece: le falta Director, Product Owner o Service Owner en el catálogo de dueños.'
              : ' categorías vigentes no aparecen: les falta Director, Product Owner o Service Owner en el catálogo de dueños.');
            self.$('iniOmitidas').hidden = false;
          }

          if (!catalogo.asignaciones.length) {
            self.$('iniEstado').textContent = 'No hay categorías vigentes con Director, Product Owner y Service Owner.';
            self.bloquearTodo('Sin valores en el catálogo.');
            return;
          }
          if (!catalogo.tipos.length) {
            self.$('iniEstado').textContent = 'No hay tipos de iniciativa en el catálogo.';
          }

          self.solicitud = new SolicitudNueva(catalogo);
          self.pintarCamposComunes();
          self.pintarCamposTipo();
          self.pintar();
        })
        .catch(function (err) {
          if (mia !== self.cargaId) return;
          self.solicitud = null;
          self.$('iniEstado').textContent = '';
          self.bloquearTodo('No disponible: no se pudo cargar el catálogo.');
          self.mostrarError((err && err.message) || 'No se pudo cargar el catálogo.');
        });
    }
  }

  return {
    URL_CATALOGO: URL_CATALOGO,
    CAMPOS_COMUNES: CAMPOS_COMUNES,
    DEFINICIONES_TIPO: DEFINICIONES_TIPO,
    CatalogoIniciativas: CatalogoIniciativas,
    CascadaOrganizacional: CascadaOrganizacional,
    SolicitudNueva: SolicitudNueva,
    PaginaIniciativas: PaginaIniciativas
  };
})();

window.IniciativasPagina = (function () {
  'use strict';
  var pagina = new window.Iniciativas.PaginaIniciativas(document);
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { pagina.iniciar(); });
  } else {
    pagina.iniciar();
  }
  return pagina;
})();
