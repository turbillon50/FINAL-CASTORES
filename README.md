# CASTORES Control — Deploy en Vercel

Monorepo `pnpm` con:

- `artifacts/castores-control` — Frontend Vite + React + Clerk
- `artifacts/api-server` — API Express + Drizzle/Postgres + Clerk
- `lib/*` — código compartido (db, schemas zod, cliente API generado)

Estado actual:

- `corepack pnpm run build` compila todo el monorepo (typecheck + build de cada paquete).
- ErrorBoundary global instalado: ya **no se queda en pantalla blanca** ante errores de cliente — muestra mensaje + stack + botones de recuperación.
- Llamadas API en cliente centralizadas en `apiUrl()` (`artifacts/castores-control/src/lib/api-url.ts`). Si `VITE_API_BASE_URL` está set, lo usa; si no, usa el origen del web.
- CORS y cookies de sesión endurecidas para deploy con web y API en orígenes distintos (`SameSite=None; Secure` en producción).

---

## Estrategia de deploy: 2 proyectos Vercel separados

Funciona mejor con monorepo pnpm:

| Proyecto | Vercel "Root Directory" | `vercel.json`                              |
|----------|------------------------|--------------------------------------------|
| Web      | `castores/`            | `castores/vercel.json`                     |
| API      | `castores/artifacts/api-server/` | `castores/artifacts/api-server/vercel.json` |

**Importante**: el Root Directory del Web se queda en `castores/` (no en `artifacts/castores-control/`) para que `pnpm install` corra desde la raíz del workspace y resuelva los `@workspace/*`.

El proyecto API hace `cd ../..` en su `installCommand` por la misma razón.

### 1) Web project — Vercel

- Framework preset: `Other` (lo infiere de `vercel.json`)
- Root Directory: `castores`
- Install Command: `corepack pnpm install --frozen-lockfile` (ya en `vercel.json`)
- Build Command: `corepack pnpm --filter @workspace/castores-control run build` (ya en `vercel.json`)
- Output Directory: `artifacts/castores-control/dist/public` (ya en `vercel.json`)
- Environment Variables (Production + Preview):
  - `VITE_CLERK_PUBLISHABLE_KEY` — `pk_live_...` o `pk_test_...`
  - `VITE_API_BASE_URL` — URL pública del proyecto API, sin slash final. Ej: `https://castores-api.vercel.app`
  - `BASE_PATH` — `/`
  - (opcional) `VITE_CLERK_PROXY_URL` — solo si usas proxy de Clerk

### 2) API project — Vercel

- Framework preset: `Other`
- Root Directory: `castores/artifacts/api-server`
- Install / Build Commands: vienen de `vercel.json` (instalan desde la raíz del monorepo)
- La función Express se monta en `api/index.ts`; todas las rutas se reescriben a esa Function.
- Environment Variables (Production + Preview):
  - `DATABASE_URL` — string de conexión Postgres (Neon/Supabase). Debe permitir SSL.
  - `SESSION_SECRET` — string aleatorio largo (≥ 32 bytes).
  - `CLERK_SECRET_KEY` — `sk_live_...` o `sk_test_...` (debe ser del mismo proyecto Clerk que el web)
  - `ADMIN_ACCESS_PHRASE` — frase para activar al admin general inicial (ej. `CASTORES`)
  - `FRONTEND_PUBLIC_URL` — URL pública del web, sin slash final. Ej: `https://castores.vercel.app`
  - `NODE_ENV` — `production`
  - (opcional) `ALLOWED_ORIGINS` — orígenes adicionales separados por coma
  - (opcional) `RESEND_API_KEY` — para emails transaccionales
  - (opcional) `LOG_LEVEL` — `info` por default

`PORT` **no se debe definir** en Vercel: el runtime serverless asigna su propio puerto. Solo se usa en local (`pnpm dev`).

---

## Flujo de deploy (CLI Vercel)

Asumiendo `vercel` CLI instalado y logueado (`npx vercel login`):

```bash
# Desde castores/
# Una sola vez, vincula el repo al proyecto web:
vercel link
# acepta sugerencia, confirma "castores" como Root Directory

# Set env vars del web (ejemplo, repite por cada una):
vercel env add VITE_CLERK_PUBLISHABLE_KEY production
vercel env add VITE_API_BASE_URL production
vercel env add BASE_PATH production

# Deploy a producción:
vercel --prod
```

Para el proyecto API, repite desde `castores/artifacts/api-server/`:

```bash
cd artifacts/api-server
vercel link    # crea/usa proyecto distinto, p.ej. "castores-api"
# Set envs:
vercel env add DATABASE_URL production
vercel env add SESSION_SECRET production
vercel env add CLERK_SECRET_KEY production
vercel env add FRONTEND_PUBLIC_URL production
vercel env add NODE_ENV production    # value = "production"
vercel --prod
```

---

## Variables: plantilla completa

Ver `.env.example`.

## Notas de demo vs producción

- Si falta `VITE_CLERK_PUBLISHABLE_KEY`, la web muestra un aviso de configuración (no crashea).
- Para hardening de producción todavía faltan: rate limits, auditoría de accesos, rotación de secretos, dominio + TLS final, logs centralizados.

## Troubleshooting

- **Pantalla blanca** → ya no debería ocurrir gracias al ErrorBoundary global. Si pasa, abre DevTools → Console y comparte el stack.
- **CORS bloqueado** → verifica que `FRONTEND_PUBLIC_URL` (en API) coincida con el dominio actual del web y que `VITE_API_BASE_URL` (en web) apunte exactamente al dominio del API. Sin slash final en ambos.
- **Cookie de sesión no persiste** → `NODE_ENV=production` en API es indispensable; sin él, la cookie sale `Secure=false; SameSite=Lax` y no sobrevive cross-site.
- **`@workspace/db` no se resuelve en Vercel** → confirma que el `installCommand` se ejecuta desde la raíz del monorepo (`castores/`).
