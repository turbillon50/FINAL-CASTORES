import { useEffect, useState, type FormEvent } from "react";
import { useLocation } from "wouter";
import {
  clearWorkerSession,
  getWorkerToken,
  getWorkerUser,
  markPinChanged,
  workerFetch,
} from "@/lib/worker-session";

/**
 * Cambio de PIN tipo cajero.
 *
 * Dos modos según `pinMustChange` de la sesión:
 *   - true  → primer login después de alta/reset. NO pide PIN actual
 *             (acaba de entrar con él, ya está validado). Solo pide
 *             nuevo + confirmar.
 *   - false → cambio voluntario. Pide PIN actual + nuevo + confirmar.
 *             El backend throttle bloquea 15 min tras 3 fallos.
 */
export default function WorkerChangePinPage() {
  const [, setLocation] = useLocation();
  const user = getWorkerUser();
  const mustChange = user?.pinMustChange === true;

  const [currentPin, setCurrentPin] = useState("");
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!getWorkerToken() || !user) setLocation("/check/login");
  }, [setLocation, user]);

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (busy) return;
    if (!mustChange && currentPin.length !== 4) {
      setError("Captura tu PIN actual de 4 dígitos.");
      return;
    }
    if (newPin.length !== 4) {
      setError("El nuevo PIN debe ser de 4 dígitos.");
      return;
    }
    if (newPin !== confirmPin) {
      setError("Los dos PINs nuevos no coinciden.");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const res = await workerFetch("/api/attendance/me/change-pin", {
        method: "POST",
        body: JSON.stringify({
          currentPin: mustChange ? undefined : currentPin,
          newPin,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401 && !mustChange) {
        setError(data?.error || "PIN actual incorrecto.");
        setBusy(false);
        return;
      }
      if (res.status === 429) {
        setError(data?.error || "Demasiados intentos. Espera unos minutos.");
        setBusy(false);
        return;
      }
      if (!res.ok) {
        setError(data?.error || "No se pudo cambiar el PIN.");
        setBusy(false);
        return;
      }
      markPinChanged();
      setLocation("/check");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Error de red");
      setBusy(false);
    }
  };

  const inputCls =
    "w-full text-center text-3xl tracking-[0.6em] font-mono py-4 rounded-2xl";
  const inputStyle = {
    background: "rgba(255,255,255,0.08)",
    border: "1.5px solid rgba(255,60,0,0.3)",
    color: "#fff",
  } as const;

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center px-6 py-8"
      style={{ background: "linear-gradient(160deg, #141414 0%, #262626 60%, #141414 100%)" }}
    >
      <div className="w-full max-w-sm">
        <div className="text-center mb-6">
          <div
            className="inline-flex items-center justify-center w-16 h-16 rounded-2xl mb-4"
            style={{ background: "rgba(255,60,0,0.15)", border: "1px solid rgba(255,60,0,0.4)" }}
          >
            <span className="text-3xl">🔐</span>
          </div>
          <h1 className="text-white font-black text-2xl tracking-tight">
            {mustChange ? "Cambia tu PIN inicial" : "Cambiar mi PIN"}
          </h1>
          <p className="text-sm mt-2" style={{ color: "rgba(255,255,255,0.55)" }}>
            {mustChange
              ? "El PIN que te dio el admin es de un solo uso. Elige uno nuevo que solo tú sepas."
              : "Tu PIN actual + el nuevo (dos veces para confirmar)."}
          </p>
        </div>

        {user && (
          <div
            className="mb-5 px-3 py-2 rounded-xl text-center"
            style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}
          >
            <p
              className="text-[10px] uppercase tracking-widest font-bold"
              style={{ color: "rgba(255,255,255,0.4)" }}
            >
              {user.workerCode}
            </p>
            <p className="text-white font-bold text-sm leading-tight">{user.name}</p>
          </div>
        )}

        <form onSubmit={onSubmit} className="space-y-4">
          {!mustChange && (
            <div>
              <label
                className="block text-[11px] font-bold uppercase tracking-widest mb-1.5"
                style={{ color: "rgba(255,255,255,0.45)" }}
              >
                PIN actual
              </label>
              <input
                type="password"
                value={currentPin}
                onChange={(e) => setCurrentPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
                placeholder="••••"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={4}
                className={inputCls}
                style={inputStyle}
                data-testid="input-current-pin"
              />
            </div>
          )}

          <div>
            <label
              className="block text-[11px] font-bold uppercase tracking-widest mb-1.5"
              style={{ color: "rgba(255,255,255,0.45)" }}
            >
              Nuevo PIN
            </label>
            <input
              type="password"
              value={newPin}
              onChange={(e) => setNewPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
              placeholder="••••"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={4}
              className={inputCls}
              style={inputStyle}
              data-testid="input-new-pin"
            />
          </div>

          <div>
            <label
              className="block text-[11px] font-bold uppercase tracking-widest mb-1.5"
              style={{ color: "rgba(255,255,255,0.45)" }}
            >
              Confirmar PIN
            </label>
            <input
              type="password"
              value={confirmPin}
              onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
              placeholder="••••"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={4}
              className={inputCls}
              style={inputStyle}
              data-testid="input-confirm-pin"
            />
          </div>

          {error && (
            <div
              className="rounded-xl px-4 py-3 text-sm font-medium text-center"
              style={{ background: "rgba(220,38,38,0.15)", border: "1px solid rgba(220,38,38,0.35)", color: "#fca5a5" }}
            >
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={busy || newPin.length !== 4 || confirmPin.length !== 4 || (!mustChange && currentPin.length !== 4)}
            className="w-full py-4 rounded-2xl text-base font-black tracking-wide disabled:opacity-40 transition-all"
            style={{
              background: "linear-gradient(135deg, #FF3C00, #E8A830)",
              color: "white",
              boxShadow: "0 4px 20px rgba(255,60,0,0.35)",
            }}
            data-testid="button-change-pin"
          >
            {busy ? "Guardando..." : "Guardar PIN"}
          </button>

          {!mustChange && (
            <button
              type="button"
              onClick={() => setLocation("/check")}
              className="block w-full text-center text-xs"
              style={{ color: "rgba(255,255,255,0.45)" }}
            >
              Volver
            </button>
          )}
        </form>

        {mustChange && (
          <p className="text-center text-xs mt-6" style={{ color: "rgba(255,255,255,0.3)" }}>
            ¿Olvidaste el PIN inicial? Pide a tu admin que lo resetee.{" "}
            <button
              onClick={() => {
                clearWorkerSession();
                setLocation("/check/login");
              }}
              className="underline"
            >
              Salir
            </button>
          </p>
        )}
      </div>
    </div>
  );
}
