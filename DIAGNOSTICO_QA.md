# Diagnóstico QA — Castores Control
Fecha: 2026-05-07
Branch: claude/stabilize-production-chat-kmj5A
Total: 40 hallazgos (6 BLOCKER · 12 HIGH · 16 MEDIUM · 6 LOW)

---

## Estado general

Infraestructura sana: DB OK, Clerk OK, push endpoints OK, PWA bien configurada,
ErrorBoundary cubre crashes globales. El esqueleto es sólido. Los hallazgos
abajo son los huecos reales que deben cerrarse antes de escalar el producto.

---

## BLOCKERS (6) — fixear antes de mostrar a más clientes

| # | Problema | Archivo / endpoint | Impacto |
|---|---|---|---|
| 1 | Aislamiento de proyectos roto: `PATCH /projects/:id`, `GET/POST/DELETE /projects/:id/assignments`, `DELETE /materials/:id`, `POST /reports` no checan `canAccessProject` | server/routes/projects.ts, assignments.ts, materials.ts, reports.ts | Supervisor del Proyecto A puede modificar/borrar/reportar el Proyecto B |
| 2 | Materiales sin Edit UI; sólo aprobar/rechazar | client/pages/MaterialsTab.tsx | Imposible corregir cantidad/costo ya capturado |
| 3 | Reporte de materiales NO filtra por `status='approved'` | server/routes/reports.ts:155 | PDF muestra dinero gastado que nunca se aprobó |
| 4 | Cuenta rechazada sin salida (sólo "Cerrar sesión") | client/pages/cuenta-rechazada.tsx | Usuario rechazado queda en limbo, sin contacto a soporte ni reapertura |
| 5 | Sin rate-limit en `/auth/forgot-password`, `/invite-login`, `/reset-password` | server/routes/auth.ts | Spam de emails + brute force de tokens |
| 6 | `activity_log` se escribe pero no tiene UI | falta página admin/auditoria | Nadie puede revisar quién borró/modificó qué |

---

## HIGH (12)

### Datos / arquitectura
7.  Fotos almacenadas como data URLs dentro de filas Postgres. 1000 obras × 5MB = ~27 GB en filas; ralentiza queries. Migrar a blob storage (Vercel Blob / S3 / R2).
8.  Bitácora sin paginación: trae todas las entradas. Reventará con 200+ por obra.
9.  Push subscriptions huérfanas: borrar usuario no purga sus subscriptions.
10. Email send fire-and-forget sin log (auth.ts:467,659; users.ts:243,274). Si Resend falla nadie se entera.

### Seguridad / autorización
11. Cache de permisos = 90s. Democión de admin se aplica con 90s de retraso.
12. `POST /materials/:id/approve` sin `canAccessProject` ni audit log.
13. Reset password token NO incluye `clerkId`: si la cuenta Clerk se recreó, el token aún sirve. Token rebinding.
14. Sin webhooks Clerk (`user.deleted`, `user.updated`): usuario borrado en Clerk sigue activo en DB.

### UX / mobile / errors
15. Sticky admin bar tapada por home indicator en iPhone 12+ (bitacora/[id].tsx:449). Falta `safe-area-inset-bottom`.
16. Submit de bitácora no valida campos requeridos (puede enviar registro vacío).
17. `console.error` en producción filtra detalles internos durante sign-up (App.tsx:804,821).
18. SW v6 no trunca payload de push; backend sí. Si algo se cuela, iOS lo corta sin avisar.

---

## MEDIUM (16) — pulido importante

19. Documentos sin tamaño máximo ni validación de mime.
20. Documentos sin versionado: subir mismo nombre silencia el anterior.
21. Reportes sin Edit ni Delete.
22. Hitos de proyecto sin límite ni validación de duplicados.
23. Material sin estados `delivered` / `consumed`; sólo pending/approved/rejected.
24. Bitácora sin lightbox para ampliar fotos.
25. `projectAssignmentsTable` sin UNIQUE(projectId, userId): race condition duplica asignaciones.
26. Borrar usuario deja assignments huérfanas → "Sin nombre" en Team Tab.
27. `/auth/forgot-password` no checa `clerkId`: usuario sin Clerk recibe correo y luego falla.
28. `ApprovalGate` no re-checa estado en sesión activa: usuario rechazado mid-sesión sigue dentro hasta refresh.
29. Proveedor hereda `documentsLegalView=true`: ve contratos.
30. Anuncios con `targetRole=null` broadcastean a todos sin confirmación.
31. Vercel sirve assets con `cache-control: max-age=0`. Falta `immutable` en `/assets/*`.
32. Suspense fallback "CARGANDO..." sin timeout: chunk lazy fallido = spinner infinito.
33. Colisión z-index: sticky bar (z-30) vs FAB (z-50) en bitácora detail.
34. Top bar móvil sin `safe-area-inset-top`: notch tapa logo en iPhone 13+.

