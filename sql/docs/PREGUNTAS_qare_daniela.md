# Preguntas para Daniela: reglas de clasificación QARE (Técnicos)

**Versión sanitizada.** Los ejemplos no traen códigos de ticket ni el texto
original de las respuestas: se resumen. La versión con ejemplos por ticket está
fuera del repositorio y se comparte solo por un canal interno autorizado.

Contexto técnico completo y cifras: `PROPUESTA_qare_tecnicos.md`, sección 13.

**Datos.** Salen del diag `diag_qare_correcciones.sql`, corrido en QA el
2026-11-27 a las 15:23, con la ventana del 2026-10-29 al 2026-11-27. En esa
ventana hay 9 444 tickets: 7 714 evaluados y 4 769 con texto evaluable (patrón
2 316, calidad 494, sin patrón 1 959 = 41.1 %). Las cifras cambian un poco de un
día a otro.

**Las propuestas son técnicas, no decisiones.** Cada pregunta trae lo que se ve
en los datos, ejemplos resumidos, las opciones y lo que cambia cada una. La
regla la decides tú.

---

## 0. Antes de las preguntas: lo que ya se cambió en tus objetos

El 2026-11-27 se aplicó en QA `sql/46`, con rollback listo. Son tres
correcciones técnicas que no cambian ninguna regla:

1. **`usp_QARE_DetalleEvidencia`.** El filtro `@EstadoDescripcion` ahora acepta
   la etiqueta que el propio SP muestra (`RESPUESTA INVALIDA`, `RESPUESTA
   ANALIZABLE`) además del valor interno. Antes, filtrar por la etiqueta
   devolvía 0 filas.
2. **`vw_QARE_CalidadCaptura`.** El catálogo de inválidas se consulta con
   `EXISTS` y no con `LEFT JOIN`. Con la misma condición y la misma precedencia,
   un valor repetido en el catálogo (como pasó con `v`/`V`) ya no duplica el
   ticket.
3. **`usp_QARE_CalidadCaptura_KPIs`.** Ahora rechaza un inicio posterior al fin
   con `THROW 50001`, igual que los otros tres SP.

Verificado en QA: el Detalle por etiqueta devuelve lo mismo que por valor
interno (2 975 y 4 802), y cuadra con KPIs. Si vuelves a modificar alguno de los
tres objetos, conviene partir de la versión actual.

---

## 1. `ERROR` como respuesta completa

**Lo que vemos.**
- 74 tickets con el texto `ERROR` solo (46 `ERROR`, 26 `error`, 2 `Error`). Hoy
  son *sin patrón*: la fila inválida `error` (Id 39) está **inactiva**.
- 50 de los 74 son de Control de Accesos TI, con causa "Error de usuario" y
  tipo "Se dan indicaciones".
- 21 son de App Evolución, con tipo "No fue necesario hacer nada".
- El catálogo ya clasifica `ERROR DE USUARIO` (Id 55) como `CALIDAD` →
  `PROBLEMA / NO SOLUCION`.

| Ejemplo | Grupo | Solución al usuario (resumen) |
|---|---|---|
| Ejemplo 1 | Control de Accesos TI | Le dice al usuario que el tema no le corresponde al área y que busque al área que da ese soporte |
| Ejemplo 2 | Control de Accesos TI | La misma respuesta de "no corresponde" |
| Ejemplo 3 | Soporte App Evolución | Agradece al usuario la confirmación (visto bueno) y cierra |
| Ejemplo 4 | Soporte App Evolución | El mismo agradecimiento y cierre |

Aparte, hay 42 tickets con textos que *empiezan* con `ERROR` y nombran el
problema, no la solución: error en un material, en un pedido, en una factura,
en un token… (32 escrituras distintas, todas sin patrón).

**Opciones.**
- a) Inválida: activar la Id 39. Las inválidas pasan de 38.2 % a 39.1 %.
- b) `CALIDAD` `PROBLEMA / NO SOLUCION`, igual que `ERROR DE USUARIO`: el
  técnico dice "fue error del usuario / no nos corresponde".
