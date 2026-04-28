import { useLocation } from "wouter";
import { motion } from "framer-motion";
import { useClerk } from "@clerk/react";

export default function PendingApproval() {
  const [, setLocation] = useLocation();
  const { signOut } = useClerk();

  const handleSignOut = async () => {
    localStorage.removeItem("castores_demo_user");
    localStorage.removeItem("castores_real_user");
    await signOut();
    window.location.href = `${import.meta.env.BASE_URL}`;
  };

  return (
    <div className="min-h-screen bg-[#F7F5F2] flex flex-col items-center justify-center px-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="w-full max-w-sm text-center"
      >
        {/* Clock icon */}
        <div className="w-20 h-20 rounded-3xl mx-auto mb-6 flex items-center justify-center"
          style={{ background: "rgba(200,149,42,0.10)", border: "2px solid rgba(200,149,42,0.20)" }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="#C8952A" strokeWidth="1.5" className="w-10 h-10">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>

        <div className="bg-white rounded-3xl p-7 shadow-sm" style={{ border: "1px solid rgba(0,0,0,0.07)" }}>
          <h1 className="text-[#1a1612] font-black text-xl mb-2" style={{ fontFamily: "'Bebas Neue', sans-serif", letterSpacing: "0.04em" }}>
            Solicitud en revisión
          </h1>
          <p className="text-[#1a1612]/50 text-sm leading-relaxed mb-6">
            Tu solicitud de acceso fue enviada correctamente. El administrador de
            <strong className="text-[#C8952A]"> CASTORES</strong> la revisará y recibirás
            una notificación por email cuando sea aprobada.
          </p>

          <div className="space-y-2 mb-6">
            {[
              { step: "1", text: "Registro completado", done: true },
              { step: "2", text: "Revisión por administrador", done: false, current: true },
              { step: "3", text: "Acceso aprobado", done: false },
            ].map((s) => (
              <div key={s.step} className="flex items-center gap-3 p-2.5 rounded-xl"
                style={{ background: s.current ? "rgba(200,149,42,0.06)" : "transparent" }}>
                <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
                  style={{
                    background: s.done ? "#C8952A" : s.current ? "rgba(200,149,42,0.15)" : "rgba(0,0,0,0.06)",
                    color: s.done ? "white" : s.current ? "#C8952A" : "rgba(0,0,0,0.3)",
                  }}>
                  {s.done ? "✓" : s.step}
                </div>
                <span className="text-xs font-medium" style={{ color: s.current ? "#C8952A" : s.done ? "#1a1612" : "rgba(0,0,0,0.35)" }}>
                  {s.text}
                </span>
                {s.current && (
                  <span className="ml-auto text-[10px] font-bold text-[#C8952A] uppercase tracking-wider">En curso</span>
                )}
              </div>
            ))}
          </div>

          <p className="text-[#1a1612]/30 text-[11px] mb-4">
            Tiempo estimado: menos de 24 horas hábiles
          </p>

          <button
            onClick={handleSignOut}
            className="w-full py-2.5 rounded-xl text-sm font-semibold transition-all hover:bg-black/5"
            style={{ color: "#1a1612", border: "1px solid rgba(0,0,0,0.1)" }}
          >
            Cerrar sesión
          </button>
        </div>

        <p className="text-[#1a1612]/20 text-[10px] uppercase tracking-[0.2em] mt-6">
          © {new Date().getFullYear()} CASTORES Estructuras y Construcciones
        </p>
      </motion.div>
    </div>
  );
}
