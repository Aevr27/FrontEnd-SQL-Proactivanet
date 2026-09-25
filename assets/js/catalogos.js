/* =========================================================================
   assets/js/catalogos.js

   Las <option> de los filtros, una sola copia para todo el tablero.

   Cada pestaña llenaba sus <select> con su propia plantilla
   `<option value="${attr(v)}">${html(v)}</option>`: dashboard.js
   (Grupos / Tecnicos de SLA y Call Center), backlog.js (C1 / Grupos /
   Lideres) y experiencia.js (Director / PO / Manager / SO). Eran la misma
   linea, y aqui queda una.

   Lo que NO hace, a proposito:
     - no decide QUE catalogo lleva cada pestaña ni de donde sale: eso sigue
       en cada modulo y en su .ashx;
     - no sabe de dependencias entre filtros (Director -> PO, Manager -> SO,
       el acotado del Call Center): siguen donde estaban;
     - no lee ni guarda la seleccion. El <select> sigue siendo la fuente de la
       verdad, y el desplegable propio (desplegable.js) se entera solo por su
       MutationObserver, igual que antes.

   Uso:
     Catalogos.opciones(valores)          -> '<option ...>...</option>...'
     Catalogos.llenar(sel, valores)       reemplaza las <option> del <select>
     Catalogos.llenar(sel, valores, todo) igual, con una primera opcion
                                          value="" y el texto `todo`
                                          (p. ej. '— Todos —')

   Cada valor es a la vez value y texto, escapado con Escape (escape.js), que
   tiene que estar cargado antes. `valores` tiene que ser un arreglo: quien
   llama conserva su propio `?? []` / `|| []`.

   DONDE SE CARGA
   Como escape.js: en dashboard.html, antes de dashboard.js y de los modulos
   embebidos (que pierden sus <script> al montarse y usan esa copia), y en las
   paginas sueltas backlog.html y experiencia.html.
   ========================================================================= */
window.Catalogos = (function () {
  'use strict';

  function opcion(valor, texto) {
    return '<option value="' + Escape.attr(valor) + '">' + Escape.html(texto) + '</option>';
  }

  function opciones(valores) {
    return valores.map(function (v) { return opcion(v, v); }).join('');
  }

  function llenar(sel, valores, textoTodos) {
    var primera = (textoTodos === undefined || textoTodos === null) ? '' : opcion('', textoTodos);
    sel.innerHTML = primera + opciones(valores);
  }

  return { opciones: opciones, llenar: llenar };
})();
