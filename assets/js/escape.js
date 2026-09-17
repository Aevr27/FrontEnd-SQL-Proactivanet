/* =========================================================================
   ESCAPE DE HTML — una sola copia para todo el tablero.

   El tablero arma marcado con plantillas y lo mete con innerHTML. Todo lo
   que sale de SQL -nombres de Director, Product Owner, Service Owner,
   categorias, titulos, descripciones, folios, estados- es TEXTO DE DATO, no
   marcado: si llega con `<`, `>` o comillas y se pega tal cual, el navegador
   lo interpreta. Una categoria dada de alta en Proactivanet con un
   `<img onerror=...>` en el nombre se ejecutaria en el navegador de quien
   abra el tablero, y seguiria ahi en cada carga. Eso es un XSS almacenado:
   el dato viaja limpio por la API y se convierte en codigo AQUI, al pintarlo.

   La regla: el dato se escapa JUSTO al insertarlo en HTML. No se escapa al
   guardarlo, ni al traerlo, ni se toca la estructura de datos -los mismos
   objetos siguen sirviendo para calcular, ordenar, filtrar y exportar-.

   Para el texto normal no cambia nada de lo que se ve: "Dirección de TI"
   entra y sale igual. Solo cambia lo que ANTES habria sido marcado.

   -------------------------------------------------------------------------
   COMO USARLA
   -------------------------------------------------------------------------
     Escape.html(valor)   // texto que va DENTRO de un elemento
     Escape.attr(valor)   // valor que va dentro de un atributo entrecomillado

   Las dos escapan el mismo juego de caracteres -&, <, >, " y '-, que es lo
   que hace falta para las dos posiciones siempre que el atributo vaya entre
   comillas, como en todo el tablero. Son dos nombres porque dicen DONDE se
   esta metiendo el valor, y eso se lee en el sitio de uso.

   NO sirven para:
     - meter dato en un href/src de esquema libre (ahi el riesgo es
       `javascript:`, que el escape de HTML no quita),
     - meter dato dentro de un <script> o de un manejador en linea,
     - meter dato dentro de un bloque <style>.
   En esos tres casos el dato no debe ir ahi.

   -------------------------------------------------------------------------
   DONDE SE CARGA
   -------------------------------------------------------------------------
   Antes que cualquier modulo que la use: dashboard.html, experiencia.html,
   qa.html, orquestacion.html y observabilidad.html. Los modulos que se
   montan embebidos en dashboard.html pierden sus <script> al inyectarse
   -moduloEmbebido() los quita a proposito-, asi que ahi la copia buena es la
   que ya cargo dashboard.html, igual que pasa con Paleta.

   Se expone como objeto con nombre -window.Escape- y no como dos funciones
   sueltas a proposito: dashboard.js declara `function escapeHtml` en el
   scope global, y un segundo escapeHtml global seria una redeclaracion.
   dashboard.js y backlog.js conservan sus nombres locales y delegan aqui.
   ========================================================================= */
(function (raiz) {
  'use strict';

  var MAPA = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  };

  /* null y undefined salen como cadena vacia, no como "null"/"undefined":
     es lo que ya hacian las copias de dashboard.js y backlog.js, y las
     tablas del tablero cuentan con ello. */
  function escapar(valor) {
    if (valor === null || valor === undefined) return '';
    return String(valor).replace(/[&<>"']/g, function (c) { return MAPA[c]; });
  }

  raiz.Escape = {
    html: escapar,
    attr: escapar
  };
})(window);
