# Pestaña "Efectividad de iniciativas": cómo se instala

La pestaña es la boleta de las iniciativas. Cada una promete bajar un % los
tickets de sus categorías; la base las califica una vez al día
(`60_efectividad_iniciativas.sql`, al final del ETL) comparando los 90 días
de antes con los 90 de después de su cierre, corregido por lo que pasó con el
resto del volumen. La pestaña enseña ese cálculo:

- **Tarjetas**: el % de efectividad (lo logrado entre lo prometido), cuántas
  iniciativas se midieron y cómo salieron (efectivas, parciales, sin baja),
  los tickets evitados, el rebote, cuántas están en medición y cuántas no se
  pueden calificar.
- **Medidas**: la lista con la calificación de cada una. Clic en una fila
  abre su **boleta**: antes, lo esperado sin la iniciativa, después y la meta,
  por categoría.
- **En medición**: cuándo se va a poder calificar cada una (90 días después
  de su cierre), con una gráfica por mes.
- **No se puede calificar**: las que no entran y por qué, en tres grupos:
  corregir en el Excel, sin historia suficiente y no entran por regla.
- **Descargar Excel**: cinco hojas con todo lo de arriba, con los filtros
  puestos.

Los filtros son los de Experiencia (Director, Product Owner, Manager, Service
Owner) más el tipo de iniciativa (PRB, SOR, MAP, ADO...). Con los mismos
filtros, el % es el mismo que la tarjeta "% Efectividad Reducción" de
Experiencia.

La pestaña no calcula nada nuevo ni escribe en la base: lee lo que dejó el 60.

## 1. La base de datos

**No hay nada que correr.** Usa lo que ya está instalado desde el
2026-10-09: el 60 (`dbo.ExpEfectividad`, `dbo.ExpEfectividadCorrida`) y lo que
lee Experiencia.

**Permisos.** La cuenta del tablero (el `User ID` del `Web.config`) ya lee
todo lo que hace falta, porque la tarjeta de Experiencia funciona:
`dbo.ExpEfectividad`, `dbo.ExpEfectividadCorrida`, `dbo.Problem`,
`dbo.ProblemCategoria` y las vistas de Experiencia. Si la pestaña dice
"Todavía no hay cálculo" mientras la tarjeta de Experiencia sí trae un %,
falta el `SELECT` de esa cuenta sobre las dos tablas del 60:

```sql
GRANT SELECT ON dbo.ExpEfectividad        TO [usuario_del_tablero];
GRANT SELECT ON dbo.ExpEfectividadCorrida TO [usuario_del_tablero];
```

## 2. El sitio (IIS)

### Archivos nuevos: se copian tal cual

Ninguno existía, así que no pisan nada:

```
efectividad/efectividad.html
efectividad/efectividad.css
efectividad/efectividad.js
efectividad/vendor/xlsx.mini.min.js
efectividad/vendor/LEEME.md
handlers/efectividad.ashx
App_Code/EfectividadQueries.cs
```

`App_Code/EfectividadQueries.cs` se compila solo en la primera petición, como
el resto de `App_Code`. Usa lo que ya está, sin cambiarlo:
`ExperienciaQueries.Construir` (el armado de Experiencia: así las categorías
y sus dueños salen igual que en esa pestaña), `DirectorioOrganizacional`,
`DashboardDb`, `DashboardDataInfo` y `DashboardHandler`. Necesita el
`ExperienciaQueries.cs` que se publicó el 2026-10-13 (el de la tarjeta de
efectividad).

### Archivos compartidos: dos cambios chicos

Se hicieron sobre el `dashboard.html` y el `dashboard.js` del repositorio
(el del 2026-10-06 con la pestaña de Análisis de servicios). Si en el
servidor ya hay una versión más nueva, **no se reemplaza el archivo**: se
agregan estos tres pedazos a mano.

**`dashboard.html`, en la barra lateral**, después del botón de Experiencia
(el `<li>` que tiene `id="mtab-experiencia"`):

```html
        <li>
          <button class="mnav" id="mtab-efectividad" data-tab="efectividad" type="button" title="Efectividad de iniciativas">
            <svg class="mnav-ico" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path d="M5 19.5V13M10 19.5V9.5M15 19.5V15"/><path d="m13.5 7 2.5 2.5L20.5 5"/>
            </svg>
            <span class="mnav-txt">Efectividad</span>
          </button>
        </li>
```

**`dashboard.html`, el contenedor**, después de
`<div id="tab-experiencia" ...></div>`:

```html
  <div id="tab-efectividad" class="maintab-content" role="region" aria-labelledby="mtab-efectividad"></div>
```

**`dashboard.js`**, antes de `const TableroBacklog = moduloEmbebido({`:

```js
const TableroEfectividad = moduloEmbebido({
  nombre: 'Efectividad de iniciativas',
  base: 'efectividad/',
  id: 'tab-efectividad',
  pagina: 'efectividad.html',
  hoja: 'efectividad.css',
  guion: 'efectividad.js',
  alVolver: () => {
    const modulo = window.TableroEfectividadModulo;
    if (modulo) modulo.redimensionar();
  },
});
```

y en `const MODULOS = { ... }`, debajo de `experiencia: TableroExperiencia,`:

```js
  efectividad: TableroEfectividad,
```

`tools/tests/BarraLateralSmoke.js` ahora espera nueve módulos en la barra
(antes ocho).

## 3. Cómo comprobar que quedó

1. Abrir el tablero y entrar a "Efectividad": salen las seis tarjetas y la
   lista de Medidas. La primera vez tarda lo mismo que abrir Experiencia:
   lee lo mismo.
2. Sin filtros, el **% Efectividad** es el mismo que la tarjeta
   "% Efectividad Reducción" de Experiencia (el 2026-10-13, 34%). Con el
   mismo Director (o PO, Manager, Service Owner) en las dos pestañas, también.
3. Clic en una iniciativa: se abre su boleta con una gráfica por categoría.
4. "⬇ Descargar Excel" baja `Efectividad_iniciativas_<fecha>.xlsx` con cinco
   hojas.

## 4. Cómo se probó

`pruebas/correr_efectividad.sh` (Docker con SQL Server): sobre la base de
prueba del 60 corre `EfectividadQueries.Construir` con Mono
(`tools/tests/EfectividadPestanaSmoke.cs`) y las cuentas de `efectividad.js`
con node (`tools/tests/EfectividadPestanaSmoke.js`): sin filtros dan lo mismo
que la corrida del 60, y con cada dueño del catálogo, lo mismo que la tarjeta
de Experiencia. También sin la corrida del 60 (dice "Todavía no hay
cálculo"). La página se probó en Chromium, suelta y dentro del tablero.
