/* =========================================================================
   sql/27_gestion_admin_crear_subestado.sql - Subestado elegido por ADM en
   "Crear iniciativa".                         ROLLBACK: _rollback.sql

   ESTADO: PROPUESTA. NO EJECUTADA EN LA VM NI APROBADA. Solo se corrio en
   bases DESECHABLES de LocalDB (GestionAdminPrueba_*,
   tools/tests/CrearSubestadoSqlLocalDbSmoke.cs) para comprobar que compila
   y fijar los hashes de abajo. Aplicarla es otro paso, con su OK.

   POR QUE
     ADM quiere fijar el Subestado de una iniciativa al darla de alta. La
     columna ya existe: dbo.Problem.Subestado nvarchar(100) NULL (esquema_bd
     02_columnas). Lo que falta es el camino: adm.usp_GestionAdmin_Crear no
     lo recibe y su INSERT no lo escribe. Modificar ya lo cambia (sql/18,
     @CambiaSubestado), pero Crear + Modificar dejaria una MODIFICACION de
     mas en Cambios recientes / auditoria: se guarda en el mismo INSERT.

   QUE CAMBIA (ALTER; conserva permisos)
     adm.usp_GestionAdmin_Crear   + @Subestado nvarchar(100) = NULL (con
                                  default: un llamador que no lo manda sigue
                                  igual), vacio/espacios = NULL, 51029 si no
                                  es uno que ya existe (recortado) en un
                                  problema VigenteEnOrigen = 1 con la grafia
                                  exacta (Latin1_General_BIN2), y la columna
                                  en el INSERT de dbo.Problem.
     REGLA DE SUBESTADO = LA DEL SITIO. ValidadorGestionAdmin (Crear y
     Modificar) acepta solo valores de ExperienciaQueries.LeerEstadosProblem:
     LTRIM(RTRIM(Subestado)) de problemas vigentes, comparados con
     StringComparer.Ordinal. Aqui se repite esa regla (no la mas laxa de
     Estado 51013 / Solicitar cambios 51217, que ignora mayusculas y mira
     tambien los no vigentes): lo que el sitio acepta, la base lo acepta;
     lo que el sitio rechaza, la base tambien (p. ej. 'solucionado' si solo
     existe 'Solucionado'). Unica diferencia: el sitio recorta cualquier
     blanco (Trim) y la base solo espacios; el sitio manda el valor ya
     recortado, asi que por el sitio no hay diferencia.
     Lo demas es el texto exacto de sql/26. 0 tablas, 0 columnas, 0 datos.
     Estado NO cambia: ni se valida contra el Subestado ni se deriva de el
     (no hay reglas de transicion verificadas). El tope, el Codigo, el
     TicketsReduce, la proteccion y el sello de sql/23 son los mismos.

   EL SITIO
     Solo manda @Subestado cuando DeteccionSql27
     (App_Code/EscritorGestionAdmin.cs) ve el parametro en sys.parameters.
     Desplegar antes de aplicar esto no rompe nada (el campo no se ofrece y
     el servidor lo rechaza con 422); el rollback lo vuelve a apagar solo.

   ORDEN: despues de sql/26 (cambia el Crear de sql/26). Independiente de
     sql/24 y sql/25 (no tocan Crear).

   PRECONDICION (si no se cumple, ROLLBACK y no toca nada)
     Crear = sql/26  0x80F079B26DC86BD070E7A529ECACE4FDCB5C9EF82887EC35EF20A805C783B44B
     (regla del hash: SHA2_256 de OBJECT_DEFINITION sin espacios, tabs ni
     saltos de linea; la de sql/20 a 26 y del diag ADM_04 sec 11).
     Si ya tiene el de sql/27, se niega ("ya aplicada").
   POSTCONDICION (si no, ROLLBACK)
     Crear     0x6D8BE5D83F74B68CC651D8CDF9283BC6C3A536D112700082449518CDAE14B2BD
     y @Subestado nvarchar(100) en sys.parameters.

   DIAG ADM_04 (repo del backend), seccion 11: despues de esto marca Crear
     como 'OTRA: revisar' (ya lo estaba desde sql/20). Esperado.

   COMO CORRERLO (solo con OK)
       EXEC sys.sp_set_session_context N'aprobar_migracion', N'27';
     y el script completo (sqlcmd -b -I, o SSMS con el script entero).
     Una sola transaccion.
   ========================================================================= */
