# Acuse "Estoy trabajando en ello" de PO/SO — implementación y migración para aprobar

Estado:

- **Código hecho y probado** en `claude-branch`.
- **`sql/28_acuse_po_so.sql`: NO EJECUTADA, SIN APROBAR.** Hace falta tu OK
  explícito para correrla en la VM. Mientras no exista en la base, el sitio
  no muestra nada del acuse.
- No hay deploy a la VM ni merge a `main` sin aprobación aparte.

## 1. Decisiones (2026-10-22)

- Solo el PO o el SO asignado a la iniciativa acusa, cada uno en su rol. Los
  dos acuses son independientes.
- Solo entran quienes ya pasan la puerta de Admin (ADM/MOD). **No se da
  acceso nuevo.**
- Se puede acusar una iniciativa en **Atrasadas del semáforo**. No se usa la
  regla del KPI Atrasadas.
- El canal es una notificación persistente para ADM, dentro de la app. Esta
  vez no hay Teams, Power Automate, correo ni .ps1.
- El interruptor global de visibilidad de Iniciativas no se toca. En
  `claude-branch` no existe.

## 2. Identidad: cómo se resuelve

Cadena (código en `App_Code/AcuseIniciativa.cs`, `IdentidadAcuse`):

1. Cuenta de IIS (`AccesoAdmin.IdentidadEscritura`, la misma que firma toda
   escritura de Admin).
2. `IdentidadWindows.CorreoCandidato()`: quita el dominio y arma
   `cuenta@soriana.com`. Es lo mismo que ya hace la cabecera.
3. `dbo.CatPersona.Correo` (vigente; sin mayúsculas ni espacios). Se exige
   **exactamente una** fila. Si no hay ninguna: `no_encontrado`. Si hay más
   de una: `ambiguo`.
4. Además, **ninguna otra** fila de CatPersona puede tener el mismo nombre.
   Si la hay: `nombre_repetido`, porque el nombre del dueño no se podría
   atribuir a una sola persona.
5. La persona es dueña del rol si su nombre es igual a `OwnerProblem` (PO) u
   `OwnerServicio` (SO). La comparación ignora mayúsculas, acentos y
   espacios de más; es el criterio del diagnóstico (`COLLATE CI_AI`).

Del navegador solo llegan `folio` y `rol`. Todo se revalida en el servidor
en cada POST: identidad, que la iniciativa exista, que esté Atrasada y que
la persona sea dueña de **ese** rol. Después, la base vuelve a revisar el
dueño, el Estado y la **fecha compromiso** que evaluó el sitio dentro de la
transacción.

### Cobertura observada en la VM

Datos de `sql/diag_acuse_identidad_po_so.sql`, corrido por el usuario el
2026-10-22:

- **Usuarios ADM/MOD (6):** 2 se resuelven por `cuenta@soriana.com` y por
  `CorreoUsuario` (los dos coinciden):

  | Cuenta | Persona | Rol | Iniciativas activas |
  |---|---|---|---|
  | `SORIANA\jesuscamor` (MOD) | Jesus Campa Morones | PO | 12 |
  | `SORIANA\edgarrad` (ADM) | Edgar Ramos Davalos | SO | 10 |

  Los otros 4 (`t_andresvr`, `danielalc`, `omaralus`, `t_olgado`) no
  coinciden con ninguna persona: nunca ven el botón.
- **PO/SO de iniciativas activas:** los 20 nombres de PO y los 22 de SO
  tienen **exactamente una** persona con ese nombre en CatPersona. No hay
  ninguno `ambiguo` ni `no_encontrado`. 2 están resueltos y 40 son
  `sin_usuario_admin`: no entran a Admin.
- **No medido:** cuántas de esas 22 iniciativas están Atrasadas hoy.

### Supuestos y riesgos que quedan

- **El correo armado es de la persona.** `cuenta@soriana.com` se trata como
  el correo de quien inició sesión. Vale si el correo guardado en
  CatPersona es igual a la cuenta. Las cuentas `t_*` nunca coinciden. Para
  los dos casos de hoy está verificado.
- **Último eslabón por nombre.** Se compara el nombre de CatPersona con el
  nombre capturado del dueño. Ambos son datos del servidor; no es un nombre
  del navegador ni el `displayName` del usuario. Si alguno está mal escrito,
  la persona no puede acusar: falla cerrado, no abierto.
- **Depende de las cargas.** CatPersona y los dueños vienen del Excel o del
  ETL. Si cambian, cambia quién puede acusar, siempre según el dato vigente.
- **Alcance.** Hoy son 2 personas. Ampliarlo implica dar acceso a Admin, que
  es otra decisión.
