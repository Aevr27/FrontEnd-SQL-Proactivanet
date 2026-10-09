/* =====================================================================================
   motor.js — el analisis de la pagina "Analisis de servicio"

   Lee la salida de 45_extraccion_servicio.sql (o de 44_extraccion_s_biometrico,
   version 1 o 2), clasifica el motivo de cada ticket con las reglas del
   servicio, arma las tablas de las siete hojas y el Excel.

   Corre igual en el navegador (window.Motor) y en node (require): asi la
   prueba del repositorio revisa el mismo codigo que usa la pagina. No manda
   nada a ningun lado: todo pasa en memoria.

   Las definiciones son las del analisis de S-Biometrico del 2026-10-02:

     resuelto      FechaFirmaSolucion no nula y Estado distinto de Rechazada
     evaluable     FechaEstimadaResolucion no nula
     vencido       evaluable y (firma despues de la fecha estimada, o sin firma
                   y la fecha estimada ya paso al corte)
     reabierto     IntentosSolucion > 1
     TTR           FechaFirmaSolucion - FechaRegistro, en dias, de los resueltos
     sitio         Tienda, City Club, CEDIS o CAD con su numero
     reincidencia  el mismo sitio abrio otro ticket en los N dias anteriores
     lote          tickets firmados por la misma persona en el mismo minuto;
                   "en lote" = en grupos de 10 o mas
     primer mov.   primera version del historial con Subestado "En Proceso" o
                   con tecnico asignado
     quincena      dias al pago mas cercano (15 o ultimo del mes), con el
                   indice ajustado por el promedio de su dia de la semana
   ===================================================================================== */
