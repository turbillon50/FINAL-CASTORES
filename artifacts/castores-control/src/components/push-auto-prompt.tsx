import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { getAuthToken } from "@workspace/api-client-react";
import { apiUrl } from "@/lib/api-url";

// Cuánto esperar antes de re-mostrar si el usuario lo cerró sin habilitar.
// 7 días: ni demasiado insistente ni se olvida del todo.
const REPROMPT_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

const STORAGE_KEYS = {
  dismissedAt: "castores_push_prompt_dismissed_at",
  iosShown: "castores_push_ios_instructions_shown",
};

function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent) && !("MSStream" in window);
}

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) ||
    (navigator as { standalone?: boolean }).standalone === true
  );
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function authedFetch(path: string, init?: RequestInit): Promise<Response> {
  const token = await getAuthToken().catch(() => null);
  const headers: Record<string, string> = { "Content-Type": "application/json", ...(init?.headers as Record<string, string> | undefined) };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return fetch(apiUrl(path), { ...init, headers, credentials: "include" });
}

type Mode =
  | "hidden"
  | "ask"          // navegador soportado, sin permiso pedido aún → CTA principal
  | "ios-pwa"     // iPhone Safari fuera de la PWA → instrucciones
  | "denied";     // usuario bloqueó: explicación de cómo reactivar

/**
 * Se monta en MainLayout. Decide si vale la pena mostrar el banner y
 * lo presenta una vez por sesión (re-mostrable cada 7 días si fue
 * dismissed). El componente queda invisible (return null) en casos:
 *  - Usuario no logueado o no aprobado.
 *  - Push ya activado (subscription existe).
 *  - Navegador sin soporte (no iOS y no PushManager).
 *  - Dismissed hace < 7 días.
 */