- c) Dejarla como está, sin patrón.

**Propuesta técnica:** b) para `ERROR` solo, porque el contexto muestra que se
usa como "error de usuario".

**Preguntas.**
1. ¿`ERROR` solo es inválida o es `PROBLEMA / NO SOLUCION`?
2. ¿Por qué se desactivó la fila `error`?
3. ¿Los textos `Error en …` (42) se quedan sin patrón, o los tratamos de otra
   forma?

---

## 2. `CARGA DE PRECIOS`

**Lo que vemos.**
- 90 tickets sin patrón, con 13 escrituras. Las más comunes son el rótulo solo
  (47) y el rótulo con un prefijo de dos letras (25). Unas pocas (3, o menos
  cada una) son frases completas que dicen que la carga se mandó bien a la
  báscula.
- 89 son de End User, en categorías de básculas (Ticket serializado – Sección
  precio).
- Tipos: reinicio de servicio (41) y acción al sistema (34).
- La regla `CARGA DE` (Id 35 → `CARGA / SINCRONIZACION`) está **inactiva**. Si
  se reactivara tal cual atraparía también textos sobre carga de una página, de
  una imagen o de básculas.

| Ejemplo | Texto (resumen) | Solución al usuario (resumen) |
|---|---|---|
| Ejemplo 5 | El rótulo solo | Avisa que los precios ya se enviaron y pide probar |
| Ejemplo 6 | El rótulo con prefijo | Dice que lo pedido ya se mandó y pide comprobarlo en las básculas |
| Ejemplo 7 | El rótulo con otro prefijo | Avisa que se reinició el servicio de la báscula |

**Opciones.**
- a) Frase nueva `CARGA DE PRECIO` (sin la S, cubre las 13 escrituras) →
  `CARGA / SINCRONIZACION`. Ese patrón pasaría de 14 a unos 104 tickets.
- b) Dejarla sin patrón, como un rótulo que no dice qué se hizo.

**Propuesta técnica:** a), sin reactivar la raíz `CARGA DE`.

**Preguntas.**
1. ¿`CARGA DE PRECIOS` es `CARGA / SINCRONIZACION`?
2. ¿Por qué se apagó `CARGA DE`?

---

## 3. `ALTA SAP TIENDA` / `ALTA SAP OAT`

**Lo que vemos.**
- 57 tickets (31 + 26), todos de Control de Accesos TI, en la categoría SAP /
  Alta, Baja, Cambios.
- En 50 el tipo es "Se otorgan permisos": el alta se hizo. En 7 es "Se dan
  indicaciones": el alta se pide por SorIA.
- La regla `ALTA SAP` (Id 84 → `CUENTAS / CREDENCIALES`) está **inactiva**. Las
  activas `ALTA DE USUARIO SAP` y `ALTA USUARIO SAP` no coinciden porque el
  texto no dice `USUARIO`.

| Ejemplo | Texto | Tipo | Solución al usuario (resumen) |
|---|---|---|---|
| Ejemplo 8 | `ALTA SAP TIENDA` | Se otorgan permisos | Confirma que se hizo el alta y pide validar |
| Ejemplo 9 | `ALTA SAP OAT` | Se otorgan permisos | Describe cómo se tramitan los accesos |
| Ejemplo 10 | `ALTA SAP TIENDA` | Se dan indicaciones | Indica que el alta de tienda se pide por SorIA |
| Ejemplo 11 | `ALTA SAP TIENDA` | Se otorgan permisos | También indica que el alta se hace por SorIA |

El ejemplo 11 muestra que el texto no siempre dice si el alta se hizo: incluso
el tipo puede no coincidir con la solución.

**Opciones.**
- a) `ALTA SAP` → `CUENTAS / CREDENCIALES` para todos.
- b) Lo mismo, pero solo si el tipo es "Se otorgan permisos"; los demás quedan
  sin patrón. Esto requiere una regla que mire el tipo y hoy no existe.
- c) Dejarlo como rótulo sin patrón.

**Propuesta técnica:** a). El 88 % se hizo, y el caso SorIA se mide mejor con
el tipo de solución que con el texto.

