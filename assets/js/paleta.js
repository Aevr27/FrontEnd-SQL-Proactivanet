/* =========================================================================
   PALETA CATEGORICA COMPARTIDA — una sola fuente para todo el tablero.

   La cargan dashboard.html, qa/qa.html, experiencia/experiencia.html y
   orquestacion/orquestacion.html ANTES de su propio guion, igual que
   Chart.js. Los modulos que se montan embebidos en dashboard.html
   (Experiencia y QA) pierden sus <script> al inyectarse -moduloEmbebido()
   los quita a proposito-, asi que ahi la copia buena es la que ya cargo
   dashboard.html. En las dos rutas hay exactamente un window.Paleta.

   -------------------------------------------------------------------------
   COMO USARLA EN UNA GRAFICA NUEVA
   -------------------------------------------------------------------------
   NO copies el arreglo de colores. Pide siempre los colores aqui.

   1) La dimension YA tiene un orden canonico propio (una lista que manda el
      servidor, un orden de lideres, un catalogo fijo). Usa la posicion:

        const colores = Paleta.escala(ordenLideres);      // arreglo paralelo
        const color   = Paleta.color(nombre, ordenLideres); // uno suelto

   2) La dimension NO tiene orden canonico y sus etiquetas se reordenan al
      repintar (ordenar por valor, filtrar, etc.). Usa un registro con
      nombre: recuerda que categoria se llevo que color y se lo devuelve
      igual en cada repintado, aunque cambie el orden de la grafica.

        const reg = Paleta.registro('sla-estado');
        const colores = reg.escala(etiquetas);   // reserva las que falten
        const color   = reg.color('Abierto');    // siempre el mismo

   El registro es por nombre y vive lo que viva la pagina: dos graficas que
   pinten la MISMA dimension deben pedir el MISMO nombre de registro para
   que una categoria conserve su color entre las dos.

   -------------------------------------------------------------------------
   CUANDO **NO** USARLA
   -------------------------------------------------------------------------
   Cuando el color significa un ESTADO y no una identidad. Esos sistemas son
   semanticos y se quedan como estan: OK/Incorrecto/Valido/Sin catalogo (QA),
   Critica/Alta/Media/Baja (Backlog y Orquestacion), el semaforo verde/ambar/
   rojo, y las rampas ordinales -antiguedad, estado de una iniciativa-, donde
   el color tiene que contar un orden. Meter la paleta categorica ahi rompe
   la lectura del dato.
   ========================================================================= */
(function (raiz) {
  'use strict';

  /* Ocho posiciones en ORDEN FIJO. No se reordenan ni se les insertan
     colores en medio: la posicion ES la identidad, y moverla recolorea
     todas las graficas del tablero a la vez. */
  var PALETA_CATEGORICA = [
    '#2563eb',
    '#dc2626',
    '#16a34a',
    '#d97706',
    '#7c3aed',
    '#0891b2',
    '#db2777',
    '#6b7280'
  ];

  /* Sin dato / fuera de catalogo / categoria desconocida. No es la posicion
     8: es el color de "esto no es una categoria". */
  var NEUTRO = '#6b7280';

  /* AZUL DE SERIE UNICA — el relleno por defecto de una barra ORDINARIA.

     Una grafica de ranking o de comparacion con UNA sola serie -"top 10 por
     grupo", "volumen por director", "llamadas por agente"- no esta contando
     ocho identidades distintas: esta contando una magnitud, y las barras solo
     se comparan entre si por su largo. Pintarlas de ocho colores hacia creer
     que el color decia algo. Todas van de este azul.

     NO es un azul nuevo: es la MISMA posicion 1 de la paleta categorica, el
     azul que ya llevaban las barras por grupo de QA y la serie Creados del
     tablero de SLA. Se le pone nombre para que una grafica pueda pedir "el
     azul de una barra normal" sin depender de que ese sea el indice 0.

     Lo aplica Barras.aplicarDefaults() como default de Chart.js para el tipo
     `bar`, asi que una grafica ordinaria no tiene que pedirlo: le basta con
     NO declarar color. Se declara color solo cuando el color SIGNIFICA algo
     -semaforo, severidad, estado, rampa ordinal- o cuando la barra es una
     identidad que se repite en otras vistas (lider, categoria de un pastel). */
  var AZUL_SERIE = PALETA_CATEGORICA[0];

  // Color de la posicion i, dando la vuelta cuando hay mas categorias que
  // colores. La vuelta es intencional: ocho identidades separables es el
  // limite util; a partir de ahi la grafica necesita leyenda o etiqueta
  // directa, no mas tonos.
  function porIndice(i) {
    if (!(i >= 0)) return NEUTRO;
    return PALETA_CATEGORICA[i % PALETA_CATEGORICA.length];
  }

  // Color de `clave` segun su posicion en `orden`. Fuera de la lista: neutro.
  function color(clave, orden) {
    var i = (orden || []).indexOf(clave);
    return i >= 0 ? porIndice(i) : NEUTRO;
  }

  // Arreglo de colores paralelo a `orden`, listo para backgroundColor.
  function escala(orden) {
    return (orden || []).map(function (_, i) { return porIndice(i); });
  }

  // { clave: color } para cuando conviene consultar por nombre.
  function mapa(orden) {
    var salida = {};
    (orden || []).forEach(function (clave, i) { salida[clave] = porIndice(i); });
    return salida;
  }

  /* Registro con nombre: reparte colores por ORDEN DE ALTA, no por orden de
     pintado. La primera categoria que se registra se queda la posicion 1 y
     no la suelta aunque despues la grafica la ordene distinto o la esconda
     un filtro. Es lo que hace que el color sea estable cuando la dimension
     no trae un orden canonico del servidor. */
  var registros = {};
  function registro(nombre) {
    if (registros[nombre]) return registros[nombre];

    var asignados = {};   // clave -> color
    var altas = 0;        // cuantas posiciones se han repartido

    function colorDe(clave) {
      if (clave === null || clave === undefined || clave === '') return NEUTRO;
      var k = String(clave);
      if (!(k in asignados)) asignados[k] = porIndice(altas++);
      return asignados[k];
    }

    registros[nombre] = {
      nombre: nombre,
      color: colorDe,
      // Da de alta las claves que falten, en el orden en que llegan, y
      // devuelve el arreglo paralelo.
      escala: function (claves) { return (claves || []).map(colorDe); },
      // Solo lo ya asignado, para pintar una leyenda sin reservar de mas.
      asignados: function () {
        var copia = {};
        for (var k in asignados) if (asignados.hasOwnProperty(k)) copia[k] = asignados[k];
        return copia;
      }
    };
    return registros[nombre];
  }

  raiz.Paleta = {
    PALETA_CATEGORICA: PALETA_CATEGORICA,
    NEUTRO: NEUTRO,
    AZUL_SERIE: AZUL_SERIE,
    porIndice: porIndice,
    color: color,
    escala: escala,
    mapa: mapa,
    registro: registro
  };
})(window);
