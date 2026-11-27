# Propuesta: pestaña Técnicos / QARE

Estado (2026-11-27, tarde): **los cuatro SP ya existen en QA como prototipo de
Daniela** (sección 12). Este documento pasa de "diseñar" a "revisar ese
prototipo". Nada de lo propuesto aquí está implementado ni aplicado.

Archivos de diagnóstico (solo lectura):
`sql/diag/diag_qare_tecnicos_perfil.sql` (diag 1, corrido en QA 2026-11-27),
`sql/diag/diag_qare_tecnicos_perfil_2.sql` (diag 2, corrido en QA 2026-11-27 11:02),
los seis de la investigación SQL (sección 11, corridos en QA 2026-11-27 11:39-11:52)
y `sql/diag/diag_qare_tecnicos_prototipo.sql` (ampliado 2026-11-27, **sin correr**).

## 1. Objetivo y alcance

Nueva pestaña "Técnicos / QARE" junto a QA y QARE (Calidad de información). Mide
la calidad de la pregunta abierta del formulario QARE
(`QARe_DescripcionSolucion`, "Describe la solución aplicada") por ticket, por
patrón de solución y por técnico.

Cuatro procedimientos nuevos, que no reemplazan ni alteran los `usp_CorreoQARE_*`:

| SP | Alimenta |
|---|---|
| `usp_QARE_CalidadCaptura_KPIs` | Las cuatro tarjetas |
| `usp_QARE_PatronesSolucion` | Barra segmentada y Pareto |
| `usp_QARE_CalidadCaptura_Tecnicos` | Tabla por técnico |
| `usp_QARE_DetalleEvidencia` | Tabla de evidencia por ticket |

El nombre `usp_QARE_CalidadCaptura_KPIs` lo dio el usuario el 2026-11-27; no
aparece en las cuatro capturas guardadas. Su salida no se ve en ninguna captura
(sección 11.6).

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
  tickets distintos. `vw_CorreoQARECierre_Base` es un `SELECT` de columnas de
  `vw_CorreoQA_Base` sin filtro propio (diag 2, A).
- **Alcance heredado de `vw_CorreoQA_Base`** (diag 2, A): lee `dbo.vw_Tickets`; solo
  `Estado = 'Cerrada'`; excluye los grupos `Datos Maestros%`, `Servicios al personal%`
  y `SorIA`, y las categorías `Soria%`, `S-Mesa de Servicios al Personal%`,
  `S-Datos-Maestros%` y `S-Punto de Venta/Aplicativo/Ampliaci%`. `Grupo` vacío sale
  como `'Sin grupo'`. La pestaña nueva hereda este alcance sin reimplementarlo.
- **Técnico** (diag 2, A): `Tecnico = COALESCE(NULLIF(TRIM(FirmaSolucion)),
  NULLIF(TRIM(TecnicoSegundaLinea)), 'Sin tecnico')`: quien firmó la solución y, si
  no hay firma, el asignado. Es la misma regla que `vw_Dash_ProductividadBase` (SLA).
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
ampliando la captura (releídos el 2026-11-27 con la misma transcripción); son
legibles, salvo `TicketsSinInfo…`, que está cortado en el original.

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
- Explicación (diag 2): `Tecnico` es la firma de solución, no el asignado (2.2).

**Cuentas que no son personas:** `User, Setup` (646 tickets, 25 grupos),
`Proactivanet, Customer Service`, `Lexmark, Proveedor`, `Lexmark2, Proveedor`,
`Soporte, Fenicia`. `dbo.CatCuentaNoPersona` ya existe y SLA y Análisis lo usan
para sacarlas de lo que habla de personas. Contenido: 4.2, C.

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

### 4.2 Diag 2 (QA, 2026-11-27 11:02; misma ventana, 9 341 tickets)

La población creció de 9 310 a 9 341 entre corridas del mismo día: son tickets
cerrados en el intervalo. Los porcentajes no cambian de forma apreciable.

**A. Definiciones:** ver 2.2 (alcance y regla de `Tecnico`).

**B. Origen de `Tecnico`:** igual a `FirmaSolucion` en 9 341 de 9 341; `FirmaSolucion`
vacía en 0; igual a `TecnicoSegundaLinea` en solo 4 876. En este periodo, agrupar por
`Tecnico` o por `FirmaSolucion` (como el prototipo de Daniela) da lo mismo. `Tecnico`
además tiene respaldo definido si algún día la firma viene vacía.

**C. Cuentas que no son personas.**

`dbo.CatCuentaNoPersona` (8 cuentas, todas `Habilitado = 1`):

| Cuenta | Tipo | Tickets en el periodo |
|---|---|---|
| `User, Setup` | Automatizacion | 648 |
| `Proactivanet, Customer Service` | Automatizacion | 99 |
| `MAC, Mesa` | Generica | 5 |
| `Desk, Smart` | Automatizacion | 1 |
| `Energeticos, Control`, `NetLogistik, NetLogistik Soporte`, `Operaciones, Operaciones`, `Soriana, Consulta` | Generica / Proveedor | 0 |

Cuentas con forma de cuenta que **no** están en el catálogo (457 tickets):
`Lexmark, Proveedor` 109, `Soporte, Fenicia` 90, `Lexmark2, Proveedor` 85,
`Transnetwork, Proveedor` 63, `Bizerba, Proveedor` 35, `Sonda, Proveedor` 24,
`Mexba, Proveedor` 21, `Berkel, Proveedor` 12, `Realfix, Proveedor` 10,
`Honeywell, Proveedor` 7, `PCM, Proveedor` 1. Son cuentas de proveedor que sí
capturan QARE (p. ej. `Bizerba` 1 de 35 sin captura), así que excluirlas no es
automático (9.2).

**D1. Cascada candidata de "inválida"** (excluyente, gana la primera; **hipótesis,
no reglas**):

| Regla | Tickets | % de 9 341 | Técnicos | Lectura de los ejemplos (D2) |
|---|---|---|---|---|
| R0 sin captura / vacío | 1 715 | 18.36 | 17 | Igual a "sin información QARE" (1 712 en diag 1). |
| R1 sin letras (`.`, `-`, `0`, `1`, `,`) | 1 651 | 17.67 | 34 | Basura evidente. |
| R2 literal genérico (`N/A`, `NA`, `NO`, `SI`, `SIN RESPUESTA`, `NO  SALE ERROR`…) | 1 636 | 17.51 | 44 | Basura evidente. |
| R3 copia de `QA_MensajeError` | 8 | 0.09 | 4 | **Respuestas con contenido** (`DESBLOQUEO DE USUARIO`, `LIBERACIÓN DE PRESUPUESTO`). La regla las marcaría mal. |
| R4 copia del rótulo del tipo declarado | 66 | 0.71 | 4 | Repite el catálogo ("Se dan indicaciones, técnicamente no se hizo nada" 36, "No fue necesario hacer nada…" 19, "Se otorgan permisos" 10): no agrega nada al tipo declarado. |
| R5 menos de 10 caracteres | 231 | 2.47 | 39 | **Mezcla**: basura (`X`, `N`, `FF`, `AN`, `NO APLICA`) y palabras con significado (`REINICIO` 21, `PINPAD`, `GAVETA`, `BASCULA`, `DOMINIO`). El largo no separa. |
| R6 copia de `SolucionUsuario` | 213 | 2.28 | 15 | **Soluciones reales** (`SE RESETEA PERFIL VIRTUAL`, `SE EJECUTAN POLITICAS DE WINDOWS`, textos largos de básculas). La regla las marcaría mal. |
| Z pasa todas | 3 821 | 40.91 | 84 | Incluye patrones claros (`CARGA DE PRECIOS`, `PERMISOS ADICIONALES TIENDA`, `SE REINICIA SERVICIOS DE EHUB`) y frases sin acción (`SE BRINDA CONTACTO PARA SEGUIMIENTO`, `INCIDENCIA GENERAL RESUELTA`, `CONFIRMAN EL CIERRE DEL TICKET`, `SE DAN INDICACIONES`). |

