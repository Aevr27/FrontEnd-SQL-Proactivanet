# PROPOSAL — `dbo.ProblemFechaEvento` (date-change history) — NOT EXECUTED, NOT APPROVED

Status: **proposal only**. None of these objects exist in the database. Nothing
here has been run anywhere. Markdown on purpose: it cannot be executed by
accident. Every SQL block that changes the database is labelled
**NOT EXECUTED** and contains a `{{TIPO_CODIGO}}` placeholder that makes it fail
if pasted as-is (see §1).

Purpose: evidence for the **History of Changes** section of the initiative
detail panel (Initiative list → click name → right-side detail → History of
changes). The current dates stay in `dbo.Problem` and remain the only source of
the current value. The history table is append-only evidence and never feeds
back into `dbo.Problem`.

---

## 0. Facts vs assumptions

### Verified (VM, `sql/diag_admin_historial_fechas.sql`, 2026-10-07)

| # | Fact |
|---|---|
| V1 | SQL Server 16.0.4255.1 (2022, Developer Edition), database compatibility level **150**. `IS DISTINCT FROM` needs level 160, so it is not used. |
| V2 | `PK_Problem` is clustered on **`Codigo`** only. `dbo.Problem` has no identity column. |
| V3 | `FK_ProblemCategoria_Problem` already references `dbo.Problem`. That means TRUNCATE on `Problem` already fails today, and changing or deleting a `Codigo` that has categories is already blocked. |
| V4 | Of the SQL modules containing the text `dbo.Problem`, only `usp_CargarExperiencia` writes it, with **UPDATE and INSERT**: no MERGE, DELETE or TRUNCATE. No module uses `SESSION_CONTEXT` or `CONTEXT_INFO`. |
| V5 | `dbo.Problem` has **0 triggers** (enabled or disabled). |
| V6 | The source is a hand-typed Excel sheet (`DBProblems`). `NroCambioFecha*` are typed by hand (0 formulas) and inconsistent: counter 0 while original ≠ current in 14 Solución / 42 Cierre rows, and shifted-column garbage (e.g. PRB 2026-000177, counter 46289). `FechaOriginal*` is filled in only about 175 of 939 rows, and Análisis has no original at all. |
| V7 | Dates appear as `2026-10-21 00:00:00` in the N6 output, so they are stored as a date/time type with midnight times. **The exact type is not verified.** |
| V8 | Admin does not write to `dbo.Problem` today. "Solicitar cambios" is a browser-only draft with no submission, and `adm.Solicitud` does not exist (it is only proposed in `PROPUESTA_numero_solicitud.md`, not approved). |
| V9 | Frontend contract already waiting: `admin/registro-iniciativas.js` `htmlHistorial` expects `historial: [{campo, anterior, nuevo, fecha, usuario}]`. Today it always arrives empty. |

### Not verified (must be checked before any DDL; see §13 P0)

| # | Open item | Why it matters |
|---|---|---|
| U1 | Exact data type, length and **collation** of `Problem.Codigo` | The FK column must match it exactly. |
| U2 | Exact data type of `FechaAnalisis/FechaSolucion/FechaCierre`, and whether any non-midnight times exist | This decides the comparison rule (§4). |
| U3 | **`cargar_experiencia.py`**: does it only fill staging and call `usp_CargarExperiencia`, or does it also write `dbo.Problem` directly (bcp, `BULK INSERT`, `SqlBulkCopy`, `to_sql`, plain UPDATE/DELETE)? The copy that used to be in Downloads is gone, so this is **NOT closed**. | See §8. |
| U4 | Whether `usp_CargarExperiencia` (or any writer) uses `OUTPUT` **without `INTO`** on `dbo.Problem` | **SQL Server rejects that statement once the table has an enabled trigger (Msg 334). This is the one way the trigger can break the loader outright.** |
| U5 | H3 searched only for the literal `dbo.Problem`. A module that writes `Problem`, `[dbo].[Problem]` or `[Problem]` would not have been detected. | P0 repeats the search with a broader pattern. |
| U6 | Which SQL logins the loader and the web app use | This decides whether `LoginBD` (§7) actually tells writers apart. |
| U7 | Whether a SQL Agent job, or anything outside the database, writes `Problem` | Same reason as U3. |
| U8 | Delete rule of `FK_ProblemCategoria_Problem` | This is context for the DELETE decision (§6). |

---

## 1. Table schema

