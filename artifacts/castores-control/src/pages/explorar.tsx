import { useLocation } from "wouter";
import { motion } from "framer-motion";

const FEATURES = [
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className="w-6 h-6">
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
      </svg>
    ),
    title: "Bitácora Digital",
    desc: "Registra avances de obra con fotos, firmas digitales de supervisor y cliente, y trazabilidad completa.",
    color: "#C8952A",
  },
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className="w-6 h-6">
        <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" />
      </svg>
    ),
    title: "Control de Materiales",
    desc: "Solicitudes de material con flujo de aprobación, control de inventario y alertas automáticas.",
    color: "#3B82F6",
  },
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className="w-6 h-6">
        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
      </svg>
    ),
    title: "Gestión Documental",
    desc: "Planos, contratos, permisos y reportes centralizados con acceso por rol.",
    color: "#10B981",
  },
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className="w-6 h-6">
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
      </svg>
    ),
    title: "Reportes y Análisis",
    desc: "Avance por proyecto, costos de material, actividad del equipo y KPIs de construcción.",
    color: "#8B5CF6",
  },
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className="w-6 h-6">
        <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
      </svg>
    ),
    title: "Notificaciones en Tiempo Real",
    desc: "Alertas de firma pendiente, material agotado, documentos por vencer y mensajes del equipo.",
    color: "#EF4444",
  },
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className="w-6 h-6">
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
      </svg>
    ),
    title: "Gestión por Roles",
    desc: "Admin, supervisor, cliente, trabajador y proveedor — cada uno con su vista y permisos.",
    color: "#F59E0B",
  },
];

const ROLES_INFO = [
  { role: "Administrador", desc: "Control total del sistema, aprobación de usuarios y configuración.", color: "#C8952A", icon: "🏗️" },
  { role: "Supervisor", desc: "Gestión de obras en campo, firma de bitácoras y control de materiales.", color: "#3B82F6", icon: "👷" },
  { role: "Cliente", desc: "Seguimiento de avances, aprobación de bitácoras y acceso a reportes.", color: "#10B981", icon: "🏢" },
  { role: "Trabajador", desc: "Registro de actividades diarias y consulta de asignaciones.", color: "#EF4444", icon: "🔧" },
  { role: "Proveedor", desc: "Consulta de solicitudes de material y actualización de estatus de entrega.", color: "#8B5CF6", icon: "🚛" },
];

