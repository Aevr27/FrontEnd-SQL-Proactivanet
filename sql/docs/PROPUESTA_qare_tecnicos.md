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
   enteran; `usp_QARE_DetalleEvidencia` sí muestra el ticket repetido.
   **Corregido 2026-11-27 12:17** con `sql/45_qare_respuesta_invalida_v_duplicada.sql`
   aplicado en QA: fila 47 (`v`) inactiva, 48 (`V`) activa; la vista queda en
   9 374 filas = 9 374 tickets.
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
   el bug `v`/`V` (5, ya corregido: avisarle), la normalización antes de comparar (1-3), los filtros por SP
   (6), las reglas desactivadas y `ERROR` (9, 10) y la incoherencia exacto/parcial
   (11, 12). Son cambios a sus objetos: no se tocan sin su acuerdo y aprobación.
3. Medir el rendimiento de los cuatro SP con 15 y 90 días (7).
4. Preguntas al negocio que quedan: si los catálogos de Daniela son la versión
   aprobada, quién los mantiene, el trato de cuentas no persona y proveedores
   (9.2), qué filtros debe respetar cada bloque de la pantalla (12.4.6) y si los
   parámetros siguen la convención QARE (9.11).

## 13. Propuesta de correcciones al prototipo (2026-11-27, solo lectura)

Fase de investigación previa a cualquier cambio en los objetos de Daniela. Nada de
esta sección modifica la vista, los SP ni los catálogos.

**De dónde salen los datos.** De la corrida de `sql/diag/diag_qare_correcciones.sql`
en QA (`Tickets_Proactivanet`, SQL Server 16.0.4255.1) el 2026-11-27 a las 15:23,
con la ventana del 2026-10-29 al 2026-11-27, fin incluido. En esa ventana la vista
dio **9 444 filas = 9 444 tickets**. La cifra de 9 374 que se dio tras `sql/45`
era de la mañana; la diferencia son tickets que se firmaron durante el día (la
última firma del historial es de las 13:18). Las referencias del tipo "(2c)" o
"(3a)" señalan la sección del diag que da cada cifra. Las secciones 12.x son
corridas anteriores y se citan solo cuando no se volvieron a medir.

**Validez del simulador.** El nivel 1 de la sección 2 reproduce la vista en
**7 714 de 7 714** tickets evaluados, con 0 diferencias (2a). Los totales de 4d2,
la salida de KPIs y la del Detalle coinciden campo por campo (4e: cuadre 0), y
Patrones con `@Grupo` coincide con lo que se espera de la vista (4g). Ningún
ticket de la vista quedó sin su fila de `vw_CorreoQARECierre_Base` y ninguno está
duplicado.

**Fuera de QA** solo se usó LocalDB (base desechable ya borrada, datos sintéticos)
para probar el diag antes de correrlo. Esos resultados no son cifras de QA y no
se citan como tales.

### 13.1 Resumen ejecutivo

- **Errores confirmados en QA (2).** a) Al filtrar `usp_QARE_DetalleEvidencia`
  por la etiqueta que el propio SP devuelve (`RESPUESTA INVALIDA`) salen
  **0 filas**; con el valor interno (`NO EVALUABLE`) salen 2 945 (4e). b) La
  vista une el catálogo de inválidas con un `LEFT JOIN` sin unicidad. Hoy no
  duplica (9 444 = 9 444, y 383 214 = 383 214 en todo el historial), pero un
  valor activo repetido vuelve a duplicar tickets, como pasó con `v`/`V`.
- **Corrección de la versión anterior.** La propuesta decía que el `NO  SALE
  ERROR` con doble espacio era un error, porque la variante con un espacio no
  coincidiría. **No lo es:** el catálogo tiene las dos (Id 48 con un espacio y
  Id 182 con dos, ambas activas; 1e), y los 218 tickets de QA usan el doble
  espacio (3a).
- **La normalización casi no mueve tickets.** Quitar invisibles, colapsar
  espacios, ignorar acentos y quitar signos finales cambia, entre los cuatro
  pasos, unos **11 tickets** de texto evaluable (2b): 8 por limpiar el texto y 3
  por recortar una frase del catálogo (H22). Los 893 restantes del
  paso 5 ya eran no evaluables: son textos de solo signos (`.`, `,`, `..`). Hay
  83 textos con ancho cero y 282 con doble espacio, pero solo 2 de cada grupo
  cambian de clasificación (2e/2e2). La normalización es correcta pero de baja
  prioridad, y tiene una trampa (13.4).
- **Lo que mueve la barra es el catálogo.** Con todas las reglas reactivadas,
  *sin patrón* bajaría de 1 959 a 1 579, de 41.1 % a 33.1 % del texto evaluable
  (2b, nivel 9). No conviene reactivarlas tal cual porque algunas atrapan de
  más (13.5.5). Las cinco familias frecuentes ya tienen ejemplos por ticket y
  contexto (13.3).
