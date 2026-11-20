/* =========================================================================
   sql/43_gestion_admin_crear_prefijo_alfanumerico.sql - Crear acepta un
   prefijo de una letra y dos letras o digitos (S2L).
                                                  ROLLBACK: _rollback.sql

   ESTADO: PROPUESTA PARA REVISION. NO EJECUTADA EN LA VM.
   Solo se corrio en bases DESECHABLES de LocalDB (GestionAdminPrueba_*,
   tools/tests/PrefijoAlfanumericoSqlLocalDbSmoke.cs), que fijan los hashes
   de abajo.

   POR QUE
     Regla de negocio (confirmada 2026-11-20): S2L ('Shift to Left' en
     dbo.CatPrefijoProblem) es un prefijo valido; dbo.Problem ya tiene
     'S2L 2026-000001' y Crear debe emitir los siguientes. Crear exigia
     [A-Z][A-Z][A-Z] y lo rechazaba con 51021: una Nueva solicitud S2L no se
     podia aprobar.

   QUE CAMBIA (ALTER; conserva permisos)
     adm.usp_GestionAdmin_Crear: SOLO la regla y el texto de 51021
       [A-Z][A-Z][A-Z] -> [A-Z][A-Z0-9][A-Z0-9]  (Latin1_General_BIN)
     Lo demas es el texto exacto de sql/27: firma, 51002 (catalogo), tope,
     candado adm.codigo:<prefijo>:<anio>, consecutivo, 51022-51025,
     TicketsReduce, proteccion. 0 tablas, 0 columnas, 0 datos.
     Un prefijo de tres letras sigue el mismo camino. SEMC (cuatro) sigue en
     51021. El consecutivo de S2L sale de los Codigos 'S2L<anio>...' que ya
     haya en dbo.Problem (la misma lectura que cualquier prefijo).

   ORDEN: despues de sql/27 y sql/32. sql/32 (adelante y rollback) y
     sql/27_rollback exigen el hash de sql/27: con esta aplicada se niegan
     (sin tocar nada). Para deshacer 32 o 27, primero este rollback.

   PRECONDICION (si no, ROLLBACK y no toca nada)
     Crear = sql/27  0x6D8BE5D83F74B68CC651D8CDF9283BC6C3A536D112700082449518CDAE14B2BD
     (SHA2_256 de OBJECT_DEFINITION sin espacios, tabs ni saltos de linea).
     Si ya tiene el de sql/43, se niega ("ya aplicada").
   POSTCONDICION (si no, ROLLBACK)
     Crear = 0x0B39CE7220342B020F37DAFA5CD15540D35A3E2A074D043D54EEB6A9FDEA704E
     y la misma firma, permisos, QUOTED_IDENTIFIER/ANSI_NULLS ON y filas de
     dbo.Problem que antes.

   COMO CORRERLO (solo con OK)
       EXEC sys.sp_set_session_context N'aprobar_migracion', N'43';
     y el script completo (sqlcmd -b -I, o SSMS con el script entero).
     Una sola transaccion.
   ========================================================================= */
IF DB_NAME() NOT LIKE N'GestionAdminPrueba[_]%'
   AND ISNULL(CONVERT(nvarchar(10), SESSION_CONTEXT(N'aprobar_migracion')), N'') <> N'43'
BEGIN
    RAISERROR (N'Migracion 43 SIN APROBAR: declara aprobar_migracion = 43 en esta sesion.', 16, 1);
    SET NOEXEC ON;
END;
GO
SET XACT_ABORT ON;
BEGIN TRAN;
DECLARE @h varbinary(32) = HASHBYTES('SHA2_256', REPLACE(REPLACE(REPLACE(REPLACE(
                            OBJECT_DEFINITION(OBJECT_ID('adm.usp_GestionAdmin_Crear', 'P')),
                            N' ', N''), NCHAR(9), N''), NCHAR(13), N''), NCHAR(10), N''));
IF @h IS NULL OR @h <> 0x6D8BE5D83F74B68CC651D8CDF9283BC6C3A536D112700082449518CDAE14B2BD
BEGIN
    ROLLBACK;
    DECLARE @hex nvarchar(70) = ISNULL(CONVERT(nvarchar(70), @h, 1), N'NULL');
    IF @h = 0x0B39CE7220342B020F37DAFA5CD15540D35A3E2A074D043D54EEB6A9FDEA704E
        RAISERROR (N'Migracion 43: ya aplicada (Crear tiene el hash de sql/43). No se toca nada.', 16, 1);
    ELSE
        RAISERROR (N'Migracion 43: adm.usp_GestionAdmin_Crear no es la de sql/27 (hash %s). No se toca nada.', 16, 1, @hex);
    SET NOEXEC ON;
