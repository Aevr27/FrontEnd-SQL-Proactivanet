# Verificación manual de avisos de Teams — 2026-11-20

## Alcance

Registro de la prueba manual del flujo de Power Automate desde el panel de pruebas local del Dashboard. Esta nota documenta lo observado; no representa una prueba en producción ni una autorización de despliegue.

## Resultado observado

Los tres eventos de prueba se ejecutaron desde el panel local y llegaron a Teams:

| Evento | Destino observado | Identificador de prueba |
|---|---|---|
| `NEW_REQUEST` | Chat de grupo `Alertas Pruebas` | `TEST-PA-001` |
| `REQUEST_APPROVED` | Mensaje privado del bot | `TEST-PA-002` |
| `REQUEST_REJECTED` | Mensaje privado del bot | `TEST-PA-003` |

También se probó texto con acentos y se confirmó que el mensaje se procesó correctamente.

## Contrato de campos comprobado

El formato de texto documentado para el webhook tiene seis campos separados por `|`:

| Índice | Contenido |
|---|---|
| `[0]` | Evento |
| `[1]` | Tipo |
| `[2]` | Correo del solicitante |
| `[3]` | Nombre del solicitante |
| `[4]` | Número de solicitud |
| `[5]` | Fecha, código de iniciativa o comentario de rechazo, según el evento |

En los mensajes privados, el correo del destinatario debe salir de `[2]`; el nombre mostrado después de «Hola» debe salir de `[3]`. El número de solicitud usa `[4]` y el dato específico del evento usa `[5]`.

## Límites de esta verificación

- La prueba confirma que las tres ramas del flujo pueden procesar los eventos sintéticos enviados por el panel local y publicar los mensajes observados.
- El destinatario privado del panel de pruebas se obtiene de la configuración local de pruebas; esta prueba, por sí sola, no demuestra la entrega a la cuenta real de cada solicitante.
- El código del repositorio conecta actualmente `NEW_REQUEST` con el flujo real al registrar nuevas solicitudes. Esta prueba del panel no demuestra que los handlers reales de aprobación y rechazo estén conectados.
- No se verificó la salida HTTPS desde la identidad del Application Pool en la VM ni la entrega desde el entorno desplegado.
- Esta verificación no modifica SQL ni la configuración del servidor.

## Siguiente comprobación antes de habilitarlo en el servidor

Realizar una prueba controlada con una solicitud real en el entorno de QA: enviarla desde una cuenta identificable, aprobarla desde otra cuenta y comprobar que el mensaje privado llega al chat de Teams del solicitante original. Repetir con rechazo para comprobar el mismo enrutamiento. Confirmar además que el flujo guardado en Power Automate usa el contrato actual de seis campos.