- **Entre los SP** la población y el conteo coinciden. Las diferencias reales
  son tres: KPIs no valida las fechas, el Detalle tiene el filtro por estado
  roto y los filtros disponibles cambian de un SP a otro. La exclusión de firma
  NULL (solo Técnicos) no afecta a ningún ticket: hay 0 firmas NULL en todo el
  historial (4c).
- **Siguiente cambio concreto:** las correcciones 1 y 2 de 13.7 (unir inválidas
  sin duplicar y arreglar el filtro del Detalle). Están confirmadas en QA y no
  dependen de ninguna decisión de negocio.

### 13.2 Tabla de hallazgos

Categorías: **E** error confirmado · **P** problema técnico probable · **M** mejora
sugerida · **D** decisión funcional pendiente (Daniela). Las cifras son tickets de
la ventana salvo que se diga otra cosa.

| # | Hallazgo | Cat. | Evidencia en QA | Tickets | Sección |
|---|---|---|---|---|---|
| H1 | El filtro de estado del Detalle espera el valor interno y muestra la etiqueta | E | 4e: etiqueta = 0 filas, valor interno = 2 945 | todo filtro por estado | 13.6 |
| H2 | `LEFT JOIN` a inválidas sin unicidad | E | Ocurrió con `v`/`V`; hoy filas = tickets | 0 hoy | 13.6 |
| H3 | ~~La variante de `NO SALE ERROR` con un espacio no coincide~~ **Descartado**: el catálogo tiene las dos variantes | — | 1e (Id 48 y 182), 3a | 0 | 13.5.1 |
| H4 | El ancho cero no se quita y la columna no lo ignora | P | 0b: U+200B/U+200C ≠ texto limpio; 83 textos con ancho cero, 71 al inicio (2e) | 2 (2e2) | 13.4 |
| H5 | Los acentos se distinguen (`SQL_Latin1_General_CP1_CI_AS`) | P | 0c: `NAVEGACIÓN` ≠ `NAVEGACION`; 52 claves del catálogo coinciden al quitar acentos (2f) | 6 (2e2) | 13.4 |
| H6 | Los espacios repetidos internos no se colapsan | P | 282 textos con doble espacio (2e) | 2 (2e2) | 13.4 |
| H7 | Los signos finales impiden la igualdad exacta | P | 1 425 textos terminan en signo (2e) | 2 fuera de los de solo signos (2d) | 13.4 |
| H8 | `ERROR` solo es evaluable porque la inválida `error` está inactiva | D | Id 39 inactiva (1e, 3d3); 50 de 74 son de un grupo de accesos que lo usa como "error de usuario / no corresponde" (1c, 1d) | 74 | 13.3 |
| H9 | Reglas inactivas dejan sin patrón frases frecuentes | D | `CARGA DE`, `ALTA SAP`, `NAVEGACION`, `CONTACTO` inactivas (1e, 3d2) | 231 en las 4 familias (1b) | 13.3 |
| H10 | `NO SALE ERROR` es `PROBLEMA / NO SOLUCION`, pero la solución al usuario dice que se hicieron ajustes | D | 218 tickets, 217 de un grupo, 207 con tipo "se dan indicaciones" (3a2, 3a3) | 218 | 13.5.1 |
| H11 | `CALIDAD` exige el texto completo; con contención el resultado cambia regla por regla | D/M | 3c: `FAVOR DE VALIDAR` 0 exactos y 58 parciales; `MATERIALES SIN PMV` 46 exactos | según regla | 13.5.3 |
| H12 | "Sin respuesta" tiene tres destinos distintos | D | 123 inválida, 40 `CALIDAD`, 11 sin patrón (3e) | 174 | 13.5.4 |
| H13 | Copiar el rótulo del tipo de solución cuenta como patrón | D | 66 iguales, 25 truncados, 15 que empiezan con el tipo; los 106 son patrón (3b) | 106 | 13.5.2 |
| H14 | `PATRON` por `LIKE` con raíces cortas y `Orden` por encima del largo | M | 2g: `CONFIGUR` (Orden 50) gana a frases de `SEGURIDAD` (130) | 3 | 13.4 |
| H15 | `PalabraClave` entra a `LIKE` sin escapar | M | 0c: `_` actúa de comodín en QA; ninguna frase del catálogo tiene `_ % [` (2f) | 0 hoy | 13.4 |
| H16 | KPIs no valida `@FechaInicio > @FechaFin`; los otros tres sí | M | 4a | — | 13.6 |
| H17 | Técnicos excluye firma NULL; los demás no | M | 4a; 0 firmas NULL en 383 214 tickets (4c) | 0 | 13.6 |
| H18 | Los filtros cambian por SP: Categoría y Técnico solo mueven el Detalle | D | 4a, 4b | — | 13.6 |
| H19 | No se excluyen las cuentas no persona ni los proveedores | D | 759 tickets de cuentas del catálogo en la ventana (4d2); salen como filas en Técnicos (4f) | 759 + proveedores | 13.6 |
| H20 | `QARe_Evidencia` repite la descripción | D | 4 753 de 7 625 (`diag_qare_evidencia` 4, no se volvió a medir); en las 5 familias es lo común (1d) | 4 753 | 13.3 |
| H21 | Las inválidas se concentran en pocas firmas | D | 12 firmas con ≥ 50 evaluados y ≥ 90 % no evaluable suman 1 537 de 2 945 (4f) | 1 537 | 13.6 |
| H22 | Normalizar el catálogo con `TRIM` amplía la regla `' SQL'` | P | 2c/2d: `MYSQL` pasa a `BASE DE DATOS / DML` en el paso 1->2 por el espacio inicial de la Id 9 | 3 | 13.4 |

