/* =========================================================================
   admin/categorias-duenos.js

   Pestaña "Administración" de admin/iniciativas.html (solo ADM), seccion
   "Dueños de categoría": consultar los dueños de cada categoria (dbo.CatCategoriaDueno)
   y PREPARAR cambios con vista previa. PROTOTIPO: nada se guarda ni se
   envia; "Guardar (no disponible)" esta deshabilitado. Solo con rol ADM (como el alta de
   ADM); el handler de lectura (?duenos=1) exige AccesoAdmin.ExigirAdm y,
   cuando exista la escritura, su handler tambien.

   DATOS (solo lectura)
   --------------------
   handlers/admin_iniciativas_catalogos.ashx?duenos=1
   (App_Code/CatalogoDuenosCategoria.cs):
     duenos    cada fila de CatCategoriaDueno: lo CAPTURADO (po, so,
               director; null = vacio), lo RESUELTO por el sitio
               (DirectorioOrganizacional.Resolver), la fila de la que hereda
               su C1 (fuente_c1), vigente y usada.
     personas  dbo.CatPersona vigentes { nombre, rol, manager }: las UNICAS
               opciones para proponer un dueño. No se escribe ningun nombre
               a mano.

   LA REGLA DE HERENCIA (la del sitio, no se reescribe)
   ----------------------------------------------------
     Cada campo sale de la fila del N2 si esta capturado (PROPIO) y, si no,
     de la fila FUENTE de su C1 (HEREDADO): la primera fila de ese C1, que
     el servidor dice en fuente_c1. Si tampoco esta ahi, FALTA. El "antes"
     se pinta con lo que resolvio el servidor; el "despues" se calcula aqui
     con esa misma regla, y si el calculo no reproduce el "antes" se avisa y
     no se ofrece vista previa.
     Una fila que es la FUENTE de su C1 le pasa sus valores a las filas del
     C1 que no tienen el campo capturado (dependientes): cambiarla cambia
     tambien a esas, y la vista previa las lista.

   HALLAZGOS (lo que falta o no cuadra; solo se senala)
     no_vigente          fila dada de baja en el origen (sigue resolviendo)
     repetida            N2 repetido tras normalizar: el sitio usa otra fila
     sin_c1              sin C1: lo que no tenga capturado no se hereda
     falta               un dueño que no esta ni propio ni heredado
     fuente_no_vigente   heredado de una fila dada de baja
     persona_desconocida el dueño efectivo no esta en CatPersona vigente

   LO QUE NO HACE
     No toca dbo.Problem (OwnerProblem, OwnerServicio), ni ProblemCategoria,
     ni ninguna iniciativa: cambiar el dueño de una categoria cambiaria lo
     que el tablero RESUELVE para ella, no lo capturado en las iniciativas.
     No crea categorias ni personas.

   EXTENSION
     La pestaña Administración esta pensada para crecer con otras secciones
     (alta de categorias, personas/dueños): cada una con su modelo sin DOM y
     su vista, como esta (CatalogoDuenos / PropuestaDuenos / VistaDuenos),
     reusando CatalogoDuenos para personas y filas.

   PIEZAS
     CatalogoDuenos    el JSON validado: filas, personas, origen, hallazgos,
                       dependientes, filtro y busqueda (sin DOM)
     PropuestaDuenos   el borrador de una categoria y su antes/despues
                       (sin DOM)
     VistaDuenos       el DOM de la seccion

   Se prueba en node: tools/tests/CategoriasDuenosSmoke.js.
   ========================================================================= */
