import { useState } from "react";
import { MainLayout } from "@/components/layout/main-layout";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { useAuth as useClerkAuth } from "@clerk/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { format } from "date-fns";
import { es } from "date-fns/locale";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// ─── Auth fetch helper ────────────────────────────────────────────────────────
function useAuthFetch() {
  const { getToken } = useClerkAuth();
  const { user } = useAuth();
  return async (path: string, opts?: RequestInit) => {
    const token = await getToken().catch(() => null);
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (token) headers["Authorization"] = `Bearer ${token}`;
    const params = new URLSearchParams();
    if (user?.email) params.set("email", user.email);
    const qs = params.toString();
    const url = `${BASE}/api${path}${qs ? (path.includes("?") ? "&" : "?") + qs : ""}`;
    const res = await fetch(url, { ...opts, headers: { ...headers, ...(opts?.headers ?? {}) } });
    if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || "Error"); }
    return res.json();
  };
}

// ─── Types ────────────────────────────────────────────────────────────────────
const REPORT_TYPES = [
  { value: "avance", label: "Avance de Obra", icon: "📊", desc: "Progreso, presupuesto y estado general del proyecto", color: "#C8952A" },
  { value: "bitacora", label: "Bitácora de Trabajo", icon: "📋", desc: "Registro de actividades diarias y entradas de obra", color: "#3B82F6" },
  { value: "materiales", label: "Control de Materiales", icon: "🏗️", desc: "Solicitudes de materiales, costos y estatus de entrega", color: "#8B5CF6" },
];

const STATUS_LABELS: Record<string, string> = { pending: "Pendiente", approved: "Aprobado", rejected: "Rechazado", delivered: "Entregado" };
const STATUS_COLORS: Record<string, string> = { pending: "#F59E0B", approved: "#10B981", rejected: "#EF4444", delivered: "#3B82F6" };

const MXN = (v: number) => new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 }).format(v);

