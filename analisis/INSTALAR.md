# Pestaña "Análisis de servicios": cómo se instala

La pestaña deja que cada service owner escoja su servicio y un periodo, y ve
cuándo llegan los tickets, en qué sitios, por qué motivo y cómo se atienden.
También descarga el Excel de siete hojas (con la descripción de cada ticket)
y deja probar reglas de motivo y armar el script que las guarda.

Son dos partes: la base (la corre el dueño en SSMS) y el sitio (lo sube quien
administra IIS). Primero la base: sin ella la pestaña abre, pero avisa que no
hay servicios.

**Dónde están los scripts.** El 47, el 78, el 79 y el 80 están en `sql/` de
este repositorio, copiados tal cual del paquete del 2026-10-21
(`Paquete_Analisis_de_servicios_20261006.zip`). Los de cada servicio del 48
al 75 siguen fuera: los corre el dueño de la base desde su copia (el paquete
los trae en `1_base_SSMS/`). Las reglas de la tabla se contaron leyendo los
scripts del paquete (`tools/tests/AnalisisPaqueteSmoke.js`); **ninguno se ha
corrido desde aquí**: lo que hace cada uno en la base es lo que dice su
autor.

## 1. La base de datos (SSMS)

Correr en `Tickets_Proactivanet`, en este orden, abriéndolos como archivo:

| Script | Qué hace |
|---|---|
| `47_analisis_servicios.sql` | Crea `dbo.AnalisisServicio`, `dbo.AnalisisServicioCriterio`, `dbo.AnalisisRegla`, `dbo.usp_Analisis_Servicios` y `dbo.usp_Analisis_Datos`. Solo crea objetos nuevos y se puede volver a correr. |
| `48_analisis_s_biometrico.sql` | Da de alta S-Biométrico con sus criterios y sus 19 reglas. Cada vez que se corre sube su versión de reglas. |
| `49_analisis_s_punto_de_venta.sql` | Da de alta S-Punto de Venta (las rutas vieja y nuevas y, desde el 2026-10-10, `/Soria/Punto de Venta/`) con sus 38 reglas. Igual que el 48: no toca a los demás servicios. |
| `51_analisis_s_acceso_aplicaciones.sql` | Da de alta S-Acceso Aplicaciones - Permisos (y, desde el 2026-10-10, `/Soria/SAP/`) con sus 26 reglas. Igual que el 48. (El 50 no es de la pestaña: es la variación mensual.) |
| `52_analisis_s_caja_general.sql` | Da de alta S-Caja General (con el árbol viejo de Backoffice y, desde el 2026-10-10, `/Soria/Caja General/` y `/Soria/Backoffice POS/`) con sus 28 reglas. Igual que el 48. |
| `54_analisis_s_equipo_de_computo.sql` | Da de alta S-Equipo de Cómputo (con Administración de Impresiones y Reparación de Equipo desde la versión del 2026-10-09, y `/Soria/Fallas de equipos o dispositivos/` desde el 2026-10-10) con sus 27 reglas. Igual que el 48: si ya se corrió el de antes, se vuelve a correr y sube la versión de reglas. (El 53 no es de la pestaña: es el de oportunidades.) |
| `55_analisis_s_logistica.sql` | Da de alta S-Logística (FENIX WMS, con el árbol viejo S-FENIX WMS y, desde el 2026-10-10, `/Soria/Fenix_WMS/`) con sus 27 reglas. Igual que el 48. |
| `56_analisis_s_fenicia.sql` | Da de alta S-Fenicia con sus 12 reglas. Igual que el 48. |
| `57_analisis_s_gestion_de_inventarios.sql` | Da de alta S-Gestión de Inventarios (App Evolución) con sus 38 reglas. Igual que el 48. |
| `58_analisis_s_basculas.sql` | Da de alta S-Básculas (con los grupos de los proveedores Berkel, Bizerba y Mexba y, desde el 2026-10-10, `/Soria/Básculas/`) con sus 24 reglas. Igual que el 48. |
| `59_analisis_s_autocobro.sql` | Da de alta S-Autocobro (con el grupo Autocobro y los proveedores NCR, Toshiba, LinkX y Bitu) con sus 30 reglas. Igual que el 48. |
| `68_analisis_s_servicios_ti.sql` | Da de alta S-Servicios TI con sus 21 reglas (2026-10-10). Igual que el 48. |
| `69_analisis_s_mesa_de_control.sql` | Da de alta S-Mesa de Control con sus 21 reglas (2026-10-10). Igual que el 48. |
| `70_analisis_s_powerbi.sql` | Da de alta S-PowerBI con sus 18 reglas (2026-10-10). Igual que el 48. |
| `71_analisis_usuarios_de_red.sql` | Da de alta Usuarios de Red (con `/Soria/Usuarios RED/`) con sus 16 reglas (2026-10-10). Igual que el 48. |
| `72_analisis_s_comunicaciones.sql` | Da de alta S-Comunicaciones con sus 24 reglas (2026-10-10). Igual que el 48. |
| `75_analisis_s_facturacion.sql` | Da de alta Facturación (`/Facturación/`: Facturacion Clientes y Factura Corporativa) con sus 32 reglas (2026-10-16). Sugiere el periodo desde el 2026-04-01. Igual que el 48. (El 73 y el 74 no son de la pestaña: son diagnósticos.) |
| `79_analisis_s_abasto.sql` | Da de alta S-Abasto (`/S-Abasto/`: SAP y F&R) con sus 27 reglas (2026-10-21). Igual que el 48. Está en `sql/`. |
| `80_analisis_s_conciliaciones.sql` | Da de alta Conciliaciones (`/Conciliaciones/`: Conciliación Bancaria y Servicios Tienda) con sus 19 reglas (2026-10-21). Igual que el 48. Está en `sql/`. |
| `78_analisis_secciones.sql` | Prende, por servicio, lo que no le sirve a todos (2026-10-21): la quincena solo en S-Biométrico y la tabla de los CEDIS que nombra el texto en S-Logística y S-Gestión de Inventarios; los otros 15 (Abasto y Conciliaciones incluidos) quedan en NULL. Solo cambia la columna `Secciones`: no toca reglas ni versiones. Va después del 47 y se puede volver a correr. Está en `sql/`. (El 76 y el 77 no son de la pestaña: son de Orquestación.) |

