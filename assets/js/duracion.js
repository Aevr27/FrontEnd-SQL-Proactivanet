/* =========================================================================
   DURACION EN MESES / SEMANAS / DIAS — una sola copia para todo el tablero.

   La Antiguedad de una iniciativa llega del servidor como numero entero de
   dias desde dbo.Problem.FechaCreacion (ExperienciaQueries.DiasDesde). El
   dato sigue siendo ese entero -ordenar, filtrar y exportar lo usan tal
   cual-; esto solo cambia COMO SE LEE al pintarlo.

   Un mes son 30 dias, la misma convencion que el SLOT de Experiencia
   ("30 dias c/u"): asi la cifra no depende de que mes toco y la suma de las
   partes vuelve siempre a los dias exactos. Las partes en cero no salen.

     Duracion.dias(125)               // "4 meses y 5 días"
     Duracion.dias(45)                // "1 mes, 2 semanas y 1 día"
     Duracion.dias(0)                 // "0 días"
     Duracion.dias(45, { corto: true }) // "1 m 2 sem 1 d"  (celdas de tabla)
     Duracion.dias(null)              // ""  (quien llama pone su guion)

   DONDE SE CARGA: dashboard.html, experiencia.html y admin/iniciativas.html.
   Embebida en dashboard.html, Experiencia pierde sus <script> y usa la copia
   de alli, igual que Escape y Paleta.
   ========================================================================= */
(function (raiz) {
  'use strict';

  var DIAS_MES = 30;
  var DIAS_SEMANA = 7;

  function plural(n, uno, varios) { return n + ' ' + (n === 1 ? uno : varios); }

  function dias(valor, opciones) {
    if (valor === null || valor === undefined || valor === '') return '';
    var total = Math.floor(Number(valor));
    if (!isFinite(total)) return '';
    var corto = !!(opciones && opciones.corto);
    var signo = total < 0 ? '-' : '';
    total = Math.abs(total);

    var meses = Math.floor(total / DIAS_MES);
    var resto = total % DIAS_MES;
    var semanas = Math.floor(resto / DIAS_SEMANA);
    var d = resto % DIAS_SEMANA;

    var partes = [];
    if (corto) {
      if (meses) partes.push(meses + ' m');
      if (semanas) partes.push(semanas + ' sem');
      if (d || !partes.length) partes.push(d + ' d');
      return signo + partes.join(' ');
    }
    if (meses) partes.push(plural(meses, 'mes', 'meses'));
    if (semanas) partes.push(plural(semanas, 'semana', 'semanas'));
    if (d || !partes.length) partes.push(plural(d, 'día', 'días'));
    var texto = partes.length > 1
      ? partes.slice(0, -1).join(', ') + ' y ' + partes[partes.length - 1]
      : partes[0];
    return signo + texto;
  }

  raiz.Duracion = { dias: dias };
})(typeof window !== 'undefined' ? window : this);
