import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { useUser, useClerk } from "@clerk/react";
import { useAuth } from "@/lib/auth";

export default function Login() {
  const [, setLocation] = useLocation();
  const { isLoaded, isSignedIn, user: clerkUser } = useUser();
  const { signOut } = useClerk();
  const { user: authUser, clearDemoUser } = useAuth();
  const [installPrompt, setInstallPrompt] = useState<any>(null);
  const [installed, setInstalled] = useState(false);
  const [showAccountChoice, setShowAccountChoice] = useState(false);
  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  // True if the user explicitly clicked "Cerrar sesión" — prevents auto-redirect
  // back to dashboard while Clerk's session cookie is still being invalidated
  const justSignedOut = typeof window !== "undefined"
    ? sessionStorage.getItem("castores_signed_out") === "1"
    : false;

  // Detect invite code from URL query param.
  // Also fall back to localStorage when the server-side /api/invite/:code handler
  // set the code there and then redirected here — in that case the URL includes a
  // cache-buster "_t" param even if iOS dropped "?code=" when launching the PWA.
  const _urlParams = typeof window !== "undefined"
    ? new URLSearchParams(window.location.search) : null;
  const hasInviteCode = !!(_urlParams?.has("code") ||
    (_urlParams?.has("_t") && !!localStorage.getItem("castores_invite_code")));

  // Capture invite code from URL (or localStorage fallback for iOS PWA)
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const urlCode = params.get("code");
    // Use localStorage fallback only when arriving from server redirect (has _t)
    const storedCode = params.has("_t") ? localStorage.getItem("castores_invite_code") : null;
    const code = urlCode?.toUpperCase() ?? storedCode?.toUpperCase() ?? null;
    if (code) {
      localStorage.setItem("castores_invite_code", code);
      setInviteCode(code);
    }
  }, []);

  // Once Clerk loads, decide what to do
  useEffect(() => {
    if (!isLoaded) return;

    // After an explicit logout we stay on the login page regardless of Clerk state.
    // Clear the flag so a normal revisit later works correctly.
    if (justSignedOut) {
      sessionStorage.removeItem("castores_signed_out");
      // If Clerk cookie is still alive, sign out again silently
      if (isSignedIn) signOut().catch(() => {});
      return;
    }

    if (hasInviteCode) {
      if (isSignedIn) {
        // Already signed in — show choice screen
        setShowAccountChoice(true);
      } else {
        setLocation(`${import.meta.env.BASE_URL}sign-up`);
      }
    } else {
      if (isSignedIn) setLocation("/dashboard");
    }
  }, [isLoaded, isSignedIn, hasInviteCode, setLocation]);

  // NOTE: Auto-redirect to dashboard is handled exclusively by Clerk's isSignedIn.
  // We do NOT use authUser/localStorage for routing to prevent stale demo data
  // from bypassing the real authentication gate.

  const handleRegisterNew = async () => {
    setSigningOut(true);
    await signOut();
    setLocation("/sign-up");
  };

  const handleContinue = () => {
    localStorage.removeItem("castores_invite_code");
    setLocation(`${import.meta.env.BASE_URL}dashboard`);
  };

  // PWA install prompt — must be declared BEFORE any conditional return
  // so the hook count stays stable between renders.
  useEffect(() => {
    const handler = (e: Event) => { e.preventDefault(); setInstallPrompt(e); };
    window.addEventListener("beforeinstallprompt", handler);
    window.addEventListener("appinstalled", () => setInstalled(true));
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  // ── Account choice screen ────────────────────────────────────────────
  if (showAccountChoice && inviteCode) {
    const email = clerkUser?.primaryEmailAddress?.emailAddress ?? "";
    return (
      <div className="min-h-[100dvh] flex items-center justify-center bg-[#F7F5F2] p-6">
        <div className="w-full max-w-sm bg-white rounded-3xl shadow-xl overflow-hidden">
          <div className="bg-[#1a1612] px-8 py-6 text-center">
            <div className="text-3xl mb-2">🔑</div>
            <h1 className="text-white font-bold text-lg">Invitación recibida</h1>
            <p className="text-white/50 text-sm mt-1">Código: <span className="text-[#C8952A] font-mono font-bold">{inviteCode}</span></p>
          </div>
          <div className="px-8 py-6 space-y-4">
            <p className="text-sm text-gray-600 text-center">
              Ya tienes una sesión activa. ¿Qué quieres hacer?
            </p>

            <button
              onClick={handleRegisterNew}
              disabled={signingOut}
              className="w-full bg-[#C8952A] text-white font-bold py-4 rounded-2xl text-sm tracking-wide disabled:opacity-60"
            >
              {signingOut ? "Cerrando sesión..." : "Registrar con otro correo"}
            </button>

            <div className="text-center text-xs text-gray-400">— o —</div>

            {email && (
              <div className="bg-gray-50 rounded-2xl px-4 py-3 text-center">
                <p className="text-xs text-gray-400 mb-1">Sesión actual</p>
                <p className="font-semibold text-sm text-gray-800 truncate">{email}</p>
              </div>
            )}

            <button
              onClick={handleContinue}
              className="w-full border border-gray-200 text-gray-600 font-semibold py-3 rounded-2xl text-sm"
            >
              Continuar como esta cuenta
            </button>
          </div>
        </div>
      </div>
    );
  }

  const handleInstall = async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    const { outcome } = await installPrompt.userChoice;
    if (outcome === "accepted") setInstalled(true);
    setInstallPrompt(null);
  };

  return (
    <div className="min-h-[100dvh] w-full flex flex-col md:flex-row overflow-hidden bg-[#F7F5F2]">

      {/* ── HERO FOTO ─────────────────────────────────── */}
      <div className="relative w-full md:w-[55%] h-[45vh] md:h-screen overflow-hidden shrink-0">
        <img
          src="https://images.unsplash.com/photo-1504307651254-35680f356dfd?w=1200&q=85&fit=crop&crop=center"
          alt="Obra de construcción CASTORES"
          className="absolute inset-0 w-full h-full object-cover"
          style={{ objectPosition: "center 30%" }}
        />
        <div className="absolute inset-0 bg-gradient-to-b md:bg-gradient-to-r from-black/5 via-black/25 to-black/75" />
        <div className="hidden md:block absolute inset-y-0 right-0 w-24 bg-gradient-to-r from-transparent to-[#F7F5F2]" />
        <div className="md:hidden absolute bottom-0 inset-x-0 h-24 bg-gradient-to-b from-transparent to-[#F7F5F2]" />

        {/* Logo */}
        <div className="absolute top-5 left-5 flex items-center gap-2.5">
          <div className="w-10 h-10 rounded-xl bg-white/95 shadow-lg flex items-center justify-center overflow-hidden">
            <img src={`${import.meta.env.BASE_URL}castores-logo.jpeg`} alt="CASTORES" className="h-8 w-auto object-contain" />
          </div>
          <div>
            <p className="text-white font-bold text-sm leading-tight tracking-wide drop-shadow">CASTORES</p>
            <p className="text-white/55 text-[9px] uppercase tracking-widest leading-tight">Estructuras y Construcciones</p>
          </div>
        </div>

        {/* Headline */}
        <div className="absolute bottom-0 left-0 p-6 md:p-10 pb-10 md:pb-14">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1, duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
          >
            <p className="text-white/45 text-[10px] uppercase tracking-[0.3em] font-medium mb-2">
              Sistema de Control Operacional
            </p>
            <h1
              className="text-white text-[clamp(2.8rem,8vw,5rem)] leading-[0.9] font-black uppercase tracking-wide"
              style={{ fontFamily: "'Bebas Neue', sans-serif", textShadow: "0 2px 20px rgba(0,0,0,0.5)" }}
            >
              Castores<br />Control
            </h1>
          </motion.div>
        </div>
      </div>

      {/* ── PANEL DERECHO ─────────────────────────────── */}
      <div className="flex-1 flex flex-col justify-center px-6 py-10 md:py-0 md:px-12">
        <motion.div
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.2, duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
          className="w-full max-w-sm mx-auto md:mx-0"
        >
          {/* Título */}
          <div className="mb-8">
            <h2
              className="text-[#1a1612] text-3xl font-black leading-tight tracking-tight"
              style={{ fontFamily: "'Bebas Neue', sans-serif", letterSpacing: "0.04em" }}
            >
              Bienvenido
            </h2>
            <p className="text-[#1a1612]/40 text-sm mt-1">
              Plataforma de gestión de construcción y proyectos
            </p>
          </div>

          {/* Botones principales */}
          <div className="space-y-3">
            <motion.button
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.32 }}
              whileHover={{ y: -2 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => {
                clearDemoUser();
                setLocation("/sign-in");
              }}
              className="w-full flex items-center justify-center gap-2.5 py-3.5 px-5 rounded-2xl text-sm font-bold"
              style={{
                background: "linear-gradient(135deg, #C8952A, #E8A830)",
                color: "white",
                boxShadow: "0 4px 20px rgba(200,149,42,0.35)",
              }}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="w-4 h-4">
                <path d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
              </svg>
              Iniciar sesión
            </motion.button>

            <motion.button
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4 }}
              whileHover={{ y: -2 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => {
                clearDemoUser();
                setLocation("/sign-up");
              }}
              className="w-full flex items-center justify-center gap-2.5 py-3.5 px-5 rounded-2xl text-sm font-bold"
              style={{
                background: "white",
                color: "#1a1612",
                border: "1.5px solid rgba(0,0,0,0.1)",
                boxShadow: "0 1px 8px rgba(0,0,0,0.06)",
              }}
            >
              Solicitar acceso al sistema →
            </motion.button>
          </div>

          {/* Separador con info */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.5 }}
            className="mt-8 p-4 rounded-2xl"
            style={{ background: "rgba(200,149,42,0.06)", border: "1px solid rgba(200,149,42,0.15)" }}
          >
            <p className="text-xs font-semibold mb-2" style={{ color: "#C8952A" }}>
              🔑 ¿Tienes una clave de invitación?
            </p>
            <p className="text-[11px] leading-relaxed" style={{ color: "rgba(26,22,18,0.5)" }}>
              Si un administrador te compartió una clave, regístrate con el botón de arriba e ingrésala en el formulario para obtener acceso inmediato.
            </p>
          </motion.div>

          {/* PWA install */}
          <AnimatePresence>
            {installPrompt && !installed && (
              <motion.button
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 8 }}
                transition={{ delay: 0.65 }}
                onClick={handleInstall}
                className="mt-4 w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl text-xs font-semibold transition-all"
                style={{
                  background: "rgba(200,149,42,0.06)",
                  border: "1px solid rgba(200,149,42,0.2)",
                  color: "#C8952A",
                }}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
                </svg>
                Instalar app en este dispositivo
              </motion.button>
            )}
            {installed && (
              <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                className="mt-4 text-center text-xs text-emerald-700 tracking-wider">
                ✓ App instalada correctamente
              </motion.p>
            )}
          </AnimatePresence>

          <p className="text-[#1a1612]/20 text-[10px] tracking-[0.2em] uppercase mt-8">
            © {new Date().getFullYear()} CASTORES Estructuras y Construcciones
          </p>
        </motion.div>
      </div>
    </div>
  );
}
