import { useEffect, useState } from "react";
import { useUser } from "@clerk/react";
import { apiUrl } from "@/lib/api-url";

export type PermissionKey =
  | "dashboardFull"
  | "projectsViewAll"
  | "projectsCreateEdit"
  | "bitacoraView"
  | "bitacoraCreate"
  | "budgetViewAmounts"
  | "materialsApprove"
  | "materialsRequest"
  | "materialsSupply"
  | "workersView"
  | "workersManage"
  | "documentsLegalView"
  | "documentsLegalManage"
  | "adminPanelAccess";

export type Role = "admin" | "supervisor" | "client" | "worker" | "proveedor";

export interface MePermissions {
  userId: number;
  role: Role;
  isActive: boolean;
  approvalStatus: string;
  permissions: Partial<Record<PermissionKey, boolean>>;
}

interface UsePermissionsState {
  data: MePermissions | null;
  loading: boolean;
  error: string | null;
  // Convenience: returns true if the role has the given permission key.
  // Always returns false while data is loading or errored — never optimistically
  // shows a button; better to under-show than to render-then-fail.
  has: (key: PermissionKey) => boolean;
  // Role-based shortcut for cases where we genuinely care about the role
  // (e.g. dashboard variants are role-aware copy, not permission-gated logic).
  isRole: (...roles: Role[]) => boolean;
  refresh: () => void;
}

const NOOP: UsePermissionsState["has"] = () => false;
let inflightPromise: Promise<MePermissions | null> | null = null;
let cachedPermissions: { data: MePermissions; expiresAt: number } | null = null;
const CACHE_TTL_MS = 30_000;

async function fetchMePermissions(): Promise<MePermissions | null> {
  const now = Date.now();
  if (cachedPermissions && cachedPermissions.expiresAt > now) return cachedPermissions.data;
  if (inflightPromise) return inflightPromise;

  inflightPromise = (async () => {
    try {
      const res = await fetch(apiUrl("/api/auth/me-permissions"), {
        credentials: "include",
        headers: { Accept: "application/json" },
      });
      if (!res.ok) return null;
      const data = (await res.json()) as MePermissions;
      cachedPermissions = { data, expiresAt: Date.now() + CACHE_TTL_MS };
      return data;
    } catch {
      return null;
    } finally {
      inflightPromise = null;
    }
  })();
  return inflightPromise;
}

/**
 * Returns the current user's role and effective permission map.
 *
 * Use `permissions.has("projectsCreateEdit")` to gate buttons / actions and
 * `permissions.isRole("admin")` for role-specific copy / dashboards.
 *
 * The data is cached for 30 seconds across all callers to avoid spamming
 * the API on every render. Permission changes by an admin propagate within
 * 60 seconds (server cache) + up to 30 seconds (client cache).
 */
export function usePermissions(): UsePermissionsState {
  const { isLoaded, isSignedIn } = useUser();
  const [state, setState] = useState<{ data: MePermissions | null; loading: boolean; error: string | null }>(() => {
    const cached = cachedPermissions && cachedPermissions.expiresAt > Date.now() ? cachedPermissions.data : null;
    return { data: cached, loading: !cached, error: null };
  });

  const refresh = () => {
    cachedPermissions = null;
    setState((s) => ({ ...s, loading: true }));
    fetchMePermissions().then((data) => {
      setState({ data, loading: false, error: data ? null : "fetch failed" });
    });
  };

  useEffect(() => {
    if (!isLoaded) return;
    if (!isSignedIn) {
      setState({ data: null, loading: false, error: null });
      cachedPermissions = null;
      return;
    }
    fetchMePermissions().then((data) => {
      setState({ data, loading: false, error: data ? null : "fetch failed" });
    });
  }, [isLoaded, isSignedIn]);

  const data = state.data;
  return {
    data,
    loading: state.loading,
    error: state.error,
    has: data ? (key) => data.permissions[key] === true || data.role === "admin" : NOOP,
    isRole: data ? (...roles) => roles.includes(data.role) : () => false,
    refresh,
  };
}

/** Bust the cache. Useful after the admin saves new permissions. */
export function invalidatePermissionsCache(): void {
  cachedPermissions = null;
}