```sql
-- NOT EXECUTED. Proposal only. {{TIPO_CODIGO}} must be replaced with the exact
-- type + collation of dbo.Problem.Codigo from P0-1 (e.g. nvarchar(20) COLLATE ...).
CREATE TABLE dbo.ProblemFechaEvento
(
    IdEvento      int IDENTITY(1,1) NOT NULL
                  CONSTRAINT PK_ProblemFechaEvento PRIMARY KEY CLUSTERED,
    Codigo        {{TIPO_CODIGO}}   NOT NULL
                  CONSTRAINT FK_ProblemFechaEvento_Problem
                  REFERENCES dbo.Problem (Codigo),          -- NO ACTION (see §6)
    Campo         varchar(13)       NOT NULL
                  CONSTRAINT CK_ProblemFechaEvento_Campo
                  CHECK (Campo IN ('FechaAnalisis', 'FechaSolucion', 'FechaCierre')),
    ValorAnterior date              NULL,
    ValorNuevo    date              NULL,
    Operacion     char(1)           NOT NULL
                  CONSTRAINT CK_ProblemFechaEvento_Operacion
                  CHECK (Operacion IN ('I', 'U', 'B')),     -- Insert / Update / Baseline
    Reconstruido  AS CAST(CASE WHEN Operacion = 'B' THEN 1 ELSE 0 END AS bit),
    Origen        varchar(12)       NOT NULL
                  CONSTRAINT CK_ProblemFechaEvento_Origen
                  CHECK (Origen IN ('ADMIN', 'NO_DECLARADO')),
    Usuario       nvarchar(256)     NULL,
    SolicitudId   int               NULL,
    LoginBD       nvarchar(128)     NOT NULL
                  CONSTRAINT DF_ProblemFechaEvento_LoginBD DEFAULT (ORIGINAL_LOGIN()),
    FechaRegistro datetime2(3)      NOT NULL
                  CONSTRAINT DF_ProblemFechaEvento_FechaRegistro DEFAULT (SYSUTCDATETIME()),

    -- A row is a real transition: never NULL->NULL, never X->X.
    CONSTRAINT CK_ProblemFechaEvento_Transicion CHECK (
        (ValorAnterior IS NOT NULL OR ValorNuevo IS NOT NULL)
        AND (ValorAnterior IS NULL OR ValorNuevo IS NULL OR ValorAnterior <> ValorNuevo)),
    -- Baseline rows only state "value at go-live": no previous value is claimed.
    CONSTRAINT CK_ProblemFechaEvento_Base CHECK (
        Operacion <> 'B' OR (ValorAnterior IS NULL AND ValorNuevo IS NOT NULL)),
    -- Person / request only when the writer declared itself as Admin.
    CONSTRAINT CK_ProblemFechaEvento_Admin CHECK (
        Origen = 'ADMIN' OR (Usuario IS NULL AND SolicitudId IS NULL))
);

CREATE NONCLUSTERED INDEX IX_ProblemFechaEvento_Codigo
    ON dbo.ProblemFechaEvento (Codigo, IdEvento);
```

| Column | Type | Purpose / justification |
|---|---|---|
| `IdEvento` | `int IDENTITY` | Persisted event order and the stable row id. The display number is derived from it (§3). Expected volume is a few thousand rows per year, so `int` is enough. |
| `Codigo` | = `Problem.Codigo` | The initiative, through the verified PK (V2). Type and collation must be copied exactly (U1). |
| `Campo` | `varchar(13)` | Which date changed. It stores the actual column name, so no translation table is needed. |
| `ValorAnterior` / `ValorNuevo` | `date` | The value before and after. NULLs cover `NULL→date`, `date→date` and `date→NULL`. `date` is used because the business value is a calendar day (see §4 on time components). |
| `Operacion` | `char(1)` | `I`: captured on an INSERT into `Problem`. `U`: captured on an UPDATE. `B`: one-time baseline row (§5). It lets the UI tell "created with this date" apart from "changed". |
| `Reconstruido` | computed `bit` | The explicit "not observed, reconstructed" flag the UI checks. It is computed from `Operacion`, so it can never disagree with it. It is **non-persisted** on purpose: persisted or indexed computed columns impose SET-option requirements on every writer session, and the loader's session options are unknown. |
| `Origen` | `varchar(12)` | `ADMIN` only when the writer declared it through `SESSION_CONTEXT`. Everything else is `NO_DECLARADO`, which honestly means "the trigger cannot tell who wrote this". See §7. |
| `Usuario` | `nvarchar(256)` | The person (`DOMAIN\account`), **only** when declared by Admin. Never guessed. |
| `SolicitudId` | `int` | The Admin request number, **only** when declared by Admin. There is no FK because `adm.Solicitud` does not exist. It is `int` to match the proposed `NumeroSolicitud`. Until that flow exists the value is always NULL. |
| `LoginBD` | `nvarchar(128)` | The database principal that ran the statement (`ORIGINAL_LOGIN()`). This is the only writer identity the database can actually prove. It is technical evidence, not a person. Its usefulness depends on U6. |
| `FechaRegistro` | `datetime2(3)` UTC | When the change hit `Problem`. UTC, like the other DW stamps; Admin converts it for display. |

Not included, on purpose: the legacy `NroCambioFecha*` counter (§3, §10),
`FechaOriginal*` (§5), a "fuente/archivo" date (the loader does not provide one,
so it is not verified), a generic table/column name (§9), and an FK on
`SolicitudId` (its table does not exist).

---

## 2. What each transition looks like

