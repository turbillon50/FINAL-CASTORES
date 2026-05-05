import { useEffect, useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { getAuthToken } from "@workspace/api-client-react";
import { apiUrl } from "@/lib/api-url";

type State =
  | { kind: "loading" }
  | { kind: "unsupported" }
  | { kind: "ios-needs-pwa" }
  | { kind: "denied" }
  | { kind: "ready"; subscribed: boolean };

function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent) && !("MSStream" in window);
}

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) ||
    // iOS Safari uses navigator.standalone, no display-mode.
    (navigator as any).standalone === true
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
  const headers: Record<string, string> = { "Content-Type": "application/json", ...(init?.headers as any) };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return fetch(apiUrl(path), { ...init, headers, credentials: "include" });
}

export function PushToggle() {
  const { toast } = useToast();
  const [state, setState] = useState<State>({ kind: "loading" });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Compatibilidad básica del navegador.
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
        if (isIOS() && !isStandalone()) {
          if (!cancelled) setState({ kind: "ios-needs-pwa" });
        } else {
          if (!cancelled) setState({ kind: "unsupported" });
        }
        return;
      }
      // En iOS la PushManager solo existe dentro de la PWA standalone (≥ 16.4).
      if (isIOS() && !isStandalone()) {
        if (!cancelled) setState({ kind: "ios-needs-pwa" });
        return;
      }

      if (Notification.permission === "denied") {
        if (!cancelled) setState({ kind: "denied" });
        return;
      }

      try {
        const reg = await navigator.serviceWorker.ready;
        const existing = await reg.pushManager.getSubscription();
        if (!cancelled) setState({ kind: "ready", subscribed: !!existing });
      } catch {
        if (!cancelled) setState({ kind: "unsupported" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function enable() {
    setBusy(true);
    try {
      // Pedir permiso (gesto del usuario es este click).
      const perm = await Notification.requestPermission();
      if (perm !== "granted") {
        setState({ kind: perm === "denied" ? "denied" : "ready", subscribed: false } as State);
        toast({ title: "Permiso no concedido", description: "Activa las notificaciones en los ajustes del navegador para recibir alertas.", variant: "destructive" });
        return;
      }

      // Llave pública del servidor.
      const keyRes = await authedFetch("/api/push/public-key");
      if (!keyRes.ok) throw new Error("No se pudo obtener la configuración de push");
      const { publicKey } = await keyRes.json();
      if (!publicKey) throw new Error("Falta llave pública");

      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
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

      setState({ kind: "ready", subscribed: true });
      toast({ title: "Notificaciones activadas", description: "Recibirás alertas en este dispositivo." });
    } catch (e: any) {
      toast({ title: "No pudimos activar las notificaciones", description: e?.message || "Inténtalo de nuevo.", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      const endpoint = sub?.endpoint;
      if (sub) await sub.unsubscribe().catch(() => {});
      if (endpoint) {
        await authedFetch("/api/push/unsubscribe", {
          method: "POST",
          body: JSON.stringify({ endpoint }),
        }).catch(() => {});
      }
      setState({ kind: "ready", subscribed: false });
      toast({ title: "Notificaciones desactivadas" });
    } catch (e: any) {
      toast({ title: "Error", description: e?.message || "No se pudo desactivar.", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="bg-card border border-border rounded-2xl p-6 space-y-3">
      <div className="flex items-start gap-3">
        <span className="w-10 h-10 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center text-lg font-bold">🔔</span>
        <div className="flex-1 min-w-0">
          <h3 className="font-bebas text-xl tracking-wide">NOTIFICACIONES</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Recibe alertas del sistema en este dispositivo, incluso con la app cerrada.
          </p>
        </div>
      </div>

      {state.kind === "loading" && (
        <p className="text-sm text-muted-foreground">Comprobando…</p>
      )}

      {state.kind === "unsupported" && (
        <p className="text-sm text-muted-foreground">
          Tu navegador no soporta notificaciones push.
        </p>
      )}

      {state.kind === "ios-needs-pwa" && (
        <div className="text-sm text-muted-foreground space-y-2">
          <p className="font-medium text-foreground">Para iPhone/iPad necesitamos un paso extra:</p>
          <ol className="list-decimal list-inside space-y-1">
            <li>Abre Safari y ve a <span className="font-mono">castores.info</span>.</li>
            <li>Toca el botón <strong>Compartir</strong> (cuadrado con flecha hacia arriba).</li>
            <li>Elige <strong>Añadir a pantalla de inicio</strong>.</li>
            <li>Abre Castores desde el ícono de la pantalla de inicio.</li>
            <li>Vuelve a esta pantalla y activa las notificaciones.</li>
          </ol>
        </div>
      )}

      {state.kind === "denied" && (
        <div className="text-sm text-red-700 space-y-1">
          <p className="font-medium">Las notificaciones están bloqueadas.</p>
          <p className="text-muted-foreground">
            Ve a los ajustes del navegador (o del sistema en iOS), busca <em>Castores</em> y activa las notificaciones.
          </p>
        </div>
      )}

      {state.kind === "ready" && (
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm">
            {state.subscribed
              ? "Activadas en este dispositivo."
              : "No estás recibiendo notificaciones aquí."}
          </p>
          <button
            onClick={state.subscribed ? disable : enable}
            disabled={busy}
            className={
              "px-4 py-2 rounded-xl font-semibold text-sm transition disabled:opacity-50 " +
              (state.subscribed
                ? "border border-border bg-background hover:bg-accent"
                : "bg-amber-600 hover:bg-amber-700 text-white")
            }
          >
            {busy ? "..." : state.subscribed ? "Desactivar" : "Activar"}
          </button>
        </div>
      )}
    </section>
  );
}
