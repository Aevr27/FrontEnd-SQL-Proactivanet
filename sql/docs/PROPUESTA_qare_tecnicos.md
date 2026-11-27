# Propuesta: pestaña Técnicos / QARE — fuentes, brechas y contrato

Estado: **investigación cerrada; procedimientos NO escritos.** Las tres
clasificaciones centrales del tablero no tienen regla en la base ni en el
repositorio. Este documento dice qué está verificado, qué falta y qué tiene que
decidir el negocio antes de escribir `usp_QARE_PatronesSolucion`,
`usp_QARE_CalidadCaptura_Tecnicos` y `usp_QARE_DetalleEvidencia`.

Perfil de datos para tomar esas decisiones: `sql/diag/diag_qare_tecnicos_perfil.sql`
(solo lectura).

## 1. Fuentes revisadas

| Fuente | Qué aporta |
|---|---|
| `sql/16_qare_filtros_org.sql` | Cuerpos completos de `tvf_CorreoQARE_Base` y de los seis `usp_CorreoQARE_*` (aplicado en QA 2026-09-29). |
| `App_Code/QareContrato.cs`, `QareQueries.cs`, `QareExportar.cs` | Contrato verificado en QA (diag v2, 2026-09-25): fechas, defaults, escala de %. |
| `esquema_bd/` (export de QA, 2026-10-13) | Lista de objetos, columnas y filas. **Los cuerpos están truncados a ~250 caracteres.** |
| `Integracion_SQL-Proactivanet/01_esquema_proactivanet.sql`, `generar_sql.py` | Columnas de `dbo.Tickets` y la pregunta del formulario detrás de cada `QARe_*`. |
| `sql/10_qa_web.sql` (obsoleto, solo documentación) | Mapeo `Tecnico` = "Técnico de 2ª línea". |
| `sql/47_analisis_servicios.sql`, `analisis/motor.js` | Único motor de clasificación por frases que existe (ver 3.2). |

## 2. Lo que sí está verificado y se reutiliza

- **Población:** `dbo.vw_CorreoQARECierre_Base` (envoltorio de `vw_CorreoQA_Base`,
  la misma base que QA). Una fila por `CodigoTicket` (diag export: 0 duplicados).
- **Fecha oficial:** `FechaFirmaSolucion`; `@FechaFin` inclusivo
  (`>= @Fi AND < DATEADD(DAY,1,@Ff)`).
- **Default NULL/NULL:** `@Ff` = hoy en México (`DATEADD(HOUR,-6,SYSUTCDATETIME())`),
  `@Fi` = `@Ff - 14`.
- **Porcentajes:** `DECIMAL(6,2)`, escala 0-100, `NULLIF(denominador,0)`.
- **Pareto:** patrón de `usp_CorreoQARE_CausaRaiz`: `ROW_NUMBER() OVER (ORDER BY
  CantidadTickets DESC, <etiqueta> ASC)` y acumulado con
  `SUM() OVER (... ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)`.
- **Filtros org:** semántica de `tvf_CorreoQARE_Base` (`fn_CorreoBacklog_SplitList`,
  NULL/vacío = sin filtro, `C1 = fn_CorreoBacklog_CategoriaC1`, `Lider` vía
  `CatLiderGrupo` con 'Sin Torre').
- **Columnas disponibles en la vista** (verificadas en `esquema_bd/02_columnas.tsv`):
  `CodigoTicket, Grupo, Categoria, Tecnico, Titulo, SolucionUsuario, QARe_Causa,
  QARe_DescripcionSolucion (MAX), QARe_TipoSolucion, QARe_Evidencia (MAX),
  QARe_UsuarioConfirmo, QARe_VerificoClasificacion, QARe_AplicaOtrosCasos,
  QARe_GenerarArticulo, GrupoCorrecto, Validacion, FechaFirmaSolucion`, entre otras.

## 3. Brechas (bloquean los tres SP)

### 3.1 No existe ninguna regla para estas clasificaciones

Búsqueda en repo, repo de integración, export `esquema_bd/` y ETL: ningún
objeto, columna, catálogo ni comentario define:

