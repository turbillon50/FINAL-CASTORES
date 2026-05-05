import { Switch, Route, Router as WouterRouter, useLocation, Redirect } from "wouter";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/lib/auth";
import { ClerkProvider, SignIn, useUser, useClerk, useAuth as useClerkAuth } from "@clerk/react";
import { useSignUp } from "@clerk/react/legacy";
import { useEffect, useLayoutEffect, useRef, useState, lazy, Suspense, type FormEvent } from "react";
import { setBaseUrl, setDemoMode, setAuthTokenGetter, setClerkUserInfo } from "@workspace/api-client-react";
import { apiUrl } from "@/lib/api-url";
import NotFound from "@/pages/not-found";
import Login from "@/pages/login";
import CompleteProfile from "@/pages/complete-profile";
import PendingApproval from "@/pages/pending-approval";
import CuentaRechazada from "@/pages/cuenta-rechazada";
import AdminAccessPage from "@/pages/admin-access";

// Code-splitting: las páginas detrás de auth se bajan bajo demanda.
// La primera carga del SPA solo trae el bundle del login + onboarding;
// el dashboard, bitácora, reportes, etc. llegan en chunks separados al
// momento de navegarlos. Esto reduce ~400kb de la primera descarga, lo
// que se nota mucho en redes 4G de obra.
const Dashboard = lazy(() => import("@/pages/dashboard"));
const Projects = lazy(() => import("@/pages/projects/index"));
const ProjectDetail = lazy(() => import("@/pages/projects/[id]"));
const Bitacora = lazy(() => import("@/pages/bitacora/index"));
const NewBitacoraEntry = lazy(() => import("@/pages/bitacora/new"));
const BitacoraDetail = lazy(() => import("@/pages/bitacora/[id]"));
const Materiales = lazy(() => import("@/pages/materiales"));
const Documentos = lazy(() => import("@/pages/documentos"));
const Reportes = lazy(() => import("@/pages/reportes"));
const Usuarios = lazy(() => import("@/pages/usuarios"));
const Notificaciones = lazy(() => import("@/pages/notificaciones"));
const Explorar = lazy(() => import("@/pages/explorar"));
const AdminPanel = lazy(() => import("@/pages/admin"));
const Cuenta = lazy(() => import("@/pages/cuenta"));
const FAQ = lazy(() => import("@/pages/faq"));
const Terminos = lazy(() => import("@/pages/legal-terminos"));
const Privacidad = lazy(() => import("@/pages/legal-privacidad"));

function RouteFallback() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#f8f4ef]">
      <div className="flex flex-col items-center gap-3">
        <div className="w-10 h-10 rounded-full border-2 border-amber-200 border-t-amber-600 animate-spin" />
        <p className="text-xs text-gray-500 tracking-wider">CARGANDO…</p>
      </div>
    </div>
  );
}

const clerkPubKey =
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY ||
  import.meta.env.CLERK_PUBLISHABLE_KEY ||
  import.meta.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;
const resolvedClerkProxyUrl =
  typeof clerkProxyUrl === "string" && clerkProxyUrl.trim().length > 0
    ? clerkProxyUrl
    : undefined;
const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");
const apiBaseUrl = import.meta.env.VITE_API_BASE_URL;

if (apiBaseUrl) {
  setBaseUrl(apiBaseUrl);
}

function stripBase(path: string): string {
  return basePath && path.startsWith(basePath)
    ? path.slice(basePath.length) || "/"
    : path;
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 30_000,
    },
  },
});

const clerkAppearance = {
  elements: {
    socialButtonsRoot: { display: "none" },
    socialButtonsBlockButton: { display: "none" },
    dividerRow: { display: "none" },
    dividerText: { display: "none" },
    dividerLine: { display: "none" },
    // Passkeys disabled — requires Clerk plan upgrade
    passkey__container: { display: "none" },
    passkeyContainer: { display: "none" },
    "passkey-container": { display: "none" },
    userVerificationRoot: { display: "none" },
  },
};

function SignInPage() {
  // Custom email + password sign-in that bypasses Clerk's hosted UI. Clerk's
  // <SignIn /> component requires an email OTP every time it sees a "new
  // device", which is unworkable for users who already have a password set
  // (they get stuck on a verification screen on every fresh phone or
  // browser). We POST to /api/auth/invite-login instead — the backend
  // verifies the password against Clerk Backend API and mints a one-shot
  // sign_in_token URL we redirect to. No OTP, ever, on the sign-in path.
  const { signOut } = useClerk();
  const { isSignedIn } = useUser();
  const [, setLocation] = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputCls = "w-full px-4 py-3 rounded-xl border border-gray-200 bg-white focus:outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-100 text-gray-900 placeholder-gray-400 transition text-sm";

  // If a previous Clerk session is sitting around (user opened /sign-in while
  // already signed in), wipe it before showing the form so the new login
  // can't be intercepted by the cached session.
  useEffect(() => {
    if (isSignedIn) {
      signOut().catch(() => {});
    }
  }, [isSignedIn, signOut]);

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (busy) return;
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail || !password) {
      setError("Ingresa tu correo y contraseña.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(apiUrl("/api/auth/invite-login"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: cleanEmail, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError((data && (data.error || data.detail)) || "No pudimos iniciar sesión.");
        setBusy(false);
        return;
      }
      ["castores_signup_step","castores_signup_email","castores_invite_code","castores_invite_pending","castores_signup_pending"]
        .forEach(k => { try { localStorage.removeItem(k); } catch { /* ignore */ } });
      const target: string = data?.signInUrl || (basePath ? `${basePath}/dashboard` : "/dashboard");
      window.location.assign(target);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Error de red";
      setError(`No pudimos iniciar sesión: ${msg}`);
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#f8f4ef] px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-6">
          <img src={`${basePath}/castores-logo.jpeg`} alt="Castores" className="w-16 h-16 rounded-2xl object-cover shadow mx-auto mb-3" />
          <h1 className="text-2xl font-bold text-gray-900">Iniciar sesión</h1>
          <p className="text-sm text-gray-500 mt-1">Entra con el correo y contraseña que creaste al registrarte.</p>
        </div>
        <form onSubmit={onSubmit} className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 space-y-3">
          <input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value.trim().toLowerCase())}
            placeholder="Correo electrónico"
            required
            autoComplete="email"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            inputMode="email"
            className={inputCls}
          />
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="Contraseña"
            autoComplete="current-password"
            required
            className={inputCls}
          />
          {error && <p className="text-sm text-red-600 text-center">{error}</p>}
          <button type="submit" disabled={busy} className="w-full py-3 rounded-xl font-semibold text-white bg-amber-600 hover:bg-amber-700 transition disabled:opacity-50 text-sm mt-1">
            {busy ? "Entrando..." : "Iniciar sesión →"}
          </button>
          <button
            type="button"
            onClick={() => setLocation("/forgot-password")}
            className="block w-full text-center text-xs text-gray-500 hover:text-amber-700 mt-2"
          >
            ¿Olvidaste tu contraseña?
          </button>
        </form>
        <p className="text-center text-sm text-gray-500 mt-4">
          ¿Aún no tienes cuenta?{" "}
          <button onClick={() => setLocation("/")} className="text-amber-700 font-medium hover:text-amber-900 underline">
            Volver al inicio
          </button>
        </p>
      </div>
    </div>
  );
}

