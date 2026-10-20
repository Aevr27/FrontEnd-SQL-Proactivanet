# FrontEnd-SQL-Proactivanet

Tableros web (HTML + ASP.NET en IIS) sobre la base `Tickets_Proactivanet`,
que alimenta el pipeline de integración de Proactivanet con SQL Server.

> **Alcance de este repositorio.** Aquí están solo los tableros: `dashboard.html`,
> las carpetas de cada pestaña, `handlers/`, `App_Code/`, `assets/` y algunos
> scripts en `sql/`. El ETL (`etl_proactivanet.py`, `descubrir_campos.py`,
> `generar_sql.py`, `01_esquema_proactivanet.sql`, `requirements.txt`,
> `config.ejemplo.json`), los scripts SQL base del tablero y los documentos
> `AUTENTICACION.md`, `CORREO_BACKLOG.md` y `CORREO_QA.md` viven en el
> repositorio de integración (Integracion_SQL-Proactivanet). Las secciones
> **Arquitectura**, **ETL**, **Base de datos**, **Instalación**,
> **Programación** y **Power BI** describen ese pipeline como contexto; sus
> archivos no están aquí.

## Arquitectura

```text
Proactivanet API
      ↓
etl_proactivanet.py
      ↓
stg.Tickets
      ↓
dbo.Tickets
      ↓
dbo.vw_Tickets
      ├── Power BI
      └── Tableros HTML / ASP.NET
```

El pipeline utiliza dos reportes de Proactivanet:

- **Backlog Soriana Total** — se utiliza para la carga inicial.
- **Backlog Soriana Últimos 3 días** — se utiliza para las cargas incrementales.

La carga inicial se ejecuta una vez con `--completa`. Después, el proceso
incremental mantiene actualizados los tickets modificados durante los últimos
3 días mediante UPSERT, evitando duplicados.

## Componentes principales

### ETL (repositorio de integración)

- `etl_proactivanet.py` — proceso principal de extracción y carga.
- `descubrir_campos.py` — valida el mapeo de campos contra la respuesta real de
  la API.
- `generar_sql.py` — genera el esquema SQL a partir de la definición de
  columnas.
- `01_esquema_proactivanet.sql` — crea los objetos principales de la base de
  datos.
- `requirements.txt` — dependencias de Python.

### Tableros web (este repositorio)

- `dashboard.html` / `dashboard.js` / `dashboard.css` — la página única con la
  barra lateral de pestañas: SLA y productividad, Backlog, Experiencia,
  Efectividad, Calidad de información (QA y QARE), Análisis de servicios,
  Observabilidad (Observabilidad y Orquestación) y Call Center.
- `backlog/`, `experiencia/`, `qa/`, `qare/`, `analisis/`, `orquestacion/` — cada pestaña
  embebida; también abren como página suelta.
- `assets/Tablero_Experiencia.html` — archivo generado (Observabilidad; su
  Orquestación y su Experiencia se esconden) que se muestra en Observabilidad dentro de un `<iframe>`;
  es una instantánea, no consulta SQL.
- `admin/` — Administración de iniciativas (`admin/iniciativas.html`, enlazada
  desde la barra lateral solo para cuentas autorizadas) y la consola de
  correos (`admin/admin.html`, sin enlace). Crear y modificar iniciativas y el
  alta de categorías **solo validan**: la persistencia no está implementada.