### 13.3 Respuestas frecuentes sin patrón

Las familias agrupan por contenido, sin acentos y en mayúsculas (1a, 1b). "Sin
patrón" son los tickets que hoy terminan en `SIN PATRON IDENTIFICADO`.

| Familia | Sin patrón | Escrituras | Grupo dominante | Categoría dominante | Tipo de solución dominante | Regla del catálogo |
|---|---|---|---|---|---|---|
| `ERROR` exacto | 74 (46 `ERROR`, 26 `error`, 2 `Error`) | 3 | Control de Accesos TI (50) | Accesos / Aplicativos legados (44) | Se dan indicaciones (51) | Inválida `error` Id 39, **inactiva** |
| `CARGA DE PRECIO(S)` | 90 (+3 ya en `REINICIO`) | 13 | End User (89) | Básculas / Ticket serializado (67) | Reinicio de servicio (41), acción al sistema (34) | `CARGA DE` Id 35 → `CARGA / SINCRONIZACION`, **inactiva** |
| `ALTA SAP TIENDA` / `OAT` | 57 | 2 | Control de Accesos TI (57) | SAP / Alta, Baja, Cambios (54) | Se otorgan permisos (50) | `ALTA SAP` Id 84 → `CUENTAS / CREDENCIALES`, **inactiva** |
| `… BRINDA … CONTACTO …` | 48 | 4 | Service Desk (46) | Varias de Punto de Venta y Chrome | Se dan indicaciones (39) | `CONTACTO` Id 30 → `INDICACIONES / CANALIZACION`, **inactiva** |
| `NAVEGACION` | 36 (+2 `NAVEAGCION`) | 6 | Seguridad Informática (30) | Usuario de red / Permisos de navegación (28) | Se otorgan permisos (34) | `NAVEGACION` Id 46 → `SEGURIDAD / CONECTIVIDAD`, **inactiva** |

Lectura por familia (con los ejemplos por ticket de 1d):

- **`ERROR`.** En el grupo de accesos, la solución al usuario es siempre "el tema
  que reportas no corresponde a Control Accesos TI" y la causa declarada es
  "Error de usuario" (50 de 74). En App Evolución (21) la solución es "muchas
  gracias por su respuesta… Vo.Bo." y el tipo es "no fue necesario hacer nada".
  En los dos casos `ERROR` es una abreviatura de la causa, no de la solución. El
  catálogo ya trata `ERROR DE USUARIO` (Id 55) como `CALIDAD` `PROBLEMA / NO
  SOLUCION`. Aparte, hay 42 tickets con 32 textos que empiezan con `ERROR`
  (`Error en material`, `Error en pedido`…): nombran el problema y no la
  solución, y tampoco tienen patrón.
- **`CARGA DE PRECIOS`.** La solución al usuario dice "se envía actualización de
  precios"; encaja en `CARGA / SINCRONIZACION`. La raíz `CARGA DE` atraparía de
  más: con todas las reglas activas, `CARGA DE PAGINA`, `CARGA DE IMAGEN` y
  `CARGA DE BASCULAS` también entrarían (2d, 1->9). `CARGA DE PRECIO`, sin la
  `S`, cubre las 13 escrituras.
- **`ALTA SAP …`.** Viene entera de un grupo y de una categoría. En 50 tickets el
  alta se hizo ("se realiza el alta del usuario"). En 7 no: "las altas de tienda
  se realizan mediante SorIA", con tipo "se dan indicaciones". El rótulo no
  distingue entre los dos casos. Las reglas activas `ALTA DE USUARIO SAP` y
  `ALTA USUARIO SAP` no coinciden porque el texto no dice `USUARIO`.
- **`SE BRINDA CONTACTO …`.** Es canalización: la solución al usuario da el
  contacto con el que se lleva el seguimiento. La raíz `CONTACTO` atraparía 85
  tickets sin patrón, entre ellos `CONFIRMA CONTACTO DE TIENDA`, que no es
  canalización (3d). Hay formas vecinas sin patrón: `SE ADJUNTAN CONTACTOS`
  (15), `SE PROPORCIONA CONTACTO.` (9) y `SE LE BRINDA INFORMACIÓN PARA PONERSE
  EN CONTACTO CON OTRO EQUIPO` (8) (2d).
- **`NAVEGACION`.** En Seguridad Informática significa "se otorgó el permiso de
  navegación". Su regla inactiva lo mandaba a `SEGURIDAD / CONECTIVIDAD`, pero
  las frases activas `PERMISO DE NAVEGACION` y `PERMISOS DE NAVEGACION` van a
  `ROLES / PERMISOS` (1e). Los 10 de Service Desk son otra cosa: borrado de
  caché y temporales del navegador.