### S-Abasto y Conciliaciones (2026-10-21)

Solo base: el sitio no cambia para darlos de alta. La lista de la pestaña
sale de `usp_Analisis_Servicios`, así que aparecen en cuanto el 79 y el 80
están corridos; no hay registro de servicios en el sitio.

| | S-Abasto (`abasto`) | Conciliaciones (`conciliaciones`) |
|---|---|---|
| Script | `sql/79_analisis_s_abasto.sql` | `sql/80_analisis_s_conciliaciones.sql` |
| Criterios | Ruta `/S-Abasto/%`; Título `%abasto%`, `%f&r%` (solo para "Fuera de ruta") | Ruta `/Conciliaciones/%`; Título `%concilia%` |
| Grupos | ninguno | ninguno |
| Reglas / frases | 27 / 229 | 19 / 178 |
| Periodo sugerido | desde 2026-04-01 | desde 2026-04-01 |
| Secciones | NULL (sin quincena ni CEDIS) | NULL |
| Motivos de equipo | ninguno | ninguno |

En Conciliaciones dos motivos salen de dos reglas cada uno, a propósito: "Es
de otro servicio..." (R13 y R17) y "Usuario o acceso..." (R11 y R18). La
primera de cada par es la frase precisa y va antes de las reglas generales
del cierre (R14 a R16); la segunda, la palabra suelta, va después. En el
Resumen y en la hoja Motivos cuentan como un solo motivo.

