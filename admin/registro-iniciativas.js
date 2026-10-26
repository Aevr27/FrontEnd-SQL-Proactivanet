/* =========================================================================
   admin/registro-iniciativas.js

   Vista Iniciativas de admin/iniciativas.html: el registro de iniciativas
   existentes, SOLO LECTURA. Indicadores, filtros, lista y el detalle de la
   iniciativa elegida.

   DE DONDE SALE CADA COSA
   -----------------------
   handlers/admin_iniciativas_registro.ashx -> ExperienciaQueries
   .RegistroIniciativas (App_Code/ExperienciaRegistro.cs), que reusa las
   lecturas y el semaforo de Experiencia sin cambiarlos. Aqui no se calcula
   ninguna cifra de negocio: tickets_reduce, riesgo_folio, retrazado,
   sem_fecha, activa y seguimiento llegan hechos. Lo unico que se hace en el
   navegador es contar, filtrar, ordenar y pintar.

   INDICADORES (sobre el registro COMPLETO, no sobre lo filtrado)
   ---------------------------------------------------------------
   Los filtros y la busqueda solo deciden la lista; los indicadores cambian
   solo cuando cambia el registro (carga, o relectura tras guardar).
     Total            las abiertas: estado distinto de Cerrado, comparado
                      con plano() (sin mayusculas, acentos ni espacios de
                      mas). Rotulo "Total iniciativas activas" (2026-10-26;
                      del 2026-10-23 al 2026-10-26 contaba TODAS, Cerradas
                      incluidas). Es la poblacion por omision: su clic no
                      filtra, quita el indicador y la lista vuelve a todas.
                      `abiertas` sigue en el modelo y vale lo mismo.
     Activas          `seguimiento`: estado en estados_activos y agrupacion
                      en agrupadores. Es el criterio de la tabla "Activas"
                      de Experiencia (filasBaseAct). Incluye las sin
                      categoria. Globo de ayuda (GloboAyuda) con ese
                      criterio, armado con lo que manda el servidor.
     Requerimientos   abiertas (no Cerrado) con agrupacion ReqOpr
                      (AGRUPACION_REQUERIMIENTOS, comparada con plano()).
                      `agrup` es dbo.ProblemCategoria.TipoAgrupado de su
                      primera fila (sin categoria: dbo.Problem
                      .TipoIniciativa). NO es Total - Activas ni el prefijo
                      (REQ/HAR): un HAR puede ser Adopcion. Cuentan en
                      Total, nunca en Activas (ReqOpr no es agrupador).
                      Reemplaza a "Fuera de Activas" (2026-10-16): en la VM
                      esas 223 eran 185 ReqOpr + 38 "Adopcion" con tilde,
                      que el servidor ya reconoce (Canonizar). fueraActivas
                      se sigue calculando (abiertas = Activas +
                      fueraActivas), sin tarjeta.
                      Globo de ayuda (GloboAyuda) como Activas; antes
                      era el title nativo de la tarjeta (2026-10-26).
     Atrasadas        `seguimiento` y `retrazado`, solo las que tienen
                      categoria: el criterio del KPI "Iniciativas
                      Retrasadas" de Experiencia (aqui se rotula Atrasadas). El pie suma riesgo_folio
                      ("tickets en riesgo").
     Cerradas         estado Cerrado (el mismo plano()). Otros estados no
                      activos NO cuentan aqui (si en Total).
   Total + Cerradas = todas las iniciativas del registro.
   Cada regla vive UNA vez (CONDICION_KPI): la usan la cuenta del
   indicador y su filtro, asi que no pueden separarse.

   INDICADORES Y SEMAFORO COMO FILTRO (2026-10-22, solo esta vista)
   ----------------------------------------------------------------
   Un clic en una tarjeta (o en una categoria del semaforo) acota la LISTA
   a las iniciativas que cuenta ese indicador (FiltroRegistro.indicador,
   Registro.cumpleIndicador); otro clic en el mismo lo quita. Uno a la vez:
   elegir otro reemplaza al anterior. Total no es un filtro: su clic quita
   el indicador elegido y la lista vuelve a todas las iniciativas que dejan
   pasar los demas filtros (que no se tocan). La mecanica (elegir, quitar,
   reemplazar, conservar en la relectura, atributos, escucha y foco) es la
   compartida de assets/js/seleccion-kpi.js (SeleccionKpi); las reglas de
   cada indicador siguen aqui. Se combina en Y con Estado, Tipo,
   Director, cascada y busqueda; ninguno de ellos se toca (Cerradas con
   Cerrado desmarcado en Estado = lista vacia, y lo dice). Cuenta como un
   filtro activo y "Limpiar filtros" lo quita. Las cifras NO se mueven: se
   siguen contando sobre el registro completo. La Cobertura no lo usa (un
   clic estando en ella vuelve a la lista). La relectura lo conserva (sobre).
   No hay tarjeta "Fuera de Activas" (fueraActivas) ni otra diferencia:
   no hay nada que filtrar ahi.

   SEMAFORO (junto al titulo Registro; registro COMPLETO, como los KPIs)
   ----------------------------------------------------------------------
   Solo las de estado activo (`activa`): las demas no tienen fecha
   compromiso. Cada una cae en UNA, en este orden (semaforoFecha):
     Sin control de fecha  control_fecha === false (CatPrefijoProblem
                           .ControlDeFecha = 0: REQ/RTI); gris, solo si hay.
     Atrasadas             fecha_retrasada (el semaforo del servidor).
     Sin fecha             sin la fecha compromiso de su estado.
     En tiempo             con fecha y sin vencer.
   Sin control_fecha (servidor anterior) cuenta como con control, que es el
   ISNULL(ControlDeFecha, 1) del servidor.
   Por que "Sin control de fecha" NO se funde con "Sin fecha" (revisado
   2026-10-16): son reglas distintas. Sin fecha = un tipo CON fecha
   compromiso al que le falta capturarla (dato pendiente: rojo). Sin control
   = el catalogo (CatPrefijoProblem.ControlDeFecha = 0, regla c04a23a) dice
   que el tipo no tiene fecha que vencer: el servidor (ExperienciaQueries
   .Semaforo) lo deja en ambar y nunca retrasado, tenga o no fecha. Fundirlas
   pintaria de rojo y contaria como pendientes las REQ/RTI sin fecha, y las
   que si tienen una caerian en En tiempo, prometiendo un compromiso que no
   existe. Con cero activas sin control, el semaforo ya muestra solo tres
   (siHay).

   FILTROS
   -------
     Estado               varios a la vez (O), igual que Tipo de
                          iniciativa: opciones = los estados que trae el
                          registro (activos primero); al cargar, todos
                          (Cerrado incluido; 2026-10-16); "Todos"
                          alterna; ninguno = lista vacia.
                          (La Agrupacion/TipoAgrupado YA NO es filtro: el
                          dato `agrup` sigue llegando porque decide
                          `seguimiento` -Activas/Retrasadas- y se ve en la
                          tabla y el detalle.)
     Tipo de iniciativa   el catalogo dbo.CatPrefijoProblem
                          (`tipos_iniciativa`: [{ prefijo, nombre }], TODAS
                          sus filas, en el orden del servidor) contra el
                          `prefijo` de cada iniciativa (dbo.Problem.Prefijo).
                          Se ve la Descripcion; se filtra por Prefijo. NO es
                          Problem.TipoIniciativa ni la Agrupacion. Varios a
                          la vez = O.
                          Por omision todos marcados (tiposIni = null).
                          "Todas" alterna: con todo marcado lo desmarca todo
                          (tiposIni = [], no pasa ninguna iniciativa); con
                          cualquier otra cosa lo marca todo. Marcar a mano
                          el ultimo que faltaba vuelve a null.
     Director -> Product Owner -> Service Owner -> Categoria
                          progresivos sobre las combinaciones REALES de las
                          categorias de las iniciativas (CascadaOrganizacional
                          en modo 'filtro', admin/cascada-organizacional.js).
                          OPCIONES SEGUN EL ROL (Registro.alcance):
                            ADM ('completo')   todo lo de antes, incluidos
                              los dueños capturados en el Problem de las
                              iniciativas sin categoria (OwnerProblem /
                              OwnerServicio / Direccion) y los que solo
                              resuelven filas dadas de baja de
                              CatCategoriaDueno: sirven para investigar.
                            MOD / sin rol todavia ('catalogo')  solo
                              nombres del catalogo vigente de dueños
                              (asignaciones de admin_iniciativas_catalogos,
                              DirectorioOrganizacional.AsignacionesVigentes,
                              con su herencia C1 -> N2 por campo). Se pide
                              el catalogo al cargar; sin el, sin opciones
                              (falla cerrado). Las iniciativas sin categoria
                              no aportan opciones, y una fila de iniciativa
                              solo aporta si sus tres dueños estan en el
                              catalogo. NINGUNA iniciativa se oculta: solo
                              cambia que nombres se ofrecen para filtrar.
                          (VIEWER no llega aqui: 403 en todo Admin.)
                          Una iniciativa pasa si UNA de sus categorias cumple
                          todo lo elegido a la vez. Las que no tienen
                          categoria se comparan con los dueños del propio
                          Problem (pasaFiltroIniciativa de Experiencia) y no
                          pasan un filtro de Categoria.
                          PO / SO (2026-10-20): los CAPTURADOS de la
                          iniciativa (po_capturado / so_capturado =
                          dbo.Problem.OwnerProblem / OwnerServicio), los
                          mismos que muestran y ordenan las columnas; sin
                          capturar = '' (no pasa un PO / SO elegido).
                          Director y Categoria siguen siendo los de cada
                          categoria. Los dueños de la categoria
                          (CatCategoriaDueno) se ven solo en el detalle y en
                          la Cobertura, que sigue filtrando sus categorias
                          por sus propios dueños.

   COBERTURA DE CATEGORIAS (vista secundaria, se pide al abrirla)
   ---------------------------------------------------------------
     Universo     las categorias VIGENTES de dbo.CatCategoriaDueno con
                  Director, PO y SO (handlers/admin_iniciativas_catalogos.ashx,
                  el mismo catalogo de Nueva solicitud). Las que no tienen
                  los tres dueños las cuenta el servidor en `omitidas`.
     Activa       `seguimiento` (estado activo y agrupacion de agrupadores):
                  el mismo criterio del indicador Activas y de Experiencia.
     Cubierta     al menos una iniciativa activa con una ruta cuya `n2`
                  (la CategoriaN2 de su C1&C2, la pone el servidor) es esa
                  categoria. Sin volumen de tickets: solo existencia.
     Fuera        rutas de iniciativas activas cuya `n2` no es una categoria
                  del catalogo vigente: se listan aparte, no se descartan.
     Sin categoria  iniciativas activas sin ninguna categoria: no pueden
                  cubrir una; solo se cuentan.
     Filtros      los MISMOS de la lista (FiltroRegistro): Estado y Tipo
                  deciden que iniciativas cuentan; Director
                  y la cascada deciden que categorias se ven. Al cargarse, el
                  catalogo se suma a la cascada (Registro.catalogo): sus
                  categorias y dueños pasan a ser opciones aunque no tengan
                  iniciativas, y elegir una CategoriaN2 filtra la lista por
                  las rutas que cuelgan de ella.

   PIEZAS
   ------
     Registro         el JSON del handler, validado
     SeleccionVarios  varios valores de una lista (Estado, Tipo)
     FiltroRegistro   lo elegido y que iniciativa pasa
     Cobertura        catalogo de categorias x iniciativas activas
     SolicitudCambio  borrador de "Solicitar cambios" de una iniciativa
     ("Modificar" y la marca Incompleta del detalle son de
     admin/iniciativa-admin.js: EdicionAdmin e Incompleta; solo con rol
     ADM. "Validar en el servidor (no guarda)" valida en
     admin_iniciativas_gestion.ashx, que responde 501: no hay persistencia.)
     VistaRegistro    el DOM: carga, estados, KPIs, filtros, tabla, detalle,
                      y la vista Cobertura

   DETALLE: SOLICITAR CAMBIOS E HISTORIAL
   --------------------------------------
     "Solicitar cambios" abre un borrador (SolicitudCambio, con su llave)
     que se valida en el navegador. Con persistencia_solicitudes = true del
     registro (sql/22 aplicada) se ENVIA a admin_iniciativas_solicitudes.ashx
     (enviarCambio) y solo se dice "enviada" con el numero que da la base;
     si no, solo se prepara. Enviar nunca cambia la iniciativa: la aplica un
     ADM desde la cola (admin/solicitudes-cambio.js). Campos que se pueden pedir cambiar
     (CAMPOS_CAMBIO): "Fecha de compromiso" (una sola opcion; la etapa
     -Analisis, Solucion o Cierre- se elige en un segundo selector que
     arranca en la del Estado actual, ETAPA_SOLICITUD), Estado (solo el
     nuevo Estado: sin fecha compromiso, que se pide con su opcion, y sin
     Subestado, que es solo de ADM y lo cambia con "Modificar",
     2026-10-26), Categorias (el %
     de varias ligadas y agregar categorias del catalogo, sin repetir) y
     Otros (solo explicacion). Lo demas se agregara cuando se designe.
     SEGUIMIENTO: Fecha de creacion (f_creacion = dbo.Problem.FechaCreacion)
     y un selector "Ver por categoria" con las categorias reales de la
     iniciativa; al cambiarlo se repinta solo su bloque (regSegCatInfo).
     Las fechas son las de la INICIATIVA salvo la de analisis de una
     categoria ligada despues (f_analisis_propia, sql/18), que se marca
     "Propia"; las que heredan se marcan "De la iniciativa".
     "Historial de cambios (N)" nace plegado. Pinta `historial`, las filas
     de dbo.ProblemFechaEvento de la iniciativa en orden de IdEvento
     (App_Code/HistorialFechas.cs): { id, campo, anterior, nuevo, operacion,
     origen, usuario, solicitud, fecha, reconstruido }. Los rotulos los pone
     etiquetarHistorial (sql/PROPUESTA_historial_fechas.md seccion 4): Linea
     base, Fecha inicial, Fecha asignada, Fecha retirada y "Cambio n", que es
     lo unico que cuenta y lo que da N. En FechaCierre solo cuentan las
     extensiones (nueva > anterior): un adelanto se muestra sin numero
     (regla del 2026-10-09). "Cambio n" corre por categoria y campo: los
     eventos de la iniciativa (`historial`) y los de las fechas propias de
     sus categorias (`historial_categorias`, con `categoria`) se numeran y
     se pintan por separado, y N es solo el de la iniciativa. En un evento
     de categoria, anterior null es el valor crudo: la categoria heredaba la
     fecha de la iniciativa, y asi se explica (no se rellena). La Linea base se rotula pero no se pinta
     (2026-10-09): es la foto del inicio de captura, no un movimiento; el
     servidor la sigue mandando porque de ella salen `desde` y
     `reconstruido`. Los NroCambioFecha* del Excel siguen en Seguimiento
     tal cual.

   Se prueba en node: tools/tests/RegistroIniciativasSmoke.js.
   ========================================================================= */