Patrón común: en las cinco familias la evidencia repite el texto de la
descripción (`QARe_Evidencia` = descripción en casi todos los ejemplos de 1d; en
la ventana completa, 4 753 de 7 625, H20).

### 13.4 Normalización y coincidencias

**Intercalación real.** La base, la columna `QARe_DescripcionSolucion` y
`PalabraClave` usan `SQL_Latin1_General_CP1_CI_AS`. `PalabraClave` es
**`varchar`**: una frase del catálogo no puede tener caracteres fuera de cp1252
(0a).

| Prueba (contra `SIN RESPUESTA`, con la expresión de la vista) | ¿Igual en QA? (0b) |
|---|---|
| U+200C o U+200B delante | No |
| U+FEFF (BOM) delante | **Sí** (la intercalación lo ignora) |
| NBSP en medio o al final, tabulador o CR/LF al final | No |
| Doble espacio interno | No |
| Espacios al final | Sí |
| Minúsculas | Sí |
| Punto final | No |
| `NAVEGACIÓN` = `NAVEGACION` (y con `LIKE`) | No (0c) |
| `ALTAXSAP LIKE '%ALTA_SAP%'` | **Sí**: `_` es comodín (0c) |

**Impacto medido por nivel** (2b; los niveles se acumulan, y el catálogo se
normaliza igual que el texto en cada uno):

| Nivel | Cambio | No evaluable | `CALIDAD` | Patrón | Sin patrón |
|---|---|---|---|---|---|
| 1 | La vista | 2 945 | 494 | 2 316 | 1 959 |
| 2 | Sin invisibles; NBSP, tab y CR/LF a espacio; recorte | 2 947 | 494 | 2 317 | 1 956 |
| 3 | + espacios colapsados | 2 947 | 494 | 2 319 | 1 954 |
| 4 | + sin acentos | 2 947 | 494 | 2 323 | 1 950 |
| 5 | + sin signos finales | 2 054 + 893 vacíos | 495 | 2 323 | 1 949 |
| 9 | Nivel 1 con todas las reglas activas | 2 945 | 494 | 2 696 | 1 579 |

Qué cambia en cada paso (2c, 2d):

- **1->2 (5 tickets).** `--` con un invisible y `SIN RESPUESTA` con ancho cero
  pasan a inválida, como debe ser. Los otros 3 son la **trampa (H22)**: la regla
  Id 9 es `' SQL'`, con un espacio inicial que hace de límite de palabra. Al
  recortarla, `SE VALIDA FOLIO EN MYSQL` pasa a `BASE DE DATOS / DML`. Puede que
  esté bien (MySQL es una base de datos), pero el cambio no viene de limpiar el
  texto: viene de ampliar una regla. **El catálogo no se debe recortar al
  normalizar**, o la Id 9 se reescribe antes.
- **2->3 (2) y 3->4 (4).** Ganan patrón `SE ANEXA  MANUAL…`, `SE ENTREGO UNIDAD
  DE IMAGEN`, `SE ACTIVA PARÁMETRO`, `SE REALIZA CALIBRACIÓN DE BASCULA`,
  `SE REALIZA ENVIÓ DE BATERÍA…`: todos correctos.
- **4->5.** 893 textos de solo signos pasan de *no evaluable* a *vacío*: el
  mismo grupo con otro nombre. Solo `REPORTE MAL LEVANTADO.` cambia de verdad y
  pasa a `CALIDAD`.

**Catálogo (2f).** Hay 52 claves con dos o más filas que coinciden al quitar los
acentos. Casi siempre son la misma frase con y sin acento; unas pocas son filas
repetidas tal cual, como `POLITICAS DE WINDOWS`, que tiene cuatro. Con una
intercalación `AS` las dos escrituras hacen falta, y por eso no son un error.
Si se normalizan los acentos, sobra una de cada grupo. Seis pares además difieren
en `Patron`, `Orden` o tipo, con una sola fila activa. Por ejemplo, `ERROR DE
AUTENTICACION` es `CALIDAD` activa (Id 130) y `PATRON` inactiva (Id 137); `FALLA
DE RED` es `CALIDAD` activa (Id 132) y `PATRON` inactiva (Id 139). Solo dos
frases tienen bordes raros: la Id 9 `' SQL'` (espacio inicial) y la Id 182 (doble
espacio, a propósito). Ninguna tiene `_`, `%` ni `[`.

**Recomendación técnica.** Normalizar el texto en los niveles 2 a 4 es seguro.
Sin recortar el catálogo mueve 8 tickets: 6 ganan patrón y 2 pasan a inválida. Hacerlo **sin recortar el catálogo** (H22). El nivel 5 no
aporta nada. Escapar los comodines es preventivo: hoy no cambia nada. Como el
efecto es chico, esto va después de las correcciones de filtro y de unión
(13.7).

### 13.5 Reglas de clasificación existentes

#### 13.5.1 `NO SALE ERROR`

