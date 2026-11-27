# Propuesta: pestaña Técnicos / QARE

Estado (2026-11-27): **especificación en revisión; procedimientos NO escritos.**
Nada de este documento está implementado ni aplicado en ninguna base.

Archivos de diagnóstico (solo lectura):
`sql/diag/diag_qare_tecnicos_perfil.sql` (diag 1, corrido en QA 2026-11-27) y
`sql/diag/diag_qare_tecnicos_perfil_2.sql` (diag 2, **todavía sin correr**).

## 1. Objetivo y alcance

Nueva pestaña "Técnicos / QARE" junto a QA y QARE (Calidad de información). Mide
la calidad de la pregunta abierta del formulario QARE
(`QARe_DescripcionSolucion`, "Describe la solución aplicada") por ticket, por
patrón de solución y por técnico.

Tres procedimientos nuevos, que no reemplazan ni alteran los `usp_CorreoQARE_*`:

| SP | Alimenta |
|---|---|
| `usp_QARE_PatronesSolucion` | Tarjetas, barra segmentada y Pareto |
| `usp_QARE_CalidadCaptura_Tecnicos` | Tabla por técnico |
| `usp_QARE_DetalleEvidencia` | Tabla de evidencia por ticket |

Fuera de alcance de este documento: SQL de implementación, cambios al frontend y
despliegue.

## 2. Fuentes de datos y arquitectura

### 2.1 Fuentes revisadas

| Fuente | Qué aporta |
|---|---|
| Chat de Teams con Daniela Lazaro Cardona, 2026-11-26 (capturas en `OneDrive/Imágenes/Capturas de pantalla/Screenshot 2026-11-26 175450/175502/175815/180930.png`) | Mockup, nombres de campos y columnas resaltadas (sección 3). |
| `sql/16_qare_filtros_org.sql` | Cuerpos completos de `tvf_CorreoQARE_Base` y de los seis `usp_CorreoQARE_*` (aplicado en QA 2026-09-29). |
| `App_Code/QareContrato.cs`, `QareQueries.cs` | Contrato QARE verificado en QA (2026-09-25): fechas, defaults, escala de %. |
| `esquema_bd/` (export de QA, 2026-10-13) | Objetos, columnas y filas. Cuerpos truncados a ~250 caracteres. |
| `Integracion_SQL-Proactivanet/01_esquema_proactivanet.sql`, `generar_sql.py` | Columnas de `dbo.Tickets` y la pregunta del formulario detrás de cada `QARe_*`. |
| `App_Code/DashboardQueries.cs`, `sql/47_analisis_servicios.sql` | Uso actual de `dbo.CatCuentaNoPersona`. |
| Salida del diag 1 en QA (2026-11-27) | Sección 4. |

### 2.2 Verificado y reutilizable

- **Población:** `dbo.vw_CorreoQARECierre_Base` (envoltorio de `vw_CorreoQA_Base`,
  la misma base que QA). Una fila por `CodigoTicket`: diag 1, 9 310 filas = 9 310
  tickets distintos.
- **Fecha:** `FechaFirmaSolucion`; `@FechaFin` inclusivo
  (`>= @Fi AND < DATEADD(DAY,1,@Ff)`).
- **Default NULL/NULL** de los SP QARE: `@Ff` = hoy en México
  (`DATEADD(HOUR,-6,SYSUTCDATETIME())`), `@Fi` = `@Ff - 14` (15 días incluyendo hoy).
- **Porcentajes:** `DECIMAL(6,2)`, escala 0-100, `NULLIF(denominador, 0)`.
- **Pareto:** estructura de `usp_CorreoQARE_CausaRaiz`: `ROW_NUMBER() OVER (ORDER BY
  CantidadTickets DESC, <etiqueta> ASC)` y acumulado con
  `SUM() OVER (... ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)`.
- **Filtros:** convención de `tvf_CorreoQARE_Base` (lista por comas con
  `fn_CorreoBacklog_SplitList`, NULL/vacío = sin filtro).
