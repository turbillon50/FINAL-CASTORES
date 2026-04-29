import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { useUser, useAuth as useClerkAuth } from "@clerk/react";
import { useToast } from "@/hooks/use-toast";
import { apiUrl } from "@/lib/api-url";

const ROLE_LABELS: Record<string, string> = {
  admin: "Administrador",
  supervisor: "Supervisor de Obra",
  client: "Cliente / Contratante",
  worker: "Trabajador / Operario",
  proveedor: "Proveedor",
};

const ROLE_ICONS: Record<string, string> = {
  admin: "🛡️", supervisor: "👷", client: "🏢", worker: "🔧", proveedor: "🚛",
};

const ROLE_COLORS: Record<string, string> = {
  admin: "#C8952A", supervisor: "#3B82F6", client: "#10B981", worker: "#EF4444", proveedor: "#8B5CF6",
};

type CodeState =
  | { status: "checking" }
  | { status: "valid"; role: string; label: string; code: string }
  | { status: "invalid"; code: string }
  | { status: "no_code" };

export default function CompleteProfile() {
  const { user, isLoaded: clerkLoaded, isSignedIn } = useUser();
  const { getToken } = useClerkAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const [codeState, setCodeState] = useState<CodeState>({ status: "checking" });
  const [name, setName] = useState(user?.fullName || "");
  const [company, setCompany] = useState("");
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(false);
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [codeInput, setCodeInput] = useState("");
  const [validatingCode, setValidatingCode] = useState(false);

  // SECURITY: This page requires a verified Clerk session. If Clerk isn't
  // loaded yet, wait. If the user isn't signed in, redirect them to the
  // Clerk sign-up flow (preserving their invite code) so email verification
  // happens BEFORE any account is created in our database.
  useEffect(() => {
    if (!clerkLoaded) return;
    if (!isSignedIn) {
      const code = localStorage.getItem("castores_invite_code");
      const target = code
        ? `/sign-up?code=${encodeURIComponent(code)}`
        : `/sign-up`;
      setLocation(target);
    }
  }, [clerkLoaded, isSignedIn, setLocation]);

  const validateCode = async (raw: string) => {
    const code = raw.trim().toUpperCase();
    if (!code) {
      toast({ title: "Escribe una clave de invitación", variant: "destructive" });
      return;
    }
    setValidatingCode(true);
    try {
      const res = await fetch(apiUrl(`/api/invitations/validate`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const data = await res.json();
      if (data.valid && data.role) {
        localStorage.setItem("castores_invite_code", code);
        setCodeState({ status: "valid", role: data.role, label: data.label ?? code, code });
      } else {
        toast({
          title: "Clave inválida",
          description: data.reason || "Verifica la clave y vuelve a intentar",
          variant: "destructive",
        });
      }
    } catch {
      toast({ title: "Error de conexión", variant: "destructive" });
    } finally {
      setValidatingCode(false);
    }
  };

  // On mount: validate saved invite code.
  // Prioridad de fuentes: (1) ?code= en URL  (2) localStorage  — la URL gana
  // porque sobrevive a sesiones nuevas o a navegadores donde se borró el storage.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const urlCode = params.get("code")?.trim().toUpperCase() || null;
    const storedCode = localStorage.getItem("castores_invite_code");
    const code = urlCode || storedCode;

    if (urlCode) {
      // Sincroniza el storage con lo que venga en la URL para que sobreviva
      // a un refresh aunque la URL pierda el query (PWA, redirects, etc.).
      localStorage.setItem("castores_invite_code", urlCode);
    }

    if (!code) {
      setCodeState({ status: "no_code" });
      return;
    }

    fetch(apiUrl(`/api/invitations/validate`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.valid && data.role) {
          setCodeState({ status: "valid", role: data.role, label: data.label ?? code, code });
        } else {
          setCodeState({ status: "invalid", code });
        }
      })
      .catch(() => setCodeState({ status: "invalid", code: code ?? "" }));
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (codeState.status !== "valid") return;
    if (!name.trim()) { toast({ title: "Ingresa tu nombre completo", variant: "destructive" }); return; }
    if (!acceptedTerms) { toast({ title: "Debes aceptar los términos de uso", variant: "destructive" }); return; }

    setLoading(true);
    try {
      const token = await getToken();
      if (!token) {
        throw new Error("Sesión de acceso no válida. Vuelve a iniciar registro.");
      }
      const res = await fetch(apiUrl(`/api/auth/clerk-register`), {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          name: name.trim(),
          email: user?.primaryEmailAddress?.emailAddress || "",
          role: codeState.role,
          company: company.trim() || undefined,
          phone: phone.trim() || undefined,
          clerkId: user?.id || undefined,
          invitationCode: codeState.code,
          acceptTerms: true,
          termsVersion: "1.0",
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Error al registrar");
      }

      localStorage.removeItem("castores_invite_code");
      const userData = await res.json();

      if (userData.approvalStatus === "approved") {
        setLocation("/dashboard");
      } else {
        setLocation("/pending-approval");
      }
    } catch (err: unknown) {
      toast({ title: (err as Error).message || "Error inesperado", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  // ── Loading Clerk session ────────────────────────────────────────
  if (!clerkLoaded || !isSignedIn) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4"
        style={{ background: "linear-gradient(135deg, #1a1612 0%, #2d2419 60%, #1a1612 100%)" }}>
        <div className="w-12 h-12 border-4 rounded-full animate-spin"
          style={{ borderColor: "rgba(200,149,42,0.2)", borderTopColor: "#C8952A" }} />
        <p className="text-sm font-semibold" style={{ color: "rgba(255,255,255,0.5)" }}>
          {clerkLoaded ? "Redirigiendo a registro seguro..." : "Verificando sesión..."}
        </p>
      </div>
    );
  }

  // ── Loading / verifying code ─────────────────────────────────────
  if (codeState.status === "checking") {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4"
        style={{ background: "linear-gradient(135deg, #1a1612 0%, #2d2419 60%, #1a1612 100%)" }}>
        <div className="w-12 h-12 border-4 rounded-full animate-spin"
          style={{ borderColor: "rgba(200,149,42,0.2)", borderTopColor: "#C8952A" }} />
        <p className="text-sm font-semibold" style={{ color: "rgba(255,255,255,0.5)" }}>
          Verificando tu invitación...
        </p>
      </div>
    );
  }

  // ── No invitation code ───────────────────────────────────────────
  if (codeState.status === "no_code") {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-5 py-10"
        style={{ background: "linear-gradient(135deg, #1a1612 0%, #2d2419 60%, #1a1612 100%)" }}>
        <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-sm">
          <div className="text-5xl mb-6 text-center">🔒</div>
          <h1 className="text-white font-black text-2xl mb-3 text-center"
            style={{ fontFamily: "'Bebas Neue', sans-serif", letterSpacing: "0.04em" }}>
            Acceso por Invitación
          </h1>
          <p className="text-sm mb-6 leading-relaxed text-center" style={{ color: "rgba(255,255,255,0.5)" }}>
            Este sistema es privado. Ingresa tu <strong className="text-amber-400">clave de invitación</strong> para continuar.
          </p>

          {/* Code input form */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              validateCode(codeInput);
            }}
            className="space-y-3 mb-5"
          >
            <input
              value={codeInput}
              onChange={(e) => setCodeInput(e.target.value.toUpperCase())}
              placeholder="EJ: A1B2C3D4"
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              className="w-full px-4 py-3.5 rounded-2xl text-base font-mono font-bold text-white placeholder-white/25 outline-none text-center tracking-widest"
              style={{
                background: "rgba(255,255,255,0.07)",
                border: "1.5px solid rgba(200,149,42,0.3)",
                letterSpacing: "0.15em",
              }}
            />
            <button
              type="submit"
              disabled={validatingCode || !codeInput.trim()}
              className="w-full py-3.5 rounded-2xl text-sm font-bold transition-all disabled:opacity-50"
              style={{
                background: "linear-gradient(135deg, #C8952A, #C8952Acc)",
                color: "white",
              }}
            >
              {validatingCode ? "Verificando..." : "Validar clave →"}
            </button>
          </form>

          <div className="rounded-2xl p-4 mb-4 text-left"
            style={{ background: "rgba(200,149,42,0.08)", border: "1px solid rgba(200,149,42,0.2)" }}>
            <p className="text-xs font-semibold mb-2 text-amber-400">¿Cómo obtener acceso?</p>
            <p className="text-xs leading-relaxed" style={{ color: "rgba(255,255,255,0.5)" }}>
              Pide a tu administrador que te genere una clave desde el panel de control. Te la compartirá por WhatsApp o mensaje directo.
            </p>
          </div>

          <button
            onClick={() => setLocation("/admin-access")}
            className="w-full py-3 rounded-2xl text-xs font-bold mb-3"
            style={{ background: "rgba(200,149,42,0.12)", color: "#C8952A", border: "1px solid rgba(200,149,42,0.35)" }}>
            Soy administrador inicial (activar con frase)
          </button>

          <button
            onClick={() => setLocation("/")}
            className="w-full py-3 rounded-2xl text-xs font-bold"
            style={{ background: "rgba(255,255,255,0.05)", color: "rgba(255,255,255,0.5)", border: "1px solid rgba(255,255,255,0.08)" }}>
            ← Volver al inicio
          </button>
        </motion.div>
      </div>
    );
  }

  // ── Invalid / expired code ───────────────────────────────────────
  if (codeState.status === "invalid") {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-5"
        style={{ background: "linear-gradient(135deg, #1a1612 0%, #2d2419 60%, #1a1612 100%)" }}>
        <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-sm text-center">
          <div className="text-5xl mb-6">❌</div>
          <h1 className="text-white font-black text-2xl mb-3"
            style={{ fontFamily: "'Bebas Neue', sans-serif", letterSpacing: "0.04em" }}>
            Clave Inválida
          </h1>
          <p className="text-sm mb-4 leading-relaxed" style={{ color: "rgba(255,255,255,0.5)" }}>
            La clave <span className="font-mono text-amber-400 font-bold">{codeState.code}</span> no es válida o ya fue utilizada.
          </p>
          <p className="text-xs mb-6" style={{ color: "rgba(255,255,255,0.35)" }}>
            Pide al administrador que genere una nueva clave para ti.
          </p>
          <button
            onClick={() => setLocation("/")}
            className="w-full py-3.5 rounded-2xl text-sm font-bold"
            style={{ background: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.6)", border: "1px solid rgba(255,255,255,0.1)" }}>
            ← Volver al inicio
          </button>
        </motion.div>
      </div>
    );
  }

  // ── Valid code: show profile completion form ──────────────────────
  const roleColor = ROLE_COLORS[codeState.role] ?? "#C8952A";

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 py-10"
      style={{ background: "linear-gradient(135deg, #1a1612 0%, #2d2419 60%, #1a1612 100%)" }}>
      <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-md">

        {/* Logo */}
        <div className="flex items-center gap-2.5 mb-8 justify-center">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center overflow-hidden"
            style={{ background: "rgba(200,149,42,0.12)", border: "1px solid rgba(200,149,42,0.25)" }}>
            <img src="/castores-logo.jpeg" alt="CASTORES" className="h-8 w-auto object-contain" />
          </div>
          <span className="font-black text-white uppercase tracking-widest text-lg"
            style={{ fontFamily: "'Bebas Neue', sans-serif" }}>Castores Control</span>
        </div>

        <div className="rounded-3xl overflow-hidden"
          style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", backdropFilter: "blur(20px)" }}>

          {/* Invitation badge */}
          <div className="px-7 pt-6 pb-4">
            <div className="flex items-center gap-3 p-3.5 rounded-2xl mb-5"
              style={{ background: `${roleColor}15`, border: `1.5px solid ${roleColor}40` }}>
              <span className="text-2xl">{ROLE_ICONS[codeState.role] ?? "👤"}</span>
              <div>
                <p className="text-xs font-semibold mb-0.5" style={{ color: roleColor }}>
                  Invitación verificada ✓
                </p>
                <p className="text-white font-bold text-sm">
                  {ROLE_LABELS[codeState.role] ?? codeState.role}
                </p>
              </div>
              <div className="ml-auto text-right">
                <p className="text-[10px]" style={{ color: "rgba(255,255,255,0.35)" }}>Código</p>
                <p className="font-mono text-xs font-bold" style={{ color: roleColor }}>{codeState.code}</p>
              </div>
            </div>

            <h1 className="text-white font-black text-xl mb-1"
              style={{ fontFamily: "'Bebas Neue', sans-serif", letterSpacing: "0.04em" }}>
              Completa tu perfil
            </h1>
            <p className="text-xs mb-6" style={{ color: "rgba(255,255,255,0.35)" }}>
              Tu acceso queda configurado por la invitación.
            </p>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold mb-1.5" style={{ color: "rgba(255,255,255,0.55)" }}>
                  Nombre completo *
                </label>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Ej: Juan Pérez Ramírez"
                  required
                  className="w-full px-4 py-3 rounded-xl text-sm text-white placeholder-white/30 outline-none"
                  style={{ background: "rgba(255,255,255,0.07)", border: "1.5px solid rgba(255,255,255,0.12)" }}
                />
              </div>

              <div>
                <label className="block text-xs font-semibold mb-1.5" style={{ color: "rgba(255,255,255,0.55)" }}>
                  Empresa / Organización
                </label>
                <input
                  value={company}
                  onChange={(e) => setCompany(e.target.value)}
                  placeholder="Nombre de tu empresa (opcional)"
                  className="w-full px-4 py-3 rounded-xl text-sm text-white placeholder-white/30 outline-none"
                  style={{ background: "rgba(255,255,255,0.07)", border: "1.5px solid rgba(255,255,255,0.12)" }}
                />
              </div>

              <div>
                <label className="block text-xs font-semibold mb-1.5" style={{ color: "rgba(255,255,255,0.55)" }}>
                  Teléfono
                </label>
                <input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+52 81 1234 5678 (opcional)"
                  type="tel"
                  className="w-full px-4 py-3 rounded-xl text-sm text-white placeholder-white/30 outline-none"
                  style={{ background: "rgba(255,255,255,0.07)", border: "1.5px solid rgba(255,255,255,0.12)" }}
                />
              </div>

              {/* Terms */}
              <label className="flex items-start gap-3 cursor-pointer mt-2">
                <div className="relative flex-shrink-0 mt-0.5">
                  <input
                    type="checkbox"
                    checked={acceptedTerms}
                    onChange={(e) => setAcceptedTerms(e.target.checked)}
                    className="sr-only"
                  />
                  <div
                    className="w-5 h-5 rounded-md flex items-center justify-center transition-all"
                    style={{
                      background: acceptedTerms ? roleColor : "rgba(255,255,255,0.07)",
                      border: `1.5px solid ${acceptedTerms ? roleColor : "rgba(255,255,255,0.2)"}`,
                    }}>
                    {acceptedTerms && (
                      <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="3">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </div>
                </div>
                <span className="text-xs leading-relaxed" style={{ color: "rgba(255,255,255,0.45)" }}>
                  Acepto los{" "}
                  <a href="/legal/terminos" target="_blank" className="underline" style={{ color: roleColor }}>
                    Términos de Uso
                  </a>{" "}
                  y la{" "}
                  <a href="/legal/privacidad" target="_blank" className="underline" style={{ color: roleColor }}>
                    Política de Privacidad
                  </a>
                </span>
              </label>

              <button
                type="submit"
                disabled={loading || !acceptedTerms}
                className="w-full py-3.5 rounded-2xl text-sm font-bold transition-all disabled:opacity-50 mt-2"
                style={{ background: `linear-gradient(135deg, ${roleColor}, ${roleColor}cc)`, color: "white" }}>
                {loading ? "Registrando..." : "Completar registro →"}
              </button>
            </form>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
