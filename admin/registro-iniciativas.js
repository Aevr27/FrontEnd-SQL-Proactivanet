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
     Estado               varios a la vez (O), igual que Tipo de
                          iniciativa: opciones = los estados que trae el
                          registro (activos primero); todos marcados por
                          omision; "Todos" alterna; ninguno = lista vacia.
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
                          Una iniciativa pasa si UNA de sus categorias cumple
                          todo lo elegido a la vez. Las que no tienen
                          categoria se comparan con los dueños del propio
                          Problem (pasaFiltroIniciativa de Experiencia) y no
                          pasan un filtro de Categoria.

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
     VistaRegistro    el DOM: carga, estados, KPIs, filtros, tabla, detalle,
                      y la vista Cobertura

   DETALLE: SOLICITAR CAMBIOS E HISTORIAL (SIN PERSISTENCIA TODAVIA)
   ----------------------------------------------------------------
     El detalle sigue siendo de solo lectura: nada se edita en el lugar.
     "Solicitar cambios" abre un borrador (SolicitudCambio) que se valida en
     el navegador y NO se envia: no existe aun el registro de solicitudes en
     la base (ni su numero #0000001). Campos que se pueden pedir cambiar:
     solo las fechas compromiso (CAMPOS_CAMBIO); los demas se agregaran
     cuando se designen explicitamente.
     "Historial de cambios (N)" nace plegado. Pinta `historial`, las filas
     de dbo.ProblemFechaEvento de la iniciativa en orden de IdEvento
     (App_Code/HistorialFechas.cs): { id, campo, anterior, nuevo, operacion,
     origen, usuario, solicitud, fecha, reconstruido }. Los rotulos los pone
     etiquetarHistorial (sql/PROPUESTA_historial_fechas.md seccion 4): Linea
     base, Fecha inicial, Fecha asignada, Fecha retirada y "Cambio n", que es
     lo unico que cuenta y lo que da N. En FechaCierre solo cuentan las
     extensiones (nueva > anterior): un adelanto se muestra sin numero
     (regla del 2026-10-09). Los NroCambioFecha* del Excel siguen en
     Seguimiento tal cual.

   Se prueba en node: tools/tests/RegistroIniciativasSmoke.js.
   ========================================================================= */
window.RegistroIniciativas = (function () {
  'use strict';

  var URL_REGISTRO = '../handlers/admin_iniciativas_registro.ashx';
  // El catalogo de categorias de Nueva solicitud. Solo se pide al abrir la
  // Cobertura, nunca al cargar la pagina.
  var URL_CATALOGO = '../handlers/admin_iniciativas_catalogos.ashx';
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
    }

    // Suma el catalogo a las filas organizacionales (la cascada y el filtro).
    ampliar(filasCatalogo) { this.catalogo = filasCatalogo; }

    // Las filas con las que se filtra una iniciativa: las de filasDe y, con
    // el catalogo cargado, ademas la CategoriaN2 de cada ruta (mismos
    // dueños), para que elegir una categoria del catalogo encuentre las
    // iniciativas que cuelgan de ella.
    filasDeIniciativa(i) {
      var filas = Registro.filasDe(i);
      if (!this.catalogo || i.sin_categoria) return filas;
      i.categorias.forEach(function (c) {
        if (c.n2 && c.n2 !== c.categoria) {
          filas.push({ director: c.director || '', po: c.po || '', so: c.so || '', categoria: c.n2 });
        }
      });
      return filas;
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

    filasOrganizacionales(director) {
      var salida = [], self = this;
      this.iniciativas.forEach(function (i) {
        self.filasDeIniciativa(i).forEach(function (f) { if (!director || f.director === director) salida.push(f); });
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
      var marcados = this.lista();
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
    }

    // Estado: solo `v` ('' = todos). Para varios, alternarEstado.
    elegirEstado(v) { this.estados.solo(v); }
    alternarEstado(v) { this.estados.alternar(v); }
    todosEstados() { this.estados.todas(); }
    estadosMarcados() { return this.estados.lista(); }

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

    limpiar() {
      this.estados.limpiar();
      this.tipos.limpiar();
      this.elegirDirector('');
      this.cascada.limpiar(0);
    }

    activos() {
      var org = this.cascada.filtros();
      return (this.estados.activo() ? 1 : 0) + (this.tipos.activo() ? 1 : 0) + (this.director ? 1 : 0) + Object.keys(org).length;
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

    aplicar(lista) {
      var self = this;
      return lista.filter(function (i) { return self.pasa(i); });
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

  // Lo que hoy se puede pedir cambiar de una iniciativa: SOLO las tres
  // fechas compromiso (las de FECHA_DEL_ESTADO). Otros campos se agregan
  // aqui cuando se designen explicitamente; no se adivinan.
  var CAMPOS_CAMBIO = [
    { clave: 'f_analisis', rotulo: 'Fecha compromiso de Análisis' },
    { clave: 'f_solucion', rotulo: 'Fecha compromiso de Solución' },
    { clave: 'f_cierre', rotulo: 'Fecha compromiso de Cierre' }
  ];

  // Historial de fechas: el nombre corto de cada columna de dbo.Problem.
  var CAMPOS_HISTORIAL = { FechaAnalisis: 'Análisis', FechaSolucion: 'Solución', FechaCierre: 'Cierre' };

  // Rotulo de cada fila del historial, en el orden en que llegan (IdEvento).
  // Solo "Cambio n" cuenta; n corre por campo. En Cierre un adelanto
  // (nueva < anterior) no cuenta. Sin `operacion` la fila no es del
  // contrato: se rotula "—" y no cuenta.
  function etiquetarHistorial(lista) {
    var n = {};
    return (Array.isArray(lista) ? lista : []).map(function (h) {
      var e = '—', cuenta = false;
      if (!h || !h.operacion) {
        e = '—';
      } else if (h.operacion === 'B') {
        e = 'Línea base';
      } else if (h.operacion === 'I') {
        e = 'Fecha inicial';
      } else if (!h.anterior && h.nuevo) {
        e = 'Fecha asignada';
      } else if (h.anterior && !h.nuevo) {
        e = 'Fecha retirada';
      } else if (h.campo === 'FechaCierre' && String(h.nuevo) < String(h.anterior)) {
        e = 'Adelanto (no cuenta)';
      } else {
        n[h.campo] = (n[h.campo] || 0) + 1;
        e = 'Cambio ' + n[h.campo];
        cuenta = true;
      }
      return { fila: h || {}, etiqueta: e, cuenta: cuenta };
    });
  }

  function campoCambio(clave) {
    for (var k = 0; k < CAMPOS_CAMBIO.length; k++) if (CAMPOS_CAMBIO[k].clave === clave) return CAMPOS_CAMBIO[k];
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
  class SolicitudCambio {
    constructor(iniciativa) {
      this.iniciativa = iniciativa;
      // Por omision, la fecha del estado en el que esta (la que se suele
      // pedir extender); si no esta en uno de esos estados, ninguna.
      this.campo = FECHA_DEL_ESTADO[iniciativa.estado] || '';
      this.propuesto = '';
      this.motivo = '';
    }

    static campos() { return CAMPOS_CAMBIO.slice(); }

    actual() { return this.campo && this.iniciativa[this.campo] ? this.iniciativa[this.campo] : null; }

    // -> [{ campo, mensaje }]; vacia = lista para enviar (cuando se pueda).
    validar() {
      var errores = [];
      if (!campoCambio(this.campo)) {
        errores.push({ campo: 'campo', mensaje: 'Elige qué quieres cambiar.' });
      } else if (!fechaValida(this.propuesto)) {
        errores.push({ campo: 'propuesto', mensaje: 'Escribe la nueva fecha.' });
      } else if (this.propuesto === this.actual()) {
        errores.push({ campo: 'propuesto', mensaje: 'La nueva fecha es igual a la actual.' });
      }
      if (!String(this.motivo || '').trim()) {
        errores.push({ campo: 'motivo', mensaje: 'Explica el motivo del cambio.' });
      }
      return errores;
    }

    resumen() {
      var c = campoCambio(this.campo);
      return { folio: this.iniciativa.folio, campo: this.campo, rotulo: c ? c.rotulo : '',
               anterior: this.actual(), nuevo: this.propuesto, motivo: String(this.motivo || '').trim() };
    }
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
      this.coberturaCarga = 0;    // descarta respuestas superadas
      this.coberturaPromesa = null;
      this.covFiltro = '';        // '' | con | sin
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
          if (folio) self.abrirDetalle(folio, el);
        });
      });

      // Acciones dentro del detalle (se repinta al abrirlo: por delegacion).
      this.$('regDetCuerpo').addEventListener('click', function (e) {
        var el = e.target;
        if (el && el.closest) el = el.closest('[data-accion]');
        var accion = el && el.getAttribute && el.getAttribute('data-accion');
        if (accion) self.accionDetalle(accion);
      });
      this.$('regDetCuerpo').addEventListener('change', function (e) {
        if (e.target && e.target.id === 'regCambioCampo') self.elegirCampoCambio(e.target.value);
      });
      this.$('regDetCerrar').addEventListener('click', function () { self.cerrarDetalle(); });
      this.$('regDetFondo').addEventListener('click', function () { self.cerrarDetalle(); });
      this.doc.addEventListener('keydown', function (e) {
        if (e.key !== 'Escape') return;
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
      this.filtro.limpiar();
      this.refrescar();
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
      // La Cobertura cuelga del registro: se vuelve a pedir al reabrirla.
      this.cobertura = null;
      this.coberturaPromesa = null;
      this.coberturaCarga++;
      this.mostrarModo('registro');
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
    refrescar() {
      this.limite = PAGINA;
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
          // Desde aqui la cascada compartida ofrece tambien las categorias
          // y dueños del catalogo.
          registro.ampliar(self.cobertura.filas);
          self.filtro.rearmar();
          self.estadoCobertura('listo');
          self.refrescar();
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
      var n = f.activos();
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
      this.cambio = new SolicitudCambio(i);
      this.cambioAbierto = false;
      this.histAbierto = false;
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
      this.cambio = null;
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

    // ---- Solicitar cambios / Historial ----
    accionDetalle(accion) {
      if (!this.abierta) return;
      if (accion === 'solicitar-cambios') this.abrirCambio(!this.cambioAbierto);
      else if (accion === 'cambio-cancelar') this.abrirCambio(false);
      else if (accion === 'cambio-preparar') this.prepararCambio();
      else if (accion === 'historial') this.plegarHistorial();
    }

    // Abrir arranca un borrador nuevo sobre la iniciativa abierta.
    abrirCambio(abrir) {
      var i = this.registro && this.registro.buscar(this.abierta);
      if (!i) return;
      this.cambio = new SolicitudCambio(i);
      this.cambioAbierto = abrir;
      this.$('regCambio').innerHTML = abrir ? this.htmlCambio() : '';
      this.$('regCambio').hidden = !abrir;
      this.$('regCambioBoton').setAttribute('aria-expanded', abrir ? 'true' : 'false');
      var foco = abrir ? this.$('regCambioCampo') : this.$('regCambioBoton');
      if (foco && foco.focus) foco.focus();
    }

    elegirCampoCambio(v) {
      if (!this.cambio) return;
      this.cambio.campo = campoCambio(v) ? v : '';
      this.$('regCambioActual').textContent = fecha(this.cambio.actual());
    }

    // Valida el borrador. NO lo envia: no hay donde guardarlo todavia.
    prepararCambio() {
      if (!this.cambio) return;
      var c = this.cambio, self = this;
      var campo = this.$('regCambioCampo').value;
      c.campo = campoCambio(campo) ? campo : '';
      c.propuesto = this.$('regCambioNueva').value || '';
      c.motivo = this.$('regCambioMotivo').value || '';
      var errores = c.validar();
      var por = {};
      errores.forEach(function (e) { por[e.campo] = true; });
      [['campo', 'regCambioCampo'], ['propuesto', 'regCambioNueva'], ['motivo', 'regCambioMotivo']].forEach(function (par) {
        self.$(par[1]).setAttribute('aria-invalid', por[par[0]] ? 'true' : 'false');
      });
      var msg = this.$('regCambioMsg');
      if (errores.length) {
        msg.className = 'ini-cambio-msg error';
        msg.innerHTML = '<ul>' + errores.map(function (e) { return '<li>' + Escape.html(e.mensaje) + '</li>'; }).join('') + '</ul>';
        return;
      }
      var r = c.resumen();
      msg.className = 'ini-cambio-msg listo';
      msg.innerHTML = '<strong>Solicitud preparada, no enviada.</strong> ' + Escape.html(r.rotulo) + ': ' +
        Escape.html(fecha(r.anterior)) + ' → ' + Escape.html(fecha(r.nuevo)) + '. ' +
        'El envío y la revisión se habilitarán cuando exista el registro de solicitudes; por ahora no se guarda nada.';
    }

    plegarHistorial() {
      this.histAbierto = !this.histAbierto;
      this.$('regHistBoton').setAttribute('aria-expanded', this.histAbierto ? 'true' : 'false');
      this.$('regHistCuerpo').hidden = !this.histAbierto;
    }

    htmlCambio() {
      var c = this.cambio;
      var opciones = '<option value="">— Elige —</option>' + CAMPOS_CAMBIO.map(function (x) {
        return '<option value="' + Escape.attr(x.clave) + '"' + (x.clave === c.campo ? ' selected' : '') + '>' + Escape.html(x.rotulo) + '</option>';
      }).join('');
      return '<h4>Solicitar cambios</h4>' +
        '<p class="ini-nota">Pide un cambio sobre esta iniciativa; aquí no se edita. Por ahora solo se pueden pedir cambios de fecha compromiso.</p>' +
        '<div class="ini-cambio-campos">' +
          '<div class="campo"><label for="regCambioCampo">Qué cambiar</label><select id="regCambioCampo">' + opciones + '</select></div>' +
          '<div class="campo"><span class="ini-cambio-rot">Valor actual</span><span class="ini-cambio-actual" id="regCambioActual">' +
            Escape.html(fecha(c.actual())) + '</span></div>' +
          '<div class="campo"><label for="regCambioNueva">Nueva fecha</label><input type="date" id="regCambioNueva"></div>' +
          '<div class="campo ini-cambio-ancho"><label for="regCambioMotivo">Motivo</label><textarea id="regCambioMotivo" rows="3"></textarea></div>' +
        '</div>' +
        '<div class="ini-cambio-msg" id="regCambioMsg" role="status" aria-live="polite"></div>' +
        '<div class="ini-cambio-pie">' +
          '<button type="button" class="btn chico" data-accion="cambio-preparar">Preparar solicitud</button> ' +
          '<button type="button" class="btn linea chico" data-accion="cambio-cancelar">Cancelar</button>' +
        '</div>';
    }

    htmlHistorial(i) {
      var filas = etiquetarHistorial(i.historial);
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
      return '<section class="ini-det-sec ini-det-ancha ini-hist">' +
        '<button type="button" class="ini-hist-boton" id="regHistBoton" data-accion="historial" aria-expanded="false" aria-controls="regHistCuerpo">' +
          '<svg class="ini-hist-ico" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M9.5 6.5 15 12l-5.5 5.5"/></svg>' +
          '<span>Historial de cambios (' + fmt(cambios) + ')</span></button>' +
        '<div class="ini-hist-cuerpo" id="regHistCuerpo" hidden>' + cuerpo + '</div></section>';
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
        '</div>' +
        '<div class="ini-det-acciones"><button type="button" class="btn linea chico" id="regCambioBoton" data-accion="solicitar-cambios"' +
          ' aria-expanded="false" aria-controls="regCambio">Solicitar cambios</button></div>' +
        '</div>' +
        '<section class="ini-det-sec ini-cambio" id="regCambio" hidden></section>';

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
        seccion('Descripción', desc, 'ini-det-ancha') +
        this.htmlHistorial(i);
    }
  }

  return {
    URL_REGISTRO: URL_REGISTRO,
    PAGINA: PAGINA,
    FECHA_DEL_ESTADO: FECHA_DEL_ESTADO,
    URL_CATALOGO: URL_CATALOGO,
    Registro: Registro,
    SeleccionVarios: SeleccionVarios,
    FiltroRegistro: FiltroRegistro,
    Cobertura: Cobertura,
    SolicitudCambio: SolicitudCambio,
    CAMPOS_CAMBIO: CAMPOS_CAMBIO,
    etiquetarHistorial: etiquetarHistorial,
    ordenar: ordenar,
    VistaRegistro: VistaRegistro
  };
})();
