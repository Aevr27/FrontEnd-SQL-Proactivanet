/* =========================================================================
   qa_test.js

   Tablero de QA. Toda la informacion viene de qa.ashx, que la consulta en
   vivo a SQL Server. El navegador nunca habla con la base: no conoce el
   servidor, ni el usuario, ni la cadena de conexion (viven en Web.config,
   del lado del servidor).

   Ventana de datos: los ultimos 15 dias, la misma de usp_CorreoQA_Kpis, para
   que el tablero y el correo diario de QA cuadren.

   Peticiones:
     - carga inicial : qa.ashx?action=summary            (~10 KB)
     - detalle       : qa.ashx?action=detail&...         (solo al pedirlo)
     - QARE completo : qa.ashx?action=qare               (solo si hay que
                       mostrar una distribucion de respuestas)
     - catalogos     : nunca en este prototipo

   Regla de datos: lo que el API no trae, no se calcula aqui. No existe
   ninguna metrica de cumplimiento QARE porque la formula oficial aun no
   esta definida.
   ========================================================================= */

(function () {
  'use strict';

  var API = 'handlers/qa.ashx';
  var TECNICOS_TOPE = 15;   // el resto se ve con "ver todos"

  var NUM = new Intl.NumberFormat('es-MX');
  var NUM2 = new Intl.NumberFormat('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  // Paleta alineada con dashboard.css.
  var COLOR = {
    azul: '#2563eb', azulOscuro: '#1d4ed8', verde: '#059669',
    rojo: '#dc2626', ambar: '#d97706', morado: '#7c3aed',
    cyan: '#0891b2', gris: '#94a3b8'
  };

  // Color por estado de validacion. Un estado que no este en la lista recibe
  // un color neutro, pero conserva su nombre: nunca se agrupa con otro.
  var COLOR_VALIDACION = {
    'OK': COLOR.verde,
    'Incorrecto': COLOR.rojo,
    'Valido': COLOR.cyan,
    'Sin catalogo': COLOR.ambar
  };

  var estado = {
    resumen: null,
    qareCompleto: null,
    tecnicosCompletos: false,
    filtros: { validacion: 'Incorrecto', grupo: null, tecnico: null, grupoCorrecto: null },
    pagina: 1,
    tamano: 100,
    total: 0,
    detalleAbierto: false,
    peticionDetalle: 0,
    peticionResumen: 0
  };

  var graficas = { grupo: null, tecnico: null, validacion: null };

  // ---------------------------------------------------------------- utiles
  function $(id) { return document.getElementById(id); }

  function esc(valor) {
    if (valor === null || valor === undefined) return '';
    return String(valor)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // Un nulo del origen se muestra como nulo, no se sustituye por un valor real.
  function celdaNula(texto) {
    return '<span class="nulo">' + esc(texto) + '</span>';
  }

  function fechaCorta(iso) {
    if (!iso || typeof iso !== 'string') return null;
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
    return m ? m[3] + '/' + m[2] + '/' + m[1] : null;
  }

  function fechaHora(iso) {
    if (!iso || typeof iso !== 'string') return '';
    var m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}:\d{2})/.exec(iso);
    if (m) return m[3] + '/' + m[2] + '/' + m[1] + ' ' + m[4];
    return fechaCorta(iso) || iso;
  }

  function recortar(texto, tope) {
    if (texto === null || texto === undefined) return '';
    texto = String(texto);
    return texto.length > tope ? texto.slice(0, tope - 1) + '…' : texto;
  }

  // ------------------------------------------------------------------ API
  // Mensajes de error siempre en terminos de usuario: nada de rutas, stacks
  // ni detalles del servidor, vengan de donde vengan.
  function pedir(parametros) {
    var url = API + '?' + Object.keys(parametros)
      .filter(function (k) { return parametros[k] !== null && parametros[k] !== undefined && parametros[k] !== ''; })
      .map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(parametros[k]); })
      .join('&');

    return fetch(url, { headers: { 'Accept': 'application/json' }, cache: 'no-store' })
      .then(function (respuesta) {
        return respuesta.text().then(function (texto) {
          var datos = null;
          if (texto && texto.trim() !== '') {
            try { datos = JSON.parse(texto); }
            catch (e) { datos = null; }
          }

          if (!respuesta.ok) {
            // El handler responde su propio JSON de error; si llega otra cosa
            // (por ejemplo una pagina HTML de IIS), se usa un texto generico.
            var msg = (datos && typeof datos.message === 'string')
              ? datos.message
              : 'El servidor respondio con el codigo ' + respuesta.status + '.';
            throw new Error(msg);
          }
          if (datos === null) {
            throw new Error('La respuesta del servidor llego vacia o con un formato no valido.');
          }
          if (datos && datos.error === true) {
            throw new Error(typeof datos.message === 'string' ? datos.message : 'El servidor reporto un error.');
          }
          return datos;
        });
      })
      .catch(function (err) {
        if (err instanceof TypeError) {
          throw new Error('No se pudo contactar a qa.ashx. Revisa que el sitio este publicado y en ejecucion.');
        }
        throw err;
      });
  }

  // -------------------------------------------------------------- resumen
  function cargarResumen() {
    $('cargando').hidden = false;
    $('error-global').hidden = true;
    $('tablero').hidden = true;

    // qa.ashx solo existe si un servidor lo ejecuta. Abierta desde el disco la
    // pagina no tiene origen HTTP, el fetch muere en CORS y el usuario solo ve
    // el spinner: mejor decirlo aqui.
    if (location.protocol !== 'http:' && location.protocol !== 'https:') {
      $('cargando').hidden = true;
      $('tablero').hidden = true;
      $('error-global-msg').textContent =
        'Esta pagina necesita el servidor: abrela en ' +
        'http://localhost:8080/qa_test.html (la publica dev-qa.cmd) o en el sitio ' +
        'publicado en IIS. Los datos se consultan a la base desde el servidor, no ' +
        'desde el navegador.';
      $('error-global').hidden = false;
      return;
    }

    // Si el usuario recarga varias veces seguidas, solo la ultima peticion
    // puede tocar la pantalla: una respuesta vieja que llegue tarde no debe
    // reactivar el spinner ni el mensaje de error.
    var token = ++estado.peticionResumen;

    pedir({ action: 'summary' })
      .then(function (datos) {
        if (token !== estado.peticionResumen) return;
        if (!datos.summary || !datos.source) {
          throw new Error('La respuesta no contiene la informacion de resumen esperada.');
        }
        estado.resumen = datos;
        estado.qareCompleto = null;
        pintarTablero(datos);
        $('cargando').hidden = true;
        $('error-global').hidden = true;
        $('tablero').hidden = false;
      })
      .catch(function (err) {
        if (token !== estado.peticionResumen) return;
        $('cargando').hidden = true;
        $('tablero').hidden = true;
        $('error-global-msg').textContent = err.message;
        $('error-global').hidden = false;
      });
  }

  function pintarTablero(datos) {
    pintarOrigen(datos);
    pintarKpis(datos.summary, datos.historico);
    pintarGrupo(datos.porGrupo || []);
    pintarTecnico(datos.porTecnico || []);
    pintarValidacion(datos.validacion || []);
    pintarRecategorizacion(datos.recategorizacion || []);
    pintarQare(datos.qare);
  }

  // El bloque "source" describe de donde salieron los datos y que ventana
  // cubren. Deliberadamente no trae servidor, base ni usuario: esto lo ve el
  // navegador.
  function pintarOrigen(datos) {
    var src = datos.source || {};
    var desde = fechaCorta(src.fechaInicio);
    var hasta = fechaCorta(src.fechaFin);

    $('chip-fecha').textContent = (desde && hasta)
      ? 'Datos QA: ' + desde + ' – ' + hasta
      : 'Datos QA: sin rango informado';

    var partes = [];
    partes.push('Origen: ' + (src.origen || 'no informado'));
    if (src.ticketsRows !== null && src.ticketsRows !== undefined) {
      partes.push(NUM.format(src.ticketsRows) + ' tickets en el rango');
    }
    $('sub-fuente').textContent = partes.join(' · ');

    var pie = [];
    if (src.vista) pie.push('Vista: ' + src.vista);
    if (desde && hasta) pie.push('Rango: ' + desde + ' – ' + hasta);
    if (src.consultadoEn) pie.push('Consultado: ' + fechaHora(src.consultadoEn));
    $('pie-fuente').textContent = pie.join(' · ');
  }

  // ----------------------------------------------------------------- KPIs
  function tarjeta(clase, titulo, valor, nota) {
    return '<div class="kpi ' + clase + '">' +
      '<div class="kpi-tit">' + esc(titulo) + '</div>' +
      '<div class="kpi-val">' + esc(valor) + '</div>' +
      (nota ? '<div class="kpi-nota">' + esc(nota) + '</div>' : '') +
      '</div>';
  }

  function pintarKpis(resumen, historico) {
    var total = resumen.totalTickets;
    var incorrectos = resumen.incorrectos;
    var pct = resumen.incorrectosPct;

    var html = '';
    html += tarjeta('kpi-azul', 'Total tickets',
      total === undefined ? 'n/d' : NUM.format(total), 'Suma ultimos 15 dias');
    html += tarjeta('kpi-rojo', 'Tickets incorrectos',
      incorrectos === undefined ? 'n/d' : NUM.format(incorrectos), 'Validacion = Incorrecto (suma 15 dias)');
    html += tarjeta('kpi-ambar', '% incorrectos',
      pct === undefined ? 'n/d' : NUM2.format(pct) + '%', 'Sobre el total del rango');

    // Un solo dia cada uno, contado por fecha de firma de solucion. Se omiten
    // si el reporte no trae esa columna.
    if (historico) {
      html += tarjeta('kpi-rojo', 'Incorrectos ayer',
        historico.incorrectosAyer === undefined
          ? 'n/d' : NUM.format(historico.incorrectosAyer),
        fechaCorta(historico.fechaAyer));
      html += tarjeta('kpi-azul', 'Incorrectos semana anterior',
        historico.incorrectosSemanaAnterior === undefined
          ? 'n/d' : NUM.format(historico.incorrectosSemanaAnterior),
        fechaCorta(historico.fechaSemanaAnterior));
    }

    $('kpis').innerHTML = html;
  }

  // ------------------------------------------------------------- graficas
  function altoLienzo(n) { return Math.max(240, n * 26 + 64) + 'px'; }

  function barrasHorizontales(canvasId, etiquetas, valores, color, alClic) {
    var ctx = $(canvasId).getContext('2d');
    return new Chart(ctx, {
      type: 'bar',
      data: {
        labels: etiquetas,
        datasets: [{
          data: valores,
          backgroundColor: color,
          hoverBackgroundColor: COLOR.azulOscuro,
          borderRadius: 3,
          barPercentage: .82,
          categoryPercentage: .86
        }]
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 220 },
        layout: { padding: { right: 26 } },
        onClick: function (evento, elementos) {
          if (alClic && elementos.length) alClic(etiquetas[elementos[0].index]);
        },
        onHover: function (evento, elementos) {
          if (alClic) evento.native.target.style.cursor = elementos.length ? 'pointer' : 'default';
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: function (item) { return NUM.format(item.parsed.x) + ' tickets'; }
            }
          },
          // Valor al final de cada barra, sin plugins externos.
          etiquetasValor: {}
        },
        scales: {
          x: {
            beginAtZero: true,
            ticks: { precision: 0, color: '#64748b' },
            grid: { color: '#eef2f7' }
          },
          y: {
            ticks: {
              color: '#334155', autoSkip: false, font: { size: 11.5 },
              callback: function (valor) { return recortar(this.getLabelForValue(valor), 42); }
            },
            grid: { display: false }
          }
        }
      },
      plugins: [pluginValores]
    });
  }

  // Dibuja el valor al final de la barra. Chart.js no lo trae de serie y no
  // vale la pena sumar otra dependencia por esto.
  var pluginValores = {
    id: 'etiquetasValor',
    afterDatasetsDraw: function (chart) {
      var ctx = chart.ctx;
      ctx.save();
      ctx.font = '600 11px "Segoe UI", Roboto, Arial, sans-serif';
      ctx.fillStyle = '#334155';
      ctx.textBaseline = 'middle';
      chart.getDatasetMeta(0).data.forEach(function (barra, i) {
        var valor = chart.data.datasets[0].data[i];
        ctx.fillText(NUM.format(valor), barra.x + 6, barra.y);
      });
      ctx.restore();
    }
  };

  function pintarGrupo(filas) {
    var lienzo = $('lienzo-grupo');
    if (!filas.length) {
      lienzo.innerHTML = '<div class="vacio">No hay grupos con tickets incorrectos en este rango.</div>';
      $('hint-grupo').textContent = '';
      return;
    }
    var orden = filas.slice().sort(function (a, b) { return b.tickets - a.tickets; });
    $('hint-grupo').textContent = orden.length + ' grupos';
    lienzo.style.height = altoLienzo(orden.length);

    if (graficas.grupo) graficas.grupo.destroy();
    graficas.grupo = barrasHorizontales(
      'chart-grupo',
      orden.map(function (f) { return f.grupo === null ? '(sin grupo)' : f.grupo; }),
      orden.map(function (f) { return f.tickets; }),
      COLOR.azul,
      function (etiqueta) {
        if (etiqueta === '(sin grupo)') return;
        aplicarFiltro('grupo', etiqueta);
      }
    );
  }

  function pintarTecnico(filas) {
    var lienzo = $('lienzo-tecnico');
    var boton = $('btn-tecnicos-todos');
    if (!filas.length) {
      lienzo.innerHTML = '<div class="vacio">No hay tecnicos con tickets incorrectos en este rango.</div>';
      $('hint-tecnico').textContent = '';
      boton.hidden = true;
      return;
    }

    var orden = filas.slice().sort(function (a, b) { return b.tickets - a.tickets; });
    var visibles = estado.tecnicosCompletos ? orden : orden.slice(0, TECNICOS_TOPE);

    $('hint-tecnico').textContent = estado.tecnicosCompletos
      ? orden.length + ' tecnicos'
      : 'top ' + visibles.length + ' de ' + orden.length;

    boton.hidden = orden.length <= TECNICOS_TOPE;
    boton.textContent = estado.tecnicosCompletos ? 'Ver solo el top ' + TECNICOS_TOPE : 'Ver los ' + orden.length;

    lienzo.style.height = altoLienzo(visibles.length);

    if (graficas.tecnico) graficas.tecnico.destroy();
    graficas.tecnico = barrasHorizontales(
      'chart-tecnico',
      visibles.map(function (f) { return f.tecnico; }),
      visibles.map(function (f) { return f.tickets; }),
      COLOR.morado,
      function (etiqueta) { aplicarFiltro('tecnico', etiqueta); }
    );
  }

  function pintarValidacion(filas) {
    if (!filas.length) {
      $('leyenda-validacion').innerHTML = '<div class="vacio">Sin datos de validacion.</div>';
      return;
    }
    var etiquetas = filas.map(function (f) { return f.validacion === null ? '(sin valor)' : f.validacion; });
    var valores = filas.map(function (f) { return f.tickets; });
    var colores = etiquetas.map(function (e) { return COLOR_VALIDACION[e] || COLOR.gris; });
    var total = valores.reduce(function (a, b) { return a + b; }, 0);

    $('hint-validacion').textContent = etiquetas.length + ' estados';

    if (graficas.validacion) graficas.validacion.destroy();
    graficas.validacion = new Chart($('chart-validacion').getContext('2d'), {
      type: 'doughnut',
      data: { labels: etiquetas, datasets: [{ data: valores, backgroundColor: colores, borderWidth: 2, borderColor: '#fff' }] },
      options: {
        responsive: true, maintainAspectRatio: false, cutout: '58%',
        // La dona tambien filtra: clic en un estado = detalle de ese estado.
        onClick: function (evento, elementos) {
          if (elementos.length) {
            var etiqueta = etiquetas[elementos[0].index];
            if (etiqueta !== '(sin valor)') aplicarFiltro('validacion', etiqueta);
          }
        },
        onHover: function (evento, elementos) {
          evento.native.target.style.cursor = elementos.length ? 'pointer' : 'default';
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: function (item) {
                var pct = total ? (item.parsed * 100 / total) : 0;
                return item.label + ': ' + NUM.format(item.parsed) + ' (' + NUM2.format(pct) + '%)';
              }
            }
          }
        }
      }
    });

    // Leyenda propia: los cuatro estados se listan por separado, nunca se
    // agrupa "Valido" con "OK" ni "Sin catalogo" con "Incorrecto".
    $('leyenda-validacion').innerHTML = filas.map(function (f, i) {
      var pct = f.pct !== undefined ? f.pct : (total ? f.tickets * 100 / total : 0);
      return '<span class="leyenda-item">' +
        '<span class="swatch" style="background:' + colores[i] + '"></span>' +
        esc(etiquetas[i]) +
        ' <span class="leyenda-val">' + NUM.format(f.tickets) + '</span>' +
        ' <span class="leyenda-pct">(' + NUM2.format(pct) + '%)</span></span>';
    }).join('');
  }

  function pintarRecategorizacion(filas) {
    var cuerpo = $('tbody-recat');
    if (!filas.length) {
      cuerpo.innerHTML = '<tr><td colspan="3" class="vacio">Sin pares de recategorizacion.</td></tr>';
      $('hint-recat').textContent = '';
      return;
    }
    var orden = filas.slice().sort(function (a, b) { return b.tickets - a.tickets; });
    $('hint-recat').textContent = orden.length + ' pares';

    cuerpo.innerHTML = orden.map(function (f) {
      // grupoCorrecto nulo en el origen = el ticket no tiene grupo correcto
      // asignado. Se rotula como tal y se deja claro que viene vacio.
      var correcto = (f.grupoCorrecto === null || f.grupoCorrecto === undefined || f.grupoCorrecto === '')
        ? celdaNula('Sin grupo correcto')
        : esc(f.grupoCorrecto);
      return '<tr>' +
        '<td>' + (f.grupo === null ? celdaNula('(sin grupo)') : esc(f.grupo)) + '</td>' +
        '<td>' + correcto + '</td>' +
        '<td class="num">' + NUM.format(f.tickets) + '</td>' +
        '</tr>';
    }).join('');
  }

  // ----------------------------------------------------------------- QARE
  function pintarQare(qare) {
    var cuerpo = $('tbody-qare');
    if (!qare || !qare.campos || !qare.campos.length) {
      cuerpo.innerHTML = '<tr><td colspan="5" class="vacio">El origen no contiene campos QARE.</td></tr>';
      $('nota-qare').textContent = '';
      return;
    }

    // La nota la escribe el extractor; se muestra literal.
    $('nota-qare').textContent = qare.nota || '';
    $('pie-qare').textContent =
      'Se muestran los contadores tal como salen de la base. No se calcula ningun porcentaje ' +
      'de cumplimiento QARE: la regla oficial todavia no esta definida.';

    cuerpo.innerHTML = qare.campos.map(function (campo, i) {
      var distribucion;
      if (campo.tieneDistribucion) {
        distribucion = '<button type="button" class="enlace" data-qare="' + i + '">Ver respuestas</button>';
      } else if (campo.respondidos === 0) {
        distribucion = celdaNula('Sin respuestas');
      } else {
        distribucion = celdaNula('Texto libre');
      }
      return '<tr>' +
        '<td>' + esc(campo.campo) + '</td>' +
        '<td class="num">' + NUM.format(campo.respondidos || 0) + '</td>' +
        '<td class="num">' + NUM.format(campo.sinRespuesta || 0) + '</td>' +
        '<td class="num">' + NUM.format(campo.valoresDistintos || 0) + '</td>' +
        '<td id="qare-dist-' + i + '">' + distribucion + '</td>' +
        '</tr>';
    }).join('');

    cuerpo.querySelectorAll('button[data-qare]').forEach(function (boton) {
      boton.addEventListener('click', function () { verDistribucion(Number(boton.getAttribute('data-qare'))); });
    });
  }

  // action=qare solo se pide si el usuario abre una distribucion, y una sola
  // vez por carga del tablero.
  function verDistribucion(indice) {
    var celda = $('qare-dist-' + indice);
    celda.textContent = 'Cargando…';

    var promesa = estado.qareCompleto
      ? Promise.resolve(estado.qareCompleto)
      : pedir({ action: 'qare' }).then(function (datos) { estado.qareCompleto = datos; return datos; });

    promesa.then(function (datos) {
      var campo = datos && datos.qare && datos.qare.campos ? datos.qare.campos[indice] : null;
      var respuestas = campo && campo.respuestas;
      if (!respuestas || !respuestas.length) {
        celda.innerHTML = celdaNula('Sin distribucion');
        return;
      }
      celda.innerHTML = respuestas.map(function (r) {
        return '<div>' + esc(r.respuesta) + ' <strong>' + NUM.format(r.tickets) + '</strong></div>';
      }).join('');
    }).catch(function (err) {
      celda.innerHTML = '<span class="nulo">' + esc(err.message) + '</span>';
    });
  }

  // -------------------------------------------------------------- detalle
  function aplicarFiltro(nombre, valor) {
    estado.filtros[nombre] = valor;
    estado.pagina = 1;
    cargarDetalle();
    $('detalle-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function pintarFiltros() {
    var etiquetas = {
      validacion: 'Validacion', grupo: 'Grupo',
      tecnico: 'Tecnico', grupoCorrecto: 'Grupo correcto'
    };
    var html = Object.keys(etiquetas)
      .filter(function (k) { return estado.filtros[k]; })
      .map(function (k) {
        return '<span class="filtro">' + esc(etiquetas[k]) + ': ' + esc(estado.filtros[k]) +
          ' <button type="button" data-quitar="' + k + '" title="Quitar filtro">&times;</button></span>';
      }).join('');

    var caja = $('filtros-activos');
    caja.innerHTML = html || '<span class="hint">Sin filtros: se listan todos los tickets del rango, paginados.</span>';
    caja.querySelectorAll('button[data-quitar]').forEach(function (boton) {
      boton.addEventListener('click', function () {
        estado.filtros[boton.getAttribute('data-quitar')] = null;
        estado.pagina = 1;
        cargarDetalle();
      });
    });
  }

  function cargarDetalle() {
    estado.detalleAbierto = true;
    pintarFiltros();

    $('detalle-cargando').hidden = false;
    $('detalle-error').hidden = true;

    var token = ++estado.peticionDetalle;

    pedir({
      action: 'detail',
      validacion: estado.filtros.validacion,
      grupo: estado.filtros.grupo,
      tecnico: estado.filtros.tecnico,
      grupoCorrecto: estado.filtros.grupoCorrecto,
      page: estado.pagina,
      pageSize: estado.tamano
    }).then(function (datos) {
      if (token !== estado.peticionDetalle) return;   // respuesta vieja, se ignora
      $('detalle-cargando').hidden = true;
      pintarDetalle(datos);
      $('detalle-panel').hidden = false;
    }).catch(function (err) {
      if (token !== estado.peticionDetalle) return;
      $('detalle-cargando').hidden = true;
      $('detalle-error-msg').textContent = err.message;
      $('detalle-error').hidden = false;
    });
  }

  function pintarDetalle(datos) {
    var filas = datos.rows || [];
    estado.total = datos.total || 0;
    estado.pagina = datos.page || 1;

    var desde = estado.total === 0 ? 0 : (estado.pagina - 1) * estado.tamano + 1;
    var hasta = (estado.pagina - 1) * estado.tamano + filas.length;
    var paginas = estado.tamano > 0 ? Math.max(1, Math.ceil(estado.total / estado.tamano)) : 1;

    $('paginacion-txt').textContent =
      estado.total === 0
        ? 'Sin resultados para el filtro actual'
        : NUM.format(desde) + '–' + NUM.format(hasta) + ' de ' + NUM.format(estado.total) +
          ' tickets · pagina ' + estado.pagina + ' de ' + paginas;

    $('btn-prev').disabled = estado.pagina <= 1;
    $('btn-next').disabled = estado.pagina >= paginas;
    $('hint-detalle').textContent = NUM.format(estado.total) + ' tickets filtrados';

    var cuerpo = $('tbody-detalle');
    if (!filas.length) {
      cuerpo.innerHTML = '<tr><td colspan="8" class="vacio">Ningun ticket coincide con el filtro.</td></tr>';
      return;
    }

    // Los nombres de columna son los del workbook original; el prototipo los
    // lee tal cual, sin renombrar nada.
    cuerpo.innerHTML = filas.map(function (t) {
      var correcto = (t['Grupo Correcto'] === null || t['Grupo Correcto'] === undefined || t['Grupo Correcto'] === '')
        ? celdaNula('Sin grupo correcto')
        : esc(t['Grupo Correcto']);
      var validacion = t['Validacion'] || '';
      var clase = validacion === 'Incorrecto' ? 'badge badge-rojo' : 'badge badge-gris';

      return '<tr>' +
        '<td>' + esc(t['Código']) + '</td>' +
        '<td>' + esc(fechaHora(t['Fecha de registro'])) + '</td>' +
        '<td class="recorte" title="' + esc(t['Título']) + '">' + esc(recortar(t['Título'], 70)) + '</td>' +
        '<td>' + esc(t['Grupo']) + '</td>' +
        '<td>' + esc(t['Técnico de 2ª línea']) + '</td>' +
        '<td class="recorte" title="' + esc(t['Categoría']) + '">' + esc(recortar(t['Categoría'], 60)) + '</td>' +
        '<td>' + correcto + '</td>' +
        '<td><span class="' + clase + '">' + esc(validacion) + '</span></td>' +
        '</tr>';
    }).join('');
  }

  // ------------------------------------------------------------- arranque
  function conectarEventos() {
    $('btn-recargar').addEventListener('click', function () {
      estado.detalleAbierto = false;
      $('detalle-panel').hidden = true;
      cargarResumen();
    });
    $('btn-reintentar').addEventListener('click', cargarResumen);

    $('btn-detalle').addEventListener('click', function () {
      estado.filtros = { validacion: 'Incorrecto', grupo: null, tecnico: null, grupoCorrecto: null };
      estado.pagina = 1;
      cargarDetalle();
    });

    $('sel-tam').addEventListener('change', function () {
      estado.tamano = Number(this.value) || 100;
      estado.pagina = 1;
      if (estado.detalleAbierto) cargarDetalle();
    });

    $('btn-prev').addEventListener('click', function () {
      if (estado.pagina > 1) { estado.pagina--; cargarDetalle(); }
    });
    $('btn-next').addEventListener('click', function () {
      estado.pagina++; cargarDetalle();
    });

    $('btn-tecnicos-todos').addEventListener('click', function () {
      estado.tecnicosCompletos = !estado.tecnicosCompletos;
      pintarTecnico(estado.resumen.porTecnico || []);
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    conectarEventos();
    cargarResumen();
  });
})();
