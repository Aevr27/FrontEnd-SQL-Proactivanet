/* =========================================================================
   admin/iniciativas.js

   Pagina oculta de administracion de iniciativas. Vistas Iniciativas
   (inicio) y Solicitudes con pestaña. Iniciativas es el registro de solo
   lectura de admin/registro-iniciativas.js (VistaRegistro, que esta pagina
   solo arranca). "Nueva solicitud" es una accion de Iniciativas, sin
   pestaña, con

       Tipo de iniciativa -> Product Owner -> Service Owner -> Categoria
                                                              -> Director (derivado)

   mas los campos de captura. No guarda nada: "Validar en el servidor"
   manda la solicitud a admin_iniciativas_validar.ashx, que la revisa
   (obligatorios, catalogo, cascada, %, capacidad de la categoria, RCA de
   Problem) y responde, sin numero de solicitud ni alta.

   REGLAS (el servidor es la autoridad; aqui solo se adelantan)
     Todos los campos son obligatorios. RCA: obligatorio si el tipo es el
     Problem del catalogo (tipo_problem del handler), opcional si no.
     % de disminucion: 0 a la capacidad DISPONIBLE de la Categoria
     (admin_iniciativas_capacidad.ashx), hasta dos decimales, sin multiplos
     obligatorios.

   DE DONDE SALE CADA COSA
   -----------------------
   Seleccion (lo elige quien solicita)
     Tipo de iniciativa   las filas de dbo.CatPrefijoProblem
                          (DashboardCatalogos.PrefijosIniciativa): se ve la
                          Descripcion y viaja el Prefijo, que es lo que valida
                          el servidor y el prefijo del codigo. Solo habilita
                          la cascada: en los datos no hay relacion tipo ->
                          categoria, asi que no filtra ninguna lista.
     PO / SO / Categoria  una fila por categoria REAL (ruta completa activa
                          de dbo.Categorias) con sus dueños resueltos por la
                          regla de siempre (C1&C2 exacto o C1;
                          CatalogoRutasIniciativa). La ruta es la llave de la
                          capacidad: cada una, su propio 100%. No hay arbol de personas:
                          cada select ofrece los valores de las filas que
                          cumplen TODO lo elegido arriba, asi que cualquier
                          opcion lleva a una categoria real.
   Derivado (lo pone el sistema, no se edita)
     Director             el de la fila de la categoria elegida. Si las filas
                          que quedan no coinciden en uno solo, no se adivina.
   Captura (lo escribe quien solicita)
     CAMPOS_COMUNES y DEFINICIONES_TIPO, abajo: 02 Informacion del problema
     (Titulo, Descripcion, Observaciones) y 03 Impacto: el % de
     disminucion de la Categoria elegida (captura) y, calculados de solo
     lectura, la Volumetria de esa categoria (VolumetriaCliente de
     admin/iniciativa-admin.js, la misma de Crear / Modificar: ultimos 30
     dias) y los Tickets a reducir = floor(volumetria x % / 100).
   Pendiente (no se pinta como campo, ver sql/diag_admin_nueva_solicitud.sql)
     El RCA se elige y se valida, pero todavia no se guarda ni hay numero
     de solicitud con que nombrarlo. Destino FUTURO confirmado (solo
     dependencia, nada implementado): SharePoint, sitio ProblemManagement,
     biblioteca "Documentos compartidos", carpeta General/Archivos RCA
     Problems:
       https://soriana0.sharepoint.com/sites/ProblemManagement/Documentos%20compartidos/Forms/AllItems.aspx?id=%2Fsites%2FProblemManagement%2FDocumentos%20compartidos%2FGeneral%2FArchivos%20RCA%20Problems
     Siguen sin decidir: mecanismo de subida, autenticacion y permisos,
     extensiones permitidas, convencion de nombre, duplicados/versiones,
     como se persiste la referencia al documento y si dbo.Problem.RCA tiene
     algun significado.
     Codigo, fechas,
     contadores, Estado, Subestado, Gerencia, Macroproceso, Causa, Proceso,
     comentarios, CuentaConWA y Volumetria del ultimo mes vienen hoy del
     Excel tal cual y su regla no esta verificada.

   Ni el Manager (jerarquia del Service Owner en CatPersona) ni el Lider de
   Backlog/QARE (el de un Grupo, CatLiderGrupo) entran en esta cascada.

   PIEZAS
   ------
     CatalogoIniciativas   el JSON del handler, validado
     CascadaOrganizacional PO -> SO -> Categoria y el Director derivado, en
                           modo 'creacion' (admin/cascada-organizacional.js,
                           compartida con cualquier pestaña que filtre)
     SolicitudNueva        el formulario sin DOM: tipo, cascada, valores
     PaginaIniciativas     el DOM: vistas, carga, estados, campos, ayuda
                           (y arranca VistaCrearAdmin, el alta directa de
                           ADM de admin/iniciativa-admin.js: otra vista,
                           otro borrador, sin las reglas de esta)
     MenuLateral           plegar/desplegar la barra lateral (copia de la
                           del tablero; sus entradas son enlaces de vuelta)

   BORRADOR
   --------
   SolicitudNueva ES el borrador: guarda tipo, cascada y textos. Cambiar de
   vista solo oculta paneles; al volver a Nueva solicitud se repinta desde
   ese objeto. El catalogo se carga una vez al abrir la pagina, asi que ir y
   volver no lo recrea. Vive en memoria: recargar la pagina lo pierde. No se
   guarda en el servidor.
   Las cuatro se prueban en node: tools/tests/IniciativasCascadaSmoke.js.
   ========================================================================= */
