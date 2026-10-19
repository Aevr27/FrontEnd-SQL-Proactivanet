/* =========================================================================
   sql/22_solicitudes_cambio_rollback.sql - Deshace sql/22: borra las tres
   tablas, los dos tipos y los cuatro procedimientos de solicitudes, y deja
   adm.usp_GestionAdmin_Modificar con el texto EXACTO de sql/21.

   ESTADO: PROPUESTA PARA REVISION. NO EJECUTADA EN LA VM.
   Misma guarda (aprobar_migracion = 22 o base GestionAdminPrueba_*). Una
   sola transaccion.

   DATOS: si hay solicitudes guardadas, se NIEGA salvo que la sesion
   declare tambien
       EXEC sys.sp_set_session_context N'rollback_22_borrar_solicitudes', N'SI';
   Borrarlas es irreversible: respaldar antes (diag seccion 4). Las filas
   del historial que ya tienen SolicitudId se quedan (no hay FK): el
   numero queda sin su solicitud.
   Antes de esto, apagar en el sitio el envio y la revision de solicitudes
   (si no, fallan con "objeto no existe").

   PRECONDICION (si no, ROLLBACK y no toca nada): los cinco
     procedimientos con el hash de sql/22.
   POSTCONDICION (si no, ROLLBACK): Modificar con el hash de sql/21
     0x4E3A69887120832C215FFAF68DFF2792BDE7272CD75B3B0FC399A424050583C3
     y ningun objeto de 22.
   ========================================================================= */
IF DB_NAME() NOT LIKE N'GestionAdminPrueba[_]%'
   AND ISNULL(CONVERT(nvarchar(10), SESSION_CONTEXT(N'aprobar_migracion')), N'') <> N'22'
BEGIN
    RAISERROR (N'Rollback 22 SIN APROBAR: declara aprobar_migracion = 22 en esta sesion.', 16, 1);
    SET NOEXEC ON;
END;
GO
SET XACT_ABORT ON;
BEGIN TRAN;
IF OBJECT_ID('tempdb..#h22') IS NOT NULL DROP TABLE #h22;
SELECT v.Objeto, v.Esperado, Hash = HASHBYTES('SHA2_256', REPLACE(REPLACE(REPLACE(REPLACE(
                   OBJECT_DEFINITION(OBJECT_ID(v.Objeto, 'P')),
                   N' ', N''), NCHAR(9), N''), NCHAR(13), N''), NCHAR(10), N''))
INTO #h22
FROM (VALUES (N'adm.usp_GestionAdmin_Modificar', 0x8E0848187A529F6E0C2D9D8B30820F0EA19CCDEC7C7937EFB41BF33108084BA9),
             (N'adm.usp_SolicitudCambio_Crear', 0x33BBF48EB2CA3F3ED42B232BDEE570E634734348AB95D0B9D48568D3B70FDC71),
             (N'adm.usp_SolicitudCambio_Rechazar', 0xFC91FF5A0C7F5F445A1EEA168C20D696DE7D3D0943499D9EC1CF604F5987EF24),
             (N'adm.usp_SolicitudCambio_RegistrarFallo', 0x1125E2A3BD250A4EEB68703A72A55DACE9B3B43E4DCA13D3C9BD84FA35D7DB95),
             (N'adm.usp_SolicitudCambio_Aplicar', 0xB12230C54B32CEB5CA060D1431BB4E8F5A052A69CED25872B2F1775A62BF17C1)) AS v (Objeto, Esperado);
