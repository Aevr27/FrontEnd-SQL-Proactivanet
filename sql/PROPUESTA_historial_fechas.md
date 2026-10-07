# PROPOSAL — `dbo.ProblemFechaEvento` (date-change history) — NOT EXECUTED, NOT APPROVED

> **`ProblemFechaEvento` is an append-only evidence trail for initiative date
> changes. It does not replace the current dates in `dbo.Problem` and exists
> specifically so the initiative detail History of Changes panel can show
> evidence of deadline/date extensions and other date transitions.**

Status: **proposal only**. None of these objects exist in the database, and
nothing in this document has been run anywhere. It is written in Markdown on
purpose, so it cannot be executed by accident. Every SQL block that would change
the database is labelled **NOT EXECUTED**, and the table DDL contains a
`{{TIPO_CODIGO}}` placeholder, so it fails if pasted as-is (see §2).

---

## Central rule

| | `dbo.Problem` | `dbo.ProblemFechaEvento` |
|---|---|---|
| Role | **Source of truth** for the *current* `FechaAnalisis`, `FechaSolucion`, `FechaCierre` | **Evidence only**: one row per actual change of one of those dates |
| Who writes it | Today `usp_CargarExperiencia` (Excel). Later, possibly an Admin approval procedure. | Only the trigger on `dbo.Problem` (and, if approved, the one-time baseline) |
| Who reads it | Every view, the normal initiative view, Experiencia, Admin | Only the History of Changes section of the initiative detail panel (initiative list → click the name → right-side panel) |
| Can it change? | Yes, normally | **Never updated, never deleted** (§9) |

The history never drives, recalculates or overwrites a current date. If the two
ever seem to disagree, `dbo.Problem` is right by definition.

Example. Current value: `FechaSolucion = 24/07/2026`. History:

```
FechaSolucion  27/06/2026 → 15/07/2026   (Cambio 1)
FechaSolucion  15/07/2026 → 24/07/2026   (Cambio 2)
```

---

## 1. Facts vs open items

### Verified

| # | Fact | Source |
|---|---|---|
| V1 | SQL Server 16.0.4255.1 (2022), compatibility level **150**. `IS DISTINCT FROM` needs level 160, so it is not used. | diag H1, 2026-10-07 |
| V2 | `PK_Problem` is clustered on **`Codigo`** only. There is no identity column. | diag H2/H2b |
| V3 | `FK_ProblemCategoria_Problem` already references `dbo.Problem`. That makes TRUNCATE of `Problem` impossible today. | diag H2c |
| V4 | Among the SQL modules whose text contains `dbo.Problem`, only `usp_CargarExperiencia` writes it, using **UPDATE and INSERT** (no MERGE, DELETE or TRUNCATE). No module uses `SESSION_CONTEXT` or `CONTEXT_INFO`. | diag H3 |
| V5 | `dbo.Problem` has **0 triggers**. | diag H4 |
| V6 | `NroCambioFecha*` are typed by hand and unreliable: counter 0 while original ≠ current (14 Solución / 42 Cierre), corrupted values such as `46289`/`46292` (PRB 2026-000177), and shifted columns. `FechaOriginal*` is present in only about 175 of 939 rows, and Análisis has none. | Excel V3.1 + diag N5/N6 |
| V7 | Admin's identity source is `IdentidadWindows` (`App_Code/IdentidadWindows.cs`). It is built only from `HttpContext.User.Identity.Name`, which IIS fills through Windows authentication. `Original` (`DOMAIN\account`) is documented there as the security identity "that should go into any future log". Without IIS authentication it is anonymous, and identity is never invented. | code |
| V8 | Admin does not write `dbo.Problem` today. "Solicitar cambios" is a browser-only draft (`SolicitudCambio` in `admin/registro-iniciativas.js`) with fields: field, current value, new date and a **required `motivo`**. It is not submitted anywhere. `adm.Solicitud` does not exist; it is only proposed in `PROPUESTA_numero_solicitud.md`. | code |
| V9 | The panel already expects `historial: [{campo, anterior, nuevo, fecha, usuario}]` (`htmlHistorial`). It always arrives empty today. | code |

### Open, must be closed before the test environment (none is closed yet)

| # | Item | Why it blocks | How to close |
|---|---|---|---|
| O1 | Exact type, length and **collation** of `Problem.Codigo` | The FK column must match it exactly. It fills `{{TIPO_CODIGO}}`. | P0-1 |
| O2 | Exact types of `FechaAnalisis/FechaSolucion/FechaCierre`, and whether non-midnight times exist | Decides whether the comparison and conversion are safe. **A character type would stop this design.** The N6 output shows `2026-10-21 00:00:00`, but the type has not been confirmed. | P0-1, P0-6 |
| O3 | `OUTPUT` without `INTO` on `dbo.Problem`, in the loader or any other writer | **SQL Server rejects that statement once the table has an enabled trigger (Msg 334). The load would fail.** | P0-3 (SQL side) + Python review (O4) |
| O4 | **`cargar_experiencia.py`** writing `dbo.Problem` directly (bcp, `BULK INSERT`, `SqlBulkCopy`, `to_sql`, executemany UPDATE/DELETE) instead of only filling staging and calling the procedure | Bulk paths that bypass triggers would leave silent gaps; a DELETE would fail once history exists. The local copy is gone, so this is **not verified**. | Manual review of the current file |
| O5 | Other unknown writers: modules referencing `Problem` without the `dbo.` prefix (missed by H3), SQL Agent job steps, external scripts | Same reasons as O3 and O4 | P0-3, P0-7, ask the owners |
| O6 | Which database login(s) the loader and the web application use | Decides how informative `LoginBD` is (§7). The web connection string uses a SQL login; the loader's login is unknown. | Ask the owners / P0-5 while a load runs |
| O7 | Delete/update rule of `FK_ProblemCategoria_Problem` | Context for §8 only | P0-4 |