function ForgotPasswordPage() {
  const [, setLocation] = useLocation();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputCls = "w-full px-4 py-3 rounded-xl border border-gray-200 bg-white focus:outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-100 text-gray-900 placeholder-gray-400 transition text-sm";

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (busy) return;
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail) { setError("Ingresa tu correo."); return; }
    setBusy(true); setError(null);
    try {
      const res = await fetch(apiUrl("/api/auth/forgot-password"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: cleanEmail }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError((data && data.error) || "No pudimos procesar tu solicitud.");
        setBusy(false);
        return;
      }
      setDone(true);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Error de red";
      setError(`No pudimos procesar tu solicitud: ${msg}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#f8f4ef] px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-6">
          <img src={`${basePath}/castores-logo.jpeg`} alt="Castores" className="w-16 h-16 rounded-2xl object-cover shadow mx-auto mb-3" />
          <h1 className="text-2xl font-bold text-gray-900">Restablecer contraseña</h1>
          <p className="text-sm text-gray-500 mt-1">Te enviamos un correo con instrucciones.</p>
        </div>
        {done ? (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 space-y-4 text-center">
            <p className="text-sm text-gray-700">
              Si tu correo está registrado, en unos minutos recibirás un enlace para crear una contraseña nueva. El enlace caduca en 30 minutos.
            </p>
            <button
              onClick={() => setLocation("/sign-in")}
              className="w-full py-3 rounded-xl font-semibold text-white bg-amber-600 hover:bg-amber-700 transition text-sm"
            >
              Volver a iniciar sesión
            </button>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 space-y-3">
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value.trim().toLowerCase())}
              placeholder="Correo electrónico"
              required
              autoComplete="email"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              inputMode="email"
              className={inputCls}
            />
            {error && <p className="text-sm text-red-600 text-center">{error}</p>}
            <button type="submit" disabled={busy} className="w-full py-3 rounded-xl font-semibold text-white bg-amber-600 hover:bg-amber-700 transition disabled:opacity-50 text-sm mt-1">
              {busy ? "Enviando..." : "Enviar enlace"}
            </button>
            <button
              type="button"
              onClick={() => setLocation("/sign-in")}
              className="block w-full text-center text-xs text-gray-500 hover:text-amber-700"
            >
              Volver al inicio de sesión
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

function ResetPasswordPage() {
  const [, setLocation] = useLocation();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputCls = "w-full px-4 py-3 rounded-xl border border-gray-200 bg-white focus:outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-100 text-gray-900 placeholder-gray-400 transition text-sm";

  const token = (() => {
    if (typeof window === "undefined") return "";
    return new URLSearchParams(window.location.search).get("token") ?? "";
  })();

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (busy) return;
    if (!token) { setError("Falta el token. Solicita un enlace nuevo."); return; }
    if (password.length < 8) { setError("La contraseña debe tener al menos 8 caracteres."); return; }
    if (password !== confirm) { setError("Las contraseñas no coinciden."); return; }

    setBusy(true); setError(null);
    try {
      const res = await fetch(apiUrl("/api/auth/reset-password"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError((data && data.error) || "No pudimos cambiar la contraseña.");
        setBusy(false);
        return;
      }
      setDone(true);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Error de red";
      setError(`No pudimos cambiar la contraseña: ${msg}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#f8f4ef] px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-6">
          <img src={`${basePath}/castores-logo.jpeg`} alt="Castores" className="w-16 h-16 rounded-2xl object-cover shadow mx-auto mb-3" />
          <h1 className="text-2xl font-bold text-gray-900">Nueva contraseña</h1>
          <p className="text-sm text-gray-500 mt-1">Elige una contraseña que recuerdes (mín. 8 caracteres).</p>
        </div>
        {done ? (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 space-y-4 text-center">
            <p className="text-sm text-gray-700">Listo. Tu contraseña fue actualizada.</p>
            <button
              onClick={() => setLocation("/sign-in")}
              className="w-full py-3 rounded-xl font-semibold text-white bg-amber-600 hover:bg-amber-700 transition text-sm"
            >
              Iniciar sesión →
            </button>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 space-y-3">
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="Nueva contraseña"
              autoComplete="new-password"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              required
              className={inputCls}
            />
            <input
              type="password"
              value={confirm}
              onChange={e => setConfirm(e.target.value)}
              placeholder="Confirmar contraseña"
              autoComplete="new-password"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              required
              className={inputCls}
            />
            {error && <p className="text-sm text-red-600 text-center">{error}</p>}
            <button type="submit" disabled={busy} className="w-full py-3 rounded-xl font-semibold text-white bg-amber-600 hover:bg-amber-700 transition disabled:opacity-50 text-sm mt-1">
              {busy ? "Guardando..." : "Guardar contraseña"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

function translateClerkError(msg: string): string {
  const m = msg.toLowerCase();
  if (m.includes("incorrect") || m.includes("invalid") || m.includes("incorrecto")) return "Código incorrecto. Intenta de nuevo.";
  if (m.includes("expired") || m.includes("expirado")) return "El código expiró. Usa el botón Reenviar para recibir uno nuevo.";
  if (m.includes("too many") || m.includes("rate")) return "Demasiados intentos. Espera unos minutos e intenta de nuevo.";
  if (m.includes("network") || m.includes("fetch")) return "Error de conexión. Revisa tu internet e intenta de nuevo.";
  return msg;
}

function parseClerkError(err: unknown): { msg: string; isEmailTaken: boolean } {
  if (err && typeof err === "object") {
    const e = err as Record<string, unknown>;
    if (Array.isArray(e.errors) && e.errors.length > 0) {
      const first = e.errors[0] as Record<string, unknown>;
      const code = String(first.code ?? "");
      const msg = String(first.longMessage ?? first.message ?? "Error desconocido");
      return { msg, isEmailTaken: code === "form_identifier_exists" };
    }
    if (typeof e.message === "string") return { msg: e.message, isEmailTaken: false };
  }
  return { msg: "Error al conectar con el servidor. Inténtalo de nuevo.", isEmailTaken: false };
}

function PwaInstallBanner({ defaultIOS }: { defaultIOS: boolean }) {
  const [tab, setTab] = useState<"ios" | "android">(defaultIOS ? "ios" : "android");
  return (
    <div className="w-full mb-5 rounded-2xl text-sm overflow-hidden"
      style={{ border: "1px solid rgba(200,149,42,0.30)" }}>
      {/* Tabs */}
      <div className="flex" style={{ background: "rgba(200,149,42,0.08)" }}>
        {(["ios", "android"] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className="flex-1 py-2 text-xs font-bold transition-colors"
            style={tab === t
              ? { background: "#C8952A", color: "#fff" }
              : { color: "#92400e" }}>
            {t === "ios" ? "🍎 iPhone / iPad" : "🤖 Android"}
          </button>
        ))}
      </div>
      {/* Contenido */}
      <div className="p-4" style={{ background: "rgba(200,149,42,0.06)" }}>
        <p className="font-semibold text-amber-800 mb-2">📲 Instala la app en tu teléfono</p>
        {tab === "ios" ? (
          <ol className="text-amber-700 space-y-1.5">
            <li>1. Abre esta página en <span className="font-bold">Safari</span></li>
            <li>2. Toca el ícono <span className="font-bold">⬆ Compartir</span> (parte inferior de la pantalla)</li>
            <li>3. Selecciona <span className="font-bold">"Agregar a pantalla de inicio"</span></li>
            <li>4. Toca <span className="font-bold">"Agregar"</span> — ya tienes el ícono en tu inicio</li>
          </ol>
        ) : (
          <ol className="text-amber-700 space-y-1.5">
            <li>1. Abre esta página en <span className="font-bold">Chrome</span></li>
            <li>2. Toca el menú <span className="font-bold">⋮</span> (esquina superior derecha)</li>
            <li>3. Selecciona <span className="font-bold">"Añadir a pantalla de inicio"</span> o <span className="font-bold">"Instalar app"</span></li>
            <li>4. Confirma — ya tienes el ícono en tu inicio</li>
          </ol>
        )}
      </div>
    </div>
  );
}

type SignUpSplashState =
  | { status: "idle" }                  // no invite, jump straight to form
  | { status: "loading"; code: string } // fetching invitation metadata
  | { status: "ready"; code: string; role: string; label: string | null; invitedBy: string | null }
  | { status: "invalid"; code: string; reason: string }
  // user clicked Continuar in splash; keep code+role around so the form
  // submission can pass them straight to the backend register endpoint.
  | { status: "dismissed"; code: string; role: string };

const ROLE_LABEL: Record<string, string> = {
  admin: "Administrador",
  supervisor: "Supervisor de Obra",
  client: "Cliente / Contratante",
  worker: "Trabajador / Operario",
  proveedor: "Proveedor",
};

const ROLE_ICON: Record<string, string> = {
  admin: "🛡️", supervisor: "👷", client: "🏢", worker: "🔧", proveedor: "🚛",
};

const ROLE_INTRO: Record<string, string> = {
  admin: "Tendrás acceso completo al sistema: gestión de obras, materiales, equipos, reportes e invitaciones.",
  supervisor: "Vas a llevar la bitácora de obra, registrar avances, solicitar materiales y generar reportes.",
  client: "Vas a poder ver el avance de tus obras, acceder a documentos y reportes en tiempo real.",
  worker: "Vas a poder reportar tu trabajo en obra, registrar incidencias y consultar materiales.",
  proveedor: "Vas a recibir solicitudes de material y vas a poder gestionar tus pedidos.",
};

function SignUpPage() {
  const { isLoaded, isSignedIn } = useUser();
  const { isLoaded: signUpLoaded, signUp, setActive } = useSignUp();
  const { signOut } = useClerk();
  const [, setLocation] = useLocation();
  // Tracks whether we're tearing down a leftover Clerk session before
  // showing the form. Without this the form would briefly accept input
  // while signOut is still propagating.
  const [purgingSession, setPurgingSession] = useState(false);
  const handledStaleSessionRef = useRef(false);

  // Recovery: user left to check email and app reloaded with same invite code.
  // Only recover if the URL code matches the stored code — a different code means
  // a new invitation (possibly for a different person) and must start fresh.
  const _urlCodeRaw = typeof window !== "undefined"
    ? new URLSearchParams(window.location.search).get("code")?.toUpperCase() ?? null
    : null;
  const _storedCode = typeof window !== "undefined"
    ? localStorage.getItem("castores_invite_code")
    : null;
  const isOtpRecovery = typeof window !== "undefined"
    && localStorage.getItem("castores_signup_step") === "otp"
    && !!localStorage.getItem("castores_signup_email")
    && (!_urlCodeRaw || _urlCodeRaw === _storedCode);

  // True only for a genuinely fresh invite link with no active OTP in progress.
  const hasUrlCode = !!_urlCodeRaw && !isOtpRecovery;

  // On mount only: capture invite code and clear stale signup state.
  // Must be a useEffect — NOT inline — so that re-renders triggered during
  // the OTP flow (e.g. setBusy, setStep) don't erase the
  // castores_signup_step/email keys that handleSubmitForm writes for iOS
  // background-kill recovery before the OTP screen appears.
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const code = urlParams.get("code");
    if (code) {
      localStorage.setItem("castores_invite_code", code.toUpperCase());
      // Don't wipe OTP state when the user just came back from the email app
      if (!isOtpRecovery) {
        localStorage.removeItem("castores_signup_step");
        localStorage.removeItem("castores_signup_email");
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  type SignUpStep = "form" | "otp";
  const [step, setStep] = useState<SignUpStep>(() => {
    // Start at form only on a genuinely fresh invite visit.
    // If the user is returning from the email app (isOtpRecovery), restore OTP.
    if (hasUrlCode) return "form";
    return typeof window !== "undefined" && localStorage.getItem("castores_signup_step") === "otp"
      ? "otp" : "form";
  });
  const [email, setEmail] = useState(() => {
    if (hasUrlCode) return "";
    return typeof window !== "undefined" ? (localStorage.getItem("castores_signup_email") ?? "") : "";
  });
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [password, setPassword] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [emailTaken, setEmailTaken] = useState(false);
  const [resendOk, setResendOk] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [busy, setBusy] = useState(false);
  // Invitation splash state. Decides whether to show the dynamic role-aware
  // welcome screen before the registration form. Driven by ?code= in the URL
  // or castores_invite_code in localStorage. Skipped if user is mid-OTP.
  const [splash, setSplash] = useState<SignUpSplashState>(() => {
    if (typeof window === "undefined") return { status: "idle" };
    const code = _urlCodeRaw ?? _storedCode ?? null;
    if (!code) return { status: "idle" };
    // OTP recovery (legacy path) — we don't have the role until validate runs;
    // load the splash silently so the rest of the SignUpPage renders without
    // it instead of leaving the form with no role attached on submit.
    if (isOtpRecovery) return { status: "loading", code };
    return { status: "loading", code };
  });
  // Synchronous double-tap guard: setBusy schedules a state update but on a fast
  // double-tap (especially iOS PWA) both handlers fire before React re-renders
  // and both see busy=false. A ref is read/written synchronously, so the second
  // tap bails out immediately.
  const verifyingRef = useRef(false);
  // Direct DOM ref for the email input. We read its `.value` on submit
  // instead of trusting the React state — iOS Safari and password managers
  // can inject autofilled values without firing onChange, which would
  // leave the React state stale while the DOM holds the real (often
  // unwanted) value. Reading the DOM ensures we always see what the user
  // is actually about to send.
  const emailInputRef = useRef<HTMLInputElement>(null);
  // Password is always required: without it the Clerk account is OTP-only and
  // the user cannot sign in again later via /sign-in (which uses email+password).
  const PASSWORD_MIN = 8;

  // CRITICAL: when SignUpPage mounts with a Clerk session already active and
  // there is NO in-progress signUp flow (signUp.status would be
  // "missing_requirements" mid-OTP), the user arrived here while logged in
  // as somebody else (e.g. admin still cached). The previous code would
  // immediately redirect them to /complete-profile, which silently logged them
  // back in as the existing user — making "register a new account" impossible.
  //
  // Instead: tear down the stale session in-place. After signOut completes the
  // form mounts cleanly so the new email + password creates a real new Clerk
  // user. The handledStaleSessionRef guard ensures we never sign the user out
  // AFTER a successful registration (when isSignedIn flips to true legitimately).
  useEffect(() => {
    if (!isLoaded || !signUpLoaded) return;
    if (handledStaleSessionRef.current) return;
    handledStaleSessionRef.current = true;
    // Don't tear down a session that belongs to an in-flight signup:
    //   - "missing_requirements" → user is mid-OTP, restore the OTP screen
    //   - "complete"             → signup just succeeded, hard nav to
    //                              /complete-profile is queued, don't undo it
    const inFlightSignup = signUp?.status === "missing_requirements" || signUp?.status === "complete";
    if (isSignedIn && !inFlightSignup) {
      setPurgingSession(true);
      // CRITICAL: NEVER drop castores_invite_code here. If the user landed on
      // /sign-up?code=XXXX, that code lives both in the URL and (after the
      // mount effect below) in localStorage. complete-profile relies on the
      // localStorage copy after the OTP hard-nav (the URL ?code= is gone by
      // then). Wiping the invite code at this stage was sending invited users
      // to the no_code screen — the same screen that previously leaked the
      // master phrase.
      ["castores_signup_step","castores_signup_email","castores_real_user","castores_signup_pending"]
        .forEach(k => { try { localStorage.removeItem(k); } catch { /* ignore */ } });
      signOut().catch(() => {}).finally(() => setPurgingSession(false));
    }
  }, [isLoaded, signUpLoaded, isSignedIn, signUp?.status, signOut]);

  // Fetch invitation metadata for the splash. Runs once on mount when there
  // is a code waiting (?code= in URL or castores_invite_code in localStorage)
  // and the user is NOT mid-OTP recovery. Skipped for the master phrase since
  // that path is intentionally invisible to the public UI.
  useEffect(() => {
    if (splash.status !== "loading") return;
    const ac = new AbortController();
    fetch(apiUrl("/api/invitations/validate"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: splash.code }),
      signal: ac.signal,
    })
      .then((r) => r.json().catch(() => null))
      .then((data: { valid?: boolean; role?: string; label?: string | null; invitedBy?: string | null; isMasterKey?: boolean; reason?: string } | null) => {
        if (ac.signal.aborted) return;
        if (!data || !data.valid || data.isMasterKey || !data.role) {
          setSplash({ status: "invalid", code: splash.code, reason: data?.reason ?? "Esta invitación no es válida o ya fue utilizada." });
          return;
        }
        setSplash({
          status: "ready",
          code: splash.code,
          role: data.role,
          label: data.label ?? null,
          invitedBy: data.invitedBy ?? null,
        });
      })
      .catch(() => {
        if (ac.signal.aborted) return;
        // Network error — show invalid splash so the user can retry from "/"
        // rather than dropping them on the form with no role context.
        setSplash({ status: "invalid", code: splash.code, reason: "No pudimos validar tu invitación. Verifica tu conexión y vuelve a abrir el link." });
      });
    return () => ac.abort();
  }, [splash]);

  // If Clerk's signUp session survived an iOS restart, jump to OTP step.
  // Skip this when a fresh invite link is open — we never want to restore
  // a previous user's session when someone is starting a new registration.
  useEffect(() => {
    if (!signUpLoaded || hasUrlCode) return;
    if (signUp?.status === "missing_requirements") {
      if (signUp.emailAddress) {
        setEmail(signUp.emailAddress);
        localStorage.setItem("castores_signup_email", signUp.emailAddress);
      }
      localStorage.setItem("castores_signup_step", "otp");
      setStep("otp");
    } else if (localStorage.getItem("castores_signup_step") === "otp") {
      // Clerk has no pending session but localStorage has stale OTP state.
      // Reset to form so the user isn't stuck on an OTP screen that can't work.
      localStorage.removeItem("castores_signup_step");
      localStorage.removeItem("castores_signup_email");
      setStep("form");
      setEmail("");
    }
  }, [signUpLoaded, signUp?.status, hasUrlCode]);

  const handleSubmitForm = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (busy) return;

    // DOM-level read of the email — autofill can mutate the input without
    // firing React onChange. This is the source of truth at submit time.
    const submitEmail = (emailInputRef.current?.value ?? email).trim().toLowerCase();
    if (submitEmail !== email) setEmail(submitEmail);
    if (!submitEmail) { setError("Ingresa un correo electrónico válido."); return; }
    if (!password || password.length < PASSWORD_MIN) {
      setError(`La contraseña debe tener al menos ${PASSWORD_MIN} caracteres.`);
      return;
    }
    if (!acceptTerms) {
      setError("Debes aceptar los Términos y la Política de Privacidad.");
      return;
    }

    // Pull role + invitation code from the splash state (which validated the
    // code against the backend before the user ever saw the form). If we're
    // here without those, fall back to localStorage where the URL-code
    // capture effect parked it.
    let invitationCode: string | null = null;
    let role: string | null = null;
    if (splash.status === "ready" || splash.status === "dismissed") {
      invitationCode = splash.code;
      role = splash.role;
    } else {
      invitationCode = localStorage.getItem("castores_invite_code");
    }
    if (!invitationCode) {
      setError("Falta la clave de invitación. Abre el link que te compartió tu administrador.");
      return;
    }

    setBusy(true);
    setError(null);

    const fullName = [firstName.trim(), lastName.trim()].filter(Boolean).join(" ") || submitEmail.split("@")[0];

    try {
      const res = await fetch(apiUrl("/api/auth/invite-register"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: fullName,
          email: submitEmail,
          password,
          role,                    // null if we don't know it yet — backend will derive from invitation
          invitationCode,
          acceptTerms: true,
          termsVersion: "1.0",
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = (data && (data.error || data.detail || data.message)) || "No pudimos crear tu cuenta. Intenta de nuevo.";
        if (typeof msg === "string" && msg.toLowerCase().includes("ya está registrado")) {
          setEmailTaken(true);
        }
        setError(typeof msg === "string" ? msg : "Error al registrar.");
        setBusy(false);
        return;
      }

      // Wipe all signup recovery keys — registration is complete.
      ["castores_signup_step","castores_signup_email","castores_invite_code","castores_signup_pending"]
        .forEach(k => { try { localStorage.removeItem(k); } catch { /* ignore */ } });

      // Clerk gave us a single-use sign-in URL. Redirecting to it logs the
      // user in (no password retype, no OTP) and lands them in /dashboard.
      const target: string = data?.signInUrl
        || (basePath ? `${basePath}/sign-in` : "/sign-in");
      window.location.assign(target);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Error de red";
      setError(`No pudimos crear tu cuenta: ${msg}`);
      setBusy(false);
    }
  };

  const handleVerifyOtp = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    // Synchronous guard wins the double-tap race; the React state guard is
    // kept for the disabled button styling.
    if (verifyingRef.current || !signUp || otpCode.length < 6) return;
    verifyingRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const result = await signUp.attemptVerification({ strategy: "email_code", code: otpCode });
      if (result.status === "complete") {
        await setActive({ session: result.createdSessionId });
        localStorage.removeItem("castores_signup_step");
        localStorage.removeItem("castores_signup_email");
        // replace() is more reliable than assign() inside iOS PWA and also
        // removes the OTP page from history so back-button can't return to it.
        window.location.replace(basePath ? `${basePath}/complete-profile` : "/complete-profile");
        return;
      }
      // OTP verified but Clerk still needs more fields. Most common case in
      // this instance is missingFields=["username"] because the Clerk dashboard
      // has username required. Auto-fill it from the email rather than failing
      // the user.
      const missing = (result as unknown as { missingFields?: string[]; unverifiedFields?: string[] }).missingFields ?? [];
      const unverified = (result as unknown as { unverifiedFields?: string[] }).unverifiedFields ?? [];
      // eslint-disable-next-line no-console
      console.error("[signup] attemptVerification did not complete", { status: result.status, missing, unverified });

      if (missing.includes("username") && signUp) {
        try {
          const baseEmail = (signUp.emailAddress || email).split("@")[0].toLowerCase();
          const base = baseEmail.replace(/[^a-z0-9_]/g, "_").slice(0, 50) || "user";
          const suffix = Math.random().toString(36).slice(2, 6);
          const updated = await signUp.update({ username: `${base}_${suffix}`.slice(0, 64) });
          if (updated.status === "complete" && updated.createdSessionId) {
            await setActive({ session: updated.createdSessionId });
            localStorage.removeItem("castores_signup_step");
            localStorage.removeItem("castores_signup_email");
            window.location.replace(basePath ? `${basePath}/complete-profile` : "/complete-profile");
            return;
          }
        } catch (updateErr) {
          // eslint-disable-next-line no-console
          console.error("[signup] username patch failed", updateErr);
        }
      }

      const detail = [
        missing.length ? `Faltan: ${missing.join(", ")}` : null,
        unverified.length ? `Sin verificar: ${unverified.join(", ")}` : null,
      ].filter(Boolean).join(" · ");
      setError(
        `El código se verificó pero el registro quedó incompleto (status=${result.status})${detail ? ` — ${detail}` : ""}. ` +
        `Captura de este error para diagnosticar; intenta "Reenviar" o cambia de correo.`,
      );
      setBusy(false);
      verifyingRef.current = false;
    } catch (err) {
      const { msg } = parseClerkError(err);
      if (
        msg.toLowerCase().includes("already been verified") ||
        msg.toLowerCase().includes("already verified")
      ) {
        // The first verification call already created the Clerk session and
        // set the cookie. The local signUp ref may still be stale — don't
        // depend on it. Hard-reload to "/" and let Login.tsx route the now
        // signed-in user to /complete-profile or /dashboard.
        localStorage.removeItem("castores_signup_step");
        localStorage.removeItem("castores_signup_email");
        window.location.replace(basePath ? `${basePath}/` : "/");
        return;
      }
      setError(translateClerkError(msg));
      setBusy(false);
      verifyingRef.current = false;
    }
  };

  // Tick the resend cooldown down to zero so the button auto-enables.
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const id = window.setTimeout(() => setResendCooldown(c => Math.max(0, c - 1)), 1000);
    return () => window.clearTimeout(id);
  }, [resendCooldown]);

  const handleResend = async () => {
    if (resendCooldown > 0) return; // ratelimit guard
    setError(null);
    setResendOk(false);
    if (!signUp) {
      localStorage.removeItem("castores_signup_step");
      setStep("form");
      setError("Tu sesión expiró. Vuelve a ingresar tus datos para recibir un nuevo código.");
      return;
    }
    try {
      await signUp.prepareVerification({ strategy: "email_code" });
      setResendOk(true);
      // Start a 60-second cooldown so the user can't spam Clerk's email
      // provider into rate-limiting their address. Each tick removes one
      // second from the countdown, then the timer clears itself.
      setResendCooldown(60);
    } catch (err) {
      setError(translateClerkError(parseClerkError(err).msg));
    }
  };

  const inputCls = "w-full px-4 py-3 rounded-xl border border-gray-200 bg-white focus:outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-100 text-gray-900 placeholder-gray-400 transition text-sm";
  const btnPrimary = "w-full py-3 rounded-xl font-semibold text-white bg-amber-600 hover:bg-amber-700 transition disabled:opacity-50 text-sm";

  // Show spinner while:
  //   - Clerk is initializing
  //   - We're tearing down a stale session
  //   - User just successfully signed up (isSignedIn=true while the hard
  //     nav to /complete-profile is in flight)
  // The stale-session teardown effect above guarantees that, once Clerk has
  // loaded and we mounted with someone else's session, signOut runs and
  // isSignedIn becomes false — so the form renders.
  if (!isLoaded || !signUpLoaded || purgingSession || (isSignedIn && handledStaleSessionRef.current === false)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f8f4ef]">
        <div className="flex flex-col items-center gap-3">
          <div className="animate-spin rounded-full h-10 w-10 border-4 border-amber-500 border-t-transparent" />
          {purgingSession && (
            <p className="text-xs text-gray-500">Preparando registro nuevo...</p>
          )}
        </div>
      </div>
    );
  }
  // After successful registration isSignedIn becomes true while the hard
  // navigation runs. Show the spinner (no purging text) so the form does
  // not flash.
  if (isSignedIn) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f8f4ef]">
        <div className="animate-spin rounded-full h-10 w-10 border-4 border-amber-500 border-t-transparent" />
      </div>
    );
  }

  // While Clerk initializes and localStorage says OTP is pending, show loader
  // (prevents flashing the form before the Clerk sync effect redirects to OTP)
  if (step === "otp" && !signUpLoaded) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f8f4ef]">
        <div className="animate-spin rounded-full h-10 w-10 border-4 border-amber-500 border-t-transparent" />
      </div>
    );
  }

  // ── OTP step ──────────────────────────────────────────────────────────────
  if (step === "otp") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f8f4ef] p-4">
        <div className="w-full max-w-sm">
          <div className="text-center mb-5">
            <div className="text-4xl mb-2">📧</div>
            <h1 className="text-2xl font-bold text-gray-900">Revisa tu correo</h1>
            <p className="text-sm text-gray-500 mt-1">
              Enviamos un código de 6 dígitos a
            </p>
            <p className="font-semibold text-gray-800 text-sm mt-0.5 break-all">{email}</p>
          </div>

          {/* Instrucción explícita paso a paso */}
          <div className="rounded-xl p-3 text-sm mb-4"
            style={{ background: "rgba(200,149,42,0.08)", border: "1px solid rgba(200,149,42,0.25)" }}>
            <p className="font-semibold text-amber-800 mb-1">¿Qué hacer ahora?</p>
            <ol className="text-amber-700 space-y-1 list-none">
              <li>1. Abre tu app de correo</li>
              <li>2. Busca el mensaje de Castores</li>
              <li>3. Copia el código de 6 dígitos</li>
              <li>4. Regresa aquí e ingrésalo abajo</li>
            </ol>
          </div>

          {!signUp && signUpLoaded && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-sm text-amber-800 mb-4">
              Tu sesión fue interrumpida. El código anterior puede haber expirado — usa el botón "Reenviar código".
            </div>
          )}

          <form onSubmit={handleVerifyOtp} className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 space-y-4">
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={6}
              value={otpCode}
              onChange={e => { setOtpCode(e.target.value.replace(/\D/g, "")); setError(null); setResendOk(false); }}
              placeholder="000000"
              className={`${inputCls} text-center text-2xl tracking-[0.5em] font-mono`}
              autoFocus
              autoComplete="one-time-code"
            />
            {error && <p className="text-sm text-red-600 text-center">{error}</p>}
            {resendOk && <p className="text-sm text-green-600 text-center">¡Código reenviado! Revisa tu correo.</p>}
            <button type="submit" disabled={busy || otpCode.length < 6} className={btnPrimary}>
              {busy ? "Verificando..." : "Verificar código"}
            </button>
          </form>

          <div className="mt-4 flex flex-col gap-2 text-center">
            <button
              onClick={handleResend}
              disabled={resendCooldown > 0}
              className="text-sm text-amber-700 hover:text-amber-900 font-medium disabled:text-gray-400 disabled:hover:text-gray-400 disabled:cursor-not-allowed"
            >
              {resendCooldown > 0
                ? `Espera ${resendCooldown}s antes de reenviar`
                : "¿No llegó el código? Reenviar"}
            </button>
            <button
              onClick={() => {
                localStorage.removeItem("castores_signup_step");
                localStorage.removeItem("castores_signup_email");
                setStep("form");
                setOtpCode("");
                setError(null);
              }}
              className="text-sm text-gray-500 hover:text-gray-700"
            >
              Cambiar correo electrónico
            </button>
            <button
              onClick={() => {
                localStorage.removeItem("castores_signup_step");
                localStorage.removeItem("castores_signup_email");
                window.location.assign(basePath ? `${basePath}/sign-in` : "/sign-in");
              }}
              className="text-sm text-gray-400 hover:text-gray-600"
            >
              ¿Ya tienes cuenta? Iniciar sesión →
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Invitation splash (role-aware) ────────────────────────────────────────
  // Shown to users arriving via ?code=XXXX (or with a stored code) before any
  // form. Clarifies who invited them, what role they'll have, and what they'll
  // be able to do. Hides after the user clicks "Continuar con mi registro".
  if (splash.status === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center"
        style={{ background: "linear-gradient(135deg, #1a1612 0%, #2d2419 60%, #1a1612 100%)" }}>
        <div className="animate-spin rounded-full h-10 w-10 border-4"
          style={{ borderColor: "rgba(200,149,42,0.2)", borderTopColor: "#C8952A" }} />
      </div>
    );
  }
  if (splash.status === "ready") {
    const roleLabel = ROLE_LABEL[splash.role] ?? splash.role;
    const roleIcon = ROLE_ICON[splash.role] ?? "👤";
    const roleIntro = ROLE_INTRO[splash.role] ?? "Vas a poder usar el sistema según tu rol asignado.";
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-5 py-10"
        style={{ background: "linear-gradient(135deg, #1a1612 0%, #2d2419 60%, #1a1612 100%)" }}>
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
          className="w-full max-w-sm"
        >
          {/* Logo */}
          <div className="flex items-center justify-center gap-2.5 mb-8">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center overflow-hidden"
              style={{ background: "rgba(200,149,42,0.12)", border: "1px solid rgba(200,149,42,0.25)" }}>
              <img src={`${basePath}/castores-logo.jpeg`} alt="CASTORES" className="h-8 w-auto object-contain" />
            </div>
            <span className="font-black text-white uppercase tracking-widest text-lg"
              style={{ fontFamily: "'Bebas Neue', sans-serif" }}>Castores Control</span>
          </div>

          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.15 }}
            className="text-[10px] uppercase tracking-[0.3em] font-medium mb-3 text-center"
            style={{ color: "rgba(255,255,255,0.45)" }}
          >
            🏗️ Has sido invitado
          </motion.p>

          <motion.h1
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.25, duration: 0.5 }}
            className="text-white text-[clamp(2.2rem,7vw,3rem)] leading-[0.95] font-black uppercase tracking-wide text-center mb-4"
            style={{ fontFamily: "'Bebas Neue', sans-serif", textShadow: "0 2px 20px rgba(0,0,0,0.4)" }}
          >
            Bienvenido a<br />Castores
          </motion.h1>

          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.4, duration: 0.4 }}
            className="rounded-2xl p-4 mb-5"
            style={{ background: "rgba(200,149,42,0.10)", border: "1.5px solid rgba(200,149,42,0.35)" }}
          >
            <div className="flex items-center gap-3">
              <span className="text-3xl">{roleIcon}</span>
              <div className="flex-1">
                <p className="text-[10px] uppercase tracking-widest font-semibold mb-0.5"
                  style={{ color: "#C8952A" }}>
                  Rol asignado
                </p>
                <p className="text-white font-bold text-base">{roleLabel}</p>
              </div>
            </div>
            {splash.invitedBy && (
              <p className="text-[11px] mt-3 pt-3 border-t" style={{ color: "rgba(255,255,255,0.5)", borderColor: "rgba(255,255,255,0.08)" }}>
                Te invitó: <span className="font-semibold text-white/80">{splash.invitedBy}</span>
                {splash.label ? <> · <span style={{ color: "rgba(255,255,255,0.4)" }}>{splash.label}</span></> : null}
              </p>
            )}
          </motion.div>

          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.55 }}
            className="text-sm leading-relaxed text-center mb-6"
            style={{ color: "rgba(255,255,255,0.65)" }}
          >
            {roleIntro}
          </motion.p>

          <motion.button
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.7 }}
            whileHover={{ y: -1 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => setSplash({ status: "dismissed", code: splash.code, role: splash.role })}
            className="w-full py-3.5 rounded-2xl text-sm font-bold"
            style={{
              background: "linear-gradient(135deg, #C8952A, #E8A830)",
              color: "white",
              boxShadow: "0 4px 20px rgba(200,149,42,0.35)",
            }}
          >
            Continuar con mi registro →
          </motion.button>

          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.85 }}
            className="text-[10px] mt-5 text-center"
            style={{ color: "rgba(255,255,255,0.3)" }}
          >
            Tu invitación es de un solo uso y queda vinculada a tu correo.
          </motion.p>
        </motion.div>
      </div>
    );
  }
  if (splash.status === "invalid") {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-5"
        style={{ background: "linear-gradient(135deg, #1a1612 0%, #2d2419 60%, #1a1612 100%)" }}>
        <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-sm text-center">
          <div className="text-5xl mb-6">❌</div>
          <h1 className="text-white font-black text-2xl mb-3"
            style={{ fontFamily: "'Bebas Neue', sans-serif", letterSpacing: "0.04em" }}>
            Invitación inválida
          </h1>
          <p className="text-sm mb-6 leading-relaxed" style={{ color: "rgba(255,255,255,0.55)" }}>
            La clave <span className="font-mono text-amber-400 font-bold">{splash.code}</span> no es válida o ya fue utilizada.
          </p>
          <p className="text-xs mb-6" style={{ color: "rgba(255,255,255,0.35)" }}>
            Pídele a tu administrador que te genere una nueva clave o que revise el link de invitación.
          </p>
          <button
            onClick={() => {
              try { localStorage.removeItem("castores_invite_code"); } catch { /* ignore */ }
              window.location.assign(basePath ? `${basePath}/` : "/");
            }}
            className="w-full py-3.5 rounded-2xl text-sm font-bold"
            style={{ background: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.7)", border: "1px solid rgba(255,255,255,0.12)" }}>
            ← Volver al inicio
          </button>
        </motion.div>
      </div>
    );
  }

  // ── Form step ─────────────────────────────────────────────────────────────
  const isStandalone = typeof window !== "undefined" &&
    (window.matchMedia("(display-mode: standalone)").matches || (window.navigator as { standalone?: boolean }).standalone === true);
  const detectedIOS = typeof window !== "undefined" && /iphone|ipad|ipod/i.test(window.navigator.userAgent);

  return (
    <div className="min-h-screen bg-[#f8f4ef] overflow-y-auto">
      <div className="flex flex-col items-center px-4 py-8 max-w-sm mx-auto">

        {/* Logo + bienvenida */}
        <img src={`${basePath}/castores-logo.jpeg`} alt="Castores" className="w-16 h-16 rounded-2xl object-cover shadow mb-3" />
        <h1 className="text-2xl font-bold text-gray-900 text-center">Bienvenido a Castores</h1>
        <p className="text-sm text-gray-500 text-center mt-1 mb-5">Tu plataforma de gestión de obra</p>

        {/* Banner instalar PWA con toggle iOS / Android */}
        {!isStandalone && <PwaInstallBanner defaultIOS={detectedIOS} />}

        {/* Pasos del proceso */}
        <div className="w-full mb-5">
          <p className="text-xs uppercase tracking-wider text-gray-400 font-semibold mb-3 text-center">Cómo funciona el registro</p>
          <div className="flex flex-col gap-2">
            {[
              { n: "1", title: "Llena tus datos", desc: "Nombre, apellido y correo electrónico" },
              { n: "2", title: "Revisa tu correo", desc: "Te enviamos un código de 6 dígitos — ve a tu correo, cópialo y regresa aquí" },
              { n: "3", title: "¡Listo!", desc: "Ingresa el código y entra a la plataforma" },
            ].map(s => (
              <div key={s.n} className="flex items-start gap-3 bg-white rounded-xl px-4 py-3"
                style={{ border: "1px solid rgba(0,0,0,0.06)" }}>
                <span className="flex-shrink-0 w-6 h-6 rounded-full text-xs font-bold flex items-center justify-center text-white"
                  style={{ background: "#C8952A" }}>{s.n}</span>
                <div>
                  <p className="text-sm font-semibold text-gray-800">{s.title}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{s.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Formulario */}
        <form onSubmit={handleSubmitForm} className="w-full bg-white rounded-2xl shadow-sm border border-gray-100 p-6 space-y-3">
          <div className="flex gap-2">
            <input type="text" value={firstName} onChange={e => setFirstName(e.target.value)} placeholder="Nombre" required className={inputCls} />
            <input type="text" value={lastName} onChange={e => setLastName(e.target.value)} placeholder="Apellido" required className={inputCls} />
          </div>
          <div>
            <input
              ref={emailInputRef}
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value.trim().toLowerCase())}
              onInput={e => setEmail((e.target as HTMLInputElement).value.trim().toLowerCase())}
              onBlur={e => setEmail(e.target.value.trim().toLowerCase())}
              placeholder="Correo electrónico"
              required
              // CRITICAL: every browser's "email" autocomplete kept silently
              // swapping the typed address for a previously-used one. Setting
              // autoComplete=off + password-manager opt-outs + reading the
              // DOM at submit time gives deterministic submission of whatever
              // is actually visible in the field. The preview below ALWAYS
              // shows that value, so the user can spot a swap before pressing
              // Continuar.
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              inputMode="email"
              name="castores-signup-email-fresh"
              data-form-type="other"
              data-lpignore="true"
              data-1p-ignore
              className={inputCls}
            />
            {email && (
              <p className="text-[11px] text-gray-500 mt-1.5 leading-snug">
                Te enviaremos el código a <span className="font-semibold text-gray-800 break-all">{email}</span>.
                Verifica que esté correcto antes de continuar.
              </p>
            )}
          </div>
          <div>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="Contraseña (mínimo 8 caracteres)"
              autoComplete="new-password"
              minLength={PASSWORD_MIN}
              required
              className={inputCls}
            />
            <p className="text-[11px] text-gray-500 mt-1.5 leading-snug">
              Esta contraseña te permitirá <strong>volver a entrar</strong> en cualquier momento desde "Iniciar sesión".
            </p>
          </div>
          <label className="flex items-start gap-2.5 cursor-pointer pt-1">
            <input
              type="checkbox"
              checked={acceptTerms}
              onChange={(e) => setAcceptTerms(e.target.checked)}
              className="mt-0.5 w-4 h-4 rounded border-gray-300 text-amber-600 focus:ring-amber-500"
            />
            <span className="text-[11px] leading-snug text-gray-600">
              Acepto los{" "}
              <a href={`${basePath}/legal/terminos`} target="_blank" rel="noopener noreferrer" className="text-amber-700 underline">Términos de Uso</a>
              {" "}y la{" "}
              <a href={`${basePath}/legal/privacidad`} target="_blank" rel="noopener noreferrer" className="text-amber-700 underline">Política de Privacidad</a>.
            </span>
          </label>
          {error && (
            <div className="text-sm text-red-600">
              {error}{" "}
              {emailTaken && (
                <a href={`${basePath}/sign-in`} className="font-semibold underline text-amber-700">
                  Inicia sesión →
                </a>
              )}
            </div>
          )}
          <button type="submit" disabled={busy || !acceptTerms} className={`${btnPrimary} mt-1`}>
            {busy ? "Creando tu cuenta..." : "Completar registro →"}
          </button>
        </form>

        <p className="text-center text-sm text-gray-500 mt-4">
          ¿Ya tienes cuenta?{" "}
          <a href={`${basePath}/sign-in`} className="text-amber-700 font-medium hover:text-amber-900">Inicia sesión</a>
        </p>
      </div>
    </div>
  );
}