| Indicador pedido | Qué falta |
|---|---|
| Respuesta inválida (no evaluable) | Criterio: ¿vacío? ¿largo mínimo? ¿lista de textos genéricos? ¿sobre qué campo? |
| Respuesta analizable | Se asume = no inválida, pero **no confirmado**. |
| Patrón reconocido | Catálogo de patrones (nombre, frases/reglas, campo evaluado, prioridad si dos coinciden). No existe. |
| Sin patrón identificado | Depende del catálogo anterior. |
| Respuesta incompleta (calidad) | Criterio: ¿falta Causa/Evidencia/TipoSolucion? ¿texto sin pasos? ¿umbral? Y si es excluyente o compatible con "patrón reconocido". |

Sin esto, cualquier SP que devuelva esas columnas sería ficticio.

### 3.2 Catálogos existentes que **no** sirven tal cual

- `dbo.CatCausaRaizAgrupador` (135 filas): agrupa `vw_Tickets.CausaRaizFenix`, un
  campo de Proactivanet, no el texto QARE. Podría ser "patrón" sólo si el negocio
  lo decide; el diag sección 5 mide su cobertura.
- `dbo.AnalisisRegla` (369 filas): frases por **servicio** de Análisis, evaluadas
  en el navegador (`motor.js`) con normalización propia. Son motivos del
  incidente, no patrones de solución, y reproducirlo en SQL duplicaría lógica.
- `QARe_TipoSolucion`: respuesta codificada del técnico; es candidata a
  "respuesta declarada", **no** a patrón reconocido (es lo que el técnico dice, no
  lo que se reconoce en el texto).

### 3.3 Resolutor: dos candidatos

`vw_CorreoQA_Base` expone `Tecnico` y `TecnicoAsignado`;
`vw_CorreoQARECierre_Base` sólo `Tecnico`. Cuerpos de vista no leídos (export
truncado). El diag 0b y 2b/2c/2d dicen de dónde sale cada uno y cuánto difieren.
Además, hay nombres con U+FFFD desde la importación: el filtro por técnico debe
comparar contra el valor tal como viene de la BD.

### 3.4 Filtro de Categoría

Los filtros QARE actuales son Servicio (C1), Grupo y Líder. La pestaña nueva pide
"Categoría": falta decidir si es C1 (reusar `@C1`), la ruta completa
(`Categoria`, igualdad exacta) o un prefijo.

### 3.5 Motor de clasificación: dónde vive

Si los patrones son frases sobre texto libre, hay que decidir:
- **Catálogo en tabla** (p. ej. `dbo.QarePatron` + `dbo.QarePatronFrase`) y
  coincidencia en SQL con `LIKE` sobre texto normalizado. Requiere DDL (aprobación
  aparte, script + rollback) y definir la normalización (acentos, mayúsculas).
- **Clasificación precalculada** por un proceso (ETL/Python) en una tabla
  `CodigoTicket -> Patron, Motivo`. Los SP sólo leerían.

Recomendación: tabla de clasificación precalculada si el catálogo va a crecer o
la regla es difusa; `LIKE` en SQL si son pocas frases exactas. Decisión del negocio.

## 3b. Resultados del diag en QA (2026-11-27, ventana 2026-10-29 a 2026-11-27)

`diag_qare_tecnicos_perfil.sql`, 9 310 tickets, una fila por ticket.

**Resolutor**
- `Tecnico` nunca viene vacío (103 distintos, 0 con U+FFFD).
- `Tecnico` = `vw_Tickets.TecnicoSegundaLinea` sólo en 4 858 (52 %). En los
  ejemplos distintos, `TecnicoSegundaLinea` es NULL o es otra persona y
  `TecnicoAsignado` dice "Sin asignar". `Tecnico` es otra cosa; en la vista del SLA
  (`DashboardQueries.cs`) es la firma de solución con respaldo en el asignado.
  **Sin verificar para `vw_CorreoQA_Base`:** el cuerpo volvió truncado. diag 2, A y B.
- Hay cuentas que no son personas: `User, Setup` (646 tickets, 25 grupos),
  `Proactivanet, Customer Service`, `Lexmark, Proveedor`, `Soporte, Fenicia`...
  `dbo.CatCuentaNoPersona` ya existe y la usan SLA y Análisis para sacarlas de lo
  que habla de personas. Candidato a reutilizar en la tabla por técnico (diag 2, C).