- **Columnas de la vista usadas por la propuesta** (en `esquema_bd/02_columnas.tsv`):
  `CodigoTicket, FechaFirmaSolucion, FirmaSolucion, Tecnico, Grupo, Categoria,
  Validacion, QARe_Causa, QARe_AplicaOtrosCasos, QARe_GenerarArticulo,
  QARe_VerificoClasificacion, QARe_TipoSolucion, QARe_DescripcionSolucion,
  QARe_Evidencia, SolucionUsuario, QA_MensajeError`.

## 3. Requisitos visuales recuperados de Daniela

Transcripción de las capturas del 26-nov. Los encabezados de las tablas se leyeron
ampliando la captura; los nombres son legibles, pero conviene confirmarlos con el
archivo original de Daniela (sección 10).

### 3.1 Pantalla (mockup "QARE | Respuestas y patrones de solución")

- Filtros: **Período, Grupo, Categoría, Técnico**.
- Cuatro tarjetas: **Total de tickets, Sin información QARE, Respuestas
  analizables, Respuestas inválidas**. Nota en la tarjeta: "Estos indicadores
  evalúan únicamente la pregunta abierta."
- Barra segmentada "¿Qué encontramos en las respuestas analizables?".
- Pareto "Principales patrones de solución" (solo patrones reconocidos).
- Tabla "Explorar por técnico"; "Selecciona un técnico para filtrar la evidencia".
- Tabla "Evidencia QARE · compara lo declarado con lo escrito": búsqueda por
  ticket o texto, filtro "Todos los estados", selector de Columnas, "25 por
  página", filas expandibles con "Contexto y trazabilidad".
- Notas al pie: "Sin patrón no significa contradicción. La comparación entre
  respuestas es manual." y, en la barra, "Respuesta incompleta: solo describe el
  problema o no documenta una acción."
- Daniela: el mockup es "más o menos así"; las cifras son ilustrativas.

### 3.2 Barra segmentada (`usp_QARE_PatronesSolucion`)

Daniela: "Patrón reconocido = PctConPatron, Sin patrón identificado =
PctSinPatron y Respuesta incompleta = PctCalidad". Columnas de su salida de
ejemplo (resaltadas: los tres `Pct*`):

`TotalTextoEvaluable, TicketsConPatron, PctConPatron, TicketsCalidad, PctCalidad,
TicketsSinPatron, PctSinPatron`

Valores de ejemplo, **solo ilustrativos, no usar como resultado esperado**:
4 135 = 2 010 + 435 + 1 690; 48.61 + 10.52 + 40.87 = 100.

Rótulos: el chat define "Patrón reconocido / Respuesta incompleta / Sin patrón
identificado". El mockup usa otros ("Solución identificada / Respuesta
incompleta / Sin clasificar") y un borrador ASCII dice "Observación de captura".
Se toman los del chat por ser la indicación explícita.

### 3.3 Pareto (`usp_QARE_PatronesSolucion`)

Columnas: `Posicion, PatronSolucion, Tickets, Porcentaje, TicketsAcumulados,
PctAcumulado`. Barras = Tickets; línea = PctAcumulado en eje secundario; orden
descendente.

La captura muestra 13 patrones (nombres de su prototipo, **no aprobados como
catálogo**): ACTUALIZACION / INSTALACION, REINICIO / REACTIVACION,
INDICACIONES / CANALIZACION, ROLES / PERMISOS, VALIDACION / SIN INTERVENCION,
CONFIGURACION, CUENTAS / CREDENCIALES, HARDWARE / REPARACION, BASE DE DATOS /
DML, CANCELACION / CIERRE OPERA… (cortado), CAMBIO ADMINISTRATIVO, SEGURIDAD /
CONECTIVIDAD, REPROCESO / REENVIO.

### 3.4 Resumen por técnico (`usp_QARE_CalidadCaptura_Tecnicos`)

Columnas de la salida de su prototipo, en orden (**resaltadas en amarillo**):

**`FirmaSolucion`**, `TicketsTotales`, `TicketsSinInfo…` (nombre cortado en la
captura), `TicketsEvaluados`, **`TicketsNoEvaluables`**, `PctNoEvaluable`,
**`TicketsTextoEvaluable`**, `PctTextoEvaluable`, **`TicketsConPatron`**,
`PctConPatron`, **`TicketsCalidad`**, `PctCalidad`, **`TicketsSinPatron`**,
`PctSinPatron`.