**D3. Sin captura por técnico:** muy concentrado. Cuatro firmas suman 1 672 de los
1 715 sin captura (97.5 %): dos técnicos de un solo grupo cada uno (83 % y 89 % de
sus tickets sin captura) y las cuentas `User, Setup` (91 %) y `Proactivanet,
Customer Service` (92 %). El resto de los técnicos tiene entre 0 % y 17 %. Parece
hábito o flujo de captura de esas firmas, no una falla general del formulario.
**Sin verificar** si el grupo de esos dos técnicos cierra por un flujo que no muestra
el formulario QARE.

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
   En la base, `Tecnico` = `COALESCE(FirmaSolucion, TecnicoSegundaLinea, 'Sin tecnico')`
   y coincide con `FirmaSolucion` en el 100 % del periodo medido (diag 2, B).
8. Población, fecha, default, escala de % y convención de filtros: sección 2.2.
9. `QARe_UsuarioConfirmo` no se usa (100 % NULL).
10. `CatCausaRaizAgrupador` no es el catálogo de patrones.

## 6. Propuesta de clasificación (NO aprobada)

Estados excluyentes por ticket, evaluados en este orden. El orden es propuesta;
lo que dice el prototipo de Daniela está en la sección 8.

| # | Estado (`EstadoDescripcionVisual`) | Condición propuesta | Fuente de la condición |
|---|---|---|---|
| 1 | `SIN INFORMACION QARE` | Sin captura QARE (`QARe_DescripcionSolucion` y `QARe_TipoSolucion` NULL) | Diag 1: van NULL juntos. **Definición exacta pendiente (9.1).** |
| 2 | `RESPUESTA INVALIDA` | El texto no es evaluable | Reglas candidatas D1 del diag 2. **Pendiente (9.4).** Propuesta técnica según 4.2: R1 + R2 (con la lista de literales ampliada con `NO APLICA`, `X`, `N`…) + quizá R4; no R3, R5 ni R6. Con esa base serían de 3 287 (R1 + R2) a ~3 400 inválidas (más R4 y la basura de R5, que D1 no separa) y de ~4 230 a 4 339 analizables, sobre 9 341 tickets con 1 715 sin captura. |
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

| Indicador | `usp_QARE_CalidadCaptura_KPIs` | `usp_QARE_PatronesSolucion` | `usp_QARE_CalidadCaptura_Tecnicos` | `usp_QARE_DetalleEvidencia` | Denominador del % |
|---|---|---|---|---|---|
| Total de tickets | **sin nombre en las capturas** (9.10) | — | `TicketsTotales` | `COUNT(*)` | — |
| Sin información QARE | **sin nombre** (9.10) | — | `TicketsSinInfo…` (nombre cortado) | `EstadoDescripcionVisual = 'SIN INFORMACION QARE'` | — |
| Evaluados | — | — | `TicketsEvaluados` | estado ≠ sin información | — |
| Respuestas inválidas | **sin nombre** (9.10) | — | `TicketsNoEvaluables`, `PctNoEvaluable` | `= 'RESPUESTA INVALIDA'` | `TicketsEvaluados` (8.1) |
| Respuestas analizables | **sin nombre** (9.10) | `TotalTextoEvaluable` | `TicketsTextoEvaluable`, `PctTextoEvaluable` | `= 'RESPUESTA ANALIZABLE'` | `TicketsEvaluados` (8.1) |
| Patrón reconocido | — | `TicketsConPatron`, `PctConPatron` | `TicketsConPatron`, `PctConPatron` | `ClasificacionRespuesta` = patrón | `TotalTextoEvaluable` |
| Respuesta incompleta | — | `TicketsCalidad`, `PctCalidad` | `TicketsCalidad`, `PctCalidad` | `ClasificacionRespuesta` = incompleta | `TotalTextoEvaluable` |
| Sin patrón identificado | — | `TicketsSinPatron`, `PctSinPatron` | `TicketsSinPatron`, `PctSinPatron` | `ClasificacionRespuesta` = sin patrón | `TotalTextoEvaluable` |
| Pareto | — | `Posicion, PatronSolucion, Tickets, Porcentaje, TicketsAcumulados, PctAcumulado` | — | — | `Porcentaje` y `PctAcumulado` sobre `TicketsConPatron` (8.1) |
| Técnico | — | — | `FirmaSolucion` | `FirmaSolucion` | — |

Las tarjetas tienen su propio SP; las capturas solo muestran los result sets de
la barra, el Pareto, la tabla por técnico y el detalle.

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
   (En datos dan casi lo mismo: R0 = 1 715 y todos-NULL = 1 712.) Dato para decidir:
   el 97.5 % de los sin captura viene de cuatro firmas (4.2, D3); contarlos como
   inválidos cargaría a esos técnicos con un problema de captura, no de redacción.
2. **Cuentas que no son personas:** ¿se excluyen de la tabla por técnico `User,
   Setup` y las demás de `dbo.CatCuentaNoPersona`? Ojo: el mockup muestra `User,
   Setup` y `Mexba, Proveedor` como filas. Y aparte: ¿las 11 cuentas de proveedor
   fuera del catálogo (457 tickets, 4.2 C) cuentan como técnicos? Sí capturan QARE.
   Si se excluyen, ¿se dan de alta en el catálogo? Es un cambio de datos que también
   afecta a SLA y Análisis.
3. **Identidad del técnico:** casi cerrada. `Tecnico` es la firma de solución con
   respaldo en el asignado y es igual a `FirmaSolucion` en el 100 % del periodo
   (4.2 B). Propuesta: calcular con `Tecnico` y devolver la columna con el nombre del
   prototipo, `FirmaSolucion`. Solo falta el visto bueno a ese nombre.
4. **Respuesta inválida:** ¿qué reglas candidatas se aprueban y qué literales
   forman la lista de genéricos? Datos en 4.2 D1/D2: R1 y R2 son basura evidente;
   R3 y R6 marcarían mal respuestas con contenido; R5 (largo) mezcla basura con
   palabras útiles; R4 (copiar el rótulo del tipo) es decisión de negocio:
   ¿inválida o incompleta?
5. **Respuesta incompleta:** ¿qué regla detecta "solo describe el problema o no
   documenta una acción"? ¿Lista de frases, ausencia de verbo de acción, otra?
   Candidatas vistas en el grupo Z: `SE BRINDA CONTACTO PARA SEGUIMIENTO`,
   `INCIDENCIA GENERAL RESUELTA`, `CONFIRMAN EL CIERRE DEL TICKET`,
   `SE DAN INDICACIONES`; y las palabras sueltas de R5 (`REINICIO`, `PINPAD`):
   ¿incompletas o patrón?
6. **Catálogo de patrones:** ¿se adoptan los 13 grupos del prototipo de Daniela?
   ¿Quién valida qué textos pertenecen a cada uno?
7. **Categoría:** ¿el filtro usa la ruta completa, la raíz (C1, como QARE) o un
   nivel específico?
8. **Parámetros definitivos** comunes a los tres SP (propuesta en 9.11).
9. **Un ticket con dos patrones:** ¿gana el primero por prioridad o cuenta en ambos?
   Si cuenta en ambos, el Pareto deja de sumar `P` y se rompe la prueba 8.3.4.
10. **Tarjetas:** salen de `usp_QARE_CalidadCaptura_KPIs`, pero ninguna captura
    muestra sus columnas. Propuesta técnica: los mismos nombres que la tabla por
    técnico (`TicketsTotales`, `TicketsSinInfo…`, `TicketsNoEvaluables`,
    `TicketsTextoEvaluable`), para que la prueba 8.3.5 compare columna con
    columna. Falta el visto bueno y el nombre completo de `TicketsSinInfo…`.
