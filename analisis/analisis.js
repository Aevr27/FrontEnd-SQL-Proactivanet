/* =========================================================================
   analisis/analisis.js

   Pestaña "Análisis de servicios". Un solo archivo para la pagina suelta
   (analisis/analisis.html) y para la pestaña del tablero, que monta ese
   mismo marcado e inyecta este mismo script (TableroAnalisis en
   dashboard.js).

   De donde sale cada cosa:
     - la lista de servicios y los tickets: handlers/analisis.ashx, que lee
       dbo.usp_Analisis_Servicios y dbo.usp_Analisis_Datos
       (47_analisis_servicios.sql);
     - el analisis (motivo, temporal, sitios, atencion) y el Excel:
       analisis/motor.js, el MISMO motor de la pagina de claude.ai
       (analisis_servicio/motor.js en el repositorio; la prueba revisa que las
       dos copias sean iguales);
     - leer el JSON, preparar y analizar corren en un Web Worker
       (analisis/trabajo.js) para no congelar la pagina; si no arranca, el
       mismo archivo corre aqui;
     - el Excel lo arma ExcelJS (analisis/vendor/exceljs.min.js, copia local:
       el tablero corre en una VM sin salida a CDN), cargado al pulsar.

   Las reglas de motivo son las del servicio en la base. El editor de la hoja
   "Reglas" deja probar cambios SIN guardarlos: reclasifica aqui mismo, y
   "Generar script" arma el SQL que los guarda; ese script lo corre el dueno
   en SSMS. El tablero no escribe en la base.
   ========================================================================= */

