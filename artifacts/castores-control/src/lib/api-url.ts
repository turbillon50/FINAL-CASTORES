/**
 * Builds an absolute URL for a backend API call.
 *
 * Strategy:
 *   - If `VITE_API_BASE_URL` is set (typical 2-project Vercel deploy where
 *     web and api live in different domains), prepend it.
 *   - Otherwise, prepend the Vite `BASE_URL` so the request stays on the
 *     same origin as the SPA (single-project deploy or local dev with a
 *     proxied /api).
 *
 * Always pass the path beginning with `/api/...` (without the base prefix).
 *
 * @example
 *   apiUrl("/api/users/me")
 *   apiUrl("/api/users/123/approve")
 */
export function apiUrl(path: string): string {
  if (!path.startsWith("/")) {
    throw new Error(
      `apiUrl: expected path starting with "/" but got "${path}"`,
    );
  }

  const apiBase = import.meta.env.VITE_API_BASE_URL;
  if (typeof apiBase === "string" && apiBase.trim().length > 0) {
    return `${apiBase.replace(/\/+$/, "")}${path}`;
  }

  const viteBase = import.meta.env.BASE_URL.replace(/\/+$/, "");
  return `${viteBase}${path}`;
}
