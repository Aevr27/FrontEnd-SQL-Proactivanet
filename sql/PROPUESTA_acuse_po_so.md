# PROPUESTA: acuse "Estoy trabajando en ello" de PO/SO (NO EJECUTADA, SIN APROBAR)

Estado: **propuesta para revisión**. Nada de esto existe en la base ni en el
sitio. Es Markdown a propósito, para que nadie lo corra por error como
script. Ningún DDL/DML se ejecuta sin el OK explícito del dueño del proyecto.

Decisiones ya aprobadas (2026-10-22):

- Solo el PO o el SO asignado a la iniciativa acusa, cada uno en su rol. Los
  dos acuses son independientes.
- No se da acceso nuevo: solo entran quienes ya pasan la puerta de Admin
  (ADM/MOD en `dbo.UsuariosAdmin`).
- Puede acusar una iniciativa que esté en **Atrasada del semáforo** (no se
  usa la regla del KPI Atrasadas).
- El canal es una notificación persistente dentro de la app, para ADM. Esta
  vez no hay Teams, Power Automate, correo, webhooks ni .ps1.
- Antes de cualquier migración, esta propuesta se revisa y se aprueba.

## 1. Hallazgos (auditados en el código, 2026-10-22)

**Identidad.**
- La única identidad es `HttpContext.User.Identity.Name` de IIS (Negotiate),
  en `App_Code/IdentidadWindows.cs`. `Original` (`DOMINIO\cuenta`) es la
  identidad de seguridad.
- No hay ninguna consulta al directorio activo en el sitio (sin
  `System.DirectoryServices`, sin LDAP).
- Desde el equipo de desarrollo no hay dominio, así que no se pudo probar
  si el App Pool de la VM puede consultar AD.

**PO/SO de una iniciativa.**
- Son texto con un nombre: `dbo.Problem.OwnerProblem` y `OwnerServicio`, los
  mismos `po_capturado` y `so_capturado` del registro.
- No existe ninguna columna ni tabla que los relacione con una cuenta.

**Cadenas automáticas que ya existen:**
- a) `IdentidadWindows.CorreoCandidato` (`cuenta@soriana.com`) contra
  `dbo.CatPersona.Correo`, en `DirectorioPersonas`. **No es fiable:** es un
  candidato, las cuentas `t_*` no coinciden con el correo y en la VM "casi
  nunca resuelve" (nota del 2026-10-19).
- b) `dbo.UsuariosAdmin.Usuario` → `CorreoUsuario` (guardado por ADM, ya se
  lee en `App_Code/CorreoAdmin.cs`) → `CatPersona.Correo` → `CatPersona.Nombre`
  → igual al nombre capturado.
  - Cubre justo a quienes pueden entrar (ADM/MOD).
  - **No se ha medido con datos reales:** hay que ver cuántos tienen
    `CorreoUsuario`, si su correo está en `CatPersona` y si el nombre coincide
    con el capturado.
  - Lo mide `sql/diag_acuse_identidad_po_so.sql` (solo lectura). Lo validé en
    LocalDB con datos de prueba; falta correrlo en la VM.

**Último eslabón inevitable.** En b) (y en cualquier cadena de directorio) el
último paso compara dos nombres guardados en catálogos del servidor
(`CatPersona.Nombre` y `OwnerProblem`). Nunca es un nombre que mande el
navegador ni el `displayName` del usuario. Si no hay coincidencia, o si hay
más de una persona con ese nombre, la respuesta es "no autorizado": falla
cerrado. Aun así, es una autorización que depende de que los nombres estén
bien escritos (hay acentos corruptos de origen). **Este riesgo se acepta o
no explícitamente.**

**Elegibilidad.**
- La regla "Atrasada" del semáforo ya existe en el servidor:
  `ExperienciaQueries.Semaforo` + `ExperienciaRegistro.RegistroIniciativas()`
  (`activa`, `control_fecha`, `fecha_retrasada`).
- `semaforoFecha` de `admin/registro-iniciativas.js` lee los mismos datos.
- El acuse la **reusa**, no la recalcula.