END;
GO
IF @@TRANCOUNT = 0 BEGIN RAISERROR (N'Migracion 43: transaccion cerrada.', 16, 1); SET NOEXEC ON; END;
GO
/* Foto de lo que NO debe cambiar: firma, permisos, opciones SET y filas. */
IF OBJECT_ID('tempdb..#antes43') IS NOT NULL DROP TABLE #antes43;
SELECT Parametros = (SELECT CHECKSUM_AGG(CHECKSUM(p.parameter_id, p.name, p.user_type_id, p.max_length, p.is_output, p.has_default_value))
                     FROM sys.parameters AS p WHERE p.object_id = OBJECT_ID('adm.usp_GestionAdmin_Crear', 'P')),
       NParametros = (SELECT COUNT(*) FROM sys.parameters WHERE object_id = OBJECT_ID('adm.usp_GestionAdmin_Crear', 'P')),
       Permisos = (SELECT CHECKSUM_AGG(CHECKSUM(dp.grantee_principal_id, dp.permission_name, dp.state))
                   FROM sys.database_permissions AS dp WHERE dp.class = 1 AND dp.major_id = OBJECT_ID('adm.usp_GestionAdmin_Crear', 'P')),
       Opciones = (SELECT CONVERT(int, uses_quoted_identifier) * 2 + CONVERT(int, uses_ansi_nulls)
                   FROM sys.sql_modules WHERE object_id = OBJECT_ID('adm.usp_GestionAdmin_Crear', 'P')),
       Problemas = (SELECT COUNT(*) FROM dbo.Problem)
INTO #antes43;
GO
IF @@TRANCOUNT = 0 BEGIN RAISERROR (N'Migracion 43: transaccion cerrada.', 16, 1); SET NOEXEC ON; END;
GO
/* ---------- 1. Crear (texto de sql/27 + prefijo alfanumerico) ---------- */
-- El procedimiento guarda las opciones de la sesion que lo altera (sqlcmd
-- sin -I deja QUOTED_IDENTIFIER OFF). Lote aparte: QUOTED_IDENTIFIER se
-- fija al compilar el lote, y asi la definicion (y su hash) no las incluye.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
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
    -- sql/26: Volumetria que ADM fija en el alta (dbo.Problem.VolumetriaOriginal).
    -- Opcional y con default: NULL = no la fijo (como antes de sql/26).
    @VolumetriaOriginal   int = NULL,
    -- sql/27: Subestado inicial que ADM elige (dbo.Problem.Subestado).
    -- Opcional y con default: NULL = sin elegir (como antes de sql/27).
    @Subestado            nvarchar(100) = NULL,
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
    SET @Subestado = NULLIF(LTRIM(RTRIM(@Subestado)), N'');

    IF NULLIF(LTRIM(RTRIM(@Usuario)), N'') IS NULL
        THROW 51001, N'Falta el usuario autenticado: no se guarda nada sin atribucion.', 1;
    IF NOT EXISTS (SELECT 1 FROM dbo.CatPrefijoProblem WHERE Prefijo = @Prefijo)
        THROW 51002, N'El prefijo no esta en dbo.CatPrefijoProblem.', 1;
    -- dbo.Problem.Prefijo es UPPER(LEFT(Codigo, 3)): un prefijo del catalogo
    -- que no sea de tres caracteres no puede formar un Codigo valido. Una
    -- letra y luego letras o digitos (S2L). BIN: solo A-Z y 0-9 ASCII; con
    -- la intercalacion de la base el rango dejaria pasar letras acentuadas.
    IF @Prefijo COLLATE Latin1_General_BIN NOT LIKE N'[A-Z][A-Z0-9][A-Z0-9]'
        THROW 51021, N'Prefijo invalido para un Codigo: se esperan una letra y dos letras o digitos (PPP AAAA-NNNNNN).', 1;
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
    -- sql/27: la regla del sitio (ValidadorGestionAdmin, la misma de
    -- Modificar): un Subestado que ya existe, recortado, en un problema
    -- VIGENTE, con la grafia EXACTA (binario = StringComparer.Ordinal).
    -- Mas estricta que la de Estado (51013): asi la base acepta justo lo
    -- que el sitio acepta y no nace una grafia nueva. No hay catalogo ni
    -- reglas de transicion Estado/Subestado: no se cruza con el Estado.
    IF @Subestado IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM dbo.Problem
                       WHERE VigenteEnOrigen = 1
                         AND LTRIM(RTRIM(Subestado)) COLLATE Latin1_General_BIN2 = @Subestado COLLATE Latin1_General_BIN2)
        THROW 51029, N'Subestado inicial que no existe (tal cual) en un problema vigente de dbo.Problem.', 1;
    -- PO / SO: que sean del catalogo lo revisa la aplicacion (la misma
    -- resolucion de duenos que el resto del sitio); aqui solo el largo, para
    -- no truncar en silencio.
    IF LEN(@OwnerProblem) > 255 OR LEN(@OwnerServicio) > 255
        THROW 51027, N'Product Owner o Service Owner de mas de 255 caracteres.', 1;
    IF @VolumetriaOriginal < 0
        THROW 51028, N'La Volumetria no puede ser negativa.', 1;
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
    DECLARE @consume bit = CASE WHEN @vivo = 1 AND (@TipoAgrupado IS NULL OR @TipoAgrupado COLLATE Latin1_General_CI_AI IN (N'Problem', N'SorIA', N'Adopcion', N'Mejora'))
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
            -- del alta o NULL (sql/20). VolumetriaOriginal = la que fijo ADM o
            -- NULL (sql/26). Subestado = el que eligio ADM o NULL (sql/27).
            -- VigenteEnOrigen = 1 para los filtros.
            INSERT dbo.Problem (Codigo, TipoIniciativa, Titulo, Descripcion, Observaciones, Estado, Subestado,
                                OwnerProblem, OwnerServicio, VolumetriaOriginal,
                                FechaCreacion, FechaEntregaAnalisis, FechaAnalisis,
                                NroCambioFechaAnalisis, NroCambioFechaSolucion, NroCambioFechaCierre,
                                VigenteEnOrigen)
            VALUES (@nuevo, @TipoIniciativa, @Titulo, @Descripcion, @Observaciones, @Estado, @Subestado,
                    @OwnerProblem, @OwnerServicio, @VolumetriaOriginal,
                    @hoyMx, @entrega, @analisis, 0, 0, 0, 1);

            -- Iniciales: sin fechas propias (NULL) = heredan las de la iniciativa.
            INSERT dbo.ProblemCategoria (Codigo, Categoria, TipoIniciativa, TipoAgrupado, PctDisminucion, VigenteEnOrigen)
            SELECT @nuevo, LTRIM(RTRIM(REPLACE(c.Categoria, NCHAR(160), N' '))), @TipoIniciativa, @TipoAgrupado, c.Pct, 1
            FROM @Categorias AS c;

            EXEC adm.usp_GestionAdmin_TicketsReduce @Codigo = @nuevo, @Categorias = @Categorias;

            -- En la misma transaccion: un alta guardada nunca queda sin proteger.
            -- sql/23: el alta es tambien su ultimo cambio guardado desde el Dashboard.
            INSERT adm.IniciativaProtegida (Codigo, Motivo, Usuario, UltimoCambioUtc, UltimoCambioUsuario)
            VALUES (@nuevo, 'ALTA', @Usuario, SYSUTCDATETIME(), @Usuario);

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
IF @@TRANCOUNT = 0 BEGIN RAISERROR (N'Migracion 43: nada que confirmar: transaccion cerrada.', 16, 1); SET NOEXEC ON; END;
GO
DECLARE @h2 varbinary(32) = HASHBYTES('SHA2_256', REPLACE(REPLACE(REPLACE(REPLACE(
                            OBJECT_DEFINITION(OBJECT_ID('adm.usp_GestionAdmin_Crear', 'P')),
                            N' ', N''), NCHAR(9), N''), NCHAR(13), N''), NCHAR(10), N''));