**Preguntas.**
1. ¿`ALTA SAP …` es `CUENTAS / CREDENCIALES` aunque 7 de 57 sean "se hace por
   SorIA"?
2. ¿Por qué se apagó la Id 84?

---

## 4. `SE BRINDA CONTACTO …` y vecinas

**Lo que vemos.**
- 48 tickets sin patrón, con 4 escrituras que dicen que se dio un contacto para
  el seguimiento o información para contactar a otro equipo.
- Casi todos son de Service Desk (46), con tipo "Se dan indicaciones" (39).
- Hay formas vecinas, también sin patrón, que dicen que se adjuntaron contactos
  (15) o que se proporcionó un contacto (9).
- La raíz `CONTACTO` (Id 30 → `INDICACIONES / CANALIZACION`) está **inactiva**.
  Reactivada atraparía 85 tickets, entre ellos textos que confirman un contacto
  con la tienda, que no son canalización.

| Ejemplo | Solución al usuario (resumen) |
|---|---|
| Ejemplo 12 | Da el contacto que dará seguimiento y pide enviar evidencias |
| Ejemplo 13 | Remite al usuario a los contactos de otra área (programa de lealtad) |
| Ejemplo 14 | Remite a un manual para que el usuario resuelva el problema |

**Opciones.**
- a) Frases completas (`BRINDA CONTACTO`, `ADJUNTAN CONTACTOS`, `PROPORCIONA
  CONTACTO`, `PONERSE EN CONTACTO`) → `INDICACIONES / CANALIZACION`.
- b) → `CALIDAD` `RESPUESTA SIN ACCION DOCUMENTADA`: se canaliza, no se
  resuelve.

**Propuesta técnica:** a). Es lo que el catálogo ya llama canalización.

**Pregunta.** ¿Dar un contacto es `INDICACIONES / CANALIZACION` o es una
respuesta sin acción documentada?

---

## 5. `NAVEGACION`

**Lo que vemos.**
- 36 tickets sin patrón (más 2 con la palabra mal escrita).
- 30 son de Seguridad Informática, en la categoría Usuario de red / Permisos
  de navegación, con tipo "Se otorgan permisos" (34 en total).
- La regla inactiva `NAVEGACION` (Id 46) los mandaba a `SEGURIDAD /
  CONECTIVIDAD`. Las activas `PERMISO DE NAVEGACION` y `PERMISOS DE NAVEGACION`
  van a `ROLES / PERMISOS`.
- Los 10 de Service Desk son otra cosa: borrado de caché y temporales del
  navegador.

| Ejemplo | Grupo | Texto (resumen) | Solución al usuario (resumen) |
|---|---|---|---|
| Ejemplo 15 | Seguridad Informática | `NAVEGACION` | Confirma que el usuario ya tiene los permisos |
| Ejemplo 16 | Seguridad Informática | `NAVEGACION` mal escrito | Confirma que ya tienen la licencia y el acceso a internet |
| Ejemplo 17 | Service Desk | Borrado de caché del navegador | Confirma que el borrado se hizo con éxito |

**Opciones.**
- a) `NAVEGACION` (y la variante mal escrita) → `ROLES / PERMISOS`, como las
  frases activas.
- b) → `SEGURIDAD / CONECTIVIDAD`, como decía la Id 46.
- c) Dejarlo sin patrón.

**Propuesta técnica:** a). Aparte, una frase para el borrado de caché →
`MANTENIMIENTO / LIMPIEZA`, si te parece.

**Pregunta.** ¿`NAVEGACION` en Seguridad Informática es `ROLES / PERMISOS`?

---

## 6. `NO SALE ERROR`

**Lo que vemos.**
- 218 tickets con el texto exacto `NO  SALE ERROR` (doble espacio), hoy
  `CALIDAD` `PROBLEMA / NO SOLUCION`. El catálogo tiene las dos escrituras (Id
  48 y 182).
- 217 son de Soporte Especializado en Aplicativos Inetum, en categorías de Caja
  General (diferencia de póliza 91, cierre de conciliaciones 42, conciliación
  bancaria 28).
