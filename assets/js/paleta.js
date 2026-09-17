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


  /* =======================================================================
     IDENTIDAD DE LIDER — una sola tabla nombre -> color para TODO el tablero.

     Un lider (torre, director, Product Owner: son las mismas personas vistas
     desde distintas paginas) tiene UN color y no lo suelta: la tendencia por
     lider, la apilada de antiguedad, la matriz, los swatches del Backlog y
     los rankings de Experiencia pintan a la misma persona igual.

     Aqui hay DOS cosas separadas, y conviene no mezclarlas:

     1) EL COLOR sale del NOMBRE y de nada mas: de un mapa escrito a mano
        (COLOR_LIDER_FIJO, mas abajo) para los lideres historicos, y de la
        huella del nombre normalizado para el resto. Son los colores que
        estas personas ya llevaban; lo que cambia es que ya NO dependen del
        ranking por volumen del corte, ni del roster vivo, ni de que pestaña
        se haya abierto primero.

     2) EL ORDEN en que se LISTAN -leyenda, columnas de la matriz- es
        alfabetico (localeCompare en es, sin distinguir acentos ni caja), con
        `Sin Torre` SIEMPRE al final: es una categoria conocida del tablero,
        no una persona, y no debe colarse entre las Ss.

     Los cubos de "sin dato" -"(Sin director)", "(Sin PO)", "Otros"...- NO
     son lideres: no entran al orden y van de NEUTRO, para que nunca se
     lleven el color de una persona real.

     Por eso una grafica puede ordenar sus barras por volumen -mayor a menor-
     sin tocar el color: el puesto en la grafica, el sitio en la leyenda y la
     identidad del color son tres cosas distintas.

     Uso:
       Paleta.registrarLideres(nombres)  // da de alta el roster de la pagina
                                         // y devuelve el orden canonico (la
                                         // leyenda se pinta con este arreglo)
       Paleta.colorLider(nombre)         // color de esa persona, siempre igual
       Paleta.ordenarLideres(nombres)    // solo ordena, sin dar de alta
     ======================================================================= */

  var SIN_TORRE = 'Sin Torre';

  // "(Sin director)", "(Sin PO)", "(Sin dato)", "Sin asignar", "Otros": cubos
  // de resto, no personas. `Sin Torre` es la excepcion: es una torre conocida.
  function esCuboSinDato(nombre) {
    if (nombre === null || nombre === undefined) return true;
    var t = String(nombre).trim();
    if (!t) return true;
    if (mismaClave(t, SIN_TORRE)) return false;
    return /^\(?\s*sin\s/i.test(t) || /^otros$/i.test(t);
  }

  // Comparacion de nombres tolerante a acentos y mayusculas: la misma persona
  // escrita "JESUS CAMPA" o "Jesús Campa" es UN lider, no dos.
  function clave(nombre) {
    var t = String(nombre === null || nombre === undefined ? '' : nombre).trim();
    if (t.normalize) t = t.normalize('NFD').replace(/[̀-ͯ]/g, '');
    return t.toLowerCase().replace(/\s+/g, ' ');
  }
  function mismaClave(a, b) { return clave(a) === clave(b); }

  function comparaLideres(a, b) {
    var ta = mismaClave(a, SIN_TORRE), tb = mismaClave(b, SIN_TORRE);
    if (ta !== tb) return ta ? 1 : -1;          // Sin Torre, siempre al final
    if (ta && tb) return 0;
    return clave(a).localeCompare(clave(b), 'es');
  }

  // Alfabetico con `Sin Torre` al final. Quita duplicados y cubos sin dato:
  // es el orden de la LEYENDA y de la tabla de colores.
  function ordenarLideres(nombres) {
    var vistos = {}, salida = [];
    (nombres || []).forEach(function (n) {
      if (esCuboSinDato(n)) return;
      var k = clave(n);
      if (k in vistos) return;
      vistos[k] = true;
      salida.push(String(n).trim());
    });
    return salida.sort(comparaLideres);
  }

  /* COLOR CONGELADO POR NOMBRE — el reparto historico, escrito a mano.

     Estos son los colores que los lideres YA llevaban en el Backlog y en el
     correo, cuando el reparto salia del ranking por volumen del corte. Se
     fijan aqui, por NOMBRE, justo para que dejen de depender del volumen:
     una persona que baja de puesto -o un corte donde otro sube- ya no
     recolorea el tablero. Son los mismos colores de siempre, con el mismo
     origen: posiciones de PALETA_CATEGORICA, ningun hex nuevo.

     El ORDEN en que aparecen los nombres AQUI no significa nada: la leyenda
     va aparte, en orden alfabetico con `Sin Torre` al final. Este mapa solo
     dice quien lleva que color.

     Para mover un color, cambiar la posicion de PALETA_CATEGORICA que se
     pide aqui. Para dar de alta a un lider nuevo, agregarlo con la posicion
     que le toque: mientras no este en esta lista, su color sale de la huella
     de su nombre (colorLider, mas abajo), que es estable pero no elegida. */
  var COLOR_LIDER_FIJO = {
    'Laura Cardenas':  PALETA_CATEGORICA[0],   // azul
    'Jesus Campa':     PALETA_CATEGORICA[1],   // rojo
    'Adriana Lozano':  PALETA_CATEGORICA[2],   // verde
    'Bendrix Zuir':    PALETA_CATEGORICA[3],   // naranja
    'Carlos Garcia':   PALETA_CATEGORICA[4],   // morado
    'Sergio Gonzalez': PALETA_CATEGORICA[5],   // cian
    'Sin Torre':       PALETA_CATEGORICA[6]    // rosa
  };

  // El mapa fijo, indexado por la misma clave tolerante a acentos y caja que
  // usa todo lo demas.
  var FIJOS = {};
  (function () {
    for (var n in COLOR_LIDER_FIJO) {
      if (COLOR_LIDER_FIJO.hasOwnProperty(n)) FIJOS[clave(n)] = COLOR_LIDER_FIJO[n];
    }
  })();

  /* COLORES QUE PUEDE LLEVAR UNA PERSONA.

     Son las MISMAS posiciones de PALETA_CATEGORICA, menos la que vale
     NEUTRO: el gris significa "esto no es una categoria", y prestarselo a
     una persona real es justo el error que se arregla aqui. No hay ningun
     hex nuevo. */
  var PALETA_LIDER = PALETA_CATEGORICA.filter(function (c) { return c !== NEUTRO; });

  /* Huella estable de una clave (FNV-1a de 32 bits, mas una vuelta de
     mezcla). Solo se le pide que el MISMO texto de siempre el MISMO numero,
     dentro y fuera del navegador, y que los nombres se repartan parejo entre
     las siete posiciones. No es criptografia: es la forma de que el color
     salga del nombre y de nada mas.

     La mezcla final no es adorno. Los bits BAJOS de FNV-1a estan mal
     repartidos, y aqui se toma justo el resto entre 7: con un lote de 30
     nombres reales el reparto salia 3/5/2/7/8/1/4 -un color casi sin usar y
     otro con el triple de la cuenta-, y con la mezcla queda 5/4/4/3/5/5/4.

     `>>> 0` en cada paso mantiene el valor en entero sin signo de 32 bits, y
     Math.imul multiplica como entero de 32 bits: sin eso la multiplicacion
     se va al terreno de los flotantes, pierde bits altos y el resultado deja
     de ser reproducible. */
  function huella(k) {
    var h = 2166136261;
    for (var i = 0; i < k.length; i++) {
      h ^= k.charCodeAt(i);
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    h ^= h >>> 16;
    h = Math.imul(h, 2246822507) >>> 0;
    h ^= h >>> 13;
    h = Math.imul(h, 3266489909) >>> 0;
    h ^= h >>> 16;
    return h >>> 0;
  }

  /* El roster vivo de la pagina. YA NO decide colores: es solo el orden
     canonico -A->Z con `Sin Torre` al final- con el que se pintan leyendas y
     columnas de matriz. El color se calcula aparte, desde el nombre.

     Antes esto repartia las posiciones que los lideres fijos no ocupaban, y
     de ahi salia el error: cuando el roster ya traia a los siete lideres
     fijos -porque el Backlog o SLA se habian abierto primero- las unicas
     posiciones "libres" que quedaban eran la del gris, asi que TODA persona
     que no estuviera en el mapa fijo se pintaba de NEUTRO. El color dependia
     de que pestaña se hubiera cargado antes. */
  var rosterLideres = [];

  // Da de alta los nombres que falten y devuelve el orden canonico COMPLETO.
  function registrarLideres(nombres) {
    rosterLideres = ordenarLideres(rosterLideres.concat(nombres || []));
    return rosterLideres.slice();
  }

  /* Color de una persona, SOLO en funcion de su nombre normalizado.

     1) Un cubo sin dato -"(Sin director)", "(Sin PO)", "Otros", vacio...- es
        NEUTRO: no es una persona.
     2) El mapa fijo manda, aunque esa persona no se haya dado de alta en
        esta vista.
     3) El resto sale de la huella de su clave. Es determinista: la misma
        persona saca el mismo color en cada grafica, en cada pestaña y en
        cada carga, sin que importe quien se registro primero ni si se
        registro. Dos personas pueden coincidir en color -son siete
        posiciones-, que es el mismo tope que la paleta ya tenia declarado
        arriba; lo que no puede pasar es que alguien real salga gris. */
  function colorLider(nombre) {
    if (esCuboSinDato(nombre)) return NEUTRO;
    var k = clave(nombre);
    if (FIJOS[k]) return FIJOS[k];
    return PALETA_LIDER[huella(k) % PALETA_LIDER.length];
  }

  // Orden canonico ya dado de alta, para pintar una leyenda.
  function lideres() { return rosterLideres.slice(); }

  raiz.Paleta = {
    PALETA_CATEGORICA: PALETA_CATEGORICA,
    PALETA_LIDER: PALETA_LIDER,
    NEUTRO: NEUTRO,
    AZUL_SERIE: AZUL_SERIE,
    porIndice: porIndice,
    color: color,
    escala: escala,
    mapa: mapa,
    registro: registro,
    SIN_TORRE: SIN_TORRE,
    ordenarLideres: ordenarLideres,
    registrarLideres: registrarLideres,
    colorLider: colorLider,
    lideres: lideres
  };
})(window);
