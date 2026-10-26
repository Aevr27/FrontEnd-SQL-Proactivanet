/* =========================================================================
   assets/js/seleccion-kpi.js

   El indicador elegido con un clic en una tarjeta KPI (o en otro boton que
   haga de indicador, como el semaforo del Registro de iniciativas). Sacado
   del Registro (admin/registro-iniciativas.js, FiltroRegistro) para que
   otra pestaña lo use sin copiar la mecanica.

   QUE HACE (y nada mas)
   ---------------------
     - recuerda UNA clave elegida ('' = ninguna);
     - alternar(k): la misma clave la quita; otra valida la reemplaza; una
       clave que "limpia" (p. ej. Total) quita la elegida; una que no existe
       no cambia nada;
     - reconciliar(): tras una relectura conserva la elegida si sigue siendo
       valida y la quita si no;
     - atributos(k): el data-* y el aria-pressed del boton de k, para la
       plantilla que pinta el modulo. Las claves que limpian no son un
       estado: van sin aria-pressed (son una accion, "ver todo");
     - clases(k) y boton(k, etiqueta, titulo): las clases de la tarjeta y
       el boton que la cubre, con las reglas de assets/css/kpi.css
       (.kpi-filtrable, .kpi-filtro, .kpi-sel), para no copiar la
       plantilla en cada pestaña;
     - escuchar(): UN escucha de clic delegado por contenedor. Los botones
       son <button>, asi que Enter y espacio tambien llegan como clic;
     - enfocar(): devuelve el foco al boton pulsado despues de que el modulo
       repinto sus tarjetas con innerHTML.

   QUE NO HACE: no sabe que significa ninguna clave ni que registros cuenta,
   no filtra, no pide datos, no pinta tarjetas, no guarda nada en el
   navegador (el estado dura lo que dura la pagina, como KpisFijos) y no
   anuncia nada por su cuenta: el aviso para lectores de pantalla lo da el
   modulo en su propia cuenta de la lista (aria-live), no la rejilla entera.
   Todo eso es del modulo que la usa.

   Uso:
     var sel = new SeleccionKpi({
       valida: function (k) { return ...; },   // la clave existe hoy
       limpian: ['total'],                      // opcional
       atributo: 'data-indicador'               // opcional (el de omision)
     });
     sel.alternar('cerradas');  // -> true si cambio
     sel.clave;                 // 'cerradas'
     '<button type="button"' + sel.atributos('cerradas') + '>'
     '<div class="kpi' + sel.clases('cerradas') + '">...' +
       sel.boton('cerradas', 'Cerradas: 12') + '</div>'
     SeleccionKpi.escuchar([caja], 'data-indicador', function (k) { ... });
     SeleccionKpi.enfocar([caja], 'data-indicador', 'cerradas');

   Lo prueba tools/tests/SeleccionKpiSmoke.js.
   ========================================================================= */
window.SeleccionKpi = (function () {
  'use strict';

  var ATRIBUTO = 'data-indicador';

  function attr(v) {
    return String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  class SeleccionKpi {
    constructor(opciones) {
      var o = opciones || {};
      this.valida = typeof o.valida === 'function' ? o.valida : function () { return true; };
      this.limpian = (o.limpian || []).slice();
      this.atributo = o.atributo || ATRIBUTO;
      this.clave = '';
    }

    limpia(k) { return this.limpian.indexOf(k) >= 0; }
    es(k) { return !!k && k === this.clave; }

    // -> true si la eleccion cambio.
    alternar(k) {
      var antes = this.clave;
      if (this.limpia(k)) this.clave = '';
      else if (k === this.clave) this.clave = '';
      else if (k && this.valida(k)) this.clave = k;
      return this.clave !== antes;
    }

    limpiar() {
      var antes = this.clave;
      this.clave = '';
      return antes !== '';
    }

    // Tras releer los datos: la elegida sigue si todavia es valida.
    reconciliar() {
      if (this.clave && !this.valida(this.clave)) return this.limpiar();
      return false;
    }

    // La misma eleccion con otras reglas de validez (otra instancia del
    // filtro del modulo, sobre datos nuevos): copia y reconcilia.
    copiarEn(otra) {
      otra.clave = this.clave;
      otra.reconciliar();
      return otra;
    }

    // ' data-indicador="k" aria-pressed="true|false"' (sin aria-pressed en
    // las claves que limpian).
    atributos(k) {
      return ' ' + this.atributo + '="' + attr(k) + '"' +
        (this.limpia(k) ? '' : ' aria-pressed="' + (this.es(k) ? 'true' : 'false') + '"');
    }

    // ' kpi-filtrable' (+ ' kpi-sel' si es la elegida): las clases de la
    // tarjeta .kpi de `k` (assets/css/kpi.css). Las que limpian no se
    // marcan nunca como elegidas.
    clases(k) {
      return ' kpi-filtrable' + (!this.limpia(k) && this.es(k) ? ' kpi-sel' : '');
    }

    // El boton transparente que cubre la tarjeta de `k` (.kpi-filtro de
    // assets/css/kpi.css): sin botones anidados, el rotulo y la cifra
    // quedan debajo y el nombre accesible lo da `etiqueta`. `titulo`,
    // opcional, es el title de la tarjeta (queda encima de ella).
    boton(k, etiqueta, titulo) {
      return '<button type="button" class="kpi-filtro"' + this.atributos(k) +
        ' aria-label="' + attr(etiqueta) + '"' + (titulo ? ' title="' + attr(titulo) + '"' : '') + '></button>';
    }

    // La clave del boton sobre el que cayo el evento, o ''. Un hijo del
    // boton cuenta; un elemento sin el atributo (p. ej. un globo de ayuda
    // dentro de la tarjeta) no.
    static claveDelEvento(e, atributo) {
      var el = e && e.target;
      if (el && el.closest) el = el.closest('[' + atributo + ']');
      var k = el && el.getAttribute ? el.getAttribute(atributo) : null;
      return k || '';
    }

    // Un escucha delegado por contenedor: sobrevive a cada innerHTML del
    // modulo. Conectar dos veces el mismo contenedor no duplica.
    static escuchar(contenedores, atributo, alPulsar) {
      (contenedores || []).forEach(function (caja) {
        if (!caja || !caja.addEventListener) return;
        caja.__seleccionKpi = caja.__seleccionKpi || {};
        if (caja.__seleccionKpi[atributo]) return;
        caja.__seleccionKpi[atributo] = true;
        caja.addEventListener('click', function (e) {
          var k = SeleccionKpi.claveDelEvento(e, atributo);
          if (k) alPulsar(k, e);
        });
      });
    }

    // Foco al boton de `k` en el primer contenedor que lo tenga. -> true si
    // lo encontro.
    static enfocar(contenedores, atributo, k) {
      return (contenedores || []).some(function (caja) {
        var botones = caja && caja.querySelectorAll ? caja.querySelectorAll('[' + atributo + ']') : [];
        for (var n = 0; n < botones.length; n++) {
          if (botones[n].getAttribute(atributo) === k) {
            if (botones[n].focus) botones[n].focus();
            return true;
          }
        }
        return false;
      });
    }
  }

  return SeleccionKpi;
})();
