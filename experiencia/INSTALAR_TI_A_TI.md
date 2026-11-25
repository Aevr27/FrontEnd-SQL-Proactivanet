# Botón «TI a TI» de Experiencia: cómo se instala

El botón **TI a TI** de la pestaña Experiencia quita de toda la pestaña los
requerimientos de TI a TI. Abre con ellos incluidos («Incluidos») y al
picarlo cambia a «Sin TI a TI». Funciona como «Sin proveedores» de SLA.

## Qué quita

La misma regla de la página «Camino a 7,000» (el `89_mapa_reduccion.sql` v2,
que decidió el dueño; ese script no está en este repositorio). La regla del
sitio vive en `App_Code/TicketTIaTI.cs`. Son **peticiones de
servicio** (las SorIA Peticiones no) que cumplen una de dos condiciones:

- son del servicio **S-Servicios TI**, las notifique quien las notifique;
- son del cliente **OAT** y **no las notifica una tienda**. «Tienda» es la
  regla de sitio del 89: empieza con número, City Club, Cedis o Cad, o trae
  algún dígito y ninguna `\` (las cuentas de dominio la llevan). CEDIS y
  City Club se quedan.

La casilla «También los de permisos» abre marcada y quita también las de
**S-Acceso Aplicaciones - Permisos**. Sin marcar, esas se quedan.

Cómo se comporta en la pantalla:

- **El número entre paréntesis.** El rótulo («TI a TI (1,180)») dice cuántos
  hay en lo que se ve: el SLOT 0 o el mes en curso, con los filtros de dueño y
  el tipo de registro. Con «Incidentes» es 0, porque todos son requerimientos.
- **Qué cambia.** Con el botón puesto cambian:
  - las tarjetas, gráficas y tablas;
  - el histórico y el pronóstico;
  - «Volumen − Automatizado»;
  - la descarga de tickets. El libro dice en su cabecera «TI a TI: Sin TI a TI».
- **La nota.** Arriba de las tarjetas aparece una nota con cuántos se quitaron
  y qué incluye.
- **Qué no cambia.** Tickets Reduce, % Efectividad Reducción y las listas de
  iniciativas.
- **Cuándo vuelve a «Incluidos».** Con «Limpiar», al cambiar de pestaña y al
  volver a abrir el tablero. No se guarda en ningún lado.

## Qué se copia al servidor

**No hay cambios en la base de datos.** Se copian estos archivos del sitio:

| Archivo | Qué cambia |
|---|---|
| `App_Code/TicketTIaTI.cs` | **Nuevo.** La regla, en un solo lugar. |
| `App_Code/ExperienciaTIaTI.cs` | **Nuevo.** Cuántos de TI a TI hay por categoría y periodo. |
| `handlers/experiencia_ti.ashx` | **Nuevo.** Lo sirve a la pestaña. |
| `App_Code/ExperienciaQueries.cs` | La descarga trae y aplica la clase de TI a TI. |
| `App_Code/ExperienciaAutomatizados.cs`, `App_Code/DashboardQueries.cs` | Los automatizados aceptan el botón. SLA no lo ofrece. |
| `handlers/experiencia_automatizados.ashx`, `handlers/experiencia_exportar.ashx` | Leen `?ti=excluir` y `?ti_permisos=dejar`. |
| `experiencia/experiencia.js`, `.html`, `.css` | El botón, la casilla, la nota y la ayuda. |
| `dashboard.js` | Avisa a Experiencia al volver a su pestaña desde otra. |

Hay que copiar todo `App_Code` junto: si falta `TicketTIaTI.cs` o
`ExperienciaTIaTI.cs`, el sitio no compila.

## Cómo se ve que quedó

1. Abre la pestaña Experiencia. El botón aparece deshabilitado con «TI a TI
   (…)» y en un momento muestra su número. Los datos se piden después de
   pintar la pestaña, así que la pestaña no tarda más en abrir.
2. Para ver la respuesta directa, abre
   `handlers/experiencia_ti.ashx?anio=2026`. Debe traer `regla`, `categorias`
   y `categorias_v2`.
3. Pica el botón. «Volumen Actual» debe bajar exactamente lo que decía el
   rótulo, y la nota debe aparecer.
4. Revisa «Volumen − Automatizado». Si dice «Error al consultar SLA» solo con
   el botón puesto, la cuenta del sitio no puede ejecutar `dbo.fn_CategoriaC1`
   (con el botón, los automatizados la usan directo). Concentración ya llama
   igual a `dbo.fn_CategoriaC1C2`. Prueba
   `handlers/experiencia_automatizados.ashx?modo=mes&fecha_inicio=2026-01-01&fecha_fin=2026-11-30&ti=excluir`.
   Solo hace falta si la cuenta del sitio no tiene ya EXECUTE sobre el
   esquema `dbo` (según `DASHBOARD.md`, en QA `PROACTIVANETAD` lo tiene; qué
   login usa el sitio lo dice el `Web.config` del servidor). En ese caso el
   permiso sería `GRANT EXECUTE ON dbo.fn_CategoriaC1 TO [cuenta del sitio];`,
   y se pide aparte, con aprobación: no forma parte de esta instalación.

Si `experiencia_ti.ashx` falla, el botón dice «TI a TI (sin dato)» y se
queda deshabilitado. El resto de la pestaña sigue igual. Con el corte de
respaldo (sin handler), el botón no aparece.

## Cómo se probó

- `tools/tests/TiATiExperienciaSmoke.js` (node). Con datos inventados prueba
  el volumen con y sin el botón, la casilla, el tipo de registro, el modo Mes,
  que nada quede negativo, que todo vuelva igual al apagarlo, lo que se pide
  al servidor, «Limpiar» y la vuelta a la pestaña. Si `89_mapa_reduccion.sql`
  está junto a la raíz del repositorio, compara las constantes de la regla
  contra las del 89; si no, ese caso sale como SKIP.
- `tools/tests/TiATiSqlLocalDbSmoke.cs` (LocalDB, base desechable). Corre
  el SQL del sitio sobre tickets escritos a mano, cada uno con la clase que
  la regla le debe dar: la columna del export, la lectura de
  `experiencia_ti.ashx` por SLOT y por mes, y el predicado de los
  automatizados con y sin los de permisos. Las vistas son réplicas y la
  colación es la de LocalDB: no sustituye la comprobación en QA de arriba.
- El arnés de Docker original, `pruebas/correr_ti_a_ti_experiencia.sh`
  (comparaba contra los tickets de la prueba del 89), **no está en este
  repositorio** y no se corrió.
