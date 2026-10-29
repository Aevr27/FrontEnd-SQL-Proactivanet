/* SesionAdmin — que puede ver de Admin quien esta mirando la pagina.

   Pregunta a handlers/admin_sesion.ashx y:
     - muestra los elementos marcados con data-solo-registro si el
       servidor dice registro: true: todos, tambien anonimos
       (AccesoIniciativas.PuedeVerRegistro; no depende del rol ni de ser
       PO/SO). La entrada Iniciativas del menu ya NO lo lleva: se ve
       siempre;
     - muestra los marcados con data-solo-adm (p. ej. "+ Crear
       iniciativa") solo si ademas el servidor dice rol "ADM"
       (dbo.UsuariosAdmin). MOD, sin rol o cualquier fallo: ocultos.
     - muestra los marcados con data-solo-solicitud ("Solicitar una
       iniciativa") solo si el servidor dice solicitante: true
       (AccesoIniciativas: ADM, MOD y Product Owner o Service Owner
       vigentes) y la respuesta es CONFIRMADA;
     - muestra los marcados con data-sesion-incierta (la entrada
       "Reintentar acceso") solo si el servidor NO pudo confirmar
       (verificacion: "incompleta" o un 5xx), no esta autorizado y no hay
       entrada Iniciativas que mostrar. Antes de rendirse reintenta UNA
       vez (ESPERA_REINTENTO); despues, solo si la persona pulsa
       Reintentar;
     - con { persona: true }, pinta "Bienvenido, <Nombre>" en el elemento
       que se le pase (autorizado o solicitante), solo si el servidor
       resolvio el nombre, y el correo
       (dbo.UsuariosAdmin.CorreoUsuario) en el otro, solo si el servidor lo
       mando. Nunca se arma un correo aqui.

   vigilar(alCambiar): con la pagina ya abierta, un 403 de un handler
   admin_* (perdio el rol o dejo de ser PO/SO)
   vuelve a preguntar UNA vez a admin_sesion (las que coinciden comparten
   la misma pregunta) y le pasa el resultado a alCambiar, que decide que
   ocultar. No recarga la pagina.

   ES SOLO UX. La seguridad esta en el servidor (AccesoAdmin.Exigir y
   AdminAccesoModulo): ocultar la entrada no protege nada, y mostrarla
   tampoco da acceso. Cualquier fallo de red (sin servidor, MOCK_DATA) deja
   todo oculto y en silencio: nunca un error a la vista ni un nombre
   inventado. */
