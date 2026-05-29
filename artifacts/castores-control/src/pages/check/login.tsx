import { useEffect, useState, type FormEvent } from "react";
import { useLocation } from "wouter";
import { loginWorker, getWorkerToken } from "@/lib/worker-session";

/**
 * Login del trabajador operativo. No usa Clerk — pide código (CAS-XXXX)
 * y PIN de 4 dígitos. Pensado para celulares: inputs grandes, sin
 * teclado complicado, una sola pantalla. Después del login redirige
 * a /check (PWA de check-in/out).
 */
export default function WorkerLoginPage() {
  const [, setLocation] = useLocation();
  const [code, setCode] = useState("");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Auto-llenado vía deeplink: el admin manda
  //   /check/login?code=CAS-7421&pin=4829
  // por WhatsApp; al abrir, ambos campos quedan listos para tap.
  useEffect(() => {
    if (getWorkerToken()) {
      setLocation("/check");
      return;
    }
    const params = new URLSearchParams(window.location.search);
    const qCode = params.get("code");
    const qPin = params.get("pin");
    if (qCode) setCode(qCode.toUpperCase().replace(/[^A-Z0-9-]/g, ""));
    if (qPin) setPin(qPin.replace(/\D/g, "").slice(0, 4));
  }, [setLocation]);

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (busy) return;
    const normalized = code.trim().toUpperCase();
    if (!normalized || pin.length !== 4) {
      setError("Captura tu código (ej. CAS-1234) y tu PIN de 4 dígitos.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const u = await loginWorker(normalized, pin);
      // Si el admin acaba de crear/resetear, primero cambia tu PIN.
      setLocation(u.pinMustChange ? "/check/change-pin" : "/check");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "No pudimos iniciar sesión.");
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6 py-8"
      style={{ background: "linear-gradient(160deg, #141414 0%, #262626 60%, #141414 100%)" }}>
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl mb-4"
            style={{ background: "rgba(255,60,0,0.15)", border: "1px solid rgba(255,60,0,0.4)" }}>
            <span className="text-3xl">👷</span>
          </div>
          <h1 className="text-white font-black text-3xl tracking-tight">Marcar asistencia</h1>
          <p className="text-sm mt-2" style={{ color: "rgba(255,255,255,0.55)" }}>
            Ingresa tu código de trabajador y tu PIN.
          </p>
        </div>

        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label className="block text-[11px] font-bold uppercase tracking-widest mb-1.5"
              style={{ color: "rgba(255,255,255,0.45)" }}>
              Código de trabajador
            </label>
            <input
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, ""))}
              placeholder="CAS-1234"
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              inputMode="text"
              className="w-full text-center text-2xl font-mono font-bold tracking-[0.15em] py-4 rounded-2xl"
              style={{
                background: "rgba(255,255,255,0.08)",
                border: "1.5px solid rgba(255,60,0,0.3)",
                color: "#fff",
              }}
              data-testid="input-worker-code"
            />
          </div>

          <div>
            <label className="block text-[11px] font-bold uppercase tracking-widest mb-1.5"
              style={{ color: "rgba(255,255,255,0.45)" }}>
              PIN (4 dígitos)
            </label>
            <input
              type="password"
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
              placeholder="••••"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={4}
              autoComplete="one-time-code"
              className="w-full text-center text-3xl tracking-[0.6em] font-mono py-4 rounded-2xl"
              style={{
                background: "rgba(255,255,255,0.08)",
                border: "1.5px solid rgba(255,60,0,0.3)",
                color: "#fff",
              }}
              data-testid="input-worker-pin"
            />
          </div>

          {error && (
            <div className="rounded-xl px-4 py-3 text-sm font-medium text-center"
              style={{ background: "rgba(220,38,38,0.15)", border: "1px solid rgba(220,38,38,0.35)", color: "#fca5a5" }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={busy || pin.length !== 4 || !code}
            className="w-full py-4 rounded-2xl text-base font-black tracking-wide disabled:opacity-40 transition-all"
            style={{
              background: "linear-gradient(135deg, #FF3C00, #E8A830)",
              color: "white",
              boxShadow: "0 4px 20px rgba(255,60,0,0.35)",
            }}
            data-testid="button-worker-login"
          >
            {busy ? "Entrando..." : "Entrar →"}
          </button>
        </form>

        <p className="text-center text-xs mt-6" style={{ color: "rgba(255,255,255,0.3)" }}>
          ¿No tienes código? Pide a tu supervisor o admin que te dé de alta.
        </p>
      </div>
    </div>
  );
}
