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
| Análisis de servicios | `analisis/` | `moduloEmbebido()` |
| Observabilidad › Observabilidad | `assets/Tablero_Experiencia.html` | `<iframe>` (ver §2.4) |
| Observabilidad › Orquestación | `orquestacion/` | `moduloEmbebido()` |
| Call Center | `dashboard.html` / `dashboard.js` | comparte la barra de filtros de SLA (`adoptarControlesSla`) |

**Observabilidad** y **Calidad de información** son entradas de grupo (`GRUPOS` en `dashboard.js`): la barra muestra una sola entrada y un selector interno (`.subnav`) cambia entre sus dos módulos, que siguen siendo los mismos de `MODULOS`. Los hashes de siempre siguen valiendo (`#tablero`, `#orquestacion`, `#qa`, `#qare`); `#observabilidad` y `#calidad` abren el último módulo visto del grupo (el primero, la primera vez).

La entrada **Administración** es un enlace a `admin/iniciativas.html`, no una pestaña; solo se ve si `handlers/admin_sesion.ashx` dice que la cuenta está autorizada, y la autorización real está en el servidor (`App_Code/AccesoAdmin.cs`).

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
| Orquestación | `handlers/orquestacion.ashx` (vistas del `sql/77_tablero_orquestacion.sql` sobre el esquema `orq` del 76) | «Carga del Excel»: `FechaFin` de la última `orq.CargaLote` aplicada |
| Tablero (Observabilidad) | `assets/Tablero_Experiencia.html`, un archivo **generado** (TableroExperiencia_v3.7.exe) con los datos dentro; no consulta SQL | «Instantánea generada el dd/mm/aaaa · no se actualiza en vivo» en la cabecera de cada panel, copiada del pie «Generado el ...» que pone el generador. Si el archivo no trae esa fecha, no se muestra ninguna |

Además:

- `observabilidad/` es página suelta, **sin enlace** desde la navegación. Lee `data/*.mock.json` (el JSON que traía el monolito) y su pie es texto fijo. No son datos en vivo. `orquestacion/` ya es pestaña y lee la base.
- `MOCK_DATA` (`assets/js/mock-data.js`) debe ser `false` en el repositorio. Con `true` (solo pruebas locales) SLA, Call Center y Backlog usan datos simulados y la pastilla lo dice («Datos simulados (MOCK_DATA), no reales»).
- Ninguna fecha de frescura se calcula en el navegador: si el servidor o el archivo no la traen, la pastilla queda vacía.

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

Alcance: solo el rol de Admin del request. No cambia la cadena de conexión ni los permisos SQL (la web sigue con su cuenta de servicio), no salta validaciones de los handlers ni modifica `dbo.UsuariosAdmin` ni el rol de otros usuarios. Con MOD, lo exclusivo de ADM (crear/modificar directo, correos, alta de categoría, dueños) sigue en 403 `RolInsuficiente`. Crear, modificar y enviar solicitudes los firma (`@Usuario`, bitácora) `AccesoAdmin.IdentidadEscritura`: la identidad Windows real si IIS la trae; si no, y solo con el atajo activo, la cuenta de `ADMIN_DEV_IDENTIDAD` que ya pasó por la whitelist. Nunca algo que mande el navegador. Sin ninguna de las dos: 403 `SinUsuario`.

> En la VM, IIS Express (`dev-local.cmd`) es la instancia de desarrollo y usa la cadena de conexión de **su** `Web.config`: si apunta a la base real, crear y modificar escriben en la base real, firmados con esa cuenta. El sitio IIS de la VM (`w3wp.exe`) sigue la regla normal.

Comprobar que en la VM no está activo:

- En el `Web.config` de la VM: no debe existir `AdminDevOverride` y `compilation debug` debe ser `"false"`. Aun si alguien copiara ambas cosas, la condición 4 (`w3wp.exe`) lo corta.
- Abrir `handlers/admin_sesion.ashx` en la VM: la respuesta **nunca** debe traer `"desarrollo_local"`. Una cuenta sin fila ADM/MOD en `dbo.UsuariosAdmin` debe ver `{"autorizado":false}`.

Pruebas: `tools/tests/AccesoAdminHttpSmoke.cs` (bloques L y W; compilar en Release y con `/define:DEBUG`) y `tools/tests/AccesoDesarrolloLocalIisExpress.ps1` (IIS Express real: con la clave apagada corre I0; con `true`, I1–I4) y `tools/tests/AdminEscrituraLocalIisExpress.ps1` (POST real de crear / modificar / enviar solicitud en un sitio temporal con base inalcanzable: nunca escribe; no usa el `Web.config` local).

**No copies `requirements.txt` ni `config.json` al sitio IIS.** Esos archivos pertenecen al ETL. La conexión del tablero se configura mediante `Web.config`.

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