Cada script: exige el 47 con la columna `Secciones` (si no, avisa con
`RAISERROR`, `SET NOEXEC ON` y no cambia nada); corre en una transacción con
`XACT_ABORT` (todo o nada); con `MERGE` da de alta o actualiza **solo su
servicio**, borra e inserta **solo sus** criterios y reglas, y sube su
`ReglasVersion`. Se puede volver a correr. Al volverlo a correr deja
`Secciones` en NULL (el script lo escribe siempre, a diferencia del botón
"Generar script", que la conserva). Los criterios y las reglas que arma
"Generar script" con estas mismas reglas son idénticos a los del script
(lo comprueba `AnalisisAbastoConciliacionesSmoke.js`).

**Casi nadie lo reporta desde una tienda** (Abasto: compradores y Soporte
AMS Inetum). Con menos del 30% de tickets con sitio la pestaña no mide por
sitio (ver "Pocos sitios" abajo) y el hallazgo del día pico dice el día y
los tickets sin "de N sitios". Ese cambio de `analisis/motor.js` ya está en
este repositorio desde d1818db (en `main` con el PR #18); en el servidor
falta subirlo si todavía tiene el `motor.js` de antes del 2026-10-21: sin
él, S-Abasto diría "con 40 tickets de 0 sitios".

Orden (lo hace el dueño de la base, con su aprobación; aquí no se ha corrido):

1. El 47 del 2026-10-21 (con la columna `Secciones`). Según el paquete ya
   está corrido; lo confirma la consulta 1 de abajo.
2. `79_analisis_s_abasto.sql` y `80_analisis_s_conciliaciones.sql`, en
   cualquier orden entre ellos.
3. El 78 no hace falta para estos dos (su script ya los deja en NULL); si se
   vuelve a correr, tampoco los cambia.

Comprobar, de solo lectura:

    -- 1) el 47 nuevo: debe dar un número, no NULL
    SELECT COL_LENGTH('dbo.AnalisisServicio', 'Secciones') AS Columna;
    -- 2) los dos servicios, activos y sin secciones
    SELECT Servicio, Nombre, ReglasVersion, Activo, Secciones
    FROM dbo.AnalisisServicio WHERE Servicio IN ('abasto', 'conciliaciones');
    -- 3) 27 y 19 reglas; 3 y 2 criterios
    SELECT Servicio, Reglas = COUNT(*) FROM dbo.AnalisisRegla
    WHERE Servicio IN ('abasto', 'conciliaciones') GROUP BY Servicio;
    SELECT Servicio, Criterios = COUNT(*) FROM dbo.AnalisisServicioCriterio
    WHERE Servicio IN ('abasto', 'conciliaciones') GROUP BY Servicio;
    -- 4) los dos en la lista del selector (Reglas 27 y 19)
    EXEC dbo.usp_Analisis_Servicios;

En la pestaña (después de Ctrl+F5): S-Abasto y Conciliaciones salen en la
lista; con "3 meses" y Analizar, la hoja Reglas trae 27 (o 19) reglas más
"Sin clasificar"; en S-Abasto los hallazgos dicen "Solo ... no se mide por
sitio" y, si hay día pico, "N día(s) pico; el mayor, ..., con X tickets."
**sin** "de 0 sitios". El Excel baja `Analisis_abasto_<desde>_<hasta>.xlsx`.

**Cómo deshacerlo.** No hay script de rollback. Lo más corto y reversible es
apagar el servicio: `UPDATE dbo.AnalisisServicio SET Activo = 0 WHERE
Servicio IN ('abasto', 'conciliaciones');` (sale de la lista y
`usp_Analisis_Datos` lo rechaza; las reglas se quedan). Para quitarlo del
todo, borrar en este orden `dbo.AnalisisRegla`, `dbo.AnalisisServicioCriterio`
y `dbo.AnalisisServicio` con `WHERE Servicio = '...'` (llaves foráneas). Las
dos cosas cambian la base: aviso y aprobación del dueño antes. Volver a
correr el 79 o el 80 no deja la versión anterior de las reglas (las borra y
las vuelve a insertar): si se cambiaron con "Generar script", guardar antes
`SELECT * FROM dbo.AnalisisRegla WHERE Servicio = '...'`.

