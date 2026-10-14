# Admin: Crear / Guardar cambios → SQL — estado y cutover

Fecha: 2026-10-14. Nada de esto se ha corrido en la VM, QA ni producción.
`PersistenciaGestionAdmin.Habilitada = false` y `AltaCategoriaProactivanet.Habilitada = false` (const).

## A. Estado actual

| Pieza | Dónde | Estado |
|---|---|---|
| Frontend | `claude-branch` HEAD `cc3977d` + cambios de esta sesión **sin commit** | `origin/main` (desplegado) = `107484c`: **no** trae nada de esto |
| Migración | `sql/18_gestion_admin_persistencia.sql` (+ rollback) | sin aplicar (volcado 2026-10-13: no hay esquema `adm`) |
| Backend | `Proactivanet Project/backend_admin_persistencia/` (git local `9247dd0`, sin remoto) | ADM_01/02/03 + rollbacks, sin aplicar; falta entregarlo al dueño del repo del backend |
| Diagnóstico | `sql/diag_admin_persistencia_cutover.sql` | solo lectura; probado en LocalDB, sin correr en la VM |

## B. Los dos botones, de punta a punta

**Crear** — `admin/iniciativas.html#admGuardar` → `VistaCrearAdmin.guardar()` (admin/iniciativa-admin.js; revisión local `BorradorAdmin.revisar()`, solo bloquea sin Tipo/prefijo) → `enviarGestion()` POST multipart `accion=crear` → `handlers/admin_iniciativas_gestion.ashx` → `AccesoAdmin.ExigirAdm` (403 si no es ADM) → `PeticionCrearAdmin.DesdeFormulario` → `ValidadorGestionAdmin.FormatoCrear` (422) → `GestionIniciativaAdminService.Crear` (lee catálogo, capacidad, valores existentes; 503 si falla) → `PlanificadorGestionAdmin.Crear` → **si `PersistenciaGestionAdmin.Activa()`**: `IdentidadWindows.DesdeContexto` (403 `SinUsuario` sin Windows auth) → `Guardar` → `EscritorGestionAdminSql.Crear` → `adm.usp_GestionAdmin_Crear` (una transacción: candado de Código por prefijo/año, `RevisarTope`, `INSERT dbo.Problem` → `trg_Problem_FechaEvento` 'I', `INSERT dbo.ProblemCategoria`, `adm.usp_GestionAdmin_TicketsReduce`; `@Codigo` OUTPUT solo tras COMMIT) → 200 `{accion:'crear', guardada:true, codigo}` → JS estado `guardada` (muestra el código, limpia el borrador) → `alGuardar` → `VistaRegistro.cargar()` (lista y búsqueda "existente" recargadas). **Sin la persistencia**: 501 `PersistenciaNoHabilitada` → "Solo validación… NO se guardó".

**Guardar cambios** — detalle del registro → `data-accion="edicion-guardar"` → `VistaRegistro.guardarEdicion()` (admin/registro-iniciativas.js; `EdicionAdmin.revisar()`) → POST `accion=modificar` (solo lo que cambió: textos, fechas, estado, `pct_*` + `pct_tipo_agrupado`, `agregar_*` + tipos, `fcat_*`, `quitar_categoria`) → mismo handler → `FormatoModificar` → `GestionIniciativaAdminService.Modificar` (lee la iniciativa del **mismo** registro que pinta la página) → `PlanificadorGestionAdmin.Modificar` → con persistencia: `EscritorGestionAdminSql.Modificar` → `adm.usp_GestionAdmin_Modificar` (una transacción: bloqueo de la fila del Problem, tope con candado, `UPDATE dbo.Problem` → eventos de la iniciativa, NroCambioFecha*, `UPDATE/INSERT dbo.ProblemCategoria` → `trg_ProblemCategoria_FechaEvento`, TicketsReduce) → 200 `{accion:'modificar', guardada:true}` → JS recarga el registro y reabre el detalle (historial, categorías y capacidad salen del registro nuevo) con el aviso en `#regDetAviso`.

Respuestas de escritura (handler): 200 guardada · 409 `TopeExcedido|CategoriaRepetida|DatoInvalido|CodigoNoEmitido|EscrituraRechazada` (THROW antes del COMMIT: nada guardado) · 409 `PendienteSinRegla` (quitar categoría) · 500 `EscrituraNoConfirmada` (`guardada:null`: no se sabe; pedir revisar el registro antes de reintentar). Solo `200 + guardada:true + accion` (+ `codigo` en un alta) se pinta como guardado.

