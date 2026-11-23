# Tableros HTML — SLA, Productividad, Backlog y demás pestañas

Tableros web para consultar información de tickets de Proactivanet desde SQL Server. Funcionan en **IIS con ASP.NET** y no requieren Python en el servidor.

> Este documento describe lo que hace el **código de este repositorio** (rama `claude-branch`). Lo que depende de cada servidor —qué versión está copiada, qué trae su `Web.config`, si los procedimientos existen en la base, cada cuánto corre el ETL— se indica como tal y hay que comprobarlo en el propio servidor.

## 1. Arquitectura

Una sola página, `dashboard.html`, con una barra lateral de pestañas (registro `MODULOS` en `dashboard.js`):

| Pestaña | Dónde vive | Cómo se monta |
|---|---|---|
| SLA y productividad | `dashboard.html` / `dashboard.js` | propia de la página |
| Backlog | `backlog/` | `moduloEmbebido()`: se trae su HTML, su hoja y su script la primera vez que se abre |
| Experiencia | `experiencia/` | `moduloEmbebido()` |
| Calidad de información › QA | `qa/` | `moduloEmbebido()` |
| Calidad de información › QARE | `qare/` | `moduloEmbebido()` |
| Servicios › Vista general de servicios | `concentracion/` | `moduloEmbebido()`, independiente de Análisis de servicios (ver §3bis) |
| Servicios › Análisis de servicios | `analisis/` | `moduloEmbebido()` |
| Observabilidad › Observabilidad | `assets/Tablero_Experiencia.html` | `<iframe>` (ver §2.4) |
| Observabilidad › Orquestación | `orquestacion/` | `moduloEmbebido()` |
| Call Center | `dashboard.html` / `dashboard.js` | comparte la barra de filtros de SLA (`adoptarControlesSla`) |

**Observabilidad**, **Calidad de información** y **Servicios** (Vista general de servicios + Análisis de servicios) son entradas de grupo (`GRUPOS` en `dashboard.js`): la barra muestra una sola entrada y un selector interno (`.subnav`) cambia entre sus dos módulos, que siguen siendo los mismos de `MODULOS`. Los hashes de siempre siguen valiendo (`#tablero`, `#orquestacion`, `#qa`, `#qare`, `#analisis`, `#concentracion`); `#observabilidad`, `#calidad` y `#servicios` abren el último módulo visto del grupo (el primero, la primera vez).

La entrada **Iniciativas** es un enlace a `admin/iniciativas.html`, no una pestaña; se ve para toda cuenta Windows autenticada (`handlers/admin_sesion.ashx` dice `"registro": true`). Dentro, el registro es de todos; **Solicitar una iniciativa** y **Solicitudes** (las propias) son de ADM, MOD y de los Product Owner / Service Owner vigentes (dueño de una fila vigente de `dbo.CatCategoriaDueno` **o** `dbo.CatPersona.Rol` = Product Owner / Service Owner, con la cuenta resuelta a una sola persona vigente por correo; Director no califica por rol; regla aditiva, ADM/MOD igual); **Administración** sigue siendo de ADM/MOD. La autorización real está en el servidor (`App_Code/AccesoIniciativas.cs` y `App_Code/AccesoAdmin.cs`); el interruptor `INICIATIVAS_ABIERTAS` ya no decide el acceso.

Cada carpeta de módulo sigue funcionando también como página suelta (`backlog/backlog.html`, `experiencia/experiencia.html`, ...).

### Componentes

- **`handlers/*.ashx` + `App_Code/`** — API ASP.NET/C# consumida por los tableros (`dashboard.js` pide a `handlers/`).
- **`assets/`** — piezas compartidas (`datos-info.js`, `escape.js`, `desplegable.js`, `mock-data.js`, ...) y `assets/vendor/chart.umd.min.js`.
- **`Web.config.ejemplo`** — plantilla de configuración de IIS y conexión a SQL Server.
- **`sql/`** — solo algunos scripts del tablero (QA, Call Center, QARE, diagnósticos de lectura). Los scripts base (`04_dashboard_sla.sql`, `07_correo_backlog.sql`, `08_ids_proactivanet.sql`, `16_cruce_llamadas_tickets.sql`, ...) **no están en este repositorio**: viven en el de integración (Integracion_SQL-Proactivanet).

IIS compila `App_Code/` automáticamente durante la primera solicitud. No hay un proyecto de Visual Studio ni es necesario ejecutar `dotnet build`.

## 2. Dashboard de SLA y productividad

La pestaña de SLA contiene:

- filtros por fecha (inicio, fin, rango rápido y «Últimos SLOTs»);
- filtros por grupo y por técnico (selección múltiple; sin selección se incluyen todos);
- interruptor **Todos / Sin proveedores**;
- tarjetas KPI;
- cumplimiento de SLA por líder y grupo (tabla plegada);
- entra vs sale y productividad por técnico;
- cumplimiento de SLA en el tiempo, dónde se pierde el SLA, prioridad de lo resuelto;
- reabiertos por grupo y en el tiempo;
- personas con más tickets resueltos.

El rango mide **lo resuelto** en el periodo (fecha de solución; los «creados» van por fecha de registro).

### Filtros de fecha

Rango libre o accesos rápidos: **7 días** y **Año** en SLA; **7 días** y **Mes** en el Call Center. El stepper **Últimos SLOTs** (0 a 12) reescribe el rango a bloques de 30 días; 0 lo apaga.

**Limpiar** quita Grupos, Técnicos, Campañas y «Sin proveedores», apaga el SLOT, quita los filtros por clic en las gráficas, vuelve al mes en curso y vuelve a pedir los datos al servidor (vacía la caché de 60 s de los agregados de SLA). El botón lo dice en su texto emergente.

### KPIs y gráficos

Sin filtros por clic, los KPIs salen del servidor: resueltos, creados, tiempo de 1ª respuesta, cumplimiento SLA, vencidos SLA, horas de resolución (mediana y 90 %), reabiertos, automatizado, técnicos activos y reasignaciones promedio.

Al hacer clic en una barra o rebanada (prioridad, SLA) se activa un **filtro por clic**: las gráficas y los KPIs se recalculan sobre las filas de detalle cargadas. El pie de «Resueltos (filtrado)» dice qué filtro por clic está puesto (por ejemplo `por clic: Prioridad: Alta · 120 de 900 cargados`); otro clic en la misma barra lo quita.

El interruptor **Todos / Sin proveedores** saca de toda la pestaña de SLA —KPIs, tendencia, productividad, distribución, detalle y la tabla por líder y grupo— los grupos de proveedor: los que, sin espacios a la izquierda, empiezan por `Proveedor` (sin distinguir mayúsculas). «Vendor Managment» no entra en la regla y se queda. El grupo excluido sale del numerador y del denominador del SLA. La regla vive solo en `DashboardQueries.GrupoProveedor` (`App_Code/DashboardQueries.cs`); viaja como `?proveedores=excluir` y «Todos» no manda nada, así que da exactamente los números de siempre. No toca la base de datos: la tabla por líder y grupo filtra en `sla_lider_grupo.ashx` las filas que devuelve `dbo.usp_Dash_SlaLiderGrupo`. En el Call Center el interruptor se retira, igual que Grupos.

Los gráficos usan Chart.js servido **localmente** desde `assets/vendor/chart.umd.min.js` (no hace falta salida a internet).

### Call Center y carga combinada

Es su **propia pestaña** (Call Center), con la misma barra de filtros que SLA: Grupos y «Sin proveedores» se retiran y aparece Campañas.

- **Call Center** — tarjetas y gráficos de llamadas, servidos por `llamadas.ashx`. El filtro de grupo no se aplica: una llamada no tiene grupo resolutor. El de técnico solo acota «Atención por agente»: el handler traduce el nombre a extensiones con `dbo.CatAgenteTecnico` (y `dbo.CatAgenteTecnicoAlias` para nombres viejos) y descarta las filas del resto. Los procedimientos no cambian.
- **Carga combinada** — tickets y llamadas por técnico en la misma fila, servido por `carga_combinada.ashx`. Solo incluye a los técnicos con extensión telefónica registrada en `dbo.CatAgenteTecnico`; el filtro de técnico lo acota. Los tickets se cuentan por fecha de firma de solución y las llamadas únicamente si fueron contestadas.