11. **Parámetros propuestos:** `@FechaInicio DATE = NULL`, `@FechaFin DATE = NULL`
    (inclusivo), `@Grupos NVARCHAR(MAX) = NULL`, `@Categorias NVARCHAR(MAX) = NULL`
    (según 9.7), `@Tecnicos NVARCHAR(MAX) = NULL` (listas por comas, NULL = todo). El
    detalle además `@Estado` y `@Clasificacion` (clic en la barra o el Pareto). ¿Se
    mantienen también `@C1`/`@Lideres` de QARE?
12. **Detalle:** ¿`EstadoDescripcionVisual` visible (captura) o en la expansión
    (mockup)? ¿Se agrega "Regla detectada"?
13. ¿Las cinco columnas por técnico se muestran solo como conteo o también con su %?
14. **Sin captura concentrado:** ¿el grupo de los dos técnicos con 83-89 % sin
    captura cierra por un flujo donde no aparece el formulario QARE? Si es así, ¿se
    excluye ese flujo o se muestra tal cual?

## 10. Riesgos y validaciones antes de crear los SP

- **Código del prototipo de Daniela.** Las capturas son salidas reales de SSMS
  (se ve "Return Value"), con estados y patrones ya calculados: sus SP existen en
  alguna base. Antes de pedírselo, `diag_qare_objetos_fuentes.sql` (1b y 1c) los
  busca en todas las bases a las que la cuenta tiene acceso y
  `diag_qare_tecnicos_prototipo.sql` imprime su cuerpo. Solo si no aparecen se le
  pide. Con ese código la mayoría de las preguntas se cierran leyendo, no decidiendo.
- ~~Correr el diag 2~~ (hecho 2026-11-27, 4.2).
- **Reglas por lista literal** (R2 y las de incompleta) son frágiles: cada técnico
  inventa su variante (`NA`, `N/A`, `NO APLICA`). Hay que normalizar el texto
  (mayúsculas, sin acentos, espacios dobles, puntuación final) antes de comparar y
  revisar la lista con cada periodo nuevo.
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

## 11. Investigación SQL (2026-11-27)

Objetivo: agotar la evidencia técnica (base, repositorios, ETL, capturas) antes de
llevar preguntas al negocio. Escrita antes de correr los scripts de 11.4; sus
resultados y el prototipo que encontraron están en la sección 12, que corrige lo
que aquí quedó superado (11.3.1, 11.9, 11.10).

### 11.1 Fuentes identificadas

Además de las de 2.1 y 2.2:

| Fuente | Qué aporta | Verificado en |
|---|---|---|
| `dbo.vw_CorreoQA_Base` | Base de la vista QARE. Trae `TecnicoAsignado`, que `vw_CorreoQARECierre_Base` no expone. | `esquema_bd/02_columnas.tsv`, diag 2 A |
| `dbo.vw_Tickets` | Campos fuera de la vista QARE: `TecnicoSegundaLinea`, `CausaRaizFenix`, `CausaRaizGrupos`, `Lider`. | `esquema_bd/02_columnas.tsv` |
| `dbo.vw_Dash_ProductividadBase` (SLA) | `Tecnico`, `TecnicoResolvio`, `EsPersona`: la atribución del tablero SLA. | `esquema_bd/02_columnas.tsv`, `DashboardQueries.cs` |
| `dbo.usp_CorreoQARE_Detalle` | Una fila por ticket, 50 columnas y seis banderas calculadas (`EsRecurrente`, `UsuarioConfirmo`, `EsCasoReutilizable`, `EsPotencialKB`, `EsInconsistenciaConfirmacionQA`, `EsOportunidadKB`). Lo usa el export QARE. | `App_Code/QareExportar.cs` |
| `usp_CorreoQARE_KB`, `_OportunidadesKB`, `_RecurrentesAplicacion` | SP QARE que no están en `sql/16` ni en ningún repositorio. | `esquema_bd/01_objetos.tsv` (cuerpos truncados) |
| `dbo.CatAgenteTecnico` (20 filas), `CatAgenteTecnicoAlias` (2), `vw_TecnicoAgente` | Agentes de Call Center con extensión y nombres viejos. **No** es un catálogo de técnicos: solo cubre a quien tiene extensión. Sirve para detectar alias. | `esquema_bd/06_filas.tsv`, `DASHBOARD.md` |
| `dbo.AnalisisRegla` + `analisis/motor.js` | Clasificador de texto por frases (sección 11.3). | `sql/47`, `sql/79`, `sql/80`, `motor.js` |
| ETL (`Integracion_SQL-Proactivanet/01_esquema_proactivanet.sql`, `generar_sql.py`) | Texto de cada pregunta del formulario y la carga: `QARe_DescripcionSolucion = NULLIF(s.QARe_DescripcionSolucion, '')`, sin recortar; las respuestas cortas (`AplicaOtrosCasos`, `GenerarArticulo`, `VerificoClasificacion`) sí se recortan. | Código del ETL |
| `sql/10_qa_web.sql` | `Validacion` = validación de la **categoría** del ticket en QA (`OK / Valido / Incorrecto / Sin catalogo`). No mide el texto QARE: en el detalle es contexto, no calidad. | Cabecera del script |

Consecuencia del ETL: un texto de solo espacios llega como no NULL. Es una
explicación posible de R0 = 1 715 contra 1 712 con todo NULL (diag 1 y 2), **sin
verificar**; `diag_qare_kpis.sql` sección 3 lo mide (S1 contra S2).

### 11.2 Objetos reutilizables

| Objeto | Para qué | SP |
|---|---|---|
| `vw_CorreoQARECierre_Base` | Población (2.2) | Los cuatro |
| `tvf_CorreoQARE_Base` | Filtros C1 / Grupo / Líder y su convención | Los cuatro (si se mantienen esos filtros, 9.11) |
| `fn_CorreoBacklog_SplitList`, `fn_CorreoBacklog_CategoriaC1`, `CatLiderGrupo` | Listas por comas, C1, líder | Los cuatro |
| `CatCuentaNoPersona` | Marcar cuentas que no son personas | Técnicos |
| Estructura de `usp_CorreoQARE_CausaRaiz` | Pareto | Patrones |
| Método de `motor.js` / `AnalisisRegla` | Coincidencia de frases sobre texto normalizado | Patrones, y quizá incompleta |

### 11.3 Lógica ya implementada