IF @h2 = 0x0B39CE7220342B020F37DAFA5CD15540D35A3E2A074D043D54EEB6A9FDEA704E
   AND EXISTS (SELECT 1 FROM #antes43 AS a
               WHERE ISNULL(a.Parametros, 0) = ISNULL((SELECT CHECKSUM_AGG(CHECKSUM(p.parameter_id, p.name, p.user_type_id, p.max_length, p.is_output, p.has_default_value))
                                                       FROM sys.parameters AS p WHERE p.object_id = OBJECT_ID('adm.usp_GestionAdmin_Crear', 'P')), 0)
                 AND a.NParametros = (SELECT COUNT(*) FROM sys.parameters WHERE object_id = OBJECT_ID('adm.usp_GestionAdmin_Crear', 'P'))
                 AND ISNULL(a.Permisos, 0) = ISNULL((SELECT CHECKSUM_AGG(CHECKSUM(dp.grantee_principal_id, dp.permission_name, dp.state))
                                                     FROM sys.database_permissions AS dp WHERE dp.class = 1 AND dp.major_id = OBJECT_ID('adm.usp_GestionAdmin_Crear', 'P')), 0)
                 AND a.Opciones = 3
                 AND a.Opciones = (SELECT CONVERT(int, uses_quoted_identifier) * 2 + CONVERT(int, uses_ansi_nulls)
                                   FROM sys.sql_modules WHERE object_id = OBJECT_ID('adm.usp_GestionAdmin_Crear', 'P'))
                 AND a.Problemas = (SELECT COUNT(*) FROM dbo.Problem))
BEGIN
    COMMIT;
    SELECT Migracion = N'Migracion 43', Resultado = 'APLICADA';
END
ELSE
BEGIN
    ROLLBACK;
    DECLARE @hex2 nvarchar(70) = ISNULL(CONVERT(nvarchar(70), @h2, 1), N'NULL');
    RAISERROR (N'Migracion 43: adm.usp_GestionAdmin_Crear no quedo como se esperaba (hash %s, firma, permisos u opciones); ROLLBACK de todo.', 16, 1, @hex2);
END;
GO
SET NOEXEC OFF;
GO
