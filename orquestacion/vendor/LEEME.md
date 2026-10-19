# orquestacion/vendor/

- Chart.js no va aquí: la página suelta (`orquestacion/orquestacion.html`)
  carga `../assets/vendor/chart.umd.min.js`, la misma copia (4.4.4) que usa
  `dashboard.html`; embebida, la pestaña usa la del tablero.
- `xlsx.mini.min.js`: SheetJS 0.18.5 (la build comunitaria, licencia Apache
  2.0), la misma copia que traen `experiencia/vendor/` y
  `efectividad/vendor/`, byte por byte salvo los fines de línea. Arma el Excel de la pestaña
  "Orquestación" (Resumen, Madurez, Dirección - N3, Completitud por campo,
  Vista v3.7, Histórico, Decomisos y Jobs). Solo se carga al pulsar
  "Descargar Excel".

Van copiados aquí y no desde un CDN porque el tablero corre en una VM sin
salida a internet.