- El tipo es "Se dan indicaciones" en 207.
- La solución al usuario casi siempre dice que se hicieron ajustes.
- Son el **44 % de todo `CALIDAD`** (218 de 494), y una sola firma tiene 216.

| Ejemplo | Categoría | Solución al usuario (resumen) |
|---|---|---|
| Ejemplo 18 | Diferencia póliza | Dice que se hicieron los ajustes para que el usuario continúe con su cierre |
| Ejemplo 19 | Cierre de conciliaciones | Dice que se hicieron los ajustes para continuar |
| Ejemplo 20 | Diferencia póliza | Pide que manden toda la póliza a otra área para que los apoye |

**Opciones.**
- a) Inválida: las inválidas pasan a 41.0 % y `CALIDAD` baja a 276.
- b) `PROBLEMA / NO SOLUCION`, como hoy.
- c) `RESPUESTA SIN ACCION DOCUMENTADA`: hubo acción, pero el texto no la
  describe.

**Propuesta técnica:** c). Según la solución al usuario, el problema sí se
atendió. `NO SALE ERROR` parece la respuesta a otra pregunta (el mensaje de
error) puesta en el campo de solución.

**Pregunta.** ¿Qué es `NO SALE ERROR`: inválida, problema o respuesta sin
acción? Sea cual sea, ¿convendría hablarlo con el grupo que la usa?

---

## 7. Texto igual al tipo de solución declarado

**Lo que vemos.**
- 106 tickets copian en la descripción el rótulo del tipo de solución que ya
  eligieron, y los 106 cuentan hoy como patrón. Los rótulos son las opciones del
  formulario, no texto libre.

| Texto copiado | Tickets | Clasificación hoy |
|---|---|---|
| `Se dan indicaciones, técnicamente no se hizo nada` (36 completos, 22 truncados, 3 que empiezan así) | 61 | `INDICACIONES / CANALIZACION` |
| `Se otorgan permisos` (10 completos, 12 que empiezan así) | 22 | `ROLES / PERMISOS` |
| `No fue necesario hacer nada, ya estaba solucionado` | 19 | `VALIDACION / SIN INTERVENCION` |
| `Reinstalación o configuración de aplicativo` y `Reinicio de servicio/equipo` | 4 | su patrón |

**Opciones.**
- a) Contarlos como patrón, como hoy: lo que dicen es cierto.
- b) `RESPUESTA SIN ACCION DOCUMENTADA`: no agregan nada a lo ya declarado.
- c) Inválida.

**Propuesta técnica:** b), con una regla general (texto = tipo) en lugar de
cargar cada rótulo como frase.

**Pregunta.** ¿Copiar el tipo de solución cuenta como patrón?

---

## 8. "Sin respuesta" del usuario

**Lo que vemos.** El mismo hecho tiene tres destinos (174 tickets en total).

| Forma | Tickets | Hoy |
|---|---|---|
| `SIN RESPUESTA`, sola | 123 | Inválida |
| "Sin respuesta" + "del usuario" | 40 | `CALIDAD` `RESPUESTA SIN ACCION DOCUMENTADA` |
| "Sin respuesta" + "por parte de usuario" | 7 | Sin patrón |
| "Se contacta" + "sin respuesta" | 4 | Sin patrón |

**Propuesta técnica:** un solo destino para todas las formas. El que parece
encajar es `RESPUESTA SIN ACCION DOCUMENTADA`, porque es un motivo de cierre y
no una solución.

**Pregunta.** ¿Cuál es el destino único?

---

## 9. ¿"Incompleta" es todo el texto o basta con que contenga la frase?

**Lo que vemos.** Hoy las reglas `CALIDAD` exigen el texto **completo**, y las
de patrón aceptan la frase en cualquier parte. Con contención:

- **Algunas reglas `CALIDAD` acertarían.** Hay textos que dicen que el reporte
  se cerró por falta de información (3), que un embarque estaba bloqueado por
  otro usuario (9) o que se apoyó con una baja por intermitencia de red (2).
  Dicen lo mismo que la regla exacta.
