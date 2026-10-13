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

   VOLUMETRIA (de solo lectura)
   ----------------------------
     Al elegir o cambiar una categoria se pide su volumetria a
     handlers/admin_iniciativas_volumetria.ashx: el Total general del SLOT 0
     (ultimos 30 dias) de dbo.vw_TBSlotCAT, con la consulta y la llave de
     Experiencia (App_Code/ExperienciaVolumetria.cs). Se pinta, no se
     captura. NO es Tickets Reduce (ese sigue en la base). Estados:
     cargando, ok, cero (0 real), sin_datos (la vista vino vacia), error
     (la consulta fallo: nunca se pinta como 0) y ruta_invalida.

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
     solo cuenta si coincide con una opcion real (resolverOpcion). Con 20 o
     menos, un <select> normal.

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

  // Validacion en el servidor de crear y modificar (solo ADM). NO guarda:
  // con datos validos responde 501 PersistenciaNoHabilitada.
  var URL_GESTION = '../handlers/admin_iniciativas_gestion.ashx';
  // Volumetria por categoria (solo lectura, ADM o MOD).
  var URL_VOLUMETRIA = '../handlers/admin_iniciativas_volumetria.ashx';

  // Desde cuantas opciones un selector pasa a ser caja con busqueda.
  var SELECTOR_UMBRAL = 20;

  function vacio(v) { return v === null || v === undefined || String(v).trim() === ''; }
  function llaveRuta(r) { return String(r === null || r === undefined ? '' : r).trim().toUpperCase(); }

  // ---------------------------------------------------------------------
  // Incompleta
  // ---------------------------------------------------------------------
  // Los datos que el flujo de solicitud exige, salvo la Volumetria, que ya
  // no se captura. El Tipo no esta: sin tipo no hay prefijo de codigo, asi
  // que en el alta es BLOQUEANTE, no "incompleta".
  var CAMPOS_INCOMPLETA = [
    { clave: 'categoria',     rotulo: 'Categoría' },
    { clave: 'titulo',        rotulo: 'Título' },
    { clave: 'descripcion',   rotulo: 'Descripción' },
    { clave: 'observaciones', rotulo: 'Observaciones' },
    { clave: 'pct',           rotulo: '% Disminución' },
    { clave: 'rca',           rotulo: 'RCA', soloProblem: true }
  ];

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
    fecha: function (v) {
      if (v === '') return '';
      var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
      if (!m) return 'Escribe una fecha válida (aaaa-mm-dd).';
      var d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
      return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3] ? ''
        : 'Escribe una fecha válida (aaaa-mm-dd).';
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
    }
  };

  // ---------------------------------------------------------------------
  // VolumetriaCliente
  // ---------------------------------------------------------------------
  // pedir: (url, opciones) -> Promise<Response>. Recuerda por ruta; un error
  // no se recuerda (se puede volver a pedir).
  class VolumetriaCliente {
    constructor(pedir) {
      this.pedir = pedir || function (url, op) { return fetch(url, op); };
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
      var url = URL_VOLUMETRIA + '?ruta=' + encodeURIComponent(String(ruta).trim());
      e.promesa = Promise.resolve()
        .then(function () { return self.pedir(url, { method: 'GET', cache: 'no-store' }); })
        .then(function (r) {
          return r.json().catch(function () { return null; }).then(function (json) {
            var fila = json && Array.isArray(json.rutas) ? json.rutas[0] : null;
            if (!r.ok || !fila || typeof fila.estado !== 'string') {
              return { estado: 'error', valor: null,
                       mensaje: (json && json.error) || ('El servidor respondió ' + r.status + '.') };
            }
            return { estado: fila.estado, valor: typeof fila.volumetria === 'number' ? fila.volumetria : null };
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
    return '<output class="ini-vol' + clase + '" title="Calculada: Total general del SLOT 0 de vw_TBSlotCAT (solo lectura)">' +
      Escape.html(VolumetriaCliente.texto(e)) + '</output>';
  }

  // ---------------------------------------------------------------------
  // CategoriasProblema
  // ---------------------------------------------------------------------
  // ligadas: las categorias ACTUALES del problema ([{ categoria, pct_dism }]),
  // o [] en un alta. rutas: las rutas del catalogo vigente (lo unico que se
  // puede agregar). Cada fila: { categoria, valor (% en texto), original
  // (% de la base, en texto) | null si es nueva, ligada, quitada }.
  class CategoriasProblema {
    constructor(ligadas, rutas) {
      this.rutas = Array.isArray(rutas) ? rutas : [];
      this.filas = (ligadas || []).map(function (c) {
        var v = pctDe(c.pct_dism);
        return { categoria: c.categoria || '', valor: v, original: v, ligada: true, quitada: false };
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
          ? 'Elige una categoría de la lista: «' + String(texto).trim() + '» no es una categoría vigente.'
          : 'El catálogo de categorías no está disponible.' };
      }
      var n = this.buscar(ruta);
      if (n >= 0) {
        var f = this.filas[n];
        return { ok: false, ruta: ruta, mensaje: f.quitada
          ? ruta + ' está marcada para quitar: usa «Restaurar» en vez de agregarla otra vez.'
          : ruta + ' ya está en la lista.' };
      }
      this.filas.push({ categoria: ruta, valor: '', original: null, ligada: false, quitada: false });
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
      if (f && !f.quitada) f.valor = String(texto === null || texto === undefined ? '' : texto).trim();
    }

    activas() { return this.filas.filter(function (f) { return !f.quitada; }); }

    erroresFormato() {
      var errores = [];
      this.activas().forEach(function (f) {
        var e = FORMATO.pct(f.valor);
        if (e) errores.push({ clave: 'pct', mensaje: f.categoria + ': ' + e });
      });
      return errores;
    }

    // -> [{ clave, rotulo, anterior, nuevo }]
    cambios() {
      var salida = [];
      this.filas.forEach(function (f) {
        if (f.ligada && f.quitada) {
          salida.push({ clave: 'quitar_categoria', rotulo: 'Quitar categoría', anterior: f.categoria, nuevo: '' });
        } else if (!f.ligada) {
          salida.push({ clave: 'agregar_categoria', rotulo: 'Agregar categoría', anterior: '',
                        nuevo: f.categoria + (f.valor === '' ? ' (sin %)' : ' · ' + f.valor + '%') });
        } else if (f.valor !== f.original) {
          salida.push({ clave: 'pct', rotulo: '% Disminución · ' + f.categoria, anterior: f.original, nuevo: f.valor });
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

    // Modificar: SOLO lo que cambio.
    paresModificar() {
      var pares = [];
      this.filas.forEach(function (f) {
        if (f.ligada && f.quitada) pares.push(['quitar_categoria', f.categoria]);
        else if (!f.ligada) pares.push(['agregar_categoria', f.categoria], ['agregar_pct', f.valor]);
        else if (f.valor !== f.original) pares.push(['pct_categoria', f.categoria], ['pct_valor', f.valor]);
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
  // vol: VolumetriaCliente o null.
  function htmlCategorias(cats, vol, prefijo) {
    if (!cats.filas.length) return '<p class="ini-nota">Sin categorías todavía.</p>';
    return '<div class="ini-det-tabla"><table class="ini-cats-tabla"><thead><tr><th scope="col">Categoría</th>' +
      '<th scope="col">Volumetría <span class="ini-origen derivado">Calculada</span></th>' +
      '<th scope="col">% Disminución</th><th scope="col"><span class="ini-sr">Acción</span></th></tr></thead><tbody>' +
      cats.filas.map(function (f, n) {
        var estado = f.quitada ? '<span class="ini-cat-estado">Se quitará</span>'
          : !f.ligada ? '<span class="ini-cat-estado nueva">Nueva</span>' : '';
        var pct = f.quitada ? Escape.html(f.original === '' ? '—' : f.original + '%')
          : '<label class="ini-ed-pct"><span class="ini-sr">% de ' + Escape.html(f.categoria) + '</span>' +
            '<input type="number" min="0" max="100" step="0.01" data-' + prefijo + '-pct="' + n + '" value="' +
            Escape.attr(f.valor) + '"> %</label>';
        var boton = f.quitada
          ? '<button type="button" class="btn linea chico" data-' + prefijo + '-cat="restaurar" data-indice="' + n + '">Restaurar</button>'
          : '<button type="button" class="btn linea chico" data-' + prefijo + '-cat="quitar" data-indice="' + n + '">Quitar</button>';
        return '<tr' + (f.quitada ? ' class="ini-cat-quitada"' : '') + '><td><span class="ini-cat-ruta">' +
          Escape.html(f.categoria) + '</span> ' + estado + '</td><td>' +
          (f.quitada ? '—' : htmlVolumetria(vol ? vol.estado(f.categoria) : null)) + '</td><td>' + pct + '</td><td>' + boton + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  // ---------------------------------------------------------------------
  // RespuestaGestion: lo que contesto admin_iniciativas_gestion.ashx
  // ---------------------------------------------------------------------
  // Nunca hay un estado de exito: el handler no guarda. Cinco estados
  // excluyentes:
  //   no_habilitada  501: valida en el servidor, NO guardada
  //   invalida       422: errores por campo
  //   denegado       403: sin rol ADM (o sin acceso)
  //   no_disponible  503: no se pudo leer el catalogo; no se sabe si es valida
  //   error          cualquier otra cosa (red, 500, respuesta ilegible)
  var RespuestaGestion = {
    desde: function (estado, json) {
      json = json && typeof json === 'object' ? json : null;
      var tipo = json && json.tipo;
      var e = estado === 501 && tipo === 'PersistenciaNoHabilitada' && json.valida === true && json.guardada === false ? 'no_habilitada'
        : estado === 422 && json && json.valida === false ? 'invalida'
        : estado === 403 ? 'denegado'
        : estado === 503 ? 'no_disponible'
        : 'error';
      return {
        estado: e,
        guardada: false,
        errores: e === 'invalida' && Array.isArray(json.errores) ? json.errores : [],
        advertencias: json && Array.isArray(json.advertencias) ? json.advertencias : [],
        cambios: json && Array.isArray(json.cambios) ? json.cambios : [],
        faltantes: json && Array.isArray(json.faltantes) ? json.faltantes : [],
        bloqueos: json && Array.isArray(json.bloqueos) ? json.bloqueos : [],
        mensaje: (json && (json.persistencia_motivo || json.error)) ||
          (estado ? 'El servidor respondió ' + estado + '.' : 'No se pudo contactar al servidor.')
      };
    },
    titulo: function (r) {
      return {
        no_habilitada: 'Solo validación: los datos son válidos en el servidor, pero NO se guardó nada. ' +
          'No se guardó: la persistencia no está habilitada.',
        invalida: 'El servidor rechazó los datos (no se guardó nada):',
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
      this.categorias = new CategoriasProblema([], BorradorAdmin.rutasDe(catalogo));
      this.rca = null;   // nombre del archivo elegido; no se sube
    }

    // Las rutas distintas del catalogo, en su orden.
    static rutasDe(catalogo) {
      var vistas = {}, salida = [];
      ((catalogo && catalogo.asignaciones) || []).forEach(function (f) {
        if (f.categoria && !vistas[f.categoria]) { vistas[f.categoria] = true; salida.push(f.categoria); }
      });
      return salida;
    }

    elegirTipo(valor) {
      this.tipo = valor && this.catalogo.tieneTipo(valor) ? valor : '';
      return this.tipo !== '';
    }

    agregarCategoria(texto) { return this.categorias.agregar(texto); }

    capturar(clave, texto) {
      if (Object.prototype.hasOwnProperty.call(this.valores, clave)) this.valores[clave] = String(texto || '');
    }

    elegirRca(archivo) { this.rca = archivo && archivo.size > 0 ? String(archivo.name || 'archivo') : null; }

    esProblem() { return this.tipo !== '' && this.tipo === this.catalogo.tipoProblem; }

    // El Director de las categorias elegidas, si es uno solo; si no, ''.
    director() {
      var rutas = {};
      this.categorias.activas().forEach(function (f) { rutas[llaveRuta(f.categoria)] = true; });
      var vistos = {};
      (this.catalogo.asignaciones || []).forEach(function (f) {
        if (rutas[llaveRuta(f.categoria)] && f.director) vistos[f.director] = true;
      });
      var lista = Object.keys(vistos);
      return lista.length === 1 ? lista[0] : '';
    }

    // Lo unico que impide guardar (cuando se pueda): sin tipo no hay
    // prefijo de codigo.
    bloqueantes() { return this.tipo ? [] : [{ clave: 'tipo', mensaje: 'Elige el Tipo de iniciativa: define el prefijo del código.' }]; }

    erroresFormato() { return this.categorias.erroresFormato(); }

    datos() {
      var v = this.valores, cats = this.categorias.comoRegistro();
      return {
        categoria: cats.length ? 'si' : '', titulo: v.titulo, descripcion: v.descripcion,
        observaciones: v.observaciones,
        // Sin categorias el % no se pide aparte (ya falta "Categoría").
        pct: !cats.length ? undefined : (cats.every(function (c) { return c.pct_dism !== null; }) ? 'si' : ''),
        rca: this.rca || ''
      };
    }

    faltantes() { return Incompleta.faltantes(this.datos(), this.esProblem()); }

    // Lo que viaja al servidor (accion=crear). El archivo del RCA lo pone la
    // vista. PO / SO ya no se eligen aqui: viajan vacios (opcionales).
    paraEnviar() {
      var v = this.valores;
      return [['accion', 'crear'], ['tipo', this.tipo], ['po', ''], ['so', ''],
        ['titulo', v.titulo], ['descripcion', v.descripcion], ['observaciones', v.observaciones]]
        .concat(this.categorias.paresCrear());
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
        codigo: null,          // nunca se inventa
        guardado: false,       // nunca en esta fase
        aviso: AVISO_PROTOTIPO
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
          (typeof i.antiguedad === 'number' ? ' · ' + i.antiguedad + ' días' : '') +
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
    { clave: 'categorias', rotulo: 'Categorías y % de disminución', estado: 'editable', control: 'categorias',
      destino: 'dbo.ProblemCategoria (Categoria, PctDisminucion en fracción)' },
    { clave: 'rca', rotulo: 'RCA', estado: 'pendiente',
      motivo: 'El destino del documento (SharePoint) y su referencia siguen sin decidir.' },
    { clave: 'codigo', rotulo: 'Código y Tipo de iniciativa', estado: 'solo_lectura',
      motivo: 'Identifican la iniciativa y nunca cambian; el tipo es el prefijo del código.' },
    { clave: 'duenos', rotulo: 'Director, Product Owner, Service Owner y Manager', estado: 'solo_lectura',
      motivo: 'Se derivan de la categoría (CatCategoriaDueno / CatPersona).' },
    { clave: 'calculados', rotulo: 'Volumetría, tickets a reducir, en riesgo, antigüedad y semáforo', estado: 'solo_lectura',
      motivo: 'Los calcula la base o el servidor.' }
  ];

  var CAMPOS_PROBLEMA = ['titulo', 'descripcion', 'observaciones', 'f_analisis', 'f_solucion', 'f_cierre', 'estado', 'subestado'];

  function claves(lista) { return lista.map(function (f) { return f.clave; }); }
  function campo(clave) { return CAMPOS_EDICION.filter(function (c) { return c.clave === clave; })[0]; }

  // ---------------------------------------------------------------------
  // EdicionAdmin: edicion directa de una iniciativa del registro, sin DOM
  // ---------------------------------------------------------------------
  // opciones: { rutas: [...] (catalogo vigente, para agregar),
  //             estados: [...], subestados: [...] (los que ya existen) }.
  // Sin rutas no se puede agregar; sin listas no se puede cambiar Estado
  // ni Subestado (el servidor tambien lo rechaza).
  class EdicionAdmin {
    constructor(iniciativa, opciones) {
      opciones = opciones || {};
      this.iniciativa = iniciativa;
      this.listas = {
        estados: Array.isArray(opciones.estados) ? opciones.estados : [],
        subestados: Array.isArray(opciones.subestados) ? opciones.subestados : []
      };
      // El Titulo editable es el del Problem (titulo_problem); `titulo`
      // puede ser el TituloIniciativa, cuya columna no se escribe aqui.
      var tit = iniciativa.titulo_problem !== undefined ? iniciativa.titulo_problem : iniciativa.titulo;
      this.original = {
        titulo: tit || '',
        descripcion: iniciativa.descripcion || '',
        observaciones: iniciativa.observaciones || '',
        f_analisis: iniciativa.f_analisis || '',
        f_solucion: iniciativa.f_solucion || '',
        f_cierre: iniciativa.f_cierre || '',
        estado: iniciativa.estado || '',
        subestado: iniciativa.subestado || ''
      };
      this.valores = {};
      var self = this;
      CAMPOS_PROBLEMA.forEach(function (k) { self.valores[k] = self.original[k]; });
      this.categorias = new CategoriasProblema(iniciativa.categorias || [], opciones.rutas);
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

    // -> [{ clave, rotulo, anterior, nuevo }]
    cambios() {
      var self = this, salida = [];
      CAMPOS_PROBLEMA.forEach(function (k) {
        var nuevo = k.indexOf('f_') === 0 || k === 'estado' || k === 'subestado' ? self.valores[k].trim() : self.valores[k];
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
        notas.push('Sin categoría: sus dueños son los capturados en el Problem (OwnerProblem, OwnerServicio, Direccion) ' +
          'y se conservan tal cual; aquí no se modifican.');
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

  function claseRespuesta(r) { return r.estado === 'no_habilitada' ? 'aviso' : 'mal'; }

  function htmlRespuesta(r) {
    var lista = function (xs, f) { return xs.length ? '<ul>' + xs.map(f).join('') + '</ul>' : ''; };
    var texto = function (v) { return v === '' || v === null || v === undefined ? '(vacío)' : String(v); };
    var partes = ['<strong class="ini-prototipo-marca">' + Escape.html(RespuestaGestion.titulo(r)) + '</strong>'];
    partes.push(lista(r.errores, function (e) { return '<li>' + Escape.html(e.mensaje) + '</li>'; }));
    if (r.estado === 'no_habilitada') {
      if (r.cambios.length) {
        partes.push('<p>Cambios validados (no guardados):</p>' + lista(r.cambios, function (c) {
          return '<li>' + Escape.html(c.rotulo) + ': ' + Escape.html(texto(c.anterior)) + ' → ' + Escape.html(texto(c.nuevo)) + '</li>';
        }));
      }
      partes.push(r.faltantes.length ? htmlFaltantes(r.faltantes, 'Según el servidor.') : '<p>Sin datos faltantes.</p>');
    }
    partes.push(lista(r.advertencias, function (a) { return '<li>' + Escape.html(a) + '</li>'; }));
    if (r.estado !== 'invalida' || !r.errores.length) partes.push('<p class="ini-prototipo-aviso">' + Escape.html(r.mensaje) + '</p>');
    return partes.join('');
  }

  // Bloque de categorias de "Modificar" (se repinta solo).
  function htmlCategoriasEdicion(ed, vol) {
    var rutas = ed.categorias.rutas;
    var agregar = rutas.length
      ? '<div class="ini-cat-agregar"><label for="regEdCatBuscar">Agregar categoría</label>' +
          Selector.html('regEdCatBuscar', rutas, '') +
          ' <button type="button" class="btn linea chico" data-accion="edicion-cat-agregar">Agregar</button></div>'
      : '<p class="ini-nota">El catálogo de categorías no está disponible: no se pueden agregar categorías.</p>';
    return htmlCategorias(ed.categorias, vol, 'edicion') + agregar +
      '<div class="ini-cambio-msg" id="regEdCatMsg" role="status" aria-live="polite"></div>' +
      '<small class="ini-sub">Destino propuesto: dbo.ProblemCategoria. Quitar = la fila deja de estar vigente; no se borra ' +
        '(regla de baja pendiente de aprobar). La volumetría es calculada y de solo lectura.</small>';
  }

  // Formulario de edicion dentro del detalle del registro.
  // contexto: { tipo, volumetria (VolumetriaCliente) }.
  function htmlEdicion(ed, contexto) {
    contexto = contexto || {};
    function control(c) {
      var id = 'regEd-' + c.clave;
      var v = ed.valores[c.clave];
      var rot = '<label for="' + id + '">' + Escape.html(c.rotulo) + '</label>';
      var ctl;
      if (c.control === 'multilinea') {
        ctl = '<textarea id="' + id + '" data-edicion="' + c.clave + '" rows="4">' + Escape.html(v) + '</textarea>';
      } else if (c.control === 'fecha') {
        ctl = '<input type="date" id="' + id + '" data-edicion="' + c.clave + '" value="' + Escape.attr(v) + '">';
      } else if (c.control === 'lista') {
        var ops = ed.listas[c.lista].slice();
        if (v && ops.indexOf(v) < 0) ops.unshift(v);
        if (c.clave === 'subestado' && !ed.conoceSubestado()) {
          return '<div class="campo"><span class="ini-cambio-rot">' + Escape.html(c.rotulo) + '</span>' +
            '<p class="ini-nota">El registro no trajo el Subestado: no se puede editar aquí.</p></div>';
        }
        if (!ed.listas[c.lista].length) {
          return '<div class="campo"><span class="ini-cambio-rot">' + Escape.html(c.rotulo) + '</span>' +
            '<p class="ini-nota">' + Escape.html(v || '—') + ' · sin lista de valores: no se puede cambiar.</p></div>';
        }
        ctl = Selector.html(id, ops, v, ' data-edicion="' + c.clave + '"');
      } else {
        ctl = '<input type="text" id="' + id + '" data-edicion="' + c.clave + '" value="' + Escape.attr(v) + '">';
      }
      return '<div class="campo' + (c.control === 'multilinea' || c.control === 'texto' ? ' ini-cambio-ancho' : '') + '">' + rot + ctl +
        '<small class="ini-sub">Destino propuesto: ' + Escape.html(c.destino) + '</small></div>';
    }
    var problema = CAMPOS_EDICION.filter(function (c) { return c.estado === 'editable' && c.control !== 'categorias'; });
    var noEditables = CAMPOS_EDICION.filter(function (c) { return c.estado !== 'editable'; });
    var i = ed.iniciativa;
    var ctx = '<p class="ini-nota">Código ' + Escape.html(i.folio) +
      (contexto.tipo || i.prefijo ? ' · ' + Escape.html(contexto.tipo || i.prefijo) : '') +
      (i.estado ? ' · ' + Escape.html(i.estado) : '') + ' (solo lectura)</p>';
    var legado = ed.notasLegado().map(function (n) { return '<p class="ini-nota">' + Escape.html(n) + '</p>'; }).join('');
    return '<h4>Modificar iniciativa</h4>' +
      '<p class="ini-prototipo-aviso">«Validar en el servidor» solo valida: la persistencia no está habilitada y ' +
        'no se guarda nada todavía. Además, mientras el Excel siga cargando, la carga reemplazaría estos campos.</p>' +
      ctx + legado +
      htmlFaltantes(ed.faltantesOriginales(), 'Ya faltaba antes de modificar.') +
      '<h5>Problema <span class="ini-sub">dbo.Problem · el código no cambia</span></h5>' +
      '<div class="ini-cambio-campos">' + problema.map(control).join('') + '</div>' +
      '<h5>Categorías <span class="ini-sub">dbo.ProblemCategoria · cada una con su %</span></h5>' +
      '<div id="regEdCats">' + htmlCategoriasEdicion(ed, contexto.volumetria || null) + '</div>' +
      '<div class="ini-ed-vista" id="regEdVista" aria-live="polite">' + htmlVistaPrevia(ed) + '</div>' +
      '<details class="ini-ed-otros"><summary>Campos no editables todavía</summary><ul>' +
        noEditables.map(function (c) {
          return '<li><b>' + Escape.html(c.rotulo) + '</b> · ' +
            (c.estado === 'pendiente' ? 'pendiente de contrato' : 'solo lectura') + ': ' + Escape.html(c.motivo) + '</li>';
        }).join('') + '</ul></details>' +
      '<div class="ini-cambio-msg" id="regEdMsg" role="status" aria-live="polite"></div>' +
      '<div class="ini-cambio-pie">' +
        '<button type="button" class="btn chico" data-accion="edicion-revisar">Revisar cambios</button> ' +
        '<button type="button" class="btn chico" data-accion="edicion-guardar" aria-describedby="regEdGuardarNota">Validar en el servidor (no guarda)</button> ' +
        '<button type="button" class="btn linea chico" data-accion="edicion-cancelar">Cancelar</button>' +
      '</div>' +
      '<small class="ini-sub" id="regEdGuardarNota">Solo valida en el servidor (solo ADM); no guarda mientras la persistencia no esté habilitada.</small>';
  }

  // Vista previa en vivo de "Modificar". Siempre dice que no se guarda.
  function htmlVistaPrevia(ed) {
    var v = ed.vistaPrevia();
    var fila = function (c) {
      return '<tr><th scope="row">' + Escape.html(c.rotulo) + '</th><td>' +
        Escape.html(c.anterior === '' ? '(vacío)' : c.anterior) + '</td><td>' +
        Escape.html(c.nuevo === '' ? '(vacío)' : c.nuevo) + '</td></tr>';
    };
    return '<h5>Vista previa (no se guarda)</h5>' +
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
      this.volumetria = new VolumetriaCliente(pedirLectura || null);
      this.borrador = null;
      this.archivoRca = null;  // el File elegido: viaja al servidor, que no lo guarda
      this.enviando = false;
      this.cableado = false;
      this.ruta = 'nuevo';
      // Registro de problemas para "existente" (() -> [iniciativas]) y que
      // hacer al elegir uno (folio -> void). Los fija la pagina.
      this.fuenteProblemas = null;
      this.alElegirExistente = null;
    }

    $(id) { return this.doc.getElementById(id); }

    fijarProblemas(fuente, alElegir) {
      this.fuenteProblemas = typeof fuente === 'function' ? fuente : null;
      this.alElegirExistente = typeof alElegir === 'function' ? alElegir : null;
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
      CAMPOS_CREAR.forEach(function (k) {
        self.$('adm-' + k).addEventListener('input', function (e) {
          if (!self.borrador) return;
          self.borrador.capturar(k, e.target.value);
          self.pintarFaltantes();
        });
      });
      this.$('admCatAgregar').addEventListener('click', function () { self.agregarCategoria(); });
      this.$('admCats').addEventListener('input', function (e) {
        var t = e.target, n = t && t.getAttribute && t.getAttribute('data-crear-pct');
        if (!self.borrador || n === null || n === undefined) return;
        self.borrador.categorias.capturarPct(Number(n), t.value);
        self.pintarFaltantes();
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

    // "Agregar": lo escrito en el selector tiene que ser una categoria real.
    agregarCategoria(texto) {
      if (!this.borrador) return null;
      if (texto === undefined) texto = this.$('admCatBuscar').value;
      var r = this.borrador.agregarCategoria(texto);
      var msg = this.$('admCatMsg');
      msg.textContent = r.ok ? '' : r.mensaje;
      msg.className = 'ini-motivo' + (r.ok ? '' : ' mal');
      if (r.ok) {
        this.$('admCatBuscar').value = '';
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
      this.$('admCats').innerHTML = htmlCategorias(this.borrador.categorias, this.volumetria, 'crear');
      this.$('admDirector').textContent = this.borrador.director() || '—';
    }

    pintar() {
      var b = this.borrador;
      var tipo = this.$('admTipo');
      var selector = this.$('admCatSelector');
      if (!b) {
        Catalogos.llenar(tipo, [], '—');
        tipo.disabled = true;
        selector.innerHTML = '<input type="text" id="admCatBuscar" disabled>';
        this.$('admCatAgregar').disabled = true;
        this.$('admDirector').textContent = '—';
        this.$('admFaltantes').innerHTML = '';
        this.$('admCats').innerHTML = '';
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
        selector.innerHTML = Selector.html('admCatBuscar', b.categorias.rutas, '');
        selector.setAttribute('data-n', String(b.categorias.rutas.length));
      }
      this.$('admCatAgregar').disabled = b.categorias.rutas.length === 0;
      this.$('admRcaNota').textContent = b.esProblem()
        ? 'Problem: sin RCA queda incompleta. El archivo no se sube.'
        : 'Opcional para este tipo. El archivo no se sube.';
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

    // "Validar en el servidor (no guarda)": lo que se ve es SIEMPRE la
    // respuesta real; si el borrador ya tiene errores locales, no se envia.
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
      caja.innerHTML = '<span>Validando en el servidor…</span>';
      return enviarGestion(pares, this.pedir).then(function (r) {
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
    URL_GESTION: URL_GESTION,
    URL_VOLUMETRIA: URL_VOLUMETRIA,
    SELECTOR_UMBRAL: SELECTOR_UMBRAL,
    RespuestaGestion: RespuestaGestion,
    enviarGestion: enviarGestion,
    claseRespuesta: claseRespuesta,
    htmlRespuesta: htmlRespuesta,
    CAMPOS_INCOMPLETA: CAMPOS_INCOMPLETA,
    CAMPOS_EDICION: CAMPOS_EDICION,
    Incompleta: Incompleta,
    FORMATO: FORMATO,
    Selector: Selector,
    VolumetriaCliente: VolumetriaCliente,
    CategoriasProblema: CategoriasProblema,
    BorradorAdmin: BorradorAdmin,
    BuscadorProblemas: BuscadorProblemas,
    EdicionAdmin: EdicionAdmin,
    VistaCrearAdmin: VistaCrearAdmin,
    RUTAS_PROBLEMA: RUTAS_PROBLEMA,
    htmlFaltantes: htmlFaltantes,
    htmlRevision: htmlRevision,
    htmlEdicion: htmlEdicion,
    htmlCategoriasEdicion: htmlCategoriasEdicion,
    htmlVistaPrevia: htmlVistaPrevia,
    htmlVolumetria: htmlVolumetria
  };
})();
