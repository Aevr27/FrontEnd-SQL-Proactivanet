/* =========================================================================
   sql/20_gestion_admin_duenos.sql - PO / SO en el alta de Admin.
                                                  ROLLBACK: _rollback.sql

   ESTADO: APROBADO 2026-10-15 (OK del usuario), SIN APLICAR en la VM.
   Probado solo en LocalDB desechable (GestionAdminSqlLocalDbSmoke).

   QUE CAMBIA
     Solo adm.usp_GestionAdmin_Crear (ALTER; conserva permisos). Dos
     parametros nuevos, al final y opcionales:
       @OwnerProblem  nvarchar(4000) = NULL -> dbo.Problem.OwnerProblem  (PO)
       @OwnerServicio nvarchar(4000) = NULL -> dbo.Problem.OwnerServicio (SO)
     Vacio o solo espacios = NULL. Mas de 255 = THROW 51027. Que sean del
     catalogo lo valida la aplicacion (ValidadorGestionAdmin), como antes.
     Lo demas del procedimiento queda IGUAL a sql/18 (Codigo, tope,
     IniciativaProtegida, historial, candado del cargador).
     0 tablas, 0 columnas, 0 datos.

   ORDEN
     1. Este script (la aplicacion vieja sigue funcionando: no manda los
        parametros nuevos y valen NULL).
     2. Desplegar la aplicacion con PersistenciaGestionAdmin.GuardaDuenos =
        true. Al reves falla: "too many arguments".
     Para deshacer: primero GuardaDuenos = false (desplegar), luego el
     rollback. Lo ya guardado en OwnerProblem / OwnerServicio se queda.

   PRECONDICION (si no se cumple, ROLLBACK y no toca nada)
     adm.usp_GestionAdmin_Crear existe y su hash es EXACTAMENTE el de sql/18
     (0x1183206C...F21E8). Cualquier otra definicion (sql/20 ya aplicada o
     un cambio a mano) se rechaza. Hash = SHA2_256 de OBJECT_DEFINITION sin
     espacios, tabs ni saltos de linea (misma regla que el diag ADM_04 sec
     11 y GestionAdminSqlLocalDbSmoke); SQL Server guarda un ALTER como
     'CREATE PROCEDURE', asi que sql/18 y este rollback dan el mismo hash.
   POSTCONDICION (si no se cumple, ROLLBACK)
     hash = el de sql/20 (abajo) y parametros exactos (nombre, tipo, largo,
     OUTPUT, READONLY, en orden).

   DIAG ADM_04 (repo del backend), seccion 11: despues de esto marca
     adm.usp_GestionAdmin_Crear como 'OTRA: revisar'. Es lo esperado si el
     hash es este (misma regla del diag; probado en LocalDB):
       0x77292B7976EAF0670BE8961824D212EEEFB218343A816CE83BB6F3FE8934C297
     El rollback vuelve exacto al de sql/18 (0x1183206C...F21E8).

   COMO CORRERLO
       EXEC sys.sp_set_session_context N'aprobar_migracion', N'20';
     y el script completo (sqlcmd -b -I, o SSMS con el script entero).
     Una sola transaccion.
   ========================================================================= */
IF DB_NAME() NOT LIKE N'GestionAdminPrueba[_]%'
   AND ISNULL(CONVERT(nvarchar(10), SESSION_CONTEXT(N'aprobar_migracion')), N'') <> N'20'
BEGIN
    RAISERROR (N'Migracion 20 SIN APROBAR: declara aprobar_migracion = 20 en esta sesion.', 16, 1);
    SET NOEXEC ON;
END;
GO
SET XACT_ABORT ON;
BEGIN TRAN;
DECLARE @hash varbinary(32) = HASHBYTES('SHA2_256', REPLACE(REPLACE(REPLACE(REPLACE(
                            OBJECT_DEFINITION(OBJECT_ID('adm.usp_GestionAdmin_Crear', 'P')),
                            N' ', N''), NCHAR(9), N''), NCHAR(13), N''), NCHAR(10), N''));