window.CategoriasDuenos = (function () {
  'use strict';

  var URL_DUENOS = '../handlers/admin_iniciativas_catalogos.ashx?duenos=1';

  var CAMPOS = [
    { clave: 'po',       rotulo: 'Product Owner' },
    { clave: 'so',       rotulo: 'Service Owner' },
    { clave: 'director', rotulo: 'Director PO' }
  ];

  var AVISO_PROTOTIPO = 'Prototipo: no se guardó nada. Los dueños de las iniciativas ' +
    '(OwnerProblem, OwnerServicio) no se tocan. La persistencia se conectará cuando el contrato de base esté aprobado.';

  // Filtros de la lista. 'vigentes' es el de inicio.
  var FILTROS = {
    vigentes:        { rotulo: 'Vigentes', pasa: function (c, f) { return f.vigente; } },
    todas:           { rotulo: 'Todas (incluye dadas de baja)', pasa: function () { return true; } },
    heredadas:       { rotulo: 'Con dueños heredados del C1', pasa: function (c, f) {
      return CAMPOS.some(function (x) { return c.origen(f, x.clave).tipo === 'heredado'; }); } },
    faltantes:       { rotulo: 'Con dueños faltantes', pasa: function (c, f) {
      return CAMPOS.some(function (x) { return c.origen(f, x.clave).tipo === 'falta'; }); } },
    inconsistencias: { rotulo: 'Con hallazgos', pasa: function (c, f) { return c.hallazgos(f).length > 0; } },
    no_vigentes:     { rotulo: 'Dadas de baja', pasa: function (c, f) { return !f.vigente; } }
  };

  function texto(v) { return typeof v === 'string' && v.trim() !== '' ? v.trim() : null; }
  function llave(v) { var t = texto(v); return t === null ? '' : t.toLowerCase(); }
  function plano(v) {
    return String(v === null || v === undefined ? '' : v).normalize('NFD')
      .replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  }
  function rotuloDe(campo) {
    for (var k = 0; k < CAMPOS.length; k++) if (CAMPOS[k].clave === campo) return CAMPOS[k].rotulo;
    return campo;
  }

  // ---------------------------------------------------------------------
  // CatalogoDuenos
  // ---------------------------------------------------------------------
  class CatalogoDuenos {
    constructor(filas, personas) {
      this.filas = filas;
      this.personas = personas;
      var self = this;
      this.usadaPorN2 = {};
      filas.forEach(function (f) { if (f.usada && !self.usadaPorN2[llave(f.n2)]) self.usadaPorN2[llave(f.n2)] = f; });
      this.personaPorNombre = {};
      personas.forEach(function (p) { self.personaPorNombre[llave(p.nombre)] = p; });
    }

    // Sin `duenos` o `personas` lanza: una respuesta rara no se pinta como
    // "sin categorias". Filas sin N2 de texto se descartan, sin corregirlas.
    static desdeJson(json) {
      if (!json || !Array.isArray(json.duenos) || !Array.isArray(json.personas)) {
        throw new Error('La respuesta del servidor no trae el catálogo de dueños.');
      }
      var filas = json.duenos.filter(function (f) { return f && texto(f.n2); }).map(function (f) {
        var r = f.resuelto || {};
        return {
          n2: texto(f.n2), c1: texto(f.c1),
          propio: { po: texto(f.po), so: texto(f.so), director: texto(f.director) },
          resuelto: { po: texto(r.po), so: texto(r.so), director: texto(r.director) },
          fuenteC1: texto(f.fuente_c1),
          vigente: f.vigente === true,
          usada: f.usada !== false
        };
      });
      var vistos = {};
      var personas = json.personas.filter(function (p) {
        var k = p && llave(p.nombre);
        if (!k || vistos[k]) return false;
        vistos[k] = true;
        return true;
      }).map(function (p) { return { nombre: texto(p.nombre), rol: texto(p.rol), manager: texto(p.manager) }; });
      return new CatalogoDuenos(filas, personas);
    }

    persona(nombre) { return this.personaPorNombre[llave(nombre)] || null; }
    fila(n2) { return this.usadaPorN2[llave(n2)] || null; }

    // La fila de la que hereda `f` (la fuente de su C1), o null.
    fuente(f) { return f.fuenteC1 ? this.fila(f.fuenteC1) : null; }
    esFuente(f) { return !!f.fuenteC1 && llave(f.fuenteC1) === llave(f.n2) && f.usada; }

    // { tipo: 'propio' | 'heredado' | 'falta', valor, desde } con lo que
    // resolvio el servidor.
    origen(f, campo) {
      if (f.propio[campo]) return { tipo: 'propio', valor: f.propio[campo], desde: null };
      if (f.resuelto[campo]) return { tipo: 'heredado', valor: f.resuelto[campo], desde: f.fuenteC1 };
      return { tipo: 'falta', valor: null, desde: null };
    }

    // Filas que toman `campo` de `f` porque `f` es la fuente de su C1 y ellas
    // no lo tienen capturado.
    dependientes(f, campo) {
      if (!this.esFuente(f)) return [];
      return this.filas.filter(function (x) {
        return x !== f && x.usada && llave(x.fuenteC1) === llave(f.n2) && !x.propio[campo];
      });
    }

    hallazgos(f) {
      var self = this, h = [];
      if (!f.vigente) h.push({ clave: 'no_vigente', texto: 'Dada de baja en el origen; el sitio sigue resolviendo sus dueños.' });
      if (!f.usada) h.push({ clave: 'repetida', texto: 'N2 repetido: el sitio usa otra fila con el mismo nombre.' });
      if (!f.c1) h.push({ clave: 'sin_c1', texto: 'Sin C1: lo que no tenga capturado no se puede heredar.' });
      CAMPOS.forEach(function (c) {
        var o = self.origen(f, c.clave);
        if (o.tipo === 'falta') {
          h.push({ clave: 'falta', campo: c.clave, texto: 'Sin ' + c.rotulo + ', ni propio ni heredado.' });
          return;
        }
        if (o.tipo === 'heredado') {
          var fu = self.fuente(f);
          if (fu && !fu.vigente) {
            h.push({ clave: 'fuente_no_vigente', campo: c.clave,
                     texto: c.rotulo + ' heredado de ' + fu.n2 + ', que está dada de baja.' });
          }
        }
        if (!self.persona(o.valor)) {
          h.push({ clave: 'persona_desconocida', campo: c.clave,
                   texto: o.valor + ' (' + c.rotulo + ') no está en CatPersona vigente.' });
        }
      });
      return h;
    }

    // filtro: clave de FILTROS; busqueda: N2, C1 o nombre de un dueño.
    filtrar(filtro, busqueda) {
      var self = this;
      var regla = FILTROS[filtro] || FILTROS.vigentes;
      var q = plano(busqueda);
      return this.filas.filter(function (f) {
        if (!regla.pasa(self, f)) return false;
        if (!q) return true;
        var textos = [f.n2, f.c1].concat(CAMPOS.map(function (c) { return self.origen(f, c.clave).valor; }));
        return textos.some(function (t) { return plano(t).indexOf(q) >= 0; });
      });
    }

    // Cuantas filas pasa cada filtro (sin busqueda).
    resumen() {
      var self = this, r = {};
      Object.keys(FILTROS).forEach(function (k) { r[k] = self.filtrar(k, '').length; });
      return r;
    }
  }

  // ---------------------------------------------------------------------
  // PropuestaDuenos: borrador de una categoria, en memoria
  // ---------------------------------------------------------------------
  class PropuestaDuenos {
    constructor(catalogo, fila) {
      this.catalogo = catalogo;
      this.fila = fila;
      this.original = { po: fila.propio.po || '', so: fila.propio.so || '', director: fila.propio.director || '' };
      this.valores = { po: this.original.po, so: this.original.so, director: this.original.director };
      // El calculo local tiene que reproducir lo que resolvio el servidor;
      // si no, la vista previa no seria confiable.
      var self = this;
      this.consistente = CAMPOS.every(function (c) {
        return (self.efectivo(c.clave, self.original).valor || null) === (fila.resuelto[c.clave] || null);
      });
    }

    // Solo la fila que el sitio usa se puede preparar.
    habilitada() { return this.fila.usada && this.consistente; }

    // Opciones de un campo: las personas de CatPersona y, si el valor
    // capturado hoy no esta entre ellas, ese valor (para poder dejarlo como
    // esta), marcado. '' = sin valor propio (hereda del C1).
    opciones(campo) {
      var lista = this.catalogo.personas.map(function (p) { return { valor: p.nombre, verificada: true }; });
      var actual = this.original[campo];
      if (actual && !this.catalogo.persona(actual)) lista.unshift({ valor: actual, verificada: false });
      return lista;
    }

    // Acepta '' o una opcion de opciones(campo); cualquier otro texto no.
    asignar(campo, valor) {
      if (!Object.prototype.hasOwnProperty.call(this.valores, campo) || !this.habilitada()) return false;
      var v = texto(valor) || '';
      if (v !== '' && !this.catalogo.persona(v) && llave(v) !== llave(this.original[campo])) return false;
      var p = v ? this.catalogo.persona(v) : null;
      this.valores[campo] = p ? p.nombre : v;
      return true;
    }

    // Valor efectivo de `campo` con `valores` como lo capturado de la fila:
    // propio, o el de la fuente del C1, o falta. Si la fila ES la fuente, lo
    // heredado seria ella misma: sin valor propio, falta.
    efectivo(campo, valores) {
      var propio = texto(valores[campo]);
      if (propio) return { tipo: 'propio', valor: propio, desde: null };
      var f = this.fila;
      if (this.catalogo.esFuente(f)) return { tipo: 'falta', valor: null, desde: null };
      var fu = this.catalogo.fuente(f);
      var h = fu ? fu.propio[campo] : null;
      return h ? { tipo: 'heredado', valor: h, desde: fu.n2 } : { tipo: 'falta', valor: null, desde: null };
    }

    cambios() {
      var self = this;
      return CAMPOS.filter(function (c) { return self.valores[c.clave] !== self.original[c.clave]; }).map(function (c) {
        return { campo: c.clave, rotulo: c.rotulo, anterior: self.original[c.clave], nuevo: self.valores[c.clave] };
      });
    }

    // Antes/despues por campo, y las filas dependientes cuyo valor cambiaria.
    vista() {
      var self = this, cat = this.catalogo, f = this.fila;
      return CAMPOS.map(function (c) {
        var antes = cat.origen(f, c.clave);
        var despues = self.efectivo(c.clave, self.valores);
        var cambiaPropio = self.valores[c.clave] !== self.original[c.clave];
        var deps = cambiaPropio ? cat.dependientes(f, c.clave).map(function (d) {
          return { n2: d.n2, anterior: d.resuelto[c.clave], nuevo: texto(self.valores[c.clave]) };
        }).filter(function (d) { return d.anterior !== d.nuevo; }) : [];
        return {
          campo: c.clave, rotulo: c.rotulo, antes: antes, despues: despues,
          cambia: antes.valor !== despues.valor || antes.tipo !== despues.tipo,
          dependientes: deps
        };
      });
    }

    // Lo que veria quien revisa. NO es un guardado.
    revisar() {
      var vista = this.vista();
      var advertencias = [];
      vista.forEach(function (v) {
        if (v.despues.tipo === 'falta' && v.antes.tipo !== 'falta') {
          advertencias.push(v.rotulo + ' quedaría sin valor (ni propio ni heredado).');
        }
        if (v.dependientes.length) {
          advertencias.push(v.dependientes.length + (v.dependientes.length === 1 ? ' categoría hereda' : ' categorías heredan') +
            ' ' + v.rotulo + ' de esta fila y también cambiaría' + (v.dependientes.length === 1 ? '' : 'n') + '.');
        }
      });
      return {
        cambios: this.cambios(),
        vista: vista,
        advertencias: advertencias,
        dependientes: vista.reduce(function (n, v) { return n + v.dependientes.length; }, 0),
        guardado: false,
        aviso: AVISO_PROTOTIPO
      };
    }
  }

  // ---------------------------------------------------------------------
  // VistaDuenos
  // ---------------------------------------------------------------------
  function htmlOrigen(o) {
    if (o.tipo === 'falta') return '<span class="cd-origen falta">Falta</span>';
    var v = Escape.html(o.valor);
    return o.tipo === 'heredado'
      ? v + ' <span class="cd-origen heredado" title="' + Escape.attr('Heredado de ' + (o.desde || 'su C1')) + '">heredado</span>'
      : v;
  }

  class VistaDuenos {
    // pedir: funcion que devuelve el fetch a usar (el de la pagina).
    constructor(doc, pedir) {
      this.doc = doc;
      this.pedir = pedir || function () { return fetch; };
      this.catalogo = null;
      this.carga = null;       // promesa en curso o resuelta
      this.cargaId = 0;
      this.filtro = 'vigentes';
      this.busqueda = '';
      this.propuesta = null;
      this.cableado = false;
    }

    $(id) { return this.doc.getElementById(id); }

    // Se pide la primera vez que se abre la seccion; despues, nada.
    abrir() {
      this.cablear();
      if (!this.carga) this.carga = this.cargar();
      return this.carga;
    }

    cargar() {
      var self = this, mia = ++this.cargaId;
      this.estado('cargando');
      var pedir = this.pedir() || fetch;
      return Promise.resolve()
        .then(function () { return pedir(URL_DUENOS, { cache: 'no-store' }); })
        .then(function (r) {
          return r.json().catch(function () { return null; }).then(function (json) {
            if (!r.ok) throw new Error((json && json.error) || ('El servidor respondió ' + r.status + '.'));
            return json;
          });
        })
        .then(function (json) {
          if (mia !== self.cargaId) return;
          self.catalogo = CatalogoDuenos.desdeJson(json);
          self.estado('listo');
          self.pintarLista();
        })
        .catch(function (err) {
          if (mia !== self.cargaId) return;
          self.catalogo = null;
          self.carga = null;   // Reintentar vuelve a pedir
          self.$('cdErrorTexto').textContent = (err && err.message) || 'No se pudo cargar el catálogo.';
          self.estado('error');
        });
    }

    estado(e) {
      this.$('cdCargando').hidden = e !== 'cargando';
      this.$('cdError').hidden = e !== 'error';
      this.$('cdContenido').hidden = e !== 'listo';
    }

    cablear() {
      if (this.cableado) return;
      this.cableado = true;
      var self = this;
      var filtro = this.$('cdFiltro');
      filtro.innerHTML = Object.keys(FILTROS).map(function (k) {
        return '<option value="' + Escape.attr(k) + '">' + Escape.html(FILTROS[k].rotulo) + '</option>';
      }).join('');
      filtro.value = this.filtro;
      filtro.addEventListener('change', function (e) { self.filtro = FILTROS[e.target.value] ? e.target.value : 'vigentes'; self.pintarLista(); });
      this.$('cdBuscar').addEventListener('input', function (e) { self.busqueda = e.target.value || ''; self.pintarLista(); });
      this.$('cdReintentar').addEventListener('click', function () { self.carga = self.cargar(); });
      this.$('cdCuerpo').addEventListener('click', function (e) {
        var el = e.target;
        if (el && el.closest) el = el.closest('[data-n2]');
        var n2 = el && el.getAttribute && el.getAttribute('data-n2');
        if (n2) self.elegir(n2);
      });
      this.$('cdDetalle').addEventListener('change', function (e) {
        var campo = e.target && e.target.getAttribute && e.target.getAttribute('data-cd-campo');
        if (campo && self.propuesta) {
          self.propuesta.asignar(campo, e.target.value);
          self.pintarVista();
        }
      });
      this.$('cdDetalle').addEventListener('click', function (e) {
        var el = e.target;
        if (el && el.closest) el = el.closest('[data-cd-accion]');
        var accion = el && el.getAttribute && el.getAttribute('data-cd-accion');
        if (accion === 'revisar') self.revisar();
        else if (accion === 'descartar' && self.propuesta) self.elegir(self.propuesta.fila.n2);
        else if (accion === 'cerrar') self.cerrar();
      });
    }

    pintarLista() {
      if (!this.catalogo) return;
      var self = this, cat = this.catalogo;
      var lista = cat.filtrar(this.filtro, this.busqueda);
      var r = cat.resumen();
      this.$('cdResumen').textContent = r.vigentes + ' vigentes · ' + r.heredadas + ' con dueños heredados · ' +
        r.faltantes + ' con faltantes · ' + r.inconsistencias + ' con hallazgos · ' + r.no_vigentes + ' dadas de baja';
      this.$('cdCuenta').textContent = lista.length + (lista.length === 1 ? ' categoría' : ' categorías');
      this.$('cdVacio').hidden = lista.length > 0;
      this.$('cdCuerpo').innerHTML = lista.map(function (f) {
        var h = cat.hallazgos(f);
        return '<tr class="cd-fila' + (f.vigente ? '' : ' cd-baja') + '">' +
          '<td><button type="button" class="ini-folio" data-n2="' + Escape.attr(f.n2) + '">' + Escape.html(f.n2) + '</button></td>' +
          '<td>' + Escape.html(f.c1 || '—') + '</td>' +
          CAMPOS.map(function (c) { return '<td>' + htmlOrigen(cat.origen(f, c.clave)) + '</td>'; }).join('') +
          '<td class="num">' + (h.length ? '<span class="cd-hallazgos" title="' + Escape.attr(h.map(function (x) { return x.texto; }).join('\n')) + '">' + h.length + '</span>' : '—') + '</td>' +
          '</tr>';
      }).join('');
    }

    // Abre (o reinicia) el borrador de una categoria.
    elegir(n2) {
      if (!this.catalogo) return;
      var f = null;
      this.catalogo.filas.forEach(function (x) { if (!f && x.n2 === n2) f = x; });
      if (!f) return;
      this.propuesta = new PropuestaDuenos(this.catalogo, f);
      this.$('cdDetalle').hidden = false;
      this.$('cdDetTitulo').textContent = f.n2;
      this.pintarDetalle();
    }

    cerrar() {
      this.propuesta = null;
      this.$('cdDetalle').hidden = true;
    }

    pintarDetalle() {
      var p = this.propuesta, cat = this.catalogo, f = p.fila;
      var fu = cat.fuente(f);
      var h = cat.hallazgos(f);
      var herencia = !f.c1 ? 'Sin C1: no hereda.'
        : cat.esFuente(f) ? 'Es la fila fuente de su C1 (' + f.c1 + '): las categorías del C1 sin dueño capturado heredan de esta.'
        : fu ? 'Hereda de ' + fu.n2 + ' (fuente de ' + f.c1 + ') lo que no tiene capturado.'
        : 'Su C1 (' + f.c1 + ') no tiene fila fuente.';
      var controles = CAMPOS.map(function (c) {
        var ops = '<option value="">— Sin valor propio (heredar del C1) —</option>' + p.opciones(c.clave).map(function (o) {
          return '<option value="' + Escape.attr(o.valor) + '"' + (o.valor === p.valores[c.clave] ? ' selected' : '') + '>' +
            Escape.html(o.valor + (o.verificada ? '' : ' (no está en CatPersona)')) + '</option>';
        }).join('');
        return '<div class="campo"><label for="cd-' + c.clave + '">' + Escape.html(c.rotulo) + ' (capturado)</label>' +
          '<select id="cd-' + c.clave + '" data-cd-campo="' + c.clave + '"' + (p.habilitada() ? '' : ' disabled') + '>' + ops + '</select></div>';
      }).join('');
      var bloqueo = !f.usada ? 'El sitio no usa esta fila (N2 repetido): no se pueden preparar cambios aquí.'
        : !p.consistente ? 'El cálculo local no reproduce los dueños que resolvió el servidor: no se ofrece vista previa.' : '';
      this.$('cdDetCuerpo').innerHTML =
        '<p class="ini-prototipo-aviso" role="note">' + Escape.html(AVISO_PROTOTIPO) + '</p>' +
        '<p class="ini-nota">' + Escape.html(herencia) + (f.vigente ? '' : ' Fila dada de baja en el origen.') + '</p>' +
        (h.length ? '<div class="ini-incompleta" role="note"><strong>Hallazgos</strong><ul>' +
          h.map(function (x) { return '<li>' + Escape.html(x.texto) + '</li>'; }).join('') + '</ul></div>' : '') +
        (bloqueo ? '<p class="ini-nota">' + Escape.html(bloqueo) + '</p>' : '') +
        '<div class="ini-cambio-campos">' + controles + '</div>' +
        '<div id="cdVista"></div>' +
        '<div class="ini-cambio-msg" id="cdMsg" role="status" aria-live="polite"></div>' +
        '<div class="ini-cambio-pie">' +
          '<button type="button" class="btn chico" data-cd-accion="revisar"' + (p.habilitada() ? '' : ' disabled') + '>Revisar propuesta</button> ' +
          '<button type="button" class="btn chico" disabled aria-describedby="cdGuardarNota">Guardar (no disponible)</button> ' +
          '<button type="button" class="btn linea chico" data-cd-accion="descartar">Descartar cambios</button> ' +
          '<button type="button" class="btn linea chico" data-cd-accion="cerrar">Cerrar</button>' +
        '</div>' +
        '<small class="ini-sub" id="cdGuardarNota">Solo vista previa: guardar se habilitará con la persistencia aprobada.</small>';
      this.pintarVista();
    }

    // Antes / despues de los tres campos.
    pintarVista() {
      var p = this.propuesta, caja = this.$('cdVista');
      if (!p || !caja) return;
      if (!p.habilitada()) { caja.innerHTML = ''; return; }
      var vista = p.vista();
      caja.innerHTML = '<div class="ini-det-tabla"><table><caption class="ini-sr">Antes y después</caption><thead><tr>' +
        '<th scope="col">Campo</th><th scope="col">Antes</th><th scope="col">Después</th></tr></thead><tbody>' +
        vista.map(function (v) {
          return '<tr' + (v.cambia ? ' class="cd-cambia"' : '') + '><th scope="row">' + Escape.html(v.rotulo) + '</th>' +
            '<td>' + htmlOrigen(v.antes) + '</td><td>' + htmlOrigen(v.despues) + '</td></tr>';
        }).join('') + '</tbody></table></div>' +
        vista.filter(function (v) { return v.dependientes.length; }).map(function (v) {
          return '<p class="ini-nota">' + Escape.html(v.rotulo) + ' también cambiaría en: ' +
            v.dependientes.map(function (d) {
              return Escape.html(d.n2 + ' (' + (d.anterior || 'sin valor') + ' → ' + (d.nuevo || 'sin valor') + ')');
            }).join(', ') + '.</p>';
        }).join('');
    }

    revisar() {
      if (!this.propuesta || !this.propuesta.habilitada()) return null;
      var r = this.propuesta.revisar();
      var msg = this.$('cdMsg');
      msg.className = 'ini-cambio-msg ' + (r.cambios.length ? 'listo' : '');
      msg.innerHTML = '<strong class="ini-prototipo-marca">' +
          Escape.html(r.cambios.length ? 'Propuesta revisada, no guardada.' : 'Sin cambios.') + '</strong>' +
        (r.cambios.length ? '<ul>' + r.cambios.map(function (c) {
          return '<li>' + Escape.html(c.rotulo + ': ' + (c.anterior || '(sin valor propio)') + ' → ' + (c.nuevo || '(sin valor propio)')) + '</li>';
        }).join('') + '</ul>' : '') +
        (r.advertencias.length ? '<ul>' + r.advertencias.map(function (a) { return '<li>' + Escape.html(a) + '</li>'; }).join('') + '</ul>' : '') +
        '<p class="ini-prototipo-aviso">' + Escape.html(r.aviso) + '</p>';
      return r;
    }
  }

  return {
    URL_DUENOS: URL_DUENOS,
    CAMPOS: CAMPOS,
    FILTROS: FILTROS,
    AVISO_PROTOTIPO: AVISO_PROTOTIPO,
    rotuloDe: rotuloDe,
    CatalogoDuenos: CatalogoDuenos,
    PropuestaDuenos: PropuestaDuenos,
    VistaDuenos: VistaDuenos
  };
})();