**Notificaciones.**
- No hay ninguna tabla de notificaciones en la app ni una convención de
  leído/no leído.
- `dbo.AvisoProblemsEnvio` es la bandeja de un .ps1 de correo, con otro
  propósito y otra forma (no tiene leído/no leído ni ligas a eventos). **No se
  reusa.**

**Interruptor global de visibilidad de Iniciativas.** No existe en
`claude-branch` (lo busqué en `Web.config`, `App_Code` y `admin/`). Este
trabajo no lo crea ni lo toca.

## 2. Decisión de identidad pendiente (se detiene aquí)

Hoy no hay una resolución automática **verificada**. Lo que sigue, en orden:

1. Correr en la VM `sql/diag_acuse_identidad_po_so.sql`. Si en la
   sección 3 la mayoría de los PO/SO de iniciativas activas salen
   `resuelto`, la cadena b) sirve. Los casos `ambiguo` y `no_encontrado`
   simplemente no podrán acusar.
2. Si AD es la fuente preferida: probar en la VM, con la cuenta del App
   Pool, `UserPrincipal.FindByIdentity(ctx, IdentityType.SamAccountName,
   cuenta)`. Sirve si `EmailAddress` existe y coincide con
   `CatPersona.Correo`. Reemplazaría el paso `CorreoUsuario` por un dato del
   directorio. Hoy no hay código ni permiso verificado para esto.
3. Si ninguna de las dos alcanza, la **alternativa** es una tabla de mapeo
   mantenida por ADM (sección 3.4). **No se usa sin aprobarla**, y no
   reemplaza en silencio a las otras.

El esquema de abajo no depende de cuál se elija: guarda la cuenta, el
nombre con el que se autorizó y la fuente.

## 3. Migración propuesta: `sql/28_acuse_po_so.sql` (borrador)

Mismo patrón que 22–27: guarda de base, precondición, una sola
transacción, postcondición y `_rollback.sql`. **No crea ni altera nada
existente.** Solo depende de `dbo.Problem (Codigo)` y del esquema `adm`.

### 3.1 Tablas

```sql
-- Un acuse = (iniciativa, rol, cuenta, fecha compromiso vencida).
CREATE TABLE adm.AcuseIniciativa (
    IdAcuse          int IDENTITY(1,1) NOT NULL CONSTRAINT PK_AcuseIniciativa PRIMARY KEY,
    Codigo           nvarchar(100) COLLATE <la de dbo.Problem.Codigo> NOT NULL
                     CONSTRAINT FK_AcuseIniciativa_Problem REFERENCES dbo.Problem (Codigo),
    Rol              char(2)       NOT NULL CONSTRAINT CK_AcuseIniciativa_Rol CHECK (Rol IN ('PO', 'SO')),
    Cuenta           nvarchar(256) NOT NULL CONSTRAINT CK_AcuseIniciativa_Cuenta CHECK (LEN(LTRIM(RTRIM(Cuenta))) > 0),
                     -- IdentidadWindows.Original, la de IIS; nunca la del navegador
    NombreDueno      nvarchar(4000) NOT NULL,   -- OwnerProblem/OwnerServicio con el que se autorizo (foto)
    FuenteIdentidad  varchar(16)   NOT NULL
                     CONSTRAINT CK_AcuseIniciativa_Fuente CHECK (FuenteIdentidad IN ('CORREO_USUARIO', 'DIRECTORIO', 'MAPEO_ADM')),
    EstadoIniciativa nvarchar(100) NOT NULL,    -- foto del Estado al acusar
    FechaCompromiso  date          NOT NULL,    -- la fecha vencida del estado (Atrasada siempre la tiene)
    FechaUtc         datetime2(0)  NOT NULL CONSTRAINT DF_AcuseIniciativa_Fecha DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT UQ_AcuseIniciativa UNIQUE (Codigo, Rol, Cuenta, FechaCompromiso)
);
CREATE INDEX IX_AcuseIniciativa_Codigo ON adm.AcuseIniciativa (Codigo, FechaUtc DESC);

-- Una notificacion para ADM por acuse (UNIQUE: nunca dos por el mismo acuse).
CREATE TABLE adm.NotificacionAdm (
    IdNotificacion int IDENTITY(1,1) NOT NULL CONSTRAINT PK_NotificacionAdm PRIMARY KEY,
    Tipo           varchar(10) NOT NULL CONSTRAINT CK_NotificacionAdm_Tipo CHECK (Tipo IN ('ACUSE')),
    IdAcuse        int NOT NULL CONSTRAINT FK_NotificacionAdm_Acuse REFERENCES adm.AcuseIniciativa (IdAcuse),
    FechaUtc       datetime2(0) NOT NULL CONSTRAINT DF_NotificacionAdm_Fecha DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT UQ_NotificacionAdm_Acuse UNIQUE (IdAcuse)
);
CREATE INDEX IX_NotificacionAdm_Fecha ON adm.NotificacionAdm (FechaUtc DESC);

-- Leida = hay fila, por usuario ADM. Cargar la lista NO marca nada.
CREATE TABLE adm.NotificacionLectura (
    IdNotificacion int NOT NULL CONSTRAINT FK_NotificacionLectura_Notif REFERENCES adm.NotificacionAdm (IdNotificacion),
    Usuario        nvarchar(256) NOT NULL,
    LeidaUtc       datetime2(0)  NOT NULL CONSTRAINT DF_NotificacionLectura_Fecha DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT PK_NotificacionLectura PRIMARY KEY (IdNotificacion, Usuario)
);
```