IF DB_NAME() NOT LIKE N'GestionAdminPrueba[_]%'
   AND ISNULL(CONVERT(nvarchar(10), SESSION_CONTEXT(N'aprobar_migracion')), N'') <> N'27'
BEGIN
    RAISERROR (N'Migracion 27 SIN APROBAR: declara aprobar_migracion = 27 en esta sesion.', 16, 1);
    SET NOEXEC ON;
END;
GO
SET XACT_ABORT ON;
BEGIN TRAN;
DECLARE @h varbinary(32) = HASHBYTES('SHA2_256', REPLACE(REPLACE(REPLACE(REPLACE(
                            OBJECT_DEFINITION(OBJECT_ID('adm.usp_GestionAdmin_Crear', 'P')),
                            N' ', N''), NCHAR(9), N''), NCHAR(13), N''), NCHAR(10), N''));
IF @h IS NULL OR @h <> 0x80F079B26DC86BD070E7A529ECACE4FDCB5C9EF82887EC35EF20A805C783B44B
BEGIN
    ROLLBACK;
    DECLARE @hex nvarchar(70) = ISNULL(CONVERT(nvarchar(70), @h, 1), N'NULL');
    IF @h = 0x6D8BE5D83F74B68CC651D8CDF9283BC6C3A536D112700082449518CDAE14B2BD
        RAISERROR (N'Migracion 27: ya aplicada (Crear tiene el hash de sql/27). No se toca nada.', 16, 1);
    ELSE
        RAISERROR (N'Migracion 27: adm.usp_GestionAdmin_Crear no es la de sql/26 (hash %s). Aplica sql/26 antes. No se toca nada.', 16, 1, @hex);
    SET NOEXEC ON;
END;
GO
IF @@TRANCOUNT = 0 BEGIN RAISERROR (N'Migracion 27: transaccion cerrada.', 16, 1); SET NOEXEC ON; END;
GO
/* ---------- 1. Crear (texto de sql/26 + Subestado) ---------- */
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
IF @@TRANCOUNT = 0 BEGIN RAISERROR (N'Migracion 27: nada que confirmar: transaccion cerrada.', 16, 1); SET NOEXEC ON; END;
GO
DECLARE @h2 varbinary(32) = HASHBYTES('SHA2_256', REPLACE(REPLACE(REPLACE(REPLACE(
                             OBJECT_DEFINITION(OBJECT_ID('adm.usp_GestionAdmin_Crear', 'P')),
                             N' ', N''), NCHAR(9), N''), NCHAR(13), N''), NCHAR(10), N''));
DECLARE @sub int = (SELECT COUNT(*) FROM sys.parameters AS p
                    WHERE p.object_id = OBJECT_ID('adm.usp_GestionAdmin_Crear', 'P') AND p.name = N'@Subestado'
                      AND TYPE_NAME(p.user_type_id) = N'nvarchar' AND p.max_length = 200);
IF @h2 = 0x6D8BE5D83F74B68CC651D8CDF9283BC6C3A536D112700082449518CDAE14B2BD AND @sub = 1
BEGIN
    COMMIT;
    SELECT Migracion = N'Migracion 27', Resultado = 'APLICADA';
END
ELSE
BEGIN
    ROLLBACK;
    DECLARE @hex2 nvarchar(70) = ISNULL(CONVERT(nvarchar(70), @h2, 1), N'NULL');
    RAISERROR (N'Migracion 27: adm.usp_GestionAdmin_Crear no quedo como se esperaba (hash %s); ROLLBACK de todo.', 16, 1, @hex2);
END;
GO
SET NOEXEC OFF;
GO