| Situation | Row(s) written |
|---|---|
| `UPDATE` sets `FechaSolucion` 27/06 → 15/07 | `Campo=FechaSolucion, Anterior=2026-06-27, Nuevo=2026-07-15, Operacion=U` |
| later 15/07 → 24/07 | a second row `Anterior=2026-07-15, Nuevo=2026-07-24, U` |
| NULL → date | `Anterior=NULL, Nuevo=date, U` |
| date → NULL | `Anterior=date, Nuevo=NULL, U` |
| A → B → A | two rows. Reverting is a real change and is never deduplicated. |
| one UPDATE changes 2 of the 3 dates | two rows (one per field), same statement |
| value written but unchanged | no row |

`dbo.Problem` is never modified by this mechanism.

---

## 3. Event numbering

- `NroCambioFecha*` are **not** read, copied or trusted (V6).
- Nothing is stored as a "change number". It is derived on read from persisted order:

```sql
NumeroCambio = CASE WHEN Operacion = 'U' AND ValorAnterior IS NOT NULL AND ValorNuevo IS NOT NULL
                    THEN COUNT(CASE WHEN Operacion = 'U' AND ValorAnterior IS NOT NULL AND ValorNuevo IS NOT NULL THEN 1 END)
                         OVER (PARTITION BY Codigo, Campo ORDER BY IdEvento ROWS UNBOUNDED PRECEDING)
               END
```

  Only `date → date` updates count as a "change of commitment". `I` and `B` rows
  are the initial value. `NULL → date` and `date → NULL` are shown but not numbered.
  This counting rule is a **business decision to confirm** (approval checklist).
- The order is by `IdEvento`, not `FechaRegistro`. Rows from one statement share a
  timestamp, but there is never more than one row per `(Codigo, Campo)` per statement.

---

## 4. Trigger

```sql
-- NOT EXECUTED. Proposal only.
CREATE TRIGGER dbo.trg_Problem_FechaEvento
ON dbo.Problem
AFTER INSERT, UPDATE
AS
BEGIN
    SET NOCOUNT ON;

    -- Nothing affected, or none of the three columns is in the statement.
    -- (For INSERT, UPDATE() is true for every column.)
    IF NOT EXISTS (SELECT 1 FROM inserted) RETURN;
    IF NOT (UPDATE(FechaAnalisis) OR UPDATE(FechaSolucion) OR UPDATE(FechaCierre)) RETURN;

    -- Declared context (only a future Admin SP sets it; see §7).
    DECLARE @esAdmin bit =
        CASE WHEN CONVERT(varchar(12), SESSION_CONTEXT(N'pfe_origen')) = 'ADMIN' THEN 1 ELSE 0 END;
    DECLARE @usuario nvarchar(256) =
        CASE WHEN @esAdmin = 1 THEN CONVERT(nvarchar(256), SESSION_CONTEXT(N'pfe_usuario')) END;
    DECLARE @solicitud int =
        CASE WHEN @esAdmin = 1 THEN TRY_CONVERT(int, SESSION_CONTEXT(N'pfe_solicitud')) END;

    INSERT dbo.ProblemFechaEvento
           (Codigo, Campo, ValorAnterior, ValorNuevo, Operacion, Origen, Usuario, SolicitudId)
    SELECT i.Codigo, v.Campo, v.Anterior, v.Nuevo,
           CASE WHEN d.Codigo IS NULL THEN 'I' ELSE 'U' END,
           CASE WHEN @esAdmin = 1 THEN 'ADMIN' ELSE 'NO_DECLARADO' END,
           @usuario, @solicitud
    FROM inserted AS i
    LEFT JOIN deleted AS d ON d.Codigo = i.Codigo
    CROSS APPLY (VALUES
        ('FechaAnalisis', CONVERT(date, d.FechaAnalisis), CONVERT(date, i.FechaAnalisis)),
        ('FechaSolucion', CONVERT(date, d.FechaSolucion), CONVERT(date, i.FechaSolucion)),
        ('FechaCierre',   CONVERT(date, d.FechaCierre),   CONVERT(date, i.FechaCierre))
    ) AS v (Campo, Anterior, Nuevo)
    WHERE EXISTS (SELECT v.Anterior EXCEPT SELECT v.Nuevo);   -- NULL-safe "is distinct"
END;
```

How it meets the requirements:

- **Set-based, multi-row.** One INSERT…SELECT over `inserted`/`deleted`, with no cursor and no per-row logic.
- **inserted vs deleted.** They are joined on the PK `Codigo` (V2). For an INSERT, `deleted` is empty, so `Anterior` is NULL and `Operacion='I'`.
- **Real changes only.** `EXISTS (SELECT a EXCEPT SELECT b)` is true for `NULL↔date` and `date↔other date`, and false for `NULL=NULL` and `X=X`. This is the level-150 replacement for `IS DISTINCT FROM`.
- **Unrelated columns.** If the statement does not mention the dates, the trigger exits early. If it does mention them (the loader rewrites all columns), unchanged values fail the `EXCEPT` test and produce no row.
- **No duplicates.** There is one row per `(Codigo, Campo)` per statement, and only when the value differs.
- **Comparison is at `date` granularity.** This is consistent whether the source type is `date`, `datetime` or `datetime2`. A time-only change (00:00 → 13:00 on the same day) produces **no** event, which is intentional because the business value is the day. P0-6 checks that non-midnight times do not exist today (U2). If the column turns out to be a character type, **stop**: the design must change, because `CONVERT` could fail and abort the load.
- **Failure surface is minimal.** By construction no constraint can fail: `Campo` and `Origen` are constants; the transition CHECK is guaranteed by the `WHERE`; `B` is never written by the trigger; `Usuario`/`SolicitudId` are only non-NULL when `ADMIN`; `TRY_CONVERT` is used for `SolicitudId`; and the FK holds because `Codigo` comes from `inserted`. There are no external calls, no dynamic SQL and no result sets.
- **PK changes.** Updating `Codigo` itself would appear as an `I` on the new code. The loader matches rows by `Codigo` and is not expected to change it. Changing a code that has history is also blocked by the new FK, just as V3 already blocks it for categories.
- **Permissions.** `dbo` owns both objects, so ownership chaining applies: the loader's login needs **no** new permission on `ProblemFechaEvento`.

---

## 5. INSERT and the one-time baseline

**New record going forward** (a normal INSERT by the loader or anyone else):
- Each of the 3 dates that is **not NULL** produces one row: `Anterior=NULL, Nuevo=value, Operacion='I', Origen` as declared. Dates that are NULL produce nothing.
- So an initiative born with only `FechaAnalisis` (as 2026 initiatives do, see V7/N6) gets exactly one row.

**Legacy baseline (one-time, separate approval, optional):**
- What it can honestly support: "on go-live day, the current value of field X was Y". Nothing else.
- For each existing `Problem` row and each date that is **not NULL**: insert `Anterior=NULL, Nuevo=current, Operacion='B'` (so `Reconstruido=1`), `Origen='NO_DECLARADO'`. Rows whose date is NULL get nothing.
- It does **not** use `FechaOriginal*`. Writing `original → current` would look like one direct change when an unknown number of intermediate changes happened. Those values are hand-typed and missing in about 80% of rows (V6). `FechaOriginal*` stays a normal attribute of `Problem`, readable as such.
- It does **not** use `NroCambioFecha*` (§10).
- Value: the timeline becomes self-contained, with a first line such as "value when history started: 24/07/2026 (reconstructed)". Even **without** the baseline, the first real change after go-live still records the old value in `ValorAnterior`, so the baseline is a convenience, not a requirement. **Recommendation: load it** (it is cheap and clearly flagged). It can be skipped with no loss of real evidence.

```sql
-- NOT EXECUTED. Proposal only. Runs inside the deployment transaction (§13), BEFORE the trigger exists.
INSERT dbo.ProblemFechaEvento (Codigo, Campo, ValorAnterior, ValorNuevo, Operacion, Origen)
SELECT p.Codigo, v.Campo, NULL, v.Valor, 'B', 'NO_DECLARADO'
FROM dbo.Problem AS p WITH (TABLOCKX, HOLDLOCK)
CROSS APPLY (VALUES
    ('FechaAnalisis', CONVERT(date, p.FechaAnalisis)),
    ('FechaSolucion', CONVERT(date, p.FechaSolucion)),
    ('FechaCierre',   CONVERT(date, p.FechaCierre))
) AS v (Campo, Valor)
WHERE v.Valor IS NOT NULL;
```

The baseline covers all rows, including `VigenteEnOrigen = 0`, so that a row
that becomes current again still has its anchor. Confirm this in the checklist.

---

## 6. DELETE

**Recommendation: no DELETE branch.** The reasons:
- There is no verified deleter (V4). TRUNCATE is impossible today (V3).
- With the proposed FK (NO ACTION), a `Problem` row that **has** history cannot be deleted. The delete fails, and the evidence is protected.
- A `Problem` row with **no** history can only be one whose three dates were always NULL. Deleting it would create no date transition, so there is nothing to log.
- So a DELETE branch could never write a meaningful row. It would only add code paths to test.

Consequence to accept: if the loader or `cargar_experiencia.py` ever deletes
rows from `Problem` (U3), that delete will **fail** for initiatives with history.
This is the same behavior `FK_ProblemCategoria_Problem` already enforces for rows
with categories. The alternatives are worse: `ON DELETE CASCADE` silently destroys
evidence, and having no FK allows orphans. If business someday needs physical
deletes, revisit then.

---

## 7. Origen / Usuario / SolicitudId / Reconstruido

| Field | Today (loader, manual SQL) | Future Admin approval flow | One-time baseline |
|---|---|---|---|
| `Origen` | `NO_DECLARADO` | `ADMIN` | `NO_DECLARADO` |
| `Usuario` | NULL | `DOMAIN\account` from the approving request | NULL |
| `SolicitudId` | NULL | request number | NULL |
| `Reconstruido` | 0 | 0 | 1 |
| `LoginBD` | the loader's SQL login | the web app's SQL login | the login that ran the deploy |