Cómo responde cada regla:

- **PO y SO independientes:** son filas distintas (`Rol`). Si una persona es
  PO y SO de la misma iniciativa, son dos acuses, cada uno pedido
  explícitamente.
- **Idempotencia:** `UQ_AcuseIniciativa`. Un doble clic o un reintento de
  red con la misma fecha vencida devuelve el acuse existente y no crea otro
  acuse ni otra notificación (`UQ_NotificacionAdm_Acuse`). Si la iniciativa
  vence otra vez con **otra** fecha compromiso, es otro episodio y se puede
  acusar de nuevo. Ese es el único "reacuse" permitido.
- **Leído/no leído:** se guarda por ADM, porque cada administrador lleva su
  bandeja. Solo una acción explícita ("Marcar como leída") inserta la fila;
  listar no la inserta.
- **El contenido no se duplica:** iniciativa, persona, rol y hora salen de
  la unión con `AcuseIniciativa`. El título sale del registro vivo.

### 3.2 Procedimientos (las únicas escrituras)

```sql
adm.usp_Acuse_Registrar
    @Usuario nvarchar(256),          -- IdentidadWindows.Original (lo pone el servidor)
    @Codigo nvarchar(100), @Rol char(2),
    @NombreDueno nvarchar(4000), @FuenteIdentidad varchar(16),
    @EstadoIniciativa nvarchar(100), @FechaCompromiso date,
    @IdAcuse int OUTPUT, @Nuevo bit OUTPUT
```

Qué hace, en una sola transacción:

1. Bloquea la fila de `dbo.Problem` (`UPDLOCK, HOLDLOCK`) y **revalida en la
   base** que la iniciativa exista y esté vigente.
2. Revalida que `OwnerProblem` / `OwnerServicio` (según `@Rol`) siga siendo
   exactamente `@NombreDueno`, que `Estado` siga siendo `@EstadoIniciativa` y
   que la fecha del estado siga siendo `@FechaCompromiso`. Si algo cambió
   entre la revisión del sitio y el guardado: error 5130x, nada se guarda.
3. Si el acuse ya existe: `@Nuevo = 0` y devuelve el existente.
4. Si no existe: inserta el acuse y su notificación.

No toca ninguna columna de `dbo.Problem` ni de `ProblemCategoria`.

```sql
adm.usp_Notificacion_MarcarLeida @Usuario nvarchar(256), @IdNotificacion int
```

Idempotente: si ya está leída, no hace nada.

Las lecturas (bandeja de ADM, acuses del detalle) se hacen con `SELECT`
sobre las tres tablas, como ya hace la cuenta del sitio con
`adm.IniciativaProtegida`.

