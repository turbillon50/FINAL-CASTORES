# Castores: facturas y agenda

La tienda de materiales queda fuera de este cambio.

## Comportamiento

- `/agenda`: agenda privada de cada administrador, con el acceso existente de Castores. Guarda citas y el mensaje personal en PostgreSQL. Permite editar, confirmar, cancelar y eliminar. Una versión evita sobrescribir cambios de otro dispositivo.
- Las fechas se guardan como instantes UTC y se muestran en la zona elegida (centro de México, Cancún o Tijuana). La agenda se puede instalar desde el navegador; requiere conexión para consultar/guardar.
- Abrir WhatsApp únicamente prepara un mensaje. No se registra como enviado ni entregado.
- El plan automático contempla 24 y 2 horas antes de la cita, únicamente con autorización registrada del cliente. Una cita creada dentro de esos intervalos no genera recordatorios retroactivos. El cron revisa cada cinco minutos; los trabajos vencidos por más de treinta minutos se descartan para no enviar avisos atrasados.
- Edición, cancelación y eliminación invalidan recordatorios pendientes. Un trabajo en envío bloquea temporalmente la edición. Los estados entregado/leído vienen de webhooks firmados. Una respuesta debe incluir el código de cita, evitando afectar la siguiente cita del mismo teléfono.
- Ante una interrupción de red, el envío queda por verificar y **no se reintenta automáticamente**: el proveedor podría haberlo aceptado. Revisar el registro de Twilio antes de enviar algo manualmente. Tampoco se reintentan automáticamente errores de cuota/credenciales.

## Activación de WhatsApp

Los envíos están desactivados inicialmente. Se necesitan las siguientes variables del proyecto `final-castores-v5ld`, sin introducirlas en Git:

| Variable                      | Valor o función                                              |
| ----------------------------- | ------------------------------------------------------------ |
| `TWILIO_ACCOUNT_SID`          | Cuenta dueña del remitente                                   |
| `TWILIO_AUTH_TOKEN`           | Secreto de Twilio para envío y validación de firmas          |
| `TWILIO_WHATSAPP_FROM`        | Remitente aprobado, formato `whatsapp:+52…`                  |
| `TWILIO_WHATSAPP_CONTENT_SID` | Plantilla de WhatsApp aprobada, SID `HX…`                    |
| `AGENDA_PUBLIC_URL`           | `https://castores.info`, sin ruta                            |
| `CRON_SECRET`                 | Secreto aleatorio exclusivo de este proyecto                 |
| `AGENDA_WHATSAPP_ENABLED`     | `true` solamente después de configurar y probar el remitente |

La plantilla automática debe usar estas variables, todas de texto:

1. Cliente.
2. Fecha local `YYYY-MM-DD`.
3. Hora local `HH:mm`.
4. Servicio/motivo.
5. Código único de cita de ocho caracteres.

Texto de referencia para aprobación: «Hola {{1}}, Castores te recuerda tu cita el {{2}} a las {{3}} para {{4}}. Responde CONFIRMAR {{5}} o CANCELAR {{5}}.» No basta guardar un texto libre: los recordatorios automáticos requieren la plantilla aprobada correspondiente. El mensaje editable de la pantalla es exclusivamente para envío personal.

Configurar webhook de mensajes entrantes: `POST https://castores.info/api/agenda/webhooks/inbound`. El callback de estado se adjunta a cada envío. Ambos validan la firma de Twilio contra la URL pública exacta. Mantener HTTPS. No usar el sandbox como remitente de clientes.

El cron es `GET /api/agenda/cron`, protegido por `Authorization: Bearer <CRON_SECRET>`. Se declara cada cinco minutos en `vercel.json`; requiere un plan compatible con esa frecuencia. Vercel solo lo ejecuta en producción. Confirmar continuidad del plan al terminar el periodo de prueba de la cuenta.

## Escaneo de facturas

`GEMINI_API_KEY` y opcionalmente `GEMINI_VISION_MODEL` configuran el proveedor. La clave se manda en una cabecera, no en la URL ni en respuestas/logs. El lector conserva todos los renglones, señala campos incompletos, distingue galones de litros y rechaza respuestas truncadas. Fotos adicionales añaden conceptos, preservando los ya capturados. Revisar duplicados si se repite la misma sección. La nota conserva una fotografía adjunta (la última seleccionada), no un archivo multipágina.

Diagnóstico interno: `POST /api/internal/invoice-diagnostic`, con el mismo secreto de infraestructura y body `{ "image": "data:image/jpeg;base64,…" }`. Verifica conexión PostgreSQL y ejecuta la lectura real sin crear notas ni modificar datos de negocio. Devuelve resultado y código sanitizado del proveedor; nunca devuelve credenciales. No llamar desde el navegador ni guardar el secreto en clientes.

## Esquema y verificación

La migración es aditiva e idempotente, con tablas `agenda_appointments`, `agenda_settings`, `agenda_reminders` y `agenda_inbound`. Se integra en las migraciones de arranque existentes; no requiere borrar ni recrear datos. No ejecutar un `db:push` destructivo para habilitar la agenda.

- `corepack pnpm test`: pruebas unitarias del escaneo y fechas, pruebas HTTP con PostgreSQL embebido aislado y prueba DOM del formulario. Nunca se usan clientes o credenciales reales en las pruebas.
- `corepack pnpm run typecheck`.
- `corepack pnpm --filter @workspace/api-server build` y `corepack pnpm --filter @workspace/castores-control build`.

La prueba DOM no sustituye una revisión visual en iPhone/Android ni una prueba de entrega con un destinatario autorizado. La prueba de PostgreSQL embebido verifica SQL y transacciones, pero no simula varios procesos reales para el bloqueo de cron. La operación usa `pg_try_advisory_lock` y `FOR UPDATE SKIP LOCKED` para ese caso.

Para revertir: restaurar el despliegue anterior y mantener las nuevas tablas; no eliminar citas. Desactivar `AGENDA_WHATSAPP_ENABLED` y desplegar para detener próximos envíos. Los mensajes ya aceptados por el proveedor pueden seguir su curso.