window.Iniciativas = (function () {
  'use strict';

  // ?rutas=1: las categorias REALES (ruta completa), que son la llave de la
  // capacidad: cada ruta tiene su propio 100%. Sin el parametro el handler
  // da las CategoriaN2, que solo usa la Cobertura del registro.
  var URL_CATALOGO = '../handlers/admin_iniciativas_catalogos.ashx?rutas=1';
  // Capacidad de la categoria (solo para mostrar) y validacion en el
  // servidor (la autoridad; no guarda nada).
  var URL_CAPACIDAD = '../handlers/admin_iniciativas_capacidad.ashx';
  var URL_VALIDAR = '../handlers/admin_iniciativas_validar.ashx';

  // RCA por el sitio APAGADO (2026-10-22): todavia no hay destino de
  // subida, asi que el bloque 04 solo dice a que correo mandarlo; no se pide
  // ni se envia archivo (el servidor tampoco lo exige: SolicitudIniciativa.
  // RcaEnSitio). enSitio = true vuelve a la regla de antes (obligatorio para
  // Problem). El correo lo dio el usuario; no sale de la base.
  var RCA = { enSitio: false, correo: 'problemTI@soriana.com' };

  // Rotulos de los campos obligatorios, para avisar cuales faltan. Las
  // claves son las de SolicitudNueva (Descripcion = 'analisis').
  var ROTULOS = {
    tipo: 'Tipo de iniciativa', po: 'Product Owner', so: 'Service Owner', categoria: 'Categoría',
    titulo: 'Título', analisis: 'Descripción', descripcion: 'Descripción', observaciones: 'Observaciones',
    volumetria: 'Volumetría', pct: '% Disminución', tickets: 'Tickets a reducir', rca: 'RCA',
    // Errores que solo da el servidor (admin_iniciativas_validar.ashx).
    solicitante: 'Solicitante', token: 'Borrador'
  };

  // ---------------------------------------------------------------------
  // Campos de captura
  // ---------------------------------------------------------------------
  //
  // Un campo:
  //   clave      identificador (id del control: 'campo-' + clave)
  //   etiqueta   texto del rotulo
  //   control    'texto' | 'multilinea' | 'entero' | 'porcentaje' |
  //              'calculado' (solo lectura: lo pone SolicitudNueva.calculado,
  //              no se captura)
  //   obligatorio  solo en 'calculado': sin valor cuenta como faltante
  //   seccion    solo en comunes: 'info' (02) o 'impacto' (03)
  //   destino    solo documentacion: la columna a la que iria, o null si
  //              no esta confirmada. Nada se guarda todavia.
  //   ayuda      opcional { texto, nota? }: el rotulo entero se vuelve
  //              destino de GloboAyuda (patron "Pregunta" de QARE)
  //   reiniciaConCascada  se vacia si cambia PO, SO o Categoria (un campo
  //              que dependa de la categoria)
  //   requiereCategoria   ademas, bloqueado hasta elegir la Categoria
  //
  // Comunes a todos los tipos. Cambiar de tipo NO borra los de 02; el % de
  // 03 si, porque cambiar de tipo vacia la cascada y con ella la Categoria.
  //
  // Textos de ayuda: los de la plantilla con que ya se capturan los
  // Problems (los de Titulo y Descripcion se ven dentro de
  // dbo.Problem.Descripcion en Experiencia) y las definiciones que dio
  // negocio. No se redactan aqui.
  var CAMPOS_COMUNES = [
    { clave: 'titulo', etiqueta: 'Título', control: 'texto', seccion: 'info',
      destino: 'dbo.Problem.Titulo',
      ayuda: { texto: 'Nombre descriptivo del problema que permita identificar la afectación y su causa principal.' } },
    // La clave sigue siendo 'analisis' (borradores y pruebas la usan); el
    // dato es la Descripcion del Problem.
    { clave: 'analisis', etiqueta: 'Descripción', control: 'multilinea', seccion: 'info',
      destino: 'dbo.Problem.Descripcion',
      ayuda: { texto: 'Detalle del síntoma o comportamiento observado que origina el problema.' } },
    { clave: 'observaciones', etiqueta: 'Observaciones', control: 'multilinea', seccion: 'info',
      destino: 'dbo.Problem.Observaciones',
      ayuda: { texto: 'Información adicional sobre cuándo, dónde y en qué condiciones se presenta la afectación.' } },
    // La volumetria de la Categoria elegida: YA NO se captura. Es la misma
    // de Crear / Modificar / Solicitar cambios: VolumetriaCliente
    // (admin/iniciativa-admin.js) -> admin_iniciativas_volumetria.ashx ->
    // App_Code/ExperienciaVolumetria.cs (Total general del SLOT 0 de
    // vw_TBSlotCAT: los ultimos 30 dias). Viaja como `volumetria` al
    // validador, que sigue exigiendo un entero >= 0 y no la guarda. Destino
    // sin confirmar. NO es Tickets Reduce (dbo.ExpTicketsReduce).
    { clave: 'volumetria', etiqueta: 'Volumetría de la categoría', control: 'calculado', seccion: 'impacto',
      destino: null, obligatorio: true, requiereCategoria: true,
      ayuda: { texto: 'Cantidad de incidentes asociados al problema que justifican su análisis y seguimiento.',
               nota: 'Se calcula: tickets de la categoría elegida en los últimos 30 días. No se captura.' } },
    // Por categoria: dbo.ProblemCategoria.PctDisminucion es DECIMAL(9,4) y
    // guarda FRACCION (1.0000 = 100%). Se captura en % con hasta dos
    // decimales, que es esa misma precision. 0-100 es un tope de la
    // pantalla, no de la base (no tiene CHECK); los multiplos de 5 no se
    // exigen porque no estan verificados.
    { clave: 'pct', etiqueta: '% Disminución de tickets vs categoría', control: 'porcentaje', seccion: 'impacto',
      destino: 'dbo.ProblemCategoria.PctDisminucion (fracción)',
      reiniciaConCascada: true, requiereCategoria: true },
    // La meta se escribe en % O en tickets: el que se escribio manda
    // (SolicitudNueva.metaPor) y el otro se calcula con la volumetria de la
    // categoria. % -> tickets: floor(volumetria x % / 100), ticket entero
    // (ticketsDe). Tickets -> %: pctDeTickets, a dos decimales. Solo viaja
    // el % (el validador no tiene campo de tickets) y el Tickets Reduce del
    // registro sigue saliendo de dbo.ExpTicketsReduce con su ventana movil.
    { clave: 'tickets', etiqueta: 'Tickets a reducir', control: 'meta-tickets', seccion: 'impacto',
      destino: null, opcional: true, reiniciaConCascada: true, requiereCategoria: true }
  ];

  // Ayuda de los rotulos fijos del HTML (no son campos de captura).
  // Definiciones que dio negocio; el valor sigue saliendo de la cascada.
  var AYUDA_FIJA = {
    so: { texto: 'Responsable del servicio afectado y encargado de validar el seguimiento del problema.' },
    categoria: { texto: 'Categoría o clasificación a la que pertenecen los incidentes considerados dentro de la volumetría del problema.' },
    rca: { texto: 'Documento con la descripción de la causa raíz identificada que originó el problema, incluyendo el análisis realizado, los factores contribuyentes y las acciones correctivas y preventivas definidas para evitar su recurrencia.' }
  };

  // Validacion de los controles numericos. '' es valido (nada capturado).
  // Devuelve el mensaje de error o ''.
  var VALIDAR = {
    entero: function (v) {
      return v === '' || /^\d+$/.test(v) ? '' : 'Escribe un número entero, de 0 en adelante.';
    },
    porcentaje: function (v) {
      if (v === '') return '';
      return /^\d{1,3}(\.\d{1,2})?$/.test(v) && Number(v) <= 100 ? ''
        : 'Escribe un porcentaje entre 0 y 100, con hasta dos decimales.';
    }
  };

  // El % capturado como lo guarda ProblemCategoria.PctDisminucion
  // (fraccion, 4 decimales), o null si no es valido.
  function fraccionDe(pct) {
    if (pct === '' || VALIDAR.porcentaje(pct)) return null;
    return Math.round(Number(pct) * 100) / 10000;
  }

  // Tickets a reducir: floor(volumetria x pct / 100) a ticket entero,
  // SIEMPRE hacia abajo (2026-10-26; el FLOOR de la propuesta sql/33 para
  // adm.usp_GestionAdmin_TicketsReduce). En centesimas de % y con enteros,
  // para no redondear flotantes: 1247 x 12.5% = 155.875 -> 155; 7 x 9.46%
  // = 0.66 -> 0. null si falta o no vale alguno.
  function ticketsDe(volumetria, pct) {
    if (typeof volumetria !== 'number' || !isFinite(volumetria) || volumetria < 0 || volumetria % 1) return null;
    pct = String(pct === null || pct === undefined ? '' : pct).trim();
    if (pct === '' || VALIDAR.porcentaje(pct)) return null;
    return Math.floor(volumetria * Math.round(Number(pct) * 100) / 10000);
  }

  // Tickets a reducir -> el menor % con dos decimales que da al menos esos
  // tickets con ticketsDe (la misma
  // regla que MetaCategoria.pct de Crear, admin/iniciativa-admin.js). Con
  // volumetrias grandes 0.01% es mas de un ticket: exacto dice si ese % da
  // los mismos tickets. -> { pct, exacto, tickets } o { error } ('' = vacio).
  function pctDeTickets(volumetria, tickets) {
    var t = String(tickets === null || tickets === undefined ? '' : tickets).trim();
    if (t === '') return { error: '' };
    if (VALIDAR.entero(t)) return { error: VALIDAR.entero(t) };
    if (typeof volumetria !== 'number' || !isFinite(volumetria) || volumetria < 0 || volumetria % 1) {
      return { error: 'Sin volumetría no se puede pasar de tickets a %.' };
    }
    if (volumetria === 0) return { error: 'Con volumetría 0 no hay tickets que reducir: usa el %.' };
    var n = Number(t);
    if (n > volumetria) {
      return { error: n.toLocaleString('es-MX') + ' tickets es más que la volumetría (' +
        volumetria.toLocaleString('es-MX') + '): pasaría de 100%.' };
    }
    var pct = String(Math.ceil(n * 10000 / volumetria) / 100);
    var da = ticketsDe(volumetria, pct);
    return { pct: pct, exacto: da === n, tickets: da };
  }

  // Token del borrador: un GUID v4 que el servidor usa SOLO para no guardar
  // dos veces el mismo envio (doble clic, respuesta perdida). No dice quien
  // es nadie. crypto.getRandomValues existe tambien fuera de https (el sitio
  // es http de intranet, donde crypto.randomUUID no esta); sin crypto, al
  // azar comun: basta con que no se repita entre borradores.
  function nuevoToken(cripto) {
    var b = [];
    var c = cripto === undefined ? (typeof window !== 'undefined' && window.crypto) : cripto;
    if (c && typeof c.getRandomValues === 'function') {
      var a = new Uint8Array(16);
      c.getRandomValues(a);
      for (var i = 0; i < 16; i++) b.push(a[i]);
    } else {
      for (var j = 0; j < 16; j++) b.push(Math.floor(Math.random() * 256));
    }
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    var h = b.map(function (x) { return (x < 16 ? '0' : '') + x.toString(16); }).join('');
    return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
  }

  // Campos propios de cada Tipo de iniciativa, por nombre exacto del tipo:
  //
  //   'Nombre del tipo': { campos: [ <campo>, ... ] }
  //
  // VACIO A PROPOSITO: ni el modelo en la base ni el codigo del sitio dicen
  // hoy que campo cambia segun el tipo, y el libro de Excel no esta en el
  // repo. Un tipo sin entrada solo lleva los comunes. Al definirlos, basta
  // con agregarlos aqui: la pagina los pinta y los limpia al cambiar el tipo.
  var DEFINICIONES_TIPO = {};

  // La cascada es la compartida de admin/cascada-organizacional.js.
  var CascadaOrganizacional = window.CascadaOrganizacional;

  // ---------------------------------------------------------------------
  // CatalogoIniciativas
  // ---------------------------------------------------------------------
  class CatalogoIniciativas {
    // tipos: los PREFIJOS, en el orden del servidor; nombres: prefijo ->
    // Descripcion (lo que se ve). tipoProblem: el prefijo que es Problem
    // (exige RCA), tal como lo marca el servidor (tipo_problem), o ''. Aqui
    // no se escribe.
    // rutasAdm: SOLO con rol ADM (rutas_adm del handler): TODAS las rutas
    // activas, cada una { categoria, director, po, so } con '' en el dueño
    // que falte. null si el servidor no las mando (MOD): Crear / Modificar
    // de ADM las usan para elegir categoria; la cascada, nunca.
    constructor(tipos, asignaciones, omitidas, tipoProblem, nombres, rutasAdm) {
      this.tipos = tipos;
      this.asignaciones = asignaciones;
      this.omitidas = omitidas;
      this.tipoProblem = tipoProblem || '';
      this.nombres = nombres || {};
      this.rutasAdm = Array.isArray(rutasAdm) ? rutasAdm : null;
    }

    // El JSON del handler (?rutas=1) -> catalogo. La cascada va sobre
    // `rutas` (categoria = ruta completa), NO sobre `asignaciones` (N2).
    // Sin rutas o sin tipos lanza; filas que no sean texto no vacio y tipos
    // sin `prefijo` de texto se descartan, sin corregirlos.
    static desdeJson(json) {
      if (!json || !Array.isArray(json.rutas) || !Array.isArray(json.tipos)) {
        throw new Error('La respuesta del servidor no trae el catálogo esperado.');
      }
      var claves = ['director', 'po', 'so', 'categoria'];
      var filas = json.rutas.filter(function (f) {
        return f && claves.every(function (c) { return typeof f[c] === 'string' && f[c] !== ''; });
      });
      var vistos = {}, nombres = {};
      var tipos = [];
      json.tipos.forEach(function (t) {
        var p = t && typeof t.prefijo === 'string' ? t.prefijo : '';
        if (p === '' || Object.prototype.hasOwnProperty.call(vistos, p)) return;
        vistos[p] = true;
        nombres[p] = typeof t.nombre === 'string' && t.nombre !== '' ? t.nombre : p;
        tipos.push(p);
      });
      // El orden de los tipos es el del servidor (Problem primero si esta).
      var problem = typeof json.tipo_problem === 'string' && vistos[json.tipo_problem] ? json.tipo_problem : '';
      var omitidas = (Number(json.rutas_sin_duenos) || 0) + (Number(json.rutas_duenos_no_vigentes) || 0);
      return new CatalogoIniciativas(tipos, filas, omitidas, problem, nombres, CatalogoIniciativas.rutasAdmDe(json));
    }

    // rutas_adm -> [{ categoria, director, po, so }] o null si no vino. Solo
    // se exige la categoria (texto no vacio): un dueño que falta queda ''.
    // Sin repetir (misma llave que el servidor: sin mayusculas ni espacios).
    static rutasAdmDe(json) {
      if (!json || !Array.isArray(json.rutas_adm)) return null;
      var vistas = {}, salida = [];
      json.rutas_adm.forEach(function (f) {
        var cat = f && typeof f.categoria === 'string' ? f.categoria.trim() : '';
        var k = cat.toLowerCase();
        if (!cat || vistas[k]) return;
        vistas[k] = true;
        salida.push({
          categoria: cat,
          director: typeof f.director === 'string' ? f.director : '',
          po: typeof f.po === 'string' ? f.po : '',
          so: typeof f.so === 'string' ? f.so : ''
        });
      });
      return salida;
    }

    tieneTipo(valor) { return this.tipos.indexOf(valor) >= 0; }
    nombreTipo(valor) { return Object.prototype.hasOwnProperty.call(this.nombres, valor) ? this.nombres[valor] : valor; }
  }

  // ---------------------------------------------------------------------
  // SolicitudNueva
  // ---------------------------------------------------------------------
  class SolicitudNueva {
    constructor(catalogo, definiciones, comunes) {
      this.catalogo = catalogo;
      this.definiciones = definiciones || DEFINICIONES_TIPO;
      this.comunes = comunes || CAMPOS_COMUNES;
      this.tipo = '';
      this.cascada = new CascadaOrganizacional(catalogo.asignaciones, 'creacion');
      this.valores = {};       // campos comunes
      this.valoresTipo = {};   // campos del tipo
      // Capacidad de la Categoria elegida, tal como la dio el servidor:
      //   { categoria, estado: 'cargando' | 'lista' | 'error',
      //     disponible (fraccion), determinable }
      // Solo orienta al usuario: al validar, el servidor la recalcula.
      this.capacidad = null;
      // Volumetria de la Categoria elegida, como la da VolumetriaCliente:
      //   { categoria, estado: 'cargando' | 'ok' | 'cero' | 'sin_datos' |
      //     'ruta_invalida' | 'error', valor, mensaje }
      // Atada a su categoria: la de otra (vieja o que llega tarde) no se usa.
      this.volumen = null;
      // Lo que se escribio de la meta: 'pct' o 'tickets'. El otro se
      // calcula; con 'tickets', valores.pct sale de pctDeTickets.
      this.metaPor = 'pct';
      this.rca = null;         // el File elegido (no se sube a ningun lado)
      // Un borrador = un token: reenviarlo no crea otra solicitud.
      this.token = nuevoToken();
    }

    camposTipo() {
      var d = this.tipo && Object.prototype.hasOwnProperty.call(this.definiciones, this.tipo)
        ? this.definiciones[this.tipo] : null;
      return (d && Array.isArray(d.campos)) ? d.campos : [];
    }

    // Cambiar de tipo limpia la cascada completa y los campos del tipo. Un
    // tipo fuera del catalogo no se acepta (queda sin tipo).
    elegirTipo(valor) {
      this.tipo = (valor && this.catalogo.tieneTipo(valor)) ? valor : '';
      this.cascada.limpiar(0);
      this.valoresTipo = {};
      this.limpiarDeCascada(this.comunes, this.valores);
      this.capacidad = null;
      this.volumen = null;
      return this.tipo !== '';
    }

    // Un cambio en la cascada limpia los niveles de abajo (y con ellos el
    // Director) y los campos que dependan de la categoria.
    elegir(nivel, valor) {
      var aceptado = this.tipo ? this.cascada.elegir(nivel, valor) : false;
      this.limpiarDeCascada(this.camposTipo(), this.valoresTipo);
      this.limpiarDeCascada(this.comunes, this.valores);
      if (!this.capacidad || this.capacidad.categoria !== this.categoria()) this.capacidad = null;
      if (!this.volumen || this.volumen.categoria !== this.categoria()) this.volumen = null;
      return aceptado;
    }

    // ---- RCA ----
    // Obligatorio solo si el tipo elegido es el Problem del catalogo.
    rcaObligatorio() { return RCA.enSitio && this.tipo !== '' && this.tipo === this.catalogo.tipoProblem; }
    elegirRca(archivo) { this.rca = archivo && archivo.size > 0 ? archivo : null; }

    // ---- capacidad de la categoria ----
    // La respuesta de una categoria que ya no es la elegida se descarta.
    pedirCapacidad() {
      var cat = this.categoria();
      this.capacidad = cat ? { categoria: cat, estado: 'cargando' } : null;
      return cat;
    }

    fijarCapacidad(cat, json) {
      if (!cat || cat !== this.categoria()) return false;
      var ok = json && typeof json.disponible === 'number' && typeof json.determinable === 'boolean';
      this.capacidad = ok
        ? { categoria: cat, estado: 'lista', disponible: json.disponible, determinable: json.determinable }
        : { categoria: cat, estado: 'error' };
      return true;
    }

    fallaCapacidad(cat) { return this.fijarCapacidad(cat, null); }

    // Lo maximo que se puede pedir, en % con dos decimales, o null si no se
    // sabe todavia.
    maxPct() {
      var c = this.capacidad;
      return c && c.estado === 'lista' && c.determinable ? Math.round(c.disponible * 10000) / 100 : null;
    }

    // ---- volumetria de la categoria ----
    // Misma regla que la capacidad: la respuesta de una categoria que ya no
    // es la elegida se descarta.
    pedirVolumen() {
      var cat = this.categoria();
      this.volumen = cat ? { categoria: cat, estado: 'cargando', valor: null, mensaje: '' } : null;
      return cat;
    }

    // e: lo que resolvio VolumetriaCliente.consultar ({ estado, valor, mensaje }).
    fijarVolumen(cat, e) {
      if (!cat || cat !== this.categoria()) return false;
      this.volumen = {
        categoria: cat,
        estado: e && typeof e.estado === 'string' ? e.estado : 'error',
        valor: e && typeof e.valor === 'number' ? e.valor : null,
        mensaje: (e && e.mensaje) || ''
      };
      this.recalcularMeta();
      return true;
    }

    // La de la Categoria elegida, o null (sin categoria, o de otra).
    volumenActual() {
      var v = this.volumen, cat = this.categoria();
      return cat && v && v.categoria === cat ? v : null;
    }

    // Tickets (entero >= 0) o null mientras no haya un dato real: cargando,
    // sin datos, ruta invalida o error NO son 0. 'cero' si (lo dijo el
    // servidor).
    volumetria() {
      var v = this.volumenActual();
      if (!v) return null;
      if (v.estado === 'cero') return 0;
      return v.estado === 'ok' && typeof v.valor === 'number' && isFinite(v.valor) && v.valor >= 0 ? Math.round(v.valor) : null;
    }

    // floor(volumetria x % / 100), o null si falta la volumetria o el % no
    // es valido (formato o capacidad: error('pct')).
    ticketsReducir() {
      var pct = String(this.valores.pct === undefined ? '' : this.valores.pct).trim();
      if (pct === '' || this.error('pct')) return null;
      return ticketsDe(this.volumetria(), pct);
    }

    // Valor de un campo 'calculado', o null.
    calculado(clave) {
      if (clave === 'volumetria') return this.volumetria();
      if (clave === 'tickets') return this.ticketsReducir();
      return null;
    }

    motivoVolumen() {
      if (!this.categoria()) return 'Elige primero la Categoría en Clasificación.';
      var v = this.volumenActual();
      if (!v || v.estado === 'cargando') return 'Consultando la volumetría de la categoría…';
      if (v.estado === 'ok' || v.estado === 'cero') return 'Tickets de la categoría en los últimos 30 días. No se captura.';
      if (v.estado === 'sin_datos') return 'Sin datos de tickets cargados para los últimos 30 días: no se puede calcular.';
      if (v.estado === 'ruta_invalida') return 'La categoría no es válida para calcular la volumetría.';
      return 'No se pudo consultar la volumetría' + (v.mensaje ? ': ' + v.mensaje : '.');
    }

    motivoTickets() {
      if (!this.categoria()) return 'Elige primero la Categoría en Clasificación.';
      if (this.volumetria() === null) return 'Se calcula cuando esté la volumetría de la categoría.';
      if (this.metaPor === 'tickets') {
        var r = pctDeTickets(this.volumetria(), this.valores.tickets);
        if (r.error === '') return 'Escribe los tickets o el % de disminución: el otro se calcula.';
        if (r.error !== undefined) return r.error;
        return '≈ ' + r.pct + '% de ' + this.volumetria().toLocaleString('es-MX') +
          (r.exacto ? '' : ' · con 2 decimales son ' + r.tickets.toLocaleString('es-MX') + ' tickets') + '.';
      }
      var pct = String(this.valores.pct === undefined ? '' : this.valores.pct).trim();
      if (pct === '') return 'Escribe el % de disminución o los tickets: el otro se calcula.';
      if (this.error('pct')) return 'Corrige el % de disminución para calcularlo.';
      return 'Volumetría × % ÷ 100, redondeado hacia abajo a ticket entero.';
    }

    // Lo que muestra la casilla de tickets: lo escrito, o los que da el %.
    ticketsVista() {
      if (this.metaPor === 'tickets') return String(this.valores.tickets === undefined ? '' : this.valores.tickets);
      var t = this.ticketsReducir();
      return t === null ? '' : String(t);
    }

    // Con la meta en tickets, el % (lo que viaja) sale de los tickets y de
    // la volumetria; vacio si no se puede (error('tickets') dice por que).
    recalcularMeta() {
      if (this.metaPor !== 'tickets') return;
      var r = pctDeTickets(this.volumetria(), this.valores.tickets);
      this.valores.pct = r.error === undefined ? r.pct : '';
    }

    limpiarDeCascada(campos, valores) {
      campos.forEach(function (c) { if (c.reiniciaConCascada) delete valores[c.clave]; });
      if (valores === this.valores) this.metaPor = 'pct';
    }

    // La Categoria elegida en la cascada: la UNICA fuente de la categoria.
    categoria() { return this.cascada.seleccion[2] || ''; }

    campo(clave) {
      var todos = this.comunes.concat(this.camposTipo());
      for (var i = 0; i < todos.length; i++) if (todos[i].clave === clave) return todos[i];
      return null;
    }

    capturar(clave, texto) {
      var c = this.campo(clave);
      if (!c || c.control === 'calculado' || (c.requiereCategoria && !this.categoria())) return;
      if (this.comunes.indexOf(c) >= 0) this.valores[clave] = texto;
      else this.valoresTipo[clave] = texto;
      // El que se escribe manda; el otro se calcula.
      if (clave === 'pct') { this.metaPor = 'pct'; delete this.valores.tickets; }
      if (clave === 'tickets') { this.metaPor = 'tickets'; this.recalcularMeta(); }
    }

    // Mensaje de error del valor capturado, o ''.
    error(clave) {
      var c = this.campo(clave);
      var v = c ? (this.comunes.indexOf(c) >= 0 ? this.valores : this.valoresTipo)[clave] : '';
      var texto = String(v === undefined ? '' : v).trim();
      if (clave === 'tickets') {
        if (this.metaPor !== 'tickets') return '';
        var r = pctDeTickets(this.volumetria(), texto);
        return r.error || (this.error('pct') ? this.error('pct') : '');
      }
      var error = c && VALIDAR[c.control] ? VALIDAR[c.control](texto) : '';
      if (error || clave !== 'pct' || texto === '') return error;
      // El % contra la capacidad que dio el servidor (en diezmilesimas,
      // para no comparar flotantes).
      var cap = this.capacidad;
      if (cap && cap.estado === 'lista' && !cap.determinable) return 'No se puede calcular la capacidad de esta categoría.';
      var max = this.maxPct();
      if (max !== null && Math.round(this.pctFraccion() * 10000) > Math.round(cap.disponible * 10000)) {
        return 'Esta categoría solo tiene ' + max + '% disponible.';
      }
      return '';
    }

    pctFraccion() { return fraccionDe(String(this.valores.pct || '').trim()); }

    // Claves obligatorias sin valor (en el orden del formulario). RCA solo
    // si es obligatorio para el tipo.
    faltantes() {
      var self = this, faltan = [];
      if (!this.tipo) faltan.push('tipo');
      ['po', 'so', 'categoria'].forEach(function (k, i) { if (!self.cascada.seleccion[i]) faltan.push(k); });
      this.comunes.forEach(function (c) {
        if (c.control === 'calculado') {
          if (c.obligatorio && self.calculado(c.clave) === null) faltan.push(c.clave);
          return;
        }
        if (c.opcional) return;
        if (String(self.valores[c.clave] === undefined ? '' : self.valores[c.clave]).trim() === '') faltan.push(c.clave);
      });
      if (this.rcaObligatorio() && !this.rca) faltan.push('rca');
      return faltan;
    }

    // Lo que hay que corregir antes de mandar: faltantes y formatos.
    erroresCliente() {
      var self = this;
      var errores = this.faltantes().map(function (k) {
        // Con Categoria, la volumetria no "falta": no esta disponible, y se
        // dice por que (consultando, sin datos, error).
        if (k === 'volumetria' && self.categoria()) return { campo: k, mensaje: self.motivoVolumen() };
        // Con la meta en tickets el % no "falta": sale de los tickets.
        if (k === 'pct' && self.metaPor === 'tickets') {
          return { campo: 'tickets', mensaje: self.error('tickets') || 'Falta ' + ROTULOS.tickets + ' o ' + ROTULOS.pct + '.' };
        }
        return { campo: k, mensaje: k === 'rca' ? 'El RCA es obligatorio para Problem.' : 'Falta ' + ROTULOS[k] + '.' };
      });
      ['volumetria', 'pct', 'tickets'].forEach(function (k) {
        var e = self.error(k);
        if (k === 'pct' && self.metaPor === 'tickets') return;   // lo dice 'tickets'
        if (e && errores.every(function (x) { return x.campo !== k; })) errores.push({ campo: k, mensaje: e });
      });
      return errores;
    }

    // Los campos con los nombres que espera admin_iniciativas_validar.ashx.
    // disponible_cliente va solo como dato: el servidor no lo usa. token:
    // el del borrador (anti-duplicado). Nunca viajan nombre, cuenta ni
    // correo de nadie: el servidor los resuelve.
    // volumetria: la de la categoria (volumetria()), '' si no hay. Los
    // tickets a reducir no viajan: el validador no tiene ese campo.
    camposEnvio() {
      var v = this.valores, sel = this.cascada.seleccion;
      var max = this.maxPct(), vol = this.volumetria();
      return {
        tipo: this.tipo, po: sel[0] || '', so: sel[1] || '', categoria: sel[2] || '',
        titulo: v.titulo || '', descripcion: v.analisis || '', observaciones: v.observaciones || '',
        volumetria: vol === null ? '' : String(vol), pct: String(v.pct || '').trim(),
        disponible_cliente: max === null ? '' : String(max), token: this.token
      };
    }

    estado() {
      var hayTipos = this.catalogo.tipos.length > 0;
      var director = this.cascada.director();
      return {
        tipo: hayTipos
          ? { habilitado: true, opciones: this.catalogo.tipos, valor: this.tipo, motivo: '', etiquetas: this.catalogo.nombres }
          : { habilitado: false, opciones: [], valor: '', motivo: 'Sin tipos de iniciativa en el catálogo.' },
        niveles: this.cascada.estado(this.tipo !== '',
          hayTipos ? 'Elige primero un Tipo de iniciativa.' : 'Sin tipos de iniciativa en el catálogo.'),
        director: {
          valor: director,
          motivo: director ? 'Derivado de la categoría.'
            : this.cascada.completa() ? 'La categoría no tiene un Director único.'
            : 'Se completa al elegir la Categoría.'
        },
        pct: this.categoria()
          ? { habilitado: true, motivo: this.motivoCapacidad(), max: this.maxPct() }
          : { habilitado: false, motivo: 'Elige primero la Categoría en Clasificación.', max: null },
        // e: la forma de VolumetriaCliente (null sin categoria: '—').
        volumetria: {
          e: this.volumenActual(), motivo: this.motivoVolumen(),
          reintentar: !!(this.volumenActual() && this.volumenActual().estado === 'error')
        },
        tickets: {
          valor: this.ticketsReducir(), vista: this.ticketsVista(), motivo: this.motivoTickets(),
          habilitado: this.volumetria() !== null && this.volumetria() > 0, metaPor: this.metaPor
        },
        rca: {
          habilitado: this.tipo !== '',
          obligatorio: this.rcaObligatorio(),
          motivo: !this.tipo ? 'Elige primero un Tipo de iniciativa.'
            : (this.rcaObligatorio() ? 'Obligatorio para Problem.' : 'Opcional para este tipo.') +
              ' El archivo todavía no se guarda.'
        },
        camposVisibles: this.tipo !== ''
      };
    }

    motivoCapacidad() {
      var c = this.capacidad;
      if (!c) return 'Para la categoría elegida en Clasificación.';
      if (c.estado === 'cargando') return 'Calculando la capacidad de reducción de la categoría…';
      if (c.estado === 'error') return 'No se pudo calcular la capacidad; el servidor la revisará al validar.';
      if (!c.determinable) {
        return 'Capacidad no determinable: hay iniciativas en categorías que contienen a esta o que cuelgan de ella.';
      }
      var max = this.maxPct();
      return 'Capacidad de reducción · Disponible: ' + max + '%. Puedes solicitar entre 0% y ' + max + '%.';
    }
  }

  // ---------------------------------------------------------------------
  // PaginaIniciativas
  // ---------------------------------------------------------------------
  // Vistas: cada una con su panel y la pestaña que se marca al mostrarla.
  // Nueva solicitud no tiene pestaña propia: cuelga de Iniciativas.
  var VISTAS = {
    iniciativas: { panel: 'panel-iniciativas', pestana: 'tab-iniciativas' },
    solicitudes: { panel: 'panel-solicitudes', pestana: 'tab-solicitudes' },
    nueva:       { panel: 'panel-nueva',       pestana: 'tab-iniciativas' },
    // Administracion (solo ADM): alta directa de iniciativas. Las
    // categorias se crean en el sitio de Proactivanet, no aqui.
    administracion: { panel: 'panel-administracion', pestana: 'tab-administracion' },
    // Alta directa de ADM (admin/iniciativa-admin.js): accion de
    // Administracion, separada de Nueva solicitud. Solo con rol ADM.
    crear:       { panel: 'panel-crear-admin', pestana: 'tab-administracion' }
  };
  var VISTAS_SOLO_ADM = { administracion: true, crear: true };
  // Dueños de categoria (PO / SO): flujo aparte, oculto por ahora. Con false
  // la seccion #cdSeccion queda oculta y su catalogo (?duenos=1) no se pide.
  // admin/categorias-duenos.js y el handler siguen intactos.
  var DUENOS_VISIBLES = false;
  // Nueva solicitud: ADM o MOD. Sin rol resuelto, no abre (falla cerrado).
  var VISTAS_ADM_MOD = { nueva: true };
  // Solicitudes: soloSolicitante = la misma regla que "Solicitar una
  // iniciativa" (puedeSolicitar, de admin_sesion: AccesoIniciativas).
  var PESTANAS = [
    { id: 'tab-iniciativas', vista: 'iniciativas' },
    { id: 'tab-solicitudes', vista: 'solicitudes', soloSolicitante: true },
    { id: 'tab-administracion', vista: 'administracion', soloAdm: true }
  ];

  var SELECTS = [
    { sel: 'selPo',        mot: 'motPo' },
    { sel: 'selSo',        mot: 'motSo' },
    { sel: 'selCategoria', mot: 'motCategoria' }
  ];

  // ---------------------------------------------------------------------
  // MenuLateral
  // ---------------------------------------------------------------------
  // Mismo comportamiento que plegarLateral() de dashboard.js: la clase
  // .lateral-cerrada va en <html> (el hueco del <body> depende de ella) y
  // el boton dice el estado real. Aqui no hay graficas que remedir ni
  // modulos que montar: las entradas son enlaces al tablero.
  class MenuLateral {
    constructor(doc) {
      this.raiz = doc.documentElement;
      this.boton = doc.getElementById('lateral-plegar');
    }

    plegar(cerrar) {
      if (!this.raiz || !this.raiz.classList) return;
      this.raiz.classList.toggle('lateral-cerrada', cerrar);
      if (!this.boton) return;
      var texto = cerrar ? 'Desplegar el menu' : 'Contraer el menu';
      this.boton.setAttribute('aria-expanded', String(!cerrar));
      this.boton.setAttribute('aria-label', texto);
      this.boton.title = texto;
    }

    conectar() {
      var self = this;
      if (this.boton) {
        this.boton.addEventListener('click', function () {
          self.plegar(!self.raiz.classList.contains('lateral-cerrada'));
        });
      }
      return this;
    }
  }

  function enfocar(el) { if (el && typeof el.focus === 'function') el.focus(); }

  class PaginaIniciativas {
    constructor(doc) {
      this.doc = doc;
      this.solicitud = null;
      this.cargaId = 0;      // descarta la respuesta de una carga ya superada
      this.globo = null;
      this.vista = 'iniciativas';
      this.menu = null;
      this.registro = null;  // VistaRegistro (admin/registro-iniciativas.js)
      this.crearAdmin = null; // VistaCrearAdmin (admin/iniciativa-admin.js)
      this.duenos = null;     // VistaDuenos (admin/categorias-duenos.js), perezosa; null si DUENOS_VISIBLES = false
      this.cola = null;       // ColaSolicitudes (admin/solicitudes-cambio.js): cola de ADM
      this.nuevas = null;     // RegistroSolicitudesNuevas (admin/solicitudes-nuevas.js): solo lectura, ADM
      this.mias = null;       // MisSolicitudes (admin/solicitudes-nuevas.js): las propias, quien no es ADM
      this.recientes = null;  // VistaCambiosRecientes (admin/cambios-recientes.js): solo ADM
      this.avisos = null;     // VistaAvisosAcuse (admin/acuse-iniciativa.js): avisos de PO/SO, solo ADM
      this.volumetria = null; // VolumetriaCliente de Nueva solicitud (perezoso; usa this.pedir)
      // 'ADM' | 'MOD' | null, de SesionAdmin (fijarRol). null hasta saberlo:
      // sin rol no se abre nada de ADM.
      this.rol = null;
      // true | false de admin_sesion (fijarRol); null hasta saberlo.
      this.puedeSolicitar = null;
    }

    // Solo UX, como SesionAdmin: decide que acciones de ADM se pintan. El
    // alta y la edicion de ADM solo validan en el servidor (501, no
    // guardan); el handler exige ADM por su cuenta (AccesoAdmin.ExigirAdm).
    // solicitante: admin_sesion (AccesoIniciativas: ADM siempre, MOD solo si
    // es PO/SO vigente); sin el, como antes (con rol, puede).
    fijarRol(rol, solicitante) {
      if (this.denegada || this.soloSolicitud) return;
      this.salirDeSinVerificar();
      this.rol = rol === 'ADM' || rol === 'MOD' ? rol : null;
      this.puedeSolicitar = solicitante === undefined ? !!this.rol : solicitante === true;
      this.aplicarPestanas();
      if (this.registro && this.registro.fijarRol) this.registro.fijarRol(this.rol);
      if (this.cola) this.cola.fijarRol(this.rol);
      if (this.nuevas) this.nuevas.fijarRol(this.rol);
      if (!this.puedeSolicitar && this.mias) this.mias.ocultar();
      if ((VISTAS_SOLO_ADM[this.vista] && this.rol !== 'ADM') || (VISTAS_ADM_MOD[this.vista] && (!this.rol || !this.puedeSolicitar)) ||
          (this.vista === 'solicitudes' && !this.puedeSolicitar)) {
        this.mostrarVista('iniciativas');
      } else if (this.vista === 'solicitudes') {
        // El rol llega despues de pintar: si ya se esta en Solicitudes, se
        // vuelve a pintar con el rol de verdad.
        this.abrirSolicitudes();
      }
    }

    // El contenido de Solicitudes segun el rol: ADM, la cola y el registro
    // completo; los demas (solo llegan aqui si pueden solicitar), "Mis
    // solicitudes" y, MOD, la nota de la cola. El solicitante sin rol no
    // ve la nota: no tiene la pestaña Iniciativas que menciona.
    abrirSolicitudes() {
      var adm = this.rol === 'ADM';
      if (this.cola) this.cola.abrir();
      if (this.nuevas) this.nuevas.abrir();
      if (this.soloSolicitud && this.$('solNoAdm')) this.$('solNoAdm').hidden = true;
      if (this.mias) {
        if (adm) this.mias.ocultar();
        else this.mias.abrir();
      }
    }

    // VIEWER (o sin respuesta de admin_sesion): la pagina no muestra nada
    // de Admin. Solo UX y defensa extra: la pagina la niega
    // AdminAccesoModulo si esta registrado en Web.config, y cada handler
    // admin_iniciativas_* responde 403 a un VIEWER de todos modos.
    // Irreversible en esta carga de pagina. `mensaje` cambia solo el texto
    // (p. ej. perdio el acceso con la pagina abierta: revisarSesion).
    denegar(mensaje) {
      var self = this;
      this.salirDeSinVerificar();
      this.denegada = true;
      this.rol = null;
      this.puedeSolicitar = false;
      if (this.mias) this.mias.ocultar();
      if (mensaje && this.$('iniDenegadoTexto')) this.$('iniDenegadoTexto').textContent = mensaje;
      if (this.registro && this.registro.fijarRol) this.registro.fijarRol(null);
      if (this.registro && this.registro.cerrarDetalle) this.registro.cerrarDetalle(true);
      Object.keys(VISTAS).forEach(function (k) { self.$(VISTAS[k].panel).hidden = true; });
      this.$('iniTabs').hidden = true;
      this.$('iniDenegado').hidden = false;
    }

    // Cuenta SIN rol ADM/MOD con el interruptor INICIATIVAS_ABIERTAS
    // (admin_sesion: solicitante y no autorizado): Nueva solicitud y
    // Solicitudes (las suyas), nada mas. La pestaña Iniciativas se vuelve
    // "Solicitar una iniciativa" (abre Nueva solicitud: el registro no es
    // suyo); sin "Volver" (no hay a donde). Solo UX: el servidor ya le niega
    // todo handler que no sea de Nueva solicitud o Mis solicitudes
    // (AccesoIniciativas). Irreversible en esta carga de pagina.
    modoSolicitante() {
      if (this.denegada) return;
      var self = this;
      this.salirDeSinVerificar();
      this.soloSolicitud = true;
      this.rol = null;
      this.puedeSolicitar = true;
      if (this.registro && this.registro.fijarRol) this.registro.fijarRol(null);
      if (this.registro && this.registro.cerrarDetalle) this.registro.cerrarDetalle(true);
      if (this.cola && this.cola.fijarRol) this.cola.fijarRol(null);
      if (this.nuevas && this.nuevas.fijarRol) this.nuevas.fijarRol(null);
      this.$('tab-iniciativas').textContent = 'Solicitar una iniciativa';
      this.$('tab-iniciativas').setAttribute('aria-controls', 'panel-nueva');
      this.aplicarPestanas();
      this.$('iniTabs').hidden = false;
      this.$('btnVolver').hidden = true;
      Object.keys(VISTAS).forEach(function (k) { self.$(VISTAS[k].panel).hidden = true; });
      this.mostrarVista('nueva');
    }

    // admin_sesion no pudo confirmar (SesionAdmin: incierto, sin
    // autorizado): ni "sin acceso" ni "solo solicitante". Se oculta todo y
    // se ofrece Reintentar (#iniVerificar). Reversible: la siguiente
    // respuesta confirmada sale por fijarRol / modoSolicitante / denegar.
    // No toca el borrador (SolicitudNueva sigue en memoria).
    sinVerificar() {
      if (this.denegada) return;
      var self = this;
      this.verificacionPendiente = true;
      Object.keys(VISTAS).forEach(function (k) { self.$(VISTAS[k].panel).hidden = true; });
      this.$('iniTabs').hidden = true;
      this.$('iniVerificar').hidden = false;
    }

    salirDeSinVerificar() {
      if (!this.verificacionPendiente) return;
      this.verificacionPendiente = false;
      this.$('iniVerificar').hidden = true;
      this.$('iniTabs').hidden = false;
      if (VISTAS[this.vista]) this.$(VISTAS[this.vista].panel).hidden = false;
    }

    // La respuesta de admin_sesion al abrir la pagina (o al pulsar
    // Reintentar): SesionAdmin ya pinto los data-solo-*; aqui la pagina.
    aplicarSesion(s) {
      if (!s) return;
      if (s.incierto && !s.autorizado) { this.sinVerificar(); return; }
      this.sesion = s;
      if (s.autorizado) this.fijarRol(s.rol, s.solicitante);
      else if (s.solicitante) this.modoSolicitante();
      else this.denegar();
    }

    aviso(texto) {
      var el = this.$('iniAvisoSesion');
      if (!el) return;
      el.textContent = texto || '';
      el.hidden = !texto;
    }

    // Con la pagina ya abierta, un handler de Admin respondio 403 y
    // admin_sesion volvio a contestar (SesionAdmin.vigilar). Oculta lo que
    // ya no le toca, sin recargar: ADM que pasa a MOD (fijarRol); quien
    // pierde ADM/MOD pero sigue siendo PO/SO vigente pasa a "solo Nueva
    // solicitud" con su borrador (modoSolicitante); sin nada, denegar. Un
    // solicitante que lo pierde conserva el formulario en pantalla (el
    // servidor ya no lo deja enviar) con el aviso. true = la pagina ya habia
    // decidido y SesionAdmin debe repintar el menu con `s`.
    revisarSesion(s) {
      var antes = this.sesion;
      if (!antes || !s || this.denegada) return false;
      if (s.incierto && !s.autorizado) {
        if (this.soloSolicitud) {
          this.aviso('No se pudo verificar tu acceso a Iniciativas. Si el envío falla, vuelve a intentarlo más tarde.');
          return false;
        }
        this.sinVerificar();
        return true;
      }
      this.sesion = s;
      if (s.autorizado) {
        if (antes.rol !== s.rol || antes.solicitante !== s.solicitante) {
          this.fijarRol(s.rol, s.solicitante);
          this.aviso('Tu acceso cambió: ahora entras como ' + s.rol + '. Se ocultó lo que ya no te corresponde.');
        }
        return true;
      }
      if (s.solicitante) {
        if (!this.soloSolicitud) {
          this.modoSolicitante();
          this.aviso('Ya no tienes acceso a la administración de iniciativas. Puedes seguir con Nueva solicitud.');
        } else if (!this.puedeSolicitar) {
          this.puedeSolicitar = true;
          this.aplicarPestanas();
          this.aviso('');
        }
        return true;
      }
      if (this.soloSolicitud) {
        // Solicitudes sigue la misma regla: se oculta junto con el envio.
        this.puedeSolicitar = false;
        this.aplicarPestanas();
        if (this.mias) this.mias.ocultar();
        if (this.vista === 'solicitudes') this.mostrarVista('nueva');
        this.aviso('La solicitud de iniciativas ya no está disponible para tu cuenta. Tu borrador sigue en pantalla, pero no se puede enviar.');
        return true;
      }
      this.denegar('Tu acceso a la administración de iniciativas ya no está vigente.');
      return true;
    }

    $(id) { return this.doc.getElementById(id); }

    // Las pestañas de solo ADM se ven solo con rol ADM (ademas de
    // data-solo-adm de SesionAdmin: aqui manda el rol que fijo la pagina).
    // Solicitudes, solo si puede solicitar (null = aun no se sabe: oculta).
    pestanaVisible(p) {
      if (p.soloSolicitante && this.puedeSolicitar !== true) return false;
      return !p.soloAdm || this.rol === 'ADM';
    }

    // A que vista lleva la pestaña: en modo solicitante, "Iniciativas" es
    // "Solicitar una iniciativa" (Nueva solicitud).
    vistaDe(p) { return this.soloSolicitud && p.vista === 'iniciativas' ? 'nueva' : p.vista; }

    aplicarPestanas() {
      var self = this;
      PESTANAS.forEach(function (p) {
        var t = self.$(p.id);
        if (t) t.hidden = !self.pestanaVisible(p);
      });
    }

    // ---- arranque ----
    iniciar() {
      var self = this;
      this.menu = new MenuLateral(this.doc).conectar();
      // El registro carga por su cuenta, en paralelo con el catalogo de
      // Nueva solicitud: un fallo de uno no bloquea al otro.
      this.registro = new window.RegistroIniciativas.VistaRegistro(this.doc).iniciar();
      // Acuse del PO / SO en el detalle y avisos de ADM: un solo cliente
      // (quien soy se pide una vez). Sin sql/28 no pintan nada. Oculto
      // pendiente de aprobacion (AcuseIniciativa.HABILITADO = false): ni se
      // conecta, y la seccion de avisos deja de ser data-solo-adm para que
      // SesionAdmin no la muestre.
      if (window.AcuseIniciativa && !window.AcuseIniciativa.HABILITADO) {
        var avSeccion = this.$('avSeccion');
        if (avSeccion) { avSeccion.removeAttribute('data-solo-adm'); avSeccion.hidden = true; }
      }
      if (window.AcuseIniciativa && window.AcuseIniciativa.HABILITADO) {
        var clienteAcuse = new window.AcuseIniciativa.ClienteAcuse(null);
        var regAcuse = this.registro;
        this.registro.acuse = new window.AcuseIniciativa.AcuseDetalle(this.doc, null, clienteAcuse);
        this.avisos = new window.AcuseIniciativa.VistaAvisosAcuse(this.doc, null,
          function () { return regAcuse ? regAcuse.registro : null; },
          function (folio) {
            self.mostrarVista('iniciativas');
            if (self.vista === 'iniciativas') regAcuse.abrirDesdeLista(folio);
          }, clienteAcuse);
      }
      // Cola de ADM de "Solicitar cambios" (pestaña Solicitudes). Clasificar
      // usa los valores que ya existen (del registro); aplicar relee el
      // registro sin recargar la pagina.
      if (window.SolicitudesCambioCola) {
        var regCola = this.registro;
        this.cola = new window.SolicitudesCambioCola.ColaSolicitudes(this.doc, null, function () {
          var r = regCola && regCola.registro;
          return r ? { iniciativa: r.valoresTipoIniciativa, agrupado: r.valoresTipoAgrupado } : {};
        });
        this.cola.alCambiarIniciativa = function () { if (regCola && regCola.actualizar) regCola.actualizar(); };
      }
      // "Nuevas" (misma pestaña): registro de solo lectura de sql/29. Al
      // volver a "De cambio" se relee esa cola, como al abrir la pestaña.
      if (window.SolicitudesNuevas) {
        this.nuevas = new window.SolicitudesNuevas.RegistroSolicitudesNuevas(this.doc, null);
        var colaNuevas = this.cola;
        this.nuevas.alVerCambio = function () { if (colaNuevas && colaNuevas.rol === 'ADM') colaNuevas.listar(); };
        // Mis solicitudes (misma pestaña): las propias, para quien no es ADM.
        if (window.SolicitudesNuevas.MisSolicitudes) this.mias = new window.SolicitudesNuevas.MisSolicitudes(this.doc, null);
      }
      // Refresco automatico de la pestaña Solicitudes (assets/js/refresco-auto.js):
      // relee la lista que se ve (Cambios, Iniciativas o Mis solicitudes)
      // con su propio "Actualizar", solo si esa lista lo permite
      // (puedeRefrescar: visible, sin detalle abierto ni nadie escribiendo).
      // Las demas pestañas no se refrescan solas.
      if (window.RefrescoAuto) {
        var listas = [this.cola, this.nuevas, this.mias].filter(function (l) { return l && l.puedeRefrescar; });
        var visible = function () { return listas.filter(function (l) { return l.puedeRefrescar(); })[0] || null; };
        this.refresco = new window.RefrescoAuto({
          doc: this.doc,
          puede: function () { return !!visible(); },
          refrescar: function () { var l = visible(); return l ? l.refrescarFondo() : Promise.resolve(null); }
        }).iniciar();
      }
      // Cambios recientes (pestaña Administracion, solo ADM). Titulo y estado
      // del registro ya cargado; "Ver" abre el mismo detalle de Iniciativas
      // (abrirDesdeLista: pregunta si hay cambios sin guardar) y "Actualizar
      // registro" usa actualizar(), que conserva filtros, busqueda y orden.
      if (window.CambiosRecientes) {
        var regRec = this.registro;
        this.recientes = new window.CambiosRecientes.VistaCambiosRecientes(this.doc, null,
          function () { return regRec ? regRec.registro : null; },
          function (folio) {
            self.mostrarVista('iniciativas');
            if (self.vista === 'iniciativas') regRec.abrirDesdeLista(folio);
          },
          function () { return regRec.actualizar(); });
      }
      if (window.IniciativaAdmin) {
        // La volumetria (GET) va por el mismo fetch de la pagina; la
        // validacion (POST) por el suyo.
        this.crearAdmin = new window.IniciativaAdmin.VistaCrearAdmin(this.doc, null,
          function (url, op) { return fetch(url, op); });
        // "Ligar a un problema existente": busca en el registro ya cargado y,
        // al elegir uno, abre su "Modificar" en Iniciativas.
        var reg = this.registro;
        this.crearAdmin.fijarProblemas(
          function () { return reg && reg.registro ? reg.registro.iniciativas : null; },
          function (folio) { self.mostrarVista('iniciativas'); reg.modificar(folio); });
        // Clasificacion, Agrupacion y Estado del alta: los valores que ya
        // existen, del mismo registro.
        this.crearAdmin.fijarValores(function () {
          var r = reg && reg.registro;
          return r ? { estados: r.estadosProblem, subestados: r.subestadosProblem,
                       tiposIniciativa: r.valoresTipoIniciativa, tiposAgrupado: r.valoresTipoAgrupado,
                       persiste: r.persistenciaAdmin === true, volumetriaManual: r.volumetriaManual === true,
                       subestadoAlta: r.subestadoAlta === true } : null;
        });
        // Un alta GUARDADA relee el registro (la lista, la busqueda de
        // "existente" y sus valores) sin recargar la pagina y sin tocar la
        // vista de Iniciativas (filtros, busqueda, orden, "mostrar mas",
        // modo, detalle abierto): actualizar(), no cargar(). Si la relectura
        // falla, el alta SI se guardo y se dice junto a su respuesta.
        this.crearAdmin.alGuardar = function () {
          return reg.actualizar().then(function (res) {
            var caja = self.$('admResultado');
            if (res.ok || res.superada || !caja) return res;
            caja.innerHTML += '<p class="ini-prototipo-aviso">Se guardó, pero la lista de Iniciativas no se pudo actualizar: ' +
              Escape.html((res.error && res.error.message) || 'error desconocido') + ' Puede no mostrarla todavía.</p>';
            return res;
          });
        };
      }
      if (DUENOS_VISIBLES && window.CategoriasDuenos) this.duenos = new window.CategoriasDuenos.VistaDuenos(this.doc);
      if (this.$('cdSeccion')) this.$('cdSeccion').hidden = !DUENOS_VISIBLES;
      this.aplicarPestanas();
      this.cablearPestanas();
      this.cablearAcciones();
      this.mostrarVista(this.vista);
      this.cablearSelects();
      this.montarDesplegables();
      this.cablearCampos();
      this.cablearEnvio();
      this.globo = new GloboAyuda(this.$('panel-nueva'), '.ayuda-destino', function (d) {
        return self.ayudaDe(d.getAttribute('data-ayuda'));
      }).conectar();
      this.$('iniReintentar').addEventListener('click', function () { self.cargar(); });
      return this.cargar();
    }

    // ---- vistas: solo navegacion; no tocan el borrador ----
    mostrarVista(nombre) {
      var self = this;
      if (!VISTAS[nombre] || this.denegada) return;
      // Modo solicitante: Nueva solicitud y Solicitudes, nada mas.
      if (this.soloSolicitud && nombre !== 'nueva' && nombre !== 'solicitudes') return;
      // Solicitudes: la misma regla que Solicitar (clic, teclado u otro modulo).
      if (nombre === 'solicitudes' && this.puedeSolicitar !== true) return;
      if (VISTAS_SOLO_ADM[nombre] && this.rol !== 'ADM') return;
      // El alta necesita su modulo (admin/iniciativa-admin.js); Administracion no.
      if (nombre === 'crear' && !this.crearAdmin) return;
      if (VISTAS_ADM_MOD[nombre] && this.rol !== 'ADM' && this.rol !== 'MOD' && !this.soloSolicitud) return;
      // Con rol pero sin ser solicitante (MOD que no es PO/SO vigente).
      if (VISTAS_ADM_MOD[nombre] && this.rol && this.puedeSolicitar === false) return;
      // Salir del registro con cambios sin guardar en el detalle: se
      // pregunta; si no se descartan, la pestana no cambia.
      if (nombre !== 'iniciativas' && this.registro && this.registro.cerrarDetalle &&
          this.registro.cerrarDetalle() === false) return;
      this.vista = nombre;
      Object.keys(VISTAS).forEach(function (k) { self.$(VISTAS[k].panel).hidden = k !== nombre; });
      PESTANAS.forEach(function (p) {
        var t = self.$(p.id);
        var activa = VISTAS[nombre].pestana === p.id;
        t.classList.toggle('activa', activa);
        t.setAttribute('aria-selected', activa ? 'true' : 'false');
        t.tabIndex = activa ? 0 : -1;
      });
      if (nombre !== 'iniciativas' && this.registro) this.registro.cerrarDetalle();
      // El catalogo de dueños se pide la primera vez que se abre la pestaña.
      if (nombre === 'administracion' && this.duenos) this.duenos.abrir();
      // Cada vez que se abre Administracion (rol ADM ya revisado arriba).
      if (nombre === 'administracion' && this.recientes) this.recientes.abrir();
      if (nombre === 'administracion' && this.avisos) this.avisos.abrir();
      if (nombre === 'solicitudes') this.abrirSolicitudes();
      if (nombre === 'nueva') this.repintarBorrador();
      else if (this.globo) this.globo.ocultar();
    }

    // Nueva solicitud se pinta desde SolicitudNueva, no desde lo que haya
    // quedado en el DOM.
    repintarBorrador() {
      if (!this.solicitud) return;
      this.pintarCamposComunes();
      this.pintarCamposTipo();
      this.pintar();
    }

    cablearPestanas() {
      var self = this;
      PESTANAS.forEach(function (p, i) {
        var t = self.$(p.id);
        t.addEventListener('click', function () { self.mostrarVista(self.vistaDe(p)); });
        t.addEventListener('keydown', function (e) {
          var paso = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
          if (!paso) return;
          // Salta las pestañas ocultas (Administracion sin rol ADM).
          var n = i, sig = p;
          do {
            n = (n + paso + PESTANAS.length) % PESTANAS.length;
            sig = PESTANAS[n];
          } while (sig !== p && !self.pestanaVisible(sig));
          self.mostrarVista(self.vistaDe(sig));
          enfocar(self.$(sig.id));
        });
      });
    }

    // "Solicitar una iniciativa" abre Nueva solicitud; "Volver" regresa.
    cablearAcciones() {
      var self = this;
      this.$('btnSolicitar').addEventListener('click', function () {
        self.mostrarVista('nueva');
        enfocar(self.$('iniNuevaTitulo'));
      });
      this.$('btnVolver').addEventListener('click', function () {
        self.mostrarVista('iniciativas');
        enfocar(self.$('btnSolicitar'));
      });
      this.$('btnCrearAdmin').addEventListener('click', function () {
        self.mostrarVista('crear');
        if (self.vista === 'crear') enfocar(self.$('admCrearTitulo'));
      });
      this.$('btnVolverAdmin').addEventListener('click', function () {
        self.mostrarVista('administracion');
        enfocar(self.$('btnCrearAdmin'));
      });
    }

    // ---- selects ----
    // Tipo, PO, SO y Categoria con el desplegable del filtro Tecnicos de
    // SLA (assets/js/desplegable.js): el <select> sigue siendo la fuente de
    // la verdad y avisa con su `change`, asi que la cascada no cambia. Las
    // opciones que llegan con innerHTML las rehace el propio desplegable;
    // value / disabled por propiedad, repintarDesplegables. Una sola vez:
    // los selects son del HTML fijo. Sin el modulo quedan nativos.
    montarDesplegables() {
      var D = window.Desplegable, self = this;
      if (!D || !D.montar) return;
      [{ sel: 'selTipo' }].concat(SELECTS).forEach(function (ids) {
        var sel = self.$(ids.sel);
        if (sel && sel.parentNode) D.montar(sel.parentNode);
      });
    }

    repintarDesplegables() {
      if (window.Desplegable && window.Desplegable.repintar) window.Desplegable.repintar();
    }

    cablearSelects() {
      var self = this;
      this.$('selTipo').addEventListener('change', function (e) {
        if (!self.solicitud) return;
        self.solicitud.elegirTipo(e.target.value);
        self.pintarCamposTipo();
        self.pintarCamposComunes();
        self.pintar();
      });
      SELECTS.forEach(function (ids, i) {
        self.$(ids.sel).addEventListener('change', function (e) {
          if (!self.solicitud) return;
          self.solicitud.elegir(i, e.target.value);
          if (self.solicitud.camposTipo().some(function (c) { return c.reiniciaConCascada; })) {
            self.pintarCamposTipo();
          }
          self.pintarCamposComunes();
          self.pintar();
          self.actualizarCapacidad();
          self.actualizarVolumen();
        });
      });
    }

    // Pide la volumetria de la Categoria elegida con el VolumetriaCliente
    // de Crear / Modificar (admin/iniciativa-admin.js; recuerda por ruta y
    // no recuerda errores). Mientras llega se ve "Consultando…", nunca la
    // de la categoria anterior; la que llegue tarde de otra se descarta.
    actualizarVolumen() {
      var self = this, s = this.solicitud;
      var cat = s ? s.categoria() : '';
      if (!cat || (s.volumen && s.volumen.categoria === cat && s.volumen.estado !== 'error')) return Promise.resolve();
      s.pedirVolumen();
      this.pintarCalculados();
      var A = window.IniciativaAdmin;
      if (!A || !A.VolumetriaCliente) {
        s.fijarVolumen(cat, { estado: 'error', mensaje: 'falta admin/iniciativa-admin.js.' });
        this.pintarCalculados();
        return Promise.resolve();
      }
      if (!this.volumetria) {
        this.volumetria = new A.VolumetriaCliente(function (url, op) { return (self.pedir || fetch)(url, op); });
      }
      return this.volumetria.consultar(cat).then(function (e) {
        if (self.solicitud === s && s.fijarVolumen(cat, e)) self.pintarCalculados();
      });
    }

    // Pide la capacidad de la Categoria elegida, si cambio. Solo para
    // mostrarla y acotar el %; el servidor decide al validar.
    actualizarCapacidad() {
      var self = this, s = this.solicitud;
      var cat = s ? s.categoria() : '';
      if (!cat || (s.capacidad && s.capacidad.categoria === cat)) return Promise.resolve();
      s.pedirCapacidad();
      this.pintarPct(s.estado().pct);
      var pedir = this.pedir || fetch;
      var listo = function (json) {
        if (self.solicitud === s && s.fijarCapacidad(cat, json)) self.pintarPct(s.estado().pct);
      };
      return Promise.resolve()
        .then(function () { return pedir(URL_CAPACIDAD + '?categoria=' + encodeURIComponent(cat), { cache: 'no-store' }); })
        .then(function (r) {
          return r.json().catch(function () { return null; }).then(function (json) { return r.ok ? json : null; });
        })
        .then(listo, function () { listo(null); });
    }

    pintarSelect(sel, mot, e) {
      if (e.etiquetas) {
        // Valor (prefijo) y texto (Descripcion) distintos.
        sel.innerHTML = '<option value="">' + Escape.html(e.habilitado ? '— Elige —' : '—') + '</option>' +
          e.opciones.map(function (v) {
            var t = Object.prototype.hasOwnProperty.call(e.etiquetas, v) ? e.etiquetas[v] : v;
            return '<option value="' + Escape.attr(v) + '">' + Escape.html(t) + '</option>';
          }).join('');
      } else {
        Catalogos.llenar(sel, e.opciones, e.habilitado ? '— Elige —' : '—');
      }
      sel.value = e.valor;
      sel.disabled = !e.habilitado;
      mot.textContent = e.motivo;
    }

    pintar() {
      var self = this;
      var est = this.solicitud.estado();
      this.pintarSelect(this.$('selTipo'), this.$('motTipo'), est.tipo);
      est.niveles.forEach(function (e, i) {
        self.pintarSelect(self.$(SELECTS[i].sel), self.$(SELECTS[i].mot), e);
      });
      this.repintarDesplegables();
      this.$('outDirector').textContent = est.director.valor || '—';
      this.$('motDirector').textContent = est.director.motivo;
      this.mostrarCampos(est.camposVisibles);
      this.pintarPct(est.pct);
      this.pintarCalculados();
      this.pintarRca(est.rca);
    }

    // Volumetria (con el mismo htmlVolumetria de Crear / Modificar) y
    // Tickets a reducir: solo lectura, desde SolicitudNueva.
    pintarCalculados() {
      var s = this.solicitud, vol = this.$('campo-volumetria'), tk = this.$('campo-tickets');
      if (!s || !vol || !tk) return;
      var est = s.estado(), A = window.IniciativaAdmin;
      vol.innerHTML = (A && A.htmlVolumetria ? A.htmlVolumetria(est.volumetria.e)
        : '<output class="ini-vol">' + Escape.html(est.volumetria.e ? est.volumetria.e.estado : '—') + '</output>') +
        (est.volumetria.reintentar ? ' <button type="button" class="btn linea chico" data-reintentar="volumetria">Reintentar</button>' : '');
      this.$('campo-volumetria-msg').textContent = est.volumetria.motivo;
      // Tickets: casilla editable. Lo escrito no se toca; si manda el %,
      // muestra los que da. Con la meta en tickets, el % muestra el calculado.
      tk.disabled = !est.tickets.habilitado;
      if (est.tickets.metaPor !== 'tickets' || tk.value === undefined || tk.value === null) tk.value = est.tickets.vista;
      var pct = this.$('campo-pct');
      if (pct && est.tickets.metaPor === 'tickets') pct.value = s.valores.pct || '';
      this.pintarMensaje('tickets', est.tickets.motivo);
    }

    pintarRca(e) {
      var input = this.$('campoRca');
      input.disabled = !e.habilitado;
      input.setAttribute('aria-required', e.obligatorio ? 'true' : 'false');
      this.$('motRca').textContent = e.motivo;
      this.$('rotRcaObligatorio').hidden = !e.obligatorio;
      this.$('iniRcaArchivo').hidden = !RCA.enSitio;
      this.$('iniRcaCorreo').hidden = RCA.enSitio;
    }

    // 02 y 03 se ven al elegir el tipo; antes, su aviso.
    mostrarCampos(visibles) {
      this.$('iniBloqueCampos').hidden = !visibles;
      this.$('iniCamposPendiente').hidden = visibles;
      this.$('iniBloqueImpacto').hidden = !visibles;
      this.$('iniImpactoPendiente').hidden = visibles;
    }

    // El % se habilita con la Categoria; el aviso dice por que no, o el
    // error de lo capturado.
    pintarPct(e) {
      var input = this.$('campo-pct');
      input.disabled = !e.habilitado;
      // El tope del control sigue a la capacidad; sin ella, 100.
      input.setAttribute('max', e.max === null || e.max === undefined ? '100' : String(e.max));
      this.pintarMensaje('pct', e.motivo);
    }

    // Mensaje bajo un control numerico: el error si lo hay; si no, `base`.
    pintarMensaje(clave, base) {
      var msg = this.$('campo-' + clave + '-msg');
      var error = this.solicitud ? this.solicitud.error(clave) : '';
      msg.textContent = error || base || '';
      msg.classList.toggle('ini-error-campo', !!error);
      this.$('campo-' + clave).setAttribute('aria-invalid', error ? 'true' : 'false');
    }

    // Todos bloqueados con el mismo motivo (cargando / error / vacio).
    bloquearTodo(motivo) {
      var self = this;
      [{ sel: 'selTipo', mot: 'motTipo' }].concat(SELECTS).forEach(function (ids) {
        var sel = self.$(ids.sel);
        Catalogos.llenar(sel, [], '—');
        sel.disabled = true;
        self.$(ids.mot).textContent = motivo;
      });
      this.repintarDesplegables();
      this.$('outDirector').textContent = '—';
      this.$('motDirector').textContent = '';
      this.mostrarCampos(false);
      this.pintarRca({ habilitado: false, obligatorio: false, motivo: motivo });
    }

    // ---- campos de captura ----
    ayudaDe(clave) {
      if (Object.prototype.hasOwnProperty.call(AYUDA_FIJA, clave)) return AYUDA_FIJA[clave];
      var todos = CAMPOS_COMUNES.concat(this.solicitud ? this.solicitud.camposTipo() : []);
      for (var i = 0; i < todos.length; i++) if (todos[i].clave === clave) return todos[i].ayuda || null;
      return null;
    }

    htmlCampo(campo, valor) {
      var id = 'campo-' + campo.clave;
      var v = valor || '';
      var ayuda = campo.ayuda && campo.ayuda.texto;
      var rotulo = ayuda
        ? '<label for="' + id + '" class="ini-rotulo ayuda-destino" data-ayuda="' + Escape.attr(campo.clave) + '">' +
            Escape.html(campo.etiqueta) + '</label>'
        : '<label for="' + id + '" class="ini-rotulo">' + Escape.html(campo.etiqueta) + '</label>';
      var numerico = campo.control === 'entero' || campo.control === 'porcentaje' || campo.control === 'meta-tickets';
      var ids = (ayuda ? [id + '-ayuda'] : []).concat(numerico ? [id + '-msg'] : []);
      var describe = ids.length ? ' aria-describedby="' + ids.join(' ') + '"' : '';
      var dato = ' id="' + id + '" data-campo="' + Escape.attr(campo.clave) + '"';
      var control;
      if (campo.control === 'calculado') {
        // Solo lectura, como el Director derivado: rotulo + caja punteada +
        // motivo. El contenido lo pone pintarCalculados.
        var idRot = id + '-rot';
        var ref = ' aria-describedby="' + (ayuda ? id + '-ayuda ' : '') + id + '-msg"';
        return '<div class="ini-campo ini-derivado">' +
          '<span class="ini-rotulo-derivado' + (ayuda ? ' ayuda-destino' : '') + '" id="' + idRot + '"' +
          (ayuda ? ' data-ayuda="' + Escape.attr(campo.clave) + '"' : '') + '>' + Escape.html(campo.etiqueta) +
          ' <span class="ini-origen derivado">Calculada</span></span>' +
          '<div id="' + id + '" role="group" aria-labelledby="' + idRot + '"' + ref + '><output class="ini-vol">—</output></div>' +
          '<small class="ini-motivo" id="' + id + '-msg" aria-live="polite"></small>' +
          (ayuda ? '<span class="ini-sr" id="' + id + '-ayuda">' + Escape.html(ayuda) + '</span>' : '') + '</div>';
      }
      if (campo.control === 'meta-tickets') {
        // Se habilita con la volumetria (pintarCalculados).
        control = '<input type="number"' + dato + describe + ' inputmode="numeric" min="0" step="1" disabled value="' +
          Escape.attr(v) + '">';
      } else if (campo.control === 'multilinea') {
        control = '<textarea' + dato + ' rows="6"' + describe + '>' + Escape.html(v) + '</textarea>';
      } else if (campo.control === 'entero') {
        control = '<input type="number"' + dato + describe + ' inputmode="numeric" min="0" step="1" value="' + Escape.attr(v) + '">';
      } else if (campo.control === 'porcentaje') {
        control = '<div class="ini-pct"><input type="number"' + dato + describe + ' inputmode="decimal" min="0" max="100" step="0.01"' +
          (campo.requiereCategoria && !(this.solicitud && this.solicitud.categoria()) ? ' disabled' : '') +
          ' value="' + Escape.attr(v) + '"><span class="ini-pct-sufijo" aria-hidden="true">%</span></div>';
      } else {
        control = '<input type="text"' + dato + describe + ' value="' + Escape.attr(v) + '">';
      }
      var oculto = ayuda ? '<span class="ini-sr" id="' + id + '-ayuda">' + Escape.html(ayuda) + '</span>' : '';
      var msg = numerico ? '<small class="ini-motivo" id="' + id + '-msg" aria-live="polite"></small>' : '';
      return '<div class="ini-campo ini-campo-captura">' + rotulo + control + msg + oculto + '</div>';
    }

    // 02 Informacion del problema y 03 Impacto, cada uno en su contenedor.
    pintarCamposComunes() {
      var self = this, s = this.solicitud;
      [['info', 'iniCamposComunes'], ['impacto', 'iniCamposImpacto']].forEach(function (par) {
        self.$(par[1]).innerHTML = CAMPOS_COMUNES.filter(function (c) { return c.seccion === par[0]; })
          .map(function (c) { return self.htmlCampo(c, s ? s.valores[c.clave] : ''); }).join('');
      });
      this.pintarCalculados();
    }

    pintarCamposTipo() {
      var self = this, s = this.solicitud;
      var campos = s ? s.camposTipo() : [];
      var cont = this.$('iniCamposTipo');
      cont.innerHTML = campos.map(function (c) { return self.htmlCampo(c, s.valoresTipo[c.clave]); }).join('');
      cont.hidden = campos.length === 0;
    }

    // Un solo oyente para los dos contenedores: los controles se vuelven a
    // pintar y no conviene colgarles eventos uno por uno.
    cablearCampos() {
      var self = this;
      ['iniCamposComunes', 'iniCamposImpacto', 'iniCamposTipo'].forEach(function (id) {
        self.$(id).addEventListener('input', function (e) {
          var clave = e.target && e.target.getAttribute && e.target.getAttribute('data-campo');
          if (!clave || !self.solicitud) return;
          self.solicitud.capturar(clave, e.target.value);
          if (clave === 'pct' || clave === 'tickets') {
            self.pintarPct(self.solicitud.estado().pct);
            self.pintarCalculados();
          }
        });
      });
      // "Reintentar" de la volumetria (solo aparece tras un error).
      this.$('iniCamposImpacto').addEventListener('click', function (e) {
        var t = e.target;
        if (t && t.getAttribute && t.getAttribute('data-reintentar') === 'volumetria') self.actualizarVolumen();
      });
    }

    // ---- RCA y validacion en el servidor ----
    cablearEnvio() {
      var self = this;
      this.$('campoRca').addEventListener('change', function (e) {
        if (!self.solicitud) return;
        var archivos = e.target && e.target.files;
        self.solicitud.elegirRca(archivos && archivos.length ? archivos[0] : null);
      });
      this.$('btnValidar').addEventListener('click', function () { self.validar(); });
    }

    // Primero lo que el navegador ya sabe (faltantes, formatos); si pasa, el
    // servidor vuelve a validar TODO, con catalogo y capacidad actuales, y
    // resuelve quien solicita y el correo del PO. Si la base ya guarda
    // solicitudes (sql/29) la guarda: guardada = true y su numero; entonces
    // el borrador se reemplaza por uno limpio (otro token). El mismo token
    // reenviado devuelve el mismo numero (nuevo = false), nunca otra.
    validar() {
      var self = this, s = this.solicitud;
      if (!s) return Promise.resolve();
      var locales = s.erroresCliente();
      if (locales.length) {
        this.mostrarResultado(false, 'Revisa la solicitud antes de validarla:', locales);
        return Promise.resolve();
      }

      var campos = s.camposEnvio();
      var datos = new FormData();
      Object.keys(campos).forEach(function (k) { datos.append(k, campos[k]); });
      if (RCA.enSitio && s.rca) datos.append('rca', s.rca, s.rca.name);

      var boton = this.$('btnValidar');
      boton.disabled = true;
      this.mostrarResultado(null, 'Validando en el servidor…', []);
      var pedir = this.pedir || fetch;
      return Promise.resolve()
        .then(function () { return pedir(URL_VALIDAR, { method: 'POST', body: datos }); })
        .then(function (r) {
          return r.json().catch(function () { return null; }).then(function (json) {
            if (self.solicitud !== s) return;
            if (json && typeof json.valida === 'boolean') {
              var guardada = json.valida && json.guardada === true &&
                typeof json.numero_solicitud === 'string' && json.numero_solicitud;
              self.mostrarResultado(json.valida, guardada
                ? (json.nuevo === false
                    ? 'Esta solicitud ya estaba guardada con el número ' + json.numero_solicitud + '. No se creó otra.'
                    : 'Solicitud guardada. Número de solicitud: ' + json.numero_solicitud + '.') + self.textoDestinatarios(json)
                : json.valida
                  ? 'La solicitud pasó la validación del servidor. No se guardó: el guardado de solicitudes todavía no está habilitado.'
                  : 'El servidor rechazó la solicitud:', Array.isArray(json.errores) ? json.errores : []);
              if (guardada) self.nuevoBorrador();
            } else {
              self.mostrarResultado(false, (json && json.error) || ('El servidor respondió ' + r.status + '.'), []);
            }
          });
        })
        .catch(function () {
          if (self.solicitud === s) self.mostrarResultado(false, 'No se pudo conectar con el servidor.', []);
        })
        .then(function () { boton.disabled = false; });
    }

    // " Solicitante: ... · Product Owner: ..." con lo que resolvio el
    // servidor (nunca lo capturado).
    textoDestinatarios(json) {
      var partes = [];
      var sol = json && json.solicitante;
      if (sol && typeof sol.correo === 'string' && sol.correo) {
        partes.push('Solicitante: ' + (typeof sol.nombre === 'string' && sol.nombre ? sol.nombre + ' <' + sol.correo + '>' : sol.correo));
      }
      if (json && typeof json.product_owner_correo === 'string' && json.product_owner_correo) {
        partes.push('Product Owner: ' + json.product_owner_correo);
      }
      return partes.length ? ' ' + partes.join(' · ') + '.' : '';
    }

    // Tras guardar: el mismo catalogo, un borrador limpio (otro token). El
    // resultado se queda a la vista.
    nuevoBorrador() {
      if (!this.solicitud) return;
      this.solicitud = new SolicitudNueva(this.solicitud.catalogo);
      this.$('campoRca').value = '';
      this.pintarCamposComunes();
      this.pintarCamposTipo();
      this.pintar();
    }

    // valida: true / false / null (en curso). errores: [{campo, mensaje}].
    mostrarResultado(valida, texto, errores) {
      var caja = this.$('iniResultado');
      caja.hidden = false;
      caja.classList.toggle('ok', valida === true);
      caja.classList.toggle('mal', valida === false);
      caja.innerHTML = '<strong>' + Escape.html(texto) + '</strong>' + (errores.length
        ? '<ul>' + errores.map(function (e) {
            var rot = ROTULOS[e.campo] ? ROTULOS[e.campo] + ': ' : '';
            return '<li>' + Escape.html(rot + (e.mensaje || '')) + '</li>';
          }).join('') + '</ul>'
        : '');
    }

    mostrarError(texto) {
      this.$('iniErrorTexto').textContent = texto;
      this.$('iniError').hidden = false;
    }

    // ---- carga ----
    // `pedir` es fetch por omision; las pruebas le pasan uno propio.
    cargar(pedir) {
      var self = this;
      pedir = pedir || function (url, opciones) { return fetch(url, opciones || { cache: 'no-store' }); };
      this.pedir = pedir;      // capacidad y validacion usan el mismo
      var mia = ++this.cargaId;

      this.solicitud = null;
      this.$('iniResultado').hidden = true;
      if (this.globo) this.globo.ocultar();
      this.$('iniError').hidden = true;
      this.$('iniOmitidas').hidden = true;
      this.$('iniEstado').textContent = 'Cargando catálogos…';
      this.bloquearTodo('Cargando…');

      return Promise.resolve()
        .then(function () {
          return Promise.resolve(pedir(URL_CATALOGO)).catch(function () {
            throw new Error('No se pudo conectar con el servidor.');
          });
        })
        .then(function (r) {
          return r.json().catch(function () { return null; }).then(function (json) {
            if (!r.ok) {
              throw new Error((json && json.error) || ('El servidor respondió ' + r.status + '.'));
            }
            return json;
          });
        })
        .then(function (json) {
          if (mia !== self.cargaId) return;
          var catalogo = CatalogoIniciativas.desdeJson(json);
          self.$('iniEstado').textContent = '';
          // El alta de ADM usa el mismo catalogo aunque no haya categorias:
          // la categoria es opcional ahi.
          if (self.crearAdmin) self.crearAdmin.fijarCatalogo(catalogo);
          // "Modificar" agrega categorias de este mismo catalogo: las de ADM
          // (todas las activas) si vinieron; "Solicitar cambios", las de la
          // cascada, como siempre.
          if (self.registro && self.registro.fijarRutasCatalogo && window.IniciativaAdmin) {
            var BA = window.IniciativaAdmin.BorradorAdmin;
            // Las filas de la cascada (las mismas de Nueva solicitud) para
            // "Agregar categoria" de Solicitar cambios.
            self.registro.fijarRutasCatalogo(BA.rutasDe(catalogo), undefined, catalogo.rutasAdm ? BA.rutasAdmDe(catalogo) : null,
              catalogo.asignaciones);
          }
          // ... y sus PO / SO capturados salen de la misma lista que el alta.
          if (self.registro && self.registro.fijarDuenosCatalogo && window.IniciativaAdmin) {
            var B = window.IniciativaAdmin.BorradorAdmin;
            self.registro.fijarDuenosCatalogo({ po: B.valoresDe(catalogo, 'po'), so: B.valoresDe(catalogo, 'so') });
          }

          if (catalogo.omitidas > 0) {
            var n = catalogo.omitidas;
            self.$('iniOmitidas').textContent = n + (n === 1
              ? ' categoría activa no aparece: no tiene Director, Product Owner y Service Owner vigentes en el catálogo de dueños.'
              : ' categorías activas no aparecen: no tienen Director, Product Owner y Service Owner vigentes en el catálogo de dueños.');
            self.$('iniOmitidas').hidden = false;
          }

          if (!catalogo.asignaciones.length) {
            self.$('iniEstado').textContent = 'No hay categorías activas con Director, Product Owner y Service Owner.';
            self.bloquearTodo('Sin valores en el catálogo.');
            return;
          }
          if (!catalogo.tipos.length) {
            self.$('iniEstado').textContent = 'No hay tipos de iniciativa en el catálogo.';
          }

          self.solicitud = new SolicitudNueva(catalogo);
          self.pintarCamposComunes();
          self.pintarCamposTipo();
          self.pintar();
        })
        .catch(function (err) {
          if (mia !== self.cargaId) return;
          self.solicitud = null;
          if (self.crearAdmin) self.crearAdmin.fijarCatalogo(null);
          // Sin catalogo: "Modificar" y "Solicitar cambios" lo dicen (error),
          // no lo pintan como lista vacia ni como "cargando".
          if (self.registro && self.registro.fijarRutasCatalogo) self.registro.fijarRutasCatalogo(null, 'error');
          self.$('iniEstado').textContent = '';
          self.bloquearTodo('No disponible: no se pudo cargar el catálogo.');
          self.mostrarError((err && err.message) || 'No se pudo cargar el catálogo.');
        });
    }
  }

  return {
    URL_CATALOGO: URL_CATALOGO,
    URL_CAPACIDAD: URL_CAPACIDAD,
    URL_VALIDAR: URL_VALIDAR,
    CAMPOS_COMUNES: CAMPOS_COMUNES,
    AYUDA_FIJA: AYUDA_FIJA,
    VALIDAR: VALIDAR,
    RCA: RCA,
    fraccionDe: fraccionDe,
    ticketsDe: ticketsDe,
    pctDeTickets: pctDeTickets,
    nuevoToken: nuevoToken,
    DEFINICIONES_TIPO: DEFINICIONES_TIPO,
    CatalogoIniciativas: CatalogoIniciativas,
    CascadaOrganizacional: CascadaOrganizacional,
    SolicitudNueva: SolicitudNueva,
    VISTAS: VISTAS,
    VISTAS_SOLO_ADM: VISTAS_SOLO_ADM,
    VISTAS_ADM_MOD: VISTAS_ADM_MOD,
    DUENOS_VISIBLES: DUENOS_VISIBLES,
    MenuLateral: MenuLateral,
    PaginaIniciativas: PaginaIniciativas
  };
})();

window.IniciativasPagina = (function () {
  'use strict';
  var pagina = new window.Iniciativas.PaginaIniciativas(document);
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { pagina.iniciar(); });
  } else {
    pagina.iniciar();
  }
  return pagina;
})();
