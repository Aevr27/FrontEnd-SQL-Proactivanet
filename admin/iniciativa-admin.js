/* =========================================================================
   admin/iniciativa-admin.js

   Gestion directa de ADM sobre iniciativas: crear y editar SIN el flujo de
   solicitud. SOLO VALIDACION: el boton "Validar en el servidor (no guarda)"
   manda los datos a handlers/admin_iniciativas_gestion.ashx, que los valida
   y responde 501 PersistenciaNoHabilitada (PersistenciaGestionAdmin.
   Habilitada es una constante false). Nada de este archivo guarda ni genera
   codigo: no hay contrato de base aprobado para estas escrituras (Paso 0,
   ver sql/diag_admin_alta_edicion.sql); la persistencia real es una fase
   aparte. Un 501 NUNCA se pinta como exito.

   MODELO (el de la base, sin inventar relaciones)
   -----------------------------------------------
     dbo.Problem           el problema, una fila por Codigo.
     dbo.ProblemCategoria  el problema contra UNA ruta completa de categoria,
                           con su % de disminucion (fraccion). Un problema
                           tiene cero o mas.
     Crear un problema = Problem + sus categorias. Ligar a uno EXISTENTE =
     elegirlo (buscador) y modificar sus categorias en "Modificar": nunca se
     crea un Problem nuevo por escribir un nombre o un codigo. El Codigo no
     cambia al modificar.

   SEPARACION DE ROLES
   -------------------
     "Nueva solicitud" (admin/iniciativas.js, SolicitudNueva) es el flujo de
     solicitud con TODAS sus validaciones. No se toca aqui.
     "Crear iniciativa" y "Modificar" (detalle del registro) son de ADM:
     aceptan datos incompletos (se avisa como INCOMPLETA), pero el tope de
     100% por categoria es el mismo para todos (lo decide el servidor).
     Los botones solo se pintan con rol ADM (SesionAdmin). Es solo UX: la
     autorizacion la hace el servidor (AccesoAdmin.ExigirAdm).

   VOLUMETRIA
   ----------
     Al elegir o cambiar una categoria se pide su volumetria a
     handlers/admin_iniciativas_volumetria.ashx: el Total general del SLOT 0
     (ultimos 30 dias) de dbo.vw_TBSlotCAT, con la consulta y la llave de
     Experiencia (App_Code/ExperienciaVolumetria.cs). NO es Tickets Reduce
     (ese sigue en la base). Estados: cargando, ok, cero (0 real),
     sin_datos (la vista vino vacia), error (la consulta fallo: nunca se
     pinta como 0) y ruta_invalida. En Modificar es de solo lectura.
     Crear y Modificar de ADM (alcance=total) muestran `ultimos30`: los
     tickets de la categoria en los ultimos 30 dias con la expresion de
     VolumenUltimos30 de dbo.vw_ProblemCategoria, la MISMA base con la que
     adm.usp_GestionAdmin_TicketsReduce guarda Tickets a reducir (antes se
     mostraba el total historico y la base calculaba sobre 30 dias:
     74 vs 7, 2026-10-26). El total historico ya no se pinta.
     En Crear, si la base tiene sql/26 (volumetria_manual del registro),
     ADM puede fijar otra por categoria (vacia = la calculada); la suma de
     las de un alta con alguna fijada viaja como `volumetria` y se guarda
     en dbo.Problem.VolumetriaOriginal. Sin sql/26 el campo no se ofrece.

   SUBESTADO INICIAL (Crear)
   -------------------------
     Opcional, de los valores que ya existen (subestados_problem del
     registro, la misma lista que Modificar). Solo se ofrece si la base
     tiene sql/27 (subestado_alta del registro); sin elegir no viaja y la
     base guarda NULL. Elegirlo no toca el Estado ni lo deriva.

   META EN % O EN TICKETS (Crear)
   ------------------------------
     "Planear la meta por" elige que se escribe en cada categoria: el % de
     disminucion o los tickets a resolver; el otro se muestra calculado con
     la volumetria de esa categoria (MetaCategoria). Lo que ADM escribio
     (fuente) nunca se pisa: cambiar el modo o la volumetria solo recalcula
     el otro. Viaja y se guarda el % (dos decimales): desde tickets puede no
     ser exacto y se dice. Tickets a reducir = FLOOR(volumetria de 30 dias
     x %): siempre hacia abajo, entero. Lo sigue calculando la base con la
     volumetria calculada, no con la fijada (si ADM fijo otra, se avisa lo
     que guardara la base).

   INCOMPLETA (marca DERIVADA, sin columna)
   ----------------------------------------
     Se calcula al vuelo; no se guarda en ningun lado. Un dato que el origen
     no trae (undefined) no se cuenta. Dos alcances (decision 2026-10-09,
     opcion A, tras E10):
       Borrador de ADM    CAMPOS_INCOMPLETA. Sin Volumetria desde que es
                          calculada (no hay nada que capturar).
       Iniciativa existente  solo CAMPOS_REGISTRO: Categoria y %.
     La marca solo se ve en el detalle, no en la lista.

   SELECTORES
   ----------
     Mas de SELECTOR_UMBRAL (20) opciones: caja de texto con lista
     (<input list> + <datalist>), en la que se escribe para buscar; el valor
     solo cuenta si coincide con una opcion real (Selector.resolver). Con 20
     o menos, un <select> normal. Lo escrito que no es una opcion se
     rechaza con las parecidas (Selector.coincidencias: parte del nombre o
     del codigo), sin elegir ninguna. Es el mismo en Crear, Modificar,
     Solicitar cambios y Seguimiento (registro-iniciativas.js).
     EXCEPCION: la categoria de Crear y Modificar (ADM) y el PO / SO de
     Solicitar cambios (registro-iniciativas.js, htmlDatosCambio) usan el
     desplegable del filtro Grupos de SLA (assets/js/desplegable.js sobre un
     <select> real: Selector.desplegable + Selector.montar), con su buscador.

   FECHA DE ANALISIS POR CATEGORIA (sql/18_gestion_admin_persistencia.sql)
   ---------------------------------------------------------------------
     Regla: el analisis dura FECHAS_GESTION.diasAnalisis (15) dias
     naturales. Una categoria NUEVA en "Modificar" (ligada despues) tiene SU
     fecha de creacion (el dia en que se liga) y SU fecha de analisis (ese
     dia + 15): se muestran calculadas y las fija el servidor al guardar.
     Una ligada con fecha PROPIA (f_analisis_propia del registro) la edita
     aqui (fcat_categoria / fcat_analisis). Una ligada que HEREDA (las
     iniciales del alta) muestra la de la iniciativa, "De la iniciativa":
     se cambia en "Fecha compromiso de Analisis", nunca como fecha propia.

   TIPOS DECLARADOS
   ----------------
     En el alta, Clasificacion (TipoIniciativa) y Agrupacion (TipoAgrupado)
     salen del Tipo (prefijo) por regla del negocio (TiposPorPrefijo; se
     muestran, no se eligen). El alta pide Estado inicial y la fecha de
     entrega del analisis (por omision hoy), que pueden faltar: ADM crea
     justo cuando falta informacion, y lo que falta se marca Incompleta.
     Solo el Tipo bloquea: sin el no hay Codigo. Una categoria que se liga
     a una existente puede llevar los suyos; nada se copia de las hermanas.
     Sin Agrupacion, el servidor revisa el tope como si la fila consumiera.
     Las opciones son los valores que ya existen (valores_tipo_iniciativa /
     valores_tipo_agrupado / estados_problem del registro).

   PRODUCT OWNER / SERVICE OWNER EN CREAR
   --------------------------------------
     Opcionales y SIN la cascada de Nueva solicitud: cada lista son los
     valores distintos del catalogo (asignaciones), completa, y elegir uno
     no filtra ni vacia el otro ni las categorias. Solo valores de la lista
     (nada escrito a mano): lo que no coincide se rechaza con las parecidas.
     Se guardan en dbo.Problem.OwnerProblem / OwnerServicio (sql/20); sin
     elegir, NULL. Si la base no tiene sql/20 (GuardaDuenos = false), el
     servidor rechaza un PO / SO elegido: nunca se tira.

   PIEZAS
   ------
     Incompleta          las reglas de faltantes (puras, sin DOM)
     VolumetriaCliente   pide y recuerda la volumetria por ruta
     CategoriasProblema  las categorias de un problema: agregar sin repetir,
                         quitar / restaurar, % por categoria, lo que viaja
     BorradorAdmin       el formulario de alta de ADM, sin DOM
     BuscadorProblemas   "Ligar a un problema existente": busca en el registro
     EdicionAdmin        "Modificar" una iniciativa del registro, sin DOM
     CAMPOS_EDICION      que se edita, que espera contrato y que es solo
                         lectura (con el porque)
     VistaCrearAdmin     el DOM del panel "Crear iniciativa"

   Se prueba en node: tools/tests/IniciativaAdminSmoke.js.
   ========================================================================= */
