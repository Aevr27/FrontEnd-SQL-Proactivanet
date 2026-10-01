/* =========================================================================
   admin/cascada-organizacional.js

   CascadaOrganizacional: Product Owner -> Service Owner -> Categoria sobre
   las asignaciones vigentes de dbo.CatCategoriaDueno (las que entrega
   handlers/admin_iniciativas_catalogos.ashx, DirectorioOrganizacional
   .AsignacionesVigentes). Es la UNICA implementacion de la cascada en
   admin/: cualquier pestaña que necesite PO / SO / Categoria crea una
   instancia de esta clase en vez de filtrar por su cuenta.

   No hay arbol de personas: cada nivel ofrece los valores de las filas que
   cumplen TODO lo elegido arriba, asi que cualquier combinacion lleva a una
   categoria real. Elegir un nivel limpia los de abajo; un valor que no esta
   entre las opciones validas no se acepta.

   DOS MODOS (la regla de filtrado es la misma en los dos)
   ---------------------------------------------------------
     'creacion'  (por omision) "Nueva solicitud": hay que elegir los tres
                 niveles en orden; un nivel sin padre elegido queda
                 bloqueado, y al completar se deriva el Director.
     'filtro'    para listas: cada nivel es opcional ("Todos"). Un nivel sin
                 padre elegido ofrece todo lo que permiten los niveles de
                 arriba que si se eligieron; filtros() da lo elegido para la
                 consulta del servidor.

   La Categoria es la CategoriaN2 de CatCategoriaDueno, no la ruta completa
   de dbo.ProblemCategoria / Tickets. Esta clase no resuelve ese cruce.

   Se prueba en node: tools/tests/CascadaOrganizacionalSmoke.js y, la parte
   de creacion, tools/tests/IniciativasCascadaSmoke.js.
   ========================================================================= */
window.CascadaOrganizacional = (function () {
  'use strict';

  function igualTexto(a, b) { return a < b ? -1 : a > b ? 1 : 0; }

  var MODOS = {
    creacion: { nivelesLibres: false },
    filtro:   { nivelesLibres: true }
  };

  class CascadaOrganizacional {
    // `filas`: [{ director, po, so, categoria }]. `modo`: 'creacion' |
    // 'filtro'; cualquier otro valor lanza.
    constructor(filas, modo) {
      modo = modo || 'creacion';
      if (!Object.prototype.hasOwnProperty.call(MODOS, modo)) {
        throw new Error('Modo de cascada desconocido: ' + modo);
      }
      this.filas = filas;
      this.modo = modo;
      this.seleccion = CascadaOrganizacional.NIVELES.map(function () { return ''; });
    }

    // Filas que cumplen lo elegido en los niveles 0..hasta-1.
    filasHasta(hasta) {
      var niveles = CascadaOrganizacional.NIVELES, sel = this.seleccion;
      return this.filas.filter(function (f) {
        for (var i = 0; i < hasta; i++) {
          if (sel[i] && f[niveles[i].clave] !== sel[i]) return false;
        }
        return true;
      });
    }

    // Valores distintos del nivel, ordenados como el directorio (ordinal).
    opciones(nivel) {
      var clave = CascadaOrganizacional.NIVELES[nivel].clave;
      var vistos = {}, salida = [];
      this.filasHasta(nivel).forEach(function (f) {
        var v = f[clave];
        if (v && !Object.prototype.hasOwnProperty.call(vistos, v)) {
          vistos[v] = true;
          salida.push(v);
        }
      });
      return salida.sort(igualTexto);
    }

    // Limpia el nivel `desde` y todos los de abajo.
    limpiar(desde) {
      for (var i = desde; i < this.seleccion.length; i++) this.seleccion[i] = '';
    }

    // Elegir limpia los niveles de abajo. Un valor que no esta entre las
    // opciones validas no se acepta (el nivel queda vacio). Devuelve si se
    // acepto.
    elegir(nivel, valor) {
      this.limpiar(nivel);
      if (valor && this.opciones(nivel).indexOf(valor) >= 0) {
        this.seleccion[nivel] = valor;
        return true;
      }
      return false;
    }

    completa() {
      return this.seleccion.every(function (v) { return v !== ''; });
    }

    // Director de la categoria elegida, o '' si falta elegir algo o si las
    // filas que quedan no coinciden en uno solo (no se adivina).
    director() {
      if (!this.completa()) return '';
      var directores = {};
      this.filasHasta(this.seleccion.length).forEach(function (f) { directores[f.director] = true; });
      var lista = Object.keys(directores);
      return lista.length === 1 ? lista[0] : '';
    }

    // Lo elegido, por clave, solo los niveles con valor: lo que una lista
    // manda al servidor. {} = sin filtro organizacional.
    filtros() {
      var salida = {}, sel = this.seleccion;
      CascadaOrganizacional.NIVELES.forEach(function (n, i) { if (sel[i]) salida[n.clave] = sel[i]; });
      return salida;
    }

    // Lo que pinta cada select. `raizHabilitada`: si el primer nivel puede
    // usarse (en creacion depende del tipo, que vive fuera de la cascada).
    // En modo filtro un padre vacio no bloquea al hijo.
    estado(raizHabilitada, motivoRaiz) {
      var self = this, libres = MODOS[this.modo].nivelesLibres;
      return CascadaOrganizacional.NIVELES.map(function (n, i) {
        var padre = i > 0 ? CascadaOrganizacional.NIVELES[i - 1] : null;
        if (!raizHabilitada && (!padre || libres)) {
          return { habilitado: false, opciones: [], valor: '', motivo: motivoRaiz };
        }
        if (padre && !libres && !self.seleccion[i - 1]) {
          return { habilitado: false, opciones: [], valor: '',
                   motivo: 'Elige primero ' + padre.articulo + ' ' + padre.etiqueta + '.' };
        }
        var ops = self.opciones(i);
        if (!ops.length) {
          // El nivel elegido mas cercano hacia arriba (en creacion, el padre).
          var arriba = null;
          for (var k = i - 1; k >= 0 && !arriba; k--) {
            if (self.seleccion[k]) arriba = CascadaOrganizacional.NIVELES[k];
          }
          return { habilitado: false, opciones: [], valor: '',
                   motivo: arriba ? 'Sin valores para el ' + arriba.etiqueta + ' elegido.'
                                  : 'Sin valores en el catálogo.' };
        }
        return { habilitado: true, opciones: ops, valor: self.seleccion[i], motivo: '' };
      });
    }
  }

  CascadaOrganizacional.NIVELES = [
    { clave: 'po',        etiqueta: 'Product Owner', articulo: 'un' },
    { clave: 'so',        etiqueta: 'Service Owner', articulo: 'un' },
    { clave: 'categoria', etiqueta: 'Categoría',     articulo: 'una' }
  ];

  return CascadaOrganizacional;
})();