export function PushAutoPrompt() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [mode, setMode] = useState<Mode>("hidden");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!user) return;

    let cancelled = false;
    (async () => {
      try {
        const dismissedAtRaw = localStorage.getItem(STORAGE_KEYS.dismissedAt);
        const dismissedAt = dismissedAtRaw ? Number(dismissedAtRaw) : 0;
        if (Number.isFinite(dismissedAt) && Date.now() - dismissedAt < REPROMPT_AFTER_MS) {
          return; // dismissed reciente — respetamos
        }

        // iPhone fuera de la PWA: necesita instalar primero.
        if (isIOS() && !isStandalone()) {
          if (!cancelled) setMode("ios-pwa");
          return;
        }

        // Sin soporte de push (navegador exótico): no insistimos.
        if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
          return;
        }

        // Permiso ya bloqueado: ofrecemos guía para reactivarlo.
        if (Notification.permission === "denied") {
          if (!cancelled) setMode("denied");
          return;
        }

        // Permiso ya concedido: chequear si tiene subscription activa.
        // Si la tiene → no mostramos nada. Si no → ofrecemos un botón
        // que solo crea la subscription (no re-pide permiso, ya lo dio).
        if (Notification.permission === "granted") {
          const reg = await navigator.serviceWorker.ready;
          const existing = await reg.pushManager.getSubscription();
          if (!existing && !cancelled) setMode("ask");
          return;
        }

        // Permiso "default" (nunca preguntado): este es el caso clásico.
        if (!cancelled) setMode("ask");
      } catch {
        // Cualquier error en la detección → no mostramos. La página
        // /cuenta sigue teniendo el toggle como fallback.
      }
    })();

    return () => { cancelled = true; };
  }, [user]);

  const dismiss = () => {
    localStorage.setItem(STORAGE_KEYS.dismissedAt, String(Date.now()));
    setMode("hidden");
  };

  const enable = async () => {
    setBusy(true);
    try {
      const perm = await Notification.requestPermission();
      if (perm === "denied") {
        setMode("denied");
        return;
      }
      if (perm !== "granted") {
        setBusy(false);
        return;
      }

      const keyRes = await authedFetch("/api/push/public-key");
      if (!keyRes.ok) throw new Error("No se pudo obtener la configuración");
      const { publicKey } = await keyRes.json();
      if (!publicKey) throw new Error("Falta llave pública");

      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
      });

      const json = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
      const subRes = await authedFetch("/api/push/subscribe", {
        method: "POST",
        body: JSON.stringify({
          endpoint: json.endpoint,
          keys: { p256dh: json.keys?.p256dh, auth: json.keys?.auth },
          userAgent: navigator.userAgent,
        }),
      });
      if (!subRes.ok) throw new Error("El servidor rechazó la suscripción");

      toast({ title: "✅ Notificaciones activadas", description: "Recibirás los avisos como en una app nativa." });
      // Limpia el flag de dismissed para no volver a aparecer en este dispositivo.
      localStorage.setItem(STORAGE_KEYS.dismissedAt, String(Date.now()));
      setMode("hidden");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Inténtalo de nuevo.";
      toast({ title: "No pudimos activar las notificaciones", description: msg, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  if (!user || mode === "hidden") return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: 100 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 100 }}
        transition={{ type: "spring", stiffness: 380, damping: 30 }}
        className="fixed left-0 right-0 z-[60] pointer-events-none"
        style={{ bottom: "max(env(safe-area-inset-bottom), 16px)" }}
      >
        <div className="max-w-md mx-auto px-4">
          <div
            className="pointer-events-auto rounded-2xl p-4 shadow-2xl"
            style={{
              background: "linear-gradient(135deg, #1a1612 0%, #2d2419 100%)",
              border: "1px solid rgba(200,149,42,0.4)",
              boxShadow: "0 12px 40px rgba(0,0,0,0.4)",
            }}
          >
            <div className="flex items-start gap-3">
              <div
                className="w-11 h-11 rounded-xl flex items-center justify-center text-2xl shrink-0"
                style={{ background: "rgba(200,149,42,0.18)", border: "1px solid rgba(200,149,42,0.35)" }}
              >
                🔔
              </div>
              <div className="flex-1 min-w-0">
                {mode === "ask" && (
                  <>
                    <h3 className="text-white font-bold text-base leading-tight">Activa los avisos en este celular</h3>
                    <p className="text-white/65 text-xs mt-1 leading-relaxed">
                      Para que te llegue cada aviso del dueño con vibración y aparezca en la pantalla,
                      como cualquier app de mensajería.
                    </p>
                    <div className="flex gap-2 mt-3">
                      <button
                        onClick={enable}
                        disabled={busy}
                        className="flex-1 rounded-xl py-2.5 font-bold text-sm transition active:scale-[0.97] disabled:opacity-50"
                        style={{ background: "#C8952A", color: "#fff", boxShadow: "0 4px 14px rgba(200,149,42,0.4)" }}
                      >
                        {busy ? "Activando..." : "Activar"}
                      </button>
                      <button
                        onClick={dismiss}
                        disabled={busy}
                        className="rounded-xl px-4 py-2.5 font-semibold text-xs transition disabled:opacity-50"
                        style={{ color: "rgba(255,255,255,0.55)" }}
                      >
                        Después
                      </button>
                    </div>
                  </>
                )}

                {mode === "ios-pwa" && (
                  <>
                    <h3 className="text-white font-bold text-base leading-tight">Instala Castores en tu iPhone</h3>
                    <p className="text-white/65 text-xs mt-1 leading-relaxed">
                      iPhone solo permite avisos al celular si la app está en tu pantalla de inicio.
                      Es rápido:
                    </p>
                    <ol className="text-white/75 text-xs mt-2 space-y-1 list-decimal list-inside">
                      <li>Toca <strong>Compartir</strong> (cuadrado con flecha ↑)</li>
                      <li>Elige <strong>"Añadir a pantalla de inicio"</strong></li>
                      <li>Abre Castores desde el ícono nuevo</li>
                    </ol>
                    <div className="flex gap-2 mt-3">
                      <button
                        onClick={dismiss}
                        className="flex-1 rounded-xl py-2.5 font-bold text-sm transition"
                        style={{ background: "rgba(255,255,255,0.1)", color: "#fff", border: "1px solid rgba(255,255,255,0.2)" }}
                      >
                        Entendido
                      </button>
                    </div>
                  </>
                )}

                {mode === "denied" && (
                  <>
                    <h3 className="text-white font-bold text-base leading-tight">Avisos bloqueados</h3>
                    <p className="text-white/65 text-xs mt-1 leading-relaxed">
                      En su momento bloqueaste las notificaciones. Para activarlas:
                      ajustes del navegador → busca <strong>Castores</strong> → Permitir notificaciones.
                    </p>
                    <button
                      onClick={dismiss}
                      className="mt-3 w-full rounded-xl py-2.5 font-bold text-sm transition"
                      style={{ background: "rgba(255,255,255,0.1)", color: "#fff", border: "1px solid rgba(255,255,255,0.2)" }}
                    >
                      Entendido
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
