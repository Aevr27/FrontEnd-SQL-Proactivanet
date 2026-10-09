# Pestaña "Análisis de servicios": cómo se instala

La pestaña deja que cada service owner escoja su servicio y un periodo, y ve
cuándo llegan los tickets, en qué sitios, por qué motivo y cómo se atienden.
También descarga el Excel de siete hojas (con la descripción de cada ticket)
y deja probar reglas de motivo y armar el script que las guarda.

Son dos partes: la base (la corre el dueño en SSMS) y el sitio (lo sube quien
administra IIS). Primero la base: sin ella la pestaña abre, pero avisa que no
hay servicios.

**Los scripts de base (47 a 59) no están en este repositorio**: los corre el
dueño de la base desde su copia. La tabla de abajo describe lo que hace cada
uno según su autor; no se ha comprobado desde aquí.

## 1. La base de datos (SSMS)

Correr en `Tickets_Proactivanet`, en este orden, abriéndolos como archivo:

| Script | Qué hace |
|---|---|
| `47_analisis_servicios.sql` | Crea `dbo.AnalisisServicio`, `dbo.AnalisisServicioCriterio`, `dbo.AnalisisRegla`, `dbo.usp_Analisis_Servicios` y `dbo.usp_Analisis_Datos`. Solo crea objetos nuevos y se puede volver a correr. |
| `48_analisis_s_biometrico.sql` | Da de alta S-Biométrico con sus criterios y sus 19 reglas. Cada vez que se corre sube su versión de reglas. |
| `49_analisis_s_punto_de_venta.sql` | Da de alta S-Punto de Venta (las tres rutas, vieja y nuevas) con sus 36 reglas. Igual que el 48: no toca a los demás servicios. |
| `51_analisis_s_acceso_aplicaciones.sql` | Da de alta S-Acceso Aplicaciones - Permisos con sus 26 reglas. Igual que el 48. (El 50 no es de la pestaña: es la variación mensual.) |
| `52_analisis_s_caja_general.sql` | Da de alta S-Caja General (con el árbol viejo de Backoffice) con sus 28 reglas. Igual que el 48. |
| `54_analisis_s_equipo_de_computo.sql` | Da de alta S-Equipo de Cómputo (con Administración de Impresiones y Reparación de Equipo desde la versión del 2026-10-09) con sus 27 reglas. Igual que el 48: si ya se corrió el de antes, se vuelve a correr y sube la versión de reglas. (El 53 no es de la pestaña: es el de oportunidades.) |
| `55_analisis_s_logistica.sql` | Da de alta S-Logística (FENIX WMS, con el árbol viejo S-FENIX WMS) con sus 27 reglas. Igual que el 48. |
| `56_analisis_s_fenicia.sql` | Da de alta S-Fenicia con sus 12 reglas. Igual que el 48. |
| `57_analisis_s_gestion_de_inventarios.sql` | Da de alta S-Gestión de Inventarios (App Evolución) con sus 38 reglas. Igual que el 48. |
| `58_analisis_s_basculas.sql` | Da de alta S-Básculas (con los grupos de los proveedores Berkel, Bizerba y Mexba) con sus 24 reglas. Igual que el 48. |
| `59_analisis_s_autocobro.sql` | Da de alta S-Autocobro (con el grupo Autocobro y los proveedores NCR, Toshiba, LinkX y Bitu) con sus 30 reglas. Igual que el 48. |

**Si ya se corrió un 47 anterior** (el del 2026-10-06 en la mañana, sin las
exclusiones de abajo), se vuelve a correr el de ahora: solo recrea los dos
procedimientos; las tablas y lo que cargó el 48 se quedan.

**Lo que no cuenta.** Los tickets del grupo SorIA (el bot) y los que cerró
una cuenta de `dbo.CatCuentaNoPersona` ("Desk, Smart", "User, Setup"...) no
son trabajo del servicio: no salen en la pestaña ni en el Excel, y el
Resumen dice cuántos se quitaron. El 47 necesita esa tabla (la crean
`04_dashboard_sla.sql` y `16_catalogos_tecnicos.sql`); si no está, avisa y
no crea nada. Para que una cuenta vuelva a contar: `Habilitado = 0` en el
catálogo.

**Permiso.** El tablero llama a los dos procedimientos con su usuario de SQL
(el `User ID` del `Web.config` del servidor). Si ese usuario no tiene
EXECUTE sobre todo el esquema `dbo`, hay que darle estos dos:

