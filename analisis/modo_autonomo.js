/* =====================================================================================
   analisis/modo_autonomo.js — la vista de Modo Autónomo en "Análisis de servicios"

   Modo Autónomo no se analiza como los demás servicios (tickets por ruta con
   reglas de frases): sus datos ya vienen clasificados de la base
   (97_analisis_modo_autonomo.sql, que lee crit.Incidente y crit.TicketMA;
   las reglas viven en analisis_modo_autonomo/reglas.py y ReglasMA.ps1). Aquí
   solo se cuentan y se pintan:

     - los EVENTOS de los incident managers por origen, con el zoom al nivel 2
       y 3 (eléctrica -> el UPS no sostuvo -> sin pila);
     - los INCIDENTES que no llegan al IM por motivo, con el mismo zoom;
     - por mes, por tienda y el detalle; y el Excel;
     - el SERVIDOR DE LA TIENDA (98_caidas_servidor.sql, 2026-11-23): lo que
       registra su log (Portal de Indicadores) contra Modo Autónomo, en los dos
       sentidos: fallas del servidor sin reporte, y Modo Autónomo con el
       servidor bien. Si la base no lo tiene, la hoja dice por qué.

   Las tarjetas son del periodo escogido y, abajo, del último mes del periodo
   (lo que va del mes si el periodo llega a hoy): pedido del dueño, 2026-11-23.

   "Sin detalle" (lo que el texto no dice) se muestra tal cual y en gris: el
   dueño trabaja con los IMs para que se documente (decidido el 2026-11-20).

   Corre igual en el navegador (window.AnalisisModoAutonomo) y en node
   (require), para que la prueba revise el mismo código. No pide nada: recibe
   la respuesta de analisis.ashx?accion=modo_autonomo, Motor.ocultarClaves
   y, para pintar, las funciones de dibujo de analisis.js.
   ===================================================================================== */