**Captura QARE**
- 1 712 tickets (18.4 %) sin QARE: `QARe_TipoSolucion`, `AplicaOtrosCasos`,
  `GenerarArticulo` y los textos vienen NULL juntos. Los cuatro campos libres
  (`Causa`, `Evidencia`, `DescripcionSolucion`, `TipoSolucion`) se llenan juntos
  (7 595 de 7 598): "incompleta" por campo vacío casi no distingue nada.
- `QARe_UsuarioConfirmo` es NULL en el 100 %: no sirve para ninguna regla.
- Largo de `QARe_DescripcionSolucion`: 31.9 % entre 1 y 9 caracteres, 17.2 % entre
  10 y 19, 24.9 % entre 20 y 49; sólo 7.6 % llega a 50 o más.
- Textos más repetidos: `.` 778, `N/A` 424, `NO` 274, `-` 245, `NO  SALE ERROR` 217
  (parece respuesta a otra pregunta), `NA` 208, `0` 181, `SI` 147,
  `SIN RESPUESTA` 121, guiones sueltos. Junto a eso, textos cortos con contenido
  real repetido: `PERMISOS ADICIONALES TIENDA`, `CARGA DE PRECIOS`,
  `SE REINICIA SERVICIOS DE EHUB`, `ALTA SAP TIENDA`: materia prima de un catálogo
  de patrones.
- 232 tickets copian `SolucionUsuario` tal cual; 36 copian el rótulo del tipo de
  solución ("Se dan indicaciones, técnicamente no se hizo nada").

**Respuesta declarada:** `QARe_TipoSolucion` es un catálogo cerrado de 11 valores,
lleno siempre que hay captura. El más usado es "Se dan indicaciones, técnicamente
no se hizo nada" (2 025).

**Catálogo de patrones:** `CatCausaRaizAgrupador` cubre 105 de 9 310 (1.1 %) y
`QARe_Causa` no empata nunca con él. **Descartado** como fuente de patrones.

**Grupo / categoría:** siempre llenos; 48 grupos, 423 rutas de categoría.

### Lo que cambia

- La brecha 3.1 sigue abierta, pero ya hay datos para decidir. `diag_qare_tecnicos_perfil_2.sql`
  (D1) cuenta una cascada **candidata** de "inválida": vacío, sin letras, literal
  genérico, copia de otro campo, menos de 10 caracteres. Las reglas y la lista de
  literales las aprueba el negocio.
- El patrón no puede salir de un catálogo existente: hay que crearlo (3.5), sembrado
  con los textos repetidos de 3b.
- Por técnico: decidir si las cuentas de `CatCuentaNoPersona` salen de la tabla
  (como en el SLA) o se muestran aparte.

## 4. Contrato propuesto (se aplica cuando 3.x esté resuelto)

Parámetros comunes a los tres SP, mismos tipos y semántica que QARE:

| Parámetro | Tipo | PatronesSolucion | CalidadCaptura_Tecnicos | DetalleEvidencia |
|---|---|---|---|---|
| `@FechaInicio` | DATE = NULL | sí | sí | sí |
| `@FechaFin` | DATE = NULL (inclusivo) | sí | sí | sí |
| `@Grupos` | NVARCHAR(MAX) = NULL, lista por comas | sí | sí | sí |
| `@C1` / categoría | pendiente 3.4 | sí | sí | sí |
| `@Tecnicos` | NVARCHAR(MAX) = NULL, lista por comas | sí | sí (filtra filas) | sí |
| `@Clasificacion` | NVARCHAR(50) = NULL | no | no | sí (clic en barra/columna) |

Regla de consistencia: los tres leen **una misma fuente filtrada** (una TVF nueva,
p. ej. `dbo.tvf_QARE_TecnicosBase`, modelada sobre `tvf_CorreoQARE_Base` y sin
alterarla) que devuelve por ticket las banderas `EsInvalida`, `EsAnalizable`,
`TienePatron`, `Patron`, `EsIncompleta`. Ningún SP recalcula una bandera.

Invariantes que el script de validación comprobará (válidos sólo si el negocio
confirma que las categorías son excluyentes como se indica):

