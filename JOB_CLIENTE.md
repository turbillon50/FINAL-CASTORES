# JOB: Castores — 3 bugs + vista de cliente (a gusto del dueño)

Repo: /root/FINAL-CASTORES  ·  App front: artifacts/castores-control (Vite + React PWA)
API: api/index.mjs (Express monolito)  ·  DB: Drizzle/Neon en lib/db/src/schema
Diseño: Vulcano Standard (obsidian, sin Lucide). Respeta el estilo existente.

REGLAS DURAS:
- NO toques el módulo de escaneo de facturas (OCR Gemini). Funciona, se queda igual.
- Antes de commitear: corre el build/typecheck del proyecto. Si NO pasa, NO commitees ni pushees. Deja el error en el log.
- Un solo commit por arreglo, mensajes conventional commits. Push a origin main al final SOLO si build OK.
- No inventes columnas: revisa el schema Drizzle real antes de tocar la API.

TAREAS:

1) BUG — Editar obra no permite reasignar cliente ni supervisor.
   En pages/projects/[id].tsx (modo edición): mostrar y habilitar los selects de cliente y supervisor.
   Asegurar que la mutación de update mande client_id y supervisor_id, y que el handler PATCH/PUT de obra en api/index.mjs los acepte y persista. Confirmar contra el schema.

2) BUG — Asistencia muestra horario del día siguiente (timezone).
   En pages/asistencia/*: las fechas se renderizan/agrupan en UTC y brincan de día.
   Forzar zona America/Mexico_City al formatear y al agrupar por día (date key). Revisar también cómo se guarda el timestamp en la API por si el shift viene de ahí. Que el día y hora mostrados correspondan a CDMX.

3) BUG — Crear obra no acepta decimales en presupuesto (pero editar sí).
   En pages/projects/index.tsx (form de crear): el input de presupuesto solo toma enteros.
   Igualarlo al de editar: step="0.01", inputMode decimal, parseFloat al enviar. Que acepte 1234.56.

4) FEATURE — Vista de cliente: solo material y cantidad, SIN precios.
   El rol "cliente" debe ver un reporte por obra con material + cantidad solicitada únicamente.
   NADA de precios, montos ni totales de factura para el cliente. Juan (admin/contratista) sigue viendo precios completos.
   Reutiliza pages/reportes.tsx y el gating por rol ya existente (revisa admin-access / roles).
   Si el rol cliente ya existe en el schema/usuarios, úsalo; si necesitas filtrar la respuesta de la API por rol para no filtrar precios, hazlo del lado servidor (no solo ocultar en UI).

ENTREGA: build verde + commit + push. Al terminar escribe una línea RESUMEN_FINAL: con lo que quedó y lo que no.
