/* =========================================================================
   admin/iniciativa-admin.js

   Gestion directa de ADM sobre iniciativas: crear y editar SIN el flujo de
   solicitud. PROTOTIPO: nada de este archivo guarda, envia ni genera
   codigo. No hay endpoint ni contrato de base para estas escrituras
   todavia (Paso 0 en la VM pendiente, ver sql/diag_admin_alta_edicion.sql);
   la persistencia real es una fase aparte.

   SEPARACION DE ROLES
   -------------------
     "Nueva solicitud" (admin/iniciativas.js, SolicitudNueva) es el flujo de
     solicitud con TODAS sus validaciones (obligatorios, cascada completa,
     capacidad, RCA de Problem). No se toca aqui.
     "Crear iniciativa" y "Modificar" (detalle del registro) son de ADM: aceptan
     cualquier tipo y datos incompletos, incluso Problem sin RCA. Lo que
     falta no bloquea: se avisa como INCOMPLETA.
     Los botones solo se pintan con rol ADM (SesionAdmin; sin rol, MOD o
     cualquier fallo = ocultos). Es solo UX: como aqui no hay ninguna
     llamada al servidor, no hay nada que autorizar todavia; cuando exista
     la escritura, su handler debe exigir ADM (AccesoAdmin.ExigirAdm).

   INCOMPLETA (marca DERIVADA, sin columna)
   ----------------------------------------
     Se calcula al vuelo; no se guarda en ningun lado. Un dato que el origen
     no trae (undefined) no se cuenta: "no se sabe" no es "falta". Dos
     alcances (decision 2026-10-09, opcion A, tras E10):
       Borrador de ADM    la lista completa de CAMPOS_INCOMPLETA (lo que el
                          flujo de solicitud exige).
       Iniciativa existente  solo CAMPOS_REGISTRO: Categoria y %. E10 midio
                          que Descripcion falta en ~90% de las activas y la
                          fecha de analisis en 183 de 257 En Analisis: con
                          esos la marca saldria en casi todas y no
                          distinguiria nada. No se agregan sin otra medicion.
     La marca solo se ve en el detalle, no en la lista.

   CODIGO
   ------
     No se inventa ni se asigna: la regla de generacion (prefijo + año +
     consecutivo) sigue sin contrato aprobado. El borrador muestra
     "se asigna al guardar".

   PIEZAS
   ------
     Incompleta        las reglas de faltantes (puras, sin DOM)
     BorradorAdmin     el formulario de alta de ADM, sin DOM
     EdicionAdmin      "Modificar" una iniciativa del registro, sin DOM:
                       valores actuales, cambios, faltantes de antes y de
                       despues, avisos de datos heredados (legado)
     CAMPOS_EDICION    que se puede editar, que espera contrato y que es
                       solo lectura (con el porque)
     VistaCrearAdmin   el DOM del panel "Crear iniciativa (Admin)"

   Se prueba en node: tools/tests/IniciativaAdminSmoke.js.
   ========================================================================= */