Daniela: "solo estos 5", con esta correspondencia:

| Columna de la tabla | Campo del SP |
|---|---|
| Respuestas inválidas | `TicketsNoEvaluables` |
| Respuestas analizables | `TicketsTextoEvaluable` |
| Patrón reconocido | `TicketsConPatron` |
| Sin patrón identificado | `TicketsSinPatron` |
| Respuesta incompleta | `TicketsCalidad` |

El identificador de fila es **`FirmaSolucion`** (también resaltado), no `Tecnico`.

### 3.5 Detalle de evidencia (`usp_QARE_DetalleEvidencia`)

Columnas de la salida de su prototipo, en orden:

| Columna | Resalte | En la tabla |
|---|---|---|
| `CodigoTicket` | amarillo | visible |
| `FechaFirmaSolucion` | verde | oculta / expansión |
| `FirmaSolucion` | verde | oculta / expansión |
| `Grupo` | verde | oculta / expansión |
| `Categoria` | verde | oculta / expansión |
| `Validacion` | verde (el borde del resalte es dudoso; el mockup la pone en la expansión) | oculta / expansión |
| `QARe_Causa` | amarillo | visible |
| `QARe_AplicaOtrosCasos` | amarillo | visible |
| `QARe_GenerarArticulo` | amarillo | visible |
| `QARe_VerificoClasificacion` | amarillo | visible |
| `QARe_TipoSolucion` | amarillo | visible |
| `QARe_DescripcionSolucion` | amarillo | visible |
| `EstadoDescripcionVisual` | amarillo | visible |
| `ClasificacionRespuesta` | amarillo | visible |

Daniela: amarillas visibles; verdes ocultas, "al pasar el mouse o expandir". Se
prefiere expandir porque también funciona en pantallas táctiles.

Valores que se ven en su prototipo:
- `EstadoDescripcionVisual`: `RESPUESTA ANALIZABLE`, `RESPUESTA INVALIDA`,
  `SIN INFORMACION QARE`.