### Lo que no le sirve a todos (2026-10-21)

La quincena (el análisis alrededor del pago) salió de S-Biométrico y salía
en todos los servicios. Ahora el sitio la muestra solo si el servicio la
prende en `dbo.AnalisisServicio.Secciones`, un JSON:

    {"quincena": true, "cedis": {"5549": "Salinas Victoria secos"}}

- `quincena: true` (exactamente `true`): tabla, gráfica, hallazgo e índices
  del pago en la hoja Temporal. Sin ella, la hoja Temporal muestra la serie
  de cada día con los días pico en ámbar (los mismos de la tabla "Días
  pico") junto al promedio por mes.
- `cedis`: la tabla "CEDIS que menciona el texto" de la hoja Sitios. Sale
  solo con el mapa, nunca por el nombre del servicio.
- Sin la columna, vacía, con JSON ilegible o con otro valor: todo apagado.

El sitio la lee del parámetro `Secciones` que devuelve `usp_Analisis_Datos`
(bloque `parametros`; el 47 manda `{}` si la columna está en NULL) y, si no
viene, de la columna `Secciones` de la lista de `usp_Analisis_Servicios`. El
47 del 2026-10-21 **no** pone `Secciones` en la lista, así que hoy solo
cuenta el parámetro; el respaldo queda para un 47 que la agregue.
`AnalisisQueries.cs` pasa las dos tal cual: no cambia.

**Estado de la base (no comprobado desde aquí).** El volcado de esquema del
2026-10-13 (`esquema_bd/02_columnas.tsv`) no tenía la columna `Secciones`.
El paquete del 2026-10-21 dice que el 47 nuevo ya está corrido, y su
`results.rpt` (una corrida de `usp_Analisis_Datos` para `biometrico` del
2026-10-21 17:53) trae la fila `Secciones = {"quincena":true}`: el 47 nuevo y
la quincena de S-Biométrico ya estarían en la base. Confirmarlo con la
consulta 3 de abajo. Mientras falte, ningún servicio muestra la quincena y la
tabla de CEDIS no sale; lo demás funciona igual.

Orden para prenderlo (lo hace el dueño de la base; aquí no se ha corrido):

1. `47_analisis_servicios.sql` del 2026-10-21 (agrega `Secciones` y recrea los
   dos procedimientos; las reglas se quedan).
2. `78_analisis_secciones.sql`.
3. Comprobar, de solo lectura:

       SELECT COL_LENGTH('dbo.AnalisisServicio', 'Secciones') AS Columna;
       SELECT Servicio, Secciones FROM dbo.AnalisisServicio WHERE Secciones IS NOT NULL;
       EXEC dbo.usp_Analisis_Datos @Servicio = 'biometrico', @Desde = '2026-09-01', @Hasta = '2026-10-01';
       -- el primer bloque debe traer una fila Clave = 'Secciones'

Lo que no se deshace solo: el 47 recrea los dos procedimientos con
`CREATE OR ALTER` (la versión anterior no se guarda: sacarla antes con
`SELECT OBJECT_DEFINITION(OBJECT_ID('dbo.usp_Analisis_Datos'))` si se quiere
volver) y agrega la columna con `ALTER TABLE` (quitarla es otro `ALTER`). El
47 no va en una transacción; cada bloque se puede volver a correr. El 78
sobrescribe `Secciones` de los 18 servicios que nombra: guardar antes
`SELECT Servicio, Secciones FROM dbo.AnalisisServicio`.

**Pocos sitios (2026-10-21).** Si menos del 30% de los tickets trae tienda,
City Club, CEDIS o CAD (`UMBRAL_SITIOS` en `motor.js`), la pestaña no mide
por sitio: los indicadores Sitios, Concentración y Reincidencia cambian por
"Con sitio", "Reabiertos" (IntentosSolucion mayor que 1) y "Abiertos
vencidos" (sin firma de solución y con la fecha estimada antes del corte);
la hoja Sitios deja solo "Quién reporta", con la nota de por qué. El 30%
exacto ya mide por sitio. No depende de la base.

**"Generar script" y `Secciones`.** El script que arma la pestaña solo
escribe `Secciones` si el servicio ya trae algo prendido; entonces exige el
47 del 2026-10-21 (si no, avisa y no cambia nada). Sin secciones el script
es el de antes: corre con cualquier 47 y no toca la columna.

**Si ya se corrió un 47 anterior** (el del 2026-10-06 en la mañana, sin las
exclusiones de abajo), se vuelve a correr el de ahora: solo recrea los dos
procedimientos; las tablas y lo que cargó el 48 se quedan.

**Lo que no cuenta.** Los tickets del grupo SorIA (el bot), los de la rama
`/Soria/` sin grupo ni firma (desde el 2026-10-10) y los que cerró una cuenta
de `dbo.CatCuentaNoPersona` ("Desk, Smart", "User, Setup"...) no son trabajo
del servicio: no salen en la pestaña ni en el Excel, y el
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
analisis/modo_autonomo.js
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

Sin base, desde la raíz del repositorio (datos sintéticos, no tocan nada):

    node tools\tests\AnalisisSeccionesSitiosSmoke.js        # secciones, 30% de sitios, script, trabajo.js sin Worker, Excel
    node tools\tests\AnalisisAbastoConciliacionesSmoke.js   # 79 y 80: reglas, 78, clasificacion, dia pico sin "0 sitios", Excel
    node tools\tests\MotorOcultarClavesSmoke.js             # contraseñas tapadas en Detalle y Excel

## El paquete para instalar

El `Paquete_Analisis_de_servicios_*.zip` lo arma el dueño de la base fuera de
este repositorio (`paquetes/armar_paquete_analisis.py` y
`analisis_servicio/`, en su repositorio). Antes de mandarlo a instalar, se
descomprime en una carpeta temporal y se revisa contra este repositorio:

    node tools\tests\AnalisisPaqueteSmoke.js <carpeta del paquete>

Falla si falta o sobra un script de la tabla de arriba, si un servicio no
trae las reglas que dice la tabla, si una clave o un nombre de servicio se
repite, si el 78 no nombra a todos los servicios, si un archivo del sitio es
distinto del de este repositorio (copia vieja) o si trae algo que no se
reparte (`Web.config`, `config*.json`, `*.mock.json`, `bin/`, salidas de SSMS
como `results.rpt`, o más de 2 MB).

El del 2026-10-21 pasa en la base (los 20 scripts, 18 servicios sin claves
repetidas, 78 completo) y **falla en el sitio**: sus `analisis.html`,
`analisis.css`, `analisis.js`, `AnalisisQueries.cs` y `analisis.ashx` son de
antes del 2026-10-21 (sin gzip ni Server-Timing, sin el Worker), su
`motor.js` es el de antes (sin la caché de textos, con la regex de
contraseñas vieja) aunque trae el arreglo del día pico, y le falta
`analisis/trabajo.js`. Para el sitio se suben los archivos de este
repositorio, no los del paquete.

## 4. Un servicio nuevo o reglas nuevas

Las reglas viven en `dbo.AnalisisRegla`. Nadie las escribe a mano en la
base:

- En la hoja "Reglas" de la pestaña, el owner prueba cambios (no se guarda
  nada) y "Generar script SQL" baja un `.sql` que el dueño corre en SSMS.
- Un servicio nuevo se arma en `analisis_servicio/servicios.js` y
  `node analisis_servicio/armar_scripts.js` genera su script, con la misma
  función que usa el botón de la pestaña. Esa carpeta no está en este
  repositorio.
- Para prender la quincena en otro servicio (o los CEDIS), se cambia
  `secciones` en `servicios.js`, se vuelve a armar y se corre el
  `78_analisis_secciones.sql` nuevo. El botón de la pestaña conserva las
  secciones que el servicio ya tiene.

## 5. Modo Autónomo (2026-11-20)

Modo Autónomo sale en la lista como un servicio más, pero con su propia
vista: no se elige por ruta ni grupo (desde septiembre su categoría trae de
todo y muchos tickets están en otras) y la mitad de sus datos no son
tickets, sino los eventos que registran los incident managers en su Excel
de críticos. Los datos ya vienen clasificados de la base (esquema `crit`):
la pestaña solo los cuenta y los pinta.

Lo que muestra: KPIs y hallazgos; **Causas de los IMs** y **Lo que no
llega al IM** con zoom (clic en una barra o en un nombre abre el nivel 2 y
luego el 3; las migas regresan; «Sin detalle» en gris es lo que el texto no
dice); el servidor de la tienda (2026-11-23, abajo); por mes; tiendas;
detalle; y su Excel (siete hojas, doce con el servidor; sin textos de
tickets; sí lleva `CausaIM` y `OrigenDetalle`, con las contraseñas tapadas,
y el nombre de cada sucursal).

**Orden de instalación.** Primero el sitio y después la base: el sitio
nuevo sin la base no muestra nada de Modo Autónomo (la lista sale de
`usp_Analisis_Servicios`), pero un sitio viejo con la fila ya dada de alta
mandaría `modo_autonomo` por el camino del motor.

1. El sitio: `analisis/modo_autonomo.js` (nuevo), `analisis/analisis.js`,
   `analisis/analisis.css`, `handlers/analisis.ashx` y
   `App_Code/AnalisisQueries.cs`.
2. `95_criticos.sql` del 2026-11-20 (repositorio de la base, no está en
   este): según su autor, agrega `Nivel2` y `Nivel3` a `crit.Incidente`, la
   tabla `crit.TicketMA` y su procedimiento, y se puede volver a correr.
   **No verificado:** el script no se ha revisado.
3. `Cargar_Criticos.ps1` con su `ReglasMA.ps1` del 2026-11-20, en la PC
   donde se carga el Excel: llena los niveles y `crit.TicketMA` (el log dice
   "Tickets de Modo Autonomo desde ..."). **No verificado.**
4. `97_analisis_modo_autonomo.sql` (repositorio de la base): da de alta el
   servicio `modo_autonomo` y crea `dbo.usp_Analisis_ModoAutonomo` (solo
   lectura); sin el paso 2 se niega y no cambia nada. **No verificado.**

Lo que el sitio espera del procedimiento: «Contrato que espera el sitio»,
al final de esta sección.

**Activo.** `analisis.ashx?accion=modo_autonomo` responde 400 si
`modo_autonomo` no viene en `usp_Analisis_Servicios` (es decir, si no existe
o tiene `Activo = 0`), igual que `usp_Analisis_Datos` con cualquier otro
servicio. No depende de que el procedimiento lo revise.

**Contraseñas.** `CausaIM` y `OrigenDetalle` son texto libre de los IMs y no
pasan por el motor. `modo_autonomo.js` les aplica `Motor.ocultarClaves`, la
misma regla del Detalle de los demás servicios, antes de pintarlos o
mandarlos al Excel. Igual que en el motor, el texto viaja sin tapar en el
JSON de `analisis.ashx` y solo se tapa en el navegador. Los nombres de
personas no se tapan, ni aquí ni en el motor.

La cuenta del tablero necesita `EXECUTE` sobre
`dbo.usp_Analisis_ModoAutonomo`. Según el autor, el esquema `crit` es de
`dbo` y el procedimiento lo lee sin permisos aparte (encadenamiento de
propietarios); **no verificado**.

**Frescura.** La vista muestra lo de la última carga del Excel (el
subtítulo dice cuándo): hoy, cuando corre `Cargar_Criticos.ps1` (a mano, el
correo de Modo Autónomo los días 1 y 15, y el resumen semanal).

**La liga directa.** `dashboard.html?servicio=modo_autonomo#analisis`
abre la pestaña con Modo Autónomo ya analizado, con el año (del 1 de enero
a hoy, botón "Este año" marcado). El periodo, en la dirección: `&meses=N`
(1 a 13, por el tope de 400 días), `&meses=anio`, o
`&desde=aaaa-mm-dd&hasta=aaaa-mm-dd`. Sirve igual para cualquier servicio
(`?servicio=<clave>`; los demás, sin periodo, van con 6 meses). Para que el
correo de Modo Autónomo la lleve ("Ver en el tablero"), en su
`config_correo_modo_autonomo.json`:
`"url_tablero": "https://<servidor>/dashboard.html?servicio=modo_autonomo"`
y `"seccion_tablero": "analisis"`.

Comprobar (solo lectura):

    SELECT Servicio, Nombre, Activo, Secciones FROM dbo.AnalisisServicio WHERE Servicio = 'modo_autonomo';
    EXEC dbo.usp_Analisis_ModoAutonomo @Desde = '2026-01-01', @Hasta = '2026-12-01';
    SELECT COUNT(*) AS Tickets, COUNT(DISTINCT Grupo) AS Incidentes FROM crit.TicketMA;   -- columnas sin verificar

En la pestaña (Ctrl+F5): "Modo Autónomo" en la lista, sin "(sin reglas)";
al analizarlo, sus seis hojas; si un aviso dice que no hay tickets
clasificados o que los eventos no traen niveles, falta el paso 3.

**Cómo quitarlo.** `UPDATE dbo.AnalisisServicio SET Activo = 0 WHERE
Servicio = 'modo_autonomo';`: sale de la lista y `accion=modo_autonomo`
responde 400; lo demás no cambia.

Pruebas en este repositorio (datos sintéticos, sin base):

    node tools\tests\AnalisisModoAutonomoSmoke.js                    # modelo, zoom, hojas, servidor de la tienda, tarjetas por mes, contraseñas tapadas, Excel
    node tools\tests\AnalisisModoAutonomoHeadlessSmoke.js            # en Chrome: lista, "Este año", tarjetas con su mes, zoom, hoja del servidor, Excel, liga directa con y sin periodo
    node tools\tests\AnalisisModoAutonomoSeguridadHeadlessSmoke.js   # en Chrome: motor <-> Modo Autónomo, contraseñas tapadas en pantalla, 400/500, sin registro

y `tools/tests/AnalisisModoAutonomoHandlerSmoke.cs` (se compila como
`AnalisisDatosSmoke.cs`; sin base: la regla de `Activo` y los 400/405/500
del handler). La comparación de nombres contra `reglas.py` corre solo si
ese archivo está al lado del sitio (si no, SKIP). La prueba de Docker del
autor (`pruebas/correr_analisis_modo_autonomo.sh`: 97 contra 47 y 95) vive
en el repositorio de la base y no se ha corrido aquí.

### Contrato que espera el sitio

Sale de lo que leen `AnalisisQueries.ModoAutonomo` y `modo_autonomo.js`; la
definición real de 97 no se ha revisado contra esto.

- `dbo.AnalisisServicio`: una fila `Servicio = 'modo_autonomo'`, `Activo = 1`,
  con `Nombre`. Su `DesdeSugerido` no se usa: la vista abre con el año.
  Sale en `usp_Analisis_Servicios` (47) sin cambiar ese procedimiento.
- `dbo.usp_Analisis_ModoAutonomo @Desde DATE, @Hasta DATE`: `@Hasta` es el
  día siguiente al último incluido (como en `usp_Analisis_Datos`); el sitio
  ya limita el periodo a 400 días. Tiempo máximo: 60 s. Errores propios con
  `RAISERROR(..., 16, 1)` (número 50000): el sitio los da como 400 con su
  texto. Devuelve **exactamente tres** resultados, en este orden (los
  nombres de columna se leen tal cual; las que falten salen vacías):
  1. parámetros: `Clave`, `Valor`. Claves leídas: `UltimaCargaExcel`,
     `CargaTickets` (vacía = aviso de que falta clasificar tickets),
     `ReglasVersion`.
  2. eventos: `Mes` (aaaa-mm), `Inicio`, `Horas`, `Tienda` (número; nulo =
     varias sucursales), `TiendaNombre`, `Aplicacion`, `Tipo`, `Origen`
     (clave: electrica, ups, comunicaciones, servidor, sql, clima, software,
     sincausa), `OrigenDetalle`, `RespaldoFallo` (1/0), `Alcance`, `Nivel2`,
     `Nivel3` («Sin detalle» = lo que el texto no dice), `CausaIM`,
     `TicketsMA`.
  3. incidentes: `Mes`, `Fecha`, `Tienda`, `Tickets`, `Motivo` (clave:
     electrica, ups, servidor, comunicaciones, red_caja, equipo_caja,
     aplicativo, operador, sincausa, probable_electrica), `Fuente`
     (documentado, tienda, supuesto), `Nivel2`, `Nivel3`, `SinContacto`
     (1/0), `Alcance`, `TiendaConEventoIM` (1/0).
- `GRANT EXECUTE ON dbo.usp_Analisis_ModoAutonomo TO [usuario_del_tablero]`.

### El servidor de la tienda, las tarjetas por mes y el año (2026-11-23)

Pedido del dueño para el CIO: la vista de Modo Autónomo **abre con el año**
(del 1 de enero a hoy; botón nuevo "Este año" en el periodo rápido) y
**cada tarjeta** trae el periodo escogido y, abajo, **su último mes** ("Octubre",
o "Del 1 al 23 de noviembre" si llega a hoy). Las tarjetas siguen al filtro.

La hoja nueva **El servidor de la tienda** compara el log de los servidores
de tienda (Portal de Indicadores: apagados sin aviso, reinicios programados
y cortes de red) con Modo Autónomo, **en los dos sentidos**: las fallas del
servidor en horario de tienda que no tuvieron evento del IM ni ticket cerca,
y los eventos del IM y tickets en los que el servidor siguió bien. Trae sus
tarjetas, barras, tablas, las tiendas donde más se cae y las fallas sin
reporte; el Excel suma cinco hojas. Una tarjeta nueva arriba, "Servidor sin
reporte", y un hallazgo. Son las mismas cuentas que el correo de Modo Autónomo.

**Orden de instalación** (después de lo de arriba):

1. `98_caidas_servidor.sql` (raíz) y sus permisos (al final del archivo); la
   cuenta del tablero necesita `EXECUTE` sobre
   `dbo.usp_Analisis_ModoAutonomoServidor`.
2. La carga del portal en la máquina del ETL (`caidas_servidor/LEEME.md`,
   "En la base"); sin ninguna carga, la hoja dice que el portal no se ha
   cargado.
3. El sitio: `analisis/modo_autonomo.js`, `analisis/analisis.js`,
   `analisis/analisis.css`, `analisis/analisis.html`,
   `handlers/analisis.ashx` y `App_Code/AnalisisQueries.cs`.

Sin el 98 (o sin el permiso) la vista de Modo Autónomo sigue igual: la
tarjeta del servidor sale con "—", un aviso dice por qué y la hoja lo explica.

Comprobar (solo lectura):

    EXEC dbo.usp_Analisis_ModoAutonomoServidor @Desde = '2026-01-01', @Hasta = '2026-12-01';