(function (raiz, fabrica) {
    if (typeof module === 'object' && module.exports) module.exports = fabrica();
    else raiz.AnalisisModoAutonomo = fabrica();
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    // Los nombres de reglas.py (ORIGENES y MOTIVOS_TICKET): la base guarda la clave.
    var ORIGENES = {
        electrica: 'Falla eléctrica', ups: 'UPS', comunicaciones: 'Comunicaciones', servidor: 'Servidor',
        sql: 'Base de datos (SQL)', clima: 'Clima o siniestro', software: 'Software o configuración',
        sincausa: 'Sin causa identificada'
    };
    var MOTIVOS = {
        electrica: 'Falla eléctrica', ups: 'UPS', servidor: 'Servidor o SQL de la tienda',
        comunicaciones: 'Comunicaciones de la tienda', red_caja: 'Red de la caja (cable, nodo, IP)',
        equipo_caja: 'Equipo de la caja (CPU, disco)', aplicativo: 'Aplicativo de la caja (RTE, servicios)',
        operador: 'Operador atrapado (baja forzada)', sincausa: 'Sin causa documentada',
        probable_electrica: 'Probable falla eléctrica (sin documentar)'
    };
    var FUENTES = { documentado: 'Documentado', tienda: 'Lo dijo la tienda', supuesto: 'Supuesto (sin causa documentada)' };
    var SIN_DETALLE = 'Sin detalle';
    var SERVICIO = 'modo_autonomo';
    var HOJAS = [['Causas', 'Causas de los IMs'], ['NoLlegan', 'Lo que no llega al IM'], ['Servidor', 'El servidor de la tienda'],
                 ['Mes', 'Por mes'], ['Tiendas', 'Tiendas'], ['Detalle', 'Detalle']];
    var MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
    var MESES_LARGOS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
    // Lo que le pasó al servidor (98: Tipo de la falla y Paso de cada evento o ticket).
    var FALLAS = { apagado: 'Se apagó sin aviso', reinicio: 'Reinicio programado', corte: 'Perdió la red' };
    var PASOS = { apagado: 'Se apagó', reinicio: 'Reinicio programado', corte: 'Perdió la red', nada: 'El servidor siguió bien' };
    var REPORTES = { evento: 'Evento del IM', ticket: 'Ticket de Modo Autónomo', sin: 'Sin reporte' };

    /* ------------------------------------------------------------------ leer */
    function num(v) { if (v == null || v === '') return null; var n = Number(v); return isFinite(n) ? n : null; }
    function txt(v) { return v == null ? '' : String(v); }
    function objetos(bloque) {
        if (!bloque || !bloque.columnas) return [];
        return bloque.filas.map(function (f) {
            var o = {};
            bloque.columnas.forEach(function (c, i) { o[c] = f[i]; });
            return o;
        });
    }
    function miles(n) { return Math.round(n || 0).toLocaleString('es-MX'); }
    function pct(a, b) { return b ? (100 * a / b).toFixed(0) + '%' : '0%'; }
    function horasTxt(h) { return (h || 0).toLocaleString('es-MX', { maximumFractionDigits: 0 }); }

    /* ------------------------------------------------------------------ el árbol */
    // Un nodo por etiqueta en cada nivel; n = eventos o incidentes. Un nivel
    // vacío ('' o null) quiere decir que ese origen no tiene ese nivel: ahí
    // se acaba la rama. Ordenados de mayor a menor.
    function nodo(clave, nombre) { return { clave: clave, nombre: nombre, n: 0, horas: 0, tickets: 0, tiendas: {}, hijos: [], _i: {} }; }
    function hijo(padre, clave, nombre) {
        var h = padre._i[clave];
        if (!h) { h = padre._i[clave] = nodo(clave, nombre); padre.hijos.push(h); }
        return h;
    }
    function sumar(nd, x) {
        nd.n++; nd.horas += x.horas || 0; nd.tickets += x.tickets || 0;
        if (x.tienda != null) nd.tiendas[x.tienda] = 1;
    }
    function cerrar(nd) {
        nd.tiendas = Object.keys(nd.tiendas).length;
        delete nd._i;
        nd.sinDetalle = nd.clave === SIN_DETALLE;
        nd.hijos.sort(function (a, b) { return b.n - a.n || (a.nombre < b.nombre ? -1 : 1); });
        nd.hijos.forEach(cerrar);
        return nd;
    }
    function arbol(items, nombres, titulo) {
        var raiz = nodo('', titulo);
        items.forEach(function (x) {
            sumar(raiz, x);
            var a = hijo(raiz, x.n1, nombres[x.n1] || x.n1);
            sumar(a, x);
            if (!x.n2) return;
            var b = hijo(a, x.n2, x.n2);
            sumar(b, x);
            if (!x.n3) return;
            sumar(hijo(b, x.n3, x.n3), x);
        });
        return cerrar(raiz);
    }
    // ruta: las claves desde la raíz. Una clave que ya no está (otro periodo) corta ahí.
    function buscar(raiz, ruta) {
        var nd = raiz, camino = [raiz];
        for (var i = 0; i < (ruta || []).length; i++) {
            var h = nd.hijos.filter(function (x) { return x.clave === ruta[i]; })[0];
            if (!h) break;
            nd = h; camino.push(h);
        }
        return { nodo: nd, camino: camino };
    }

    /* ------------------------------------------------------------------ el modelo */
    // ocultar: Motor.ocultarClaves, la misma regla que tapa las contraseñas del
    // Detalle del motor. OrigenDetalle y CausaIM son texto libre de los IMs y
    // salen en pantalla y en el Excel sin pasar por el motor; sin la función no
    // se arma el modelo, para que nunca salgan sin tapar.
    function modelo(respuesta, ocultar) {
        if (typeof ocultar !== 'function') throw new Error('AnalisisModoAutonomo.modelo necesita la función que tapa contraseñas (Motor.ocultarClaves).');
        var b = respuesta.bloques || {};
        var p = {};
        objetos(b.parametros).forEach(function (r) { p[r.Clave] = r.Valor; });
        var eventos = objetos(b.eventos).map(function (r) {
            return {
                mes: txt(r.Mes), inicio: txt(r.Inicio), horas: num(r.Horas) || 0, tienda: num(r.Tienda),
                tiendaNombre: txt(r.TiendaNombre), aplicacion: txt(r.Aplicacion), tipo: txt(r.Tipo),
                n1: txt(r.Origen) || 'sincausa', detalle: txt(ocultar(txt(r.OrigenDetalle))), respaldo: num(r.RespaldoFallo) === 1,
                alcance: txt(r.Alcance), n2: txt(r.Nivel2), n3: txt(r.Nivel3), causaIM: txt(ocultar(txt(r.CausaIM))),
                ticketsMA: num(r.TicketsMA) || 0
            };
        });
        var incidentes = objetos(b.incidentes).map(function (r) {
            return {
                mes: txt(r.Mes), fecha: txt(r.Fecha), tienda: num(r.Tienda), tickets: num(r.Tickets) || 0,
                n1: txt(r.Motivo) || 'probable_electrica', fuente: txt(r.Fuente), n2: txt(r.Nivel2), n3: txt(r.Nivel3),
                sinContacto: num(r.SinContacto) === 1, alcance: txt(r.Alcance), tiendaConEventoIM: num(r.TiendaConEventoIM) === 1
            };
        });
        var m = {
            servicio: SERVICIO, desde: respuesta.desde, hasta: respuesta.hasta, parametros: p,
            eventos: eventos, incidentes: incidentes,
            arbolEventos: arbol(eventos, ORIGENES, 'Todas las causas'),
            arbolIncidentes: arbol(incidentes, MOTIVOS, 'Todos los motivos')
        };
        m.cifras = cifras(m);
        m.corte = corteMes(m.desde, m.hasta);
        m.cifrasMes = cifras(soloMes(m, m.corte.mes));
        m.meses = porMes(m);
        m.tiendas = porTienda(m);
        m.servidor = modeloServidor(respuesta.servidor, m);
        m.hallazgos = hallazgos(m);   // despues de tiendas: el ultimo hallazgo nombra la que mas tuvo
        m.avisos = avisos(m);
        return m;
    }

    // El último mes del periodo, para el pie de las tarjetas: "Octubre" si el periodo
    // lo trae completo; si no, "Del 1 al 23 de noviembre" (lo que va del mes).
    function corteMes(desde, hasta) {
        var h = txt(hasta), d = txt(desde);
        if (!/^\d{4}-\d{2}-\d{2}/.test(h)) return { mes: '', etiqueta: '' };
        var mes = h.slice(0, 7), a = +h.slice(0, 4), n = +h.slice(5, 7), dia = +h.slice(8, 10);
        var ultimo = new Date(Date.UTC(a, n, 0)).getUTCDate();
        var ini = d.slice(0, 7) === mes ? +d.slice(8, 10) : 1;
        var nombre = MESES_LARGOS[n - 1];
        var etiqueta = ini === 1 && dia === ultimo ? nombre.charAt(0).toUpperCase() + nombre.slice(1)
                                                   : 'Del ' + ini + ' al ' + dia + ' de ' + nombre;
        return { mes: mes, etiqueta: etiqueta };
    }
    function soloMes(m, mes) {
        var e = m.eventos.filter(function (x) { return x.mes === mes; });
        var i = m.incidentes.filter(function (x) { return x.mes === mes; });
        return { eventos: e, incidentes: i, arbolEventos: arbol(e, ORIGENES, ''), arbolIncidentes: arbol(i, MOTIVOS, '') };
    }

    /* ------------------------------------------------------------------ el servidor */
    // respuesta.servidor: { disponible, motivo } o { disponible: true, bloques } (analisis.ashx,
    // AnalisisQueries.ModoAutonomoServidor). Las mismas cuentas que el correo
    // (Enviar_CorreoModoAutonomo.ps1, Get-MetricasServidor), sobre el periodo escogido.
    function modeloServidor(s, m) {
        if (!s) return { disponible: false, motivo: 'falta subir al sitio el analisis.ashx y el AnalisisQueries.cs del 2026-11-23' };
        if (!s.disponible) return { disponible: false, motivo: txt(s.motivo) || 'sin datos del Portal de Indicadores' };
        var b = s.bloques || {}, p = {};
        objetos(b.parametros).forEach(function (r) { p[r.Clave] = r.Valor; });
        var todas = objetos(b.fallas).map(function (r) {
            return {
                mes: txt(r.Mes), inicio: txt(r.Inicio), minutos: num(r.Minutos), tienda: num(r.Tienda), tiendaNombre: txt(r.TiendaNombre),
                estado: txt(r.Estado), tipo: txt(r.Tipo), causa: txt(r.Causa), horario: num(r.Horario) === 1, cuenta: num(r.Cuenta) === 1,
                reporte: txt(r.Reporte), causaMA: txt(r.CausaMA)
            };
        });
        var ma = objetos(b.modoautonomo).map(function (r) {
            return {
                fuente: txt(r.Fuente), mes: txt(r.Mes), fecha: txt(r.Fecha), tienda: num(r.Tienda), causa: txt(r.Causa), n2: txt(r.Nivel2),
                paso: txt(r.Paso), pasoCausa: txt(r.PasoCausa), pasoInicio: txt(r.PasoInicio)
            };
        });
        var servidores = objetos(b.servidores).map(function (r) {
            return { servidor: txt(r.Servidor), tienda: num(r.Tienda), tiendaNombre: txt(r.TiendaNombre), estado: txt(r.Estado),
                     logDesde: txt(r.LogDesde), redDesde: txt(r.RedDesde), alcanzado: num(r.Alcanzado) === 1 };
        });
        var causas = objetos(b.causas).map(function (r) {
            return { tipo: txt(r.Tipo), causa: txt(r.Causa), total: num(r.Total) || 0, enHorario: num(r.EnHorario) || 0,
                     servidores: num(r.Servidores) || 0, sinReporte: num(r.SinReporte) || 0 };
        });
        // Solo cuentan las de horario de tienda (Cuenta = 1); los apagados fuera de horario
        // vienen para el Excel.
        var fallas = todas.filter(function (x) { return x.cuenta; });
        var mes = fallas.filter(function (x) { return x.mes === m.corte.mes; });
        function cuantas(l, rep) { return l.filter(function (x) { return x.reporte === rep; }).length; }
        function horas(l) { return Math.round(l.reduce(function (t, x) { return t + (x.minutos || 0); }, 0) / 6) / 10; }
        var porTipo = {};
        Object.keys(FALLAS).forEach(function (t) {
            var x = fallas.filter(function (f) { return f.tipo === t; }), xm = mes.filter(function (f) { return f.tipo === t; });
            porTipo[t] = { n: x.length, mes: xm.length, horas: horas(x), horasMes: horas(xm), evento: cuantas(x, 'evento'),
                           ticket: cuantas(x, 'ticket'), sin: cuantas(x, 'sin'), sinMes: cuantas(xm, 'sin') };
        });
        // Lo que le pasó al servidor en cada evento del IM (por origen) y cada incidente (por motivo).
        function pasos(filas, nombres) {
            var r = [];
            Object.keys(nombres).forEach(function (k) {
                var x = filas.filter(function (f) { return f.causa === k; });
                if (!x.length) return;
                var j = x.filter(function (f) { return f.paso !== 'sinlog'; });
                var o = { causa: k, nombre: nombres[k], total: x.length, juzgados: j.length, sinLog: x.length - j.length };
                Object.keys(PASOS).forEach(function (pp) { o[pp] = j.filter(function (f) { return f.paso === pp; }).length; });
                o.conServidor = j.length - o.nada;
                r.push(o);
            });
            return r.sort(function (a, c) { return c.total - a.total; });
        }
        var im = ma.filter(function (x) { return x.fuente === 'im'; }), tk = ma.filter(function (x) { return x.fuente === 'ticket'; });
        // Las tiendas con más apagados y cortes en horario (los reinicios son programados).
        var evTienda = {};
        m.eventos.forEach(function (e) { if (e.tienda != null) evTienda[e.tienda] = (evTienda[e.tienda] || 0) + 1; });
        var t = {};
        fallas.forEach(function (f) {
            if (f.tienda == null) return;
            var x = t[f.tienda] || (t[f.tienda] = { tienda: f.tienda, nombre: '', estado: '', apagado: 0, corte: 0, reinicio: 0, sin: 0, eventosIM: evTienda[f.tienda] || 0 });
            if (!x.nombre) x.nombre = f.tiendaNombre;
            if (!x.estado) x.estado = f.estado;
            x[f.tipo] = (x[f.tipo] || 0) + 1;
            if (f.reporte === 'sin' && f.tipo !== 'reinicio') x.sin++;
        });
        var tiendas = Object.keys(t).map(function (k) { var x = t[k]; x.fallas = x.apagado + x.corte; return x; })
            .filter(function (x) { return x.fallas > 0; })
            .sort(function (a, c) { return c.fallas - a.fallas || c.sin - a.sin || a.tienda - c.tienda; });
        return {
            disponible: true, parametros: p, lectura: txt(p.UltimaLecturaPortal), servidores: servidores, nServidores: num(p.Servidores) || servidores.length,
            noAlcanzados: num(p.NoAlcanzados), corteMinimo: num(p.CorteMinimoMin), todas: todas, fallasLista: fallas, ma: ma, causas: causas,
            fallas: fallas.length, fallasMes: mes.length, sinReporte: cuantas(fallas, 'sin'), sinReporteMes: cuantas(mes, 'sin'),
            porTipo: porTipo, porOrigen: pasos(im, ORIGENES), porMotivo: pasos(tk, MOTIVOS), tiendas: tiendas,
            eventosIM: im.length, eventosIMJuzgados: im.filter(function (x) { return x.paso !== 'sinlog'; }).length,
            incidentes: tk.length, incidentesJuzgados: tk.filter(function (x) { return x.paso !== 'sinlog'; }).length
        };
    }

    function sinDetalle(x) { return x.n2 === SIN_DETALLE || x.n3 === SIN_DETALLE; }
    function cifras(m) {
        var e = m.eventos, i = m.incidentes, c = {};
        c.eventos = e.length;
        c.horas = e.reduce(function (s, x) { return s + x.horas; }, 0);
        var porTienda = {};
        e.forEach(function (x) { if (x.tienda != null) porTienda[x.tienda] = (porTienda[x.tienda] || 0) + 1; });
        c.tiendas = Object.keys(porTienda).length;
        c.tiendasRepiten = Object.keys(porTienda).filter(function (k) { return porTienda[k] >= 2; }).length;
        var elec = e.filter(function (x) { return x.n1 === 'electrica'; });
        c.electricas = elec.length;
        c.respaldo = elec.filter(function (x) { return x.respaldo; }).length;
        c.eventosSinDetalle = e.filter(sinDetalle).length;
        c.incidentes = i.length;
        c.ticketsSueltos = i.reduce(function (s, x) { return s + x.tickets; }, 0);
        c.ticketsEnEventos = e.reduce(function (s, x) { return s + x.ticketsMA; }, 0);
        c.supuestos = i.filter(function (x) { return x.fuente === 'supuesto'; }).length;
        c.incidentesSinDetalle = i.filter(sinDetalle).length;
        c.principal = m.arbolEventos.hijos[0] || null;
        c.principalIncidentes = m.arbolIncidentes.hijos[0] || null;
        return c;
    }

    // La rama más grande, nivel por nivel, sin pasar por "Sin detalle".
    function ramaMayor(raiz) {
        var r = [], nd = raiz;
        while (nd.hijos.length) {
            var h = nd.hijos.filter(function (x) { return !x.sinDetalle; })[0];
            if (!h) break;
            r.push(h); nd = h;
        }
        return r;
    }
    function hallazgos(m) {
        var c = m.cifras, h = [];
        if (!c.eventos && !c.incidentes) return ['No hay eventos de los IMs ni incidentes de Modo Autónomo en el periodo.'];
        var r = ramaMayor(m.arbolEventos);
        if (r.length) {
            var t = 'La causa principal de los eventos de los IMs es ' + r[0].nombre.toLowerCase() + ': ' + miles(r[0].n) + ' de ' +
                    miles(c.eventos) + ' (' + pct(r[0].n, c.eventos) + ')';
            if (r[1]) t += '; dentro, ' + r[1].nombre.charAt(0).toLowerCase() + r[1].nombre.slice(1) + ' (' + miles(r[1].n) + ')';
            if (r[2]) t += ' y, en eso, ' + r[2].nombre.charAt(0).toLowerCase() + r[2].nombre.slice(1) + ' (' + miles(r[2].n) + ')';
            h.push(t + '.');
        }
        var s = m.servidor;
        if (s && s.disponible && s.fallas) {
            h.push('El servidor de la tienda falló ' + miles(s.fallas) + ' veces en horario de tienda (' + miles(s.fallasMes) + ' ' +
                   enElMes(m.corte) + '): ' + pct(s.sinReporte, s.fallas) + ' sin reporte de Modo Autónomo.');
        }
        if (c.electricas) {
            h.push('En ' + miles(c.respaldo) + ' de ' + miles(c.electricas) + ' fallas eléctricas el UPS o la planta no sostuvieron la tienda.');
        }
        if (c.incidentes) {
            // "Probable falla electrica" es el supuesto para los que no tienen causa: se dice aparte.
            var doc = m.arbolIncidentes.hijos.filter(function (x) { return x.clave !== 'probable_electrica'; })[0];
            h.push('No llegaron al IM ' + miles(c.incidentes) + ' incidentes (' + miles(c.ticketsSueltos) + ' tickets). ' +
                   pct(c.supuestos, c.incidentes) + ' no tiene causa documentada (cuentan como probable falla eléctrica)' +
                   (doc ? '; de los demás, el motivo principal es ' + doc.nombre.charAt(0).toLowerCase() + doc.nombre.slice(1) + ', con ' + miles(doc.n) + '.' : '.'));
        }
        if (c.eventosSinDetalle) {
            h.push(miles(c.eventosSinDetalle) + ' eventos (' + pct(c.eventosSinDetalle, c.eventos) +
                   ') no dicen el detalle de su causa: en gris en el zoom, para trabajarlo con los IMs.');
        }
        if (c.tiendasRepiten) {
            var top = m.tiendas[0];
            h.push(miles(c.tiendasRepiten) + ' tiendas tuvieron 2 o más eventos' +
                   (top && top.eventos >= 2 ? '; la que más, la ' + top.tienda + ' con ' + miles(top.eventos) + '.' : '.'));
        }
        return h.slice(0, 6);
    }
    // "en octubre" o "del 1 al 23 de noviembre", para meterlo en una frase.
    function enElMes(corte) {
        var e = corte.etiqueta;
        return /^Del /.test(e) ? e.charAt(0).toLowerCase() + e.slice(1) : 'en ' + e.toLowerCase();
    }
    function avisos(m) {
        var a = [], p = m.parametros;
        if (!m.servidor.disponible) {
            a.push('La comparación con el servidor de la tienda no está disponible: ' + m.servidor.motivo + '.');
        }
        if (!p.CargaTickets) {
            a.push('Todavía no hay tickets clasificados (crit.TicketMA): falta correr Cargar_Criticos.ps1 con la versión del 2026-11-20. Se ven solo los eventos de los IMs.');
        }
        if (m.eventos.length && m.eventos.every(function (x) { return !x.n2; })) {
            a.push('Los eventos no traen el nivel 2 y 3: falta volver a cargar el Excel con Cargar_Criticos.ps1 (versión del 2026-11-20).');
        }
        return a;
    }
    function porMes(m) {
        var t = {};
        function fila(mes) { return t[mes] || (t[mes] = { mes: mes, eventos: 0, horas: 0, electricas: 0, incidentes: 0, tickets: 0 }); }
        m.eventos.forEach(function (x) { if (!x.mes) return; var f = fila(x.mes); f.eventos++; f.horas += x.horas; if (x.n1 === 'electrica') f.electricas++; });
        m.incidentes.forEach(function (x) { if (!x.mes) return; var f = fila(x.mes); f.incidentes++; f.tickets += x.tickets; });
        return Object.keys(t).sort().map(function (k) { return t[k]; });
    }
    function porTienda(m) {
        var t = {};
        function fila(x) {
            return t[x.tienda] || (t[x.tienda] = { tienda: x.tienda, nombre: '', eventos: 0, horas: 0, incidentes: 0, tickets: 0, causas: {} });
        }
        m.eventos.forEach(function (x) {
            if (x.tienda == null) return;
            var f = fila(x); f.eventos++; f.horas += x.horas; if (!f.nombre) f.nombre = x.tiendaNombre;
            var k = ORIGENES[x.n1] || x.n1; f.causas[k] = (f.causas[k] || 0) + 1;
        });
        m.incidentes.forEach(function (x) { if (x.tienda == null) return; var f = fila(x); f.incidentes++; f.tickets += x.tickets; });
        return Object.keys(t).map(function (k) {
            var f = t[k], c = Object.keys(f.causas).sort(function (a, b) { return f.causas[b] - f.causas[a]; })[0];
            f.principal = c ? c + ' (' + f.causas[c] + ')' : '';
            delete f.causas;
            return f;
        }).sort(function (a, b) { return b.eventos - a.eventos || b.incidentes - a.incidentes || a.tienda - b.tienda; });
    }

    /* ------------------------------------------------------------------ pintar */
    // a: lo que presta analisis.js -> esc, horizontales(d, op), columnas(d, op),
    // htmlTabla(tb, max), ancho(). ruta: {Causas: [...], NoLlegan: [...]}.
    // Cada tarjeta: [título, valor del periodo, su pie, el último mes del periodo, clase].
    function kpis(m) {
        var c = m.cifras, pr = c.principal, cm = m.cifrasMes, s = m.servidor;
        function mes(v) { return m.corte.etiqueta ? m.corte.etiqueta + ': ' + v : ''; }
        var prMes = pr ? (buscar(soloMes(m, m.corte.mes).arbolEventos, [pr.clave]).camino[1] || { n: 0 }).n : 0;
        return [
            ['Eventos de los IMs', miles(c.eventos), horasTxt(c.horas) + ' horas en Modo Autónomo', mes(miles(cm.eventos) + ' (' + horasTxt(cm.horas) + ' h)'), ''],
            ['Tiendas', miles(c.tiendas), miles(c.tiendasRepiten) + ' con 2 o más eventos', mes(miles(cm.tiendas)), ''],
            ['Causa principal', pr ? pct(pr.n, c.eventos) : '—', pr ? pr.nombre : 'sin eventos', pr ? mes(pct(prMes, cm.eventos) + ' (' + miles(prMes) + ')') : '', ''],
            ['El respaldo no sostuvo', miles(c.respaldo), 'de ' + miles(c.electricas) + ' fallas eléctricas', mes(miles(cm.respaldo) + ' de ' + miles(cm.electricas)), ''],
            ['No llegan al IM', miles(c.incidentes), miles(c.ticketsSueltos) + ' tickets en incidentes', mes(miles(cm.incidentes)), ''],
            s.disponible
                ? ['Servidor sin reporte', miles(s.sinReporte), 'de ' + miles(s.fallas) + ' fallas en horario (' + pct(s.sinReporte, s.fallas) + ')',
                   mes(miles(s.sinReporteMes) + ' de ' + miles(s.fallasMes)), 'sr']
                : ['Servidor sin reporte', '—', 'sin datos del Portal de Indicadores', '', ''],
            ['Sin detalle', pct(c.eventosSinDetalle, c.eventos), 'de los eventos no dice el detalle', mes(pct(cm.eventosSinDetalle, cm.eventos)), '']
        ];
    }
    function migas(a, camino, hoja) {
        return '<nav class="an-migas" aria-label="Nivel del zoom">' + camino.map(function (nd, i) {
            var ruta = JSON.stringify(camino.slice(1, i + 1).map(function (x) { return x.clave; }));
            var ultimo = i === camino.length - 1;
            return (i ? '<span aria-hidden="true">›</span>' : '') + (ultimo
                ? '<b aria-current="true">' + a.esc(nd.nombre) + '</b>'
                : '<button type="button" class="an-miga" data-ma-hoja="' + hoja + '" data-ma-ruta="' + a.esc(ruta) + '">' + a.esc(nd.nombre) + '</button>');
        }).join('') + '</nav>';
    }
    function panelZoom(a, raiz, ruta, hoja, unidad, conHoras) {
        var b = buscar(raiz, ruta), nd = b.nodo, nivel = b.camino.length;   // 1 = el primer nivel
        var total = nd.n || 1;
        var d = nd.hijos.map(function (h) {
            var abre = h.hijos.length > 0;
            return {
                e: h.nombre, v: h.n, etq: miles(h.n) + ' (' + pct(h.n, total) + ')', apagada: h.sinDetalle,
                zoom: abre ? h.clave : null,
                tip: h.nombre + '\n' + miles(h.n) + ' ' + unidad + ' (' + pct(h.n, total) + ')' +
                     (conHoras ? '\n' + horasTxt(h.horas) + ' horas' : '\n' + miles(h.tickets) + ' tickets') +
                     '\n' + miles(h.tiendas) + ' tiendas' + (abre ? '\nClic para ver el siguiente nivel' : '')
            };
        });
        var titulo = nivel === 1 ? (hoja === 'Causas' ? 'Eventos por origen' : 'Incidentes por motivo') : nd.nombre + ': nivel ' + nivel;
        var h = migas(a, b.camino, hoja);
        if (!d.length) {
            h += '<p class="nota">' + (nd === raiz ? 'Sin datos en el periodo.' : 'Este nivel no se abre más.') + '</p>';
            return h;
        }
        h += '<div class="an-tabla an-grafica"><h4>' + a.esc(titulo) + '</h4>' +
             a.horizontales(d, { ancho: a.ancho(), titulo: titulo, derecha: 96 }) +
             '<p class="nota">Clic en una barra o en el nombre para abrir el siguiente nivel. En gris, «Sin detalle»: lo que el texto no dice.</p></div>';
        var cols = [{ n: nivel === 1 ? (hoja === 'Causas' ? 'Origen' : 'Motivo') : 'Nivel ' + nivel, t: 'txt' },
                    { n: unidad.charAt(0).toUpperCase() + unidad.slice(1), t: 'int' }, { n: '%', t: 'txt' },
                    conHoras ? { n: 'Horas', t: 'int' } : { n: 'Tickets', t: 'int' }, { n: 'Tiendas', t: 'int' }];
        var filas = nd.hijos.map(function (x) {
            return [x.hijos.length ? { html: '<button type="button" class="an-zoom" data-ma-hoja="' + hoja + '" data-ma-zoom="' + a.esc(x.clave) + '">' + a.esc(x.nombre) + '</button>' } : x.nombre,
                    x.n, pct(x.n, total), conHoras ? x.horas : x.tickets, x.tiendas];
        });
        h += tablaHtml(a, { titulo: 'El detalle de este nivel', columnas: cols, filas: filas });
        return h;
    }
    // Como htmlTabla de analisis.js, pero una celda puede traer HTML ya escapado ({html}).
    function tablaHtml(a, tb) {
        var h = '<div class="an-tabla"><h4>' + a.esc(tb.titulo) + '</h4><div class="scroll-x"><table><thead><tr>' +
                tb.columnas.map(function (c) { return '<th scope="col"' + (c.t !== 'txt' ? ' class="n"' : '') + '>' + a.esc(c.n) + '</th>'; }).join('') +
                '</tr></thead><tbody>';
        if (!tb.filas.length) h += '<tr><td colspan="' + tb.columnas.length + '" class="vacio">Sin datos.</td></tr>';
        tb.filas.forEach(function (f) {
            h += '<tr>' + f.map(function (v, i) {
                var c = tb.columnas[i];
                if (v && typeof v === 'object' && v.html != null) return '<td>' + v.html + '</td>';
                if (typeof v === 'number') return '<td class="n">' + (c.t === 'num1' ? v.toLocaleString('es-MX', { maximumFractionDigits: 1 }) : miles(v)) + '</td>';
                return '<td>' + a.esc(v) + '</td>';
            }).join('') + '</tr>';
        });
        h += '</tbody></table></div>' + (tb.nota ? '<p class="nota">' + a.esc(tb.nota) + '</p>' : '') + '</div>';
        return h;
    }
    function panelMes(a, m) {
        var dos = a.ancho() > 900, W = dos ? Math.floor((a.ancho() - 16) / 2) : a.ancho();
        function etq(mes) { var x = mes.split('-'); return MESES[+x[1] - 1] + ' ' + x[0].slice(2); }
        var ev = m.meses.map(function (x) { return { e: etq(x.mes), v: x.eventos, etq: miles(x.eventos), tip: x.mes + '\n' + miles(x.eventos) + ' eventos\n' + horasTxt(x.horas) + ' horas' }; });
        var inc = m.meses.map(function (x) { return { e: etq(x.mes), v: x.incidentes, etq: miles(x.incidentes), tip: x.mes + '\n' + miles(x.incidentes) + ' incidentes\n' + miles(x.tickets) + ' tickets' }; });
        var ult = Math.max(0, m.meses.length - 1);
        var h = '<div class="an-graficas">' +
                '<div class="an-tabla an-grafica"><h4>Eventos de los IMs por mes</h4>' + a.columnas(ev, { ancho: W, titulo: 'Eventos por mes', etiquetar: [ult] }) + '</div>' +
                '<div class="an-tabla an-grafica"><h4>Incidentes que no llegan al IM por mes</h4>' + a.columnas(inc, { ancho: W, titulo: 'Incidentes por mes', etiquetar: [ult] }) + '</div>' +
                '</div>';
        h += tablaHtml(a, {
            titulo: 'Mes a mes',
            columnas: [{ n: 'Mes', t: 'txt' }, { n: 'Eventos', t: 'int' }, { n: 'Horas', t: 'int' }, { n: 'Eléctricos', t: 'int' },
                       { n: 'Incidentes sin IM', t: 'int' }, { n: 'Sus tickets', t: 'int' }],
            filas: m.meses.map(function (x) { return [x.mes, x.eventos, Math.round(x.horas), x.electricas, x.incidentes, x.tickets]; }),
            nota: 'El mes del inicio del evento, o del primer ticket del incidente.'
        });
        return h;
    }
    function panelTiendas(m, a) {
        return tablaHtml(a, {
            titulo: 'Las tiendas con más eventos',
            columnas: [{ n: 'Tienda', t: 'txt' }, { n: 'Sucursal', t: 'txt' }, { n: 'Eventos', t: 'int' }, { n: 'Horas', t: 'int' },
                       { n: 'Causa principal', t: 'txt' }, { n: 'Incidentes sin IM', t: 'int' }, { n: 'Sus tickets', t: 'int' }],
            filas: m.tiendas.slice(0, 30).map(function (x) {
                return [String(x.tienda), x.nombre, x.eventos, Math.round(x.horas), x.principal, x.incidentes, x.tickets];
            }),
            nota: 'Las primeras 30 de ' + miles(m.tiendas.length) + '; el Excel las lleva todas. Sin las de varias sucursales.'
        });
    }
    function panelDetalle(m, a) {
        var MAX = 200;
        return tablaHtml(a, {
            titulo: 'Eventos de los IMs',
            columnas: [{ n: 'Inicio', t: 'txt' }, { n: 'Tienda', t: 'txt' }, { n: 'Aplicación', t: 'txt' }, { n: 'Origen', t: 'txt' },
                       { n: 'Nivel 2', t: 'txt' }, { n: 'Nivel 3', t: 'txt' }, { n: 'Causa del IM', t: 'txt' }, { n: 'Horas', t: 'num1' }, { n: 'Alcance', t: 'txt' }],
            filas: m.eventos.slice(0, MAX).map(function (x) {
                return [x.inicio, x.tienda == null ? 'Varias' : String(x.tienda), x.aplicacion, ORIGENES[x.n1] || x.n1, x.n2, x.n3, x.causaIM, x.horas, x.alcance];
            }),
            nota: m.eventos.length > MAX ? 'Aquí los primeros ' + MAX + ' de ' + miles(m.eventos.length) + '; el Excel los lleva todos.' : ''
        }) + tablaHtml(a, {
            titulo: 'Incidentes que no llegan al IM',
            columnas: [{ n: 'Primer ticket', t: 'txt' }, { n: 'Tienda', t: 'txt' }, { n: 'Tickets', t: 'int' }, { n: 'Motivo', t: 'txt' },
                       { n: 'De dónde sale', t: 'txt' }, { n: 'Nivel 2', t: 'txt' }, { n: 'Nivel 3', t: 'txt' }, { n: 'Alcance', t: 'txt' }],
            filas: m.incidentes.slice(0, MAX).map(function (x) {
                return [x.fecha, x.tienda == null ? '—' : String(x.tienda), x.tickets, MOTIVOS[x.n1] || x.n1, FUENTES[x.fuente] || x.fuente, x.n2, x.n3, x.alcance];
            }),
            nota: m.incidentes.length > MAX ? 'Aquí los primeros ' + MAX + ' de ' + miles(m.incidentes.length) + '; el Excel los lleva todos.' : ''
        });
    }
    // Barras apiladas en HTML (se acomodan al ancho del panel). filas: [{e, texto, seg: [{v, clase, tip}]}];
    // leyenda: [[clase, nombre]]. Los colores viven en analisis.css (.an-seg.*).
    function pilas(a, titulo, filas, leyenda) {
        var h = '<div class="an-pilas" role="list" aria-label="' + a.esc(titulo) + '">';
        filas.forEach(function (f) {
            var tot = f.seg.reduce(function (t, x) { return t + x.v; }, 0) || 1;
            h += '<div class="an-pila-fila" role="listitem"><span class="an-pila-e">' + a.esc(f.e) + '</span><span class="an-pila" aria-hidden="true">' +
                 f.seg.filter(function (x) { return x.v > 0; }).map(function (x) {
                     return '<span class="an-seg ' + x.clase + '" style="width:' + (100 * x.v / tot).toFixed(2) + '%" data-tip="' + a.esc(f.e + '\n' + x.tip) + '"></span>';
                 }).join('') + '</span><span class="an-pila-t">' + a.esc(f.texto) + '</span></div>';
        });
        if (!leyenda) return h + '</div>';
        return h + '</div><p class="an-leyenda">' + leyenda.map(function (l) {
            return '<span><i class="an-seg ' + l[0] + '" aria-hidden="true"></i>' + a.esc(l[1]) + '</span>';
        }).join('') + '</p>';
    }
    function horas1(h) { return (h || 0).toLocaleString('es-MX', { maximumFractionDigits: 1 }); }
    function minTxt(v) { v = num(v); return v == null ? '—' : v % 60 === 0 ? v / 60 + ' h' : v + ' min'; }
    function tarjetaHtml(a, k) {
        return '<div class="kpi' + (k[4] ? ' ' + k[4] : '') + '"><div class="lbl">' + a.esc(k[0]) + '</div><div class="val">' + a.esc(k[1]) + '</div>' +
               '<div class="foot" title="' + a.esc(k[2]) + '">' + a.esc(k[2]) + '</div>' + (k[3] ? '<div class="foot an-mes">' + a.esc(k[3]) + '</div>' : '') + '</div>';
    }
    // Lo que le pasó al servidor en los eventos del IM y los tickets: la frase del correo.
    function fraseServidorBien(s) {
        var el = s.porOrigen.filter(function (x) { return x.causa === 'electrica'; })[0];
        var pe = s.porMotivo.filter(function (x) { return x.causa === 'probable_electrica'; })[0];
        var f = [];
        if (el && el.juzgados) f.push('en los eventos eléctricos del IM el servidor falló en el ' + pct(el.conServidor, el.juzgados) + ' (' + miles(el.conServidor) + ' de ' + miles(el.juzgados) + ')');
        if (pe && pe.juzgados) f.push('en los tickets de probable falla eléctrica solo en el ' + pct(pe.conServidor, pe.juzgados) +
                                      ': en los demás el servidor siguió prendido y con red, y la falla estuvo del lado de las cajas');
        if (!f.length) return '';
        var t = f.join('; ');
        return t.charAt(0).toUpperCase() + t.slice(1) + '.';
    }
    function panelServidor(m, a) {
        var s = m.servidor;
        if (!s.disponible) {
            return '<div class="an-tabla"><h4>El servidor de la tienda</h4><p class="nota">No disponible: ' + a.esc(s.motivo) + '.</p>' +
                   '<p class="nota">Esta hoja compara el log de los servidores de tienda (Portal de Indicadores) con Modo Autónomo. ' +
                   'Necesita 98_caidas_servidor.sql en la base y la carga del portal (caidas_servidor\\Cargar_Servidor.ps1, que corre el ETL).</p></div>';
        }
        var p = s.parametros, t = s.porTipo, mes = m.corte.etiqueta;
        function pie(v) { return mes ? mes + ': ' + v : ''; }
        var desde = num(p.HorarioDesde), hasta = num(p.HorarioHasta);
        var h = '<div class="an-tabla an-srv-intro"><h4>Qué se compara</h4>' +
            '<p>El Portal de Indicadores lee el log (visor de eventos) de los ' + miles(s.nServidores) + ' servidores de tienda: cuándo se apagó sin aviso, ' +
            'cuándo se reinició por programa (parches de Windows o reinicio de sanidad) y cuándo se quedó sin red. Aquí se compara con lo que llegó como ' +
            'Modo Autónomo (eventos de los IMs y tickets), en los dos sentidos:</p><ol>' +
            '<li><b>Fallas del servidor sin reporte</b>: el servidor falló en horario de tienda y no hubo evento del IM ni ticket cerca.</li>' +
            '<li><b>Modo Autónomo con el servidor bien</b>: hubo evento del IM o ticket y el servidor siguió prendido y con red.</li></ol>' +
            '<p class="nota">«Cerca»: el evento del IM se cruza con la falla (con ' + a.esc(minTxt(p.MargenEventoMin)) + ' de margen a cada lado); el primer ticket cae entre ' +
            a.esc(minTxt(p.TicketAntesMin)) + ' antes de que empiece la falla y ' + a.esc(minTxt(p.TicketDespuesMin)) + ' después de que termina. ' +
            'Horario de tienda: de ' + (desde == null ? 7 : desde) + ':00 a ' + ((hasta == null ? 23 : hasta) - 1) + ':59. Un corte de red cuenta si dura ' +
            a.esc(String(s.corteMinimo == null ? 5 : s.corteMinimo)) + ' minutos o más. Logs leídos el ' + a.esc(s.lectura) + '.</p></div>';
        h += '<div class="kpis an-srv-kpis">' + [
            ['Apagados sin aviso', miles(t.apagado.n), horas1(t.apagado.horas) + ' horas con el servidor abajo', pie(miles(t.apagado.mes)), 'sr'],
            ['Reinicios programados', miles(t.reinicio.n), 'parches de Windows o sanidad', pie(miles(t.reinicio.mes)), ''],
            ['Cortes de red', miles(t.corte.n), horas1(t.corte.horas) + ' horas sin red', pie(miles(t.corte.mes)), ''],
            ['Fallas sin reporte', pct(s.sinReporte, s.fallas), miles(s.sinReporte) + ' de ' + miles(s.fallas) + ': ni evento del IM ni ticket',
             pie(miles(s.sinReporteMes) + ' de ' + miles(s.fallasMes)), 'sr']
        ].map(function (k) { return tarjetaHtml(a, k); }).join('') + '</div>';

        // 1. Fallas del servidor que no llegaron como Modo Autónomo.
        h += '<div class="an-tabla"><h4>1. Fallas del servidor que no llegaron como Modo Autónomo</h4>' +
             pilas(a, 'Fallas del servidor por tipo y reporte', Object.keys(FALLAS).map(function (k) {
                 var x = t[k];
                 return { e: FALLAS[k], texto: miles(x.n) + ' · ' + pct(x.sin, x.n) + ' sin reporte', seg: [
                     { v: x.evento, clase: 'evento', tip: miles(x.evento) + ' con evento del IM' },
                     { v: x.ticket, clase: 'ticket', tip: miles(x.ticket) + ' con ticket de Modo Autónomo' },
                     { v: x.sin, clase: 'sin', tip: miles(x.sin) + ' sin reporte' }] };
             }), [['evento', REPORTES.evento], ['ticket', REPORTES.ticket], ['sin', REPORTES.sin]]) + '</div>';
        h += tablaHtml(a, {
            titulo: 'Por tipo de falla, en horario de tienda',
            columnas: [{ n: 'Falla', t: 'txt' }, { n: 'Fallas', t: 'int' }, { n: 'Horas', t: 'num1' }, { n: 'Con evento del IM', t: 'int' },
                       { n: 'Con ticket', t: 'int' }, { n: 'Sin reporte', t: 'int' }, { n: '% sin reporte', t: 'txt' }, { n: 'En el mes', t: 'int' }, { n: 'Sin reporte en el mes', t: 'int' }],
            filas: Object.keys(FALLAS).map(function (k) {
                var x = t[k];
                return [FALLAS[k], x.n, x.horas, x.evento, x.ticket, x.sin, pct(x.sin, x.n), x.mes, x.sinMes];
            }),
            nota: mes ? 'En el mes: ' + enElMes(m.corte).replace(/^en /, '') + '.' : ''
        });
        h += tablaHtml(a, {
            titulo: 'Lo que dice el log',
            columnas: [{ n: 'Falla', t: 'txt' }, { n: 'Causa en el log', t: 'txt' }, { n: 'Todas', t: 'int' }, { n: 'En horario', t: 'int' },
                       { n: 'Servidores', t: 'int' }, { n: 'Sin reporte', t: 'int' }],
            filas: s.causas.map(function (x) { return [FALLAS[x.tipo] || x.tipo, x.causa, x.total, x.enHorario, x.servidores, x.sinReporte]; }),
            nota: 'Todas: las del periodo a cualquier hora; en horario: las que cuentan arriba.'
        });

        // 2. Modo Autónomo con el servidor bien.
        var ley = [['apagado', PASOS.apagado], ['reinicio', PASOS.reinicio], ['corte', PASOS.corte], ['nada', PASOS.nada]];
        function filasPasos(l) {
            return l.filter(function (x) { return x.juzgados > 0; }).map(function (x) {
                return { e: x.nombre, texto: pct(x.conServidor, x.juzgados) + ' con falla · ' + miles(x.juzgados), seg: Object.keys(PASOS).map(function (k) {
                    return { v: x[k], clase: k, tip: miles(x[k]) + ' de ' + miles(x.juzgados) + ': ' + PASOS[k].toLowerCase() };
                }) };
            });
        }
        var frase = fraseServidorBien(s);
        h += '<div class="an-tabla"><h4>2. Modo Autónomo con el servidor bien</h4>' + (frase ? '<p>' + a.esc(frase) + '</p>' : '') +
             '<h5>Eventos de los IMs, por causa</h5>' + pilas(a, 'Eventos de los IMs: qué le pasó al servidor', filasPasos(s.porOrigen), null) +
             '<h5>Tickets que no llegan al IM, por motivo</h5>' + pilas(a, 'Tickets: qué le pasó al servidor', filasPasos(s.porMotivo), ley) + '</div>';
        h += tablaHtml(a, {
            titulo: 'Qué le pasó al servidor',
            columnas: [{ n: 'De dónde', t: 'txt' }, { n: 'Causa', t: 'txt' }, { n: 'Total', t: 'int' }, { n: 'Con log', t: 'int' }, { n: 'Se apagó', t: 'int' },
                       { n: 'Reinicio', t: 'int' }, { n: 'Perdió la red', t: 'int' }, { n: 'Siguió bien', t: 'int' }, { n: '% siguió bien', t: 'txt' }],
            filas: s.porOrigen.map(function (x) { return ['Evento del IM'].concat(filaPaso(x)); })
                .concat(s.porMotivo.map(function (x) { return ['Ticket'].concat(filaPaso(x)); })),
            nota: 'Solo se juzgan los eventos y tickets de cuando el log de su servidor ya alcanzaba (con log): ' + miles(s.eventosIMJuzgados) + ' de ' +
                  miles(s.eventosIM) + ' eventos del IM y ' + miles(s.incidentesJuzgados) + ' de ' + miles(s.incidentes) + ' incidentes.'
        });

        // 3. Tiendas y el detalle de lo que no se reportó.
        h += tablaHtml(a, {
            titulo: 'Tiendas donde el servidor más se cae',
            columnas: [{ n: 'Tienda', t: 'txt' }, { n: 'Sucursal', t: 'txt' }, { n: 'Estado', t: 'txt' }, { n: 'Apagados', t: 'int' }, { n: 'Cortes de red', t: 'int' },
                       { n: 'Sin reporte', t: 'int' }, { n: 'Eventos del IM', t: 'int' }, { n: 'Reinicios programados', t: 'int' }],
            filas: s.tiendas.slice(0, 20).map(function (x) { return [String(x.tienda), x.nombre, x.estado, x.apagado, x.corte, x.sin, x.eventosIM, x.reinicio]; }),
            nota: 'Apagados y cortes en horario de tienda; las primeras 20 de ' + miles(s.tiendas.length) + ' (el Excel trae todas las fallas).'
        });
        var sin = s.fallasLista.filter(function (x) { return x.reporte === 'sin'; }).reverse(), MAX = 100;
        h += tablaHtml(a, {
            titulo: 'Fallas sin reporte, de la más reciente',
            columnas: [{ n: 'Inicio', t: 'txt' }, { n: 'Tienda', t: 'txt' }, { n: 'Sucursal', t: 'txt' }, { n: 'Falla', t: 'txt' }, { n: 'Causa en el log', t: 'txt' }, { n: 'Minutos', t: 'int' }],
            filas: sin.slice(0, MAX).map(function (x) {
                return [x.inicio, x.tienda == null ? '—' : String(x.tienda), x.tiendaNombre, FALLAS[x.tipo] || x.tipo, x.causa, x.minutos == null ? '' : x.minutos];
            }),
            nota: (sin.length > MAX ? 'Aquí las primeras ' + MAX + ' de ' + miles(sin.length) + '; el Excel las trae todas. ' : '') +
                  (s.noAlcanzados ? miles(s.noAlcanzados) + ' servidores no se alcanzaron en la última lectura del portal.' : '')
        });
        return h;
    }
    function filaPaso(x) {
        return [x.nombre, x.total, x.juzgados, x.apagado, x.reinicio, x.corte, x.nada, pct(x.nada, x.juzgados)];
    }
    function panel(m, hoja, ruta, a) {
        ruta = ruta || {};
        if (hoja === 'Servidor') return panelServidor(m, a);
        if (hoja === 'Causas') return panelZoom(a, m.arbolEventos, ruta.Causas, 'Causas', 'eventos', true) +
            '<p class="nota">Los eventos que registran los incident managers en su Excel de críticos (Modo Autónomo, Sucursal Aislada y Servidor TDA). ' +
            'En una falla eléctrica el nivel 2 dice qué falló (la instalación, la planta, el UPS, lo que no levantó al volver la luz, o solo el corte) y el nivel 3, cómo.</p>';
        if (hoja === 'NoLlegan') return panelZoom(a, m.arbolIncidentes, ruta.NoLlegan, 'NoLlegan', 'incidentes', false) +
            '<p class="nota">Tickets de Modo Autónomo que no caen cerca de ningún evento del IM, juntados en incidentes (la misma tienda con menos de 6 horas entre uno y otro). ' +
            'El motivo es el que documentó quien lo resolvió; si no, lo que dijo la tienda; si tampoco, «probable falla eléctrica» (supuesto).</p>';
        if (hoja === 'Mes') return panelMes(a, m);
        if (hoja === 'Tiendas') return panelTiendas(m, a);
        if (hoja === 'Detalle') return panelDetalle(m, a);
        return '';
    }

    /* ------------------------------------------------------------------ Excel */
    function filasArbol(raiz, unidad) {
        var f = [];
        raiz.hijos.forEach(function (a) {
            if (!a.hijos.length) f.push([a.nombre, '', '', a.n, unidad === 'h' ? a.horas : a.tickets]);
            a.hijos.forEach(function (b) {
                if (!b.hijos.length) f.push([a.nombre, b.nombre, '', b.n, unidad === 'h' ? b.horas : b.tickets]);
                b.hijos.forEach(function (c) { f.push([a.nombre, b.nombre, c.nombre, c.n, unidad === 'h' ? c.horas : c.tickets]); });
            });
        });
        return f;
    }
    function armarLibro(m, ExcelJS) {
        var wb = new ExcelJS.Workbook();
        function hoja(nombre, enc, filas) {
            var ws = wb.addWorksheet(nombre);
            ws.addRow(enc).font = { bold: true };
            filas.forEach(function (f) { ws.addRow(f); });
            ws.columns.forEach(function (c, i) { c.width = Math.min(60, Math.max(10, String(enc[i] || '').length + 4)); });
            if (filas.length) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: enc.length } };
            return ws;
        }
        var r = wb.addWorksheet('Resumen');
        r.addRow(['Modo Autónomo · del ' + m.desde + ' al ' + m.hasta]).font = { bold: true };
        r.addRow(['Excel de críticos cargado el ' + (m.parametros.UltimaCargaExcel || '—') + ' · tickets clasificados el ' + (m.parametros.CargaTickets || '—')]);
        r.addRow([m.servidor.disponible ? 'Logs del servidor de tienda leídos el ' + (m.servidor.lectura || '—') + ' (Portal de Indicadores)'
                                        : 'Servidor de la tienda: no disponible (' + m.servidor.motivo + ')']);
        r.addRow([]);
        r.addRow(['', 'Periodo', '', m.corte.etiqueta]).font = { bold: true };
        kpis(m).forEach(function (k) { r.addRow([k[0], k[1], k[2], k[3].replace(/^[^:]*: /, '')]); });
        r.addRow([]);
        r.addRow(['Hallazgos']).font = { bold: true };
        m.hallazgos.forEach(function (h) { r.addRow([h]); });
        r.getColumn(1).width = 40; r.getColumn(2).width = 14; r.getColumn(3).width = 50; r.getColumn(4).width = 26;
        hoja('Causas de los IMs', ['Origen', 'Nivel 2', 'Nivel 3', 'Eventos', 'Horas'], filasArbol(m.arbolEventos, 'h'));
        hoja('No llegan al IM', ['Motivo', 'Nivel 2', 'Nivel 3', 'Incidentes', 'Tickets'], filasArbol(m.arbolIncidentes, 't'));
        hoja('Por mes', ['Mes', 'Eventos', 'Horas', 'Eléctricos', 'Incidentes sin IM', 'Sus tickets'],
             m.meses.map(function (x) { return [x.mes, x.eventos, Math.round(x.horas * 100) / 100, x.electricas, x.incidentes, x.tickets]; }));
        hoja('Tiendas', ['Tienda', 'Sucursal', 'Eventos', 'Horas', 'Causa principal', 'Incidentes sin IM', 'Sus tickets'],
             m.tiendas.map(function (x) { return [x.tienda, x.nombre, x.eventos, Math.round(x.horas * 100) / 100, x.principal, x.incidentes, x.tickets]; }));
        hoja('Eventos', ['Inicio', 'Tienda', 'Sucursal', 'Aplicación', 'Tipo', 'Origen', 'Detalle', 'Nivel 2', 'Nivel 3', 'Causa del IM', 'Respaldo no sostuvo', 'Horas', 'Alcance', 'Tickets en su ventana'],
             m.eventos.map(function (x) {
                 return [x.inicio, x.tienda, x.tiendaNombre, x.aplicacion, x.tipo, ORIGENES[x.n1] || x.n1, x.detalle, x.n2, x.n3, x.causaIM,
                         x.respaldo ? 'Sí' : 'No', x.horas, x.alcance, x.ticketsMA];
             }));
        hoja('Incidentes sin IM', ['Primer ticket', 'Tienda', 'Tickets', 'Motivo', 'De dónde sale', 'Nivel 2', 'Nivel 3', 'Alcance', 'Cerrado sin contactar', 'La tienda tuvo evento del IM'],
             m.incidentes.map(function (x) {
                 return [x.fecha, x.tienda, x.tickets, MOTIVOS[x.n1] || x.n1, FUENTES[x.fuente] || x.fuente, x.n2, x.n3, x.alcance,
                         x.sinContacto ? 'Sí' : 'No', x.tiendaConEventoIM ? 'Sí' : 'No'];
             }));
        var s = m.servidor;
        if (s.disponible) {
            var causaMA = function (k) { return ORIGENES[k] || MOTIVOS[k] || k; };
            hoja('Servidor por tipo', ['Falla', 'Fallas en horario', 'Horas', 'Con evento del IM', 'Con ticket', 'Sin reporte', 'En el mes', 'Sin reporte en el mes'],
                 Object.keys(FALLAS).map(function (k) { var x = s.porTipo[k]; return [FALLAS[k], x.n, x.horas, x.evento, x.ticket, x.sin, x.mes, x.sinMes]; }));
            hoja('Servidor y Modo Autónomo', ['De dónde', 'Causa', 'Total', 'Con log', 'Se apagó', 'Reinicio', 'Perdió la red', 'Siguió bien'],
                 s.porOrigen.map(function (x) { return ['Evento del IM'].concat(filaPaso(x).slice(0, 7)); })
                     .concat(s.porMotivo.map(function (x) { return ['Ticket'].concat(filaPaso(x).slice(0, 7)); })));
            hoja('Fallas del servidor', ['Inicio', 'Tienda', 'Sucursal', 'Estado', 'Falla', 'Causa en el log', 'Minutos', 'En horario (cuenta)', 'Reporte', 'Causa en Modo Autónomo'],
                 s.todas.map(function (x) {
                     return [x.inicio, x.tienda, x.tiendaNombre, x.estado, FALLAS[x.tipo] || x.tipo, x.causa, x.minutos, x.cuenta ? 'Sí' : 'No',
                             x.cuenta ? (REPORTES[x.reporte] || x.reporte) : '', x.causaMA ? causaMA(x.causaMA) : ''];
                 }));
            hoja('Modo Autónomo y su servidor', ['De dónde', 'Fecha', 'Tienda', 'Causa', 'Nivel 2', 'Qué le pasó al servidor', 'Causa en el log', 'Inicio de la falla'],
                 s.ma.map(function (x) {
                     return [x.fuente === 'im' ? 'Evento del IM' : 'Ticket', x.fecha, x.tienda, causaMA(x.causa), x.n2,
                             x.paso === 'sinlog' ? 'Sin log (no se juzga)' : (PASOS[x.paso] || x.paso), x.pasoCausa, x.pasoInicio];
                 }));
            hoja('Servidores', ['Servidor', 'Tienda', 'Sucursal', 'Estado', 'Log desde', 'Red desde', 'Alcanzado en la última lectura'],
                 s.servidores.map(function (x) { return [x.servidor, x.tienda, x.tiendaNombre, x.estado, x.logDesde, x.redDesde, x.alcanzado ? 'Sí' : 'No']; }));
        }
        return wb;
    }

    return {
        SERVICIO: SERVICIO, HOJAS: HOJAS, SIN_DETALLE: SIN_DETALLE, ORIGENES: ORIGENES, MOTIVOS: MOTIVOS,
        modelo: modelo, buscar: buscar, kpis: kpis, panel: panel, armarLibro: armarLibro
    };
});
