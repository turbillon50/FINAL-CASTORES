import { MainLayout } from "@/components/layout/main-layout";
import { CinematicProjectCard } from "@/components/ui/cinematic-project-card";
import { ActivityFeed } from "@/components/ui/activity-feed";
import { PageHero } from "@/components/ui/page-hero";
import { CommandStats } from "@/components/ui/command-stats";
import { BudgetChart } from "@/components/ui/budget-chart";
import { useGetDashboardSummary, useListProjects, useGetDashboardActivity, useGetMaterialAlerts } from "@workspace/api-client-react";
import { Link } from "wouter";
import { useAuth } from "@/lib/auth";
import { motion } from "framer-motion";

const HERO_IMAGES: Record<string, string> = {
  admin: "https://images.unsplash.com/photo-1504307651254-35680f356dfd?w=1400&q=80&fit=crop",
  supervisor: "https://images.unsplash.com/photo-1581092795360-fd1ca04f0952?w=1400&q=80&fit=crop",
  client: "https://images.unsplash.com/photo-1486325212027-8081e485255e?w=1400&q=80&fit=crop",
  worker: "https://images.unsplash.com/photo-1541888946425-d81bb19240f5?w=1400&q=80&fit=crop",
  proveedor: "https://images.unsplash.com/photo-1586528116311-ad8dd3c8310d?w=1400&q=80&fit=crop",
};

const ROLE_LABELS: Record<string, string> = {
  admin: "Centro de Mando",
  supervisor: "Panel de Supervisión",
  client: "Mi Portal",
  worker: "Mi Área de Trabajo",
  proveedor: "Portal de Suministros",
};

const ROLE_SUBTITLES: Record<string, string> = {
  admin: "Control total y absoluto sobre operaciones, presupuesto y personal",
  supervisor: "Gestión de obra, bitácora y solicitudes en tiempo real",
  client: "Avance de tus obras, reportes y documentación",
  worker: "Tus tareas asignadas, horarios y actividad del día",
  proveedor: "Solicitudes de materiales, entregas y catálogo de suministros",
};

const ROLE_COLORS: Record<string, string> = {
  admin: "#C8952A",
  supervisor: "#3B82F6",
  client: "#10B981",
  worker: "#EF4444",
  proveedor: "#8B5CF6",
};