1. **Superado (sección 12):** las reglas sí existen en QA, en el prototipo de
   Daniela. Lo que sigue vale para los repositorios. Búsqueda en `claude-branch`
   (JS, C#, SQL), en `Integracion_SQL-Proactivanet` y en los cuerpos truncados de
   `esquema_bd/`: no hay listas de genéricos, umbrales de largo ni verificación de
   letras sobre `QARe_*`. Falta confirmarlo en los cuerpos completos de la base
   (`diag_qare_objetos_fuentes.sql` 3c y 4), sobre todo `EsOportunidadKB` y
   `EsPotencialKB` de `usp_CorreoQARE_Detalle`, las únicas banderas que podrían
   mirar el texto.
2. **Única normalización de texto en QARE:** `UPPER(LTRIM(RTRIM(x))) IN (N'SI', N'SÍ')`
   en `usp_CorreoQARE_KPIs` y `_ConfirmacionVsQA`.
3. **Denominadores:** `usp_CorreoQARE_KPIs` divide cada % entre los tickets que
   contestaron esa pregunta (`TicketsConRespuesta*`), no entre el total. Es la
   misma convención que el prototipo de Daniela (`PctNoEvaluable` sobre
   `TicketsEvaluados`, 8.1).
4. **Cuentas que no son personas — dos precedentes distintos:**
   - SLA (`DashboardQueries.cs`): `CatCuentaNoPersona.Cuenta = b.Tecnico` exacto.
     Salen solo de lo que habla de personas (gráfica por técnico, ranking,
     técnicos activos); **siguen** en volúmenes y SLA, en la tarjeta
     "Automatizado". Sin la tabla, respaldo fijo `'Desk, Smart'`, `'User, Setup'`.
   - Análisis (`sql/47`): compara contra `FirmaSolucion` con NBSP convertido y
     recortado; excluye el ticket entero y lo cuenta en `ExcluidosCuenta`.
   - SLA "Sin proveedores" excluye **grupos** `Proveedor%`, no cuentas.
5. **Clasificación de texto en Análisis** (`motor.js`): normaliza (minúsculas, sin
   acentos, todo lo que no sea letra, número o `:` a espacio), recorre reglas
   ordenadas y **gana la primera**; cada regla es una lista de frases sobre título +
   descripción (D), solución (S) o ambas (DS); lo que no coincide va a
   "Sin clasificar" (R99). Las reglas son por servicio y miran `SolucionUsuario`,
   no el texto QARE. Dos motivos se repiten entre servicios: "Cerrado sin
   respuesta" y "Duplicado". El **método** sirve para patrones; las frases no.
6. **Atribución del técnico:** 2.2 y diag 2 B. `Tecnico` = `FirmaSolucion` en el
   100 % del periodo; el SLA usa la misma regla.

### 11.4 Consultas de diagnóstico creadas

Todas en `sql/diag/`. Solo `SELECT`; la única escritura es la tabla temporal `#Q`
de la sesión (se borra al final). Ventana fija 2026-10-29 a 2026-11-27, la de los
diag 1 y 2. Los cinco últimos comparten un bloque base idéntico: normalización
(equivalente a `motor.js`), listas candidatas y una clasificación candidata
excluyente:

| Escalón | Condición | Respaldo |
|---|---|---|
| `S` | Texto vacío | Diag 1 y 2 |
| `I1` sin letras / `I2` lista G1 (no-respuesta) / `I3` lista G3 (frase de formulario) | Basura evidente | Ejemplos D2 del diag 2 |
| `Q1` copia del tipo / `Q2` lista G2 (solo estado: `RESUELTO`, `ATENDIDO`…) / `Q3` < 10 caracteres / `Q4` copia de `QA_MensajeError` / `Q5` copia de `SolucionUsuario` | Dudosas | Q3-Q5 traen respuestas con contenido (diag 2) |
| `A` | Resto | — |

| Script | Investiga |
|---|---|
| `diag_qare_objetos_fuentes.sql` | Inventario de objetos; los cuatro SP nuevos y `usp_QARE_*` en **otras bases** (prototipo de Daniela); columnas; dependencias hacia abajo de `vw_CorreoQARECierre_Base` y hacia arriba de las fuentes; módulos que mencionan campos QARE, `'N/A'`, `LEN` o `PATINDEX`; **cuerpos completos** por línea de los módulos que leen el texto QARE y de `vw_Dash_ProductividadBase`, `vw_TecnicoAgente`, `usp_CorreoQA_PorTecnico`; parámetros de los SP vecinos; índices de `dbo.Tickets`; contenido de catálogos y de `AnalisisRegla`. |
| `diag_qare_kpis.sql` | Patrón de llenado de los 8 campos QARE; cinco definiciones de "sin información"; denominadores actuales; las cuatro tarjetas con variante mínima y máxima de inválida y la prueba `T = S + I + A`; estabilidad por día; si la falta de captura es un flujo (Tipo, Subestado, revocación, reapertura, `Validacion`, grupo) o un hábito; por C1. |
| `diag_qare_patrones.sql` | Textos y palabras más repetidos tras normalizar; cuántos textos cubren el 50/80/90 %; arranques ("SE REINICIA"); variantes de escritura; `TipoSolucion`, `Causa` y `Evidencia`; semillas sacadas del **nombre** de los 13 patrones: cobertura, tickets con 0/1/2+ patrones, empates, Pareto candidato con la forma del contrato, lo que queda sin patrón, tipo declarado × patrón; frases de `AnalisisRegla` sobre el texto QARE. |
| `diag_qare_tecnicos.sql` | `Tecnico` contra `FirmaSolucion`, `TecnicoSegundaLinea`, `TecnicoAsignado`, `ResponsableUltimaModificacion` y el técnico del SLA; quién firma tickets de otro; nombres escritos de varias formas; U+FFFD y NBSP; alias; comparación exacta (SLA) contra normalizada (Análisis) de `CatCuentaNoPersona`; tabla por técnico con la forma del prototipo y su reconciliación con el global; volumen por firma; técnicos en varios grupos; concentración de cada escalón por firma. |
| `diag_qare_evidencia.sql` | Existencia de las 12 columnas de origen del detalle; llenado, distintos y largo de las 39 columnas de la vista; literales de las respuestas cerradas; forma de `QARe_Evidencia` (liga, archivo, "adjunto", igual a la descripción); texto que repite un campo declarado; tipo declarado × verbo de acción; cinco tickets por escalón (sin nombre); llenado de campos que solo están en `vw_Tickets`. |
| `diag_qare_reglas_calidad.sql` | 14 criterios por separado (los cinco del diag anterior desdoblados, más una palabra, verbo de acción, palabra de problema); solapamientos; la cascada con ejemplos; barrido de umbral de largo (3 a 30) separando lo que ya era basura de lo marcado solo por largo; candidatos a la lista de genéricos; señales de incompleta; frases de cierre sin acción; estabilidad semanal. |

Comprobación hecha: los seis corrieron sin errores en LocalDB contra una base
desechable con vistas de prueba (12 tickets inventados) que reproducen las
columnas de QA. Eso valida sintaxis, colaciones y que la clasificación se comporta
como se describe (p. ej. `DESBLOQUEO DE USUARIO` copiado del mensaje de error cae
en `Q4`, no en inválida; `Perez` y `Pérez` se detectan como el mismo nombre). **No**
dice nada de los datos reales.

Los textos literales no ASCII van como `NCHAR()`: SSMS puede abrir un `.sql` UTF-8
sin BOM como cp1252 y romper los literales (mismo tipo de falla que
`BacklogCategorias.cs`).

### 11.5 Resultados relevantes hasta hoy

Los de los diag 1 y 2 (sección 4) siguen siendo los únicos con datos de QA. De la
revisión de código y capturas de esta sesión:

- Las capturas confirman los encabezados de 3.4 y 3.5; no muestran la salida de
  las tarjetas.
- Ninguna regla de inválida, incompleta o patrón existe en el código revisado
  (11.3.1).
- El export de 2026-10-13 no tenía índice de `dbo.Tickets` con
  `FechaFirmaSolucion` como llave; `IX_Tickets_CorreoQA_FechaCategoriaGrupo`
  empieza por `FechaRegistro`. Los SP QARE filtran por `FechaFirmaSolucion`, así
  que recorren la tabla. Medido antes: `usp_CorreoQARE_Detalle` 1.1 s (15 días) y
  3.8 s (30 días) (`QareExportar.cs`). Hay que confirmar con la sección 6 del diag
  de objetos y medir los SP nuevos, que además normalizan texto.

### 11.6 Reglas candidatas respaldadas por datos (no aprobadas)

| Regla | Evidencia | Lectura |
|---|---|---|
| Sin información = texto abierto vacío | 1 715 (trim) contra 1 712 (todo NULL); los 4 textos se llenan juntos en 7 595 de 7 598 | Robusta; la diferencia es de 3 tickets. |
| Inválida = sin letras + lista de no-respuesta + frases de formulario | R1 + R2 = 3 287; los ejemplos son basura | Respaldada. La lista exacta es de negocio. |
| No marcar inválida la copia de `SolucionUsuario` ni de `QA_MensajeError` | R3 y R6: los ejemplos son soluciones reales | Respaldada **en contra** de la regla. |
| No usar el largo como regla | R5 mezcla `X`, `NO APLICA` con `REINICIO`, `PINPAD`, `BASCULA` | Respaldada en contra; el barrido de `diag_qare_reglas_calidad.sql` 4 lo cuantifica. |
| Copia del tipo declarado | 66 tickets; no agrega información | Dato claro; inválida o incompleta es de negocio. |
| Patrones por frases normalizadas, gana la primera | Método probado en Análisis; textos cortos repetidos con significado | Viable; cobertura y empates por medir (`diag_qare_patrones.sql` 4). |
| Incompleta = sin verbo de acción o solo problema | Frases del grupo Z del diag 2 | Hipótesis sin medir (`diag_qare_reglas_calidad.sql` 6). |

### 11.7 Reconciliación

Relaciones que deben cumplirse (de la aritmética del prototipo, 8.1):

```
T = S + E                      E = I + A          A = TotalTextoEvaluable
A = P + C + N                  (excluyentes: cada analizable en uno solo)
PctConPatron + PctCalidad + PctSinPatron = 100   (sobre A)
SUM(Pareto.Tickets) = P        último PctAcumulado = 100
S ∩ I = ∅                      N ⊄ I  (sin patrón no es inválida)
```

Lo que los datos y el diseño permiten o impiden:

1. **`T = S + I + A`** cuadra por construcción con cualquier cascada excluyente;
   `diag_qare_kpis.sql` 5 lo comprueba con las dos variantes.
2. **`A = P + C + N` al 100 %** solo si P, C y N son excluyentes. No lo son de
   forma natural: "SE DAN INDICACIONES" encaja en el patrón INDICACIONES /
   CANALIZACION y a la vez en "no documenta una acción". Hace falta un orden
   (¿patrón antes que incompleta o al revés?). El prototipo de Daniela cuadra
   exacto (134 = 78 + 0 + 56), así que ella aplica algún orden.
3. **Un ticket con dos patrones** rompe `SUM(Pareto) = P` si cuenta dos veces.
   `diag_qare_patrones.sql` 4b mide cuántos hay; 4d arma el Pareto con "gana el
   primero" y comprueba la suma.
4. **Redondeo:** tres `DECIMAL(6,2)` redondeados por separado pueden sumar 99.99
   o 100.01. Decisión técnica: aceptar ± 0.02 (prueba 8.3.3) o calcular el
   último como 100 menos los otros dos.
5. **Cuentas que no son personas:** si se quitan de la tabla por técnico pero no
   de las tarjetas (precedente SLA), la suma por técnico ≠ global por exactamente
   sus tickets; hay que reportarlos aparte para que 8.3.5 siga cuadrando.
6. **Pareto del prototipo:** termina en 1 990 / 2 010 = 99.00 %; faltan 20 tickets
   (otra fila fuera de la captura o un patrón excluido). Sin verificar.
7. **Denominadores distintos en la misma pantalla:** las tarjetas son conteos; los
   % por técnico de inválida y analizable van sobre E; los de la barra sobre A;
   los del Pareto sobre P. No hay % sobre T en ningún lado del prototipo.

### 11.8 Matriz por SP

| SP | Fuentes identificadas | Lógica reutilizable | Información faltante | Estado |
|---|---|---|---|---|
| `usp_QARE_CalidadCaptura_KPIs` | `vw_CorreoQARECierre_Base` (`QARe_DescripcionSolucion`) | Población, fechas, default, filtros (2.2); cascada `S / I / A` | Nombres de columnas (9.10); lista de inválidas (9.4); `S` exacto (9.1, casi cerrado) | Diseñable en cuanto se apruebe 9.4 |
| `usp_QARE_PatronesSolucion` | Misma vista; tipo, causa y evidencia como contexto | Pareto de `usp_CorreoQARE_CausaRaiz`; método de `motor.js` | Catálogo de patrones y frases (9.6); regla de incompleta (9.5); prioridad entre patrones e incompleta (9.9, 11.7.2) | Bloqueado por negocio; viabilidad medible con `diag_qare_patrones.sql` |
| `usp_QARE_CalidadCaptura_Tecnicos` | Misma vista; `CatCuentaNoPersona`; `vw_Tickets` solo si se quiere el asignado | `Tecnico` = firma (2.2); `EsPersona` del SLA o `ExcluidosCuenta` de Análisis | Trato de cuentas no persona y proveedores (9.2); mínimo de tickets por fila; mismas reglas que KPIs y Patrones | Atribución resuelta; métricas dependen de los otros dos |
| `usp_QARE_DetalleEvidencia` | Misma vista: las 12 columnas de origen existen (`esquema_bd`); contexto extra en `vw_Tickets` | Fechas y filtros; estados de los otros SP | "Regla detectada" sí o no (9.12); visibilidad de `EstadoDescripcionVisual`; `@Estado` / `@Clasificacion` | Columnas resueltas; cálculos dependen de los otros SP |

### 11.9 Lo que no se puede determinar técnicamente

- Qué literales forman la lista de inválidas (la medición ordena candidatos; la
  frontera entre "basura" y "respuesta pobre" es criterio).
- Si "copia del tipo" y "solo estado" (`RESUELTO`) son inválidas o incompletas.
- El catálogo de patrones: nombres definitivos (el décimo está cortado:
  "CANCELACION / CIERRE OPERA…"), qué frases pertenecen a cada uno y quién lo
  mantiene.
- El orden entre patrón e incompleta y entre dos patrones.
- Si las cuentas no persona y de proveedor salen de la tabla por técnico.
- El nivel de categoría del filtro y si se conservan `@C1` / `@Lideres`.
- Los nombres de las columnas de `usp_QARE_CalidadCaptura_KPIs`.

Si el prototipo de Daniela aparece en alguna base (11.4, 1c), la mayoría de estos
puntos se leen de su código en vez de decidirse.

### 11.10 Resumen ejecutivo

1. **Descubierto sin preguntar a Daniela:** la población y su alcance, la
   atribución del técnico (`Tecnico` = firma, igual que SLA), los encabezados de
   sus cuatro capturas, la aritmética de su prototipo (sin información fuera de
   inválidas; % sobre evaluados y sobre texto evaluable; barra excluyente), los
   denominadores que ya usa QARE, que `Validacion` mide la categoría y no el
   texto, cómo carga el ETL el texto, los dos precedentes para cuentas no persona
   y que el detalle se puede armar entero con la vista actual.
2. **Reglas que ya existen:** población y filtros QARE, regla del técnico, SI/SÍ,
   denominadores por pregunta, exclusión de cuentas (SLA y Análisis, distintas),
   Pareto, y el método de clasificación por frases de Análisis. **Ninguna** regla
   de calidad del texto (pendiente de confirmar en los cuerpos completos de la
   base).
3. **Inferibles de los datos, no aprobadas:** sin información = texto vacío;
   inválida = sin letras + no-respuesta + frases de formulario; no usar el largo
   ni la copia de `SolucionUsuario` / `QA_MensajeError`; patrones por frases
   normalizadas con prioridad.
4. **No se resuelven con investigación técnica:** 11.9.
5. **Falta para diseñar los cuatro SP:** correr en QA los seis diagnósticos (el de
   objetos primero: puede encontrar el prototipo y cerrar casi todo); aprobar la
   lista de inválidas, la regla de incompleta, el catálogo de patrones con su
   orden y el trato de cuentas; y fijar los nombres de las tarjetas. El catálogo
   requiere DDL con su propio script, rollback y aprobación.

## 12. Resultados en QA y prototipo encontrado (2026-11-27)

Los seis scripts de 11.4 se corrieron en QA entre las 11:39 y las 11:52. Ventana
2026-10-29 a 2026-11-27: 9 341 tickets, igual que el diag 2 y que
`tvf_CorreoQARE_Base` sin filtros.

### 12.1 El prototipo de Daniela ya está en QA

`diag_qare_objetos_fuentes.sql` (1b, 1c) encontró en `Tickets_Proactivanet`:

| Objeto | Creado | Modificado | Cuerpo leído |
|---|---|---|---|
| `dbo.vw_QARE_CalidadCaptura` | 2026-11-10 | 2026-11-25 | Sí (12.2) |
| `dbo.CatQARE_RespuestaInvalida` (tabla, 40 filas) | 2026-11-10 | 2026-11-10 | Columnas sí; contenido pendiente |
| `dbo.CatQARE_PatronSolucion` (tabla, 344 filas) | 2026-11-17 | 2026-11-18 | Columnas sí; contenido pendiente |
| `dbo.usp_QARE_CalidadCaptura_KPIs` | 2026-11-10 | 2026-11-25 | Sí (12.3b) |
| `dbo.usp_QARE_CalidadCaptura_Tecnicos` | 2026-11-11 | 2026-11-25 | Sí (12.3b) |
| `dbo.usp_QARE_PatronesSolucion` | 2026-11-19 | 2026-11-25 | Sí (12.3b) |
| `dbo.usp_QARE_DetalleEvidencia` | 2026-11-26 | 2026-11-26 | Sí (12.3) |
| `dbo.usp_QARE_Cerradas_PerfilResolutor` | 2026-11-13 | 2026-11-13 | Sí: perfil de las respuestas cerradas por resolutor (`@MinTickets = 10`); fuera del alcance de la pestaña |
| `crit.Causa` (tabla) | 2026-11-13 | — | No revisado |

Los cuerpos de KPIs, Técnicos y Patrones salieron de las secciones 1-3 de
`diag_qare_tecnicos_prototipo.sql` (QA, 2026-11-27 12:02). Esa corrida usó la versión
anterior del script: el contenido de los catálogos (secciones 4-9, agregadas
después) sigue pendiente.

Columnas de los catálogos: `CatQARE_RespuestaInvalida (IdRespuestaInvalida, Campo,
Valor varchar(100), Motivo varchar(200), Activo)`; `CatQARE_PatronSolucion (IdRegla,
Orden, Patron varchar(100), PalabraClave varchar(150), Activo, TipoClasificacion
varchar(30))`. Las dos tienen llave primaria propia; no se ve restricción única
sobre `Valor` ni sobre `PalabraClave`.

`vw_CorreoQA_Base` y `vw_CorreoQARECierre_Base` se modificaron el 2026-11-10, el
mismo día que se creó la vista del prototipo. El diag 2 ya leyó esa versión
(sección 4.2 A).

### 12.2 Reglas implementadas en `vw_QARE_CalidadCaptura`

Lee `vw_CorreoQARECierre_Base` (misma población que QARE) y calcula por ticket:

| Columna | Regla |
|---|---|
| `EstadoDescripcion` | `SIN INFORMACION QARE` si el texto es NULL o solo espacios; `NO EVALUABLE` si `SolucionNoDescriptiva = 1`; si no, `TEXTO EVALUABLE`. |
| `SolucionNoDescriptiva` | 1 si el texto, tras `UPPER(LTRIM(RTRIM()))`, es **igual** a un `Valor` activo de `CatQARE_RespuestaInvalida` con `Campo = 'QARe_DescripcionSolucion'`; o si al quitar `. , * - _ / \ ; :`, tabulador y espacio no queda nada. |
| `ClasificacionRespuesta` | Solo texto evaluable. Prioridad: 1) regla `CALIDAD` de `CatQARE_PatronSolucion` por **igualdad** exacta; 2) regla `PATRON_SOLUCION` por `LIKE '%PalabraClave%'`; 3) `SIN PATRON IDENTIFICADO`. Dentro de cada tipo gana `Orden`, luego la frase más larga, luego `IdRegla`. |
| `TipoClasificacionRespuesta` | `CALIDAD` / `PATRON_SOLUCION` / `SIN PATRON`. |
| `PatronSolucion` | Patrón o `SIN CLASIFICAR`; NULL si es `CALIDAD`. Comentario: "se conserva temporalmente para no romper los SP actuales". |
| Auditoría | `IdReglaPatron`, `FrasePatron`, `IdReglaCalidad`, `FraseCalidad`, `IdReglaClasificacion`, `FraseClasificacion`: la "Regla detectada" del mockup ya existe. |