- **Otras se equivocarían.** `FAVOR DE VALIDAR` tiene 0 exactos y 58
  parciales, y los parciales describen acciones reales, como cambiar la
  visibilidad de una cuenta o corregir el grupo de un usuario. Lo mismo pasa
  con `NUEVA CONTRASEÑA`: 22 parciales, todos de "se anexa la nueva
  contraseña", hoy bien clasificados como `CUENTAS / CREDENCIALES`.

**Propuesta técnica:** mantener la igualdad exacta como regla general y darle
un modo "contiene" solo a las reglas que tú elijas. Candidatas: `FALTA DE
INFORMACIÓN`, `EMBARQUE BLOQUEADO` e `INTERMITENCIA EN RED`.

**Pregunta.** ¿Qué reglas `CALIDAD` deben aplicar aunque haya más texto?

---

## 10. Pantalla: filtros, cuentas no persona y concentración por técnico

**Filtros.** Categoría y Técnico solo filtran el Detalle. KPIs no tiene filtro
de grupo, y Técnicos y Patrones sí. Las tarjetas no se mueven cuando el usuario
elige una categoría o un técnico.

**Cuentas no persona y proveedores.** Hay 759 tickets de cuentas del catálogo
`CatCuentaNoPersona` en la ventana, y aparecen como filas en Técnicos. Por
ejemplo, una cuenta de *setup* con 651 tickets, 592 sin información QARE.
También aparecen cuentas de proveedores externos (impresoras, red, básculas).

**Concentración.** 12 firmas, con 50 o más evaluados cada una y 90 % o más de
respuestas inválidas, suman 1 537 de las 2 945 inválidas.

**Preguntas.**
1. ¿Qué filtros debe respetar cada bloque de la pantalla?
2. ¿Se excluyen o se marcan las cuentas no persona y los proveedores?
3. ¿Se resalta en Técnicos la concentración de inválidas?

---

## 11. Evidencia que repite la descripción

En 4 753 de 7 625 tickets con evidencia, `QARe_Evidencia` es igual a la
descripción. En las cinco familias de arriba es lo normal: la evidencia repite
el mismo rótulo que la descripción.

**Pregunta.** ¿Una evidencia que repite la descripción cuenta como evidencia?

---

## 12. Catálogos

**Lo que vemos.**
- Algunas filas están apagadas y no se sabe por qué: `CARGA DE`, `ALTA SAP`,
  `NAVEGACION`, `CONTACTO`, `error`, `VALIDACION`, `POLITICAS DE WINDOWS`
  (dos filas iguales), `SCRIPT`, `REPAR`.
- Hay 52 grupos de filas que coinciden al quitar los acentos. Casi siempre son
  la misma frase con y sin acento; con la intercalación actual hacen falta las
  dos escrituras.
- Cinco frases están a la vez como `CALIDAD` y como `PATRON`, con una sola fila
  activa. Por ejemplo, `ERROR DE AUTENTICACION` y `FALLA DE RED`.

**Preguntas.**
1. ¿Los catálogos actuales son la versión que tú das por buena?
2. ¿Quién los mantiene y cómo se registra por qué se apaga una regla?
   Proponemos una columna de nota o motivo.

---

## Resumen de impacto (cada cambio por separado; no se suman)

| Decisión | Efecto en la ventana |
|---|---|
| 1b. `ERROR` → `PROBLEMA / NO SOLUCION` | Sin patrón −74; calidad +74 |
| 1a. `ERROR` inválida | Inválidas de 38.2 % a 39.1 % |
| 2, 3, 4 y 5 como se proponen | Sin patrón de 41.1 % a ≈ 36.2 % |
| 6a. `NO SALE ERROR` inválida | Inválidas a 41.0 %; calidad de 494 a 276 |
| 6c. `NO SALE ERROR` → sin acción | Cambia solo la clasificación dentro de `CALIDAD` |
| 7b. Copia del tipo → sin acción | Patrón −106; calidad +106 |