(function () {
  'use strict';
  if (typeof document === 'undefined') return;

  var PREFIJO = 'an-';
  function $(id) { return document.getElementById(PREFIJO + id); }
  if (!$('servicio')) return;

  // Rutas resueltas contra este script: embebido, el documento vive un nivel
  // mas arriba. document.currentScript solo vale mientras se evalua.
  var YO = document.currentScript && document.currentScript.src;
  function junto(rel, respaldo) { try { return new URL(rel, YO).href; } catch (e) { return respaldo; } }
  var API = junto('../handlers/analisis.ashx', 'handlers/analisis.ashx');
  var MOTOR_URL = junto('motor.js', 'analisis/motor.js');
  var EXCEL_URL = junto('vendor/exceljs.min.js', 'analisis/vendor/exceljs.min.js');
  var TRABAJO_URL = junto('trabajo.js', 'analisis/trabajo.js');

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function cargarScript(url, global) {
    return new Promise(function (ok, mal) {
      if (window[global]) return ok();
      var s = document.createElement('script');
      s.src = url;
      s.onload = function () { ok(); };
      s.onerror = function () { mal(new Error('no se pudo cargar ' + url)); };
      document.head.appendChild(s);
    });
  }
  var motorListo = null;
  function motor() { return motorListo || (motorListo = cargarScript(MOTOR_URL, 'Motor').then(function () { return window.Motor; })); }

  /* ------------------------------------------------------------ trabajo pesado */
  // Leer el JSON, preparar y analizar corren en un Worker (trabajo.js) para que
  // la pagina no se congele con un servicio grande. Si el Worker no arranca o
  // se cae, el mismo trabajo.js corre aqui, en la pagina, como antes. Aqui
  // tambien se sigue usando motor.js para pintar, el editor y el Excel.
  function Analizador() {
    var yo = this;
    this.pendientes = {}; this.n = 0; this.local = null; this.cuerpo = null;
    try { this.worker = typeof Worker === 'function' ? new Worker(TRABAJO_URL) : null; } catch (e) { this.worker = null; }
    if (!this.worker) return;
    this.worker.onmessage = function (e) {
      var m = e.data, p = yo.pendientes[m.id];
      if (!p) return;
      if (m.aviso) { p.avisar(m.aviso); return; }
      delete yo.pendientes[m.id];
      if (m.error) p.mal(new Error(m.error)); else p.ok(m.ok);
    };
    this.worker.onerror = function (e) { if (e.preventDefault) e.preventDefault(); yo.sinWorker(); };
  }
  Analizador.prototype.sinWorker = function () {
    if (this.worker) this.worker.terminate();
    this.worker = null;
    var p = this.pendientes; this.pendientes = {};
    Object.keys(p).forEach(function (id) { var e = new Error('sin worker'); e.sinWorker = true; p[id].mal(e); });
  };
  // cuerpo: el ArrayBuffer de analisis.ashx. Se copia al Worker (no se
  // transfiere) para poder repetir aqui si el Worker se cae.
  Analizador.prototype.cargar = function (cuerpo, avisar) { this.cuerpo = cuerpo; return this.pedir('cargar', { cuerpo: cuerpo }, avisar); };
  Analizador.prototype.analizar = function (servicio, avisar) { return this.pedir('analizar', { servicio: servicio }, avisar); };
  Analizador.prototype.pedir = function (tipo, args, avisar) {
    var yo = this;
    if (!this.worker) return this.aqui(tipo, args, avisar);
    return new Promise(function (ok, mal) {
      var id = ++yo.n;
      yo.pendientes[id] = { ok: ok, mal: mal, avisar: avisar };
      args.id = id; args.tipo = tipo;
      yo.worker.postMessage(args);
    }).catch(function (e) {
      if (!e.sinWorker) throw e;
      // Lo que el Worker tenia cargado se perdio con el: se vuelve a cargar aqui.
      var antes = tipo === 'analizar' && !(yo.local && yo.local.datos) ? yo.aqui('cargar', { cuerpo: yo.cuerpo }, avisar) : Promise.resolve();
      return antes.then(function () { return yo.aqui(tipo, args, avisar); });
    });
  };
  Analizador.prototype.aqui = function (tipo, args, avisar) {
    var yo = this;
    return Promise.all([motor(), cargarScript(TRABAJO_URL, 'AnalisisTrabajo')]).then(function () {
      if (!yo.local) yo.local = new window.AnalisisTrabajo(window.Motor);
      // El aviso se pinta antes de que el trabajo ocupe la pagina.
      avisar(tipo === 'cargar' ? 'Preparando tickets…' : 'Analizando…');
      return new Promise(function (ok) { setTimeout(ok, 20); });
    }).then(function () {
      var nada = function () {};
      return tipo === 'cargar' ? yo.local.cargar(args.cuerpo, nada) : yo.local.analizar(args.servicio, nada);
    });
  };
  var analizador = new Analizador();

  /* ------------------------------------------------------------ estado */
  var servicios = [];            // lista de usp_Analisis_Servicios
  var respuesta = null;          // lo ultimo que devolvio analisis.ashx, sin los tickets
  var nTickets = 0;              // tickets que dejo Motor.preparar(...)
  var turno = 0;                 // cada "Analizar" deja viejo al anterior
  var medicion = null;           // ms de cada paso de la ultima carga
  var reglasBase = [];           // las de la base
  var reglasPrueba = null;       // las del editor, si se estan probando
  var motivosEquipo = [];
  var resultado = null;          // Motor.analizar(...)
  var pestana = 'Resumen';

  function estado(txt, clase) { var e = $('estado'); e.textContent = txt || ''; e.className = 'estado' + (clase ? ' ' + clase : ''); }
  function error(txt) { $('error').hidden = !txt; $('error-msg').textContent = txt || ''; }

  /* ------------------------------------------------------------ fechas */
  function dos(n) { return (n < 10 ? '0' : '') + n; }
  function iso(d) { return d.getFullYear() + '-' + dos(d.getMonth() + 1) + '-' + dos(d.getDate()); }
  function hoyMx() {
    // El dia de Mexico (UTC-6), aunque el equipo este en otra zona.
    var ahora = new Date(Date.now() - 6 * 3600000);
    return new Date(ahora.getUTCFullYear(), ahora.getUTCMonth(), ahora.getUTCDate());
  }
  function ponerMeses(n) {
    var h = hoyMx(), d = new Date(h.getFullYear(), h.getMonth() - (n - 1), 1);
    $('desde').value = iso(d); $('hasta').value = iso(h);
    document.querySelectorAll('#' + PREFIJO + 'filtros [data-meses]').forEach(function (b) {
      b.setAttribute('aria-pressed', String(+b.dataset.meses === n));
    });
  }

  /* ------------------------------------------------------------ servicios */
  function pedirServicios() {
    estado('Cargando servicios…');
    return fetch(API + '?accion=servicios', { cache: 'no-store' })
      .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status)); return j; }); })
      .then(function (j) {
        servicios = j.servicios || [];
        var sel = $('servicio');
        sel.innerHTML = servicios.length ? '' : '<option value="">(no hay servicios dados de alta)</option>';
        servicios.forEach(function (s) {
          var o = document.createElement('option');
          o.value = s.Servicio; o.textContent = s.Nombre + (s.Reglas ? '' : ' (sin reglas)');
          sel.appendChild(o);
        });
        $('lista').innerHTML = servicios.map(function (s) {
          return '<button type="button" class="an-servicio" data-servicio="' + esc(s.Servicio) + '"><b>' + esc(s.Nombre) + '</b>' +
                 '<span>' + esc(s.Descripcion || '') + '</span><span>' + (s.Reglas || 0) + ' reglas de motivo · versión ' + esc(s.ReglasVersion) + '</span></button>';
        }).join('');
        estado(servicios.length ? '' : 'Sin servicios: falta correr 47 y el script de algún servicio.');
      })
      .catch(function (e) { estado(''); error('No se pudo leer la lista de servicios: ' + e.message); });
  }

  /* ------------------------------------------------------------ analizar */
  function analizar() {
    var clave = $('servicio').value;
    if (!clave) return;
    error(''); $('avisos').hidden = true;
    $('analizar').disabled = true; $('excel').disabled = true;
    var nombre = (servicios.filter(function (s) { return s.Servicio === clave; })[0] || {}).Nombre || clave;
    estado('Trayendo los tickets de ' + nombre + '…');
    var url = API + '?servicio=' + encodeURIComponent(clave) + '&desde=' + encodeURIComponent($('desde').value) + '&hasta=' + encodeURIComponent($('hasta').value);
    var t0 = Date.now(), mio = ++turno, med = {};
    // El JSON no se lee aqui: el cuerpo pasa entero al Worker. Solo una
    // respuesta de error (corta) se lee en la pagina.
    Promise.all([motor(), fetch(url, { cache: 'no-store' }).then(function (r) {
      if (r.ok) return r.arrayBuffer();
      return r.json().then(function (j) { throw new Error(j.error || ('HTTP ' + r.status)); });
    })]).then(function (x) {
      if (mio !== turno) return;
      med.descarga = Date.now() - t0;
      var avisar = function (txt) { if (mio === turno) estado(txt); };
      return analizador.cargar(x[1], avisar).then(function (c) {
        if (mio !== turno) return;
        respuesta = c.respuesta; nTickets = c.tickets;
        med.lectura = c.ms.lectura; med.preparacion = c.ms.preparacion;
        reglasBase = c.reglas;
        reglasPrueba = null;
        var me = parametro('MotivosEquipo');
        try { motivosEquipo = JSON.parse(me || '[]'); } catch (e) { motivosEquipo = []; }
        return correrAnalisis(avisar, med).then(function (listo) {
          if (!listo || mio !== turno) return;
          med.total = Date.now() - t0; med.enWorker = !!analizador.worker; medicion = med;
          estado(window.Motor.miles(nTickets) + ' tickets en ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s.', 'ok');
          $('excel').disabled = false;
          $('intro').hidden = true; $('resultado').hidden = false;
        });
      });
    }).catch(function (e) {
      if (mio !== turno) return;
      estado('');
      error(e.message + (/HTTP 5/.test(e.message) ? ' Revisa que 47_analisis_servicios.sql este corrido.' : ''));
    }).then(function () { if (mio === turno) $('analizar').disabled = false; });
  }

  function parametro(clave) {
    var b = respuesta && respuesta.bloques && respuesta.bloques.parametros;
    if (!b) return null;
    var ic = b.columnas.indexOf('Clave'), iv = b.columnas.indexOf('Valor');
    var f = b.filas.filter(function (r) { return r[ic] === clave; })[0];
    return f ? f[iv] : null;
  }
  function criterios() {
    var b = respuesta.bloques.parametros, ic = b.columnas.indexOf('Clave'), iv = b.columnas.indexOf('Valor');
    return b.filas.filter(function (r) { return ['Ruta', 'RutaFuera', 'Grupo', 'Titulo'].indexOf(r[ic]) >= 0; })
                  .map(function (r) { return { clave: r[ic], valor: r[iv] }; });
  }

  // Corre el analisis (en el Worker) y pinta. Resuelve true si pinto; false si
  // mientras tanto se pidio otro analisis.
  function correrAnalisis(avisar, med) {
    var mio = turno;
    return analizador.analizar({ nombre: parametro('Servicio') || respuesta.servicio, reglas: reglasPrueba || reglasBase, motivosEquipo: motivosEquipo },
                               avisar || function () {}).then(function (a) {
      if (mio !== turno) return false;
      var t0 = Date.now();
      resultado = a.resultado;
      pintar();
      if (med) { med.analisis = a.ms.analisis; med.pintado = Date.now() - t0; }
      return true;
    });
  }

  /* ------------------------------------------------------------ pintar */
  var HOJAS = [['Resumen', 'Resumen'], ['Temporal', 'Temporal'], ['Sitios', 'Sitios'], ['Motivos', 'Motivos'],
               ['Atencion', 'Atención'], ['Reglas', 'Reglas'], ['Detalle', 'Detalle']];
  $('pestanas').innerHTML = HOJAS.map(function (h) {
    return '<button type="button" role="tab" id="' + PREFIJO + 'tab-' + h[0] + '" data-hoja="' + h[0] + '" aria-controls="' + PREFIJO + 'panel">' + esc(h[1]) + '</button>';
  }).join('');

  function fmt(v, t) {
    var M = window.Motor;
    if (v == null || v === '' || (typeof v === 'number' && !isFinite(v))) return '';
    if (typeof v !== 'number') return esc(v);
    if (t === 'pct') return (100 * v).toFixed(1) + '%';
    if (t === 'num1') return v.toLocaleString('es-MX', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    if (t === 'num2') return v.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (t === 'int') return Math.round(v).toLocaleString('es-MX');
    if (t === 'fecha') return esc(M.textoFecha(v));
    return esc(v);
  }
  function htmlTabla(tb, max) {
    var filas = max ? tb.filas.slice(0, max) : tb.filas;
    var num = function (c) { return c.t !== 'txt'; };
    var h = '<div class="an-tabla"><h4>' + esc(tb.titulo) + '</h4><div class="scroll-x"><table><thead><tr>' +
      tb.columnas.map(function (c) { return '<th scope="col"' + (num(c) ? ' class="n"' : '') + '>' + esc(c.n) + '</th>'; }).join('') + '</tr></thead><tbody>';
    if (!filas.length) h += '<tr><td colspan="' + tb.columnas.length + '" class="vacio">Sin datos.</td></tr>';
    filas.forEach(function (f) {
      h += '<tr' + (f[0] === 'Total' ? ' class="total"' : '') + '>' + f.map(function (v, i) {
        var c = tb.columnas[i] || { t: 'txt' }, largo = typeof v === 'string' && v.length > 40, corto = typeof v === 'string' && v.length <= 16;
        return '<td' + (num(c) && typeof v === 'number' ? ' class="n"' : largo ? ' class="largo"' : corto ? ' class="c"' : '') + '>' + fmt(v, c.t) + '</td>';
      }).join('') + '</tr>';
    });
    h += '</tbody></table></div>';
    if (tb.nota) h += '<p class="nota">' + esc(tb.nota) + '</p>';
    return h + '</div>';
  }

  // ---- graficas: una sola serie, un solo tono; el globo dice el valor
  function ancho() { var p = $('panel'); return Math.max(300, Math.min(1100, (p && p.clientWidth) || 640)); }
  function columnas(d, op) {
    var W = op.ancho, H = 220, iz = 40, de = 10, ar = 14, ab = 30, n = d.length;
    var max = Math.max.apply(null, d.map(function (x) { return x.v || 0; }).concat([0])) || 1;
    var paso = Math.pow(10, Math.floor(Math.log10(max))), tope = Math.ceil(max / paso) * paso;
    if (tope / paso <= 2) { paso /= 2; tope = Math.ceil(max / paso) * paso; }
    var y = function (v) { return ar + (H - ar - ab) * (1 - v / tope); };
    var banda = (W - iz - de) / Math.max(1, n), bw = Math.min(24, banda * 0.62);
    var s = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(op.titulo) + '">';
    for (var v = 0; v <= tope + 1e-9; v += paso) {
      s += '<line class="eje" x1="' + iz + '" x2="' + (W - de) + '" y1="' + y(v) + '" y2="' + y(v) + '"/><text x="' + (iz - 6) + '" y="' + (y(v) + 4) + '" text-anchor="end">' + Math.round(v * 10) / 10 + '</text>';
    }
    var cada = Math.ceil(n / Math.max(1, Math.floor((W - iz - de) / 46)));
    d.forEach(function (x, i) {
      var cx = iz + banda * (i + 0.5), yv = y(x.v || 0), h = Math.max(0, y(0) - yv), r = Math.min(4, h, bw / 2);
      s += '<rect class="hit" x="' + (cx - banda / 2) + '" y="' + ar + '" width="' + banda + '" height="' + (H - ar - ab) + '" data-tip="' + esc(x.tip) + '"/>';
      if (h > 0) s += '<path class="barra" pointer-events="none" d="M' + (cx - bw / 2) + ',' + y(0) + 'V' + (yv + r) + 'Q' + (cx - bw / 2) + ',' + yv + ' ' + (cx - bw / 2 + r) + ',' + yv +
                     'H' + (cx + bw / 2 - r) + 'Q' + (cx + bw / 2) + ',' + yv + ' ' + (cx + bw / 2) + ',' + (yv + r) + 'V' + y(0) + 'Z"/>';
      if (i % cada === 0) s += '<text x="' + cx + '" y="' + (H - ab + 16) + '" text-anchor="middle">' + esc(x.e) + '</text>';
    });
    (op.etiquetar || []).forEach(function (i) {
      var x = d[i]; if (!x || x.v == null) return;
      s += '<text class="etq" x="' + (iz + banda * (i + 0.5)) + '" y="' + (y(x.v) - 6) + '" text-anchor="middle">' + esc(x.etq) + '</text>';
    });
    return s + '<line class="eje" x1="' + iz + '" x2="' + (W - de) + '" y1="' + y(0) + '" y2="' + y(0) + '"/></svg>';
  }
  function indice(d, op) {
    var W = op.ancho, H = 220, iz = 40, de = 10, ar = 14, ab = 30, n = d.length;
    var vals = d.map(function (x) { return x.v; }).filter(function (v) { return v != null; });
    var lo = Math.floor(Math.min.apply(null, vals.concat([0.8])) * 10) / 10, hi = Math.ceil(Math.max.apply(null, vals.concat([1.2])) * 10) / 10;
    var y = function (v) { return ar + (H - ar - ab) * (hi - v) / (hi - lo); };
    var banda = (W - iz - de) / n, bw = Math.min(24, banda * 0.62);
    var s = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(op.titulo) + '">';
    for (var v = lo; v <= hi + 1e-9; v += 0.1) {
      s += '<line class="eje" x1="' + iz + '" x2="' + (W - de) + '" y1="' + y(v) + '" y2="' + y(v) + '"/><text x="' + (iz - 6) + '" y="' + (y(v) + 4) + '" text-anchor="end">' + v.toFixed(1) + '</text>';
    }
    d.forEach(function (x, i) {
      var cx = iz + banda * (i + 0.5);
      s += '<rect class="hit" x="' + (cx - banda / 2) + '" y="' + ar + '" width="' + banda + '" height="' + (H - ar - ab) + '" data-tip="' + esc(x.tip) + '"/>';
      if (x.v != null) {
        var a = y(Math.max(x.v, 1)), b = y(Math.min(x.v, 1)), r = Math.min(4, (b - a) / 2, bw / 2), x0 = cx - bw / 2, x1 = cx + bw / 2;
        var p = x.v >= 1 ? 'M' + x0 + ',' + b + 'V' + (a + r) + 'Q' + x0 + ',' + a + ' ' + (x0 + r) + ',' + a + 'H' + (x1 - r) + 'Q' + x1 + ',' + a + ' ' + x1 + ',' + (a + r) + 'V' + b + 'Z'
                         : 'M' + x0 + ',' + a + 'V' + (b - r) + 'Q' + x0 + ',' + b + ' ' + (x0 + r) + ',' + b + 'H' + (x1 - r) + 'Q' + x1 + ',' + b + ' ' + x1 + ',' + (b - r) + 'V' + a + 'Z';
        if (b - a > 0.5) s += '<path class="barra" pointer-events="none" d="' + p + '"/>';
      }
      s += '<text x="' + cx + '" y="' + (H - ab + 16) + '" text-anchor="middle">' + esc(x.e) + '</text>';
    });
    s += '<line class="ref" x1="' + iz + '" x2="' + (W - de) + '" y1="' + y(1) + '" y2="' + y(1) + '"/>';
    return s + '<text class="etq" x="' + (W - de) + '" y="' + (y(1) - 6) + '" text-anchor="end">1.0 = día normal</text></svg>';
  }
  function horizontales(d, op) {
    var W = op.ancho, fila = 26, ar = 6, H = ar + fila * d.length + 6, et = Math.min(W * 0.46, 340), iz = et + 8, de = 56;
    var max = Math.max.apply(null, d.map(function (x) { return x.v; })) || 1;
    var x = function (v) { return iz + (W - iz - de) * v / max; };
    var corta = function (t) { var m = Math.floor(et / 6.2); return t.length > m ? t.slice(0, m - 1) + '…' : t; };
    var s = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(op.titulo) + '">';
    d.forEach(function (q, i) {
      var cy = ar + fila * i + fila / 2, bh = Math.min(16, fila - 8), w = x(q.v) - iz, r = Math.min(4, w, bh / 2);
      s += '<rect class="hit" x="0" y="' + (cy - fila / 2) + '" width="' + W + '" height="' + fila + '" data-tip="' + esc(q.tip) + '"/>';
      s += '<text x="' + et + '" y="' + (cy + 4) + '" text-anchor="end" style="fill:var(--ink-2)">' + esc(corta(q.e)) + '</text>';
      if (w > 0) s += '<path class="barra' + (q.apagada ? ' apagada' : '') + '" pointer-events="none" d="M' + iz + ',' + (cy - bh / 2) + 'H' + (iz + w - r) + 'Q' + (iz + w) + ',' + (cy - bh / 2) + ' ' + (iz + w) + ',' + (cy - bh / 2 + r) +
                     'V' + (cy + bh / 2 - r) + 'Q' + (iz + w) + ',' + (cy + bh / 2) + ' ' + (iz + w - r) + ',' + (cy + bh / 2) + 'H' + iz + 'Z"/>';
      s += '<text class="etq" x="' + (iz + Math.max(w, 0) + 6) + '" y="' + (cy + 4) + '">' + esc(q.etq) + '</text>';
    });
    return s + '<line class="eje" x1="' + iz + '" x2="' + iz + '" y1="' + ar + '" y2="' + (H - 6) + '"/></svg>';
  }
  function grafica(titulo, svg, nota) {
    return '<div class="an-tabla an-grafica"><h4>' + esc(titulo) + '</h4>' + svg + (nota ? '<p class="nota">' + esc(nota) + '</p>' : '') + '</div>';
  }
  function graficasTemporal() {
    var M = window.Motor, g = resultado.graficas, W = ancho() > 900 ? Math.floor((ancho() - 16) / 2) : ancho();
    var meses = g.meses.map(function (m) {
      return { e: m.mes.slice(2), v: m.porDia, etq: M.numTxt(m.porDia), tip: m.mes + '\n' + M.numTxt(m.porDia) + ' tickets por día\n' + M.miles(m.tickets) + ' en el mes' };
    });
    var iMax = meses.reduce(function (b, d, i) { return d.v > (meses[b] || {}).v ? i : b; }, 0);
    var q = g.quincena.map(function (d) {
      return { e: (d.k > 0 ? '+' : '') + d.k, v: d.indice,
               tip: (d.k === 0 ? 'Día de pago' : (d.k < 0 ? -d.k + ' días antes del pago' : d.k + ' días después del pago')) + '\nÍndice ' + M.numTxt(d.indice, 2) };
    });
    return '<div class="an-graficas">' +
      grafica('Tickets por día, promedio de cada mes', columnas(meses, { ancho: W, titulo: 'Tickets por día por mes', etiquetar: [iMax, meses.length - 1] })) +
      grafica('Alrededor del pago', indice(q, { ancho: W, titulo: 'Índice alrededor del pago' }), 'Días respecto al 15 o al último del mes. Arriba de 1.0, más tickets que un día normal de su día de la semana.') +
      '</div>';
  }
  function graficaMotivos() {
    var M = window.Motor;
    var d = resultado.graficas.motivos.map(function (m) {
      return { e: m.motivo, v: m.tickets, etq: (100 * m.pct).toFixed(1) + '%', apagada: m.motivo === M.SIN_CLASIFICAR,
               tip: m.motivo + '\n' + M.miles(m.tickets) + ' tickets (' + (100 * m.pct).toFixed(1) + '%)' };
    });
    return grafica('Tickets por motivo', horizontales(d, { ancho: ancho(), titulo: 'Tickets por motivo' }), 'En gris, lo que ninguna regla reconoció.');
  }

  function pintar() {
    var M = window.Motor, r = resultado, c = r.cifras;
    $('titulo').textContent = r.servicio + (reglasPrueba ? ' — probando reglas del editor' : '');
    $('sub').textContent = 'Del ' + respuesta.desde + ' al ' + respuesta.hasta + ' · corte ' + M.textoFecha(r.corte) + ' (hora de México) · reglas versión ' +
                           (parametro('ReglasVersion') || '?') + ' · ' + M.miles(c.tickets) + ' tickets' + (c.soloGrupo ? ' · ' + M.miles(c.soloGrupo) + ' solo por el grupo, aparte' : '');
    var mot = c.motivos.filter(function (m) { return m[0] !== M.SIN_CLASIFICAR; }).sort(function (a, b) { return b[1] - a[1]; })[0];
    var k = [
      ['Tickets', M.miles(c.tickets), 'por la ruta del servicio'],
      ['Por día', M.numTxt(c.porDia), 'promedio de días completos'],
      ['Sitios', M.miles(c.sitios), 'tiendas, City Club, CEDIS y CAD'],
      ['Concentración', M.pctTxt(c.conc10), 'en el 10% de sitios con más'],
      ['Reincidencia 30 días', M.pctTxt(c.reinc30), 'otro ticket del mismo sitio'],
      ['Cumple SLA', M.pctTxt(c.cumple), 'de los que tienen fecha estimada'],
      ['TTR mediano', M.numTxt(c.ttrMed) + ' d', 'registro a firma de solución'],
      ['Sin clasificar', M.pctTxt(c.sinClasificar), mot ? 'principal: ' + mot[0] : 'sin reglas']
    ];
    $('kpis').innerHTML = k.map(function (x) {
      return '<div class="kpi"><div class="lbl">' + esc(x[0]) + '</div><div class="val">' + esc(x[1]) + '</div><div class="foot">' + esc(x[2]) + '</div></div>';
    }).join('');
    $('hallazgos').innerHTML = r.hallazgos.map(function (h) { return '<li>' + esc(h) + '</li>'; }).join('');
    var av = (r.avisos || []).filter(Boolean);
    $('avisos').innerHTML = av.map(function (a) { return '<li>' + esc(a) + '</li>'; }).join('');
    $('avisos').hidden = !av.length;
    pintarPanel();
  }

  function pintarPanel() {
    HOJAS.forEach(function (h) {
      var b = $('tab-' + h[0]); b.setAttribute('aria-selected', String(h[0] === pestana)); b.tabIndex = h[0] === pestana ? 0 : -1;
    });
    $('panel').setAttribute('aria-labelledby', PREFIJO + 'tab-' + pestana);
    var r = resultado, h = '';
    if (pestana === 'Detalle') {
      h = htmlTabla({ titulo: 'Detalle: una fila por ticket', columnas: r.detalle.columnas, filas: r.detalle.filas,
                      nota: 'Aquí se ven las primeras 100 de ' + window.Motor.miles(r.detalle.filas.length) + ' filas; el Excel las lleva todas, con filtro.' }, 100);
    } else {
      if (pestana === 'Temporal') h += graficasTemporal();
      if (pestana === 'Motivos') h += graficaMotivos();
      // Los hallazgos ya estan arriba: aqui no se repiten (el Excel si los lleva).
      h += (r.hojas[pestana] || []).filter(function (tb) { return tb.id !== 'hallazgos'; }).map(function (tb) { return htmlTabla(tb); }).join('');
      if (pestana === 'Reglas') h += editor();
    }
    $('panel').innerHTML = h;
    if (pestana === 'Reglas') conectarEditor();
  }

  /* ------------------------------------------------------------ reglas */
  function editor() {
    var M = window.Motor, fr = M.frasesFrecuentes(resultado.sinClasificar, 40);
    return '<div class="an-editor"><h4>Probar cambios a las reglas</h4>' +
      '<p class="nota">Una regla por línea: <code>R01 | Motivo | Campo | frase; otra frase</code>. Campo: D = título y descripción, S = solución, DS = cualquiera. ' +
      'Una frase entre comillas conserva sus espacios: <code>" pin "</code> encuentra la palabra sola. Gana la primera que cumple. ' +
      '"Probar" reclasifica aquí mismo sin guardar nada. Cuando funcionen, "Generar script" arma el SQL que las guarda en la base: se lo pasas a quien corre los scripts.</p>' +
      '<textarea id="' + PREFIJO + 'reglas" spellcheck="false" aria-label="Reglas de motivo">' + esc(M.reglasATexto(reglasPrueba || reglasBase)) + '</textarea>' +
      '<div class="an-botones"><button type="button" class="btn" id="' + PREFIJO + 'probar">Probar reglas</button>' +
      '<button type="button" class="btn linea" id="' + PREFIJO + 'base"' + (reglasPrueba ? '' : ' disabled') + '>Volver a las de la base</button>' +
      '<button type="button" class="btn gris" id="' + PREFIJO + 'generar">Generar script SQL</button>' +
      '<span class="an-estado-ed" id="' + PREFIJO + 'estado-ed" role="status">' + (reglasPrueba ? 'Probando las reglas del editor; la base no cambió.' : '') + '</span></div>' +
      '<div id="' + PREFIJO + 'salida-script" hidden><pre class="an-script" id="' + PREFIJO + 'script"></pre>' +
      '<div class="an-botones"><button type="button" class="btn" id="' + PREFIJO + 'bajar-script">⬇ Descargar .sql</button>' +
      '<button type="button" class="btn linea" id="' + PREFIJO + 'copiar-script">Copiar</button></div></div></div>' +
      '<div class="an-editor"><h4>Frases que más se repiten en los tickets sin clasificar</h4>' +
      '<p class="nota">Pares y tríos de palabras del título y la descripción, por número de tickets. Sirven para escribir reglas nuevas.</p>' +
      (fr.length ? '<div class="an-frases">' + fr.map(function (f) { return '<span>' + esc(f[0]) + '<b>' + f[1] + '</b></span>'; }).join('') + '</div>'
                 : '<p class="nota">No hay suficientes tickets sin clasificar para sugerir frases.</p>') + '</div>';
  }
  function leerEditor() {
    var r = window.Motor.textoAReglas($('reglas').value), e = $('estado-ed');
    if (r.errores.length) { e.className = 'an-estado-ed mal'; e.textContent = r.errores.slice(0, 3).join(' '); return null; }
    return r.reglas;
  }
  function conectarEditor() {
    // Mientras se trae otro servicio (Analizar deshabilitado) el editor espera.
    $('probar').addEventListener('click', function () {
      if ($('analizar').disabled) return;
      var r = leerEditor(); if (!r) return;
      reglasPrueba = r;
      $('probar').disabled = true;
      correrAnalisis().then(function (listo) {
        if (!listo) return;
        var e = $('estado-ed'); e.className = 'an-estado-ed ok'; e.textContent = r.length + ' reglas aplicadas aquí; la base no cambió.';
      }).catch(function (x) { error(x.message); }).then(function () { if ($('probar')) $('probar').disabled = false; });
    });
    $('base').addEventListener('click', function () {
      if ($('analizar').disabled) return;
      reglasPrueba = null; correrAnalisis().catch(function (x) { error(x.message); });
    });
    $('generar').addEventListener('click', function () {
      var M = window.Motor, r = leerEditor(); if (!r) return;
      var s = servicios.filter(function (x) { return x.Servicio === respuesta.servicio; })[0] || {};
      var g = M.scriptServicio({
        clave: respuesta.servicio, nombre: parametro('Servicio') || s.Nombre, descripcion: s.Descripcion || null,
        desdeSugerido: s.DesdeSugerido || null, criterios: criterios(), reglas: r, motivosEquipo: motivosEquipo,
        origen: 'Generado por la pestaña "Análisis de servicios" del tablero, sobre la versión ' + (parametro('ReglasVersion') || '?') + ' de las reglas.',
        fecha: M.textoFecha(Date.UTC.apply(null, (function (d) { return [d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()]; })(new Date())))
      });
      var e = $('estado-ed');
      if (g.errores.length) { e.className = 'an-estado-ed mal'; e.textContent = g.errores.slice(0, 3).join(' '); return; }
      $('script').textContent = g.sql; $('salida-script').hidden = false;
      e.className = 'an-estado-ed ok'; e.textContent = 'Script listo: ' + r.length + ' reglas. Descárgalo y pásaselo a quien corre los scripts en SSMS.';
      $('bajar-script').onclick = function () {
        bajar('﻿' + g.sql, 'application/sql', 'analisis_' + respuesta.servicio + '_reglas_' + iso(new Date()).replace(/-/g, '') + '.sql');
      };
      $('copiar-script').onclick = function () { copiar($('script'), e); };
    });
  }

  function bajar(contenido, tipo, nombre) {
    var url = URL.createObjectURL(contenido instanceof Blob ? contenido : new Blob([contenido], { type: tipo }));
    var a = document.createElement('a');
    a.href = url; a.download = nombre;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
  }
  function copiar(nodo, e) {
    var r = document.createRange(); r.selectNodeContents(nodo);
    var s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (x) { ok = false; }
    e.className = 'an-estado-ed ' + (ok ? 'ok' : '');
    e.textContent = ok ? 'Copiado.' : 'Quedó seleccionado: cópialo con Ctrl+C.';
  }

  /* ------------------------------------------------------------ Excel */
  function excel() {
    var M = window.Motor;
    if (!resultado) return;
    $('excel').disabled = true; estado('Armando el Excel…');
    cargarScript(EXCEL_URL, 'ExcelJS').then(function () {
      return M.armarLibro(resultado, window.ExcelJS).xlsx.writeBuffer();
    }).then(function (buf) {
      var nombre = 'Analisis_' + respuesta.servicio + '_' + respuesta.desde.replace(/-/g, '') + '_' + respuesta.hasta.replace(/-/g, '') + '.xlsx';
      bajar(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), null, nombre);
      estado('Excel listo: ' + nombre, 'ok');
    }).catch(function (e) { error('No se pudo armar el Excel: ' + e.message); estado(''); })
      .then(function () { $('excel').disabled = false; });
  }

  /* ------------------------------------------------------------ eventos */
  $('analizar').addEventListener('click', analizar);
  $('excel').addEventListener('click', excel);
  $('filtros').addEventListener('click', function (e) {
    var b = e.target.closest('[data-meses]'); if (b) ponerMeses(+b.dataset.meses);
  });
  ['desde', 'hasta'].forEach(function (id) {
    $(id).addEventListener('change', function () {
      document.querySelectorAll('#' + PREFIJO + 'filtros [data-meses]').forEach(function (b) { b.setAttribute('aria-pressed', 'false'); });
    });
  });
  $('lista').addEventListener('click', function (e) {
    var b = e.target.closest('[data-servicio]'); if (!b) return;
    $('servicio').value = b.dataset.servicio; analizar();
  });
  $('pestanas').addEventListener('click', function (e) {
    var b = e.target.closest('[data-hoja]'); if (!b || !resultado) return;
    pestana = b.dataset.hoja; pintarPanel();
  });
  $('pestanas').addEventListener('keydown', function (e) {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    var i = HOJAS.findIndex(function (h) { return h[0] === pestana; }) + (e.key === 'ArrowRight' ? 1 : -1);
    pestana = HOJAS[(i + HOJAS.length) % HOJAS.length][0]; pintarPanel(); $('tab-' + pestana).focus();
  });
  var tip = $('tip');
  document.addEventListener('pointermove', function (e) {
    var t = e.target.closest && e.target.closest('#' + PREFIJO + 'panel [data-tip]');
    if (!t) { tip.hidden = true; return; }
    tip.textContent = t.getAttribute('data-tip'); tip.hidden = false;
    tip.style.left = Math.min(window.innerWidth - tip.offsetWidth - 8, e.clientX + 12) + 'px';
    tip.style.top = Math.max(8, e.clientY - tip.offsetHeight - 10) + 'px';
  });

  // Al volver a la pestaña (dashboard.js -> alVolver) o al cambiar el ancho: las
  // graficas se dibujan al ancho del panel, que midio cero mientras estuvo oculto.
  var anchoPintado = 0;
  function redimensionar() {
    if (!resultado || (pestana !== 'Temporal' && pestana !== 'Motivos')) return;
    if (Math.abs(ancho() - anchoPintado) > 20) { anchoPintado = ancho(); pintarPanel(); }
  }
  window.addEventListener('resize', function () { clearTimeout(redimensionar.t); redimensionar.t = setTimeout(redimensionar, 200); });
  // medicion(): ms de descarga, lectura, preparacion, analisis y pintado de la
  // ultima carga, para revisarlos desde la consola sin llenarla de mensajes.
  window.TableroAnalisisModulo = { redimensionar: redimensionar, medicion: function () { return medicion; } };

  ponerMeses(6);
  pedirServicios();
  motor();   // se adelanta la carga del motor mientras el usuario escoge
})();