Esto contesta, **en el prototipo**, las preguntas 9.1, 9.4, 9.5, 9.6 y 9.9:

- Sin información = texto vacío, fuera de las inválidas (coincide con 8.1).
- Inválida = catálogo de literales + texto hecho solo de signos.
- Incompleta = reglas `CALIDAD` del catálogo (ejemplos en el comentario: `FALLA
  IMPRESORA` -> `PROBLEMA / NO SOLUCION`; `FALTA DE INFORMACION` -> `RESPUESTA SIN
  ACCION DOCUMENTADA`).
- **Incompleta gana a patrón**, y entre patrones gana `Orden`: P, C y N son
  excluyentes y la barra cuadra al 100 % por construcción (11.7.2 resuelto).

Falta saber si el negocio da esos catálogos por aprobados o si son borrador.

### 12.3 `usp_QARE_DetalleEvidencia`

- Lee la vista; "este SP NO vuelve a clasificar".
- Columnas en el orden de la captura (3.5). `EstadoDescripcionVisual` traduce
  `NO EVALUABLE` -> `RESPUESTA INVALIDA` y `TEXTO EVALUABLE` -> `RESPUESTA ANALIZABLE`.
  Las de auditoría y el rótulo visual del tipo están comentados.
- Parámetros: `@FechaInicio`, `@FechaFin`, `@Grupo`, `@FirmaSolucion`,
  `@Categoria`, `@EstadoDescripcion`, `@ClasificacionRespuesta`. Fechas NULL =
  **todo el historial** (no los 15 días de los SP QARE); fin inclusivo; valida
  inicio <= fin con `THROW 50001`.