IF @hash IS NULL OR @hash <> 0x1183206C8BF1CFB33675A44D104D65F8660BCC0FF88CC63E40324DB7FBAF21E8
BEGIN
    ROLLBACK;
    DECLARE @hex nvarchar(70) = ISNULL(CONVERT(nvarchar(70), @hash, 1), N'NULL: no existe o sin VIEW DEFINITION');
    IF @hash = 0x77292B7976EAF0670BE8961824D212EEEFB218343A816CE83BB6F3FE8934C297
        RAISERROR (N'Migracion 20: adm.usp_GestionAdmin_Crear ya tiene @OwnerProblem (hash de sql/20). No se toca nada.', 16, 1);
    ELSE
        RAISERROR (N'Migracion 20: adm.usp_GestionAdmin_Crear no es la de sql/18 (hash %s). No se toca nada.', 16, 1, @hex);
    SET NOEXEC ON;
END;
GO
IF @@TRANCOUNT = 0 BEGIN RAISERROR (N'Migracion 20: transaccion cerrada.', 16, 1); SET NOEXEC ON; END;
GO
ALTER PROCEDURE adm.usp_GestionAdmin_Crear
    @Usuario              nvarchar(256),
    @Prefijo              nvarchar(10),
    @TipoIniciativa       nvarchar(100),
    @TipoAgrupado         nvarchar(100),
    @Estado               nvarchar(100),
    @Titulo               nvarchar(max),
    @Descripcion          nvarchar(max),
    @Observaciones        nvarchar(max),
    @FechaEntregaAnalisis date = NULL,          -- NULL = hoy
    @Categorias           adm.CategoriaPctTipo READONLY,
    @Hoy                  date = NULL,          -- NULL = hoy en Mexico (UTC-6)
    -- sql/20: PO / SO del alta, opcionales (NULL = sin elegir). Al final
    -- y con default: un llamador que no los manda sigue funcionando.
    @OwnerProblem         nvarchar(4000) = NULL, -- Product Owner (columna: 255)
    @OwnerServicio        nvarchar(4000) = NULL, -- Service Owner (columna: 255)
    @Codigo               nvarchar(100) OUTPUT