export default function Explorar() {
  const [, setLocation] = useLocation();

  return (
    <div className="min-h-screen bg-[#F7F5F2]">
      {/* Header */}
      <header className="sticky top-0 z-20 bg-[#F7F5F2]/90 backdrop-blur-md border-b border-black/[0.06]">
        <div className="max-w-5xl mx-auto px-5 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-white shadow flex items-center justify-center overflow-hidden">
              <img src="/castores-logo.jpeg" alt="CASTORES" className="h-6 w-auto object-contain" />
            </div>
            <span className="font-black text-[#1a1612] text-sm tracking-wide uppercase" style={{ fontFamily: "'Bebas Neue', sans-serif", letterSpacing: "0.08em" }}>
              Castores Control
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setLocation("/")}
              className="text-[#1a1612]/50 text-sm font-medium px-3 py-1.5 rounded-lg hover:bg-black/5 transition-colors"
            >
              Inicio
            </button>
            <button
              onClick={() => setLocation("/sign-up")}
              className="text-sm font-bold px-4 py-2 rounded-xl text-white transition-all hover:opacity-90"
              style={{ background: "#C8952A" }}
            >
              Registrarme
            </button>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="max-w-5xl mx-auto px-5 pt-14 pb-12 text-center">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }}>
          <p className="text-[#C8952A] text-xs font-bold uppercase tracking-[0.3em] mb-3">Sistema de Control Operacional</p>
          <h1
            className="text-[#1a1612] text-[clamp(2.5rem,7vw,4.5rem)] leading-[0.95] font-black uppercase mb-4"
            style={{ fontFamily: "'Bebas Neue', sans-serif" }}
          >
            La plataforma digital<br />para tu obra
          </h1>
          <p className="text-[#1a1612]/55 text-base max-w-xl mx-auto leading-relaxed">
            Bitácoras con firma digital, control de materiales, documentos y reportes —
            todo en un sistema diseñado para la construcción mexicana.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center mt-8">
            <button
              onClick={() => setLocation("/sign-up")}
              className="px-8 py-3 rounded-2xl font-bold text-white text-sm tracking-wide transition-all hover:opacity-90 active:scale-[0.98]"
              style={{ background: "linear-gradient(135deg, #C8952A, #a87520)" }}
            >
              Solicitar acceso gratis
            </button>
            <button
              onClick={() => setLocation("/")}
              className="px-8 py-3 rounded-2xl font-bold text-sm tracking-wide transition-all hover:bg-black/5"
              style={{ color: "#1a1612", border: "1px solid rgba(0,0,0,0.12)" }}
            >
              Ver modo demo
            </button>
          </div>
        </motion.div>
      </section>

      {/* Features grid */}
      <section className="max-w-5xl mx-auto px-5 pb-14">
        <h2 className="text-[#1a1612] font-black text-2xl mb-6 text-center" style={{ fontFamily: "'Bebas Neue', sans-serif", letterSpacing: "0.05em" }}>
          Todo lo que necesitas en obra
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {FEATURES.map((f, i) => (
            <motion.div
              key={f.title}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.07, duration: 0.5 }}
              className="bg-white rounded-2xl p-5"
              style={{ border: "1px solid rgba(0,0,0,0.07)", boxShadow: "0 1px 8px rgba(0,0,0,0.05)" }}
            >
              <div className="w-10 h-10 rounded-xl flex items-center justify-center mb-3" style={{ background: f.color + "12", color: f.color }}>
                {f.icon}
              </div>
              <h3 className="font-bold text-[#1a1612] text-sm mb-1">{f.title}</h3>
              <p className="text-[#1a1612]/50 text-xs leading-relaxed">{f.desc}</p>
            </motion.div>
          ))}
        </div>
      </section>

      {/* Roles section */}
      <section className="bg-[#1a1612] py-14">
        <div className="max-w-5xl mx-auto px-5">
          <h2 className="text-white font-black text-2xl mb-2 text-center" style={{ fontFamily: "'Bebas Neue', sans-serif", letterSpacing: "0.05em" }}>
            Un sistema para cada rol
          </h2>
          <p className="text-white/40 text-sm text-center mb-8">Cada usuario ve solo lo que necesita</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {ROLES_INFO.map((r) => (
              <div key={r.role} className="rounded-2xl p-4" style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)" }}>
                <div className="flex items-center gap-2.5 mb-2">
                  <span className="text-xl">{r.icon}</span>
                  <span className="font-bold text-white text-sm">{r.role}</span>
                </div>
                <p className="text-white/40 text-xs leading-relaxed">{r.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="max-w-5xl mx-auto px-5 py-14 text-center">
        <h2 className="text-[#1a1612] font-black text-2xl mb-3" style={{ fontFamily: "'Bebas Neue', sans-serif" }}>
          ¿Listo para digitalizar tu obra?
        </h2>
        <p className="text-[#1a1612]/45 text-sm mb-6">El administrador aprobará tu cuenta en menos de 24 horas.</p>
        <button
          onClick={() => setLocation("/sign-up")}
          className="px-10 py-3.5 rounded-2xl font-bold text-white text-sm tracking-wide transition-all hover:opacity-90"
          style={{ background: "#C8952A" }}
        >
          Solicitar acceso →
        </button>
        <p className="text-[#1a1612]/25 text-[10px] uppercase tracking-[0.2em] mt-8">
          © {new Date().getFullYear()} CASTORES Estructuras y Construcciones
        </p>
      </section>
    </div>
  );
}
