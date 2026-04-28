# CASTORES - Demo deploy en Vercel

Proyecto monorepo `pnpm` con:
- `artifacts/castores-control` (frontend Vite + React)
- `artifacts/api-server` (API Express + Drizzle/Postgres)

## Estado actual

- Compila correctamente con `corepack pnpm run build`.
- Preparado para deploy demo en Vercel sin secretos hardcodeados.
- Variables centralizadas en `.env.example`.

## Deploy recomendado (2 proyectos en Vercel)

### 1) API project

- Root directory: `artifacts/api-server`
- Framework preset: `Other`
- Usa `vercel.json` incluido en ese directorio.

Variables minimas:
- `DATABASE_URL`
- `SESSION_SECRET`
- `CLERK_SECRET_KEY`
- `FRONTEND_PUBLIC_URL`
- `NODE_ENV=production`

Opcional:
- `RESEND_API_KEY`
- `LOG_LEVEL`

### 2) Web project

- Root directory: `artifacts/castores-control`
- Framework preset: `Vite`
- Usa `vercel.json` incluido para SPA rewrites.

Variables minimas:
- `VITE_CLERK_PUBLISHABLE_KEY`
- `VITE_API_BASE_URL` (URL publica del proyecto API)
- `BASE_PATH=/`

Opcional:
- `VITE_CLERK_PROXY_URL`

## Variables requeridas

La plantilla completa esta en `.env.example`.

## Notas de demo vs produccion

- Demo: si falta `VITE_CLERK_PUBLISHABLE_KEY`, la web ya no crashea y muestra aviso de configuracion.
- Produccion: faltan endurecimientos de seguridad y observabilidad (rate limits, auditoria de acceso, secretos rotados, dominios y TLS final).