Ambos bloques requieren que se hayan ejecutado `14_llamadas_callcenter.sql`, `15_dashboard_llamadas.sql` (en `sql/`) y `16_cruce_llamadas_tickets.sql` (repo Integracion_SQL, rama `feature/tablero-sla-productividad`). El filtro de técnico no necesita ningún script nuevo: usa los catálogos que ya crea el 16. Si faltan, el resto del tablero sigue funcionando y el bloque de carga combinada se desactiva indicando el motivo.

### 2.4. Origen y frescura de los datos

Lo que hace el código; si un handler responde o no, y la fecha que muestra, depende del servidor.

| Pestaña | Origen | Qué fecha muestra |
|---|---|---|
| SLA, Call Center | `handlers/*.ashx` contra SQL en cada carga (los agregados de SLA se reutilizan hasta 60 s en el navegador; «Limpiar» los descarta) | «Última actualización»: sello del ETL que manda el servidor en `kpis.meta` |
| Backlog | `handlers/backlog_*.ashx` | «Última actualización»: la fecha de corte con la que respondió el servidor (un corte, sin periodo) |
| Experiencia | `handlers/experiencia.ashx`; **si no responde**, `experiencia/data/experiencia.mock.json` (corte guardado a mano) | En vivo: sello y periodo del servidor. Respaldo: aviso «Datos de respaldo, no en vivo» arriba y la pastilla dice «Datos de respaldo, no en vivo · Corte: dd/mm/aaaa» con la fecha guardada en el propio archivo |
| QA, QARE | `handlers/qa.ashx`, `handlers/qare.ashx` | sello (y periodo) de `dataInfo` |
| Análisis de servicios | `handlers/analisis.ashx` | no muestra sello de frescura |
| Vista general de servicios | `handlers/concentracion.ashx` (filas de ticket de `dbo.vw_ServicioTickets` del periodo; caché de 5 min por mes —o por rango de Slots— y día; cabecera `Server-Timing`) | «Última actualización»: sello del ETL (`dbo.EtlLog`); «Periodo»: las fechas del Slot o del mes, calculadas en el servidor |
| Orquestación | `handlers/orquestacion.ashx` (vistas del `sql/77_tablero_orquestacion.sql` sobre el esquema `orq` del 76) | «Carga del Excel»: `FechaFin` de la última `orq.CargaLote` aplicada |
| Tablero (Observabilidad) | `assets/Tablero_Experiencia.html`, un archivo **generado** (TableroExperiencia_v3.7.exe) con los datos dentro; no consulta SQL | «Instantánea generada el dd/mm/aaaa · no se actualiza en vivo» en la cabecera de cada panel, copiada del pie «Generado el ...» que pone el generador. Si el archivo no trae esa fecha, no se muestra ninguna |

Además:

- `observabilidad/` es página suelta, **sin enlace** desde la navegación. Lee `data/*.mock.json` (el JSON que traía el monolito) y su pie es texto fijo. No son datos en vivo. `orquestacion/` ya es pestaña y lee la base.
- `MOCK_DATA` (`assets/js/mock-data.js`) debe ser `false` en el repositorio. Con `true` (solo pruebas locales) SLA, Call Center y Backlog usan datos simulados y la pastilla lo dice («Datos simulados (MOCK_DATA), no reales»).
- Ninguna fecha de frescura se calcula en el navegador: si el servidor o el archivo no la traen, la pastilla queda vacía. La única hora del navegador es «Consultado: …» (ver abajo), que dice cuándo se consultó el servidor, no de cuándo son los datos.

#### Refresco automático

- **Intervalo:** `RefrescoAuto.INTERVALO_DATOS` en `assets/js/refresco-auto.js` (5 min). Es el único sitio donde se cambia. Las listas de Solicitudes en Admin siguen con `RefrescoAuto.INTERVALO` (2 min).
- **Qué se refresca:** solo la pestaña a la vista. En el tablero: SLA y Call Center (una sola carga), Backlog, QARE, QA, Experiencia, Efectividad, Orquestación y Vista general de servicios, con un único temporizador (`dashboard.js`, sección 4ter; cada módulo publica su `refrescar()` y el router lo conoce por `refrescoDe()`). En Admin: el registro de Iniciativas (`VistaRegistro.refrescarFondo`), solo con la lista a la vista y sin detalle abierto. No se refrescan Análisis (se calcula con el botón Analizar sobre el servicio elegido, con una descarga grande que procesa un Worker, y su hoja «Reglas» tiene cambios de prueba sin guardar) ni Observabilidad (instantánea generada, no consulta SQL).
- **Montaje:** cada pestaña se sigue montando la primera vez que se abre, no al cargar la página. Montarlas todas al arrancar no habilitaba el refresco (lo que faltaba era la carga en modo «fondo» de cada módulo) y sumaría al inicio el HTML, el script y la consulta de cada una —Experiencia y la segunda fase de QA son las más pesadas— además de gráficas medidas en cero dentro de un contenedor oculto. Una pestaña ya montada que no se está viendo no pide nada; al volver a ella, si sus datos ya pasaron el intervalo, se refresca en ese momento y sin volver a montarse.
- **Cómo:** la misma carga del botón, en modo «fondo». Se conservan los filtros, la selección por clic y lo que se está escribiendo. No se refresca con la pestaña del navegador oculta (al volver, si ya pasó el intervalo, refresca una vez), con un campo con el foco ni con un desplegable abierto. Nunca hay dos peticiones encimadas.
- **Por módulo:**
  - *QA:* resumen y distribución por estado sin «Calculando…»; el Top 10 por grupo y técnico (que siempre es la vista por omisión) también se refresca: con la vista por omisión sale de la misma petición, con otro rango o filtros es una petición más. Si el detalle está abierto se vuelve a pedir con sus filtros y su página. Pasa por la caché de `qa.ashx` (5 min el resumen, 2 min el detalle), así que un dato nuevo puede tardar hasta ese tiempo más.
  - *Experiencia:* vuelve a pedir `experiencia.ashx` (nunca el respaldo) y repinta con `renderAll()`, como al cambiar un filtro. Se conservan Director / PO / Manager / SO, «Ver por», tipo de registro, la selección de las gráficas, las casillas del Histórico, la tarjeta elegida, el panel a la vista y las filas desplegadas de los árboles (por nombre). Con un modal abierto no se refresca. Si la carga inicial cayó al respaldo y el refresco trae datos en vivo, el aviso de respaldo se quita. `experiencia.ashx` no tiene caché en el servidor: cada refresco es la consulta completa. Los automatizados de SLA del modo a la vista (`experiencia_automatizados.ashx`: una llamada con todos los periodos, repartida por dueño; misma caché de 5 min que `kpis.ashx`) se vuelven a pedir sin pasar por «cargando». Cambiar Director / PO / Manager / SO no los pide: se filtran en el navegador.
  - *Efectividad:* una petición; se conservan filtros, búsqueda, orden, hoja y motivos desplegados. Con la boleta abierta no se refresca. Su dato cambia cuando corre el cálculo por lotes (`dbo.ExpEfectividadCorrida`); entre corridas el refresco trae lo mismo.
  - *Orquestación:* una petición; se conservan filtros, direcciones desplegadas, indicador del histórico y la lista de jobs. La lista (`?detalle=1`) solo se vuelve a pedir si llegó otra carga del Excel (`orq.CargaLote`). Su dato cambia con esa carga, no con el ETL de tickets.
- **«Actualizar»:** cada una de esas pestañas tiene el botón. Pide en ese momento y queda deshabilitado mientras la petición está en vuelo.
- **«Consultado: dd/mm/aaaa · hh:mm»:** renglón aparte en la pastilla (o junto al título en Admin). Solo avanza con una respuesta correcta. Si un refresco falla, los datos anteriores se quedan y se agrega «⚠ No se pudo actualizar (hh:mm); se muestran los datos anteriores».
- **Límites de origen:** el refresco solo trae lo que ya está en SQL. SLA y Call Center pasan además por la caché del servidor (`DashboardQueries.SegundosCache`, 300 s), así que un cambio puede tardar hasta unos 5 min más. Backlog es una foto diaria (`dbo.CorreoBacklogSnapshot`): si se está viendo el último corte y llega uno nuevo, el refresco cambia a ese corte. El registro de Iniciativas lee `dbo.Problem` sin caché: un PRB editado en Proactivanet aparece cuando el ETL del repositorio de integración lo carga. Este repositorio no cambia la programación del ETL.

## 3bis. Vista general de servicios

