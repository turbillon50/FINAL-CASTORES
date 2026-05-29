import { useEffect, useState, useCallback } from "react";
import { motion } from "framer-motion";
import { getAuthToken } from "@workspace/api-client-react";
import { apiUrl } from "@/lib/api-url";

interface AuditRow {
  name: string;
  email: string | null;
  role: string | null;
  approvalStatus: string | null;
  isActive: boolean | null;
  inClerk: boolean;
  inDb: boolean;
  dbId: number | null;
  clerkId: string | null;
  lastSignInAt: number | null;
  access: string;
}
interface AuditData {
  summary: { total: number; ok: number; needsAttention: number; clerkError: string | null };
  rows: AuditRow[];
}

const ROLE_LABELS: Record<string, string> = {
  admin: "Administrador", supervisor: "Supervisor", client: "Cliente",
  worker: "Trabajador", proveedor: "Proveedor",
};

// Estado de acceso → etiqueta, color (semántico) y si hay arreglo de 1 clic.
const ACCESS_META: Record<string, { label: string; color: string; fix?: "approve" | "activate" }> = {
  ok:               { label: "Con acceso",            color: "#10B981" },
  pending:          { label: "Pendiente de aprobar",  color: "#F59E0B", fix: "approve" },
  inactive:         { label: "Inactivo",              color: "#EF4444", fix: "activate" },
  rejected:         { label: "Rechazado",             color: "#EF4444" },
  clerk_no_account: { label: "En Clerk, sin registro", color: "#F97316" },
  db_no_clerk:      { label: "Sin identidad Clerk",   color: "#64748B" },
  worker_code:      { label: "Trabajador (código/PIN)", color: "#64748B" },
};

async function authFetch(path: string, opts?: RequestInit) {
  const token = await getAuthToken();
  const res = await fetch(apiUrl(`/api${path}`), {
    ...opts,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(opts?.headers ?? {}) },
    credentials: "same-origin",
  });
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || "Error"); }
  return res.status === 204 ? null : res.json();
}

export function AccessAudit() {
  const [data, setData] = useState<AuditData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await authFetch("/users/access-audit"));
    } catch (e: any) {
      setError(e?.message ?? "No se pudo cargar la auditoría");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const fix = async (row: AuditRow, kind: "approve" | "activate") => {
    if (!row.dbId) return;
    setBusyId(row.dbId);
    try {
      if (kind === "approve") {
        await authFetch(`/users/${row.dbId}/approve`, { method: "PATCH" });
      } else {
        await authFetch(`/users/${row.dbId}`, { method: "PATCH", body: JSON.stringify({ isActive: true }) });
      }
      await load();
    } catch (e: any) {
      setError(e?.message ?? "No se pudo aplicar el cambio");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="rounded-2xl p-5 bg-card" style={{ border: "1px solid hsl(var(--border))" }}>
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <h3 className="font-display text-xl text-foreground tracking-wide">Auditoría de acceso</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Cruza Clerk (identidad) con la base de datos (acceso real). Marca quién puede entrar y quién no.
          </p>
        </div>
        <button onClick={load} disabled={loading}
          className="shrink-0 text-xs font-bold px-3 py-1.5 rounded-lg border border-border text-foreground/70 hover:text-foreground hover:bg-foreground/[0.03] transition-colors disabled:opacity-50">
          {loading ? "Cargando…" : "Actualizar"}
        </button>
      </div>

      {/* Resumen */}
      {data && (
        <div className="flex flex-wrap gap-2 mb-4">
          <span className="text-xs font-semibold px-2.5 py-1 rounded-lg bg-foreground/[0.05] text-foreground/70 tabular-nums">
            {data.summary.total} en total
          </span>
          <span className="text-xs font-semibold px-2.5 py-1 rounded-lg tabular-nums" style={{ background: "#10B98115", color: "#10B981" }}>
            {data.summary.ok} con acceso
          </span>
          {data.summary.needsAttention > 0 && (
            <span className="text-xs font-semibold px-2.5 py-1 rounded-lg tabular-nums" style={{ background: "#F59E0B15", color: "#B45309" }}>
              {data.summary.needsAttention} requieren atención
            </span>
          )}
        </div>
      )}

      {data?.summary.clerkError && (
        <p className="text-xs mb-3 px-3 py-2 rounded-lg" style={{ background: "#EF444410", color: "#B91C1C" }}>
          No se pudo leer Clerk: {data.summary.clerkError}. Se muestra solo la base de datos.
        </p>
      )}
      {error && <p className="text-xs text-red-600 mb-3">{error}</p>}

      {loading && !data ? (
        <div className="py-10 flex justify-center">
          <div className="w-8 h-8 rounded-full border-2 border-black/10 border-t-[#141414] animate-spin" />
        </div>
      ) : data && data.rows.length > 0 ? (
        <div className="rounded-xl overflow-hidden" style={{ border: "1px solid hsl(var(--border))" }}>
          <div className="divide-y" style={{ borderColor: "hsl(var(--border))" }}>
            {data.rows.map((row, i) => {
              const meta = ACCESS_META[row.access] ?? { label: row.access, color: "#64748B" };
              return (
                <motion.div
                  key={(row.dbId ?? row.clerkId ?? i).toString()}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: Math.min(i * 0.03, 0.3) }}
                  className="flex items-center justify-between gap-3 px-3 py-2.5 bg-card"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-foreground truncate">{row.name}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {row.email ?? "—"}
                      {row.role && <span className="text-foreground/40"> · {ROLE_LABELS[row.role] ?? row.role}</span>}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="inline-flex items-center gap-1.5 text-[11px] font-bold px-2 py-1 rounded-md"
                      style={{ background: `${meta.color}18`, color: meta.color }}>
                      <span className="w-1.5 h-1.5 rounded-full" style={{ background: meta.color }} />
                      {meta.label}
                    </span>
                    {meta.fix && row.dbId && (
                      <button onClick={() => fix(row, meta.fix!)} disabled={busyId === row.dbId}
                        className="text-[11px] font-bold px-2.5 py-1 rounded-md text-white disabled:opacity-50"
                        style={{ background: "#141414" }}>
                        {busyId === row.dbId ? "…" : meta.fix === "approve" ? "Aprobar" : "Activar"}
                      </button>
                    )}
                  </div>
                </motion.div>
              );
            })}
          </div>
        </div>
      ) : (
        !loading && <p className="text-sm text-muted-foreground text-center py-6">Sin usuarios para auditar.</p>
      )}
    </div>
  );
}
