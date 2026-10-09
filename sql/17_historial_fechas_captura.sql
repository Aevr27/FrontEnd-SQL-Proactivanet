/* =========================================================================
   sql/17_historial_fechas_captura.sql - Captura viva del historial de
   FechaAnalisis / FechaSolucion / FechaCierre en dbo.ProblemFechaEvento.

   QUE HACE (todo en UNA transaccion, UN solo lote sin GO)
   1. Comprueba el punto de partida: la tabla existe, el trigger no existe
      todavia, ningun otro trigger de dbo.Problem escribe la tabla, y lo que
      hay en ella es solo la importacion del Excel (Operacion 'U',
      NO_DECLARADO).
   2. Linea base OPCIONAL (@LineaBase):
        'NINGUNA'        no escribe filas 'B'.
        'SIN_HISTORIAL'  una fila 'B' (FechaAnterior NULL, FechaNueva = valor
                         actual) por cada fecha NO NULL de dbo.Problem cuyo
                         Codigo+Campo NO tenga ya eventos (los de la
                         importacion ya dicen de donde parten). Va ANTES del
                         trigger, con dbo.Problem bloqueada, para que ningun
                         cambio caiga entre la linea base y la captura.
        NULL             se niega: es una decision, no un default.
      Se elige ahora porque una linea base puesta DESPUES quedaria con
      IdEvento posterior a los cambios ya capturados.
   3. Crea dbo.trg_Problem_FechaEvento (AFTER INSERT, UPDATE), el de
      sql/PROPUESTA_historial_fechas.md seccion 5: una fila por fecha que
      cambia de verdad a nivel dia; INSERT de Problem = 'I'; UPDATE = 'U';
      Origen ADMIN solo si la sesion lo declara (SESSION_CONTEXT
      pfe_origen / pfe_usuario / pfe_solicitud), si no NO_DECLARADO.
   4. Se prueba a si mismo sobre UNA fila real de dbo.Problem, dentro de un
      punto de guardado que luego se deshace:
        a. reescribir sus tres fechas con el mismo valor -> 0 eventos;
        b. mover un dia una fecha no NULL                 -> 1 evento 'U'.
      Al deshacer el punto de guardado, dbo.Problem y los triggers de otros
      (trg_Problem_EstadoEvento) quedan como estaban; solo se consumen
      valores de IDENTITY.
   5. Si @Confirmar = 1 y todo cuadra: COMMIT. Si no: ROLLBACK de todo (ni
      linea base ni trigger).
   6. Solo si hubo COMMIT, en su PROPIA transaccion que siempre se deshace:
      declarar ADMIN sin usuario y mover una fecha -> debe rechazarse. (Un
      error dentro de un trigger deja la transaccion sin poder confirmarse,
      por eso no va en la del paso 5.)

   NO TOCA: dbo.Problem (su esquema ni sus datos), usp_CargarExperiencia, ni
   trg_Problem_EstadoEvento. No crea el guard de solo-agregar (va aparte:
   despues de el, deshacer la importacion requiere desactivarlo).

   RIESGO: con el trigger puesto, si este falla, falla la sentencia que lo
   disparo (la carga del Excel incluida) y se deshace entera. Las causas
   esperables estan cubiertas (ver PROPUESTA seccion 5); la prueba 4 lo
   ejercita sobre una fila real antes del COMMIT.

   COMO CORRERLO (SSMS, base Tickets_Proactivanet, en la VM, sin carga del
   Excel corriendo)
   - Primero tal cual (@Confirmar = 0): ensayo, termina en ROLLBACK.
   - Luego @Confirmar = 1. Pegar la salida.
   - Deshacer: sql/17_historial_fechas_captura_rollback.sql.
   ========================================================================= */
SET NOCOUNT ON;
SET XACT_ABORT ON;

DECLARE @LineaBase varchar(13) = NULL;   -- 'NINGUNA' | 'SIN_HISTORIAL'
DECLARE @Confirmar bit = 0;              -- 1 = COMMIT si todas las pruebas pasan