---

## 2. Table schema

One row = **one actual transition of one date field** of one initiative.

```sql
-- NOT EXECUTED. Proposal only. {{TIPO_CODIGO}} must be replaced with the exact
-- type + collation of dbo.Problem.Codigo from P0-1.
CREATE TABLE dbo.ProblemFechaEvento
(
    IdEvento      int IDENTITY(1,1) NOT NULL
                  CONSTRAINT PK_ProblemFechaEvento PRIMARY KEY CLUSTERED,
    Codigo        {{TIPO_CODIGO}}   NOT NULL
                  CONSTRAINT FK_ProblemFechaEvento_Problem
                  REFERENCES dbo.Problem (Codigo),          -- no cascade: intentional (§8)
    Campo         varchar(13)       NOT NULL
                  CONSTRAINT CK_ProblemFechaEvento_Campo
                  CHECK (Campo IN ('FechaAnalisis', 'FechaSolucion', 'FechaCierre')),
    FechaAnterior date              NULL,
    FechaNueva    date              NULL,
    Operacion     char(1)           NOT NULL
                  CONSTRAINT CK_ProblemFechaEvento_Operacion
                  CHECK (Operacion IN ('I', 'U', 'B')),     -- Insert / Update / Baseline
    Reconstruido  AS CAST(CASE WHEN Operacion = 'B' THEN 1 ELSE 0 END AS bit),
    Origen        varchar(12)       NOT NULL
                  CONSTRAINT CK_ProblemFechaEvento_Origen
                  CHECK (Origen IN ('NO_DECLARADO', 'ADMIN')),
    Usuario       nvarchar(256)     NULL,
    SolicitudId   int               NULL,
    LoginBD       nvarchar(128)     NOT NULL
                  CONSTRAINT DF_ProblemFechaEvento_LoginBD DEFAULT (ORIGINAL_LOGIN()),
    FechaRegistro datetime2(3)      NOT NULL
                  CONSTRAINT DF_ProblemFechaEvento_FechaRegistro DEFAULT (SYSUTCDATETIME()),

    -- A real transition: never NULL->NULL, never X->X.
    CONSTRAINT CK_ProblemFechaEvento_Transicion CHECK (
        (FechaAnterior IS NOT NULL OR FechaNueva IS NOT NULL)
        AND (FechaAnterior IS NULL OR FechaNueva IS NULL OR FechaAnterior <> FechaNueva)),
    -- Baseline only states "value known at initialization"; it never claims a previous value.
    CONSTRAINT CK_ProblemFechaEvento_Base CHECK (
        Operacion <> 'B' OR (FechaAnterior IS NULL AND FechaNueva IS NOT NULL)),
    -- Excel/undeclared rows carry no person or request; Admin rows must carry the user.
    CONSTRAINT CK_ProblemFechaEvento_Atribucion CHECK (
        (Origen = 'NO_DECLARADO' AND Usuario IS NULL AND SolicitudId IS NULL)
        OR (Origen = 'ADMIN' AND Usuario IS NOT NULL))
);

CREATE NONCLUSTERED INDEX IX_ProblemFechaEvento_Codigo
    ON dbo.ProblemFechaEvento (Codigo, IdEvento);
```

| Column | Type | Meaning |
|---|---|---|
| `IdEvento` | `int IDENTITY` | Row id and **persisted chronological order**. Display order and the "Cambio n" numbering derive from it (§4). At a few thousand rows a year, `int` is enough. |
| `Codigo` | = `Problem.Codigo` | The initiative, through the verified PK (V2). |
| `Campo` | `varchar(13)` | Which date changed. It stores the real column name. |
| `FechaAnterior` / `FechaNueva` | `date` | **The scheduled date value** before and after the change. NULLs express `NULL→date` and `date→NULL`. Stored at day level (§5). |
| `Operacion` | `char(1)` | `I`: captured when the `Problem` row was inserted. `U`: captured on an update. `B`: one-time baseline. |
| `Reconstruido` | computed `bit` | 1 only for `B`. It is an explicit "known at initialization, not an observed change" flag that can never disagree with `Operacion`. It is non-persisted, so it adds no SET-option requirements for writers. |
| `Origen` | `varchar(12)` | Which path declared the change (§7). |
| `Usuario` | `nvarchar(256)` | The **authenticated application user**, Admin only (§7). |
| `SolicitudId` | `int` | The **application request/approval id**, Admin only, once that workflow exists. There is no FK because the table does not exist yet. |
| `LoginBD` | `nvarchar(128)` | The **database login** that executed the SQL (`ORIGINAL_LOGIN()`). It is technical evidence, not a person. |
| `FechaRegistro` | `datetime2(3)` UTC | **When the system captured the change.** It answers "when was this recorded?", not "what was the initiative scheduled for?". Admin converts it to UTC-6 for display. |

There is deliberately **no** change-number column, no `NroCambioFecha*`, no
`FechaOriginal*`, no `Motivo` (§11), and no generic table/column-name columns.

