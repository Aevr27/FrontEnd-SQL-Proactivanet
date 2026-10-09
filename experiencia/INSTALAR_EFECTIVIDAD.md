# KPI "% Efectividad Reducción": cómo se instala

La tarjeta de la pestaña Experiencia deja de decir siempre S/D: muestra cuánto
de lo que se comprometieron a reducir las iniciativas se redujo de verdad, y
responde a los filtros de Director, Product Owner, Manager y Service Owner.

El cálculo no lo hace el tablero: lo deja hecho la base una vez al día
(`60_efectividad_iniciativas.sql`), con la regla acordada el 2026-10-02 (la del
41). El tablero solo lo lee y suma lo que pasa sus filtros.

**Lo que este repositorio tiene y lo que no.** El código del sitio ya está
aquí (`App_Code/ExperienciaQueries.cs`, `LeerEfectividad`;
`experiencia/experiencia.js`, `tarjetaEfectividad`). Los scripts de base
(`43_equivalencias_categorias.sql`, `60_efectividad_iniciativas.sql`) y el
ETL **no** están en este repositorio: las tablas y columnas que lee el sitio
salen del tablero de referencia del 2026-10-09 y no se han comprobado contra
la base. Mientras falten, la tarjeta dice S/D, sin ningún error.

## 1. La base de datos (SSMS)

En `Tickets_Proactivanet`, abriéndolo como archivo (lo corre el dueño de la
base, con su aviso y su OK):

| Script | Qué hace |
|---|---|
| `43_equivalencias_categorias.sql` | Crea `dbo.CatRutaEquivalente`, que el 60 necesita. |
| `60_efectividad_iniciativas.sql` | Crea las tablas del cálculo (`dbo.ExpEfectividad`, `dbo.ExpEfectividadCorrida`) y `dbo.usp_Exp_CalcularEfectividad`. Según su autor, no toca `dbo.Problem`: solo la lee. Al final calcula una vez y muestra el KPI. |

Lo que el sitio lee de esas tablas (para comprobarlo contra el 60 antes de
instalar):

- `dbo.ExpEfectividadCorrida`: `Id` (el último cálculo) y `Hoy` (su día, ya en
  UTC-06).
- `dbo.ExpEfectividad`: `Codigo`, `CategoriaExcel`, `Categoria`, `Orden`
  (15 = medida, 14 = en medición; las demás filas no se leen), `Compromiso`,
  `Logro`, `SeMideDesde`.

**Permisos.** Cambiando los nombres por las cuentas reales (el `User ID` del
`Web.config` del tablero, y la cuenta del ETL):

```sql
GRANT SELECT  ON dbo.ExpEfectividad              TO [usuario_del_tablero];
GRANT SELECT  ON dbo.ExpEfectividadCorrida       TO [usuario_del_tablero];
GRANT EXECUTE ON dbo.usp_Exp_CalcularEfectividad TO [usuario_del_etl];
```

Sin el primero, la tarjeta sigue en S/D. Para calcular a mano, en SSMS:
`EXEC dbo.usp_Exp_CalcularEfectividad;`

## 2. El ETL

Según el tablero de referencia, `etl_proactivanet.py` llama al cálculo una vez
al día y `cargar_experiencia.py` recalcula después de cargar el Excel. Esas
versiones no están en este repositorio; antes de desplegarlas hay que
compararlas con las que corren hoy.

## 3. El sitio (IIS)

Los tres archivos ya traen el cambio en este repositorio:
`App_Code/ExperienciaQueries.cs`, `experiencia/experiencia.js` y
`experiencia/experiencia.html` (la ayuda). Si en el servidor hay una versión
más nueva, no se reemplaza el archivo: se aplican a mano el método
`LeerEfectividad` (con sus dos líneas en `Construir`) y el bloque
`// ---- [KPI-4] % Efectividad Reducción ----` de `experiencia.js`.

Si las tablas existen pero sus columnas no coinciden, `LeerEfectividad`
deja la falla en la traza de ASP.NET (`ExperienciaQueries.Efectividad`) y la
tarjeta queda en S/D; el resto de la pestaña no cambia.

## 4. Cómo comprobar que quedó

1. En SSMS: `SELECT TOP (1) * FROM dbo.ExpEfectividadCorrida ORDER BY Id DESC;`
   trae el cálculo de hoy.
2. En el tablero, sin filtros, la tarjeta dice el mismo % que esa fila
   (redondeado) y abajo "N medidas · M en medición · al dd/mm".
3. Con un Director o un Service Owner, cambia: solo cuenta las iniciativas de
   sus categorías. Si ninguna de las suyas se ha podido medir, dice S/D,
   cuántas están en medición y el día en que se mide la primera.

Pruebas sin base: `node tools/tests/EfectividadExperienciaSmoke.js`. La de C#
(`tools/tests/EfectividadExperienciaSmoke.cs`) necesita una base con el 60
para sus casos completos.

## Lo que todavía no está

- **La pestaña propia** con los KPIs adicionales (% efectivas, rebote, tickets
  evitados, sin base) y el detalle por iniciativa.
