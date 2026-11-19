# Instrucciones para Claude — FrontEnd-SQL-Proactivanet

Reglas permanentes de desarrollo para este repositorio. La arquitectura vive en
`README.md` y `DASHBOARD.md`; no repetirla aquí.

## Documentación del código

**Documentar por qué el código se comporta así, no todo lo que hace.** El
comportamiento se comunica con buenos nombres, funciones pequeñas, separación de
responsabilidades y pruebas. Un comentario debe aportar algo que el código no
deja ver.

Antes de agregar un comentario, preguntar:

1. ¿Ya es obvio leyendo el código?
2. ¿Explica el porqué y no sólo el qué?
3. ¿Ya está documentado en un lugar autoritativo?
4. ¿Le seguirá sirviendo al siguiente desarrollador?
5. ¿Un nombre más claro, otra frontera de función o una prueba lo comunicaría mejor?

Si no aporta información, no se agrega.

**Sí comentar** (breve y preciso):

- Reglas de negocio no obvias, excepciones y distinciones entre flujos parecidos.
- Restricciones técnicas: SQL Server, IIS, ASP.NET, navegador; workarounds de
  compatibilidad; decisiones de rendimiento, caché o concurrencia; integridad de datos.
- Fronteras de autorización y por qué se valida en el servidor.
- Algoritmos: por qué éste, casos borde, precisión y redondeo, y cuándo una
  versión "más simple" daría un resultado incorrecto.
- Efectos secundarios no visibles, orden obligatorio de operaciones, invariantes
  y cambios que romperían algo en silencio.

**No comentar:**

- Traducciones línea por línea o asignaciones, condicionales y ciclos obvios.
- Párrafos que repiten lo que dice el nombre de la función.
- Arquitectura o especificaciones de API copiadas en varios archivos.
- Historial de desarrollo, referencias a commits o notas temporales.
- Listas de reglas de negocio que ya tienen un lugar autoritativo.

**Dónde va cada cosa:**

| Información | Lugar |
|---|---|
| Razonamiento no obvio de una implementación | Comentario corto en el código |
| Contrato de función o clase | Documentación concisa, sólo si aporta |
| Arquitectura de módulos | `README.md` / `DASHBOARD.md` |
| Contratos de API | Un solo documento o definición autoritativa |
| Esquema y procedimientos de BD | Scripts de `sql/` y su documentación verificada |
| Despliegue y entorno | `DASHBOARD.md` y los `INSTALAR*.md` |
| Decisiones históricas aún vigentes | Documento técnico dedicado |
| Comportamiento esperado y regresiones | Pruebas en `tools/tests/` |

Cada regla importante tiene una sola explicación autoritativa. No crear un
documento por cada decisión menor.

**Encabezados de archivo:** cortos. Responsabilidad del archivo, su lugar en la
arquitectura si no es obvio y una o dos restricciones críticas. Para módulos
complejos, referencia al documento correspondiente. No usarlos como
especificación completa, pero no quitar una advertencia crítica sólo para
acortarlos.

**Exactitud:** la documentación desactualizada es peor que la escasa. Al
modificar código, corregir o quitar los comentarios que dejaron de ser ciertos.
Distinguir comportamiento implementado de comportamiento propuesto. Nunca
inventar esquema, comportamiento de API ni reglas de negocio; lo no verificado
se marca como no verificado.

**Proporcionalidad:** la documentación crece con la complejidad y el riesgo. No
hay proporción mínima de comentarios ni meta de reducción.

**Pruebas:** si una prueba demuestra el comportamiento, preferirla a un
comentario largo. En pruebas, comentar sólo por qué importa un escenario inusual.

### Alcance

Se aplica a código nuevo y a archivos que ya se estén tocando por otra tarea.
**No** autoriza una limpieza general: no reescribir encabezados en bloque, no
borrar comentarios masivamente, no tocar módulos ajenos a la tarea ni mezclar
limpieza de documentación con cambios funcionales. Una limpieza dedicada se
propone por separado.

Esta regla no reemplaza las salvaguardas del proyecto: verificar definiciones
reales de BD antes de proponer SQL, pedir aprobación explícita antes de cambiar
la BD, cambios pequeños e incrementales, preservar trabajo sin commitear ajeno y
distinguir pruebas en LocalDB de la verificación real en QA.