Pestaña propia en la barra lateral, justo debajo de **Análisis de servicios**. Se llamó «Concentración de tickets» hasta el 2026-11-09; la carpeta (`concentracion/`), el handler (`concentracion.ashx`), el contenedor y el hash (`#concentracion`) conservan ese nombre para no romper enlaces. Es una vista **global**: carga sola al abrirse, sin elegir servicio, y no lee, cambia ni comparte nada con Análisis de servicios, que sigue esperando a que se elija un servicio y se pulse Analizar.

### Filtros

| Filtro | Qué hace |
|---|---|
| **Periodo por: Slot / Mes** | Uno a la vez; el botón elegido muestra su control y oculta el otro. Nunca se combinan (la intersección de una ventana rodante y un mes calendario sería parcial y ambigua). |
| **Slot** (0–12, 0 por omisión) | La columna `Slot` de `dbo.vw_Tickets`, sin cambiar su cálculo: **Slot k = hoy−(30k+29) … hoy−30k**, 30 días con hoy dentro del Slot 0 (comprobado contra QA el 2026-11-09). No es el SLOT del stepper de SLA (cuenta desde ayer y el 0 mide 31 días). |
| **Mes** | Mes calendario por `FechaRegistro`: el mes en curso (hasta hoy) y los 12 anteriores, el mismo alcance que los Slots. |
| **Service Owner** (varios) | El SO de la **categoría** del ticket según `dbo.CatCategoriaDueno`: el de su C1&C2 exacto o, si no está capturado, el de su C1 (`App_Code/DirectorioOrganizacional.cs`, la única resolución de dueños del sitio, la misma de Experiencia; llaves `fn_CategoriaC1` / `fn_CategoriaC1C2` de la categoría). Los tickets sin SO resuelto se eligen como «(Sin Service Owner)». No se usa `dbo.CatServiceOwner` (la tabla de las vistas viejas de slots). |
| **Grupo** (varios) | `Grupo` del ticket (el grupo asignado). |

Varios valores de un filtro = cualquiera de ellos; filtros distintos = todos a la vez. Los filtros se aplican a las **cuatro** gráficas (en la comparación, a los dos periodos). Bajo los controles, una línea dice lo aplicado (periodo con sus fechas reales, SO, Grupo y «N de M tickets del periodo»). Las listas de SO y Grupo salen de los tickets del periodo, con su conteo; lo elegido que ya no aparece se conserva con 0. **Limpiar** vuelve al estado de arranque: Slot 0 (también desde Mes), sin meses, SO ni Grupo; si ya está así, no vuelve a pedir. «Actualizar» y el refresco automático piden con los mismos filtros y no los reinician.

### Gráficas

| Gráfica | Qué pinta |
|---|---|
| Concentración de tickets por servicio (Pareto, a todo el ancho) | Top 10 por **código de servicio** (`CatServicioCorreo.Servicio`, rotulado con su `Descripcion`; PU y WMS son una barra cada uno), % acumulado en línea y referencia 80 % punteada |
| Tickets por categoría (abajo, izquierda) | Top 15 en barras horizontales; el eje muestra los dos últimos niveles de la ruta en dos líneas y el tooltip la ruta completa |
| Tickets por grupo (abajo, derecha) | Top 15 en barras horizontales |
| Servicios con mayor cambio de tickets (abajo, a todo el ancho; 2026-11-18) | Top 5 que más subieron (rojo `#ff4646`, el de «SLA vencidos») y Top 5 que más bajaron (verde `#4CAF50`, el de «Dentro SLA»; los mismos de las barras de SLA) contra el periodo anterior, barras horizontales divergentes desde 0 con eje simétrico y la diferencia con signo |

### Comparación con el periodo anterior

- **Qué se compara:** por **código de servicio** (como el Pareto: un servicio que cambia de rama de categoría sigue siendo una sola entrada), tickets distintos del periodo actual contra los del periodo anterior, con **los mismos filtros** de Service Owner (mismo catálogo de dueños) y Grupo en los dos. Diferencia = actual − anterior; las de 0 no salen. A igual diferencia, por código. No usa `dbo.usp_DashboardServicios_Comparativo` (agrupa por rama y no filtra por SO ni Grupo; ver `sql/diag/ADM_DIAG_usp_DashboardServicios_Comparativo.sql`).
- **Periodo anterior** (`ConcentracionContrato.PeriodoAnterior`, misma duración, pegado al actual, con el hoy de México):
  - Slot N (acumulado, 30·(N+1) días): los 30·(N+1) días anteriores a su inicio.
  - Mes cerrado: el mes anterior completo. Mes en curso (del 1 a hoy): los mismos días del mes anterior, acotados a su último día.
  - Varios meses: cada mes se corre hacia atrás tantos meses como abarca la selección (del más viejo al más reciente). Seguidos → los mismos meses justo antes; no seguidos → el mismo patrón, nunca un rango continuo.
- **Historia insuficiente:** el periodo anterior se lee por `FechaRegistro` y se exige que **cada día** tenga al menos un ticket (la misma cobertura de la pestaña, sobre todos los tickets y antes de filtros). Nunca se compara contra un periodo a medias ni se recorta solo el anterior.
- **Ventana máxima comparable** (2026-11-18, `ConcentracionContrato.VentanaComparable`): si el anterior pedido no está completo y la selección es continua (Slot, o meses seguidos), se comparan dos ventanas de **L días**, iguales, pegadas y sin solape, que terminan en el fin del periodo elegido. La historia continua empieza el día siguiente al último día **sin ningún ticket** (hoy no cuenta; los días bajos, como los feriados, no son hueco); con T días cubiertos hasta el fin, `L = floor(min(lo pedido, floor(T/2)) / 7) · 7` (semanas completas: los dos lados con los mismos días de la semana). Se parten de las filas ya leídas (sin otra consulta), con los mismos filtros y la misma cuenta. La gráfica muestra un aviso ámbar con lo pedido, desde cuándo hay historia y las dos ventanas; las otras tres gráficas siguen con el periodo completo. `cambios.ventana` trae lo pedido (`solicitado`) y `actual`/`anterior` lo comparado.
  - Sin ventana posible: `historiaInsuficiente` con `motivo` — `ventanaMinima` (L < 28 días) o `noConsecutivos` (meses con hueco: una ventana continua metería meses no elegidos).
  - En QA al 2026-11-18: Slots 0–4 comparan su periodo completo; Slots 5–12 y los 13 meses comparan 175 días (28/05/2026–18/11/2026 contra 04/12/2025–27/05/2026); solo Dic 2025 no alcanza (14 días).
- **Errores:** si no se puede leer el periodo anterior, `cambios.estado = error` y `errores.cambios`; las otras tres gráficas siguen.
- **Costo:** una lectura más por petición para el periodo anterior, con la misma caché de 5 min (en modo Mes, un mes completo comparte la llave de la pestaña).
- **Por qué no la USP** (2026-11-18): se comparó contra `dbo.usp_DashboardServicios_Comparativo` en la rama `experiment/servicios-usp` (réplica en LocalDB, no QA). C# fue más rápido en frío en los cinco casos y leyó 2–4 veces menos páginas: la USP vuelve a leer el periodo actual, que la pestaña ya tiene en memoria, y no cubre Service Owner, Grupo, varios meses ni la historia. La USP no se usa ni se modificó.

#### Limitaciones conocidas de la comparación

