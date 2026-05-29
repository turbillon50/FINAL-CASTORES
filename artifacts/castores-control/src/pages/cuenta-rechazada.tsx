import { useLocation } from "wouter";
import { motion } from "framer-motion";
import { useClerk, useUser } from "@clerk/react";

const SUPPORT_EMAIL = "contacto@castores.mx";

export default function CuentaRechazada() {
  const [, setLocation] = useLocation();
  const { signOut } = useClerk();
  const { user } = useUser();

  const userEmail =
    user?.primaryEmailAddress?.emailAddress ??
    user?.emailAddresses?.[0]?.emailAddress ??
    "";
  const userName = user?.fullName ?? "";

  const handleSignOut = async () => {
    localStorage.removeItem("castores_demo_user");
    localStorage.removeItem("castores_real_user");
    await signOut();
    window.location.href = `${import.meta.env.BASE_URL}`;
  };

  const buildMailto = () => {
    const subject = encodeURIComponent("Solicitud de revisión de acceso — Castores Control");
    const body = encodeURIComponent(
      `Hola equipo de CASTORES,\n\n` +
        `Mi solicitud para acceder a Castores Control fue rechazada y me gustaría pedir una revisión.\n\n` +
        `Datos de mi cuenta:\n` +
        `• Nombre: ${userName || "(escribir)"}\n` +
        `• Correo: ${userEmail || "(escribir)"}\n` +
        `• Empresa / rol esperado: \n\n` +
        `Motivo por el que considero que debo tener acceso:\n\n` +
        `Gracias.\n`,
    );
    return `mailto:${SUPPORT_EMAIL}?subject=${subject}&body=${body}`;
  };

  return (
    <div
      className="min-h-screen bg-[#FAFAFA] flex flex-col items-center justify-center px-4"
      style={{ paddingTop: "max(env(safe-area-inset-top), 16px)", paddingBottom: "max(env(safe-area-inset-bottom), 16px)" }}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="w-full max-w-sm text-center"
      >
        <div
          className="w-20 h-20 rounded-3xl mx-auto mb-6 flex items-center justify-center"
          style={{ background: "rgba(239,68,68,0.10)", border: "2px solid rgba(239,68,68,0.20)" }}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="#EF4444" strokeWidth="1.5" className="w-10 h-10">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636"
            />
          </svg>
        </div>

        <div className="bg-white rounded-3xl p-7 shadow-sm" style={{ border: "1px solid rgba(0,0,0,0.07)" }}>
          <h1
            className="text-[#141414] font-black text-xl mb-2"
            style={{ fontFamily: "'Bebas Neue', sans-serif", letterSpacing: "0.04em" }}
          >
            Solicitud rechazada
          </h1>
          <p className="text-[#141414]/55 text-sm leading-relaxed mb-6">
            El administrador no aprobó tu solicitud de acceso. Si crees que esto fue un error puedes pedir una revisión —
            te abrimos un correo con tus datos prellenados.
          </p>

          <a
            href={buildMailto()}
            className="block w-full py-3 rounded-xl text-sm font-bold mb-3 transition-transform active:scale-[0.98]"
            style={{ background: "#FF3C00", color: "#fff", boxShadow: "0 4px 14px rgba(255,60,0,0.35)" }}
          >
            Solicitar revisión por correo
          </a>

          <div
            className="rounded-2xl p-3 mb-5 text-left"
            style={{ background: "rgba(0,0,0,0.03)", border: "1px solid rgba(0,0,0,0.06)" }}
          >
            <p className="text-[10px] uppercase tracking-wider text-[#141414]/45 font-bold mb-1">¿Prefieres escribirnos directo?</p>
            <a
              href={`mailto:${SUPPORT_EMAIL}`}
              className="text-[#FF3C00] text-sm font-semibold break-all"
            >
              {SUPPORT_EMAIL}
            </a>
          </div>

          <button
            onClick={() => setLocation("/")}
            className="w-full py-2.5 rounded-xl text-sm font-semibold mb-2 transition-all hover:bg-black/5"
            style={{ color: "#141414", border: "1px solid rgba(0,0,0,0.12)" }}
          >
            Intentar con otra cuenta
          </button>
          <button
            onClick={handleSignOut}
            className="w-full py-2.5 rounded-xl text-sm font-semibold transition-all text-[#141414]/55 hover:text-[#141414]"
          >
            Cerrar sesión
          </button>
        </div>

        <p className="text-[#141414]/20 text-[10px] uppercase tracking-[0.2em] mt-6">
          © {new Date().getFullYear()} CASTORES Estructuras y Construcciones
        </p>
      </motion.div>
    </div>
  );
}
