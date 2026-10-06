# analisis/vendor/

`exceljs.min.js` es ExcelJS 4.4.0 (licencia MIT), el `dist/exceljs.min.js` del
paquete de npm tal cual. Arma el Excel de siete hojas de la pestaña "Análisis
de servicios", con formato (encabezados, anchos, porcentajes, filtro en el
Detalle), que la copia de SheetJS que ya trae `experiencia/vendor/` no hace.

Va copiado aquí y no desde un CDN porque el tablero corre en una VM sin
salida a internet (igual que `assets/vendor/chart.umd.min.js`). Solo se
carga al pulsar "Descargar Excel".

Es la misma versión que usa la página de claude.ai
(`analisis_servicio/`), así que los dos Excel salen iguales.