Los rótulos de los botones salen de `persistencia_admin` del registro (`admin_iniciativas_registro.ashx`): "Guardar" solo si el servidor guarda; si no, "Validar en el servidor (no guarda)".

SQL: misma cadena `TicketsProactivanet` que el resto del tablero (`ConnectionStringProvider`). Los procedimientos de `adm` no usan `EXECUTE AS`: corren con los permisos del que llama y, como `adm` es `AUTHORIZATION dbo`, el encadenamiento de propiedad cubre `dbo.*`. **Basta `GRANT EXECUTE ON SCHEMA::adm`**; sin él, 229 (probado: LocalDB P4 y diagnóstico D5d). `adm` no tiene tablas: el `DENY` sobre `adm` no aplica.

## C. Lo que falta, por prioridad

| # | Prioridad | Qué | Evidencia | Remedio | Quién | Cierra cuando |
|---|---|---|---|---|---|---|
| 1 | P0 | El cargador del Excel sigue activo: pisa las columnas de Problem/ProblemCategoria y marca `VigenteEnOrigen = 0` a todo Código que no venga en el libro → borraría de la vista lo creado por Admin | `tools/tests/usp_CargarExperiencia_174bb51.sql` (UPDATE de 35+12 columnas; barrido a 0) | Apagar el programador, conciliación final, instalar ADM_03 (stub 51900) | Negocio + VM + DBA | D2b `CargadorEsStub = 1` |
| 2 | P0 | sql/18 sin aplicar | volcado 2026-10-13 sin `adm` | Aplicar 18 con su guarda | DBA (con OK) | D4: columnas, `adm`, trigger |
| 3 | P0 | Falta `GRANT EXECUTE ON SCHEMA::adm` a la cuenta del sitio | sql/18 §8 comentado; LocalDB P4 = 229 | `GRANT EXECUTE ON SCHEMA::adm TO [<usuario del sitio>]` | DBA | D5d `EjecutaAdm = 1` |
| 4 | P0 | Versiones desplegadas sin verificar (cargador, vw_ProblemCategoria, vw_ProblemVencido): los scripts se niegan si no coinciden | volcado con cuerpos truncados | Correr el diagnóstico; si difieren, rehacer ADM_01/02/03 y sus rollbacks sobre la versión real | DBA + código | D2b = 1/1/1 |
| 5 | P0 | El código no está desplegado (main ≠ claude-branch) y el switch es const false | `origin/main` `107484c` | PR a main + deploy; encender el switch es un cambio de código aparte | Código + VM (con OK) | Página muestra "Guardar" |
| 6 | P1 | TicketsReduce: Admin usa `ROUND(VolumenUltimos30 × %, 0)` con el volumen de `vw_ProblemCategoria` (regla verificada en QA 2026-10-01); el cuerpo de `usp_Exp_CalcularTicketsReduce` (65) no está disponible para compararlo (puede usar el SLOT 0) | `esquema_bd/procedimientos/...TicketsReduce.sql` truncado | D3: leer el 65; si su volumen difiere, cambiar `adm.usp_GestionAdmin_TicketsReduce` para usar la misma fuente. Mientras tanto el tablero usa `ExpTicketsReduce` cuando existe | Código | Fórmulas iguales |
| 7 | P1 | `usp_Exp_CalcularEfectividad`: cuerpo no disponible; efecto de filas con NULL en campos del Excel desconocido | volcado truncado | D3 + leerlo | Código | Sin dependencias de esos campos |
| 8 | P1 | Regla de vencidas (ADM_02): la iniciativa vence cuando vence su primera fecha de análisis por categoría | ADM_02 | Decidir: así, o aviso por categoría | Negocio | Decisión escrita |
| 9 | P1 | Tope: la base cuenta las filas vivas SIN agrupación (para no pasar de 100%); la vista previa del navegador (`ExperienciaQueries.CompromisosCapacidad`) no → la base puede rechazar (409 `TopeExcedido`) lo que la vista previa dejó pasar | `sql/18` RevisarTope; LocalDB K12/K13 | Decidir si la vista previa (y Nueva solicitud) también las cuenta; D7b/D7c dicen cuántas hay | Negocio → código | Decisión + D7c |
| 10 | P1 | Códigos con número ilegible bloquean el alta de su prefijo/año (51023) | `adm.usp_GestionAdmin_Crear`; LocalDB C8 | D7a2 los lista; reparar = el DBA renombra ese Código a uno bien formado sin usar (el SP considera todos, activos o no: no puede duplicar) | Negocio + DBA | D7a `Ilegibles = 0` |
| 11 | P1 | Ninguna prueba en IIS ni navegador real | — | Smoke manual (§G) en la VM tras el deploy | VM | §G completo |
| 12 | P1 | Paquete del backend sin remoto | `backend_admin_persistencia` git local | Entregarlo al dueño del repo del backend | Andrés | En su repo |
| 13 | P2 | Owner/Dirección opcionales → el aviso de vencidas de una iniciativa nueva no lleva Owner Problem ni copias (sí dueños por categoría); no bloquea escrituras | `vw_ProblemVencidoAviso` (26) | Capturarlos cuando haya regla | Negocio | — |
| 14 | P2 | `FechaOriginalCierre` NULL en las nuevas → `vw_ProblemCategoria.Vencida = 0`. Ningún consumidor encontrado en este repo ni en los scripts del backend leídos (el aviso usa `vw_ProblemVencido.DiasVencida`) | grep repo + scripts 13/26/28/38 | D8 confirma consumidores en la base | DBA | D8 sin lectores |
| 15 | P2 | `EstadoProblem`, `CierreProblem`, `MejorFecha` NULL en las nuevas: solo los escribe el cargador; sin lectores encontrados | idem | D8 | DBA | D8 |
| 16 | P2 | `FechaEntregaAnalisis`: solo se valida el formato (puede ser anterior a la creación); vacía = hoy | `FormatoCrear`, sql/18 | Decidir una regla si hace falta | Negocio | — |
| 17 | P2 | Quitar categoría sin regla: con la persistencia activa el servidor responde 409 `PendienteSinRegla` (nada se guarda); el botón sigue visible | handler | Decidir baja (física o marca) | Negocio | — |
| 18 | P2 | Reintentar tras `EscrituraNoConfirmada` en un alta podría crear otra iniciativa (con otro Código, nunca duplicado) | handler | El mensaje pide revisar el registro antes; el smoke §G lo cubre | Operación | — |
| 19 | P2 | Desarrollo local: el rol de prueba (`AccesoDesarrolloLocal`) no da identidad Windows → escribir en local responde 403 `SinUsuario` | handler | Solo afecta pruebas locales | — | — |
| 20 | P2 | `CatPersona` / `CatCategoriaDueno` congeladas tras el retiro | backend CUTOVER_CHECKLIST | Mantenimiento por DBA a petición | DBA | — |

