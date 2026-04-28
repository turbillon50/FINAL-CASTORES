import { useLocation } from "wouter";
import { motion } from "framer-motion";
import { useClerk } from "@clerk/react";

export default function CuentaRechazada() {
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
        <div className="w-20 h-20 rounded-3xl mx-auto mb-6 flex items-center justify-center"
          style={{ background: "rgba(239,68,68,0.10)", border: "2px solid rgba(239,68,68,0.20)" }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="#EF4444" strokeWidth="1.5" className="w-10 h-10">
            <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
          </svg>
        </div>

        <div className="bg-white rounded-3xl p-7 shadow-sm" style={{ border: "1px solid rgba(0,0,0,0.07)" }}>
          <h1 className="text-[#1a1612] font-black text-xl mb-2" style={{ fontFamily: "'Bebas Neue', sans-serif", letterSpacing: "0.04em" }}>
            Solicitud rechazada
          </h1>
          <p className="text-[#1a1612]/50 text-sm leading-relaxed mb-6">
            El administrador no aprobó tu solicitud de acceso. Si crees que esto es un error,
            comunícate directamente con CASTORES Estructuras y Construcciones.
          </p>

          <div className="rounded-2xl p-4 mb-5" style={{ background: "rgba(239,68,68,0.05)", border: "1px solid rgba(239,68,68,0.15)" }}>
            <p className="text-[#EF4444] text-xs font-semibold">¿Tienes dudas?</p>
            <p className="text-[#1a1612]/50 text-xs mt-1">
              Escríbenos a <span className="text-[#C8952A] font-medium">contacto@castores.mx</span> con tu nombre y empresa.
            </p>
          </div>

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
