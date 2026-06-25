import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { MainLayout } from "@/components/layout/main-layout";
import { getAuthToken, getClerkUserInfo } from "@workspace/api-client-react";
import { apiUrl } from "@/lib/api-url";
import { usePermissions } from "@/hooks/use-permissions";
import { compressImageFile } from "@/lib/compress-image";

type ProjectMini = { id: number; name: string };
type WorkerMini = { id: number; name: string | null; workerCode: string | null; role: string };
type EstadoRow = { id: number; userId: number; projectId: number; checkInAt: string; checkOutAt: string | null; };

async function authedFetch(path: string, init?: RequestInit): Promise<Response> {
  const token = await getAuthToken();
  const { clerkId, email } = getClerkUserInfo();
  const headers: Record<string, string> = { Accept: "application/json", ...(init?.body ? { "Content-Type": "application/json" } : {}) };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const params = new URLSearchParams();
  if (clerkId) params.set("clerkId", clerkId);
  if (email) params.set("email", email);
  const qs = params.toString();
  const sep = path.includes("?") ? "&" : "?";
  return fetch(`${apiUrl(path)}${qs ? sep + qs : ""}`, { ...init, headers: { ...headers, ...(init?.headers as Record<string, string> | undefined) }, credentials: "include" });
}

function hora(d: string | Date): string {
  return new Date(d).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" });
}