- `ClasificacionRespuesta`: nombre del patrón (`ACTUALIZACION / IN…`),
  `SIN PATRON IDENTIF…`, `PROBLEMA / NO SOL…` (probablemente "respuesta
  incompleta"; sin verificar) o `NULL` cuando el estado es inválida o sin
  información.

Diferencias entre mockup y captura (decidir en la revisión):
- El mockup pone "Estado de la abierta" en la expansión; en la captura
  `EstadoDescripcionVisual` está en amarillo.
- El mockup muestra "Regla detectada" (p. ej. `CALIBRACION`) en la expansión. Esa
  columna no aparece en la captura: hay que agregarla al contrato o quitarla del
  diseño.

## 4. Hallazgos de los diagnósticos

### 4.1 Diag 1 (QA, 2026-11-27; ventana 2026-10-29 a 2026-11-27)

**Población:** 9 310 tickets. `Grupo` y `Categoria` siempre llenos; 48 grupos,
423 rutas de categoría.

**Técnico**
- `Tecnico` nunca viene vacío; 103 distintos; 0 con U+FFFD.
- `Tecnico` = `vw_Tickets.TecnicoSegundaLinea` solo en 4 858 (52 %). En los ejemplos
  distintos, `TecnicoSegundaLinea` es NULL o es otra persona y `TecnicoAsignado`
  dice "Sin asignar".
- En la vista del SLA (`DashboardQueries.cs`) `Tecnico` es la firma de solución con
  respaldo en el asignado. Para `vw_CorreoQA_Base` **no está verificado**: el cuerpo
  volvió truncado.

**Cuentas que no son personas:** `User, Setup` (646 tickets, 25 grupos),
`Proactivanet, Customer Service`, `Lexmark, Proveedor`, `Lexmark2, Proveedor`,
`Soporte, Fenicia`. `dbo.CatCuentaNoPersona` ya existe y SLA y Análisis lo usan
para sacarlas de lo que habla de personas. Qué cuentas tiene hoy: diag 2, C.

**Captura QARE**
- 1 712 tickets (18.4 %) sin QARE: `TipoSolucion`, `AplicaOtrosCasos`,
  `GenerarArticulo` y los textos vienen NULL juntos.
- `Causa`, `Evidencia`, `DescripcionSolucion` y `TipoSolucion` se llenan juntos en
  7 595 de 7 598: "incompleta = falta un campo" casi no separa nada.
- `QARe_UsuarioConfirmo`: NULL en el 100 %. No sirve para reglas ni indicadores.

**Texto de la solución (`QARe_DescripcionSolucion`)**
- Largo: vacío 18.4 %, 1-9 caracteres 31.9 %, 10-19 17.2 %, 20-49 24.9 %, 50 o más 7.6 %.
- Más repetidos: `.` 778, `N/A` 424, `NO` 274, `-` 245, `NO  SALE ERROR` 217 (parece
  respuesta a otra pregunta del formulario), `NA` 208, `0` 181, `SI` 147,
  `SIN RESPUESTA` 121, guiones sueltos.
- Hay textos cortos con contenido real repetido: `PERMISOS ADICIONALES TIENDA`,
  `CARGA DE PRECIOS`, `SE REINICIA SERVICIOS DE EHUB`, `ALTA SAP TIENDA`.
  Candidatos para el catálogo, **no reglas**.
- 232 tickets copian `SolucionUsuario` tal cual; 36 copian el rótulo del tipo
  ("Se dan indicaciones, técnicamente no se hizo nada").

**Tipo de solución declarado:** `QARe_TipoSolucion` es un catálogo cerrado de 11
valores, lleno siempre que hay captura. El más usado es "Se dan indicaciones,
técnicamente no se hizo nada" (2 025). Es lo que el técnico declara; no equivale al
patrón reconocido en el texto.

**Catálogo existente:** `CatCausaRaizAgrupador` cubre 105 de 9 310 (1.1 %) y
`QARe_Causa` nunca empata con él. **Descartado** como fuente de patrones.

### 4.2 Diag 2 — pendiente de correr

`diag_qare_tecnicos_perfil_2.sql` está escrito (commit `8659104`) pero **su salida
no se ha compartido**. Medirá:
- **A.** Cuerpo completo de `vw_CorreoQA_Base` y `vw_CorreoQARECierre_Base`, una
  fila por línea.
- **B.** Si `Tecnico` = `FirmaSolucion` o = `COALESCE(FirmaSolucion, TecnicoSegundaLinea)`.
- **C.** Contenido de `CatCuentaNoPersona` y cuentas con forma de cuenta fuera de él.
- **D1/D2.** Cuántos tickets caen en cada regla candidata de "inválida" (cascada
  excluyente: vacío; sin letras; literal genérico; copia de `QA_MensajeError`;
  copia del tipo; menos de 10 caracteres; copia de `SolucionUsuario`), con ejemplos.
  **Son hipótesis para decidir, no reglas.**
- **D3.** Tickets sin captura por técnico.

## 5. Definiciones y reglas confirmadas

Confirmado por Daniela (capturas) o verificado en datos:

1. Las tarjetas y las tres categorías de la barra evalúan **solo la pregunta abierta**
   (`QARe_DescripcionSolucion`).
2. "Sin información QARE" es un indicador propio, con estado
   `SIN INFORMACION QARE` en el detalle.
3. Respuestas inválidas = `TicketsNoEvaluables`; analizables =
   `TicketsTextoEvaluable`; patrón reconocido = `TicketsConPatron`; sin patrón =
   `TicketsSinPatron`; respuesta incompleta = `TicketsCalidad`.
4. La barra usa `TotalTextoEvaluable` como denominador y sus tres categorías suman
   el 100 % de ese universo.
5. El Pareto cuenta solo tickets con patrón reconocido.
6. Respuesta incompleta, en palabras del mockup: "solo describe el problema o no
   documenta una acción". Es una definición funcional; **la regla que la detecta
   no está definida** (pendiente 9.5).
7. La tabla por técnico se agrupa por `FirmaSolucion` en el prototipo de Daniela.
8. Población, fecha, default, escala de % y convención de filtros: sección 2.2.
9. `QARe_UsuarioConfirmo` no se usa (100 % NULL).
10. `CatCausaRaizAgrupador` no es el catálogo de patrones.

## 6. Propuesta de clasificación (NO aprobada)

Estados excluyentes por ticket, evaluados en este orden. El orden es propuesta;
lo que dice el prototipo de Daniela está en la sección 8.

| # | Estado (`EstadoDescripcionVisual`) | Condición propuesta | Fuente de la condición |
|---|---|---|---|
| 1 | `SIN INFORMACION QARE` | Sin captura QARE (`QARe_DescripcionSolucion` y `QARe_TipoSolucion` NULL) | Diag 1: van NULL juntos. **Definición exacta pendiente (9.1).** |
| 2 | `RESPUESTA INVALIDA` | El texto no es evaluable | Reglas candidatas D1 del diag 2. **Pendiente (9.4).** |
| 3 | `RESPUESTA ANALIZABLE` | Todo lo demás | Complemento de 1 y 2 dentro del total. |

Dentro de `RESPUESTA ANALIZABLE`, una sola `ClasificacionRespuesta`:

| Sub-estado | Condición propuesta | Pendiente |
|---|---|---|
| Patrón reconocido | El texto coincide con un patrón del catálogo nuevo | Catálogo y método de coincidencia (9.6, 9.9) |
| Respuesta incompleta | "Solo describe el problema o no documenta una acción" | Regla (9.5) |
| Sin patrón identificado | Analizable, sin patrón y no incompleta | Depende de las dos anteriores |

Dónde vive el catálogo (decisión técnica, requiere DDL aparte con aprobación):
- **Tabla de patrones + frases** y coincidencia en SQL sobre texto normalizado
  (mayúsculas, sin acentos, sin espacios dobles). Sirve si las frases son pocas y
  exactas.
- **Clasificación precalculada** (`CodigoTicket -> Patron, Regla`) escrita por un
  proceso. Sirve si la regla es difusa o el catálogo crece. Los SP solo leen.

En los dos casos, "Regla detectada" del mockup sería la frase que coincidió.

## 7. Matriz de indicadores, campos y denominadores

| Indicador | `usp_QARE_PatronesSolucion` | `usp_QARE_CalidadCaptura_Tecnicos` | `usp_QARE_DetalleEvidencia` | Denominador del % |
|---|---|---|---|---|
| Total de tickets | **sin nombre en las capturas** (pendiente 9.10) | `TicketsTotales` | `COUNT(*)` | — |
| Sin información QARE | **sin nombre** (9.10) | `TicketsSinInfo…` (nombre cortado) | `EstadoDescripcionVisual = 'SIN INFORMACION QARE'` | — |
| Evaluados | — | `TicketsEvaluados` | estado ≠ sin información | — |
| Respuestas inválidas | **sin nombre** (9.10) | `TicketsNoEvaluables`, `PctNoEvaluable` | `= 'RESPUESTA INVALIDA'` | `TicketsEvaluados` (8.1) |
| Respuestas analizables | `TotalTextoEvaluable` | `TicketsTextoEvaluable`, `PctTextoEvaluable` | `= 'RESPUESTA ANALIZABLE'` | `TicketsEvaluados` (8.1) |
| Patrón reconocido | `TicketsConPatron`, `PctConPatron` | `TicketsConPatron`, `PctConPatron` | `ClasificacionRespuesta` = patrón | `TotalTextoEvaluable` |
| Respuesta incompleta | `TicketsCalidad`, `PctCalidad` | `TicketsCalidad`, `PctCalidad` | `ClasificacionRespuesta` = incompleta | `TotalTextoEvaluable` |
| Sin patrón identificado | `TicketsSinPatron`, `PctSinPatron` | `TicketsSinPatron`, `PctSinPatron` | `ClasificacionRespuesta` = sin patrón | `TotalTextoEvaluable` |
| Pareto | `Posicion, PatronSolucion, Tickets, Porcentaje, TicketsAcumulados, PctAcumulado` | — | — | `Porcentaje` y `PctAcumulado` sobre `TicketsConPatron` (8.1) |
| Técnico | — | `FirmaSolucion` | `FirmaSolucion` | — |

Las cuatro tarjetas y la barra salen de `usp_QARE_PatronesSolucion`, pero las
capturas solo muestran el result set de la barra y el del Pareto. Falta decidir si
las tarjetas son un tercer result set o se suman de la tabla por técnico (9.10).

## 8. Reconciliación de poblaciones

### 8.1 Lo que dicen los números del prototipo de Daniela

Se comprobó con las filas visibles de sus capturas (aritmética, no datos de QA):

| Relación | Evidencia |
|---|---|
| `TicketsTotales = TicketsSinInfo + TicketsEvaluados` | Fila 2: 243 = 1 + 242 |
| `TicketsEvaluados = TicketsNoEvaluables + TicketsTextoEvaluable` | 480 = 346 + 134; 242 = 1 + 241; 240 = 1 + 239; 224 = 1 + 223 |
| `PctNoEvaluable` / `PctTextoEvaluable` sobre `TicketsEvaluados`, no sobre el total | Fila 2: 241/242 = 99.59 (lo que muestra); 241/243 daría 99.18 |
| `TicketsTextoEvaluable = TicketsConPatron + TicketsCalidad + TicketsSinPatron` | 134 = 78 + 0 + 56; 241 = 127 + 17 + 97; 239 = 116 + 2 + 121; 223 = 105 + 54 + 64 |
| `PctConPatron`, `PctCalidad`, `PctSinPatron` sobre `TicketsTextoEvaluable` | 78/134 = 58.21; 17/241 = 7.05; 121/239 = 50.63; 54/223 = 24.22 |
| Barra global | 2 010 + 435 + 1 690 = 4 135; 2 010/4 135 = 48.61 |
| Pareto: `Porcentaje` sobre `TicketsConPatron` | 278/2 010 = 13.83; 160/2 010 = 7.96 |

Conclusión: **en el prototipo de Daniela, los tickets sin información NO entran en
"no evaluables"** (fila 2: 1 sin info + 1 no evaluable + 241 evaluables = 243).
Es evidencia fuerte para la pregunta 9.1, pero falta que el negocio la confirme.

El Pareto visible termina en 13 filas con `TicketsAcumulados` = 1 990 y
`PctAcumulado` = 99.00 (1 990/2 010). Faltan 20 tickets: o hay filas fuera de la
captura o hay patrones excluidos. Sin verificar.

### 8.2 Poblaciones que hay que distinguir

```
T   Total de tickets del periodo
S   Sin información QARE                         (S ⊂ T)
E   Evaluados = T − S
I   Respuestas inválidas (no evaluables)         (I ⊂ E, según 8.1)
A   Analizables (texto evaluable) = E − I        = TotalTextoEvaluable
P   Con patrón reconocido                        (P ⊂ A)
C   Respuesta incompleta (calidad)               (C ⊂ A)
N   Sin patrón identificado                      (N ⊂ A)
```

No se da por hecho que S quede fuera de I ni que P, C y N sean excluyentes hasta
aprobar 9.1 y 9.4-9.6.

### 8.3 Pruebas de reconciliación antes de implementar (las hará el script de validación)

1. `T = S + I + A`.
2. `A = P + C + N` (cada ticket analizable en una sola sub-categoría).
3. `PctConPatron + PctCalidad + PctSinPatron = 100` (± 0.02 por redondeo).
4. `SUM(Pareto.Tickets) = P`; último `PctAcumulado = 100.00` (± redondeo); no decrece.
5. Por técnico: la suma de cada columna = el total global del mismo filtro (si se
   excluyen cuentas no-persona, la diferencia = sus tickets, reportada aparte).
6. Detalle: `COUNT(*)` por `EstadoDescripcionVisual` y `ClasificacionRespuesta` = los
   conteos de los otros dos SP con los mismos parámetros.
7. Un mismo `CodigoTicket` aparece una sola vez en el detalle.
8. La suma de días sueltos = el rango (fin inclusivo), como en QARE.

## 9. Pendientes de definición de negocio

1. **Sin captura QARE:** ¿los 1 712 tickets sin captura cuentan también como
   respuestas inválidas o solo en "Sin información QARE"? El prototipo de Daniela
   los deja fuera (8.1): falta confirmarlo. También falta la definición exacta de
   "sin captura": ¿solo `QARe_DescripcionSolucion` NULL o todos los campos QARE NULL?
2. **Cuentas que no son personas:** ¿se excluyen de la tabla por técnico `User,
   Setup` y las demás de `dbo.CatCuentaNoPersona`? Ojo: el mockup muestra `User,
   Setup` y `Mexba, Proveedor` como filas.
3. **Identidad del técnico:** el prototipo agrupa por `FirmaSolucion`. ¿Se usa
   `FirmaSolucion` tal cual (¿y qué pasa si viene vacía?) o `Tecnico` (que en el SLA
   es firma con respaldo en el asignado)? El diag 2 B mide la diferencia.
4. **Respuesta inválida:** ¿qué reglas candidatas del diag 2 (D1) se aprueban y qué
   literales forman la lista de genéricos?
5. **Respuesta incompleta:** ¿qué regla detecta "solo describe el problema o no
   documenta una acción"? ¿Lista de frases, ausencia de verbo de acción, otra?
6. **Catálogo de patrones:** ¿se adoptan los 13 grupos del prototipo de Daniela?
   ¿Quién valida qué textos pertenecen a cada uno?
7. **Categoría:** ¿el filtro usa la ruta completa, la raíz (C1, como QARE) o un
   nivel específico?
8. **Parámetros definitivos** comunes a los tres SP (propuesta en 9.11).
9. **Un ticket con dos patrones:** ¿gana el primero por prioridad o cuenta en ambos?
   Si cuenta en ambos, el Pareto deja de sumar `P` y se rompe la prueba 8.3.4.
10. **Tarjetas:** nombre de las columnas de Total, Sin información e Inválidas en
    `usp_QARE_PatronesSolucion` (no aparecen en las capturas).
11. **Parámetros propuestos:** `@FechaInicio DATE = NULL`, `@FechaFin DATE = NULL`
    (inclusivo), `@Grupos NVARCHAR(MAX) = NULL`, `@Categorias NVARCHAR(MAX) = NULL`
    (según 9.7), `@Tecnicos NVARCHAR(MAX) = NULL` (listas por comas, NULL = todo). El
    detalle además `@Estado` y `@Clasificacion` (clic en la barra o el Pareto). ¿Se
    mantienen también `@C1`/`@Lideres` de QARE?
12. **Detalle:** ¿`EstadoDescripcionVisual` visible (captura) o en la expansión
    (mockup)? ¿Se agrega "Regla detectada"?
13. ¿Las cinco columnas por técnico se muestran solo como conteo o también con su %?

## 10. Riesgos y validaciones antes de crear los SP

- **Pedir a Daniela el código de su prototipo.** Las capturas son salidas reales de
  SSMS (se ve "Return Value"), con estados y patrones ya calculados. Sus SP o
  consultas contienen las reglas de 9.1 y 9.3-9.6. Con ese código la mayoría de las
  preguntas se cierran leyendo, no decidiendo.
- **Correr el diag 2** en QA (sección 4.2): cierra el origen de `Tecnico`, el
  contenido de `CatCuentaNoPersona` y da cifras para las reglas de inválida.
- **Confirmar los encabezados** de 3.4 y 3.5 con el archivo original: los nombres
  se leyeron de una captura ampliada; `TicketsSinInfo…` está cortado y el borde del
  resalte de `Validacion` es dudoso.
- **Rendimiento:** la coincidencia de frases con `LIKE '%…%'` sobre NVARCHAR(MAX)
  no usa índices; en 30 días son ~9 300 filas (aceptable), pero hay que medirlo
  contra 90 días antes de exponer rangos largos.
- **Nombres con acentos rotos** en la BD: hoy 0 en el periodo; el filtro de técnico
  debe comparar contra el valor tal como viene.
- **DDL:** el catálogo de patrones requiere crear tablas. Script, rollback y
  aprobación aparte; nada se aplica sin autorización.
- **No tocar** `usp_CorreoQARE_*`, `tvf_CorreoQARE_Base` ni la pestaña QARE actual.
