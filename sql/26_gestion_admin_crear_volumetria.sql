/* =========================================================================
   sql/26_gestion_admin_crear_volumetria.sql - Volumetria fijada por ADM en
   "Crear iniciativa".                         ROLLBACK: _rollback.sql

   ESTADO: PROPUESTA. NO EJECUTADA EN LA VM NI APROBADA. Solo se corrio en
   bases DESECHABLES de LocalDB (GestionAdminPrueba_*,
   tools/tests/CrearVolumetriaSqlLocalDbSmoke.cs) para comprobar que compila
   y fijar los hashes de abajo. Aplicarla es otro paso, con su OK.

   POR QUE
     ADM a veces apunta a una volumetria distinta de la calculada (SLOT 0 de
     vw_TBSlotCAT). La columna ya existe: dbo.Problem.VolumetriaOriginal int
     NULL (la llena el Excel en las demas iniciativas). Lo que falta es el
     camino: adm.usp_GestionAdmin_Crear no la recibe.

   QUE CAMBIA (ALTER; conserva permisos)
     adm.usp_GestionAdmin_Crear   + @VolumetriaOriginal int = NULL (con
                                  default: un llamador que no la manda sigue
                                  igual), 51028 si es negativa, y la columna
                                  en el INSERT de dbo.Problem.
     Lo demas es el texto exacto de sql/23. 0 tablas, 0 columnas, 0 datos.
     TicketsReduce NO cambia: sigue siendo ROUND(VolumenUltimos30 de
     dbo.vw_ProblemCategoria x %), no usa esta volumetria (decision
     2026-10-21). Modificar, Aplicar y el cargador no se tocan; ADM_04 ya
     impide que el Excel pise las filas que Admin crea.

   EL SITIO
     Solo manda @VolumetriaOriginal cuando DeteccionSql26
     (App_Code/EscritorGestionAdmin.cs) ve el parametro en sys.parameters.
     Desplegar antes de aplicar esto no rompe nada (el campo no se ofrece y
     el servidor lo rechaza con 422); el rollback lo vuelve a apagar solo.

   ORDEN: despues de sql/23 (cambia el Crear de sql/23). Independiente de
     sql/24 y sql/25 (no tocan Crear).

   PRECONDICION (si no se cumple, ROLLBACK y no toca nada)
     Crear = sql/23  0x8032AA3EBEA8E44EFB1E58DF977824093B91BFACFEC2E5EB0684AEC1E52743E6
     (regla del hash: SHA2_256 de OBJECT_DEFINITION sin espacios, tabs ni
     saltos de linea; la de sql/20 a 25 y del diag ADM_04 sec 11).
     Si ya tiene el de sql/26, se niega ("ya aplicada").
   POSTCONDICION (si no, ROLLBACK)
     Crear     0x80F079B26DC86BD070E7A529ECACE4FDCB5C9EF82887EC35EF20A805C783B44B
     y @VolumetriaOriginal int en sys.parameters.

   DIAG ADM_04 (repo del backend), seccion 11: despues de esto marca Crear
     como 'OTRA: revisar' (ya lo estaba desde sql/20). Esperado.

   COMO CORRERLO (solo con OK)
       EXEC sys.sp_set_session_context N'aprobar_migracion', N'26';
     y el script completo (sqlcmd -b -I, o SSMS con el script entero).
     Una sola transaccion.
   ========================================================================= */
IF DB_NAME() NOT LIKE N'GestionAdminPrueba[_]%'
   AND ISNULL(CONVERT(nvarchar(10), SESSION_CONTEXT(N'aprobar_migracion')), N'') <> N'26'
BEGIN
    RAISERROR (N'Migracion 26 SIN APROBAR: declara aprobar_migracion = 26 en esta sesion.', 16, 1);
    SET NOEXEC ON;
END;
GO
SET XACT_ABORT ON;
BEGIN TRAN;
DECLARE @h varbinary(32) = HASHBYTES('SHA2_256', REPLACE(REPLACE(REPLACE(REPLACE(
                            OBJECT_DEFINITION(OBJECT_ID('adm.usp_GestionAdmin_Crear', 'P')),
                            N' ', N''), NCHAR(9), N''), NCHAR(13), N''), NCHAR(10), N''));
IF @h IS NULL OR @h <> 0x8032AA3EBEA8E44EFB1E58DF977824093B91BFACFEC2E5EB0684AEC1E52743E6
BEGIN
    ROLLBACK;
    DECLARE @hex nvarchar(70) = ISNULL(CONVERT(nvarchar(70), @h, 1), N'NULL');
    IF @h = 0x80F079B26DC86BD070E7A529ECACE4FDCB5C9EF82887EC35EF20A805C783B44B
        RAISERROR (N'Migracion 26: ya aplicada (Crear tiene el hash de sql/26). No se toca nada.', 16, 1);
    ELSE
        RAISERROR (N'Migracion 26: adm.usp_GestionAdmin_Crear no es la de sql/23 (hash %s). Aplica sql/23 antes. No se toca nada.', 16, 1, @hex);
    SET NOEXEC ON;
END;
GO
IF @@TRANCOUNT = 0 BEGIN RAISERROR (N'Migracion 26: transaccion cerrada.', 16, 1); SET NOEXEC ON; END;
GO
/* ---------- 1. Crear (texto de sql/23 + VolumetriaOriginal) ---------- */
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
            -- NULL (sql/26). VigenteEnOrigen = 1 para los filtros.
            INSERT dbo.Problem (Codigo, TipoIniciativa, Titulo, Descripcion, Observaciones, Estado,
                                OwnerProblem, OwnerServicio, VolumetriaOriginal,
                                FechaCreacion, FechaEntregaAnalisis, FechaAnalisis,
                                NroCambioFechaAnalisis, NroCambioFechaSolucion, NroCambioFechaCierre,
                                VigenteEnOrigen)
            VALUES (@nuevo, @TipoIniciativa, @Titulo, @Descripcion, @Observaciones, @Estado,
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
IF @@TRANCOUNT = 0 BEGIN RAISERROR (N'Migracion 26: nada que confirmar: transaccion cerrada.', 16, 1); SET NOEXEC ON; END;
GO
DECLARE @h2 varbinary(32) = HASHBYTES('SHA2_256', REPLACE(REPLACE(REPLACE(REPLACE(
                             OBJECT_DEFINITION(OBJECT_ID('adm.usp_GestionAdmin_Crear', 'P')),
                             N' ', N''), NCHAR(9), N''), NCHAR(13), N''), NCHAR(10), N''));
DECLARE @vol int = (SELECT COUNT(*) FROM sys.parameters AS p
                    WHERE p.object_id = OBJECT_ID('adm.usp_GestionAdmin_Crear', 'P') AND p.name = N'@VolumetriaOriginal'
                      AND TYPE_NAME(p.user_type_id) = N'int');
IF @h2 = 0x80F079B26DC86BD070E7A529ECACE4FDCB5C9EF82887EC35EF20A805C783B44B AND @vol = 1
BEGIN
    COMMIT;
    SELECT Migracion = N'Migracion 26', Resultado = 'APLICADA';
END
ELSE
BEGIN
    ROLLBACK;
    DECLARE @hex2 nvarchar(70) = ISNULL(CONVERT(nvarchar(70), @h2, 1), N'NULL');
    RAISERROR (N'Migracion 26: adm.usp_GestionAdmin_Crear no quedo como se esperaba (hash %s); ROLLBACK de todo.', 16, 1, @hex2);
END;
GO
SET NOEXEC OFF;
GO
