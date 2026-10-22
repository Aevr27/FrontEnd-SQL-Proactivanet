# PROPUESTA: acuse "Estoy trabajando en ello" de PO/SO (NO EJECUTADA, SIN APROBAR)

Estado: **auditoría + propuesta**. No hay código, tabla ni flujo de esto en
ninguna parte. Este es un archivo Markdown a propósito, para que nadie lo
corra por error como script. Ningún DDL/DML se ejecuta sin el OK explícito
del dueño del proyecto (aviso previo: qué cambia, riesgo, rollback).

## 1. Qué existe hoy (auditado 2026-10-22)

| Pieza | Estado |
|---|---|
| Botón / acción de acuse en el detalle o la tarjeta | **No existe** (ni oculto ni a medias: no hay texto, handler, ruta ni dato). |
| Persistencia de acuses | **No existe**. Ninguna tabla `adm.*` ni `dbo.*` del volcado `esquema_bd/` la cubre. |
| Integración Teams / Power Automate / webhooks | **No existe** en este repo, en `backend_admin_persistencia`, `Iniciativas` ni `Proactivanet-Data-Transfer`. |
| Patrón de aviso que sí existe | `dbo.AvisoProblemsEnvio` + `dbo.usp_AvisoProblems_Pendientes / _Reservar / _Confirmar`: una bandeja de salida que un **.ps1** externo lee, reserva y confirma (correo de vencidas al PO). El .ps1 no está en ningún repo accesible; no se pudo verificar cómo envía. |
| Identidad del usuario | Cuenta Windows (`DOMINIO\usuario`) del sitio; rol de `dbo.UsuariosAdmin` (`Usuario`, `CorreoUsuario`, `Acceso` ADM/MOD). Sin rol = VIEWER = 403 en todo Admin (`AccesoAdmin`, prefijo `admin_iniciativas_`). |
| Quién es el PO / SO de una iniciativa | **Texto con un nombre**: `dbo.Problem.OwnerProblem / OwnerServicio` (capturados) y `dbo.CatCategoriaDueno.ProductOwner / ServiceOwner` (de la categoría). **No hay ninguna relación nombre ↔ cuenta Windows.** `dbo.CatPersona` (Nombre, Correo) existe, pero no tiene cuenta; derivar correo o cuenta del nombre está prohibido (convención de correos con excepciones). |
| Regla de "vencida" | Dos reglas reales: `fecha_retrasada` (semáforo: fecha compromiso del estado vencida, solo activas con control de fecha) y el KPI Atrasadas (`seguimiento`, `retrazado > 0`, con categoría). |

Conclusión: no se puede autorizar en el servidor "solo el PO/SO de esta
iniciativa" porque la base no sabe qué cuenta es qué persona. Implementarlo
sin eso sería adivinar la identidad.

## 2. Decisiones abiertas (del dueño del proyecto)

1. **Identidad PO/SO ↔ cuenta.** Opciones:
   - a) Tabla nueva `adm.PersonaCuenta (Cuenta, Nombre)` mantenida por ADM
     (explícita y auditable). Recomendada.
   - b) Leer el `displayName`/`mail` del directorio activo de la cuenta y
     compararlo con el nombre capturado. Depende de permisos LDAP del App
     Pool en la VM y de que los nombres coincidan exactos (hay acentos
     corruptos en datos importados).
   - c) Agregar una columna de cuenta a `dbo.CatPersona`. Choca con el
     ETL que la carga desde el Excel.
2. **Qué PO/SO cuenta:** el capturado en la iniciativa (`OwnerProblem` /
   `OwnerServicio`, recomendado: es el de la columna del registro) o
   también los de sus categorías.
3. **Acceso de PO/SO sin rol ADM/MOD:** hoy no entran a Admin. Hay que
   decidir si se les da un handler fuera del prefijo `admin_iniciativas_`
   (solo ese acuse) o un rol nuevo en `UsuariosAdmin`.
4. **Regla de "vencida":** `fecha_retrasada` (semáforo) o el KPI Atrasadas.
5. **Canal del aviso a ADM:** solo en la aplicación, una bandeja de
   salida + flujo de Power Automate que la lea (lo tendría que crear
   quien administre Power Automate), o reusar el .ps1 de AvisoProblems.

## 3. Diseño propuesto (con 1a, 2 capturado, 4 semáforo, 5 bandeja)

Comportamiento:

- PO y SO acusan **por separado**: una fila por (iniciativa, rol, cuenta).
- **Idempotente:** volver a pulsar no crea otro acuse ni otro aviso. Se
  responde "ya registrado el dd/mm hh:mm". El reacuse deliberado queda
  fuera del primer corte.
