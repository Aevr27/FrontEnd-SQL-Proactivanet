/* =========================================================================
   admin/cambios-recientes.js - "Cambios recientes" (pestaña Administracion,
   solo ADM). handlers/admin_iniciativas_recientes.ashx (GET).

   Las ultimas iniciativas con un cambio guardado DESDE EL DASHBOARD (alta,
   edicion directa o solicitud aplicada), la mas reciente primero. No es
   bitacora ni dice que campos cambiaron. No incluye lo hecho en SSMS ni por
   la carga del Excel (sql/23_cambios_recientes.sql).

   El servidor manda solo folio, hora y usuario; titulo y estado salen del
   registro que la pagina ya cargo (VistaRegistro), y "Ver" abre el MISMO
   detalle de Iniciativas (abrirDesdeLista): no toca filtros, busqueda,
   orden ni "mostrar mas". Un folio que no esta en el registro cargado NO
   se descarta: se muestra con su aviso y se puede releer el registro
   (actualizar(), que conserva la vista).

   Solo UX: el servidor exige ADM (AccesoAdmin.ExigirAdm).
   Se prueba en node: tools/tests/CambiosRecientesSmoke.js.
   ========================================================================= */
window.CambiosRecientes = (function () {
  'use strict';

  var URL = '../handlers/admin_iniciativas_recientes.ashx';

  function h(s) { return Escape.html(s === null || s === undefined ? '' : String(s)); }
  // "aaaa-mm-ddThh:mm:ssZ" (UTC) -> hora local legible (como la cola de solicitudes).
  function fechaHora(utc) {
    if (!utc) return '—';
    var d = new Date(utc);
    if (isNaN(d.getTime())) return h(utc);
    function dos(n) { return (n < 10 ? '0' : '') + n; }
    return dos(d.getDate()) + '/' + dos(d.getMonth() + 1) + '/' + d.getFullYear() + ' ' + dos(d.getHours()) + ':' + dos(d.getMinutes());
  }

  // cambios: [{ folio, fecha_utc, usuario, accion }]. registro: el Registro
  // cargado (con buscar(folio)) o null si aun no hay. faltantesReleidos:
  // folios que siguieron sin aparecer tras releer el registro.
  function htmlLista(cambios, registro, faltantesReleidos) {
    faltantesReleidos = faltantesReleidos || {};
    var faltan = false;
    var filas = cambios.map(function (c) {
      var i = registro ? registro.buscar(c.folio) : null;
      var iniciativa, accion;
      if (i) {
        iniciativa = h(i.titulo || '—') + (i.estado ? '<span class="ini-sub">' + h(i.estado) + '</span>' : '');
        accion = '<button type="button" class="btn linea chico" data-cr-folio="' + h(c.folio) + '">Ver</button>';
      } else if (!registro) {
        iniciativa = '<span class="ini-sub">El registro de iniciativas todavía no está cargado.</span>';
        accion = '';
      } else {
        faltan = true;
        iniciativa = '<span class="ini-cr-falta">' + (faltantesReleidos[c.folio]
          ? 'Sigue sin aparecer en el registro de Iniciativas: su detalle no se puede abrir aquí.'
          : 'No está en el registro de Iniciativas cargado (puede no estar vigente o haberse guardado después de cargarlo).') + '</span>';
        accion = '';
      }
      return '<tr><td>' + (i ? '<button type="button" class="ini-folio" data-cr-folio="' + h(c.folio) + '">' + h(c.folio) + '</button>' : h(c.folio)) + '</td>' +
        '<td>' + iniciativa + '</td>' +
        '<td>' + (c.accion === 'alta' ? 'Alta' : 'Cambio') + '</td>' +
        '<td>' + fechaHora(c.fecha_utc) + '</td>' +
        '<td>' + h(c.usuario || '—') + '</td>' +
        '<td>' + accion + '</td></tr>';
    }).join('');
    return '<table class="ini-det-tabla ini-cr-tabla"><thead><tr><th scope="col">Código</th><th scope="col">Iniciativa</th>' +
      '<th scope="col">Qué</th><th scope="col">Guardado</th><th scope="col">Por</th><th scope="col"><span class="ini-sr">Abrir</span></th></tr></thead>' +
      '<tbody>' + filas + '</tbody></table>' +
      (faltan ? '<p class="ini-nota"><button type="button" class="btn linea chico" data-cr-releer>Actualizar registro</button> ' +
                'Relee el registro sin cambiar filtros ni búsqueda.</p>' : '');
  }

  function leer(resp) {
    return Promise.resolve(resp.json()).catch(function () { return null; }).then(function (j) { return { status: resp.status, json: j || {} }; });
  }

  class VistaCambiosRecientes {
    // pedir(url, op) -> Promise<Response> (fetch por omision).
    // registro() -> el Registro cargado o null.
    // abrirIniciativa(folio) -> abre su detalle en Iniciativas.
    // releer() -> Promise (VistaRegistro.actualizar: conserva la vista).
    constructor(doc, pedir, registro, abrirIniciativa, releer) {
      this.doc = doc;
      this.pedir = pedir || function (url, op) { return fetch(url, op); };
      this.registro = registro || function () { return null; };
      this.abrirIniciativa = abrirIniciativa || function () {};
      this.releer = releer || function () { return Promise.resolve(); };
      this.cambios = null;
      this.faltantesReleidos = {};
      this.cargaId = 0;      // descarta la respuesta de una carga ya superada
      this.cableado = false;
    }

    $(id) { return this.doc.getElementById(id); }

    cablear() {
      if (this.cableado || !this.$('crSeccion')) return;
      this.cableado = true;
      var self = this;
      this.$('crActualizar').addEventListener('click', function () { self.cargar(); });
      this.$('crReintentar').addEventListener('click', function () { self.cargar(); });
      this.$('crLista').addEventListener('click', function (e) {
        var t = e.target;
        var el = t && t.closest ? t.closest('[data-cr-folio],[data-cr-releer]') : t;
        if (!el || !el.getAttribute) return;
        if (el.getAttribute('data-cr-releer') !== null) { self.releerRegistro(); return; }
        var folio = el.getAttribute('data-cr-folio');
        if (folio) self.verIniciativa(folio);
      });
    }

    // cargando | error | vacio | listo: excluyentes; cargando y error
    // nunca se ven como lista vacia.
    estado(e, texto) {
      this.$('crCargando').hidden = e !== 'cargando';
      this.$('crError').hidden = e !== 'error';
      this.$('crVacio').hidden = e !== 'vacio';
      this.$('crLista').hidden = e !== 'listo';
      if (e === 'error') this.$('crErrorTexto').textContent = texto || '';
      if (e === 'vacio') this.$('crVacioTexto').textContent = texto || '';
    }

    // Al mostrar la pestaña Administracion.
    abrir() {
      this.cablear();
      return this.cargar();
    }

    cargar() {
      var self = this, mia = ++this.cargaId;
      this.estado('cargando');
      return Promise.resolve().then(function () { return self.pedir(URL, { cache: 'no-store', credentials: 'same-origin' }); })
        .then(leer)
        .then(function (r) {
          if (mia !== self.cargaId) return null;
          if (r.status !== 200 || !Array.isArray(r.json.cambios)) {
            self.cambios = null;
            self.estado('error', r.json.error || ('Respuesta ' + r.status + '.'));
            return null;
          }
          if (r.json.alcance && self.$('crAlcance')) self.$('crAlcance').textContent = r.json.alcance;
          self.cambios = r.json.cambios;
          self.faltantesReleidos = {};
          if (r.json.estado === 'sin_columna') {
            self.estado('vacio', 'Los cambios recientes todavía no están habilitados en la base de datos.');
          } else if (!self.cambios.length) {
            self.estado('vacio', 'Todavía no hay cambios guardados desde el Dashboard.');
          } else {
            self.pintar();
          }
          return self.cambios;
        }, function () {
          if (mia !== self.cargaId) return null;
          self.cambios = null;
          self.estado('error', 'No se pudo contactar al servidor.');
          return null;
        });
    }

    pintar() {
      if (!this.cambios || !this.cambios.length) return;
      this.$('crLista').innerHTML = htmlLista(this.cambios, this.registro(), this.faltantesReleidos);
      this.estado('listo');
    }

    verIniciativa(folio) {
      var reg = this.registro();
      if (!reg || !reg.buscar(folio)) { this.pintar(); return false; }
      this.abrirIniciativa(folio);
      return true;
    }

    // Relee el registro (sin tocar su vista) y repinta. Lo que siga sin
    // aparecer se queda en la lista con su aviso.
    releerRegistro() {
      var self = this;
      return Promise.resolve(this.releer()).then(function () {
        var reg = self.registro();
        (self.cambios || []).forEach(function (c) { if (reg && !reg.buscar(c.folio)) self.faltantesReleidos[c.folio] = true; });
        self.pintar();
      });
    }
  }

  return { VistaCambiosRecientes: VistaCambiosRecientes, htmlLista: htmlLista, URL: URL };
})();
