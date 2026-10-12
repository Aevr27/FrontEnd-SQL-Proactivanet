/* KpisFijos -- boton "Fijar KPIs" de cada pestaña.

   QUE HACE
   --------
   Cada pestaña con rejilla de KPI (`section.kpis`) lleva en su cabecera un
   boton con data-kpis-fijar="<id de su rejilla>". Pulsarlo pone o quita la
   clase .kpis-fijas en ESA rejilla (assets/css/kpis-fijos.css: position
   sticky arriba de la ventana) y su aria-pressed. Nada mas:

     - no copia ni mueve las tarjetas: es el mismo nodo, que se queda pegado
       al hacer scroll dentro de su pestaña;
     - no pide datos ni toca filtros;
     - cada pestaña tiene su propio boton y su propio estado; las pestañas
       ocultas (display:none) no pintan nada, asi que nunca hay dos rejillas
       pegadas a la vez;
     - quitarlo devuelve la rejilla exactamente a como estaba (solo se quita
       la clase).

   El estado dura lo que dura la pagina, sin localStorage, por el mismo
   motivo que la barra lateral: la VM tiene sesiones compartidas.

   POR QUE UN SOLO ESCUCHA DELEGADO
   --------------------------------
   Las pestañas embebidas (Backlog, Experiencia, QA, QARE, Analisis) llegan
   como marcado sin sus <script> (moduloEmbebido, dashboard.js): el boton
   viene en su HTML, pero ningun script suyo corre. Un solo escucha de clic
   en el documento cubre a todas, montadas antes o despues. Las paginas
   sueltas cargan este mismo archivo y se cablean igual.

   Lo prueba tools/tests/KpisFijosSmoke.js. */
(function (global) {
  'use strict';

  var CLASE = 'kpis-fijas';

  // boton: el que lleva data-kpis-fijar. -> true si quedo fijada, false si
  // se solto, null si su rejilla no existe (no se cambia nada).
  function alternar(boton, doc) {
    var id = boton && boton.getAttribute('data-kpis-fijar');
    var rejilla = id ? doc.getElementById(id) : null;
    if (!rejilla) return null;
    var fijar = !rejilla.classList.contains(CLASE);
    if (fijar) rejilla.classList.add(CLASE); else rejilla.classList.remove(CLASE);
    boton.setAttribute('aria-pressed', fijar ? 'true' : 'false');
    return fijar;
  }

  function enganchar(doc) {
    if (!doc || doc.__kpisFijos) return;
    doc.__kpisFijos = true;
    doc.addEventListener('click', function (e) {
      var t = e.target;
      var boton = t && t.closest ? t.closest('[data-kpis-fijar]') : null;
      if (boton) alternar(boton, doc);
    });
  }

  global.KpisFijos = { CLASE: CLASE, alternar: alternar, enganchar: enganchar };
  if (global.document) enganchar(global.document);
})(window);
