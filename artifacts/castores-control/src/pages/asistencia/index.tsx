import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { MainLayout } from "@/components/layout/main-layout";
import { getAuthToken, getClerkUserInfo } from "@workspace/api-client-react";
import { apiUrl } from "@/lib/api-url";
import { usePermissions } from "@/hooks/use-permissions";

type CheckInRow = {
  id: number;
  userId: number;
  projectId: number;
  checkInAt: string;
  checkOutAt: string | null;
  totalMinutes: number | null;
  checkInStatus: "ok" | "flagged" | "manual";
  checkOutStatus: "ok" | "flagged" | "manual" | null;
  checkInDistanceMeters: number | null;
  checkOutDistanceMeters: number | null;
  checkInNotes: string | null;
  checkOutNotes: string | null;
  userName: string | null;
  userWorkerCode: string | null;
  projectName: string | null;
};

type ProjectMini = { id: number; name: string };

async function authedFetch(path: string): Promise<Response> {
  const token = await getAuthToken();
  const { clerkId, email } = getClerkUserInfo();
  const headers: Record<string, string> = { Accept: "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const params = new URLSearchParams();
  if (clerkId) params.set("clerkId", clerkId);
  if (email) params.set("email", email);
  const qs = params.toString();
  const sep = path.includes("?") ? "&" : "?";
  return fetch(`${apiUrl(path)}${qs ? sep + qs : ""}`, { headers, credentials: "include" });
}

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" });
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("es-MX", { day: "2-digit", month: "short" });
}

