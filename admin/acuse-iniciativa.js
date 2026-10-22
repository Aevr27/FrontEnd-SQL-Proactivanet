/* =========================================================================
   admin/acuse-iniciativa.js - acuse "Estoy trabajando en ello" del PO / SO
   y los avisos de ADM. handlers/admin_iniciativas_acuse.ashx (sql/28).

   QUIEN VE EL BOTON (solo UX: el servidor revalida TODO en el POST)
     El PO o el SO asignado (dbo.Problem.OwnerProblem / OwnerServicio), cada
     uno en su rol, y solo si la iniciativa esta en "Atrasadas" del semaforo
     (Registro.semaforoFecha, la misma clasificacion de la lista). Quien es
     dueño de que lo dice el servidor (accion=mio: cuenta de IIS ->
     cuenta@soriana.com -> dbo.CatPersona -> nombre del dueño); aqui no se
     compara ningun nombre ni se manda ninguna cuenta, solo folio y rol.
     Si ya hay un acuse de ese rol para la fecha compromiso de hoy, en lugar
     del boton se dice cuando se registro.

   AVISOS DE ADM (pestaña Administracion)
     Persistentes: salen de la base, no de la sesion. Listar NO marca nada;
     "Marcar como leida" es explicito y por administrador. "Ver" abre el
     mismo detalle de Iniciativas.

   El acuse no cambia la iniciativa (estado, fechas, dueños, semaforo).
   Sin sql/28 (disponible = false) no se pinta nada.
   Se prueba en node: tools/tests/AcuseIniciativaSmoke.js.
   ========================================================================= */