- **Regla:** `CALIDAD` por igualdad exacta, Id 48 (`NO SALE ERROR`) e Id 182
  (`NO  SALE ERROR`), ambas `PROBLEMA / NO SOLUCION` y activas (1e).
- **Datos (3a, 3a2):** 218 tickets, todos con el texto exacto y doble espacio.
  Vienen de 3 firmas y 217 de un mismo grupo de soporte de aplicativos. Las
  categorías son de Caja General: diferencia de póliza (91), cierre de
  conciliaciones (42), conciliación bancaria (28)… Causa: "necesidad del usuario"
  (218). Tipo: "se dan indicaciones" (207). El `QA_MensajeError` del ticket dice
  también "no sale" solo en 18.
- **Lo que dicen los tickets (3a3):** la solución al usuario es "Se realizan los
  ajustes necesarios para continuar (con su cierre)". O sea, hubo una acción.
  `NO SALE ERROR` parece una respuesta fija al campo "mensaje de error" escrita
  en el campo de la solución.
- **Peso:** son 218 de los 494 tickets `CALIDAD` (44 %). En Técnicos, una sola
  firma tiene 216 tickets `CALIDAD` de 217 con texto evaluable (4f). El KPI de
  calidad depende casi por completo de esa plantilla.
- **Daniela decide** si es inválida, `PROBLEMA / NO SOLUCION` (hoy) o
  `RESPUESTA SIN ACCION DOCUMENTADA`. Pasarla a inválida deja la tasa de
  inválidas en 41.0 % (13.9).

#### 13.5.2 Texto igual al tipo de solución declarado

3b: 106 tickets copian el rótulo del tipo, y los 106 cuentan como patrón: 66
iguales, 25 con el rótulo truncado y 15 que empiezan con el rótulo. El más común
es `Se dan indicaciones, técnicamente no se hizo nada`, con 61 en total (36
iguales, 22 truncados y 3 que empiezan con el rótulo); va a `INDICACIONES /
CANALIZACION`. Le siguen `No fue necesario hacer nada…` (19, a `VALIDACION / SIN
INTERVENCION`) y `Se otorgan permisos` (22, a `ROLES / PERMISOS`). Que funcione
depende de que el rótulo esté cargado como frase; no hay una regla general.
**Daniela decide** si copiar el tipo es patrón, respuesta sin acción
documentada o inválida. Lo técnico es una regla explícita (texto normalizado =
tipo normalizado), en vez de cargar cada rótulo como frase.

#### 13.5.3 Exacto contra parcial

3c muestra, para cada regla `CALIDAD`, cuántos tickets coinciden de forma exacta
y cuántos contienen la frase con más texto:

- **Contención mal aplicada.** `FAVOR DE VALIDAR` tiene 0 exactos y 58 parciales.
  Los parciales describen acciones reales (`SE CAMBIO LA VISIBILIDAD DE LA
  CUENTA FAVOR DE VALIDAR`). `NUEVA CONTRASEÑA` tiene 0 exactos y 22 parciales,
  todos ya en `CUENTAS / CREDENCIALES` (`SE ANEXA NUEVA CONTRASEÑA`, 18).
  Marcarlos como incompletos sería un error.
- **Contención bien aplicada.** `SE CIERRA (EL) REPORTE POR FALTA DE INFORMACIÓN`
  (3), `EMBARQUE BLOQUEADO POR OTRO USUARIO` (9) y `APOYO … POR INTERMITENCIA EN
  RED` (2) dicen lo mismo que la regla exacta.
- **La igualdad exacta sí funciona** en `MATERIALES SIN PMV` (46), `SE ANEXA
  EVIDENCIA` (33), `SIN TRANSITO` (7) y `FALLA DE RED` (6).

Conclusión: mantener la igualdad exacta como regla general y dar un modo propio
(contiene, empieza con) solo a las reglas en que Daniela lo apruebe. **Daniela
decide** si "incompleta" se define por todo el texto o por la ausencia de
acción.

#### 13.5.4 "Sin respuesta"

3e: `SIN RESPUESTA` es inválida (123). `SIN RESPUESTA DEL USUARIO` es `CALIDAD`
`RESPUESTA SIN ACCION DOCUMENTADA` (40). `SIN RESPUESTA POR PARTE DE USUARIO` (7)
y `SE CONTACTA SIN RESPUESTA` (4) quedan sin patrón. Son tres destinos para el
mismo hecho, con 174 tickets. **Daniela decide** un solo destino. Lo técnico es
que todas las formas lleguen a él.

#### 13.5.5 Reglas desactivadas

Para cada regla inactiva, 3d cuenta cuántos tickets atraparía hoy, separados por
su resultado actual. 3d2 muestra los huecos y 2d (paso 1->9) el destino.

