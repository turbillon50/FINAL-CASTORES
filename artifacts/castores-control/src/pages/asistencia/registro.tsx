import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { MainLayout } from "@/components/layout/main-layout";
import { getAuthToken, getClerkUserInfo } from "@workspace/api-client-react";
import { apiUrl } from "@/lib/api-url";
import { usePermissions } from "@/hooks/use-permissions";

type ProjectMini = { id: number; name: string };
type WorkerMini = { id: number; name: string | null; workerCode: string | null; role: string };

async function authedFetch(path: string, init?: RequestInit): Promise<Response> {
  const token = await getAuthToken();
  const { clerkId, email } = getClerkUserInfo();
  const headers: Record<string, string> = {
    Accept: "application/json",
    ...(init?.body ? { "Content-Type": "application/json" } : {}),
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const params = new URLSearchParams();
  if (clerkId) params.set("clerkId", clerkId);
  if (email) params.set("email", email);
  const qs = params.toString();
  const sep = path.includes("?") ? "&" : "?";
  return fetch(`${apiUrl(path)}${qs ? sep + qs : ""}`, {
    ...init,
    headers: { ...headers, ...(init?.headers as Record<string, string> | undefined) },
    credentials: "include",
  });
}

/**
 * Pantalla del SUPERVISOR: registra la asistencia de sus trabajadores uno por
 * uno. Reemplaza el QR (que no tuvo aceptaci\u00f3n entre los trabajadores).
 * El supervisor elige la obra, elige al trabajador, lo marca presente y
 * opcionalmente deja una nota ("lleg\u00f3 tarde"). Sin geofence.
 */
export default function RegistroManualPage() {
  const [, setLocation] = useLocation();
  const perms = usePermissions();
  const [projects, setProjects] = useState<ProjectMini[]>([]);
  const [workers, setWorkers] = useState<WorkerMini[]>([]);
  const [projectId, setProjectId] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [savingId, setSavingId] = useState<number | null>(null);
  const [doneIds, setDoneIds] = useState<Record<number, string>>({});
  const [notesById, setNotesById] = useState<Record<number, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      authedFetch("/api/projects").then((r) => (r.ok ? r.json() : [])),
      authedFetch("/api/users?role=worker").then((r) => (r.ok ? r.json() : [])),
    ])
      .then(([projData, workerData]) => {
        const ps = (projData as ProjectMini[]).map((p) => ({ id: p.id, name: p.name }));
        setProjects(ps);
        if (ps.length > 0) setProjectId(ps[0].id);
        setWorkers(
          (workerData as WorkerMini[]).map((w) => ({
            id: w.id, name: w.name, workerCode: w.workerCode, role: w.role,
          })),
        );
      })
      .catch(() => setError("No se pudieron cargar los datos."))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return workers;
    return workers.filter(
      (w) =>
        (w.name ?? "").toLowerCase().includes(q) ||
        (w.workerCode ?? "").toLowerCase().includes(q),
    );
  }, [workers, search]);

  async function registrar(worker: WorkerMini) {
    if (!projectId || savingId != null) return;
    setSavingId(worker.id);
    setError(null);
    try {
      const res = await authedFetch("/api/attendance/manual-check-in", {
        method: "POST",
        body: JSON.stringify({
          workerId: worker.id,
          projectId,
          notes: notesById[worker.id]?.trim() || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error || "No se pudo registrar.");
        return;
      }
      const hora = new Date().toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" });
      setDoneIds((prev) => ({ ...prev, [worker.id]: hora }));
    } catch {
      setError("Error de red al registrar.");
    } finally {
      setSavingId(null);
    }
  }

  if (!perms.loading && !perms.has("attendanceGenerateQr")) {
    return (
      <MainLayout>
        <div className="max-w-3xl mx-auto px-4 py-10 text-center">
          <p className="text-gray-500">No tienes permiso para registrar asistencia.</p>
        </div>
      </MainLayout>
    );
  }

  return (
    <MainLayout>
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 space-y-5">
        <div className="flex items-end justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Registrar asistencia</h1>
            <p className="text-sm text-gray-500 mt-0.5">
              Marca a tus trabajadores presentes. Puedes a\u00f1adir una nota por persona.
            </p>
          </div>
          <button
            onClick={() => setLocation("/asistencia")}
            className="px-4 py-2 rounded-xl text-sm font-bold text-gray-700 border border-gray-200"
            data-testid="button-back-dashboard"
          >
            \u2190 Dashboard
          </button>
        </div>

        <div className="bg-white rounded-2xl border border-gray-100 p-4 flex items-center gap-3">
          <label className="text-[10px] font-bold uppercase tracking-widest text-gray-400 whitespace-nowrap">Obra:</label>
          <select
            value={projectId ?? ""}
            onChange={(e) => setProjectId(Number(e.target.value))}
            className="flex-1 px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm"
            data-testid="select-registro-project"
          >
            {projects.length === 0 && <option>Cargando...</option>}
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>

        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar trabajador por nombre o c\u00f3digo..."
          className="w-full px-4 py-2.5 rounded-xl border border-gray-200 bg-white text-sm"
          data-testid="input-search-worker"
        />

        {error && (
          <div className="rounded-xl px-4 py-3 text-sm font-medium bg-red-50 border border-red-200 text-red-700">
            {error}
          </div>
        )}

        {loading ? (
          <p className="text-sm text-gray-400 text-center py-8">Cargando trabajadores...</p>
        ) : filtered.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-8">No hay trabajadores que coincidan.</p>
        ) : (
          <div className="space-y-2">
            {filtered.map((w) => {
              const hora = doneIds[w.id];
              return (
                <div
                  key={w.id}
                  className="bg-white rounded-2xl border border-gray-100 p-4 flex flex-col gap-3"
                  data-testid={`worker-row-${w.id}`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-bold text-gray-900 truncate">{w.name ?? "Sin nombre"}</p>
                      {w.workerCode && (
                        <p className="text-xs text-gray-400 font-mono">{w.workerCode}</p>
                      )}
                    </div>
                    {hora ? (
                      <span
                        className="px-4 py-2 rounded-xl text-sm font-bold text-green-700 bg-green-50 border border-green-200 whitespace-nowrap"
                        data-testid={`worker-done-${w.id}`}
                      >
                        \u2713 Presente {hora}
                      </span>
                    ) : (
                      <button
                        onClick={() => registrar(w)}
                        disabled={savingId != null || !projectId}
                        className="px-5 py-2 rounded-xl text-sm font-bold text-white disabled:opacity-40 whitespace-nowrap"
                        style={{ background: "#FF3C00" }}
                        data-testid={`button-register-${w.id}`}
                      >
                        {savingId === w.id ? "..." : "Marcar presente"}
                      </button>
                    )}
                  </div>
                  {!hora && (
                    <input
                      value={notesById[w.id] ?? ""}
                      onChange={(e) => setNotesById((prev) => ({ ...prev, [w.id]: e.target.value }))}
                      placeholder="Nota opcional (ej: lleg\u00f3 tarde)"
                      className="w-full px-3 py-2 rounded-lg border border-gray-200 bg-gray-50 text-sm"
                      data-testid={`input-note-${w.id}`}
                    />
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </MainLayout>
  );
}