window.AcuseIniciativa = (function () {
  'use strict';

  var URL = '../handlers/admin_iniciativas_acuse.ashx';
  var ROLES = { PO: 'Product Owner', SO: 'Service Owner' };

  function h(s) { return Escape.html(s === null || s === undefined ? '' : String(s)); }
  function dos(n) { return (n < 10 ? '0' : '') + n; }
  // "aaaa-mm-ddThh:mm:ssZ" (UTC) -> hora local legible.
  function fechaHora(utc) {
    if (!utc) return '—';
    var d = new Date(utc);
    if (isNaN(d.getTime())) return h(utc);
    return dos(d.getDate()) + '/' + dos(d.getMonth() + 1) + '/' + d.getFullYear() + ' ' + dos(d.getHours()) + ':' + dos(d.getMinutes());
  }
  function fecha(s) { return s ? String(s).split('-').reverse().join('/') : 'sin fecha'; }

  function leer(resp) {
    return Promise.resolve(resp.json()).catch(function () { return null; })
      .then(function (j) { return { status: resp.status, json: j || {} }; });
  }

  // La fecha compromiso del estado actual (la misma de la lista), o null.
  function fechaDelEstado(i) {
    var R = window.RegistroIniciativas, campo = R && R.FECHA_DEL_ESTADO ? R.FECHA_DEL_ESTADO[i.estado] : null;
    return campo && i[campo] ? i[campo] : null;
  }
  function atrasada(i) {
    var R = window.RegistroIniciativas;
    return !!(R && R.Registro && R.Registro.semaforoFecha(i) === 'atrasada');
  }

  // ---------------------------------------------------------------------
  // Cliente del handler
  // ---------------------------------------------------------------------
  class ClienteAcuse {
    constructor(pedir) {
      this.pedir = pedir || function (url, op) { return fetch(url, op); };
      this.mioPromesa = null;
    }

    get(params) {
      var self = this;
      return Promise.resolve().then(function () {
        return self.pedir(URL + '?' + params, { cache: 'no-store', credentials: 'same-origin' });
      }).then(leer);
    }

    post(accion, campos) {
      var self = this;
      var cuerpo = Object.keys(campos).map(function (k) {
        return encodeURIComponent(k) + '=' + encodeURIComponent(campos[k]);
      }).join('&');
      return Promise.resolve().then(function () {
        return self.pedir(URL + '?accion=' + accion, {
          method: 'POST', credentials: 'same-origin', cache: 'no-store',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' }, body: cuerpo
        });
      }).then(leer);
    }

    // Una vez por pagina; si falla se vuelve a pedir la proxima vez.
    mio() {
      var self = this;
      if (!this.mioPromesa) {
        this.mioPromesa = this.get('accion=mio').then(function (r) {
          if (r.status !== 200) { self.mioPromesa = null; return { disponible: false, roles: {} }; }
          return r.json;
        }, function () { self.mioPromesa = null; return { disponible: false, roles: {} }; });
      }
      return this.mioPromesa;
    }

    deIniciativa(folio) { return this.get('accion=iniciativa&folio=' + encodeURIComponent(folio)); }
    acusar(folio, rol) { return this.post('acusar', { folio: folio, rol: rol }); }
    bandeja() { return this.get('accion=bandeja'); }
    leida(id) { return this.post('leida', { id: id }); }
  }

  // ---------------------------------------------------------------------
  // En el detalle de una iniciativa
  // ---------------------------------------------------------------------
  // -> los roles que este usuario puede acusar HOY en la iniciativa `i`:
  // dueño de ese rol (servidor) y Atrasada (semaforo).
  function rolesAcusables(i, mio) {
    if (!mio || !mio.disponible || !atrasada(i)) return [];
    var r = mio.roles && mio.roles[i.folio];
    return Array.isArray(r) ? r.filter(function (x) { return x === 'PO' || x === 'SO'; }) : [];
  }

  // El acuse de ese rol para la fecha compromiso de hoy, o null.
  function acuseVigente(acuses, rol, fechaHoy) {
    for (var k = 0; k < (acuses || []).length; k++) {
      var a = acuses[k];
      if (a.rol === rol && (a.fecha_compromiso || null) === (fechaHoy || null)) return a;
    }
    return null;
  }

  function htmlDetalle(i, mio, acuses, aviso, enviando) {
    if (!mio || !mio.disponible) return '';
    var fechaHoy = fechaDelEstado(i);
    var partes = rolesAcusables(i, mio).map(function (rol) {
      var ya = acuseVigente(acuses, rol, fechaHoy);
      if (ya) {
        return '<p class="ini-acuse-hecho">Registraste que estás trabajando en ella como ' + h(ROLES[rol]) +
          ' el ' + fechaHora(ya.fecha_utc) + '.</p>';
      }
      return '<button type="button" class="btn linea chico ini-acuse-btn" data-acuse-rol="' + rol + '"' + (enviando ? ' disabled' : '') + '>' +
        (enviando === rol ? 'Registrando…' : 'Estoy trabajando en ello (' + h(ROLES[rol]) + ')') + '</button>';
    });
    var lista = (acuses || []).map(function (a) {
      return '<li><b>' + h(a.rol) + '</b> ' + h(a.nombre) + ' · ' + fechaHora(a.fecha_utc) +
        ' <span class="ini-tenue">(compromiso ' + h(fecha(a.fecha_compromiso)) + ')</span></li>';
    }).join('');
    if (!partes.length && !lista && !aviso) return '';
    return '<div class="ini-acuse" role="group" aria-label="Acuse de los dueños">' +
      (partes.length ? '<div class="ini-acuse-acciones">' + partes.join('') + '</div>' +
        '<p class="ini-nota">Avisa a los administradores que la iniciativa atrasada está en atención. ' +
        'No cambia el estado, las fechas ni el semáforo.</p>' : '') +
      (aviso ? '<p class="ini-cambio-msg ' + aviso.clase + '" role="status">' + aviso.html + '</p>' : '') +
      (lista ? '<p class="ini-acuse-tit">Acuses de los dueños</p><ul class="ini-acuse-lista">' + lista + '</ul>' : '') +
      '</div>';
  }

  class AcuseDetalle {
    constructor(doc, pedir, cliente) {
      this.doc = doc;
      this.cliente = cliente || new ClienteAcuse(pedir);
      this.i = null;
      this.caja = null;
      this.mioDatos = null;
      this.acuses = null;
      this.aviso = null;
      this.enviando = null;
      this.carga = 0;
    }

    // Cada vez que se abre un detalle: `caja` es nueva (el detalle se repinta).
    mostrar(i, caja) {
      var self = this, mia = ++this.carga;
      this.i = i;
      this.caja = caja;
      this.acuses = null;
      this.aviso = null;
      this.enviando = null;
      if (!caja) return Promise.resolve();
      caja.innerHTML = '';
      caja.hidden = true;
      if (caja.addEventListener) {
        caja.addEventListener('click', function (e) {
          var el = e.target && e.target.closest ? e.target.closest('[data-acuse-rol]') : e.target;
          var rol = el && el.getAttribute && el.getAttribute('data-acuse-rol');
          if (rol && mia === self.carga) self.acusar(rol);
        });
      }
      return Promise.all([this.cliente.mio(), this.cliente.deIniciativa(i.folio)]).then(function (res) {
        if (mia !== self.carga) return;
        self.mioDatos = res[0];
        self.acuses = res[1].status === 200 && Array.isArray(res[1].json.acuses) ? res[1].json.acuses : [];
        self.pintar();
      }, function () { /* sin acuse: el detalle sigue igual */ });
    }

    pintar() {
      if (!this.caja) return;
      var html = htmlDetalle(this.i, this.mioDatos, this.acuses, this.aviso, this.enviando);
      this.caja.innerHTML = html;
      this.caja.hidden = html === '';
    }

    acusar(rol) {
      if (this.enviando || !this.i) return Promise.resolve();
      var self = this, i = this.i, mia = this.carga;
      this.enviando = rol;
      this.aviso = null;
      this.pintar();
      return this.cliente.acusar(i.folio, rol).then(function (r) {
        if (mia !== self.carga) return;
        self.enviando = null;
        if (r.status === 200 && r.json.acusado) {
          self.aviso = { clase: 'listo', html: (r.json.nuevo ? '<strong>Registrado.</strong> ' : '<strong>Ya estaba registrado.</strong> ') +
            'Los administradores lo verán en sus avisos (' + fechaHora(r.json.fecha_utc) + ').' };
        } else {
          self.aviso = { clase: 'aviso', html: '<strong>No se registró.</strong> ' + h(r.json.error || ('Respuesta ' + r.status + '.')) };
        }
        return self.cliente.deIniciativa(i.folio).then(function (d) {
          if (mia !== self.carga) return;
          if (d.status === 200 && Array.isArray(d.json.acuses)) self.acuses = d.json.acuses;
          self.pintar();
        }, function () { self.pintar(); });
      }, function () {
        if (mia !== self.carga) return;
        self.enviando = null;
        self.aviso = { clase: 'aviso', html: '<strong>No se pudo contactar al servidor.</strong> Reinténtalo: el acuse no se duplica.' };
        self.pintar();
      });
    }
  }

  // ---------------------------------------------------------------------
  // Avisos de ADM (pestaña Administracion)
  // ---------------------------------------------------------------------
  function htmlBandeja(notifs, registro) {
    var filas = notifs.map(function (n) {
      var i = registro ? registro.buscar(n.folio) : null;
      return '<tr class="' + (n.leida ? 'ini-av-leida' : 'ini-av-nueva') + '">' +
        '<td>' + (n.leida ? '<span class="ini-tenue">Leído</span>' : '<span class="pill ini-av-pill">Nuevo</span>') + '</td>' +
        '<td>' + (i ? '<button type="button" class="ini-folio" data-av-folio="' + h(n.folio) + '">' + h(n.folio) + '</button>' : h(n.folio)) + '</td>' +
        '<td>' + (i ? h(i.titulo || '—') : '<span class="ini-sub">No está en el registro cargado.</span>') + '</td>' +
        '<td>' + h(n.nombre) + '<span class="ini-sub">' + h(ROLES[n.rol] || n.rol) + ' · ' + h(n.cuenta) + '</span></td>' +
        '<td>' + fechaHora(n.fecha_utc) + '<span class="ini-sub">compromiso ' + h(fecha(n.fecha_compromiso)) + '</span></td>' +
        '<td>' + (n.leida ? '' : '<button type="button" class="btn linea chico" data-av-leida="' + h(n.id_notificacion) + '">Marcar como leído</button>') +
          (i ? ' <button type="button" class="btn linea chico" data-av-folio="' + h(n.folio) + '">Ver</button>' : '') + '</td></tr>';
    }).join('');
    return '<table class="ini-det-tabla ini-av-tabla"><thead><tr><th scope="col">Estado</th><th scope="col">Código</th>' +
      '<th scope="col">Iniciativa</th><th scope="col">Quién</th><th scope="col">Cuándo</th><th scope="col"><span class="ini-sr">Acciones</span></th></tr></thead>' +
      '<tbody>' + filas + '</tbody></table>';
  }

  class VistaAvisosAcuse {
    // registro() -> el Registro cargado o null; abrirIniciativa(folio).
    constructor(doc, pedir, registro, abrirIniciativa, cliente) {
      this.doc = doc;
      this.cliente = cliente || new ClienteAcuse(pedir);
      this.registro = registro || function () { return null; };
      this.abrirIniciativa = abrirIniciativa || function () {};
      this.datos = null;
      this.carga = 0;
      this.cableado = false;
    }

    $(id) { return this.doc.getElementById(id); }

    cablear() {
      if (this.cableado || !this.$('avSeccion')) return;
      this.cableado = true;
      var self = this;
      this.$('avActualizar').addEventListener('click', function () { self.cargar(); });
      this.$('avReintentar').addEventListener('click', function () { self.cargar(); });
      this.$('avLista').addEventListener('click', function (e) {
        var t = e.target;
        var el = t && t.closest ? t.closest('[data-av-folio],[data-av-leida]') : t;
        if (!el || !el.getAttribute) return;
        var id = el.getAttribute('data-av-leida');
        if (id) { self.marcarLeida(Number(id), el); return; }
        var folio = el.getAttribute('data-av-folio');
        if (folio) self.abrirIniciativa(folio);
      });
    }

    estado(e, texto) {
      this.$('avCargando').hidden = e !== 'cargando';
      this.$('avError').hidden = e !== 'error';
      this.$('avVacio').hidden = e !== 'vacio';
      this.$('avLista').hidden = e !== 'listo';
      if (e === 'error') this.$('avErrorTexto').textContent = texto || '';
      if (e === 'vacio') this.$('avVacioTexto').textContent = texto || '';
    }

    abrir() {
      this.cablear();
      return this.cargar();
    }

    cargar() {
      var self = this, mia = ++this.carga;
      this.estado('cargando');
      return this.cliente.bandeja().then(function (r) {
        if (mia !== self.carga) return null;
        if (r.status !== 200) { self.datos = null; self.estado('error', r.json.error || ('Respuesta ' + r.status + '.')); self.pintarCuenta(); return null; }
        self.datos = r.json;
        if (!r.json.disponible) self.estado('vacio', 'El acuse de los dueños todavía no está habilitado en la base de datos.');
        else self.pintar();
        self.pintarCuenta();
        return self.datos;
      }, function () {
        if (mia !== self.carga) return null;
        self.datos = null;
        self.estado('error', 'No se pudo contactar al servidor.');
        self.pintarCuenta();
        return null;
      });
    }

    pintarCuenta() {
      var n = this.datos && this.datos.disponible ? this.datos.no_leidas || 0 : 0;
      this.$('avNoLeidas').textContent = n ? (n === 1 ? '1 sin leer' : n + ' sin leer') : '';
    }

    pintar() {
      var lista = this.datos && Array.isArray(this.datos.notificaciones) ? this.datos.notificaciones : [];
      if (!lista.length) { this.estado('vacio', 'Todavía no hay avisos de los dueños.'); return; }
      this.$('avLista').innerHTML = htmlBandeja(lista, this.registro());
      this.estado('listo');
    }

    marcarLeida(id, boton) {
      var self = this;
      if (boton) boton.disabled = true;
      return this.cliente.leida(id).then(function (r) {
        if (r.status !== 200 || !r.json.leida) {
          if (boton) boton.disabled = false;
          self.$('avErrorTexto').textContent = r.json.error || ('Respuesta ' + r.status + '.');
          self.$('avError').hidden = false;
          return false;
        }
        (self.datos.notificaciones || []).forEach(function (n) {
          if (n.id_notificacion === id && !n.leida) { n.leida = true; self.datos.no_leidas = Math.max(0, (self.datos.no_leidas || 0) - 1); }
        });
        self.$('avError').hidden = true;
        self.pintar();
        self.pintarCuenta();
        return true;
      }, function () {
        if (boton) boton.disabled = false;
        return false;
      });
    }
  }

  return {
    URL: URL,
    ClienteAcuse: ClienteAcuse,
    AcuseDetalle: AcuseDetalle,
    VistaAvisosAcuse: VistaAvisosAcuse,
    rolesAcusables: rolesAcusables,
    acuseVigente: acuseVigente,
    htmlDetalle: htmlDetalle,
    htmlBandeja: htmlBandeja
  };
})();
