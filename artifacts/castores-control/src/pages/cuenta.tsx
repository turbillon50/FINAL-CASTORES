import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { motion } from "framer-motion";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { MainLayout } from "@/components/layout/main-layout";
import { getAuthToken } from "@workspace/api-client-react";
import { apiUrl } from "@/lib/api-url";
import { PushToggle } from "@/components/push-toggle";

export default function Cuenta() {
  const { user, logout } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [step, setStep] = useState<"idle" | "confirm1" | "confirm2" | "deleting">("idle");
  const [confirmText, setConfirmText] = useState("");

  if (!user) return null;

  const initials = (user.name || "U").split(" ").map(w => w[0]).slice(0, 2).join("").toUpperCase();

  async function deleteAccount() {
    setStep("deleting");
    try {
      const token = await getAuthToken().catch(() => null);
      const res = await fetch(apiUrl(`/api/users/me`), {
        method: "DELETE",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        credentials: "include",
      });
      if (!res.ok) throw new Error(await res.text());
      toast({ title: "Cuenta eliminada", description: "Tus datos personales fueron borrados." });
      try {
        if ("serviceWorker" in navigator) {
          const regs = await navigator.serviceWorker.getRegistrations();
          await Promise.all(regs.map(r => r.unregister()));
        }
        if ("caches" in window) {
          const keys = await caches.keys();
          await Promise.all(keys.map(k => caches.delete(k)));
        }
        localStorage.clear();
        sessionStorage.clear();
      } catch {}
      await logout();
    } catch (e: any) {
      toast({ title: "Error", description: e.message || "No se pudo eliminar", variant: "destructive" });
      setStep("idle");
    }
  }

  return (
    <MainLayout>
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="max-w-3xl mx-auto space-y-6">
        <div>
          <h1 className="font-bebas text-4xl tracking-wider text-foreground">MI CUENTA</h1>
          <p className="text-sm text-muted-foreground mt-1">Información personal, preferencias y privacidad.</p>
        </div>

        {/* Perfil */}
        <section className="bg-card border border-border rounded-2xl p-6">
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-full bg-orange-500 text-white flex items-center justify-center text-2xl font-bebas tracking-wider">
              {initials}
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="font-bebas text-2xl tracking-wide truncate">{user.name}</h2>
              <p className="text-sm text-muted-foreground truncate">{user.email}</p>
              <span className="inline-block mt-1 px-2 py-0.5 rounded-full bg-orange-100 text-orange-700 text-xs font-semibold uppercase tracking-wide">
                {user.role}
              </span>
            </div>
          </div>
          {user.company && (
            <div className="mt-4 pt-4 border-t border-border text-sm">
              <span className="text-muted-foreground">Empresa: </span><span className="font-medium">{user.company}</span>
            </div>
          )}
        </section>

        {/* Notificaciones push */}
        <PushToggle />

        {/* Legal & ayuda */}
        <section className="bg-card border border-border rounded-2xl divide-y divide-border overflow-hidden">
          <LinkRow href="/faq" icon="?" label="Preguntas frecuentes" desc="Ayuda y soporte" />
          <LinkRow href="/legal/terminos" icon="§" label="Términos y condiciones" desc="Uso de la plataforma" />
          <LinkRow href="/legal/privacidad" icon="◉" label="Política de privacidad" desc="Cómo manejamos tus datos" />
          <a href="https://wa.me/529984292748" target="_blank" rel="noopener" className="flex items-center gap-4 p-4 hover:bg-accent transition">
            <span className="w-10 h-10 rounded-xl bg-green-100 text-green-700 flex items-center justify-center text-lg font-bold">W</span>
            <div className="flex-1 min-w-0">
              <div className="font-medium">Soporte por WhatsApp</div>
              <div className="text-xs text-muted-foreground">+52 998 429 2748</div>
            </div>
            <span className="text-muted-foreground">→</span>
          </a>
        </section>

        {/* Seguridad */}
        <SeguridadSection email={user.email} userName={user.name || "Usuario"} />

        {/* Sesión */}
        <section className="bg-card border border-border rounded-2xl p-6 space-y-3">
          <h3 className="font-bebas text-xl tracking-wide">SESIÓN</h3>
          <button
            onClick={() => logout()}
            className="w-full sm:w-auto px-5 py-2.5 rounded-xl border border-border bg-background hover:bg-accent transition font-medium"
          >
            Cerrar sesión
          </button>
        </section>

        {/* Zona peligro */}
        <section className="bg-red-50 border border-red-200 rounded-2xl p-6 space-y-4">
          <div>
            <h3 className="font-bebas text-xl tracking-wide text-red-700">ZONA DE PELIGRO</h3>
            <p className="text-sm text-red-700/80 mt-1">
              Eliminar tu cuenta borrará tus datos personales de forma permanente. Esta acción no se puede deshacer.
            </p>
          </div>

          {step === "idle" && (
            <button
              onClick={() => setStep("confirm1")}
              className="px-5 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white font-semibold transition"
            >
              Eliminar mi cuenta
            </button>
          )}

          {step === "confirm1" && (
            <div className="space-y-3">
              <p className="text-sm text-red-800 font-medium">
                Al eliminar tu cuenta perderás acceso a todos tus proyectos, bitácoras, reportes y notificaciones.
                Tu información personal será anonimizada permanentemente.
              </p>
              <div className="flex gap-2">
                <button onClick={() => setStep("confirm2")} className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white font-semibold text-sm">
                  Continuar
                </button>
                <button onClick={() => setStep("idle")} className="px-4 py-2 rounded-xl border border-border bg-white text-sm">
                  Cancelar
                </button>
              </div>
            </div>
          )}

          {step === "confirm2" && (
            <div className="space-y-3">
              <label className="block text-sm text-red-900 font-medium">
                Para confirmar, escribe <span className="font-mono bg-red-100 px-1.5 rounded">ELIMINAR</span>:
              </label>
              <input
                value={confirmText}
                onChange={e => setConfirmText(e.target.value)}
                className="w-full px-4 py-2.5 rounded-xl border-2 border-red-300 focus:border-red-500 outline-none bg-white"
                placeholder="ELIMINAR"
                autoFocus
              />
              <div className="flex gap-2">
                <button
                  disabled={confirmText !== "ELIMINAR"}
                  onClick={deleteAccount}
                  className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white font-semibold text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Eliminar definitivamente
                </button>
                <button onClick={() => { setStep("idle"); setConfirmText(""); }} className="px-4 py-2 rounded-xl border border-border bg-white text-sm">
                  Cancelar
                </button>
              </div>
            </div>
          )}

          {step === "deleting" && (
            <p className="text-sm text-red-700">Eliminando cuenta…</p>
          )}
        </section>
      </motion.div>
    </MainLayout>
  );
}

