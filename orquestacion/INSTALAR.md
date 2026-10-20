# Pestaña "Orquestación": cómo se instala (claude-branch)

Viene del `Paquete_Orquestacion_20261019.zip` (su `LEEME_PRIMERO.md`), integrado
en esta rama el 2026-10-19. Diferencias con el paquete:

- `dashboard.html`, `dashboard.js` y `admin/iniciativas.html` **ya traen** la
  pestaña: los del paquete eran la versión del 2026-10-14 y esta rama ya iba
  más adelante (Fijar KPIs, duracion.js, aviso de MOCK_DATA, instantánea del
  marco). Se agregaron los cuatro pedazos a mano; no se reemplazó nada.
- Chart.js no se copia a `orquestacion/vendor/`: la página suelta usa
  `../assets/vendor/chart.umd.min.js`, el mismo del tablero.
- `App_Code/OrquestacionQueries.cs` sin BOM, con los acentos de los literales
  como `\uXXXX` (como el resto de App_Code), y `orq.Parametro.Valor` sale como
  número aunque la columna sea texto (antes las ejecuciones futuras se
  concatenaban: "17" + 5 = "175"). Los costos de `orq.Parametro` no se leen
  ni se muestran: son información reservada.
- `sql/77_tablero_orquestacion.sql`: la columna `Campos` usa `OUTER APPLY TOP (1)`
  en vez de `LEFT JOIN` a `orq.ValorRelleno`. Mismo resultado salvo cuando el
  relleno trae dos valores iguales bajo `Latin1_General_CI_AI`
  ("Huerfanos"/"Huérfanos"): ahí el original armaba 15 caracteres.

El 76 (`76_orquestacion.sql`) y `cargar_orquestacion.py` **no están en este
repositorio**: según el paquete, ya están instalados y cargados en la VM
(2026-10-19).

## 0. Antes de tocar nada: diagnóstico (solo lectura)

`sql/diag_orquestacion_tablero.sql` en SSMS. No escribe nada. Dice si están
los objetos y columnas que leen el 77 y el C#, el tipo de `orq.Parametro.Valor`,
las cargas aplicadas, si `FechaFin` parece UTC, rellenos y `JobName` repetidos,
y quién tiene SELECT sobre `orq`. Correrlo otra vez después del paso 1: la
sección 8 da las cifras de la cabecera.

## 1. La base (SSMS) — CAMBIO DE BD

1. `sql/77_tablero_orquestacion.sql`: abrir como archivo (trae BOM) y F5.
   `CREATE OR ALTER VIEW` de tres vistas en `orq` (`vw_TableroJob`,
   `vw_TableroDecomiso`, `vw_TableroDetalle`). No escribe datos ni toca `dbo`.
   Se puede volver a correr. Sin el 76 avisa y no crea nada.
   Deshacer: `DROP VIEW orq.vw_TableroDetalle, orq.vw_TableroDecomiso, orq.vw_TableroJob;`
2. Permiso de lectura para la cuenta del `Web.config` (si la sección 7 del
   diagnóstico no la muestra):

   ```sql
   GRANT SELECT ON SCHEMA::orq TO [usuario_del_tablero];
   ```

   Deshacer: `REVOKE SELECT ON SCHEMA::orq FROM [usuario_del_tablero];`

## 2. El sitio (IIS)

Archivos nuevos o cambiados de esta rama:

```
handlers/orquestacion.ashx
App_Code/OrquestacionQueries.cs
orquestacion/orquestacion.html  orquestacion.css  orquestacion.js
orquestacion/vendor/xlsx.mini.min.js  orquestacion/vendor/LEEME.md
dashboard.html  dashboard.js  admin/iniciativas.html
```

`orquestacion/data/` sobra (el prototipo viejo): se puede borrar del servidor.

## 3. Cómo comprobar que quedó

1. `handlers/orquestacion.ashx` → 200 y `"hay_datos":true`;
   `?detalle=1` → `detalle.cols` y `detalle.filas`; un POST → 405.
2. La pestaña: cabecera «Carga del Excel: <fecha> · N jobs» y las tarjetas.
   Con el Excel del 2026-10-17 el paquete da: 10,034 jobs, 3 huérfanos,
   registro completo 95.6% (documentado 51.7%), 1,903 activos, 69
   completamente orquestados, 129 candidatos y 81 migrados con éxito, 442 de
   442 decomisos, 53 ejecuciones pendientes, 74 JOB y 1,602 tareas. Solo valen
   para ese Excel.
3. «Ver la lista» y «⬇ Descargar Excel» (ocho hojas).
4. En la pestaña «Tablero» ya no salen «Orquestación» ni «Experiencia».

«Todavía no hay datos de orquestación» puede ser: falta el 77, falta el
`GRANT` (OBJECT_ID no ve lo que no se puede leer), otra base en el
`Web.config`, o ninguna carga `Aplicado`. El diagnóstico los separa.

## 4. Pruebas en esta rama

- `bash tools/tests/OrquestacionLocalDb.sh` (LocalDB): el 77 sin el 76, el
  77 dos veces sobre un esquema `orq` **de mentira**
  (`OrquestacionLocalDb_stub.sql`, solo las columnas que leen el 77 y el C#),
  `OrquestacionQueries` compilado como IIS (codepage 1252) y su respuesta por
  `OrquestacionCalc`. No prueba el 76 real.
- `node tools/tests/BarraLateralSmoke.js`, `EscapeSmoke.js`,
  `UrlSeguraSmoke.js`, `FrescuraDatosSmoke.js`.