### 12.3b `usp_QARE_CalidadCaptura_KPIs`, `_Tecnicos` y `usp_QARE_PatronesSolucion`

Los tres leen `vw_QARE_CalidadCaptura`, cuentan `COUNT(DISTINCT CodigoTicket)` y
calculan % `DECIMAL(10,2)` con `NULLIF(denominador, 0)`. Fechas NULL = todo el
historial; fin inclusivo; `THROW 50001` si inicio > fin (KPIs no valida).

| SP | Parámetros | Salida |
|---|---|---|
| KPIs | `@FechaInicio`, `@FechaFin` | Una fila: `TicketsTotales`, `TicketsSinInformacionQARE`, `TicketsEvaluados`, `TicketsNoEvaluables`, `PctNoEvaluable`, `TicketsTextoEvaluable`, `PctTextoEvaluable` (% sobre evaluados). |
| Técnicos | `@FechaInicio`, `@FechaFin`, `@Grupo` | Por `FirmaSolucion` (excluye `FirmaSolucion IS NULL`), ordenado por `TicketsEvaluados DESC`: las 14 columnas de la captura (3.4); `TicketsSinInfo…` es `TicketsSinInformacionQARE`. `PctConPatron`, `PctCalidad`, `PctSinPatron` sobre texto evaluable. No excluye cuentas que no son personas. |
| Patrones | `@FechaInicio`, `@FechaFin`, `@Grupo`, `@FirmaSolucion`, `@Top` | Tres result sets sobre `#Base` (solo `TEXTO EVALUABLE`): 1) distribución de `ClasificacionRespuesta` × tipo con % sobre texto evaluable; 2) Pareto `Posicion, PatronSolucion, Tickets, Porcentaje, TicketsAcumulados, PctAcumulado` solo `PATRON_SOLUCION`, desempate por nombre; 3) barra `TotalTextoEvaluable, TicketsConPatron, PctConPatron, TicketsCalidad, PctCalidad, TicketsSinPatron, PctSinPatron`. |

Lo que esto cierra:

- **9.10:** las columnas de las tarjetas ya existen (KPIs, arriba).
- **8.1, Pareto al 99 %:** `@Top` recorta las filas pero `Porcentaje` y
  `PctAcumulado` se calculan sobre todos los tickets con patrón. Con un `@Top`
  la última fila no llega a 100 %; la captura (13 filas, 99.00 %) es consistente
  con que haya más de 13 patrones. Sin verificar qué `@Top` usó.
- **8.3.5:** Técnicos excluye firma NULL y KPIs no; en la ventana medida no hay
  firmas vacías (12.5), así que hoy cuadra.

### 12.4 Hallazgos de revisión del prototipo (confirmados con los catálogos, 12.7)

