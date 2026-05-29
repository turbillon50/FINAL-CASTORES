import { useState } from "react";
import { motion } from "framer-motion";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import {
  ResponsiveContainer, BarChart, Bar, PieChart, Pie, Cell,
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from "recharts";

// ─── Constructor inteligente de reportes (solo modo admin) ─────────────────────
// El admin elige qué fuentes incluir (obra, bitácora, materiales, asistencia),
// una o varias obras (o todas) y un rango de fechas; el backend
// (POST /reports/builder) devuelve métricas agregadas + series, y aquí las
// renderizamos como dashboard (recharts + tablas) con opción Imprimir/PDF.

type Section = "obra" | "bitacora" | "materiales" | "asistencia";

const SECTION_META: { key: Section; label: string; icon: string; color: string; desc: string }[] = [
  { key: "obra", label: "Obra / Avance / Presupuesto", icon: "📊", color: "#FF3C00", desc: "Estado, % avance, presupuesto vs gastado" },
  { key: "bitacora", label: "Bitácora", icon: "📋", color: "#3B82F6", desc: "Actividades diarias por obra y fecha" },
  { key: "materiales", label: "Materiales y notas", icon: "🏗️", color: "#8B5CF6", desc: "Gasto por proveedor, estatus y obra" },
  { key: "asistencia", label: "Asistencia / Geocheck", icon: "📍", color: "#10B981", desc: "Horas por trabajador, check-ins y obra" },
];

const GOLD = "#FF3C00";
const PALETTE = ["#FF3C00", "#3B82F6", "#10B981", "#8B5CF6", "#EF4444", "#F59E0B", "#06B6D4", "#EC4899", "#64748B", "#14B8A6"];
const STATUS_COLOR: Record<string, string> = { approved: "#10B981", pending: "#F59E0B", rejected: "#EF4444" };
const STATUS_LABEL: Record<string, string> = { approved: "Aprobado", pending: "Pendiente", rejected: "Rechazado", manual: "Manual", ok: "OK", flagged: "Marcado" };

const MXN = (v: number) => new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v ?? 0);
const fmtDay = (d: string) => { try { return format(new Date(d + "T12:00:00"), "dd MMM", { locale: es }); } catch { return d; } };

interface Props {
  authFetch: (path: string, opts?: RequestInit) => Promise<any>;
  projects: any[];
}