| Regla inactiva | Sin patrón que atraparía | Lectura |
|---|---|---|
| `CONTACTO` (Id 30) | 85 | Atrapa de más (`CONFIRMA CONTACTO DE TIENDA`); usar frases completas |
| `CARGA DE` (Id 35) | 96 | Atrapa de más (`CARGA DE PAGINA`, `CARGA DE IMAGEN`); usar `CARGA DE PRECIO` |
| `ALTA SAP` (Id 84) | 57 | Coincide justo con la familia; el destino depende de 13.3 |
| `NAVEGACION` (Id 46) | 31 | Destino dudoso (13.3) |
| `VALIDACION`/`VALIDACIÓN` (Id 223, 222) | 23 + 16 | Raíz muy general |
| `POLITICAS DE WINDOWS` (Id 134, 141; duplicadas) | 15 | Las dos filas son iguales; el destino es claro |
| `SCRIPT` (Id 147) | 9 | Raíz corta, pero los textos sí son scripts |
| `REPAR` (Id 22) | 10 | Raíz corta; incluye `EL CONTRATO NO CUBRE LA REPARACION`, que no es una reparación |

Las inválidas inactivas `.`, `-`, `,`, `-----------` y `v` no importan: esos
textos ya son no evaluables por la regla de solo signos (3d3). La única inactiva
que cambia algo es `error` (74, H8).

**Recomendación:** no reactivar raíces cortas. Proponer frases completas cuando
Daniela decida a qué patrón va cada familia.

### 13.6 Consistencia entre procedimientos

Los cuatro cuerpos son de 4a. KPIs y Técnicos se modificaron por última vez el
2026-11-25, Patrones también, y el Detalle el 2026-11-26 (4a2).

| Aspecto | KPIs | Técnicos | Patrones | Detalle | Lectura |
|---|---|---|---|---|---|
| Fuente | vista | vista | vista → `#Base` (texto evaluable con clasificación) | vista | Nadie reclasifica |
| Conteo | `COUNT(DISTINCT)` | `COUNT(DISTINCT)` | `COUNT(DISTINCT)` | filas | Cuadran en la ventana (4e, 4g) |
| Fin de rango | `< @FechaFin + 1` | igual | igual | igual | Correcto: `<= @FechaFin` perdería 34 tickets del último día (4d) |
| Inicio > fin | No valida | `THROW 50001` | `THROW 50001` | `THROW 50001` | H16 |
| Firma NULL | Cuenta | Excluye | Cuenta | Cuenta | H17; 0 en todo el historial (4c) |
| Fechas NULL | Todo el historial | igual | igual | igual | 383 214 tickets desde 2025-01-01 (4c) |
| Denominadores | % sobre evaluados | Inválidas y texto evaluable sobre evaluados; patrón, calidad y sin patrón sobre texto evaluable | % sobre texto evaluable | — | Coherente entre los tres |
| `@Top` | — | — | `NULL` por defecto = todos | — | El Pareto se calcula sobre todos los patrones |
| Filtros | — | Grupo | Grupo, Técnico | Grupo, Técnico, Categoría, Estado, Clasificación | H18 |
| Parámetros | `date` | `varchar(250)` | `varchar(250)` | `varchar` | Ningún grupo, firma ni categoría de la ventana cambia al pasar por `VARCHAR` (4h, 0 filas); el riesgo es teórico |
| Etiquetas de estado | — | — | — | La salida usa la etiqueta y el filtro el valor interno | H1 |
| Cuentas no persona | No excluye | Salen como filas | No excluye | No excluye | H19 |

**Técnicos (4f).** Las filas incluyen cuentas de automatización y de proveedor.
Por ejemplo, una cuenta de *setup* tiene 651 tickets, 592 de ellos sin
información QARE. Las inválidas se concentran: 12 firmas con 50 o más evaluados
y 90 % o más de no evaluables suman 1 537 de las 2 945 inválidas (H21). Para la
pantalla, eso dice más que el total.

**Tiempos observados** (una corrida, con caché, en lotes con `INSERT EXEC`): KPIs
unos 3 s, cada Detalle unos 5 s, Técnicos 11 s, Patrones 8 s, y 20 s para leer
el historial completo de la vista. No sustituyen la medición de 12.4.7.

### 13.7 Correcciones técnicas recomendadas

Son cambios a objetos de Daniela. Cada uno lleva su script con rollback, se
prueba antes en LocalDB y se aplica en QA solo con aprobación explícita y con su
acuerdo.

| Orden | Corrección | Hallazgo | Objeto | Impacto medido |
|---|---|---|---|---|
| 1 | Que el Detalle acepte el valor interno **y** la etiqueta en `@EstadoDescripcion` | H1 | `usp_QARE_DetalleEvidencia` | El filtro por la etiqueta pasa de 0 filas a 2 945 |
| 2 | Unir las inválidas con `EXISTS` u `OUTER APPLY TOP (1)` en vez de `LEFT JOIN` | H2 | vista | 0 tickets hoy; evita duplicados futuros |
| 3 | Validar inicio > fin en KPIs, como los otros tres | H16 | KPIs | 0 tickets |
| 4 | Normalizar el texto en los niveles 2-4 **sin recortar el catálogo** | H4-H6, H22 | vista | 6 tickets ganan patrón y 2 pasan a inválida |
| 5 | Escapar `_ % [` de `PalabraClave` o usar `CHARINDEX` | H15 | vista | 0 hoy; preventivo |
| 6 | Modo de comparación explícito por regla | H11, H14 | catálogo y vista | Depende de 13.8 |