---

## 3. Transitions → rows

| Operation on `dbo.Problem` | Rows written |
|---|---|
| `FechaSolucion` 27/06 → 15/07 | 1: `FechaSolucion, 2026-06-27 → 2026-07-15, U` |
| later 15/07 → 24/07 | 1 more: `2026-07-15 → 2026-07-24, U` |
| `NULL → date` | 1: `FechaAnterior NULL` |
| `date → NULL` | 1: `FechaNueva NULL` |
| one statement changes `FechaSolucion` **and** `FechaCierre` | **2** (one per field) |
| A → B → A | 2. A reversal is a real change and is never deduplicated. |
| value rewritten but unchanged (the loader rewrites every column) | 0 |
| only the time of day changes, same calendar day | 0 |
| only unrelated columns change | 0 |

---

## 4. Numbering: derived by the UI, not stored

- `NroCambioFechaAnalisis/Solucion/Cierre` remain legacy source metadata. They are **not read** to build history and are **not used** as the change number (V6).
- There is no change number in the database. The panel numbers the events while rendering, from the events it received in `IdEvento` order, separately for each `Campo`:
  - `B` → **"Línea base"**. It is never "Cambio 1".
  - `I` → **"Fecha inicial"** (the date the initiative was created with).
  - `U` with both dates present → **"Cambio 1", "Cambio 2", …**, counted in order per field.
  - `U` `NULL → date` → "Fecha asignada"; `U` `date → NULL` → "Fecha retirada". These are shown but not counted as changes.
- These labels and the counting rule are a **display decision to confirm** (checklist). Changing them later needs no database change.

---

## 5. Trigger on `dbo.Problem`

```sql
-- NOT EXECUTED. Proposal only.
CREATE TRIGGER dbo.trg_Problem_FechaEvento
ON dbo.Problem
AFTER INSERT, UPDATE
AS
BEGIN
    SET NOCOUNT ON;

    IF NOT EXISTS (SELECT 1 FROM inserted) RETURN;
    -- None of the three columns is in the statement. (For INSERT, UPDATE() is true for all.)
    IF NOT (UPDATE(FechaAnalisis) OR UPDATE(FechaSolucion) OR UPDATE(FechaCierre)) RETURN;

    -- Declared context (only a future Admin procedure sets it; §7, §11).
    DECLARE @esAdmin bit =
        CASE WHEN CONVERT(varchar(12), SESSION_CONTEXT(N'pfe_origen')) = 'ADMIN' THEN 1 ELSE 0 END;
    DECLARE @usuario nvarchar(256) =
        CASE WHEN @esAdmin = 1 THEN CONVERT(nvarchar(256), SESSION_CONTEXT(N'pfe_usuario')) END;
    DECLARE @solicitud int =
        CASE WHEN @esAdmin = 1 THEN TRY_CONVERT(int, SESSION_CONTEXT(N'pfe_solicitud')) END;

    INSERT dbo.ProblemFechaEvento
           (Codigo, Campo, FechaAnterior, FechaNueva, Operacion, Origen, Usuario, SolicitudId)
    SELECT i.Codigo, v.Campo, v.Anterior, v.Nueva,
           CASE WHEN d.Codigo IS NULL THEN 'I' ELSE 'U' END,
           CASE WHEN @esAdmin = 1 THEN 'ADMIN' ELSE 'NO_DECLARADO' END,
           @usuario, @solicitud
    FROM inserted AS i
    LEFT JOIN deleted AS d ON d.Codigo = i.Codigo
    CROSS APPLY (VALUES
        ('FechaAnalisis', CONVERT(date, d.FechaAnalisis), CONVERT(date, i.FechaAnalisis)),
        ('FechaSolucion', CONVERT(date, d.FechaSolucion), CONVERT(date, i.FechaSolucion)),
        ('FechaCierre',   CONVERT(date, d.FechaCierre),   CONVERT(date, i.FechaCierre))
    ) AS v (Campo, Anterior, Nueva)
    WHERE EXISTS (SELECT v.Anterior EXCEPT SELECT v.Nueva);   -- NULL-safe "is distinct" (level 150)
END;
```

How the trigger meets each requirement:

- **`AFTER INSERT, UPDATE`, set-based, multi-row.** A single INSERT…SELECT over all of `inserted`. There is no cursor and no per-row logic.
- **`inserted` vs `deleted`.** Rows are joined on the PK `Codigo` (V2). For an INSERT, `deleted` is empty, so `FechaAnterior` is NULL and `Operacion = 'I'`.
- **Only real changes, NULL-safe.** `EXISTS (SELECT a EXCEPT SELECT b)` is true for `NULL↔date` and for `date↔other date`, and false for `NULL=NULL` and `X=X`. This is the level-150 replacement for `IS DISTINCT FROM`.
- **Day level.** Both sides are converted to `date`, so a time-only change produces nothing. This is valid only if O2 confirms a date/time type.
- **Unrelated columns.** If the statement does not mention the dates, the trigger exits early. If it mentions them without changing them (the loader's broad UPDATE), the `EXCEPT` filter produces 0 rows.
- **No duplicates.** At most one row per `(Codigo, Campo)` per statement.
- **Code changes.** An UPDATE of `Codigo` itself would show up as an `I` on the new code. The loader matches rows by `Codigo`. Changing a code that has history is blocked by the FK, as V3 already does for categories.
- **Permissions.** `dbo` owns both tables, so ownership chaining applies: the loader's login needs **no** new permission.

**Failure behavior. It is not claimed that the trigger cannot fail.** A trigger error rolls back the statement that fired it, which here means the loader's UPDATE or INSERT. The design avoids the *expected* constraint failures on the loader path:
- `Campo`, `Operacion` and `Origen` are constants.
- The transition CHECK is guaranteed by the `WHERE`.
- `B` is never written by the trigger.
- `Usuario` and `SolicitudId` stay NULL unless the context says `ADMIN`.
- `TRY_CONVERT` is used for `SolicitudId`.
- The FK value comes from `inserted`.

What remains possible:
- Msg 334, if any writer uses `OUTPUT` without `INTO` (O3).
- Conversion errors, if the date columns are not a date/time type (O2).
- Ordinary engine conditions: lock waits or deadlocks, `tempdb` or log space, a disabled or dropped history table.
- **Deliberately**, on the Admin path only: `ADMIN` declared without a user fails `CK_ProblemFechaEvento_Atribucion`, so an unattributed web change is refused.

**The test plan must prove that a normal loader run succeeds with the trigger enabled (T14, T15).**

---

## 6. INSERT and the optional baseline

**New `Problem` row going forward:** each date that is **not NULL** produces one `I` row (`FechaAnterior` NULL). Dates that are NULL produce nothing. An initiative born with only `FechaAnalisis` (as in diag N6) gets exactly one row.

**One-time legacy baseline: optional, separate approval, and not a change.**
- It records only what is genuinely known at initialization: the current non-NULL value of each date. Rows have `Operacion = 'B'`, `Reconstruido = 1`, `Origen = 'NO_DECLARADO'`, and `FechaAnterior` NULL (enforced by a CHECK).
- It does **not** use `FechaOriginal*`: writing `original → current` would look like a single direct change when an unknown number of intermediate changes happened.
- It does **not** use `NroCambioFecha*`.
- The UI shows it as **"Línea base"**, never as "Cambio 1" (§4).
- Its value is limited: the first real change after go-live already records the old value in `FechaAnterior`. The baseline only gives initiatives that never change a visible starting point. Skipping it loses no real evidence. **Recommendation: load it, clearly labelled.**
- It covers all rows, including those with `VigenteEnOrigen = 0`. Confirm this in the checklist.

```sql
-- NOT EXECUTED. Proposal only. Runs in the deployment transaction (§14), BEFORE the trigger exists.
INSERT dbo.ProblemFechaEvento (Codigo, Campo, FechaAnterior, FechaNueva, Operacion, Origen)
SELECT p.Codigo, v.Campo, NULL, v.Valor, 'B', 'NO_DECLARADO'
FROM dbo.Problem AS p WITH (TABLOCKX, HOLDLOCK)
CROSS APPLY (VALUES
    ('FechaAnalisis', CONVERT(date, p.FechaAnalisis)),
    ('FechaSolucion', CONVERT(date, p.FechaSolucion)),
    ('FechaCierre',   CONVERT(date, p.FechaCierre))
) AS v (Campo, Valor)
WHERE v.Valor IS NOT NULL;
```

---

## 7. Attribution: `Origen`, `Usuario`, `SolicitudId`, `LoginBD`

These four fields stay conceptually separate:

- `Usuario` = the authenticated **application** user.
- `LoginBD` = the **database** login that executed the SQL.
- `SolicitudId` = the **application** request/approval id.
- `Origen` = which path declared the change.

| Field | Excel / loader (today) | Web / Admin (future) | Baseline |
|---|---|---|---|
| `Origen` | `NO_DECLARADO` | `ADMIN` | `NO_DECLARADO` |
| `Usuario` | NULL, by design | **required**: authenticated web user | NULL |
| `SolicitudId` | NULL | the real request/approval id, when that workflow exists | NULL |
| `LoginBD` | the login that ran the load | the web app's login | the login that ran the deploy |

**Excel / loader path.**
- Date changes in this workflow are agreed in meetings, with the responsible person's boss present, and typed into the Excel file by hand. No individual requester is needed for them, and **none is fabricated**.
- The pipeline cannot provide one anyway: the sheet has no "changed by" column, the loader sets no context (V4), and the trigger cannot see who edited the file.
- So `Usuario` and `SolicitudId` stay NULL, and the CHECK forbids filling them on these rows.
- `Origen` is **`NO_DECLARADO`, not `EXCEL`**, because nothing verified lets the trigger prove that the writer was the loader: a manual UPDATE from SSMS looks identical. Two ways to get an accurate `EXCEL` value exist, and neither is adopted here:
  - (a) `usp_CargarExperiencia` declares `pfe_origen = 'EXCEL'`. This is a one-line change to the loader, which this proposal deliberately does not touch; it would need its own approval.
  - (b) The trigger maps a dedicated loader login to `EXCEL`. This works only if O6 proves the login is used exclusively by the loader, and it hardcodes a login name.

  Either one would add `'EXCEL'` to `CK_ProblemFechaEvento_Origen` later.
- `LoginBD` still records the database login, as technical evidence.
- The panel labels these rows honestly, for example "Sin solicitante registrado (carga de Excel u otra vía directa)". It never shows "desconocido" as a person, and never shows `LoginBD` as a person.

**Web / Admin path (future; attribution required).**
- `Usuario` = `IdentidadWindows.Original` (`DOMAIN\account`) of the request being served, resolved server-side from IIS Windows authentication (V7). It is **never** taken from a value the browser sends. If the identity is not authenticated, the change must not be made at all.
- `SolicitudId` = the id of the request/approval record once that entity exists. Until then it is NULL, which the CHECK allows.
- `LoginBD` = the web app's database login.
- If the requester and the approver are different people, `Usuario` records whoever performed the action that changed `Problem`. The other person is reachable through `SolicitudId` in the request record, so no second person column is added.
- **Mechanism** (safest option given V4/V7; not built). The procedure that applies an approved change declares the context, updates `Problem`, then clears the context. It also clears it in its `CATCH` block:
  ```sql
  EXEC sys.sp_set_session_context @key = N'pfe_origen',    @value = 'ADMIN';
  EXEC sys.sp_set_session_context @key = N'pfe_usuario',   @value = @usuario;          -- IdentidadWindows.Original, passed by the server
  EXEC sys.sp_set_session_context @key = N'pfe_solicitud', @value = @solicitudId;      -- NULL until the workflow exists
  UPDATE dbo.Problem SET FechaSolucion = @nueva WHERE Codigo = @codigo;
  -- then set the three keys back to NULL (also in CATCH)
  ```
  Pooled connections are reused, so the next statement must not inherit `ADMIN` (T15b). The key names are free today (V4).
- Admin never inserts into `ProblemFechaEvento` itself. If it did, every change would be recorded twice.

**Designed for richer attribution later.** The table and trigger already carry `Usuario` and `SolicitudId`. When date extensions move to the website, only the applying procedure has to declare its context; the table, the trigger and the existing Excel rows stay as they are.

---

## 8. DELETE: no trigger branch; deletion is blocked by design

- The current loader does not DELETE, TRUNCATE or MERGE `dbo.Problem` (V4), and TRUNCATE is already impossible (V3). There is no DELETE logic in the trigger.
- **Intentional audit protection:** `FK_ProblemFechaEvento_Problem` has **no cascade**. Once a `Problem` row has any history event, **deleting that row is rejected by the FK**. This is deliberate: the evidence cannot disappear with the row. It is not a side effect.
- A `Problem` row without history (all three dates always NULL) can still be deleted, and there is nothing date-related to log for it.
- Consequence: if any writer (O4, O5) ever deletes rows from `Problem`, those deletes will fail for initiatives that have history. `ON DELETE CASCADE` was rejected because it would destroy evidence; having no FK was rejected because it would allow orphans.

---

## 9. Append-only

Once a history event exists it is **never updated and never deleted**. `dbo.Problem` keeps changing independently.

This is enforced in two layers:
1. **Permissions.** Nobody receives INSERT, UPDATE or DELETE on the table. The web login gets only `SELECT` (a separate approval). Inserts happen only through the trigger, via ownership chaining.
2. **Guard trigger** on the history table itself. It is small, and it is justified by this explicit requirement:

```sql
-- NOT EXECUTED. Proposal only.
CREATE TRIGGER dbo.trg_ProblemFechaEvento_SoloAgregar
ON dbo.ProblemFechaEvento
INSTEAD OF UPDATE, DELETE
AS
BEGIN
    SET NOCOUNT ON;
    THROW 50001, 'dbo.ProblemFechaEvento is append-only: events cannot be updated or deleted.', 1;
END;
```

Limits, stated honestly:
- A `db_owner` or `sysadmin` can still disable the guard, or run TRUNCATE (which does not fire DML triggers) or DROP. Those are deliberate administrative acts, not accidents.
- In the **test environment only**, cleaning up test events requires `DISABLE TRIGGER dbo.trg_ProblemFechaEvento_SoloAgregar ON dbo.ProblemFechaEvento`, then the cleanup, then `ENABLE`.

---

## 10. Loader safety (`usp_CargarExperiencia`, `cargar_experiencia.py`)

Expected impact, if O1–O6 come back clean:
- On each load, the trigger compares the roughly 940 rows the loader UPDATEs plus its INSERTs, and writes one row for each date that actually differs. When nothing changed, it writes **0** rows.
- It runs inside the loader's statement, in the same transaction. The extra cost should be milliseconds; T15 measures it.
- The loader's code, results and row counts do not change (`SET NOCOUNT ON`, no result sets).
- The loader needs no new permission.

**Not closed. Each item blocks the move to the test environment until there is evidence:**
1. O3: `OUTPUT` without `INTO` (Msg 334).
2. O4: `cargar_experiencia.py` writing `dbo.Problem` directly. bcp, `BULK INSERT` and `SqlBulkCopy` without `FIRE_TRIGGERS` **skip** the trigger (silent gaps). pyodbc/pandas row inserts and updates fire it normally. A DELETE fails once history exists (§8).
3. O5: other writers.
4. O1/O2: exact types and collation.
5. O6: logins.

---

## 11. Future date-extension workflow (prepared for, not designed here)

```
Authenticated user → requests a date extension → review/approval → procedure updates dbo.Problem → trigger writes the event
```

- What is ready: `Origen = ADMIN`, the required `Usuario`, `SolicitudId` and `LoginBD`, plus the context mechanism (§7).
- What is **not** decided here: the request/approval entity, its states, who approves, and how a rejected request looks. These belong to the Admin workflow design and must build on what exists: `SolicitudCambio` (V8), `IdentidadWindows` and roles (`UsuariosAdmin`), and the `adm.*` proposal.
- **No `Motivo` column in `ProblemFechaEvento`.** The reason is already a required field of the request draft (V8), so it belongs to the request/approval entity and is reachable through `SolicitudId`. This table records *what changed and when*; the request records *why and who asked*. Excel rows have no reason in the pipeline anyway.
- Separate, unsolved issue: if Admin changes a date that the Excel file still holds at its old value, the next load reverts it. The history will show both events (`ADMIN`, then `NO_DECLARADO`). It makes the conflict visible; it does not decide which source wins.

---

## 12. Alternatives

| Option | Verdict |
|---|---|
| **Capture inside the loader** (compare staging with `Problem` before the UPDATE) | Requires changing `usp_CargarExperiencia`, which this proposal deliberately leaves untouched. It sees only the loader: Admin and manual SQL would each need their own capture, and any path that forgets it creates gaps. It is the fallback only if O4/O5 reveal a writer that deletes and re-inserts rows. |
| **Temporal (system-versioned) table on `Problem`** | Requires `ALTER TABLE` on the most-read table. Because the loader rewrites all 35 columns of every row on every load, it would write about 940 history versions per load even when nothing changed, and the date changes would have to be found by diffing whole rows. Schema changes would also require turning versioning off. Too much noise. |
| **Generic audit** (`Tabla/Columna/Anterior/Nuevo` as text, CDC, SQL Audit) | Loses the data type and records many columns nobody needs. CDC needs SQL Agent and logs every row the loader touches. It overlaps the planned workflow log. Premature. |
| **Trigger + dedicated table (proposed)** | No change to `Problem` or to the loader. It captures every writer that fires triggers and filters down to the three dates and real day-level changes, which matters because the loader's UPDATEs are broad. Its cost is hidden logic, which this document and the naming mitigate. |

---

## 13. Legacy limitations

| Layer | What it contains | Trust |
|---|---|---|
| Existing data | The current dates in `Problem`; the hand-typed `FechaOriginal*` (partial); the hand-typed `NroCambioFecha*` (unreliable) | Current dates: authoritative. The rest: legacy attributes of `Problem`, **never turned into events** |
| Baseline (optional) | "Value known at initialization", per field, `Reconstruido = 1` | Labelled "Línea base", not a change |
| Captured history | Every `I`/`U` event from the go-live timestamp onward | Trustworthy evidence |

Intermediate values from before go-live were never persisted, so they **cannot be reconstructed**. For example, `27/06 → 15/07 → 24/07` cannot be rebuilt for an existing initiative. The free-text "Histórico de comentarios" is not parsed. The panel always shows "Historial registrado desde dd/mm/aaaa", so a short or empty list is never read as "never changed".

---

## 14. FK, indexes, constraints (minimal)

- `PK_ProblemFechaEvento`, clustered on `IdEvento`.
- `FK_ProblemFechaEvento_Problem` → `dbo.Problem(Codigo)`, no cascade (§8).
- `IX_ProblemFechaEvento_Codigo (Codigo, IdEvento)`: the Admin read and FK checks. It is the only secondary index.
- CHECKs: `Campo`, `Operacion`, `Origen`, transition, baseline shape, attribution.
- Guard trigger `trg_ProblemFechaEvento_SoloAgregar` (§9).
- No filtered index and no indexed computed column. These impose SET-option requirements on every writer session, and the loader's settings are unknown.

---

## 15. Rollback

```sql
-- NOT EXECUTED. Proposal only.
-- Step 1 (soft): stops capture, keeps all evidence; the loader is back to exactly today's behavior.
DROP TRIGGER IF EXISTS dbo.trg_Problem_FechaEvento;

-- Step 2 (full): ONLY after deciding what to do with the rows collected so far.
--   Optional preservation first:
--   SELECT * INTO dbo.ProblemFechaEvento_respaldo_YYYYMMDD FROM dbo.ProblemFechaEvento;
DROP TABLE IF EXISTS dbo.ProblemFechaEvento;   -- also drops its guard trigger, PK, FK, CHECKs, defaults, index
```

- Step 1 keeps every row. Step 2 **permanently deletes the history**. Events captured after go-live **cannot be regenerated**, because the old values no longer exist in `Problem`. That is why the backup copy is recommended. Baseline rows could be regenerated, but only with the values current at that later time.
- `dbo.Problem` is never altered, so it needs nothing to roll back.
- Order: **first remove the Admin history read** (or ship it so it tolerates a missing table), then drop the table.
- Record the dates of any period when the trigger was off, so the panel's "recorded since" line stays honest.

---

## 16. Deployment order

**P0: read-only pre-flight on the VM** (SELECT only; may be run directly):

```sql
-- P0-1 exact types / collation (O1, O2; fills {{TIPO_CODIGO}})
SELECT c.name, t.name AS tipo, c.max_length, c.precision, c.scale, c.is_nullable, c.collation_name
FROM sys.columns c JOIN sys.types t ON t.user_type_id = c.user_type_id
WHERE c.object_id = OBJECT_ID('dbo.Problem')
  AND c.name IN ('Codigo', 'FechaAnalisis', 'FechaSolucion', 'FechaCierre');
SELECT BaseCollation = DATABASEPROPERTYEX(DB_NAME(), 'Collation');

-- P0-2 names are free
SELECT name, type_desc FROM sys.objects WHERE name LIKE '%ProblemFechaEvento%';

-- P0-3 every module mentioning Problem in any spelling (O3, O5)
SELECT OBJECT_SCHEMA_NAME(m.object_id) AS esquema, OBJECT_NAME(m.object_id) AS objeto, o.type_desc,
       UsaOutput = CASE WHEN m.definition LIKE '%OUTPUT%' THEN 1 ELSE 0 END,
       UsaDelete = CASE WHEN m.definition LIKE '%DELETE%' THEN 1 ELSE 0 END,
       UsaBulk   = CASE WHEN m.definition LIKE '%BULK%' OR m.definition LIKE '%OPENROWSET%' THEN 1 ELSE 0 END
FROM sys.sql_modules m JOIN sys.objects o ON o.object_id = m.object_id
WHERE m.definition LIKE '%Problem%'
ORDER BY objeto;

-- P0-4 existing FK rules on Problem (O7)
SELECT name, delete_referential_action_desc, update_referential_action_desc
FROM sys.foreign_keys WHERE referenced_object_id = OBJECT_ID('dbo.Problem');

-- P0-5 logins / SET options of live sessions (O6; run while a load is running if possible)
SELECT session_id, login_name, program_name, quoted_identifier, ansi_nulls, arithabort
FROM sys.dm_exec_sessions WHERE is_user_process = 1;

-- P0-6 non-midnight times (O2). ONLY if P0-1 says datetime/datetime2/smalldatetime;
-- CAST(date AS time) is an error, and for a date type this check is unnecessary.
SELECT ConHoraAnalisis = SUM(CASE WHEN CAST(FechaAnalisis AS time) <> '00:00' THEN 1 ELSE 0 END),
       ConHoraSolucion = SUM(CASE WHEN CAST(FechaSolucion AS time) <> '00:00' THEN 1 ELSE 0 END),
       ConHoraCierre   = SUM(CASE WHEN CAST(FechaCierre   AS time) <> '00:00' THEN 1 ELSE 0 END)
FROM dbo.Problem;

-- P0-7 SQL Agent job steps touching Problem / the loader (O5; needs msdb read, skip if denied)
SELECT j.name, s.step_name, s.subsystem
FROM msdb.dbo.sysjobs j JOIN msdb.dbo.sysjobsteps s ON s.job_id = j.job_id
WHERE s.command LIKE '%Problem%' OR s.command LIKE '%CargarExperiencia%';
```

For P0-3, any hit with `UsaOutput = 1` must be read to confirm whether its `OUTPUT` targets `Problem` without `INTO`. In addition: a manual review of `cargar_experiencia.py`, searching for `Problem`, `bulk`, `BULK INSERT`, `bcp`, `SqlBulkCopy`, `fast_executemany`, `to_sql`, `DELETE`, `TRUNCATE` and `OUTPUT`, plus asking for the loader's and the web's database logins.

**Then:**
1. Approval of this proposal (checklist).
2. **Test environment** (a restored copy, or a separate database, to be decided): create the table, index and guard trigger; run the baseline (if approved); create the `Problem` trigger; run T1–T16; test the rollback; redeploy.
3. Compare `usp_CargarExperiencia` duration before and after, in test.
4. **Production**, at a time when no load is running, as one transaction:
   ```sql
   -- NOT EXECUTED. Shape only.
   SET XACT_ABORT ON;
   BEGIN TRAN;
       -- CREATE TABLE + IX (§2)                          [batch 1]
       -- baseline INSERT WITH (TABLOCKX, HOLDLOCK) (§6)  [batch 1; omit if baseline rejected]
   GO
       -- CREATE TRIGGER dbo.trg_ProblemFechaEvento_SoloAgregar (§9)   [own batch]
   GO
       -- CREATE TRIGGER dbo.trg_Problem_FechaEvento (§5)              [own batch]
   GO
   COMMIT;
   ```
   The exclusive lock on `Problem` taken by the baseline is held until COMMIT, so no write can land between the baseline and the trigger. On about 940 rows it lasts milliseconds. Any error rolls back everything.
5. Smoke test: the event count equals the baseline count; both triggers appear enabled in `sys.triggers`.
6. Next normal Excel load: the number of new `I`/`U` events matches the dates that actually changed in the Excel file. Spot-check 2–3 codes.
7. Separate approval: `GRANT SELECT` on the table to the web login, or a read-only procedure.
8. Separate approval later: the Admin history read (§17), on `claude-branch` → VM → `main`.

---

## 17. Admin read behavior (History of Changes panel)

- **Current dates:** from `dbo.Problem`, exactly as today. The normal initiative view does not change.
- **History:** a read keyed by the open detail's `Codigo`, run when the detail opens:
  ```sql
  SELECT e.IdEvento, e.Campo, e.FechaAnterior, e.FechaNueva, e.Operacion, e.Reconstruido,
         e.Origen, e.Usuario, e.SolicitudId, e.FechaRegistro
  FROM dbo.ProblemFechaEvento e
  WHERE e.Codigo = @codigo
  ORDER BY e.IdEvento;
  ```
- **Handler** (`admin_iniciativas_registro`, detail): passes the rows through in that order and maps them to the existing contract `{campo, anterior, nuevo, fecha, usuario}` plus `operacion`, `reconstruido`, `origen`, `solicitud`. `fecha` = `FechaRegistro` converted to UTC-6. `usuario` = `Usuario` (`ADMIN` rows only). `LoginBD` is not sent to the UI.
- **Panel** (`htmlHistorial`): renders chronologically, applies the labels from §4 ("Línea base", "Fecha inicial", "Cambio n", …), and shows "Historial registrado desde …".
- **Admin must never:**
  - reconstruct missing history;
  - invent previous dates;
  - read `NroCambioFecha*` or `FechaOriginal*` to build events;
  - use the history to calculate or show the current date;
  - write history rows;
  - overwrite any `Problem` date from the history.

---

## 18. Testing plan (test environment only)

Setup: a scratch initiative built by scripting an existing row's INSERT (SSMS "Script as INSERT", so no column names are invented here), with `Codigo = 'TST 2099-000001'` (plus `…02`, `…03`). "Rows" = new rows in `ProblemFechaEvento` after each step.

| # | Action | Expected |
|---|---|---|
| T1 | INSERT with all 3 dates NULL | 0 rows |
| T2 | INSERT with `FechaAnalisis` only | 1: `FechaAnalisis`, NULL→d, `I` |
| T3 | INSERT with all 3 dates | 3, `I` |
| T4 | UPDATE of an unrelated column only | 0 (early exit) |
| T5 | UPDATE setting a date to itself, plus an unrelated column | 0 |
| T6 | `FechaAnalisis` d1→d2 | 1, `U` |
| T7 | `FechaSolucion` NULL→d | 1, `U`, `FechaAnterior` NULL |
| T8 | `FechaCierre` d→NULL | 1, `U`, `FechaNueva` NULL |
| T9 | one UPDATE changing Solución **and** Cierre | 2, same `FechaRegistro` |
| T10 | A→B, then B→A | 2 |
| T11 | time-only change (only if a datetime type) | 0 |
| T12 | multi-row UPDATE: `FechaSolucion = DATEADD(day,1,…)` on all TST rows that have one | rows = number of affected rows; the revert produces the same number again |
| T13 | multi-row UPDATE over **all** rows setting each date to itself | 0 |
| T14 | `usp_CargarExperiencia` twice with the same staging data | **both runs succeed**; the 2nd run writes 0 rows |
| T15 | change one date in staging, run the loader | **succeeds**; exactly 1 `U`, `NO_DECLARADO`, `Usuario`/`SolicitudId` NULL, `LoginBD` = loader login; duration within noise of the run without the trigger |
| T15b | context ADMIN + user + 123 → UPDATE; clear the context → UPDATE on the same connection | 1st: `ADMIN`/user/123; 2nd: `NO_DECLARADO`/NULL/NULL |
| T15c | context ADMIN **without** user → UPDATE | fails on `CK_ProblemFechaEvento_Atribucion`; `Problem` unchanged; 0 rows |
| T15d | context ADMIN + user, no request id | 1 row, `SolicitudId` NULL |
| T15e | DELETE a TST `Problem` row that has history | **rejected by the FK**; a row without history deletes normally |
| T15f | UPDATE / DELETE on `ProblemFechaEvento` | both rejected by the guard (50001) |
| T15g | baseline script on the test copy | count = non-NULL dates; every row is `B`, `Reconstruido = 1`, `FechaAnterior` NULL |
| T16 | rollback step 1: a load runs normally, 0 new rows, table intact. Step 2: table gone; `Problem` and the loader unaffected | as described |

Cleanup (test environment only): disable the guard, delete the TST events and then the TST rows, re-enable the guard.

---

## Approval checklist

**Before the test environment**
- [ ] O1/O2: P0-1 (and P0-6 if applicable) run; `{{TIPO_CODIGO}}` filled; dates confirmed as a date/time type.
- [ ] O3: no `OUTPUT` without `INTO` targeting `dbo.Problem`.
- [ ] O4: `cargar_experiencia.py` reviewed: no direct writes to `dbo.Problem` (or each finding resolved).
- [ ] O5: no unknown writers (P0-3, P0-7, owners asked).
- [ ] O6: the loader's and the web's database logins identified.
- [ ] Test environment selected.

**Design**
- [ ] Table schema (§2): one row per field transition, `FechaAnterior`/`FechaNueva` separate from `FechaRegistro`.
- [ ] Trigger behavior (§5): `AFTER INSERT, UPDATE`, set-based, `EXCEPT` comparison, no claim that it cannot fail.
- [ ] Append-only (§9): no updates or deletes, permissions plus guard trigger.
- [ ] Day-level comparison: time-only changes ignored.
- [ ] Baseline (§6): load it ("Línea base", current non-NULL values, including non-current rows) **or** skip it.
- [ ] `NroCambioFecha*` and `FechaOriginal*` excluded from history; "Cambio n" derived by the UI (§4 labels).
- [ ] Intentional FK-based delete prevention accepted (§8).
- [ ] Excel attribution (§7): `NO_DECLARADO`, no `Usuario` or `SolicitudId`, `LoginBD` recorded; `EXCEL` deferred.
- [ ] Future web attribution requirement (§7, §11): `ADMIN` + required authenticated `Usuario` + `SolicitudId` when the workflow exists + `LoginBD`; no `Motivo` column.
- [ ] `dbo.Problem` and `usp_CargarExperiencia` remain unmodified.

**Test → production**
- [ ] T1–T16 pass.
- [ ] The loader works normally with the trigger enabled (T14, T15).
- [ ] No unexpected performance or regression issue (load duration compared).
- [ ] Deployment (§16) and rollback (§15) reviewed, including the permanent loss on step 2.
- [ ] Separate approval for the web login's `SELECT`.
- [ ] Separate approval later for the Admin history-read code.
