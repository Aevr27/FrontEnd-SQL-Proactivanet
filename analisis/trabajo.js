/* =========================================================================
   analisis/trabajo.js

   La parte pesada de la pestaña "Análisis de servicios": leer el JSON de
   analisis.ashx, Motor.preparar() y Motor.analizar(). Corre en un Web Worker
   para que la página no se congele con un servicio grande; analisis.js la
   pinta con lo que devuelve.

   El mismo archivo sirve de dos formas:
     - como Worker (new Worker('trabajo.js')): carga motor.js con
       importScripts y contesta mensajes {id, tipo, ...};
     - como <script> normal, si el navegador no pudo levantar el Worker:
       solo deja window.AnalisisTrabajo y analisis.js lo llama directo.
   Asi la logica vive en un solo lugar. El analisis es el de motor.js, sin
   cambios: aqui solo se decide DONDE corre.
   ========================================================================= */
(function (raiz) {
  'use strict';

  function ahora() { return typeof performance !== 'undefined' ? performance.now() : Date.now(); }

  // Guarda los tickets ya preparados entre una corrida y otra: "Probar
  // reglas" reclasifica sin volver a leer ni a preparar.
  function AnalisisTrabajo(Motor) {
    this.M = Motor;
    this.datos = null;
  }

  // cuerpo: el ArrayBuffer de la respuesta de analisis.ashx, tal cual.
  // Devuelve lo que la página necesita de la respuesta, sin los tickets.
  AnalisisTrabajo.prototype.cargar = function (cuerpo, avisar) {
    var M = this.M, t0 = ahora();
    avisar('Preparando tickets…');
    var resp = JSON.parse(new TextDecoder('utf-8').decode(cuerpo)), t1 = ahora();
    var datos = M.preparar(M.bloquesDeTablero(resp)), t2 = ahora();
    if (datos.error) throw new Error(datos.error);
    this.datos = datos;
    var b = resp.bloques || {};
    return {
      respuesta: { servicio: resp.servicio, desde: resp.desde, hasta: resp.hasta, bloques: { parametros: b.parametros } },
      reglas: M.reglasDeTablero(resp),
      tickets: datos.tickets.length,
      ms: { lectura: t1 - t0, preparacion: t2 - t1 }
    };
  };

  // servicio: {nombre, reglas, motivosEquipo}, como lo pide Motor.analizar.
  AnalisisTrabajo.prototype.analizar = function (servicio, avisar) {
    if (!this.datos) throw new Error('No hay tickets cargados.');
    avisar('Analizando…');
    var t0 = ahora(), resultado = this.M.analizar(this.datos, servicio, { conTextos: true });
    return { resultado: resultado, ms: { analisis: ahora() - t0 } };
  };

  var enWorker = typeof WorkerGlobalScope !== 'undefined' && raiz instanceof WorkerGlobalScope;
  if (!enWorker) { raiz.AnalisisTrabajo = AnalisisTrabajo; return; }

  importScripts('motor.js');
  var trabajo = new AnalisisTrabajo(raiz.Motor);
  raiz.onmessage = function (e) {
    var m = e.data, avisar = function (txt) { raiz.postMessage({ id: m.id, aviso: txt }); };
    try {
      var r = m.tipo === 'cargar' ? trabajo.cargar(m.cuerpo, avisar) : trabajo.analizar(m.servicio, avisar);
      raiz.postMessage({ id: m.id, ok: r });
    } catch (err) {
      raiz.postMessage({ id: m.id, error: (err && err.message) || String(err) });
    }
  };
})(typeof self !== 'undefined' ? self : this);