La normalización de acentos (antes la 6) entra en la 4, porque 3->4 solo dio
cambios correctos. La que unificaba la firma NULL se quita: no tiene efecto.

### 13.8 Decisiones funcionales pendientes (Daniela)

No se le preguntan todavía. Cada una va con sus ejemplos por ticket.

1. `ERROR` solo: ¿inválida, o `PROBLEMA / NO SOLUCION` como `ERROR DE USUARIO`?
   (H8; 1d)
2. `CARGA DE PRECIOS`: ¿`CARGA / SINCRONIZACION` con la frase `CARGA DE PRECIO`?
   (13.3)
3. `ALTA SAP TIENDA/OAT`: ¿`CUENTAS / CREDENCIALES`, aunque 7 de 57 sean "se
   hace por SorIA"? (13.3)
4. `SE BRINDA CONTACTO …` y vecinas: ¿`INDICACIONES / CANALIZACION`? (13.3)
5. `NAVEGACION` en Seguridad Informática: ¿`ROLES / PERMISOS`? (13.3)
6. `NO SALE ERROR`: ¿inválida, problema o sin acción, si la solución dice que se
   hicieron ajustes? (H10; 3a3)
7. Copiar el tipo de solución (106): ¿patrón, sin acción o inválida? (H13)
8. "Sin respuesta" (174): ¿un solo destino? (H12)
9. ¿"Incompleta" se define por todo el texto o por la ausencia de acción? ¿Qué
   reglas `CALIDAD` pasan a contención? (H11)
10. Filtros de cada bloque de la pantalla (H18); cuentas no persona y
    proveedores (H19); si Técnicos se ordena o se marca por concentración de
    inválidas (H21).
11. Si la evidencia que repite la descripción cuenta como evidencia (H20).
12. Si los catálogos actuales son la versión aprobada y quién los mantiene
    (12.6).

### 13.9 Impacto en los KPIs

Base (4d2, 4e): evaluados 7 714; no evaluables 2 945 (38.2 %); texto evaluable
4 769, que se reparte en patrón 2 316 (48.6 %), `CALIDAD` 494 (10.4 %) y sin
patrón 1 959 (41.1 %). Cada fila estima **un cambio aplicado solo**. Los cambios
no se suman: un ticket puede estar en dos.

| Cambio | No evaluables (% de evaluados) | Texto evaluable | Barra (patrón / calidad / sin patrón) |
|---|---|---|---|
| `ERROR` inválida (74) | 3 019 (39.1 %) | 4 695 | sin patrón 1 885 (40.1 %) |
| `NO SALE ERROR` inválida (218) | 3 163 (41.0 %) | 4 551 | calidad 276 (6.1 %) |
| Frases completas para las 4 familias de 13.3 (231, 1b) | = | = | patrón 2 547; sin patrón 1 728 (36.2 %) |
| Normalización niveles 2-4 (2b; incluye los 3 de H22) | 2 947 | 4 767 | patrón 2 323; sin patrón 1 950 (40.9 %) |
| Todas las reglas reactivadas (2b, nivel 9; **no se recomienda**) | = | = | patrón 2 696; sin patrón 1 579 (33.1 %) |

Efecto por SP: **KPIs** cambia solo con las inválidas. **Técnicos** concentra
los cambios en pocas filas: `NO SALE ERROR` está en 3 firmas y `ALTA SAP` en 2.
**Patrones** mueve la barra y el Pareto: `CARGA / SINCRONIZACION` pasaría de 14
a unos 104 tickets. **Detalle** solo cambia de etiquetas; la corrección 1
arregla su filtro.

### 13.10 Orden recomendado

1. Correcciones 1-3 de 13.7: confirmadas y sin decisión de negocio. Script y
   rollback listos y probados en LocalDB (13.11); falta aprobación para QA.
2. Llevar a Daniela 13.8 con los ejemplos de 1d, 3a3, 3b, 3c2 y 3d2.
3. Con sus respuestas, frases completas en el catálogo (13.5.5) y modo por regla
   (13.7.6).
4. Normalización (13.7.4), sin recortar el catálogo.
5. Medir el rendimiento de los cuatro SP con 15 y 90 días (12.4.7) antes de
   exponerlos.

### 13.11 `sql/46`: correcciones 1-3 (preparadas, NO aplicadas en QA)

Archivos: `sql/46_qare_correcciones_detalle_vista_kpis.sql` y
`sql/46_qare_correcciones_detalle_vista_kpis_rollback.sql`. Usan `ALTER`, así que
conservan los permisos. No tocan tablas, datos ni catálogos.

**Qué cambia en cada objeto.** Fuera de esto, los cuerpos son el texto de QA
leído el 2026-11-27.