export default function Dashboard() {
  const { user } = useAuth();
  const { data: summary } = useGetDashboardSummary();
  const { data: projects = [] } = useListProjects({ status: "active" });
  const { data: activities = [] } = useGetDashboardActivity({ limit: 6 });
  const { data: alerts = [] } = useGetMaterialAlerts();

  const role = user?.role ?? "worker";
  const roleColor = ROLE_COLORS[role];
  const fmt = (n: number) => new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0, notation: "compact" }).format(n);
  const budgetPct = summary?.totalBudget ? Math.round((summary.totalSpent / summary.totalBudget) * 100) : 0;

  const stats = [
    {
      label: "Obras Activas",
      value: summary?.activeProjects ?? 0,
      color: roleColor,
      subtext: "En ejecución",
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-5 h-5">
          <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 21h16.5M4.5 3h15M5.25 3v18m13.5-18v18M9 6.75h1.5m-1.5 3h1.5m-1.5 3h1.5m3-6H15m-1.5 3H15m-1.5 3H15M9 21v-3.375c0-.621.504-1.125 1.125-1.125h3.75c.621 0 1.125.504 1.125 1.125V21" />
        </svg>
      ),
    },
    {
      label: "Trabajadores",
      value: summary?.totalWorkers ?? 0,
      color: "#3B82F6",
      subtext: "En campo",
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-5 h-5">
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
        </svg>
      ),
    },
    {
      label: "Materiales Pend.",
      value: summary?.pendingMaterialRequests ?? 0,
      color: (summary?.pendingMaterialRequests ?? 0) > 0 ? "#F59E0B" : "#10B981",
      trend: (summary?.pendingMaterialRequests ?? 0) > 0 ? { value: 3, up: false } : undefined,
      subtext: "Por autorizar",
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-5 h-5">
          <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" />
        </svg>
      ),
    },
    {
      label: "Presupuesto Usado",
      value: budgetPct,
      suffix: "%",
      color: budgetPct > 90 ? "#EF4444" : "#C8952A",
      subtext: summary?.totalBudget ? fmt(summary.totalSpent) + " de " + fmt(summary.totalBudget) : "Sin datos",
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-5 h-5">
          <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75M15 10.5a3 3 0 11-6 0 3 3 0 016 0zm3 0h.008v.008H18V10.5zm-12 0h.008v.008H6V10.5z" />
        </svg>
      ),
    },
  ];

  return (
    <MainLayout>
      <div className="space-y-6 pb-4">
        {/* ─── HERO ─── */}
        <PageHero
          title={ROLE_LABELS[role]}
          subtitle={ROLE_SUBTITLES[role]}
          imageUrl={HERO_IMAGES[role]}
          accentColor={roleColor}
          badge={role === "admin" ? "Sistema Activo · CASTORES CONTROL" : undefined}
        >
          <p className="text-white/40 text-xs font-mono">
            {new Date().toLocaleDateString("es-MX", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}
          </p>
        </PageHero>

        {/* ─── ALERTS ─── */}
        {alerts.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-start gap-4 p-4 rounded-2xl"
            style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.25)" }}
          >
            <div className="p-2 rounded-xl shrink-0" style={{ background: "rgba(239,68,68,0.15)" }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="#EF4444" strokeWidth="2" className="w-5 h-5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
              </svg>
            </div>
            <div className="flex-1">
              <h3 className="font-bold text-sm mb-1" style={{ color: "#EF4444" }}>
                {alerts.length} {alerts.length === 1 ? "Alerta Crítica" : "Alertas Críticas"} de Materiales
              </h3>
              <div className="space-y-1">
                {alerts.slice(0, 2).map((a, i) => (
                  <p key={i} className="text-xs text-foreground/60">
                    <span className="font-semibold text-foreground/80">{a.projectName}:</span> {a.message}
                  </p>
                ))}
              </div>
            </div>
            <Link href="/materiales"
              className="shrink-0 px-4 py-2 rounded-xl text-xs font-bold transition-all"
              style={{ background: "rgba(239,68,68,0.15)", color: "#EF4444", border: "1px solid rgba(239,68,68,0.3)" }}>
              Revisar
            </Link>
          </motion.div>
        )}

        {/* ─── COMMAND STATS ─── */}
        <CommandStats stats={stats} />

        {/* ─── MAIN GRID ─── */}
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          {/* Left: Projects + Budget */}
          <div className="xl:col-span-2 space-y-6">
            {/* Section header */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-1 h-6 rounded-full" style={{ background: roleColor }} />
                <h2 className="font-display text-2xl text-foreground tracking-wide">Obras Activas</h2>
              </div>
              <Link href="/projects" className="text-xs font-bold uppercase tracking-wider flex items-center gap-1 transition-all hover:opacity-70"
                style={{ color: roleColor }}>
                Ver todas
                <svg viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
                  <path fillRule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" clipRule="evenodd" />
                </svg>
              </Link>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              {projects.slice(0, 4).map((project, index) => (
                <CinematicProjectCard key={project.id} project={project} index={index} />
              ))}
              {projects.length === 0 && (
                <div className="col-span-full py-14 text-center rounded-2xl border border-dashed border-foreground/10">
                  <p className="text-muted-foreground text-sm">No hay obras activas en este momento.</p>
                </div>
              )}
            </div>

            {/* Budget chart — admin only */}
            {role === "admin" && projects.length > 0 && (
              <BudgetChart
                projects={projects.map((project) => ({
                  name: project.name,
                  budget: project.budget ?? null,
                  spentAmount: project.spentAmount ?? null,
                  progressPercent: project.progressPercent ?? null,
                  status: project.status ?? "active",
                }))}
              />
            )}

            {/* Map placeholder */}
            {(role === "admin" || role === "supervisor") && (
              <div className="relative rounded-2xl overflow-hidden" style={{ height: 220, border: "1px solid rgba(0,0,0,0.07)" }}>
                <img
                  src="https://images.unsplash.com/photo-1477959858617-67f85cf4f1df?w=1200&q=70&fit=crop"
                  alt="Mapa de obras"
                  className="absolute inset-0 w-full h-full object-cover"
                  style={{ filter: "saturate(0.6) brightness(0.9)" }}
                />
                <div className="absolute inset-0" style={{ background: "linear-gradient(135deg,rgba(200,149,42,0.15),rgba(0,0,0,0.55))" }} />

                {/* Fake pins */}
                {[
                  { top: "30%", left: "25%", label: "CDMX Norte" },
                  { top: "55%", left: "60%", label: "Polanco" },
                  { top: "40%", left: "70%", label: "Santa Fe" },
                ].map((pin) => (
                  <div key={pin.label} className="absolute flex flex-col items-center gap-1" style={{ top: pin.top, left: pin.left }}>
                    <div className="w-3 h-3 rounded-full border-2 border-white animate-pulse"
                      style={{ background: "#C8952A", boxShadow: "0 0 8px #C8952A" }} />
                    <span className="text-[9px] font-bold text-white px-1.5 py-0.5 rounded"
                      style={{ background: "rgba(0,0,0,0.55)", backdropFilter: "blur(4px)" }}>
                      {pin.label}
                    </span>
                  </div>
                ))}

                <div className="absolute bottom-0 left-0 right-0 p-4 flex items-end justify-between">
                  <div>
                    <p className="text-white font-display text-xl tracking-wide">Vista de Ubicaciones</p>
                    <p className="text-white/50 text-xs">{projects.length} obras activas georreferenciadas</p>
                  </div>
                  <span className="text-[10px] px-2.5 py-1 rounded-full font-bold"
                    style={{ background: "rgba(200,149,42,0.25)", border: "1px solid rgba(200,149,42,0.5)", color: "#C8952A" }}>
                    Mapa Interactivo
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Right: Activity + Quick actions */}
          <div className="space-y-5">
            {/* Quick actions — admin only */}
            {role === "admin" && (
              <div className="rounded-2xl p-5" style={{ background: "#fff", border: "1px solid rgba(0,0,0,0.07)", boxShadow: "0 2px 12px rgba(0,0,0,0.04)" }}>
                <h3 className="font-display text-lg text-foreground tracking-wide mb-4">Acciones de Control</h3>
                <div className="space-y-2">
                  {[
                    { label: "Aprobar materiales pendientes", href: "/materiales", color: "#F59E0B", count: summary?.pendingMaterialRequests },
                    { label: "Revisar bitácora de obras", href: "/bitacora", color: "#3B82F6" },
                    { label: "Generar reporte semanal", href: "/reportes", color: "#10B981" },
                    { label: "Gestionar equipo de trabajo", href: "/usuarios", color: "#C8952A" },
                  ].map((a) => (
                    <Link key={a.href} href={a.href}>
                      <div className="flex items-center gap-3 px-3 py-3 rounded-xl cursor-pointer transition-all hover:bg-foreground/[0.03] group">
                        <div className="w-2 h-2 rounded-full shrink-0" style={{ background: a.color }} />
                        <span className="text-sm text-foreground/70 group-hover:text-foreground/90 flex-1 transition-colors">{a.label}</span>
                        {a.count != null && a.count > 0 && (
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                            style={{ background: `${a.color}20`, color: a.color }}>
                            {a.count}
                          </span>
                        )}
                        <svg viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5 text-foreground/20 group-hover:text-foreground/40 transition-colors shrink-0">
                          <path fillRule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" clipRule="evenodd" />
                        </svg>
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {/* Activity feed */}
            <div className="rounded-2xl p-5" style={{ background: "#fff", border: "1px solid rgba(0,0,0,0.07)", boxShadow: "0 2px 12px rgba(0,0,0,0.04)" }}>
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-display text-lg text-foreground tracking-wide">Actividad Reciente</h3>
                <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" title="En vivo" />
              </div>
              <ActivityFeed activities={activities} />
            </div>
          </div>
        </div>
      </div>
    </MainLayout>
  );
}