- **Días sin tickets vs. carga faltante.** La historia se da por completa solo si cada día tiene al menos un ticket en `vw_ServicioTickets` (todos los servicios y grupos, antes de filtros). Con los datos no se puede distinguir un día real sin tickets de un día que el ETL no cargó; los dos cuentan como hueco. Verificado en QA (`sql/diag/DIAG_Concentracion_CoberturaDiaria.sql`, 2026-11-18): la historia continua empieza el **2025-12-01**; desde entonces los 352 días tienen tickets (~423/día, 16–24 horas con registros cada día) y ningún día en cero; antes solo hay diez tickets sueltos (uno por día, del 2025-08-19 al 2025-11-28) que no son historia. Los días bajos son feriados reales (1 de enero: 80; 25 de diciembre: 135), por eso solo un cero es hueco.
- **Hoy va a medias.** Slot 0 y el mes en curso incluyen el día de hoy, incompleto, contra días completos del periodo anterior. En Slot 0 el actual cuenta de menos hasta ~1/30 del volumen del periodo (≈3 %) al empezar el día; en el mes en curso el efecto es mayor al principio del mes (el día 1 es un día parcial contra uno completo). Inclina las diferencias pequeñas hacia «reducción». Es la regla aprobada (la misma de la pestaña); excluir hoy en los dos lados sería un cambio de comportamiento aparte.
- **Slot anterior por fechas.** El actual se lee por la columna `Slot` y el anterior por `FechaRegistro`. Son el mismo corte porque `vw_Tickets` calcula `Slot = FLOOR(DATEDIFF(DAY, FechaRegistro, DATEADD(HOUR, -6, SYSUTCDATETIME())) / 30.0)`: los rangos de los Slots 0–10 coinciden con los de QA (2026-11-09, `ConcentracionContratoSmoke`). El texto de `vw_Tickets` usado para comprobarlo es el recuperado, no idéntico byte a byte; si esa fórmula cambiara en QA, los dos periodos dejarían de estar pegados. La ventana acotada parte por `FechaRegistroDia` filas de las dos lecturas (su anterior puede caer dentro del actual pedido); depende del mismo corte.
- **Lectura adicional.** En la réplica de LocalDB, la lectura del periodo anterior es ~35–50 % del tiempo de una petición en frío (0.35 s en mes en curso, 0.6 s en Slot 0, 2.2 s en Slots 0–3, 3.4 s en Slots 0–6) y 3–30 ms con caché. El refresco automático (cada 5 min) coincide con el vencimiento de la caché, así que en la práctica cada refresco paga las dos lecturas. Pendiente de medir en QA (`sql/diag/BENCH_cambios_csharp_vs_usp_QA.sql`, rama experimental).

- **Cuenta:** la misma de los procedimientos `usp_CorreoServicio_*`, sobre los tickets ya filtrados: tickets distintos por etiqueta, total = suma, orden por cantidad y nombre, porcentajes a 2 decimales. El acumulado y el 80 % se calculan sobre **todas** las filas; el Top 10/15 solo recorta lo que se pinta. Cada gráfica muestra **su propio** total (categorías sin categoría y grupos sin grupo quedan fuera).
- **Colores** (2026-11-09): azul acero `#5b84b1` hasta alcanzar el 80 % (la barra que lo cruza incluida), azul claro `#c3d5ea` el resto, acumulado en ámbar apagado `#d39a3a`, referencia en gris pizarra punteado `#8a94a6`.
- **Cobertura:** si el periodo tiene tickets en menos días de los que mide (sin contar hoy), sale un aviso discreto con el primer y último día con datos. Se mide sobre todos los tickets del periodo, antes de SO y Grupo. En QA la historia continua empieza el 2025-12-01 (antes, solo tickets sueltos).

### De dónde salen los datos