function LinkRow({ href, icon, label, desc }: { href: string; icon: string; label: string; desc: string }) {
  return (
    <Link href={href}>
      <div className="flex items-center gap-4 p-4 hover:bg-accent transition cursor-pointer">
        <span className="w-10 h-10 rounded-xl bg-orange-100 text-orange-700 flex items-center justify-center text-lg font-bold">{icon}</span>
        <div className="flex-1 min-w-0">
          <div className="font-medium">{label}</div>
          <div className="text-xs text-muted-foreground">{desc}</div>
        </div>
        <span className="text-muted-foreground">→</span>
      </div>
    </Link>
  );
}

function SeguridadSection({ email, userName }: { email: string; userName: string }) {
  const { toast } = useToast();
  const [sending, setSending] = useState(false);
  const [sentAt, setSentAt] = useState<number | null>(null);

  const handleChangePassword = async () => {
    setSending(true);
    try {
      const res = await fetch(apiUrl("/api/auth/forgot-password"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "No se pudo enviar el correo");
      }
      setSentAt(Date.now());
      toast({
        title: "Correo enviado",
        description: `Te enviamos un enlace a ${email}. Caduca en 30 min.`,
      });
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setSending(false);
    }
  };

  return (
    <section className="bg-card border border-border rounded-2xl p-6 space-y-4">
      <div className="flex items-start gap-3">
        <span className="w-10 h-10 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center text-lg">🔒</span>
        <div className="flex-1 min-w-0">
          <h3 className="font-bebas text-xl tracking-wide">SEGURIDAD</h3>
          <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
            Tu contraseña se guarda <strong>encriptada</strong> con el mismo estándar que usan los bancos
            (Clerk + bcrypt). Nadie en Castores Control la ve en texto plano — ni siquiera el administrador.
          </p>
        </div>
      </div>

      <ul className="text-xs text-muted-foreground space-y-1.5 pl-1">
        <li className="flex items-center gap-2">
          <span className="text-emerald-600">✓</span>
          Si olvidas tu contraseña, recupérala desde <strong>cualquier dispositivo</strong> con tu correo.
        </li>
        <li className="flex items-center gap-2">
          <span className="text-emerald-600">✓</span>
          Cambiarla cierra automáticamente tus sesiones en otros dispositivos.
        </li>
        <li className="flex items-center gap-2">
          <span className="text-emerald-600">✓</span>
          Conexión 100% por HTTPS, datos cifrados en tránsito y reposo.
        </li>
      </ul>

      <div className="pt-2 border-t border-border">
        <button
          onClick={handleChangePassword}
          disabled={sending || (sentAt !== null && Date.now() - sentAt < 60000)}
          className="w-full sm:w-auto px-5 py-2.5 rounded-xl border border-border bg-background hover:bg-accent transition font-medium text-sm disabled:opacity-50"
        >
          {sending
            ? "Enviando..."
            : sentAt !== null && Date.now() - sentAt < 60000
              ? "Correo enviado ✓"
              : "Cambiar mi contraseña"}
        </button>
        <p className="text-[11px] text-muted-foreground mt-2">
          Te enviaremos un enlace a <strong>{email}</strong> para que elijas una nueva.
        </p>
      </div>
    </section>
  );
}