Estado / Subestado inicial: opcionales en el alta (se validan contra los valores existentes si vienen); no hay valor por omisión. Subestado no se captura al crear.

## D. Diagnóstico de solo lectura (VM)

`sql/diag_admin_persistencia_cutover.sql` — ajustar `@UsuarioSitio`; resultados a texto. Cubre: D1 servidor/RCSI · D2 existencia, fechas y hash de cargador/vistas/SP/triggers · D3 definiciones completas en trozos de 250 (65, 60, vistas, triggers) · D4 precondiciones de 18 y módulos que insertan en las tablas · D5 principal del sitio, roles, permisos y permisos efectivos (`EXECUTE AS USER`) · D6 últimas cargas, quién llama al cargador, jobs de SQL Agent · D7 códigos por prefijo/año (siguiente, ilegibles), filas vivas sin agrupación, rutas > 100% (regla del tablero y de la base), valores que ofrecerá el formulario · D8 consumidores de columnas que Admin deja NULL · D9 último respaldo.

## E. Orden de despliegue (cada paso con su OK)

1. Diagnóstico (§D) y guardar sus definiciones (D3). Parar si D2b no es 1/1/1/0.
2. Respaldo completo y plan de conciliación Excel ↔ SQL.
3. Apagar el programador del cargador; conciliación final aprobada; instalar ADM_03 (backend `CUTOVER_CHECKLIST.md` §1). **Mientras el cargador siga activo, encender la persistencia está prohibido**: la siguiente carga pisaría o desactivaría lo creado.
   *Plan transitorio decidido (2026-10-14):* el cargador sigue activo con ADM_04 instalado **después** de `sql/18` (paso 4), en lugar de ADM_03; modificar de verdad en Admin una iniciativa del Excel (algún valor editable distinto al guardar; sin cambios no cuenta) le transfiere a Admin la iniciativa entera. Verificado y bloqueos: backend `CUTOVER_CHECKLIST.md` §0-B y `ADM_04_RUNBOOK.md`. Sin ADM_04 la prohibición sigue igual: `adm.IniciativaProtegida` sola no protege nada.