// ─── Print view ───────────────────────────────────────────────────────────────
function PrintView({ data, onClose }: { data: any; onClose: () => void }) {
  const { report, project, logs, materials, summary } = data;

  const typeLabel = REPORT_TYPES.find(t => t.value === report.type)?.label ?? report.type;

  const handlePrint = () => window.print();

  return (
    <>
      {/* Print-only style injected into head */}
      <style>{`
        @media print {
          body > * { display: none !important; }
          #castores-report-print { display: block !important; }
          @page { margin: 15mm; size: A4; }
        }
        #castores-report-print { display: none; }
      `}</style>

      {/* Screen overlay */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex flex-col"
        style={{ background: "#F5F4F0" }}>

        {/* Top bar (hidden on print) */}
        <div className="flex items-center justify-between px-4 py-3 border-b no-print"
          style={{ background: "white", borderColor: "rgba(0,0,0,0.1)" }}>
          <div className="flex items-center gap-3">
            <button onClick={onClose}
              className="w-8 h-8 rounded-lg flex items-center justify-center"
              style={{ background: "rgba(0,0,0,0.06)" }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
                <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
              </svg>
            </button>
            <div>
              <p className="font-bold text-sm" style={{ color: "#1a1612" }}>{report.title}</p>
              <p className="text-xs" style={{ color: "rgba(26,22,18,0.45)" }}>{typeLabel}</p>
            </div>
          </div>
          <button
            onClick={handlePrint}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold text-white"
            style={{ background: "#C8952A" }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6.72 13.829c-.24.03-.48.062-.72.096m.72-.096a42.415 42.415 0 0110.56 0m-10.56 0L6.34 18m10.94-4.171c.24.03.48.062.72.096m-.72-.096L17.66 18m0 0l.229 2.523a1.125 1.125 0 01-1.12 1.227H7.231c-.662 0-1.18-.568-1.12-1.227L6.34 18m11.318 0h1.091A2.25 2.25 0 0021 15.75V9.456c0-1.081-.768-2.015-1.837-2.175a48.055 48.055 0 00-1.913-.247M6.34 18H5.25A2.25 2.25 0 013 15.75V9.456c0-1.081.768-2.015 1.837-2.175a48.056 48.056 0 011.913-.247m10.5 0a48.536 48.536 0 00-10.5 0m10.5 0V3.375c0-.621-.504-1.125-1.125-1.125h-8.25c-.621 0-1.125.504-1.125 1.125v3.659M18 10.5h.008v.008H18V10.5zm-3 0h.008v.008H15V10.5z" />
            </svg>
            Imprimir / PDF
          </button>
        </div>

        {/* Report content (visible on screen + print) */}
        <div className="flex-1 overflow-y-auto py-6 px-4">
          <div id="castores-report-print" className="max-w-3xl mx-auto bg-white rounded-2xl shadow-sm overflow-hidden" style={{ border: "1px solid rgba(0,0,0,0.08)" }}>

            {/* Header */}
            <div className="px-8 pt-8 pb-6" style={{ background: "linear-gradient(135deg, #1a1612 0%, #2d2419 100%)" }}>
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-3 mb-3">
                    <div className="w-10 h-10 rounded-xl overflow-hidden flex-shrink-0" style={{ background: "rgba(200,149,42,0.2)", border: "1px solid rgba(200,149,42,0.3)" }}>
                      <img src="/castores-logo.jpeg" alt="CASTORES" className="w-full h-full object-contain" />
                    </div>
                    <div>
                      <p className="text-white font-black text-sm" style={{ fontFamily: "'Bebas Neue', sans-serif", letterSpacing: "0.06em" }}>
                        CASTORES ESTRUCTURAS Y CONSTRUCCIONES
                      </p>
                      <p className="text-xs" style={{ color: "rgba(255,255,255,0.4)" }}>Sistema de Control Operacional</p>
                    </div>
                  </div>
                  <h1 className="text-white font-black text-2xl mb-1" style={{ fontFamily: "'Bebas Neue', sans-serif", letterSpacing: "0.04em" }}>
                    {report.title}
                  </h1>
                  <p className="text-sm font-semibold" style={{ color: "#C8952A" }}>{typeLabel}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs mb-1" style={{ color: "rgba(255,255,255,0.4)" }}>Generado por</p>
                  <p className="text-white text-sm font-bold">{report.generatedByName}</p>
                  <p className="text-xs mt-1" style={{ color: "rgba(255,255,255,0.4)" }}>
                    {format(new Date(report.createdAt), "dd 'de' MMMM yyyy", { locale: es })}
                  </p>
                </div>
              </div>

              {/* Period badge */}
              {(report.dateFrom || report.dateTo) && (
                <div className="mt-4 inline-flex items-center gap-2 px-3 py-1.5 rounded-lg"
                  style={{ background: "rgba(200,149,42,0.15)", border: "1px solid rgba(200,149,42,0.3)" }}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="#C8952A" strokeWidth="2" className="w-3.5 h-3.5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
                  </svg>
                  <span className="text-xs font-bold" style={{ color: "#C8952A" }}>
                    Período: {report.dateFrom ? format(new Date(report.dateFrom + "T12:00:00"), "dd MMM yyyy", { locale: es }) : "Inicio"} — {report.dateTo ? format(new Date(report.dateTo + "T12:00:00"), "dd MMM yyyy", { locale: es }) : "Hoy"}
                  </span>
                </div>
              )}
            </div>

            <div className="px-8 py-6 space-y-8">

              {/* Project info */}
              {project && (
                <section>
                  <h2 className="font-black text-base mb-3 pb-2 border-b" style={{ color: "#1a1612", fontFamily: "'Bebas Neue', sans-serif", letterSpacing: "0.04em", borderColor: "rgba(0,0,0,0.08)" }}>
                    INFORMACIÓN DEL PROYECTO
                  </h2>
                  <div className="grid grid-cols-2 gap-3">
                    {[
                      { label: "Nombre", value: project.name },
                      { label: "Ubicación", value: project.location ?? "—" },
                      { label: "Estado", value: project.status === "active" ? "Activa" : project.status === "completed" ? "Terminada" : project.status === "paused" ? "Pausada" : project.status },
                      { label: "Avance", value: `${project.progressPercent ?? 0}%` },
                      { label: "Cliente", value: project.clientName ?? "—" },
                      { label: "Supervisor", value: project.supervisorName ?? "—" },
                      { label: "Presupuesto", value: project.budget ? MXN(project.budget) : "—" },
                      { label: "Inicio", value: project.startDate ? format(new Date(project.startDate + "T12:00:00"), "dd/MM/yyyy") : "—" },
                    ].map(({ label, value }) => (
                      <div key={label} className="rounded-lg p-3" style={{ background: "#FAFAF9", border: "1px solid rgba(0,0,0,0.06)" }}>
                        <p className="text-[10px] font-bold uppercase tracking-wider mb-0.5" style={{ color: "rgba(26,22,18,0.4)" }}>{label}</p>
                        <p className="text-sm font-bold" style={{ color: "#1a1612" }}>{value}</p>
                      </div>
                    ))}
                  </div>

                  {/* Progress bar */}
                  {report.type === "avance" && (
                    <div className="mt-4 rounded-xl p-4" style={{ background: "#FAFAF9", border: "1px solid rgba(0,0,0,0.06)" }}>
                      <div className="flex justify-between items-center mb-2">
                        <span className="text-xs font-bold" style={{ color: "rgba(26,22,18,0.55)" }}>Avance general</span>
                        <span className="text-sm font-black" style={{ color: "#C8952A" }}>{project.progressPercent ?? 0}%</span>
                      </div>
                      <div className="h-3 rounded-full overflow-hidden" style={{ background: "rgba(0,0,0,0.08)" }}>
                        <div className="h-full rounded-full transition-all" style={{ width: `${project.progressPercent ?? 0}%`, background: "linear-gradient(90deg, #C8952A, #E8B84B)" }} />
                      </div>
                      {project.budget ? (
                        <div className="flex justify-between mt-3">
                          <div className="text-center">
                            <p className="text-[10px]" style={{ color: "rgba(26,22,18,0.4)" }}>Presupuesto total</p>
                            <p className="text-sm font-black" style={{ color: "#1a1612" }}>{MXN(project.budget)}</p>
                          </div>
                          <div className="text-center">
                            <p className="text-[10px]" style={{ color: "rgba(26,22,18,0.4)" }}>Gastado</p>
                            <p className="text-sm font-black" style={{ color: "#EF4444" }}>{MXN(project.spentAmount ?? 0)}</p>
                          </div>
                          <div className="text-center">
                            <p className="text-[10px]" style={{ color: "rgba(26,22,18,0.4)" }}>Disponible</p>
                            <p className="text-sm font-black" style={{ color: "#10B981" }}>{MXN((project.budget ?? 0) - (project.spentAmount ?? 0))}</p>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  )}
                </section>
              )}

              {/* Materials section */}
              {(report.type === "materiales" || report.type === "avance") && (
                <section>
                  <h2 className="font-black text-base mb-3 pb-2 border-b" style={{ color: "#1a1612", fontFamily: "'Bebas Neue', sans-serif", letterSpacing: "0.04em", borderColor: "rgba(0,0,0,0.08)" }}>
                    MATERIALES ({summary.totalMaterials})
                  </h2>

                  {/* Summary chips */}
                  <div className="flex gap-2 flex-wrap mb-4">
                    {[
                      { label: "Aprobados", val: summary.approvedMaterials, color: "#10B981" },
                      { label: "Pendientes", val: summary.pendingMaterials, color: "#F59E0B" },
                      { label: "Rechazados", val: summary.rejectedMaterials, color: "#EF4444" },
                    ].map(({ label, val, color }) => (
                      <div key={label} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg"
                        style={{ background: `${color}10`, border: `1px solid ${color}30` }}>
                        <span className="w-2 h-2 rounded-full" style={{ background: color }} />
                        <span className="text-xs font-bold" style={{ color }}>{label}: {val}</span>
                      </div>
                    ))}
                    {summary.totalMaterialCost > 0 && (
                      <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg ml-auto"
                        style={{ background: "#C8952A10", border: "1px solid #C8952A30" }}>
                        <span className="text-xs font-bold" style={{ color: "#C8952A" }}>
                          Total: {MXN(summary.totalMaterialCost)}
                        </span>
                      </div>
                    )}
                  </div>

                  {materials.length === 0 ? (
                    <p className="text-sm text-center py-6" style={{ color: "rgba(26,22,18,0.35)" }}>Sin materiales en el período seleccionado</p>
                  ) : (
                    <div className="rounded-xl overflow-hidden" style={{ border: "1px solid rgba(0,0,0,0.08)" }}>
                      <table className="w-full text-xs">
                        <thead>
                          <tr style={{ background: "#F5F4F0" }}>
                            {["Material", "Cantidad", "Unidad", "Costo Total", "Estatus"].map(h => (
                              <th key={h} className="px-3 py-2 text-left font-bold" style={{ color: "rgba(26,22,18,0.5)" }}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y" style={{ background: "white" }}>
                          {materials.map((m: any) => (
                            <tr key={m.id}>
                              <td className="px-3 py-2 font-semibold" style={{ color: "#1a1612" }}>{m.name}</td>
                              <td className="px-3 py-2" style={{ color: "rgba(26,22,18,0.6)" }}>{m.quantityApproved ?? m.quantityRequested}</td>
                              <td className="px-3 py-2" style={{ color: "rgba(26,22,18,0.6)" }}>{m.unit}</td>
                              <td className="px-3 py-2 font-semibold" style={{ color: "#C8952A" }}>
                                {m.totalCost ? MXN(m.totalCost) : "—"}
                              </td>
                              <td className="px-3 py-2">
                                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold"
                                  style={{ background: `${STATUS_COLORS[m.status] ?? "#999"}15`, color: STATUS_COLORS[m.status] ?? "#999" }}>
                                  {STATUS_LABELS[m.status] ?? m.status}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>
              )}

              {/* Bitácora section */}
              {(report.type === "bitacora" || report.type === "avance") && (
                <section>
                  <h2 className="font-black text-base mb-3 pb-2 border-b" style={{ color: "#1a1612", fontFamily: "'Bebas Neue', sans-serif", letterSpacing: "0.04em", borderColor: "rgba(0,0,0,0.08)" }}>
                    BITÁCORA DE TRABAJO ({summary.totalLogs} entradas)
                  </h2>

                  {logs.length === 0 ? (
                    <p className="text-sm text-center py-6" style={{ color: "rgba(26,22,18,0.35)" }}>Sin entradas de bitácora en el período seleccionado</p>
                  ) : (
                    <div className="space-y-3">
                      {logs.map((log: any) => (
                        <div key={log.id} className="rounded-xl p-4" style={{ background: "#FAFAF9", border: "1px solid rgba(0,0,0,0.06)" }}>
                          <div className="flex items-center justify-between mb-1.5">
                            <span className="font-black text-sm" style={{ color: "#1a1612" }}>
                              {format(new Date(log.logDate + "T12:00:00"), "EEEE dd 'de' MMMM", { locale: es })}
                            </span>
                            {log.isSubmitted && (
                              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                                style={{ background: "#10B98115", color: "#10B981" }}>Firmada</span>
                            )}
                          </div>
                          <p className="text-xs leading-relaxed mb-2" style={{ color: "rgba(26,22,18,0.7)" }}>{log.activity}</p>
                          {log.observations && <p className="text-xs leading-relaxed" style={{ color: "rgba(26,22,18,0.45)" }}>📝 {log.observations}</p>}
                          {log.workersInvolved && <p className="text-xs mt-1" style={{ color: "rgba(26,22,18,0.45)" }}>👷 {log.workersInvolved}</p>}
                          {log.materialsUsed && <p className="text-xs mt-1" style={{ color: "rgba(26,22,18,0.45)" }}>🏗️ {log.materialsUsed}</p>}
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              )}

              {/* Footer */}
              <div className="border-t pt-6 flex items-end justify-between" style={{ borderColor: "rgba(0,0,0,0.08)" }}>
                <div>
                  <p className="text-[10px] uppercase tracking-wider mb-1" style={{ color: "rgba(26,22,18,0.35)" }}>Generado por</p>
                  <p className="text-sm font-bold" style={{ color: "#1a1612" }}>{report.generatedByName}</p>
                  <p className="text-xs" style={{ color: "rgba(26,22,18,0.4)" }}>
                    {format(new Date(report.createdAt), "dd 'de' MMMM yyyy, HH:mm", { locale: es })}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-[10px] uppercase tracking-wider mb-4" style={{ color: "rgba(26,22,18,0.35)" }}>Firma de conformidad</p>
                  <div className="w-40 border-b" style={{ borderColor: "rgba(0,0,0,0.2)" }} />
                </div>
              </div>
            </div>
          </div>
        </div>
      </motion.div>
    </>
  );
}

// ─── Main Reportes page ───────────────────────────────────────────────────────
export default function Reportes() {
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const authFetch = useAuthFetch();

  const [showForm, setShowForm] = useState(false);
  const [creating, setCreating] = useState(false);
  const [printData, setPrintData] = useState<any>(null);
  const [loadingPrint, setLoadingPrint] = useState<number | null>(null);

  const [form, setForm] = useState({
    title: "",
    type: "avance",
    projectId: "",
    dateFrom: "",
    dateTo: "",
  });

  const { data: reports = [], isLoading } = useQuery<any[]>({
    queryKey: ["reports"],
    queryFn: () => authFetch("/reports"),
    refetchInterval: 60_000,
  });

  const { data: projects = [] } = useQuery<any[]>({
    queryKey: ["projects"],
    queryFn: () => authFetch("/projects"),
  });

  const canCreate = user?.role === "admin" || user?.role === "supervisor";

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.projectId) { toast({ title: "Selecciona un proyecto", variant: "destructive" }); return; }
    if (!form.title.trim()) { toast({ title: "Escribe un título para el reporte", variant: "destructive" }); return; }
    setCreating(true);
    try {
      const payload: Record<string, any> = {
        title: form.title.trim(),
        type: form.type,
        projectId: parseInt(form.projectId),
      };
      if (form.dateFrom) payload.dateFrom = form.dateFrom;
      if (form.dateTo) payload.dateTo = form.dateTo;
      await authFetch("/reports", { method: "POST", body: JSON.stringify(payload) });
      qc.invalidateQueries({ queryKey: ["reports"] });
      toast({ title: "Reporte generado correctamente." });
      setShowForm(false);
      setForm({ title: "", type: "avance", projectId: "", dateFrom: "", dateTo: "" });
    } catch (err: any) {
      toast({ title: err.message, variant: "destructive" });
    } finally {
      setCreating(false);
    }
  };

  const openPrint = async (id: number) => {
    setLoadingPrint(id);
    try {
      const data = await authFetch(`/reports/${id}/data`);
      setPrintData(data);
    } catch (err: any) {
      toast({ title: err.message, variant: "destructive" });
    } finally {
      setLoadingPrint(null);
    }
  };

  const typeColor = REPORT_TYPES.find(t => t.value === form.type)?.color ?? "#C8952A";

  const inputCls = "w-full px-3 py-2.5 rounded-xl text-sm outline-none";
  const inputStyle = { background: "rgba(255,255,255,0.07)", border: "1.5px solid rgba(255,255,255,0.12)", color: "white" };

  return (
    <>
      <AnimatePresence>
        {printData && <PrintView key="print" data={printData} onClose={() => setPrintData(null)} />}
      </AnimatePresence>

      <MainLayout>
        <div className="space-y-5 pb-6">

          {/* Hero */}
          <div className="relative rounded-3xl overflow-hidden" style={{ minHeight: 160 }}>
            <img
              src="https://images.unsplash.com/photo-1454165804606-c3d57bc86b40?w=1400&q=80&fit=crop"
              alt="Reportes"
              className="absolute inset-0 w-full h-full object-cover"
            />
            <div className="absolute inset-0" style={{ background: "linear-gradient(135deg, rgba(26,22,18,0.92) 0%, rgba(26,22,18,0.6) 100%)" }} />
            <div className="relative z-10 p-6 flex items-end justify-between h-full" style={{ minHeight: 160 }}>
              <div>
                <span className="text-[10px] font-black tracking-widest px-2 py-1 rounded-md mb-2 inline-block"
                  style={{ background: "rgba(16,185,129,0.25)", color: "#10B981", border: "1px solid rgba(16,185,129,0.4)" }}>
                  INFORMES
                </span>
                <h1 className="text-white font-black text-2xl" style={{ fontFamily: "'Bebas Neue', sans-serif", letterSpacing: "0.04em" }}>
                  Reportes de Obra
                </h1>
                <p className="text-xs mt-1" style={{ color: "rgba(255,255,255,0.5)" }}>
                  Genera informes formales de avance, materiales y bitácora
                </p>
              </div>
              {canCreate && (
                <button
                  onClick={() => setShowForm(!showForm)}
                  className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold text-white flex-shrink-0"
                  style={{ background: showForm ? "#EF4444" : "#10B981", border: "1px solid rgba(255,255,255,0.15)" }}>
                  {showForm ? "✕ Cancelar" : "+ Nuevo reporte"}
                </button>
              )}
            </div>
          </div>

          {/* Generator form */}
          <AnimatePresence>
            {showForm && (
              <motion.div
                key="form"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="overflow-hidden">
                <form onSubmit={handleCreate} className="rounded-3xl p-6 space-y-5"
                  style={{ background: "linear-gradient(135deg, #1a1612 0%, #2d2419 100%)", border: "1.5px solid rgba(200,149,42,0.2)" }}>
                  <h3 className="font-black text-white text-lg" style={{ fontFamily: "'Bebas Neue', sans-serif", letterSpacing: "0.04em" }}>
                    Nuevo Reporte
                  </h3>

                  {/* Report type selector */}
                  <div>
                    <label className="block text-xs font-semibold mb-2" style={{ color: "rgba(255,255,255,0.5)" }}>Tipo de reporte</label>
                    <div className="grid grid-cols-1 gap-2">
                      {REPORT_TYPES.map((t) => (
                        <label key={t.value}
                          className="flex items-center gap-3 p-3 rounded-xl cursor-pointer transition-all"
                          style={{
                            background: form.type === t.value ? `${t.color}15` : "rgba(255,255,255,0.04)",
                            border: `1.5px solid ${form.type === t.value ? t.color + "50" : "rgba(255,255,255,0.08)"}`,
                          }}>
                          <input type="radio" name="type" value={t.value} checked={form.type === t.value}
                            onChange={(e) => setForm(f => ({ ...f, type: e.target.value }))} className="sr-only" />
                          <span className="text-xl">{t.icon}</span>
                          <div className="flex-1">
                            <p className="text-sm font-bold" style={{ color: form.type === t.value ? t.color : "rgba(255,255,255,0.7)" }}>{t.label}</p>
                            <p className="text-xs" style={{ color: "rgba(255,255,255,0.35)" }}>{t.desc}</p>
                          </div>
                          <div className="w-4 h-4 rounded-full border-2 flex items-center justify-center"
                            style={{ borderColor: form.type === t.value ? t.color : "rgba(255,255,255,0.2)" }}>
                            {form.type === t.value && <div className="w-2 h-2 rounded-full" style={{ background: t.color }} />}
                          </div>
                        </label>
                      ))}
                    </div>
                  </div>

                  {/* Title */}
                  <div>
                    <label className="block text-xs font-semibold mb-1.5" style={{ color: "rgba(255,255,255,0.5)" }}>Título del reporte *</label>
                    <input
                      className={inputCls} style={inputStyle}
                      value={form.title}
                      onChange={(e) => setForm(f => ({ ...f, title: e.target.value }))}
                      placeholder="Ej: Reporte de Avance — Torre Residencial — Mayo 2025"
                      required
                    />
                  </div>

                  {/* Project */}
                  <div>
                    <label className="block text-xs font-semibold mb-1.5" style={{ color: "rgba(255,255,255,0.5)" }}>Proyecto *</label>
                    <select
                      className={inputCls} style={{ ...inputStyle, background: "rgba(255,255,255,0.07)" }}
                      value={form.projectId}
                      onChange={(e) => setForm(f => ({ ...f, projectId: e.target.value }))}
                      required>
                      <option value="">— Seleccionar proyecto —</option>
                      {projects.map((p: any) => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                  </div>

                  {/* Date range */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold mb-1.5" style={{ color: "rgba(255,255,255,0.5)" }}>Fecha inicio</label>
                      <input type="date" className={inputCls} style={inputStyle}
                        value={form.dateFrom} onChange={(e) => setForm(f => ({ ...f, dateFrom: e.target.value }))} />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold mb-1.5" style={{ color: "rgba(255,255,255,0.5)" }}>Fecha fin</label>
                      <input type="date" className={inputCls} style={inputStyle}
                        value={form.dateTo} onChange={(e) => setForm(f => ({ ...f, dateTo: e.target.value }))} />
                    </div>
                  </div>

                  <button type="submit" disabled={creating}
                    className="w-full py-3.5 rounded-2xl text-sm font-bold text-white disabled:opacity-50"
                    style={{ background: `linear-gradient(135deg, ${typeColor}, ${typeColor}bb)` }}>
                    {creating ? "Generando..." : "Generar reporte →"}
                  </button>
                </form>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Reports list */}
          {isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map(i => (
                <div key={i} className="h-24 rounded-2xl animate-pulse" style={{ background: "rgba(0,0,0,0.06)" }} />
              ))}
            </div>
          ) : reports.length === 0 ? (
            <div className="text-center py-16 rounded-2xl" style={{ background: "rgba(0,0,0,0.03)", border: "1.5px dashed rgba(0,0,0,0.1)" }}>
              <div className="text-4xl mb-3">📊</div>
              <p className="font-bold text-sm" style={{ color: "rgba(26,22,18,0.5)" }}>Sin reportes generados</p>
              <p className="text-xs mt-1" style={{ color: "rgba(26,22,18,0.35)" }}>
                {canCreate ? 'Usa el botón "Nuevo reporte" para crear el primero.' : "Aún no hay reportes disponibles."}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {[...reports].reverse().map((report: any) => {
                const rt = REPORT_TYPES.find(t => t.value === report.type);
                return (
                  <motion.div
                    key={report.id}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="flex items-start gap-4 p-4 rounded-2xl"
                    style={{ background: "white", border: "1px solid rgba(0,0,0,0.07)" }}>

                    {/* Icon */}
                    <div className="w-12 h-12 rounded-xl flex items-center justify-center text-xl flex-shrink-0"
                      style={{ background: `${rt?.color ?? "#999"}12`, border: `1.5px solid ${rt?.color ?? "#999"}25` }}>
                      {rt?.icon ?? "📄"}
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-0.5">
                        <p className="font-black text-sm truncate" style={{ color: "#1a1612" }}>{report.title}</p>
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full flex-shrink-0"
                          style={{ background: `${rt?.color ?? "#999"}12`, color: rt?.color ?? "#999" }}>
                          {rt?.label ?? report.type}
                        </span>
                      </div>
                      <p className="text-xs" style={{ color: "rgba(26,22,18,0.45)" }}>
                        🏗️ {report.projectName ?? "—"}
                      </p>
                      <p className="text-xs mt-0.5" style={{ color: "rgba(26,22,18,0.35)" }}>
                        {format(new Date(report.createdAt), "dd/MM/yyyy HH:mm", { locale: es })} · {report.generatedByName}
                        {(report.dateFrom || report.dateTo) && (
                          <span> · {report.dateFrom ? format(new Date(report.dateFrom + "T12:00:00"), "dd MMM", { locale: es }) : "?"} — {report.dateTo ? format(new Date(report.dateTo + "T12:00:00"), "dd MMM", { locale: es }) : "Hoy"}</span>
                        )}
                      </p>
                    </div>

                    {/* View / Download */}
                    <button
                      onClick={() => openPrint(report.id)}
                      disabled={loadingPrint === report.id}
                      className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold flex-shrink-0 transition-all disabled:opacity-50"
                      style={{ background: `${rt?.color ?? "#C8952A"}15`, color: rt?.color ?? "#C8952A", border: `1px solid ${rt?.color ?? "#C8952A"}30` }}>
                      {loadingPrint === report.id ? (
                        <div className="w-4 h-4 border-2 rounded-full animate-spin" style={{ borderColor: "transparent", borderTopColor: rt?.color ?? "#C8952A" }} />
                      ) : (
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6.72 13.829c-.24.03-.48.062-.72.096m.72-.096a42.415 42.415 0 0110.56 0m-10.56 0L6.34 18m10.94-4.171c.24.03.48.062.72.096m-.72-.096L17.66 18m0 0l.229 2.523a1.125 1.125 0 01-1.12 1.227H7.231c-.662 0-1.18-.568-1.12-1.227L6.34 18m11.318 0h1.091A2.25 2.25 0 0021 15.75V9.456c0-1.081-.768-2.015-1.837-2.175a48.055 48.055 0 00-1.913-.247M6.34 18H5.25A2.25 2.25 0 013 15.75V9.456c0-1.081.768-2.015 1.837-2.175a48.056 48.056 0 011.913-.247m10.5 0a48.536 48.536 0 00-10.5 0m10.5 0V3.375c0-.621-.504-1.125-1.125-1.125h-8.25c-.621 0-1.125.504-1.125 1.125v3.659M18 10.5h.008v.008H18V10.5zm-3 0h.008v.008H15V10.5z" />
                        </svg>
                      )}
                      {loadingPrint === report.id ? "Cargando..." : "Ver / PDF"}
                    </button>
                  </motion.div>
                );
              })}
            </div>
          )}
        </div>
      </MainLayout>
    </>
  );
}
