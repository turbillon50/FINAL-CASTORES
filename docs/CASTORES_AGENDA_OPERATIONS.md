# Castores: facturas y agenda

La tienda de materiales queda fuera de este cambio.

## Comportamiento

- `/agenda`: agenda privada de cada administrador, con el acceso existente de Castores. Guarda citas y el mensaje personal en PostgreSQL. Permite editar, confirmar, cancelar y eliminar. Una versión evita sobrescribir cambios de otro dispositivo.
- Las fechas se guardan como instantes UTC y se muestran en la zona elegida (centro de México, Cancún o Tijuana). La agenda se puede instalar desde el navegador; requiere conexión para consultar/guardar.
- Abrir WhatsApp únicamente prepara un mensaje. No se registra como enviado ni entregado.

## Alcance confirmado de la agenda

Juan pidió el 4 de octubre conservar las citas en base de datos, mantener el diseño que le gustó, incorporar su logo, guardar «Agenda Castores» en el inicio y poder notificar por WhatsApp. El documento de su prototipo explica el envío manual: abrir el mensaje preparado y pulsar Enviar. El backend de Twilio adjunto no constituye un compromiso de automatización.

Luis confirmó el 27 de octubre el uso manual, sin administrar claves de Meta. La pantalla no ofrece activación automática ni muestra trabajos pendientes de activación. Crear o editar citas desde ella mantiene deshabilitada la autorización de automatización (`optIn: false`).

No se requieren claves de Meta, cuenta de Twilio ni plantilla aprobada para este flujo. El texto editable se guarda en PostgreSQL. Abrir WhatsApp no cambia el estado de la cita ni certifica que el mensaje se haya enviado.

La implementación automática anterior permanece inactiva por compatibilidad; `AGENDA_WHATSAPP_ENABLED` debe mantenerse en `false`. Se retiró el cron de `vercel.json`. Activar automatización requeriría un nuevo acuerdo de alcance; no es un pendiente para entregar Castores. Se conservan tablas y registros existentes sin borrar datos.

## Escaneo de facturas

`GEMINI_API_KEY` y opcionalmente `GEMINI_VISION_MODEL` configuran el proveedor. La clave se manda en una cabecera, no en la URL ni en respuestas/logs. El lector conserva todos los renglones, señala campos incompletos, distingue galones de litros y rechaza respuestas truncadas. Fotos adicionales añaden conceptos, preservando los ya capturados. Revisar duplicados si se repite la misma sección. La nota conserva una fotografía adjunta (la última seleccionada), no un archivo multipágina.

Diagnóstico interno: `POST /api/internal/invoice-diagnostic`, con el mismo secreto de infraestructura y body `{ "image": "data:image/jpeg;base64,…" }`. Verifica conexión PostgreSQL y ejecuta la lectura real sin crear notas ni modificar datos de negocio. Devuelve resultado y código sanitizado del proveedor; nunca devuelve credenciales. No llamar desde el navegador ni guardar el secreto en clientes.

## Esquema y verificación

La migración es aditiva e idempotente, con tablas `agenda_appointments`, `agenda_settings`, `agenda_reminders` y `agenda_inbound`. Se integra en las migraciones de arranque existentes; no requiere borrar ni recrear datos. No ejecutar un `db:push` destructivo para habilitar la agenda.

- `corepack pnpm test`: pruebas unitarias del escaneo y fechas, pruebas HTTP con PostgreSQL embebido aislado y prueba DOM del formulario. Nunca se usan clientes o credenciales reales en las pruebas.
- `corepack pnpm run typecheck`.
- `corepack pnpm --filter @workspace/api-server build` y `corepack pnpm --filter @workspace/castores-control build`.

La prueba DOM no sustituye una revisión visual en iPhone/Android ni una prueba manual con un destinatario autorizado. La prueba de PostgreSQL embebido verifica SQL y transacciones, pero no simula varios procesos reales para el bloqueo de cron. La operación usa `pg_try_advisory_lock` y `FOR UPDATE SKIP LOCKED` para ese caso.

Para revertir: restaurar el despliegue anterior y mantener las nuevas tablas; no eliminar citas. Desactivar `AGENDA_WHATSAPP_ENABLED` y desplegar para detener próximos envíos. Los mensajes ya aceptados por el proveedor pueden seguir su curso.