- El acuse **no cambia nada** de la iniciativa (estado, fechas, dueños, %,
  volumetría, semáforo). No es prueba de avance.
- El acuse se guarda primero. El aviso es una fila en la bandeja, **en la
  misma transacción**, así que un Teams caído no pierde el acuse, y el flujo
  marca la fila como enviada (reservar/confirmar, como AvisoProblems).
- ADM lo ve en el detalle de la iniciativa (sección "Acuses") y en la cola.

Esquema (borrador, **no ejecutar**):

```sql
CREATE TABLE adm.PersonaCuenta (
    Cuenta    nvarchar(256) NOT NULL CONSTRAINT PK_PersonaCuenta PRIMARY KEY,  -- DOMINIO\usuario
    Nombre    nvarchar(255) NOT NULL,                                          -- tal cual en Problem.OwnerProblem/OwnerServicio
    Vigente   bit NOT NULL CONSTRAINT DF_PersonaCuenta_Vigente DEFAULT (1),
    AltaPor   nvarchar(256) NOT NULL,
    AltaUtc   datetime2(0)  NOT NULL CONSTRAINT DF_PersonaCuenta_Alta DEFAULT (SYSUTCDATETIME())
);

CREATE TABLE adm.AcuseIniciativa (
    IdAcuse    int IDENTITY(1,1) NOT NULL CONSTRAINT PK_AcuseIniciativa PRIMARY KEY,
    Codigo     nvarchar(100) NOT NULL CONSTRAINT FK_AcuseIniciativa_Problem REFERENCES dbo.Problem (Codigo),
    Rol        char(2)       NOT NULL CONSTRAINT CK_AcuseIniciativa_Rol CHECK (Rol IN ('PO', 'SO')),
    Cuenta     nvarchar(256) NOT NULL,
    Nombre     nvarchar(255) NOT NULL,   -- el nombre con el que se autorizo (foto)
    FechaUtc   datetime2(0)  NOT NULL CONSTRAINT DF_AcuseIniciativa_Fecha DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT UQ_AcuseIniciativa UNIQUE (Codigo, Rol, Cuenta)   -- idempotencia
);

CREATE TABLE adm.AvisoAcuse (                -- bandeja de salida
    IdAcuse      int NOT NULL CONSTRAINT PK_AvisoAcuse PRIMARY KEY
                 CONSTRAINT FK_AvisoAcuse_Acuse REFERENCES adm.AcuseIniciativa (IdAcuse),
    Estado       varchar(10) NOT NULL CONSTRAINT DF_AvisoAcuse_Estado DEFAULT ('PENDIENTE')
                 CONSTRAINT CK_AvisoAcuse_Estado CHECK (Estado IN ('PENDIENTE', 'RESERVADO', 'ENVIADO', 'FALLIDO')),
    Intentos     int NOT NULL CONSTRAINT DF_AvisoAcuse_Intentos DEFAULT (0),
    ReservadoUtc datetime2(0) NULL, EnviadoUtc datetime2(0) NULL, UltimoError nvarchar(2000) NULL
);
-- adm.usp_Acuse_Registrar @Usuario, @Codigo, @Rol: valida en la base que la
--   cuenta mapee (PersonaCuenta vigente) al OwnerProblem/OwnerServicio de la
--   iniciativa y que este vencida; inserta acuse + aviso en una transaccion;
--   si ya existe (UQ), devuelve el existente sin insertar nada.
-- adm.usp_AvisoAcuse_Reservar / _Confirmar: para el flujo (como AvisoProblems).
-- Permisos: EXECUTE a la cuenta del sitio; DENY de escritura directa (como sql/18).
```

Orden y rollback: script `sql/28_acuse_po_so.sql` con guarda de base,
precondición de hashes, transacción y postcondición, igual que 22–27. El
rollback (`_rollback.sql`) se niega si ya hay acuses (no borra historia sin
bandera explícita). No toca objetos existentes: no hay riesgo para los
procedimientos desplegados. No hay historia que migrar: no existían acuses.

Contenido del aviso: código, título, quién acusó (nombre y cuenta), rol
PO/SO, hora (UTC y México) y liga al registro
(`admin/iniciativas.html#folio=...` si se agrega ese ancla: hoy la página
no abre un folio por URL).

## 4. Qué queda fuera hasta decidir

Código del handler, la UI y el flujo de Power Automate: se construyen sobre
1–5. Sin la decisión 1, cualquier autorización en el servidor sería
inventada.
