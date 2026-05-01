import { Switch, Route, Router as WouterRouter, useLocation, Redirect } from "wouter";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/lib/auth";
import { ClerkProvider, SignIn, useUser, useClerk, useAuth as useClerkAuth } from "@clerk/react";
import { useSignUp } from "@clerk/react/legacy";
import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { setBaseUrl, setDemoMode, setAuthTokenGetter, setClerkUserInfo } from "@workspace/api-client-react";
import { apiUrl } from "@/lib/api-url";
import NotFound from "@/pages/not-found";
import Login from "@/pages/login";
import Dashboard from "@/pages/dashboard";
import Projects from "@/pages/projects/index";
import ProjectDetail from "@/pages/projects/[id]";
import Bitacora from "@/pages/bitacora/index";
import NewBitacoraEntry from "@/pages/bitacora/new";
import BitacoraDetail from "@/pages/bitacora/[id]";
import Materiales from "@/pages/materiales";
import Documentos from "@/pages/documentos";
import Reportes from "@/pages/reportes";
import Usuarios from "@/pages/usuarios";
import Notificaciones from "@/pages/notificaciones";
import Explorar from "@/pages/explorar";
import CompleteProfile from "@/pages/complete-profile";
import PendingApproval from "@/pages/pending-approval";
import CuentaRechazada from "@/pages/cuenta-rechazada";
import AdminPanel from "@/pages/admin";
import Cuenta from "@/pages/cuenta";
import FAQ from "@/pages/faq";
import Terminos from "@/pages/legal-terminos";
import Privacidad from "@/pages/legal-privacidad";
import AdminAccessPage from "@/pages/admin-access";

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
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#f8f4ef]">
      <SignIn
        routing="path"
        path={`${basePath}/sign-in`}
        signUpUrl={`${basePath}/sign-up`}
        fallbackRedirectUrl={`${basePath}/dashboard`}
        appearance={clerkAppearance}
      />
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
  const [error, setError] = useState<string | null>(null);
  const [emailTaken, setEmailTaken] = useState(false);
  const [resendOk, setResendOk] = useState(false);
  const [busy, setBusy] = useState(false);
  // Synchronous double-tap guard: setBusy schedules a state update but on a fast
  // double-tap (especially iOS PWA) both handlers fire before React re-renders
  // and both see busy=false. A ref is read/written synchronously, so the second
  // tap bails out immediately.
  const verifyingRef = useRef(false);
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
      ["castores_signup_step","castores_signup_email","castores_invite_code","castores_real_user","castores_signup_pending"]
        .forEach(k => { try { localStorage.removeItem(k); } catch { /* ignore */ } });
      signOut().catch(() => {}).finally(() => setPurgingSession(false));
    }
  }, [isLoaded, signUpLoaded, isSignedIn, signUp?.status, signOut]);

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
    if (!signUp || busy) return;
    if (!password || password.length < PASSWORD_MIN) {
      setError(`La contraseña debe tener al menos ${PASSWORD_MIN} caracteres.`);
      return;
    }
    setBusy(true);
    setError(null);

    // Write localStorage BEFORE calling Clerk — prevents iOS race condition
    // where the app is killed between the button tap and the server response
    localStorage.setItem("castores_signup_step", "otp");
    localStorage.setItem("castores_signup_email", email);

    try {
      const resource = await signUp.create({
        emailAddress: email,
        password,
        ...(firstName ? { firstName } : {}),
        ...(lastName ? { lastName } : {}),
      });
      // Use the returned resource — the hook's signUp ref is stale after create()
      await resource.prepareVerification({ strategy: "email_code" });
      setStep("otp");
    } catch (err) {
      localStorage.removeItem("castores_signup_step");
      const { msg, isEmailTaken } = parseClerkError(err);
      if (isEmailTaken) {
        setEmailTaken(true);
        setError("Este correo ya está registrado.");
      } else if (msg.toLowerCase().includes("password") || msg.toLowerCase().includes("contraseña")) {
        setShowPassword(true);
        setError(msg || "La contraseña no cumple los requisitos. Usa al menos 8 caracteres.");
      } else {
        setError(msg);
      }
    } finally {
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
      // OTP verified but Clerk still needs more fields (e.g. username/phone
      // required by instance settings). Without surfacing this the user thinks
      // the click did nothing while the abandoned signup is silently discarded.
      const missing = (result as unknown as { missingFields?: string[]; unverifiedFields?: string[] }).missingFields ?? [];
      const unverified = (result as unknown as { unverifiedFields?: string[] }).unverifiedFields ?? [];
      // eslint-disable-next-line no-console
      console.error("[signup] attemptVerification did not complete", { status: result.status, missing, unverified, result });
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

  const handleResend = async () => {
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
            <button onClick={handleResend} className="text-sm text-amber-700 hover:text-amber-900 font-medium">
              ¿No llegó el código? Reenviar
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
          <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="Correo electrónico" required autoComplete="email" className={inputCls} />
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
          <button type="submit" disabled={busy} className={`${btnPrimary} mt-1`}>
            {busy ? "Enviando código..." : "Continuar →"}
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

    // Never redirect away from the public landing ("/"). A stale Clerk
    // missing_requirements session (e.g. an abandoned signup from days ago)
    // would otherwise trap the user in an OTP screen that no longer applies.
    // From "/" the user can choose Iniciar sesión or Solicitar acceso themselves.
    if (
      clerkPending &&
      location !== "/" &&
      !location.startsWith("/sign-up") &&
      !location.startsWith("/complete-profile") &&
      !location.startsWith("/sign-in")
    ) {
      navigate("/sign-up", { replace: true });
    }
  }, [userLoaded, signUpLoaded, isSignedIn, signUp?.status, location, navigate]);

  return null;
}

function Router() {
  return (
    <Switch>
      {/* Public routes */}
      <Route path="/invite/:code" component={InvitePage} />
      <Route path="/api/invite/:code" component={InvitePage} />
      <Route path="/" component={Login} />
      <Route path="/explorar" component={Explorar} />
      <Route path="/sign-in/*?" component={SignInPage} />
      <Route path="/sign-up/*?" component={SignUpPage} />
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
