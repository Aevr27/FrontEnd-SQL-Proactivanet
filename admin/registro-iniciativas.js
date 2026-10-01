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

   INDICADORES (sobre lo filtrado)
   -------------------------------
     Total        iniciativas del registro (una por folio).
     Activas      `seguimiento`: estado en estados_activos y agrupacion en
                  agrupadores. Es el criterio de la tabla "Activas" de
                  Experiencia (filasBaseAct).
     Retrasadas   `seguimiento` y `retrazado`, solo las que tienen categoria:
                  el criterio del KPI "Iniciativas Retrasadas" de
                  Experiencia. El pie suma riesgo_folio ("tickets en
                  riesgo").
     No activas   estado fuera de estados_activos. No se llama "Cerradas":
                  Experiencia no tiene ese concepto, solo activa / no activa.

   FILTROS
   -------
     Estado, Agrupacion   igualdad exacta con el valor de la iniciativa.
     Director -> Product Owner -> Service Owner -> Categoria
                          progresivos sobre las combinaciones REALES de las
                          categorias de las iniciativas (CascadaOrganizacional
                          en modo 'filtro', admin/cascada-organizacional.js).
                          Una iniciativa pasa si UNA de sus categorias cumple
                          todo lo elegido a la vez. Las que no tienen
                          categoria se comparan con los dueños del propio
                          Problem (pasaFiltroIniciativa de Experiencia) y no
                          pasan un filtro de Categoria.

   PIEZAS
   ------
     Registro         el JSON del handler, validado
     FiltroRegistro   lo elegido y que iniciativa pasa
     VistaRegistro    el DOM: carga, estados, KPIs, filtros, tabla, detalle

   Se prueba en node: tools/tests/RegistroIniciativasSmoke.js.
   ========================================================================= */
window.RegistroIniciativas = (function () {
  'use strict';

  var URL_REGISTRO = '../handlers/admin_iniciativas_registro.ashx';
  var CascadaOrganizacional = window.CascadaOrganizacional;

  // Cuantas filas pinta la tabla de una vez; "Mostrar mas" agrega otras
  // tantas. El filtro y el orden van siempre sobre el registro completo.
  var PAGINA = 100;

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
  function texto(v) { return v === null || v === undefined || v === '' ? '—' : v; }

  // ---------------------------------------------------------------------
  // Registro
  // ---------------------------------------------------------------------
  class Registro {
    constructor(iniciativas, estadosActivos, agrupadores, fechaGen) {
      this.iniciativas = iniciativas;
      this.estadosActivos = estadosActivos;
      this.agrupadores = agrupadores;
      this.fechaGen = fechaGen;
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
      return new Registro(lista,
        Array.isArray(json.estados_activos) ? json.estados_activos : [],
        Array.isArray(json.agrupadores) ? json.agrupadores : [],
        typeof json.fecha_gen === 'string' ? json.fecha_gen : '');
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

    filasOrganizacionales(director) {
      var salida = [];
      this.iniciativas.forEach(function (i) {
        Registro.filasDe(i).forEach(function (f) { if (!director || f.director === director) salida.push(f); });
      });
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

    tipos() {
      return distintos(this.iniciativas.map(function (i) { return i.agrup; })).sort(igualTexto);
    }

    buscar(folio) {
      for (var k = 0; k < this.iniciativas.length; k++) if (this.iniciativas[k].folio === folio) return this.iniciativas[k];
      return null;
    }

    // Los cuatro indicadores sobre una lista ya filtrada.
    static indicadores(lista) {
      var r = { total: lista.length, sinCategoria: 0, activas: 0, reduceActivas: 0,
                retrasadas: 0, riesgo: 0, noActivas: 0 };
      lista.forEach(function (i) {
        if (i.sin_categoria) r.sinCategoria++;
        if (!i.activa) r.noActivas++;
        if (!i.seguimiento) return;
        r.activas++;
        r.reduceActivas += numero(i.tickets_reduce);
        if (i.retrazado > 0 && !i.sin_categoria) {
          r.retrasadas++;
          r.riesgo += numero(i.riesgo_folio);
        }
      });
      return r;
    }
  }

  // ---------------------------------------------------------------------
  // FiltroRegistro
  // ---------------------------------------------------------------------
  class FiltroRegistro {
    constructor(registro) {
      this.registro = registro;
      this.estado = '';
      this.tipo = '';
      this.director = '';
      this.cascada = new CascadaOrganizacional(registro.filasOrganizacionales(''), 'filtro');
    }

    elegirEstado(v) { this.estado = this.registro.estados().indexOf(v) >= 0 ? v : ''; }
    elegirTipo(v) { this.tipo = this.registro.tipos().indexOf(v) >= 0 ? v : ''; }

    // El Director acota la cascada: se rearma con las filas de ese Director
    // y lo ya elegido abajo se conserva mientras siga siendo valido.
    elegirDirector(v) {
      this.director = this.registro.directores().indexOf(v) >= 0 ? v : '';
      var antes = this.cascada.seleccion.slice();
      this.cascada = new CascadaOrganizacional(this.registro.filasOrganizacionales(this.director), 'filtro');
      for (var n = 0; n < antes.length; n++) {
        if (antes[n] && !this.cascada.elegir(n, antes[n])) break;
      }
    }

    elegir(nivel, v) { return this.cascada.elegir(nivel, v); }

    limpiar() {
      this.estado = '';
      this.tipo = '';
      this.elegirDirector('');
      this.cascada.limpiar(0);
    }

    activos() {
      var org = this.cascada.filtros();
      return (this.estado ? 1 : 0) + (this.tipo ? 1 : 0) + (this.director ? 1 : 0) + Object.keys(org).length;
    }

    pasa(i) {
      if (this.estado && i.estado !== this.estado) return false;
      if (this.tipo && i.agrup !== this.tipo) return false;
      var director = this.director, org = this.cascada.filtros();
      var claves = Object.keys(org);
      if (!director && !claves.length) return true;
      return Registro.filasDe(i).some(function (f) {
        if (director && f.director !== director) return false;
        return claves.every(function (k) { return f[k] === org[k]; });
      });
    }

    aplicar(lista) {
      var self = this;
      return lista.filter(function (i) { return self.pasa(i); });
    }
  }

  // ---------------------------------------------------------------------
  // Orden de la tabla
  // ---------------------------------------------------------------------
  // Por omision, como las tablas de Experiencia: lo que mas tickets tiene en
  // riesgo arriba; luego las activas, luego lo que mas reduce.
  function fechaCompromiso(i) {
    var campo = FECHA_DEL_ESTADO[i.estado];
    return campo ? i[campo] || '' : '';
  }
  var COLUMNAS = {
    folio:   function (i) { return i.folio; },
    titulo:  function (i) { return (i.titulo || '').toLowerCase(); },
    estado:  function (i) { return i.estado || ''; },
    agrup:   function (i) { return i.agrup || ''; },
    po:      function (i) { return duenos(i, 'po')[0] || ''; },
    so:      function (i) { return duenos(i, 'so')[0] || ''; },
    reduce:  function (i) { return numero(i.tickets_reduce); },
    fecha:   function (i) { return fechaCompromiso(i); }
  };
  function ordenPorOmision(a, b) {
    return numero(b.riesgo_folio) - numero(a.riesgo_folio)
      || (b.activa ? 1 : 0) - (a.activa ? 1 : 0)
      || numero(b.tickets_reduce) - numero(a.tickets_reduce)
      || igualTexto(b.folio, a.folio);
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

  // ---------------------------------------------------------------------
  // VistaRegistro
  // ---------------------------------------------------------------------
  var SELECTS_ORG = ['regPo', 'regSo', 'regCategoria'];

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
    }

    $(id) { return this.doc.getElementById(id); }

    iniciar() {
      this.cablear();
      this.cargar();
      return this;
    }

    // ---- eventos ----
    cablear() {
      var self = this;
      this.$('regEstadoSel').addEventListener('change', function (e) {
        if (!self.filtro) return;
        self.filtro.elegirEstado(e.target.value); self.refrescar();
      });
      this.$('regTipo').addEventListener('change', function (e) {
        if (!self.filtro) return;
        self.filtro.elegirTipo(e.target.value); self.refrescar();
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
      this.$('regLimpiar').addEventListener('click', function () { self.limpiarFiltros(); });
      this.$('regLimpiarVacio').addEventListener('click', function () { self.limpiarFiltros(); });
      this.$('regMas').addEventListener('click', function () { self.limite += PAGINA; self.pintarTabla(); });
      this.$('regReintentar').addEventListener('click', function () { self.cargar(); });

      // Una fila se abre con su boton de folio o con un clic en la fila.
      this.$('regCuerpo').addEventListener('click', function (e) {
        var el = e.target;
        if (el && el.closest) el = el.closest('[data-folio]');
        var folio = el && el.getAttribute && el.getAttribute('data-folio');
        if (folio) self.abrirDetalle(folio, el);
      });
      this.$('regCabeza').addEventListener('click', function (e) {
        var el = e.target;
        if (el && el.closest) el = el.closest('[data-orden]');
        var col = el && el.getAttribute && el.getAttribute('data-orden');
        if (col) self.ordenarPor(col);
      });

      this.$('regDetCerrar').addEventListener('click', function () { self.cerrarDetalle(); });
      this.$('regDetFondo').addEventListener('click', function () { self.cerrarDetalle(); });
      this.doc.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && self.abierta) self.cerrarDetalle();
      });
    }

    limpiarFiltros() {
      if (!this.filtro) return;
      this.filtro.limpiar();
      this.refrescar();
    }

    ordenarPor(col) {
      if (!COLUMNAS[col]) return;
      if (this.orden && this.orden.col === col) {
        // asc -> desc -> por omision
        this.orden = this.orden.dir === 'asc' ? { col: col, dir: 'desc' } : null;
      } else {
        this.orden = { col: col, dir: col === 'reduce' ? 'desc' : 'asc' };
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
      this.cerrarDetalle();
      this.estadoVista('cargando');

      return Promise.resolve()
        .then(function () {
          return Promise.resolve(pedir(URL_REGISTRO)).catch(function () {
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
          if (mia !== self.cargaId) return;
          self.registro = Registro.desdeJson(json);
          self.filtro = new FiltroRegistro(self.registro);
          self.orden = null;
          self.limite = PAGINA;
          self.estadoVista(self.registro.iniciativas.length ? 'listo' : 'sinDatos');
          self.refrescar();
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
      if (!listo) {
        this.$('regKpis').innerHTML = estado === 'cargando' ? this.htmlKpisCargando() : '';
        this.bloquearFiltros(estado === 'cargando' ? 'Cargando…' : '');
      }
    }

    bloquearFiltros(texto) {
      var self = this;
      ['regEstadoSel', 'regTipo', 'regDirector'].concat(SELECTS_ORG).forEach(function (id) {
        var sel = self.$(id);
        Catalogos.llenar(sel, [], texto || '—');
        sel.disabled = true;
      });
    }

    // ---- pintado ----
    refrescar() {
      this.limite = PAGINA;
      this.pintarFiltros();
      this.pintarTabla();
    }

    filtradas() {
      return this.filtro ? this.filtro.aplicar(this.registro.iniciativas) : [];
    }

    pintarFiltros() {
      var f = this.filtro, r = this.registro;
      this.pintarSelect('regEstadoSel', r.estados(), f.estado, 'Todos');
      this.pintarSelect('regTipo', r.tipos(), f.tipo, 'Todas');
      this.pintarSelect('regDirector', r.directores(), f.director, 'Todos');
      var self = this;
      f.cascada.estado(true, '').forEach(function (e, i) {
        self.pintarSelect(SELECTS_ORG[i], e.opciones, e.valor, i === 2 ? 'Todas' : 'Todos');
      });
      var n = f.activos();
      this.$('regLimpiar').hidden = n === 0;
      this.$('regFiltrosCuenta').textContent = n ? (n === 1 ? '1 filtro activo' : n + ' filtros activos') : '';
    }

    pintarSelect(id, opciones, valor, todos) {
      var sel = this.$(id);
      Catalogos.llenar(sel, opciones, '— ' + todos + ' —');
      sel.value = valor || '';
      sel.disabled = opciones.length === 0;
    }

    htmlKpisCargando() {
      return ['Total de iniciativas', 'Activas', 'Retrasadas', 'No activas'].map(function (l) {
        return '<div class="kpi ini-kpi-cargando"><div class="lbl">' + Escape.html(l) + '</div>' +
          '<div class="val">…</div><div class="foot">Cargando…</div></div>';
      }).join('');
    }

    pintarKpis(lista) {
      var k = Registro.indicadores(lista);
      var agr = this.registro.agrupadores.join(' · ');
      var tarjetas = [
        { l: 'Total de iniciativas', v: k.total,
          f: k.sinCategoria ? fmt(k.sinCategoria) + ' sin categoría' : 'todas con categoría', s: '' },
        { l: 'Activas', v: k.activas, f: fmt(k.reduceActivas) + ' tickets a reducir', s: 'sv',
          t: 'En Análisis, En Solución o En Monitoreo, de ' + agr + ' (criterio de Experiencia).' },
        { l: 'Retrasadas', v: k.retrasadas, f: fmt(k.riesgo) + ' tickets en riesgo', s: k.retrasadas ? 'sr' : 'sv',
          t: 'Activas con la fecha de su estado vencida y con categoría (criterio de Experiencia).' },
        { l: 'No activas', v: k.noActivas, f: 'fuera de los estados activos', s: '',
          t: 'Estado distinto de ' + this.registro.estadosActivos.join(', ') + '.' }
      ];
      this.$('regKpis').innerHTML = tarjetas.map(function (c) {
        return '<div class="kpi ini-kpi ' + c.s + '"' + (c.t ? ' title="' + Escape.attr(c.t) + '"' : '') + '>' +
          '<div class="lbl">' + Escape.html(c.l) + '</div>' +
          '<div class="val">' + fmt(c.v) + '</div>' +
          '<div class="foot">' + Escape.html(c.f) + '</div></div>';
      }).join('');
    }

    pintarCabeza() {
      var orden = this.orden;
      var cols = [
        { c: 'folio', t: 'Código' }, { c: 'titulo', t: 'Título' }, { c: 'estado', t: 'Estado' },
        { c: 'agrup', t: 'Agrupación' }, { c: 'po', t: 'Product Owner' }, { c: 'so', t: 'Service Owner' },
        { c: 'reduce', t: 'Tickets a reducir', num: true }, { c: 'fecha', t: 'Fecha compromiso' }
      ];
      this.$('regCabeza').innerHTML = '<tr>' + cols.map(function (x) {
        var activa = orden && orden.col === x.c;
        var aria = activa ? (orden.dir === 'asc' ? 'ascending' : 'descending') : 'none';
        var flecha = activa ? '<span class="ord" aria-hidden="true">' + (orden.dir === 'asc' ? '▲' : '▼') + '</span>' : '';
        return '<th scope="col"' + (x.num ? ' class="num"' : '') + ' aria-sort="' + aria + '">' +
          '<button type="button" class="ini-orden" data-orden="' + x.c + '">' + Escape.html(x.t) + flecha + '</button></th>';
      }).join('') + '</tr>';
    }

    htmlDuenos(i, clave) {
      var lista = duenos(i, clave);
      if (!lista.length) return '<span class="ini-tenue">—</span>';
      if (lista.length === 1) return Escape.html(lista[0]);
      return '<span title="' + Escape.attr(lista.join('\n')) + '">' + Escape.html(lista[0]) +
        ' <span class="ini-mas">+' + (lista.length - 1) + '</span></span>';
    }

    htmlEstado(i) {
      var clase = i.activa ? 'dentro' : 'neutro';
      return '<span class="pill ' + clase + '">' + Escape.html(texto(i.estado)) + '</span>';
    }

    // Punto del semaforo + la fecha del estado actual. Retrasada: fecha en
    // rojo y la palabra, sin pintar la fila entera.
    htmlPunto(i) {
      var sem = i.sem_fecha === 'rojo' || i.sem_fecha === 'ambar' || i.sem_fecha === 'verde' ? i.sem_fecha : '';
      return sem ? '<span class="ini-sem ' + sem + '" aria-hidden="true"></span>' : '';
    }

    htmlCompromiso(i) {
      var f = fechaCompromiso(i);
      var punto = this.htmlPunto(i);
      if (!i.activa) return punto + '<span class="ini-tenue">—</span>';
      if (i.fecha_retrasada) {
        return punto + '<b class="ini-vencida">' + Escape.html(fecha(f)) + '</b> <span class="ini-retraso">Retrasada</span>';
      }
      return punto + Escape.html(f ? fecha(f) : 'Sin fecha');
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
        '<td data-col="Product Owner" class="ini-col-persona">' + this.htmlDuenos(i, 'po') + '</td>' +
        '<td data-col="Service Owner" class="ini-col-persona">' + this.htmlDuenos(i, 'so') + '</td>' +
        '<td data-col="Tickets a reducir" class="num">' + fmt(i.tickets_reduce) + '</td>' +
        '<td data-col="Fecha compromiso" class="fecha-cell">' + this.htmlCompromiso(i) + '</td>' +
        '</tr>';
    }

    pintarTabla() {
      if (!this.registro) return;
      var lista = this.filtradas();
      this.pintarKpis(lista);
      this.pintarCabeza();

      var vacio = lista.length === 0;
      this.$('regVacio').hidden = !vacio;
      this.$('regTablaCaja').hidden = vacio;

      var orden = ordenar(lista, this.orden);
      var visibles = orden.slice(0, this.limite);
      var self = this;
      this.$('regCuerpo').innerHTML = visibles.map(function (i) { return self.htmlFila(i); }).join('');

      var total = this.registro.iniciativas.length;
      this.$('regCuenta').textContent = vacio ? '' :
        (lista.length === total ? fmt(total) + ' iniciativas' : fmt(lista.length) + ' de ' + fmt(total) + ' iniciativas') +
        (visibles.length < lista.length ? ' · mostrando ' + fmt(visibles.length) : '');
      var quedan = lista.length - visibles.length;
      this.$('regMas').hidden = quedan <= 0;
      this.$('regMas').textContent = 'Mostrar ' + fmt(Math.min(PAGINA, quedan)) + ' más';
    }

    // ---- detalle ----
    abrirDetalle(folio, origen) {
      var i = this.registro && this.registro.buscar(folio);
      if (!i) return;
      this.abierta = folio;
      this.origenFoco = origen || null;
      this.$('regDetTitulo').textContent = i.folio;
      this.$('regDetCuerpo').innerHTML = this.htmlDetalle(i);
      this.$('regDetFondo').hidden = false;
      this.$('regDetalle').hidden = false;
      this.marcarRaiz(true);
      var cerrar = this.$('regDetCerrar');
      if (cerrar && cerrar.focus) cerrar.focus();
    }

    // Siempre deja el panel oculto; el foco solo vuelve si estaba abierto.
    cerrarDetalle() {
      var estaba = !!this.abierta;
      this.abierta = null;
      this.$('regDetalle').hidden = true;
      this.$('regDetFondo').hidden = true;
      this.marcarRaiz(false);
      var origen = this.origenFoco;
      this.origenFoco = null;
      if (!estaba) return;
      // El boton del folio de esa fila; si la fila ya no esta, nada.
      if (origen && origen.focus && origen.isConnected !== false) {
        var boton = origen.querySelector ? origen.querySelector('.ini-folio') : null;
        (boton || origen).focus();
      }
    }

    // .ini-detalle-abierto en <html> quita el scroll de la pagina de atras.
    marcarRaiz(abierto) {
      var raiz = this.doc.documentElement;
      if (raiz && raiz.classList) raiz.classList.toggle('ini-detalle-abierto', abierto);
    }

    htmlDetalle(i) {
      function dato(rotulo, valor, html) {
        return '<div class="ini-dato"><dt>' + Escape.html(rotulo) + '</dt><dd>' +
          (html ? valor : Escape.html(texto(valor))) + '</dd></div>';
      }
      function seccion(titulo, cuerpo, clase) {
        return '<section class="ini-det-sec' + (clase ? ' ' + clase : '') + '"><h4>' + Escape.html(titulo) + '</h4>' + cuerpo + '</section>';
      }
      function lista(valores) {
        return valores.length ? valores.map(function (v) { return Escape.html(v); }).join('<br>') : '—';
      }

      var cab = '<div class="ini-det-cab">' +
        '<p class="ini-det-nombre">' + Escape.html(texto(i.titulo)) + '</p>' +
        '<div class="ini-det-marcas">' + this.htmlEstado(i) +
          (i.agrup ? ' <span class="chip ini-chip">' + Escape.html(i.agrup) + '</span>' : '') +
          (i.activa && i.fecha_retrasada ? ' <span class="pill vencido">Retrasada</span>' : '') +
        '</div></div>';

      var ident = '<dl class="ini-datos">' +
        dato('Código', i.folio) +
        dato('Agrupación', i.agrup) +
        dato('Estado', i.estado) +
        dato('Antigüedad', fmt(i.antiguedad) + ' días') +
        (i.titulo_problem && i.titulo_problem !== i.titulo ? dato('Título del problema', i.titulo_problem) : '') +
        '</dl>';

      var varios = !i.sin_categoria && (duenos(i, 'po').length > 1 || duenos(i, 'so').length > 1 || duenos(i, 'director').length > 1);
      var org = '<dl class="ini-datos">' +
        dato('Director', lista(duenos(i, 'director')), true) +
        dato('Product Owner', lista(duenos(i, 'po')), true) +
        dato('Service Owner', lista(duenos(i, 'so')), true) +
        dato('Manager', i.manager) +
        '</dl>' +
        (i.sin_categoria ? '<p class="ini-nota">Sin categoría: los dueños son los capturados en el Problem.</p>'
          : '<p class="ini-nota">Dueños de sus categorías' + (varios ? '; varían por categoría (ver abajo).' : '.') +
            ' Manager: el del Service Owner ' + Escape.html(texto(i.so)) + '.</p>');

      var impacto = '<dl class="ini-datos ini-datos-num">' +
        dato('Tickets a reducir', fmt(i.tickets_reduce)) +
        dato('Tickets en riesgo', fmt(i.riesgo_folio)) +
        '</dl>' +
        '<p class="ini-nota">Tickets a reducir: suma de sus categorías. En riesgo: los mismos tickets si va retrasada.</p>';

      var cats = i.categorias.length
        ? '<div class="ini-det-tabla"><table><thead><tr><th scope="col">Categoría</th><th scope="col" class="num">% disminución</th>' +
            '<th scope="col" class="num">Tickets a reducir</th>' + (varios ? '<th scope="col">Product Owner</th><th scope="col">Service Owner</th>' : '') +
          '</tr></thead><tbody>' +
          i.categorias.map(function (c) {
            return '<tr><td class="ini-cat-ruta">' + Escape.html(texto(c.categoria)) + '</td>' +
              '<td class="num">' + pct(c.pct_dism) + '</td><td class="num">' + fmt(c.tickets_reduce) + '</td>' +
              (varios ? '<td>' + Escape.html(texto(c.po)) + '</td><td>' + Escape.html(texto(c.so)) + '</td>' : '') + '</tr>';
          }).join('') + '</tbody></table></div>'
        : '<p class="ini-nota">Esta iniciativa no tiene categorías asignadas.</p>';

      var actual = FECHA_DEL_ESTADO[i.estado];
      function etapa(nombre, campo, cambios) {
        var vencida = i.fecha_retrasada && actual === campo;
        var valor = i[campo] ? fecha(i[campo]) : '—';
        return '<tr' + (actual === campo ? ' class="ini-etapa-actual"' : '') + '><th scope="row">' + Escape.html(nombre) +
          (actual === campo ? ' <span class="ini-sub">estado actual</span>' : '') + '</th>' +
          '<td class="fecha-cell">' + (vencida ? '<b class="ini-vencida">' + Escape.html(valor) + '</b>' : Escape.html(valor)) + '</td>' +
          '<td class="num">' + fmt(cambios) + '</td></tr>';
      }
      var semTexto = { verde: 'Sin compromiso vigente', ambar: 'En tiempo o sin fecha', rojo: 'Retrasada' }[i.sem_fecha] || '—';
      var seguimiento =
        '<p class="ini-det-sem">' + this.htmlPunto(i) + Escape.html(semTexto) + '</p>' +
        '<div class="ini-det-tabla"><table><thead><tr><th scope="col">Fecha</th><th scope="col">Compromiso</th>' +
          '<th scope="col" class="num">Cambios</th></tr></thead><tbody>' +
          etapa('Análisis', 'f_analisis', i.n_analisis) +
          etapa('Solución', 'f_solucion', i.n_solucion) +
          etapa('Cierre', 'f_cierre', i.n_cierre) +
        '</tbody></table></div>';

      function textoLargo(v) {
        return v ? '<div class="ini-texto">' + Escape.html(v) + '</div>' : '<p class="ini-nota">Sin captura.</p>';
      }
      var desc = textoLargo(i.descripcion) +
        '<h5>Observaciones</h5>' + textoLargo(i.observaciones);

      return cab +
        '<div class="ini-det-rejilla">' +
          seccion('Identificación', ident) +
          seccion('Organización', org) +
          seccion('Impacto', impacto) +
          seccion('Seguimiento', seguimiento) +
        '</div>' +
        seccion('Categorías afectadas', cats, 'ini-det-ancha') +
        seccion('Descripción', desc, 'ini-det-ancha');
    }
  }

  return {
    URL_REGISTRO: URL_REGISTRO,
    PAGINA: PAGINA,
    FECHA_DEL_ESTADO: FECHA_DEL_ESTADO,
    Registro: Registro,
    FiltroRegistro: FiltroRegistro,
    ordenar: ordenar,
    VistaRegistro: VistaRegistro
  };
})();