export function ReportBuilder({ authFetch, projects }: Props) {
  const [sections, setSections] = useState<Record<Section, boolean>>({ obra: true, bitacora: true, materiales: true, asistencia: true });
  const [projectMode, setProjectMode] = useState<"all" | "selected">("all");
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<any>(null);

  const toggleSection = (k: Section) => setSections((s) => ({ ...s, [k]: !s[k] }));
  const toggleProject = (id: number) =>
    setSelectedIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));

  const anySection = Object.values(sections).some(Boolean);
  const projectsOk = projectMode === "all" || selectedIds.length > 0;

  const generate = async () => {
    if (!anySection) { setError("Selecciona al menos una sección."); return; }
    if (!projectsOk) { setError("Elige al menos una obra o usa 'Todas las obras'."); return; }
    setLoading(true);
    setError(null);
    try {
      const config: Record<string, any> = { sections };
      if (projectMode === "selected") config.projectIds = selectedIds;
      if (dateFrom) config.dateFrom = dateFrom;
      if (dateTo) config.dateTo = dateTo;
      const data = await authFetch("/reports/builder", { method: "POST", body: JSON.stringify(config) });
      setResult(data);
    } catch (err: any) {
      setError(err?.message ?? "Error al generar el reporte");
      setResult(null);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      {/* Print styles: al imprimir solo se ve el contenedor del reporte */}
      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          #castores-builder-report, #castores-builder-report * { visibility: visible !important; }
          #castores-builder-report { position: absolute !important; left: 0; top: 0; width: 100%; }
          .no-print { display: none !important; }
          @page { margin: 12mm; size: A4; }
        }
      `}</style>

      {/* ─── Configuración ─── */}
      <div className="rounded-3xl p-6 space-y-5 no-print"
        style={{ background: "linear-gradient(135deg, #141414 0%, #262626 100%)", border: "1.5px solid rgba(255,60,0,0.2)" }}>
        <div>
          <h3 className="font-black text-white text-lg" style={{ fontFamily: "'Bebas Neue', sans-serif", letterSpacing: "0.04em" }}>
            Constructor inteligente
          </h3>
          <p className="text-xs" style={{ color: "rgba(255,255,255,0.4)" }}>
            Arma cualquier reporte: elige fuentes, obras y período.
          </p>
        </div>

        {/* Secciones */}
        <div>
          <label className="block text-xs font-semibold mb-2" style={{ color: "rgba(255,255,255,0.5)" }}>Secciones a incluir</label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {SECTION_META.map((m) => {
              const on = sections[m.key];
              return (
                <button key={m.key} type="button" onClick={() => toggleSection(m.key)}
                  className="flex items-center gap-3 p-3 rounded-xl text-left transition-all"
                  style={{ background: on ? `${m.color}18` : "rgba(255,255,255,0.04)", border: `1.5px solid ${on ? m.color + "55" : "rgba(255,255,255,0.08)"}` }}>
                  <span className="text-xl">{m.icon}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold" style={{ color: on ? m.color : "rgba(255,255,255,0.7)" }}>{m.label}</p>
                    <p className="text-[11px] truncate" style={{ color: "rgba(255,255,255,0.35)" }}>{m.desc}</p>
                  </div>
                  <div className="w-4 h-4 rounded-md border-2 flex items-center justify-center flex-shrink-0"
                    style={{ borderColor: on ? m.color : "rgba(255,255,255,0.25)", background: on ? m.color : "transparent" }}>
                    {on && (
                      <svg viewBox="0 0 24 24" fill="none" stroke="#141414" strokeWidth="3" className="w-3 h-3">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                      </svg>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Obras */}
        <div>
          <label className="block text-xs font-semibold mb-2" style={{ color: "rgba(255,255,255,0.5)" }}>Obras</label>
          <div className="flex gap-2 mb-2">
            {(["all", "selected"] as const).map((mode) => (
              <button key={mode} type="button" onClick={() => setProjectMode(mode)}
                className="flex-1 py-2 rounded-xl text-xs font-bold transition-all"
                style={{
                  background: projectMode === mode ? GOLD : "rgba(255,255,255,0.06)",
                  color: projectMode === mode ? "#141414" : "rgba(255,255,255,0.6)",
                  border: `1.5px solid ${projectMode === mode ? GOLD : "rgba(255,255,255,0.1)"}`,
                }}>
                {mode === "all" ? "Todas las obras" : "Elegir obras"}
              </button>
            ))}
          </div>
          {projectMode === "selected" && (
            <div className="max-h-44 overflow-y-auto rounded-xl p-2 space-y-1" style={{ background: "rgba(0,0,0,0.25)", border: "1px solid rgba(255,255,255,0.08)" }}>
              {projects.length === 0 ? (
                <p className="text-xs text-center py-3" style={{ color: "rgba(255,255,255,0.35)" }}>Sin obras disponibles</p>
              ) : projects.map((p: any) => {
                const on = selectedIds.includes(p.id);
                return (
                  <button key={p.id} type="button" onClick={() => toggleProject(p.id)}
                    className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-left transition-all"
                    style={{ background: on ? "rgba(255,60,0,0.18)" : "transparent" }}>
                    <div className="w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0"
                      style={{ borderColor: on ? GOLD : "rgba(255,255,255,0.25)", background: on ? GOLD : "transparent" }}>
                      {on && <svg viewBox="0 0 24 24" fill="none" stroke="#141414" strokeWidth="3" className="w-2.5 h-2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" /></svg>}
                    </div>
                    <span className="text-xs font-semibold truncate" style={{ color: on ? "white" : "rgba(255,255,255,0.6)" }}>{p.name}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Período */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold mb-1.5" style={{ color: "rgba(255,255,255,0.5)" }}>Fecha inicio</label>
            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl text-sm outline-none"
              style={{ background: "rgba(255,255,255,0.07)", border: "1.5px solid rgba(255,255,255,0.12)", color: "white" }} />
          </div>
          <div>
            <label className="block text-xs font-semibold mb-1.5" style={{ color: "rgba(255,255,255,0.5)" }}>Fecha fin</label>
            <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl text-sm outline-none"
              style={{ background: "rgba(255,255,255,0.07)", border: "1.5px solid rgba(255,255,255,0.12)", color: "white" }} />
          </div>
        </div>

        {error && <p className="text-xs font-semibold" style={{ color: "#FCA5A5" }}>{error}</p>}

        <button type="button" onClick={generate} disabled={loading}
          className="w-full py-3.5 rounded-2xl text-sm font-bold text-white disabled:opacity-50"
          style={{ background: `linear-gradient(135deg, ${GOLD}, ${GOLD}bb)` }}>
          {loading ? "Generando..." : "Generar reporte →"}
        </button>
      </div>

      {/* ─── Resultado ─── */}
      {result && <BuilderReport data={result} />}
    </>
  );
}

// ─── Vista del reporte (dashboard + tablas, imprimible) ────────────────────────
function BuilderReport({ data }: { data: any }) {
  const { meta, projects, obra, bitacora, materiales, asistencia } = data;

  return (
    <div className="mt-5 space-y-4">
      {/* Barra de acciones (no imprime) */}
      <div className="flex items-center justify-between no-print">
        <p className="text-sm font-bold" style={{ color: "rgba(20,20,20,0.55)" }}>
          {meta.projectCount} obra(s) · generado {format(new Date(meta.generatedAt), "dd/MM/yyyy HH:mm", { locale: es })}
        </p>
        <button onClick={() => window.print()}
          className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold text-white"
          style={{ background: GOLD }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6.72 13.829c-.24.03-.48.062-.72.096m.72-.096a42.415 42.415 0 0110.56 0m-10.56 0L6.34 18m10.94-4.171c.24.03.48.062.72.096m-.72-.096L17.66 18m0 0l.229 2.523a1.125 1.125 0 01-1.12 1.227H7.231c-.662 0-1.18-.568-1.12-1.227L6.34 18m11.318 0h1.091A2.25 2.25 0 0021 15.75V9.456c0-1.081-.768-2.015-1.837-2.175a48.055 48.055 0 00-1.913-.247M6.34 18H5.25A2.25 2.25 0 013 15.75V9.456c0-1.081.768-2.015 1.837-2.175a48.056 48.056 0 011.913-.247m10.5 0a48.536 48.536 0 00-10.5 0m10.5 0V3.375c0-.621-.504-1.125-1.125-1.125h-8.25c-.621 0-1.125.504-1.125 1.125v3.659M18 10.5h.008v.008H18V10.5zm-3 0h.008v.008H15V10.5z" />
          </svg>
          Imprimir / PDF
        </button>
      </div>

      {/* Contenedor imprimible */}
      <div id="castores-builder-report" className="bg-white rounded-2xl overflow-hidden" style={{ border: "1px solid rgba(0,0,0,0.08)" }}>
        {/* Header */}
        <div className="px-7 pt-7 pb-5" style={{ background: "linear-gradient(135deg, #141414 0%, #262626 100%)" }}>
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-xl overflow-hidden flex-shrink-0" style={{ background: "rgba(255,60,0,0.2)", border: "1px solid rgba(255,60,0,0.3)" }}>
                  <img src="/castores-logo.jpeg" alt="CASTORES" className="w-full h-full object-contain" />
                </div>
                <div>
                  <p className="text-white font-black text-sm" style={{ fontFamily: "'Bebas Neue', sans-serif", letterSpacing: "0.06em" }}>
                    CASTORES ESTRUCTURAS Y CONSTRUCCIONES
                  </p>
                  <p className="text-xs" style={{ color: "rgba(255,255,255,0.4)" }}>Reporte configurado · Panel administrativo</p>
                </div>
              </div>
              <h1 className="text-white font-black text-2xl" style={{ fontFamily: "'Bebas Neue', sans-serif", letterSpacing: "0.04em" }}>
                Reporte Inteligente
              </h1>
            </div>
            <div className="text-right">
              <p className="text-xs mb-1" style={{ color: "rgba(255,255,255,0.4)" }}>Generado por</p>
              <p className="text-white text-sm font-bold">{meta.generatedByName ?? "—"}</p>
              <p className="text-xs mt-1" style={{ color: "rgba(255,255,255,0.4)" }}>
                {format(new Date(meta.generatedAt), "dd 'de' MMMM yyyy", { locale: es })}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 mt-4">
            <Badge label={`${meta.projectCount} obra(s)`} />
            {(meta.dateFrom || meta.dateTo) && (
              <Badge label={`Período: ${meta.dateFrom ? fmtDay(meta.dateFrom) : "Inicio"} — ${meta.dateTo ? fmtDay(meta.dateTo) : "Hoy"}`} />
            )}
          </div>
        </div>

        <div className="px-7 py-6 space-y-9">
          {/* Obras incluidas */}
          {projects?.length > 0 && (
            <Section title={`OBRAS INCLUIDAS (${projects.length})`}>
              <div className="flex flex-wrap gap-2">
                {projects.map((p: any) => (
                  <span key={p.id} className="text-xs font-semibold px-3 py-1.5 rounded-lg" style={{ background: "#FAFAFA", border: "1px solid rgba(0,0,0,0.07)", color: "#141414" }}>
                    {p.name}
                  </span>
                ))}
              </div>
            </Section>
          )}

          {obra && <ObraSection obra={obra} />}
          {materiales && <MaterialesSection m={materiales} />}
          {bitacora && <BitacoraSection b={bitacora} />}
          {asistencia && <AsistenciaSection a={asistencia} />}
        </div>
      </div>
    </div>
  );
}

// ─── Bloques reutilizables ─────────────────────────────────────────────────────
function Badge({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center text-xs font-bold px-3 py-1.5 rounded-lg"
      style={{ background: "rgba(255,60,0,0.15)", border: "1px solid rgba(255,60,0,0.3)", color: GOLD }}>
      {label}
    </span>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="font-black text-base mb-3 pb-2 border-b" style={{ color: "#141414", fontFamily: "'Bebas Neue', sans-serif", letterSpacing: "0.04em", borderColor: "rgba(0,0,0,0.08)" }}>
        {title}
      </h2>
      {children}
    </section>
  );
}

function Kpi({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="rounded-xl p-3 flex-1 min-w-[120px]" style={{ background: "#FAFAFA", border: "1px solid rgba(0,0,0,0.06)" }}>
      <p className="text-[10px] font-bold uppercase tracking-wider mb-0.5" style={{ color: "rgba(20,20,20,0.4)" }}>{label}</p>
      <p className="text-base font-black" style={{ color: color ?? "#141414" }}>{value}</p>
    </div>
  );
}

function ChartBox({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl p-4 mt-4" style={{ background: "#FAFAFA", border: "1px solid rgba(0,0,0,0.06)" }}>
      <p className="text-xs font-bold mb-2" style={{ color: "rgba(20,20,20,0.55)" }}>{title}</p>
      <div style={{ width: "100%", height: 260 }}>{children}</div>
    </div>
  );
}

const axisProps = { tick: { fontSize: 11, fill: "rgba(20,20,20,0.6)" }, stroke: "rgba(0,0,0,0.15)" };

// ─── Sección Obra ──────────────────────────────────────────────────────────────
function ObraSection({ obra }: { obra: any }) {
  const t = obra.totals;
  const chartData = obra.byProject.map((p: any) => ({ name: p.name, Presupuesto: p.budget, Gastado: p.spent }));
  return (
    <Section title="OBRA · AVANCE Y PRESUPUESTO">
      <div className="flex flex-wrap gap-2">
        <Kpi label="Obras" value={`${t.projectCount}`} />
        <Kpi label="Activas" value={`${t.activeCount}`} color="#10B981" />
        <Kpi label="Terminadas" value={`${t.completedCount}`} color="#3B82F6" />
        <Kpi label="Avance prom." value={`${t.avgProgress}%`} color={GOLD} />
        <Kpi label="Presupuesto" value={MXN(t.totalBudget)} />
        <Kpi label="Gastado" value={MXN(t.totalSpent)} color="#EF4444" />
        <Kpi label="Disponible" value={MXN(t.available)} color="#10B981" />
      </div>
      {chartData.length > 0 && (
        <ChartBox title="Presupuesto vs. gastado por obra">
          <ResponsiveContainer>
            <BarChart data={chartData} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.06)" />
              <XAxis dataKey="name" {...axisProps} interval={0} angle={-15} textAnchor="end" height={50} />
              <YAxis {...axisProps} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
              <Tooltip formatter={(v: any) => MXN(Number(v))} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="Presupuesto" fill="#FF3C00" radius={[4, 4, 0, 0]} />
              <Bar dataKey="Gastado" fill="#EF4444" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartBox>
      )}
      <Table
        head={["Obra", "Estatus", "Avance", "Presupuesto", "Gastado", "Disponible"]}
        rows={obra.byProject.map((p: any) => [
          p.name, p.status, `${p.progressPercent}%`, MXN(p.budget), MXN(p.spent), MXN(p.available),
        ])}
      />
    </Section>
  );
}

// ─── Sección Materiales ──────────────────────────────────────────────────────
function MaterialesSection({ m }: { m: any }) {
  const pieData = m.byStatus.filter((s: any) => s.count > 0).map((s: any) => ({ name: s.label, value: s.count, status: s.status }));
  const supplierData = m.bySupplier.slice(0, 8).map((s: any) => ({ name: s.supplier, Gasto: s.spend }));
  return (
    <Section title={`MATERIALES (${m.totalItems} renglones · ${m.totalNotes} notas)`}>
      <div className="flex flex-wrap gap-2">
        <Kpi label="Gasto aprobado" value={MXN(m.spend.approved)} color="#10B981" />
        <Kpi label="Pendiente" value={MXN(m.spend.pending)} color="#F59E0B" />
        <Kpi label="Rechazado" value={MXN(m.spend.rejected)} color="#EF4444" />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-0 md:gap-4">
        {pieData.length > 0 && (
          <ChartBox title="Renglones por estatus">
            <ResponsiveContainer>
              <PieChart>
                <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90} label>
                  {pieData.map((d: any, i: number) => <Cell key={i} fill={STATUS_COLOR[d.status] ?? PALETTE[i % PALETTE.length]} />)}
                </Pie>
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 11 }} />
              </PieChart>
            </ResponsiveContainer>
          </ChartBox>
        )}
        {supplierData.length > 0 && (
          <ChartBox title="Gasto por proveedor (top 8)">
            <ResponsiveContainer>
              <BarChart data={supplierData} layout="vertical" margin={{ top: 4, right: 8, left: 8, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.06)" />
                <XAxis type="number" {...axisProps} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                <YAxis type="category" dataKey="name" {...axisProps} width={90} />
                <Tooltip formatter={(v: any) => MXN(Number(v))} />
                <Bar dataKey="Gasto" fill="#8B5CF6" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartBox>
        )}
      </div>
      <Table
        head={["Material", "Obra", "Cant.", "Unidad", "Estatus", "Costo"]}
        rows={m.items.slice(0, 60).map((it: any) => [
          it.name, it.projectName ?? "—", `${it.quantity}`, it.unit,
          STATUS_LABEL[it.status] ?? it.status, it.totalCost ? MXN(it.totalCost) : "—",
        ])}
      />
    </Section>
  );
}

// ─── Sección Bitácora ────────────────────────────────────────────────────────
function BitacoraSection({ b }: { b: any }) {
  const lineData = b.byDate.map((d: any) => ({ name: fmtDay(d.date), Entradas: d.count }));
  return (
    <Section title={`BITÁCORA (${b.totalLogs} entradas)`}>
      <div className="flex flex-wrap gap-2">
        <Kpi label="Entradas" value={`${b.totalLogs}`} color="#3B82F6" />
        <Kpi label="Firmadas" value={`${b.submittedLogs}`} color="#10B981" />
        <Kpi label="Obras con registro" value={`${b.byProject.length}`} />
      </div>
      {lineData.length > 0 && (
        <ChartBox title="Entradas por fecha">
          <ResponsiveContainer>
            <LineChart data={lineData} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.06)" />
              <XAxis dataKey="name" {...axisProps} />
              <YAxis {...axisProps} allowDecimals={false} />
              <Tooltip />
              <Line type="monotone" dataKey="Entradas" stroke="#3B82F6" strokeWidth={2} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </ChartBox>
      )}
      <Table
        head={["Fecha", "Obra", "Actividad", "Firmada"]}
        rows={b.entries.slice(0, 60).map((e: any) => [
          fmtDay(e.logDate), e.projectName ?? "—", e.activity, e.isSubmitted ? "Sí" : "No",
        ])}
      />
    </Section>
  );
}

// ─── Sección Asistencia ──────────────────────────────────────────────────────
function AsistenciaSection({ a }: { a: any }) {
  const workerData = a.byWorker.slice(0, 10).map((w: any) => ({ name: w.name, Horas: w.hours }));
  return (
    <Section title={`ASISTENCIA / GEOCHECK (${a.totalCheckIns} check-ins)`}>
      <div className="flex flex-wrap gap-2">
        <Kpi label="Check-ins" value={`${a.totalCheckIns}`} color="#10B981" />
        <Kpi label="Horas totales" value={`${a.totalHours} h`} color={GOLD} />
        <Kpi label="Sesiones abiertas" value={`${a.openSessions}`} color="#F59E0B" />
        <Kpi label="Marcados" value={`${a.flaggedCount}`} color="#EF4444" />
      </div>
      {workerData.length > 0 && (
        <ChartBox title="Horas por trabajador (top 10)">
          <ResponsiveContainer>
            <BarChart data={workerData} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.06)" />
              <XAxis dataKey="name" {...axisProps} interval={0} angle={-15} textAnchor="end" height={50} />
              <YAxis {...axisProps} />
              <Tooltip />
              <Bar dataKey="Horas" fill="#10B981" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartBox>
      )}
      <Table
        head={["Trabajador", "Check-ins", "Horas", "Marcados"]}
        rows={a.byWorker.slice(0, 40).map((w: any) => [w.name, `${w.checkIns}`, `${w.hours} h`, `${w.flagged}`])}
      />
    </Section>
  );
}

// ─── Tabla genérica ─────────────────────────────────────────────────────────
function Table({ head, rows }: { head: string[]; rows: (string | number)[][] }) {
  if (rows.length === 0) {
    return <p className="text-sm text-center py-6" style={{ color: "rgba(20,20,20,0.35)" }}>Sin datos en el período seleccionado</p>;
  }
  return (
    <div className="rounded-xl overflow-hidden mt-4" style={{ border: "1px solid rgba(0,0,0,0.08)" }}>
      <table className="w-full text-xs">
        <thead>
          <tr style={{ background: "#F4F4F5" }}>
            {head.map((h) => (
              <th key={h} className="px-3 py-2 text-left font-bold" style={{ color: "rgba(20,20,20,0.5)" }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y" style={{ background: "white" }}>
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((c, j) => (
                <td key={j} className="px-3 py-2" style={{ color: j === 0 ? "#141414" : "rgba(20,20,20,0.65)", fontWeight: j === 0 ? 600 : 400 }}>{c}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