```sql
GRANT EXECUTE ON dbo.usp_Analisis_Servicios TO [usuario_del_tablero];
GRANT EXECUTE ON dbo.usp_Analisis_Datos     TO [usuario_del_tablero];
```

Cómo saber si hace falta: después de instalar el sitio, si la pestaña dice
"No se pudo leer la lista de servicios" con un error de permisos, falta.

## 2. El sitio (IIS)

### Archivos nuevos: se copian tal cual

Ninguno existía, así que no pisan nada:

```
analisis/analisis.html
analisis/analisis.css
analisis/analisis.js
analisis/motor.js
analisis/trabajo.js
analisis/vendor/exceljs.min.js
handlers/analisis.ashx
App_Code/AnalisisQueries.cs
```

`App_Code/AnalisisQueries.cs` se compila solo en la primera petición, como el
resto de `App_Code`. Usa lo que ya está: `DashboardDb.CadenaConexion()`,
`SqlRowMapper.Fila`, `DashboardHandler.Registrar` y `MensajeSeguro`, y
`DashboardDataInfo.HoyEnPresentacion()`. No cambia ninguno de ellos.

`analisis/trabajo.js` es el Web Worker que hace la parte pesada (leer,
preparar y analizar); si el navegador no lo levanta, `analisis.js` lo carga
como script normal. Va junto a `analisis.js`.

### Archivos compartidos: dos cambios chicos

En este repositorio `dashboard.html` y `dashboard.js` ya traen estos pedazos;
solo hace falta aplicarlos a mano si el servidor tiene otra versión.

Se hicieron sobre la versión de producción que mandó el dueño el
2026-10-06. Si en el servidor ya hay una más nueva, **no se reemplaza el
archivo**: se agregan estos tres pedazos a mano.

**`dashboard.html`, en la barra lateral**, después del botón de QARE (el
`<li>` que tiene `id="mtab-qare"`):

```html
        <li>
          <button class="mnav" id="mtab-analisis" data-tab="analisis" type="button" title="Análisis de servicios">
            <svg class="mnav-ico" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <circle cx="10.5" cy="10.5" r="6"/><path d="m15 15 5 5M7.5 12.5v-2M10.5 12.5v-4M13.5 12.5v-3"/>
            </svg>
            <span class="mnav-txt">Análisis de servicios</span>
          </button>
        </li>
```

**`dashboard.html`, el contenedor**, después de `<div id="tab-qare" ...></div>`:

```html
  <div id="tab-analisis" class="maintab-content" role="region" aria-labelledby="mtab-analisis"></div>
```

**`dashboard.js`**, junto a `const TableroQare = moduloEmbebido({...});`:

```js
const TableroAnalisis = moduloEmbebido({
  nombre: 'Análisis de servicios',
  base: 'analisis/',
  id: 'tab-analisis',
  pagina: 'analisis.html',
  hoja: 'analisis.css',
  guion: 'analisis.js',
  alVolver: () => {
    const modulo = window.TableroAnalisisModulo;
    if (modulo) modulo.redimensionar();
  },
});
```

y en `const MODULOS = { ... }`, debajo de `qare: TableroQare,`:

```js
  analisis: TableroAnalisis,
```

`tools/tests/BarraLateralSmoke.js` ahora espera ocho módulos en la barra (antes siete).

## 3. Cómo comprobar que quedó

1. Abrir el tablero y entrar a "Análisis de servicios": aparece S-Biométrico
   en la lista.
2. Escoger "3 meses" y pulsar Analizar: en unos segundos salen los
   indicadores, los hallazgos y las siete hojas.
3. "⬇ Descargar Excel" baja `Analisis_biometrico_<desde>_<hasta>.xlsx`.

Un periodo de 6 meses de S-Biométrico son unos 7,500 tickets y unos 12 MB
de respuesta (con los textos); si el servidor tiene la compresión dinámica de
IIS, viaja mucho menos.

## 4. Un servicio nuevo o reglas nuevas

Las reglas viven en `dbo.AnalisisRegla`. Nadie las escribe a mano en la
base:

- En la hoja "Reglas" de la pestaña, el owner prueba cambios (no se guarda
  nada) y "Generar script SQL" baja un `.sql` que el dueño corre en SSMS.
- Un servicio nuevo se arma en `analisis_servicio/servicios.js` y
  `node analisis_servicio/armar_scripts.js` genera su script, con la misma
  función que usa el botón de la pestaña. Esa carpeta no está en este
  repositorio.