| Objeto | Cambio | Lo que no cambia |
|---|---|---|
| `usp_QARE_DetalleEvidencia` | `@EstadoDescripcion` se traduce a `@EstadoInterno`: `RESPUESTA INVALIDA` → `NO EVALUABLE` y `RESPUESTA ANALIZABLE` → `TEXTO EVALUABLE`; cualquier otro valor pasa igual | Los parámetros, las columnas de salida, el orden y los demás filtros. Filtrar por el valor interno da lo mismo que antes |
| `vw_QARE_CalidadCaptura` | El `LEFT JOIN` a `CatQARE_RespuestaInvalida` pasa a ser un `EXISTS` dentro de `flags`, con la **misma** condición (`Campo`, `Activo`, `UPPER(LTRIM(RTRIM()))` en los dos lados) | Las columnas, la regla de solo signos, `CALIDAD` antes que patrón y el orden de las reglas (`Orden`, largo, `IdRegla`). `s` no se usaba en ningún otro lugar de la vista |
| `usp_QARE_CalidadCaptura_KPIs` | Bloque `THROW 50001, 'La FechaInicio no puede ser mayor que la FechaFin.', 1` copiado de los otros tres SP | El cálculo, los filtros y el rango inclusivo |

**Salvaguardas** (el mismo patrón que `sql/84`):
- Solo corre en `Tickets_Proactivanet` y con `aprobar_migracion = 46` (`46R`
  para el rollback). También corre en una base de prueba `QarePrueba_*`.
- **Precondición:** el SHA2-256 de cada `OBJECT_DEFINITION`, sin espacios,
  tabuladores ni saltos de línea, tiene que coincidir con el del texto leído de
  QA. Si Daniela cambió cualquiera de los tres objetos, el script no hace nada y
  muestra los hashes que encontró.
- Las tres modificaciones van en una sola transacción. La **postcondición**
  compara los tres hashes finales; si alguno no coincide, se deshace todo.
- El archivo es UTF-8 con BOM, porque los comentarios de los cuerpos tienen
  acentos y entran en el hash.

**Pruebas en LocalDB.** Se hicieron en la base desechable `QarePrueba_46`, con la
intercalación de QA y 92 tickets sintéticos. **No son cifras de QA.** La base ya
se borró. A = cuerpos originales, B = con `sql/46`, C = después del rollback.

| Validación | Resultado |
|---|---|
| H1: `RESPUESTA INVALIDA` devuelve los mismos tickets que `NO EVALUABLE` | A: 0 filas; B: 14, los mismos tickets (diferencia 0); igual con grupo y ventana (0 → 5) y en minúsculas |
| H1: los demás estados y las corridas sin estado | Iguales en A y B: sin filtros 92, ventana 91, último día 1, `NO EVALUABLE` 14, `TEXTO EVALUABLE` 72, `SIN INFORMACION QARE` 6, estado desconocido 0, grupo 47, firma 26, categoría 30, clasificación 52 |
| H1: `RESPUESTA ANALIZABLE` | A: 0; B: 72, los mismos que `TEXTO EVALUABLE` |
| H2: catálogo sin duplicados | La vista completa es igual en A, B y C (`EXCEPT` en los dos sentidos = 0) |
| H2: duplicados activos equivalentes (`na` y ` NA ` además de `NA`, y `v ` además de `V`, en una transacción que se deshace) | A: 104 filas para 92 tickets, y el Detalle devuelve 104. B: 92 = 92. La clasificación de B con duplicados es igual a la de B sin ellos (0). KPIs: 14 no evaluables en todos los casos (ya usaba `COUNT(DISTINCT)`) |
| H3: inicio > fin | KPIs en A: una fila con ceros. En B: error 50001, con el mismo mensaje que el Detalle |
| H3: rangos válidos (sin fechas, ventana, último día, solo inicio, solo fin) | KPIs iguales en A y B (0) |
| Rollback | Hashes de C = A, y la vista, el Detalle y KPIs de C = A |
| Rechazos | En otra base sin aprobación no se ejecuta nada. Con KPIs cambiado, con un estado parcial (solo la vista nueva) y con un segundo intento de migración o de rollback, se niega sin tocar nada. Una copia sin BOM leída como cp1252 falla en la postcondición y se deshace: los hashes quedan como en A |

**Riesgos pendientes.**
- La precondición depende de que los cuerpos que se leyeron de QA (salidas
  `.rpt`) coincidan carácter por carácter, sin contar los blancos, con lo que hay
  en QA. Si el script se niega en QA, los hashes que muestra en "antes" dicen
  qué objeto difiere. Entonces hay que volver a leer ese cuerpo; no se debe
  forzar.
- El texto de KPIs se armó a partir de las líneas de 4a, que omiten las líneas
  en blanco. El hash ignora los blancos. El rollback devuelve el mismo texto sin
  contar los blancos, pero no el mismo formato.
- `RESPUESTA ANALIZABLE` cambia de 0 filas a las de texto evaluable. Es el mismo
  defecto que H1, pero si la pantalla dependiera de recibir 0, cambia lo que ve.
- En una base sin los objetos de QA, `SET NOEXEC ON` no ejecuta nada, pero
  SQL Server igual compila el `ALTER VIEW` y muestra un error 208. En QA no pasa.
- Los SP que leen la vista se recompilan en su siguiente ejecución.