function ClerkQueryClientCacheInvalidator() {
  const { addListener } = useClerk();
  const qc = useQueryClient();
  const prevUserIdRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    const unsubscribe = addListener(({ user }) => {
      const userId = user?.id ?? null;
      if (prevUserIdRef.current !== undefined && prevUserIdRef.current !== userId) {
        qc.clear();
      }
      prevUserIdRef.current = userId;
    });
    return unsubscribe;
  }, [addListener, qc]);

  return null;
}

/** Syncs Clerk token with the API client.
 *  Uses useLayoutEffect so auth is set before any child-component effects
 *  (e.g. React Query queryFn) can fire — prevents race-condition 403s. */
function AuthSync() {
  const { getToken } = useClerkAuth();
  const { isSignedIn, user: clerkUser } = useUser();

  useLayoutEffect(() => {
    if (isSignedIn) {
      setDemoMode(false);
      setAuthTokenGetter(() => getToken());
      setClerkUserInfo(
        clerkUser?.id ?? null,
        clerkUser?.primaryEmailAddress?.emailAddress ?? null,
      );
    } else {
      setDemoMode(false);
      setAuthTokenGetter(null);
      setClerkUserInfo(null, null);
    }
  }, [isSignedIn, getToken, clerkUser]);

  return null;
}