1. **Coincidencias exactas frágiles.** Inválidas y `CALIDAD` solo recortan espacios
   y pasan a mayúsculas: `N/A`, `N/A.`, `NA` y `N A` necesitan una fila cada uno.
   La normalización de 11.4 convierte 2 275 textos analizables distintos en claves
   que agrupan variantes (`diag_qare_patrones.sql` 1). **Confirmado:** el catálogo
   de patrones repite cada frase con y sin acento (`CODIGO CRUZADO` /
   `CÓDIGO CRUZADO`) y guarda errores de dedo tal como se escribieron
   (`ERRO DE AUTENTICACIÓN`, `PROBLEMAS DE NAVEAGCION`, `DAN INDICAIONES`).
2. **Caracteres invisibles.** Hay textos con espacio de ancho cero al inicio
   (`‌SIN RESPUESTA`, `‌SE REINSTALÓ RTE`; `diag_qare_patrones.sql` 1 y 5). Ni la
   igualdad ni `LTRIM` los quitan, así que esas respuestas no coinciden con el
   catálogo. **Medido:** 82 de 7 651 textos llenos traen espacio de ancho cero;
   1 trae NBSP; ninguno trae saltos de línea.
3. **Solo signos:** no quita NBSP, saltos de línea ni `? # ( ) ' "`; un texto
   de solo dígitos (`0` 181, `1` 102 en diag 1) es evaluable salvo que esté en el
   catálogo.
4. **`PATRON_SOLUCION` por `LIKE` sin límite de palabra:** el catálogo usa raíces
   cortas (`REINICI`, `INSTAL`, `CONFIGUR`, `PERMISO`, `CONTRASEÑA`, `RESET`), así que
   cualquier mención cuenta como acción: `SIN PERMISOS` o `NO RECUERDA SU CONTRASEÑA`
   caerían en un patrón. La colación es `CI_AS` (con acentos), de ahí las filas
   duplicadas del punto 1.
5. **`LEFT JOIN` al catálogo de inválidas, bug confirmado:** `v` (Id 47) y `V`
   (Id 48) están activos y son iguales con `CI_AS`. La vista devuelve 9 375 filas
   para 9 374 tickets. Los tres SP de conteo usan `COUNT(DISTINCT)` y no se
   enteran; `usp_QARE_DetalleEvidencia` sí muestra el ticket repetido. Basta con
   desactivar una de las dos filas (cambio de datos, aprobación aparte).
6. **Filtros dispares entre SP y contra el mockup** (Período, Grupo, Categoría,
   Técnico):

   | SP | Grupo | Categoría | Técnico | Estado / clasificación |
   |---|---|---|---|---|
   | KPIs | — | — | — | — |
   | Técnicos | sí | — | — | — |
   | Patrones | sí | — | sí | — |
   | Detalle | sí | sí (ruta exacta) | sí | sí |

   Con un filtro de Categoría o Técnico, las tarjetas, la barra y la tabla por
   técnico no se mueven y el detalle sí. Todos `VARCHAR`, un solo valor, sin
   `@C1` / `@Lideres` y sin el default de 15 días de los SP QARE (2.2).
7. **Rendimiento:** `dbo.Tickets` tiene 1 069 740 filas y **ningún índice** con
   `FechaFirmaSolucion` como llave (confirmado, `diag_qare_objetos_fuentes.sql` 6).
   La vista suma dos `OUTER APPLY` con `LIKE` por ticket. Medir los cuatro SP con
   15 y 90 días antes de exponerlos.
8. **Cuentas que no son personas** (`User, Setup` y demás) salen como filas de la
   tabla por técnico; el mockup las muestra así. Decisión 9.2 sigue abierta.
9. **Reglas desactivadas dejan sin patrón textos claros y frecuentes:** `CARGA DE`
   (inactiva) deja `CARGA DE PRECIOS` 48 y `SP CARGA DE PRECIOS` 24; `ALTA SAP`
   deja `ALTA SAP TIENDA` 31 y `ALTA SAP OAT` 26; `NAVEGACION` deja 31; `CONTACTO`
   deja `SE BRINDA CONTACTO PARA SEGUIMIENTO` 33. Probablemente se apagaron por
   coincidir de más; una frase completa las recuperaría sin ese riesgo.
10. **`ERROR` no es inválida:** la fila `error` del catálogo está inactiva, así que
    `ERROR` (74 tickets) es el texto "sin patrón" más frecuente.
11. **Exacto contra parcial:** `CALIDAD` compara igualdad y `PATRON_SOLUCION`
    `LIKE`, así que el mismo contenido cae distinto según lo que lo rodee:
    `NUEVA CONTRASEÑA` sola es `RESPUESTA SIN ACCION DOCUMENTADA`, pero
    `SE ANEXA NUEVA CONTRASEÑA` (18) es `CUENTAS / CREDENCIALES` por `CONTRASEÑA`.
12. **"Sin respuesta del usuario" en cuatro lugares:** `SIN RESPUESTA` es inválida
    (121); `SIN RESPUESTA DEL USUARIO` exacta es `CALIDAD` (40); cualquier texto que
    contenga `SIN RESPUESTA DE USUARIO` es patrón `VALIDACION / SIN INTERVENCION`;
    `SIN RESPUESTA POR PARTE DE USUARIO` queda sin patrón (7).

### 12.5 Datos de QA que siguen valiendo

Aunque las reglas sean las del prototipo, estos resultados describen los datos:

**Captura (`diag_qare_kpis.sql`)**
- Llenado: los 7 campos juntos en 7 621 (81.6 %); nada en 1 096; **solo
  `VerificoClasificacion` en 618**; otras 6 combinaciones. Texto vacío = tipo
  vacío = 1 715. Por eso "todo NULL" daba 1 712 en el diag 1 y aquí 1 096: la
  pregunta de verificar clasificación se contesta aparte.
- Denominadores: `VerificoClasificacion` 8 243; los demás 7 626 / 7 625.
- Sin información no es un flujo de Tipo (Incidencia 21 %, Petición 10 %). Se
  concentra en **`Proveedor RODHE`** (995 de 1 174, 84.8 %; es el C1
  `S-Biométrico`: 995 de 1 172), en las cuentas de `CatCuentaNoPersona` (681 de
  753, 90.4 %), `Fenicia` (62 de 76), `Proveedor Sonda` (61 de 85) y
  `S-Ampliacion Punto de Venta` (28 de 28). Personas: 12 %. Los picos diarios
  (~200 sin información el 2, 5, 11 y 18 de noviembre) son de ahí.
- `Subestado` viene vacío en el 100 % de la vista y `FirmaCierreRevocacion` lleno en
  el 100 % (103 valores): ninguno sirve como señal de flujo.

**Técnico (`diag_qare_tecnicos.sql`)**
- `Tecnico` = `FirmaSolucion` = `Tecnico` y `TecnicoResolvio` del SLA en 9 341 de
  9 341. Igual al asignado en 4 876; 3 284 tickets de personas no tienen asignado.
- Sin variantes de escritura, sin U+FFFD ni NBSP en nombres. Comparación exacta
  (SLA) = normalizada (Análisis): 753 = 753.
- Firmantes: 88 personas (8 131 tickets), 4 cuentas del catálogo (753; 681 sin
  información, 33 analizables), 11 proveedores fuera del catálogo (457; 5 sin
  información, 316 analizables).
- 36 firmas con menos de 20 tickets (262 tickets); 38 firmas trabajan en 2 o más
  grupos (5 012 tickets).
- La suma por técnico cuadra con el global (9 341 = 1 715 + 3 309 + 4 317).
- Contraste con la captura de Daniela (otra ventana), primera fila de su tabla:
  480 / 0 / 480 / **346** / 134 en su prototipo; 516 / 0 / 516 / **370** / 146 aquí
  con la variante mínima (71.7 % contra 72.1 % no evaluable).

**Calidad del texto (`diag_qare_reglas_calidad.sql`)**

