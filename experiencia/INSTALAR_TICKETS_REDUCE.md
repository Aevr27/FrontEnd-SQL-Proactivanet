# Tickets Reduce calculado en la base: cómo se instala

Tickets Reduce es lo que la pestaña Experiencia resta del volumen de cada hoja
para separar "Con Iniciativa" de "Sin Iniciativa". Lo suma también el registro
de iniciativas de Admin. Hasta ahora lo traía el Excel (una fórmula) y la base
solo lo copiaba. El 64 del 2026-10-09 midió dos problemas:

- 38 filas tenían % y tickets, pero el Excel las dejaba en 0;
- de las que sí lo traían, solo 20 de 63 cuadraban con el volumen de hoy.

Desde el 65 se calcula en la base, siempre:

> **Tickets Reduce = % de disminución × tickets de su ruta en los últimos 30
> días**, redondeado. El % se topa en 100%; sin %, queda vacío.

Es el mismo volumen de 30 días (slot 0) contra el que el tablero lo compara.
`dbo.ProblemCategoria` no se toca: su Tickets Reduce sigue siendo el del Excel,
y el nuevo queda en `dbo.ExpTicketsReduce`, con los dos lado a lado.

Son tres partes, como la efectividad: la base, el ETL y el sitio. Primero la
base: sin ella el tablero sigue usando el del Excel, sin ningún error.

## 1. La base de datos (SSMS)

En `Tickets_Proactivanet`, abriéndolo como archivo:

| Script | Qué hace |
|---|---|
| `65_tickets_reduce_en_base.sql` | Crea `dbo.ExpTicketsReduce` y `dbo.usp_Exp_CalcularTicketsReduce`. Al final calcula una vez y muestra el resumen. Se puede volver a correr. |

Al terminar sale una fila `calculado` con:

- `Filas`: las filas vigentes de `dbo.ProblemCategoria`;
- `ConTicketsReduce` y `TicketsReduce`: cuántas filas tienen valor y cuánto suman;
- `ExcelEnCero`: cuántas tenían 0 en el Excel y ahora sí tienen valor;
- `TicketsReduceExcel`: lo que sumaba el Excel.

**Permisos**, cambiando los nombres por las cuentas reales (las mismas de la
efectividad):

```sql
GRANT SELECT  ON dbo.ExpTicketsReduce              TO [usuario_del_tablero];
GRANT EXECUTE ON dbo.usp_Exp_CalcularTicketsReduce TO [usuario_del_etl];
```

Sin el primero, el tablero no ve la tabla y sigue con el del Excel. Sin el
segundo, el ETL avisa en su log "Falta ejecutar 65_tickets_reduce_en_base.sql"
y no recalcula.

## 2. El ETL

Los mismos dos archivos de la efectividad, juntos, en la carpeta donde corren
hoy. Si ya se copiaron para la efectividad, hay que volver a copiarlos: esta
versión trae las dos cosas.

```
etl_proactivanet.py
cargar_experiencia.py
```

- `etl_proactivanet.py`, al final de cada corrida que cargó bien los tickets,
  recalcula Tickets Reduce y la efectividad "una vez al día". En el resumen
  salen las líneas `tickets reduce: ...` y `efectividad: ...`. Con
  `--sin-efectividad` se omiten las dos.
- `cargar_experiencia.py`, después de cargar el Excel, recalcula las dos
  siempre.

Ninguno se cae si el cálculo falla o si falta el 65: lo dicen en el log y el
tablero sigue con el último cálculo.

Para calcular a mano, en SSMS: `EXEC dbo.usp_Exp_CalcularTicketsReduce;`

## 3. El sitio (IIS)

Un solo archivo que ya existe: **`App_Code/ExperienciaQueries.cs`**. Si el del
servidor es la versión del repositorio, se reemplaza. Si es más nuevo, se
aplican estos dos pedazos a mano:

1. En `LeerIniciativas`, el `const string SQL = ...` se cambia por el bloque
   del repositorio que empieza en el comentario `// TICKETS REDUCE: el
   calculado en la base` y termina en `"WHERE v.VigenteEnOrigen = 1";`. Lee
   `dbo.ExpTicketsReduce` si existe; si no, el Tickets Reduce del Excel, igual
   que antes.
2. El método `TieneTicketsReduceCalculado`, completo, justo antes de
   `LeerIniciativasSinCategoria`.

No hay cambios en `experiencia.js` ni en `experiencia.html`. El registro de
iniciativas de Admin (`ExperienciaRegistro.cs`) usa el mismo `LeerIniciativas`,
así que también cambia, sin tocarlo.

## 4. Cómo comprobar que quedó

1. En SSMS: `SELECT TOP (20) * FROM dbo.ExpTicketsReduce ORDER BY TicketsReduce DESC;`
   trae el cálculo de hoy (`Hoy`).
2. En el tablero, "Con Iniciativa" sube. Con los datos del 2026-10-09, al
   calcular las 38 filas que estaban en 0, pasaba de 14.9% a 17.6%.
   Recalcular también las demás lo mueve otro poco, hacia arriba o hacia
   abajo según el volumen de hoy.
3. Las iniciativas de rutas nuevas ya traen su Tickets Reduce: Modo autónomo
   de Punto de Venta, PinPad y CPU en Equipo de Cómputo, las de Mesa de Control.

## Lo que todavía usa el del Excel

- El pronóstico (`pronostico/`) y el `50_variacion_mensual_y_compromiso.sql`:
  se cambian la próxima vez que se corran, a fin de octubre.
- Una iniciativa que apunta a una **rama** (por ejemplo
  `/Facturación/Facturacion Clientes`): sus tickets están en las hojas, y el
  tablero no resta de una rama. Calcularla así da 0; repartirla entre sus hojas
  es otra decisión.