DECLARE @mal nvarchar(400) = (SELECT TOP (1) Objeto + N' (hash ' + ISNULL(CONVERT(nvarchar(70), Hash, 1), N'NULL') + N')'
                              FROM #h22 WHERE Hash IS NULL OR Hash <> Esperado ORDER BY Objeto);
DECLARE @filas int = CASE WHEN OBJECT_ID('adm.SolicitudCambio', 'U') IS NULL THEN 0
                          ELSE (SELECT COUNT(*) FROM adm.SolicitudCambio) END;
DECLARE @borrar bit = CASE WHEN ISNULL(CONVERT(nvarchar(10), SESSION_CONTEXT(N'rollback_22_borrar_solicitudes')), N'') = N'SI'
                           THEN 1 ELSE 0 END;
IF @mal IS NOT NULL OR (@filas > 0 AND @borrar = 0)
BEGIN
    ROLLBACK;
    IF @mal IS NOT NULL
        RAISERROR (N'Rollback 22: %s no es la de sql/22 (no aplicada o cambiada a mano). No se toca nada.', 16, 1, @mal);
    ELSE
        RAISERROR (N'Rollback 22: hay %d solicitudes guardadas. Borrarlas es irreversible: respaldalas y declara rollback_22_borrar_solicitudes = SI. No se toca nada.', 16, 1, @filas);
    SET NOEXEC ON;
END;
GO
IF @@TRANCOUNT = 0 BEGIN RAISERROR (N'Rollback 22: transaccion cerrada.', 16, 1); SET NOEXEC ON; END;
GO
DROP PROCEDURE adm.usp_SolicitudCambio_Aplicar;
DROP PROCEDURE adm.usp_SolicitudCambio_RegistrarFallo;
DROP PROCEDURE adm.usp_SolicitudCambio_Rechazar;
DROP PROCEDURE adm.usp_SolicitudCambio_Crear;
DROP TABLE adm.SolicitudCambioEvento;
DROP TABLE adm.SolicitudCambioCategoria;
DROP TABLE adm.SolicitudCambio;
DROP TYPE adm.SolicitudCategoriaTipo;
DROP TYPE adm.SolicitudClasificacionTipo;
GO
/* Modificar vuelve al texto EXACTO de sql/21. El lote empieza en su
   comentario original: un comentario dentro del lote cambiaria el hash. */
IF @@TRANCOUNT = 0 BEGIN RAISERROR (N'Rollback 22: transaccion cerrada.', 16, 1); SET NOEXEC ON; END;
GO
/* Solo lo que trae su bandera Cambia*. No hay parametro para Codigo ni para
   FechaCreacion: no cambian.
   @Pcts      ligadas vigentes: Pct = el valor final; TipoIniciativa /
              TipoAgrupado NULL = no cambian (con valor, se declaran).
   @Agregar   se ligan ahora: Tipo* obligatorios; fechas PROPIAS = hoy y
              hoy + 15.
   @FechasCategoria  nueva fecha de analisis de una ligada. Si la categoria
              hereda (inicial, sin fecha propia), el cambio va a la fecha de
              la INICIATIVA (FechaAnalisis), no a una fecha propia. */
ALTER PROCEDURE adm.usp_GestionAdmin_Modificar
    @Usuario             nvarchar(256),
    @Codigo              nvarchar(100),
    @CambiaTitulo        bit = 0, @Titulo        nvarchar(max) = NULL,
    @CambiaDescripcion   bit = 0, @Descripcion   nvarchar(max) = NULL,
    @CambiaObservaciones bit = 0, @Observaciones nvarchar(max) = NULL,
    @CambiaEstado        bit = 0, @Estado        nvarchar(100) = NULL,
    @CambiaSubestado     bit = 0, @Subestado     nvarchar(100) = NULL,
    @CambiaFAnalisis     bit = 0, @FAnalisis     date = NULL,
    @CambiaFSolucion     bit = 0, @FSolucion     date = NULL,
    @CambiaFCierre       bit = 0, @FCierre       date = NULL,
    @Pcts                adm.CategoriaPctTipo READONLY,
    @Agregar             adm.CategoriaPctTipo READONLY,
    @FechasCategoria     adm.CategoriaFechaTipo READONLY,
    @Hoy                 date = NULL
AS
BEGIN
    SET NOCOUNT ON; SET XACT_ABORT ON;
    IF NULLIF(LTRIM(RTRIM(@Usuario)), N'') IS NULL
        THROW 51001, N'Falta el usuario autenticado: no se guarda nada sin atribucion.', 1;
    IF EXISTS (SELECT 1 FROM (SELECT Categoria FROM @Pcts UNION ALL SELECT Categoria FROM @Agregar) AS x
               GROUP BY LTRIM(RTRIM(REPLACE(x.Categoria, NCHAR(160), N' '))) HAVING COUNT(*) > 1)
       OR EXISTS (SELECT 1 FROM @FechasCategoria
                  GROUP BY LTRIM(RTRIM(REPLACE(Categoria, NCHAR(160), N' '))) HAVING COUNT(*) > 1)
        THROW 51003, N'Una categoria viene repetida.', 1;
    IF EXISTS (SELECT 1 FROM (SELECT Categoria FROM @Pcts UNION ALL SELECT Categoria FROM @Agregar
                              UNION ALL SELECT Categoria FROM @FechasCategoria) AS x
               WHERE NULLIF(LTRIM(RTRIM(REPLACE(x.Categoria, NCHAR(160), N' '))), N'') IS NULL)
        THROW 51004, N'Una categoria llego vacia.', 1;
    IF EXISTS (SELECT 1 FROM (SELECT Pct FROM @Pcts UNION ALL SELECT Pct FROM @Agregar) AS x WHERE x.Pct < 0 OR x.Pct > 1)
        THROW 51005, N'El % de una categoria esta fuera de 0-100.', 1;
    IF EXISTS (SELECT 1 FROM (SELECT TipoIniciativa FROM @Agregar UNION ALL SELECT TipoIniciativa FROM @Pcts) AS x
                  WHERE NULLIF(LTRIM(RTRIM(x.TipoIniciativa)), N'') IS NOT NULL
                    AND NOT EXISTS (SELECT 1 FROM dbo.Problem AS p WHERE LTRIM(RTRIM(p.TipoIniciativa)) = LTRIM(RTRIM(x.TipoIniciativa))))
        THROW 51011, N'Tipo de iniciativa de una categoria que no existe en dbo.Problem.', 1;
    IF EXISTS (SELECT 1 FROM (SELECT TipoAgrupado FROM @Agregar UNION ALL SELECT TipoAgrupado FROM @Pcts) AS x
                  WHERE NULLIF(LTRIM(RTRIM(x.TipoAgrupado)), N'') IS NOT NULL
                    AND NOT EXISTS (SELECT 1 FROM dbo.ProblemCategoria AS pc WHERE LTRIM(RTRIM(pc.TipoAgrupado)) = LTRIM(RTRIM(x.TipoAgrupado))))
        THROW 51012, N'Agrupacion (TipoAgrupado) de una categoria que no existe en dbo.ProblemCategoria.', 1;
    IF @CambiaEstado = 1
       AND (NULLIF(LTRIM(RTRIM(@Estado)), N'') IS NULL
            OR NOT EXISTS (SELECT 1 FROM dbo.Problem WHERE LTRIM(RTRIM(Estado)) = LTRIM(RTRIM(@Estado))))
        THROW 51013, N'El Estado no es uno de los que ya existen en dbo.Problem.', 1;
    IF EXISTS (SELECT 1 FROM @FechasCategoria WHERE FechaAnalisis IS NULL)
        THROW 51017, N'La fecha de analisis de una categoria no se puede vaciar.', 1;
    IF EXISTS (SELECT 1 FROM @Agregar AS c
               WHERE NOT EXISTS (SELECT 1 FROM dbo.Categorias AS k
                                 WHERE k.VigenteEnOrigen = 1 AND k.RutaCompleta = LTRIM(RTRIM(REPLACE(c.Categoria, NCHAR(160), N' ')))))
        THROW 51015, N'Una categoria no esta (vigente) en dbo.Categorias.', 1;
    IF @CambiaEstado = 1 SET @Estado = LTRIM(RTRIM(@Estado));

    DECLARE @hoyMx date = COALESCE(@Hoy, CONVERT(date, DATEADD(HOUR, -6, SYSUTCDATETIME())));

    BEGIN TRY
        BEGIN TRAN;
            -- Igual que en Crear: antes de bloquear filas de dbo.Problem.
            DECLARE @rcProt int;
            EXEC @rcProt = sp_getapplock @Resource = N'adm.proteccion', @LockMode = 'Shared',
                                         @LockOwner = 'Transaction', @LockTimeout = 15000;
            IF @rcProt < 0 THROW 51026, N'La carga del Excel esta corriendo y no termino a tiempo. Intenta de nuevo.', 1;

            DECLARE @estadoAntes nvarchar(100), @estadoFinal nvarchar(100);
            SELECT @estadoAntes = p.Estado,
                   @estadoFinal = CASE WHEN @CambiaEstado = 1 THEN @Estado ELSE p.Estado END
            FROM dbo.Problem AS p WITH (UPDLOCK, HOLDLOCK)
            WHERE p.Codigo = @Codigo;
            IF @@ROWCOUNT = 0 THROW 51006, N'La iniciativa no existe.', 1;

            IF EXISTS (SELECT 1 FROM (SELECT Categoria FROM @Pcts UNION ALL SELECT Categoria FROM @FechasCategoria) AS x
                       WHERE NOT EXISTS (SELECT 1 FROM dbo.ProblemCategoria AS pc WITH (UPDLOCK, HOLDLOCK)
                                         WHERE pc.Codigo = @Codigo AND pc.VigenteEnOrigen = 1
                                           AND pc.Categoria = LTRIM(RTRIM(REPLACE(x.Categoria, NCHAR(160), N' ')))))
                THROW 51007, N'Un cambio es de una categoria que no esta ligada (vigente) a esta iniciativa.', 1;
            IF EXISTS (SELECT 1 FROM @Agregar AS x
                       INNER JOIN dbo.ProblemCategoria AS pc WITH (UPDLOCK, HOLDLOCK)
                               ON pc.Codigo = @Codigo
                              AND pc.Categoria = LTRIM(RTRIM(REPLACE(x.Categoria, NCHAR(160), N' '))))
                THROW 51008, N'La categoria ya esta ligada a esta iniciativa (o lo estuvo y se dio de baja).', 1;

            -- Fecha de una categoria que HEREDA = fecha de la iniciativa.
            DECLARE @heredadas int, @fHeredada date;
            SELECT @heredadas = COUNT(DISTINCT f.FechaAnalisis), @fHeredada = MIN(f.FechaAnalisis)
            FROM @FechasCategoria AS f
            INNER JOIN dbo.ProblemCategoria AS pc
                    ON pc.Codigo = @Codigo
                   AND pc.Categoria = LTRIM(RTRIM(REPLACE(f.Categoria, NCHAR(160), N' ')))
            WHERE pc.FechaAnalisisCategoria IS NULL;
            IF @heredadas > 1 OR (@heredadas = 1 AND @CambiaFAnalisis = 1 AND ISNULL(@FAnalisis, '19000101') <> @fHeredada)
                THROW 51016, N'Las categorias que heredan la fecha de la iniciativa comparten UNA fecha de analisis: llegaron dos distintas.', 1;
            IF @heredadas = 1 SELECT @CambiaFAnalisis = 1, @FAnalisis = @fHeredada;

            -- Como queda cada categoria vigente (+ las que se ligan).
            DECLARE @final TABLE (Categoria nvarchar(450) PRIMARY KEY, PctAntes decimal(9,4), PctDespues decimal(9,4),
                                  AgrupAntes nvarchar(100), AgrupDespues nvarchar(100), Nueva bit);
            INSERT @final (Categoria, PctAntes, PctDespues, AgrupAntes, AgrupDespues, Nueva)
            SELECT pc.Categoria, pc.PctDisminucion,
                   CASE WHEN x.Categoria IS NULL THEN pc.PctDisminucion ELSE x.Pct END,
                   pc.TipoAgrupado,
                   COALESCE(NULLIF(LTRIM(RTRIM(x.TipoAgrupado)), N''), pc.TipoAgrupado), 0
            FROM dbo.ProblemCategoria AS pc
            LEFT JOIN @Pcts AS x ON pc.Categoria = LTRIM(RTRIM(REPLACE(x.Categoria, NCHAR(160), N' ')))
            WHERE pc.Codigo = @Codigo AND pc.VigenteEnOrigen = 1;
            INSERT @final (Categoria, PctAntes, PctDespues, AgrupAntes, AgrupDespues, Nueva)
            SELECT LTRIM(RTRIM(REPLACE(x.Categoria, NCHAR(160), N' '))), NULL, x.Pct, NULL, NULLIF(LTRIM(RTRIM(x.TipoAgrupado)), N''), 1
            FROM @Agregar AS x;

            DECLARE @vivoAntes bit = CASE WHEN LTRIM(RTRIM(@estadoAntes)) COLLATE Latin1_General_CI_AI
                                               IN (N'En Analisis', N'En Solucion', N'En Monitoreo') THEN 1 ELSE 0 END;
            DECLARE @vivoFinal bit = CASE WHEN LTRIM(RTRIM(@estadoFinal)) COLLATE Latin1_General_CI_AI
                                               IN (N'En Analisis', N'En Solucion', N'En Monitoreo') THEN 1 ELSE 0 END;
            DECLARE @tocaCapacidad bit = CASE WHEN @CambiaEstado = 1 OR EXISTS (SELECT 1 FROM @Pcts)
                                                   OR EXISTS (SELECT 1 FROM @Agregar) THEN 1 ELSE 0 END;

            IF @tocaCapacidad = 1 AND @vivoFinal = 1
            BEGIN
                -- Una fila sin agrupacion se revisa como si consumiera
                -- (conservador): no se salta el tope por falta del dato.
                DECLARE @revisar adm.CategoriaPctTipo;
                INSERT @revisar (Categoria, Pct)
                SELECT f.Categoria, f.PctDespues
                FROM @final AS f
                WHERE (NULLIF(LTRIM(RTRIM(f.AgrupDespues)), N'') IS NULL OR LTRIM(RTRIM(f.AgrupDespues)) COLLATE Latin1_General_CI_AI IN (N'Problem', N'SorIA', N'Adopcion', N'Mejora'))
                  AND ISNULL(f.PctDespues, 0) > 0
                  AND (f.Nueva = 1
                       OR ISNULL(f.PctDespues, 0) > ISNULL(f.PctAntes, 0)
                       OR NOT (@vivoAntes = 1 AND (NULLIF(LTRIM(RTRIM(f.AgrupAntes)), N'') IS NULL
                                                   OR LTRIM(RTRIM(f.AgrupAntes)) COLLATE Latin1_General_CI_AI IN (N'Problem', N'SorIA', N'Adopcion', N'Mejora'))));
                IF EXISTS (SELECT 1 FROM @revisar)
                    EXEC adm.usp_GestionAdmin_RevisarTope @Codigo = @Codigo, @Revisar = @revisar;
            END;

            EXEC sys.sp_set_session_context @key = N'pfe_origen', @value = 'ADMIN';
            EXEC sys.sp_set_session_context @key = N'pfe_usuario', @value = @Usuario;
            EXEC sys.sp_set_session_context @key = N'pfe_solicitud', @value = NULL;

            -- Lo editable como estaba (filas ya bloqueadas arriba): al final, solo
            -- si algo de esto cambio se protege la iniciativa. Textos en binario:
            -- un cambio de mayusculas o de espacios tambien es un cambio.
            SELECT Titulo = CONVERT(varbinary(max), Titulo), Descripcion = CONVERT(varbinary(max), Descripcion),
                   Observaciones = CONVERT(varbinary(max), Observaciones), Estado = CONVERT(varbinary(max), Estado),
                   Subestado = CONVERT(varbinary(max), Subestado), FechaAnalisis, FechaSolucion, FechaCierre
            INTO #antesP FROM dbo.Problem WHERE Codigo = @Codigo;
            SELECT Categoria = CONVERT(varbinary(max), Categoria), PctDisminucion,
                   TipoIniciativa = CONVERT(varbinary(max), TipoIniciativa), TipoAgrupado = CONVERT(varbinary(max), TipoAgrupado),
                   FechaAnalisisCategoria, VigenteEnOrigen
            INTO #antesC FROM dbo.ProblemCategoria WHERE Codigo = @Codigo;

            DECLARE @ultimoEvento int = (SELECT ISNULL(MAX(IdEvento), 0) FROM dbo.ProblemFechaEvento);

            UPDATE dbo.Problem SET
                Titulo        = CASE WHEN @CambiaTitulo = 1        THEN @Titulo        ELSE Titulo END,
                Descripcion   = CASE WHEN @CambiaDescripcion = 1   THEN @Descripcion   ELSE Descripcion END,
                Observaciones = CASE WHEN @CambiaObservaciones = 1 THEN @Observaciones ELSE Observaciones END,
                Estado        = CASE WHEN @CambiaEstado = 1        THEN @Estado        ELSE Estado END,
                Subestado     = CASE WHEN @CambiaSubestado = 1     THEN @Subestado     ELSE Subestado END,
                FechaAnalisis = CASE WHEN @CambiaFAnalisis = 1     THEN @FAnalisis     ELSE FechaAnalisis END,
                FechaSolucion = CASE WHEN @CambiaFSolucion = 1     THEN @FSolucion     ELSE FechaSolucion END,
                FechaCierre   = CASE WHEN @CambiaFCierre = 1       THEN @FCierre       ELSE FechaCierre END
            WHERE Codigo = @Codigo
              AND (@CambiaTitulo | @CambiaDescripcion | @CambiaObservaciones | @CambiaEstado |
                   @CambiaSubestado | @CambiaFAnalisis | @CambiaFSolucion | @CambiaFCierre) = 1;

            -- NroCambioFecha*: los cambios que cuentan de lo que el trigger
            -- acaba de escribir para esta iniciativa (la fila de dbo.Problem
            -- esta bloqueada: nadie mas escribe sus eventos ahora).
            DECLARE @nA int, @nS int, @nC int;
            SELECT @nA = SUM(CASE WHEN e.Campo = 'FechaAnalisis' THEN 1 ELSE 0 END),
                   @nS = SUM(CASE WHEN e.Campo = 'FechaSolucion' THEN 1 ELSE 0 END),
                   @nC = SUM(CASE WHEN e.Campo = 'FechaCierre' AND e.FechaNueva > e.FechaAnterior THEN 1 ELSE 0 END)
            FROM dbo.ProblemFechaEvento AS e
            WHERE e.IdEvento > @ultimoEvento AND e.Codigo = @Codigo AND e.Categoria IS NULL
              AND e.Operacion = 'U' AND e.FechaAnterior IS NOT NULL AND e.FechaNueva IS NOT NULL;
            IF ISNULL(@nA, 0) + ISNULL(@nS, 0) + ISNULL(@nC, 0) > 0
                UPDATE dbo.Problem SET
                    NroCambioFechaAnalisis = ISNULL(NroCambioFechaAnalisis, 0) + ISNULL(@nA, 0),
                    NroCambioFechaSolucion = ISNULL(NroCambioFechaSolucion, 0) + ISNULL(@nS, 0),
                    NroCambioFechaCierre   = ISNULL(NroCambioFechaCierre, 0)   + ISNULL(@nC, 0)
                WHERE Codigo = @Codigo;

            UPDATE pc SET
                pc.PctDisminucion = x.Pct,
                pc.TipoIniciativa = COALESCE(NULLIF(LTRIM(RTRIM(x.TipoIniciativa)), N''), pc.TipoIniciativa),
                pc.TipoAgrupado   = COALESCE(NULLIF(LTRIM(RTRIM(x.TipoAgrupado)), N''), pc.TipoAgrupado)
            FROM dbo.ProblemCategoria AS pc
            INNER JOIN @Pcts AS x
                    ON pc.Codigo = @Codigo
                   AND pc.Categoria = LTRIM(RTRIM(REPLACE(x.Categoria, NCHAR(160), N' ')));

            -- Fecha propia de una ligada: solo las que YA tienen fecha propia
            -- (las que heredan se movieron arriba, en la de la iniciativa).
            UPDATE pc SET pc.FechaAnalisisCategoria = f.FechaAnalisis
            FROM dbo.ProblemCategoria AS pc
            INNER JOIN @FechasCategoria AS f
                    ON pc.Codigo = @Codigo
                   AND pc.Categoria = LTRIM(RTRIM(REPLACE(f.Categoria, NCHAR(160), N' ')))
            WHERE pc.FechaAnalisisCategoria IS NOT NULL
              AND pc.FechaAnalisisCategoria <> f.FechaAnalisis;

            -- Ligadas ahora: fechas PROPIAS (hoy y hoy + 15) y los tipos que vengan (NULL si no).
            INSERT dbo.ProblemCategoria (Codigo, Categoria, TipoIniciativa, TipoAgrupado, PctDisminucion,
                                         VigenteEnOrigen, FechaCreacionCategoria, FechaAnalisisCategoria)
            SELECT @Codigo, LTRIM(RTRIM(REPLACE(x.Categoria, NCHAR(160), N' '))),
                   NULLIF(LTRIM(RTRIM(x.TipoIniciativa)), N''), NULLIF(LTRIM(RTRIM(x.TipoAgrupado)), N''),
                   x.Pct, 1, @hoyMx, DATEADD(DAY, 15, @hoyMx)
            FROM @Agregar AS x;

            DECLARE @tr adm.CategoriaPctTipo;
            INSERT @tr (Categoria) SELECT Categoria FROM @Agregar UNION SELECT Categoria FROM @Pcts;
            IF EXISTS (SELECT 1 FROM @tr)
                EXEC adm.usp_GestionAdmin_TicketsReduce @Codigo = @Codigo, @Categorias = @tr;

            -- Modificar = Admin toma la iniciativa ENTERA (decidido 2026-10-14): el
            -- Excel ya no la pisa. Solo si algo editable cambio de verdad: una
            -- llamada sin cambios (o con los mismos valores) no se la quita al
            -- Excel. Si ya estaba protegida se queda como estaba (motivo y fecha).
            IF EXISTS (SELECT CONVERT(varbinary(max), Titulo), CONVERT(varbinary(max), Descripcion),
                              CONVERT(varbinary(max), Observaciones), CONVERT(varbinary(max), Estado),
                              CONVERT(varbinary(max), Subestado), FechaAnalisis, FechaSolucion, FechaCierre
                       FROM dbo.Problem WHERE Codigo = @Codigo
                       EXCEPT SELECT * FROM #antesP)
               OR EXISTS (SELECT CONVERT(varbinary(max), Categoria), PctDisminucion, CONVERT(varbinary(max), TipoIniciativa),
                                 CONVERT(varbinary(max), TipoAgrupado), FechaAnalisisCategoria, VigenteEnOrigen
                          FROM dbo.ProblemCategoria WHERE Codigo = @Codigo
                          EXCEPT SELECT * FROM #antesC)
               OR EXISTS (SELECT * FROM #antesC
                          EXCEPT SELECT CONVERT(varbinary(max), Categoria), PctDisminucion, CONVERT(varbinary(max), TipoIniciativa),
                                        CONVERT(varbinary(max), TipoAgrupado), FechaAnalisisCategoria, VigenteEnOrigen
                          FROM dbo.ProblemCategoria WHERE Codigo = @Codigo)
                INSERT adm.IniciativaProtegida (Codigo, Motivo, Usuario)
                SELECT @Codigo, 'MODIFICACION', @Usuario
                WHERE NOT EXISTS (SELECT 1 FROM adm.IniciativaProtegida WHERE Codigo = @Codigo);
            DROP TABLE #antesP; DROP TABLE #antesC;

            EXEC sys.sp_set_session_context @key = N'pfe_origen', @value = NULL;
            EXEC sys.sp_set_session_context @key = N'pfe_usuario', @value = NULL;
        COMMIT;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK;
        EXEC sys.sp_set_session_context @key = N'pfe_origen', @value = NULL;
        EXEC sys.sp_set_session_context @key = N'pfe_usuario', @value = NULL;
        THROW;
    END CATCH;
END;
GO
IF @@TRANCOUNT = 0 BEGIN RAISERROR (N'Rollback 22: transaccion cerrada.', 16, 1); SET NOEXEC ON; END;
GO
IF OBJECT_ID('tempdb..#p22') IS NOT NULL DROP TABLE #p22;
SELECT v.Objeto, v.Esperado, Hash = HASHBYTES('SHA2_256', REPLACE(REPLACE(REPLACE(REPLACE(
                   OBJECT_DEFINITION(OBJECT_ID(v.Objeto, 'P')),
                   N' ', N''), NCHAR(9), N''), NCHAR(13), N''), NCHAR(10), N''))
INTO #p22
FROM (VALUES (N'adm.usp_GestionAdmin_Modificar', 0x4E3A69887120832C215FFAF68DFF2792BDE7272CD75B3B0FC399A424050583C3)) AS v (Objeto, Esperado);
IF NOT EXISTS (SELECT 1 FROM #p22 WHERE Hash IS NULL OR Hash <> Esperado)
   AND OBJECT_ID('adm.SolicitudCambio', 'U') IS NULL AND TYPE_ID('adm.SolicitudCategoriaTipo') IS NULL
   AND TYPE_ID('adm.SolicitudClasificacionTipo') IS NULL AND OBJECT_ID('adm.usp_SolicitudCambio_RegistrarFallo', 'P') IS NULL
BEGIN
    COMMIT;
    SELECT Rollback_ = N'22', Resultado = 'DESHECHA';
END
ELSE
BEGIN
    ROLLBACK;
    RAISERROR (N'Rollback 22: Modificar no volvio al texto de sql/21; ROLLBACK de todo.', 16, 1);
END;
GO
SET NOEXEC OFF;
GO