### 3.3 Permisos y despliegue

- A la cuenta del sitio (PROACTIVANETAD):
  - `GRANT EXECUTE` sobre los 2 procedimientos.
  - `GRANT SELECT` sobre las 3 tablas.
  - `DENY INSERT, UPDATE, DELETE` sobre las 3 tablas, igual que sql/18
    sección 8: nada se escribe por fuera de los procedimientos.
- **Orden:** sql/28 no depende de 22–27 ni los cambia. Se puede aplicar
  antes o después del sitio nuevo.
- **Interruptor:** el sitio detecta la migración en ejecución (como
  `DeteccionSql26`). Sin las tablas, el acuse no aparece y el handler
  responde `sin_tabla`. No hace falta encender nada a mano.
- **Handler:** `handlers/admin_iniciativas_acuse.ashx`. Por su prefijo
  queda detrás de `AccesoAdmin`, así que solo entran ADM/MOD y no se abre
  acceso nuevo.
  - **POST** recibe solo `folio` y `rol`. El servidor:
    1. toma la cuenta de IIS;
    2. resuelve a la persona con la fuente aprobada;
    3. lee la iniciativa con `RegistroIniciativas()`, exige Atrasada del
       semáforo y exige que el nombre del dueño de ese rol sea el de la
       persona;
    4. llama a `usp_Acuse_Registrar`.
  - **GET** de la bandeja y **POST** de marcar como leída: solo ADM
    (`ExigirAdm`).

### 3.4 Alternativa, solo si la identidad automática no alcanza (NO aprobada)

```sql
CREATE TABLE adm.PersonaCuenta (
    Cuenta  nvarchar(256) NOT NULL CONSTRAINT PK_PersonaCuenta PRIMARY KEY,   -- DOMINIO\cuenta
    Nombre  nvarchar(255) NOT NULL,   -- tal cual en OwnerProblem / OwnerServicio
    Vigente bit NOT NULL CONSTRAINT DF_PersonaCuenta_Vigente DEFAULT (1),
    AltaPor nvarchar(256) NOT NULL,
    AltaUtc datetime2(0)  NOT NULL CONSTRAINT DF_PersonaCuenta_Alta DEFAULT (SYSUTCDATETIME())
);
```

ADM la mantendría (alta y baja con su procedimiento). Con ella,
`FuenteIdentidad = 'MAPEO_ADM'`.

### 3.5 Rollback (`sql/28_acuse_po_so_rollback.sql`)

- Se niega si existe algún acuse o notificación, salvo con una bandera
  explícita (`@BorrarAcusesYNotificaciones = 1`). Esos datos son historia que
  no se puede reconstruir.
- Antes de borrar, sugiere exportar las 3 tablas.
- Con la bandera: quita permisos, procedimientos y las tablas en orden
  (`NotificacionLectura` → `NotificacionAdm` → `AcuseIniciativa`).
- No toca nada que existía antes. Sin las tablas, el sitio vuelve solo a
  "sin acuse".
- No hay historia anterior que migrar: hoy no existen acuses.

## 4. Pruebas que se harán al implementar (después de la aprobación)

- **LocalDB desechable** (como `CambiosRecientesSqlLocalDbSmoke`):
  - el PO acusa en su rol y el SO por separado;
  - el SO no puede acusar como PO;
  - una cuenta ajena es rechazada;
  - no elegible es rechazado;
  - doble envío: 1 acuse y 1 notificación;
  - el dueño o el estado cambia a mitad: nada se guarda;
  - leído/no leído por ADM, y listar no marca;
  - `dbo.Problem` sin cambios (hash de la fila antes y después);
  - la cuenta del sitio no escribe directo (229).
- **Handler sin SQL** (como `CambiosRecientesHttpSmoke`):
  - MOD/ADM entra, VIEWER recibe 403;
  - el `folio`, `rol` o cuenta que manda el navegador no sustituyen la
    identidad;
  - solo ADM ve la bandeja.
- **JS** (registro): el botón aparece solo con Atrasada y siendo el dueño
  de ese rol; tiene confirmación visible; no cambia el semáforo ni las
  cifras.