(function (global) {
  'use strict';

  // Lo que se pinta cuando no hay respuesta util: nada visible.
  function nada(incierto) {
    return { autorizado: false, solicitante: false, registro: false, nombre: null, rol: null, correo: null, incierto: !!incierto };
  }

  // Un 403 de estos dice que la pagina abierta perdio algo (no admin_sesion,
  // que nunca responde 403).
  function esHandlerAdmin(url) {
    var u = typeof url === 'string' ? url : (url && typeof url.url === 'string' ? url.url : '');
    return /(^|\/)handlers\/admin_(?!sesion\.ashx)/i.test(u);
  }

  class SesionAdmin {
    // base: ruta relativa a la raiz del sitio ('' en dashboard.html,
    // '../' en admin/). pedir: fetch por omision; las pruebas pasan uno propio.
    constructor(base, pedir) {
      this.url = (base || '') + 'handlers/admin_sesion.ashx';
      this.pedir = pedir || function (url) { return fetch(url, { cache: 'no-store' }); };
      this.enCurso = null;
    }

    // -> Promise<{ autorizado, solicitante, registro, nombre, rol, correo, incierto }>.
    // Nunca rechaza. incierto: el servidor contesto pero no pudo confirmar.
    consultar(opciones) {
      var persona = !!(opciones && opciones.persona);
      var url = this.url + (persona ? '?persona=1' : '');
      var estado = 0;
      return Promise.resolve()
        .then(() => this.pedir(url))
        .then(function (r) {
          estado = r && typeof r.status === 'number' ? r.status : 0;
          return r && r.ok ? r.json() : null;
        })
        .then(function (json) {
          if (!json) return nada(estado >= 500);
          var nombre = typeof json.nombre === 'string' && json.nombre.trim()
            ? json.nombre.trim() : null;
          var autorizado = json.autorizado === true;
          // Solo si el servidor lo dice con un true de verdad (ADM, MOD o
          // PO/SO vigente).
          var solicitante = json.solicitante === true;
          // Toda cuenta autenticada ve el registro; ADM/MOD siempre.
          var registro = json.registro === true || autorizado;
          var rol = autorizado && (json.rol === 'ADM' || json.rol === 'MOD') ? json.rol : null;
          // Solo un correo con forma de correo; el servidor ya lo filtra.
          var correo = autorizado && typeof json.correo === 'string' && /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/.test(json.correo.trim())
            ? json.correo.trim() : null;
          return { autorizado: autorizado, solicitante: solicitante, registro: registro, nombre: nombre, rol: rol, correo: correo,
                   incierto: json.verificacion === 'incompleta' };
        })
        .catch(function () { return nada(false); });
    }

    // consultar() y, si no pudo confirmar, UNA vez mas tras ESPERA_REINTENTO.
    // Una sola a la vez: quien llama mientras otra va, recibe la misma.
    consultarFirme(opciones) {
      var self = this;
      if (this.enCurso) return this.enCurso;
      var espera = SesionAdmin.ESPERA_REINTENTO;
      this.enCurso = this.consultar(opciones).then(function (s) {
        if (!s.incierto || s.autorizado) return s;
        return new Promise(function (ok) { setTimeout(ok, espera); })
          .then(function () { return self.consultar(opciones); });
      }).then(function (s) { self.enCurso = null; return s; });
      return this.enCurso;
    }

    // Muestra/oculta [data-solo-*] y [data-sesion-incierta] dentro de doc
    // y, si se pasan, pinta el saludo y el correo.
    pintar(doc, s, saludo, correo) {
      // Sin confirmar y sin rol: el registro sigue (no depende de eso), sin
      // Solicitar; Reintentar solo si tampoco hay entrada Iniciativas.
      var incierto = !!s.incierto && !s.autorizado;
      doc.querySelectorAll('[data-solo-registro]').forEach(function (el) {
        el.hidden = !s.registro;
      });
      doc.querySelectorAll('[data-solo-adm]').forEach(function (el) {
        el.hidden = s.rol !== 'ADM';
      });
      doc.querySelectorAll('[data-solo-solicitud]').forEach(function (el) {
        el.hidden = !s.solicitante || incierto;
      });
      doc.querySelectorAll('[data-sesion-incierta]').forEach(function (el) {
        el.hidden = !(incierto && !s.registro);
      });
      if (saludo) {
        var conNombre = (s.autorizado || s.solicitante) && s.nombre;
        saludo.textContent = conNombre ? 'Bienvenido, ' + s.nombre : '';
        saludo.hidden = !conNombre;
      }
      if (correo) {
        correo.textContent = s.autorizado && s.correo ? s.correo : '';
        correo.hidden = !(s.autorizado && s.correo);
      }
      return s;
    }

    // consultarFirme() + pintar(). Devuelve la promesa con el estado.
    aplicar(raiz, saludo, correo) {
      var self = this;
      var doc = raiz || global.document;
      return this.consultarFirme({ persona: !!(saludo || correo) }).then(function (s) {
        return self.pintar(doc, s, saludo, correo);
      });
    }

    // Envuelve fetch de la pagina: un 403 de handlers/admin_* vuelve a
    // preguntar (una pregunta a la vez, sin reintento automatico) y pasa el
    // estado nuevo a alCambiar(s). La respuesta 403 sigue su camino igual.
    vigilar(alCambiar, opciones) {
      var self = this;
      var original = global.fetch;
      if (typeof original !== 'function' || original.__sesionVigilada) return this;
      var envuelto = function (url) {
        return original.apply(this, arguments).then(function (r) {
          if (r && r.status === 403 && esHandlerAdmin(url)) self.revisar(alCambiar, opciones);
          return r;
        });
      };
      envuelto.__sesionVigilada = true;
      global.fetch = envuelto;
      return this;
    }

    revisar(alCambiar, opciones) {
      if (this.revisando) return this.revisando;
      var self = this;
      this.revisando = (this.enCurso || this.consultar(opciones)).then(function (s) {
        self.revisando = null;
        try { if (alCambiar) alCambiar(s); } catch (e) { if (global.console) global.console.error(e); }
        return s;
      });
      return this.revisando;
    }
  }

  // Milisegundos antes del unico reintento automatico (las pruebas lo bajan).
  SesionAdmin.ESPERA_REINTENTO = 1500;
  SesionAdmin.esHandlerAdmin = esHandlerAdmin;

  global.SesionAdmin = SesionAdmin;
})(typeof window !== 'undefined' ? window : globalThis);