type ApprovalStatus = "loading" | "not_registered" | "pending" | "rejected" | "approved" | "error";

/**
 * Checks DB approval status for Clerk-authenticated users before rendering
 * protected content. Redirects to complete-profile / pending / rejected as needed.
 */
function ApprovalGate({ children }: { children: React.ReactNode }) {
  const { isLoaded, isSignedIn, user: clerkUser } = useUser();
  const { getToken } = useClerkAuth();
  const { setRealUser } = useAuth();
  const [, setLocation] = useLocation();
  const [status, setStatus] = useState<ApprovalStatus>("loading");
  const [retryTick, setRetryTick] = useState(0);

  // Stable primitives only — avoids re-running the effect on every render.
  // getToken is kept in a ref so it stays out of the dep array (Clerk recreates
  // the function reference on each render, causing an infinite poll loop).
  const clerkUserId = clerkUser?.id ?? null;
  const clerkUserEmail = clerkUser?.primaryEmailAddress?.emailAddress ?? null;
  const getTokenRef = useRef(getToken);
  getTokenRef.current = getToken;
  const setRealUserRef = useRef(setRealUser);
  setRealUserRef.current = setRealUser;

  useEffect(() => {
    if (!isLoaded) return;

    if (!isSignedIn) {
      setStatus("loading");
      return;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10_000);

    (async () => {
      try {
        const token = await getTokenRef.current();
        const params = new URLSearchParams({
          clerkId: clerkUserId ?? "",
          email: clerkUserEmail ?? "",
        });
        const res = await fetch(`${apiUrl(`/api/auth/clerk-me`)}?${params}`, {
          signal: controller.signal,
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        });

        if (res.status === 404) { setStatus("not_registered"); return; }
        if (!res.ok) { setStatus("error"); return; }

        const dbUser = await res.json();

        if (dbUser.approvalStatus === "approved") {
          setRealUserRef.current({
            id: dbUser.id,
            name: dbUser.name,
            email: dbUser.email,
            role: dbUser.role,
            company: dbUser.company ?? "",
            avatarUrl: dbUser.avatarUrl ?? null,
            isActive: dbUser.isActive,
          });
        }

        if (dbUser.approvalStatus === "pending") setStatus("pending");
        else if (dbUser.approvalStatus === "rejected") setStatus("rejected");
        else setStatus("approved");
      } catch (e: any) {
        if (!controller.signal.aborted) setStatus("error");
      } finally {
        clearTimeout(timeoutId);
      }
    })();

    return () => { controller.abort(); clearTimeout(timeoutId); };
  }, [isLoaded, isSignedIn, clerkUserId, clerkUserEmail, retryTick]);

  useEffect(() => {
    if (status === "not_registered") setLocation("/complete-profile");
    else if (status === "pending") setLocation("/pending-approval");
    else if (status === "rejected") setLocation("/cuenta-rechazada");
  }, [status, setLocation]);

  if (status === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f8f4ef]">
        <div className="animate-spin rounded-full h-10 w-10 border-4 border-amber-500 border-t-transparent" />
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[#f8f4ef] gap-4 p-6 text-center">
        <p className="text-sm text-gray-600">No se pudo verificar tu acceso. Revisa tu conexión e intenta de nuevo.</p>
        <button
          onClick={() => { setStatus("loading"); setRetryTick(t => t + 1); }}
          className="px-5 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-semibold text-sm transition"
        >
          Reintentar
        </button>
      </div>
    );
  }

  if (status !== "approved") return null;

  return <>{children}</>;
}

