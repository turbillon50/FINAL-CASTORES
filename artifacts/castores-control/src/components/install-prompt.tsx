import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

const DISMISS_KEY = "castores_install_dismissed_at";
const DISMISS_DAYS = 7;

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

function isStandalone() {
  if (typeof window === "undefined") return true;
  return window.matchMedia("(display-mode: standalone)").matches ||
    // @ts-ignore iOS Safari
    window.navigator.standalone === true;
}

function isiOS() {
  if (typeof navigator === "undefined") return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream;
}

function recentlyDismissed() {
  try {
    const v = localStorage.getItem(DISMISS_KEY);
    if (!v) return false;
    const days = (Date.now() - Number(v)) / (1000 * 60 * 60 * 24);
    return days < DISMISS_DAYS;
  } catch {
    return false;
  }
}

export function InstallPrompt() {
  const [visible, setVisible] = useState(false);
  const [iosOpen, setIosOpen] = useState(false);
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    if (isStandalone() || recentlyDismissed()) return;

    const handler = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
      setVisible(true);
    };
    window.addEventListener("beforeinstallprompt", handler);

    if (isiOS()) {
      const t = setTimeout(() => setVisible(true), 2500);
      return () => { clearTimeout(t); window.removeEventListener("beforeinstallprompt", handler); };
    }

    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  function dismiss() {
    try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch {}
    setVisible(false);
    setIosOpen(false);
  }

  async function install() {
    if (deferred) {
      await deferred.prompt();
      await deferred.userChoice;
      dismiss();
    } else if (isiOS()) {
      setIosOpen(true);
    }
  }

  if (!visible) return null;

  return (
    <>
      <AnimatePresence>
        {visible && !iosOpen && (
          <motion.div
            initial={{ y: 80, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 80, opacity: 0 }}
            className="fixed left-3 right-3 bottom-3 z-40 md:left-auto md:right-6 md:bottom-6 md:max-w-sm"
          >
            <div className="bg-foreground text-background rounded-2xl shadow-2xl p-4 flex items-center gap-3">
              <div className="w-11 h-11 rounded-xl bg-orange-500 text-white flex items-center justify-center text-xl font-bold flex-shrink-0">↓</div>
              <div className="flex-1 min-w-0">
                <div className="font-bebas tracking-wide text-lg leading-tight">INSTALAR CASTORES</div>
                <div className="text-xs opacity-75">Acceso rápido desde tu pantalla de inicio.</div>
              </div>
              <button onClick={install} className="px-3 py-2 rounded-xl bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold flex-shrink-0">
                Instalar
              </button>
              <button onClick={dismiss} aria-label="Cerrar" className="text-background/60 hover:text-background text-xl leading-none w-7 h-7 flex items-center justify-center flex-shrink-0">×</button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {iosOpen && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/60 flex items-end md:items-center justify-center p-4"
            onClick={dismiss}
          >
            <motion.div
              initial={{ y: 50, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 30, opacity: 0 }}
              onClick={e => e.stopPropagation()}
              className="bg-card rounded-2xl max-w-sm w-full p-6 space-y-4"
            >
              <div className="flex items-start gap-3">
                <div className="w-12 h-12 rounded-xl bg-orange-500 text-white flex items-center justify-center text-2xl font-bold">⌃</div>
                <div className="flex-1">
                  <h3 className="font-bebas text-2xl tracking-wide">INSTALAR EN iPHONE</h3>
                  <p className="text-sm text-muted-foreground">Sigue estos 3 pasos en Safari:</p>
                </div>
              </div>
              <ol className="space-y-3 text-sm">
                <li className="flex gap-3"><span className="font-bebas text-orange-600 text-xl">1.</span><span>Toca el botón <b>Compartir</b> <span className="inline-block px-1.5 py-0.5 bg-accent rounded">⎙</span> en la barra inferior de Safari.</span></li>
                <li className="flex gap-3"><span className="font-bebas text-orange-600 text-xl">2.</span><span>Desliza y selecciona <b>"Agregar a pantalla de inicio"</b>.</span></li>
                <li className="flex gap-3"><span className="font-bebas text-orange-600 text-xl">3.</span><span>Toca <b>Agregar</b>. ¡Listo! Castores aparecerá como app en tu pantalla.</span></li>
              </ol>
              <button onClick={dismiss} className="w-full py-2.5 rounded-xl bg-orange-500 hover:bg-orange-600 text-white font-semibold">
                Entendido
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
