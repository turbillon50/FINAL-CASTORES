import { Switch, Route, Router as WouterRouter, useLocation, Redirect } from "wouter";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/lib/auth";
import { ClerkProvider, SignIn, SignUp, useUser, useClerk, useAuth as useClerkAuth, useSignUp } from "@clerk/react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
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
    // Hide passkey prompts — users register with email/password only
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

function SignUpPage() {
  const { isLoaded, isSignedIn } = useUser();
  const { isLoaded: signUpLoaded, signUp } = useSignUp();
  const [, setLocation] = useLocation();

  // Capture invite code from URL query string (?code=XXXX) and persist to
  // localStorage so complete-profile can read it after Clerk sign-up.
  if (typeof window !== "undefined") {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    if (code) {
      localStorage.setItem("castores_invite_code", code.toUpperCase());
    }
  }

  // Persist OTP-pending state + email to localStorage so SignUpGuard can
  // redirect back here even when Clerk's own cookie was cleared by iOS.
  useEffect(() => {
    if (!signUpLoaded) return;
    if (signUp?.status === "missing_requirements") {
      localStorage.setItem("castores_signup_pending", "1");
      if (signUp.emailAddress) {
        localStorage.setItem("castores_signup_email", signUp.emailAddress);
      }
    } else if (!signUp || signUp.status === "abandoned" || signUp.status === "complete") {
      localStorage.removeItem("castores_signup_pending");
      localStorage.removeItem("castores_signup_email");
    }
  }, [signUpLoaded, signUp?.status, signUp?.emailAddress]);

  // If Clerk already has a valid session, send them to complete-profile.
  useEffect(() => {
    if (!isLoaded) return;
    if (isSignedIn) {
      localStorage.removeItem("castores_signup_pending");
      localStorage.removeItem("castores_signup_email");
      setLocation("/complete-profile");
    }
  }, [isLoaded, isSignedIn, setLocation]);

  if (!isLoaded || isSignedIn) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f8f4ef]">
        <div className="animate-spin rounded-full h-10 w-10 border-4 border-amber-500 border-t-transparent" />
      </div>
    );
  }

  // Pre-populate email if the user had to restart after iOS killed the PWA
  const savedEmail = typeof window !== "undefined"
    ? (localStorage.getItem("castores_signup_email") ?? undefined)
    : undefined;

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#f8f4ef]">
      <SignUp
        routing="path"
        path={`${basePath}/sign-up`}
        signInUrl={`${basePath}/sign-in`}
        fallbackRedirectUrl={`${basePath}/complete-profile`}
        appearance={clerkAppearance}
        initialValues={savedEmail ? { emailAddress: savedEmail } : undefined}
      />
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

type ApprovalStatus = "loading" | "not_registered" | "pending" | "rejected" | "approved";

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
      // Fail-closed: stay in loading so ProtectedRoute can redirect to "/"
      setStatus("loading");
      return;
    }

    // Clerk user — check DB registration & approval
    (async () => {
      try {
        const token = await getTokenRef.current();
        const params = new URLSearchParams({
          clerkId: clerkUserId ?? "",
          email: clerkUserEmail ?? "",
        });
        const res = await fetch(`${apiUrl(`/api/auth/clerk-me`)}?${params}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        });

        if (res.status === 404) {
          setStatus("not_registered");
          return;
        }

        if (!res.ok) {
          // Fail-closed: keep loading and let the user retry/refresh.
          // Previously this fell open, which let pending/rejected users in
          // whenever the backend hiccuped.
          setStatus("loading");
          return;
        }

        const dbUser = await res.json();

        // Persist real user identity so the app remembers name/role across sessions
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
      } catch {
        // Fail-closed: keep loading so ProtectedRoute redirects to "/"
        setStatus("loading");
      }
    })();
  }, [isLoaded, isSignedIn, clerkUserId, clerkUserEmail]);

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

  if (status !== "approved") return null;

  return <>{children}</>;
}

function ProtectedRoute({ component: Component }: { component: React.ComponentType }) {
  const { isLoaded, isSignedIn } = useUser();

  if (!isLoaded) {
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
      localStorage.removeItem("castores_signup_pending");
      localStorage.removeItem("castores_signup_email");
      return;
    }

    const clerkPending = signUp?.status === "missing_requirements";
    const localPending = localStorage.getItem("castores_signup_pending") === "1";

    if (
      (clerkPending || localPending) &&
      !location.startsWith("/sign-up") &&
      !location.startsWith("/complete-profile")
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