- **The current Excel/loader path cannot provide a user or request.** The Excel sheet has no "changed by" column, the loader does not set any context (V4), and the trigger cannot see who edited the spreadsheet. So for every event captured from the loader, `Usuario` and `SolicitudId` stay **NULL**, and the UI shows "not recorded". Nothing is inferred from `LoginBD`, `APP_NAME()` or `HOST_NAME()`.
- `Origen` is not set to `EXCEL` for those rows. The trigger cannot prove that the loader was the writer: a manual UPDATE in SSMS looks the same. `NO_DECLARADO` is the truthful value. `LoginBD` adds verifiable technical context; whether it actually separates loader from web from humans depends on U6.
- **Future Admin flow (not built, depends on `adm.Solicitud` approval):** the approval stored procedure (never the C# code) sets the context, updates `Problem`, and clears the context, all inside a TRY/CATCH:
  ```sql
  EXEC sys.sp_set_session_context @key = N'pfe_origen',    @value = 'ADMIN';
  EXEC sys.sp_set_session_context @key = N'pfe_usuario',   @value = @usuario;
  EXEC sys.sp_set_session_context @key = N'pfe_solicitud', @value = @numeroSolicitud;
  UPDATE dbo.Problem SET FechaSolucion = @nueva WHERE Codigo = @codigo;
  -- then set the three keys back to NULL (also in CATCH)
  ```
  The context is cleared explicitly because pooled connections are reused, so the next statement on the same connection must not inherit `ADMIN`. A test covers this (T15). The key names are free today (V4).
- Admin never inserts into `ProblemFechaEvento` directly. If it also inserted, every change would be recorded twice.

---

## 8. Loader safety (`usp_CargarExperiencia`, `cargar_experiencia.py`)

Expected impact, assuming the P0 checks pass:
- Each load's UPDATE (about 940 rows) and INSERT also run the trigger, which reads `inserted`/`deleted` and inserts a few rows. The cost is milliseconds, inside the same transaction. A load in which nothing changed writes **0** rows.
- The loader's code, results and `@@ROWCOUNT` do not change (`SET NOCOUNT ON`, and the trigger returns no result sets).
- If the trigger fails, the loader's statement rolls back. This is why the trigger is designed so that it cannot fail (§4).

Risks that are **not closed**:
1. **`OUTPUT` without `INTO` on `dbo.Problem`** (U4). This would make the loader fail with Msg 334 as soon as the trigger exists. P0-3 checks the SQL side; the Python side needs a manual review.
2. **`cargar_experiencia.py` writing `Problem` directly** (U3). **This is open. It has not been verified.**
   - bcp, `BULK INSERT` or `SqlBulkCopy` without `FIRE_TRIGGERS` **skip the trigger**. Changes would be missed silently, the load would not break, and the history would have gaps.
   - pyodbc `executemany`/`fast_executemany` and pandas `to_sql` issue normal INSERT/UPDATE statements. The trigger fires and the rows get `Origen=NO_DECLARADO`.
   - A DELETE on `Problem` from Python fails once history exists (§6).
   - What to do: the user reviews the current `cargar_experiencia.py` and searches for `Problem`, `bulk`, `BULK INSERT`, `bcp`, `fast_executemany`, `to_sql`, `DELETE`, `TRUNCATE` and `OUTPUT`. Any hit on `Problem` (as opposed to staging) blocks the move to production until it is reviewed.
3. Writers outside `sys.sql_modules`, such as SQL Agent job steps or other scripts (U5, U7). P0-3 and P0-7 cover part of this.

---

## 9. Alternatives

| Option | Verdict |
|---|---|
| **Capture inside the loader** (compare staging with `Problem` before the UPDATE) | It requires changing `usp_CargarExperiencia`, which we keep untouched. It only sees changes made through the loader: Admin and manual SQL would each need their own capture code, and an UPDATE that forgets it creates a gap. It would be the fallback only if a writer turns out to DELETE and re-INSERT rows. |
| **System-versioned temporal table on `Problem`** | It requires `ALTER TABLE dbo.Problem`, the most-read table. The loader rewrites all 35 columns on every load, so even with the same values a new history version is written for every row on every load (about 940 per load). The date changes would then have to be found by diffing whole rows. Schema changes would also require switching versioning off. Too much volume for too little signal. |
| **Generic audit** (`Tabla, Columna, Anterior, Nuevo` as text or `sql_variant`, or CDC / SQL Audit) | Loses the data type, makes queries harder, and records many columns nobody asked for. CDC needs SQL Agent and records every row the loader touches. It overlaps with the planned `adm.SolicitudEvento` workflow log. Premature. |
| **Trigger + dedicated table (proposed)** | Zero changes to `Problem` and to the loader. It catches every writer that fires triggers, filters down to the 3 columns and to real changes only (the key point given the loader's broad UPDATEs), and it is small enough to review line by line. Its cost is hidden logic, which is mitigated by this document and by naming. |

---

## 10. Legacy limitations (explicit)

Three separate layers:

1. **Genuinely available in existing data:** the current dates in `Problem`, the hand-typed `FechaOriginalSolucion`/`FechaOriginalCierre` (partial, unverified), and the hand-typed `NroCambioFecha*` counters (unreliable). These are attributes of `Problem`, not history.
2. **One-time reconstructed baseline:** "value at go-live" per field, flagged `Reconstruido=1`. That is all.
3. **Trustworthy history:** every `I`/`U` row from the go-live timestamp onward.

**What cannot be recovered:** intermediate values before go-live were never persisted anywhere, so the example `27/06 → 15/07 → 24/07` cannot be rebuilt for existing initiatives. The legacy counters are **not** turned into events. The free-text "Histórico de comentarios" is **not** parsed. The UI must say "history recorded since dd/mm/yyyy" so that an empty or short list is not read as "never changed".

---

## 11. FK, indexes, constraints (minimal)

- `PK_ProblemFechaEvento` clustered on `IdEvento`: append-only inserts and order.
- `FK_ProblemFechaEvento_Problem` → `dbo.Problem(Codigo)`, NO ACTION (§6).
- `IX_ProblemFechaEvento_Codigo (Codigo, IdEvento)` is the only secondary index. It serves the Admin read (`WHERE Codigo = @c ORDER BY IdEvento`) and the FK check on any key change.
- CHECKs: `Campo`, `Operacion`, `Origen`, transition, baseline shape, admin-only metadata. All are evaluated on constants or on values the trigger already guarantees.
- **No filtered index and no indexed computed column.** These impose SET-option requirements on every DML session that touches the table, and the loader's session options are unknown.
- Not added: an append-only enforcement trigger. It is enforced through permissions instead: the web login gets only `SELECT`, and nobody gets INSERT/UPDATE/DELETE grants.

---

## 12. Rollback

```sql
-- NOT EXECUTED. Proposal only.
-- Step 1 (soft rollback: stops capture, keeps evidence; the loader is back to exactly today's behavior)
DROP TRIGGER IF EXISTS dbo.trg_Problem_FechaEvento;

-- Step 2 (full rollback: ONLY after deciding what to do with the rows collected so far)
--   Optional preservation first, e.g.:
--   SELECT * INTO dbo.ProblemFechaEvento_respaldo_YYYYMMDD FROM dbo.ProblemFechaEvento;
DROP TABLE IF EXISTS dbo.ProblemFechaEvento;   -- also drops its PK, FK, CHECKs, defaults, index
```

- **What happens to collected history:** step 1 alone keeps every row. Step 2 **deletes all of it permanently**. Rows captured since go-live **cannot be regenerated**, because the old values are gone from `Problem`. Taking the backup copy is therefore recommended before step 2. Baseline rows can be regenerated, but only with the values current at that time.
- `dbo.Problem` is never altered, so it needs nothing to roll back. It does need one ordering rule: **roll back the Admin read code first** (or ship it so it tolerates the table being missing), and only then drop the table. Otherwise the detail panel errors.
- If the trigger is dropped and recreated later, the period in between has no history. The UI's "recorded since" line must be honest about it, so record the outage dates.

---

## 13. Deployment order

**P0 — read-only pre-flight on the VM** (SELECT only; may be run directly):

```sql
-- P0-1 exact types / collation (fills {{TIPO_CODIGO}}, answers U1/U2)
SELECT c.name, t.name AS tipo, c.max_length, c.precision, c.scale, c.is_nullable, c.collation_name
FROM sys.columns c JOIN sys.types t ON t.user_type_id = c.user_type_id
WHERE c.object_id = OBJECT_ID('dbo.Problem')
  AND c.name IN ('Codigo', 'FechaAnalisis', 'FechaSolucion', 'FechaCierre');
SELECT BaseCollation = DATABASEPROPERTYEX(DB_NAME(), 'Collation');

-- P0-2 names are free
SELECT name, type_desc FROM sys.objects
WHERE name IN ('ProblemFechaEvento', 'trg_Problem_FechaEvento')
   OR name LIKE '%ProblemFechaEvento%';

-- P0-3 every module mentioning Problem in any spelling, with OUTPUT/DELETE flags (U4, U5)
SELECT OBJECT_SCHEMA_NAME(m.object_id) AS esquema, OBJECT_NAME(m.object_id) AS objeto, o.type_desc,
       UsaOutput = CASE WHEN m.definition LIKE '%OUTPUT%' THEN 1 ELSE 0 END,
       UsaDelete = CASE WHEN m.definition LIKE '%DELETE%' THEN 1 ELSE 0 END,
       UsaBulk   = CASE WHEN m.definition LIKE '%BULK%' OR m.definition LIKE '%OPENROWSET%' THEN 1 ELSE 0 END
FROM sys.sql_modules m JOIN sys.objects o ON o.object_id = m.object_id
WHERE m.definition LIKE '%Problem%'
ORDER BY objeto;

-- P0-4 FK delete/update rule already in place (U8)
SELECT name, delete_referential_action_desc, update_referential_action_desc
FROM sys.foreign_keys WHERE referenced_object_id = OBJECT_ID('dbo.Problem');

-- P0-5 session SET options of currently connected sessions (informative, for the loader if it is running)
SELECT session_id, login_name, program_name, quoted_identifier, ansi_nulls, arithabort
FROM sys.dm_exec_sessions WHERE is_user_process = 1;

-- P0-6 non-midnight times (U2). Run ONLY if P0-1 says datetime/datetime2/smalldatetime;
-- CAST(date AS time) is an error, and if the type is date this check is unnecessary.
SELECT ConHoraAnalisis = SUM(CASE WHEN CAST(FechaAnalisis AS time) <> '00:00' THEN 1 ELSE 0 END),
       ConHoraSolucion = SUM(CASE WHEN CAST(FechaSolucion AS time) <> '00:00' THEN 1 ELSE 0 END),
       ConHoraCierre   = SUM(CASE WHEN CAST(FechaCierre   AS time) <> '00:00' THEN 1 ELSE 0 END)
FROM dbo.Problem;

-- P0-7 Agent job steps touching Problem / the loader (U7; needs msdb read, skip if denied)
SELECT j.name, s.step_name, s.subsystem
FROM msdb.dbo.sysjobs j JOIN msdb.dbo.sysjobsteps s ON s.job_id = j.job_id
WHERE s.command LIKE '%Problem%' OR s.command LIKE '%CargarExperiencia%';
```

Plus a manual review of `cargar_experiencia.py` (§8.2) and the answer to "which
login does the loader use, and which does the web use?" (U6).

**Then:**
1. Approval of this proposal (checklist below).
2. **Test environment** (a restored copy of `Tickets_Proactivanet`, or a separate test database; *which one is to be decided*): create the table, run the baseline (if approved), create the trigger, run T1–T16, run the rollback (T16), redeploy.
3. Measure `usp_CargarExperiencia` duration in test before and after the trigger.
4. **Production**, at a time when no load is running, as one transaction:
   ```sql
   -- NOT EXECUTED. Shape only.
   SET XACT_ABORT ON;
   BEGIN TRAN;
       -- CREATE TABLE + IX (§1)                         [batch 1]
       -- baseline INSERT with TABLOCKX, HOLDLOCK (§5)  [same batch; omit if baseline rejected]
   GO
       -- CREATE TRIGGER (§4)                           [must be its own batch]
   GO
   COMMIT;
   ```
   The exclusive lock on `Problem` from the baseline is held until COMMIT, so no write can slip in between the baseline and the trigger. On about 940 rows it lasts milliseconds. If anything fails, `XACT_ABORT` rolls the whole transaction back.
5. Smoke test right after: `COUNT(*)` must equal the baseline count; the trigger must be enabled (`sys.triggers`).
6. Next normal Excel load: check that the number of new `I`/`U` rows matches the dates that actually changed in the Excel, and spot-check 2–3 codes.
7. Grant `SELECT` on `dbo.ProblemFechaEvento` to the web login (a separate, small change with its own OK), or expose it through a read-only SP.
8. Deploy the Admin read (§15) to `claude-branch`, verify on the VM, then `main`.

---

## 14. Testing plan (test environment only)

Setup: create a scratch initiative by scripting an existing row's INSERT (SSMS
"Script as INSERT", so no column names are invented here) with
`Codigo = 'TST 2099-000001'` (and `…02`, `…03` for the insert cases). `@n0` = `SELECT MAX(IdEvento)` before each test.
"Rows" = new rows in `ProblemFechaEvento` after that test.

| # | Action | Expected rows |
|---|---|---|
| T1 | INSERT with all 3 dates NULL | 0 |
| T2 | INSERT with `FechaAnalisis` only | 1: `FechaAnalisis, NULL→d, I` |
| T3 | INSERT with all 3 dates | 3, `I` |
| T4 | `UPDATE … SET Titulo = Titulo + ''` (unrelated column only) | 0 (early exit) |
| T5 | `UPDATE … SET FechaAnalisis = FechaAnalisis, Titulo = 'x'` (same value) | 0 |
| T6 | change `FechaAnalisis` d1→d2 | 1, `U` |
| T7 | change `FechaSolucion` NULL→d | 1, `U`, `Anterior NULL` |
| T8 | change `FechaCierre` d→NULL | 1, `U`, `Nuevo NULL` |
| T9 | one UPDATE changes Solución and Cierre | 2, same `FechaRegistro` |
| T10 | A→B then B→A | 2 |
| T11 | time-only change (only if datetime type) | 0 |
| T12 | `UPDATE … SET FechaSolucion = DATEADD(day,1,FechaSolucion) WHERE Codigo LIKE 'TST%' AND FechaSolucion IS NOT NULL` | = number of matching rows; then revert gives the same number again |
| T13 | multi-row UPDATE over **all** rows setting every date to itself | 0 |
| T14 | run `usp_CargarExperiencia` twice with the same staging data | 2nd run: 0 rows. 1st run: only the real differences between staging and test data |
| T15 | change one date in staging, run the loader | exactly 1 `U` row, `Origen = NO_DECLARADO`, `Usuario`/`SolicitudId` NULL, `LoginBD` = loader login; loader result and duration unchanged |
| T15b | `sp_set_session_context` ADMIN + user + 123, UPDATE one date, clear the context, UPDATE again on the same connection | 1st row `ADMIN`/user/123; 2nd row `NO_DECLARADO`/NULL/NULL |
| T15c | `DELETE` a TST row that has history | fails on the FK (documented behavior); a TST row with no history deletes fine |
| T15d | verify the loader has no `OUTPUT` without `INTO` | the loader runs without Msg 334 |
| T16 | rollback step 1: loader runs, 0 new rows, table intact. Step 2: table gone, `Problem` and loader unaffected | — |

Cleanup: delete the TST events and then the TST rows (test environment only).

---

## 15. Admin integration (read-only)

- **Current date:** stays as it is today, from `dbo.Problem` (`FechaAnalisis/Solucion/Cierre`), unchanged.
- **History:** a new read, keyed by the `Codigo` of the open detail, executed only when the detail opens (lazily, the same pattern as the catalogs):
  ```sql
  SELECT e.IdEvento, e.Campo, e.ValorAnterior, e.ValorNuevo, e.Operacion, e.Reconstruido,
         e.Origen, e.Usuario, e.SolicitudId, e.FechaRegistro,
         NumeroCambio = CASE WHEN e.Operacion = 'U' AND e.ValorAnterior IS NOT NULL AND e.ValorNuevo IS NOT NULL
                             THEN COUNT(CASE WHEN e.Operacion = 'U' AND e.ValorAnterior IS NOT NULL AND e.ValorNuevo IS NOT NULL THEN 1 END)
                                  OVER (PARTITION BY e.Campo ORDER BY e.IdEvento ROWS UNBOUNDED PRECEDING) END
  FROM dbo.ProblemFechaEvento e
  WHERE e.Codigo = @codigo
  ORDER BY e.IdEvento;
  ```
- **Handler** (`admin_iniciativas_registro` detail) maps each row to the existing contract `{campo, anterior, nuevo, fecha, usuario}` plus `operacion`, `reconstruido`, `origen`, `solicitud`, `numero`. `fecha` = `FechaRegistro` converted from UTC to the project's UTC-6 display. `usuario` = `Usuario`, or "no registrado" when NULL (never `LoginBD` shown as a person).
- **Frontend** (`htmlHistorial`) only renders, in chronological order (`IdEvento`): baseline rows as "valor al iniciar el historial (reconstruido)", `I` rows as "fecha inicial", and `U` rows as "Cambio n". It adds a fixed note "historial registrado desde <go-live>".
- **Admin never:** fills gaps, infers intermediate values, reads `NroCambioFecha*` or `FechaOriginal*` to build events, deduplicates, writes to `ProblemFechaEvento`, or uses any history value to set or overwrite a `Problem` date.
- **Known conflict, not solved here:** if Admin someday changes a date and the Excel still has the old one, the next load reverts it. The history will show both rows (`ADMIN` then `NO_DECLARADO`). This makes the conflict visible but does not resolve which source wins, which is a separate decision.

---

## Approval checklist

**Gate before the test environment**
- [ ] P0 run on the VM; `{{TIPO_CODIGO}}` filled in from P0-1; date type is a date/time type (not character).
- [ ] P0-3: no `OUTPUT` without `INTO`, and no unknown writers of `Problem`.
- [ ] `cargar_experiencia.py` reviewed: it does not write `dbo.Problem` directly (or every finding has been resolved).
- [ ] Which logins the loader and the web use (decides the value of `LoginBD`).
- [ ] Test environment chosen (restored copy or separate database).

**Design being approved**
- [ ] New table `dbo.ProblemFechaEvento` with exactly the §1 columns, PK, FK NO ACTION to `Problem(Codigo)`, CHECKs, and 1 index.
- [ ] New trigger `dbo.trg_Problem_FechaEvento` AFTER INSERT, UPDATE, as written in §4. No DELETE branch.
- [ ] Comparison at `date` granularity (time-only changes ignored).
- [ ] Consequence accepted: deleting a `Problem` row that has history will fail.
- [ ] `Origen = NO_DECLARADO`, with `Usuario`/`SolicitudId` NULL, for everything except a future Admin SP that declares itself through `SESSION_CONTEXT`.
- [ ] Baseline: load it (current non-NULL values only, `Reconstruido=1`, including non-current rows) **or** skip it.
- [ ] `NroCambioFecha*` and `FechaOriginal*` are not used to build events.
- [ ] Display numbering rule: only `date→date` updates count as "Cambio n".
- [ ] `dbo.Problem` and `usp_CargarExperiencia` are not modified.

**Moving from test to production**
- [ ] T1–T16 pass; loader duration unchanged within noise.
- [ ] Deployment window with no load running; single transaction as in §13.
- [ ] Rollback understood: dropping the trigger keeps the history; dropping the table **permanently loses** the post-go-live history (back it up first); remove the Admin read before dropping the table.
- [ ] Separate small OK for `GRANT SELECT` to the web login (or a read SP).
- [ ] Separate OK later for the Admin read code (handler + `htmlHistorial`).