---

## LOW (6) — polish

35. SW v6 borra TODOS los caches en `activate` (rompe fallback offline).
36. Mensajes mezclan español con jerga técnica ("Sin conexión a la base de datos").
37. Comentario de autoComplete en código contradice la implementación actual.
38. main-layout `overflow-x-hidden` puede recortar modales en pantallas estrechas.
39. Bitácora detail no resetea scroll al cargar.
40. Empty state de Materiales no explica si el rol carece de permiso.

---

## Plan de corrección y tiempos estimados

### Sprint 1 — Integridad y datos (BLOCKERS)
**Tiempo total: ~6 horas**

| Tarea | Tiempo |
|---|---|
| Agregar `canAccessProject` a 4 endpoints + tests | 1.5 h |
| Edit/Delete UI de materiales (form + endpoint + audit) | 1.5 h |
| Filtrar reporte por `status='approved'` | 0.25 h |
| Página `cuenta-rechazada` con CTA real (mailto + reapertura) | 0.5 h |
| Rate-limit middleware en `/auth/*` (express-rate-limit) | 0.75 h |
| UI de auditoría leyendo `activity_log` (paginado, filtros) | 1.5 h |

### Sprint 2 — Robustez UX y seguridad (HIGH selectos)
**Tiempo total: ~5 horas**

| Tarea | Tiempo |
|---|---|
| safe-area-inset bottom + top en sticky bar y top bar | 0.5 h |
| Validación de submit bitácora (zod + mensajes) | 0.5 h |
| `console.error` sólo en dev (logger wrapper) | 0.5 h |
| `canAccessProject` + audit log en approve/reject material | 0.75 h |
| Incluir `clerkId` en reset password token | 0.5 h |
| Re-check de estado en `ApprovalGate` cada N min | 0.5 h |
| Email send con try/catch + log a `email_failures` | 0.75 h |
| Reducir cache de permisos a 15s o invalidar en cambio de rol | 0.5 h |
| Empty states + mensajes localizados | 0.5 h |

### Sprint 3 — Arquitectura y escalabilidad (HIGH duros + MEDIUM)
**Tiempo total: ~12 horas (decisión previa de costo)**

| Tarea | Tiempo |
|---|---|
| Migración fotos a blob storage (Vercel Blob recomendado) | 4 h |
| Paginación de bitácora (cursor-based) | 1.5 h |
| Webhooks Clerk (user.deleted, user.updated) | 1 h |
| Versionado de documentos | 1.5 h |
| UNIQUE constraint + migración de duplicados existentes | 0.75 h |
| Limpieza push subscriptions huérfanas (cron) | 0.5 h |
| Cache headers `immutable` en Vercel config | 0.25 h |
| Lightbox para fotos de bitácora | 0.75 h |
| Suspense con timeout + retry | 0.5 h |
| Estados extendidos de material (delivered/consumed) | 1.25 h |

### Sprint 4 — Polish (MEDIUM restantes + LOW)
**Tiempo total: ~3 horas**

| Tarea | Tiempo |
|---|---|
| Validación tamaño/mime de documentos | 0.5 h |
| Edit/Delete reportes | 0.5 h |
| Confirmación broadcast de anuncio targetRole=null | 0.25 h |
| Permisos proveedor: revocar documentsLegalView | 0.25 h |
| z-index audit + fix sticky/FAB | 0.25 h |
| SW v6: preservar caches críticos en activate | 0.5 h |
| Reset scroll bitácora detail | 0.25 h |
| Limpieza comentarios obsoletos + i18n strings | 0.5 h |

---

## Resumen total

| Sprint | Alcance | Horas |
|---|---|---|
| 1 | Blockers de integridad y datos | 6 h |
| 2 | Robustez UX y seguridad | 5 h |
| 3 | Arquitectura y escalabilidad | 12 h |
| 4 | Polish | 3 h |
| **TOTAL** | **Estabilización completa** | **~26 horas** |

**Recomendación:**
- **Sprint 1 + 2 (~11 h)** → puede mergearse esta semana, deja el producto en estado robusto para clientes nuevos.
- **Sprint 3 (~12 h)** → requiere decisión previa sobre proveedor de blob storage; planificar para próxima iteración.
- **Sprint 4 (~3 h)** → fillers para días con baja carga.

Sin Sprint 3, el sistema soporta cómodamente ~50 obras y ~30 usuarios activos.
Sprint 3 es el que da margen para 500+ obras.