- **Cambio de fecha entre la revisión y el guardado (cerrado).** El sitio
  manda la fecha compromiso del Estado tal como la vio la lista
  (`f_analisis`, `f_solucion` o `f_cierre`; son `dbo.Problem.FechaAnalisis`,
  `FechaSolucion` y `FechaCierre`). La base la compara, con la fila
  bloqueada, contra la de ese momento. Si cambió, error 51308 y no se guarda
  ni acuse ni aviso. NULL solo coincide con NULL.
- **Lo que no se revalida en la base.** Que la iniciativa siga Atrasada por
  la fecha **propia de una categoría** (`FechaAnalisisCategoria`). Esa regla
  la decide el sitio con la lista, igual que el semáforo; la base no la
  recalcula, porque eso sería una segunda regla de vencidas. Si alguien
  cambia solo esa fecha de categoría en el instante entre la revisión y el
  guardado, el acuse queda registrado con la fecha de la iniciativa, que no
  cambió. No cambia ningún dato de la iniciativa.
- **Costo del POST.** El POST relee el registro completo
  (`ExperienciaQueries.RegistroIniciativas`) para usar exactamente la misma
  regla del semáforo. Es lo mismo que cuesta abrir la página, solo en un
  clic poco frecuente.

## 3. Qué hace la aplicación

- **Detalle de la iniciativa** (`admin/acuse-iniciativa.js`, `AcuseDetalle`):
  - Si tú eres el PO y/o el SO y está Atrasada: botón "Estoy trabajando en
    ello (Product Owner / Service Owner)", uno por rol.
  - Si ya acusaste ese rol para la fecha compromiso actual: "Registraste que
    estás trabajando en ella … el dd/mm hh:mm".
  - Tras enviar: "Registrado" o "Ya estaba registrado".
  - Se ve la lista de acuses de la iniciativa.
  - Doble clic = un solo envío.
- **Administración → "Avisos de los dueños"** (solo ADM, `VistaAvisosAcuse`):
  - Muestra la persona, el rol, la cuenta, la hora, la fecha compromiso y la
    marca Nuevo/Leído; "Ver" abre el detalle.
  - **Cargar la lista no marca nada.** "Marcar como leído" es explícito y
    por administrador.
- **Handler** `handlers/admin_iniciativas_acuse.ashx`. Va detrás de
  `AccesoAdmin` por su prefijo: `mio`, `iniciativa` y `acusar` piden ADM o
  MOD; `bandeja` y `leida` solo ADM.
- **Sin sql/28:** los GET responden `disponible: false` y el POST responde
  501. No se pinta nada.

## 4. Migración final para aprobar: `sql/28_acuse_po_so.sql`

**No altera nada existente.** Solo lee `dbo.Problem`. No depende de las
migraciones 22–27.

### Tablas

| Tabla | Columnas | Reglas |
|---|---|---|
| `adm.AcuseIniciativa` | `IdAcuse` int IDENTITY PK; `Codigo` nvarchar(100) con la collation de `dbo.Problem.Codigo` y FK a `dbo.Problem`; `Rol` char(2) PO/SO; `Cuenta` nvarchar(256); `NombreDueno` nvarchar(4000); `FuenteIdentidad` varchar(16) = `CORREO_CANDIDATO`; `EstadoIniciativa` nvarchar(100); `FechaCompromiso` date NULL; `FechaUtc` datetime2(0) | **UNIQUE (Codigo, Rol, Cuenta, FechaCompromiso)**; NULL cuenta como un episodio más. Índice (Codigo, FechaUtc DESC). |
| `adm.NotificacionAdm` | `IdNotificacion` IDENTITY PK; `Tipo` 'ACUSE'; `IdAcuse` FK; `FechaUtc` | **UNIQUE (IdAcuse)**: una notificación por acuse. Índice (FechaUtc DESC, Id DESC). |
| `adm.NotificacionLectura` | `IdNotificacion` FK; `Usuario` nvarchar(256); `LeidaUtc` | PK (IdNotificacion, Usuario): leída por cada ADM. |

### Procedimientos

**`adm.usp_Acuse_Registrar`**

- Parámetros:
  - `@Usuario`: lo pone el servidor.
  - `@Codigo`, `@Rol`.
  - `@NombreDueno`, `@EstadoIniciativa`: lo que vio el sitio.
  - `@FechaCompromiso` date (NULL = sin fecha): la fecha del Estado que
    evaluó el sitio. Es obligatoria, sin valor por omisión: quien llama
    siempre la manda.
  - `@FuenteIdentidad`.
  - Salidas: `@IdAcuse`, `@Nuevo`, `@FechaUtc`.
- En una transacción, con `UPDLOCK, HOLDLOCK` sobre la fila de `dbo.Problem`:
  1. Exige que la iniciativa exista y esté vigente (51304).
  2. Exige que el dueño del rol siga siendo el mismo (51305) y el Estado
     también (51306).
  3. Toma la fecha compromiso del Estado actual: En Análisis →
     FechaAnalisis, En Solución → FechaSolucion, En Monitoreo → FechaCierre.
  4. Exige que sea la que mandó el sitio (51308). NULL solo coincide con
     NULL; la comparación es explícita para que un NULL nunca la deje pasar
     como UNKNOWN.
  5. Si ya hay acuse del mismo episodio, lo devuelve con `@Nuevo = 0`.
  6. Si no, inserta el acuse y su notificación.