(function (raiz, fabrica) {
    if (typeof module === 'object' && module.exports) module.exports = fabrica();
    else raiz.Motor = fabrica();
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    var DIA = 86400000;
    var DIAS = ['lun', 'mar', 'mie', 'jue', 'vie', 'sab', 'dom'];
    var DIAS_LARGO = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
    var RE_COD = /^\S{2,6} \d{4}-\d+$/;
    var RE_FECHA = /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/;

    /* ------------------------------------------------------------------ utilidades */

    // Las fechas de la salida ya vienen en hora de Mexico: se guardan como si
    // fueran UTC para que ni el navegador ni node les cambien la zona.
    function fecha(s) {
        if (!s) return null;
        var m = /^(\d{4})-(\d\d)-(\d\d)(?:[ T](\d\d):(\d\d)(?::(\d\d))?)?/.exec(s);
        if (!m) return null;
        return Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
    }
    function diaDe(ms) { return Math.floor(ms / DIA) * DIA; }
    function dow(ms) { return (new Date(ms).getUTCDay() + 6) % 7; }
    function dos(n) { return (n < 10 ? '0' : '') + n; }
    function textoDia(ms) {
        var d = new Date(ms);
        return d.getUTCFullYear() + '-' + dos(d.getUTCMonth() + 1) + '-' + dos(d.getUTCDate());
    }
    function textoFecha(ms) {
        if (ms == null) return '';
        var d = new Date(ms);
        return textoDia(ms) + ' ' + dos(d.getUTCHours()) + ':' + dos(d.getUTCMinutes());
    }
    function mesDe(ms) { var d = new Date(ms); return d.getUTCFullYear() + '-' + dos(d.getUTCMonth() + 1); }
    function numero(s) {
        if (s == null || s === '') return null;
        var v = Number(String(s).replace(',', '.'));
        return isFinite(v) ? v : null;
    }
    function ordenados(a) { return a.filter(function (x) { return x != null && isFinite(x); }).sort(function (x, y) { return x - y; }); }
    // Igual que pandas.quantile: interpolacion lineal.
    function cuantil(a, q, yaOrdenado) {
        var s = yaOrdenado ? a : ordenados(a);
        if (!s.length) return null;
        var p = (s.length - 1) * q, lo = Math.floor(p), hi = Math.ceil(p);
        return s[lo] + (s[hi] - s[lo]) * (p - lo);
    }
    function media(a) {
        var s = 0, n = 0;
        for (var i = 0; i < a.length; i++) if (a[i] != null && isFinite(a[i])) { s += a[i]; n++; }
        return n ? s / n : null;
    }
    function contar(lista, clave) {
        var m = new Map();
        for (var i = 0; i < lista.length; i++) {
            var k = clave(lista[i]);
            m.set(k, (m.get(k) || 0) + 1);
        }
        return m;
    }
    function porMayor(m) { return Array.from(m.entries()).sort(function (a, b) { return b[1] - a[1] || (a[0] < b[0] ? -1 : 1); }); }
    function agrupar(lista, clave) {
        var m = new Map();
        for (var i = 0; i < lista.length; i++) {
            var k = clave(lista[i]);
            if (!m.has(k)) m.set(k, []);
            m.get(k).push(lista[i]);
        }
        return m;
    }
    function frac(a, b) { return b ? a / b : null; }
    function redondear(x, d) { if (x == null) return null; var f = Math.pow(10, d); return Math.round(x * f) / f; }
    function pctTxt(x, d) { return x == null ? 's/d' : (100 * x).toFixed(d == null ? 1 : d) + '%'; }
    function numTxt(x, d) { return x == null ? 's/d' : Number(x).toFixed(d == null ? 1 : d); }
    function miles(n) { return n == null ? 's/d' : Math.round(n).toLocaleString('es-MX'); }

    /* ------------------------------------------------------------------ texto */

    // Igual que clasificar.py: minusculas, sin acentos ni caracteres de ancho
    // cero, lo que no sea letra, numero o ":" se vuelve espacio, espacios
    // simples, y un espacio al principio y al final.
    function normalizar(s) {
        s = String(s || '').normalize('NFD').replace(/\p{Mn}/gu, '').toLowerCase();
        s = s.replace(/[\u200B-\u200F\u2060\uFEFF]/g, '');
        s = s.replace(/[^a-z0-9:]/g, ' ').replace(/:\s+/g, ': ');
        return ' ' + s.replace(/\s+/g, ' ').trim() + ' ';
    }

    /* ------------------------------------------------------------------ lectura */

    function decodificar(bytes) {
        var b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
        if (b[0] === 0xFF && b[1] === 0xFE) return new TextDecoder('utf-16le').decode(b.subarray(2));
        if (b[0] === 0xFE && b[1] === 0xFF) return new TextDecoder('utf-16be').decode(b.subarray(2));
        if (b[0] === 0xEF && b[1] === 0xBB && b[2] === 0xBF) return new TextDecoder('utf-8').decode(b.subarray(3));
        var n = Math.min(b.length, 4000), ceros = 0;
        for (var i = 1; i < n; i += 2) if (b[i] === 0) ceros++;
        if (n > 8 && ceros > n / 4) return new TextDecoder('utf-16le').decode(b);
        try { return new TextDecoder('utf-8', { fatal: true }).decode(b); }
        catch (e) { return new TextDecoder('windows-1252').decode(b); }
    }

    var TIPOS = [
        { tipo: 'parametros', pide: ['Bloque', 'Clave', 'Valor'], ok: function (f) { return f.Bloque === '0) Parametros'; } },
        { tipo: 'rutas', pide: ['Bloque', 'Origen', 'Categoria', 'Tickets'], ok: function (f) { return f.Bloque === '1) Rutas'; } },
        { tipo: 'grupos', pide: ['Bloque', 'Grupo', 'PorRuta'], ok: function (f) { return f.Bloque === '2) Grupos'; } },
        { tipo: 'fuera', pide: ['Bloque', 'RamaC1', 'Grupo', 'Tickets'], ok: function (f) { return f.Bloque === '3) Fuera de ruta'; } },
        { tipo: 'textos', pide: ['CodigoTicket', 'Campo', 'Parte', 'Texto'],
          ok: function (f) { return RE_COD.test(f.CodigoTicket || '') && /^\d+$/.test(f.Parte || '') && /\|$/.test(f.Texto || ''); } },
        { tipo: 'historial', pide: ['CodigoTicket', 'VersionFila'],
          ok: function (f) { return RE_COD.test(f.CodigoTicket || '') && /^\d+$/.test(f.VersionFila || ''); } },
        { tipo: 'tickets', pide: ['Origen', 'CodigoTicket', 'FechaRegistro'],
          ok: function (f) { return RE_COD.test(f.CodigoTicket || '') && (f.FechaRegistro == null || RE_FECHA.test(f.FechaRegistro)); } }
    ];
    function identificar(cols) {
        for (var i = 0; i < TIPOS.length; i++) {
            var t = TIPOS[i];
            if (t.pide.every(function (c) { return cols.indexOf(c) >= 0; })) return t;
        }
        return null;
    }
    function valor(crudo, col) {
        var v = col === 'Texto' ? crudo.replace(/\s+$/, '') : crudo.trim();
        return v === 'NULL' ? null : v;
    }
    function filtrar(t, cols, filas, lineas) {
        var buenas = [], malas = [];
        for (var i = 0; i < filas.length; i++) {
            if (t.ok(filas[i])) buenas.push(filas[i]); else malas.push(lineas[i]);
        }
        return { tipo: t.tipo, cols: cols, filas: buenas, descartadas: malas };
    }

    // Texto de ancho fijo (SSMS en modo texto, sqlcmd): cada bloque es un
    // encabezado y una linea de guiones que dice donde empieza y acaba cada
    // columna.
    function bloquesDeTexto(texto) {
        var L = texto.split('\n');
        for (var i = 0; i < L.length; i++) if (L[i].charCodeAt(L[i].length - 1) === 13) L[i] = L[i].slice(0, -1);
        var heads = [];
        for (i = 0; i + 1 < L.length; i++) {
            if (L[i].trim() && /^-+( +-+)*\s*$/.test(L[i + 1])) heads.push(i);
        }
        var out = [], corte = null;
        for (i = L.length - 1; i >= 0 && i >= L.length - 30; i--) {
            var m = /^(?:Completion time|Hora de finalizaci.n)\s*:\s*(\d{4}-\d\d-\d\d)T(\d\d:\d\d:\d\d)/.exec(L[i]);
            if (m) { corte = m[1] + ' ' + m[2]; break; }
        }
        heads.forEach(function (h, k) {
            var spans = [], re = /-+/g, m;
            while ((m = re.exec(L[h + 1]))) spans.push([m.index, m.index + m[0].length]);
            var cols = spans.map(function (s, j) { return (j === spans.length - 1 ? L[h].slice(s[0]) : L[h].slice(s[0], s[1])).trim(); });
            var t = identificar(cols);
            if (!t) return;
            var fin = k + 1 < heads.length ? heads[k + 1] : L.length, filas = [], lineas = [];
            for (var j = h + 2; j < fin; j++) {
                var l = L[j];
                // Avisos que SSMS escribe entre los resultados, no filas: "Warning: Null
                // value is eliminated by an aggregate..." (o "Advertencia:" en espanol) y
                // "(N rows affected)" si alguien quito el SET NOCOUNT.
                if (!l.trim() || /^(Completion time|Hora de finalizaci|Warning:|Advertencia:|\(\d+ (rows?|filas?) )/.test(l)) continue;
                var f = {};
                for (var c = 0; c < cols.length; c++) {
                    var s = spans[c];
                    f[cols[c]] = valor(c === cols.length - 1 ? l.slice(s[0]) : l.slice(s[0], s[1]), cols[c]);
                }
                filas.push(f); lineas.push(j + 1);
            }
            out.push(filtrar(t, cols, filas, lineas));
        });
        return { bloques: out, corte: corte };
    }

    function filasCsv(texto, sep) {
        var filas = [], fila = [], campo = '', q = false, i = 0, n = texto.length;
        while (i < n) {
            var ch = texto[i];
            if (q) {
                if (ch === '"') { if (texto[i + 1] === '"') { campo += '"'; i++; } else q = false; }
                else campo += ch;
            } else if (ch === '"' && campo === '') q = true;
            else if (ch === sep) { fila.push(campo); campo = ''; }
            else if (ch === '\n' || ch === '\r') {
                if (ch === '\r' && texto[i + 1] === '\n') i++;
                fila.push(campo); campo = ''; filas.push(fila); fila = [];
            } else campo += ch;
            i++;
        }
        if (campo !== '' || fila.length) { fila.push(campo); filas.push(fila); }
        return filas;
    }

    // Una cuadricula guardada como .csv. Si no se marco "poner entre comillas"
    // las comas del texto descuadran la fila; en el bloque 6 el texto es la
    // ultima columna y se puede rearmar, en los demas la fila se descarta.
    function bloqueDeCsv(texto) {
        var primera = texto.slice(0, texto.indexOf('\n') + 1 || texto.length);
        var sep = [',', ';', '\t'].sort(function (a, b) { return primera.split(b).length - primera.split(a).length; })[0];
        var F = filasCsv(texto, sep);
        if (!F.length) return null;
        var cols = F[0].map(function (c) { return c.trim(); });
        var t = identificar(cols);
        if (!t) return null;
        var filas = [], lineas = [], desc = [];
        for (var i = 1; i < F.length; i++) {
            var r = F[i];
            if (r.length === 1 && !r[0].trim()) continue;
            if (r.length > cols.length && t.tipo === 'textos') r = r.slice(0, cols.length - 1).concat([r.slice(cols.length - 1).join(sep)]);
            if (r.length !== cols.length) { desc.push(i + 1); continue; }
            var f = {};
            for (var c = 0; c < cols.length; c++) f[cols[c]] = valor(r[c], cols[c]);
            filas.push(f); lineas.push(i + 1);
        }
        var b = filtrar(t, cols, filas, lineas);
        b.descartadas = b.descartadas.concat(desc);
        return b;
    }

    // archivos: [{nombre, bytes}]; un .zip se abre con JSZip (global o require).
    async function leerArchivos(archivos, JSZipRef) {
        var res = { bloques: [], corte: null, archivos: [], avisos: [] };
        var cola = archivos.slice();
        while (cola.length) {
            var a = cola.shift(), nombre = a.nombre || 'archivo';
            if (/\.zip$/i.test(nombre)) {
                var Z = JSZipRef || (typeof JSZip !== 'undefined' ? JSZip : null);
                if (!Z) { res.avisos.push('No se pudo abrir ' + nombre + ': falta el lector de .zip.'); continue; }
                var zip = await Z.loadAsync(a.bytes);
                var dentro = Object.keys(zip.files).filter(function (k) { return !zip.files[k].dir && !/(^|\/)(__MACOSX|\.)/.test(k); });
                for (var i = 0; i < dentro.length; i++) cola.push({ nombre: dentro[i], bytes: await zip.files[dentro[i]].async('uint8array') });
                continue;
            }
            var texto = decodificar(a.bytes);
            var esCsv = /\.csv$/i.test(nombre) && !/\n-+( +-+)*\s*\r?\n/.test(texto.slice(0, 200000));
            var bl;
            if (esCsv) { var b = bloqueDeCsv(texto); bl = { bloques: b ? [b] : [], corte: null }; }
            else bl = bloquesDeTexto(texto);
            if (!bl.bloques.length) res.avisos.push(nombre + ': no se reconocio ningun bloque de la extraccion.');
            res.archivos.push({ nombre: nombre, bloques: bl.bloques.map(function (x) { return x.tipo; }) });
            res.bloques = res.bloques.concat(bl.bloques);
            if (bl.corte && !res.corte) res.corte = bl.corte;
        }
        return res;
    }

    /* ------------------------------------------------------------------ tickets */

    // Las mismas reglas que el bloque 4 del 44 v2, para las salidas que no
    // traen TipoSitio (44 version 1).
    function tipoSitio(tienda) {
        if (tienda == null || !String(tienda).trim()) return 'Sin dato';
        if (/^[0-9]/.test(tienda)) return 'Tienda';
        if (/^city club/i.test(tienda)) return 'City Club';
        if (/^cedis/i.test(tienda)) return 'CEDIS';
        if (/^cad[ 0-9]/i.test(tienda)) return 'CAD';
        if (tienda.indexOf('\\') >= 0) return 'Cuenta';
        if (/[0-9]/.test(tienda)) return 'Otro con numero';
        return 'Persona u otro';
    }
    var PREFIJO_SITIO = { 'Tienda': 'T', 'City Club': 'CC', 'CEDIS': 'CEDIS', 'CAD': 'CAD' };

    function juntarTextos(filas) {
        var partes = new Map();
        filas.forEach(function (f) {
            var k = f.CodigoTicket + '\u0001' + f.Campo;
            if (!partes.has(k)) partes.set(k, []);
            partes.get(k).push([+f.Parte, f.Texto.slice(0, -1)]);
        });
        var out = new Map();
        partes.forEach(function (v, k) {
            var i = k.indexOf('\u0001'), cod = k.slice(0, i), campo = k.slice(i + 1);
            v.sort(function (a, b) { return a[0] - b[0]; });
            if (!out.has(cod)) out.set(cod, {});
            out.get(cod)[campo] = v.map(function (p) { return p[1]; }).join('');
        });
        return out;
    }

    function preparar(leido) {
        var por = {};
        leido.bloques.forEach(function (b) {
            if (!por[b.tipo]) por[b.tipo] = { filas: [], descartadas: 0, cols: b.cols };
            por[b.tipo].filas = por[b.tipo].filas.concat(b.filas);
            por[b.tipo].descartadas += b.descartadas.length;
        });
        var avisos = leido.avisos.slice();
        if (!por.tickets) return { error: 'No viene el bloque 4 (los tickets). Revisa que se haya guardado la salida completa.', avisos: avisos };

        var p = {};
        (por.parametros ? por.parametros.filas : []).forEach(function (f) {
            if (!p[f.Clave]) p[f.Clave] = [];
            p[f.Clave].push(f.Valor == null ? '' : f.Valor);
        });
        var uno = function (k) { return p[k] ? p[k][0] : null; };
        var version = uno('Version') || (por.textos ? '44 v2' : (por.tickets.cols.indexOf('Descripcion') >= 0 ? '44 v1' : '44 v2'));
        var corte = fecha(uno('Extraido') || leido.corte), corteEstimado = false;

        var textos = por.textos ? juntarTextos(por.textos.filas) : new Map();
        var vistos = new Map(), duplicados = 0, sinFecha = 0;
        por.tickets.filas.forEach(function (f) {
            var fReg = fecha(f.FechaRegistro);
            if (fReg == null) { sinFecha++; return; }
            var tx = textos.get(f.CodigoTicket) || {};
            var tienda = f.Tienda, ts = f.TipoSitio || tipoSitio(tienda);
            var num = f.SitioNumero != null ? numero(f.SitioNumero) : null;
            if (f.TipoSitio == null && PREFIJO_SITIO[ts]) {
                var m = /[0-9]+/.exec(tienda || '');
                num = m ? parseInt(m[0].slice(0, 20), 10) : null;
            }
            if (ts === 'Persona u otro' || ts === 'Cuenta') tienda = '(persona o cuenta)';
            var t = {
                codigo: f.CodigoTicket, origen: f.Origen, tipo: f.Tipo, categoria: f.Categoria || '(sin categoria)',
                estado: f.Estado, subestado: f.Subestado, prioridad: f.Prioridad, sla: f.SLA, tipoRelacion: f.TipoRelacion,
                grupo: (f.Grupo || '').trim() || '(sin grupo)', firmo: f.TecnicoResolvio || null,
                tipoSitio: ts, sitioNumero: num, tienda: tienda,
                sitio: PREFIJO_SITIO[ts] && num != null ? PREFIJO_SITIO[ts] + num : null,
                fReg: fReg, fEst: fecha(f.FechaEstimadaResolucion), fSol: fecha(f.FechaFirmaSolucion),
                fCierre: fecha(f.FechaFirmaCierre), fMod: fecha(f.FechaUltimaModificacion),
                intentos: numero(f.IntentosSolucion), reasignaciones: numero(f.ReasignacionesGrupo),
                titulo: tx.Titulo != null ? tx.Titulo : (f.Titulo || ''),
                descripcion: tx.Descripcion != null ? tx.Descripcion : (f.Descripcion || ''),
                solucion: tx.SolucionUsuario != null ? tx.SolucionUsuario : (f.SolucionUsuario || ''),
                qa: {
                    QA_Frecuencia: f.QA_Frecuencia, QA_Aplicacion: f.QA_Aplicacion, QARe_TipoSolucion: f.QARe_TipoSolucion,
                    QARe_UsuarioConfirmo: f.QARe_UsuarioConfirmo, QARe_AplicaOtrosCasos: f.QARe_AplicaOtrosCasos,
                    QARe_GenerarArticulo: f.QARe_GenerarArticulo, QARe_VerificoClasificacion: f.QARe_VerificoClasificacion
                }
            };
            var mm = /(\d{4})-(\d+)$/.exec(t.codigo), clave = mm ? mm[1] + '-' + (+mm[2]) : t.codigo;
            t.arbol = (/^\/([^\/]+)/.exec(t.categoria) || [null, t.categoria])[1];
            var antes = vistos.get(clave);
            if (antes) {
                duplicados++;
                if ((t.fMod || t.fReg) <= (antes.fMod || antes.fReg)) return;
            }
            vistos.set(clave, t);
        });
        var tickets = Array.from(vistos.values()).sort(function (a, b) { return a.fReg - b.fReg || (a.codigo < b.codigo ? -1 : 1); });
        if (!tickets.length) return { error: 'El bloque 4 no trae tickets con fecha de registro.', avisos: avisos };
        if (corte == null) {
            corte = tickets.reduce(function (m, t) { return Math.max(m, t.fMod || 0, t.fReg); }, 0);
            corteEstimado = true;
            avisos.push('La salida no dice cuando se saco: el corte se toma de la ultima modificacion, ' + textoFecha(corte) + '.');
        }
        if (version === '44 v1') avisos.push('Salida del 44 version 1: la descripcion y la solucion llegan cortadas a 256 caracteres; el motivo se lee de lo que alcanzo a llegar.');

        var hist = new Map();
        (por.historial ? por.historial.filas : []).forEach(function (h) {
            if (!hist.has(h.CodigoTicket)) hist.set(h.CodigoTicket, []);
            hist.get(h.CodigoTicket).push({ version: +h.VersionFila, estado: h.Estado, subestado: h.Subestado, grupo: h.Grupo,
                                            tecnico: h.TecnicoSegundaLinea, desde: fecha(h.VigenteDesdeMx), hasta: fecha(h.VigenteHastaMx) });
        });
        // El historial empezo a guardarse en algun momento: un ticket cuya
        // primera version se vio dias despues del registro no tiene su
        // historia completa, y su "primer movimiento" seria el dia en que el
        // historial empezo. Solo cuentan los que se vieron a mas tardar 4 dias
        // despues del registro (un fin de semana largo sin ETL), y solo los
        // movimientos antes de la firma de solucion.
        tickets.forEach(function (t) {
            var hs = hist.get(t.codigo) || [], prim = null, primera = null;
            hs.forEach(function (h) {
                if (h.desde != null && (primera == null || h.desde < primera)) primera = h.desde;
                if ((h.subestado === 'En Proceso' || h.tecnico != null) && h.desde != null && (t.fSol == null || h.desde <= t.fSol) &&
                    (prim == null || h.desde < prim)) prim = h.desde;
            });
            t.conHistorial = primera != null && primera - t.fReg <= 4 * DIA;
            t.primerTrabajo = t.conHistorial ? prim : null;
        });

        var descartadas = 0;
        Object.keys(por).forEach(function (k) { descartadas += por[k].descartadas; });
        if (descartadas) avisos.push(descartadas + ' fila(s) no cuadraron con su encabezado y se dejaron fuera.');
        if (duplicados) avisos.push(duplicados + ' ticket(s) repetidos por año y consecutivo (INC que paso a REQ): se quedo la version mas reciente.');
        if (sinFecha) avisos.push(sinFecha + ' ticket(s) sin fecha de registro se dejaron fuera.');

        return {
            version: version, corte: corte, corteEstimado: corteEstimado,
            parametros: {
                servicio: uno('Servicio'), desde: uno('Desde'), hasta: uno('Hasta'), rutas: p.Ruta || [],
                rutasFuera: p.RutaFuera || [], grupos: p.Grupo || [], titulos: p.Titulo || [],
                // Los que la consulta dejo fuera (45 v2 y el tablero): el bot
                // y las cuentas que no son persona. null en salidas anteriores.
                excluidosBot: uno('ExcluidosBot') != null ? numero(uno('ExcluidosBot')) : null,
                excluidosCuenta: uno('ExcluidosCuenta') != null ? numero(uno('ExcluidosCuenta')) : null
            },
            rutas: por.rutas ? por.rutas.filas : null, grupos: por.grupos ? por.grupos.filas : null,
            fuera: por.fuera ? por.fuera.filas : null,
            tickets: tickets, textosCompletos: !!por.textos, conHistorial: !!por.historial,
            calidad: { descartadas: descartadas, duplicados: duplicados, sinFecha: sinFecha, filasTickets: por.tickets.filas.length },
            avisos: avisos
        };
    }

    /* ------------------------------------------------------------------ reglas */

    var CAMPOS = { D: 'título y descripción', S: 'solución', DS: 'título, descripción o solución' };

    // Normalizar es lo mas caro del analisis y el texto de un ticket no cambia
    // entre una corrida y otra ("Probar reglas" reclasifica los mismos
    // tickets): se guarda por ticket y se rehace solo si su texto cambio.
    var NORMALIZADOS = typeof WeakMap === 'function' ? new WeakMap() : null;
    function textosNormalizados(t) {
        var n = NORMALIZADOS && NORMALIZADOS.get(t);
        if (n && n.titulo === t.titulo && n.descripcion === t.descripcion && n.solucion === t.solucion) return n;
        var d = normalizar(t.titulo + ' ' + t.descripcion), s = normalizar(t.solucion);
        n = { titulo: t.titulo, descripcion: t.descripcion, solucion: t.solucion, d: d, s: s, ds: d + '|' + s };
        if (NORMALIZADOS) NORMALIZADOS.set(t, n);
        return n;
    }

    function clasificar(t, reglas) {
        var n = textosNormalizados(t), d = n.d, s = n.s, ds = n.ds;
        for (var i = 0; i < reglas.length; i++) {
            var r = reglas[i], texto = r.campo === 'S' ? s : r.campo === 'D' ? d : ds;
            for (var j = 0; j < r.frases.length; j++) {
                if (texto.indexOf(r.frases[j]) >= 0) return { motivo: r.motivo, regla: r.id, frase: r.frases[j] };
            }
        }
        return { motivo: SIN_CLASIFICAR, regla: 'R99', frase: null };
    }
    var SIN_CLASIFICAR = 'Sin clasificar';

    // Texto editable de las reglas: una por linea,
    //     R01 | Motivo | S | frase uno; frase dos; " pin "
    // Una frase entre comillas conserva sus espacios de las orillas.
    function reglasATexto(reglas) {
        return reglas.map(function (r) {
            return [r.id, r.motivo, r.campo, r.frases.map(function (f) { return /^ | $/.test(f) ? '"' + f + '"' : f; }).join('; ')].join(' | ');
        }).join('\n');
    }
    function textoAReglas(texto) {
        var reglas = [], errores = [];
        texto.split('\n').forEach(function (l, i) {
            if (!l.trim() || /^\s*#/.test(l)) return;
            var c = l.split('|');
            if (c.length < 4) { errores.push('Linea ' + (i + 1) + ': faltan columnas (Regla | Motivo | Campo | Frases).'); return; }
            var campo = c[2].trim().toUpperCase();
            if (!CAMPOS[campo]) { errores.push('Linea ' + (i + 1) + ': el campo va D, S o DS.'); return; }
            // La frase se normaliza igual que el texto; si venia entre comillas
            // conserva el espacio de sus orillas.
            var frases = c.slice(3).join('|').split(';').map(function (f) {
                f = f.trim();
                if (/^".*"$/.test(f)) f = f.slice(1, -1);
                var n = normalizar(f).trim();
                return n ? (/^ /.test(f) ? ' ' : '') + n + (/ $/.test(f) ? ' ' : '') : '';
            }).filter(function (f) { return f !== ''; });
            if (!frases.length) { errores.push('Linea ' + (i + 1) + ': no trae frases.'); return; }
            reglas.push({ id: c[0].trim(), motivo: c[1].trim(), campo: campo, frases: frases });
        });
        return { reglas: reglas, errores: errores };
    }

    /* ------------------------------------------------------------------ analisis */

    function resumenAtencion(g, corte) {
        var res = g.filter(function (t) { return t.resuelto; });
        var ev = g.filter(function (t) { return t.evaluable; });
        var venc = ev.filter(function (t) { return t.vencido; }).length;
        return {
            tickets: g.length, resueltos: res.length,
            rechazados: g.filter(function (t) { return t.estado === 'Rechazada'; }).length,
            abiertos: g.filter(function (t) { return t.fSol == null; }).length,
            ttrMed: cuantil(res.map(function (t) { return t.ttr; }), 0.5),
            ttrP90: cuantil(res.map(function (t) { return t.ttr; }), 0.9),
            cumple: ev.length ? 1 - venc / ev.length : null, evaluables: ev.length,
            metaMed: cuantil(ev.map(function (t) { return t.metaH; }), 0.5),
            retrasoMed: cuantil(g.filter(function (t) { return t.vencido && t.resuelto; }).map(function (t) { return t.retraso; }), 0.5),
            reabiertos: g.length ? g.filter(function (t) { return t.reabierto; }).length / g.length : null
        };
    }
    var COLS_ATENCION = [
        { n: 'Tickets', t: 'int' }, { n: 'Resueltos', t: 'int' }, { n: 'Rechazados', t: 'int' }, { n: 'Sin firma de solución', t: 'int' },
        { n: 'TTR mediana (días)', t: 'num1' }, { n: 'TTR p90 (días)', t: 'num1' }, { n: 'Cumple SLA', t: 'pct' },
        { n: 'Meta mediana (h)', t: 'num1' }, { n: 'Retraso mediano de los vencidos (días)', t: 'num1' }, { n: 'Reabiertos', t: 'pct' }
    ];
    function filaAtencion(r) {
        return [r.tickets, r.resueltos, r.rechazados, r.abiertos, r.ttrMed, r.ttrP90, r.cumple, r.metaMed, r.retrasoMed, r.reabiertos];
    }

    function tabla(id, titulo, columnas, filas, nota) {
        return { id: id, titulo: titulo, columnas: columnas, filas: filas, nota: nota || '' };
    }
    function principal(lista, clave) {
        var p = porMayor(contar(lista, clave));
        return p.length ? { valor: p[0][0], n: p[0][1], pct: p[0][1] / lista.length, segundo: p[1] || null } : null;
    }
    function textoLibre(v) {
        if (v == null || v === '') return '(vacío)';
        return String(v).length > 60 ? '(texto libre)' : String(v);
    }

    // datos = preparar(...), servicio = {nombre, reglas, motivosEquipo, cedis}
    // servicio.cedis (opcional): { '5549': 'Salinas Victoria secos', ... }. Con el, la
    // hoja Sitios trae la tabla del CEDIS que menciona el texto.
    // opciones.conTextos: el Detalle lleva titulo, descripcion y solucion (la pestaña
    // del tablero, que es interna; la pagina de claude.ai no los lleva).
    function analizar(datos, servicio, opciones) {
        opciones = opciones || {};
        var corte = datos.corte, reglas = servicio.reglas || [];
        var todos = datos.tickets;
        todos.forEach(function (t) {
            var c = clasificar(t, reglas);
            t.motivo = c.motivo; t.regla = c.regla; t.frase = c.frase;
            t.resuelto = t.fSol != null && t.estado !== 'Rechazada';
            t.evaluable = t.fEst != null;
            t.vencido = t.evaluable && ((t.fSol != null && t.fSol > t.fEst) || (t.fSol == null && t.fEst < corte));
            t.ttr = t.fSol != null ? (t.fSol - t.fReg) / DIA : null;
            t.metaH = t.fEst != null ? (t.fEst - t.fReg) / 3600000 : null;
            t.retraso = t.fSol != null && t.fEst != null ? (t.fSol - t.fEst) / DIA : null;
            t.reabierto = t.intentos != null && t.intentos > 1;
            t.diasPrimerTrabajo = t.primerTrabajo != null ? (t.primerTrabajo - t.fReg) / DIA : null;
            t.gap = null; t.gapMotivo = null; t.gapEquipo = null;
        });
        var porRuta = todos.filter(function (t) { return t.origen === 'Categoria'; });
        var soloGrupo = todos.filter(function (t) { return t.origen !== 'Categoria'; });
        var U = porRuta.length ? porRuta : todos;
        var nU = U.length;
        var arboles = porMayor(contar(U, function (t) { return t.arbol; })).map(function (x) { return x[0]; });
        var motivosOrden = reglas.map(function (r) { return r.motivo; }).filter(function (m, i, a) { return a.indexOf(m) === i; });
        motivosOrden.push(SIN_CLASIFICAR);
        var cuentaMotivo = contar(U, function (t) { return t.motivo; });
        var motivos = motivosOrden.filter(function (m) { return cuentaMotivo.get(m); })
            .sort(function (a, b) { return (a === SIN_CLASIFICAR) - (b === SIN_CLASIFICAR) || cuentaMotivo.get(b) - cuentaMotivo.get(a); });

        /* -------- periodo y serie diaria (dias completos) */
        var p = datos.parametros;
        var ini = diaDe(p.desde ? (fecha(p.desde) || U[0].fReg) : U[0].fReg);
        var finEx = diaDe(corte);                                  // el dia del corte no esta completo
        if (p.hasta && fecha(p.hasta)) finEx = Math.min(finEx, diaDe(fecha(p.hasta)));
        if (finEx <= ini) finEx = diaDe(U[U.length - 1].fReg) + DIA;
        var diario = new Map();
        for (var d = ini; d < finEx; d += DIA) diario.set(d, []);
        U.forEach(function (t) { var k = diaDe(t.fReg); if (diario.has(k)) diario.get(k).push(t); });
        var serie = Array.from(diario.entries()).map(function (e) { return { dia: e[0], n: e[1].length, lista: e[1] }; });
        var nDias = serie.length;
        var mediaDow = function (s) {
            var m = [0, 0, 0, 0, 0, 0, 0], c = [0, 0, 0, 0, 0, 0, 0];
            s.forEach(function (x) { var w = dow(x.dia); m[w] += x.n; c[w]++; });
            return m.map(function (v, i) { return c[i] ? v / c[i] : null; });
        };
        var dsem = mediaDow(serie);
        // pico: un dia con al menos 2.5 veces el promedio de su dia de la semana y 10 tickets de mas
        var picos = serie.filter(function (x) { var b = dsem[dow(x.dia)]; return b && x.n >= 2.5 * b && x.n - b >= 10; });
        var esPico = new Set(picos.map(function (x) { return x.dia; }));
        var serieSin = serie.filter(function (x) { return !esPico.has(x.dia); });
        var dsemSin = mediaDow(serieSin);
        var relPago = function (dia) {
            var f = new Date(dia), y = f.getUTCFullYear(), m = f.getUTCMonth();
            var pagos = [Date.UTC(y, m, 15), Date.UTC(y, m + 1, 0), Date.UTC(y, m, 0)];
            var mejor = null;
            pagos.forEach(function (pp) { var k = Math.round((dia - pp) / DIA); if (mejor == null || Math.abs(k) < Math.abs(mejor)) mejor = k; });
            return mejor;
        };
        var quin = new Map();
        serieSin.forEach(function (x) {
            var k = relPago(x.dia), b = dsemSin[dow(x.dia)];
            if (k < -7 || k > 7 || !b) return;
            if (!quin.has(k)) quin.set(k, []);
            quin.get(k).push(x.n / b);
        });
        var antesPago = [], despuesPago = [];
        quin.forEach(function (v, k) { if (k >= -7 && k <= -1) antesPago = antesPago.concat(v); if (k >= 0 && k <= 6) despuesPago = despuesPago.concat(v); });

        /* -------- sitios y reincidencia */
        var conSitio = U.filter(function (t) { return t.sitio; });
        var porSitio = agrupar(conSitio, function (t) { return t.sitio; });
        var ultimo = new Map(), ultimoMotivo = new Map();
        conSitio.forEach(function (t) {
            var a = ultimo.get(t.sitio), km = t.sitio + '\u0001' + t.motivo, b = ultimoMotivo.get(km);
            t.gap = a != null ? (t.fReg - a) / DIA : null;
            t.gapMotivo = b != null ? (t.fReg - b) / DIA : null;
            ultimo.set(t.sitio, t.fReg); ultimoMotivo.set(km, t.fReg);
        });
        var nombreSitio = new Map();
        porSitio.forEach(function (l, k) { nombreSitio.set(k, principal(l, function (t) { return t.tienda || ''; }).valor); });
        var cuentas = Array.from(porSitio.values()).map(function (l) { return l.length; }).sort(function (a, b) { return b - a; });
        var totalSitios = cuentas.reduce(function (a, b) { return a + b; }, 0);
        var conc = [0.05, 0.10, 0.20].map(function (q) {
            var n = Math.ceil(q * cuentas.length), s = 0;
            for (var i = 0; i < n; i++) s += cuentas[i];
            return { q: q, sitios: n, pct: frac(s, totalSitios) };
        });
        var cuentasAsc = cuentas.slice().sort(function (a, b) { return a - b; });
        var equipo = (servicio.motivosEquipo || []).filter(function (m) { return cuentaMotivo.get(m); });
        var setEquipo = new Set(equipo);
        var eq = conSitio.filter(function (t) { return setEquipo.has(t.motivo); });
        var ultimoEq = new Map();
        eq.forEach(function (t) { var a = ultimoEq.get(t.sitio); t.gapEquipo = a != null ? (t.fReg - a) / DIA : null; ultimoEq.set(t.sitio, t.fReg); });

        /* -------- grupos */
        var grupos = porMayor(contar(U, function (t) { return t.grupo; }));
        var gruposTop = grupos.slice(0, 8).map(function (g) { return g[0]; });
        var gruposMes = grupos.filter(function (g, i) { return i < 3 && g[1] >= 0.05 * nU; }).map(function (g) { return g[0]; });
        var gPrincipal = grupos.length ? grupos[0][0] : null;

        var H = {};
        var meses = Array.from(new Set(U.map(function (t) { return mesDe(t.fReg); }))).sort();

        /* ================================================== Temporal */
        var porMes = agrupar(U, function (t) { return mesDe(t.fReg); });
        var diasMes = contar(serie, function (x) { return mesDe(x.dia); });
        var colsMes = [{ n: 'Mes', t: 'txt' }, { n: 'Tickets', t: 'int' }, { n: 'Días completos', t: 'int' },
                       { n: 'Promedio por día', t: 'num1' }, { n: 'Sitios', t: 'int' }];
        if (arboles.length > 1) arboles.forEach(function (a) { colsMes.push({ n: a, t: 'int' }); });
        var filasMes = meses.map(function (m) {
            var l = porMes.get(m), nd = diasMes.get(m) || 0;
            var enDias = l.filter(function (t) { var k = diaDe(t.fReg); return k >= ini && k < finEx; }).length;
            var f = [m, l.length, nd, nd ? enDias / nd : null, new Set(l.filter(function (t) { return t.sitio; }).map(function (t) { return t.sitio; })).size];
            if (arboles.length > 1) arboles.forEach(function (a) { f.push(l.filter(function (t) { return t.arbol === a; }).length); });
            return f;
        });
        var cuentaDow = contar(U, function (t) { return dow(t.fReg); });
        var cuentaHora = contar(U, function (t) { return new Date(t.fReg).getUTCHours(); });
        var dmes = new Map();
        serie.forEach(function (x) { var k = new Date(x.dia).getUTCDate(); if (!dmes.has(k)) dmes.set(k, []); dmes.get(k).push(x.n); });
        var mediaDia = media(serie.map(function (x) { return x.n; }));
        var maxDia = serie.reduce(function (m, x) { return !m || x.n > m.n ? x : m; }, null);

        H.Temporal = [
            tabla('mes', 'Por mes', colsMes, filasMes,
                  'Promedio por día: tickets de los días completos del mes entre los días completos (el día del corte no cuenta).' +
                  (arboles.length > 1 ? ' Las últimas columnas separan por árbol de categoría (primer tramo de la ruta).' : '')),
            tabla('dow', 'Por día de la semana', [{ n: 'Día', t: 'txt' }, { n: 'Promedio por día', t: 'num1' }, { n: 'Tickets', t: 'int' }, { n: '% de los tickets', t: 'pct' }],
                  DIAS_LARGO.map(function (n, i) { return [n, dsem[i], cuentaDow.get(i) || 0, frac(cuentaDow.get(i) || 0, nU)]; })),
            tabla('hora', 'Por hora de registro', [{ n: 'Hora', t: 'txt' }, { n: 'Tickets', t: 'int' }, { n: '% de los tickets', t: 'pct' }],
                  Array.from({ length: 24 }, function (_, h) { return [dos(h) + ':00', cuentaHora.get(h) || 0, frac(cuentaHora.get(h) || 0, nU)]; })),
            tabla('diames', 'Por día del mes', [{ n: 'Día', t: 'int' }, { n: 'Promedio por día', t: 'num1' }, { n: 'Meses con ese día', t: 'int' }],
                  Array.from(dmes.keys()).sort(function (a, b) { return a - b; }).map(function (k) { return [k, media(dmes.get(k)), dmes.get(k).length]; })),
            tabla('quincena', 'Alrededor del pago (quincena)', [{ n: 'Días respecto al pago', t: 'int' }, { n: 'Índice', t: 'num2' }, { n: 'Días medidos', t: 'int' }],
                  Array.from({ length: 15 }, function (_, i) { var k = i - 7, v = quin.get(k) || []; return [k, media(v), v.length]; })
                      .concat([['Semana antes (-7 a -1)', media(antesPago), antesPago.length], ['Pago y semana después (0 a +6)', media(despuesPago), despuesPago.length]]),
                  'Día 0 = día 15 o último día del mes (fechas nominales: si el pago se recorre por fin de semana, no se ajusta). ' +
                  'Índice = tickets del día entre el promedio de su día de la semana; 1.00 es un día normal. Sin los días pico.'),
            tabla('picos', 'Días pico', [{ n: 'Fecha', t: 'txt' }, { n: 'Día', t: 'txt' }, { n: 'Tickets', t: 'int' }, { n: 'Promedio de su día de la semana', t: 'num1' },
                                         { n: 'Veces el promedio', t: 'num1' }, { n: 'Sitios', t: 'int' }, { n: 'Motivo principal', t: 'txt' }, { n: '% del motivo', t: 'pct' }],
                  picos.sort(function (a, b) { return b.n - a.n; }).map(function (x) {
                      var b = dsem[dow(x.dia)], pm = principal(x.lista, function (t) { return t.motivo; });
                      return [textoDia(x.dia), DIAS_LARGO[dow(x.dia)], x.n, b, x.n / b,
                              new Set(x.lista.filter(function (t) { return t.sitio; }).map(function (t) { return t.sitio; })).size, pm.valor, pm.pct];
                  }), 'Pico: al menos 2.5 veces el promedio de su día de la semana y 10 tickets más que ese promedio.')
        ];

        /* ================================================== Sitios */
        var cuentaTipo = porMayor(contar(U, function (t) { return t.tipoSitio; }));
        var topSitios = Array.from(porSitio.entries()).sort(function (a, b) { return b[1].length - a[1].length || (a[0] < b[0] ? -1 : 1); }).slice(0, 20);
        var reinc = [7, 15, 30].map(function (n) {
            var a = conSitio.filter(function (t) { return t.gap != null && t.gap <= n; });
            var b = conSitio.filter(function (t) { return t.gapMotivo != null && t.gapMotivo <= n; });
            return [n + ' días', frac(a.length, conSitio.length), new Set(a.map(function (t) { return t.sitio; })).size, frac(b.length, conSitio.length)];
        });
        H.Sitios = [
            tabla('tipo', 'Quién reporta', [{ n: 'Tipo de sitio', t: 'txt' }, { n: 'Tickets', t: 'int' }, { n: '%', t: 'pct' }],
                  cuentaTipo.map(function (x) { return [x[0], x[1], x[1] / nU]; }),
                  'Sale de "Notificado por". Persona u otro y Cuenta no identifican un sitio: no entran en las tablas de abajo.'),
            tabla('conc', 'Concentración', [{ n: 'Los sitios con más tickets', t: 'txt' }, { n: 'Sitios', t: 'int' }, { n: '% de los tickets con sitio', t: 'pct' }],
                  conc.map(function (c) { return ['El ' + Math.round(100 * c.q) + '%', c.sitios, c.pct]; })
                      .concat([['Todos', cuentas.length, totalSitios ? 1 : null]]),
                  'Tickets por sitio: mediana ' + numTxt(cuantil(cuentasAsc, 0.5, true), 0) + ', p90 ' + numTxt(cuantil(cuentasAsc, 0.9, true), 0) +
                  ', máximo ' + (cuentas[0] || 0) + '.'),
            tabla('top', 'Sitios con más tickets', [{ n: 'Sitio', t: 'txt' }, { n: 'Nombre', t: 'txt' }, { n: 'Tickets', t: 'int' }, { n: 'Motivo principal', t: 'txt' },
                                                    { n: '% del motivo', t: 'pct' }, { n: 'Con otro en los 30 días anteriores', t: 'int' },
                                                    { n: 'Primer ticket', t: 'txt' }, { n: 'Último ticket', t: 'txt' }],
                  topSitios.map(function (e) {
                      var l = e[1], pm = principal(l, function (t) { return t.motivo; });
                      return [e[0], nombreSitio.get(e[0]), l.length, pm.valor, pm.pct, l.filter(function (t) { return t.gap != null && t.gap <= 30; }).length,
                              textoDia(l[0].fReg), textoDia(l[l.length - 1].fReg)];
                  }), 'Sitio: T = tienda, CC = City Club, CEDIS, CAD, con su número.'),
            tabla('reinc', 'Reincidencia', [{ n: 'Ventana', t: 'txt' }, { n: 'Tickets con otro del mismo sitio antes', t: 'pct' }, { n: 'Sitios', t: 'int' },
                                            { n: 'Con el mismo motivo', t: 'pct' }], reinc,
                  'Un ticket es reincidente si el mismo sitio abrió otro en los N días anteriores. Porcentaje sobre los ' + miles(conSitio.length) + ' tickets con sitio.')
        ];
        if (equipo.length) {
            var porSitioEq = agrupar(eq, function (t) { return t.sitio; });
            var cand = Array.from(porSitioEq.entries()).map(function (e) {
                var l = e[1];
                return [e[0], nombreSitio.get(e[0]), l.length, l.filter(function (t) { return t.gapEquipo != null && t.gapEquipo <= 30; }).length]
                    .concat(equipo.map(function (m) { return l.filter(function (t) { return t.motivo === m; }).length; }));
            }).sort(function (a, b) { return b[2] - a[2] || b[3] - a[3] || (a[0] < b[0] ? -1 : 1); }).slice(0, 15);
            H.Sitios.push(tabla('equipo', 'Candidatos a revisión de equipo',
                [{ n: 'Sitio', t: 'txt' }, { n: 'Nombre', t: 'txt' }, { n: 'Tickets de equipo', t: 'int' }, { n: 'Repetidos en 30 días', t: 'int' }]
                    .concat(equipo.map(function (m) { return { n: m, t: 'int' }; })), cand,
                'Motivos de equipo: ' + equipo.join(', ') + '. ' + miles(eq.length) + ' tickets; ' +
                pctTxt(frac(eq.filter(function (t) { return t.gapEquipo != null && t.gapEquipo <= 30; }).length, eq.length)) +
                ' tienen otro de equipo del mismo sitio en los 30 días anteriores.'));
        }
        // El CEDIS que menciona el texto: en Logistica el campo de la tienda trae a la
        // persona, y en Gestion de Inventarios el sitio es la tienda que recibe; el texto
        // dice "determinante 5549" o "cedis 5548 tultitlan". Solo con servicio.cedis.
        var mapaCedis = servicio.cedis || null;
        if (mapaCedis && Object.keys(mapaCedis).length) {
            var conCedis = U.filter(function (t) {
                var x = normalizar(t.titulo + ' ' + t.descripcion), re = /\b(\d{4})\b/g, m;
                t.cedis = null;
                while ((m = re.exec(x))) { if (mapaCedis[m[1]]) { t.cedis = m[1]; break; } }
                return t.cedis != null;
            });
            var porCedis = Array.from(agrupar(conCedis, function (t) { return t.cedis; }).entries())
                .sort(function (a, b) { return b[1].length - a[1].length || (a[0] < b[0] ? -1 : 1); });
            H.Sitios.push(tabla('cedis', 'CEDIS que menciona el texto',
                [{ n: 'CEDIS', t: 'txt' }, { n: 'Nombre', t: 'txt' }, { n: 'Tickets', t: 'int' }, { n: '% de los que dicen su CEDIS', t: 'pct' },
                 { n: 'Motivo principal', t: 'txt' }, { n: '% del motivo', t: 'pct' }, { n: 'Segundo motivo', t: 'txt' },
                 { n: 'TTR mediana (días)', t: 'num1' }, { n: 'Cumple SLA', t: 'pct' }],
                porCedis.map(function (e) {
                    var l = e[1], pm = principal(l, function (t) { return t.motivo; }), r = resumenAtencion(l, corte);
                    return [e[0], mapaCedis[e[0]], l.length, frac(l.length, conCedis.length), pm.valor, pm.pct,
                            pm.segundo ? pm.segundo[0] : '', r.ttrMed, r.cumple];
                }),
                'Sale del título o la descripción: el primer número que esté en la lista de CEDIS del servicio (' +
                Object.keys(mapaCedis).length + '). ' + miles(conCedis.length) + ' de ' + miles(nU) + ' tickets (' +
                pctTxt(frac(conCedis.length, nU)) + ') lo dicen; los demás no dicen de qué CEDIS son.'));
        }

        /* ================================================== Motivos */
        var porMotivo = agrupar(U, function (t) { return t.motivo; });
        var filasMot = motivos.map(function (m) {
            var l = porMotivo.get(m), r = resumenAtencion(l, corte), cs = l.filter(function (t) { return t.sitio; });
            var pr = principal(l, function (t) { return t.regla; });
            return [m, l.length, l.length / nU, new Set(cs.map(function (t) { return t.sitio; })).size,
                    frac(cs.filter(function (t) { return t.gapMotivo != null && t.gapMotivo <= 30; }).length, cs.length),
                    r.ttrMed, r.cumple, r.reabiertos, pr.valor];
        });
        var crossMes = motivos.map(function (m) {
            var l = porMotivo.get(m), c = contar(l, function (t) { return mesDe(t.fReg); });
            return [m].concat(meses.map(function (x) { return c.get(x) || 0; })).concat([l.length]);
        });
        crossMes.push(['Total'].concat(meses.map(function (x) { return porMes.get(x).length; })).concat([nU]));
        H.Motivos = [
            tabla('motivo', 'Por motivo', [{ n: 'Motivo', t: 'txt' }, { n: 'Tickets', t: 'int' }, { n: '%', t: 'pct' }, { n: 'Sitios', t: 'int' },
                                           { n: 'Mismo sitio y motivo en 30 días', t: 'pct' }, { n: 'TTR mediana (días)', t: 'num1' },
                                           { n: 'Cumple SLA', t: 'pct' }, { n: 'Reabiertos', t: 'pct' }, { n: 'Regla que más clasificó', t: 'txt' }], filasMot,
                  'El motivo se lee del texto con las reglas de la hoja Reglas: gana la primera que cumple.'),
            tabla('motmes', 'Por mes de registro', [{ n: 'Motivo', t: 'txt' }].concat(meses.map(function (m) { return { n: m, t: 'int' }; })).concat([{ n: 'Total', t: 'int' }]), crossMes)
        ];
        if (arboles.length > 1) {
            var porArbol = agrupar(U, function (t) { return t.arbol; });
            // El total de cada arbol va en su encabezado y no en un renglon: un
            // renglon de conteos en columnas de porcentaje salia como 909800.0%.
            H.Motivos.push(tabla('motarbol', 'Por árbol de categoría (% de cada árbol)', [{ n: 'Motivo', t: 'txt' }].concat(arboles.map(function (a) {
                    return { n: a + ' (' + miles(porArbol.get(a).length) + ' tickets)', t: 'pct' };
                })),
                motivos.map(function (m) {
                    return [m].concat(arboles.map(function (a) { var l = porArbol.get(a); return frac(l.filter(function (t) { return t.motivo === m; }).length, l.length); }));
                }),
                'Cada columna suma 100%. Entre paréntesis, los tickets de ese árbol (primer tramo de la ruta).'));
        }
        var porDow = agrupar(U, function (t) { return dow(t.fReg); });
        H.Motivos.push(tabla('motdow', 'Por día de la semana (% de cada día)', [{ n: 'Motivo', t: 'txt' }].concat(DIAS.map(function (d) { return { n: d, t: 'pct' }; })),
            motivos.map(function (m) {
                return [m].concat(DIAS.map(function (_, i) { var l = porDow.get(i) || []; return frac(l.filter(function (t) { return t.motivo === m; }).length, l.length); }));
            })));
        var porCat = Array.from(agrupar(U, function (t) { return t.categoria; }).entries()).sort(function (a, b) { return b[1].length - a[1].length; }).slice(0, 20);
        H.Motivos.push(tabla('motcat', 'Contra la categoría que se capturó', [{ n: 'Categoría capturada', t: 'txt' }, { n: 'Tickets', t: 'int' }, { n: 'Motivo principal', t: 'txt' },
                                                                               { n: '% del motivo', t: 'pct' }, { n: 'Segundo motivo', t: 'txt' }, { n: '% del segundo', t: 'pct' }],
            porCat.map(function (e) {
                var l = e[1], pm = principal(l, function (t) { return t.motivo; }), s = pm.segundo;
                return [e[0], l.length, pm.valor, pm.pct, s ? s[0] : '', s ? s[1] / l.length : null];
            }), 'Las 20 categorías con más tickets. Si el motivo principal no se parece a la categoría, la categoría no está diciendo qué pasó.'));
        var filasQa = [];
        [['QA_Frecuencia', '¿Es la primera vez? (formulario)'], ['QARe_AplicaOtrosCasos', 'Aplica a otros casos (QA de resolución)'],
         ['QARe_TipoSolucion', 'Tipo de solución (QA de resolución)'], ['QARe_UsuarioConfirmo', 'El usuario confirmó (QA de resolución)']].forEach(function (c) {
            var cu = porMayor(contar(U, function (t) { return textoLibre(t.qa[c[0]]); }));
            if (cu.length === 1 && cu[0][0] === '(vacío)') return;
            cu.slice(0, 8).forEach(function (x) { filasQa.push([c[1], x[0], x[1], x[1] / nU]); });
        });
        if (filasQa.length) H.Motivos.push(tabla('qa', 'Respuestas del formulario y de QA', [{ n: 'Pregunta', t: 'txt' }, { n: 'Respuesta', t: 'txt' }, { n: 'Tickets', t: 'int' }, { n: '%', t: 'pct' }],
            filasQa, 'Las 8 respuestas más comunes de cada pregunta.'));

        /* ================================================== Atencion */
        var porGrupo = agrupar(U, function (t) { return t.grupo; });
        var otros = U.filter(function (t) { return gruposTop.indexOf(t.grupo) < 0; });
        var filasG = gruposTop.map(function (g) { return [g].concat(filaAtencion(resumenAtencion(porGrupo.get(g), corte))); });
        if (otros.length) filasG.push(['Otros grupos'].concat(filaAtencion(resumenAtencion(otros, corte))));
        filasG.push(['Total'].concat(filaAtencion(resumenAtencion(U, corte))));
        var filasGM = [];
        gruposMes.forEach(function (g) {
            var pm = agrupar(porGrupo.get(g), function (t) { return mesDe(t.fReg); });
            Array.from(pm.keys()).sort().forEach(function (m) { filasGM.push([g, m].concat(filaAtencion(resumenAtencion(pm.get(m), corte)))); });
        });
        var cortesTtr = [0, 1, 2, 3, 5, 7, 10, 14, 21, 30, Infinity];
        var nombresTtr = cortesTtr.slice(1).map(function (c, i) { return c === Infinity ? 'más de 30' : cortesTtr[i] + ' a ' + c; });
        var filasFirma = [], filasMov = [];
        gruposMes.concat(gruposMes.length ? [] : gruposTop.slice(0, 1)).forEach(function (g) {
            var res = porGrupo.get(g).filter(function (t) { return t.resuelto; });
            if (!res.length) return;
            var lote = contar(res.filter(function (t) { return t.firmo; }), function (t) { return t.firmo + '\u0001' + Math.floor(t.fSol / 60000); });
            var enLote = 0;
            res.forEach(function (t) { if (t.firmo && lote.get(t.firmo + '\u0001' + Math.floor(t.fSol / 60000)) >= 10) enLote++; });
            var porDiaFirma = Array.from(contar(res, function (t) { return diaDe(t.fSol); }).values()).sort(function (a, b) { return a - b; });
            var dowF = contar(res, function (t) { return dow(t.fSol); });
            filasFirma.push([g, res.length, enLote / res.length, cuantil(porDiaFirma, 0.5, true), cuantil(porDiaFirma, 0.9, true), porDiaFirma[porDiaFirma.length - 1]]
                .concat(DIAS.map(function (_, i) { return (dowF.get(i) || 0) / res.length; })));
            if (datos.conHistorial) {
                var conHist = res.filter(function (t) { return t.conHistorial; });
                var conMov = conHist.filter(function (t) { return t.primerTrabajo != null; });
                filasMov.push([g, res.length, frac(conHist.length, res.length), frac(conMov.length, conHist.length),
                               cuantil(conMov.map(function (t) { return t.diasPrimerTrabajo; }), 0.5),
                               cuantil(conMov.map(function (t) { return (t.fSol - t.primerTrabajo) / DIA; }), 0.5),
                               cuantil(conMov.map(function (t) { return t.ttr; }), 0.5)]);
            }
        });
        var cola = [];
        for (var cd = diaDe(ini); cd <= finEx; cd += DIA) {
            var dd = new Date(cd).getUTCDate();
            if (dd !== 1 && dd !== 15) continue;
            cola.push([textoDia(cd), U.filter(function (t) { var fin = t.fSol != null ? t.fSol : t.fCierre; return t.fReg < cd && (fin == null || fin >= cd); }).length]);
        }
        H.Atencion = [
            tabla('grupo', 'Por grupo que atiende', [{ n: 'Grupo', t: 'txt' }].concat(COLS_ATENCION), filasG,
                  'Grupo = el que tiene el ticket ahora. Resuelto = con firma de solución y no Rechazada. Cumple SLA: de los que tienen fecha estimada, ' +
                  'los que se firmaron a tiempo (o siguen abiertos y no vencen al corte ' + textoFecha(corte) + ').'),
            tabla('grupomes', 'Por grupo y mes de registro', [{ n: 'Grupo', t: 'txt' }, { n: 'Mes', t: 'txt' }].concat(COLS_ATENCION), filasGM,
                  'Los grupos con al menos el 5% de los tickets (hasta tres).'),
            tabla('meta', 'Meta del SLA (horas entre el registro y la fecha estimada)', [{ n: 'Grupo', t: 'txt' }, { n: 'Tickets con meta', t: 'int' },
                  { n: 'p10', t: 'num1' }, { n: 'p25', t: 'num1' }, { n: 'Mediana', t: 'num1' }, { n: 'p75', t: 'num1' }, { n: 'p90', t: 'num1' }],
                  gruposTop.slice(0, 4).map(function (g) {
                      var v = ordenados(porGrupo.get(g).map(function (t) { return t.metaH; }));
                      return [g, v.length, cuantil(v, 0.1, true), cuantil(v, 0.25, true), cuantil(v, 0.5, true), cuantil(v, 0.75, true), cuantil(v, 0.9, true)];
                  })),
            tabla('ttr', 'Tiempo de resolución (días, tickets resueltos)', [{ n: 'Grupo', t: 'txt' }].concat(nombresTtr.map(function (n) { return { n: n, t: 'int' }; })),
                  gruposTop.slice(0, 4).map(function (g) {
                      var v = porGrupo.get(g).filter(function (t) { return t.resuelto; }).map(function (t) { return t.ttr; });
                      return [g].concat(cortesTtr.slice(1).map(function (c, i) {
                          return v.filter(function (x) { return (i === 0 ? x >= 0 : x > cortesTtr[i]) && x <= c; }).length;
                      }));
                  }), 'Cada columna incluye su límite de arriba: "1 a 2" es más de 1 día y hasta 2.'),
            tabla('firma', 'Cuándo se firma la solución', [{ n: 'Grupo', t: 'txt' }, { n: 'Soluciones', t: 'int' }, { n: 'En lotes de 10 o más', t: 'pct' },
                  { n: 'Firmas por día (mediana)', t: 'num1' }, { n: 'Firmas por día (p90)', t: 'num1' }, { n: 'Máximo en un día', t: 'int' }]
                      .concat(DIAS.map(function (d) { return { n: d, t: 'pct' }; })), filasFirma,
                  'Lote = soluciones firmadas por la misma persona en el mismo minuto. Mucho en lote quiere decir que la firma se hace después, en bloque, ' +
                  'y el SLA se mide contra esa firma.')
        ];
        if (filasMov.length) H.Atencion.push(tabla('mov', 'Primer movimiento contra la firma', [{ n: 'Grupo', t: 'txt' }, { n: 'Resueltos', t: 'int' },
            { n: 'Con historial desde el registro', t: 'pct' }, { n: 'De esos, con movimiento antes de la firma', t: 'pct' },
            { n: 'Registro a primer movimiento (días, mediana)', t: 'num1' }, { n: 'Primer movimiento a firma (días, mediana)', t: 'num1' },
            { n: 'TTR mediana de esos (días)', t: 'num1' }], filasMov,
            'Primer movimiento: la primera versión del historial con subestado "En Proceso" o con técnico asignado, antes de la firma. ' +
            'Solo cuentan los tickets que el historial vio a más tardar 4 días después del registro. El ETL ve los cambios de ' +
            '~08:40 a ~19:00 entre semana: sirve para días, no para horas.'));
        H.Atencion.push(tabla('cola', 'Tickets abiertos (día 1 y 15 de cada mes)', [{ n: 'Fecha', t: 'txt' }, { n: 'Abiertos', t: 'int' }], cola,
            'Registrados antes de esa fecha y todavía sin firma de solución ni de cierre.'));

        /* ================================================== Reglas */
        var porRegla = agrupar(U, function (t) { return t.regla; });
        var filasR = reglas.map(function (r, i) {
            var l = porRegla.get(r.id) || [], pf = l.length ? principal(l, function (t) { return t.frase; }) : null;
            return [i + 1, r.id, r.motivo, CAMPOS[r.campo], r.frases.map(function (f) { return /^ | $/.test(f) ? '"' + f + '"' : f; }).join('; '),
                    l.length, l.length / nU, pf ? pf.valor.trim() : '', pf ? pf.n : 0, l.slice(0, 5).map(function (t) { return t.codigo; }).join(', ')];
        });
        var sc = porRegla.get('R99') || [];
        filasR.push([reglas.length + 1, 'R99', SIN_CLASIFICAR, 'ninguna regla cumplió', '', sc.length, sc.length / nU, '', 0,
                     sc.slice(0, 5).map(function (t) { return t.codigo; }).join(', ')]);
        H.Reglas = [
            tabla('reglas', 'Reglas de motivo, en orden', [{ n: 'Orden', t: 'int' }, { n: 'Regla', t: 'txt' }, { n: 'Motivo', t: 'txt' }, { n: 'Dónde busca', t: 'txt' },
                  { n: 'Frases', t: 'txt' }, { n: 'Tickets', t: 'int' }, { n: '%', t: 'pct' }, { n: 'Frase que más pegó', t: 'txt' }, { n: 'Veces', t: 'int' },
                  { n: 'Folios de ejemplo', t: 'txt' }], filasR,
                  'Gana la primera regla que cumple, así que el orden es la prioridad. Una frase cumple si aparece tal cual en el texto ya normalizado.'),
            tabla('normal', 'Cómo se lee el texto', [{ n: 'Paso', t: 'txt' }], [
                ['Título y descripción se juntan; la solución va aparte.'],
                ['Minúsculas, sin acentos y sin caracteres invisibles.'],
                ['Todo lo que no es letra, número o dos puntos se vuelve espacio; los espacios se juntan en uno.'],
                ['Se agrega un espacio al principio y al final, para que " pin " encuentre la palabra sola y no "pintura".'],
                [datos.textosCompletos ? 'Los textos llegaron completos (bloque 6).' : 'Los textos llegaron cortados a 256 caracteres (salida sin bloque 6).']
            ]),
            tabla('calidad', 'Calidad de la lectura', [{ n: 'Concepto', t: 'txt' }, { n: 'Valor', t: 'txt' }], [
                ['Formato de la salida', datos.version],
                ['Filas del bloque 4', miles(datos.calidad.filasTickets)],
                ['Repetidos por año y consecutivo (se quedó el más reciente)', miles(datos.calidad.duplicados)],
                ['Filas que no cuadraron con su encabezado', miles(datos.calidad.descartadas)],
                ['Tickets sin fecha de registro', miles(datos.calidad.sinFecha)],
                ['Corte (hora de México)', textoFecha(corte) + (datos.corteEstimado ? ' (estimado)' : '')]
            ])
        ];

        /* ================================================== Resumen */
        var cumpleU = resumenAtencion(U, corte), mot1 = filasMot[0], scN = (porMotivo.get(SIN_CLASIFICAR) || []).length;
        var rG = gPrincipal ? resumenAtencion(porGrupo.get(gPrincipal), corte) : null;
        var conc10 = conc[1];
        var r30 = reinc[2];
        var lote = filasFirma.length ? filasFirma[0] : null, mov = filasMov.length ? filasMov[0] : null;
        var hallazgos = [];
        hallazgos.push(miles(nU) + ' tickets del servicio entre ' + textoDia(U[0].fReg) + ' y ' + textoDia(U[nU - 1].fReg) +
                       (soloGrupo.length && porRuta.length ? '; otros ' + miles(soloGrupo.length) + ' llegaron solo por el grupo y se ven aparte.' : '.') +
                       (p.excluidosBot || p.excluidosCuenta ? ' No cuentan ' + miles(p.excluidosBot || 0) + ' del bot (grupo SorIA) ni ' +
                        miles(p.excluidosCuenta || 0) + ' cerrados por cuentas que no son persona.' : ''));
        if (nDias) hallazgos.push('Promedio de ' + numTxt(mediaDia) + ' tickets por día completo; el día con más fue el ' + textoDia(maxDia.dia) +
                                  ' (' + DIAS_LARGO[dow(maxDia.dia)].toLowerCase() + ') con ' + maxDia.n + '.');
        var dmax = dsem.indexOf(Math.max.apply(null, dsem.filter(function (x) { return x != null; })));
        var dmin = dsem.indexOf(Math.min.apply(null, dsem.filter(function (x) { return x != null; })));
        if (dmax >= 0) hallazgos.push('El día de la semana con más tickets es el ' + DIAS_LARGO[dmax].toLowerCase() + ' (' + numTxt(dsem[dmax]) + ' por día) y el de menos el ' +
                                      DIAS_LARGO[dmin].toLowerCase() + ' (' + numTxt(dsem[dmin]) + ').');
        if (picos.length) hallazgos.push(picos.length + ' día(s) pico; el mayor, ' + textoDia(picos[0].dia) + ', con ' + picos[0].n + ' tickets de ' +
                                         new Set(picos[0].lista.filter(function (t) { return t.sitio; }).map(function (t) { return t.sitio; })).size + ' sitios.');
        if (antesPago.length && despuesPago.length) hallazgos.push('Alrededor del pago: la semana antes da un índice de ' + numTxt(media(antesPago), 2) +
                                                                   ' y el día de pago y la semana después ' + numTxt(media(despuesPago), 2) + ' (1.00 = un día normal para su día de la semana).');
        if (cuentas.length) hallazgos.push(miles(cuentas.length) + ' sitios con tickets; el 10% con más tickets (' + conc10.sitios + ') junta el ' + pctTxt(conc10.pct) + '.');
        if (conSitio.length) hallazgos.push('Reincidencia: ' + pctTxt(r30[1]) + ' de los tickets con sitio tienen otro del mismo sitio en los 30 días anteriores; ' +
                                            pctTxt(r30[3]) + ' con el mismo motivo.');
        if (mot1) hallazgos.push('Motivo principal: ' + mot1[0] + ' (' + pctTxt(mot1[2]) + '). Sin clasificar: ' + pctTxt(scN / nU) + '.');
        if (rG) hallazgos.push(gPrincipal + ' tiene ' + pctTxt(rG.tickets / nU) + ' de los tickets: cumple el SLA en ' + pctTxt(rG.cumple) + ', con meta mediana de ' +
                               numTxt(rG.metaMed) + ' h y TTR mediano de ' + numTxt(rG.ttrMed) + ' días.');
        if (lote) hallazgos.push(lote[0] + ': ' + pctTxt(lote[2]) + ' de las soluciones se firmaron en lotes de 10 o más, por la misma persona en el mismo minuto.');
        var movOk = filasMov.filter(function (f) { return f[4] != null && f[2] >= 0.5; });
        if (movOk.length) { mov = movOk[0]; hallazgos.push(mov[0] + ': del registro al primer movimiento pasan ' + numTxt(mov[4]) + ' días (mediana) y del primer movimiento a la firma ' +
                                                  numTxt(mov[5]) + ' días.'); } else mov = null;

        var filasRutas = (datos.rutas || []).map(function (r) { return [r.Origen, r.Categoria, numero(r.Tickets), frac(numero(r.Tickets), todos.length)]; });
        if (!datos.rutas) Array.from(agrupar(todos, function (t) { return t.origen + '\u0001' + t.categoria; }).entries())
            .sort(function (a, b) { return b[1].length - a[1].length; })
            .forEach(function (e) { var k = e[0].split('\u0001'); filasRutas.push([k[0], k[1], e[1].length, e[1].length / todos.length]); });
        H.Resumen = [
            tabla('ficha', 'Ficha', [{ n: 'Concepto', t: 'txt' }, { n: 'Valor', t: 'txt' }], [
                ['Servicio', servicio.nombre || p.servicio || ''],
                ['Corte (hora de México)', textoFecha(corte) + (datos.corteEstimado ? ' (estimado)' : '')],
                ['Periodo de registro', textoDia(U[0].fReg) + ' a ' + textoDia(U[nU - 1].fReg)],
                ['Días completos medidos', miles(nDias)],
                ['Tickets analizados (por la ruta)', miles(porRuta.length || nU)],
                ['Tickets que llegaron solo por el grupo', miles(soloGrupo.length)],
                ['Fuera: atendidos por el bot (grupo SorIA)', p.excluidosBot == null ? 'no se midió (salida anterior al 45 v2)' : miles(p.excluidosBot)],
                ['Fuera: cerrados por cuentas que no son persona', p.excluidosCuenta == null ? 'no se midió (salida anterior al 45 v2)' : miles(p.excluidosCuenta)],
                ['Rutas pedidas', p.rutas.join('; ') || '(de la salida del 44)'],
                ['Rutas que se quitaron', p.rutasFuera.join('; ')],
                ['Grupos pedidos', p.grupos.join('; ')],
                ['Formato de la salida', datos.version],
                ['Textos', datos.textosCompletos ? 'completos' : 'cortados a 256 caracteres']
            ]),
            tabla('kpi', 'Indicadores', [{ n: 'Indicador', t: 'txt' }, { n: 'Valor', t: 'txt' }, { n: 'Cómo se calcula', t: 'txt' }], [
                ['Tickets por día', numTxt(mediaDia), 'Promedio de los días completos del periodo'],
                ['Sitios con tickets', miles(cuentas.length), 'Tiendas, City Club, CEDIS y CAD distintos'],
                ['Concentración', pctTxt(conc10.pct), 'Parte de los tickets que junta el 10% de los sitios con más tickets'],
                ['Reincidencia a 30 días', pctTxt(r30[1]), 'Tickets con otro del mismo sitio en los 30 días anteriores'],
                ['Motivo principal', mot1 ? mot1[0] + ' (' + pctTxt(mot1[2]) + ')' : 's/d', 'Por las reglas de la hoja Reglas'],
                ['Sin clasificar', pctTxt(scN / nU), 'Tickets que ninguna regla reconoció'],
                ['Cumple SLA', pctTxt(cumpleU.cumple), 'De los tickets con fecha estimada de resolución'],
                ['TTR mediano', numTxt(cumpleU.ttrMed) + ' días', 'Del registro a la firma de solución, tickets resueltos'],
                ['Reabiertos', pctTxt(cumpleU.reabiertos), 'IntentosSolucion mayor que 1']
            ]),
            tabla('hallazgos', 'Hallazgos', [{ n: '#', t: 'int' }, { n: 'Hallazgo', t: 'txt' }], hallazgos.map(function (h, i) { return [i + 1, h]; }),
                  'Cada número sale de las tablas de las otras hojas.'),
            tabla('rutas', 'Rutas de categoría que entraron', [{ n: 'Origen', t: 'txt' }, { n: 'Ruta', t: 'txt' }, { n: 'Tickets', t: 'int' }, { n: '%', t: 'pct' }], filasRutas,
                  'Origen Categoria = entró por la ruta. Grupo = la ruta no es del servicio, pero lo tiene el grupo pedido: se ve aparte.')
        ];
        if (datos.grupos) H.Resumen.push(tabla('grupos', 'Grupos que los atienden', [{ n: 'Grupo', t: 'txt' }, { n: 'Tickets', t: 'int' }, { n: 'Por la ruta', t: 'int' }, { n: 'Solo por el grupo', t: 'int' }],
            datos.grupos.map(function (g) { return [g.Grupo, numero(g.Tickets), numero(g.PorRuta), numero(g.SoloPorGrupo)]; })));
        if (datos.fuera && datos.fuera.length) H.Resumen.push(tabla('fuera', 'Fuera de la ruta (el título habla del servicio)', [{ n: 'Rama', t: 'txt' }, { n: 'Grupo', t: 'txt' }, { n: 'Tickets', t: 'int' }],
            datos.fuera.map(function (f) { return [f.RamaC1, f.Grupo, numero(f.Tickets)]; }), 'No están en el análisis: dicen si hay volumen capturado en otra rama.'));
        if (soloGrupo.length && porRuta.length) {
            H.Resumen.push(tabla('sologrupo', 'Lo que llegó solo por el grupo', [{ n: 'Ruta', t: 'txt' }, { n: 'Tickets', t: 'int' }, { n: 'Motivo principal', t: 'txt' }],
                Array.from(agrupar(soloGrupo, function (t) { return t.categoria; }).entries()).sort(function (a, b) { return b[1].length - a[1].length; }).slice(0, 15)
                    .map(function (e) { return [e[0], e[1].length, principal(e[1], function (t) { return t.motivo; }).valor]; }),
                'No entra en las otras hojas.'));
        }

        /* ================================================== Detalle (sin textos ni nombres, salvo conTextos) */
        var columnasDet = [
            { n: 'CodigoTicket', t: 'txt' }, { n: 'Origen', t: 'txt' }, { n: 'Tipo', t: 'txt' }, { n: 'Categoria', t: 'txt' }, { n: 'Arbol', t: 'txt' },
            { n: 'Estado', t: 'txt' }, { n: 'Subestado', t: 'txt' }, { n: 'Prioridad', t: 'txt' }, { n: 'SLA', t: 'txt' }, { n: 'TipoRelacion', t: 'txt' },
            { n: 'Grupo', t: 'txt' }, { n: 'TipoSitio', t: 'txt' }, { n: 'Sitio', t: 'txt' }, { n: 'NombreSitio', t: 'txt' },
            { n: 'FechaRegistro', t: 'fecha' }, { n: 'FechaEstimadaResolucion', t: 'fecha' }, { n: 'FechaFirmaSolucion', t: 'fecha' }, { n: 'FechaFirmaCierre', t: 'fecha' },
            { n: 'Mes', t: 'txt' }, { n: 'DiaSemana', t: 'txt' }, { n: 'Hora', t: 'int' },
            { n: 'Motivo', t: 'txt' }, { n: 'Regla', t: 'txt' }, { n: 'Frase', t: 'txt' },
            { n: 'Resuelto', t: 'txt' }, { n: 'Evaluable', t: 'txt' }, { n: 'Vencido', t: 'txt' }, { n: 'TTR_dias', t: 'num2' }, { n: 'Meta_horas', t: 'num1' },
            { n: 'Reabierto', t: 'txt' }, { n: 'IntentosSolucion', t: 'int' }, { n: 'ReasignacionesGrupo', t: 'int' },
            { n: 'DiasAlPrimerMovimiento', t: 'num2' }, { n: 'ReincidenteSitio30d', t: 'txt' }, { n: 'MismoMotivo30d', t: 'txt' },
            { n: 'QA_Frecuencia', t: 'txt' }, { n: 'QA_Aplicacion', t: 'txt' }, { n: 'QARe_TipoSolucion', t: 'txt' }, { n: 'QARe_UsuarioConfirmo', t: 'txt' },
            { n: 'QARe_AplicaOtrosCasos', t: 'txt' }, { n: 'QARe_GenerarArticulo', t: 'txt' }, { n: 'QARe_VerificoClasificacion', t: 'txt' }
        ];
        if (opciones.conTextos) columnasDet = columnasDet.concat([{ n: 'Titulo', t: 'txt' }, { n: 'Descripcion', t: 'txt' }, { n: 'SolucionUsuario', t: 'txt' }]);
        var si = function (b) { return b ? 'Si' : 'No'; };
        var qa = function (v) { return v == null || v === '' ? '' : textoLibre(v); };
        var filasDet = todos.map(function (t) {
            return [t.codigo, t.origen, t.tipo, t.categoria, t.arbol, t.estado, t.subestado, t.prioridad, t.sla, t.tipoRelacion,
                    t.grupo, t.tipoSitio, t.sitio || '', t.sitio ? (t.tienda || '') : '',
                    t.fReg, t.fEst, t.fSol, t.fCierre, mesDe(t.fReg), DIAS[dow(t.fReg)], new Date(t.fReg).getUTCHours(),
                    t.motivo, t.regla, t.frase ? t.frase.trim() : '',
                    si(t.resuelto), si(t.evaluable), t.evaluable ? si(t.vencido) : '', t.ttr, t.metaH,
                    si(t.reabierto), t.intentos, t.reasignaciones, t.diasPrimerTrabajo,
                    t.sitio ? si(t.gap != null && t.gap <= 30) : '', t.sitio ? si(t.gapMotivo != null && t.gapMotivo <= 30) : '',
                    qa(t.qa.QA_Frecuencia), qa(t.qa.QA_Aplicacion), qa(t.qa.QARe_TipoSolucion), qa(t.qa.QARe_UsuarioConfirmo),
                    qa(t.qa.QARe_AplicaOtrosCasos), qa(t.qa.QARe_GenerarArticulo), qa(t.qa.QARe_VerificoClasificacion)]
                .concat(opciones.conTextos ? [t.titulo, t.descripcion, t.solucion] : []);
        });

        return {
            servicio: servicio.nombre || p.servicio || 'Servicio', corte: corte, version: datos.version,
            hojas: H, detalle: { columnas: columnasDet, filas: filasDet },
            hallazgos: hallazgos, avisos: datos.avisos,
            graficas: {
                meses: filasMes.map(function (f) { return { mes: f[0], tickets: f[1], porDia: f[3] }; }),
                quincena: Array.from({ length: 15 }, function (_, i) { var k = i - 7; return { k: k, indice: media(quin.get(k) || []) }; }),
                motivos: filasMot.map(function (f) { return { motivo: f[0], tickets: f[1], pct: f[2] }; })
            },
            cifras: {
                tickets: nU, soloGrupo: soloGrupo.length, sitios: cuentas.length, conc10: conc10.pct, reinc30: r30[1], reinc30Motivo: r30[3],
                sinClasificar: scN / nU, cumple: cumpleU.cumple, ttrMed: cumpleU.ttrMed, porDia: mediaDia, antesPago: media(antesPago),
                despuesPago: media(despuesPago), grupoPrincipal: gPrincipal, lote: lote ? lote[2] : null, primerMov: mov ? mov[4] : null,
                motivos: Array.from(cuentaMotivo.entries()), reglas: Array.from(contar(U, function (t) { return t.regla; }).entries())
            },
            sinClasificar: porMotivo.get(SIN_CLASIFICAR) || []
        };
    }

    // Frases que mas se repiten en los tickets sin clasificar: ayudan a
    // escribir reglas nuevas. Solo para la pantalla, no van al Excel.
    var VACIAS = new Set(('de la el en y a que no se los las del por con para su al es lo le un una me mi ya favor apoyo ' +
                          'buen buenas buenos dia dias tardes noches hola gracias saludos solicito solicitamos tienda colaborador colaboradores ' +
                          'esta este son fue ha han hay como pero o u e si mas sus nos les tiene tienen').split(' '));
    function frasesFrecuentes(lista, max) {
        var cuenta = new Map();
        lista.forEach(function (t) {
            var p = normalizar(t.titulo + ' ' + t.descripcion).trim().split(' ').filter(function (w) { return w.length > 1 && !/^\d+$/.test(w); });
            var vistas = new Set();
            for (var n = 2; n <= 3; n++) {
                for (var i = 0; i + n <= p.length; i++) {
                    var g = p.slice(i, i + n);
                    if (VACIAS.has(g[0]) || VACIAS.has(g[n - 1])) continue;
                    vistas.add(g.join(' '));
                }
            }
            vistas.forEach(function (g) { cuenta.set(g, (cuenta.get(g) || 0) + 1); });
        });
        return porMayor(cuenta).filter(function (x) { return x[1] >= 3; }).slice(0, max || 40);
    }

    /* ------------------------------------------------------------------ Excel */

    var FORMATO = { int: '#,##0', num1: '#,##0.0', num2: '#,##0.00', pct: '0.0%', fecha: 'yyyy-mm-dd hh:mm', txt: '@' };
    var TINTA = 'FF1F2A37', MARCA = 'FF1D5C63', SUAVE = 'FFE4EEEE', GRIS = 'FF5B6770';

    function celda(v, t) {
        if (v == null || (typeof v === 'number' && !isFinite(v))) return null;
        if (t === 'fecha') return typeof v === 'number' ? new Date(v) : v;
        return v;
    }

    function hoja(wb, nombre, titulo, subtitulo, tablas) {
        var ws = wb.addWorksheet(nombre, { views: [{ showGridLines: false }] });
        var anchos = [];
        var r = ws.addRow([titulo]); r.font = { bold: true, size: 15, color: { argb: TINTA } };
        r = ws.addRow([subtitulo]); r.font = { size: 10, color: { argb: GRIS } };
        ws.addRow([]);
        tablas.forEach(function (tb) {
            r = ws.addRow([tb.titulo]); r.font = { bold: true, size: 12, color: { argb: MARCA } };
            r = ws.addRow(tb.columnas.map(function (c) { return c.n; }));
            r.eachCell(function (c) {
                c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
                c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: MARCA } };
                c.alignment = { vertical: 'middle', wrapText: true };
            });
            tb.columnas.forEach(function (c, i) { anchos[i] = Math.max(anchos[i] || 8, Math.min(18, c.n.length + 2)); });
            if (!tb.filas.length) {
                r = ws.addRow(['(sin datos)']); r.font = { italic: true, color: { argb: GRIS } };
            }
            tb.filas.forEach(function (f, k) {
                r = ws.addRow(f.map(function (v, i) { return celda(v, (tb.columnas[i] || {}).t); }));
                f.forEach(function (v, i) {
                    var c = r.getCell(i + 1), t = (tb.columnas[i] || {}).t || 'txt';
                    if (t !== 'txt' && typeof v === 'number') c.numFmt = FORMATO[t];
                    if (k % 2 === 1) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SUAVE } };
                    var largo = v == null ? 0 : (t === 'txt' ? String(v).length : 10);
                    anchos[i] = Math.max(anchos[i] || 8, Math.min(60, largo + 2));
                    if (t === 'txt' && String(v || '').length > 60) c.alignment = { wrapText: true, vertical: 'top' };
                });
                if (f[0] === 'Total') r.font = { bold: true };
            });
            if (tb.nota) {
                r = ws.addRow([tb.nota]); r.font = { italic: true, size: 9, color: { argb: GRIS } };
            }
            ws.addRow([]);
        });
        anchos.forEach(function (a, i) { ws.getColumn(i + 1).width = a; });
        return ws;
    }

    // Devuelve el ExcelJS.Workbook; quien llama hace wb.xlsx.writeBuffer().
    function armarLibro(res, ExcelJSRef) {
        var X = ExcelJSRef || (typeof ExcelJS !== 'undefined' ? ExcelJS : null);
        var wb = new X.Workbook();
        wb.creator = 'Analisis de servicio';
        wb.created = new Date(res.corte);
        var sub = res.servicio + ' · corte ' + textoFecha(res.corte) + ' (hora de México) · ' + res.version;
        hoja(wb, 'Resumen', 'Análisis de ' + res.servicio, sub, res.hojas.Resumen);
        hoja(wb, 'Temporal', 'Cuándo llegan', sub, res.hojas.Temporal);
        hoja(wb, 'Sitios', 'Dónde pasa', sub, res.hojas.Sitios);
        hoja(wb, 'Motivos', 'Qué pasa', sub, res.hojas.Motivos);
        hoja(wb, 'Atencion', 'Cómo se atiende', sub, res.hojas.Atencion);
        hoja(wb, 'Reglas', 'Cómo se clasificó el motivo', sub, res.hojas.Reglas);

        var ws = wb.addWorksheet('Detalle', { views: [{ state: 'frozen', ySplit: 1 }] });
        var cols = res.detalle.columnas;
        ws.columns = cols.map(function (c) {
            return { header: c.n, key: c.n, width: c.t === 'fecha' ? 17 : Math.max(10, Math.min(36, c.n.length + 2)),
                     style: c.t !== 'txt' ? { numFmt: FORMATO[c.t] } : {} };
        });
        ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
        ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: MARCA } };
        res.detalle.filas.forEach(function (f) { ws.addRow(f.map(function (v, i) { return celda(v, cols[i].t); })); });
        ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } };
        return wb;
    }

    /* ------------------------------------------------------------------ SQL */

    var MARCA_INI = '/* ==== PARAMETROS ==== */', MARCA_FIN = '/* ==== FIN PARAMETROS ==== */';
    function ascii(s) { return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[\u0000-\u001f\u007f]/g, ' '); }
    function patron(s) {      // Ruta, RutaFuera, Titulo: "contiene" si no trae %
        var v = ascii(s).trim().replace(/\[/g, '[[]').replace(/[^\x20-\x7e]/g, '_');
        if (!v) return null;
        return v.indexOf('%') >= 0 ? v : '%' + v + '%';
    }
    function exacto(s) {      // Grupo: el nombre tal cual
        var v = ascii(s).trim().replace(/\[/g, '[[]').replace(/%/g, '[%]').replace(/_/g, '[_]').replace(/[^\x20-\x7e]/g, '_');
        return v || null;
    }
    function lit(s) { return "N'" + String(s).replace(/'/g, "''").slice(0, 400) + "'"; }

    // p = {servicio, desde, hasta, rutas[], rutasFuera[], grupos[], titulos[]}
    function generarSql(plantilla, p) {
        var errores = [];
        if (!/^\d{4}-\d\d-\d\d$/.test(p.desde || '') || fecha(p.desde) == null) errores.push('La fecha Desde va como aaaa-mm-dd.');
        if (p.hasta && (!/^\d{4}-\d\d-\d\d$/.test(p.hasta) || fecha(p.hasta) == null)) errores.push('La fecha Hasta va como aaaa-mm-dd, o vacía.');
        var rutas = (p.rutas || []).map(patron).filter(Boolean), fuera = (p.rutasFuera || []).map(patron).filter(Boolean);
        var grupos = (p.grupos || []).map(exacto).filter(Boolean), titulos = (p.titulos || []).map(patron).filter(Boolean);
        if (!rutas.length && !grupos.length) errores.push('Hace falta al menos una ruta o un grupo.');
        if (errores.length) return { errores: errores, sql: null };
        var filas = [['Servicio', ascii(p.servicio || 'Servicio').replace(/[^\x20-\x7e]/g, '').trim() || 'Servicio'], ['Desde', p.desde], ['Hasta', p.hasta || '']];
        rutas.forEach(function (v) { filas.push(['Ruta', v]); });
        fuera.forEach(function (v) { filas.push(['RutaFuera', v]); });
        grupos.forEach(function (v) { filas.push(['Grupo', v]); });
        titulos.forEach(function (v) { filas.push(['Titulo', v]); });
        var bloque = 'INSERT INTO #P (Clave, Valor) VALUES\n' + filas.map(function (f) {
            var c = "'" + f[0] + "',";
            return '    (' + (c.length >= 12 ? c + ' ' : c.padEnd(12)) + lit(f[1]) + ')';
        }).join(',\n') + ';\n';
        var i = plantilla.indexOf(MARCA_INI), j = plantilla.indexOf(MARCA_FIN);
        if (i < 0 || j < i) return { errores: ['La plantilla no trae el bloque de PARAMETROS.'], sql: null };
        return { errores: [], sql: plantilla.slice(0, i + MARCA_INI.length) + '\n' + bloque + plantilla.slice(j), filas: filas };
    }

    /* ------------------------------------------------------------------ tablero */

    // La respuesta de handlers/analisis.ashx (la pestaña del tablero) trae los
    // mismos bloques que el 45, como {columnas, filas: [[...]]}. Aqui se vuelven
    // la misma estructura que leerArchivos(), para que preparar() no distinga.
    var ORDEN_BLOQUES = ['parametros', 'rutas', 'grupos', 'fuera', 'tickets', 'textos', 'historial'];
    function bloquesDeTablero(resp) {
        var b = (resp && resp.bloques) || {}, out = { bloques: [], corte: null, archivos: [], avisos: [] };
        ORDEN_BLOQUES.forEach(function (tipo) {
            var x = b[tipo];
            if (!x || !x.columnas) return;
            var t = TIPOS.filter(function (y) { return y.tipo === tipo; })[0];
            var filas = (x.filas || []).map(function (f) {
                var o = {};
                x.columnas.forEach(function (c, i) {
                    var v = f[i];
                    o[c] = v == null ? null : (c === 'Texto' ? String(v) : String(v).trim());
                });
                return o;
            });
            out.bloques.push(filtrar(t, x.columnas, filas, filas.map(function (_, i) { return i + 1; })));
        });
        return out;
    }
    function reglasDeTablero(resp) {
        var x = resp && resp.bloques && resp.bloques.reglas;
        if (!x) return [];
        var i = function (n) { return x.columnas.indexOf(n); };
        return x.filas.map(function (f) {
            var frases = [];
            try { frases = JSON.parse(f[i('Frases')] || '[]'); } catch (e) { frases = []; }
            return { orden: +f[i('Orden')], id: f[i('Regla')], motivo: f[i('Motivo')], campo: f[i('Campo')], frases: frases };
        }).sort(function (a, b) { return a.orden - b.orden; }).map(function (r) {
            return { id: r.id, motivo: r.motivo, campo: r.campo, frases: r.frases };
        });
    }

    // Los criterios del servicio (las claves del 45) ya como patrones LIKE, a partir
    // de los parametros "como se escriben" (los de servicios.js o el paso 1 de la pagina).
    function criteriosDeParametros(p) {
        var c = [];
        (p.rutas || []).map(patron).filter(Boolean).forEach(function (v) { c.push({ clave: 'Ruta', valor: v }); });
        (p.rutasFuera || []).map(patron).filter(Boolean).forEach(function (v) { c.push({ clave: 'RutaFuera', valor: v }); });
        (p.grupos || []).map(exacto).filter(Boolean).forEach(function (v) { c.push({ clave: 'Grupo', valor: v }); });
        (p.titulos || []).map(patron).filter(Boolean).forEach(function (v) { c.push({ clave: 'Titulo', valor: v }); });
        return c;
    }

    function litL(s) { return "N'" + String(s).replace(/'/g, "''") + "'"; }

    /* El script que carga un servicio en las tablas del 47. Lo arma el boton
       "Generar script" de la pestaña y, para el repositorio, armar_scripts.js
       desde servicios.js: el mismo formato en los dos casos.
         s = {clave, nombre, descripcion, desdeSugerido, criterios:[{clave, valor}],
              reglas:[{id, motivo, campo, frases}], motivosEquipo:[], origen, fecha}
       Los valores de criterios ya son patrones LIKE (no se vuelven a escapar). */
    function scriptServicio(s) {
        var errores = [], crit = (s.criterios || []).filter(function (c) { return c && c.valor; }), reglas = s.reglas || [];
        if (!/^[a-z0-9_-]{1,40}$/.test(s.clave || '')) errores.push('La clave del servicio va en minúsculas, sin espacios ni acentos (letras, números, - y _), hasta 40.');
        if (!s.nombre || !String(s.nombre).trim()) errores.push('Falta el nombre del servicio.');
        if (s.desdeSugerido && (!/^\d{4}-\d\d-\d\d$/.test(s.desdeSugerido) || fecha(s.desdeSugerido) == null)) errores.push('La fecha sugerida va como aaaa-mm-dd.');
        if (!crit.some(function (c) { return c.clave === 'Ruta' || c.clave === 'Grupo'; })) errores.push('Hace falta al menos una Ruta o un Grupo.');
        crit.forEach(function (c) {
            if (['Ruta', 'RutaFuera', 'Grupo', 'Titulo'].indexOf(c.clave) < 0) errores.push('Criterio desconocido: ' + c.clave + '.');
            if (String(c.valor).length > 400) errores.push('Un criterio pasa de 400 caracteres.');
        });
        var vistas = {};
        reglas.forEach(function (r, i) {
            var donde = 'Regla ' + (i + 1) + ' (' + (r.id || 'sin id') + '): ';
            if (!/^[A-Za-z0-9_-]{1,10}$/.test(r.id || '')) errores.push(donde + 'el id va con letras, números, - o _, hasta 10.');
            else if (vistas[r.id]) errores.push(donde + 'id repetido.');
            vistas[r.id] = true;
            if (!r.motivo || String(r.motivo).length > 200) errores.push(donde + 'el motivo va de 1 a 200 caracteres.');
            if (!CAMPOS[r.campo]) errores.push(donde + 'el campo va D, S o DS.');
            if (!r.frases || !r.frases.length) errores.push(donde + 'no trae frases.');
        });
        if (errores.length) return { errores: errores, sql: null };

        var k = "'" + s.clave + "'", nFrases = reglas.reduce(function (a, r) { return a + r.frases.length; }, 0);
        var L = [];
        L.push('/* =====================================================================================');
        L.push('   Servicio "' + s.nombre + '" (' + s.clave + ') para la pestaña "Análisis de servicios"');
        L.push('');
        L.push('   ' + (s.origen || 'Generado por la pestaña "Análisis de servicios".') + (s.fecha ? ' ' + s.fecha + '.' : ''));
        L.push('   ' + crit.length + ' criterio(s), ' + reglas.length + ' regla(s), ' + nFrases + ' frase(s).');
        L.push('');
        L.push('   Reemplaza los criterios y las reglas de ESTE servicio y sube su ReglasVersion;');
        L.push('   no toca los demas servicios. Todo o nada: si algo falla, no cambia nada.');
        L.push('   Necesita 47_analisis_servicios.sql. Lleva acentos en los textos: abrirlo como');
        L.push('   archivo en SSMS (trae BOM) o pegarlo tal cual en una consulta nueva.');
        L.push('   ===================================================================================== */');
        L.push('');
        L.push('USE [Tickets_Proactivanet];');
        L.push('GO');
        L.push('SET NOCOUNT ON;');
        L.push('SET XACT_ABORT ON;');
        L.push('SET NOEXEC OFF;');
        L.push("IF OBJECT_ID('dbo.AnalisisRegla') IS NULL");
        L.push('BEGIN');
        L.push("    RAISERROR(N'Falta correr 47_analisis_servicios.sql: no existen las tablas.', 16, 1);");
        L.push('    SET NOEXEC ON;');
        L.push('END;');
        L.push('GO');
        L.push('');
        L.push('BEGIN TRANSACTION;');
        L.push('');
        L.push('MERGE dbo.AnalisisServicio AS d');
        L.push('USING (SELECT Servicio = ' + k + ',');
        L.push('              Nombre = ' + litL(s.nombre) + ',');
        L.push('              Descripcion = ' + (s.descripcion ? litL(s.descripcion) : 'CONVERT(NVARCHAR(400), NULL)') + ',');
        L.push('              DesdeSugerido = ' + (s.desdeSugerido ? "CONVERT(DATE, '" + s.desdeSugerido + "', 23)" : 'CONVERT(DATE, NULL)') + ',');
        L.push('              MotivosEquipo = ' + litL(JSON.stringify(s.motivosEquipo || [])) + ') AS o');
        L.push('ON d.Servicio = o.Servicio');
        L.push('WHEN MATCHED THEN UPDATE SET Nombre = o.Nombre, Descripcion = o.Descripcion, DesdeSugerido = o.DesdeSugerido,');
        L.push('    MotivosEquipo = o.MotivosEquipo, ReglasVersion = d.ReglasVersion + 1, Activo = 1,');
        L.push('    FechaUltimaCargaDW = SYSDATETIME()');
        L.push('WHEN NOT MATCHED THEN INSERT (Servicio, Nombre, Descripcion, DesdeSugerido, MotivosEquipo)');
        L.push('    VALUES (o.Servicio, o.Nombre, o.Descripcion, o.DesdeSugerido, o.MotivosEquipo);');
        L.push('');
        L.push('DELETE FROM dbo.AnalisisServicioCriterio WHERE Servicio = ' + k + ';');
        L.push('INSERT INTO dbo.AnalisisServicioCriterio (Servicio, Orden, Clave, Valor) VALUES');
        L.push(crit.map(function (c, i) { return '    (' + k + ', ' + (i + 1) + ", '" + c.clave + "', " + litL(c.valor) + ')'; }).join(',\n') + ';');
        L.push('');
        L.push('DELETE FROM dbo.AnalisisRegla WHERE Servicio = ' + k + ';');
        if (reglas.length) {
            L.push('INSERT INTO dbo.AnalisisRegla (Servicio, Orden, Regla, Motivo, Campo, Frases) VALUES');
            L.push(reglas.map(function (r, i) {
                return '    (' + k + ', ' + (i + 1) + ", '" + r.id + "', " + litL(r.motivo) + ", '" + r.campo + "',\n        " + litL(JSON.stringify(r.frases)) + ')';
            }).join(',\n') + ';');
        }
        L.push('');
        L.push('COMMIT;');
        L.push('GO');
        L.push('SET NOEXEC OFF;');
        L.push('GO');
        L.push('');
        L.push('SELECT s.Servicio, s.Nombre, s.ReglasVersion,');
        L.push('       Criterios = (SELECT COUNT(*) FROM dbo.AnalisisServicioCriterio AS c WHERE c.Servicio = s.Servicio),');
        L.push('       Reglas    = (SELECT COUNT(*) FROM dbo.AnalisisRegla AS r WHERE r.Servicio = s.Servicio)');
        L.push('FROM dbo.AnalisisServicio AS s');
        L.push('WHERE s.Servicio = ' + k + ';');
        L.push('GO');
        return { errores: [], sql: L.join('\n') + '\n' };
    }

    return {
        normalizar: normalizar, clasificar: clasificar, decodificar: decodificar, bloquesDeTexto: bloquesDeTexto,
        bloqueDeCsv: bloqueDeCsv, leerArchivos: leerArchivos, preparar: preparar, analizar: analizar, armarLibro: armarLibro,
        bloquesDeTablero: bloquesDeTablero, reglasDeTablero: reglasDeTablero, criteriosDeParametros: criteriosDeParametros,
        scriptServicio: scriptServicio,
        generarSql: generarSql, reglasATexto: reglasATexto, textoAReglas: textoAReglas, frasesFrecuentes: frasesFrecuentes,
        tipoSitio: tipoSitio, cuantil: cuantil, textoFecha: textoFecha, textoDia: textoDia, pctTxt: pctTxt, numTxt: numTxt, miles: miles,
        SIN_CLASIFICAR: SIN_CLASIFICAR, CAMPOS: CAMPOS
    };
});