- Los tres procedimientos (`dbo.usp_CorreoServicio_Pareto`, `_TicketsCategoria`, `_TicketsGrupo`, versionados tal cual en `sql/81_concentracion_tickets.sql`) solo aceptan `@Slot`. Para Mes, Service Owner y Grupo había que cambiarles el contrato o crear objetos nuevos; se decidió (2026-11-09) que la pestaña **ya no los llame** y lea la misma vista, `dbo.vw_ServicioTickets`, con una consulta parametrizada de solo lectura (`App_Code/ConcentracionQueries.cs`), como Experiencia con sus vistas. Los procedimientos quedan en la base **sin tocar**.
- `sql/82_pareto_por_servicio.sql` sigue **pendiente** (propiedad y consumidores del procedimiento sin confirmar) y ya no hace falta para la pestaña: el Pareto por código se calcula en la aplicación. La prueba de paridad comprueba que, con los mismos datos, categorías y grupos salen idénticos a 81 y el Pareto idéntico a 82.
- **Conexión y permisos:** la cadena `TicketsProactivanet` de siempre. Necesita SELECT sobre `dbo.vw_ServicioTickets`, `dbo.CatServicioCorreo`, `dbo.CatCategoriaDueno` y `dbo.CatPersona`, y EXECUTE sobre `dbo.fn_CategoriaC1C2` (desde 2026-11-11 solo para categorías con caracteres fuera de `ConcentracionContrato.C1C2Verificable`: el resto se calcula en C#, una vez por categoría distinta). En QA, el usuario SQL `PROACTIVANETAD` tiene `db_datareader` y EXECUTE sobre el esquema `dbo`. Qué login usa el sitio lo dice el `Web.config` del servidor (`sql/diag/diag_concentracion_consumidores_identidad.sql`, sección I).
- **Errores:** si no se puede leer el periodo, 500 y la banda de error. Si no se puede leer el catálogo de dueños, las gráficas siguen sin el filtro de SO y lo dicen en avisos; con un SO elegido, 500 (no se ignora un filtro en silencio).
- **Pruebas:** `tools/tests/ConcentracionVistaSmoke.js` (parte pura), `ConcentracionContratoSmoke.cs` (contrato, paridad con 81/82 y filtros sobre LocalDB) y `ConcentracionHeadlessSmoke.js` (Chrome: filtros, refrescos, la pestaña suelta y `dashboard.html#concentracion`).

## 3. Dashboard de Backlog

`backlog/backlog.html` utiliza los datos de `dbo.CorreoBacklogSnapshot` mediante los procedimientos `usp_CorreoBacklog_*`.

Incluye:

- KPIs;
- tendencia total;
- tendencia por líder;
- backlog por líder;
- backlog por prioridad;
- antigüedad apilada por líder;
- tabla resumen por antigüedad, con drill-down: cada antigüedad se despliega en los grupos que tienen tickets en ella;
- tickets más antiguos por líder.

**Limpiar** quita Servicio / C1, Grupos y Líderes, vuelve a la ventana de 30 días agrupada por día y quita los filtros por clic en las gráficas. La fecha de corte se conserva.

El listado de tickets antiguos no exige una antigüedad mínima: es **una tarjeta por líder** con sus tickets más viejos que pasan los filtros, del más viejo al más nuevo por fecha de registro (empates por código; sin fecha al final). Cada tarjeta abre con 10 y su botón «Ver 25 más» destapa 25 más solo para ese líder, hasta 100 (10 → 35 → 60 → 85 → 100), con lo ya cargado: no vuelve a pedir nada al servidor. Para que el filtro por clic de líder o prioridad encuentre los más viejos de lo filtrado, `backlog_antiguos.ashx` manda la unión de los 100 más viejos de cada líder y de cada prioridad, más `total` (cuántos tenía el corte entero), en vez del backlog completo. Permite mostrar la descripción al pasar el ratón sobre el código. El código también puede funcionar como enlace directo al ticket en Proactivanet cuando existe su GUID correspondiente.

Las descripciones pueden contener HTML procedente de Outlook y ser muy grandes. Para el tablero se limita el contenido recibido y posteriormente se limpia y recorta en el navegador.

### Enlaces a Proactivanet

El enlace utiliza el formato:

```text
formIncidents.paw?id=<GUID>
```

El GUID no procede directamente del ETL. `sincronizar_ids.py` (repositorio de integración) obtiene el mapeo mediante la API y lo almacena en `dbo.TicketProactivanetId`, creado por `08_ids_proactivanet.sql`.

El servidor web únicamente consulta esa tabla; no necesita el token de Proactivanet ni acceso a internet para resolver el enlace.

Si un ticket todavía no tiene GUID en el mapeo, su código se muestra como texto sin crear un enlace roto.

## 4. Primera configuración de la base de datos

Ejecutar sobre la base `Tickets_Proactivanet`. Los scripts 04, 07, 08 y 16_cruce están en el repositorio de integración; 14 y 15, en `sql/` de este:

```powershell
# Dashboard de SLA y productividad
sqlcmd -S AZVMBDCENTRALQA -d Tickets_Proactivanet -i 04_dashboard_sla.sql

# Dashboard de Backlog
sqlcmd -S AZVMBDCENTRALQA -d Tickets_Proactivanet -i 07_correo_backlog.sql

# Mapeo de GUID de Proactivanet
sqlcmd -S AZVMBDCENTRALQA -d Tickets_Proactivanet -i 08_ids_proactivanet.sql

# Call Center y carga combinada
sqlcmd -S AZVMBDCENTRALQA -d Tickets_Proactivanet -i 14_llamadas_callcenter.sql
sqlcmd -S AZVMBDCENTRALQA -d Tickets_Proactivanet -i 15_dashboard_llamadas.sql
sqlcmd -S AZVMBDCENTRALQA -d Tickets_Proactivanet -i 16_cruce_llamadas_tickets.sql
```

El mapeo de GUID lo llena `sincronizar_ids.py` desde el equipo donde se ejecuta el ETL. El tablero funciona aunque el mapeo todavía no esté cargado; en ese caso los códigos de ticket simplemente no tendrán enlace.

Las demás pestañas (Experiencia, QA, QARE, Análisis, Administración) usan otros objetos de la base; sus instrucciones están en sus propias carpetas (`experiencia/INSTALAR_*.md`, `analisis/INSTALAR.md`) y en `sql/`.

## 5. Despliegue en IIS

Los archivos `.ashx` son ASP.NET y IIS compila `App_Code/` automáticamente.

### Requisito

El servidor debe tener ASP.NET 4.x habilitado en IIS. La documentación original especifica ASP.NET 4.8 cuando esa versión está disponible.

### Archivos del sitio

Copia al sitio de IIS el árbol del tablero, con las mismas rutas relativas:

```text
dashboard.html
dashboard.css
dashboard.js
assets/          (incluye Tablero_Experiencia.html y vendor/)
backlog/
experiencia/
qa/
qare/
analisis/
concentracion/
admin/
handlers/        (todos los .ashx)
App_Code/
```

`dashboard.js` pide los datos a `handlers/<nombre>.ashx`; si falta un handler, solo se vacía o marca error el bloque que lo usa.

Copia `Web.config.ejemplo` como `Web.config` en el servidor y ajusta la conexión a SQL Server.

> **Si el servidor ya tiene un `Web.config`**, no basta con copiar los archivos del sitio: hay que añadirle **a mano, una sola vez**, el bloque `<staticContent><clientCache>` de `Web.config.ejemplo` (y los tres `<location path="*/vendor">` que lo acompañan). Sin él, IIS manda los `.css` y `.js` sin `Cache-Control`, el navegador aplica su heurística y **un despliegue puede quedar invisible**: se copian los archivos nuevos y el navegador sigue pintando la hoja anterior, sin ningún aviso. Ya pasó una vez.
>
> Para comprobarlo: DevTools → Network, recargar sin forzar. `dashboard.css` debe traer `cache-control: no-cache` en la respuesta y salir como `304`; `assets/vendor/chart.umd.min.js` debe salir de caché.

`Web.config.ejemplo` registra también el módulo `AdminAccesoModulo`, que protege `admin/iniciativas.html`. Si el `Web.config` del servidor no lo tiene, la página estática no queda protegida por el módulo (los handlers de Admin siguen exigiendo rol por su cuenta).

### Admin en desarrollo local (`AdminDevOverride`)

IIS Express no tiene Autenticación de Windows: en local todo request llega anónimo y Admin responde 403. Para probar Admin en la máquina de desarrollo existe un atajo (`App_Code/AccesoDesarrolloLocal.cs`) que da el rol de desarrollo (ADM por omisión, o MOD) a la cuenta de `ADMIN_DEV_IDENTIDAD` **solo si se cumplen todas** estas condiciones, evaluadas en el servidor:

1. `<add key="AdminDevOverride" value="true" />` en `appSettings` del `Web.config` **local**. Ausente, vacía o cualquier otro valor = apagado. **Apagado por omisión**: `Web.config.ejemplo` no la trae.
2. `<compilation debug="true">` (sin `DEBUG` el código del atajo ni se compila).
3. `Request.IsLocal`: la dirección de la conexión es de esta máquina. No se lee `Host`, URL, query, cookie, header ni nada del navegador.
4. El proceso es `iisexpress.exe` (en la VM el sitio corre en `w3wp.exe`).
5. La cuenta (`ADMIN_DEV_IDENTIDAD`, entorno del proceso que pone `dev-local.cmd`) está en `App_Code/AdminWhitelistTemporal.cs`.
6. (2026-10-28; QA desde 2026-10-29) La cadena `TicketsProactivanet` del `Web.config` apunta **exactamente** a la base desechable de desarrollo (`(localdb)\MSSQLLocalDB` / `GestionAdminPrueba_Dev`) o a la de QA (`AZVMBDCENTRALQA` / `Tickets_Proactivanet`), sin `AttachDbFilename` ni `Failover Partner` (`AccesoDesarrolloLocal.BasePermitida`, con `SqlConnectionStringBuilder`). Otro servidor (producción, `localhost`, otra instancia de LocalDB), otra base (aunque empiece igual) o una cadena que no se puede leer: sin atajo. Contra QA, lo que se guarda desde localhost queda firmado con la cuenta de desarrollo (`ADMIN_DEV_IDENTIDAD`) y su rol de desarrollo.

Encenderlo en local:

```text
1. En el Web.config local (está en .gitignore), dentro de <appSettings>:
       <add key="AdminDevOverride" value="true" />
   y <compilation debug="true" ...>.
2. dev-local.cmd 8081                         (t_andresvr como ADM)
   dev-local.cmd 8081 SORIANA\t_andresvr MOD  (probar restricciones de MOD)
   Desde Git Bash: ./dev-local.cmd 8081 'SORIANA\t_andresvr' MOD
3. http://localhost:8081/admin/iniciativas.html
   handlers/admin_sesion.ashx debe responder "desarrollo_local": true.
```

Para apagarlo, quitar la clave (o cualquier valor distinto de `true`) y reiniciar IIS Express.

Alcance: solo el rol de Admin del request. No cambia la cadena de conexión ni los permisos SQL (la web sigue con su cuenta de servicio), no salta validaciones de los handlers ni modifica `dbo.UsuariosAdmin` ni el rol de otros usuarios. Con MOD, lo exclusivo de ADM (crear/modificar directo, aplicar o rechazar solicitudes de cambio, aprobar o rechazar Nuevas solicitudes, correos, alta de categoría, dueños) sigue en 403 `RolInsuficiente`. MOD es el rol de consulta de los Product Owner y Service Owner: lee el registro y puede pedir cambios, pero no ve el Subestado (el registro no lo manda) ni puede pedir un cambio de Subestado (422). Crear, modificar y enviar solicitudes los firma (`@Usuario`, bitácora) `AccesoAdmin.IdentidadEscritura`: la identidad Windows real si IIS la trae; si no, y solo con el atajo activo, la cuenta de `ADMIN_DEV_IDENTIDAD` que ya pasó por la whitelist. Nunca algo que mande el navegador. Sin ninguna de las dos: 403 `SinUsuario`.

> Desde 2026-10-28 (condición 6; QA permitida desde 2026-10-29), si el `Web.config` de IIS Express apunta a cualquier base que no sea `(localdb)\MSSQLLocalDB` / `GestionAdminPrueba_Dev` ni `AZVMBDCENTRALQA` / `Tickets_Proactivanet`, el atajo no se activa: Admin sigue la regla normal (anónimo → 403). El sitio IIS de la VM (`w3wp.exe`) sigue la regla normal.

Comprobar que en la VM no está activo:

- En el `Web.config` de la VM: no debe existir `AdminDevOverride` y `compilation debug` debe ser `"false"`. Aun si alguien copiara ambas cosas, la condición 4 (`w3wp.exe`) lo corta.
- Abrir `handlers/admin_sesion.ashx` en la VM: la respuesta **nunca** debe traer `"desarrollo_local"`. Una cuenta sin fila ADM/MOD en `dbo.UsuariosAdmin` debe ver `"autorizado":false` (y `"registro":true`: el registro es de todos).

Pruebas: `tools/tests/AccesoAdminHttpSmoke.cs` (bloques L y W; compilar en Release y con `/define:DEBUG`) y `tools/tests/AccesoDesarrolloLocalIisExpress.ps1` (IIS Express real: con la clave apagada corre I0; con `true`, I1–I4) y `tools/tests/AdminEscrituraLocalIisExpress.ps1` (POST real de crear / modificar / enviar solicitud en un sitio temporal con base inalcanzable: nunca escribe; no usa el `Web.config` local).

**No copies `requirements.txt` ni `config.json` al sitio IIS.** Esos archivos pertenecen al ETL. La conexión del tablero se configura mediante `Web.config`.

### Correo RCA de prueba (`admin/admin.html`)

Prueba **aislada** del envío de un RCA por correo: un *Título de prueba* y **un** documento salen con asunto `PRUEBA RCA - <Título de prueba>` y adjunto `Prueba_RCA.<extensión original>` hacia el **Correo RCA** (Para) y el **CC RCA** guardados. No crea iniciativas ni solicitudes, no consume consecutivos, no toca SQL Server y no guarda el documento: se lee a memoria, se valida y se descarta. Código: `handlers/admin_rca_correo.ashx`, `App_Code/RcaCorreoPrueba.cs`, `admin/rca-correo.js`.

- **Acceso:** solo ADM (`AccesoAdmin.ExigirAdm`, también contra POST desde otro sitio). MOD recibe 403 `RolInsuficiente`; VIEWER y anónimo, 403.
- **Remitente:** Microsoft Graph (`POST /me/sendMail`, permiso delegado `Mail.Send`) con OAuth 2.0. Outlook.com no acepta usuario y contraseña (SMTP básico) para aplicaciones, y `SmtpClient` de .NET no implementa XOAUTH2. En `Web.config`: `RcaRemitente`, `RcaOAuthClientId`, `RcaOAuthTenant` (ver `Web.config.ejemplo`). Ni contraseñas ni tokens van en `Web.config`, en el repositorio ni al navegador.
- **Conexión de la cuenta (una vez):** un ADM pulsa *Conectar cuenta remitente*; la página muestra un código, se abre `microsoft.com/link`, se inicia sesión **con la cuenta remitente** y se escribe el código (flujo de código de dispositivo). El servidor comprueba que la cuenta conectada sea `RcaRemitente` y guarda el refresh token **cifrado con DPAPI de Windows en ámbito de máquina** en `RcaDirDatos\remitente.token` (por omisión `App_Data\rca`, que IIS no sirve). La llave la custodia Windows: no está en `Web.config` ni en el repositorio, no depende del perfil del App Pool y sobrevive a reciclados y reinicios. El archivo solo se descifra en ese servidor; protégelo con los permisos NTFS de la carpeta. No se usa `MachineKey`: sin `<machineKey>` explícito su llave autogenerada puede cambiar al reciclar. Microsoft rota el token en cada uso y el servidor guarda el nuevo; si se revoca, vence (unos 90 días sin uso) o se cambia de servidor, la página pide volver a conectar.
- **Remitente alterno: SMTP (`RcaModo = smtp`).** Para cuando no se puede registrar la aplicación en Microsoft Entra (el directorio pide consentimiento de un administrador o un editor verificado). Envía con `System.Net.Mail.SmtpClient`; en `Web.config`: `RcaModo=smtp`, `RcaRemitente`, `RcaSmtpServidor`, y opcionales `RcaSmtpPuerto` (587), `RcaSmtpSsl` (true, STARTTLS) y `RcaSmtpAutenticar` (true). .NET no soporta el puerto 465 (TLS implícito). Con autenticación, el usuario es `RcaRemitente` y un ADM escribe la contraseña **una vez** en la página (*Guardar contraseña*): el servidor la guarda **cifrada con el mismo DPAPI de máquina** en `RcaDirDatos\remitente.smtp`, el campo se vacía y nunca se devuelve al navegador; *Borrar contraseña* la elimina. No se comprueba al guardar: el primer envío lo hace (`SmtpAutenticacion` si se rechaza).
  - **Gmail:** `smtp.gmail.com`, 587. Requiere verificación en dos pasos y una **contraseña de aplicación** (<https://myaccount.google.com/apppasswords>); la contraseña normal no sirve. Se acepta con o sin los espacios con que Google la muestra.
  - **Relevo interno** (p. ej. el servidor de correo de la empresa): `RcaSmtpAutenticar=false`, sin contraseña; el servidor de correo autoriza por IP.
  - Comprobar la salida desde el servidor: `Test-NetConnection smtp.gmail.com -Port 587` (`TcpTestSucceeded : True`). Abrir Gmail en el navegador (puerto 443) no lo demuestra.
  - Códigos: `SmtpAutenticacion` (usuario o contraseña rechazados), `SinConexion` (no se pudo conectar: no salió), `SmtpTls`, `SmtpDestinatario`, `SmtpNoDisponible` (4xx temporal), `SmtpTamano`, `SmtpRechazo`, y `ResultadoDesconocido` cuando la conexión se corta a medio envío o se agota el tiempo (pudo salir: revisar el buzón antes de reintentar).
- **Destinatarios:** `RcaDirDatos\destinatarios.json` (una dirección en cada campo; CC opcional; quién y cuándo los guardó). El envío usa siempre los guardados y **los vuelve a validar** con la misma regla antes de enviar: si el archivo se editó a mano o se dañó, no sale nada y la página dice qué campo corregir.
- **Documento:** uno; `pdf`, `docx`, `xlsx`, `pptx`, `doc`, `xls`, `ppt`; máximo 3 MB (límite de Graph para un adjunto en línea; `RcaMaxBytes` solo lo baja). Se valida extensión, tipo MIME y la firma del contenido.
- **Duplicados:** el botón se deshabilita mientras envía y el servidor admite un solo envío a la vez (`EnvioEnCurso`). Si Microsoft no responde a tiempo, el resultado es *desconocido* y la página pide revisar el buzón antes de reintentar.
- **Requisitos del servidor:** salida HTTPS a `login.microsoftonline.com` y `graph.microsoft.com` (o el proxy configurado en `system.net/defaultProxy`) y permiso de **escritura** de la cuenta del App Pool en `RcaDirDatos`.

Registro de la aplicación (una vez, en <https://entra.microsoft.com> con cualquier cuenta que pueda registrar aplicaciones; con una cuenta personal se crea un directorio gratuito):

1. *App registrations › New registration*. Tipos de cuenta: **Personal Microsoft accounts only** (o *Accounts in any organizational directory and personal Microsoft accounts*). Sin URI de redirección.
2. *Authentication › Advanced settings › Allow public client flows* = **Yes** (necesario para el código de dispositivo).
3. *API permissions*: Microsoft Graph, **Delegated**: `Mail.Send`, `User.Read`, `offline_access`. No se crea ningún *client secret*.
4. Copiar el *Application (client) ID* a `RcaOAuthClientId`.

Pruebas automáticas (sin red ni IIS; no prueban la entrega real): `tools/tests/RcaCorreoPruebaSmoke.cs` (configuración, adjunto, asunto, mensaje, fallos de Microsoft, reintentos, conexión y permisos del handler) , `tools/tests/RcaCorreoSmoke.js` (reglas de la página) y `tools/tests/RcaCorreoHeadlessSmoke.js` (la sección en Chrome con un servidor falso). `RcaCorreoPruebaSmoke` también cifra con DPAPI de verdad y descifra desde otro proceso, como tras un reciclado, y manda con el `SmtpClient` real a un servidor SMTP local (127.0.0.1) para comprobar el mensaje armado y los errores de autenticación, destinatario y conexión. La entrega real se comprueba a mano: conectar la cuenta, guardar destinatarios, enviar y revisar Bandeja de entrada y Enviados del buzón.

### Avisos de Power Automate (`TeamsWebhookUrl`)

`App_Code/AvisoTeams.cs` manda NEW_REQUEST, REQUEST_APPROVED y REQUEST_REJECTED al trigger HTTP de Power Automate. Los tres están conectados a los flujos reales: NEW_REQUEST al chat de revisores y aprobar / rechazar como mensaje privado al solicitante original (abajo). El panel de pruebas local manda los tres con datos sintéticos.

- **URL:** `TeamsWebhookUrl` en `appSettings` del `Web.config` del servidor. La firma `sig=` del URL es la credencial (trigger *Anyone*): nunca en el repositorio, en el navegador ni en la traza. Vacía o ausente = apagado.
- **Formato (`TeamsWebhookFormato`):**
  - `texto` (por omisión): mensaje de webhook de Teams con una Adaptive Card y un `TextBlock`; el flujo lee `attachments[0].content.body[0].text`. Un `|` dentro de un valor se cambia por `/` y los saltos de línea por espacios; un valor vacío deja su posición vacía (nunca corre las demás).
    - Los tres eventos, **seis campos, sin estado** (el evento ya lo dice): `evento|tipo|correo|nombre|numero|<5>`.
    - NEW_REQUEST (chat de revisores): `<5>` = fecha `aaaa-mm-dd`. Tipo `Initiative` = iniciativa nueva, `Change request` = solicitud de cambio.
    - REQUEST_APPROVED (mensaje privado): `<5>` = Código de la iniciativa.
    - REQUEST_REJECTED (mensaje privado): `<5>` = comentario del revisor.
  - `json`: `{ evento, tipo, solicitanteEmail, solicitanteNombre, requestNumber, estado, codigo, comentario }` (las ocho llaves siempre, `null` si no aplica). Antes de usarlo hay que cambiar el flujo: el trigger con el esquema de esas ocho llaves (o *Parse JSON*), y las expresiones que hoy hacen `split(..., '|')[n]` pasan a `triggerBody()?['solicitanteEmail']`, etc.
- **Envío:** síncrono, 5 s de timeout, sin seguir redirecciones; nunca lanza. Los fallos van a la traza de ASP.NET (categoría `AvisoTeams`) sin URL ni datos personales. Requiere salida HTTPS desde el servidor hacia Power Automate (no verificado en la VM).

**NEW_REQUEST real** (`App_Code/AvisoNuevaSolicitud.cs`): al chat de revisores, una vez por solicitud nueva, después del `COMMIT`.

| | Initiative | Change request |
|---|---|---|
| Punto | `admin_iniciativas_validar.ashx`, tras `IniciativaService.Solicitar` | `admin_iniciativas_solicitudes.ashx` (`accion=enviar`), tras `Almacen.Enviar`, fuera del `try` |
| Condición | `Guardada` y `Nuevo` (mismo token = `Nuevo` falso: sin aviso) | `Repetida` falsa (misma llave = sin aviso) |
| Correo `[2]` | El guardado por el alta (`adm.SolicitudIniciativa.SolicitanteCorreo`) | `SolicitadoPor` → `CatPersona` (una sola persona); si no, y es ADM/MOD, el único `UsuariosAdmin.CorreoUsuario` |
| Nombre `[3]` | El guardado por el alta (`adm.SolicitudIniciativa.SolicitanteNombre`) | `SolicitadoPor` → el nombre de la cola (`UsuariosAdmin.NombreSolicitante`, luego `CatPersona`) |
| Número `[4]` | `#0000142` (devuelto por la base) | `#57` (`IdSolicitud`, como la cola) |

- **Fecha `[5]`:** reloj del servidor al avisar, en la zona del sitio (`DashboardDataInfo.UtcAPresentacion`: México, UTC-06 fijo, sin horario de verano), `aaaa-mm-dd`. No depende de la zona de Windows de la VM ni del navegador.
- **Correo o nombre sin resolver:** su posición vacía (`NEW_REQUEST|Change request|||#57|2026-11-19`); el aviso sale igual. Nunca se arma `cuenta@soriana.com` ni se usa el correo o la cuenta como nombre.
- **Sin aviso** (la solicitud se responde igual): webhook vacío (ni se consulta la base); validación o base fallan; envío no confirmado (500); reintento; *Modificar* / reemplazar (pendiente de decidir). Si Power Automate falla, la solicitud sigue guardada y la respuesta no cambia.
- **Power Automate (las tres ramas; cambiarlas a mano):** con `p = split(<texto>, '|')`: `p[1]` Tipo, `p[2]` Correo, `p[3]` Solicitante, `p[4]` Solicitud #, `p[5]` Fecha (NEW_REQUEST) / Código (aprobar) / Comentario (rechazar). Respecto del texto anterior de siete campos, `p[0]`–`p[4]` no cambian; el estado (`p[5]`) desaparece, lo que estaba en `p[6]` pasa a `p[5]`, y `p[6]` ya no existe. En aprobar y rechazar hay que cambiar `p[6]` por `p[5]` y dejar de leer el estado.
- **Probarlo a mano (local / QA, nunca producción):**
  1. Primero el botón *Probar nueva solicitud* del panel: manda `NEW_REQUEST|Initiative|<correo de prueba>|Usuario de Prueba|TEST-PA-001|aaaa-mm-dd` y sirve para ajustar el flujo sin crear datos.
  2. Después, en `http://localhost:8081/admin/iniciativas.html` (contra QA), una **Nueva solicitud** de iniciativa con título que empiece por `PRUEBA PA -`; en el chat de revisores revisar tipo `Initiative`, correo y nombre de quien la envió, `Solicitud #` igual al número que muestra la pantalla y la fecha de hoy (UTC-06).
  3. Luego una **Solicitud de cambio** sobre una iniciativa de prueba (motivo `PRUEBA PA`); revisar tipo `Change request` y `#id` igual al de la cola.
  4. Reenviar el mismo borrador (reintento) no debe generar un segundo mensaje.
  5. Limpiar: un ADM **rechaza** ambas solicitudes desde la pestaña Solicitudes (motivo `Prueba Power Automate`). No se borra nada a mano. Cada rechazo manda ahora REQUEST_REJECTED privado a quien envió la solicitud (abajo): sirve de prueba del rechazo.

**REQUEST_APPROVED / REQUEST_REJECTED reales** (`App_Code/AvisoRevisionSolicitud.cs`): mensaje privado al **solicitante original**, nunca a quien revisa, una vez por revisión confirmada, después del `COMMIT`.

| | Initiative | Change request |
|---|---|---|
| Aprobar | `admin_iniciativas_solicitudes_nuevas_revision.ashx` (`Aprobar`), tras `AprobarYCrear`, solo con `Nueva` verdadero | `admin_iniciativas_solicitudes.ashx` (`Aplicar`), tras `AplicadorSolicitudCambio.Aplicar` con éxito, fuera del `try` |
| Rechazar | el mismo handler (`accion=rechazar`), tras `Rechazar` | el mismo handler (`accion=rechazar`), tras `Almacen.Rechazar` |
| Correo `[2]` | `adm.SolicitudIniciativa.SolicitanteCorreo` guardado | `SolicitadoPor` → `CatPersona` (una sola persona); si no, y `RolSolicitante` es ADM/MOD, el único `UsuariosAdmin.CorreoUsuario` |
| Nombre `[3]` | `adm.SolicitudIniciativa.SolicitanteNombre` guardado | el de la cola (`UsuariosAdmin.NombreSolicitante`, luego `CatPersona`) |
| Número `[4]` | `#0000142` | `#57` (`IdSolicitud`) |
| `[5]` aprobar | Código emitido por `AprobarYCrear` | Código de la iniciativa modificada (`adm.SolicitudCambio.Codigo`), no el `IdSolicitud` |
| `[5]` rechazar | comentario del revisor | comentario del revisor |

- **Rol del solicitante:** en Change request se usa `RolSolicitante` guardado con la solicitud (ADM, MOD o PSO), nunca el del revisor. Un PO/SO (PSO) que no está en `CatPersona` no tiene respaldo de `UsuariosAdmin`: queda sin correo y **no se envía**.
- **Sin correo válido no hay mensaje** (`AvisoTeams.MotivoInvalido`, registrado en la traza); nunca se manda a otra persona ni se arma `cuenta@soriana.com`. Nombre sin resolver = posición vacía.
- **Sin aviso:** webhook vacío (ni se relee la base); aprobación repetida (`Nueva` falso: reintento u otro ADM ganó); ya revisada (409); validación o base fallan; la solicitud releída no quedó `RECHAZADA` / `APLICADA`. No hay reintentos.
- **Aviso perdido (aceptado):** si el `COMMIT` ocurre pero la respuesta falla (500 `RevisionNoConfirmada` / `AplicacionNoConfirmada`), no se avisa, y el reintento tampoco (`Nueva` falso o 409).
- **Power Automate:** la rama de aprobación recibe en `p[5]` un Código en los dos tipos; si su texto dice que se *creó* una iniciativa, debe distinguir `p[1]` (`Initiative` / `Change request`). No verificado en el flujo guardado.
- **Probarlo a mano (QA):** enviar con la cuenta A, aprobar o rechazar con la cuenta B (ADM) y confirmar que el mensaje privado llega a A, no a B, con el Código o el comentario en `p[5]`; repetir con una solicitud de cambio.

**Panel de pruebas (solo localhost).** *PRUEBAS DE POWER AUTOMATE (SOLO LOCALHOST)* en `admin/admin.html`: cuatro botones (nueva solicitud, nueva solicitud de cambio, aprobación, rechazo) con datos sintéticos `TEST-PA-001..003`; no lee ni escribe solicitudes. El de cambio manda `p[1] = Change request` (campo `tipo` del POST); el texto «Iniciativa» / «Cambio» del chat de grupo lo arma el flujo a partir de `p[1]`, no el sitio. Código: `handlers/admin_pruebas_power_automate.ashx`, `App_Code/PruebasPowerAutomate.cs`, `admin/pruebas-power-automate.js`.

- **Puerta (servidor):** el atajo de desarrollo local completo (`AccesoDesarrolloLocal`: `AdminDevOverride`, `debug="true"`, petición local, IIS Express, base de desarrollo o QA, cuenta en la whitelist) y rol ADM. Fuera de eso el handler responde 404 `SoloLocalhost` y la página no pinta el panel. El POST además pasa por `AccesoAdmin.ExigirMismoOrigen` (CSRF: otra página abierta en la misma máquina recibe 403).
- **Destinatario de los mensajes privados:** `TeamsPruebaDestinatario` del `Web.config` local; si no, el correo de la cuenta de desarrollo en `CatPersona`, o su `UsuariosAdmin.CorreoUsuario` único. Sin ninguno, no envía. El nombre de los tres avisos es fijo: `Usuario de Prueba` (`PruebasPowerAutomate.NombrePrueba`); en los flujos reales un nombre desconocido sigue viajando vacío.
- **Usarlo:** en el `Web.config` local, `TeamsWebhookUrl` (y opcionalmente `TeamsPruebaDestinatario`), más lo de *Admin en desarrollo local*; `dev-local.cmd 8081`; abrir `http://localhost:8081/admin/admin.html`.
- **Pruebas:** `tools/tests/AvisoTeamsSmoke.cs`, `tools/tests/PruebasPowerAutomateSmoke.cs`, `tools/tests/AvisoNuevaSolicitudSmoke.cs`, `tools/tests/AvisoRevisionSolicitudSmoke.cs` y las secciones AV / AR de `tools/tests/SolicitudesCambioHttpSmoke.cs` y AR de `tools/tests/RevisionSolicitudesIniciativaHttpSmoke.cs` (sin red externa). La llegada real a Teams se comprueba a mano.

### Application Pool

El Application Pool debe utilizar:

- .NET CLR Version `v4.0`;
- pipeline `Integrated`.

`dashboard.html` está configurado como documento predeterminado mediante `Web.config.ejemplo`.

## 6. Conexión y permisos SQL

La configuración de `Web.config` puede utilizar autenticación integrada de Windows o autenticación de SQL Server.

Con autenticación integrada (`Integrated Security=SSPI`), el principal que necesita permisos en SQL Server es la identidad utilizada por el Application Pool, que es un login de Windows: `[SORIANA\CuentaAppPool]`.

Con autenticación SQL (`User ID=PROACTIVANETAD`), los permisos deben asignarse al **login de SQL Server** `[PROACTIVANETAD]`, que no es el usuario de Windows del mismo nombre. Son dos principales distintos aunque coincida el nombre.

Otorgar el permiso al principal equivocado produce un síntoma engañoso: la conexión se abre correctamente, porque el login existe, pero cada llamada devuelve `The EXECUTE permission was denied`. Para evitarlo, otorga sobre el login con el que se conecta el sitio (`SELECT SUSER_SNAME()` ejecutado con esa misma cadena de conexión).

La opción recomendada es otorgar `EXECUTE` sobre el esquema `dbo`:

```sql
GRANT EXECUTE ON SCHEMA::dbo TO [Principal];
```

También pueden otorgarse permisos únicamente sobre los procedimientos necesarios. La lista de abajo cubre SLA y Backlog; **no es completa**: Call Center, Experiencia, QA, QARE, Análisis y Administración usan más procedimientos (ver los handlers y `App_Code/`).

```sql
GRANT EXECUTE ON dbo.usp_Dash_Catalogos                  TO [Principal];
GRANT EXECUTE ON dbo.usp_Dash_KpisMulti                  TO [Principal];
GRANT EXECUTE ON dbo.usp_Dash_TendenciaMulti             TO [Principal];
GRANT EXECUTE ON dbo.usp_Dash_ProductividadTecnicoMulti  TO [Principal];
GRANT EXECUTE ON dbo.usp_Dash_DistribucionMulti          TO [Principal];
GRANT EXECUTE ON dbo.usp_Dash_DetalleMulti               TO [Principal];

GRANT EXECUTE ON dbo.usp_CorreoBacklog_Catalogos         TO [Principal];
GRANT EXECUTE ON dbo.usp_CorreoBacklog_Principal         TO [Principal];
GRANT EXECUTE ON dbo.usp_CorreoBacklog_Historico         TO [Principal];
GRANT EXECUTE ON dbo.usp_CorreoBacklog_HistoricoPorLider  TO [Principal];
GRANT EXECUTE ON dbo.usp_CorreoBacklog_Datos             TO [Principal];
GRANT EXECUTE ON dbo.usp_TicketIds_Obtener               TO [Principal];
```

No es necesario otorgar `db_owner` para que el tablero funcione. Los procedimientos pertenecen al esquema `dbo` y pueden utilizar ownership chaining para acceder a las tablas y vistas que necesitan.

### Cifrar la cadena de conexión

Si se utiliza autenticación SQL, la contraseña queda en texto plano dentro de `Web.config`. Puede cifrarse esa sección en el propio servidor:

```powershell
cd C:\Windows\Microsoft.NET\Framework64\v4.0.30319
.\aspnet_regiis.exe -pef "connectionStrings" "C:\ruta\del\sitio"
```

## 7. Diagnóstico y troubleshooting

### El sitio abre pero no muestra datos

Revisa primero:

1. Que exista `Web.config` en la raíz del sitio.
2. Que la cadena `TicketsProactivanet` esté configurada correctamente.
3. Que el Application Pool esté usando `.NET CLR v4.0` e `Integrated`.
4. Que ASP.NET esté habilitado en IIS.
5. Que la identidad correcta tenga permisos `EXECUTE` en SQL Server.
6. Que los scripts SQL requeridos se hayan ejecutado.

Si la pestaña Experiencia muestra «Datos de respaldo, no en vivo», `handlers/experiencia.ashx` no respondió: lo que se ve es el corte guardado, no la base.

### Probar un endpoint directamente

Por ejemplo:

```text
https://<sitio>/handlers/catalogos.ashx
```

Una respuesta con los catálogos indica que la conexión y permisos básicos funcionan.

Una respuesta con:

```json
{"error":"...","tipo":"..."}
```

indica un error dentro del procesamiento.

Si IIS devuelve una página HTML de error en lugar de JSON, revisa primero la configuración de ASP.NET y el Application Pool.

### Diagnóstico de permisos

Este repositorio **no** incluye un `diagnostico.ashx` general. Para saber con qué login se conecta el sitio y qué permisos tiene, consulta en SQL Server con esa misma cadena de conexión (`SELECT SUSER_SNAME(), USER_NAME(), HAS_PERMS_BY_NAME('dbo.usp_Dash_KpisMulti','OBJECT','EXECUTE')`) y otorga los `GRANT` a ese login.

### Errores frecuentes

| Mensaje | Causa probable |
|---|---|
| `Falta la cadena de conexion 'TicketsProactivanet'` | Falta `Web.config` o la cadena está mal configurada. |
| `Parser Error` / `Could not load type '...'` | No compila `App_Code/`. Habitualmente falta el bloque `<assemblies>` con `System.Web.Extensions` dentro de `<compilation>` en `Web.config` —incluido en `Web.config.ejemplo`—, ya que la directiva `<%@ Assembly %>` de un `.ashx` no se aplica a `App_Code`. También ocurre si la carpeta `App_Code/` no se copió completa. |
| `Login failed for user 'DOMINIO\SERVIDOR$'` | El Application Pool usa `ApplicationPoolIdentity` y SQL Server está en otro servidor. Utiliza una cuenta de dominio o autenticación SQL. |
| `Login failed for user ...` | La identidad del Application Pool no puede autenticarse contra SQL Server. |
| `EXECUTE permission was denied` | Falta `GRANT EXECUTE` o se otorgó al principal equivocado. |
| `Invalid object name 'dbo.vw_Dash_ProductividadBase'` | No se ejecutó `04_dashboard_sla.sql`. |
| `A network-related ... error occurred` | El servidor IIS no puede alcanzar SQL Server. |

Los errores de ASP.NET también pueden consultarse en el Visor de eventos de Windows, en `Registros de Windows → Application`.

## 8. Notas

- Los procedimientos `usp_Dash_*Multi` son los utilizados por los filtros múltiples del tablero y conviven con los procedimientos anteriores de productividad.
- El tablero no requiere Python ni el token de Proactivanet en el servidor IIS.
- El ETL y el servidor web pueden ejecutarse en máquinas diferentes.
- El correo de Backlog comparte parte de la infraestructura SQL utilizada por la pestaña de Backlog.
- Administración (`admin/`): crear y modificar iniciativas y el alta de categorías **solo validan** en el servidor; la persistencia no está implementada (`PersistenciaGestionAdmin.Habilitada` e `IntegracionCategoriasProactivanet.Habilitada` son constantes `false`).