4. Aplicar `sql/18` (`aprobar_migracion = 18`).
5. Con su propio OK, después del `COMMIT` de 18 (la sección 8 de `sql/18` está comentada y no corre con el script): `GRANT EXECUTE ON SCHEMA::adm TO [PROACTIVANETAD]` y `DENY INSERT, UPDATE, DELETE ON adm.IniciativaProtegida TO [PROACTIVANETAD]`. Con el plan transitorio, ADM_04 va después de este paso (runbook ADM_04, pasos 3b–5).
6. ADM_01 y ADM_02 (sus precondiciones revisan la versión).
7. Desplegar el frontend (PR de claude-branch a main) **con el switch en false**: la página sigue diciendo "no guarda".
8. Cambio de código aparte: `PersistenciaGestionAdmin.Habilitada = true`, desplegar.
9. Smoke (§G).
10. Vigilar: `dbo.ProblemFechaEvento` (Origen ADMIN, LoginBD = cuenta del sitio), errores 409/500 en la traza del sitio, `ExpTicketsReduce` del día siguiente.

## F. Rollback

Orden: switch a false y deploy → (si está) `ADM_04_…_rollback` con el programador apagado, en la misma transacción que ADM_03 si se retira el cargador (runbook ADM_04, E32) → `ADM_02_…_rollback` → `ADM_01_…_rollback` → `sql/18_…_rollback` → (si se decide volver al Excel) `ADM_03_…_rollback`. El rollback de 18 se niega con 51093 mientras ADM_04 esté instalado.

- El rollback de 18 se niega con 51091 mientras las vistas usen sus columnas, y con 51090 si ya hay fechas o eventos por categoría. **Forzarlo borra los eventos de categoría** (irrecuperables salvo el respaldo); los de la iniciativa (`Categoria IS NULL`) se quedan.
- Las iniciativas creadas por Admin se quedan en `dbo.Problem`/`dbo.ProblemCategoria` (ningún rollback las borra).
- Restaurar el cargador y volver a correrlo **pisa y desactiva** lo creado por Admin que no esté en el Excel: decidirlo antes.

## G. Smoke manual (VM, tras el paso 8)

1. ADM: Crear con prefijo de prueba acordado, sin Clasificación/Agrupación/Estado → "Guardado en la base · Código PPP AAAA-NNNNNN", el siguiente al mayor del prefijo/año (comparar con D7a); aparece en el registro sin recargar la página; queda Incompleta.
2. Crear otra igual → Código = el anterior + 1 (nunca repetido).
3. En el detalle: Historial muestra "Fecha inicial" de Análisis con el usuario de Windows; en SQL `LoginBD` = cuenta del sitio.
4. Modificar: ligar una categoría → su fecha propia = hoy + 15; editarla → "Cambio 1" en "Fechas de análisis por categoría"; la de la iniciativa no se mueve.
5. Editar la fecha de una categoría inicial → cambia la de la iniciativa (Historial de la iniciativa), sin fecha propia.
6. Tope: subir un % por encima de lo disponible → "La base rechazó el guardado. No se guardó nada" con el motivo; nada cambió.
7. Quitar una categoría → 409 `PendienteSinRegla`, nada cambió.
8. Con un usuario MOD: Crear/Guardar → 403, nada guardado.
9. En ningún caso un 422/409/500 dice "Guardado"; con el switch en false (paso 7) la página dice "Validar en el servidor (no guarda)" y el servidor responde 501.
10. Al día siguiente: `ExpTicketsReduce` incluye la iniciativa de prueba; dar de baja la iniciativa de prueba según se acuerde (no hay borrado desde la página).