/* ---------- 1. Punto de partida (solo lectura) ---------- */
DECLARE @tabla bit = CASE WHEN OBJECT_ID(N'dbo.ProblemFechaEvento', N'U') IS NULL THEN 0 ELSE 1 END;
DECLARE @yaExiste bit = CASE WHEN OBJECT_ID(N'dbo.trg_Problem_FechaEvento', N'TR') IS NULL THEN 0 ELSE 1 END;
DECLARE @otroEscribe int = (
    SELECT COUNT(*) FROM sys.triggers AS tr
    JOIN sys.sql_expression_dependencies AS d ON d.referencing_id = tr.object_id
    WHERE tr.parent_id = OBJECT_ID(N'dbo.Problem')
      AND d.referenced_id = OBJECT_ID(N'dbo.ProblemFechaEvento'));
DECLARE @filas int = 0, @filasOtras int = 0;
IF @tabla = 1
    SELECT @filas = COUNT(*),
           @filasOtras = SUM(CASE WHEN Operacion = 'U' AND Origen = 'NO_DECLARADO' AND Usuario IS NULL THEN 0 ELSE 1 END)
    FROM dbo.ProblemFechaEvento;

SELECT Seccion = '1 partida', TablaExiste = @tabla, TriggerYaExiste = @yaExiste,
       OtrosTriggersQueEscriben = @otroEscribe, FilasHoy = @filas, FilasNoImportacion = ISNULL(@filasOtras, 0),
       TriggersEnProblem = (SELECT COUNT(*) FROM sys.triggers WHERE parent_id = OBJECT_ID(N'dbo.Problem')),
       -- Otros modulos que usen las mismas llaves de SESSION_CONTEXT (pfe_*): debe ser 0.
       OtrosConLlavesPfe = (SELECT COUNT(*) FROM sys.sql_modules AS m
                            WHERE m.definition LIKE N'%pfe[_]origen%' OR m.definition LIKE N'%pfe[_]usuario%'
                               OR m.definition LIKE N'%pfe[_]solicitud%');

IF @LineaBase IS NULL OR @LineaBase NOT IN ('NINGUNA', 'SIN_HISTORIAL')
BEGIN
    SELECT Seccion = 'omitido', Motivo = 'Falta @LineaBase (NINGUNA o SIN_HISTORIAL). No se cambio nada.';
    RETURN;
END;
IF @tabla = 0 OR @yaExiste = 1 OR @otroEscribe > 0 OR ISNULL(@filasOtras, 0) > 0
   OR EXISTS (SELECT 1 FROM sys.sql_modules AS m
              WHERE m.definition LIKE N'%pfe[_]origen%' OR m.definition LIKE N'%pfe[_]usuario%'
                 OR m.definition LIKE N'%pfe[_]solicitud%')
BEGIN
    SELECT Seccion = 'omitido', Motivo = 'El punto de partida no es el esperado (ver 1 partida). No se cambio nada.';
    RETURN;
END;

-- Vista previa de la linea base (solo lectura).
SELECT Seccion = '2 linea base prevista', Modo = @LineaBase, v.Campo, Filas = COUNT(*)
FROM dbo.Problem AS p
CROSS APPLY (VALUES ('FechaAnalisis', CONVERT(date, p.FechaAnalisis)),
                    ('FechaSolucion', CONVERT(date, p.FechaSolucion)),
                    ('FechaCierre',   CONVERT(date, p.FechaCierre))) AS v (Campo, Valor)
WHERE @LineaBase = 'SIN_HISTORIAL' AND v.Valor IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM dbo.ProblemFechaEvento AS e WHERE e.Codigo = p.Codigo AND e.Campo = v.Campo)
GROUP BY v.Campo;

/* ---------- 2-5. Cambio, en transaccion ---------- */
BEGIN TRAN;

-- Nadie escribe dbo.Problem hasta el COMMIT: ningun cambio queda entre la
-- linea base y el trigger.
DECLARE @bloqueo int = (SELECT COUNT(*) FROM dbo.Problem WITH (TABLOCKX, HOLDLOCK));