export default function AsistenciaDashboardPage() {
  const [, setLocation] = useLocation();
  const perms = usePermissions();
  const [filters, setFilters] = useState<{ projectId: string; status: "all" | "open" | "closed"; from: string; to: string }>({
    projectId: "",
    status: "all",
    from: todayISO(),
    to: todayISO(),
  });
  const [rows, setRows] = useState<CheckInRow[]>([]);
  const [projects, setProjects] = useState<ProjectMini[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Cargo lista de obras para el dropdown del filtro.
  useEffect(() => {
    let alive = true;
    authedFetch("/api/projects").then(async (r) => {
      if (!r.ok) return;
      const data = await r.json().catch(() => []);
      if (alive) setProjects((data as ProjectMini[]).map((p) => ({ id: p.id, name: p.name })));
    });
    return () => { alive = false; };
  }, []);

  // Cargo asistencia cuando cambian filtros.
  useEffect(() => {
    let alive = true;
    setLoading(true);
    const params = new URLSearchParams();
    if (filters.projectId) params.set("projectId", filters.projectId);
    if (filters.status !== "all") params.set("status", filters.status);
    if (filters.from) params.set("from", filters.from);
    if (filters.to) params.set("to", filters.to);
    params.set("limit", "200");
    authedFetch(`/api/attendance?${params.toString()}`)
      .then(async (r) => {
        if (!alive) return;
        if (!r.ok) {
          const data = await r.json().catch(() => ({}));
          setError(data?.error || "No pudimos cargar la asistencia.");
          setRows([]);
          return;
        }
        const data = (await r.json()) as CheckInRow[];
        setRows(data);
        setError(null);
      })
      .catch((err: unknown) => {
        if (!alive) return;
        setError(err instanceof Error ? err.message : "Error de red");
      })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [filters]);

  const summary = useMemo(() => {
    const open = rows.filter((r) => !r.checkOutAt).length;
    const flagged = rows.filter((r) => r.checkInStatus === "flagged" || r.checkOutStatus === "flagged").length;
    const totalMin = rows.reduce((s, r) => s + (r.totalMinutes ?? 0), 0);
    const totalHours = Math.round(totalMin / 60);
    return { total: rows.length, open, flagged, totalHours };
  }, [rows]);

  const onExport = async () => {
    const params = new URLSearchParams();
    if (filters.projectId) params.set("projectId", filters.projectId);
    params.set("from", filters.from);
    params.set("to", filters.to);
    const url = `${apiUrl(`/api/attendance/export.csv`)}?${params.toString()}`;
    window.open(url, "_blank");
  };

  if (!perms.loading && !perms.has("attendanceViewAll")) {
    return (
      <MainLayout>
        <div className="max-w-2xl mx-auto px-6 py-12 text-center">
          <h1 className="text-xl font-bold text-gray-900">Sin acceso a Asistencia</h1>
          <p className="mt-2 text-sm text-gray-500">
            Tu rol no tiene permiso para ver el dashboard de asistencia.
          </p>
        </div>
      </MainLayout>
    );
  }

  return (
    <MainLayout>
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        <div className="flex items-end justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Asistencia</h1>
            <p className="text-sm text-gray-500 mt-0.5">
              Quién está en obra y cuánto ha trabajado.
            </p>
          </div>
          <div className="flex gap-2">
            {perms.has("attendanceGenerateQr") && (
              <button
                onClick={() => setLocation("/asistencia/qr")}
                className="px-4 py-2 rounded-xl text-sm font-bold text-white"
                style={{ background: "#1a1612" }}
                data-testid="button-go-qr"
              >
                📱 Mostrar QR
              </button>
            )}
            {perms.has("attendanceExport") && (
              <button
                onClick={onExport}
                className="px-4 py-2 rounded-xl text-sm font-bold text-amber-800"
                style={{ background: "rgba(200,149,42,0.18)", border: "1px solid rgba(200,149,42,0.4)" }}
                data-testid="button-export-csv"
              >
                ⬇ Exportar CSV
              </button>
            )}
          </div>
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Kpi label="Registros" value={String(summary.total)} accent="#1a1612" />
          <Kpi label="En obra ahora" value={String(summary.open)} accent="#22C55E" />
          <Kpi label="Marcados" value={String(summary.flagged)} accent="#F59E0B" />
          <Kpi label="Horas totales" value={String(summary.totalHours)} accent="#C8952A" />
        </div>

        {/* Filtros */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 p-4 rounded-2xl bg-white border border-gray-100">
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1">Obra</label>
            <select
              value={filters.projectId}
              onChange={(e) => setFilters((f) => ({ ...f, projectId: e.target.value }))}
              className="w-full px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm"
              data-testid="filter-project"
            >
              <option value="">Todas</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1">Estado</label>
            <select
              value={filters.status}
              onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value as "all" | "open" | "closed" }))}
              className="w-full px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm"
              data-testid="filter-status"
            >
              <option value="all">Todos</option>
              <option value="open">En obra</option>
              <option value="closed">Cerrados</option>
            </select>
          </div>
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1">Desde</label>
            <input
              type="date"
              value={filters.from}
              onChange={(e) => setFilters((f) => ({ ...f, from: e.target.value }))}
              className="w-full px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm"
              data-testid="filter-from"
            />
          </div>
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1">Hasta</label>
            <input
              type="date"
              value={filters.to}
              onChange={(e) => setFilters((f) => ({ ...f, to: e.target.value }))}
              className="w-full px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm"
              data-testid="filter-to"
            />
          </div>
        </div>

        {/* Tabla */}
        <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
          {loading ? (
            <div className="py-12 text-center text-sm text-gray-400">Cargando...</div>
          ) : error ? (
            <div className="py-8 text-center text-sm text-red-600">{error}</div>
          ) : rows.length === 0 ? (
            <div className="py-12 text-center">
              <p className="text-sm text-gray-500">Sin registros para estos filtros.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-[10px] uppercase tracking-widest text-gray-500">
                  <tr>
                    <th className="px-4 py-2.5 text-left font-bold">Trabajador</th>
                    <th className="px-4 py-2.5 text-left font-bold">Obra</th>
                    <th className="px-4 py-2.5 text-left font-bold">Día</th>
                    <th className="px-4 py-2.5 text-left font-bold">Entrada</th>
                    <th className="px-4 py-2.5 text-left font-bold">Salida</th>
                    <th className="px-4 py-2.5 text-right font-bold">Horas</th>
                    <th className="px-4 py-2.5 text-left font-bold">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const isOpen = !r.checkOutAt;
                    const flagged = r.checkInStatus === "flagged" || r.checkOutStatus === "flagged";
                    const hours = r.totalMinutes != null ? (r.totalMinutes / 60).toFixed(1) : "—";
                    return (
                      <tr key={r.id} className="border-t border-gray-100 hover:bg-amber-50/30">
                        <td className="px-4 py-3">
                          <p className="font-semibold text-gray-900">{r.userName ?? "—"}</p>
                          {r.userWorkerCode && (
                            <p className="text-[11px] font-mono text-gray-400">{r.userWorkerCode}</p>
                          )}
                        </td>
                        <td className="px-4 py-3 text-gray-700">{r.projectName ?? "—"}</td>
                        <td className="px-4 py-3 text-gray-500 text-xs whitespace-nowrap">{formatDate(r.checkInAt)}</td>
                        <td className="px-4 py-3 text-gray-700 font-mono whitespace-nowrap">{formatTime(r.checkInAt)}</td>
                        <td className="px-4 py-3 text-gray-700 font-mono whitespace-nowrap">
                          {r.checkOutAt ? formatTime(r.checkOutAt) : (
                            <span className="text-emerald-600 font-bold">En obra</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right font-bold text-gray-900">{hours}</td>
                        <td className="px-4 py-3">
                          {flagged ? (
                            <span className="text-[10px] font-bold uppercase tracking-widest px-2 py-1 rounded-full"
                              style={{ background: "rgba(245,158,11,0.18)", color: "#92400e" }}>
                              ⚠ Marcado
                            </span>
                          ) : isOpen ? (
                            <span className="text-[10px] font-bold uppercase tracking-widest px-2 py-1 rounded-full"
                              style={{ background: "rgba(34,197,94,0.18)", color: "#15803d" }}>
                              Abierto
                            </span>
                          ) : (
                            <span className="text-[10px] font-bold uppercase tracking-widest px-2 py-1 rounded-full"
                              style={{ background: "rgba(0,0,0,0.06)", color: "#525252" }}>
                              OK
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </MainLayout>
  );
}

function Kpi({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div className="p-4 rounded-2xl bg-white border border-gray-100">
      <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1">{label}</p>
      <p className="text-2xl font-black tracking-tight" style={{ color: accent }}>{value}</p>
    </div>
  );
}