```
Total               = Invalidas + Analizables
Analizables         = ConPatron + SinPatron
SUM(Pareto.Tickets) = ConPatron                          (PatronesSolucion)
SUM(por técnico)    = totales de PatronesSolucion         (CalidadCaptura)
COUNT(Detalle)      = Total, y por clasificación igual    (DetalleEvidencia)
Pareto: último PorcentajeAcumulado = 100.00 (± redondeo), no decrece
```

Denominadores propuestos (a confirmar):

| % | Numerador | Denominador |
|---|---|---|
| Distribución de patrones | tickets del patrón | tickets con patrón (`ConPatron`) |
| % Sin patrón | `SinPatron` | `Analizables` |
| % Incompletas | `Incompletas` | `Analizables` (¿o Total?) |
| % Inválidas | `Invalidas` | `Total` |
| Pareto acumulado | suma acumulada por Posición | `ConPatron` |

## 5. Matriz indicador → columna (propuesta, nombres no implementados)

| Indicador | PatronesSolucion | CalidadCaptura_Tecnicos | DetalleEvidencia |
|---|---|---|---|
| Respuestas inválidas | `TicketsInvalidos` (RS 1) | `RespuestasInvalidas` | `EsInvalida`, `MotivoClasificacion` |
| Respuestas analizables | `TicketsAnalizables` (RS 1) | `RespuestasAnalizables` | `EsAnalizable` |
| Patrón reconocido | `TicketsConPatron` (RS 1); por patrón RS 2 | `PatronReconocido` | `Patron` |
| Sin patrón | `TicketsSinPatron` (RS 1) | `SinPatron` | `Patron IS NULL AND EsAnalizable = 1` |
| Respuesta incompleta | `TicketsIncompletos` (RS 1) | `RespuestaIncompleta` | `EsIncompleta`, `CamposFaltantes` |
| Pareto | RS 2: `Posicion, Patron, CantidadTickets, Porcentaje, TicketsAcumulados, PorcentajeAcumulado` | — | — |
| Identificación | — | `Tecnico` | `CodigoTicket, FechaFirmaSolucion` |
| Resolutor / org | — | `Tecnico`, `Grupo` (si se agrupa) | `Tecnico, Grupo, Categoria` |
| Respuesta declarada | — | — | `QARe_TipoSolucion` |
| Texto | — | — | `QARe_DescripcionSolucion` (expansión) |
| Explicación | — | — | `FraseCoincidente`, `LargoTexto`, `QARe_Causa`, `QARe_Evidencia`, `Validacion` (expansión) |

## 6. Preguntas para el negocio (Daniela / dueño de QARE)

1. ¿Qué hace inválida una respuesta? ¿Sobre `QARe_DescripcionSolucion` solo?
2. ¿"Analizable" es exactamente "no inválida"?
3. ¿Existe una lista de patrones de solución? ¿Quién la mantiene y dónde?
4. Un ticket con dos patrones: ¿gana el primero por prioridad o cuenta en ambos?
5. ¿Qué hace incompleta una respuesta? ¿Es compatible con tener patrón?
6. Resolutor: `Tecnico` o `TecnicoAsignado` (ver diag 2b).
7. Categoría del filtro: C1, ruta completa o prefijo.
8. ¿Las cinco columnas de la tabla por técnico son conteos o porcentajes? Si son
   porcentajes, ¿sobre qué total de ese técnico?

9. ¿Las cuentas de `CatCuentaNoPersona` (`User, Setup`...) salen de la tabla por técnico?
10. Los 1 712 tickets sin captura QARE: ¿son "inválidas" o un indicador aparte
    ("sin captura")? Cambia el denominador de todo.

## 7. Siguiente paso

1. ~~Correr `diag_qare_tecnicos_perfil.sql`~~ (hecho 2026-11-27, ver 3b). Correr
   `sql/diag/diag_qare_tecnicos_perfil_2.sql` en QA y compartir la salida.
2. Responder la sección 6 con D1/D2 del diag 2 a la vista.
3. Con eso: escribir la TVF y los tres SP como `sql/NN_qare_tecnicos.sql` (+ rollback,
   `CREATE` sólo de objetos nuevos, sin tocar `usp_CorreoQARE_*`), script de
   validación con los invariantes de la sección 4 y ejemplos de ejecución.