window.IniciativaAdmin = (function () {
  'use strict';

  var CascadaOrganizacional = window.CascadaOrganizacional;

  // Texto fijo de la marca de prototipo: se repite en cada resultado para
  // que nunca se lea como un guardado.
  var AVISO_PROTOTIPO = 'Prototipo: no se guardó nada y no se generó código. ' +
    'La persistencia se conectará cuando el contrato de base esté aprobado.';

  // ---------------------------------------------------------------------
  // Incompleta
  // ---------------------------------------------------------------------
  // Los datos que el flujo de solicitud exige (SolicitudNueva.faltantes).
  // El Tipo no esta: sin tipo no hay prefijo de codigo, asi que en el alta
  // es BLOQUEANTE, no "incompleta".
  var CAMPOS_INCOMPLETA = [
    { clave: 'categoria',     rotulo: 'Categoría' },
    { clave: 'titulo',        rotulo: 'Título' },
    { clave: 'descripcion',   rotulo: 'Descripción' },
    { clave: 'observaciones', rotulo: 'Observaciones' },
    { clave: 'volumetria',    rotulo: 'Volumetría' },
    { clave: 'pct',           rotulo: '% Disminución' },
    { clave: 'rca',           rotulo: 'RCA', soloProblem: true }
  ];

  // Lo unico que se revisa en una iniciativa EXISTENTE (ver cabecera).
  var CAMPOS_REGISTRO = ['categoria', 'pct'];

  function vacio(v) { return v === null || String(v).trim() === ''; }

  var Incompleta = {
    CAMPOS: CAMPOS_INCOMPLETA,
    CAMPOS_REGISTRO: CAMPOS_REGISTRO,

    // datos: clave -> valor. undefined = el origen no lo trae (no cuenta);
    // null o texto vacio = falta. esProblem: el RCA solo cuenta en Problem.
    // -> [{ clave, rotulo }] en el orden de CAMPOS_INCOMPLETA.
    faltantes: function (datos, esProblem) {
      datos = datos || {};
      return CAMPOS_INCOMPLETA.filter(function (c) {
        if (c.soloProblem && !esProblem) return false;
        return datos[c.clave] !== undefined && vacio(datos[c.clave]);
      }).map(function (c) { return { clave: c.clave, rotulo: c.rotulo }; });
    },

    // Una iniciativa del registro (admin_iniciativas_registro.ashx) ->
    // datos, SOLO de CAMPOS_REGISTRO (Categoria y %). Todo lo demas queda
    // undefined a proposito: Titulo, Descripcion, Observaciones, fechas,
    // Volumetria y RCA no marcan a una iniciativa existente.
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

  // Validacion de formato de los numericos (la misma de Nueva solicitud):
  // un % fuera de 0-100 no es "incompleto", es un dato invalido.
  var FORMATO = {
    volumetria: function (v) {
      return v === '' || /^\d+$/.test(v) ? '' : 'Escribe un número entero, de 0 en adelante.';
    },
    pct: function (v) {
      if (v === '') return '';
      return /^\d{1,3}(\.\d{1,2})?$/.test(v) && Number(v) <= 100 ? ''
        : 'Escribe un porcentaje entre 0 y 100, con hasta dos decimales.';
    }
  };

  // ---------------------------------------------------------------------
  // BorradorAdmin: alta directa de ADM, sin DOM
  // ---------------------------------------------------------------------
  // catalogo: CatalogoIniciativas de admin/iniciativas.js (tipos, nombres,
  // tipoProblem, asignaciones). La cascada va en modo 'filtro': cada nivel
  // es opcional, y lo que no se elija queda como faltante.
  class BorradorAdmin {
    constructor(catalogo) {
      this.catalogo = catalogo;
      this.tipo = '';
      this.cascada = new CascadaOrganizacional(catalogo.asignaciones || [], 'filtro');
      this.valores = { titulo: '', descripcion: '', observaciones: '', volumetria: '', pct: '' };
      this.rca = null;   // nombre del archivo elegido; no se sube
    }

    elegirTipo(valor) {
      this.tipo = valor && this.catalogo.tieneTipo(valor) ? valor : '';
      return this.tipo !== '';
    }

    // A diferencia de Nueva solicitud, la cascada no espera al tipo.
    elegir(nivel, valor) { return this.cascada.elegir(nivel, valor); }

    capturar(clave, texto) {
      if (Object.prototype.hasOwnProperty.call(this.valores, clave)) this.valores[clave] = String(texto || '');
    }

    elegirRca(archivo) { this.rca = archivo && archivo.size > 0 ? String(archivo.name || 'archivo') : null; }

    esProblem() { return this.tipo !== '' && this.tipo === this.catalogo.tipoProblem; }
    categoria() { return this.cascada.seleccion[2] || ''; }

    // El Director de las filas que cumplen lo elegido, en cuanto hay
    // Categoria (PO y SO son opcionales aqui); si no es uno solo, ''.
    director() {
      if (!this.categoria()) return '';
      var vistos = {};
      this.cascada.filasHasta(3).forEach(function (f) { vistos[f.director] = true; });
      var lista = Object.keys(vistos);
      return lista.length === 1 ? lista[0] : '';
    }

    // Lo unico que impide guardar (cuando se pueda): sin tipo no hay
    // prefijo de codigo.
    bloqueantes() { return this.tipo ? [] : [{ clave: 'tipo', mensaje: 'Elige el Tipo de iniciativa: define el prefijo del código.' }]; }

    erroresFormato() {
      var v = this.valores, errores = [];
      ['volumetria', 'pct'].forEach(function (k) {
        var e = FORMATO[k](String(v[k]).trim());
        if (e) errores.push({ clave: k, mensaje: e });
      });
      return errores;
    }

    datos() {
      var v = this.valores;
      return {
        categoria: this.categoria(), titulo: v.titulo, descripcion: v.descripcion,
        observaciones: v.observaciones, volumetria: v.volumetria, pct: v.pct,
        rca: this.rca || ''
      };
    }

    faltantes() { return Incompleta.faltantes(this.datos(), this.esProblem()); }

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
  // CAMPOS_EDICION
  // ---------------------------------------------------------------------
  //   editable      se puede editar en el formulario; destino propuesto,
  //                 persistencia pendiente.
  //   pendiente     falta una decision o un contrato; se muestra sin
  //                 control, con el motivo.
  //   solo_lectura  derivado o calculado; nunca se edita aqui.
  var CAMPOS_EDICION = [
    { clave: 'titulo', rotulo: 'Título', estado: 'editable', control: 'texto',
      destino: 'dbo.Problem.Titulo' },
    { clave: 'descripcion', rotulo: 'Descripción', estado: 'editable', control: 'multilinea',
      destino: 'dbo.Problem.Descripcion' },
    { clave: 'observaciones', rotulo: 'Observaciones', estado: 'editable', control: 'multilinea',
      destino: 'dbo.Problem.Observaciones' },
    { clave: 'pct', rotulo: '% Disminución por categoría', estado: 'editable', control: 'pct-categorias',
      destino: 'dbo.ProblemCategoria.PctDisminucion (fracción)' },
    { clave: 'fechas', rotulo: 'Fechas compromiso', estado: 'pendiente',
      motivo: 'Falta decidir si ADM las cambia directo o por solicitud (historial de fechas); hoy el ETL las pisa desde el Excel.' },
    { clave: 'estado', rotulo: 'Estado y Subestado', estado: 'pendiente',
      motivo: 'Su regla no está verificada; hoy vienen del Excel.' },
    { clave: 'categorias', rotulo: 'Agregar o quitar categorías', estado: 'pendiente',
      motivo: 'Sin contrato de escritura de ProblemCategoria por ruta real ni regla de capacidad para ADM.' },
    { clave: 'rca', rotulo: 'RCA', estado: 'pendiente',
      motivo: 'El destino del documento (SharePoint) y su referencia siguen sin decidir.' },
    { clave: 'codigo', rotulo: 'Código y Tipo de iniciativa', estado: 'solo_lectura',
      motivo: 'Identifican la iniciativa; el tipo es el prefijo del código.' },
    { clave: 'duenos', rotulo: 'Director, Product Owner, Service Owner y Manager', estado: 'solo_lectura',
      motivo: 'Se derivan de la categoría (CatCategoriaDueno / CatPersona).' },
    { clave: 'calculados', rotulo: 'Tickets a reducir, en riesgo, antigüedad y semáforo', estado: 'solo_lectura',
      motivo: 'Los calcula la base o el servidor.' }
  ];

  function claves(lista) { return lista.map(function (f) { return f.clave; }); }

  function pctDe(f) {
    return typeof f === 'number' && isFinite(f) ? String(Math.round(f * 10000) / 100) : '';
  }

  // ---------------------------------------------------------------------
  // EdicionAdmin: edicion directa de una iniciativa del registro, sin DOM
  // ---------------------------------------------------------------------
  class EdicionAdmin {
    constructor(iniciativa) {
      this.iniciativa = iniciativa;
      // El Titulo editable es el del Problem (titulo_problem); `titulo`
      // puede ser el TituloIniciativa, cuya columna no se escribe aqui.
      var tit = iniciativa.titulo_problem !== undefined ? iniciativa.titulo_problem : iniciativa.titulo;
      this.original = {
        titulo: tit || '',
        descripcion: iniciativa.descripcion || '',
        observaciones: iniciativa.observaciones || '',
        pct: (iniciativa.categorias || []).map(function (c) { return { categoria: c.categoria || '', valor: pctDe(c.pct_dism) }; })
      };
      this.valores = {
        titulo: this.original.titulo,
        descripcion: this.original.descripcion,
        observaciones: this.original.observaciones,
        pct: this.original.pct.map(function (p) { return { categoria: p.categoria, valor: p.valor }; })
      };
    }

    static campos(estado) {
      return CAMPOS_EDICION.filter(function (c) { return !estado || c.estado === estado; });
    }

    capturar(clave, texto) {
      if (clave === 'titulo' || clave === 'descripcion' || clave === 'observaciones') this.valores[clave] = String(texto || '');
    }

    capturarPct(indice, texto) {
      if (this.valores.pct[indice]) this.valores.pct[indice].valor = String(texto || '').trim();
    }

    // -> [{ clave, rotulo, anterior, nuevo }]
    cambios() {
      var self = this, salida = [];
      ['titulo', 'descripcion', 'observaciones'].forEach(function (k) {
        if (self.valores[k] !== self.original[k]) {
          var c = CAMPOS_EDICION.filter(function (x) { return x.clave === k; })[0];
          salida.push({ clave: k, rotulo: c.rotulo, anterior: self.original[k], nuevo: self.valores[k] });
        }
      });
      this.valores.pct.forEach(function (p, n) {
        if (p.valor !== self.original.pct[n].valor) {
          salida.push({ clave: 'pct', rotulo: '% Disminución · ' + p.categoria,
                        anterior: self.original.pct[n].valor, nuevo: p.valor });
        }
      });
      return salida;
    }

    erroresFormato() {
      var errores = [];
      this.valores.pct.forEach(function (p) {
        var e = FORMATO.pct(p.valor);
        if (e) errores.push({ clave: 'pct', mensaje: p.categoria + ': ' + e });
      });
      return errores;
    }

    // La iniciativa como quedaria con lo editado, para la marca derivada.
    faltantes() {
      var i = this.iniciativa, v = this.valores;
      var vista = {};
      Object.keys(i).forEach(function (k) { vista[k] = i[k]; });
      vista.titulo = v.titulo;
      vista.descripcion = v.descripcion;
      vista.observaciones = v.observaciones;
      vista.categorias = (i.categorias || []).map(function (c, n) {
        var p = v.pct[n] ? v.pct[n].valor : '';
        return { categoria: c.categoria, pct_dism: p === '' || FORMATO.pct(p) ? null : Number(p) / 100 };
      });
      return Incompleta.faltantes(Incompleta.datosDeRegistro(vista), false);
    }

    // Lo que ya faltaba ANTES de modificar (misma regla de existentes).
    faltantesOriginales() {
      return Incompleta.faltantes(Incompleta.datosDeRegistro(this.iniciativa), false);
    }

    // Vista previa local: cambios, faltantes que aparecen o se resuelven, y
    // errores de formato. No guarda nada.
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

    // Datos heredados de la carga (Excel/ETL) que esta pantalla CONSERVA tal
    // cual y conviene ver antes de modificar. Fuentes verificadas en
    // ExperienciaQueries (LeerIniciativas / LeerIniciativasSinCategoria).
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
  // Aviso de faltantes (o nada si esta completa).
  function htmlFaltantes(faltan, nota) {
    if (!faltan.length) return '';
    return '<div class="ini-incompleta" role="note"><strong>Incompleta</strong> · faltan: ' +
      faltan.map(function (f) { return Escape.html(f.rotulo); }).join(', ') + '.' +
      (nota ? ' <span class="ini-incompleta-nota">' + Escape.html(nota) + '</span>' : '') + '</div>';
  }

  // Resultado de revisar(): siempre con el aviso de prototipo.
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

  // Formulario de edicion dentro del detalle del registro.
  // contexto: { tipo } (nombre del tipo, del catalogo del registro).
  function htmlEdicion(ed, contexto) {
    function control(c) {
      var id = 'regEd-' + c.clave;
      var v = ed.valores[c.clave];
      var rot = '<label for="' + id + '">' + Escape.html(c.rotulo) + '</label>';
      var ctl = c.control === 'multilinea'
        ? '<textarea id="' + id + '" data-edicion="' + c.clave + '" rows="4">' + Escape.html(v) + '</textarea>'
        : '<input type="text" id="' + id + '" data-edicion="' + c.clave + '" value="' + Escape.attr(v) + '">';
      return '<div class="campo ini-cambio-ancho">' + rot + ctl +
        '<small class="ini-sub">Destino propuesto: ' + Escape.html(c.destino) + '</small></div>';
    }
    var editables = CAMPOS_EDICION.filter(function (c) { return c.estado === 'editable' && c.control !== 'pct-categorias'; });
    var pct = ed.valores.pct.length
      ? '<div class="campo ini-cambio-ancho"><span class="ini-cambio-rot">% Disminución por categoría</span>' +
          ed.valores.pct.map(function (p, n) {
            return '<label class="ini-ed-pct"><span class="ini-cat-ruta">' + Escape.html(p.categoria) + '</span>' +
              '<input type="number" min="0" max="100" step="0.01" data-edicion-pct="' + n + '" value="' + Escape.attr(p.valor) + '"> %</label>';
          }).join('') + '<small class="ini-sub">Destino propuesto: dbo.ProblemCategoria.PctDisminucion (fracción)</small></div>'
      : '<p class="ini-nota">Sin categorías: no hay % que editar.</p>';
    var noEditables = CAMPOS_EDICION.filter(function (c) { return c.estado !== 'editable'; });
    var i = ed.iniciativa;
    var ctx = '<p class="ini-nota">Código ' + Escape.html(i.folio) +
      ((contexto && contexto.tipo) || i.prefijo ? ' · ' + Escape.html((contexto && contexto.tipo) || i.prefijo) : '') +
      (i.estado ? ' · ' + Escape.html(i.estado) : '') + ' (solo lectura)</p>';
    var legado = ed.notasLegado().map(function (n) { return '<p class="ini-nota">' + Escape.html(n) + '</p>'; }).join('');
    return '<h4>Modificar iniciativa</h4>' +
      '<p class="ini-prototipo-aviso">Prototipo: los cambios se revisan aquí pero no se guardan. ' +
        'Además, mientras el Excel siga cargando, la carga reemplazaría estos campos.</p>' +
      ctx + legado +
      htmlFaltantes(ed.faltantesOriginales(), 'Ya faltaba antes de modificar.') +
      '<div class="ini-cambio-campos">' + editables.map(control).join('') + pct + '</div>' +
      '<div class="ini-ed-vista" id="regEdVista" aria-live="polite">' + htmlVistaPrevia(ed) + '</div>' +
      '<details class="ini-ed-otros"><summary>Campos no editables todavía</summary><ul>' +
        noEditables.map(function (c) {
          return '<li><b>' + Escape.html(c.rotulo) + '</b> · ' +
            (c.estado === 'pendiente' ? 'pendiente de contrato' : 'solo lectura') + ': ' + Escape.html(c.motivo) + '</li>';
        }).join('') + '</ul></details>' +
      '<div class="ini-cambio-msg" id="regEdMsg" role="status" aria-live="polite"></div>' +
      '<div class="ini-cambio-pie">' +
        '<button type="button" class="btn chico" data-accion="edicion-revisar">Revisar cambios</button> ' +
        '<button type="button" class="btn chico" disabled aria-describedby="regEdGuardarNota">Guardar</button> ' +
        '<button type="button" class="btn linea chico" data-accion="edicion-cancelar">Cancelar</button>' +
      '</div>' +
      '<small class="ini-sub" id="regEdGuardarNota">Guardar se habilitará con la persistencia aprobada.</small>';
  }

  // Vista previa en vivo de "Modificar": que cambia y que faltantes
  // aparecen o se resuelven. Siempre dice que no se guarda.
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
  // VistaCrearAdmin: el panel "Crear iniciativa (Admin)"
  // ---------------------------------------------------------------------
  var SELECTS_CREAR = ['admPo', 'admSo', 'admCategoria'];
  var CAMPOS_CREAR = ['titulo', 'descripcion', 'observaciones', 'volumetria', 'pct'];

  class VistaCrearAdmin {
    constructor(doc) {
      this.doc = doc;
      this.borrador = null;
      this.cableado = false;
    }

    $(id) { return this.doc.getElementById(id); }

    // Un catalogo nuevo arranca un borrador nuevo; null = sin catalogo.
    fijarCatalogo(catalogo) {
      this.borrador = catalogo ? new BorradorAdmin(catalogo) : null;
      this.cablear();
      this.pintar();
      this.$('admResultado').hidden = true;
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
      SELECTS_CREAR.forEach(function (id, n) {
        self.$(id).addEventListener('change', function (e) {
          if (!self.borrador) return;
          self.borrador.elegir(n, e.target.value);
          self.pintar();
        });
      });
      CAMPOS_CREAR.forEach(function (k) {
        self.$('adm-' + k).addEventListener('input', function (e) {
          if (!self.borrador) return;
          self.borrador.capturar(k, e.target.value);
          self.pintarFaltantes();
        });
      });
      this.$('admRca').addEventListener('change', function (e) {
        if (!self.borrador) return;
        var a = e.target && e.target.files;
        self.borrador.elegirRca(a && a.length ? a[0] : null);
        self.pintarFaltantes();
      });
      this.$('admRevisar').addEventListener('click', function () { self.revisar(); });
    }

    pintar() {
      var b = this.borrador, self = this;
      var tipo = this.$('admTipo');
      if (!b) {
        Catalogos.llenar(tipo, [], '—');
        tipo.disabled = true;
        SELECTS_CREAR.forEach(function (id) { Catalogos.llenar(self.$(id), [], '—'); self.$(id).disabled = true; });
        this.$('admDirector').textContent = '—';
        this.$('admFaltantes').innerHTML = '';
        return;
      }
      var cat = b.catalogo;
      tipo.innerHTML = '<option value="">— Elige —</option>' + cat.tipos.map(function (p) {
        return '<option value="' + Escape.attr(p) + '">' + Escape.html(cat.nombreTipo(p)) + '</option>';
      }).join('');
      tipo.value = b.tipo;
      tipo.disabled = cat.tipos.length === 0;
      b.cascada.estado(true, '').forEach(function (e, n) {
        var sel = self.$(SELECTS_CREAR[n]);
        Catalogos.llenar(sel, e.opciones, '— Sin elegir —');
        sel.value = e.valor;
        sel.disabled = !e.opciones.length;
      });
      this.$('admDirector').textContent = b.director() || '—';
      this.$('admRcaNota').textContent = b.esProblem()
        ? 'Problem: sin RCA queda incompleta. El archivo no se sube.'
        : 'Opcional para este tipo. El archivo no se sube.';
      this.pintarFaltantes();
    }

    pintarFaltantes() {
      if (!this.borrador) return;
      this.$('admFaltantes').innerHTML = htmlFaltantes(this.borrador.faltantes(), 'Se puede preparar igual.');
    }

    revisar() {
      if (!this.borrador) return null;
      var r = this.borrador.revisar();
      var caja = this.$('admResultado');
      caja.hidden = false;
      caja.classList.toggle('mal', !r.listo);
      caja.classList.toggle('ok', false);
      caja.innerHTML = htmlRevision(r, r.listo ? 'Borrador revisado, no guardado.' : 'Corrige el borrador:');
      return r;
    }
  }

  return {
    AVISO_PROTOTIPO: AVISO_PROTOTIPO,
    CAMPOS_INCOMPLETA: CAMPOS_INCOMPLETA,
    CAMPOS_EDICION: CAMPOS_EDICION,
    Incompleta: Incompleta,
    BorradorAdmin: BorradorAdmin,
    EdicionAdmin: EdicionAdmin,
    VistaCrearAdmin: VistaCrearAdmin,
    htmlFaltantes: htmlFaltantes,
    htmlRevision: htmlRevision,
    htmlEdicion: htmlEdicion,
    htmlVistaPrevia: htmlVistaPrevia
  };
})();