function ProtectedRoute({ component: Component }: { component: React.ComponentType }) {
  const { isLoaded, isSignedIn } = useUser();
  // On PWA relaunch, Clerk reinitializes from storage and the token refresh is
  // async. isSignedIn can briefly be false while a valid session is being
  // confirmed. Give it up to 2 s before redirecting to the login page.
  const [graceDone, setGraceDone] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setGraceDone(true), 2000);
    return () => clearTimeout(t);
  }, []);

  if (!isLoaded || (!isSignedIn && !graceDone)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f8f4ef]">
        <div className="animate-spin rounded-full h-10 w-10 border-4 border-amber-500 border-t-transparent" />
      </div>
    );
  }

  if (!isSignedIn) {
    return <Redirect to="/" />;
  }

  return (
    <ApprovalGate>
      <Component />
    </ApprovalGate>
  );
}

/** /invite/:code — captures the code, stores it, then sends to Clerk sign-up */
function InvitePage() {
  const [, navigate] = useLocation();

  useEffect(() => {
    // Read code from path segment (/invite/XXXX) or query param (?code=XXXX)
    const pathCode = window.location.pathname.split("/invite/")[1]?.split("?")[0]?.toUpperCase();
    const queryCode = new URLSearchParams(window.location.search).get("code")?.toUpperCase();
    const code = pathCode || queryCode;
    if (code) {
      localStorage.setItem("castores_invite_code", code);
    }
    navigate("/sign-up", { replace: true });
  }, []);

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

/**
 * Detects an in-progress Clerk sign-up (e.g. user left app to check OTP email)
 * and redirects back to /sign-up so the OTP entry form reappears automatically.
 * This handles iOS PWA reloading to "/" when the user switches back from Mail.
 */
function SignUpGuard() {
  const { isLoaded: userLoaded, isSignedIn } = useUser();
  const { isLoaded: signUpLoaded, signUp } = useSignUp();
  const [location, navigate] = useLocation();

  useEffect(() => {
    if (!userLoaded || !signUpLoaded) return;

    if (isSignedIn) {
      localStorage.removeItem("castores_signup_step");
      localStorage.removeItem("castores_signup_email");
      return;
    }

    const clerkPending = signUp?.status === "missing_requirements";
    const localPending = localStorage.getItem("castores_signup_step") === "otp";

    // If localStorage says OTP is pending but Clerk has no active signup session,
    // the data is stale (e.g. old registration abandoned, PWA reinstalled).
    // Clear it so users are not trapped on the OTP screen when they want to sign in.
    if (localPending && !clerkPending) {
      localStorage.removeItem("castores_signup_step");
      localStorage.removeItem("castores_signup_email");
      return;
    }

    // Never redirect away from the public landing ("/") or from public/legal
    // pages. A stale Clerk missing_requirements session (e.g. an abandoned
    // signup from days ago) would otherwise hijack the user when they tap a
    // "Términos de uso" or "Política de privacidad" link mid-registration —
    // they need to be able to read those pages without being thrown back to
    // the OTP screen.
    const isPublicReadOnlyPath =
      location === "/" ||
      location.startsWith("/sign-up") ||
      location.startsWith("/complete-profile") ||
      location.startsWith("/sign-in") ||
      location.startsWith("/legal/") ||
      location === "/legal" ||
      location === "/faq" ||
      location === "/explorar" ||
      location.startsWith("/invite/") ||
      location.startsWith("/api/invite/");
    if (clerkPending && !isPublicReadOnlyPath) {
      navigate("/sign-up", { replace: true });
    }
  }, [userLoaded, signUpLoaded, isSignedIn, signUp?.status, location, navigate]);

  return null;
}

function Router() {
  return (
    <Suspense fallback={<RouteFallback />}>
    <Switch>
      {/* Public routes */}
      <Route path="/invite/:code" component={InvitePage} />
      <Route path="/api/invite/:code" component={InvitePage} />
      <Route path="/" component={Login} />
      <Route path="/explorar" component={Explorar} />
      <Route path="/sign-in/*?" component={SignInPage} />
      <Route path="/sign-up/*?" component={SignUpPage} />
      <Route path="/forgot-password" component={ForgotPasswordPage} />
      <Route path="/reset-password" component={ResetPasswordPage} />
      <Route path="/admin-access" component={AdminAccessPage} />

      {/* Post-signup flow */}
      <Route path="/complete-profile" component={CompleteProfile} />
      <Route path="/pending-approval" component={PendingApproval} />
      <Route path="/cuenta-rechazada" component={CuentaRechazada} />

      {/* Protected routes */}
      <Route path="/dashboard">
        {() => <ProtectedRoute component={Dashboard} />}
      </Route>
      <Route path="/projects">
        {() => <ProtectedRoute component={Projects} />}
      </Route>
      <Route path="/projects/:id">
        {() => <ProtectedRoute component={ProjectDetail} />}
      </Route>
      <Route path="/bitacora">
        {() => <ProtectedRoute component={Bitacora} />}
      </Route>
      <Route path="/bitacora/new">
        {() => <ProtectedRoute component={NewBitacoraEntry} />}
      </Route>
      <Route path="/bitacora/:id">
        {() => <ProtectedRoute component={BitacoraDetail} />}
      </Route>
      <Route path="/materiales">
        {() => <ProtectedRoute component={Materiales} />}
      </Route>
      <Route path="/documentos">
        {() => <ProtectedRoute component={Documentos} />}
      </Route>
      <Route path="/reportes">
        {() => <ProtectedRoute component={Reportes} />}
      </Route>
      <Route path="/usuarios">
        {() => <ProtectedRoute component={Usuarios} />}
      </Route>
      <Route path="/notificaciones">
        {() => <ProtectedRoute component={Notificaciones} />}
      </Route>
      <Route path="/admin">
        {() => <ProtectedRoute component={AdminPanel} />}
      </Route>
      <Route path="/cuenta">
        {() => <ProtectedRoute component={Cuenta} />}
      </Route>
      <Route path="/faq" component={FAQ} />
      <Route path="/legal/terminos" component={Terminos} />
      <Route path="/legal/privacidad" component={Privacidad} />
      <Route component={NotFound} />
    </Switch>
    </Suspense>
  );
}

function ClerkProviderWithRoutes() {
  const [, setLocation] = useLocation();

  return (
    <ClerkProvider
      publishableKey={clerkPubKey!}
      proxyUrl={resolvedClerkProxyUrl}
      routerPush={(to) => setLocation(stripBase(to))}
      routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
    >
      <QueryClientProvider client={queryClient}>
        <ClerkQueryClientCacheInvalidator />
        <TooltipProvider>
          <AuthProvider>
            <AuthSync />
            <SignUpGuard />
            <Router />
          </AuthProvider>
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ClerkProvider>
  );
}

function App() {
  if (!clerkPubKey) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f8f4ef] px-6">
        <div className="max-w-lg rounded-2xl border border-amber-200 bg-white p-6 text-center">
          <h1 className="text-xl font-bold text-[#1a1612]">Configuracion pendiente de autenticacion</h1>
          <p className="mt-2 text-sm text-[#5b5146]">
            El demo esta listo para Vercel, pero falta configurar Clerk. Agrega
            `VITE_CLERK_PUBLISHABLE_KEY` en las Environment Variables del proyecto web.
          </p>
        </div>
      </div>
    );
  }

  return (
    <WouterRouter base={basePath}>
      <ClerkProviderWithRoutes />
    </WouterRouter>
  );
}

export default App;