AS
BEGIN
    SET NOCOUNT ON; SET XACT_ABORT ON;
    SET @Codigo = NULL;
    SET @Prefijo = UPPER(LTRIM(RTRIM(@Prefijo)));
    SET @TipoIniciativa = NULLIF(LTRIM(RTRIM(@TipoIniciativa)), N'');
    SET @TipoAgrupado = NULLIF(LTRIM(RTRIM(@TipoAgrupado)), N'');
    SET @Estado = NULLIF(LTRIM(RTRIM(@Estado)), N'');
    SET @OwnerProblem = NULLIF(LTRIM(RTRIM(@OwnerProblem)), N'');
    SET @OwnerServicio = NULLIF(LTRIM(RTRIM(@OwnerServicio)), N'');

    IF NULLIF(LTRIM(RTRIM(@Usuario)), N'') IS NULL
        THROW 51001, N'Falta el usuario autenticado: no se guarda nada sin atribucion.', 1;
    IF NOT EXISTS (SELECT 1 FROM dbo.CatPrefijoProblem WHERE Prefijo = @Prefijo)
        THROW 51002, N'El prefijo no esta en dbo.CatPrefijoProblem.', 1;
    -- dbo.Problem.Prefijo es UPPER(LEFT(Codigo, 3)): un prefijo del catalogo
    -- que no sea de tres letras no puede formar un Codigo valido.
    IF @Prefijo COLLATE Latin1_General_BIN NOT LIKE N'[A-Z][A-Z][A-Z]'
        THROW 51021, N'Prefijo invalido para un Codigo: se esperan tres letras (PPP AAAA-NNNNNN).', 1;
    -- Opcionales: si no vienen, NULL (la iniciativa queda incompleta).
    IF @TipoIniciativa IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM dbo.Problem WHERE LTRIM(RTRIM(TipoIniciativa)) = @TipoIniciativa)
        THROW 51011, N'Tipo de iniciativa que no existe en dbo.Problem.', 1;
    IF @TipoAgrupado IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM dbo.ProblemCategoria WHERE LTRIM(RTRIM(TipoAgrupado)) = @TipoAgrupado)
        THROW 51012, N'Agrupacion (TipoAgrupado) que no existe en dbo.ProblemCategoria.', 1;
    IF @Estado IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM dbo.Problem WHERE LTRIM(RTRIM(Estado)) = @Estado)
        THROW 51013, N'Estado inicial que no existe en dbo.Problem.', 1;
    -- PO / SO: que sean del catalogo lo revisa la aplicacion (la misma
    -- resolucion de duenos que el resto del sitio); aqui solo el largo, para
    -- no truncar en silencio.
    IF LEN(@OwnerProblem) > 255 OR LEN(@OwnerServicio) > 255
        THROW 51027, N'Product Owner o Service Owner de mas de 255 caracteres.', 1;
    IF EXISTS (SELECT 1 FROM @Categorias
               GROUP BY LTRIM(RTRIM(REPLACE(Categoria, NCHAR(160), N' '))) HAVING COUNT(*) > 1)
        THROW 51003, N'Una categoria viene repetida.', 1;
    IF EXISTS (SELECT 1 FROM @Categorias WHERE NULLIF(LTRIM(RTRIM(REPLACE(Categoria, NCHAR(160), N' '))), N'') IS NULL)
        THROW 51004, N'Una categoria llego vacia.', 1;
    IF EXISTS (SELECT 1 FROM @Categorias WHERE Pct < 0 OR Pct > 1)
        THROW 51005, N'El % de una categoria esta fuera de 0-100.', 1;
    IF EXISTS (SELECT 1 FROM @Categorias AS c
               WHERE NOT EXISTS (SELECT 1 FROM dbo.Categorias AS k
                                 WHERE k.VigenteEnOrigen = 1 AND k.RutaCompleta = LTRIM(RTRIM(REPLACE(c.Categoria, NCHAR(160), N' ')))))
        THROW 51015, N'Una categoria no esta (vigente) en dbo.Categorias.', 1;

    DECLARE @hoyMx date = COALESCE(@Hoy, CONVERT(date, DATEADD(HOUR, -6, SYSUTCDATETIME())));
    DECLARE @analisis date = DATEADD(DAY, 15, @hoyMx);   -- 15 dias naturales
    DECLARE @anio char(4) = CONVERT(char(4), YEAR(@hoyMx));
    DECLARE @entrega date = COALESCE(@FechaEntregaAnalisis, @hoyMx);
    DECLARE @vivo bit = CASE WHEN @Estado COLLATE Latin1_General_CI_AI
                                  IN (N'En Analisis', N'En Solucion', N'En Monitoreo') THEN 1 ELSE 0 END;
    -- Sin agrupacion: se revisa como si consumiera (no se salta el tope).
    DECLARE @consume bit = CASE WHEN @vivo = 1 AND (@TipoAgrupado IS NULL OR @TipoAgrupado IN (N'Problem', N'SorIA', N'Adopcion', N'Mejora'))
                                THEN 1 ELSE 0 END;
    DECLARE @nuevo nvarchar(100), @rc int, @max int, @raro nvarchar(100);

    BEGIN TRY
        BEGIN TRAN;
            -- Primero que cualquier otro candado: el cargador del Excel
            -- (ADM_04) lo toma en Exclusive; si esta corriendo, se espera.
            EXEC @rc = sp_getapplock @Resource = N'adm.proteccion', @LockMode = 'Shared',
                                     @LockOwner = 'Transaction', @LockTimeout = 15000;
            IF @rc < 0 THROW 51026, N'La carga del Excel esta corriendo y no termino a tiempo. Intenta de nuevo.', 1;

            -- Tope: solo si las filas van a consumir.
            IF @consume = 1
            BEGIN
                DECLARE @revisar adm.CategoriaPctTipo;
                INSERT @revisar (Categoria, Pct)
                SELECT c.Categoria, c.Pct FROM @Categorias AS c WHERE c.Pct > 0;
                EXEC adm.usp_GestionAdmin_RevisarTope @Codigo = N'', @Revisar = @revisar;
            END;

            -- Codigo: un solo emisor por (prefijo, anio) a la vez; el candado
            -- dura hasta el COMMIT, asi que el siguiente ya ve este Codigo.
            DECLARE @recurso nvarchar(255) = N'adm.codigo:' + @Prefijo + N':' + @anio;
            EXEC @rc = sp_getapplock @Resource = @recurso, @LockMode = 'Exclusive',
                                     @LockOwner = 'Transaction', @LockTimeout = 15000;
            IF @rc < 0 THROW 51025, N'No se pudo reservar el siguiente Codigo (tiempo agotado). Intenta de nuevo.', 1;

            -- Todos los codigos de ese prefijo y anio, activos o no, bien o
            -- mal formados ('PRB-2026-185', 'PRB 2026-00185 '...): quitando
            -- espacios, guiones y NBSP queda 'PRB2026' + numero.
            DECLARE @raiz nvarchar(20) = @Prefijo + @anio;
            SELECT @max = MAX(n.Numero),
                   @raro = MIN(CASE WHEN n.Numero IS NULL THEN p.Codigo END)
            FROM dbo.Problem AS p
            CROSS APPLY (SELECT Plano = UPPER(REPLACE(REPLACE(REPLACE(REPLACE(LTRIM(RTRIM(p.Codigo)),
                                N' ', N''), N'-', N''), NCHAR(160), N''), NCHAR(9), N''))) AS x
            CROSS APPLY (SELECT Resto = SUBSTRING(x.Plano, LEN(@raiz) + 1, 100)) AS r
            CROSS APPLY (SELECT Numero = CASE WHEN r.Resto <> N'' AND r.Resto NOT LIKE N'%[^0-9]%' AND LEN(r.Resto) <= 9
                                              THEN CONVERT(int, r.Resto) END) AS n
            WHERE LEFT(x.Plano, LEN(@raiz)) = @raiz;
            IF @raro IS NOT NULL
            BEGIN
                DECLARE @msgRaro nvarchar(400) = N'Hay un Codigo de ' + @Prefijo + N' ' + @anio +
                    N' cuyo numero no se puede leer: ''' + @raro + N'''. Corrigelo antes de emitir otro (no se adivina).';
                THROW 51023, @msgRaro, 1;
            END;
            IF ISNULL(@max, 0) >= 999999
                THROW 51022, N'Se agotaron los consecutivos de ese prefijo y anio (999999).', 1;
            SET @nuevo = @Prefijo + N' ' + @anio + N'-' + RIGHT(N'000000' + CONVERT(nvarchar(6), ISNULL(@max, 0) + 1), 6);
            IF EXISTS (SELECT 1 FROM dbo.Problem WHERE Codigo = @nuevo)
                THROW 51024, N'El Codigo calculado ya existe: no se emite.', 1;

            EXEC sys.sp_set_session_context @key = N'pfe_origen', @value = 'ADMIN';
            EXEC sys.sp_set_session_context @key = N'pfe_usuario', @value = @Usuario;
            EXEC sys.sp_set_session_context @key = N'pfe_solicitud', @value = NULL;

            -- Direccion y demas columnas del Excel: NULL (opcionales,
            -- decision 2026-10-13). OwnerProblem / OwnerServicio = PO / SO
            -- del alta o NULL (sql/20). VigenteEnOrigen = 1 para los filtros.
            INSERT dbo.Problem (Codigo, TipoIniciativa, Titulo, Descripcion, Observaciones, Estado,
                                OwnerProblem, OwnerServicio,
                                FechaCreacion, FechaEntregaAnalisis, FechaAnalisis,
                                NroCambioFechaAnalisis, NroCambioFechaSolucion, NroCambioFechaCierre,
                                VigenteEnOrigen)
            VALUES (@nuevo, @TipoIniciativa, @Titulo, @Descripcion, @Observaciones, @Estado,
                    @OwnerProblem, @OwnerServicio,
                    @hoyMx, @entrega, @analisis, 0, 0, 0, 1);

            -- Iniciales: sin fechas propias (NULL) = heredan las de la iniciativa.
            INSERT dbo.ProblemCategoria (Codigo, Categoria, TipoIniciativa, TipoAgrupado, PctDisminucion, VigenteEnOrigen)
            SELECT @nuevo, LTRIM(RTRIM(REPLACE(c.Categoria, NCHAR(160), N' '))), @TipoIniciativa, @TipoAgrupado, c.Pct, 1
            FROM @Categorias AS c;

            EXEC adm.usp_GestionAdmin_TicketsReduce @Codigo = @nuevo, @Categorias = @Categorias;

            -- En la misma transaccion: un alta guardada nunca queda sin proteger.
            INSERT adm.IniciativaProtegida (Codigo, Motivo, Usuario) VALUES (@nuevo, 'ALTA', @Usuario);

            EXEC sys.sp_set_session_context @key = N'pfe_origen', @value = NULL;
            EXEC sys.sp_set_session_context @key = N'pfe_usuario', @value = NULL;
        COMMIT;
        SET @Codigo = @nuevo;   -- solo despues del COMMIT
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK;
        EXEC sys.sp_set_session_context @key = N'pfe_origen', @value = NULL;
        EXEC sys.sp_set_session_context @key = N'pfe_usuario', @value = NULL;
        SET @Codigo = NULL;
        THROW;
    END CATCH;
END;
GO
IF @@TRANCOUNT = 0 BEGIN RAISERROR (N'Migracion 20: transaccion cerrada; nada que confirmar.', 16, 1); SET NOEXEC ON; END;
GO
DECLARE @hash varbinary(32) = HASHBYTES('SHA2_256', REPLACE(REPLACE(REPLACE(REPLACE(
                            OBJECT_DEFINITION(OBJECT_ID('adm.usp_GestionAdmin_Crear', 'P')),
                            N' ', N''), NCHAR(9), N''), NCHAR(13), N''), NCHAR(10), N''));
DECLARE @firma nvarchar(4000) = (SELECT STRING_AGG(CONCAT(p.name, N' ', TYPE_NAME(p.user_type_id), N' ', p.max_length, N' ', p.is_output, N' ', p.is_readonly), N',')
                                    WITHIN GROUP (ORDER BY p.parameter_id)
                             FROM sys.parameters AS p WHERE p.object_id = OBJECT_ID('adm.usp_GestionAdmin_Crear', 'P'));
IF @hash = 0x77292B7976EAF0670BE8961824D212EEEFB218343A816CE83BB6F3FE8934C297
   AND @firma = N'@Usuario nvarchar 512 0 0,@Prefijo nvarchar 20 0 0,@TipoIniciativa nvarchar 200 0 0,@TipoAgrupado nvarchar 200 0 0,'
             + N'@Estado nvarchar 200 0 0,@Titulo nvarchar -1 0 0,@Descripcion nvarchar -1 0 0,@Observaciones nvarchar -1 0 0,'
             + N'@FechaEntregaAnalisis date 3 0 0,@Categorias CategoriaPctTipo -1 0 1,@Hoy date 3 0 0,'
             + N'@OwnerProblem nvarchar 8000 0 0,@OwnerServicio nvarchar 8000 0 0,@Codigo nvarchar 200 1 0'
BEGIN
    COMMIT;
    SELECT Migracion = 20, Resultado = 'APLICADA';
END
ELSE
BEGIN
    ROLLBACK;
    DECLARE @hex nvarchar(70) = ISNULL(CONVERT(nvarchar(70), @hash, 1), N'NULL');
    RAISERROR (N'Migracion 20: el procedimiento no quedo como el de sql/20 (hash %s o parametros distintos); ROLLBACK.', 16, 1, @hex);
END;
GO
SET NOEXEC OFF;
GO