export default function RegistroManualPage() {
  const [, setLocation] = useLocation();
  const perms = usePermissions();
  const [projects, setProjects] = useState<ProjectMini[]>([]);
  const [workers, setWorkers] = useState<WorkerMini[]>([]);
  const [estado, setEstado] = useState<Record<number, EstadoRow>>({});
  const [projectId, setProjectId] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [notesById, setNotesById] = useState<Record<number, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<{ msg: string; tipo: "E" | "S" } | null>(null);
  const [photoDataUrl, setPhotoDataUrl] = useState<string | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const photoInputRef = useRef<HTMLInputElement>(null);

  const showToast = (msg: string, tipo: "E" | "S") => { setToast({ msg, tipo }); setTimeout(() => setToast(null), 2800); };

  const cargarEstado = useCallback(async () => {
    try {
      const res = await authedFetch("/api/attendance/registro-estado");
      if (!res.ok) return;
      const rows = (await res.json()) as EstadoRow[];
      const map: Record<number, EstadoRow> = {};
      for (const r of rows) if (!(r.userId in map)) map[r.userId] = r;
      setEstado(map);
    } catch { }
  }, []);

  useEffect(() => {
    Promise.all([
      authedFetch("/api/projects").then((r) => (r.ok ? r.json() : [])),
      authedFetch("/api/users?role=worker").then((r) => (r.ok ? r.json() : [])),
    ]).then(([projData, workerData]) => {
      const ps = (projData as ProjectMini[]).map((p) => ({ id: p.id, name: p.name }));
      setProjects(ps);
      if (ps.length > 0) setProjectId(ps[0].id);
      setWorkers((workerData as WorkerMini[]).map((w) => ({ id: w.id, name: w.name, workerCode: w.workerCode, role: w.role })));
    }).catch(() => setError("No se pudieron cargar los datos.")).finally(() => setLoading(false));
    void cargarEstado();
  }, [cargarEstado]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return workers;
    return workers.filter((w) => (w.name ?? "").toLowerCase().includes(q) || (w.workerCode ?? "").toLowerCase().includes(q));
  }, [workers, search]);

  const presentes = Object.values(estado).filter((s) => !s.checkOutAt).length;
  const completados = Object.values(estado).filter((s) => !!s.checkOutAt).length;
  const sinMarcar = workers.length - Object.keys(estado).length;

  async function pickPhoto(file: File | null) {
    if (!file) return;
    setPhotoBusy(true);
    try { const dataUrl = await compressImageFile(file, { maxDim: 1280, quality: 0.72 }); setPhotoDataUrl(dataUrl); }
    catch { setError("No se pudo procesar la foto."); }
    finally { setPhotoBusy(false); if (photoInputRef.current) photoInputRef.current.value = ""; }
  }

  async function registrar(worker: WorkerMini, tipo: "E" | "S") {
    if (savingKey != null) return;
    if (tipo === "E" && !projectId) return;
    setSavingKey(`${worker.id}-${tipo}`);
    setError(null);
    try {
      const path = tipo === "E" ? "/api/attendance/manual-check-in" : "/api/attendance/manual-check-out";
      const body: Record<string, unknown> = { workerId: worker.id, notes: notesById[worker.id]?.trim() || undefined, photoUrl: photoDataUrl ?? undefined };
      if (tipo === "E") body.projectId = projectId;
      const res = await authedFetch(path, { method: "POST", body: JSON.stringify(body) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data?.error || "No se pudo registrar."); return; }
      setNotesById((prev) => ({ ...prev, [worker.id]: "" }));
      setPhotoDataUrl(null);
      showToast(tipo === "E" ? `Entrada — ${worker.name}` : `Salida — ${worker.name}`, tipo);
      await cargarEstado();
    } catch { setError("Error de red al registrar."); }
    finally { setSavingKey(null); }
  }

  if (!perms.loading && !perms.has("attendanceGenerateQr")) {
    return (<MainLayout><div className="max-w-3xl mx-auto px-4 py-10 text-center"><p className="text-gray-500">Sin permiso.</p></div></MainLayout>);
  }

  return (
    <MainLayout>
      {toast && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-[99] px-5 py-3 rounded-2xl text-sm font-bold text-white shadow-xl"
          style={{ background: toast.tipo === "E" ? "#16a34a" : "#1F1F1F" }}>
          {toast.tipo === "E" ? "✓" : "◼"} {toast.msg}
        </div>
      )}
      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-black text-gray-900 tracking-tight">Toma de lista</h1>
            <p className="text-sm text-gray-400 mt-0.5">Marca presentes a tu cuadrilla</p>
          </div>
          <button onClick={() => setLocation("/asistencia")} className="px-3 py-2 rounded-xl text-xs font-bold text-gray-500 border border-gray-200" data-testid="button-back-dashboard">← Historial</button>
        </div>

        <div className="grid grid-cols-3 gap-2">
          {[{ label: "En obra", val: presentes, color: "#16a34a" }, { label: "Sin marcar", val: sinMarcar, color: "#9ca3af" }, { label: "Completados", val: completados, color: "#2563eb" }].map((k) => (
            <div key={k.label} className="bg-white rounded-2xl border border-gray-100 p-3 text-center">
              <p className="text-2xl font-black" style={{ color: k.color }}>{k.val}</p>
              <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mt-0.5">{k.label}</p>
            </div>
          ))}
        </div>

        <div className="bg-white rounded-2xl border border-gray-100 px-4 py-3 flex items-center gap-3">
          <label className="text-[10px] font-bold uppercase tracking-widest text-gray-400 whitespace-nowrap">OBRA:</label>
          <select value={projectId ?? ""} onChange={(e) => setProjectId(Number(e.target.value))}
            className="flex-1 px-2 py-1.5 rounded-lg border border-gray-200 bg-white text-sm font-semibold text-gray-800" data-testid="select-registro-project">
            {projects.length === 0 && <option>Cargando...</option>}
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>

        <input value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar trabajador por nombre o código..."
          className="w-full px-4 py-3 rounded-2xl border border-gray-200 bg-white text-sm" data-testid="input-search-worker" />

        {error && <div className="rounded-2xl px-4 py-3 text-sm font-medium bg-red-50 border border-red-200 text-red-700">{error}</div>}

        {loading ? <p className="text-sm text-gray-400 text-center py-8">Cargando trabajadores...</p>
        : filtered.length === 0 ? <p className="text-sm text-gray-400 text-center py-8">No hay trabajadores que coincidan.</p>
        : (
          <div className="space-y-2">
            {filtered.map((w) => {
              const st = estado[w.id];
              const abierta = !!(st && !st.checkOutAt);
              const cerrada = !!(st && st.checkOutAt);
              return (
                <div key={w.id}
                  className="rounded-2xl border p-4 flex flex-col gap-2.5 transition-all"
                  style={{ borderColor: cerrada ? "#dbeafe" : abierta ? "#dcfce7" : "#f3f4f6", background: cerrada ? "#f0f9ff" : abierta ? "#f0fdf4" : "#fff" }}
                  data-testid={`worker-row-${w.id}`}>
                  <div className="flex items-center gap-3">
                    <div className="w-11 h-11 rounded-xl flex items-center justify-center text-sm font-black flex-shrink-0"
                      style={{ background: cerrada ? "#bfdbfe" : abierta ? "#bbf7d0" : "#f3f4f6", color: cerrada ? "#1d4ed8" : abierta ? "#15803d" : "#6b7280" }}>
                      {(w.name ?? "?").slice(0, 1).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-gray-900 truncate text-base">{w.name ?? "Sin nombre"}</p>
                      <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                        {w.workerCode && <span className="text-[11px] font-mono text-gray-400">{w.workerCode}</span>}
                        {abierta && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: "#dcfce7", color: "#15803d" }}>● En obra desde {hora(st.checkInAt)}</span>}
                        {cerrada && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: "#dbeafe", color: "#1d4ed8" }}>✓ E {hora(st.checkInAt)} · S {hora(st.checkOutAt!)}</span>}
                      </div>
                    </div>
                    {!cerrada && (
                      <button
                        onClick={() => registrar(w, abierta ? "S" : "E")}
                        disabled={savingKey != null || (!abierta && !projectId)}
                        className="px-4 py-2.5 rounded-xl text-sm font-black text-white disabled:opacity-40 flex-shrink-0"
                        style={{ background: abierta ? "#1F1F1F" : "#FF3C00", boxShadow: abierta ? "0 2px 8px rgba(0,0,0,0.18)" : "0 2px 12px rgba(255,60,0,0.35)" }}
                        data-testid={`button-marcar-${w.id}`}>
                        {savingKey === `${w.id}-E` || savingKey === `${w.id}-S` ? "..." : abierta ? "Marcar salida" : "Marcar presente"}
                      </button>
                    )}
                    {cerrada && (
                      <div className="flex-shrink-0 w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: "#dbeafe" }}>
                        <svg viewBox="0 0 20 20" fill="#1d4ed8" className="w-5 h-5"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>
                      </div>
                    )}
                  </div>
                  {!cerrada && (
                    <input value={notesById[w.id] ?? ""} onChange={(e) => setNotesById((prev) => ({ ...prev, [w.id]: e.target.value }))}
                      placeholder="Nota opcional (ej: llegó tarde)"
                      className="w-full px-3 py-2 rounded-xl border border-gray-200 bg-white/80 text-sm text-gray-600"
                      data-testid={`input-note-${w.id}`} />
                  )}
                </div>
              );
            })}
          </div>
        )}

        <div className="bg-white rounded-2xl border border-gray-100 p-4">
          <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2">Foto de evidencia (opcional)</p>
          <input ref={photoInputRef} type="file" accept="image/*" capture="environment" className="hidden"
            onChange={(e) => void pickPhoto(e.target.files?.[0] ?? null)} data-testid="input-photo" />
          {photoDataUrl ? (
            <div className="flex items-center gap-3">
              <img src={photoDataUrl} alt="Evidencia" className="w-16 h-16 rounded-xl object-cover border border-gray-200" />
              <div className="flex gap-2">
                <button onClick={() => photoInputRef.current?.click()} className="px-3 py-1.5 rounded-lg text-xs font-bold text-gray-700 border border-gray-200">Cambiar</button>
                <button onClick={() => setPhotoDataUrl(null)} className="px-3 py-1.5 rounded-lg text-xs font-bold text-red-600 border border-red-200">Quitar</button>
              </div>
              <p className="text-[11px] text-gray-400 flex-1">Se anexará al próximo registro.</p>
            </div>
          ) : (
            <button onClick={() => photoInputRef.current?.click()} disabled={photoBusy}
              className="w-full py-4 rounded-xl border-2 border-dashed border-gray-200 text-sm font-bold text-gray-400 disabled:opacity-40"
              data-testid="button-pick-photo">
              {photoBusy ? "Procesando..." : "📷 Adjuntar foto"}
            </button>
          )}
        </div>
      </div>
    </MainLayout>
  );
}
