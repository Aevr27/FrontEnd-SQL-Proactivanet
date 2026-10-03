# PROPUESTA — número de solicitud de Admin (NO EJECUTADA, SIN APROBAR)

Estado: **propuesta**. Nada de esto existe en la base. No ejecutar sin el OK
explícito del dueño del proyecto. Es Markdown a propósito: no se puede correr
por error como script.

## Por qué hace falta un objeto en la base

El número `#0000001…` debe ser generado por el servidor, consecutivo,
persistente, seguro ante concurrencia y no reiniciarse. Sin almacén en la
base no hay forma segura:

- contador en memoria: se reinicia con el App Pool y se duplica entre procesos;
- archivo: se pierde/pisa en un despliegue y no queda ligado a la solicitud;
- `dbo.Problem.Codigo`: es otra cosa (código de la iniciativa).

Hoy el sitio usa `GeneradorNumeroSolicitudPendiente`: valida y responde
`numero_solicitud: null` con `numero_pendiente`.

## Diseño propuesto

Número y solicitud en **la misma transacción**: si el alta falla, el número no
se consume (sin huecos permanentes).

```sql
-- 1) Esquema (solo si no existe)
CREATE SCHEMA adm;

-- 2) Contador de una sola fila
CREATE TABLE adm.ContadorSolicitud
(
    Id     tinyint NOT NULL CONSTRAINT PK_ContadorSolicitud PRIMARY KEY
                            CONSTRAINT CK_ContadorSolicitud_Id CHECK (Id = 1),
    Ultimo int     NOT NULL CONSTRAINT CK_ContadorSolicitud_Ultimo CHECK (Ultimo BETWEEN 0 AND 9999999)
);
INSERT adm.ContadorSolicitud (Id, Ultimo) VALUES (1, 0);

-- 3) La solicitud (columnas = lo que hoy valida el servidor)
CREATE TABLE adm.Solicitud
(
    NumeroSolicitud  int            NOT NULL CONSTRAINT PK_Solicitud PRIMARY KEY
                                             CONSTRAINT CK_Solicitud_Numero CHECK (NumeroSolicitud BETWEEN 1 AND 9999999),
    TipoIniciativa   nvarchar(100)  NOT NULL,
    ProductOwner     nvarchar(255)  NOT NULL,
    ServiceOwner     nvarchar(255)  NOT NULL,
    Categoria        nvarchar(450)  NOT NULL,   -- RUTA COMPLETA (llave de capacidad), como ProblemCategoria.Categoria
    Director         nvarchar(255)  NOT NULL,   -- derivado al validar
    Titulo           nvarchar(max)  NOT NULL,
    Descripcion      nvarchar(max)  NOT NULL,
    Observaciones    nvarchar(max)  NOT NULL,
    Volumetria       int            NOT NULL CONSTRAINT CK_Solicitud_Vol CHECK (Volumetria >= 0),
    PctDisminucion   decimal(9,4)   NOT NULL CONSTRAINT CK_Solicitud_Pct CHECK (PctDisminucion BETWEEN 0 AND 1),
    RcaExtension     nvarchar(10)   NULL,       -- extensión original; el archivo se llamará <NumeroSolicitud 7 dígitos>.<ext>
    SolicitadoPor    nvarchar(256)  NOT NULL,   -- IdentidadWindows.Original (DOMINIO\cuenta)
    FechaAlta        datetime2(0)   NOT NULL CONSTRAINT DF_Solicitud_Alta DEFAULT (SYSUTCDATETIME())
    -- Estado / revisión / aprobación: fuera de este paso (no definidos todavía).
);

-- 4) Alta atómica. La web solo tendría EXECUTE sobre el esquema adm.
CREATE PROCEDURE adm.usp_Solicitud_Crear
    @TipoIniciativa nvarchar(100), @ProductOwner nvarchar(255), @ServiceOwner nvarchar(255),
    @Categoria nvarchar(450), @Director nvarchar(255),
    @Titulo nvarchar(max), @Descripcion nvarchar(max), @Observaciones nvarchar(max),
    @Volumetria int, @PctDisminucion decimal(9,4), @RcaExtension nvarchar(10), @SolicitadoPor nvarchar(256),
    @NumeroSolicitud int OUTPUT
AS
BEGIN
    SET NOCOUNT ON; SET XACT_ABORT ON;
    BEGIN TRAN;
        -- UPDLOCK + HOLDLOCK: un solo alta a la vez toma el siguiente número.
        UPDATE adm.ContadorSolicitud WITH (UPDLOCK, HOLDLOCK)
           SET @NumeroSolicitud = Ultimo = Ultimo + 1
         WHERE Id = 1;

        -- (Aquí iría también el recálculo de capacidad de @Categoria con
        --  bloqueo, para que dos altas simultáneas no excedan el 100%.)

        INSERT adm.Solicitud (NumeroSolicitud, TipoIniciativa, ProductOwner, ServiceOwner, Categoria, Director,
                              Titulo, Descripcion, Observaciones, Volumetria, PctDisminucion, RcaExtension, SolicitadoPor)
        VALUES (@NumeroSolicitud, @TipoIniciativa, @ProductOwner, @ServiceOwner, @Categoria, @Director,
                @Titulo, @Descripcion, @Observaciones, @Volumetria, @PctDisminucion, @RcaExtension, @SolicitadoPor);
    COMMIT;   -- cualquier error: XACT_ABORT revierte contador e inserción juntos
END;
```

## Riesgo / rollback

- Riesgo bajo: objetos nuevos en un esquema propio; no toca `dbo`, ni el ETL.
- Rollback: `DROP PROCEDURE adm.usp_Solicitud_Crear; DROP TABLE adm.Solicitud;
  DROP TABLE adm.ContadorSolicitud;` (y `DROP SCHEMA adm` si quedó vacío).
- Lado C#: un `IGeneradorNumeroSolicitud` que llame al SP. El contrato ya existe.

## Pendiente de decidir antes de aprobar

- Columnas de estado/revisión/aprobación de la solicitud.
- Permisos: usuario de la web con EXECUTE sobre `adm`.
- Recálculo de capacidad dentro del SP (repetiría en SQL la regla de
  `ExperienciaQueries.ConsumeCapacidad`).
