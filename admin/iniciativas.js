/* =========================================================================
   admin/iniciativas.js

   Pagina oculta de administracion de iniciativas. Vistas Iniciativas
   (inicio) y Solicitudes con pestaña. Iniciativas es el registro de solo
   lectura de admin/registro-iniciativas.js (VistaRegistro, que esta pagina
   solo arranca). "Nueva solicitud" es una accion de Iniciativas, sin
   pestaña, con

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
     CAMPOS_COMUNES y DEFINICIONES_TIPO, abajo: 02 Informacion del problema
     (Titulo, Descripcion, Observaciones) y 03 Impacto (Volumetria y el %
     de disminucion de la Categoria elegida).
   Pendiente (no se pinta como campo, ver sql/diag_admin_nueva_solicitud.sql)
     RCA es un aviso: no hay donde guardar el documento. Codigo, fechas,
     contadores, Estado, Subestado, Gerencia, Macroproceso, Causa, Proceso,
     comentarios, CuentaConWA y Volumetria del ultimo mes vienen hoy del
     Excel tal cual y su regla no esta verificada.

   Ni el Manager (jerarquia del Service Owner en CatPersona) ni el Lider de
   Backlog/QARE (el de un Grupo, CatLiderGrupo) entran en esta cascada.

   PIEZAS
   ------
     CatalogoIniciativas   el JSON del handler, validado
     CascadaOrganizacional PO -> SO -> Categoria y el Director derivado, en
                           modo 'creacion' (admin/cascada-organizacional.js,
                           compartida con cualquier pestaña que filtre)
     SolicitudNueva        el formulario sin DOM: tipo, cascada, valores
     PaginaIniciativas     el DOM: vistas, carga, estados, campos, ayuda
     MenuLateral           plegar/desplegar la barra lateral (copia de la
                           del tablero; sus entradas son enlaces de vuelta)

   BORRADOR
   --------
   SolicitudNueva ES el borrador: guarda tipo, cascada y textos. Cambiar de
   vista solo oculta paneles; al volver a Nueva solicitud se repinta desde
   ese objeto. El catalogo se carga una vez al abrir la pagina, asi que ir y
   volver no lo recrea. Vive en memoria: recargar la pagina lo pierde. No se
   guarda en el servidor.
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
  //   control    'texto' | 'multilinea' | 'entero' | 'porcentaje'
  //   seccion    solo en comunes: 'info' (02) o 'impacto' (03)
  //   destino    solo documentacion: la columna a la que iria, o null si
  //              no esta confirmada. Nada se guarda todavia.
  //   ayuda      opcional { texto, nota? }: el rotulo entero se vuelve
  //              destino de GloboAyuda (patron "Pregunta" de QARE)
  //   reiniciaConCascada  se vacia si cambia PO, SO o Categoria (un campo
  //              que dependa de la categoria)
  //   requiereCategoria   ademas, bloqueado hasta elegir la Categoria
  //
  // Comunes a todos los tipos. Cambiar de tipo NO borra los de 02; el % de
  // 03 si, porque cambiar de tipo vacia la cascada y con ella la Categoria.
  //
  // Textos de ayuda: los de la plantilla con que ya se capturan los
  // Problems (los de Titulo y Descripcion se ven dentro de
  // dbo.Problem.Descripcion en Experiencia) y las definiciones que dio
  // negocio. No se redactan aqui.
  var CAMPOS_COMUNES = [
    { clave: 'titulo', etiqueta: 'Título', control: 'texto', seccion: 'info',
      destino: 'dbo.Problem.Titulo',
      ayuda: { texto: 'Nombre descriptivo del problema que permita identificar la afectación y su causa principal.' } },
    // La clave sigue siendo 'analisis' (borradores y pruebas la usan); el
    // dato es la Descripcion del Problem.
    { clave: 'analisis', etiqueta: 'Descripción', control: 'multilinea', seccion: 'info',
      destino: 'dbo.Problem.Descripcion',
      ayuda: { texto: 'Detalle del síntoma o comportamiento observado que origina el problema.' } },
    { clave: 'observaciones', etiqueta: 'Observaciones', control: 'multilinea', seccion: 'info',
      destino: 'dbo.Problem.Observaciones',
      ayuda: { texto: 'Información adicional sobre cuándo, dónde y en qué condiciones se presenta la afectación.' } },
    // Cantidad capturada por quien solicita. NO es la Volumetria del ultimo
    // mes (dbo.Problem.VolumenUltimoMes), que no se escribe aqui. Destino
    // sin confirmar: la candidata es dbo.Problem.VolumetriaOriginal (INT).
    { clave: 'volumetria', etiqueta: 'Volumetría', control: 'entero', seccion: 'impacto',
      destino: null,
      ayuda: { texto: 'Cantidad de incidentes asociados al problema que justifican su análisis y seguimiento.',
               nota: 'Es la cantidad que capturas tú; no es la volumetría del último mes.' } },
    // Por categoria: dbo.ProblemCategoria.PctDisminucion es DECIMAL(9,4) y
    // guarda FRACCION (1.0000 = 100%). Se captura en % con hasta dos
    // decimales, que es esa misma precision. 0-100 es un tope de la
    // pantalla, no de la base (no tiene CHECK); los multiplos de 5 no se
    // exigen porque no estan verificados.
    { clave: 'pct', etiqueta: '% Disminución de tickets vs categoría', control: 'porcentaje', seccion: 'impacto',
      destino: 'dbo.ProblemCategoria.PctDisminucion (fracción)',
      reiniciaConCascada: true, requiereCategoria: true }
  ];

  // Ayuda de los rotulos fijos del HTML (no son campos de captura).
  // Definiciones que dio negocio; el valor sigue saliendo de la cascada.
  var AYUDA_FIJA = {
    so: { texto: 'Responsable del servicio afectado y encargado de validar el seguimiento del problema.' },
    categoria: { texto: 'Categoría o clasificación a la que pertenecen los incidentes considerados dentro de la volumetría del problema.' },
    rca: { texto: 'Documento con la descripción de la causa raíz identificada que originó el problema, incluyendo el análisis realizado, los factores contribuyentes y las acciones correctivas y preventivas definidas para evitar su recurrencia.' }
  };

  // Validacion de los controles numericos. '' es valido (nada capturado).
  // Devuelve el mensaje de error o ''.
  var VALIDAR = {
    entero: function (v) {
      return v === '' || /^\d+$/.test(v) ? '' : 'Escribe un número entero, de 0 en adelante.';
    },
    porcentaje: function (v) {
      if (v === '') return '';
      return /^\d{1,3}(\.\d{1,2})?$/.test(v) && Number(v) <= 100 ? ''
        : 'Escribe un porcentaje entre 0 y 100, con hasta dos decimales.';
    }
  };

  // El % capturado como lo guarda ProblemCategoria.PctDisminucion
  // (fraccion, 4 decimales), o null si no es valido.
  function fraccionDe(pct) {
    if (pct === '' || VALIDAR.porcentaje(pct)) return null;
    return Math.round(Number(pct) * 100) / 10000;
  }

  // Campos propios de cada Tipo de iniciativa, por nombre exacto del tipo:
  //
  //   'Nombre del tipo': { campos: [ <campo>, ... ] }
  //
  // VACIO A PROPOSITO: ni el modelo en la base ni el codigo del sitio dicen
  // hoy que campo cambia segun el tipo, y el libro de Excel no esta en el
  // repo. Un tipo sin entrada solo lleva los comunes. Al definirlos, basta
  // con agregarlos aqui: la pagina los pinta y los limpia al cambiar el tipo.
  var DEFINICIONES_TIPO = {};

  // La cascada es la compartida de admin/cascada-organizacional.js.
  var CascadaOrganizacional = window.CascadaOrganizacional;

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
  // SolicitudNueva
  // ---------------------------------------------------------------------
  class SolicitudNueva {
    constructor(catalogo, definiciones, comunes) {
      this.catalogo = catalogo;
      this.definiciones = definiciones || DEFINICIONES_TIPO;
      this.comunes = comunes || CAMPOS_COMUNES;
      this.tipo = '';
      this.cascada = new CascadaOrganizacional(catalogo.asignaciones, 'creacion');
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
      this.limpiarDeCascada(this.comunes, this.valores);
      return this.tipo !== '';
    }

    // Un cambio en la cascada limpia los niveles de abajo (y con ellos el
    // Director) y los campos que dependan de la categoria.
    elegir(nivel, valor) {
      var aceptado = this.tipo ? this.cascada.elegir(nivel, valor) : false;
      this.limpiarDeCascada(this.camposTipo(), this.valoresTipo);
      this.limpiarDeCascada(this.comunes, this.valores);
      return aceptado;
    }

    limpiarDeCascada(campos, valores) {
      campos.forEach(function (c) { if (c.reiniciaConCascada) delete valores[c.clave]; });
    }

    // La Categoria elegida en la cascada: la UNICA fuente de la categoria.
    categoria() { return this.cascada.seleccion[2] || ''; }

    campo(clave) {
      var todos = this.comunes.concat(this.camposTipo());
      for (var i = 0; i < todos.length; i++) if (todos[i].clave === clave) return todos[i];
      return null;
    }

    capturar(clave, texto) {
      var c = this.campo(clave);
      if (!c || (c.requiereCategoria && !this.categoria())) return;
      if (this.comunes.indexOf(c) >= 0) this.valores[clave] = texto;
      else this.valoresTipo[clave] = texto;
    }

    // Mensaje de error del valor capturado, o ''.
    error(clave) {
      var c = this.campo(clave);
      var v = c ? (this.comunes.indexOf(c) >= 0 ? this.valores : this.valoresTipo)[clave] : '';
      return c && VALIDAR[c.control] ? VALIDAR[c.control](String(v === undefined ? '' : v).trim()) : '';
    }

    pctFraccion() { return fraccionDe(String(this.valores.pct || '').trim()); }

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
        pct: this.categoria()
          ? { habilitado: true, motivo: 'Para la categoría elegida en Clasificación.' }
          : { habilitado: false, motivo: 'Elige primero la Categoría en Clasificación.' },
        camposVisibles: this.tipo !== ''
      };
    }
  }

  // ---------------------------------------------------------------------
  // PaginaIniciativas
  // ---------------------------------------------------------------------
  // Vistas: cada una con su panel y la pestaña que se marca al mostrarla.
  // Nueva solicitud no tiene pestaña propia: cuelga de Iniciativas.
  var VISTAS = {
    iniciativas: { panel: 'panel-iniciativas', pestana: 'tab-iniciativas' },
    solicitudes: { panel: 'panel-solicitudes', pestana: 'tab-solicitudes' },
    nueva:       { panel: 'panel-nueva',       pestana: 'tab-iniciativas' }
  };
  var PESTANAS = [
    { id: 'tab-iniciativas', vista: 'iniciativas' },
    { id: 'tab-solicitudes', vista: 'solicitudes' }
  ];

  var SELECTS = [
    { sel: 'selPo',        mot: 'motPo' },
    { sel: 'selSo',        mot: 'motSo' },
    { sel: 'selCategoria', mot: 'motCategoria' }
  ];

  // ---------------------------------------------------------------------
  // MenuLateral
  // ---------------------------------------------------------------------
  // Mismo comportamiento que plegarLateral() de dashboard.js: la clase
  // .lateral-cerrada va en <html> (el hueco del <body> depende de ella) y
  // el boton dice el estado real. Aqui no hay graficas que remedir ni
  // modulos que montar: las entradas son enlaces al tablero.
  class MenuLateral {
    constructor(doc) {
      this.raiz = doc.documentElement;
      this.boton = doc.getElementById('lateral-plegar');
    }

    plegar(cerrar) {
      if (!this.raiz || !this.raiz.classList) return;
      this.raiz.classList.toggle('lateral-cerrada', cerrar);
      if (!this.boton) return;
      var texto = cerrar ? 'Desplegar el menu' : 'Contraer el menu';
      this.boton.setAttribute('aria-expanded', String(!cerrar));
      this.boton.setAttribute('aria-label', texto);
      this.boton.title = texto;
    }

    conectar() {
      var self = this;
      if (this.boton) {
        this.boton.addEventListener('click', function () {
          self.plegar(!self.raiz.classList.contains('lateral-cerrada'));
        });
      }
      return this;
    }
  }

  function enfocar(el) { if (el && typeof el.focus === 'function') el.focus(); }

  class PaginaIniciativas {
    constructor(doc) {
      this.doc = doc;
      this.solicitud = null;
      this.cargaId = 0;      // descarta la respuesta de una carga ya superada
      this.globo = null;
      this.vista = 'iniciativas';
      this.menu = null;
      this.registro = null;  // VistaRegistro (admin/registro-iniciativas.js)
    }

    $(id) { return this.doc.getElementById(id); }

    // ---- arranque ----
    iniciar() {
      var self = this;
      this.menu = new MenuLateral(this.doc).conectar();
      // El registro carga por su cuenta, en paralelo con el catalogo de
      // Nueva solicitud: un fallo de uno no bloquea al otro.
      this.registro = new window.RegistroIniciativas.VistaRegistro(this.doc).iniciar();
      this.cablearPestanas();
      this.cablearAcciones();
      this.mostrarVista(this.vista);
      this.cablearSelects();
      this.cablearCampos();
      this.globo = new GloboAyuda(this.$('panel-nueva'), '.ayuda-destino', function (d) {
        return self.ayudaDe(d.getAttribute('data-ayuda'));
      }).conectar();
      this.$('iniReintentar').addEventListener('click', function () { self.cargar(); });
      return this.cargar();
    }

    // ---- vistas: solo navegacion; no tocan el borrador ----
    mostrarVista(nombre) {
      var self = this;
      if (!VISTAS[nombre]) return;
      this.vista = nombre;
      Object.keys(VISTAS).forEach(function (k) { self.$(VISTAS[k].panel).hidden = k !== nombre; });
      PESTANAS.forEach(function (p) {
        var t = self.$(p.id);
        var activa = VISTAS[nombre].pestana === p.id;
        t.classList.toggle('activa', activa);
        t.setAttribute('aria-selected', activa ? 'true' : 'false');
        t.tabIndex = activa ? 0 : -1;
      });
      if (nombre !== 'iniciativas' && this.registro) this.registro.cerrarDetalle();
      if (nombre === 'nueva') this.repintarBorrador();
      else if (this.globo) this.globo.ocultar();
    }

    // Nueva solicitud se pinta desde SolicitudNueva, no desde lo que haya
    // quedado en el DOM.
    repintarBorrador() {
      if (!this.solicitud) return;
      this.pintarCamposComunes();
      this.pintarCamposTipo();
      this.pintar();
    }

    cablearPestanas() {
      var self = this;
      PESTANAS.forEach(function (p, i) {
        var t = self.$(p.id);
        t.addEventListener('click', function () { self.mostrarVista(p.vista); });
        t.addEventListener('keydown', function (e) {
          var paso = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
          if (!paso) return;
          var sig = PESTANAS[(i + paso + PESTANAS.length) % PESTANAS.length];
          self.mostrarVista(sig.vista);
          enfocar(self.$(sig.id));
        });
      });
    }

    // "Solicitar una iniciativa" abre Nueva solicitud; "Volver" regresa.
    cablearAcciones() {
      var self = this;
      this.$('btnSolicitar').addEventListener('click', function () {
        self.mostrarVista('nueva');
        enfocar(self.$('iniNuevaTitulo'));
      });
      this.$('btnVolver').addEventListener('click', function () {
        self.mostrarVista('iniciativas');
        enfocar(self.$('btnSolicitar'));
      });
    }

    // ---- selects ----
    cablearSelects() {
      var self = this;
      this.$('selTipo').addEventListener('change', function (e) {
        if (!self.solicitud) return;
        self.solicitud.elegirTipo(e.target.value);
        self.pintarCamposTipo();
        self.pintarCamposComunes();
        self.pintar();
      });
      SELECTS.forEach(function (ids, i) {
        self.$(ids.sel).addEventListener('change', function (e) {
          if (!self.solicitud) return;
          self.solicitud.elegir(i, e.target.value);
          if (self.solicitud.camposTipo().some(function (c) { return c.reiniciaConCascada; })) {
            self.pintarCamposTipo();
          }
          self.pintarCamposComunes();
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
      this.mostrarCampos(est.camposVisibles);
      this.pintarPct(est.pct);
    }

    // 02 y 03 se ven al elegir el tipo; antes, su aviso.
    mostrarCampos(visibles) {
      this.$('iniBloqueCampos').hidden = !visibles;
      this.$('iniCamposPendiente').hidden = visibles;
      this.$('iniBloqueImpacto').hidden = !visibles;
      this.$('iniImpactoPendiente').hidden = visibles;
    }

    // El % se habilita con la Categoria; el aviso dice por que no, o el
    // error de lo capturado.
    pintarPct(e) {
      var input = this.$('campo-pct');
      input.disabled = !e.habilitado;
      this.pintarMensaje('pct', e.motivo);
    }

    // Mensaje bajo un control numerico: el error si lo hay; si no, `base`.
    pintarMensaje(clave, base) {
      var msg = this.$('campo-' + clave + '-msg');
      var error = this.solicitud ? this.solicitud.error(clave) : '';
      msg.textContent = error || base || '';
      msg.classList.toggle('ini-error-campo', !!error);
      this.$('campo-' + clave).setAttribute('aria-invalid', error ? 'true' : 'false');
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
      this.mostrarCampos(false);
    }

    // ---- campos de captura ----
    ayudaDe(clave) {
      if (Object.prototype.hasOwnProperty.call(AYUDA_FIJA, clave)) return AYUDA_FIJA[clave];
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
      var numerico = campo.control === 'entero' || campo.control === 'porcentaje';
      var ids = (ayuda ? [id + '-ayuda'] : []).concat(numerico ? [id + '-msg'] : []);
      var describe = ids.length ? ' aria-describedby="' + ids.join(' ') + '"' : '';
      var dato = ' id="' + id + '" data-campo="' + Escape.attr(campo.clave) + '"';
      var control;
      if (campo.control === 'multilinea') {
        control = '<textarea' + dato + ' rows="6"' + describe + '>' + Escape.html(v) + '</textarea>';
      } else if (campo.control === 'entero') {
        control = '<input type="number"' + dato + describe + ' inputmode="numeric" min="0" step="1" value="' + Escape.attr(v) + '">';
      } else if (campo.control === 'porcentaje') {
        control = '<div class="ini-pct"><input type="number"' + dato + describe + ' inputmode="decimal" min="0" max="100" step="0.01"' +
          (campo.requiereCategoria && !(this.solicitud && this.solicitud.categoria()) ? ' disabled' : '') +
          ' value="' + Escape.attr(v) + '"><span class="ini-pct-sufijo" aria-hidden="true">%</span></div>';
      } else {
        control = '<input type="text"' + dato + describe + ' value="' + Escape.attr(v) + '">';
      }
      var oculto = ayuda ? '<span class="ini-sr" id="' + id + '-ayuda">' + Escape.html(ayuda) + '</span>' : '';
      var msg = numerico ? '<small class="ini-motivo" id="' + id + '-msg" aria-live="polite"></small>' : '';
      return '<div class="ini-campo ini-campo-captura">' + rotulo + control + msg + oculto + '</div>';
    }

    // 02 Informacion del problema y 03 Impacto, cada uno en su contenedor.
    pintarCamposComunes() {
      var self = this, s = this.solicitud;
      [['info', 'iniCamposComunes'], ['impacto', 'iniCamposImpacto']].forEach(function (par) {
        self.$(par[1]).innerHTML = CAMPOS_COMUNES.filter(function (c) { return c.seccion === par[0]; })
          .map(function (c) { return self.htmlCampo(c, s ? s.valores[c.clave] : ''); }).join('');
      });
      if (s) this.pintarMensaje('volumetria', '');
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
      ['iniCamposComunes', 'iniCamposImpacto', 'iniCamposTipo'].forEach(function (id) {
        self.$(id).addEventListener('input', function (e) {
          var clave = e.target && e.target.getAttribute && e.target.getAttribute('data-campo');
          if (!clave || !self.solicitud) return;
          self.solicitud.capturar(clave, e.target.value);
          if (clave === 'volumetria') self.pintarMensaje(clave, '');
          else if (clave === 'pct') self.pintarPct(self.solicitud.estado().pct);
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
    AYUDA_FIJA: AYUDA_FIJA,
    VALIDAR: VALIDAR,
    fraccionDe: fraccionDe,
    DEFINICIONES_TIPO: DEFINICIONES_TIPO,
    CatalogoIniciativas: CatalogoIniciativas,
    CascadaOrganizacional: CascadaOrganizacional,
    SolicitudNueva: SolicitudNueva,
    VISTAS: VISTAS,
    MenuLateral: MenuLateral,
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