- `handlers/*.ashx` — endpoints ASP.NET utilizados por los tableros.
- `App_Code/` — código C# utilizado por IIS.
- `assets/` — piezas compartidas de JS/CSS y `vendor/` (Chart.js local).
- `Web.config.ejemplo` — plantilla de configuración de IIS.
- `tools/tests/` — pruebas de humo (node y C#); no se despliegan.

Los tableros funcionan en IIS con ASP.NET y no requieren Python en el servidor.

Qué pestaña lee datos en vivo, cuál muestra una instantánea o un respaldo y
qué fecha de actualización enseña cada una está en `DASHBOARD.md`, §2.4.

Para información detallada sobre el funcionamiento y despliegue de los
tableros, consulta `DASHBOARD.md`.

## Base de datos

El pipeline mantiene las siguientes estructuras principales:

- **`stg.Tickets`** — staging de los datos recibidos de la API.
- **`dbo.Tickets`** — tabla principal con el estado actual de los tickets.
- **`dbo.TicketsHist`** — historial de cambios de los tickets.
- **`dbo.EtlLog`** — bitácora de las ejecuciones del ETL.
- **`dbo.vw_Tickets`** — vista principal para consumo desde Power BI y otros
  clientes.

El proceso utiliza un hash `SHA2_256` para detectar cambios. Cuando un ticket
no cambia, no se actualiza innecesariamente. El proceso utiliza `UPDATE` +
`INSERT` en lugar de `MERGE`.

## Instalación

### 1. Dependencias

En la máquina que ejecutará el ETL:

```powershell
pip install -r requirements.txt
```

También se requiere **ODBC Driver 18 (o 17) for SQL Server**.

### 2. Base de datos

Ejecuta `01_esquema_proactivanet.sql` sobre la base de datos
`Tickets_Proactivanet`.

El script es idempotente y requiere SQL Server 2016 o superior.

### 3. Configuración

Utiliza `config.ejemplo.json` como plantilla y crea tu configuración local.

Las credenciales y tokens no deben almacenarse directamente en el repositorio.

El token de Proactivanet se proporciona mediante la variable de entorno:

```text
PVNET_API_TOKEN
```

En Windows puede definirse de forma persistente:

```powershell
setx PVNET_API_TOKEN "TU_TOKEN"
```

Después de definirla, cierra y vuelve a abrir la terminal para que la variable
esté disponible.

### 4. Validar el mapeo

Para comprobar que los campos recibidos por la API coinciden con los esperados:

```powershell
python descubrir_campos.py --config config.json
```

### 5. Carga inicial

La carga inicial utiliza el reporte completo:

```powershell
python etl_proactivanet.py --config config.json --completa
```

También puede descargarse primero la información sin cargarla a SQL Server:

```powershell
python etl_proactivanet.py --config config.json --completa --solo-extraer
```

### 6. Operación normal

Después de la carga inicial:

```powershell
python etl_proactivanet.py --config config.json
```

Esta ejecución utiliza el reporte incremental de los últimos 3 días.

## Programación

Solo el proceso incremental debe programarse de forma recurrente. La carga
completa se ejecuta manualmente una vez.

Puede utilizarse Windows Task Scheduler:

```text
python C:\etl\etl_proactivanet.py --config C:\etl\config.json
```

También puede utilizarse SQL Server Agent mediante un paso CmdExec.

Las ejecuciones quedan registradas en:

```text
logs/etl_proactivanet.log
```

y en:

```text
dbo.EtlLog
```

## Tableros en IIS

El sitio web utiliza ASP.NET y archivos `.ashx`. IIS compila la carpeta
`App_Code/` automáticamente; no existe un proyecto de Visual Studio ni es
necesario ejecutar `dotnet build`.

Para desplegar el tablero se necesitan, entre otros (lista completa en
`DASHBOARD.md`, §5):

```text
dashboard.html, dashboard.css, dashboard.js
assets/  backlog/  experiencia/  qa/  qare/  analisis/  admin/
handlers/
App_Code/
Web.config
```

`Web.config.ejemplo` sirve como plantilla. Debe copiarse como `Web.config` en
el servidor y configurarse con la conexión correspondiente a SQL Server.

`Web.config` no se almacena en el repositorio porque puede contener
información sensible.

Para los requisitos de IIS, permisos SQL, endpoints, despliegue y solución de
problemas, consulta:

```text
DASHBOARD.md
```

## Power BI

Power BI puede conectarse en modo **Import** a:

```text
dbo.vw_Tickets
```

La vista proporciona los campos derivados necesarios para el consumo del
histórico de tickets.

## Documentación adicional

En este repositorio:

- `DASHBOARD.md` — funcionamiento, origen de los datos, despliegue y
  troubleshooting de los tableros IIS.
- `experiencia/INSTALAR_EFECTIVIDAD.md`, `experiencia/INSTALAR_TICKETS_REDUCE.md`
  y `analisis/INSTALAR.md` — instalación de esas pestañas.
- `sql/PROPUESTA_*.md` — propuestas de base de datos **sin aprobar ni
  ejecutar**.

En el repositorio de integración: `AUTENTICACION.md`, `CORREO_BACKLOG.md` y
`CORREO_QA.md`.

## Seguridad

No subir al repositorio:

- `config.json`
- tokens de Proactivanet
- contraseñas
- `Web.config`
- logs
- archivos de respuestas o diagnóstico que puedan contener información
  sensible

Los archivos locales y configuraciones sensibles están excluidos mediante
`.gitignore`.

## Estructura general

```text
.
├── dashboard.html / dashboard.css / dashboard.js
├── dev-local.cmd          (IIS Express local)
├── admin/
├── analisis/
├── assets/
├── backlog/
├── experiencia/
├── observabilidad/        (página suelta, sin enlace; lee data/*.mock.json)
├── orquestacion/          (pestaña; lee handlers/orquestacion.ashx, vistas del sql/77)
├── qa/
├── qare/
├── handlers/              (*.ashx)
├── App_Code/
├── sql/
├── tools/                 (pruebas y utilidades; no se despliega)
├── Web.config.ejemplo
├── README.md
└── DASHBOARD.md
```
