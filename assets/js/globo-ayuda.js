/* =========================================================================
   assets/js/globo-ayuda.js

   Globo de ayuda al pasar el mouse por un rotulo: el patron de las franjas
   "Pregunta" de los KPIs de QARE (qare.js: mostrarPregunta /
   ocultarPregunta / conectarPreguntas), sacado a una clase para que otra
   pagina lo use sin copiar el codigo.

   QARE NO se cambio y sigue con su copia: esta clase replica su
   comportamiento, no lo reemplaza. Si algun dia QARE se pasa a esta, su
   globo (#qare-kpi-globo) deberia verse igual.

   Mismo comportamiento que en QARE:
     - un solo globo por instancia, fuera del contenido, position: fixed bajo
       el destino y acotado al ancho de la ventana;
     - mouse: entrar muestra, salir oculta;
     - toque: alterna; un toque fuera lo cierra;
     - teclado: al llegar con Tab a un destino enfocable (:focus-visible);
     - Escape, desplazar o cambiar el ancho de la ventana lo ocultan.

   El texto NO vive aqui: lo da quien crea el globo, por destino.

   Diferencia con QARE: alli el destino es un <button> y lleva
   aria-expanded; aqui puede ser un <label>, que no admite ese atributo, asi
   que el estado abierto va en la clase .abierto. Para lectores de pantalla
   el texto tiene que ir ademas en un aria-describedby del control (lo pone
   quien arma el rotulo).

   Uso:
     var globo = new GloboAyuda(raiz, '.ayuda-destino', function (destino) {
       return { texto: '...', nota: '...' };   // nota opcional; null = nada
     });
     globo.conectar();

   Estilos: assets/css/globo-ayuda.css (.ayuda-destino y .globo-ayuda).
   ========================================================================= */
window.GloboAyuda = (function () {
  'use strict';

  var contador = 0;

  class GloboAyuda {
    constructor(raiz, selector, contenido) {
      this.raiz = raiz;
      this.selector = selector;
      this.contenido = contenido;
      this.abierto = null;

      contador++;
      this.globo = document.createElement('div');
      this.globo.className = 'globo-ayuda';
      this.globo.id = 'globo-ayuda-' + contador;
      this.globo.setAttribute('role', 'tooltip');
      this.globo.hidden = true;
      this.texto = document.createElement('p');
      this.texto.className = 'globo-ayuda-texto';
      this.nota = document.createElement('p');
      this.nota.className = 'globo-ayuda-nota';
      this.globo.appendChild(this.texto);
      this.globo.appendChild(this.nota);
      document.body.appendChild(this.globo);
    }

    destinoDe(e) {
      return (e.target && e.target.closest) ? e.target.closest(this.selector) : null;
    }

    mostrar(destino) {
      var c = this.contenido(destino);
      if (!c || !c.texto) return;
      if (this.abierto && this.abierto !== destino) this.abierto.classList.remove('abierto');
      this.abierto = destino;
      destino.classList.add('abierto');
      this.texto.textContent = c.texto;
      this.nota.textContent = c.nota || '';
      this.nota.hidden = !c.nota;
      this.globo.hidden = false;

      var r = destino.getBoundingClientRect();
      var ancho = this.globo.offsetWidth, margen = 8;
      var izq = Math.min(Math.max(margen, r.left + r.width / 2 - ancho / 2),
        document.documentElement.clientWidth - ancho - margen);
      this.globo.style.left = Math.max(margen, izq) + 'px';
      this.globo.style.top = (r.bottom + 6) + 'px';
      this.globo.classList.add('visible');
    }

    ocultar() {
      if (this.abierto) this.abierto.classList.remove('abierto');
      this.abierto = null;
      this.globo.classList.remove('visible');
      this.globo.hidden = true;
    }

    conectar() {
      var self = this;
      var raiz = this.raiz;
      // Mouse: entrar muestra, salir oculta. El toque no dispara esto (ver click).
      raiz.addEventListener('pointerover', function (e) {
        var d = self.destinoDe(e);
        if (d && e.pointerType === 'mouse') self.mostrar(d);
      });
      raiz.addEventListener('pointerout', function (e) {
        var d = self.destinoDe(e);
        if (d && e.pointerType === 'mouse' && !d.contains(e.relatedTarget)) self.ocultar();
      });
      // Toque: alterna. Con mouse el globo ya salio al entrar: el clic no lo cierra.
      raiz.addEventListener('click', function (e) {
        var d = self.destinoDe(e);
        if (!d) return;
        if (self.abierto === d && e.pointerType !== 'mouse') self.ocultar();
        else self.mostrar(d);
      });
      // Teclado: solo :focus-visible, como en QARE.
      raiz.addEventListener('focusin', function (e) {
        var d = self.destinoDe(e);
        if (d && d.matches(':focus-visible')) self.mostrar(d);
      });
      raiz.addEventListener('focusout', function (e) { if (self.destinoDe(e)) self.ocultar(); });
      document.addEventListener('click', function (e) {
        if (self.abierto && !self.abierto.contains(e.target)) self.ocultar();
      });
      document.addEventListener('keydown', function (e) { if (e.key === 'Escape') self.ocultar(); });
      // Fijo en pantalla: al desplazar o cambiar el ancho quedaria despegado.
      window.addEventListener('scroll', function () { self.ocultar(); }, true);
      window.addEventListener('resize', function () { self.ocultar(); });
      return this;
    }
  }

  return GloboAyuda;
})();