window.IniciativaAdmin = (function () {
  'use strict';

  // Texto fijo de la marca de prototipo: se repite en cada resultado para
  // que nunca se lea como un guardado.
  var AVISO_PROTOTIPO = 'No se guardó nada y no se generó código: la persistencia no está habilitada ' +
    '(contrato de base pendiente).';
  // La revision LOCAL nunca guarda, este o no habilitada la persistencia.
  var AVISO_REVISION = 'No se guardó nada: es solo la revisión del borrador en el navegador.';

  // Rotulos del boton que envia, segun el servidor guarde (persistencia
  // activa: `persistencia_admin` del registro) o solo valide. Sin el dato,
  // como si no guardara: nunca se promete un guardado.
  var ROTULOS = {
    guarda: { boton: 'Guardar', nota: 'Guarda en la base (solo ADM). El código lo asigna la base al guardar.',
              aviso: 'Guardar escribe en la base. El código se asigna al guardar.' },
    valida: { boton: 'Validar en el servidor (no guarda)', nota: 'Solo valida en el servidor; no guarda mientras la persistencia no esté habilitada.',
              aviso: '«Validar en el servidor» solo valida: la persistencia no está habilitada y no se guarda nada todavía. ' +
                'Además, mientras el Excel siga cargando, la carga reemplazaría estos campos.' }
  };
  function rotulos(persiste) { return persiste === true ? ROTULOS.guarda : ROTULOS.valida; }

  // Crear y modificar (solo ADM): con la persistencia activa guarda (200
  // guardada); apagada, solo valida (501 PersistenciaNoHabilitada).
  var URL_GESTION = '../handlers/admin_iniciativas_gestion.ashx';
  // Volumetria por categoria (solo lectura, ADM o MOD).
  var URL_VOLUMETRIA = '../handlers/admin_iniciativas_volumetria.ashx';
  // Alcance de ADM (Crear / Modificar; VolumetriaCliente): el servidor
  // manda el total historico y `ultimos30`; aqui solo se usa ultimos30.
  var ALCANCE_TOTAL = 'total';

  // Desde cuantas opciones un selector pasa a ser caja con busqueda.
  var SELECTOR_UMBRAL = 20;

  // PO / SO de Crear: clave del borrador -> como se nombra en los avisos.
  var DUENOS = { po: 'un Product Owner', so: 'un Service Owner' };

  function vacio(v) { return v === null || v === undefined || String(v).trim() === ''; }
  function llaveRuta(r) { return String(r === null || r === undefined ? '' : r).trim().toUpperCase(); }

  // ---------------------------------------------------------------------
  // Incompleta
  // ---------------------------------------------------------------------
  // Los datos que el flujo de solicitud exige, salvo la Volumetria (calculada;
  // la que ADM fija en Crear es opcional). El Tipo no esta: sin tipo no hay prefijo de codigo, asi
  // que en el alta es BLOQUEANTE, no "incompleta".
  var CAMPOS_INCOMPLETA = [
    { clave: 'categoria',     rotulo: 'Categoría' },
    { clave: 'titulo',        rotulo: 'Título' },
    { clave: 'descripcion',   rotulo: 'Descripción' },
    { clave: 'observaciones', rotulo: 'Observaciones' },
    { clave: 'pct',           rotulo: '% Disminución' },
    { clave: 'rca',           rotulo: 'RCA', soloProblem: true },
    // Opcionales en el alta de ADM (se crea justo cuando falta informacion).
    { clave: 'tipo_iniciativa', rotulo: 'Clasificación' },
    { clave: 'tipo_agrupado',   rotulo: 'Agrupación' },
    { clave: 'estado',          rotulo: 'Estado inicial' }
  ];

  // Regla del negocio (2026-10-15): el Tipo (prefijo) fija la Clasificacion
  // y esta la Agrupacion. Copia de TiposPorPrefijo (App_Code/
  // GestionIniciativaAdmin.cs), que es la que vale: el servidor ignora lo
  // que mande el formulario. Cambiar las dos. Prefijo sin regla = '' (Incompleta).
  var TIPOS_POR_PREFIJO = {
    ADO: 'Adopción', HAR: 'Hardware', MAP: 'Mejora Aplicativo', PRB: 'Problem', REQ: 'Requerimiento',
    RTI: 'Requerimiento TI a TI', S2L: 'Shift Left Administrador', SKB: 'SorIA_KB', SOR: 'SorIA'
  };
  var AGRUPACION_POR_CLASIFICACION = {
    'Adopción': 'Adopción', 'Hardware': 'ReqOpr', 'Mejora Aplicativo': 'Mejora', 'Problem': 'Problem',
    'Requerimiento': 'ReqOpr', 'Requerimiento TI a TI': 'ReqOpr', 'Shift Left Administrador': 'Adopción',
    'SorIA_KB': 'SorIA', 'SorIA': 'SorIA'
  };
  var TiposPorPrefijo = {
    clasificacion: function (prefijo) {
      var p = String(prefijo || '').trim().toUpperCase();
      return Object.prototype.hasOwnProperty.call(TIPOS_POR_PREFIJO, p) ? TIPOS_POR_PREFIJO[p] : '';
    },
    agrupacion: function (clasificacion) {
      return Object.prototype.hasOwnProperty.call(AGRUPACION_POR_CLASIFICACION, clasificacion) ? AGRUPACION_POR_CLASIFICACION[clasificacion] : '';
    }
  };

  // Lo unico que se revisa en una iniciativa EXISTENTE (ver cabecera).
  var CAMPOS_REGISTRO = ['categoria', 'pct'];

  var Incompleta = {
    CAMPOS: CAMPOS_INCOMPLETA,
    CAMPOS_REGISTRO: CAMPOS_REGISTRO,

    // datos: clave -> valor. undefined = el origen no lo trae (no cuenta);
    // null o texto vacio = falta. esProblem: el RCA solo cuenta en Problem.
    faltantes: function (datos, esProblem) {
      datos = datos || {};
      return CAMPOS_INCOMPLETA.filter(function (c) {
        if (c.soloProblem && !esProblem) return false;
        return datos[c.clave] !== undefined && vacio(datos[c.clave]);
      }).map(function (c) { return { clave: c.clave, rotulo: c.rotulo }; });
    },

    // Una iniciativa del registro -> datos, SOLO de CAMPOS_REGISTRO.
    datosDeRegistro: function (i) {
      var cats = Array.isArray(i.categorias) ? i.categorias : [];
      var sinCat = !!i.sin_categoria || !cats.length;
      return {
        categoria: sinCat ? '' : 'si',
        // Sin categorias no hay % que revisar: ya cuenta "Categoría".
        pct: sinCat ? undefined
          : (cats.every(function (c) { return typeof c.pct_dism === 'number' && isFinite(c.pct_dism); }) ? 'si' : '')
      };
    }
  };

  // Validacion de formato (la misma de Nueva solicitud): un % fuera de 0-100
  // no es "incompleto", es un dato invalido.
  var FORMATO = {
    pct: function (v) {
      if (v === '') return '';
      return /^\d{1,3}(\.\d{1,2})?$/.test(v) && Number(v) <= 100 ? ''
        : 'Escribe un porcentaje entre 0 y 100, con hasta dos decimales.';
    },
    // Volumetria y tickets: enteros de 0 en adelante que caben en int (la
    // columna dbo.Problem.VolumetriaOriginal; la misma regla del servidor).
    entero: function (v) {
      if (v === '') return '';
      return /^\d+$/.test(v) && Number(v) <= 2147483647 ? '' : 'Escribe un número entero, de 0 en adelante.';
    },
    fecha: function (v) {
      if (v === '') return '';
      var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
      if (!m) return 'Escribe una fecha válida (aaaa-mm-dd).';
      var d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
      return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3] ? ''
        : 'Escribe una fecha válida (aaaa-mm-dd).';
    }
  };

  function fechaCorta(s) { return s ? String(s).split('-').reverse().join('/') : '—'; }

  // Regla de fechas (la misma de FechasGestionAdmin en PlanGestionAdmin.cs):
  // analisis = dia de creacion/ligado + 15 dias naturales. Solo se muestra;
  // el servidor fija la fecha al guardar con el dia de Mexico.
  var FECHAS_GESTION = {
    diasAnalisis: 15,
    hoy: function () {
      var d = new Date();
      return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
    },
    analisisDesde: function (dia) {
      var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dia || '');
      if (!m) return '';
      var d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3] + FECHAS_GESTION.diasAnalisis));
      return d.toISOString().slice(0, 10);
    }
  };

  function pctDe(f) {
    return typeof f === 'number' && isFinite(f) ? String(Math.round(f * 10000) / 100) : '';
  }

  // ---------------------------------------------------------------------
  // Selector: <select> con pocas opciones, caja con busqueda con muchas
  // ---------------------------------------------------------------------
  var Selector = {
    UMBRAL: SELECTOR_UMBRAL,
    buscable: function (opciones) { return (opciones || []).length > SELECTOR_UMBRAL; },

    // id del control; opciones: [{ valor, texto }] o textos; valor actual.
    html: function (id, opciones, valor, extra) {
      var ops = (opciones || []).map(function (o) { return typeof o === 'string' ? { valor: o, texto: o } : o; });
      extra = extra || '';
      if (Selector.buscable(ops)) {
        return '<input type="text" id="' + id + '" list="' + id + '-lista" autocomplete="off" ' +
          'placeholder="Escribe para buscar…" value="' + Escape.attr(valor || '') + '"' + extra + '>' +
          '<datalist id="' + id + '-lista">' + ops.map(function (o) {
            return '<option value="' + Escape.attr(o.valor) + '">' + (o.texto !== o.valor ? Escape.html(o.texto) : '') + '</option>';
          }).join('') + '</datalist>';
      }
      return '<select id="' + id + '"' + extra + '><option value="">— Elige —</option>' + ops.map(function (o) {
        return '<option value="' + Escape.attr(o.valor) + '"' + (o.valor === valor ? ' selected' : '') + '>' + Escape.html(o.texto) + '</option>';
      }).join('') + '</select>';
    },

    // Siempre un <select> real (sin datalist, sin umbral), con la ruta
    // completa como texto: es el que Selector.montar viste con el
    // desplegable de SLA. Sin assets/js/desplegable.js queda el <select>
    // nativo, que sigue funcionando igual.
    desplegable: function (id, opciones, valor, extra) {
      var ops = (opciones || []).map(function (o) { return typeof o === 'string' ? { valor: o, texto: o } : o; });
      return '<select id="' + id + '" class="ini-dd-categoria"' + (extra || '') + '><option value="">— Elige —</option>' +
        ops.map(function (o) {
          return '<option value="' + Escape.attr(o.valor) + '"' + (o.valor === valor ? ' selected' : '') + '>' + Escape.html(o.texto) + '</option>';
        }).join('') + '</select>';
    },

    // Monta el desplegable de SLA (window.Desplegable) sobre los <select>
    // de Selector.desplegable dentro de `raiz`. Idempotente; sin el modulo
    // no hace nada.
    montar: function (raiz) {
      if (!raiz || !raiz.querySelectorAll || !window.Desplegable || !window.Desplegable.montar) return false;
      if (!raiz.querySelectorAll('select.ini-dd-categoria').length) return false;
      window.Desplegable.montar(raiz);
      return true;
    },

    // Lo escrito -> la opcion REAL que coincide (sin mayusculas ni espacios
    // de mas), o ''. Escribir algo parecido no elige nada.
    resolver: function (texto, opciones) {
      var k = llaveRuta(texto);
      if (!k) return '';
      for (var n = 0; n < (opciones || []).length; n++) {
        var o = opciones[n], v = typeof o === 'string' ? o : o.valor;
        if (llaveRuta(v) === k) return v;
      }
      return '';
    },

    // Las opciones que CONTIENEN lo escrito (parte del nombre o del codigo,
    // sin mayusculas ni acentos), en su orden; hasta `max`. Solo sugiere:
    // elegir sigue siendo resolver (coincidencia exacta).
    coincidencias: function (texto, opciones, max) {
      var k = plano(texto), salida = [];
      if (!k) return salida;
      (opciones || []).some(function (o) {
        var v = typeof o === 'string' ? o : o.valor, t = typeof o === 'string' ? o : o.texto;
        if (plano(v).indexOf(k) >= 0 || plano(t).indexOf(k) >= 0) salida.push(v);
        return salida.length >= (max || 5);
      });
      return salida;
    }
  };

  function plano(v) {
    return String(v === null || v === undefined ? '' : v).normalize('NFD')
      .replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  }

  // Mensaje de "no es una opcion de la lista", con las parecidas si las hay.
  function noEnLista(texto, opciones, que) {
    var t = String(texto).trim(), sug = Selector.coincidencias(t, opciones, 3);
    return 'Elige ' + que + ' de la lista: «' + t + '» no es ' + que + ' vigente.' +
      (sug.length ? ' Parecidas: ' + sug.join(' · ') + '.' : '');
  }

  // ---------------------------------------------------------------------
  // VolumetriaCliente
  // ---------------------------------------------------------------------
  // pedir: (url, opciones) -> Promise<Response>. Recuerda por ruta; un error
  // no se recuerda (se puede volver a pedir). alcance: '' (por omision) =
  // SLOT 0, los ultimos 30 dias (Nueva solicitud, Solicitar cambios);
  // 'total' = SOLO para Crear / Modificar de ADM (el servidor la niega, 403,
  // a cualquier otro rol). Con 'total' el valor es `ultimos30` (la
  // expresion de VolumenUltimos30 de vw_ProblemCategoria: la base del
  // TicketsReduce que guarda la base), nunca el total historico; el estado
  // sale de ese numero (ok > 0, cero = 0). Sin ultimos30 = error, nunca 0
  // ni el total.
  class VolumetriaCliente {
    constructor(pedir, alcance) {
      this.pedir = pedir || function (url, op) { return fetch(url, op); };
      this.alcance = alcance === ALCANCE_TOTAL ? ALCANCE_TOTAL : '';
      this.memo = {};
    }

    estado(ruta) { return this.memo[llaveRuta(ruta)] || null; }

    // -> Promise<{ estado, valor, mensaje }>. alCambiar: se llama al pasar
    // a 'cargando' y al terminar (para repintar).
    consultar(ruta, alCambiar) {
      var k = llaveRuta(ruta), self = this;
      if (!k) return Promise.resolve({ estado: 'ruta_invalida', valor: null });
      var ya = this.memo[k];
      if (ya && ya.estado !== 'error') return ya.promesa || Promise.resolve(ya);
      var e = { estado: 'cargando', valor: null };
      this.memo[k] = e;
      if (alCambiar) alCambiar(e);
      var url = URL_VOLUMETRIA + '?' + (self.alcance ? 'alcance=' + self.alcance + '&' : '') + 'ruta=' + encodeURIComponent(String(ruta).trim());
      e.promesa = Promise.resolve()
        .then(function () { return self.pedir(url, { method: 'GET', cache: 'no-store' }); })
        .then(function (r) {
          return r.json().catch(function () { return null; }).then(function (json) {
            var fila = json && Array.isArray(json.rutas) ? json.rutas[0] : null;
            if (!r.ok || !fila || typeof fila.estado !== 'string') {
              return { estado: 'error', valor: null,
                       mensaje: (json && json.error) || ('El servidor respondió ' + r.status + '.') };
            }
            if (self.alcance && fila.estado !== 'ruta_invalida') {
              var u = fila.ultimos30;
              if (typeof u !== 'number' || !isFinite(u) || u < 0 || u % 1) {
                return { estado: 'error', valor: null, alcance: self.alcance,
                         mensaje: 'el servidor no trajo los tickets de los últimos 30 días.' };
              }
              return { estado: u > 0 ? 'ok' : 'cero', valor: u, alcance: self.alcance, ultimos30: u };
            }
            return { estado: fila.estado, valor: typeof fila.volumetria === 'number' ? fila.volumetria : null, alcance: self.alcance,
                     ultimos30: null };
          });
        }, function () { return { estado: 'error', valor: null, mensaje: 'No se pudo contactar al servidor.' }; })
        .then(function (fin) {
          if (self.memo[k] === e) self.memo[k] = fin;
          if (alCambiar) alCambiar(fin);
          return fin;
        });
      return e.promesa;
    }

    static texto(e) {
      if (!e) return '—';
      switch (e.estado) {
        case 'cargando': return 'Consultando…';
        case 'ok': return Number(e.valor).toLocaleString('es-MX') + ' tickets (últimos 30 días)';
        case 'cero': return '0 tickets en los últimos 30 días';
        case 'sin_datos': return 'Sin datos de tickets cargados para los últimos 30 días';
        case 'ruta_invalida': return 'Categoría no válida';
        default: return 'No se pudo consultar' + (e.mensaje ? ': ' + e.mensaje : '');
      }
    }
  }

  function htmlVolumetria(e) {
    var clase = !e ? '' : e.estado === 'error' || e.estado === 'ruta_invalida' ? ' mal'
      : e.estado === 'sin_datos' ? ' aviso' : '';
    var origen = e && e.alcance === ALCANCE_TOTAL
      ? 'Calculada: tickets de la categoría en los últimos 30 días (VolumenUltimos30 de vw_ProblemCategoria, ' +
        'la base de Tickets a reducir), solo lectura'
      : 'Calculada: Total general del SLOT 0 de vw_TBSlotCAT (solo lectura)';
    return '<output class="ini-vol' + clase + '" title="' + Escape.attr(origen) + '">' +
      Escape.html(VolumetriaCliente.texto(e)) + '</output>';
  }

  // ---------------------------------------------------------------------
  // MetaCategoria: % de disminucion <-> tickets a resolver (Crear y Modificar de ADM)
  // ---------------------------------------------------------------------
  // Denominador: la volumetria de ESA categoria (la que ADM fijo o la
  // calculada). Lo que viaja y se guarda es el % (dbo.ProblemCategoria.
  // PctDisminucion, hasta dos decimales); los tickets solo se muestran.
  // Redondeo (2026-10-26): SIEMPRE hacia abajo, FLOOR(vol x %), el de
  // Tickets a reducir (ticketsDe de iniciativas.js y la propuesta sql/33
  // de adm.usp_GestionAdmin_TicketsReduce); en enteros (centesimas de %)
  // para no arrastrar errores de coma flotante: 7 x 9.46% = 0.66 -> 0.
  // Tickets -> %: el menor % con dos decimales que da al menos esos
  // tickets; si da mas (con volumetrias grandes 0.01% es mas de un ticket)
  // se dice, no se esconde.
  var MetaCategoria = {
    // vol: entero >= 0 o null; pct: texto. -> tickets enteros, o null.
    tickets: function (vol, pct) {
      if (typeof vol !== 'number' || !isFinite(vol) || vol < 0 || vol % 1) return null;
      if (vacio(pct) || FORMATO.pct(String(pct).trim())) return null;
      return Math.floor(vol * Math.round(Number(pct) * 100) / 10000);
    },
    // -> { pct: texto, exacto, tickets: los que da ese % } o { error }.
    pct: function (vol, tickets) {
      var t = String(tickets === null || tickets === undefined ? '' : tickets).trim();
      if (t === '') return { error: '' };
      if (FORMATO.entero(t)) return { error: 'Tickets a resolver: escribe un número entero, de 0 en adelante.' };
      if (typeof vol !== 'number' || !isFinite(vol) || vol < 0 || vol % 1) {
        return { error: 'Sin volumetría no se puede pasar de tickets a %.' };
      }
      if (vol === 0) return { error: 'Con volumetría 0 no hay tickets que resolver: usa el %.' };
      var n = Number(t);
      if (n > vol) return { error: n.toLocaleString('es-MX') + ' tickets es más que la volumetría (' + vol.toLocaleString('es-MX') + '): pasaría de 100%.' };
      var centesimos = Math.ceil(n * 10000 / vol);
      var pct = String(centesimos / 100);
      var da = MetaCategoria.tickets(vol, pct);
      return { pct: pct, exacto: da === n, tickets: da };
    }
  };

  // ---------------------------------------------------------------------
  // CategoriasProblema
  // ---------------------------------------------------------------------
  // ligadas: las categorias ACTUALES del problema ([{ categoria, pct_dism }]),
  // o [] en un alta. rutas: las rutas del catalogo vigente (lo unico que se
  // puede agregar). Cada fila: { categoria, valor (% en texto), original
  // (% de la base, en texto) | null si es nueva, ligada, quitada }.
  // Una NUEVA ademas (meta de Crear, MetaCategoria): volManual (la
  // volumetria que ADM fijo, '' = la calculada), volCalc (la calculada, o
  // null), tickets (lo escrito en "Tickets a resolver") y fuente ('pct' |
  // 'tickets': lo que ADM escribio; el otro se calcula y nunca pisa lo
  // escrito). modo: que se edita en pantalla ('pct' | 'tickets').
  class CategoriasProblema {
    constructor(ligadas, rutas) {
      this.modo = 'pct';
      this.rutas = Array.isArray(rutas) ? rutas : [];
      this.filas = (ligadas || []).map(function (c) {
        var v = pctDe(c.pct_dism);
        // agrup: la Agrupacion actual ('' = sin declarar; agrupNueva la
        // declara). fPropia: fecha de analisis PROPIA ('' = hereda la de la
        // iniciativa); fPropiaNueva es la editada.
        var propia = typeof c.f_analisis_propia === 'string' ? c.f_analisis_propia : '';
        return { categoria: c.categoria || '', valor: v, original: v, ligada: true, quitada: false,
                 agrup: typeof c.agrup === 'string' ? c.agrup : '', agrupNueva: '',
                 fPropia: propia, fPropiaNueva: propia,
                 // Meta en tickets tambien para una ligada (Modificar).
                 volCalc: null, vol30: null, tickets: '', fuente: 'pct' };
      });
    }

    fijarRutas(rutas) { this.rutas = Array.isArray(rutas) ? rutas : []; }

    buscar(ruta) {
      var k = llaveRuta(ruta);
      for (var n = 0; n < this.filas.length; n++) if (llaveRuta(this.filas[n].categoria) === k) return n;
      return -1;
    }

    // texto: lo escrito o elegido. -> { ok, mensaje, ruta }.
    agregar(texto) {
      if (vacio(texto)) return { ok: false, mensaje: 'Elige una categoría.' };
      var ruta = Selector.resolver(texto, this.rutas);
      if (!ruta) {
        return { ok: false, mensaje: this.rutas.length
          ? noEnLista(texto, this.rutas, 'una categoría')
          : 'El catálogo de categorías no está disponible.' };
      }
      var n = this.buscar(ruta);
      if (n >= 0) {
        var f = this.filas[n];
        return { ok: false, ruta: ruta, mensaje: f.quitada
          ? ruta + ' está marcada para quitar: usa «Restaurar» en vez de agregarla otra vez.'
          : ruta + ' ya está en la lista.' };
      }
      // fCreacion / fAnalisis: las PROPIAS de esta categoria ligada despues
      // (hoy y hoy + 15), calculadas, nunca copiadas de otra fila.
      var hoy = FECHAS_GESTION.hoy();
      this.filas.push({ categoria: ruta, valor: '', original: null, ligada: false, quitada: false,
                        fCreacion: hoy, fAnalisis: FECHAS_GESTION.analisisDesde(hoy),
                        tipoIniciativa: '', tipoAgrupado: '',
                        volManual: '', volCalc: null, vol30: null, tickets: '', fuente: 'pct' });
      return { ok: true, ruta: ruta, mensaje: '' };
    }

    // Una ligada se marca para quitar (se conserva la fila); una nueva se
    // descarta.
    quitar(n) {
      var f = this.filas[n];
      if (!f) return false;
      if (f.ligada) { f.quitada = true; f.valor = f.original; }
      else this.filas.splice(n, 1);
      return true;
    }

    restaurar(n) {
      var f = this.filas[n];
      if (!f || !f.quitada) return false;
      f.quitada = false;
      return true;
    }

    capturarPct(n, texto) {
      var f = this.filas[n];
      if (f && !f.quitada) {
        f.valor = String(texto === null || texto === undefined ? '' : texto).trim();
        f.fuente = 'pct';
      }
    }

    // ---- meta de Crear (solo filas nuevas) ----
    // La volumetria con la que se calcula: la fijada si es valida; vacia, la
    // calculada; fijada pero invalida, ninguna (el error lo da erroresFormato).
    volumen(f) {
      if (!f) return null;
      if (f.volManual !== undefined && f.volManual !== '') return FORMATO.entero(f.volManual) ? null : Number(f.volManual);
      return typeof f.volCalc === 'number' ? f.volCalc : null;
    }

    // Lo que tiene un fuente 'tickets': su % sale de los tickets y de la
    // volumetria (vacio si no se puede: erroresFormato dice por que). Un
    // fuente 'pct' no cambia.
    recalcular(f) {
      if (!f || f.quitada || f.fuente !== 'tickets') return;
      var r = MetaCategoria.pct(this.volumen(f), f.tickets);
      f.valor = r.error === undefined ? r.pct : '';
    }

    // La volumetria calculada de cada fila, de un VolumetriaCliente (ok o
    // cero; lo demas = sin calculada). vol30: los ultimos 30 dias que trae
    // el alcance 'total' (la base del TicketsReduce que guarda la base).
    sincronizarCalculadas(vol) {
      var self = this;
      this.filas.forEach(function (f) {
        var e = vol && vol.estado ? vol.estado(f.categoria) : null;
        var ok = e && (e.estado === 'ok' || e.estado === 'cero');
        f.volCalc = ok && typeof e.valor === 'number' ? e.valor : null;
        f.vol30 = ok && typeof e.ultimos30 === 'number' ? e.ultimos30 : null;
        self.recalcular(f);
      });
    }

    capturarVolumen(n, texto) {
      var f = this.filas[n];
      if (!f || f.ligada || f.quitada) return false;
      f.volManual = String(texto === null || texto === undefined ? '' : texto).trim();
      this.recalcular(f);
      return true;
    }

    capturarTickets(n, texto) {
      var f = this.filas[n];
      if (!f || f.quitada) return false;
      f.tickets = String(texto === null || texto === undefined ? '' : texto).trim();
      f.fuente = 'tickets';
      this.recalcular(f);
      return true;
    }

    // Solo cambia que se edita: no convierte ni toca lo escrito.
    elegirModo(modo) {
      if (modo !== 'pct' && modo !== 'tickets') return false;
      this.modo = modo;
      return true;
    }

    // Lo que muestra la casilla de tickets: lo escrito, o los que da el %.
    ticketsVista(f) {
      if (f.fuente === 'tickets') return f.tickets;
      var t = MetaCategoria.tickets(this.volumen(f), f.valor);
      return t === null ? '' : String(t);
    }

    // El valor calculado de una fila nueva, para mostrarlo junto al que se
    // edita. -> { texto, mal }.
    meta(f) {
      var vol = this.volumen(f), de = vol === null ? '' : ' de ' + vol.toLocaleString('es-MX');
      if (f.fuente === 'tickets') {
        var r = MetaCategoria.pct(vol, f.tickets);
        if (r.error !== undefined) return { texto: r.error, mal: r.error !== '' };
        return { texto: '≈ ' + r.pct + '%' + de + (r.exacto ? '' : ' · con 2 decimales son ' +
          r.tickets.toLocaleString('es-MX') + ' tickets') + this.notaGuardado(f, Number(f.tickets)), mal: false };
      }
      if (f.valor === '' || FORMATO.pct(f.valor)) return { texto: '', mal: false };
      var t = MetaCategoria.tickets(vol, f.valor);
      if (t === null) return { texto: 'Sin volumetría: no se calculan los tickets.', mal: false };
      return { texto: '= ' + t.toLocaleString('es-MX') + ' tickets' + de + this.notaGuardado(f, t), mal: false };
    }

    // Lo que la BASE guardara en Tickets a reducir (TicketsReduce): lo
    // calcula adm.usp_GestionAdmin_TicketsReduce sobre VolumenUltimos30
    // (FLOOR con sql/33), no con una volumetria fijada a mano. null si no
    // se sabe (sin vol30). Sin volumetria fijada es la misma meta mostrada.
    ticketsGuardados(f) {
      return typeof f.vol30 === 'number' ? MetaCategoria.tickets(f.vol30, f.valor) : null;
    }

    // Aviso cuando lo que guardara la base no es la meta escrita.
    notaGuardado(f, objetivo) {
      var g = this.ticketsGuardados(f);
      if (g === null || g === objetivo) return '';
      return ' · la base guardará ' + g.toLocaleString('es-MX') + ' en Tickets a reducir (calcula sobre los últimos 30 días: ' +
        f.vol30.toLocaleString('es-MX') + ')';
    }

    // La Volumetria del problema que viaja (dbo.Problem.VolumetriaOriginal):
    // '' si ADM no fijo ninguna (como hoy: NULL); si fijo alguna, la suma de
    // la que usa cada categoria activa (las que no tienen, no suman).
    volumetriaProblema() {
      var activas = this.activas().filter(function (f) { return !f.ligada; }), self = this;
      if (!activas.some(function (f) { return f.volManual; })) return '';
      return String(activas.reduce(function (s, f) { var v = self.volumen(f); return s + (v === null ? 0 : v); }, 0));
    }

    // campo: 'tipo_iniciativa' | 'tipo_agrupado'. En una nueva, sus tipos;
    // en una ligada, solo declarar la Agrupacion si no la tiene.
    capturarTipo(n, campo, texto) {
      var f = this.filas[n], v = String(texto === null || texto === undefined ? '' : texto).trim();
      if (!f || f.quitada) return false;
      if (!f.ligada && campo === 'tipo_iniciativa') f.tipoIniciativa = v;
      else if (!f.ligada && campo === 'tipo_agrupado') f.tipoAgrupado = v;
      else if (f.ligada && !f.agrup && campo === 'tipo_agrupado') f.agrupNueva = v;
      else return false;
      return true;
    }

    // Solo una ligada con fecha PROPIA (las que heredan cambian con la de la
    // iniciativa).
    capturarFecha(n, texto) {
      var f = this.filas[n];
      if (!f || !f.ligada || f.quitada || !f.fPropia) return false;
      f.fPropiaNueva = String(texto === null || texto === undefined ? '' : texto).trim();
      return true;
    }

    activas() { return this.filas.filter(function (f) { return !f.quitada; }); }

    // Las fechas calculadas de cada categoria nueva (solo para mostrar; no
    // viajan: el servidor las fija al guardar).
    fechasNuevas() {
      return this.filas.filter(function (f) { return !f.ligada; })
        .map(function (f) { return { categoria: f.categoria, f_creacion: f.fCreacion, f_analisis: f.fAnalisis }; });
    }

    erroresFormato() {
      var errores = [];
      var self = this;
      this.activas().forEach(function (f) {
        var e = FORMATO.pct(f.valor);
        if (e) errores.push({ clave: 'pct', mensaje: f.categoria + ': ' + e });
        if (!f.ligada && f.volManual && FORMATO.entero(f.volManual)) {
          errores.push({ clave: 'volumetria', mensaje: f.categoria + ': Volumetría: ' + FORMATO.entero(f.volManual) });
        }
        if (f.fuente === 'tickets') {
          var m = MetaCategoria.pct(self.volumen(f), f.tickets);
          if (m.error) errores.push({ clave: 'tickets', mensaje: f.categoria + ': ' + m.error });
        }
        if (f.ligada && f.fPropia && f.fPropiaNueva !== f.fPropia) {
          var ef = f.fPropiaNueva === '' ? 'la fecha de análisis de una categoría no se puede vaciar.' : FORMATO.fecha(f.fPropiaNueva);
          if (ef) errores.push({ clave: 'fechas_categoria', mensaje: f.categoria + ': ' + ef });
        }
      });
      return errores;
    }

    // -> [{ clave, rotulo, anterior, nuevo }]
    cambios() {
      var salida = [];
      // La meta escrita en tickets acompaña al % que viaja (solo el % se guarda).
      var enTickets = function (f) {
        return f.fuente === 'tickets' && f.valor !== '' ? ' (meta: ' + f.tickets + ' tickets)' : '';
      };
      this.filas.forEach(function (f) {
        if (f.ligada && f.quitada) {
          salida.push({ clave: 'quitar_categoria', rotulo: 'Quitar categoría', anterior: f.categoria, nuevo: '' });
        } else if (!f.ligada) {
          salida.push({ clave: 'agregar_categoria', rotulo: 'Agregar categoría', anterior: '',
                        nuevo: f.categoria + (f.valor === '' ? ' (sin %)' : ' · ' + f.valor + '%' + enTickets(f)) +
                          (f.tipoAgrupado ? ' · ' + f.tipoAgrupado : '') +
                          (f.fAnalisis ? ' · análisis ' + f.fAnalisis + ' (hoy + ' + FECHAS_GESTION.diasAnalisis + ' días)' : '') });
        } else {
          if (f.valor !== f.original) {
            salida.push({ clave: 'pct', rotulo: '% Disminución · ' + f.categoria, anterior: f.original, nuevo: f.valor + enTickets(f) });
          }
          if (f.agrupNueva) {
            salida.push({ clave: 'tipo_agrupado', rotulo: 'Agrupación · ' + f.categoria, anterior: '', nuevo: f.agrupNueva });
          }
          if (f.fPropia && f.fPropiaNueva !== f.fPropia) {
            salida.push({ clave: 'fechas_categoria', rotulo: 'Fecha de análisis · ' + f.categoria, anterior: f.fPropia, nuevo: f.fPropiaNueva });
          }
        }
      });
      return salida;
    }

    // Alta: pares cat_ruta / cat_pct de todas las activas.
    paresCrear() {
      var pares = [];
      this.activas().forEach(function (f) { pares.push(['cat_ruta', f.categoria], ['cat_pct', f.valor]); });
      return pares;
    }

    // Modificar: SOLO lo que cambio. Las listas paralelas (pct_* con
    // pct_tipo_agrupado; agregar_* con sus tipos) llevan una entrada por
    // fila, vacia si no aplica.
    paresModificar() {
      var pares = [];
      this.filas.forEach(function (f) {
        if (f.ligada && f.quitada) pares.push(['quitar_categoria', f.categoria]);
        else if (!f.ligada) {
          pares.push(['agregar_categoria', f.categoria], ['agregar_pct', f.valor],
                     ['agregar_tipo_iniciativa', f.tipoIniciativa || ''], ['agregar_tipo_agrupado', f.tipoAgrupado || '']);
        } else {
          if (f.valor !== f.original || f.agrupNueva) {
            pares.push(['pct_categoria', f.categoria], ['pct_valor', f.valor], ['pct_tipo_agrupado', f.agrupNueva || '']);
          }
          if (f.fPropia && f.fPropiaNueva !== f.fPropia) pares.push(['fcat_categoria', f.categoria], ['fcat_analisis', f.fPropiaNueva]);
        }
      });
      return pares;
    }

    // Para Incompleta (forma de datosDeRegistro).
    comoRegistro() {
      return this.activas().map(function (f) {
        return { categoria: f.categoria, pct_dism: f.valor === '' || FORMATO.pct(f.valor) ? null : Number(f.valor) / 100 };
      });
    }
  }

  // Tabla de categorias (Crear y Modificar). prefijo: de los ids/atributos.
  // vol: VolumetriaCliente o null. fechas (solo Modificar): { f_analisis
  // de la iniciativa, tiposIniciativa, tiposAgrupado }. Agrega dos columnas:
  //   Agrupacion        la de la ligada (o un selector si no tiene); en una
  //                     nueva, Clasificacion y Agrupacion a elegir.
  //   Fecha de analisis en una ligada que HEREDA, la de la iniciativa (se
  //                     cambia en "Fecha compromiso de Analisis"); en una
  //                     con fecha PROPIA, editable; en una nueva, la propia
  //                     calculada (dia en que se liga + 15), que fija el
  //                     servidor al guardar.
  // La meta de cada fila se escribe en % o en tickets (cats.modo) y el otro
  // valor se muestra calculado (MetaCategoria) con la volumetria de la fila:
  // en Crear (prefijo 'crear', sin fechas) las nuevas; en Modificar (ADM,
  // prefijo 'edicion') tambien las ligadas. Con volManual (sql/26, solo
  // Crear) la Volumetria se puede fijar a mano: vacia = la calculada.
  // fechas.puedeQuitar === false (Modificar sin sql/24): "Quitar" de una
  // ligada sale deshabilitado (la base no lo recibe; se rechazaria todo).
  function htmlCategorias(cats, vol, prefijo, fechas, volManual) {
    if (!cats.filas.length) return '<p class="ini-nota">Sin categorías todavía.</p>';
    var meta = (prefijo === 'crear' && !fechas) || prefijo === 'edicion', porTickets = meta && cats.modo === 'tickets';
    var conMeta = function (f) { return meta && !f.quitada && (!f.ligada || prefijo === 'edicion'); };
    function celdaVol(f, n) {
      if (f.quitada) return '—';
      var e = vol ? vol.estado(f.categoria) : null;
      if (!meta || f.ligada || !volManual) return htmlVolumetria(e);
      return '<label class="ini-ed-pct"><span class="ini-sr">Volumetría de ' + Escape.html(f.categoria) + '</span>' +
        '<input type="number" min="0" step="1" inputmode="numeric" data-crear-vol="' + n + '" value="' + Escape.attr(f.volManual) +
        '" placeholder="' + Escape.attr(typeof f.volCalc === 'number' ? String(f.volCalc) : '') + '"></label>' +
        '<small class="ini-vol-calc">Calculada: ' + htmlVolumetria(e) + '</small>';
    }
    function celdaPct(f, n) {
      if (f.quitada) return Escape.html(f.original === '' ? '—' : f.original + '%');
      var m = conMeta(f) ? cats.meta(f) : null;
      var salida = m ? ' <output class="ini-meta' + (m.mal ? ' mal' : '') + '" data-' + prefijo + '-meta="' + n + '">' + Escape.html(m.texto) + '</output>' : '';
      if (porTickets && conMeta(f)) {
        var vmax = cats.volumen(f);
        return '<label class="ini-ed-pct"><span class="ini-sr">Tickets a resolver de ' + Escape.html(f.categoria) + '</span>' +
          '<input type="number" min="0" step="1" inputmode="numeric"' + (vmax === null ? '' : ' max="' + vmax + '"') +
          ' data-' + prefijo + '-tickets="' + n + '" value="' +
          Escape.attr(cats.ticketsVista(f)) + '"> tickets</label>' + salida;
      }
      return '<label class="ini-ed-pct"><span class="ini-sr">% de ' + Escape.html(f.categoria) + '</span>' +
        '<input type="number" min="0" max="100" step="0.01" data-' + prefijo + '-pct="' + n + '" value="' +
        Escape.attr(f.valor) + '"> %</label>' + salida;
    }
    function celdaFecha(f, n) {
      if (f.quitada) return '—';
      if (f.ligada && f.fPropia) {
        return '<label class="ini-ed-pct"><span class="ini-sr">Fecha de análisis de ' + Escape.html(f.categoria) + '</span>' +
          '<input type="date" data-' + prefijo + '-fcat="' + n + '" value="' + Escape.attr(f.fPropiaNueva) + '"></label>' +
          ' <span class="ini-origen" title="dbo.ProblemCategoria.FechaAnalisisCategoria: se ligó después y tiene la suya">Propia</span>';
      }
      if (f.ligada) {
        return '<span class="ini-cat-fecha">' + Escape.html(fechaCorta(fechas.f_analisis)) +
          '</span> <span class="ini-origen derivado" title="Hereda la de la iniciativa (dbo.Problem.FechaAnalisis): se cambia en Fecha compromiso de Análisis">De la iniciativa</span>';
      }
      return '<span class="ini-cat-fecha">' + Escape.html(fechaCorta(f.fAnalisis)) + '</span>' +
        ' <span class="ini-origen derivado" title="Se liga el ' + Escape.attr(fechaCorta(f.fCreacion)) +
        ': análisis = ese día + ' + FECHAS_GESTION.diasAnalisis + ' días. La fija el servidor al guardar.">Calculada</span>';
    }
    function opcionesTipo(lista, valor, atributo, rotulo) {
      return '<label class="ini-ed-tipo"><span class="ini-sr">' + Escape.html(rotulo) + '</span>' +
        '<select ' + atributo + '><option value="">— ' + Escape.html(rotulo) + ' —</option>' +
        (lista || []).map(function (o) {
          return '<option value="' + Escape.attr(o) + '"' + (o === valor ? ' selected' : '') + '>' + Escape.html(o) + '</option>';
        }).join('') + '</select></label>';
    }
    function celdaTipo(f, n) {
      if (f.quitada) return '—';
      var attr = function (campo) { return 'data-' + prefijo + '-tipo="' + n + '|' + campo + '"'; };
      if (!f.ligada) {
        return opcionesTipo(fechas.tiposIniciativa, f.tipoIniciativa, attr('tipo_iniciativa'), 'Clasificación') + ' ' +
          opcionesTipo(fechas.tiposAgrupado, f.tipoAgrupado, attr('tipo_agrupado'), 'Agrupación');
      }
      if (f.agrup) return Escape.html(f.agrup);
      return opcionesTipo(fechas.tiposAgrupado, f.agrupNueva, attr('tipo_agrupado'), 'Agrupación') +
        ' <span class="ini-origen" title="Opcional. Sin agrupación, el servidor revisa su tope como si consumiera">Sin declarar</span>';
    }
    var sinQuitar = fechas && fechas.puedeQuitar === false;
    return '<div class="ini-det-tabla"><table class="ini-cats-tabla"><thead><tr><th scope="col">Categoría</th>' +
      '<th scope="col">Volumetría ' + (meta && volManual ? '<span class="ini-origen">Editable</span>'
        : '<span class="ini-origen derivado">Calculada</span>') + '</th>' +
      '<th scope="col">' + (porTickets ? 'Tickets a resolver' : '% Disminución') + '</th>' + (fechas ? '<th scope="col">Agrupación</th><th scope="col">Fecha de análisis</th>' : '') +
      '<th scope="col"><span class="ini-sr">Acción</span></th></tr></thead><tbody>' +
      cats.filas.map(function (f, n) {
        var estado = f.quitada ? '<span class="ini-cat-estado">Se quitará</span>'
          : !f.ligada ? '<span class="ini-cat-estado nueva">Nueva</span>' : '';
        var pct = celdaPct(f, n);
        var boton = f.quitada
          ? '<button type="button" class="btn linea chico" data-' + prefijo + '-cat="restaurar" data-indice="' + n + '">Restaurar</button>'
          : sinQuitar && f.ligada
            ? '<button type="button" class="btn linea chico" disabled title="Quitar una categoría ligada todavía no se guarda: falta aplicar sql/24 en la base">Quitar</button>'
            : '<button type="button" class="btn linea chico" data-' + prefijo + '-cat="quitar" data-indice="' + n + '">Quitar</button>';
        return '<tr' + (f.quitada ? ' class="ini-cat-quitada"' : '') + '><td><span class="ini-cat-ruta">' +
          Escape.html(f.categoria) + '</span> ' + estado + '</td><td>' +
          celdaVol(f, n) + '</td><td>' + pct + '</td>' +
          (fechas ? '<td>' + celdaTipo(f, n) + '</td><td>' + celdaFecha(f, n) + '</td>' : '') + '<td>' + boton + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  // ---------------------------------------------------------------------
  // RespuestaGestion: lo que contesto admin_iniciativas_gestion.ashx
  // ---------------------------------------------------------------------
  // Estados excluyentes. "guardada" es el UNICO que dice que algo se guardo,
  // y solo con 200 + guardada === true (+ codigo en un alta): la respuesta
  // de la base, nunca la de la validacion.
  //   guardada       200: la base confirmo (PersistenciaGestionAdmin activa)
  //   no_habilitada  501: valida en el servidor, NO guardada
  //   invalida       422: errores por campo
  //   rechazada      409: la base (o un pendiente sin regla) lo rechazo: nada guardado
  //   no_confirmada  500 EscrituraNoConfirmada: no se sabe si se guardo
  //   denegado       403: sin rol ADM (o sin acceso)
  //   no_disponible  503: no se pudo leer el catalogo; no se sabe si es valida
  //   error          cualquier otra cosa (red, 500, respuesta ilegible)
  var RespuestaGestion = {
    desde: function (estado, json) {
      json = json && typeof json === 'object' ? json : null;
      var tipo = json && json.tipo;
      var codigo = json && typeof json.codigo === 'string' && json.codigo.trim() ? json.codigo : null;
      // 200 sin accion, o alta sin codigo: no es exito (error).
      var e = estado === 200 && json && json.guardada === true &&
              (json.accion === 'modificar' || (json.accion === 'crear' && codigo)) ? 'guardada'
        : estado === 501 && tipo === 'PersistenciaNoHabilitada' && json.valida === true && json.guardada === false ? 'no_habilitada'
        : estado === 422 && json && json.valida === false ? 'invalida'
        : estado === 409 && json && json.guardada === false ? 'rechazada'
        : estado === 500 && tipo === 'EscrituraNoConfirmada' ? 'no_confirmada'
        : estado === 403 ? 'denegado'
        : estado === 503 ? 'no_disponible'
        : 'error';
      return {
        estado: e,
        guardada: e === 'guardada',
        codigo: e === 'guardada' ? codigo : null,
        errores: e === 'invalida' && Array.isArray(json.errores) ? json.errores : [],
        advertencias: json && Array.isArray(json.advertencias) ? json.advertencias : [],
        cambios: json && Array.isArray(json.cambios) ? json.cambios : [],
        faltantes: json && Array.isArray(json.faltantes) ? json.faltantes : [],
        bloqueos: json && Array.isArray(json.bloqueos) ? json.bloqueos : [],
        mensaje: e === 'guardada' ? 'Guardado en la base.' : (json && (json.persistencia_motivo || json.error)) ||
          (estado ? 'El servidor respondió ' + estado + '.' : 'No se pudo contactar al servidor.')
      };
    },
    titulo: function (r) {
      return {
        guardada: 'Guardado en la base' + (r.codigo ? ' · Código ' + r.codigo : '') + '.',
        no_habilitada: 'Solo validación: los datos son válidos en el servidor, pero NO se guardó nada. ' +
          'No se guardó: la persistencia no está habilitada.',
        invalida: 'El servidor rechazó los datos (no se guardó nada):',
        rechazada: 'La base rechazó el guardado. No se guardó nada:',
        no_confirmada: 'No se pudo confirmar si se guardó. Revisa el registro antes de reintentar.',
        denegado: 'Sin permiso: solo un administrador (ADM) puede hacerlo. No se validó ni se guardó nada.',
        no_disponible: 'No se pudo validar en el servidor (catálogo no disponible). No se guardó nada.',
        error: 'No se pudo completar la validación. No se guardó nada.'
      }[r.estado];
    }
  };

  // POST multipart al handler; pares: [[clave, valor], ...] (valor puede
  // ser un File). pedir: fetch por omision.
  function enviarGestion(pares, pedir) {
    var datos = new FormData();
    pares.forEach(function (p) { datos.append(p[0], p[1]); });
    pedir = pedir || function (url, op) { return fetch(url, op); };
    return Promise.resolve()
      .then(function () { return pedir(URL_GESTION, { method: 'POST', body: datos, cache: 'no-store' }); })
      .then(function (r) {
        return r.json().catch(function () { return null; }).then(function (json) { return RespuestaGestion.desde(r.status, json); });
      }, function () { return RespuestaGestion.desde(0, null); });
  }

  // ---------------------------------------------------------------------
  // BorradorAdmin: alta directa de ADM, sin DOM
  // ---------------------------------------------------------------------
  // catalogo: CatalogoIniciativas de admin/iniciativas.js (tipos, nombres,
  // tipoProblem, asignaciones = filas { director, po, so, categoria (ruta) }).
  class BorradorAdmin {
    constructor(catalogo) {
      this.catalogo = catalogo;
      this.tipo = '';
      this.valores = { titulo: '', descripcion: '', observaciones: '' };
      // Clasificacion y Agrupacion: del Tipo (elegirTipo). Estado: declarado.
      // La fecha de entrega del analisis empieza en hoy y ADM la puede cambiar.
      this.declarados = { tipo_iniciativa: '', tipo_agrupado: '', estado: '', subestado: '', f_entrega_analisis: FECHAS_GESTION.hoy() };
      // ADM elige entre TODAS las rutas activas (rutas_adm) aunque les
      // falten dueños; sin ellas, las de la cascada.
      this.categorias = new CategoriasProblema([], BorradorAdmin.rutasAdmDe(catalogo));
      this.rca = null;   // nombre del archivo elegido; no se sube
      // PO / SO: lo escrito en cada caja y la opcion real que le toca
      // ('' si no coincide con ninguna). Independientes entre si.
      this.duenosLista = { po: BorradorAdmin.valoresDe(catalogo, 'po'), so: BorradorAdmin.valoresDe(catalogo, 'so') };
      this.duenosTexto = { po: '', so: '' };
      this.duenos = { po: '', so: '' };
    }

    // Los valores distintos de un campo del catalogo (po / so), ordenados.
    static valoresDe(catalogo, campo) {
      var vistos = {}, salida = [];
      ((catalogo && catalogo.asignaciones) || []).forEach(function (f) {
        var v = f[campo] === null || f[campo] === undefined ? '' : String(f[campo]).trim();
        if (v && !vistos[llaveRuta(v)]) { vistos[llaveRuta(v)] = true; salida.push(v); }
      });
      return salida.sort(function (a, b) { return a.localeCompare(b, 'es'); });
    }

    // Elegir PO o SO de su lista. Vacio = sin elegir. Lo que no es una
    // opcion real no elige nada (y se avisa). Nunca toca el otro dueño ni
    // las categorias.
    elegirDueno(campo, texto) {
      if (!Object.prototype.hasOwnProperty.call(DUENOS, campo)) return { ok: false, mensaje: '' };
      var t = String(texto === null || texto === undefined ? '' : texto).trim();
      this.duenosTexto[campo] = t;
      this.duenos[campo] = t ? Selector.resolver(t, this.duenosLista[campo]) : '';
      if (t && !this.duenos[campo]) return { ok: false, mensaje: noEnLista(t, this.duenosLista[campo], DUENOS[campo]) };
      return { ok: true, valor: this.duenos[campo] };
    }

    // Las rutas distintas del catalogo, en su orden.
    static rutasDe(catalogo) {
      var vistas = {}, salida = [];
      ((catalogo && catalogo.asignaciones) || []).forEach(function (f) {
        if (f.categoria && !vistas[f.categoria]) { vistas[f.categoria] = true; salida.push(f.categoria); }
      });
      return salida;
    }

    // Las rutas que ADM puede elegir: rutasAdm (todas las activas, con o
    // sin dueños) si el servidor las mando; si no, las de la cascada.
    static rutasAdmDe(catalogo) {
      if (!catalogo || !Array.isArray(catalogo.rutasAdm)) return BorradorAdmin.rutasDe(catalogo);
      var vistas = {}, salida = [];
      catalogo.rutasAdm.forEach(function (f) {
        if (f.categoria && !vistas[f.categoria]) { vistas[f.categoria] = true; salida.push(f.categoria); }
      });
      return salida;
    }

    // Los dueños que le FALTAN a una ruta en el catalogo de dueños
    // (['Director', 'Product Owner', 'Service Owner'] o parte), [] si los
    // tiene o si no es una ruta conocida. Solo informa: no se inventan.
    static duenosFaltantes(catalogo, ruta) {
      var k = llaveRuta(ruta), fila = null;
      (catalogo && Array.isArray(catalogo.rutasAdm) ? catalogo.rutasAdm : []).some(function (f) {
        if (llaveRuta(f.categoria) === k) { fila = f; return true; }
        return false;
      });
      if (!fila) return [];
      var faltan = [];
      if (!fila.director) faltan.push('Director');
      if (!fila.po) faltan.push('Product Owner');
      if (!fila.so) faltan.push('Service Owner');
      return faltan;
    }

    // Clasificacion y Agrupacion salen del Tipo (TiposPorPrefijo).
    elegirTipo(valor) {
      this.tipo = valor && this.catalogo.tieneTipo(valor) ? valor : '';
      this.declarados.tipo_iniciativa = TiposPorPrefijo.clasificacion(this.tipo);
      this.declarados.tipo_agrupado = TiposPorPrefijo.agrupacion(this.declarados.tipo_iniciativa);
      return this.tipo !== '';
    }

    agregarCategoria(texto) { return this.categorias.agregar(texto); }

    // Clasificacion y Agrupacion no se capturan: las fija elegirTipo.
    capturar(clave, texto) {
      if (clave === 'tipo_iniciativa' || clave === 'tipo_agrupado') return;
      if (Object.prototype.hasOwnProperty.call(this.valores, clave)) this.valores[clave] = String(texto || '');
      else if (Object.prototype.hasOwnProperty.call(this.declarados, clave)) this.declarados[clave] = String(texto || '').trim();
    }

    elegirRca(archivo) { this.rca = archivo && archivo.size > 0 ? String(archivo.name || 'archivo') : null; }

    esProblem() { return this.tipo !== '' && this.tipo === this.catalogo.tipoProblem; }

    // El Director de las categorias elegidas, si es uno solo; si no, ''.
    director() {
      var rutas = {};
      this.categorias.activas().forEach(function (f) { rutas[llaveRuta(f.categoria)] = true; });
      var vistos = {};
      // Con rutasAdm, el Director resuelto de cada ruta (aunque le falte PO
      // o SO); sin ellas, el de la cascada.
      var filas = Array.isArray(this.catalogo.rutasAdm) ? this.catalogo.rutasAdm : (this.catalogo.asignaciones || []);
      filas.forEach(function (f) {
        if (rutas[llaveRuta(f.categoria)] && f.director) vistos[f.director] = true;
      });
      var lista = Object.keys(vistos);
      return lista.length === 1 ? lista[0] : '';
    }

    // Lo unico que impide guardar: sin tipo no hay prefijo de codigo.
    // Clasificacion, Agrupacion y Estado pueden faltar (Incompleta).
    bloqueantes() { return this.tipo ? [] : [{ clave: 'tipo', mensaje: 'Elige el Tipo de iniciativa: define el prefijo del código.' }]; }

    erroresFormato() {
      var e = FORMATO.fecha(this.declarados.f_entrega_analisis), self = this;
      var duenos = Object.keys(DUENOS).filter(function (k) { return self.duenosTexto[k] && !self.duenos[k]; })
        .map(function (k) { return { clave: k, mensaje: noEnLista(self.duenosTexto[k], self.duenosLista[k], DUENOS[k]) }; });
      return (e ? [{ clave: 'f_entrega_analisis', mensaje: 'Fecha de entrega del análisis: ' + e }] : [])
        .concat(duenos, this.categorias.erroresFormato());
    }

    datos() {
      var v = this.valores, cats = this.categorias.comoRegistro();
      return {
        categoria: cats.length ? 'si' : '', titulo: v.titulo, descripcion: v.descripcion,
        observaciones: v.observaciones,
        // Sin categorias el % no se pide aparte (ya falta "Categoría").
        pct: !cats.length ? undefined : (cats.every(function (c) { return c.pct_dism !== null; }) ? 'si' : ''),
        rca: this.rca || '',
        tipo_iniciativa: this.declarados.tipo_iniciativa, tipo_agrupado: this.declarados.tipo_agrupado,
        estado: this.declarados.estado
      };
    }

    // Con varias categorias, el faltante de % dice CUALES no lo tienen.
    faltantes() {
      var sinPct = this.categorias.activas().filter(function (f) { return f.valor === ''; })
        .map(function (f) { return f.categoria; });
      return Incompleta.faltantes(this.datos(), this.esProblem()).map(function (f) {
        return f.clave === 'pct' && sinPct.length ? { clave: f.clave, rotulo: f.rotulo + ' (sin %: ' + sinPct.join(', ') + ')' } : f;
      });
    }

    // Lo que viaja al servidor (accion=crear). El archivo del RCA lo pone la
    // vista. PO / SO: la opcion real elegida, o vacio (opcionales).
    // volumetria: solo si ADM fijo alguna (la suma, volumetriaProblema); sin
    // ella no viaja y la base guarda NULL, como siempre. El % de cada
    // categoria es el que se ve, escrito o calculado de los tickets.
    // subestado: solo si ADM eligio uno (sql/27); sin el no viaja.
    paraEnviar() {
      var v = this.valores;
      var d = this.declarados;
      var vol = this.categorias.volumetriaProblema();
      return [['accion', 'crear'], ['tipo', this.tipo], ['po', this.duenos.po], ['so', this.duenos.so],
        ['tipo_iniciativa', d.tipo_iniciativa], ['tipo_agrupado', d.tipo_agrupado], ['estado', d.estado],
        ['f_entrega_analisis', d.f_entrega_analisis],
        ['titulo', v.titulo], ['descripcion', v.descripcion], ['observaciones', v.observaciones]]
        .concat(d.subestado ? [['subestado', d.subestado]] : [], vol === '' ? [] : [['volumetria', vol]], this.categorias.paresCrear());
    }

    // Lo que veria quien revisa el borrador. NO es un guardado.
    revisar() {
      var bloq = this.bloqueantes(), formato = this.erroresFormato(), faltan = this.faltantes();
      return {
        listo: bloq.length === 0 && formato.length === 0,
        bloqueantes: bloq,
        formato: formato,
        incompleta: faltan.length > 0,
        faltantes: faltan,
        codigo: null,          // nunca se inventa: lo asigna la base
        guardado: false,       // la revision local nunca guarda
        aviso: AVISO_REVISION
      };
    }
  }

  // ---------------------------------------------------------------------
  // BuscadorProblemas: "Ligar a un problema existente"
  // ---------------------------------------------------------------------
  // Busca en las iniciativas del registro (admin_iniciativas_registro.ashx)
  // por codigo (completo o parcial) o por parte del titulo, con la MISMA
  // Busqueda del registro (registro-iniciativas.js). No inventa ni crea
  // nada: solo devuelve las que existen.
  var MAX_RESULTADOS = 20;

  var BuscadorProblemas = {
    MAX: MAX_RESULTADOS,
    buscar: function (iniciativas, texto) {
      var B = window.RegistroIniciativas && window.RegistroIniciativas.Busqueda;
      var lista = Array.isArray(iniciativas) ? iniciativas : [];
      if (!B || vacio(texto)) return { total: 0, resultados: [] };
      var b = new B(String(texto));
      var todas = lista.filter(function (i) {
        // Busqueda compara por i.titulo: tambien el del Problem, si difiere.
        return b.pasa(i) || (i.titulo_problem && b.pasa({ folio: '', titulo: i.titulo_problem }));
      });
      return { total: todas.length, resultados: todas.slice(0, MAX_RESULTADOS) };
    }
  };

  function htmlResultadosProblemas(r, texto) {
    if (vacio(texto)) return '<p class="ini-nota">Escribe parte del código o del nombre del problema.</p>';
    if (!r.total) return '<p class="ini-nota">No hay problemas que coincidan con «' + Escape.html(String(texto).trim()) + '». ' +
      'No se crea nada nuevo desde aquí.</p>';
    return '<p class="ini-nota">' + r.total + (r.total === 1 ? ' coincidencia' : ' coincidencias') +
      (r.total > r.resultados.length ? '; se muestran las primeras ' + r.resultados.length + '. Escribe más para acotar.' : '.') + '</p>' +
      '<ul class="ini-existentes">' + r.resultados.map(function (i) {
        var cats = (i.categorias || []).length;
        var tit = i.titulo_problem || i.titulo || '(sin título)';
        return '<li><button type="button" class="ini-existente" data-existente="' + Escape.attr(i.folio) + '">' +
          '<strong>' + Escape.html(i.folio) + '</strong> · ' + Escape.html(tit) +
          '<span class="ini-sub">' + Escape.html(i.estado || 'Sin estado') + ' · ' +
          (i.sin_categoria || !cats ? 'sin categorías' : cats + (cats === 1 ? ' categoría' : ' categorías')) +
          (typeof i.antiguedad === 'number' ? ' · ' + Escape.html(Duracion.dias(i.antiguedad)) : '') +
          (i.titulo && i.titulo_problem && i.titulo !== i.titulo_problem ? ' · iniciativa: ' + Escape.html(i.titulo) : '') +
          '</span></button></li>';
      }).join('') + '</ul>';
  }

  // ---------------------------------------------------------------------
  // CAMPOS_EDICION
  // ---------------------------------------------------------------------
  //   editable      se puede editar; destino propuesto, persistencia pendiente.
  //   pendiente     falta una decision o un contrato; con el motivo.
  //   solo_lectura  derivado o calculado; nunca se edita aqui.
  var CAMPOS_EDICION = [
    { clave: 'titulo', rotulo: 'Título', estado: 'editable', control: 'texto',
      destino: 'dbo.Problem.Titulo' },
    { clave: 'descripcion', rotulo: 'Descripción', estado: 'editable', control: 'multilinea',
      destino: 'dbo.Problem.Descripcion' },
    { clave: 'observaciones', rotulo: 'Observaciones', estado: 'editable', control: 'multilinea',
      destino: 'dbo.Problem.Observaciones' },
    { clave: 'f_analisis', rotulo: 'Fecha compromiso de Análisis', estado: 'editable', control: 'fecha',
      destino: 'dbo.Problem.FechaAnalisis (historial: trg_Problem_FechaEvento)' },
    { clave: 'f_solucion', rotulo: 'Fecha compromiso de Solución', estado: 'editable', control: 'fecha',
      destino: 'dbo.Problem.FechaSolucion (historial: trg_Problem_FechaEvento)' },
    { clave: 'f_cierre', rotulo: 'Fecha compromiso de Cierre', estado: 'editable', control: 'fecha',
      destino: 'dbo.Problem.FechaCierre (historial: trg_Problem_FechaEvento)' },
    { clave: 'estado', rotulo: 'Estado', estado: 'editable', control: 'lista', lista: 'estados',
      destino: 'dbo.Problem.Estado (historial: trg_Problem_EstadoEvento)' },
    { clave: 'subestado', rotulo: 'Subestado', estado: 'editable', control: 'lista', lista: 'subestados',
      destino: 'dbo.Problem.Subestado' },
    // PO / SO de la INICIATIVA (los capturados), no los de su categoría.
    // Solo se ofrecen con sql/24 en la base (edicion_duenos_quitar).
    { clave: 'po', rotulo: 'Product Owner capturado', estado: 'editable', control: 'lista', lista: 'pos',
      destino: 'dbo.Problem.OwnerProblem (sql/24); los dueños de la categoría no cambian' },
    { clave: 'so', rotulo: 'Service Owner capturado', estado: 'editable', control: 'lista', lista: 'sos',
      destino: 'dbo.Problem.OwnerServicio (sql/24); los dueños de la categoría no cambian' },
    { clave: 'categorias', rotulo: 'Categorías y % de disminución', estado: 'editable', control: 'categorias',
      destino: 'dbo.ProblemCategoria (Categoria, PctDisminucion en fracción)' },
    { clave: 'rca', rotulo: 'RCA', estado: 'pendiente',
      motivo: 'El destino del documento (SharePoint) y su referencia siguen sin decidir.' },
    { clave: 'codigo', rotulo: 'Código y Tipo de iniciativa', estado: 'solo_lectura',
      motivo: 'Identifican la iniciativa y nunca cambian; el tipo es el prefijo del código.' },
    { clave: 'duenos', rotulo: 'Director, Product Owner, Service Owner y Manager de la categoría', estado: 'solo_lectura',
      motivo: 'Se derivan de la categoría (CatCategoriaDueno / CatPersona).' },
    { clave: 'calculados', rotulo: 'Volumetría, tickets a reducir, en riesgo, antigüedad y semáforo', estado: 'solo_lectura',
      motivo: 'Los calcula la base o el servidor.' }
  ];

  var CAMPOS_PROBLEMA = ['titulo', 'descripcion', 'observaciones', 'f_analisis', 'f_solucion', 'f_cierre', 'estado', 'subestado', 'po', 'so'];
  // De una lista, recortados al comparar (como Estado / Subestado).
  var CAMPOS_LISTA = ['estado', 'subestado', 'po', 'so'];

  function claves(lista) { return lista.map(function (f) { return f.clave; }); }
  // Texto largo con los saltos de linea que devuelve un <textarea> (\n).
  function lineas(v) { return typeof v === 'string' ? v.replace(/\r\n?/g, '\n') : ''; }
  function campo(clave) { return CAMPOS_EDICION.filter(function (c) { return c.clave === clave; })[0]; }

  // ---------------------------------------------------------------------
  // EdicionAdmin: edicion directa de una iniciativa del registro, sin DOM
  // ---------------------------------------------------------------------
  // opciones: { rutas: [...] (catalogo vigente, para agregar),
  //             estados: [...], subestados: [...] (los que ya existen),
  //             pos: [...], sos: [...] (PO / SO del catalogo, los del alta),
  //             duenosYQuitar: true solo con sql/24 en la base }.
  // Sin rutas no se puede agregar; sin listas no se puede cambiar Estado
  // ni Subestado (el servidor tambien lo rechaza). Sin duenosYQuitar no
  // se ofrecen PO / SO y quitar se avisa como no guardable.
  class EdicionAdmin {
    constructor(iniciativa, opciones) {
      opciones = opciones || {};
      this.iniciativa = iniciativa;
      this.listas = {
        estados: Array.isArray(opciones.estados) ? opciones.estados : [],
        subestados: Array.isArray(opciones.subestados) ? opciones.subestados : [],
        tiposIniciativa: Array.isArray(opciones.tiposIniciativa) ? opciones.tiposIniciativa : [],
        tiposAgrupado: Array.isArray(opciones.tiposAgrupado) ? opciones.tiposAgrupado : [],
        pos: Array.isArray(opciones.pos) ? opciones.pos : [],
        sos: Array.isArray(opciones.sos) ? opciones.sos : []
      };
      this.duenosYQuitar = opciones.duenosYQuitar === true;
      // El Titulo editable es el del Problem (titulo_problem); `titulo`
      // puede ser el TituloIniciativa, cuya columna no se escribe aqui.
      var tit = iniciativa.titulo_problem !== undefined ? iniciativa.titulo_problem : iniciativa.titulo;
      this.original = {
        titulo: tit || '',
        // Un CRLF de la base no cuenta como cambio solo por pasar por el
        // control (el navegador lo vuelve \n).
        descripcion: lineas(iniciativa.descripcion),
        observaciones: lineas(iniciativa.observaciones),
        f_analisis: iniciativa.f_analisis || '',
        f_solucion: iniciativa.f_solucion || '',
        f_cierre: iniciativa.f_cierre || '',
        estado: iniciativa.estado || '',
        subestado: iniciativa.subestado || '',
        // Los CAPTURADOS (dbo.Problem), no los de la categoría (po / so).
        po: iniciativa.po_capturado || '',
        so: iniciativa.so_capturado || ''
      };
      this.valores = {};
      var self = this;
      CAMPOS_PROBLEMA.forEach(function (k) { self.valores[k] = self.original[k]; });
      this.categorias = new CategoriasProblema(iniciativa.categorias || [], opciones.rutas);
      // 'cargando' | 'error' | 'ok' del catalogo de rutas (para el aviso).
      this.rutasEstado = opciones.rutasEstado || (Array.isArray(opciones.rutas) && opciones.rutas.length ? 'ok' : '');
      // Compatibilidad: valores.pct son las filas de categorias.
      this.valores.pct = this.categorias.filas;
    }

    static campos(estado) {
      return CAMPOS_EDICION.filter(function (c) { return !estado || c.estado === estado; });
    }

    // Subestado solo si el registro lo trajo (si no, no se sabe el actual).
    conoceSubestado() { return this.iniciativa.subestado !== undefined; }

    capturar(clave, texto) {
      if (CAMPOS_PROBLEMA.indexOf(clave) >= 0) this.valores[clave] = String(texto === null || texto === undefined ? '' : texto);
    }

    capturarPct(indice, texto) { this.categorias.capturarPct(indice, texto); }

    // Meta en tickets (ADM): el % sale de la volumetria de 30 dias de la fila.
    capturarTickets(indice, texto) { return this.categorias.capturarTickets(indice, texto); }

    elegirModo(modo) { return this.categorias.elegirModo(modo); }

    capturarTipo(indice, campo, texto) { return this.categorias.capturarTipo(indice, campo, texto); }

    capturarFechaCategoria(indice, texto) { return this.categorias.capturarFecha(indice, texto); }

    // -> [{ clave, rotulo, anterior, nuevo }]
    cambios() {
      var self = this, salida = [];
      CAMPOS_PROBLEMA.forEach(function (k) {
        var nuevo = k.indexOf('f_') === 0 || CAMPOS_LISTA.indexOf(k) >= 0 ? self.valores[k].trim() : self.valores[k];
        if (nuevo !== self.original[k]) {
          salida.push({ clave: k, rotulo: campo(k).rotulo, anterior: self.original[k], nuevo: nuevo });
        }
      });
      return salida.concat(this.categorias.cambios());
    }

    // Lo que viaja al servidor (accion=modificar): SOLO lo que cambio; el
    // folio identifica (nunca cambia); el servidor vuelve a comparar.
    paraEnviar() {
      var pares = [['accion', 'modificar'], ['folio', this.iniciativa.folio]];
      this.cambios().forEach(function (c) {
        if (CAMPOS_PROBLEMA.indexOf(c.clave) >= 0) pares.push([c.clave, c.nuevo]);
      });
      return pares.concat(this.categorias.paresModificar());
    }

    erroresFormato() {
      var self = this, errores = [];
      ['f_analisis', 'f_solucion', 'f_cierre'].forEach(function (k) {
        var e = FORMATO.fecha(self.valores[k].trim());
        if (e) errores.push({ clave: k, mensaje: campo(k).rotulo + ': ' + e });
      });
      [['estado', 'estados'], ['subestado', 'subestados']].forEach(function (par) {
        var v = self.valores[par[0]].trim();
        if (v === self.original[par[0]]) return;
        if (!self.listas[par[1]].length) errores.push({ clave: par[0], mensaje: campo(par[0]).rotulo + ': no hay lista de valores; no se puede cambiar.' });
        else if (self.listas[par[1]].indexOf(v) < 0) errores.push({ clave: par[0], mensaje: campo(par[0]).rotulo + ': elige un valor de la lista.' });
      });
      // PO / SO capturados: de su lista o vacío (se vacía); sin sql/24 no
      // se pueden cambiar (el servidor también lo rechaza).
      [['po', 'pos'], ['so', 'sos']].forEach(function (par) {
        var v = self.valores[par[0]].trim();
        if (v === self.original[par[0]]) return;
        if (!self.duenosYQuitar) errores.push({ clave: par[0], mensaje: campo(par[0]).rotulo + ': todavía no se guarda (falta sql/24 en la base).' });
        else if (v !== '' && self.listas[par[1]].indexOf(v) < 0) errores.push({ clave: par[0], mensaje: campo(par[0]).rotulo + ': elige un valor de la lista o déjalo vacío.' });
      });
      // Quitar sin sql/24: la base rechazaria TODO el guardado (409
      // PendienteSinRegla); se dice aqui, antes de enviar, y nada se pierde.
      if (!this.duenosYQuitar && this.categorias.filas.some(function (f) { return f.ligada && f.quitada; })) {
        errores.push({ clave: 'quitar_categoria', mensaje: 'Quitar categorías todavía no se guarda: falta aplicar sql/24 en la base. ' +
          'Usa «Restaurar» en la categoría marcada para guardar lo demás.' });
      }
      return errores.concat(this.categorias.erroresFormato());
    }

    // La iniciativa como quedaria, para la marca derivada.
    faltantes() {
      var vista = {}, i = this.iniciativa;
      Object.keys(i).forEach(function (k) { vista[k] = i[k]; });
      vista.categorias = this.categorias.comoRegistro();
      vista.sin_categoria = !vista.categorias.length;
      return Incompleta.faltantes(Incompleta.datosDeRegistro(vista), false);
    }

    // Lo que ya faltaba ANTES de modificar (misma regla de existentes).
    faltantesOriginales() {
      return Incompleta.faltantes(Incompleta.datosDeRegistro(this.iniciativa), false);
    }

    vistaPrevia() {
      var antes = claves(this.faltantesOriginales()), despues = this.faltantes();
      var ahora = claves(despues);
      return {
        cambios: this.cambios(),
        formato: this.erroresFormato(),
        nuevasFaltas: despues.filter(function (f) { return antes.indexOf(f.clave) < 0; }),
        resueltas: this.faltantesOriginales().filter(function (f) { return ahora.indexOf(f.clave) < 0; })
      };
    }

    // Datos heredados de la carga (Excel/ETL) que esta pantalla CONSERVA.
    notasLegado() {
      var i = this.iniciativa, notas = [];
      if (i.titulo && i.titulo_problem !== undefined && i.titulo !== i.titulo_problem) {
        notas.push('El registro muestra el título de la iniciativa (dbo.ProblemCategoria.TituloIniciativa: "' + i.titulo +
          '"). Aquí se modifica el del Problem (dbo.Problem.Titulo); el otro se conserva.');
      }
      if (i.sin_categoria) {
        notas.push(this.duenosYQuitar
          ? 'Sin categoría: sus dueños son los capturados en el Problem (OwnerProblem, OwnerServicio, Direccion). ' +
            'Product Owner y Service Owner se cambian aquí; Direccion se conserva.'
          : 'Sin categoría: sus dueños son los capturados en el Problem (OwnerProblem, OwnerServicio, Direccion) ' +
            'y se conservan tal cual; aquí no se modifican.');
      }
      if (this.cambios().some(function (c) { return c.clave === 'po' || c.clave === 'so'; })) {
        notas.push('Product Owner / Service Owner capturados: solo cambian los de esta iniciativa; ' +
          'los dueños de sus categorías (y los filtros que los usan) no cambian.');
      }
      if (this.cambios().some(function (c) { return c.clave === 'estado' || c.clave === 'subestado'; })) {
        notas.push('No hay reglas de transición de Estado/Subestado verificadas: se ofrecen los valores que ya existen en los problemas.');
      }
      return notas;
    }

    revisar() {
      var formato = this.erroresFormato(), faltan = this.faltantes();
      return {
        listo: formato.length === 0,
        cambios: this.cambios(),
        formato: formato,
        incompleta: faltan.length > 0,
        faltantes: faltan,
        guardado: false,
        aviso: AVISO_PROTOTIPO
      };
    }
  }

  // ---------------------------------------------------------------------
  // HTML compartido
  // ---------------------------------------------------------------------
  function htmlFaltantes(faltan, nota) {
    if (!faltan.length) return '';
    return '<div class="ini-incompleta" role="note"><strong>Incompleta</strong> · faltan: ' +
      faltan.map(function (f) { return Escape.html(f.rotulo); }).join(', ') + '.' +
      (nota ? ' <span class="ini-incompleta-nota">' + Escape.html(nota) + '</span>' : '') + '</div>';
  }

  function htmlRevision(r, titulo) {
    var partes = ['<strong class="ini-prototipo-marca">' + Escape.html(titulo) + '</strong>'];
    var errores = (r.bloqueantes || []).concat(r.formato || []);
    if (errores.length) {
      partes.push('<ul>' + errores.map(function (e) { return '<li>' + Escape.html(e.mensaje) + '</li>'; }).join('') + '</ul>');
    }
    if (r.cambios) {
      partes.push(r.cambios.length
        ? '<ul>' + r.cambios.map(function (c) {
            return '<li>' + Escape.html(c.rotulo) + ': ' + Escape.html(c.anterior === '' ? '(vacío)' : c.anterior) +
              ' → ' + Escape.html(c.nuevo === '' ? '(vacío)' : c.nuevo) + '</li>';
          }).join('') + '</ul>'
        : '<p>Sin cambios.</p>');
    }
    partes.push(r.incompleta ? htmlFaltantes(r.faltantes) : '<p>Sin datos faltantes.</p>');
    partes.push('<p class="ini-prototipo-aviso">' + Escape.html(r.aviso) + '</p>');
    return partes.join('');
  }

  function claseRespuesta(r) {
    return r.estado === 'guardada' ? 'ok' : r.estado === 'no_habilitada' || r.estado === 'no_confirmada' ? 'aviso' : 'mal';
  }

  function htmlRespuesta(r) {
    var lista = function (xs, f) { return xs.length ? '<ul>' + xs.map(f).join('') + '</ul>' : ''; };
    var texto = function (v) { return v === '' || v === null || v === undefined ? '(vacío)' : String(v); };
    var partes = ['<strong class="ini-prototipo-marca">' + Escape.html(RespuestaGestion.titulo(r)) + '</strong>'];
    partes.push(lista(r.errores, function (e) { return '<li>' + Escape.html(e.mensaje) + '</li>'; }));
    if (r.estado === 'no_habilitada' || r.estado === 'guardada') {
      if (r.cambios.length) {
        partes.push('<p>' + (r.estado === 'guardada' ? 'Cambios guardados:' : 'Cambios validados (no guardados):') + '</p>' + lista(r.cambios, function (c) {
          return '<li>' + Escape.html(c.rotulo) + ': ' + Escape.html(texto(c.anterior)) + ' → ' + Escape.html(texto(c.nuevo)) + '</li>';
        }));
      }
      partes.push(r.faltantes.length ? htmlFaltantes(r.faltantes, 'Según el servidor.') : '<p>Sin datos faltantes.</p>');
    }
    partes.push(lista(r.advertencias, function (a) { return '<li>' + Escape.html(a) + '</li>'; }));
    if (r.estado === 'rechazada' || r.estado === 'no_confirmada') partes.push('<p>' + Escape.html(r.mensaje) + '</p>');
    else if (r.estado !== 'guardada' && (r.estado !== 'invalida' || !r.errores.length)) partes.push('<p class="ini-prototipo-aviso">' + Escape.html(r.mensaje) + '</p>');
    return partes.join('');
  }

  // Sin rutas para agregar: por que (estado del catalogo). 'cargando' y
  // 'error' nunca se ven como "no hay categorias".
  function htmlSinCatalogo(estado) {
    return '<p class="ini-nota">' + (estado === 'cargando' ? 'Cargando el catálogo de categorías…'
      : estado === 'error' ? 'No se pudo cargar el catálogo de categorías: no se pueden agregar categorías.'
      : 'El catálogo de categorías no está disponible: no se pueden agregar categorías.') + '</p>';
  }

  // Bloque de categorias de "Modificar" (se repinta solo).
  function htmlCategoriasEdicion(ed, vol) {
    var rutas = ed.categorias.rutas;
    var agregar = rutas.length
      ? '<div class="ini-cat-agregar"><label for="regEdCatBuscar">Agregar categoría</label>' +
          Selector.desplegable('regEdCatBuscar', rutas, '') +
          ' <button type="button" class="btn linea chico" data-accion="edicion-cat-agregar">Agregar</button></div>'
      : htmlSinCatalogo(ed.rutasEstado);
    // La volumetria que llego (ultimos 30 dias) recalcula el % de las
    // filas cuya meta se escribio en tickets; lo escrito no cambia.
    ed.categorias.sincronizarCalculadas(vol);
    var modo = ed.categorias.modo;
    var radio = function (valor, texto) {
      return '<label><input type="radio" name="regEdModo" value="' + valor + '" data-edicion-modo' +
        (modo === valor ? ' checked' : '') + '> ' + texto + '</label>';
    };
    var modos = ed.categorias.filas.length
      ? '<fieldset class="ini-campo ini-modo-meta"><legend>Planear la meta por</legend>' +
          radio('pct', '% de disminución') + ' ' + radio('tickets', 'Tickets a resolver') +
          '<small class="ini-motivo">Lo que escribes no cambia; el otro valor se calcula con los tickets de los últimos 30 días de cada categoría, ' +
          'redondeando hacia abajo. Se guarda el % (dos decimales); Tickets a reducir lo calcula la base con la misma volumetría.</small></fieldset>'
      : '';
    return modos + htmlCategorias(ed.categorias, vol, 'edicion', { f_analisis: ed.iniciativa.f_analisis,
        tiposIniciativa: ed.listas.tiposIniciativa, tiposAgrupado: ed.listas.tiposAgrupado,
        puedeQuitar: ed.duenosYQuitar }) + agregar +
      '<div class="ini-cambio-msg" id="regEdCatMsg" role="status" aria-live="polite"></div>' +
      '<small class="ini-sub">Destino: dbo.ProblemCategoria. Quitar = solo la asociación con esta iniciativa deja de estar vigente ' +
        '(VigenteEnOrigen = 0, la misma baja del cargador); no se borra la fila, ni la categoría, ni sus dueños.' +
        (ed.duenosYQuitar ? '' : ' Quitar una categoría ligada todavía no se guarda: falta aplicar sql/24 en la base; por eso su botón está deshabilitado.') +
        ' La volumetría son los tickets de la categoría en los últimos 30 días, calculada y de solo lectura.</small>' +
      '<small class="ini-sub">Fecha de análisis: las categorías iniciales heredan la de la iniciativa y cambian con ella ' +
        '(Fecha compromiso de Análisis). Una categoría ligada después tiene la suya: el día en que se liga + ' +
        FECHAS_GESTION.diasAnalisis + ' días, editable aquí, sin tocar la de la iniciativa. ' +
        'Clasificación y Agrupación de una categoría nueva son opcionales y no se copian de las otras.</small>';
  }

  // Edicion directa de ADM en el detalle del registro: cada campo del
  // Problem se pinta EN SU LUGAR (Identificacion, Seguimiento, Descripcion)
  // con este control: id regEd-<clave>, data-edicion=<clave>, el valor del
  // borrador y la marca ini-ed-cambiado si difiere del guardado. Estado /
  // Subestado sin lista de valores (o Subestado que el registro no trajo):
  // el valor en texto, no editable (el servidor tambien lo rechazaria).
  function htmlControlEdicion(ed, clave) {
    var c = campo(clave);
    if (!c || c.estado !== 'editable' || c.control === 'categorias') return '';
    if ((clave === 'po' || clave === 'so') && !ed.duenosYQuitar) return '';
    var id = 'regEd-' + clave, v = ed.valores[clave];
    var cambiado = ed.cambios().some(function (x) { return x.clave === clave; });
    var attrs = ' data-edicion="' + clave + '" aria-label="' + Escape.attr(c.rotulo) + '" class="ini-ed-campo' +
      (cambiado ? ' ini-ed-cambiado' : '') + '"';
    // El "\n" inicial lo descarta el parser de HTML: un texto que empieza
    // con salto de linea no lo pierde (ni parece cambiado).
    if (c.control === 'multilinea') return '<textarea id="' + id + '"' + attrs + ' rows="5">\n' + Escape.html(v) + '</textarea>';
    if (c.control === 'fecha') return '<input type="date" id="' + id + '"' + attrs + ' value="' + Escape.attr(v) + '">';
    if (c.control === 'lista') {
      if (clave === 'subestado' && !ed.conoceSubestado()) {
        return '<span class="ini-nota">El registro no trajo el Subestado: no se puede editar aquí.</span>';
      }
      if (!ed.listas[c.lista].length) {
        return Escape.html(v || '—') + ' <span class="ini-nota">sin lista de valores: no se puede cambiar.</span>';
      }
      var ops = ed.listas[c.lista].slice();
      if (v && ops.indexOf(v) < 0) ops.unshift(v);
      return Selector.html(id, ops, v, attrs);
    }
    return '<input type="text" id="' + id + '"' + attrs + ' value="' + Escape.attr(v) + '">';
  }

  // Barra "Cambios sin guardar" al pie del detalle (solo ADM). Se ve solo
  // con cambios; Guardar y Cancelar viven aqui. persiste: la persistencia
  // del registro (sin ella el boton solo valida y lo dice).
  function htmlBarraEdicion(persiste) {
    var boton = persiste === true ? 'Guardar cambios' : rotulos(false).boton;
    return '<div class="ini-ed-barra" id="regEdBarra" role="region" aria-label="Cambios sin guardar" hidden>' +
      '<div class="ini-ed-barra-fila">' +
        '<strong class="ini-ed-sucio" id="regEdSucio">Cambios sin guardar</strong>' +
        '<span class="ini-ed-barra-botones">' +
          '<button type="button" class="btn chico" id="regEdGuardar" data-accion="edicion-guardar">' + Escape.html(boton) + '</button> ' +
          '<button type="button" class="btn linea chico" id="regEdCancelar" data-accion="edicion-cancelar">Cancelar</button>' +
        '</span>' +
      '</div>' +
      (persiste === true ? '' : '<p class="ini-prototipo-aviso">' + Escape.html(rotulos(false).aviso) + '</p>') +
      '<details class="ini-ed-detalle"><summary>Ver cambios</summary><div class="ini-ed-vista" id="regEdVista" aria-live="polite"></div></details>' +
      '<div class="ini-cambio-msg" id="regEdMsg" role="status" aria-live="polite"></div>' +
    '</div>';
  }

  // Vista previa en vivo de "Modificar". Siempre dice que no se guarda.
  function htmlVistaPrevia(ed) {
    var v = ed.vistaPrevia();
    var fila = function (c) {
      return '<tr><th scope="row">' + Escape.html(c.rotulo) + '</th><td>' +
        Escape.html(c.anterior === '' ? '(vacío)' : c.anterior) + '</td><td>' +
        Escape.html(c.nuevo === '' ? '(vacío)' : c.nuevo) + '</td></tr>';
    };
    return '<h5>Cambios sin guardar</h5>' +
      (v.cambios.length
        ? '<div class="ini-det-tabla"><table><thead><tr><th scope="col">Campo</th><th scope="col">Actual</th>' +
          '<th scope="col">Propuesto</th></tr></thead><tbody>' + v.cambios.map(fila).join('') + '</tbody></table></div>'
        : '<p class="ini-nota">Sin cambios.</p>') +
      (v.formato.length ? '<ul class="ini-ed-errores">' + v.formato.map(function (e) {
        return '<li>' + Escape.html(e.mensaje) + '</li>'; }).join('') + '</ul>' : '') +
      (v.nuevasFaltas.length ? htmlFaltantes(v.nuevasFaltas, 'Faltaría después del cambio.') : '') +
      (v.resueltas.length ? '<p class="ini-nota">Se completaría: ' +
        v.resueltas.map(function (f) { return Escape.html(f.rotulo); }).join(', ') + '.</p>' : '');
  }

  // ---------------------------------------------------------------------
  // VistaCrearAdmin: el panel "Crear iniciativa"
  // ---------------------------------------------------------------------
  var CAMPOS_CREAR = ['titulo', 'descripcion', 'observaciones'];
  // Camino del problema. 'nuevo' = el formulario de alta. 'existente' =
  // buscar y elegir un problema del registro; elegirlo abre su "Modificar"
  // (alElegirExistente), donde se revisan y cambian sus categorias.
  var RUTAS_PROBLEMA = ['nuevo', 'existente'];

  class VistaCrearAdmin {
    // pedir: fetch para la validacion (POST); pedirLectura: fetch para la
    // volumetria (GET). Por omision, fetch.
    constructor(doc, pedir, pedirLectura) {
      this.doc = doc;
      this.pedir = pedir || null;
      // ADM planea sobre los ultimos 30 dias de la categoria (alcance=total
      // trae ultimos30, la base de Tickets a reducir).
      this.volumetria = new VolumetriaCliente(pedirLectura || null, ALCANCE_TOTAL);
      this.borrador = null;
      this.archivoRca = null;  // el File elegido: viaja al servidor, que no lo guarda
      this.enviando = false;
      this.cableado = false;
      this.ruta = 'nuevo';
      // Registro de problemas para "existente" (() -> [iniciativas]) y que
      // hacer al elegir uno (folio -> void). Los fija la pagina.
      this.fuenteProblemas = null;
      this.alElegirExistente = null;
      // () -> { estados, tiposIniciativa, tiposAgrupado } (valores que ya
      // existen, del registro) o null mientras no carga.
      this.fuenteValores = null;
      // (codigo) -> void: lo que hace la pagina tras un alta GUARDADA
      // (recargar el registro). Solo con estado 'guardada'.
      this.alGuardar = null;
    }

    persiste() {
      var v = this.fuenteValores ? this.fuenteValores() : null;
      return !!(v && v.persiste === true);
    }

    // Si la base guarda una Volumetria fijada por ADM (volumetria_manual del
    // registro, sql/26). Sin el dato, no: el campo no se ofrece.
    volumetriaManual() {
      var v = this.fuenteValores ? this.fuenteValores() : null;
      return !!(v && v.volumetriaManual === true);
    }

    pintarRotulos() {
      var r = rotulos(this.persiste());
      var b = this.$('admGuardar'), n = this.$('admGuardarNota'), a = this.$('admPersistenciaAviso');
      if (b) b.textContent = r.boton;
      if (n) n.textContent = r.nota;
      if (a) a.textContent = r.aviso;
    }

    $(id) { return this.doc.getElementById(id); }

    fijarProblemas(fuente, alElegir) {
      this.fuenteProblemas = typeof fuente === 'function' ? fuente : null;
      this.alElegirExistente = typeof alElegir === 'function' ? alElegir : null;
    }

    fijarValores(fuente) {
      this.fuenteValores = typeof fuente === 'function' ? fuente : null;
      this.pintarDeclarados();
    }

    // Si la base guarda el Subestado del alta (subestado_alta del registro,
    // sql/27). Sin el dato, no: el campo no se ofrece.
    subestadoAlta() {
      var v = this.fuenteValores ? this.fuenteValores() : null;
      return !!(v && v.subestadoAlta === true);
    }

    // Clasificacion y Agrupacion (solo lectura, del Tipo), selectores de
    // Estado y Subestado (con lo que ya existe) y la fecha de entrega. Sin
    // lista todavia: deshabilitado. Subestado solo con sql/27; sin ella se
    // oculta y se olvida lo elegido (no viaja).
    pintarDeclarados() {
      var b = this.borrador, v = this.fuenteValores ? this.fuenteValores() : null, self = this;
      [['admTipoIniciativa', 'tipo_iniciativa'], ['admTipoAgrupado', 'tipo_agrupado']].forEach(function (c) {
        var el = self.$(c[0]);
        if (!el) return;
        el.textContent = !b || !b.tipo ? 'Sale del Tipo de iniciativa'
          : (b.declarados[c[1]] || 'Sin regla para este Tipo (queda Incompleta)');
      });
      var conSub = this.subestadoAlta();
      var campoSub = this.$('admSubestadoCampo');
      if (campoSub) campoSub.hidden = !conSub;
      if (b && !conSub) b.declarados.subestado = '';
      [['admEstado', 'estado', 'estados']].concat(conSub ? [['admSubestado', 'subestado', 'subestados']] : []).forEach(function (c) {
        var el = self.$(c[0]);
        if (!el) return;
        var lista = v && Array.isArray(v[c[2]]) ? v[c[2]] : [];
        el.innerHTML = '<option value="">' + (lista.length ? '— Elige —' : 'Cargando…') + '</option>' + lista.map(function (o) {
          return '<option value="' + Escape.attr(o) + '">' + Escape.html(o) + '</option>';
        }).join('');
        el.value = b ? b.declarados[c[1]] : '';
        el.disabled = !b || !lista.length;
      });
      var fe = this.$('admFEntrega');
      if (fe) { fe.value = b ? b.declarados.f_entrega_analisis : ''; fe.disabled = !b; }
    }

    elegirRuta(ruta) {
      if (RUTAS_PROBLEMA.indexOf(ruta) < 0) return false;
      this.ruta = ruta;
      this.pintarRuta();
      return true;
    }

    pintarRuta() {
      var existente = this.ruta === 'existente';
      this.$('admRutaNuevo').checked = !existente;
      this.$('admRutaExistente').checked = existente;
      this.$('admExistente').hidden = !existente;
      this.$('admForm').hidden = existente;
      this.$('admFaltantes').hidden = existente;
      this.$('admRevisar').disabled = existente;
      this.$('admGuardar').disabled = existente || this.enviando;
      if (existente) { this.$('admResultado').hidden = true; this.buscarExistente(); }
    }

    // ---- existente ----
    buscarExistente() {
      var texto = this.$('admExistenteBuscar').value || '';
      var lista = this.fuenteProblemas ? this.fuenteProblemas() : null;
      var caja = this.$('admExistenteLista');
      if (!Array.isArray(lista)) {
        caja.innerHTML = '<p class="ini-nota">El registro de problemas todavía no está cargado.</p>';
        return { total: 0, resultados: [] };
      }
      var r = BuscadorProblemas.buscar(lista, texto);
      caja.innerHTML = htmlResultadosProblemas(r, texto);
      return r;
    }

    // Solo un folio que existe en el registro; nunca uno escrito a mano.
    elegirExistente(folio) {
      var lista = this.fuenteProblemas ? this.fuenteProblemas() : [];
      var existe = (lista || []).some(function (i) { return i.folio === folio; });
      if (!existe || !this.alElegirExistente) return false;
      this.alElegirExistente(folio);
      return true;
    }

    // Un catalogo nuevo arranca un borrador nuevo; null = sin catalogo.
    fijarCatalogo(catalogo) {
      this.borrador = catalogo ? new BorradorAdmin(catalogo) : null;
      this.cablear();
      this.pintar();
      this.$('admResultado').hidden = true;
      this.pintarRuta();
    }

    cablear() {
      if (this.cableado) return;
      this.cableado = true;
      var self = this;
      this.$('admTipo').addEventListener('change', function (e) {
        if (!self.borrador) return;
        self.borrador.elegirTipo(e.target.value);
        self.pintar();
      });
      [['admEstado', 'estado'], ['admSubestado', 'subestado'], ['admFEntrega', 'f_entrega_analisis']].forEach(function (c) {
        var el = self.$(c[0]);
        if (!el) return;
        el.addEventListener('change', function (e) {
          if (!self.borrador) return;
          // Sin sql/27 el Subestado no se ofrece: nada que capturar.
          if (c[1] === 'subestado' && !self.subestadoAlta()) return;
          self.borrador.capturar(c[1], e.target.value);
        });
        // El registro (de donde salen las listas) puede llegar despues.
        el.addEventListener('focus', function () { if (el.tagName === 'SELECT' && el.options.length <= 1) self.pintarDeclarados(); });
      });
      CAMPOS_CREAR.forEach(function (k) {
        self.$('adm-' + k).addEventListener('input', function (e) {
          if (!self.borrador) return;
          self.borrador.capturar(k, e.target.value);
          self.pintarFaltantes();
        });
      });
      // PO / SO: el control se repinta dentro de su caja; el evento sube.
      ['po', 'so'].forEach(function (k) {
        self.$(VistaCrearAdmin.idDueno(k) + 'Selector').addEventListener('change', function (e) {
          if (e.target && e.target.id === VistaCrearAdmin.idDueno(k)) self.elegirDueno(k, e.target.value);
        });
      });
      this.$('admCatAgregar').addEventListener('click', function () { self.agregarCategoria(); });
      // % / tickets / volumetria de una fila: solo se repinta lo CALCULADO
      // de esa fila (nunca la casilla en la que se escribe).
      this.$('admCats').addEventListener('input', function (e) {
        var t = e.target, attr = function (a) { var v = t && t.getAttribute && t.getAttribute(a); return v === null || v === undefined ? null : v; };
        var pct = attr('data-crear-pct'), tickets = attr('data-crear-tickets'), vol = attr('data-crear-vol');
        if (!self.borrador) return;
        var cats = self.borrador.categorias, n = pct !== null ? pct : tickets !== null ? tickets : vol;
        if (n === null) return;
        if (pct !== null) cats.capturarPct(Number(n), t.value);
        else if (tickets !== null) cats.capturarTickets(Number(n), t.value);
        else cats.capturarVolumen(Number(n), t.value);
        self.pintarMeta(Number(n));
        self.pintarFaltantes();
      });
      ['admModoPct', 'admModoTickets'].forEach(function (id) {
        var el = self.$(id);
        if (el) el.addEventListener('change', function (e) { if (e.target.checked) self.elegirModo(e.target.value); });
      });
      this.$('admCats').addEventListener('click', function (e) {
        var el = e.target;
        if (el && el.closest) el = el.closest('[data-crear-cat]');
        var accion = el && el.getAttribute && el.getAttribute('data-crear-cat');
        if (!accion || !self.borrador) return;
        var n = Number(el.getAttribute('data-indice'));
        if (accion === 'quitar') self.borrador.categorias.quitar(n);
        self.pintarCategorias();
        self.pintarFaltantes();
      });
      this.$('admRca').addEventListener('change', function (e) {
        if (!self.borrador) return;
        var a = e.target && e.target.files;
        self.archivoRca = a && a.length && a[0].size > 0 ? a[0] : null;
        self.borrador.elegirRca(a && a.length ? a[0] : null);
        self.pintarFaltantes();
      });
      ['admRutaNuevo', 'admRutaExistente'].forEach(function (id) {
        self.$(id).addEventListener('change', function (e) { if (e.target.checked) self.elegirRuta(e.target.value); });
      });
      this.$('admExistenteBuscar').addEventListener('input', function () { self.buscarExistente(); });
      this.$('admExistenteLista').addEventListener('click', function (e) {
        var el = e.target;
        if (el && el.closest) el = el.closest('[data-existente]');
        var folio = el && el.getAttribute && el.getAttribute('data-existente');
        if (folio) self.elegirExistente(folio);
      });
      this.$('admRevisar').addEventListener('click', function () { self.revisar(); });
      this.$('admGuardar').addEventListener('click', function () { self.guardar(); });
    }

    static idDueno(k) { return k === 'po' ? 'admPo' : 'admSo'; }

    // PO / SO: solo cambia ese campo; el aviso dice si no es de la lista.
    elegirDueno(campo, texto) {
      if (!this.borrador) return null;
      var r = this.borrador.elegirDueno(campo, texto);
      var msg = this.$(VistaCrearAdmin.idDueno(campo) + 'Msg');
      if (msg) { msg.textContent = r.ok ? '' : r.mensaje; msg.className = 'ini-motivo' + (r.ok ? '' : ' mal'); }
      return r;
    }

    // Repinta el control solo si cambia la lista (no borra lo escrito); el
    // valor siempre es el del borrador.
    pintarDuenos() {
      var b = this.borrador, self = this;
      ['po', 'so'].forEach(function (k) {
        var id = VistaCrearAdmin.idDueno(k), caja = self.$(id + 'Selector');
        if (!caja) return;
        if (!b) {
          caja.innerHTML = '<input type="text" id="' + id + '" disabled>';
          caja.setAttribute('data-n', '');
          return;
        }
        var lista = b.duenosLista[k];
        if (caja.getAttribute('data-n') !== String(lista.length)) {
          caja.innerHTML = Selector.html(id, lista, b.duenosTexto[k]);
          caja.setAttribute('data-n', String(lista.length));
        }
        var ctl = self.$(id);
        if (ctl) { ctl.value = b.duenosTexto[k]; ctl.disabled = lista.length === 0; }
        var msg = self.$(id + 'Msg');
        if (msg && !b.duenosTexto[k]) { msg.textContent = ''; msg.className = 'ini-motivo'; }
      });
    }

    // "Agregar": lo escrito en el selector tiene que ser una categoria real.
    agregarCategoria(texto) {
      if (!this.borrador) return null;
      if (texto === undefined) texto = this.$('admCatBuscar').value;
      var r = this.borrador.agregarCategoria(texto);
      var msg = this.$('admCatMsg');
      var faltan = r.ok ? BorradorAdmin.duenosFaltantes(this.borrador.catalogo, r.ruta) : [];
      msg.textContent = !r.ok ? r.mensaje : faltan.length
        ? r.ruta + ': sin ' + faltan.join(', ') + ' en el catálogo de dueños. Se puede guardar; no se inventan.' : '';
      msg.className = 'ini-motivo' + (r.ok ? '' : ' mal');
      if (r.ok) {
        this.$('admCatBuscar').value = '';
        if (window.Desplegable) window.Desplegable.repintar();
        this.consultarVolumetria(r.ruta);
        this.pintarCategorias();
        this.pintarFaltantes();
        this.$('admDirector').textContent = this.borrador.director() || '—';
      }
      return r;
    }

    consultarVolumetria(ruta) {
      var self = this;
      return this.volumetria.consultar(ruta, function () { self.pintarCategorias(); });
    }

    pintarCategorias() {
      if (!this.borrador) { this.$('admCats').innerHTML = ''; return; }
      this.borrador.categorias.sincronizarCalculadas(this.volumetria);
      this.$('admCats').innerHTML = htmlCategorias(this.borrador.categorias, this.volumetria, 'crear', undefined, this.volumetriaManual());
      this.$('admDirector').textContent = this.borrador.director() || '—';
      this.pintarModo();
    }

    // Lo calculado de la fila n (tickets o %), en su <output>. Sin el
    // elemento (o sin querySelector), nada.
    pintarMeta(n) {
      var caja = this.$('admCats'), cats = this.borrador && this.borrador.categorias, f = cats && cats.filas[n];
      var el = f && caja && caja.querySelector ? caja.querySelector('[data-crear-meta="' + n + '"]') : null;
      if (!el) return;
      var m = cats.meta(f);
      el.textContent = m.texto;
      el.className = 'ini-meta' + (m.mal ? ' mal' : '');
    }

    // "Planear la meta por": % o tickets. Solo cambia que se edita.
    elegirModo(modo) {
      if (!this.borrador || !this.borrador.categorias.elegirModo(modo)) return false;
      this.pintarCategorias();
      return true;
    }

    pintarModo() {
      var modo = this.borrador ? this.borrador.categorias.modo : 'pct';
      var p = this.$('admModoPct'), t = this.$('admModoTickets');
      if (p) { p.checked = modo === 'pct'; p.disabled = !this.borrador; }
      if (t) { t.checked = modo === 'tickets'; t.disabled = !this.borrador; }
    }

    pintar() {
      var b = this.borrador;
      var tipo = this.$('admTipo');
      var selector = this.$('admCatSelector');
      if (!b) {
        Catalogos.llenar(tipo, [], '—');
        tipo.disabled = true;
        selector.innerHTML = '<select id="admCatBuscar" disabled><option value="">—</option></select>';
        this.$('admCatAgregar').disabled = true;
        this.$('admDirector').textContent = '—';
        this.$('admFaltantes').innerHTML = '';
        this.$('admCats').innerHTML = '';
        this.pintarDuenos();
        return;
      }
      var cat = b.catalogo;
      tipo.innerHTML = '<option value="">— Elige —</option>' + cat.tipos.map(function (p) {
        return '<option value="' + Escape.attr(p) + '">' + Escape.html(cat.nombreTipo(p)) + '</option>';
      }).join('');
      tipo.value = b.tipo;
      tipo.disabled = cat.tipos.length === 0;
      // Solo se repinta si cambian las opciones: no borra lo escrito.
      if (selector.getAttribute('data-n') !== String(b.categorias.rutas.length)) {
        selector.innerHTML = Selector.desplegable('admCatBuscar', b.categorias.rutas, '');
        selector.setAttribute('data-n', String(b.categorias.rutas.length));
        Selector.montar(selector);
      }
      this.$('admCatAgregar').disabled = b.categorias.rutas.length === 0;
      this.$('admRcaNota').textContent = b.esProblem()
        ? 'Problem: sin RCA queda incompleta. El archivo no se sube.'
        : 'Opcional para este tipo. El archivo no se sube.';
      this.pintarDeclarados();
      this.pintarDuenos();
      this.pintarRotulos();
      this.pintarCategorias();
      this.pintarFaltantes();
    }

    pintarFaltantes() {
      if (!this.borrador) return;
      this.$('admFaltantes').innerHTML = htmlFaltantes(this.borrador.faltantes(), 'Se puede preparar igual.');
    }

    revisar() {
      if (!this.borrador || this.ruta !== 'nuevo') return null;
      var r = this.borrador.revisar();
      var caja = this.$('admResultado');
      caja.hidden = false;
      caja.classList.toggle('mal', !r.listo);
      caja.classList.toggle('ok', false);
      caja.innerHTML = htmlRevision(r, r.listo ? 'Borrador revisado, no guardado.' : 'Corrige el borrador:');
      return r;
    }

    // "Validar en el servidor (no guarda)" / "Guardar": lo que se ve es
    // SIEMPRE la respuesta real; si el borrador ya tiene errores locales, no
    // se envia. Solo con 'guardada' se limpia el borrador y se avisa a la
    // pagina (que recarga el registro); cualquier otra respuesta deja el
    // borrador tal cual para corregir o reintentar.
    guardar() {
      if (!this.borrador || this.enviando || this.ruta !== 'nuevo') return Promise.resolve(null);
      var local = this.revisar();
      if (!local.listo) return Promise.resolve(null);
      var self = this, boton = this.$('admGuardar'), caja = this.$('admResultado');
      var pares = this.borrador.paraEnviar();
      if (this.archivoRca) pares.push(['rca', this.archivoRca]);
      this.enviando = true;
      boton.disabled = true;
      caja.hidden = false;
      caja.classList.remove('ok', 'mal', 'aviso');
      caja.innerHTML = '<span>' + (this.persiste() ? 'Guardando…' : 'Validando en el servidor…') + '</span>';
      return enviarGestion(pares, this.pedir).then(function (r) {
        if (r.estado === 'guardada') {
          var cat = self.borrador.catalogo;
          self.borrador = new BorradorAdmin(cat);
          self.archivoRca = null;
          CAMPOS_CREAR.forEach(function (k) { var el = self.$('adm-' + k); if (el) el.value = ''; });
          var rca = self.$('admRca'); if (rca) rca.value = '';
          self.pintar();
          if (self.alGuardar) self.alGuardar(r.codigo);
        }
        caja.hidden = false;
        caja.classList.add(claseRespuesta(r));
        caja.innerHTML = htmlRespuesta(r);
        self.enviando = false;
        boton.disabled = self.ruta !== 'nuevo';
        return r;
      });
    }
  }

  return {
    AVISO_PROTOTIPO: AVISO_PROTOTIPO,
    AVISO_REVISION: AVISO_REVISION,
    ROTULOS: ROTULOS,
    URL_GESTION: URL_GESTION,
    URL_VOLUMETRIA: URL_VOLUMETRIA,
    ALCANCE_TOTAL: ALCANCE_TOTAL,
    SELECTOR_UMBRAL: SELECTOR_UMBRAL,
    RespuestaGestion: RespuestaGestion,
    enviarGestion: enviarGestion,
    claseRespuesta: claseRespuesta,
    htmlRespuesta: htmlRespuesta,
    CAMPOS_INCOMPLETA: CAMPOS_INCOMPLETA,
    TiposPorPrefijo: TiposPorPrefijo,
    CAMPOS_EDICION: CAMPOS_EDICION,
    Incompleta: Incompleta,
    FORMATO: FORMATO,
    FECHAS_GESTION: FECHAS_GESTION,
    Selector: Selector,
    VolumetriaCliente: VolumetriaCliente,
    MetaCategoria: MetaCategoria,
    CategoriasProblema: CategoriasProblema,
    BorradorAdmin: BorradorAdmin,
    BuscadorProblemas: BuscadorProblemas,
    EdicionAdmin: EdicionAdmin,
    VistaCrearAdmin: VistaCrearAdmin,
    RUTAS_PROBLEMA: RUTAS_PROBLEMA,
    htmlFaltantes: htmlFaltantes,
    htmlRevision: htmlRevision,
    htmlControlEdicion: htmlControlEdicion,
    htmlBarraEdicion: htmlBarraEdicion,
    htmlCategoriasEdicion: htmlCategoriasEdicion,
    htmlSinCatalogo: htmlSinCatalogo,
    noEnLista: noEnLista,
    htmlVistaPrevia: htmlVistaPrevia,
    htmlVolumetria: htmlVolumetria
  };
})();