DECLARE @base int = 0;
IF @LineaBase = 'SIN_HISTORIAL'
BEGIN
    INSERT INTO dbo.ProblemFechaEvento (Codigo, Campo, FechaAnterior, FechaNueva, Operacion, Origen)
    SELECT p.Codigo, v.Campo, NULL, v.Valor, 'B', 'NO_DECLARADO'
    FROM dbo.Problem AS p
    CROSS APPLY (VALUES ('FechaAnalisis', CONVERT(date, p.FechaAnalisis)),
                        ('FechaSolucion', CONVERT(date, p.FechaSolucion)),
                        ('FechaCierre',   CONVERT(date, p.FechaCierre))) AS v (Campo, Valor)
    WHERE v.Valor IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM dbo.ProblemFechaEvento AS e WHERE e.Codigo = p.Codigo AND e.Campo = v.Campo)
    ORDER BY p.Codigo, v.Campo;
    SET @base = @@ROWCOUNT;
END;

EXEC (N'
CREATE TRIGGER dbo.trg_Problem_FechaEvento
ON dbo.Problem
AFTER INSERT, UPDATE
AS
BEGIN
    /* Historial de FechaAnalisis/FechaSolucion/FechaCierre: una fila en
       dbo.ProblemFechaEvento por fecha que cambia de verdad (a nivel dia).
       Lo crea sql/17_historial_fechas_captura.sql; diseno en
       sql/PROPUESTA_historial_fechas.md seccion 5. */
    SET NOCOUNT ON;

    IF NOT EXISTS (SELECT 1 FROM inserted) RETURN;
    IF NOT (UPDATE(FechaAnalisis) OR UPDATE(FechaSolucion) OR UPDATE(FechaCierre)) RETURN;

    DECLARE @esAdmin bit =
        CASE WHEN CONVERT(varchar(12), SESSION_CONTEXT(N''pfe_origen'')) = ''ADMIN'' THEN 1 ELSE 0 END;
    DECLARE @usuario nvarchar(256) =
        CASE WHEN @esAdmin = 1 THEN CONVERT(nvarchar(256), SESSION_CONTEXT(N''pfe_usuario'')) END;
    DECLARE @solicitud int =
        CASE WHEN @esAdmin = 1 THEN TRY_CONVERT(int, SESSION_CONTEXT(N''pfe_solicitud'')) END;

    INSERT dbo.ProblemFechaEvento
           (Codigo, Campo, FechaAnterior, FechaNueva, Operacion, Origen, Usuario, SolicitudId)
    SELECT i.Codigo, v.Campo, v.Anterior, v.Nueva,
           CASE WHEN d.Codigo IS NULL THEN ''I'' ELSE ''U'' END,
           CASE WHEN @esAdmin = 1 THEN ''ADMIN'' ELSE ''NO_DECLARADO'' END,
           @usuario, @solicitud
    FROM inserted AS i
    LEFT JOIN deleted AS d ON d.Codigo = i.Codigo
    CROSS APPLY (VALUES
        (''FechaAnalisis'', CONVERT(date, d.FechaAnalisis), CONVERT(date, i.FechaAnalisis)),
        (''FechaSolucion'', CONVERT(date, d.FechaSolucion), CONVERT(date, i.FechaSolucion)),
        (''FechaCierre'',   CONVERT(date, d.FechaCierre),   CONVERT(date, i.FechaCierre))
    ) AS v (Campo, Anterior, Nueva)
    WHERE EXISTS (SELECT v.Anterior EXCEPT SELECT v.Nueva);
END;');

/* ---------- 4. Pruebas sobre una fila real (se deshacen) ---------- */
DECLARE @cod nvarchar(100), @campo varchar(13);
SELECT TOP (1) @cod = p.Codigo,
       @campo = CASE WHEN p.FechaCierre IS NOT NULL THEN 'FechaCierre'
                     WHEN p.FechaSolucion IS NOT NULL THEN 'FechaSolucion' ELSE 'FechaAnalisis' END
FROM dbo.Problem AS p
WHERE p.FechaAnalisis IS NOT NULL OR p.FechaSolucion IS NOT NULL OR p.FechaCierre IS NOT NULL
ORDER BY p.Codigo;

DECLARE @tA int = -1, @tB int = -1, @tC int = NULL, @n0 int, @tBok bit = 0;

SAVE TRANSACTION pruebas;

SET @n0 = (SELECT COUNT(*) FROM dbo.ProblemFechaEvento);
UPDATE dbo.Problem SET FechaAnalisis = FechaAnalisis, FechaSolucion = FechaSolucion, FechaCierre = FechaCierre
WHERE Codigo = @cod;
SET @tA = (SELECT COUNT(*) FROM dbo.ProblemFechaEvento) - @n0;

SET @n0 = (SELECT COUNT(*) FROM dbo.ProblemFechaEvento);
IF @campo = 'FechaCierre'        UPDATE dbo.Problem SET FechaCierre   = DATEADD(day, 1, FechaCierre)   WHERE Codigo = @cod;
ELSE IF @campo = 'FechaSolucion' UPDATE dbo.Problem SET FechaSolucion = DATEADD(day, 1, FechaSolucion) WHERE Codigo = @cod;
ELSE                             UPDATE dbo.Problem SET FechaAnalisis = DATEADD(day, 1, FechaAnalisis) WHERE Codigo = @cod;
SET @tB = (SELECT COUNT(*) FROM dbo.ProblemFechaEvento) - @n0;
IF EXISTS (SELECT 1 FROM dbo.ProblemFechaEvento
           WHERE IdEvento = (SELECT MAX(IdEvento) FROM dbo.ProblemFechaEvento)
             AND Codigo = @cod AND Campo = @campo AND Operacion = 'U' AND Origen = 'NO_DECLARADO'
             AND Usuario IS NULL AND DATEDIFF(day, FechaAnterior, FechaNueva) = 1)
    SET @tBok = 1;

IF XACT_STATE() = 1
    ROLLBACK TRANSACTION pruebas;

DECLARE @ok bit = CASE WHEN XACT_STATE() = 1 AND @tA = 0 AND @tB = 1 AND @tBok = 1
                         AND OBJECT_ID(N'dbo.trg_Problem_FechaEvento', N'TR') IS NOT NULL THEN 1 ELSE 0 END;

SELECT Seccion = '4 pruebas', FilaDePrueba = @cod, CampoMovido = @campo,
       A_mismoValor_0 = @tA, B_unDia_1 = @tB, B_filaCorrecta = @tBok,
       LineaBaseInsertada = @base,
       Accion = CASE WHEN @ok = 1 AND @Confirmar = 1 THEN 'COMMIT' ELSE 'ROLLBACK' END;

IF @ok = 1 AND @Confirmar = 1
    COMMIT;
ELSE IF XACT_STATE() <> 0
    ROLLBACK;

/* ---------- 6. ADMIN sin usuario (solo con el trigger ya confirmado) ---------- */
IF @ok = 1 AND @Confirmar = 1
BEGIN
    SET XACT_ABORT OFF;
    BEGIN TRAN;
    EXEC sys.sp_set_session_context @key = N'pfe_origen', @value = N'ADMIN';
    BEGIN TRY
        UPDATE dbo.Problem SET FechaAnalisis = DATEADD(day, 2, ISNULL(FechaAnalisis, '2000-01-01')) WHERE Codigo = @cod;
        SET @tC = 0;
    END TRY
    BEGIN CATCH
        SET @tC = CASE WHEN ERROR_NUMBER() = 547 THEN 1 ELSE -ERROR_NUMBER() END;
    END CATCH;
    IF XACT_STATE() <> 0 ROLLBACK;   -- siempre: dbo.Problem queda igual
    EXEC sys.sp_set_session_context @key = N'pfe_origen', @value = NULL;
    SET XACT_ABORT ON;
    SELECT Seccion = '6 admin sin usuario', Rechazado = @tC,
           Nota = CASE WHEN @tC = 1 THEN 'OK: rechazado por CK_ProblemFechaEvento_Atribucion'
                       ELSE 'REVISAR: no se rechazo como se esperaba (el trigger quedo puesto)' END;
END;

/* ---------- 7. Como quedo (solo lectura) ---------- */
SELECT Seccion = '7 final',
       TriggerExiste = CASE WHEN OBJECT_ID(N'dbo.trg_Problem_FechaEvento', N'TR') IS NULL THEN 0 ELSE 1 END,
       TriggerActivo = (SELECT CASE WHEN is_disabled = 0 THEN 1 ELSE 0 END FROM sys.triggers
                        WHERE object_id = OBJECT_ID(N'dbo.trg_Problem_FechaEvento')),
       Filas = (SELECT COUNT(*) FROM dbo.ProblemFechaEvento),
       FilasB = (SELECT COUNT(*) FROM dbo.ProblemFechaEvento WHERE Operacion = 'B');
