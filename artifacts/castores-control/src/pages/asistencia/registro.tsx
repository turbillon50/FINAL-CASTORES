import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { MainLayout } from "@/components/layout/main-layout";
import { getAuthToken, getClerkUserInfo } from "@workspace/api-client-react";
import { apiUrl } from "@/lib/api-url";
import { usePermissions } from "@/hooks/use-permissions";
import { compressImageFile } from "@/lib/compress-image";

type ProjectMini = { id: number; name: string };
type WorkerMini = { id: number; name: string | null; workerCode: string | null; role: string };
type EstadoRow = {
  id: number;
  userId: number;
  projectId: number;
  checkInAt: string;
  checkOutAt: string | null;
};

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

function hora(d: string | Date): string {
  return new Date(d).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" });
}

/**
 * Pantalla del SUPERVISOR: registra Entrada (E) y Salida (S) de sus
 * trabajadores. Layout pedido por el cliente: FOTO de evidencia arriba
 * (se anexa al siguiente registro que se haga), y por cada trabajador su
 * nombre con dos botones E / S. Sin geofence; status 'manual'.
 */
export default function RegistroManualPage() {
  const [, setLocation] = useLocation();
  const perms = usePermissions();
  const [projects, setProjects] = useState<ProjectMini[]>([]);
  const [workers, setWorkers] = useState<WorkerMini[]>([]);
  const [estado, setEstado] = useState<Record<number, EstadoRow>>({});
  const [projectId, setProjectId] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [savingKey, setSavingKey] = useState<string | null>(null); // `${id}-E` | `${id}-S`
  const [notesById, setNotesById] = useState<Record<number, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Foto de evidencia (una sola, arriba). Se manda con el siguiente E o S
  // que se registre y se limpia despues, para no repetirla por accidente.
  const [photoDataUrl, setPhotoDataUrl] = useState<string | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const photoInputRef = useRef<HTMLInputElement>(null);

  const cargarEstado = useCallback(async () => {
    try {
      const res = await authedFetch("/api/attendance/registro-estado");
      if (!res.ok) return;
      const rows = (await res.json()) as EstadoRow[];
      // Nos quedamos con la sesion mas reciente por trabajador (vienen
      // ordenadas DESC por checkInAt, asi que la primera gana).
      const map: Record<number, EstadoRow> = {};
      for (const r of rows) if (!(r.userId in map)) map[r.userId] = r;
      setEstado(map);
    } catch {
      /* silencioso: el estado es informativo */
    }
  }, []);

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
    void cargarEstado();
  }, [cargarEstado]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return workers;
    return workers.filter(
      (w) =>
        (w.name ?? "").toLowerCase().includes(q) ||
        (w.workerCode ?? "").toLowerCase().includes(q),
    );
  }, [workers, search]);

  async function pickPhoto(file: File | null) {
    if (!file) return;
    setPhotoBusy(true);
    try {
      const dataUrl = await compressImageFile(file, { maxDim: 1280, quality: 0.72 });
      setPhotoDataUrl(dataUrl);
    } catch {
      setError("No se pudo procesar la foto.");
    } finally {
      setPhotoBusy(false);
      if (photoInputRef.current) photoInputRef.current.value = "";
    }
  }

  async function registrar(worker: WorkerMini, tipo: "E" | "S") {
    if (savingKey != null) return;
    if (tipo === "E" && !projectId) return;
    setSavingKey(`${worker.id}-${tipo}`);
    setError(null);
    try {
      const path = tipo === "E" ? "/api/attendance/manual-check-in" : "/api/attendance/manual-check-out";
      const body: Record<string, unknown> = {
        workerId: worker.id,
        notes: notesById[worker.id]?.trim() || undefined,
        photoUrl: photoDataUrl ?? undefined,
      };
      if (tipo === "E") body.projectId = projectId;
      const res = await authedFetch(path, { method: "POST", body: JSON.stringify(body) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error || "No se pudo registrar.");
        return;
      }
      // Limpiar nota y foto consumidas; refrescar estado E/S.
      setNotesById((prev) => ({ ...prev, [worker.id]: "" }));
      setPhotoDataUrl(null);
      await cargarEstado();
    } catch {
      setError("Error de red al registrar.");
    } finally {
      setSavingKey(null);
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
              Marca entrada (E) y salida (S) de tus trabajadores. La foto se anexa al registro.
            </p>
          </div>
          <button
            onClick={() => setLocation("/asistencia")}
            className="px-4 py-2 rounded-xl text-sm font-bold text-gray-700 border border-gray-200"
            data-testid="button-back-dashboard"
          >
            ← Dashboard
          </button>
        </div>

        {/* FOTO de evidencia — arriba, como pidio el cliente */}
        <div className="bg-white rounded-2xl border border-gray-100 p-4">
          <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2">
            Foto de evidencia
          </p>
          <input
            ref={photoInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => void pickPhoto(e.target.files?.[0] ?? null)}
            data-testid="input-photo"
          />
          {photoDataUrl ? (
            <div className="flex items-center gap-3">
              <img src={photoDataUrl} alt="Evidencia" className="w-20 h-20 rounded-xl object-cover border border-gray-200" />
              <div className="flex flex-col gap-2">
                <button
                  onClick={() => photoInputRef.current?.click()}
                  className="px-4 py-2 rounded-xl text-sm font-bold text-gray-700 border border-gray-200"
                  data-testid="button-retake-photo"
                >
                  Cambiar foto
                </button>
                <button
                  onClick={() => setPhotoDataUrl(null)}
                  className="px-4 py-2 rounded-xl text-sm font-bold text-red-600 border border-red-200"
                  data-testid="button-clear-photo"
                >
                  Quitar
                </button>
              </div>
              <p className="text-xs text-gray-400 flex-1">
                Se anexara al proximo registro que marques.
              </p>
            </div>
          ) : (
            <button
              onClick={() => photoInputRef.current?.click()}
              disabled={photoBusy}
              className="w-full py-6 rounded-xl border-2 border-dashed border-gray-200 text-sm font-bold text-gray-500 disabled:opacity-40"
              data-testid="button-pick-photo"
            >
              {photoBusy ? "Procesando..." : "📷 Tomar foto"}
            </button>
          )}
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
          placeholder="Buscar trabajador por nombre o código..."
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
              const st = estado[w.id];
              const abierta = st && !st.checkOutAt; // entrada abierta → puede marcar S
              const cerrada = st && !!st.checkOutAt; // ya hizo E y S hoy
              return (
                <div
                  key={w.id}
                  className="bg-white rounded-2xl border border-gray-100 p-4 flex flex-col gap-3"
                  data-testid={`worker-row-${w.id}`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="font-bold text-gray-900 truncate">{w.name ?? "Sin nombre"}</p>
                      {w.workerCode && (
                        <p className="text-xs text-gray-400 font-mono">{w.workerCode}</p>
                      )}
                      {st && (
                        <p className="text-xs mt-0.5">
                          <span className="text-green-700 font-bold">E {hora(st.checkInAt)}</span>
                          {st.checkOutAt && (
                            <span className="text-blue-700 font-bold ml-2">S {hora(st.checkOutAt)}</span>
                          )}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {/* Boton E — entrada */}
                      <button
                        onClick={() => registrar(w, "E")}
                        disabled={savingKey != null || !projectId || abierta || cerrada}
                        className="w-12 h-12 rounded-xl text-lg font-black text-white disabled:opacity-30"
                        style={{ background: "#FF3C00" }}
                        data-testid={`button-entrada-${w.id}`}
                        title="Marcar entrada"
                      >
                        {savingKey === `${w.id}-E` ? "..." : "E"}
                      </button>
                      {/* Boton S — salida */}
                      <button
                        onClick={() => registrar(w, "S")}
                        disabled={savingKey != null || !abierta}
                        className="w-12 h-12 rounded-xl text-lg font-black text-white disabled:opacity-30"
                        style={{ background: "#1F1F1F" }}
                        data-testid={`button-salida-${w.id}`}
                        title="Marcar salida"
                      >
                        {savingKey === `${w.id}-S` ? "..." : "S"}
                      </button>
                    </div>
                  </div>
                  {!cerrada && (
                    <input
                      value={notesById[w.id] ?? ""}
                      onChange={(e) => setNotesById((prev) => ({ ...prev, [w.id]: e.target.value }))}
                      placeholder="Nota opcional (ej: llegó tarde)"
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