- Otros errores: 51301 sin usuario, 51302 rol, 51303 sin dueño.

**`adm.usp_Notificacion_MarcarLeida`**

- Parámetros: `@Usuario`, `@IdNotificacion`; salida `@Nueva`.
- Es idempotente: si ya estaba leída, no hace nada.
- Errores: 51307 la notificación no existe; 51301 sin usuario.

### Permisos

- La cuenta del sitio (PROACTIVANETAD) ya lee (`db_datareader`) y ya
  ejecuta en `adm` (de sql/18). **No hace falta ningún GRANT.**
- **DENY INSERT, UPDATE, DELETE** sobre las 3 tablas: 9 permisos. Sin eso,
  `db_datawriter` le dejaría escribirlas a mano.
- Va dentro de sql/28 y su postcondición los cuenta.

### Cómo correrla

```sql
EXEC sys.sp_set_session_context N'aprobar_migracion', N'28';
```

Después, el script completo, en una sola transacción. Si los objetos ya
existen (completos o a medias), se niega sin tocar nada.

**Orden:** se puede aplicar antes o después del despliegue del sitio. El
sitio la detecta en ejecución (`AlmacenAcusesSql.Disponible`) y sin ella
muestra la función apagada.

### Rollback: `sql/28_acuse_po_so_rollback.sql`

- Se niega si hay filas, salvo con
  `rollback_28_perder_acuses = SI`. **Los acuses, las notificaciones y las
  lecturas se pierden:** respáldalos antes (los SELECT están en el
  encabezado del script).
- Quita los 2 procedimientos y las 3 tablas; los DENY se van con ellas.
- No toca nada anterior. El sitio vuelve solo a "no disponible".

## 5. Pruebas ejecutadas (2026-10-22)

- **LocalDB desechable**, `tools/tests/AcuseIniciativaSqlLocalDbSmoke.cs`:
  **30/30**. Cubre:
  - guarda en otra base;
  - detección antes y después;
  - 5 objetos y 9 DENY;
  - reaplicar no toca nada;
  - acuse nuevo y duplicado (incluso con la cuenta en otras mayúsculas);
  - PO y SO por separado;
  - nuevo episodio y fecha NULL;
  - errores 51301 a 51308;
  - **regresión de la carrera**: la fecha compromiso cambia entre la
    evaluación y el envío (foto 05/10, base 20/10) → 51308, sin acuse ni
    aviso; NULL contra fecha y fecha contra NULL → 51308; con la foto igual
    vuelve a pasar y `dbo.Problem` queda igual;
  - `dbo.Problem` sin cambios (huella de la fila completa);
  - **8 envíos concurrentes = 1 acuse y 1 notificación**;
  - PROACTIVANETAD no escribe a mano (229);
  - leído/no leído por ADM, y listar no marca;
  - rollback que se niega con datos, que limpia con la bandera, y reaplicar.
- **Sin SQL**, `tools/tests/AcuseIniciativaHttpSmoke.cs`: **41/41**. Cubre:
  - la identidad: un correo, ambiguo, homónimo, `t_*`, dominio distinto,
    acentos, mayúsculas y espacios;
  - VIEWER 403; MOD sin bandeja;
  - sin sql/28 (GET apagado, POST 501);
  - roles de `mio`;
  - el PO no acusa como SO ni al revés;
  - ADM no dueño 403;
  - no Atrasada, sin control de fecha → 409;
  - campos `cuenta`/`usuario`/`nombre` del formulario ignorados;
  - duplicado;
  - error de la base (51305 y 51308) → 409;
  - la fecha que se manda es la del Estado de la lista (Análisis,
    Solución o Monitoreo; sin fecha, cerrada o inválida = NULL);
  - bandeja por ADM, y listar no marca.
- **JS** `tools/tests/AcuseIniciativaSmoke.js`: **25/25**.
  `RegistroIniciativasSmoke` +2 (AC1–AC2): 524/524.
- **Navegador** (banco local con un stub de fetch, sin SQL): botones en
  una Atrasada, registro, confirmación, bandeja de ADM y "Marcar como leído".

## 6. Lo que falta para encenderlo

1. Tu OK y correr `sql/28_acuse_po_so.sql` en la VM.
2. Llevar `claude-branch` a `main` (PR) y desplegar en la VM.
3. Prueba real con `SORIANA\jesuscamor` (PO) o `SORIANA\edgarrad` (SO) en una
   iniciativa suya que esté Atrasada, y que un ADM lo vea en "Avisos de los
   dueños".