| Escalón (11.4) | Tickets | Lectura |
|---|---|---|
| S | 1 715 | 17 firmas; 3 concentran el 92 %. |
| I1 sin letras | 1 651 | |
| I2 lista G1 | 1 342 | |
| I3 lista G3 | 316 | 3 firmas = 96 % (`NO  SALE ERROR`). |
| Q1 copia del tipo | 66 | 4 firmas. |
| Q2 solo estado | 13 | La lista G2 casi no aparece. |
| Q3 < 10 caracteres | 207 | |
| Q4 copia de `QA_MensajeError` | 7 | |
| Q5 copia de `SolucionUsuario` | 230 | |
| A resto | 3 794 | |

- Tarjetas candidatas: mínima 1 715 / 3 309 / 4 317 (43.4 % de inválidas sobre
  evaluados); máxima 1 715 / 3 595 / 4 031 (47.1 %).
- **El largo no sirve como regla:** de 3 082 textos con menos de 10 caracteres,
  2 872 ya eran basura por otra regla; los 210 restantes incluyen 48 con verbo de
  acción. Ningún umbral entre 3 y 30 separa limpio.
- Incompleta (señales): de 4 317 analizables, 2 672 con verbo de acción, 1 645
  sin verbo, 113 con palabra de problema y sin verbo. Frases sin acción
  frecuentes: `SE VALIDA` 153, `SE DAN INDICACIONES` 126, `SE BRINDA CONTACTO` 39.
- Inválidas por semana: de 30.9 % a 42.7 % entre la primera y la última semana.

**Patrones (`diag_qare_patrones.sql`)**
- 4 317 analizables tienen 2 275 textos distintos; 1 867 aparecen una sola vez.
  263 textos cubren el 50 %, 1 412 el 80 %. Un catálogo de frases exactas no
  alcanza; hace falta coincidencia parcial (como hace el prototipo para patrones).
- Semillas por nombre de patrón (11.4): 36.6 % sin patrón, 50.9 % con uno, 12.5 %
  con dos o más. El orden importa.
- `QARe_Causa` es un catálogo cerrado de 13 valores (`NECESIDAD DEL USUARIO` 4 521).
  `QARe_Evidencia` tiene la misma basura que el texto (`NA` 785, `NO` 616).

**Detalle (`diag_qare_evidencia.sql`)**: las 12 columnas de origen existen en la
vista base; `QARe_UsuarioConfirmo` y `Subestado` vacíos al 100 %.

### 12.7 Contenido de los catálogos y lo que clasifica la vista (QA, 12:07)

`diag_qare_tecnicos_prototipo.sql` 4-9, ventana 2026-10-29 a 2026-11-27 (9 374
tickets: 33 más que a las 11:39 por cierres del mismo día).

**`CatQARE_RespuestaInvalida`** (40 filas): solo 16 activas para
`QARe_DescripcionSolucion`: `NA`, `N/A`, `SI`, `NO`, `0`, `00`, `1`,
`SIN RESPUESTA`, `ok`, `a`, `x`, `Z`, `za`, `v`, `V` y el literal `NULL`. Inactivas:
`.`, `-`, `,`, `-----------`, `error` (el texto hecho solo de signos ya lo atrapa
`SolucionNoDescriptiva`). Las filas de `QARe_Evidencia` están todas inactivas: la
vista no evalúa la evidencia.

**`CatQARE_PatronSolucion`** (344 filas):

| Tipo | Patrón | Orden | Reglas activas |
|---|---|---|---|
| CALIDAD | PROBLEMA / NO SOLUCION | 5 | 62 |
| CALIDAD | RESPUESTA SIN ACCION DOCUMENTADA | 6 | 12 |
| PATRON | frases específicas de varios patrones | 8 | — |
| PATRON | CUENTAS / CREDENCIALES; ROLES / PERMISOS | 10 | 28; 37 |
| PATRON | BASE DE DATOS / DML | 20 | 13 |
| PATRON | SCRIPT / AUTOMATIZACION | 25 | 3 |
| PATRON | REPROCESO / REENVIO | 30 | 11 |
| PATRON | REINICIO / REACTIVACION | 40 | 14 |
| PATRON | CONFIGURACION | 50 | 19 |
| PATRON | DATOS MAESTROS / CATALOGOS | 55 | 2 |
| PATRON | ACTUALIZACION / INSTALACION | 60 | 2 |
| PATRON | MANTENIMIENTO / LIMPIEZA | 65 | 3 |
| PATRON | HARDWARE / REPARACION | 70 | 23 |
| PATRON | INDICACIONES / CANALIZACION | 80 | 17 |
| PATRON | VALIDACION / SIN INTERVENCION | 90 | 21 |
| PATRON | CARGA / SINCRONIZACION | 100 | 6 |
| PATRON | CANCELACION / CIERRE OPERATIVO | 110 | 7 |
| PATRON | CAMBIO ADMINISTRATIVO | 120 | 13 |
| PATRON | SEGURIDAD / CONECTIVIDAD | 130 | 17 |

Son 18 patrones de solución activos (más `ACCESOS / PERMISOS`, todo inactivo), no
13. En la ventana tienen tickets los 18; la captura del Pareto con 13 filas y
99 % corresponde a un `@Top` de 13 (8.1 resuelto).

**Clasificación de la vista en la ventana:**

| Estado | Tipo | Tickets |
|---|---|---|
| SIN INFORMACION QARE | — | 1 724 |
| NO EVALUABLE | — | 2 914 |
| TEXTO EVALUABLE | CALIDAD | 492 (PROBLEMA 382, SIN ACCION 110) |
| TEXTO EVALUABLE | PATRON_SOLUCION | 2 302 |
| TEXTO EVALUABLE | SIN PATRON | 1 942 |

`1 724 + 2 914 + 4 736 = 9 374` y `492 + 2 302 + 1 942 = 4 736`: las
reconciliaciones 8.3.1 y 8.3.2 cuadran. Inválidas sobre evaluados: 38.1 %
(2 914 / 7 650); la variante mínima de 11.4 daba 43.4 %.

**Decisiones de negocio que el catálogo ya toma** (preguntas 9.4 y 9.5, en el
prototipo):

- `NO  SALE ERROR` (218) **no** es inválida: es `PROBLEMA / NO SOLUCION`.
- Copiar el rótulo del tipo **sí** cuenta como patrón: `SE DAN INDICACIONES,
  TÉCNICAMENTE NO SE HIZO NADA` (36) es `INDICACIONES / CANALIZACION`; `NO FUE
  NECESARIO HACER NADA, YA ESTABA SOLUCIONADO` (19) es `VALIDACION / SIN
  INTERVENCION`.
- Cierres sin acción como `INCIDENCIA GENERAL RESUELTA` y `CONFIRMAN EL CIERRE DEL
  TICKET` son patrón `VALIDACION / SIN INTERVENCION`, no incompletos.
- `SE ANEXA EVIDENCIA`, `NO SE ADJUNTO LO SOLICITADO` y `SIN RESPUESTA DEL USUARIO`
  son `RESPUESTA SIN ACCION DOCUMENTADA`.
- Errores operativos (`MATERIALES SIN PMV` 46, `USUARIO BLOQUEANDO` 22,
  `LEGADO - ITX` 17) son `PROBLEMA / NO SOLUCION`.

El catálogo no dice si esas decisiones están aprobadas o son del prototipo.

### 12.6 Siguiente paso

1. ~~Correr `diag_qare_tecnicos_prototipo.sql` completo~~ (hecho 12:07, 12.7).
2. Llevar a Daniela la revisión de 12.4 como lista de correcciones al prototipo:
   el bug `v`/`V` (5), la normalización antes de comparar (1-3), los filtros por SP
   (6), las reglas desactivadas y `ERROR` (9, 10) y la incoherencia exacto/parcial
   (11, 12). Son cambios a sus objetos: no se tocan sin su acuerdo y aprobación.
3. Medir el rendimiento de los cuatro SP con 15 y 90 días (7).
4. Preguntas al negocio que quedan: si los catálogos de Daniela son la versión
   aprobada, quién los mantiene, el trato de cuentas no persona y proveedores
   (9.2), qué filtros debe respetar cada bloque de la pantalla (12.4.6) y si los
   parámetros siguen la convención QARE (9.11).