window.RegistroIniciativas = (function () {
  'use strict';

  var URL_REGISTRO = '../handlers/admin_iniciativas_registro.ashx';
  // El catalogo de categorias de Nueva solicitud. Solo se pide al abrir la
  // Cobertura, nunca al cargar la pagina.
  var URL_CATALOGO = '../handlers/admin_iniciativas_catalogos.ashx';
  // Columnas extra del Excel: el mismo handler, solo al pulsar Descargar.
  var URL_EXPORT = URL_REGISTRO + '?export=1';
  // Solicitudes de cambio (sql/22): la accion va en la URL.
  var URL_SOLICITUDES = '../handlers/admin_iniciativas_solicitudes.ashx';

  // Llave de un borrador de "Solicitar cambios": el reintento del MISMO
  // borrador no duplica la solicitud en el servidor.
  function nuevaLlave() {
    var c = typeof window !== 'undefined' && window.crypto;
    if (c && typeof c.randomUUID === 'function') return c.randomUUID();
    var h = '';
    for (var i = 0; i < 32; i++) h += Math.floor(Math.random() * 16).toString(16);
    return h.slice(0, 8) + '-' + h.slice(8, 12) + '-4' + h.slice(13, 16) + '-a' + h.slice(17, 20) + '-' + h.slice(20, 32);
  }
  var CascadaOrganizacional = window.CascadaOrganizacional;
  var SeleccionKpi = window.SeleccionKpi;

  // Cuantas filas pinta la tabla de una vez; "Mostrar mas" agrega otras
  // tantas. El filtro y el orden van siempre sobre el registro completo.
  var PAGINA = 100;

  // La busqueda espera esto (ms) tras la ultima tecla antes de repintar la
  // lista; Enter la aplica en el acto.
  var BUSQUEDA_ESPERA = 150;

  // La fecha comprometida de cada estado activo: la misma correspondencia de
  // Semaforo (ExperienciaQueries) y de fdateSem (experiencia.js). Solo
  // decide QUE fecha se pinta; si esta vencida lo dice fecha_retrasada.
  var FECHA_DEL_ESTADO = {
    'En Análisis': 'f_analisis',
    'En Solución': 'f_solucion',
    'En Monitoreo': 'f_cierre'
  };

  function igualTexto(a, b) { return a < b ? -1 : a > b ? 1 : 0; }
  function distintos(valores) {
    var vistos = {}, salida = [];
    valores.forEach(function (v) {
      if (v && !Object.prototype.hasOwnProperty.call(vistos, v)) { vistos[v] = true; salida.push(v); }
    });
    return salida;
  }
  function numero(v) { return typeof v === 'number' && isFinite(v) ? v : 0; }
  function fmt(n) { return numero(n).toLocaleString('es-MX'); }
  function pct(f) {
    return typeof f === 'number' && isFinite(f) ? Math.round(f * 1000) / 10 + '%' : '—';
  }
  function fecha(s) { return s ? String(s).split('-').reverse().join('/') : '—'; }
  // ['a', 'b', 'c'] -> 'a, b o c'
  function enumerar(v) {
    return v.length < 2 ? v.join('') : v.slice(0, -1).join(', ') + ' o ' + v[v.length - 1];
  }

  // Los cinco indicadores, en orden (ver la cabecera).
  // Solo los rotulos visibles (2026-10-19: Activas -> Iniciativas medibles,
  // Requerimientos -> Iniciativas con requerimientos; 2026-10-26:
  // Total de iniciativas -> Total iniciativas activas); los calculos y las
  // claves internas (activas, requerimientos) no cambian.
  var ROTULOS_KPI = ['Total iniciativas activas', 'Iniciativas medibles', 'Iniciativas con requerimientos', 'Atrasadas', 'Cerradas'];
  // La agrupacion (TipoAgrupado) de los requerimientos REQ/HAR, comparada
  // con plano(): sin acentos, mayusculas ni espacios de mas.
  var AGRUPACION_REQUERIMIENTOS = 'reqopr';

  // El semaforo de la fecha compromiso (ver la cabecera): clave, rotulo y
  // color del punto (.ini-sem). `siHay`: solo se pinta con alguna.
  var SEMAFORO = [
    { k: 'sin_fecha', l: 'Sin fecha', c: 'rojo', t: 'Activas con control de fecha y sin la fecha compromiso de su estado.' },
    { k: 'atrasada', l: 'Atrasadas', c: 'ambar', t: 'Activas con la fecha compromiso de su estado vencida.' },
    { k: 'en_tiempo', l: 'En tiempo', c: 'verde', t: 'Activas con fecha compromiso vigente.' },
    { k: 'sin_control', l: 'Sin control de fecha', c: 'gris', siHay: true,
      t: 'Activas de un tipo sin control de fecha (p. ej. REQ/RTI): no tienen fecha que vencer.' }
  ];
  // Color de cada categoria: el MISMO en el semaforo, el punto de la fila
  // y el del detalle.
  var COLOR_SEMAFORO = {};
  SEMAFORO.forEach(function (s) { COLOR_SEMAFORO[s.k] = s.c; });

  // La regla de cada indicador, en el orden de ROTULOS_KPI (ver la
  // cabecera). La cuentan Registro.indicadores y la aplica el filtro por
  // indicador: es la MISMA funcion.
  // Total cuenta las abiertas (no Cerrado) y es la clave que limpia
  // (INDICADOR_TODAS): elegirla deja la lista sin indicador.
  var CLAVES_KPI = ['total', 'activas', 'requerimientos', 'retrasadas', 'cerradas'];
  var INDICADOR_TODAS = 'total';
  // El atributo que lleva la clave en cada boton (tarjetas y semaforo).
  var ATRIBUTO_INDICADOR = 'data-indicador';
  var CONDICION_KPI = {
    total: function (i) { return !esCerrada(i); },
    activas: function (i) { return !!i.seguimiento; },
    requerimientos: function (i) { return !esCerrada(i) && Registro.esRequerimiento(i); },
    retrasadas: function (i) { return !!i.seguimiento && i.retrazado > 0 && !i.sin_categoria; },
    cerradas: function (i) { return esCerrada(i); }
  };
  // Las categorias del semaforo como indicador: 'sem_' + su clave.
  var PREFIJO_SEMAFORO = 'sem_';
  function semaforoDeIndicador(k) {
    for (var n = 0; n < SEMAFORO.length; n++) if (PREFIJO_SEMAFORO + SEMAFORO[n].k === k) return SEMAFORO[n];
    return null;
  }
  // Rotulo de un indicador elegido; el del semaforo lo dice, porque su
  // Atrasadas no es la regla de la tarjeta Atrasadas.
  function rotuloIndicador(k) {
    var n = CLAVES_KPI.indexOf(k), s = semaforoDeIndicador(k);
    return n >= 0 ? ROTULOS_KPI[n] : s ? 'Semáforo: ' + s.l : '';
  }
  function texto(v) { return v === null || v === undefined || v === '' ? '—' : v; }

  // Dias desde la creacion de la iniciativa, o null. Es `antiguedad` del
  // servidor (DiasDesde(dbo.Problem.FechaCreacion), ExperienciaQueries):
  // aqui no se calcula. El servidor da 0 cuando FechaCreacion es NULL, asi
  // que con f_creacion vacia (llega null) no hay dato; si f_creacion ni
  // viene (servidor anterior) vale `antiguedad` tal cual. La usan la
  // Antigüedad del detalle y la columna Código de la lista.
  function diasDesdeCreacion(i) {
    if (Object.prototype.hasOwnProperty.call(i, 'f_creacion') && !i.f_creacion) return null;
    var n = i.antiguedad;
    return typeof n === 'number' && isFinite(n) && n >= 0 ? Math.floor(n) : null;
  }
  function esTexto(v) { return typeof v === 'string' && v !== ''; }

  // GET del registro -> su JSON; rechaza con el mensaje para la vista.
  function leerRegistro(pedir, url) {
    return Promise.resolve()
      .then(function () {
        return Promise.resolve(pedir(url || URL_REGISTRO)).catch(function () {
          throw new Error('No se pudo conectar con el servidor.');
        });
      })
      .then(function (r) {
        return r.json().catch(function () { return null; }).then(function (json) {
          if (!r.ok) throw new Error((json && json.error) || ('El servidor respondió ' + r.status + '.'));
          return json;
        });
      });
  }

  // El selector compartido (IniciativaAdmin.Selector): <select> con 20
  // opciones o menos, caja con busqueda con mas. Sin ese modulo, <select>.
  function selectorHtml(id, opciones, valor, extra) {
    var A = window.IniciativaAdmin;
    if (A && A.Selector) return A.Selector.html(id, opciones, valor, extra);
    return '<select id="' + id + '"' + (extra || '') + '><option value="">— Elige —</option>' + (opciones || []).map(function (v) {
      return '<option value="' + Escape.attr(v) + '"' + (v === valor ? ' selected' : '') + '>' + Escape.html(v) + '</option>';
    }).join('') + '</select>';
  }
  // Lo escrito en un selector -> la opcion real, o ''.
  function resolverOpcion(texto, opciones) {
    var A = window.IniciativaAdmin, t = String(texto || '').trim();
    if (A && A.Selector) return A.Selector.resolver(t, opciones);
    return (opciones || []).indexOf(t) >= 0 ? t : '';
  }

  // ---------------------------------------------------------------------
  // Busqueda por folio o titulo
  // ---------------------------------------------------------------------
  // El estado Cerrado, comparado con plano(): lo que cuenta el indicador
  // Cerradas.
  var ESTADO_CERRADO = 'cerrado';

  // Sin mayusculas ni acentos, espacios colapsados.
  function plano(v) {
    return String(v === null || v === undefined ? '' : v).normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  }
  function esCerrada(i) { return plano(i.estado) === ESTADO_CERRADO; }
  // Dos llaves de un folio para que no importen separadores ni ceros:
  //   compacta   solo letras y digitos:     'PRB 2026-000012' -> 'prb2026000012'
  //   canonica   tramos sin ceros a la izq: 'PRB 2026-000012' -> 'prb 2026 12'
  // Asi 'prb-2026-000012', '000012' y '12' entran por la compacta y
  // 'PRB-2026-0000012' o '2026-0000012' (otro ancho de secuencia) por la
  // canonica. Coincidencia parcial: '12' trae todo folio con 12 en sus
  // digitos.
  function claveCompacta(v) { return plano(v).replace(/[^a-z0-9]/g, ''); }
  function claveCanonica(v) {
    return (plano(v).match(/[a-z]+|[0-9]+/g) || []).map(function (t) {
      return /^[0-9]/.test(t) ? t.replace(/^0+(?=[0-9])/, '') : t;
    }).join(' ');
  }

  class Busqueda {
    constructor(textoBuscado) {
      this.texto = typeof textoBuscado === 'string' ? textoBuscado : '';
      this.nombre = plano(this.texto);
      this.compacta = claveCompacta(this.texto);
      this.canonica = claveCanonica(this.texto);
    }

    activa() { return this.nombre !== ''; }

    // Folio completo o parcial (separadores y ceros a la izquierda dan
    // igual) o parte del titulo.
    pasa(i) {
      if (!this.activa()) return true;
      if (this.compacta && claveCompacta(i.folio).indexOf(this.compacta) >= 0) return true;
      if (this.canonica && claveCanonica(i.folio).indexOf(this.canonica) >= 0) return true;
      return plano(i.titulo).indexOf(this.nombre) >= 0;
    }
  }

  // ---------------------------------------------------------------------
  // Registro
  // ---------------------------------------------------------------------
  class Registro {
    constructor(iniciativas, estadosActivos, agrupadores, fechaGen, tiposCatalogo) {
      this.iniciativas = iniciativas;
      this.estadosActivos = estadosActivos;
      this.agrupadores = agrupadores;
      this.fechaGen = fechaGen;
      // [{ prefijo, nombre }] de dbo.CatPrefijoProblem (Tipo de iniciativa).
      this.tiposCatalogo = tiposCatalogo || [];
      // Filas { director, po, so, categoria } del catalogo de categorias,
      // solo despues de abrir la Cobertura (ver ampliar). null = sin cargar.
      this.catalogo = null;
      // 'catalogo' (por omision: MOD o rol aun desconocido) | 'completo'
      // (ADM). Ver la cabecera, FILTROS.
      this.alcance = 'catalogo';
      this.nombresCatalogo = null;   // { director: {}, po: {}, so: {} }
    }

    // Suma el catalogo a las filas organizacionales (la cascada y el filtro).
    ampliar(filasCatalogo) {
      this.catalogo = filasCatalogo;
      var n = { director: {}, po: {}, so: {} };
      (filasCatalogo || []).forEach(function (f) {
        Object.keys(n).forEach(function (k) { if (f[k]) n[k][f[k]] = true; });
      });
      this.nombresCatalogo = n;
    }

    fijarAlcance(completo) { this.alcance = completo ? 'completo' : 'catalogo'; }
    alcanceCompleto() { return this.alcance === 'completo'; }

    // Con alcance 'catalogo', una fila de iniciativa solo aporta opciones si
    // sus tres dueños son nombres del catalogo vigente.
    filaDelCatalogo(f) {
      var n = this.nombresCatalogo;
      return !!n && !!n.director[f.director] && !!n.po[f.po] && !!n.so[f.so];
    }

    // Las filas con las que se filtra una iniciativa: las de filasDe y, con
    // el catalogo cargado, ademas la CategoriaN2 de cada ruta (mismos
    // dueños), para que elegir una categoria del catalogo encuentre las
    // iniciativas que cuelgan de ella.
    // PO / SO de estas filas son los CAPTURADOS de la iniciativa
    // (po_capturado / so_capturado), los mismos de las columnas; Director y
    // Categoria siguen siendo los de cada categoria.
    filasDeIniciativa(i) {
      var filas = Registro.filasDe(i);
      if (this.catalogo && !i.sin_categoria) {
        i.categorias.forEach(function (c) {
          if (c.n2 && c.n2 !== c.categoria) {
            filas.push({ director: c.director || '', po: '', so: '', categoria: c.n2 });
          }
        });
      }
      var po = duenoCapturado(i, 'po'), so = duenoCapturado(i, 'so');
      return filas.map(function (f) { return { director: f.director, po: po, so: so, categoria: f.categoria }; });
    }

    // Sin la lista lanza: una respuesta rara no se pinta como "0
    // iniciativas". Entradas sin folio se descartan, sin corregirlas.
    static desdeJson(json) {
      if (!json || !Array.isArray(json.iniciativas)) {
        throw new Error('La respuesta del servidor no trae el registro de iniciativas.');
      }
      var lista = json.iniciativas.filter(function (i) {
        return i && typeof i.folio === 'string' && i.folio !== '';
      }).map(function (i) {
        if (!Array.isArray(i.categorias)) i.categorias = [];
        return i;
      });
      var r = new Registro(lista,
        Array.isArray(json.estados_activos) ? json.estados_activos : [],
        Array.isArray(json.agrupadores) ? json.agrupadores : [],
        typeof json.fecha_gen === 'string' ? json.fecha_gen : '',
        Registro.tiposDesdeJson(json.tipos_iniciativa));
      // Historial de fechas: 'ok' | 'sin_tabla' | 'error', o '' si el
      // servidor no lo manda; y desde cuando se captura (dd/MM/yyyy).
      r.historialEstado = typeof json.historial_estado === 'string' ? json.historial_estado : '';
      r.historialDesde = typeof json.historial_desde === 'string' ? json.historial_desde : '';
      // Valores de Estado/Subestado que ya existen en dbo.Problem (Modificar
      // y Solicitar cambios solo ofrecen estos).
      r.estadosProblem = Array.isArray(json.estados_problem) ? json.estados_problem.filter(esTexto) : [];
      r.subestadosProblem = Array.isArray(json.subestados_problem) ? json.subestados_problem.filter(esTexto) : [];
      // TipoIniciativa / TipoAgrupado que ya existen: lo unico que el alta y
      // una categoria ligada pueden declarar.
      r.valoresTipoIniciativa = Array.isArray(json.valores_tipo_iniciativa) ? json.valores_tipo_iniciativa.filter(esTexto) : [];
      r.valoresTipoAgrupado = Array.isArray(json.valores_tipo_agrupado) ? json.valores_tipo_agrupado.filter(esTexto) : [];
      // true solo si el servidor guarda (PersistenciaGestionAdmin activa).
      r.persistenciaAdmin = json.persistencia_admin === true;
      // "Solicitar cambios" se envia (sql/22) solo si el servidor lo dice.
      r.persistenciaSolicitudes = json.persistencia_solicitudes === true;
      // PO / SO capturados y quitar categoría en Modificar (sql/24): solo
      // si el servidor lo dice.
      r.edicionDuenosQuitar = json.edicion_duenos_quitar === true;
      // Volumetria fijada por ADM en Crear (sql/26): solo si el servidor
      // lo dice.
      r.volumetriaManual = json.volumetria_manual === true;
      // Subestado inicial en Crear (sql/27): solo si el servidor lo dice.
      r.subestadoAlta = json.subestado_alta === true;
      // "Solicitar cambios" de Título / PO / SO (sql/25): solo si el
      // servidor lo dice.
      r.solicitudesDatos = json.solicitudes_datos === true;
      return r;
    }

    // [{ prefijo, nombre }]: sin prefijo de texto se descarta; repetido, el
    // primero; sin nombre, el prefijo. El orden es el del servidor.
    static tiposDesdeJson(lista) {
      var vistos = {}, salida = [];
      (Array.isArray(lista) ? lista : []).forEach(function (t) {
        var p = t && typeof t.prefijo === 'string' ? t.prefijo : '';
        if (p === '' || Object.prototype.hasOwnProperty.call(vistos, p)) return;
        vistos[p] = true;
        salida.push({ prefijo: p, nombre: typeof t.nombre === 'string' && t.nombre !== '' ? t.nombre : p });
      });
      return salida;
    }

    // Filas { director, po, so, categoria } de una iniciativa: una por
    // categoria, o la del propio Problem si no tiene (categoria vacia).
    static filasDe(i) {
      if (i.sin_categoria || !i.categorias.length) {
        return [{ director: i.director || '', po: i.po || '', so: i.so || '', categoria: '' }];
      }
      return i.categorias.map(function (c) {
        return { director: c.director || '', po: c.po || '', so: c.so || '', categoria: c.categoria || '' };
      });
    }

    // Las filas que dan las OPCIONES de Director / PO / SO / Categoria (no
    // las que deciden si una iniciativa pasa: esas son filasDeIniciativa).
    filasOrganizacionales(director) {
      var salida = [], self = this, completo = this.alcanceCompleto();
      if (!completo && !this.catalogo) return salida;   // sin catalogo, sin opciones
      this.iniciativas.forEach(function (i) {
        if (!completo && i.sin_categoria) return;       // dueños del Problem: solo ADM
        self.filasDeIniciativa(i).forEach(function (f) {
          if (!completo && !self.filaDelCatalogo(f)) return;
          if (!director || f.director === director) salida.push(f);
        });
      });
      (this.catalogo || []).forEach(function (f) { if (!director || f.director === director) salida.push(f); });
      return salida;
    }

    directores() {
      return distintos(this.filasOrganizacionales('').map(function (f) { return f.director; })).sort(igualTexto);
    }

    // Los estados activos primero, en su orden; los demas despues, ordinal.
    estados() {
      var activos = this.estadosActivos;
      var todos = distintos(this.iniciativas.map(function (i) { return i.estado; }));
      return activos.filter(function (e) { return todos.indexOf(e) >= 0; })
        .concat(todos.filter(function (e) { return activos.indexOf(e) < 0; }).sort(igualTexto));
    }

    // Los prefijos del catalogo, en su orden (aunque no tengan iniciativas).
    tiposIniciativa() {
      return this.tiposCatalogo.map(function (t) { return t.prefijo; });
    }

    nombreTipo(prefijo) {
      for (var k = 0; k < this.tiposCatalogo.length; k++) {
        if (this.tiposCatalogo[k].prefijo === prefijo) return this.tiposCatalogo[k].nombre;
      }
      return prefijo;
    }

    buscar(folio) {
      for (var k = 0; k < this.iniciativas.length; k++) if (this.iniciativas[k].folio === folio) return this.iniciativas[k];
      return null;
    }

    // Los cinco indicadores sobre una lista de iniciativas (la vista le
    // pasa el registro completo, no lo filtrado). total = todas;
    // abiertas = no Cerradas; fueraActivas = abiertas - activas (ver la
    // cabecera).
    static indicadores(lista) {
      var r = { total: 0, abiertas: 0, sinCategoria: 0, activas: 0, reduceActivas: 0, fueraActivas: 0,
                requerimientos: 0, retrasadas: 0, riesgo: 0, cerradas: 0 };
      var c = CONDICION_KPI;
      lista.forEach(function (i) {
        if (c.cerradas(i)) r.cerradas++;
        else r.abiertas++;
        if (c.total(i)) {
          r.total++;
          if (i.sin_categoria) r.sinCategoria++;
        }
        if (c.requerimientos(i)) r.requerimientos++;
        if (c.activas(i)) {
          r.activas++;
          r.reduceActivas += numero(i.tickets_reduce);
        }
        if (c.retrasadas(i)) {
          r.retrasadas++;
          r.riesgo += numero(i.riesgo_folio);
        }
      });
      r.fueraActivas = r.abiertas - r.activas;
      return r;
    }

    // Una tarjeta (CLAVES_KPI) o una categoria del semaforo ('sem_' + k).
    static esIndicador(k) {
      return Object.prototype.hasOwnProperty.call(CONDICION_KPI, k) || !!semaforoDeIndicador(k);
    }

    // Si `i` cuenta en el indicador `k`: la misma regla con la que se
    // cuenta (CONDICION_KPI, semaforoFecha).
    static cumpleIndicador(k, i) {
      if (Object.prototype.hasOwnProperty.call(CONDICION_KPI, k)) return CONDICION_KPI[k](i);
      var s = semaforoDeIndicador(k);
      return !!s && Registro.semaforoFecha(i) === s.k;
    }

    // Agrupacion ReqOpr (ver la cabecera, Requerimientos). El estado lo
    // decide quien la llama.
    static esRequerimiento(i) { return plano(i.agrup) === AGRUPACION_REQUERIMIENTOS; }

    // La categoria del semaforo de una iniciativa, o null si no esta en un
    // estado activo (ver la cabecera, SEMAFORO).
    static semaforoFecha(i) {
      if (!i.activa) return null;
      if (i.control_fecha === false) return 'sin_control';
      if (i.fecha_retrasada) return 'atrasada';
      return fechaCompromiso(i) ? 'en_tiempo' : 'sin_fecha';
    }

    // { sin_fecha, atrasada, en_tiempo, sin_control } sobre una lista (la
    // vista le pasa el registro completo).
    static semaforo(lista) {
      var r = {};
      SEMAFORO.forEach(function (s) { r[s.k] = 0; });
      lista.forEach(function (i) {
        var k = Registro.semaforoFecha(i);
        if (k) r[k]++;
      });
      return r;
    }
  }

  // ---------------------------------------------------------------------
  // SeleccionVarios: varios valores de una lista de opciones
  // ---------------------------------------------------------------------
  // marcados: null = todos (sin restriccion); [] = ninguno (no pasa nada);
  // si no, los marcados en el orden de las opciones. "Todas/Todos" alterna:
  // con todo marcado desmarca todo; con cualquier otra cosa marca todo.
  // Marcar a mano el ultimo que faltaba vuelve a null. `opciones` es una
  // funcion: la lista puede crecer (p. ej. el registro se recarga).
  class SeleccionVarios {
    constructor(opciones) {
      this.opciones = opciones;
      this.marcados = null;
    }

    alternar(v) {
      var todos = this.opciones();
      if (todos.indexOf(v) < 0) return;
      // Un marcado que ya no es opcion (lo conservo sobre() tras un
      // guardado) se suelta al tocar el filtro.
      var marcados = this.lista().filter(function (t) { return todos.indexOf(t) >= 0; });
      var k = marcados.indexOf(v);
      if (k >= 0) marcados.splice(k, 1); else marcados.push(v);
      this.marcados = marcados.length === todos.length ? null
        : todos.filter(function (t) { return marcados.indexOf(t) >= 0; });
    }
    todas() { this.marcados = this.marcados === null ? [] : null; }
    // Solo `v`; vacio o fuera de las opciones = todos.
    solo(v) { this.marcados = v && this.opciones().indexOf(v) >= 0 ? [v] : null; }
    limpiar() { this.marcados = null; }
    todosMarcados() { return this.marcados === null; }
    activo() { return this.marcados !== null; }
    // Los marcados, en el orden de las opciones (todos si es null).
    lista() { return (this.marcados === null ? this.opciones() : this.marcados).slice(); }
    pasa(v) { return this.marcados === null || this.marcados.indexOf(v) >= 0; }
  }

  // ---------------------------------------------------------------------
  // FiltroRegistro
  // ---------------------------------------------------------------------
  class FiltroRegistro {
    constructor(registro) {
      this.registro = registro;
      this.estados = new SeleccionVarios(function () { return registro.estados(); });
      this.tipos = new SeleccionVarios(function () { return registro.tiposIniciativa(); });
      this.director = '';
      this.cascada = new CascadaOrganizacional(registro.filasOrganizacionales(''), 'filtro');
      this.busqueda = new Busqueda('');
      // Indicador elegido con un clic ('' = ninguno; ver la cabecera). Como
      // la busqueda, solo acota la lista (aplicar), no la Cobertura. La
      // mecanica es SeleccionKpi; que clave existe lo dice el Registro.
      this.seleccion = new SeleccionKpi({ valida: Registro.esIndicador, limpian: [INDICADOR_TODAS] });
    }

    get indicador() { return this.seleccion.clave; }

    // El mismo indicador lo quita; otro lo reemplaza; Total lo quita; uno
    // que no existe, nada. -> true si cambio.
    alternarIndicador(k) { return this.seleccion.alternar(k); }
    pasaIndicador(i) { return !this.indicador || Registro.cumpleIndicador(this.indicador, i); }

    // Folio o titulo. Solo acota la lista (aplicar), no la Cobertura.
    buscar(v) { this.busqueda = new Busqueda(v); }
    get textoBuscado() { return this.busqueda.texto; }
    busquedaActiva() { return this.busqueda.activa(); }

    // Estado: solo `v` ('' = todos). Para varios, alternarEstado.
    elegirEstado(v) { this.estados.solo(v); }
    alternarEstado(v) { this.estados.alternar(v); }
    todosEstados() { this.estados.todas(); }
    estadosMarcados() { return this.estados.lista(); }
    // Estado acotado y sin ningun marcado que sea Cerrado (plano(), como
    // esCerrada): la lista solo puede traer abiertas.
    excluyeCerradas() {
      return this.estados.activo() && !this.estados.lista().some(function (e) { return plano(e) === ESTADO_CERRADO; });
    }

    // Tipo de iniciativa (prefijo).
    get tiposIni() { return this.tipos.marcados; }
    alternarTipoIniciativa(v) { this.tipos.alternar(v); }
    todosTiposIniciativa() { this.tipos.todas(); }
    todosMarcados() { return this.tipos.todosMarcados(); }
    tiposIniciativa() { return this.tipos.lista(); }

    // El Director acota la cascada: se rearma con las filas de ese Director
    // y lo ya elegido abajo se conserva mientras siga siendo valido.
    elegirDirector(v) {
      this.director = this.registro.directores().indexOf(v) >= 0 ? v : '';
      this.rearmar();
    }

    // La cascada de nuevo sobre las filas de hoy (cambio de Director o
    // catalogo recien sumado), conservando lo elegido mientras valga.
    rearmar() {
      var antes = this.cascada.seleccion.slice();
      this.cascada = new CascadaOrganizacional(this.registro.filasOrganizacionales(this.director), 'filtro');
      for (var n = 0; n < antes.length; n++) {
        if (antes[n] && !this.cascada.elegir(n, antes[n])) break;
      }
    }

    elegir(nivel, v) { return this.cascada.elegir(nivel, v); }

    // El mismo filtro sobre un registro recien leido (tras un guardado).
    // Estado y Tipo se conservan TAL CUAL, aunque un valor elegido ya no
    // tenga iniciativas: el filtro sigue diciendo lo que el usuario eligio
    // (y la lista queda vacia) en vez de cambiar solo. Lo marcado es una
    // lista de inclusion: un valor que aparece por primera vez no entra.
    // Director y cascada se conservan mientras sigan siendo opcion.
    sobre(registro) {
      var f = new FiltroRegistro(registro);
      ['estados', 'tipos'].forEach(function (k) {
        var antes = this[k].marcados;
        f[k].marcados = antes === null ? null : antes.slice();
      }, this);
      f.elegirDirector(this.director);
      var sel = this.cascada.seleccion;
      for (var n = 0; n < sel.length; n++) {
        if (sel[n] && !f.cascada.elegir(n, sel[n])) break;
      }
      f.buscar(this.textoBuscado);
      this.seleccion.copiarEn(f.seleccion);
      return f;
    }

    limpiar() {
      this.estados.limpiar();
      this.tipos.limpiar();
      this.elegirDirector('');
      this.cascada.limpiar(0);
      this.buscar('');
      this.seleccion.limpiar();
    }

    activos() {
      var org = this.cascada.filtros();
      return (this.estados.activo() ? 1 : 0) + (this.tipos.activo() ? 1 : 0) + (this.director ? 1 : 0) + Object.keys(org).length +
        (this.busquedaActiva() ? 1 : 0) + (this.indicador ? 1 : 0);
    }

    // Estado y Tipo: lo que no es organizacional.
    pasaAtributos(i) {
      if (!this.estados.pasa(i.estado)) return false;
      if (!this.tipos.pasa(i.prefijo)) return false;
      return true;
    }

    // Una fila { director, po, so, categoria } contra Director y cascada.
    // `categorias`: si viene, la Categoria elegida tiene que estar en esa
    // lista (la Cobertura pasa la ruta y su N2); si no, igualdad exacta.
    pasaFila(f, categorias) {
      var director = this.director, org = this.cascada.filtros();
      if (director && f.director !== director) return false;
      return Object.keys(org).every(function (k) {
        if (k === 'categoria' && categorias) return categorias.indexOf(org[k]) >= 0;
        return f[k] === org[k];
      });
    }

    pasa(i) {
      if (!this.pasaAtributos(i)) return false;
      if (!this.director && !Object.keys(this.cascada.filtros()).length) return true;
      var self = this;
      return this.registro.filasDeIniciativa(i).some(function (f) { return self.pasaFila(f); });
    }

    // La lista: los filtros y, sobre lo que queda, la busqueda y el
    // indicador. La Cobertura no pasa por aqui (usa pasa / pasaAtributos /
    // pasaFila).
    aplicar(lista) {
      var self = this;
      return lista.filter(function (i) { return self.pasa(i) && self.busqueda.pasa(i) && self.pasaIndicador(i); });
    }
  }

  // ---------------------------------------------------------------------
  // Cobertura
  // ---------------------------------------------------------------------
  // Categorias del catalogo x iniciativas ACTIVAS del registro. No pide nada
  // ni calcula cifras: cruza dos listas que ya llegaron hechas.
  class Cobertura {
    constructor(registro, filas, omitidas) {
      this.registro = registro;
      this.filas = filas;            // [{ director, po, so, categoria }] del catalogo
      this.omitidas = omitidas;
      this.enCatalogo = {};
      var self = this;
      filas.forEach(function (f) { self.enCatalogo[f.categoria] = true; });
    }

    // El JSON de admin_iniciativas_catalogos.ashx. Sin la lista lanza; las
    // filas sin alguno de los cuatro textos se descartan (como en Nueva
    // solicitud), sin corregirlas.
    static desdeJson(json, registro) {
      if (!json || !Array.isArray(json.asignaciones)) {
        throw new Error('La respuesta del servidor no trae el catálogo de categorías.');
      }
      var claves = ['director', 'po', 'so', 'categoria'];
      var vistas = {};
      var filas = json.asignaciones.filter(function (f) {
        if (!f || !claves.every(function (c) { return typeof f[c] === 'string' && f[c] !== ''; })) return false;
        if (Object.prototype.hasOwnProperty.call(vistas, f.categoria)) return false;
        vistas[f.categoria] = true;
        return true;
      }).map(function (f) { return { director: f.director, po: f.po, so: f.so, categoria: f.categoria }; });
      return new Cobertura(registro, filas, Number(json.omitidas) || 0);
    }

    // Lo que cuenta como iniciativa activa aqui: `seguimiento`, con
    // categoria, y que pase Estado / Tipo.
    static cuenta(i, filtro) {
      return !!i.seguimiento && !i.sin_categoria && filtro.pasaAtributos(i);
    }

    // -> { filas, fuera, resumen } con lo elegido en `filtro`.
    //   filas  una por categoria del catalogo que pasa Director/cascada:
    //          { categoria, director, po, so, cubierta,
    //            iniciativas: [{ folio, titulo, estado, agrup, rutas }] }
    //   fuera  rutas de iniciativas activas sin categoria vigente del
    //          catalogo: { ruta, n2, director, po, so, iniciativas }
    calcular(filtro) {
      var self = this;
      var porN2 = {}, fuera = {}, ordenFuera = [], sinCategoria = 0;

      function agregar(destino, i, ruta) {
        for (var k = 0; k < destino.length; k++) {
          if (destino[k].folio === i.folio) {
            if (destino[k].rutas.indexOf(ruta) < 0) destino[k].rutas.push(ruta);
            return;
          }
        }
        destino.push({ folio: i.folio, titulo: i.titulo, estado: i.estado, agrup: i.agrup, rutas: [ruta] });
      }

      this.registro.iniciativas.forEach(function (i) {
        if (i.seguimiento && i.sin_categoria && filtro.pasa(i)) sinCategoria++;
        if (!Cobertura.cuenta(i, filtro)) return;
        i.categorias.forEach(function (c) {
          var ruta = c.categoria || '';
          if (c.n2 && self.enCatalogo[c.n2]) {
            agregar(porN2[c.n2] = porN2[c.n2] || [], i, ruta);
            return;
          }
          var fila = { director: c.director || '', po: c.po || '', so: c.so || '', categoria: ruta };
          if (!filtro.pasaFila(fila, [ruta].concat(c.n2 ? [c.n2] : []))) return;
          if (!Object.prototype.hasOwnProperty.call(fuera, ruta)) {
            fuera[ruta] = { ruta: ruta, n2: c.n2 || null, director: fila.director, po: fila.po, so: fila.so, iniciativas: [] };
            ordenFuera.push(ruta);
          }
          agregar(fuera[ruta].iniciativas, i, ruta);
        });
      });

      // Una categoria del catalogo pasa la Categoria elegida si es ella, o
      // si es la N2 de la ruta elegida.
      var rutas = this.rutasDeN2();
      var filas = this.filas.filter(function (f) {
        return filtro.pasaFila(f, [f.categoria].concat(rutas[f.categoria] || []));
      }).map(function (f) {
        var inis = (porN2[f.categoria] || []).slice().sort(function (a, b) { return igualTexto(a.folio, b.folio); });
        return { categoria: f.categoria, director: f.director, po: f.po, so: f.so,
                 cubierta: inis.length > 0, iniciativas: inis };
      }).sort(function (a, b) { return igualTexto(a.categoria, b.categoria); });

      var con = filas.filter(function (f) { return f.cubierta; }).length;
      return {
        filas: filas,
        fuera: ordenFuera.sort(igualTexto).map(function (r) { return fuera[r]; }),
        resumen: { categorias: filas.length, con: con, sin: filas.length - con,
                   fuera: ordenFuera.length, sinCategoria: sinCategoria, omitidas: this.omitidas }
      };
    }

    // N2 -> las rutas del registro que cuelgan de ella (cualquier estado:
    // son opciones de la Categoria). Se arma una vez.
    rutasDeN2() {
      if (this._rutasDeN2) return this._rutasDeN2;
      var mapa = {};
      this.registro.iniciativas.forEach(function (i) {
        i.categorias.forEach(function (c) {
          if (!c.categoria || !c.n2) return;
          var lista = mapa[c.n2] = mapa[c.n2] || [];
          if (lista.indexOf(c.categoria) < 0) lista.push(c.categoria);
        });
      });
      return (this._rutasDeN2 = mapa);
    }
  }

  // ---------------------------------------------------------------------
  // Orden de la tabla
  // ---------------------------------------------------------------------
  // Por omision (2026-10-20): por fecha de creacion (f_creacion =
  // dbo.Problem.FechaCreacion), la mas antigua primero; sin fecha o con una
  // que no es aaaa-mm-dd, al final. Empates por Codigo, para que el orden no
  // dependa del que trae el servidor. Tambien desempata el orden por columna.
  function fechaCompromiso(i) {
    var campo = FECHA_DEL_ESTADO[i.estado];
    return campo ? i[campo] || '' : '';
  }
  var COLUMNAS = {
    folio:   function (i) { return i.folio; },
    titulo:  function (i) { return (i.titulo || '').toLowerCase(); },
    estado:  function (i) { return i.estado || ''; },
    agrup:   function (i) { return i.agrup || ''; },
    po:      function (i) { return duenoCapturado(i, 'po'); },
    so:      function (i) { return duenoCapturado(i, 'so'); },
    // Dias desde la creacion; sin FechaCreacion, vacio (al final).
    edad:    function (i) { var d = diasDesdeCreacion(i); return d === null ? '' : d; },
    reduce:  function (i) { return numero(i.tickets_reduce); },
    fecha:   function (i) { return fechaCompromiso(i); }
  };
  function fechaCreacion(i) { return fechaValida(i.f_creacion) ? i.f_creacion : ''; }
  function ordenPorOmision(a, b) {
    var x = fechaCreacion(a), y = fechaCreacion(b);
    if (x === '' && y !== '') return 1;
    if (y === '' && x !== '') return -1;
    return igualTexto(x, y) || igualTexto(a.folio, b.folio);
  }
  function ordenar(lista, orden) {
    var copia = lista.slice();
    if (!orden || !COLUMNAS[orden.col]) return copia.sort(ordenPorOmision);
    var clave = COLUMNAS[orden.col], signo = orden.dir === 'desc' ? -1 : 1;
    return copia.sort(function (a, b) {
      var x = clave(a), y = clave(b);
      // Vacios siempre al final, en los dos sentidos.
      if (x === '' && y !== '') return 1;
      if (y === '' && x !== '') return -1;
      return signo * (x < y ? -1 : x > y ? 1 : 0) || ordenPorOmision(a, b);
    });
  }

  // Dueños distintos de una iniciativa (por sus categorias o, sin ellas, los
  // del Problem).
  function duenos(i, clave) {
    return distintos(Registro.filasDe(i).map(function (f) { return f[clave]; }));
  }

  // PO / SO CAPTURADOS de la iniciativa (dbo.Problem.OwnerProblem /
  // OwnerServicio): columnas, orden y filtro de la lista. '' = sin capturar.
  function duenoCapturado(i, clave) {
    var v = clave === 'po' ? i.po_capturado : clave === 'so' ? i.so_capturado : null;
    return typeof v === 'string' ? v.trim() : '';
  }

  // ---------------------------------------------------------------------
  // ExportRegistro: las dos hojas de "⬇ Descargar iniciativas"
  // ---------------------------------------------------------------------
  // Lo que exporta es lo que la lista muestra: las iniciativas de
  // filtradas() (Estado, Tipo, Director, cascada, busqueda e indicador)
  // COMPLETAS, sin "Mostrar mas", en el orden de la tabla (ordenar). Usa el
  // registro ya cargado (admin_iniciativas_registro.ashx, ADM/MOD) mas UNA
  // peticion al pulsar: ?export=1 al mismo handler, con las columnas de
  // dbo.Problem / dbo.ProblemCategoria que el registro no trae (Gerencia,
  // Direccion, Prioridad, TipoTicket...). Se cruzan por folio (y ruta); la
  // carga normal del registro no las pide. Ninguna cifra se calcula aqui:
  // van las del servidor o las mismas reglas de la vista.
  //
  //   Iniciativas  una fila por folio (dbo.Problem).
  //   Categorías   una fila por (Codigo, Categoria) de esas iniciativas
  //                (dbo.ProblemCategoria, ya deduplicada por el servidor):
  //                TODAS sus categorias, no solo la que paso un filtro de
  //                Categoria (el filtro elige iniciativas, no categorias).
  //                Las sin categoria no aportan filas ni se inventan.
  // Tickets a reducir de la iniciativa es el del servidor (suma de sus
  // categorias, la regla de Experiencia); no se vuelve a sumar.
  //
  // Columna: [encabezado, tipo (LibroIniciativas), ancho, valor(i, registro, x)],
  // x = la fila de ?export=1 de esa iniciativa ({} si no vino).
  function deX(campo) { return function (a, b, x) { return x[campo]; }; }
  // Folio + ruta como llave de las categorias de ?export=1; las rutas ya
  // vienen normalizadas (sin espacio duro), asi que no puede confundirlas.
  var SEP_EXTRA = '\u00a0';
  var ROTULO_SEMAFORO = { sin_fecha: 'Sin fecha', atrasada: 'Atrasada', en_tiempo: 'En tiempo', sin_control: 'Sin control de fecha' };
  function siNo(v) { return v ? 'Sí' : 'No'; }
  var ExportRegistro = {
    COLUMNAS_INICIATIVAS: [
      ['Código', 'texto', 17, function (i) { return i.folio; }],                                 // Problem.Codigo
      ['Tipo de iniciativa', 'texto', 18, function (i, r) { return i.prefijo ? r.nombreTipo(i.prefijo) : ''; }], // CatPrefijoProblem por Problem.Prefijo
      ['Título', 'texto', 45, function (i) { return i.titulo; }],                                // ProblemCategoria.TituloIniciativa o Problem.Titulo
      ['Título del problema', 'texto', 45, function (i) { return i.titulo_problem; }],           // Problem.Titulo
      ['Estado', 'texto', 14, function (i) { return i.estado; }],
      ['Subestado', 'texto', 16, function (i) { return i.subestado; }],                          // Problem.Subestado
      ['Agrupación', 'texto', 13, function (i) { return i.agrup; }],                             // TipoAgrupado (sin categoria: Problem.TipoIniciativa)
      ['Tipo Iniciativa (Problem)', 'texto', 18, deX('tipo_iniciativa')],                         // Problem.TipoIniciativa
      ['Medible', 'texto', 10, function (i) { return siNo(i.seguimiento); }],                    // indicador "Iniciativas medibles"
      ['Prioridad', 'texto', 12, deX('prioridad')],                                              // Problem.Prioridad
      ['Impacto', 'texto', 12, deX('impacto')],                                                  // Problem.Impacto
      ['Product Owner', 'texto', 26, function (i) { return duenoCapturado(i, 'po'); }],          // Problem.OwnerProblem
      ['Service Owner', 'texto', 26, function (i) { return duenoCapturado(i, 'so'); }],          // Problem.OwnerServicio
      ['Director', 'texto', 26, function (i) { return duenos(i, 'director').join('; '); }],      // de sus categorias (sin categoria: Problem.Direccion)
      ['Gerencia', 'texto', 26, deX('gerencia')],                                                // Problem.Gerencia
      ['Dirección', 'texto', 26, deX('direccion')],                                              // Problem.Direccion (capturada; no es el Director)
      ['RCA', 'texto', 10, deX('rca')],                                                          // Problem.RCA
      ['Fecha de creación', 'fecha', 12, function (i) { return fechaCreacion(i); }],             // Problem.FechaCreacion
      ['Fecha entrega PRB', 'fecha', 12, deX('f_entrega_prb')],                                  // Problem.FechaEntregaPrb
      ['Antigüedad (días)', 'entero', 11, function (i) { return diasDesdeCreacion(i); }],
      ['Fecha análisis', 'fecha', 12, function (i) { return i.f_analisis; }],                     // Problem.FechaAnalisis
      ['Fecha solución', 'fecha', 12, function (i) { return i.f_solucion; }],                     // FechaSolucion
      ['Fecha cierre', 'fecha', 12, function (i) { return i.f_cierre; }],                         // FechaCierre
      ['Fecha compromiso vigente', 'fecha', 13, function (i) { return i.activa ? fechaCompromiso(i) : ''; }],
      ['Semáforo', 'texto', 14, function (i) { return ROTULO_SEMAFORO[Registro.semaforoFecha(i)] || ''; }],
      ['Categorías', 'entero', 11, function (i) { return i.categorias.length; }],
      ['Volumetría original', 'entero', 12, deX('volumetria_original')],                         // Problem.VolumetriaOriginal
      ['Tickets a reducir', 'entero', 12, function (i) { return numero(i.tickets_reduce); }],
      ['Tickets en riesgo', 'entero', 12, function (i) { return numero(i.riesgo_folio); }],
      ['Descripción', 'texto', 60, function (i) { return i.descripcion; }],                       // Problem.Descripcion
      ['Observaciones', 'texto', 60, function (i) { return i.observaciones; }]                    // Problem.Observaciones
    ],
    // c = la categoria, i = su iniciativa, x = su fila de ?export=1.
    COLUMNAS_CATEGORIAS: [
      ['Código', 'texto', 17, function (c, i) { return i.folio; }],                               // ProblemCategoria.Codigo
      ['Título', 'texto', 45, function (c, i) { return i.titulo; }],
      ['Estado de la iniciativa', 'texto', 14, function (c, i) { return i.estado; }],
      ['Categoría', 'texto', 50, function (c) { return c.categoria; }],                           // ProblemCategoria.Categoria
      ['Categoría N2', 'texto', 24, function (c) { return c.n2; }],                               // CatCategoriaDueno.CategoriaN2 de su C1&C2
      ['Agrupación', 'texto', 13, function (c) { return c.agrup; }],                              // ProblemCategoria.TipoAgrupado
      ['Tipo de ticket', 'texto', 14, deX('tipo_ticket')],                                        // ProblemCategoria.TipoTicket
      ['Tipo Iniciativa (categoría)', 'texto', 18, deX('tipo_iniciativa')],                       // ProblemCategoria.TipoIniciativa
      ['% disminución', 'pct', 12, function (c) { return c.pct_dism; }],                          // ProblemCategoria.PctDisminucion
      ['Tickets a reducir', 'entero', 12, function (c) { return c.tickets_reduce; }],             // calculado (ExpTicketsReduce) o ProblemCategoria.TicketsReduce
      ['Mes reducción', 'entero', 10, deX('mes_reduccion')],                                     // ProblemCategoria.MesReduccion
      ['Fecha análisis', 'fecha', 12, function (c) { return c.f_analisis; }],                      // la efectiva (propia o la de la iniciativa)
      ['Director', 'texto', 26, function (c) { return c.director; }],                             // dueños de la categoria (CatCategoriaDueno)
      ['Product Owner', 'texto', 26, function (c) { return c.po; }],
      ['Service Owner', 'texto', 26, function (c) { return c.so; }]
    ],

    // La respuesta de ?export=1 -> { ini: folio -> fila, cat: folio+ruta ->
    // fila }. Sin las dos listas lanza: no se arma un Excel a medias. Folio
    // (y ruta) repetidos: la primera fila, como el servidor.
    indiceExtra(json) {
      if (!json || !Array.isArray(json.iniciativas) || !Array.isArray(json.categorias)) {
        throw new Error('la respuesta del servidor no trae las columnas del Excel.');
      }
      var x = { ini: {}, cat: {} };
      function poner(mapa, k, f) { if (!Object.prototype.hasOwnProperty.call(mapa, k)) mapa[k] = f; }
      json.iniciativas.forEach(function (f) { if (f && esTexto(f.folio)) poner(x.ini, f.folio, f); });
      json.categorias.forEach(function (f) {
        if (f && esTexto(f.folio) && esTexto(f.categoria)) poner(x.cat, f.folio + SEP_EXTRA + f.categoria, f);
      });
      return x;
    },

    // Las hojas para LibroIniciativas.construir. `lista` ya filtrada y
    // ordenada (la vista pasa ordenar(filtradas(), orden)); `extra` el
    // indiceExtra (sin el, columnas extra vacias). Las filas salen SOLO del
    // registro: una fila de extra que no cruza no agrega nada. La columna
    // Subestado sale solo con `conSubestado` (rol ADM).
    hojas(lista, registro, extra, conSubestado) {
      function columnas(defs) { return defs.map(function (d) { return { t: d[0], tipo: d[1], ancho: d[2] }; }); }
      function de(mapa, k) { return extra && Object.prototype.hasOwnProperty.call(extra[mapa], k) ? extra[mapa][k] : {}; }
      var cI = ExportRegistro.COLUMNAS_INICIATIVAS.filter(function (d) { return conSubestado || d[0] !== 'Subestado'; });
      var cC = ExportRegistro.COLUMNAS_CATEGORIAS;
      var filasCat = [];
      lista.forEach(function (i) {
        i.categorias.forEach(function (c) {
          var x = de('cat', i.folio + SEP_EXTRA + c.categoria);
          filasCat.push(cC.map(function (d) { return d[3](c, i, x); }));
        });
      });
      return [
        { nombre: 'Iniciativas', columnas: columnas(cI),
          filas: lista.map(function (i) { var x = de('ini', i.folio); return cI.map(function (d) { return d[3](i, registro, x); }); }) },
        { nombre: 'Categorías', columnas: columnas(cC), filas: filasCat }
      ];
    },

    // Iniciativas_aaaa-mm-dd[_filtrado].xlsx; `hoy` es un Date (fecha local).
    nombre(hoy, filtrado) {
      function dos(n) { return (n < 10 ? '0' : '') + n; }
      return 'Iniciativas_' + hoy.getFullYear() + '-' + dos(hoy.getMonth() + 1) + '-' + dos(hoy.getDate()) +
        (filtrado ? '_filtrado' : '') + '.xlsx';
    }
  };

  // SheetJS: el MISMO vendor de Experiencia y QARE, traido la primera vez
  // que se pulsa el boton (si otra pestaña ya lo cargo, se reusa).
  var URL_XLSX = '../experiencia/vendor/xlsx.mini.min.js';
  var xlsxCargando = null;
  function cargarXLSX() {
    if (window.XLSX) return Promise.resolve(window.XLSX);
    if (!xlsxCargando) {
      xlsxCargando = new Promise(function (listo, fallo) {
        var s = document.createElement('script');
        s.src = URL_XLSX;
        s.onload = function () { listo(window.XLSX); };
        s.onerror = function () { xlsxCargando = null; fallo(new Error('no se pudo cargar ' + URL_XLSX)); };
        document.head.appendChild(s);
      });
    }
    return xlsxCargando;
  }
  function bajarArchivo(bytes, nombre) {
    var url = URL.createObjectURL(new Blob([bytes],
      { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    var a = document.createElement('a');
    a.href = url; a.download = nombre;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
  }

  // ---------------------------------------------------------------------
  // VistaRegistro
  // ---------------------------------------------------------------------
  var SELECTS_ORG = ['regPo', 'regSo', 'regCategoria'];

  // Los filtros de varios valores: un boton que abre un panel de casillas.
  // Mismo comportamiento; cambian los ids, los atributos y los textos.
  var MULTIS = {
    estado: {
      boton: 'regEstado', panel: 'regEstadoPanel', campo: 'regEstadoCampo',
      attrUno: 'data-estado-ini', attrTodas: 'data-estado-todas',
      rotuloTodas: 'Todos', textoTodas: '— Todos —', plural: 'estados',
      ninguno: 'Ningún estado marcado: no se muestra ninguna iniciativa.'
    },
    tipo: {
      boton: 'regTipoIni', panel: 'regTipoIniPanel', campo: 'regTipoIniCampo',
      attrUno: 'data-tipo-ini', attrTodas: 'data-tipo-todas',
      rotuloTodas: 'Todas', textoTodas: '— Todas —', plural: 'tipos',
      ninguno: 'Ningún tipo marcado: no se muestra ninguna iniciativa.'
    }
  };

  // Lo que se puede pedir cambiar de una iniciativa (designado
  // 2026-10-12): las tres fechas compromiso, Estado, el % de una categoria
  // ligada y "Otros", una EXPLICACION libre de una correccion (p. ej.
  // "elegi mal la categoria") que no cambia nada por si sola: la corrige
  // ADM con "Modificar". Nada mas se adivina. El Subestado no se pide
  // (2026-10-26): es solo de ADM, que lo cambia con "Modificar".
  var CAMPOS_FECHA = [
    { clave: 'f_analisis', rotulo: 'Fecha compromiso de Análisis', tipo: 'fecha' },
    { clave: 'f_solucion', rotulo: 'Fecha compromiso de Solución', tipo: 'fecha' },
    { clave: 'f_cierre', rotulo: 'Fecha compromiso de Cierre', tipo: 'fecha' }
  ];
  // "Qué cambiar" agrupa las tres fechas en UNA opcion (2026-10-26); la
  // etapa se elige aparte. Solo presentacion: el borrador guarda la etapa
  // (f_analisis | f_solucion | f_cierre) y viaja igual que antes (tipo
  // fecha + campo_fecha). campo = 'fecha' = elegida pero sin etapa todavia.
  var CAMPO_FECHA = { clave: 'fecha', rotulo: 'Fecha de compromiso', tipo: 'fecha' };
  var CAMPOS_CAMBIO = [
    CAMPO_FECHA,
    { clave: 'estado', rotulo: 'Estado', tipo: 'estado' },
    { clave: 'pct', rotulo: 'Categorías: % de disminución o agregar', tipo: 'pct' },
    { clave: 'otros', rotulo: 'Otros (explica la corrección)', tipo: 'otros' }
  ];
  // Título / PO / SO CAPTURADOS de la iniciativa (sql/25): solo si el
  // servidor lo dice (solicitudes_datos); va antes de "Otros". PO / SO son
  // los de dbo.Problem (po_capturado / so_capturado), nunca los de la
  // categoría. El Código no se puede pedir.
  var CAMPO_DATOS = { clave: 'datos', rotulo: 'Título, Product Owner o Service Owner', tipo: 'datos' };
  var DATOS_CAMBIO = [
    { clave: 'titulo', rotulo: 'Título', par: 'titulo_nuevo' },
    { clave: 'po', rotulo: 'Product Owner capturado', par: 'po_nuevo' },
    { clave: 'so', rotulo: 'Service Owner capturado', par: 'so_nuevo' }
  ];
  function camposCambio(conDatos) {
    return conDatos ? CAMPOS_CAMBIO.slice(0, -1).concat([CAMPO_DATOS], CAMPOS_CAMBIO.slice(-1)) : CAMPOS_CAMBIO.slice();
  }

  // La etapa de cada fecha compromiso, para decir SIEMPRE a cual se refiere
  // una fecha pedida (nunca se deduce del Estado).
  var ETAPAS_FECHA = { f_analisis: 'Análisis', f_solucion: 'Solución', f_cierre: 'Cierre' };
  function esCampoFecha(clave) { return Object.prototype.hasOwnProperty.call(ETAPAS_FECHA, clave); }
  // La etapa con la que arranca "Fecha de compromiso": la de FECHA_DEL_ESTADO
  // (En Monitoreo -> Cierre: la misma regla del semaforo, y Monitoreo es
  // el que llena FechaCierre, PlanGestionAdmin) y, ya cerrada, la de
  // Cierre. Otro Estado (o sin Estado): ninguna; quien pide la elige.
  var ETAPA_SOLICITUD = { 'Cerrado': 'f_cierre' };
  Object.keys(FECHA_DEL_ESTADO).forEach(function (e) { ETAPA_SOLICITUD[e] = FECHA_DEL_ESTADO[e]; });
  function etapaPorOmision(i) {
    return i && Object.prototype.hasOwnProperty.call(ETAPA_SOLICITUD, i.estado) ? ETAPA_SOLICITUD[i.estado] : '';
  }
  function rotuloFechaNueva(clave) {
    return esCampoFecha(clave) ? 'Nueva fecha compromiso de ' + ETAPAS_FECHA[clave] : 'Nueva fecha compromiso';
  }

  // Historial de fechas: el nombre corto de cada columna de dbo.Problem.
  var CAMPOS_HISTORIAL = { FechaAnalisis: 'Análisis', FechaSolucion: 'Solución', FechaCierre: 'Cierre' };

  // Rotulo de cada fila del historial, en el orden en que llegan (IdEvento).
  // Solo "Cambio n" cuenta; n corre por categoria y campo (una fila sin
  // `categoria` es de la iniciativa: su numeracion no cambia). En Cierre un
  // adelanto (nueva < anterior) no cuenta. Sin `operacion` la fila no es
  // del contrato: se rotula "—" y no cuenta. En una fila de categoria,
  // anterior vacio = la categoria heredaba la fecha de la iniciativa.
  function etiquetarHistorial(lista) {
    var n = {};
    return (Array.isArray(lista) ? lista : []).map(function (h) {
      var e = '—', cuenta = false, deCategoria = !!(h && h.categoria);
      var k = (deCategoria ? h.categoria : '') + '\u0000' + (h ? h.campo : '');
      if (!h || !h.operacion) {
        e = '—';
      } else if (h.operacion === 'B') {
        e = 'Línea base';
      } else if (h.operacion === 'I') {
        e = deCategoria ? 'Fecha propia inicial' : 'Fecha inicial';
      } else if (!h.anterior && h.nuevo) {
        e = deCategoria ? 'Fecha propia asignada' : 'Fecha asignada';
      } else if (h.anterior && !h.nuevo) {
        e = 'Fecha retirada';
      } else if (h.campo === 'FechaCierre' && String(h.nuevo) < String(h.anterior)) {
        e = 'Adelanto (no cuenta)';
      } else {
        n[k] = (n[k] || 0) + 1;
        e = 'Cambio ' + n[k];
        cuenta = true;
      }
      return { fila: h || {}, etiqueta: e, cuenta: cuenta };
    });
  }

  function campoCambio(clave) {
    var todos = CAMPOS_FECHA.concat(camposCambio(true));
    for (var k = 0; k < todos.length; k++) if (todos[k].clave === clave) return todos[k];
    return null;
  }

  // 'aaaa-mm-dd' que existe en el calendario.
  function fechaValida(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '');
    if (!m) return false;
    var d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
  }

  // ---------------------------------------------------------------------
  // SolicitudCambio: borrador de "Solicitar cambios". No se guarda ni se
  // envia (no hay almacen de solicitudes todavia); solo se valida.
  // ---------------------------------------------------------------------
  // opciones: { estados } (los valores que ya existen en dbo.Problem; sin
  // lista no se puede pedir cambio de Estado; un `subestados` se ignora:
  // el Subestado no se pide), rutas (el
  // catalogo vigente: lo unico que se puede pedir agregar) y rutasEstado
  // ('cargando' | 'error' | 'ok').
  //
  // Campo 'pct' (Categorias): UNA solicitud lleva varias categorias. Un %
  // nuevo para cualquiera de las ligadas (pcts: ruta -> texto) y categorias
  // del catalogo para agregar, cada una con su % (nuevas). Sin repetir:
  // ni una ligada ni dos veces la misma.
  class SolicitudCambio {
    constructor(iniciativa, opciones) {
      opciones = opciones || {};
      this.iniciativa = iniciativa;
      this.estados = Array.isArray(opciones.estados) ? opciones.estados : [];
      this.rutas = Array.isArray(opciones.rutas) ? opciones.rutas : [];
      this.rutasEstado = opciones.rutasEstado || (this.rutas.length ? 'ok' : '');
      // Por omision, la fecha del estado activo en el que esta (la que se
      // suele pedir extender); si no esta en uno de esos estados, ninguna.
      // campo: f_analisis | f_solucion | f_cierre (Fecha de compromiso con
      // su etapa), 'fecha' (sin etapa), estado, pct, datos u otros.
      this.campo = FECHA_DEL_ESTADO[iniciativa.estado] || '';
      this.propuesto = '';   // fecha o Estado (texto), segun el campo
      this.pcts = {};        // solo con campo 'pct': ruta ligada -> % pedido (texto)
      this.nuevas = [];      // solo con campo 'pct': [{ categoria, valor }] a agregar
      // Solo con campo 'datos' (sql/25, opciones.datos): por dato, null = no
      // se pide; texto = el valor pedido ('' = que quede vacio). PO / SO,
      // de las listas del catalogo (opciones.pos / sos).
      this.conDatos = opciones.datos === true;
      this.pos = Array.isArray(opciones.pos) ? opciones.pos : [];
      this.sos = Array.isArray(opciones.sos) ? opciones.sos : [];
      this.datos = { titulo: null, po: null, so: null };
      this.motivo = '';
      this.llave = nuevaLlave();
      this.enviada = null;   // numero de la solicitud que dio el servidor
    }

    // Las opciones de "Qué cambiar". conDatos: con 'datos' (Título / PO /
    // SO, sql/25) antes de "Otros".
    static campos(conDatos) { return camposCambio(conDatos === true); }
    // Las tres etapas de "Fecha de compromiso".
    static camposFecha() { return CAMPOS_FECHA.slice(); }
    static etapaPorOmision(iniciativa) { return etapaPorOmision(iniciativa); }

    // La opcion de "Qué cambiar" del campo: las tres fechas son 'fecha'.
    queCambiar() { return this.tipo() === 'fecha' ? 'fecha' : this.campo; }

    // Elegir en "Qué cambiar". 'fecha' conserva la etapa ya elegida o
    // arranca en la del Estado actual (etapaPorOmision); sin ella, queda
    // sin etapa y quien pide la elige. Una etapa suelta tambien vale.
    elegir(clave) {
      if (clave === 'fecha') this.campo = esCampoFecha(this.campo) ? this.campo : etapaPorOmision(this.iniciativa) || 'fecha';
      else this.campo = campoCambio(clave) ? clave : '';
      return this.campo;
    }

    // Elegir la etapa de "Fecha de compromiso" ('' = ninguna todavia).
    elegirEtapa(clave) {
      this.campo = esCampoFecha(clave) ? clave : 'fecha';
      return this.campo;
    }

    // Lo de ahora de cada dato: el Título de dbo.Problem y los PO / SO
    // CAPTURADOS (no los de la categoría).
    datoActual(clave) {
      var i = this.iniciativa;
      if (clave === 'titulo') return (i.titulo_problem !== undefined && i.titulo_problem !== null ? i.titulo_problem : i.titulo) || '';
      if (clave === 'po') return i.po_capturado || '';
      if (clave === 'so') return i.so_capturado || '';
      return '';
    }

    // -> [{ campo, rotulo, anterior, nuevo }] de los datos pedidos.
    cambiosDatos() {
      var self = this;
      return DATOS_CAMBIO.filter(function (d) { return self.datos[d.clave] !== null && self.datos[d.clave] !== undefined; })
        .map(function (d) {
          return { campo: d.clave, rotulo: d.rotulo, anterior: self.datoActual(d.clave), nuevo: String(self.datos[d.clave]).trim() };
        });
    }

    // Lo que va a admin_iniciativas_solicitudes.ashx?accion=enviar (despues
    // de validar). Quien envia y su rol los pone el servidor: aqui no van.
    // La fecha va siempre con su etapa (campo_fecha).
    pares() {
      var t = this.tipo(), s = this.resumen();
      var p = [['folio', this.iniciativa.folio], ['llave', this.llave],
               ['tipo', t === 'pct' ? 'categorias' : t === 'fecha' || t === 'estado' || t === 'datos' ? t : 'otros']];
      // Solo los datos pedidos (la clave presente = se pide).
      if (t === 'datos') {
        s.datos.forEach(function (d) {
          for (var k = 0; k < DATOS_CAMBIO.length; k++) if (DATOS_CAMBIO[k].clave === d.campo) p.push([DATOS_CAMBIO[k].par, d.nuevo]);
        });
      }
      if (t === 'fecha') p.push(['campo_fecha', this.campo], ['fecha_nueva', s.nuevo]);
      if (t === 'estado') {
        p.push(['estado_nuevo', s.nuevo]);
      }
      if (t === 'pct') {
        s.categorias.forEach(function (c) {
          if (c.nueva) p.push(['agregar_categoria', c.categoria], ['agregar_pct', c.nuevo]);
          else p.push(['pct_categoria', c.categoria], ['pct_valor', c.nuevo]);
        });
      }
      p.push(['motivo', s.motivo]);
      return p;
    }

    tipo() { var c = campoCambio(this.campo); return c ? c.tipo : ''; }

    categoriasLigadas() { return (this.iniciativa.categorias || []).map(function (c) { return c.categoria; }); }

    // El % actual (texto) de una categoria ligada, o null.
    pctActual(ruta) {
      var c = (this.iniciativa.categorias || []).filter(function (x) { return x.categoria === ruta; })[0];
      return c && typeof c.pct_dism === 'number' ? String(Math.round(c.pct_dism * 10000) / 100) : null;
    }

    // El valor actual de lo que se pide cambiar (texto), o null. En 'pct'
    // no hay uno solo: cada categoria tiene el suyo (pctActual).
    actual() {
      var t = this.tipo(), i = this.iniciativa;
      if (t === 'fecha') return esCampoFecha(this.campo) && i[this.campo] ? i[this.campo] : null;
      if (t === 'estado') return i.estado || null;
      return null;
    }

    // % pedido para una ligada ('' = sin cambio). Una ruta no ligada no se
    // acepta aqui: se agrega con agregarCategoria.
    fijarPct(ruta, texto) {
      if (this.categoriasLigadas().indexOf(ruta) < 0) return false;
      this.pcts[ruta] = String(texto === null || texto === undefined ? '' : texto).trim();
      return true;
    }

    // texto: lo escrito o elegido. -> { ok, mensaje, ruta }. Solo rutas del
    // catalogo, sin repetir una ligada ni una ya agregada.
    agregarCategoria(texto) {
      var A = window.IniciativaAdmin;
      if (!String(texto || '').trim()) return { ok: false, mensaje: 'Elige una categoría.' };
      if (!this.rutas.length) {
        return { ok: false, mensaje: this.rutasEstado === 'cargando' ? 'El catálogo de categorías todavía se está cargando.'
          : this.rutasEstado === 'error' ? 'No se pudo cargar el catálogo de categorías.' : 'El catálogo de categorías no está disponible.' };
      }
      var escrito = String(texto).trim();
      var ruta = A ? A.Selector.resolver(escrito, this.rutas) : (this.rutas.indexOf(escrito) >= 0 ? escrito : '');
      if (!ruta) return { ok: false, mensaje: A ? A.noEnLista(escrito, this.rutas, 'una categoría') : 'Elige una categoría de la lista.' };
      var k = plano(ruta);
      if (this.categoriasLigadas().some(function (c) { return plano(c) === k; })) {
        return { ok: false, ruta: ruta, mensaje: ruta + ' ya es una categoría de esta iniciativa: pide su % en la tabla.' };
      }
      if (this.nuevas.some(function (n) { return plano(n.categoria) === k; })) {
        return { ok: false, ruta: ruta, mensaje: ruta + ' ya está en la lista para agregar.' };
      }
      this.nuevas.push({ categoria: ruta, valor: '' });
      return { ok: true, ruta: ruta, mensaje: '' };
    }

    capturarPctNueva(n, texto) {
      if (this.nuevas[n]) this.nuevas[n].valor = String(texto === null || texto === undefined ? '' : texto).trim();
    }

    quitarNueva(n) { return this.nuevas.splice(n, 1).length > 0; }

    // -> [{ categoria, anterior, nuevo, nueva }] de lo pedido en 'pct':
    // ligadas con % escrito y todas las nuevas.
    cambiosCategorias() {
      var self = this;
      return this.categoriasLigadas().filter(function (r) { return self.pcts[r]; })
        .map(function (r) { return { categoria: r, anterior: self.pctActual(r), nuevo: self.pcts[r], nueva: false }; })
        .concat(this.nuevas.map(function (n) { return { categoria: n.categoria, anterior: null, nuevo: n.valor, nueva: true }; }));
    }

    // -> [{ campo, mensaje }]; vacia = lista para enviar (cuando se pueda).
    validar() {
      var errores = [], t = this.tipo(), i = this.iniciativa;
      var nuevo = String(this.propuesto || '').trim();
      if (!t) {
        errores.push({ campo: 'campo', mensaje: 'Elige qué quieres cambiar.' });
      } else if (t === 'fecha' && !esCampoFecha(this.campo)) {
        errores.push({ campo: 'etapa', mensaje: 'Elige qué fecha compromiso quieres cambiar: Análisis, Solución o Cierre.' });
      } else if (t === 'fecha') {
        if (!fechaValida(nuevo)) errores.push({ campo: 'propuesto', mensaje: 'Escribe la nueva fecha.' });
        else if (nuevo === this.actual()) errores.push({ campo: 'propuesto', mensaje: 'La nueva fecha es igual a la actual.' });
      } else if (t === 'estado') {
        if (!this.estados.length) errores.push({ campo: 'propuesto', mensaje: 'No hay lista de estados: no se puede pedir este cambio.' });
        else if (this.estados.indexOf(nuevo) < 0) errores.push({ campo: 'propuesto', mensaje: 'Elige el nuevo Estado de la lista.' });
        else if (nuevo === (i.estado || '')) errores.push({ campo: 'propuesto', mensaje: 'El Estado pedido es igual al actual.' });
      } else if (t === 'pct') {
        var cats = this.cambiosCategorias();
        if (!cats.length) errores.push({ campo: 'categoria', mensaje: 'Escribe el nuevo % de al menos una categoría o agrega una.' });
        cats.forEach(function (c) {
          if (!/^\d{1,3}(\.\d{1,2})?$/.test(c.nuevo) || Number(c.nuevo) > 100) {
            errores.push({ campo: 'propuesto', categoria: c.categoria,
              mensaje: c.categoria + ': escribe un porcentaje entre 0 y 100, con hasta dos decimales.' });
          } else if (!c.nueva && c.anterior !== null && Number(c.nuevo) === Number(c.anterior)) {
            errores.push({ campo: 'propuesto', categoria: c.categoria, mensaje: c.categoria + ': el % pedido es igual al actual.' });
          }
        });
      } else if (t === 'datos') {
        var self = this, datos = this.cambiosDatos();
        if (!this.conDatos) {
          errores.push({ campo: 'campo', mensaje: 'Pedir cambio de Título, Product Owner o Service Owner todavía no está habilitado: explícalo con «Otros».' });
        } else if (!datos.length) {
          errores.push({ campo: 'datos', mensaje: 'Marca qué dato quieres cambiar: Título, Product Owner o Service Owner.' });
        }
        datos.forEach(function (d) {
          var lista = d.campo === 'po' ? self.pos : d.campo === 'so' ? self.sos : null;
          // PO / SO: de la lista del catálogo; vacío = que quede vacío. El
          // servidor lo vuelve a revisar al aplicar.
          if (lista && d.nuevo && lista.indexOf(d.nuevo) < 0) {
            errores.push({ campo: 'datos', dato: d.campo, mensaje: d.rotulo + ': elige uno de la lista del catálogo.' });
          } else if (d.nuevo === String(d.anterior || '').trim()) {
            errores.push({ campo: 'datos', dato: d.campo, mensaje: d.rotulo + ': el valor pedido es igual al actual.' });
          } else if (lista && d.nuevo.length > 255) {
            errores.push({ campo: 'datos', dato: d.campo, mensaje: d.rotulo + ': pasa de 255 caracteres.' });
          }
        });
      }
      if (!String(this.motivo || '').trim()) {
        errores.push({ campo: 'motivo', mensaje: t === 'otros' ? 'Explica qué hay que corregir.' : 'Explica el motivo del cambio.' });
      }
      return errores;
    }

    // automatica: true si, aprobada, se puede aplicar tal cual (fecha,
    // Estado, %); 'otros' nunca (es una explicacion).
    resumen() {
      var c = campoCambio(this.campo), t = this.tipo();
      var r = { folio: this.iniciativa.folio, campo: this.campo, rotulo: c ? c.rotulo : '',
                anterior: this.actual(), nuevo: String(this.propuesto || '').trim(), motivo: String(this.motivo || '').trim() };
      if (t === 'fecha') r.etapa = ETAPAS_FECHA[this.campo];
      if (t === 'pct') { r.anterior = null; r.nuevo = ''; r.categorias = this.cambiosCategorias(); }
      if (t === 'datos') { r.anterior = null; r.nuevo = ''; r.datos = this.cambiosDatos(); }
      if (t === 'otros') { r.nuevo = ''; r.automatica = false; }
      else if (t) r.automatica = true;
      return r;
    }
  }

  // ---------------------------------------------------------------------
  // RevisionSolicitud: lo que ADM decide sobre una solicitud. MODELO EN
  // MEMORIA: no existe el almacen de solicitudes (adm.Solicitud, sin
  // aprobar), asi que nada de esto se guarda ni se envia por si solo.
  // ---------------------------------------------------------------------
  //   pendiente -> aprobada | rechazada (una sola vez).
  //   aprobar   devuelve los pares de "Modificar" (accion=modificar) para
  //             aplicar la solicitud con LA MISMA validacion del servidor
  //             (tope de 100%, fechas, Estado existente). 'otros' no tiene
  //             pares: ADM hace la correccion a mano con "Modificar".
  //   rechazar  exige motivo; no produce ningun cambio.
  class RevisionSolicitud {
    constructor(resumen, solicitante) {
      this.solicitud = resumen;
      this.solicitante = solicitante || null;
      this.estado = 'pendiente';
      this.revisor = null;
      this.motivoRechazo = '';
    }

    pares() {
      var s = this.solicitud;
      if (!s || s.automatica !== true) return null;
      var pares = [['accion', 'modificar'], ['folio', s.folio]];
      var c = campoCambio(s.campo);
      if (c && c.tipo === 'fecha') {
        if (!esCampoFecha(s.campo)) return null;
        pares.push([s.campo, s.nuevo]);
      } else if (c && c.tipo === 'estado') {
        pares.push(['estado', s.nuevo]);
      } else if (c && c.tipo === 'pct' && Array.isArray(s.categorias) && s.categorias.length) {
        // Los mismos pares que "Modificar" (CategoriasProblema.paresModificar).
        s.categorias.forEach(function (x) {
          if (x.nueva) pares.push(['agregar_categoria', x.categoria], ['agregar_pct', x.nuevo]);
          else pares.push(['pct_categoria', x.categoria], ['pct_valor', x.nuevo]);
        });
      } else if (c && c.tipo === 'datos' && Array.isArray(s.datos) && s.datos.length) {
        // Las claves de "Modificar" (titulo / po / so); '' = vaciar.
        s.datos.forEach(function (d) { pares.push([d.campo, d.nuevo]); });
      } else return null;
      return pares;
    }

    // -> { ok, mensaje, pares }
    aprobar(revisor) {
      if (this.estado !== 'pendiente') return { ok: false, mensaje: 'La solicitud ya fue ' + this.estado + '.', pares: null };
      if (!revisor) return { ok: false, mensaje: 'Falta quién aprueba.', pares: null };
      this.estado = 'aprobada';
      this.revisor = revisor;
      var pares = this.pares();
      return { ok: true, pares: pares, mensaje: pares
        ? 'Aprobada: el cambio se valida y se aplica como un «Modificar» de ADM.'
        : 'Aprobada: «Otros» no cambia nada por sí sola; ADM hace la corrección con «Modificar».' };
    }

    rechazar(revisor, motivo) {
      if (this.estado !== 'pendiente') return { ok: false, mensaje: 'La solicitud ya fue ' + this.estado + '.', pares: null };
      if (!revisor) return { ok: false, mensaje: 'Falta quién rechaza.', pares: null };
      if (!String(motivo || '').trim()) return { ok: false, mensaje: 'Explica por qué se rechaza.', pares: null };
      this.estado = 'rechazada';
      this.revisor = revisor;
      this.motivoRechazo = String(motivo).trim();
      return { ok: true, pares: null, mensaje: 'Rechazada: la iniciativa no cambia.' };
    }
  }

  // Una fila "rotulo: valor" de los datos del detalle (html: valor ya es HTML).
  function datoDetalle(rotulo, valor, html) {
    return '<div class="ini-dato"><dt>' + Escape.html(rotulo) + '</dt><dd>' +
      (html ? valor : Escape.html(texto(valor))) + '</dd></div>';
  }

  class VistaRegistro {
    constructor(doc) {
      this.doc = doc;
      this.registro = null;
      this.filtro = null;
      this.orden = null;          // null = orden por omision
      this.limite = PAGINA;
      this.cargaId = 0;
      this.abierta = null;        // folio en el detalle
      this.origenFoco = null;
      this.cambio = null;         // SolicitudCambio del detalle abierto
      this.cambioAbierto = false; // formulario de Solicitar cambios a la vista
      this.histAbierto = false;   // Historial de cambios desplegado
      // Cobertura: se pide la primera vez que se abre.
      this.modo = 'registro';     // registro | cobertura
      this.cobertura = null;      // Cobertura, ya cargada
      this.coberturaJson = null;  // su catalogo tal cual llego (actualizar)
      this.coberturaCarga = 0;    // descarta respuestas superadas
      this.coberturaPromesa = null;
      this.covFiltro = '';        // '' | con | sin
      this.busquedaPendiente = null; // espera de la caja de busqueda
      // Indicadores: el Registro con el que se pintaron (solo se repintan
      // si cambia) y el globo de ayuda de Activas (GloboAyuda, si esta).
      this.kpisDe = null;
      this.kpisElegido = '';
      this.globoKpis = null;
      // 'ADM' | 'MOD' | null (fijarRol). Solo ADM ve "Modificar"; null
      // hasta que SesionAdmin responda.
      this.rol = null;
      // Edicion directa de ADM: el borrador (EdicionAdmin) del detalle
      // abierto; con rol ADM existe siempre que hay detalle. Solo UX: el
      // servidor exige ADM en cada guardado (AccesoAdmin.ExigirAdm).
      this.edicion = null;
      this.edicionEnviando = false;
      // Texto de ADM (titulo, descripcion, observaciones) abierto como
      // editor; los demas se ven como texto normal. null = ninguno.
      this.editando = null;
      // "Descargar iniciativas" en curso: un segundo clic no arma otro libro.
      this.descargando = false;
      // Pregunta antes de descartar cambios sin guardar: (mensaje) -> bool.
      // null = window.confirm; sin forma de preguntar, no se descarta.
      this.confirmar = null;
      // Rutas del catalogo vigente (las fija la pagina al cargar el
      // catalogo): lo unico que "Modificar" puede agregar. null = sin cargar.
      this.rutasCatalogo = null;
      // Las de ADM (rutas_adm: todas las activas, con o sin dueños), solo
      // para "Modificar". null = el servidor no las mando: se usan las de
      // arriba. "Solicitar cambios" siempre usa rutasCatalogo.
      this.rutasAdmCatalogo = null;
      this.rutasEstado = 'cargando'; // cargando | ok | error (del catalogo de rutas)
      // PO / SO del mismo catalogo (los que ofrece el alta): { po, so }.
      this.duenosCatalogo = null;
      this.volumetria = null;     // VolumetriaCliente (perezoso)
      this.segCategoria = '';     // categoria elegida en Seguimiento
      // Acuse del PO / SO (admin/acuse-iniciativa.js, AcuseDetalle): lo
      // pone la pagina; null = sin acuse. Pinta en #regAcuse del detalle.
      this.acuse = null;
    }

    // estado: 'error' si el catalogo no se pudo cargar (rutas null).
    // rutasAdm: las de ADM para "Modificar" (opcional).
    fijarRutasCatalogo(rutas, estado, rutasAdm) {
      this.rutasCatalogo = Array.isArray(rutas) ? rutas : null;
      this.rutasAdmCatalogo = this.rutasCatalogo && Array.isArray(rutasAdm) ? rutasAdm : null;
      this.rutasEstado = this.rutasCatalogo ? 'ok' : estado === 'error' ? 'error' : 'cargando';
      if (this.edicion) {
        this.edicion.categorias.fijarRutas(this.rutasAdmCatalogo || this.rutasCatalogo);
        this.edicion.rutasEstado = this.rutasEstado;
        this.pintarCategoriasEdicion();
      }
      // Solicitar cambios abierto: solo el bloque de categorias (lo demas
      // escrito no se toca).
      if (this.cambio && this.cambioAbierto) {
        this.cambio.rutas = this.rutasCatalogo || [];
        this.cambio.rutasEstado = this.rutasEstado;
        this.pintarCategoriasCambio();
      }
    }

    // { po: [...], so: [...] } del catalogo (BorradorAdmin.valoresDe). Un
    // borrador abierto recibe las listas sin perder lo escrito.
    fijarDuenosCatalogo(duenos) {
      this.duenosCatalogo = duenos && Array.isArray(duenos.po) && Array.isArray(duenos.so) ? duenos : null;
      if (this.edicion && this.duenosCatalogo) {
        this.edicion.listas.pos = this.duenosCatalogo.po;
        this.edicion.listas.sos = this.duenosCatalogo.so;
        if (this.edicion.duenosYQuitar) { this.soltarFoco(); this.pintarEditables(); }
      }
      // El borrador de "Solicitar cambios" tambien: sus listas de PO / SO.
      if (this.cambio && this.duenosCatalogo) {
        this.cambio.pos = this.duenosCatalogo.po;
        this.cambio.sos = this.duenosCatalogo.so;
        var grupo = this.$('regCambioGrupoDatos');
        if (grupo && this.cambio.tipo() !== 'datos') grupo.innerHTML = this.htmlDatosCambio();
      }
    }

    // Solo la edicion de ADM la usa: volumetria TOTAL de la categoria
    // (el servidor la niega a cualquier otro rol).
    clienteVolumetria() {
      var A = window.IniciativaAdmin;
      if (!this.volumetria && A) {
        this.volumetria = new A.VolumetriaCliente(function (url, op) { return fetch(url, op); }, A.ALCANCE_TOTAL);
      }
      return this.volumetria;
    }

    // Lo calculado (tickets o %) de la fila n de "Modificar", en su <output>.
    pintarMetaEdicion(n) {
      var ed = this.edicion, caja = this.$('regEdCats'), f = ed && ed.categorias.filas[n];
      var el = f && caja && caja.querySelector ? caja.querySelector('[data-edicion-meta="' + n + '"]') : null;
      if (!el) return;
      var m = ed.categorias.meta(f);
      el.textContent = m.texto;
      el.className = 'ini-meta' + (m.mal ? ' mal' : '');
    }

    opcionesEstado() {
      var r = this.registro;
      // Subestado: solo ADM (el servidor ni lo manda a otro rol) y solo para
      // "Modificar"; "Solicitar cambios" nunca lo ofrece (SolicitudCambio).
      return { estados: r ? r.estadosProblem || [] : [], subestados: r && this.verSubestado() ? r.subestadosProblem || [] : [],
               tiposIniciativa: r ? r.valoresTipoIniciativa || [] : [], tiposAgrupado: r ? r.valoresTipoAgrupado || [] : [],
               rutas: this.rutasCatalogo || [], rutasEstado: this.rutasEstado,
               // Solicitar cambios de Título / PO / SO (sql/25).
               datos: !!(r && r.solicitudesDatos), pos: (this.duenosCatalogo || {}).po || [], sos: (this.duenosCatalogo || {}).so || [] };
    }

    // Solo UX: la edicion de ADM no llama al servidor en esta fase.
    fijarRol(rol) {
      this.rol = rol === 'ADM' || rol === 'MOD' ? rol : null;
      this.aplicarAlcance();
      if (!this.abierta) return;
      // La edicion directa aparece o se retira en su lugar; un borrador de
      // ADM se descarta si el rol deja de ser ADM.
      var i = this.registro && this.registro.buscar(this.abierta);
      this.soltarFoco();
      this.editando = null;
      if (this.puedeEditar() && !this.edicion && i) { this.edicion = this.nuevaEdicion(i); this.pintarEditables(); }
      else if (!this.puedeEditar() && this.edicion) { this.edicion = null; this.edicionEnviando = false; this.pintarEditables(); }
      this.pintarModo();
      var acciones = this.$('regDetAcciones');
      if (acciones) acciones.innerHTML = this.htmlAcciones();
    }

    // Rotulo de la barra del detalle: lo que el usuario puede hacer aqui.
    pintarModo() {
      var modo = this.$('regDetModo');
      if (modo) modo.textContent = this.edicion ? 'Edición directa (ADM)' : 'Solo lectura';
    }

    puedeEditar() { return this.rol === 'ADM' && !!window.IniciativaAdmin; }

    // El Subestado se muestra solo con rol ADM (2026-10-26). Solo UX: el
    // servidor no lo manda a otro rol (admin_iniciativas_registro.ashx).
    verSubestado() { return this.rol === 'ADM'; }

    // Opciones de los filtros segun el rol: ADM todo; cualquier otro (o sin
    // rol todavia), solo el catalogo vigente, que se pide si falta.
    aplicarAlcance() {
      var r = this.registro;
      if (!r) return;
      var completo = this.rol === 'ADM';
      if (r.alcanceCompleto() === completo && (completo || r.catalogo || this.coberturaPromesa)) return;
      r.fijarAlcance(completo);
      if (this.filtro) this.filtro.rearmar();
      this.refrescar();
      if (!completo && !r.catalogo && !this.coberturaPromesa) this.cargarCobertura();
    }

    $(id) { return this.doc.getElementById(id); }

    iniciar() {
      var self = this;
      this.cablear();
      // Globo de ayuda de los indicadores: el patron "Pregunta" de QARE
      // (assets/js/globo-ayuda.js). Escucha en #regKpis, que no se
      // reemplaza: las tarjetas se repintan dentro.
      var Globo = window.GloboAyuda;
      if (Globo) {
        this.globoKpis = new Globo(this.$('regKpis'), '.ini-kpi-ayuda', function (d) {
          return self.ayudaKpi(d.getAttribute('data-kpi-ayuda'));
        }).conectar();
      }
      this.cargar();
      return this;
    }

    // ---- eventos ----
    cablear() {
      var self = this;
      // Estado y Tipo de iniciativa: boton que abre un panel de casillas.
      Object.keys(MULTIS).forEach(function (clave) {
        var m = MULTIS[clave];
        self.$(m.boton).addEventListener('click', function () {
          if (self.filtro) self.abrirMulti(clave, self.$(m.panel).hidden);
        });
        self.$(m.panel).addEventListener('change', function (e) {
          var el = e.target;
          if (!self.filtro || !el || !el.getAttribute) return;
          var sel = self.seleccion(clave);
          if (el.getAttribute(m.attrTodas) !== null) sel.todas();
          else if (el.getAttribute(m.attrUno) !== null) sel.alternar(el.getAttribute(m.attrUno));
          else return;
          // El panel se repinta: el foco vuelve a la misma casilla.
          var panel = self.$(m.panel);
          var casillas = panel.querySelectorAll ? Array.prototype.slice.call(panel.querySelectorAll('input')) : [];
          var n = casillas.indexOf(el);
          self.refrescar();
          if (n >= 0 && panel.querySelectorAll) {
            var nueva = panel.querySelectorAll('input')[n];
            if (nueva && nueva.focus) nueva.focus();
          }
        });
      });
      this.doc.addEventListener('click', function (e) {
        Object.keys(MULTIS).forEach(function (clave) {
          var m = MULTIS[clave], campo = self.$(m.campo);
          if (!self.$(m.panel).hidden && campo.contains && !campo.contains(e.target)) self.abrirMulti(clave, false);
        });
      });
      this.$('regDirector').addEventListener('change', function (e) {
        if (!self.filtro) return;
        self.filtro.elegirDirector(e.target.value); self.refrescar();
      });
      SELECTS_ORG.forEach(function (id, nivel) {
        self.$(id).addEventListener('change', function (e) {
          if (!self.filtro) return;
          self.filtro.elegir(nivel, e.target.value); self.refrescar();
        });
      });
      // Busqueda: repinta un momento despues de la ultima tecla; Enter la
      // aplica ya y, si queda una sola iniciativa, abre su detalle.
      this.$('regBuscar').addEventListener('input', function () {
        clearTimeout(self.busquedaPendiente);
        self.busquedaPendiente = setTimeout(function () { self.aplicarBusqueda(); }, BUSQUEDA_ESPERA);
      });
      this.$('regBuscar').addEventListener('keydown', function (e) {
        if (e.key !== 'Enter') return;
        if (e.preventDefault) e.preventDefault();
        self.aplicarBusqueda();
        var lista = self.filtradas();
        if (lista.length === 1) self.abrirDesdeLista(lista[0].folio, self.$('regBuscar'));
      });
      this.$('regLimpiar').addEventListener('click', function () { self.limpiarFiltros(); });
      this.$('regLimpiarVacio').addEventListener('click', function () { self.limpiarFiltros(); });
      this.$('regMas').addEventListener('click', function () { self.limite += PAGINA; self.pintarTabla(); });
      this.$('regDescargar').addEventListener('click', function () { self.descargar(); });
      // Indicadores y semaforo: un clic filtra la lista por ese indicador y
      // otro en el mismo lo quita; Total lo quita. Son <button>: Enter y
      // espacio tambien. La franja "Criterio" no lleva data-indicador: no
      // filtra. Escucha delegada de SeleccionKpi.
      SeleccionKpi.escuchar(this.cajasIndicador(), ATRIBUTO_INDICADOR, function (k) { self.elegirIndicador(k); });
      this.$('regReintentar').addEventListener('click', function () { self.cargar(); });

      // Una fila se abre con su boton de folio o con un clic en la fila.
      this.$('regCuerpo').addEventListener('click', function (e) {
        var el = e.target;
        if (el && el.closest) el = el.closest('[data-folio]');
        var folio = el && el.getAttribute && el.getAttribute('data-folio');
        if (folio) self.abrirDesdeLista(folio, el);
      });
      this.$('regCabeza').addEventListener('click', function (e) {
        var el = e.target;
        if (el && el.closest) el = el.closest('[data-orden]');
        var col = el && el.getAttribute && el.getAttribute('data-orden');
        if (col) self.ordenarPor(col);
      });

      // Cobertura de categorias
      this.$('regVerRegistro').addEventListener('click', function () { self.verRegistro(); });
      this.$('regVerCobertura').addEventListener('click', function () { self.verCobertura(); });
      this.$('covFiltro').addEventListener('change', function (e) {
        self.covFiltro = e.target.value === 'con' || e.target.value === 'sin' ? e.target.value : '';
        if (self.cobertura) self.pintarCobertura();
      });
      this.$('covReintentar').addEventListener('click', function () { self.cargarCobertura(); });
      ['covCuerpo', 'covFuera'].forEach(function (id) {
        self.$(id).addEventListener('click', function (e) {
          var el = e.target;
          if (el && el.closest) el = el.closest('[data-folio]');
          var folio = el && el.getAttribute && el.getAttribute('data-folio');
          if (folio) self.abrirDesdeLista(folio, el);
        });
      });

      // Acciones dentro del detalle (se repinta al abrirlo: por delegacion).
      this.$('regDetCuerpo').addEventListener('click', function (e) {
        var el = e.target;
        if (el && el.closest) el = el.closest('[data-accion]');
        var accion = el && el.getAttribute && el.getAttribute('data-accion');
        if (accion) { self.accionDetalle(accion); return; }
        // Un texto de ADM mostrado como texto: un clic lo vuelve editor.
        var texto = e.target;
        if (texto && texto.closest) texto = texto.closest('[data-editar]');
        var clave = texto && texto.getAttribute && texto.getAttribute('data-editar');
        if (clave) { self.editarTexto(clave); return; }
        // Quitar una categoria agregada en "Solicitar cambios".
        var nueva = e.target;
        if (nueva && nueva.closest) nueva = nueva.closest('[data-cambio-quitar]');
        var nq = nueva && nueva.getAttribute && nueva.getAttribute('data-cambio-quitar');
        if (nq !== null && nq !== undefined && nq !== '') { self.quitarCategoriaCambio(Number(nq)); return; }
        // Quitar / Restaurar una categoria en "Modificar".
        var cat = e.target;
        if (cat && cat.closest) cat = cat.closest('[data-edicion-cat]');
        var op = cat && cat.getAttribute && cat.getAttribute('data-edicion-cat');
        if (op) self.accionCategoria(op, Number(cat.getAttribute('data-indice')));
      });
      this.$('regDetCuerpo').addEventListener('change', function (e) {
        if (e.target && e.target.id === 'regCambioCampo') self.elegirCampoCambio(e.target.value);
        else if (e.target && e.target.id === 'regCambioFechaCampo') self.elegirEtapaCambio(e.target.value);
        else if (e.target && e.target.id === 'regSegCategoria') self.elegirCategoriaSeguimiento(e.target.value);
        // Selects y fechas de "Modificar" y de "Solicitar cambios" (algunos
        // navegadores solo avisan con change).
        else self.capturarDetalle(e.target);
      });
      // Edicion de ADM y Solicitar cambios: actualizan su borrador en
      // memoria; nada se guarda.
      this.$('regDetCuerpo').addEventListener('input', function (e) {
        if (e.target && e.target.id === 'regSegCategoria') self.elegirCategoriaSeguimiento(e.target.value);
        else self.capturarDetalle(e.target);
      });
      // Salir del editor de un texto: vuelve a verse como texto (con lo
      // escrito, marcado si difiere de lo guardado).
      this.$('regDetCuerpo').addEventListener('focusout', function (e) {
        var clave = e.target && e.target.getAttribute && e.target.getAttribute('data-edicion');
        if (clave && clave === self.editando) self.terminarTexto();
      });
      // Enter o espacio sobre un texto mostrado lo abre (es un boton).
      this.$('regDetCuerpo').addEventListener('keydown', function (e) {
        var clave = e.target && e.target.getAttribute && e.target.getAttribute('data-editar');
        if (!clave || (e.key !== 'Enter' && e.key !== ' ')) return;
        if (e.preventDefault) e.preventDefault();
        self.editarTexto(clave);
      });
      this.$('regDetCerrar').addEventListener('click', function () { self.cerrarDetalle(); });
      this.$('regDetFondo').addEventListener('click', function () { self.cerrarDetalle(); });
      // Salir de la pagina con cambios sin guardar: el navegador pregunta.
      var ventana = this.doc.defaultView || (typeof window !== 'undefined' ? window : null);
      if (ventana && ventana.addEventListener) {
        ventana.addEventListener('beforeunload', function (e) {
          if (!self.hayCambiosSinGuardar()) return;
          if (e.preventDefault) e.preventDefault();
          e.returnValue = '';
        });
      }
      this.doc.addEventListener('keydown', function (e) {
        if (e.key !== 'Escape') return;
        if (self.abierta && self.editando) { self.terminarTexto(true); return; }
        if (self.abierta) { self.cerrarDetalle(); return; }
        Object.keys(MULTIS).forEach(function (clave) {
          var m = MULTIS[clave];
          if (self.$(m.panel).hidden) return;
          self.abrirMulti(clave, false);
          self.$(m.boton).focus();
        });
      });
    }

    limpiarFiltros() {
      if (!this.filtro) return;
      clearTimeout(this.busquedaPendiente);
      this.$('regBuscar').value = '';
      this.filtro.limpiar();
      // Limpiar tambien quita el orden por columna (cambiar UN filtro no).
      this.orden = null;
      this.refrescar();
    }

    // Lo escrito en la caja pasa al filtro, solo si cambio.
    aplicarBusqueda() {
      clearTimeout(this.busquedaPendiente);
      if (!this.filtro) return;
      var v = this.$('regBuscar').value || '';
      if (v === this.filtro.textoBuscado) return;
      this.filtro.buscar(v);
      this.refrescar();
    }

    // Las dos cajas cuyos botones son indicadores: tarjetas y semaforo.
    cajasIndicador() { return [this.$('regKpis'), this.$('regSemaforo')]; }
    // La SeleccionKpi del filtro (o una vacia, antes de la primera carga):
    // pone data-indicador, aria-pressed, las clases y el boton de cada
    // indicador.
    seleccionIndicador() {
      return this.filtro ? this.filtro.seleccion : new SeleccionKpi({ limpian: [INDICADOR_TODAS] });
    }
    // data-indicador y aria-pressed del boton de `k` (SeleccionKpi).
    atributosIndicador(k) { return this.seleccionIndicador().atributos(k); }

    // Clic en un indicador (ver la cabecera). Solo cambia la lista: las
    // tarjetas se repintan con las MISMAS cifras y el foco vuelve al boton
    // pulsado. Desde la Cobertura, vuelve a la lista para que se vea. La
    // cuenta de la lista (#regCuenta, aria-live) dice el indicador elegido:
    // es el aviso para lectores de pantalla, no la rejilla entera.
    elegirIndicador(k) {
      if (!this.filtro) return;
      var cambio = this.filtro.alternarIndicador(k);
      var desdeCobertura = this.modo === 'cobertura';
      if (desdeCobertura) this.mostrarModo('registro');
      if (cambio || desdeCobertura) this.refrescar();
      SeleccionKpi.enfocar(this.cajasIndicador(), ATRIBUTO_INDICADOR, k);
    }

    // Abrir uno cierra el otro.
    abrirMulti(clave, abrir) {
      var self = this;
      Object.keys(MULTIS).forEach(function (k) {
        var m = MULTIS[k], este = k === clave && abrir;
        if (k !== clave && !abrir) return;
        self.$(m.panel).hidden = !este;
        self.$(m.boton).setAttribute('aria-expanded', este ? 'true' : 'false');
      });
    }

    seleccion(clave) { return clave === 'estado' ? this.filtro.estados : this.filtro.tipos; }

    // El texto de una opcion: la Descripcion del catalogo para Tipo; el
    // propio valor para Estado.
    rotuloMulti(clave, v) { return clave === 'tipo' ? this.registro.nombreTipo(v) : v; }

    ordenarPor(col) {
      if (!COLUMNAS[col]) return;
      if (this.orden && this.orden.col === col) {
        // asc -> desc -> por omision (fecha de creacion)
        this.orden = this.orden.dir === 'asc' ? { col: col, dir: 'desc' } : null;
      } else {
        this.orden = { col: col, dir: 'asc' };
      }
      this.pintarTabla();
    }

    // ---- carga ----
    // `pedir` es fetch por omision; las pruebas le pasan uno propio.
    cargar(pedir) {
      var self = this;
      pedir = pedir || function (url) { return fetch(url, { cache: 'no-store' }); };
      var mia = ++this.cargaId;

      this.registro = null;
      this.filtro = null;
      this.cerrarDetalle(true);
      // La Cobertura cuelga del registro: se vuelve a pedir al reabrirla.
      this.cobertura = null;
      this.coberturaJson = null;
      this.coberturaPromesa = null;
      this.coberturaCarga++;
      this.mostrarModo('registro');
      this.estadoVista('cargando');

      return leerRegistro(pedir)
        .then(function (json) {
          if (mia !== self.cargaId) return;
          self.registro = Registro.desdeJson(json);
          self.registro.fijarAlcance(self.rol === 'ADM');
          // Todas, Cerrado incluido: ningun estado preseleccionado.
          self.filtro = new FiltroRegistro(self.registro);
          // Un Reintentar no borra lo ya escrito en la caja.
          self.filtro.buscar(self.$('regBuscar').value || '');
          self.orden = null;
          self.limite = PAGINA;
          self.estadoVista(self.registro.iniciativas.length ? 'listo' : 'sinDatos');
          self.refrescar();
          // Fuera de ADM las opciones salen del catalogo: se pide ya.
          if (!self.registro.alcanceCompleto()) self.cargarCobertura(pedir);
        })
        .catch(function (err) {
          if (mia !== self.cargaId) return;
          self.registro = null;
          self.filtro = null;
          self.$('regErrorTexto').textContent = (err && err.message) || 'No se pudo cargar el registro.';
          self.estadoVista('error');
        });
    }

    // cargando | error | sinDatos | listo. Cargando y error NO pintan
    // indicadores en 0 ni una tabla vacia: se ven como lo que son.
    estadoVista(estado) {
      var listo = estado === 'listo';
      this.$('regCargando').hidden = estado !== 'cargando';
      this.$('regError').hidden = estado !== 'error';
      this.$('regSinDatos').hidden = estado !== 'sinDatos';
      this.$('regContenido').hidden = !listo;
      this.$('regKpis').setAttribute('aria-busy', estado === 'cargando' ? 'true' : 'false');
      // La instruccion de los indicadores solo cuando se pueden usar.
      this.$('regKpisGuia').hidden = !listo;
      if (!listo) {
        if (this.globoKpis) this.globoKpis.ocultar();
        this.kpisDe = null;
        this.$('regKpis').innerHTML = estado === 'cargando' ? this.htmlKpisCargando() : '';
        this.$('regSemaforo').innerHTML = '';
        this.bloquearFiltros(estado === 'cargando' ? 'Cargando…' : '');
      }
    }

    bloquearFiltros(texto) {
      var self = this;
      ['regDirector'].concat(SELECTS_ORG).forEach(function (id) {
        var sel = self.$(id);
        Catalogos.llenar(sel, [], texto || '—');
        sel.disabled = true;
      });
      Object.keys(MULTIS).forEach(function (clave) {
        var m = MULTIS[clave];
        self.abrirMulti(clave, false);
        self.$(m.boton).textContent = texto || '—';
        self.$(m.boton).disabled = true;
        self.$(m.panel).innerHTML = '';
      });
    }

    // ---- pintado ----
    // Un cambio de filtro vuelve a la primera pagina; repintar no.
    refrescar() {
      this.limite = PAGINA;
      this.repintar();
    }

    repintar() {
      this.pintarFiltros();
      this.pintarTabla();
      if (this.modo === 'cobertura' && this.cobertura) this.pintarCobertura();
    }

    // ---- Cobertura de categorias ----
    mostrarModo(modo) {
      this.modo = modo === 'cobertura' ? 'cobertura' : 'registro';
      var cob = this.modo === 'cobertura', self = this;
      this.$('regListaBloque').hidden = cob;
      this.$('covSeccion').hidden = !cob;
      // La busqueda solo acota la lista: en la Cobertura no se ve ni cuenta.
      this.$('regBuscarCampo').hidden = cob;
      if (this.filtro) this.pintarCuentaFiltros();
      [['regVerRegistro', !cob], ['regVerCobertura', cob]].forEach(function (par) {
        self.$(par[0]).classList.toggle('activa', par[1]);
        self.$(par[0]).setAttribute('aria-pressed', par[1] ? 'true' : 'false');
      });
    }

    verRegistro() { this.mostrarModo('registro'); }

    // Abre la vista; el catalogo se pide solo la primera vez.
    verCobertura(pedir) {
      if (!this.registro) return Promise.resolve();
      this.mostrarModo('cobertura');
      if (this.cobertura) { this.pintarCobertura(); return Promise.resolve(); }
      return this.coberturaPromesa || this.cargarCobertura(pedir);
    }

    // `pedir` es fetch por omision; las pruebas le pasan uno propio.
    cargarCobertura(pedir) {
      var self = this, registro = this.registro;
      if (!registro) return Promise.resolve();
      pedir = pedir || function (url) { return fetch(url, { cache: 'no-store' }); };
      var mia = ++this.coberturaCarga;
      this.estadoCobertura('cargando');

      this.coberturaPromesa = Promise.resolve()
        .then(function () {
          return Promise.resolve(pedir(URL_CATALOGO)).catch(function () {
            throw new Error('No se pudo conectar con el servidor.');
          });
        })
        .then(function (r) {
          return r.json().catch(function () { return null; }).then(function (json) {
            if (!r.ok) throw new Error((json && json.error) || ('El servidor respondió ' + r.status + '.'));
            return json;
          });
        })
        .then(function (json) {
          if (mia !== self.coberturaCarga || registro !== self.registro) return;
          self.cobertura = Cobertura.desdeJson(json, registro);
          // actualizar() la rearma con este mismo catalogo sobre un registro
          // releido.
          self.coberturaJson = json;
          // Desde aqui la cascada compartida ofrece tambien las categorias
          // y dueños del catalogo.
          registro.ampliar(self.cobertura.filas);
          self.filtro.rearmar();
          self.estadoCobertura('listo');
          // Sin volver a la primera pagina: puede llegar despues de un
          // "mostrar mas" (o de un actualizar()).
          self.repintar();
        })
        .catch(function (err) {
          if (mia !== self.coberturaCarga) return;
          self.$('covErrorTexto').textContent = (err && err.message) || 'No se pudo cargar el catálogo de categorías.';
          self.estadoCobertura('error');
        })
        .then(function () { if (mia === self.coberturaCarga) self.coberturaPromesa = null; });
      return this.coberturaPromesa;
    }

    // cargando | error | listo
    estadoCobertura(estado) {
      this.$('covCargando').hidden = estado !== 'cargando';
      this.$('covError').hidden = estado !== 'error';
      this.$('covContenido').hidden = estado !== 'listo';
      this.$('covFiltro').disabled = estado !== 'listo';
    }

    // Todas las iniciativas activas de la categoria, una por renglon: con
    // varias no se escoge ninguna. Las rutas se ven si no son la categoria.
    htmlIniciativasCobertura(inis, categoria) {
      if (!inis.length) return '<span class="ini-tenue">—</span>';
      var self = this;
      return (inis.length > 1 ? '<span class="ini-sub ini-cov-varias">' + inis.length + ' iniciativas activas</span>' : '') +
        '<ul class="ini-cov-lista">' + inis.map(function (i) {
          var rutas = i.rutas.filter(function (r) { return r && r !== categoria; });
          return '<li><button type="button" class="ini-folio" data-folio="' + Escape.attr(i.folio) + '" aria-haspopup="dialog">' +
            Escape.html(i.folio) + '</button> ' + self.htmlEstado({ activa: true, estado: i.estado }) +
            '<span class="ini-cov-titulo">' + Escape.html(texto(i.titulo)) + '</span>' +
            (rutas.length ? '<span class="ini-sub ini-cat-ruta">' + rutas.map(function (r) { return Escape.html(r); }).join('<br>') + '</span>' : '') +
            '</li>';
        }).join('') + '</ul>';
    }

    htmlFilaCobertura(f) {
      var pill = f.cubierta ? '<span class="pill dentro">Con iniciativa activa</span>'
        : '<span class="pill vencido">Sin iniciativa activa</span>';
      return '<tr class="ini-fila ini-cov-fila' + (f.cubierta ? '' : ' ini-cov-sin') + '">' +
        '<td data-col="Categoría" class="ini-col-titulo ini-cat-ruta">' + Escape.html(f.categoria) + '</td>' +
        '<td data-col="Director" class="ini-col-persona">' + Escape.html(texto(f.director)) + '</td>' +
        '<td data-col="Product Owner" class="ini-col-persona">' + Escape.html(texto(f.po)) + '</td>' +
        '<td data-col="Service Owner" class="ini-col-persona">' + Escape.html(texto(f.so)) + '</td>' +
        '<td data-col="Estado de cobertura">' + pill + '</td>' +
        '<td data-col="Iniciativas activas" class="ini-cov-inis">' + this.htmlIniciativasCobertura(f.iniciativas, f.categoria) + '</td>' +
        '</tr>';
    }

    pintarCobertura() {
      if (!this.cobertura || !this.filtro) return;
      var r = this.cobertura.calcular(this.filtro), k = r.resumen, sel = this.covFiltro;
      var filas = r.filas.filter(function (f) { return !sel || (sel === 'con') === f.cubierta; });
      this.$('covFiltro').value = sel;

      this.$('covCuenta').textContent = fmt(k.categorias) + (k.categorias === 1 ? ' categoría' : ' categorías') +
        ' · ' + fmt(k.con) + ' con iniciativa activa · ' + fmt(k.sin) + ' sin iniciativa activa';

      var notas = ['Categorías vigentes del catálogo de dueños. Iniciativa activa: En Análisis, En Solución o En Monitoreo, de ' +
        this.registro.agrupadores.join(' · ') + ' (criterio de Experiencia). No mira volumen de tickets.'];
      if (k.omitidas) notas.push(fmt(k.omitidas) + (k.omitidas === 1 ? ' categoría vigente no aparece' : ' categorías vigentes no aparecen') +
        ': le falta Director, Product Owner o Service Owner en el catálogo.');
      if (k.sinCategoria) notas.push(fmt(k.sinCategoria) + (k.sinCategoria === 1 ? ' iniciativa activa no tiene' : ' iniciativas activas no tienen') +
        ' categoría: no cubren ninguna.');
      this.$('covNota').textContent = notas.join(' ');

      this.$('covVacio').hidden = filas.length > 0;
      this.$('covTablaCaja').hidden = filas.length === 0;
      var self = this;
      this.$('covCuerpo').innerHTML = filas.map(function (f) { return self.htmlFilaCobertura(f); }).join('');

      // Rutas con iniciativa activa que no caen en ninguna categoria vigente
      // del catalogo: a la vista, no descartadas.
      var fuera = this.$('covFuera');
      fuera.hidden = r.fuera.length === 0;
      fuera.innerHTML = r.fuera.length ? '<h4 class="ini-cov-fuera-tit">Iniciativas activas fuera del catálogo vigente (' + fmt(r.fuera.length) +
        (r.fuera.length === 1 ? ' ruta' : ' rutas') + ')</h4>' +
        '<p class="ini-nota">Su ruta no cuelga de una categoría vigente del catálogo de dueños (sin fila propia para su C1&amp;C2, o dada de baja). No cuentan en la cobertura de arriba.</p>' +
        '<div class="ini-tabla-caja"><table class="ini-tabla ini-cov-tabla"><caption class="ini-sr">Rutas con iniciativa activa fuera del catálogo.</caption>' +
        '<thead><tr><th scope="col"><span class="ini-th">Ruta</span></th><th scope="col"><span class="ini-th">Product Owner</span></th>' +
        '<th scope="col"><span class="ini-th">Service Owner</span></th><th scope="col"><span class="ini-th">Iniciativas activas</span></th></tr></thead><tbody>' +
        r.fuera.map(function (x) {
          return '<tr class="ini-fila ini-cov-fila"><td data-col="Ruta" class="ini-col-titulo ini-cat-ruta">' + Escape.html(x.ruta) + '</td>' +
            '<td data-col="Product Owner" class="ini-col-persona">' + Escape.html(texto(x.po)) + '</td>' +
            '<td data-col="Service Owner" class="ini-col-persona">' + Escape.html(texto(x.so)) + '</td>' +
            '<td data-col="Iniciativas activas" class="ini-cov-inis">' + self.htmlIniciativasCobertura(x.iniciativas, x.ruta) + '</td></tr>';
        }).join('') + '</tbody></table></div>' : '';
    }

    filtradas() {
      return this.filtro ? this.filtro.aplicar(this.registro.iniciativas) : [];
    }

    pintarFiltros() {
      var f = this.filtro, r = this.registro;
      this.pintarMulti('estado');
      this.pintarMulti('tipo');
      this.pintarSelect('regDirector', r.directores(), f.director, 'Todos');
      var self = this;
      f.cascada.estado(true, '').forEach(function (e, i) {
        self.pintarSelect(SELECTS_ORG[i], e.opciones, e.valor, i === 2 ? 'Todas' : 'Todos');
      });
      this.$('regBuscar').disabled = false;
      this.pintarCuentaFiltros();
    }

    pintarCuentaFiltros() {
      var f = this.filtro;
      // La busqueda y el indicador solo acotan la lista: en la Cobertura no
      // cuentan.
      var n = f.activos() - (this.modo === 'cobertura' ? (f.busquedaActiva() ? 1 : 0) + (f.indicador ? 1 : 0) : 0);
      this.$('regLimpiar').hidden = n === 0;
      this.$('regFiltrosCuenta').textContent = n ? (n === 1 ? '1 filtro activo' : n + ' filtros activos') : '';
    }

    // Casillas: "Todas/Todos" arriba y una opcion por renglon. Esa casilla
    // va marcada solo con todo marcado; el boton dice lo elegido (o que no
    // hay nada).
    pintarMulti(clave) {
      var m = MULTIS[clave], sel = this.seleccion(clave), self = this;
      var todos = sel.opciones();
      var marcados = sel.lista();
      var nombres = marcados.map(function (v) { return self.rotuloMulti(clave, v); });
      var todas = sel.todosMarcados();
      var boton = this.$(m.boton);
      boton.disabled = todos.length === 0;
      boton.textContent = todas ? m.textoTodas
        : marcados.length === 0 ? 'Ninguno'
        : marcados.length === 1 ? nombres[0] : marcados.length + ' de ' + todos.length + ' ' + m.plural;
      boton.setAttribute('title', todas ? '' : marcados.length ? nombres.join(', ') : m.ninguno);
      boton.classList.toggle('con-valor', !todas);
      function casilla(attr, valor, rotulo, marcada, clase) {
        return '<label class="ini-multi-op' + (clase ? ' ' + clase : '') + (marcada ? ' marcada' : '') + '">' +
          '<input type="checkbox" ' + attr + '="' + Escape.attr(valor) + '"' + (marcada ? ' checked' : '') + '>' +
          '<span>' + Escape.html(rotulo) + '</span></label>';
      }
      this.$(m.panel).innerHTML = casilla(m.attrTodas, '', m.rotuloTodas, todas, 'ini-multi-todas') +
        todos.map(function (t) { return casilla(m.attrUno, t, self.rotuloMulti(clave, t), marcados.indexOf(t) >= 0, ''); }).join('');
    }

    pintarSelect(id, opciones, valor, todos) {
      var sel = this.$(id);
      Catalogos.llenar(sel, opciones, '— ' + todos + ' —');
      sel.value = valor || '';
      sel.disabled = opciones.length === 0;
    }

    htmlKpisCargando() {
      return ROTULOS_KPI.map(function (l) {
        return '<div class="kpi ini-kpi-cargando"><div class="lbl">' + Escape.html(l) + '</div>' +
          '<div class="val">…</div><div class="foot">Cargando…</div></div>';
      }).join('');
    }

    // Texto del globo de un indicador (data-kpi-ayuda), o null. El de
    // Activas se arma con estados_activos y agrupadores del servidor: si
    // el criterio cambia alli, el texto cambia solo. El de Requerimientos
    // es el que antes iba en el title de su tarjeta.
    ayudaKpi(clave) {
      if (clave === 'requerimientos') {
        return {
          texto: 'Requerimientos (REQ/HAR): abiertos, estado distinto de Cerrado, con agrupación ReqOpr.',
          nota: 'Cuentan en Total, no en ' + ROTULOS_KPI[1] + '.'
        };
      }
      if (clave !== 'activas' || !this.registro) return null;
      var estados = this.registro.estadosActivos, agr = this.registro.agrupadores;
      if (!estados.length || !agr.length) return null;
      return {
        texto: 'Iniciativas en estado ' + enumerar(estados) + ' y con agrupación ' + enumerar(agr) + '.',
        nota: 'Es el criterio de la tabla Activas de Experiencia. Incluye las que no tienen categoría.'
      };
    }

    // Sobre el registro COMPLETO: los filtros, la busqueda y el indicador
    // elegido no los mueven. Solo se repintan si cambio el registro (carga
    // o relectura) o el indicador elegido (su marca; las cifras son las
    // mismas).
    pintarKpis() {
      var elegido = this.filtro ? this.filtro.indicador : '';
      if (this.kpisDe === this.registro && this.kpisElegido === elegido) return;
      if (this.globoKpis) this.globoKpis.ocultar();
      this.kpisDe = this.registro;
      this.kpisElegido = elegido;
      var k = Registro.indicadores(this.registro.iniciativas);
      var tarjetas = [
        { k: CLAVES_KPI[0], l: ROTULOS_KPI[0], v: k.total,
          f: k.sinCategoria ? fmt(k.sinCategoria) + ' Sin categoría' : 'Todas con categoría', s: '',
          t: 'Iniciativas abiertas: estado distinto de Cerrado. Un clic quita el indicador elegido.' },
        { k: CLAVES_KPI[1], l: ROTULOS_KPI[1], v: k.activas, f: fmt(k.reduceActivas) + ' Tickets a reducir', s: 'sv', ayuda: this.ayudaKpi(CLAVES_KPI[1]) },
        { k: CLAVES_KPI[2], l: ROTULOS_KPI[2], v: k.requerimientos, f: 'REQ, RTI y HAR', s: '',
          ayuda: this.ayudaKpi(CLAVES_KPI[2]) },
        { k: CLAVES_KPI[3], l: ROTULOS_KPI[3], v: k.retrasadas, f: fmt(k.riesgo) + ' Tickets en riesgo', s: k.retrasadas ? 'sa' : 'sv',
          t: 'Iniciativas medibles con la fecha de su estado vencida y con categoría (criterio de Experiencia).' },
        { k: CLAVES_KPI[4], l: ROTULOS_KPI[4], v: k.cerradas, f: 'Estado Cerrado', s: '',
          t: 'Iniciativas en estado Cerrado.' }
      ];
      var conGlobo = !!this.globoKpis, seleccion = this.seleccionIndicador();
      this.$('regKpis').innerHTML = tarjetas.map(function (c) {
        var boton = '';
        if (c.ayuda) {
          // La franja "Criterio" (como "Pregunta" en QARE); el texto va
          // tambien oculto en la tarjeta para lectores de pantalla.
          var todo = c.ayuda.texto + ' ' + c.ayuda.nota;
          var id = 'regKpiAyuda' + c.k.charAt(0).toUpperCase() + c.k.slice(1);
          boton = '<button type="button" class="ini-kpi-ayuda" data-kpi-ayuda="' + c.k + '" aria-describedby="' + id + '"' +
            ' aria-label="Criterio de ' + Escape.attr(c.l) + '"' + (conGlobo ? '' : ' title="' + Escape.attr(todo) + '"') + '>Criterio</button>' +
            '<span class="ini-sr" id="' + id + '">' + Escape.html(todo) + '</span>';
        }
        // El filtro es un boton que cubre la tarjeta (debajo de "Criterio",
        // que no filtra): sin botones anidados. Lleva el title de la
        // tarjeta porque queda encima de ella. Total no lleva aria-pressed
        // ni se marca (SeleccionKpi: es la accion de ver todas, no un
        // estado). Clases y boton son los de SeleccionKpi, como en las
        // demas pestañas.
        var filtro = seleccion.boton(c.k, c.l + ': ' + fmt(c.v), c.t);
        return '<div class="kpi ini-kpi ' + c.s + (boton ? ' ini-kpi-ctx' : '') + seleccion.clases(c.k) + '">' + boton +
          '<div class="lbl">' + Escape.html(c.l) + '</div>' +
          '<div class="val">' + fmt(c.v) + '</div>' +
          '<div class="foot">' + Escape.html(c.f) + '</div>' + filtro + '</div>';
      }).join('');
      this.pintarSemaforo(elegido);
    }

    // Una linea compacta: punto, rotulo y cuenta por categoria. Cada una es
    // un boton que filtra la lista (indicador 'sem_' + clave). La elegida se
    // pinta aunque se quede en cero tras una relectura, para poder quitarla.
    pintarSemaforo(elegido) {
      var n = Registro.semaforo(this.registro.iniciativas), self = this;
      this.$('regSemaforo').innerHTML = SEMAFORO.filter(function (s) {
        return !s.siHay || n[s.k] > 0 || PREFIJO_SEMAFORO + s.k === elegido;
      }).map(function (s) {
        var k = PREFIJO_SEMAFORO + s.k, sel = k === elegido;
        return '<button type="button" class="ini-semaforo-op' + (sel ? ' sel' : '') + '" data-semaforo="' + s.k + '"' +
          self.atributosIndicador(k) + ' title="' + Escape.attr(s.t) + '">' +
          '<span class="ini-sem ' + s.c + '" aria-hidden="true"></span>' + Escape.html(s.l) +
          ' <b>' + fmt(n[s.k]) + '</b></button>';
      }).join('');
    }

    pintarCabeza() {
      var orden = this.orden;
      // Mismo orden que las celdas de htmlFila: lo de la iniciativa primero,
      // los dueños al final.
      var cols = [
        { c: 'folio', t: 'Código' }, { c: 'titulo', t: 'Título' }, { c: 'estado', t: 'Estado' },
        { c: 'agrup', t: 'Agrupación' }, { c: 'edad', t: 'Antigüedad', num: true },
        { c: 'reduce', t: 'Tickets a reducir', num: true },
        { c: 'fecha', t: 'Fecha compromiso' }, { c: 'so', t: 'Service Owner' }, { c: 'po', t: 'Product Owner' }
      ];
      this.$('regCabeza').innerHTML = '<tr>' + cols.map(function (x) {
        var activa = orden && orden.col === x.c;
        var aria = activa ? (orden.dir === 'asc' ? 'ascending' : 'descending') : 'none';
        var flecha = activa ? '<span class="ord" aria-hidden="true">' + (orden.dir === 'asc' ? '▲' : '▼') + '</span>' : '';
        return '<th scope="col"' + (x.num ? ' class="num"' : '') + ' aria-sort="' + aria + '">' +
          '<button type="button" class="ini-orden" data-orden="' + x.c + '">' + Escape.html(x.t) + flecha + '</button></th>';
      }).join('') + '</tr>';
    }

    // El PO / SO capturado de la iniciativa (no los de sus categorias).
    htmlDuenos(i, clave) {
      var v = duenoCapturado(i, clave);
      return v ? Escape.html(v) : '<span class="ini-tenue">—</span>';
    }

    htmlEstado(i) {
      var clase = i.activa ? 'dentro' : 'neutro';
      return '<span class="pill ' + clase + '">' + Escape.html(texto(i.estado)) + '</span>';
    }

    // Punto del semaforo + la fecha del estado actual. Atrasada
    // (fecha_retrasada): fecha en ambar y, debajo en la misma celda, la
    // palabra; sin pintar la fila entera.
    // El color del punto de una activa es el de su categoria del semaforo
    // (COLOR_SEMAFORO: Sin fecha rojo, Atrasada ambar, En tiempo verde, Sin
    // control gris). Solo cambia el color: la clasificacion es la misma
    // (semaforoFecha) y los textos no se tocan. Las no activas conservan el
    // color del servidor (sem_fecha 'verde': sin compromiso vigente).
    htmlPunto(i) {
      var k = Registro.semaforoFecha(i);
      var sem = k ? COLOR_SEMAFORO[k]
        : i.sem_fecha === 'rojo' || i.sem_fecha === 'ambar' || i.sem_fecha === 'verde' ? i.sem_fecha : '';
      return sem ? '<span class="ini-sem ' + sem + '" aria-hidden="true"></span>' : '';
    }

    htmlCompromiso(i) {
      var f = fechaCompromiso(i);
      var punto = this.htmlPunto(i);
      if (!i.activa) return punto + '<span class="ini-tenue">—</span>';
      if (i.fecha_retrasada) {
        return punto + '<b class="ini-vencida">' + Escape.html(fecha(f)) + '</b><span class="ini-retraso">Atrasada</span>';
      }
      // Sin control de fecha (REQ/RTI) y sin fecha: lo mismo que dice el
      // semaforo, no "Sin fecha".
      if (!f && i.control_fecha === false) return punto + '<span class="ini-tenue">Sin control de fecha</span>';
      return punto + Escape.html(f ? fecha(f) : 'Sin fecha');
    }

    // Columna Antigüedad: la edad desde la creacion (diasDesdeCreacion) en
    // dias, para comparar filas de un vistazo; la unica en la fila (el
    // Codigo ya no la repite como "Hace N días"). El title (y la Antigüedad
    // del detalle) lo dicen en meses / semanas / dias.
    htmlAntiguedad(i) {
      var dias = diasDesdeCreacion(i);
      return dias === null ? '<span class="ini-tenue">—</span>' : Escape.html(fmt(dias) + (dias === 1 ? ' día' : ' días'));
    }

    atributosAntiguedad(i) {
      var dias = diasDesdeCreacion(i);
      return dias === null ? '' : ' title="' + Escape.attr(Duracion.dias(dias)) + '"';
    }

    htmlFila(i) {
      var folio = Escape.attr(i.folio);
      var cats = i.sin_categoria ? '<span class="ini-sub ini-sin-cat">Sin categoría</span>'
        : '<span class="ini-sub">' + i.categorias.length + (i.categorias.length === 1 ? ' categoría' : ' categorías') + '</span>';
      return '<tr class="ini-fila" data-folio="' + folio + '">' +
        '<td data-col="Código"><button type="button" class="ini-folio" data-folio="' + folio + '"' +
          ' aria-haspopup="dialog">' + Escape.html(i.folio) + '</button></td>' +
        '<td data-col="Título" class="ini-col-titulo"><span class="ini-titulo" title="' + Escape.attr(i.titulo || '') + '">' +
          Escape.html(texto(i.titulo)) + '</span>' + cats + '</td>' +
        '<td data-col="Estado">' + this.htmlEstado(i) + '</td>' +
        '<td data-col="Agrupación">' + (i.agrup ? '<span class="chip ini-chip">' + Escape.html(i.agrup) + '</span>' : '<span class="ini-tenue">—</span>') + '</td>' +
        '<td data-col="Antigüedad" class="num ini-edad"' + this.atributosAntiguedad(i) + '>' + this.htmlAntiguedad(i) + '</td>' +
        '<td data-col="Tickets a reducir" class="num">' + fmt(i.tickets_reduce) + '</td>' +
        '<td data-col="Fecha compromiso" class="fecha-cell">' + this.htmlCompromiso(i) + '</td>' +
        '<td data-col="Service Owner" class="ini-col-persona">' + this.htmlDuenos(i, 'so') + '</td>' +
        '<td data-col="Product Owner" class="ini-col-persona">' + this.htmlDuenos(i, 'po') + '</td>' +
        '</tr>';
    }

    pintarTabla() {
      if (!this.registro) return;
      var lista = this.filtradas();
      this.pintarKpis();
      this.pintarCabeza();

      var vacio = lista.length === 0;
      this.$('regVacio').hidden = !vacio;
      if (vacio) this.$('regVacioTexto').textContent = this.textoVacio();
      this.$('regTablaCaja').hidden = vacio;

      var orden = ordenar(lista, this.orden);
      var visibles = orden.slice(0, this.limite);
      var self = this;
      this.$('regCuerpo').innerHTML = visibles.map(function (i) { return self.htmlFila(i); }).join('');

      // Total = el registro completo, no la pagina ni lo filtrado. Con
      // Cerrado fuera del filtro de Estado: las abiertas que pasan los
      // filtros (esCerrada, como el indicador) frente a ese total.
      var total = this.registro.iniciativas.length;
      var indicador = this.filtro.indicador;
      var abiertas = lista.filter(function (i) { return !esCerrada(i); }).length;
      this.$('regCuenta').textContent = vacio ? '' :
        (this.filtro.excluyeCerradas() ? fmt(abiertas) + ' Abiertas de ' + fmt(total) + ' Total'
          : lista.length === total ? fmt(total) + ' iniciativas' : fmt(lista.length) + ' de ' + fmt(total) + ' iniciativas') +
        (indicador ? ' · indicador: ' + rotuloIndicador(indicador) : '') +
        (visibles.length < lista.length ? ' · mostrando ' + fmt(visibles.length) : '');
      var quedan = lista.length - visibles.length;
      this.$('regMas').hidden = quedan <= 0;
      this.$('regMas').textContent = 'Mostrar ' + fmt(Math.min(PAGINA, quedan)) + ' más';
      // Sin iniciativas que exportar, el boton no se ofrece.
      this.$('regDescargar').disabled = vacio || this.descargando;
    }

    // "⬇ Descargar iniciativas": el .xlsx de lo que hoy pasa los filtros y
    // la busqueda, COMPLETO y en el orden de la tabla (ExportRegistro). Solo
    // lee: no toca filtro, orden, pagina ni detalle, y no pide nada al
    // servidor. `cargar` (-> Promise de XLSX), `bajar` (bytes, nombre) y
    // `hoy` son para las pruebas; por omision SheetJS, un <a download> y
    // la fecha local. `pedir` (fetch por omision) trae ?export=1: si falla,
    // no hay Excel (mensaje), nunca uno sin esas columnas.
    descargar(cargar, bajar, hoy, pedir) {
      if (this.descargando || !this.registro || !this.filtro) return Promise.resolve(false);
      var self = this, btn = this.$('regDescargar'), msg = this.$('regDescargaMsg');
      var lista = ordenar(this.filtradas(), this.orden);
      msg.hidden = true;
      msg.textContent = '';
      if (!lista.length) {
        msg.textContent = 'No hay iniciativas que coincidan con los filtros: no hay nada que descargar.';
        msg.hidden = false;
        return Promise.resolve(false);
      }
      var registro = this.registro;
      // Sin ningun filtro (ni busqueda ni indicador) sale el registro
      // completo (900+): se avisa antes. Cancelar no deja mensaje. Sin forma
      // de preguntar, se sigue: es un aviso, no se pierde nada.
      if (this.filtro.activos() === 0) {
        var preguntar = this.confirmar ||
          (typeof window !== 'undefined' && typeof window.confirm === 'function' ? function (m) { return window.confirm(m); } : null);
        if (preguntar && !preguntar('No hay filtros aplicados: se descargarán las ' + fmt(lista.length) +
            ' iniciativas del registro completo. ¿Continuar?')) return Promise.resolve(false);
      }
      var filtrado = lista.length < registro.iniciativas.length;
      var rotulo = btn.textContent;
      this.descargando = true;
      btn.disabled = true;
      btn.textContent = 'Preparando…';
      return Promise.resolve()
        .then(function () {
          return Promise.all([
            leerRegistro(pedir || function (url) { return fetch(url, { cache: 'no-store' }); }, URL_EXPORT),
            (cargar || cargarXLSX)()
          ]);
        })
        .then(function (r) {
          var extra = ExportRegistro.indiceExtra(r[0]), XLSX = r[1];
          if (!XLSX || !window.LibroIniciativas) throw new Error('no se pudo cargar el generador de Excel.');
          var bytes = window.LibroIniciativas.construir(XLSX, ExportRegistro.hojas(lista, registro, extra, self.verSubestado()));
          (bajar || bajarArchivo)(bytes, ExportRegistro.nombre(hoy || new Date(), filtrado));
          return true;
        })
        .catch(function (err) {
          if (typeof console !== 'undefined') console.error('[Iniciativas descarga]', err);
          msg.textContent = 'No se pudo descargar el Excel: ' + ((err && err.message) || 'error desconocido.');
          msg.hidden = false;
          return false;
        })
        .then(function (r) {
          self.descargando = false;
          btn.textContent = rotulo;
          btn.disabled = !self.registro || self.filtradas().length === 0;
          return r;
        });
    }

    textoVacio() {
      var f = this.filtro;
      if (f.indicador) {
        // Los demas filtros activos, sin la busqueda ni el indicador.
        var otros = f.activos() - 1 - (f.busquedaActiva() ? 1 : 0);
        var partes = (f.busquedaActiva() ? ['«' + f.textoBuscado.trim() + '»'] : [])
          .concat(['el indicador «' + rotuloIndicador(f.indicador) + '»'])
          .concat(otros > 0 ? ['los filtros seleccionados'] : []);
        return 'No hay iniciativas que coincidan con ' +
          (partes.length > 1 ? partes.slice(0, -1).join(', ') + ' y ' + partes[partes.length - 1] : partes[0]) + '.';
      }
      if (!f.busquedaActiva()) return 'No hay iniciativas que coincidan con los filtros seleccionados.';
      var buscado = '«' + f.textoBuscado.trim() + '»';
      return f.activos() > 1
        ? 'No hay iniciativas que coincidan con ' + buscado + ' y los filtros seleccionados.'
        : 'No hay iniciativas que coincidan con ' + buscado + '.';
    }

    // ---- detalle ----
    abrirDetalle(folio, origen) {
      var i = this.registro && this.registro.buscar(folio);
      if (!i) return;
      this.abierta = folio;
      this.origenFoco = origen || null;
      this.$('regDetTitulo').textContent = i.folio;
      this.cambio = new SolicitudCambio(i, this.opcionesEstado());
      this.cambioAbierto = false;
      this.histAbierto = false;
      this.edicionEnviando = false;
      this.soltarFoco();
      this.editando = null;
      this.edicion = this.puedeEditar() ? this.nuevaEdicion(i) : null;
      this.segCategoria = '';
      this.$('regDetCuerpo').innerHTML = this.htmlDetalle(i);
      this.montarSelectorCategorias();
      this.$('regDetFondo').hidden = false;
      this.$('regDetalle').hidden = false;
      this.marcarRaiz(true);
      this.pintarModo();
      this.volumetriaEdicion();
      if (this.acuse) this.acuse.mostrar(i, this.$('regAcuse'));
      var cerrar = this.$('regDetCerrar');
      if (cerrar && cerrar.focus) cerrar.focus();
    }

    // Una fila, la busqueda o "Crear > existente" abren un detalle: con
    // cambios sin guardar en el abierto, primero se pregunta.
    abrirDesdeLista(folio, origen) {
      if (this.abierta && !this.soltarCambios()) return false;
      this.abrirDetalle(folio, origen);
      return this.abierta === folio;
    }

    // Deja el panel oculto; el foco solo vuelve si estaba abierto. Con
    // cambios sin guardar pregunta antes (salvo forzar: recarga del
    // registro o acceso retirado) y, si no se descartan, no cierra.
    // -> true si quedo cerrado.
    cerrarDetalle(forzar) {
      if (!forzar && this.abierta && !this.soltarCambios()) return false;
      var estaba = !!this.abierta;
      this.abierta = null;
      this.cambio = null;
      this.edicion = null;
      this.$('regDetalle').hidden = true;
      this.$('regDetFondo').hidden = true;
      this.marcarRaiz(false);
      var origen = this.origenFoco;
      this.origenFoco = null;
      if (!estaba) return true;
      // El boton del folio de esa fila; si la fila ya no esta, nada.
      if (origen && origen.focus && origen.isConnected !== false) {
        var boton = origen.querySelector ? origen.querySelector('.ini-folio') : null;
        (boton || origen).focus();
      }
      return true;
    }

    // Hay algo escrito que difiere de lo guardado (y no se esta enviando:
    // lo que viaja ya no es un borrador que se pierda al cerrar).
    hayCambiosSinGuardar() {
      return !!(this.edicion && !this.edicionEnviando && this.edicion.cambios().length);
    }

    // -> true si se puede seguir (no hay cambios, o el usuario los descarta).
    soltarCambios() {
      if (!this.hayCambiosSinGuardar()) return true;
      var preguntar = this.confirmar ||
        (typeof window !== 'undefined' && typeof window.confirm === 'function' ? function (m) { return window.confirm(m); } : null);
      var n = this.edicion.cambios().length;
      return !!(preguntar && preguntar('Hay ' + n + (n === 1 ? ' cambio' : ' cambios') + ' sin guardar en ' +
        this.abierta + '. ¿Descartarlos?'));
    }

    // ---- Solicitar cambios / Historial ----
    accionDetalle(accion) {
      if (!this.abierta) return;
      if (accion === 'solicitar-cambios') this.abrirCambio(!this.cambioAbierto);
      else if (accion === 'cambio-cancelar') this.abrirCambio(false);
      else if (accion === 'cambio-preparar') this.prepararCambio();
      else if (accion === 'historial') this.plegarHistorial();
      else if (accion === 'editar-admin') this.abrirEdicion(true);
      else if (accion === 'edicion-cancelar') this.abrirEdicion(false);
      else if (accion === 'edicion-revisar') this.revisarEdicion();
      else if (accion === 'edicion-guardar') this.guardarEdicion();
      else if (accion === 'recargar-guardado') this.recargarTrasGuardar(this.abierta, null, null, this.edicion);
      else if (accion === 'edicion-cat-agregar') this.agregarCategoriaEdicion();
      else if (accion === 'cambio-cat-agregar') this.agregarCategoriaCambio();
    }

    // Un control del detalle -> su borrador (Modificar o Solicitar cambios).
    // -> true si lo tomo.
    capturarDetalle(t) {
      if (!t || !t.getAttribute) return false;
      var ed = this.edicion, c = this.cambio;
      var clave = t.getAttribute('data-edicion');
      var n = t.getAttribute('data-edicion-pct');
      var cp = t.getAttribute('data-cambio-pct');
      var cn = t.getAttribute('data-cambio-nueva-pct');
      var tipo = t.getAttribute('data-edicion-tipo');   // "indice|campo"
      var fcat = t.getAttribute('data-edicion-fcat');
      var tk = t.getAttribute('data-edicion-tickets');
      var modo = t.getAttribute('data-edicion-modo');
      // Mientras se envia, los controles estan deshabilitados; nada cambia.
      if (ed && this.edicionEnviando && (clave || n !== null || tipo || fcat !== null || tk !== null || modo !== null)) return true;
      // "Planear la meta por": solo cambia que se edita (repinta la tabla).
      if (ed && modo !== null && modo !== undefined) {
        if (t.checked !== false && ed.elegirModo(t.value)) { this.soltarFoco(); this.pintarCategoriasEdicion(); }
        return true;
      }
      if (ed && clave) ed.capturar(clave, t.value);
      // % o tickets de una fila: se repinta solo lo CALCULADO de esa fila,
      // nunca la casilla en la que se escribe.
      else if (ed && n !== null && n !== undefined) { ed.capturarPct(Number(n), t.value); this.pintarMetaEdicion(Number(n)); }
      else if (ed && tk !== null && tk !== undefined) { ed.capturarTickets(Number(tk), t.value); this.pintarMetaEdicion(Number(tk)); }
      else if (ed && tipo) ed.capturarTipo(Number(tipo.split('|')[0]), tipo.split('|')[1], t.value);
      else if (ed && fcat !== null && fcat !== undefined) ed.capturarFechaCategoria(Number(fcat), t.value);
      else if (c && cp !== null && cp !== undefined) { c.fijarPct(c.categoriasLigadas()[Number(cp)], t.value); return true; }
      else if (c && cn !== null && cn !== undefined) { c.capturarPctNueva(Number(cn), t.value); return true; }
      else return false;
      this.pintarEstadoEdicion(t);
      return true;
    }

    // ---- categorias de "Solicitar cambios" ----
    agregarCategoriaCambio(texto) {
      var c = this.cambio;
      if (!c) return null;
      if (texto === undefined) { var caja = this.$('regCambioCatBuscar'); texto = caja ? caja.value : ''; }
      var r = c.agregarCategoria(texto);
      if (r.ok) this.pintarCategoriasCambio();
      var msg = this.$('regCambioCatMsg');
      if (msg) {
        msg.className = 'ini-cambio-msg' + (r.ok ? '' : ' error');
        msg.textContent = r.ok ? '' : r.mensaje;
      }
      return r;
    }

    quitarCategoriaCambio(n) {
      if (!this.cambio || !this.cambio.quitarNueva(n)) return false;
      this.pintarCategoriasCambio();
      return true;
    }

    // Repinta SOLO el bloque de categorias: Que cambiar, Motivo y lo demas
    // escrito se quedan como estan.
    pintarCategoriasCambio() {
      var caja = this.$('regCambioGrupoPct');
      if (caja && this.cambio) caja.innerHTML = this.htmlCategoriasCambio();
    }

    htmlCategoriasCambio() {
      var c = this.cambio, A = window.IniciativaAdmin;
      var ligadas = c.categoriasLigadas();
      var tabla = ligadas.length || c.nuevas.length
        ? '<div class="ini-det-tabla"><table class="ini-cats-tabla"><thead><tr><th scope="col">Categoría</th>' +
            '<th scope="col" class="num">% actual</th><th scope="col">% pedido</th><th scope="col"><span class="ini-sr">Acción</span></th>' +
          '</tr></thead><tbody>' +
          ligadas.map(function (r, n) {
            var act = c.pctActual(r);
            return '<tr><td class="ini-cat-ruta">' + Escape.html(r) + '</td><td class="num">' + Escape.html(act === null ? '—' : act + '%') + '</td>' +
              '<td><label class="ini-ed-pct"><span class="ini-sr">% pedido para ' + Escape.html(r) + '</span>' +
              '<input type="number" min="0" max="100" step="0.01" data-cambio-pct="' + n + '" value="' + Escape.attr(c.pcts[r] || '') +
              '" placeholder="sin cambio"> %</label></td><td></td></tr>';
          }).join('') +
          c.nuevas.map(function (x, n) {
            return '<tr><td><span class="ini-cat-ruta">' + Escape.html(x.categoria) + '</span> <span class="ini-cat-estado nueva">Agregar</span></td>' +
              '<td class="num">—</td><td><label class="ini-ed-pct"><span class="ini-sr">% para ' + Escape.html(x.categoria) + '</span>' +
              '<input type="number" min="0" max="100" step="0.01" data-cambio-nueva-pct="' + n + '" value="' + Escape.attr(x.valor) + '"> %</label></td>' +
              '<td><button type="button" class="btn linea chico" data-cambio-quitar="' + n + '">Quitar</button></td></tr>';
          }).join('') + '</tbody></table></div>'
        : '<p class="ini-nota">Sin categorías todavía: agrega una.</p>';
      var agregar = c.rutas.length
        ? '<div class="ini-cat-agregar"><label for="regCambioCatBuscar">Agregar categoría</label>' +
            selectorHtml('regCambioCatBuscar', c.rutas, '') +
            ' <button type="button" class="btn linea chico" data-accion="cambio-cat-agregar">Agregar</button></div>'
        : (A ? A.htmlSinCatalogo(c.rutasEstado) : '<p class="ini-nota">El catálogo de categorías no está disponible.</p>');
      return tabla + agregar +
        '<div class="ini-cambio-msg" id="regCambioCatMsg" role="status" aria-live="polite"></div>' +
        '<small class="ini-sub">Deja en blanco las que no cambian. Agregar pide sumar la categoría; ADM la revisa y la aplica.</small>';
    }

    // ---- Seguimiento: categoria elegida ----
    // valor: lo elegido o escrito. Solo una categoria REAL de la iniciativa
    // cambia lo que se ve; repinta solo su bloque (ni filtros ni el resto).
    elegirCategoriaSeguimiento(valor) {
      var i = this.registro && this.registro.buscar(this.abierta);
      if (!i) return false;
      var rutas = i.categorias.map(function (c) { return c.categoria; });
      var A = window.IniciativaAdmin;
      var ruta = A ? A.Selector.resolver(valor, rutas) : (rutas.indexOf(valor) >= 0 ? valor : '');
      var caja = this.$('regSegCatInfo');
      if (!ruta) {
        if (caja && String(valor || '').trim()) {
          caja.innerHTML = '<p class="ini-nota">' + Escape.html(A ? A.noEnLista(valor, rutas, 'una categoría')
            : 'Elige una categoría de la lista.') + '</p>';
        }
        return false;
      }
      this.segCategoria = ruta;
      if (caja) caja.innerHTML = this.htmlSeguimientoCategoria(i, ruta);
      return true;
    }

    // Lo que hay de fechas para UNA categoria. Solucion y Cierre son de la
    // INICIATIVA (dbo.Problem). Analisis: la PROPIA si la categoria se ligo
    // despues (f_analisis_propia, sql/18); si no, la de la iniciativa, que
    // hereda. Lo demas propio de la categoria es su % y sus tickets.
    htmlSeguimientoCategoria(i, ruta) {
      var c = i.categorias.filter(function (x) { return x.categoria === ruta; })[0];
      if (!c) return '';
      var propia = typeof c.f_analisis_propia === 'string' && c.f_analisis_propia;
      return '<dl class="ini-datos">' +
          '<div class="ini-dato"><dt>% disminución</dt><dd>' + pct(c.pct_dism) + '</dd></div>' +
          '<div class="ini-dato"><dt>Tickets a reducir</dt><dd>' + fmt(c.tickets_reduce) + '</dd></div>' +
          '<div class="ini-dato"><dt>Análisis</dt><dd>' + Escape.html(fecha(propia ? c.f_analisis_propia : i.f_analisis)) +
            ' <span class="ini-origen' + (propia ? '' : ' derivado') + '">' + (propia ? 'Propia' : 'De la iniciativa') + '</span></dd></div>' +
          '<div class="ini-dato"><dt>Solución</dt><dd>' + Escape.html(fecha(i.f_solucion)) + '</dd></div>' +
          '<div class="ini-dato"><dt>Cierre</dt><dd>' + Escape.html(fecha(i.f_cierre)) + '</dd></div>' +
        '</dl>' +
        '<p class="ini-nota">' + (propia
          ? 'Se ligó el ' + Escape.html(fecha(c.f_creacion_propia)) + ' y tiene su propia fecha de análisis; solución y cierre son los de la iniciativa.'
          : 'Hereda las fechas de la iniciativa (dbo.Problem): cambian con ellas.') + '</p>';
    }

    // ---- categorias de "Modificar" ----
    agregarCategoriaEdicion(texto) {
      var ed = this.edicion;
      if (!ed) return null;
      if (texto === undefined) { var caja = this.$('regEdCatBuscar'); texto = caja ? caja.value : ''; }
      var r = ed.categorias.agregar(texto);
      if (r.ok) {
        this.pintarCategoriasEdicion();
        this.consultarVolumetria(r.ruta);
      }
      var msg = this.$('regEdCatMsg');
      if (msg) {
        msg.className = 'ini-cambio-msg' + (r.ok ? '' : ' error');
        msg.textContent = r.ok ? '' : r.mensaje;
      }
      return r;
    }

    accionCategoria(op, n) {
      var ed = this.edicion;
      if (!ed) return false;
      var hecho = op === 'quitar' ? ed.categorias.quitar(n) : op === 'restaurar' ? ed.categorias.restaurar(n) : false;
      if (hecho) this.pintarCategoriasEdicion();
      return hecho;
    }

    pintarCategoriasEdicion() {
      var caja = this.$('regEdCats');
      if (caja && this.edicion) caja.innerHTML = window.IniciativaAdmin.htmlCategoriasEdicion(this.edicion, this.clienteVolumetria());
      this.montarSelectorCategorias();
      this.pintarEstadoEdicion();
    }

    // "Agregar categoria" de Modificar con el desplegable del filtro Grupos
    // de SLA (IniciativaAdmin.Selector.montar). Sin el modulo, <select> nativo.
    montarSelectorCategorias() {
      var A = window.IniciativaAdmin, caja = this.$('regEdCats');
      if (A && A.Selector && A.Selector.montar && caja) A.Selector.montar(caja);
    }

    // Pide la volumetria (solo lectura) y repinta las categorias al llegar,
    // si el mismo "Modificar" sigue abierto.
    consultarVolumetria(ruta) {
      var vol = this.clienteVolumetria(), self = this, ed = this.edicion;
      if (!vol) return Promise.resolve(null);
      return vol.consultar(ruta, function () {
        if (self.edicion === ed) {
          var caja = self.$('regEdCats');
          if (caja) caja.innerHTML = window.IniciativaAdmin.htmlCategoriasEdicion(ed, vol);
          self.montarSelectorCategorias();
        }
      });
    }

    // ---- Edicion directa (ADM): guarda con la persistencia activa; si no, solo valida ----
    // Los campos editables se pintan en su lugar del detalle; la barra
    // "Cambios sin guardar" (Guardar cambios / Cancelar) aparece solo con
    // cambios. Todo esto es UX: el servidor exige ADM en cada envio
    // (admin_iniciativas_gestion.ashx -> AccesoAdmin.ExigirAdm).

    // Antes de repintar o cambiar de borrador: el control enfocado se
    // desenfoca mientras su borrador sigue vigente. Si no, el navegador
    // manda su "change" al quitarlo del DOM y el valor viejo caeria en el
    // borrador nuevo (Cancelar no limpiaria).
    soltarFoco() {
      var activo = this.doc.activeElement, cuerpo = this.$('regDetCuerpo');
      if (activo && activo.blur && cuerpo && cuerpo.contains && cuerpo.contains(activo)) activo.blur();
    }

    nuevaEdicion(i) {
      var op = this.opcionesEstado();
      var duenos = this.duenosCatalogo || { po: [], so: [] };
      return new window.IniciativaAdmin.EdicionAdmin(i,
        { rutas: this.rutasAdmCatalogo || op.rutas, rutasEstado: op.rutasEstado, estados: op.estados, subestados: op.subestados,
          tiposIniciativa: op.tiposIniciativa, tiposAgrupado: op.tiposAgrupado,
          pos: duenos.po, sos: duenos.so, duenosYQuitar: !!(this.registro && this.registro.edicionDuenosQuitar) });
    }

    // Crear > existente: abre el detalle de esa iniciativa con el foco en
    // el titulo MOSTRADO; abrir no edita (un clic, Enter o espacio si).
    modificar(folio, origen) {
      if (!this.puedeEditar()) return false;
      if (!this.abrirDesdeLista(folio, origen) || !this.edicion) return false;
      this.enfocarTexto('titulo');
      return true;
    }

    enfocarTexto(clave) {
      var vista = this.$('regEdVer-' + clave);
      if (vista && vista.focus) vista.focus();
    }

    // Repinta, desde el borrador actual, solo lo editable del detalle
    // (Identificacion, compromisos, categorias, descripcion y la barra):
    // Solicitar cambios, Historial y "Ver por categoria" no se tocan.
    pintarEditables() {
      var i = this.registro && this.registro.buscar(this.abierta);
      if (!i) return;
      var partes = { regDetNombre: this.htmlNombre(i), regDetIdent: this.htmlIdentificacion(i), regDetEtapas: this.htmlEtapas(i),
                     regDetCats: this.htmlCategoriasDetalle(i), regDetDesc: this.htmlDescripcion(i),
                     regEdBarraCaja: this.htmlBarra() };
      var self = this;
      Object.keys(partes).forEach(function (id) { var c = self.$(id); if (c) c.innerHTML = partes[id]; });
      this.montarSelectorCategorias();
      this.volumetriaEdicion();
    }

    // La volumetria (solo lectura) de cada categoria del borrador y el
    // estado de la barra.
    volumetriaEdicion() {
      var self = this;
      if (!this.edicion) return;
      this.edicion.categorias.filas.forEach(function (f) { self.consultarVolumetria(f.categoria); });
      this.pintarEstadoEdicion();
    }

    // Marca el control tocado, cuenta los cambios y muestra u oculta la
    // barra. Sin cambios la barra se va (y su mensaje con ella).
    pintarEstadoEdicion(t) {
      var ed = this.edicion, barra = this.$('regEdBarra');
      if (!ed || !barra) return;
      var cambios = ed.cambios();
      var clave = t && t.getAttribute ? t.getAttribute('data-edicion') : null;
      if (clave && t.classList) t.classList.toggle('ini-ed-cambiado', cambios.some(function (c) { return c.clave === clave; }));
      barra.hidden = !cambios.length;
      var sucio = this.$('regEdSucio');
      if (sucio) sucio.textContent = cambios.length === 1 ? '1 cambio sin guardar' : cambios.length + ' cambios sin guardar';
      if (!cambios.length) {
        var msg = this.$('regEdMsg');
        if (msg) { msg.className = 'ini-cambio-msg'; msg.innerHTML = ''; }
      }
      this.pintarVistaEdicion();
    }

    pintarVistaEdicion() {
      var caja = this.$('regEdVista');
      if (!caja || !this.edicion) return;
      caja.innerHTML = window.IniciativaAdmin.htmlVistaPrevia(this.edicion) +
        this.edicion.notasLegado().map(function (n) { return '<p class="ini-nota">' + Escape.html(n) + '</p>'; }).join('');
    }

    // abrir (accion editar-admin): con ADM el borrador ya existe; solo
    // lleva el foco al primer campo. Cerrar = Cancelar: vuelve a lo
    // guardado (un borrador nuevo desde el registro) y repinta solo lo
    // editable; sin ADM, retira la edicion. Nada se pierde de Solicitar
    // cambios ni del Historial.
    abrirEdicion(abrir) {
      var i = this.registro && this.registro.buscar(this.abierta);
      if (!i || this.edicionEnviando) return;
      if (abrir && !this.puedeEditar()) return;
      if (!abrir) { this.soltarFoco(); this.editando = null; }
      var habia = !!this.edicion;
      this.edicion = this.puedeEditar() ? (abrir && this.edicion ? this.edicion : this.nuevaEdicion(i)) : null;
      if (!abrir || !habia) this.pintarEditables();
      if (abrir && this.edicion) this.enfocarTexto('titulo');
    }

    // Revision local (sin servidor): errores de formato y cambios.
    revisarEdicion() {
      if (!this.edicion) return null;
      var r = this.edicion.revisar();
      var msg = this.$('regEdMsg');
      msg.className = 'ini-cambio-msg ' + (r.listo ? '' : 'error');
      msg.innerHTML = r.listo ? '' : '<strong class="ini-prototipo-marca">Corrige antes de guardar (no se envió nada):</strong><ul>' +
        r.formato.map(function (e) { return '<li>' + Escape.html(e.mensaje) + '</li>'; }).join('') + '</ul>';
      return r;
    }

    // Deshabilita lo editable y los botones de la barra mientras se envia.
    bloquearEdicion(si) {
      var cuerpo = this.$('regDetCuerpo');
      if (cuerpo && cuerpo.classList) cuerpo.classList.toggle('ini-ed-enviando', si);
      var controles = cuerpo && cuerpo.querySelectorAll
        ? cuerpo.querySelectorAll('[data-edicion], [data-edicion-pct], [data-edicion-tickets], [data-edicion-modo], [data-edicion-tipo], ' +
            '[data-edicion-fcat], [data-edicion-cat], #regEdCatBuscar, [data-accion="edicion-cat-agregar"]') : [];
      Array.prototype.forEach.call(controles, function (el) { el.disabled = si; });
      var self = this;
      ['regEdGuardar', 'regEdCancelar'].forEach(function (id) { var b = self.$(id); if (b) b.disabled = si; });
    }

    // ---- Textos de ADM: se ven como texto y se editan en su lugar ----
    // Titulo, Descripcion y Observaciones se muestran como el encabezado y
    // los bloques de siempre (con el valor del borrador); un clic, Enter o
    // espacio los vuelve editor ahi mismo y al salir vuelven a verse como
    // texto. Lo escrito vive en el borrador (EdicionAdmin): nada se pierde
    // al salir del editor y solo "Guardar cambios" lo envia.

    editarTexto(clave) {
      if (!this.edicion || this.edicionEnviando || !this.$('regEdCaja-' + clave)) return false;
      if (this.editando && this.editando !== clave) this.terminarTexto();
      this.editando = clave;
      this.pintarTexto(clave);
      var ctl = this.$('regEd-' + clave);
      if (ctl && ctl.focus) ctl.focus();
      return true;
    }

    // devolverFoco: Escape deja el foco en el texto mostrado (teclado).
    terminarTexto(devolverFoco) {
      var clave = this.editando;
      if (!clave) return;
      this.editando = null;
      this.pintarTexto(clave);
      var vista = devolverFoco ? this.$('regEdVer-' + clave) : null;
      if (vista && vista.focus) vista.focus();
    }

    pintarTexto(clave) {
      var caja = this.$('regEdCaja-' + clave);
      if (caja) caja.innerHTML = this.htmlTextoInterior(clave);
    }

    // El contenido de la caja de un texto: su editor (si es el abierto) o
    // el valor del borrador como texto, marcado si difiere de lo guardado.
    // Vacio o null se rotula, nunca se ve como un campo en blanco.
    htmlTextoInterior(clave) {
      var A = window.IniciativaAdmin, ed = this.edicion;
      if (this.editando === clave) return A.htmlControlEdicion(ed, clave);
      var v = ed.valores[clave] || '';
      var cambiado = ed.cambios().some(function (c) { return c.clave === clave; });
      var rotulo = A.CAMPOS_EDICION.filter(function (c) { return c.clave === clave; })[0].rotulo;
      return '<div class="ini-ed-mostrar' + (clave === 'titulo' ? ' ini-det-nombre' : ' ini-texto') +
        (cambiado ? ' ini-ed-cambiado' : '') + '" id="regEdVer-' + clave + '" role="button" tabindex="0" data-editar="' + clave +
        '" title="Clic para editar" aria-label="' + Escape.attr(rotulo + ': ' + (v.trim() ? v : 'sin captura') + '. Clic para editar') + '">' +
        (v.trim() ? Escape.html(v) : '<span class="ini-nota">Sin captura.</span>') + '</div>';
    }

    htmlTexto(clave) {
      return '<div class="ini-ed-caja" id="regEdCaja-' + clave + '">' + this.htmlTextoInterior(clave) + '</div>';
    }

    // "Guardar cambios" (o "Validar en el servidor (no guarda)" sin
    // persistencia; data-accion edicion-guardar): el mismo POST
    // accion=modificar de admin_iniciativas_gestion.ashx, con SOLO lo que
    // cambio (EdicionAdmin.paraEnviar). Solo 'guardada' (200 que la base
    // confirmo) es exito; cualquier otra respuesta deja lo escrito tal cual
    // para corregir o reintentar. Sin cambios o con errores de formato
    // locales no se envia. Un envio a la vez.
    guardarEdicion(pedir, pedirRegistro) {
      var ed = this.edicion;
      if (!ed || !this.puedeEditar() || this.edicionEnviando) return Promise.resolve(null);
      var local = this.revisarEdicion();
      if (!local.listo || !local.cambios.length) {
        if (local.listo) this.$('regEdMsg').innerHTML = '<strong class="ini-prototipo-marca">Sin cambios: no hay nada que guardar.</strong>';
        return Promise.resolve(null);
      }
      var self = this, A = window.IniciativaAdmin, folio = this.abierta;
      var pares = ed.paraEnviar();
      this.edicionEnviando = true;
      this.bloquearEdicion(true);
      this.$('regEdMsg').className = 'ini-cambio-msg';
      this.$('regEdMsg').innerHTML = '<span>' + (this.registro.persistenciaAdmin === true ? 'Guardando…' : 'Validando en el servidor…') + '</span>';
      return A.enviarGestion(pares, pedir || function (url, op) { return fetch(url, op); }).then(function (r) {
        self.edicionEnviando = false;
        // GUARDADA: lo que se ve sale del registro releido (lista,
        // categorias, capacidad e historial), sin recargar la pagina y sin
        // tocar filtros, busqueda, orden, "mostrar mas" ni la vista.
        if (r.estado === 'guardada') return self.recargarTrasGuardar(folio, r, pedirRegistro, ed).then(function () { return r; });
        // Cualquier otra respuesta: lo escrito se queda (no se repinta) y se
        // puede reintentar. El detalle pudo cerrarse o cambiar mientras tanto.
        if (self.edicion !== ed || self.abierta !== folio) return r;
        self.bloquearEdicion(false);
        var caja = self.$('regEdMsg');
        caja.className = 'ini-cambio-msg ' + (r.estado === 'no_habilitada' || r.estado === 'no_confirmada' ? 'aviso' : 'error');
        caja.innerHTML = A.htmlRespuesta(r);
        return r;
      }, function (err) {
        self.edicionEnviando = false;
        if (self.edicion === ed) self.bloquearEdicion(false);
        throw err;
      });
    }

    // Relee el registro por la misma via que cargar() (leerRegistro, la
    // fuente autoritativa) y lo pinta con la MISMA vista: el filtro de antes
    // sobre los datos nuevos (sobre()), busqueda, orden, cuantas filas se
    // ven ("mostrar mas"), registro o cobertura. La Cobertura se rearma con
    // el catalogo ya leido (guardar una iniciativa no cambia el catalogo de
    // categorias) sobre el registro nuevo, antes del filtro, para que la
    // cascada conserve lo elegido del catalogo. NO toca el detalle abierto
    // ni sus borradores: eso lo decide quien llama.
    // Sin registro todavia (carga inicial en curso o fallida) no hay vista
    // que conservar: cargar().
    // -> Promise<{ ok, registro, error, superada }>; nunca rechaza. Si
    // falla, la vista anterior queda intacta.
    actualizar(pedir) {
      var self = this;
      if (!this.registro || !this.filtro) {
        return this.cargar(pedir).then(function () {
          return { ok: !!self.registro, registro: self.registro,
                   error: self.registro ? null : new Error(self.$('regErrorTexto').textContent) };
        });
      }
      pedir = pedir || function (url) { return fetch(url, { cache: 'no-store' }); };
      var mia = ++this.cargaId;
      return leerRegistro(pedir)
        .then(function (json) {
          if (mia !== self.cargaId) return { ok: false, superada: true };
          var registro = Registro.desdeJson(json);
          registro.fijarAlcance(self.rol === 'ADM');
          var cobertura = self.coberturaJson ? Cobertura.desdeJson(self.coberturaJson, registro) : null;
          if (cobertura) registro.ampliar(cobertura.filas);
          var filtro = self.filtro.sobre(registro);
          // Una Cobertura que venia en camino colgaba del registro viejo:
          // se pide otra vez.
          var pedirCobertura = !cobertura && (self.modo === 'cobertura' || !registro.alcanceCompleto() || !!self.coberturaPromesa);
          self.registro = registro;
          self.filtro = filtro;
          self.cobertura = cobertura;
          if (cobertura) self.estadoCobertura('listo');
          self.estadoVista(registro.iniciativas.length ? 'listo' : 'sinDatos');
          self.repintar();
          if (pedirCobertura) self.cargarCobertura(pedir);
          return { ok: true, registro: registro };
        })
        .catch(function (err) {
          if (mia !== self.cargaId) return { ok: false, superada: true };
          return { ok: false, error: err };
        });
    }

    // Tras un guardado confirmado de `folio` (desde el borrador `ed`):
    // actualizar() y, SOLO si el usuario sigue en ese detalle sin otro
    // trabajo abierto (el mismo borrador, o ninguno y sin "Solicitar
    // cambios"), lo reabre con los datos guardados y el aviso. Si cerro el
    // detalle o abrio otra iniciativa mientras se guardaba, la lista se
    // actualiza igual y no se reabre nada ni se toca su borrador. Si ya no
    // pasa los filtros, el detalle sigue abierto y lo dice; los filtros no
    // cambian. Si la relectura falla, la vista anterior queda intacta y el
    // aviso dice que SI se guardo y que la vista no se actualizo.
    recargarTrasGuardar(folio, r, pedir, ed) {
      var self = this, A = window.IniciativaAdmin;
      var guardado = r ? A.htmlRespuesta(r) : '<strong>Guardado en la base.</strong>';
      var boton = '<button type="button" class="btn linea chico" data-accion="recargar-guardado">Actualizar</button>';
      return this.actualizar(pedir).then(function (res) {
        if (self.abierta !== folio) return;
        var libre = !self.cambioAbierto && (self.edicion === ed || !self.edicion);
        var i = res.ok ? res.registro.buscar(folio) : null;
        if (!libre || !i) {
          // Mismo detalle pero con otro trabajo abierto, o sin datos nuevos
          // que pintar: no se repinta. El borrador ya guardado se cierra
          // (lo que mostraria es lo de antes); cualquier otro se conserva.
          if (ed && self.edicion === ed) self.abrirEdicion(false);
          var fallo = !res.ok && !res.superada;
          var motivo = fallo
            ? '<p>Se guardó, pero no se pudo actualizar la vista: ' + Escape.html((res.error && res.error.message) || 'error desconocido') +
              ' Lo que se ve aquí puede estar desactualizado.</p>' + boton
            : res.ok && !i
            ? '<p>La lista se actualizó, pero esta iniciativa ya no está en el registro releído: lo que se ve aquí es lo de antes.</p>'
            : '<p>La lista se actualizó. Este panel conserva lo que tienes abierto; lo que se ve aquí puede ser lo de antes.</p>' + boton;
          self.avisoDetalle(fallo ? 'aviso' : 'listo', guardado + motivo);
          return;
        }
        var hist = self.histAbierto;
        self.abrirDetalle(folio, self.origenFoco);
        if (hist && self.$('regHistBoton')) self.plegarHistorial();
        var nota = self.filtro.aplicar([i]).length ? ''
          : '<p class="ini-nota">Con los cambios ya no coincide con los filtros o la búsqueda activos: no aparece en la lista, ' +
            'pero sigue abierta aquí. Los filtros no se cambiaron.</p>';
        self.avisoDetalle('listo', guardado + nota);
      });
    }

    avisoDetalle(clase, html) {
      var aviso = this.$('regDetAviso');
      if (!aviso) return;
      aviso.className = 'ini-cambio-msg ' + clase;
      aviso.hidden = false;
      aviso.innerHTML = html;
    }

    // Botones de la cabecera del detalle. Con ADM no hay boton de editar:
    // los campos editables ya lo son en su lugar (solo una pista).
    htmlAcciones() {
      return '<button type="button" class="btn linea chico" id="regCambioBoton" data-accion="solicitar-cambios"' +
          ' aria-expanded="false" aria-controls="regCambio">Solicitar cambios</button>' +
        (this.puedeEditar()
          ? ' <span class="ini-ed-pista">Edición directa (ADM): cambia los campos con borde y usa «Guardar cambios».</span>'
          : '');
    }

    // Marca derivada "Incompleta" (admin/iniciativa-admin.js): en una
    // iniciativa existente solo Categoria y %. No se guarda en ningun lado.
    htmlIncompleta(i) {
      var A = window.IniciativaAdmin;
      if (!A) return '';
      return A.htmlFaltantes(A.Incompleta.faltantes(A.Incompleta.datosDeRegistro(i), false),
        'Marca calculada; en iniciativas existentes solo se revisan Categoría y %.');
    }

    // Abrir arranca un borrador nuevo sobre la iniciativa abierta.
    abrirCambio(abrir) {
      var i = this.registro && this.registro.buscar(this.abierta);
      if (!i) return;
      this.cambio = new SolicitudCambio(i, this.opcionesEstado());
      this.cambioAbierto = abrir;
      this.$('regCambio').innerHTML = abrir ? this.htmlCambio() : '';
      this.$('regCambio').hidden = !abrir;
      this.$('regCambioBoton').setAttribute('aria-expanded', abrir ? 'true' : 'false');
      var foco = abrir ? this.$('regCambioCampo') : this.$('regCambioBoton');
      if (foco && foco.focus) foco.focus();
    }

    elegirCampoCambio(v) {
      if (!this.cambio) return;
      this.cambio.elegir(v);
      this.pintarGruposCambio();
    }

    // La etapa de "Fecha de compromiso": su fecha actual y el rotulo de la
    // nueva siguen a la etapa elegida.
    elegirEtapaCambio(v) {
      if (!this.cambio || this.cambio.tipo() !== 'fecha') return;
      this.cambio.elegirEtapa(v);
      this.pintarGruposCambio();
    }

    // Muestra solo los controles del tipo elegido y su valor actual.
    pintarGruposCambio() {
      var c = this.cambio, t = c.tipo(), self = this;
      [['fecha', 'regCambioGrupoEtapa'], ['fecha', 'regCambioGrupoFecha'], ['estado', 'regCambioGrupoEstado'], ['pct', 'regCambioGrupoPct'],
       ['datos', 'regCambioGrupoDatos']].forEach(function (g) {
        var el = self.$(g[1]);
        if (el) el.hidden = t !== g[0];
      });
      // El selector de etapa muestra la del borrador (la del Estado actual
      // al elegir "Fecha de compromiso").
      var etapa = this.$('regCambioFechaCampo');
      if (etapa && t === 'fecha') etapa.value = esCampoFecha(c.campo) ? c.campo : '';
      var rotFecha = this.$('regCambioNuevaRot');
      if (rotFecha) rotFecha.textContent = rotuloFechaNueva(t === 'fecha' ? c.campo : '');
      var act = c.actual();
      this.$('regCambioActual').textContent = t === 'fecha' ? fecha(act) : t === 'pct' ? '(el % de cada categoría, en la tabla)'
        : t === 'datos' ? '(cada dato, abajo)' : t === 'otros' ? '(explicación libre)' : texto(act);
      var rot = this.$('regCambioMotivoRot');
      if (rot) rot.textContent = t === 'otros' ? 'Explicación de la corrección' : 'Motivo';
    }

    // Valida el borrador. NO lo envia: no hay donde guardarlo todavia.
    prepararCambio() {
      if (!this.cambio) return;
      var c = this.cambio, self = this;
      var campo = this.$('regCambioCampo').value;
      if (campo === 'fecha') {
        var etapa = this.$('regCambioFechaCampo');
        c.elegirEtapa(etapa ? etapa.value : '');
      } else c.campo = campoCambio(campo) ? campo : '';
      var t = c.tipo();
      var idPropuesto = t === 'estado' ? 'regCambioEstado' : 'regCambioNueva';
      // 'pct': los % ya estan en el borrador (capturarDetalle); 'otros' no
      // tiene valor propuesto.
      if (t === 'estado') {
        // Escrito en la caja con busqueda: solo cuenta la opcion real.
        var est = this.$(idPropuesto).value || '';
        c.propuesto = resolverOpcion(est, c.estados) || est;
      } else if (t === 'fecha') c.propuesto = this.$(idPropuesto).value || '';
      else c.propuesto = '';
      if (t === 'datos') {
        // Marcado = se pide (vacío = que quede vacío); PO / SO, la opción real.
        DATOS_CAMBIO.forEach(function (d) {
          var marca = self.$('regCambioDato-' + d.clave), valor = self.$('regCambioDatoValor-' + d.clave);
          if (!marca || !marca.checked) { c.datos[d.clave] = null; return; }
          var v = valor ? valor.value || '' : '';
          var lista = d.clave === 'po' ? c.pos : d.clave === 'so' ? c.sos : null;
          c.datos[d.clave] = lista ? resolverOpcion(v, lista) || v.trim() : v;
        });
      }
      c.motivo = this.$('regCambioMotivo').value || '';
      var errores = c.validar();
      var por = {};
      errores.forEach(function (e) { por[e.campo] = true; });
      [['campo', 'regCambioCampo'], ['etapa', 'regCambioFechaCampo'], ['propuesto', idPropuesto], ['motivo', 'regCambioMotivo']].forEach(function (par) {
        if (t !== 'fecha' && par[0] === 'etapa') return;
        if ((t === 'pct' || t === 'datos') && par[0] === 'propuesto') return;
        var el = self.$(par[1]);
        if (el) el.setAttribute('aria-invalid', por[par[0]] ? 'true' : 'false');
      });
      DATOS_CAMBIO.forEach(function (d) {
        var el = self.$('regCambioDatoValor-' + d.clave);
        if (el) el.setAttribute('aria-invalid', errores.some(function (e) { return e.dato === d.clave; }) ? 'true' : 'false');
      });
      var msg = this.$('regCambioMsg');
      if (errores.length) {
        msg.className = 'ini-cambio-msg error';
        msg.innerHTML = '<ul>' + errores.map(function (e) { return '<li>' + Escape.html(e.mensaje) + '</li>'; }).join('') + '</ul>';
        return;
      }
      var r = c.resumen();
      var detalle = t === 'fecha' ? Escape.html(fecha(r.anterior)) + ' → ' + Escape.html(fecha(r.nuevo))
        : t === 'estado' ? Escape.html(texto(r.anterior)) + ' → ' + Escape.html(r.nuevo)
        : t === 'pct' ? r.categorias.map(function (x) {
            return Escape.html(x.categoria) + (x.nueva ? ' (agregar): ' + Escape.html(x.nuevo + '%')
              : ': ' + Escape.html(x.anterior === null ? '—' : x.anterior + '%') + ' → ' + Escape.html(x.nuevo + '%'));
          }).join('; ')
        : t === 'datos' ? r.datos.map(function (d) {
            return Escape.html(d.rotulo) + ': ' + Escape.html(d.anterior || '(vacío)') + ' → ' + Escape.html(d.nuevo || '(vacío)');
          }).join('; ')
        : 'explicación para ADM; no cambia nada por sí sola';
      if (this.registro && this.registro.persistenciaSolicitudes === true) {
        this.enviarCambio(null, Escape.html(r.rotulo) + ': ' + detalle);
        return;
      }
      msg.className = 'ini-cambio-msg listo';
      msg.innerHTML = '<strong>Solicitud preparada, no enviada.</strong> ' + Escape.html(r.rotulo) + ': ' + detalle + '. ' +
        'El envío y la revisión se habilitarán cuando exista el registro de solicitudes; por ahora no se guarda nada.';
    }

    // POST accion=enviar con el borrador ya validado. "Enviada" SOLO con el
    // numero que devuelve la base; cualquier otra respuesta lo dice tal cual
    // y deja reintentar con la MISMA llave (no se duplica). Nunca toca la
    // iniciativa: la aplica un ADM desde la cola.
    enviarCambio(pedir, resumenHtml) {
      var c = this.cambio, self = this;
      if (!c || this.cambioEnviando || c.enviada) return Promise.resolve(null);
      var msg = this.$('regCambioMsg'), boton = this.$('regCambioEnviar');
      this.cambioEnviando = true;
      if (boton) boton.disabled = true;
      msg.className = 'ini-cambio-msg';
      msg.innerHTML = '<span>Enviando la solicitud…</span>';
      var datos = new FormData();
      c.pares().forEach(function (p) { datos.append(p[0], p[1]); });
      pedir = pedir || this.pedirSolicitud || function (url, op) { return fetch(url, op); };
      function pintar(clase, html) {
        if (self.cambio !== c) return;
        var m = self.$('regCambioMsg');
        if (!m) return;
        m.className = 'ini-cambio-msg ' + clase;
        m.innerHTML = html;
      }
      return Promise.resolve()
        .then(function () { return pedir(URL_SOLICITUDES + '?accion=enviar', { method: 'POST', body: datos, credentials: 'same-origin' }); })
        .then(function (resp) {
          return Promise.resolve(resp.json()).catch(function () { return null; }).then(function (j) { return { status: resp.status, json: j || {} }; });
        })
        .then(function (r) {
          self.cambioEnviando = false;
          var j = r.json;
          if (r.status === 200 && j.enviada === true && typeof j.id_solicitud === 'number') {
            c.enviada = j.id_solicitud;
            pintar('listo', '<strong>Solicitud #' + Escape.html(String(j.id_solicitud)) + ' enviada.</strong> ' + (resumenHtml || '') + '. ' +
              (j.repetida ? 'Ya estaba enviada: no se duplicó. ' : '') +
              'Un administrador (ADM) la revisa; la iniciativa no cambia hasta que la aplique.');
            return r;
          }
          if (self.cambio === c && boton) boton.disabled = false;
          if (r.status === 422 && Array.isArray(j.errores)) {
            pintar('error', '<ul>' + j.errores.map(function (e) { return '<li>' + Escape.html(e.mensaje || '') + '</li>'; }).join('') + '</ul>');
          } else if (r.status === 501) {
            pintar('aviso', '<strong>No se envió.</strong> ' + Escape.html(j.error || 'El registro de solicitudes no está habilitado.'));
          } else if (j.enviada === null) {
            pintar('aviso', Escape.html(j.error || 'No se pudo confirmar el envío.') + ' Puedes reintentar: la misma solicitud no se duplica.');
          } else {
            pintar('error', '<strong>No se envió.</strong> ' + Escape.html(j.error || ('Respuesta ' + r.status + ' del servidor.')));
          }
          return r;
        }, function () {
          self.cambioEnviando = false;
          if (self.cambio === c && boton) boton.disabled = false;
          pintar('aviso', 'No se pudo contactar al servidor: no se sabe si se envió. Reintenta: la misma solicitud no se duplica.');
          return null;
        });
    }

    plegarHistorial() {
      this.histAbierto = !this.histAbierto;
      this.$('regHistBoton').setAttribute('aria-expanded', this.histAbierto ? 'true' : 'false');
      this.$('regHistCuerpo').hidden = !this.histAbierto;
    }

    htmlCambio() {
      var c = this.cambio;
      var opciones = '<option value="">— Elige —</option>' + camposCambio(c.conDatos).map(function (x) {
        return '<option value="' + Escape.attr(x.clave) + '"' + (x.clave === c.queCambiar() ? ' selected' : '') + '>' + Escape.html(x.rotulo) + '</option>';
      }).join('');
      // Las tres etapas de "Fecha de compromiso"; sin una por omision, nada
      // elegido (quien pide la elige).
      var etapas = '<option value="">— Elige —</option>' + CAMPOS_FECHA.map(function (x) {
        return '<option value="' + x.clave + '"' + (x.clave === c.campo ? ' selected' : '') + '>' + Escape.html(x.rotulo) + '</option>';
      }).join('');
      var lista = function (id, valores) { return selectorHtml(id, valores, ''); };
      var t = c.tipo();
      return '<h4>Solicitar cambios</h4>' +
        '<p class="ini-nota">Pide un cambio sobre esta iniciativa; aquí no se edita. Lo revisa y aplica un administrador (ADM). ' +
          '«Otros» es solo una explicación (p. ej. una categoría equivocada): no cambia nada por sí sola.</p>' +
        '<div class="ini-cambio-campos">' +
          '<div class="campo"><label for="regCambioCampo">Qué cambiar</label><select id="regCambioCampo">' + opciones + '</select></div>' +
          '<div class="campo" id="regCambioGrupoEtapa"' + (t === 'fecha' ? '' : ' hidden') + '><label for="regCambioFechaCampo">Fecha de compromiso</label>' +
            '<select id="regCambioFechaCampo">' + etapas + '</select></div>' +
          '<div class="campo"><span class="ini-cambio-rot">Valor actual</span><span class="ini-cambio-actual" id="regCambioActual">' +
            Escape.html(t === 'fecha' || !t ? fecha(c.actual()) : texto(c.actual())) + '</span></div>' +
          // La fecha dice SIEMPRE su etapa; sin "Qué cambiar" no hay fecha.
          '<div class="campo" id="regCambioGrupoFecha"' + (t === 'fecha' ? '' : ' hidden') + '><label for="regCambioNueva" id="regCambioNuevaRot">' +
            Escape.html(rotuloFechaNueva(t === 'fecha' ? c.campo : '')) + '</label><input type="date" id="regCambioNueva"></div>' +
          '<div class="campo" id="regCambioGrupoEstado"' + (t === 'estado' ? '' : ' hidden') + '>' +
            (c.estados.length
              ? '<label for="regCambioEstado">Nuevo Estado</label>' + lista('regCambioEstado', c.estados)
              : '<p class="ini-nota">Sin lista de estados: no se puede pedir este cambio.</p>') + '</div>' +
          '<div class="campo ini-cambio-ancho" id="regCambioGrupoPct"' + (t === 'pct' ? '' : ' hidden') + '>' +
            this.htmlCategoriasCambio() + '</div>' +
          (c.conDatos ? '<div class="campo ini-cambio-ancho" id="regCambioGrupoDatos"' + (t === 'datos' ? '' : ' hidden') + '>' +
            this.htmlDatosCambio() + '</div>' : '') +
          '<div class="campo ini-cambio-ancho"><label for="regCambioMotivo" id="regCambioMotivoRot">' + (t === 'otros' ? 'Explicación de la corrección' : 'Motivo') +
            '</label><textarea id="regCambioMotivo" rows="3"></textarea></div>' +
        '</div>' +
        '<div class="ini-cambio-msg" id="regCambioMsg" role="status" aria-live="polite"></div>' +
        '<div class="ini-cambio-pie">' +
          '<button type="button" class="btn chico" id="regCambioEnviar" data-accion="cambio-preparar">' +
            (this.registro && this.registro.persistenciaSolicitudes === true ? 'Enviar solicitud' : 'Preparar solicitud') + '</button> ' +
          '<button type="button" class="btn linea chico" data-accion="cambio-cancelar">Cancelar</button>' +
        '</div>';
    }

    // Título / PO / SO capturados (sql/25): cada uno con su casilla (marcada
    // = se pide) y su valor actual. PO / SO de la lista del catálogo; el
    // Código no se ofrece (no se puede cambiar).
    htmlDatosCambio() {
      var c = this.cambio;
      return '<p class="ini-nota">Marca lo que quieres cambiar. Product Owner y Service Owner son los capturados en la iniciativa, ' +
          'no los de sus categorías. Vacío = que quede vacío.</p>' +
        DATOS_CAMBIO.map(function (d) {
          var lista = d.clave === 'po' ? c.pos : d.clave === 'so' ? c.sos : null;
          var id = 'regCambioDatoValor-' + d.clave;
          var control = lista
            ? (lista.length ? selectorHtml(id, lista, '') : '<input type="text" id="' + id + '" disabled placeholder="Sin catálogo de dueños">')
            : '<input type="text" id="' + id + '" maxlength="4000">';
          return '<div class="ini-cambio-sub" data-dato="' + d.clave + '">' +
            '<label><input type="checkbox" id="regCambioDato-' + d.clave + '"> ' + Escape.html(d.rotulo) + '</label>' +
            '<span class="ini-cambio-rot">Actual</span><span class="ini-cambio-actual">' + Escape.html(c.datoActual(d.clave) || '—') + '</span>' +
            '<label for="' + id + '">Nuevo ' + Escape.html(d.rotulo) + '</label>' + control +
          '</div>';
        }).join('');
    }

    htmlHistorial(i) {
      // La linea base ('B') no es un movimiento: no se pinta. Se rotula antes
      // de filtrar y nunca cuenta, asi que N es el mismo con o sin ella.
      var filas = etiquetarHistorial(i.historial).filter(function (f) { return f.fila.operacion !== 'B'; });
      var cambios = filas.filter(function (f) { return f.cuenta; }).length;
      var estado = this.registro ? this.registro.historialEstado : '';
      var desde = this.registro ? this.registro.historialDesde : '';
      var hayReconstruidas = filas.some(function (f) { return f.fila.reconstruido; });
      var cuerpo;
      if (filas.length) {
        cuerpo = '<div class="ini-det-tabla"><table><thead><tr><th scope="col">Registrado</th><th scope="col">Fecha</th>' +
            '<th scope="col">Movimiento</th><th scope="col">Anterior</th><th scope="col">Nueva</th><th scope="col">Quién</th>' +
            '</tr></thead><tbody>' +
            filas.map(function (f) {
              var h = f.fila;
              var cuando = h.reconstruido ? '≈ ' + String(h.fecha || '').slice(0, 10) : texto(h.fecha);
              var quien = h.usuario ? h.usuario : (h.origen === 'NO_DECLARADO' ? 'No declarado' : '—');
              return '<tr><td>' + Escape.html(cuando) + '</td>' +
                '<td>' + Escape.html(CAMPOS_HISTORIAL[h.campo] || texto(h.campo)) + '</td>' +
                '<td>' + (f.cuenta ? '<b>' + Escape.html(f.etiqueta) + '</b>' : Escape.html(f.etiqueta)) + '</td>' +
                '<td>' + Escape.html(h.anterior ? fecha(h.anterior) : '—') + '</td>' +
                '<td>' + Escape.html(h.nuevo ? fecha(h.nuevo) : '—') + '</td>' +
                '<td>' + Escape.html(quien) + '</td></tr>';
            }).join('') + '</tbody></table></div>' +
          '<p class="ini-nota">' +
            (desde ? 'Registro automático desde el ' + Escape.html(desde) + '. ' : '') +
            (hayReconstruidas ? '≈ Reconstruido de los comentarios del Excel: la fecha es aproximada. ' : '') +
            'Solo "Cambio n" cuenta como cambio; en Cierre solo cuentan las extensiones.</p>';
      } else if (estado === 'sin_tabla') {
        cuerpo = '<p class="ini-nota">El historial de fechas todavía no está instalado en la base.</p>';
      } else if (estado === 'error') {
        cuerpo = '<p class="ini-nota">No se pudo leer el historial de fechas; el resto del detalle está completo.</p>';
      } else if (estado === 'ok') {
        cuerpo = '<p class="ini-nota">Sin movimientos de fecha registrados' +
          (desde ? ' desde el ' + Escape.html(desde) : '') + '.</p>';
      } else {
        cuerpo = '<p class="ini-nota">Sin cambios registrados. El historial empezará a guardarse cuando exista su almacenamiento en la base; ' +
          'los cambios de fecha que trae el Excel solo se cuentan (columna Cambios de Seguimiento), sin detalle.</p>';
      }
      cuerpo += this.htmlHistorialCategorias(i);
      return '<section class="ini-det-sec ini-det-ancha ini-hist">' +
        '<button type="button" class="ini-hist-boton" id="regHistBoton" data-accion="historial" aria-expanded="false" aria-controls="regHistCuerpo">' +
          '<svg class="ini-hist-ico" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M9.5 6.5 15 12l-5.5 5.5"/></svg>' +
          '<span>Historial de cambios (' + fmt(cambios) + ')</span></button>' +
        '<div class="ini-hist-cuerpo" id="regHistCuerpo" hidden>' + cuerpo + '</div></section>';
    }

    // Las fechas de analisis PROPIAS de las categorias ligadas despues, aparte
    // de las de la iniciativa: su "Cambio n" corre por categoria y no suma a
    // la N del encabezado. Anterior vacio = heredaba la de la iniciativa.
    htmlHistorialCategorias(i) {
      var filas = etiquetarHistorial(i.historial_categorias);
      if (!filas.length) return '';
      var cambios = filas.filter(function (f) { return f.cuenta; }).length;
      return '<h5>Fechas de análisis por categoría <span class="ini-sub">' + fmt(cambios) + ' cambio' + (cambios === 1 ? '' : 's') + '</span></h5>' +
        '<div class="ini-det-tabla"><table><thead><tr><th scope="col">Registrado</th><th scope="col">Categoría</th>' +
          '<th scope="col">Movimiento</th><th scope="col">Anterior</th><th scope="col">Nueva</th><th scope="col">Quién</th>' +
          '</tr></thead><tbody>' +
          filas.map(function (f) {
            var h = f.fila;
            var quien = h.usuario ? h.usuario : (h.origen === 'NO_DECLARADO' ? 'No declarado' : '—');
            return '<tr><td>' + Escape.html(texto(h.fecha)) + '</td>' +
              '<td>' + Escape.html(texto(h.categoria)) + '</td>' +
              '<td>' + (f.cuenta ? '<b>' + Escape.html(f.etiqueta) + '</b>' : Escape.html(f.etiqueta)) + '</td>' +
              '<td>' + (h.anterior ? Escape.html(fecha(h.anterior)) : '<span class="ini-origen derivado">Heredaba la de la iniciativa</span>') + '</td>' +
              '<td>' + Escape.html(h.nuevo ? fecha(h.nuevo) : '—') + '</td>' +
              '<td>' + Escape.html(quien) + '</td></tr>';
          }).join('') + '</tbody></table></div>' +
        '<p class="ini-nota">Solo las categorías ligadas después tienen fecha propia; las demás heredan la de la iniciativa (arriba).</p>';
    }

    // .ini-detalle-abierto en <html> quita el scroll de la pagina de atras.
    marcarRaiz(abierto) {
      var raiz = this.doc.documentElement;
      if (raiz && raiz.classList) raiz.classList.toggle('ini-detalle-abierto', abierto);
    }

    // ---- Partes del detalle que la edicion directa repinta en su lugar ----
    // Cada una va en su contenedor (regDetIdent, regDetEtapas, regDetCats,
    // regDetDesc, regEdBarraCaja). Sin borrador (MOD o sin rol), solo
    // lectura, como siempre.

    // El titulo del Problem (el que edita ADM) va en el encabezado cuando ES
    // el titulo que se ve. En iniciativas del Excel el encabezado es el
    // TituloIniciativa (ProblemCategoria, no se edita aqui) y el del Problem
    // va aparte en Identificacion ("Titulo del problema").
    tituloEnEncabezado(i) {
      return !!this.edicion && this.edicion.original.titulo === (i.titulo || '');
    }

    htmlNombre(i) {
      if (this.tituloEnEncabezado(i)) return this.htmlTexto('titulo');
      return '<p class="ini-det-nombre">' + Escape.html(texto(i.titulo)) + '</p>';
    }

    // Identificacion. Con ADM: Estado y Subestado editables (y el Titulo del
    // problema si no es el del encabezado); Codigo, Agrupacion y
    // Antiguedad, solo lectura.
    htmlIdentificacion(i) {
      var ed = this.edicion, A = window.IniciativaAdmin;
      var edad = diasDesdeCreacion(i);
      var antig = datoDetalle('Antigüedad', edad === null ? '—' : Duracion.dias(edad));
      if (!ed) {
        return '<dl class="ini-datos">' +
          datoDetalle('Código', i.folio) +
          datoDetalle('Agrupación', i.agrup) +
          datoDetalle('Estado', i.estado) +
          antig +
          (i.titulo_problem && i.titulo_problem !== i.titulo ? datoDetalle('Título del problema', i.titulo_problem) : '') +
          '</dl>';
      }
      return '<dl class="ini-datos">' +
        (this.tituloEnEncabezado(i) ? '' : datoDetalle('Título del problema', this.htmlTexto('titulo'), true)) +
        datoDetalle('Código', i.folio) +
        datoDetalle('Agrupación', i.agrup) +
        datoDetalle('Estado', A.htmlControlEdicion(ed, 'estado'), true) +
        datoDetalle('Subestado', A.htmlControlEdicion(ed, 'subestado'), true) +
        // PO / SO de la iniciativa (sql/24): el Código sigue como texto.
        (ed.duenosYQuitar
          ? datoDetalle('Product Owner capturado', A.htmlControlEdicion(ed, 'po'), true) +
            datoDetalle('Service Owner capturado', A.htmlControlEdicion(ed, 'so'), true)
          : '') +
        antig +
        '</dl>';
    }

    // Compromisos (Analisis, Solucion, Cierre). Con ADM, la fecha de cada
    // uno es un input date (aaaa-mm-dd, la misma semantica del servidor).
    htmlEtapas(i) {
      var ed = this.edicion, A = window.IniciativaAdmin;
      var actual = FECHA_DEL_ESTADO[i.estado];
      function etapa(nombre, campo, cambios) {
        var vencida = i.fecha_retrasada && actual === campo;
        var valor = ed ? A.htmlControlEdicion(ed, campo)
          : vencida ? '<b class="ini-vencida">' + Escape.html(fecha(i[campo])) + '</b>' : Escape.html(fecha(i[campo]));
        return '<tr' + (actual === campo ? ' class="ini-etapa-actual"' : '') + '><th scope="row">' + Escape.html(nombre) +
          (actual === campo ? ' <span class="ini-sub">estado actual</span>' : '') + '</th>' +
          '<td class="fecha-cell' + (ed && vencida ? ' ini-vencida-celda' : '') + '">' + valor + '</td>' +
          '<td class="num">' + fmt(cambios) + '</td></tr>';
      }
      return '<div class="ini-det-tabla"><table><thead><tr><th scope="col">Fecha</th><th scope="col">Compromiso</th>' +
          '<th scope="col" class="num">Cambios</th></tr></thead><tbody>' +
          etapa('Análisis', 'f_analisis', i.n_analisis) +
          etapa('Solución', 'f_solucion', i.n_solucion) +
          etapa('Cierre', 'f_cierre', i.n_cierre) +
        '</tbody></table></div>';
    }

    // Categorias afectadas. Con ADM: la tabla de edicion (% por categoria,
    // agrupacion sin declarar, fecha propia, quitar / restaurar, agregar del
    // catalogo vigente: las reglas de siempre) y, plegado, el desglose
    // guardado con tickets y dueños.
    htmlCategoriasDetalle(i) {
      var varios = this.duenosVarian(i);
      var tabla = i.categorias.length
        ? '<div class="ini-det-tabla"><table><thead><tr><th scope="col">Categoría</th><th scope="col" class="num">% disminución</th>' +
            '<th scope="col" class="num">Tickets a reducir</th>' + (varios ? '<th scope="col">Product Owner</th><th scope="col">Service Owner</th>' : '') +
          '</tr></thead><tbody>' +
          i.categorias.map(function (c) {
            return '<tr><td class="ini-cat-ruta">' + Escape.html(texto(c.categoria)) + '</td>' +
              '<td class="num">' + pct(c.pct_dism) + '</td><td class="num">' + fmt(c.tickets_reduce) + '</td>' +
              (varios ? '<td>' + Escape.html(texto(c.po)) + '</td><td>' + Escape.html(texto(c.so)) + '</td>' : '') + '</tr>';
          }).join('') + '</tbody></table></div>'
        : '<p class="ini-nota">Esta iniciativa no tiene categorías asignadas.</p>';
      if (!this.edicion) return tabla;
      return '<div id="regEdCats">' + window.IniciativaAdmin.htmlCategoriasEdicion(this.edicion, this.clienteVolumetria()) + '</div>' +
        (i.categorias.length ? '<details class="ini-ed-desglose"><summary>Desglose guardado: tickets a reducir y dueños</summary>' + tabla + '</details>' : '');
    }

    // Descripcion y Observaciones; con ADM, cada una en un textarea.
    htmlDescripcion(i) {
      var ed = this.edicion, self = this;
      function textoLargo(clave) {
        if (ed) return self.htmlTexto(clave);
        var v = i[clave];
        return v ? '<div class="ini-texto">' + Escape.html(v) + '</div>' : '<p class="ini-nota">Sin captura.</p>';
      }
      return textoLargo('descripcion') + '<h5>Observaciones</h5>' + textoLargo('observaciones');
    }

    // Barra "Cambios sin guardar" (solo con borrador de ADM).
    htmlBarra() {
      return this.edicion ? window.IniciativaAdmin.htmlBarraEdicion(this.registro && this.registro.persistenciaAdmin) : '';
    }

    duenosVarian(i) {
      return !i.sin_categoria && (duenos(i, 'po').length > 1 || duenos(i, 'so').length > 1 || duenos(i, 'director').length > 1);
    }

    htmlDetalle(i) {
      function seccion(titulo, cuerpo, clase) {
        return '<section class="ini-det-sec' + (clase ? ' ' + clase : '') + '"><h4>' + Escape.html(titulo) + '</h4>' + cuerpo + '</section>';
      }
      function lista(valores) {
        return valores.length ? valores.map(function (v) { return Escape.html(v); }).join('<br>') : '—';
      }
      function caja(id, html) { return '<div id="' + id + '">' + html + '</div>'; }

      var cab = '<div class="ini-det-cab">' +
        caja('regDetNombre', this.htmlNombre(i)) +
        '<div class="ini-det-marcas">' + this.htmlEstado(i) +
          (i.agrup ? ' <span class="chip ini-chip">' + Escape.html(i.agrup) + '</span>' : '') +
          (i.activa && i.fecha_retrasada ? ' <span class="pill ini-atrasada">Atrasada</span>' : '') +
        '</div>' +
        this.htmlIncompleta(i) +
        '<div class="ini-det-acciones" id="regDetAcciones">' + this.htmlAcciones() + '</div>' +
        '</div>' +
        '<div id="regAcuse" hidden></div>' +
        '<div class="ini-cambio-msg listo" id="regDetAviso" role="status" aria-live="polite" hidden></div>' +
        '<section class="ini-det-sec ini-cambio" id="regCambio" hidden></section>';

      var varios = this.duenosVarian(i);
      var org = '<dl class="ini-datos">' +
        datoDetalle('Director', lista(duenos(i, 'director')), true) +
        datoDetalle('Product Owner', lista(duenos(i, 'po')), true) +
        datoDetalle('Service Owner', lista(duenos(i, 'so')), true) +
        datoDetalle('Manager', i.manager) +
        '</dl>' +
        (i.sin_categoria ? '<p class="ini-nota">Sin categoría: los dueños son los capturados en el Problem.</p>'
          : '<p class="ini-nota">Dueños de sus categorías' + (varios ? '; varían por categoría (ver abajo).' : '.') +
            ' Manager: el del Service Owner ' + Escape.html(texto(i.so)) + '.</p>');
      // Con categorias, los PO / SO capturados en la iniciativa (alta de
      // Admin: dbo.Problem.OwnerProblem / OwnerServicio) van aparte: no
      // reemplazan a los de sus categorias. Sin categoria ya son los de arriba.
      if (!i.sin_categoria && (i.po_capturado || i.so_capturado)) {
        org += '<dl class="ini-datos">' +
          datoDetalle('Product Owner capturado', i.po_capturado) +
          datoDetalle('Service Owner capturado', i.so_capturado) +
          '</dl><p class="ini-nota">Capturados en la iniciativa (alta o edición de ADM): son los de las columnas y los filtros de la lista.</p>';
      }

      var impacto = '<dl class="ini-datos ini-datos-num">' +
        datoDetalle('Tickets a reducir', fmt(i.tickets_reduce)) +
        datoDetalle('Tickets en riesgo', fmt(i.riesgo_folio)) +
        '</dl>' +
        '<p class="ini-nota">Tickets a reducir: suma de sus categorías. En riesgo: los mismos tickets si va atrasada.</p>';

      var semTexto = { verde: 'Sin compromiso vigente', ambar: 'En tiempo o sin fecha', rojo: 'Atrasada' }[i.sem_fecha] || '—';
      // Fecha de creacion: dbo.Problem.FechaCreacion (f_creacion). Sin el
      // dato (servidor anterior) se ve "—", nunca una fecha calculada.
      var rutasCat = i.categorias.map(function (c) { return c.categoria; });
      if (rutasCat.indexOf(this.segCategoria) < 0) this.segCategoria = rutasCat[0] || '';
      var segCat = rutasCat.length
        ? '<div class="ini-seg-cat"><label for="regSegCategoria">Ver por categoría</label>' +
            selectorHtml('regSegCategoria', rutasCat, this.segCategoria) +
            '<div id="regSegCatInfo" aria-live="polite">' + this.htmlSeguimientoCategoria(i, this.segCategoria) + '</div></div>'
        : '<p class="ini-nota">Sin categorías: las fechas son las del problema.</p>';
      var seguimiento =
        '<p class="ini-det-sem">' + this.htmlPunto(i) + Escape.html(semTexto) + '</p>' +
        '<dl class="ini-datos">' + datoDetalle('Fecha de creación', fecha(i.f_creacion)) + '</dl>' +
        caja('regDetEtapas', this.htmlEtapas(i)) + segCat;

      // Pilas independientes: Identificacion e Impacto (cortas) comparten
      // columna para no dejar huecos bajo ellas junto a Seguimiento.
      function pila(html) { return '<div class="ini-det-pila">' + html + '</div>'; }
      return cab +
        '<div class="ini-det-rejilla">' +
          pila(seccion('Identificación', caja('regDetIdent', this.htmlIdentificacion(i))) + seccion('Impacto', impacto)) +
          pila(seccion('Organización', org)) +
          pila(seccion('Seguimiento', seguimiento)) +
          pila(seccion('Descripción', caja('regDetDesc', this.htmlDescripcion(i)))) +
        '</div>' +
        seccion('Categorías afectadas', caja('regDetCats', this.htmlCategoriasDetalle(i)), 'ini-det-ancha') +
        this.htmlHistorial(i) +
        caja('regEdBarraCaja', this.htmlBarra());
    }
  }

  return {
    URL_REGISTRO: URL_REGISTRO,
    PAGINA: PAGINA,
    BUSQUEDA_ESPERA: BUSQUEDA_ESPERA,
    Busqueda: Busqueda,
    FECHA_DEL_ESTADO: FECHA_DEL_ESTADO,
    URL_CATALOGO: URL_CATALOGO,
    URL_EXPORT: URL_EXPORT,
    Registro: Registro,
    SeleccionVarios: SeleccionVarios,
    FiltroRegistro: FiltroRegistro,
    Cobertura: Cobertura,
    SolicitudCambio: SolicitudCambio,
    RevisionSolicitud: RevisionSolicitud,
    CAMPOS_CAMBIO: CAMPOS_CAMBIO,
    etiquetarHistorial: etiquetarHistorial,
    ordenar: ordenar,
    ExportRegistro: ExportRegistro,
    VistaRegistro: VistaRegistro
  };
})();
