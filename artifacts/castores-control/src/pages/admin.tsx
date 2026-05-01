import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { MainLayout } from "@/components/layout/main-layout";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Redirect } from "wouter";
import { TabErrorBoundary } from "@/components/error-boundary";
import { useUser, useAuth as useClerkAuth } from "@clerk/react";
import { apiUrl } from "@/lib/api-url";

const ROLE_LABELS: Record<string, string> = {
  admin: "Administrador", supervisor: "Supervisor", client: "Cliente",
  worker: "Trabajador", proveedor: "Proveedor",
};
const ROLE_ICONS: Record<string, string> = {
  admin: "🛡️", supervisor: "👷", client: "🏢", worker: "🔧", proveedor: "🚛",
};
const ROLE_COLORS: Record<string, string> = {
  admin: "#C8952A", supervisor: "#3B82F6", client: "#10B981", worker: "#EF4444", proveedor: "#8B5CF6",
};

type Tab = "permisos" | "usuarios" | "obras" | "invitations" | "content" | "avisos" | "manual";

const PERMISSION_GROUPS: { group: string; items: { key: string; label: string; description: string }[] }[] = [
  { group: "General", items: [
    { key: "dashboardFull", label: "Dashboard completo", description: "Centro de mando con todas las métricas" },
    { key: "adminPanelAccess", label: "Panel administrativo", description: "Entrar al panel de control admin" },
  ]},
  { group: "Obras", items: [
    { key: "projectsViewAll", label: "Ver TODAS las obras", description: "Si no, solo las obras asignadas" },
    { key: "projectsCreateEdit", label: "Crear/editar obras", description: "Crear nuevas obras y modificar existentes" },
  ]},
  { group: "Bitácora", items: [
    { key: "bitacoraView", label: "Ver bitácora", description: "Consultar registro diario" },
    { key: "bitacoraCreate", label: "Escribir en bitácora", description: "Añadir notas, fotos, avances" },
  ]},
  { group: "Finanzas", items: [
    { key: "budgetViewAmounts", label: "Ver montos de presupuesto", description: "Costos, dinero y % ejercido" },
  ]},
  { group: "Materiales", items: [
    { key: "materialsRequest", label: "Solicitar materiales", description: "Crear solicitudes de compra" },
    { key: "materialsApprove", label: "Aprobar materiales", description: "Autorizar solicitudes" },
    { key: "materialsSupply", label: "Surtir materiales", description: "Marcar entregas (proveedores)" },
  ]},
  { group: "Personal", items: [
    { key: "workersView", label: "Ver trabajadores", description: "Lista y datos básicos" },
    { key: "workersManage", label: "Gestionar trabajadores", description: "Alta, baja, asignaciones" },
  ]},
  { group: "Documentos", items: [
    { key: "documentsLegalView", label: "Ver documentos legales", description: "Contratos, permisos, licencias" },
    { key: "documentsLegalManage", label: "Gestionar documentos", description: "Subir, reemplazar, eliminar" },
  ]},
];

const ROLES_ORDER = ["admin", "supervisor", "client", "worker", "proveedor"] as const;

interface AuthCtx { token: string | null; clerkId: string | null; email: string | null }

async function apiFetch(path: string, auth: AuthCtx, opts?: RequestInit) {
  const { token, clerkId, email } = auth;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const params = new URLSearchParams();
  if (clerkId) params.set("clerkId", clerkId);
  if (email) params.set("email", email);
  const qs = params.toString();
  const url = `${apiUrl(`/api${path}`)}${qs ? (path.includes("?") ? "&" : "?") + qs : ""}`;

  const res = await fetch(url, {
    ...opts,
    headers: { ...headers, ...(opts?.headers ?? {}) },
  });
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || "Error"); }
  return res.json();
}

/** Hook that returns a fetch function pre-loaded with fresh Clerk auth.
 *  Falls back to local auth context (localStorage) when Clerk session is
 *  unavailable so admin ops work even after a session refresh cycle. */
function useAuthFetch() {
  const { getToken } = useClerkAuth();
  const { user: clerkUser } = useUser();
  const { user: localUser } = useAuth();
  return async (path: string, opts?: RequestInit) => {
    const token = await getToken().catch(() => null);
    const auth: AuthCtx = {
      token,
      clerkId: clerkUser?.id ?? null,
      // email fallback: Clerk primary email → local context email (always in localStorage)
      email:
        clerkUser?.primaryEmailAddress?.emailAddress ??
        localUser?.email ??
        null,
    };
    return apiFetch(path, auth, opts);
  };
}

// ─── Invitations Tab ─────────────────────────────────────────────────────────
function InvitationsTab() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [role, setRole] = useState("supervisor");
  const [label, setLabel] = useState("");
  const [creating, setCreating] = useState(false);
  const { isLoaded, isSignedIn, user: clerkUser } = useUser();
  const authFetch = useAuthFetch();

  const { data: invitations = [], isLoading } = useQuery<any[]>({
    queryKey: ["invitations", clerkUser?.id ?? "anon"],
    queryFn: () => authFetch("/invitations"),
    enabled: isLoaded && !!isSignedIn && !!clerkUser,
  });

  const createInvitation = async () => {
    if (creating) return;
    setCreating(true);
    try {
      await authFetch("/invitations", {
        method: "POST",
        body: JSON.stringify({ role, label: label.trim() || undefined }),
      });
      qc.invalidateQueries({ queryKey: ["invitations"] });
      setLabel("");
      toast({ title: "Clave generada exitosamente" });
    } catch (e: any) {
      toast({ title: e.message, variant: "destructive" });
    } finally {
      setCreating(false);
    }
  };

  const revokeInvitation = async (id: number) => {
    try {
      await authFetch(`/invitations/${id}`, { method: "DELETE" });
      qc.invalidateQueries({ queryKey: ["invitations"] });
      toast({ title: "Clave revocada" });
    } catch (e: any) {
      toast({ title: e.message, variant: "destructive" });
    }
  };

  const shareWhatsApp = (inv: any) => {
    // Use /api/invite/:code (server-side redirect) instead of /sign-up?code=XXX
    // directly. iOS PWA hijacks any navigation to a URL whose origin matches a
    // registered PWA's scope and reroutes it to start_url, throwing the
    // invitee onto the BIENVENIDO screen with no way to know they had an
    // invitation in flight. The /api/invite endpoint replies with an HTML
    // page that runs a JS location.replace() AFTER seeding the invite code
    // into localStorage — the PWA can't intercept that response, so the
    // invitee always lands on /sign-up?code=… with the splash ready to go.
    const msg = encodeURIComponent(
      `🏗️ *Castores Control* — Tienes una invitación\n\nRol: *${ROLE_LABELS[inv.role] ?? inv.role}*${inv.label ? `\nPara: ${inv.label}` : ""}\n\n🔑 Tu código de acceso:\n*${inv.code}*\n\n1️⃣ Abre: https://castores.info/api/invite/${inv.code}\n2️⃣ Completa tus datos\n3️⃣ Confirma tu registro\n\nEl código es de un solo uso — no lo compartas.`
    );
    window.open(`https://wa.me/?text=${msg}`, "_blank");
  };

  const [copiedId, setCopiedId] = useState<number | null>(null);
  const copyCode = (inv: any) => {
    navigator.clipboard.writeText(inv.code).then(() => {
      setCopiedId(inv.id);
      setTimeout(() => setCopiedId(null), 2000);
    }).catch(() => {
      toast({ title: `Código: ${inv.code}`, description: "Cópialo manualmente" });
    });
  };

  const active = invitations.filter((i: any) => i.isActive && !i.usedBy);
  const used = invitations.filter((i: any) => i.usedBy || !i.isActive);

  return (
    <div className="space-y-6">
      {/* Generator */}
      <div className="rounded-2xl p-6" style={{ background: "rgba(200,149,42,0.06)", border: "1px solid rgba(200,149,42,0.2)" }}>
        <h3 className="font-black text-lg mb-1" style={{ fontFamily: "'Bebas Neue', sans-serif", letterSpacing: "0.04em", color: "#C8952A" }}>
          Generar nueva clave
        </h3>
        <p className="text-xs mb-4" style={{ color: "rgba(26,22,18,0.45)" }}>La clave se puede compartir por WhatsApp para invitar a alguien al sistema con acceso inmediato.</p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <label className="text-xs font-semibold block mb-1.5" style={{ color: "rgba(26,22,18,0.55)" }}>Rol a invitar *</label>
            <select value={role} onChange={(e) => setRole(e.target.value)}
              className="w-full rounded-xl px-3 py-2.5 text-sm outline-none transition-all appearance-none cursor-pointer"
              style={{ background: "white", border: "1px solid rgba(0,0,0,0.1)", color: "#1a1612" }}>
              {Object.entries(ROLE_LABELS).map(([v, l]) => (
                <option key={v} value={v}>{ROLE_ICONS[v]} {l}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs font-semibold block mb-1.5" style={{ color: "rgba(26,22,18,0.55)" }}>Nombre / Descripción (opcional)</label>
            <input type="text" value={label} onChange={(e) => setLabel(e.target.value)}
              placeholder="Ej. Juan Pérez - Supervisor Obra Norte"
              className="w-full rounded-xl px-3 py-2.5 text-sm outline-none transition-all"
              style={{ background: "white", border: "1px solid rgba(0,0,0,0.1)", color: "#1a1612" }} />
          </div>
          <div className="flex items-end">
            <button onClick={createInvitation} disabled={creating}
              className="w-full py-2.5 rounded-xl font-bold text-sm text-white transition-all hover:opacity-90 disabled:opacity-50"
              style={{ background: "linear-gradient(135deg, #C8952A, #E8A830)" }}>
              {creating ? "Generando..." : "⚡ Generar clave"}
            </button>
          </div>
        </div>
      </div>

      {/* Active codes */}
      {isLoading ? (
        <div className="text-center py-8 text-sm" style={{ color: "rgba(26,22,18,0.35)" }}>Cargando claves...</div>
      ) : (
        <>
          {active.length > 0 && (
            <div>
              <h4 className="text-xs font-black uppercase tracking-wider mb-3" style={{ color: "rgba(26,22,18,0.4)" }}>
                Claves activas ({active.length})
              </h4>
              <div className="space-y-2">
                {active.map((inv: any) => (
                  <motion.div key={inv.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                    className="flex items-center gap-3 p-4 rounded-xl"
                    style={{ background: "white", border: "1px solid rgba(0,0,0,0.07)" }}>
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center text-xl flex-shrink-0"
                      style={{ background: `${ROLE_COLORS[inv.role]}15` }}>
                      {ROLE_ICONS[inv.role] ?? "👤"}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-black text-lg tracking-widest font-mono" style={{ color: "#1a1612" }}>{inv.code}</span>
                        <span className="text-xs px-2 py-0.5 rounded-full font-bold"
                          style={{ background: `${ROLE_COLORS[inv.role]}15`, color: ROLE_COLORS[inv.role] }}>
                          {ROLE_LABELS[inv.role] ?? inv.role}
                        </span>
                      </div>
                      {inv.label && <p className="text-xs mt-0.5" style={{ color: "rgba(26,22,18,0.4)" }}>{inv.label}</p>}
                      <p className="text-[10px] mt-0.5" style={{ color: "rgba(26,22,18,0.3)" }}>
                        Creado {new Date(inv.createdAt).toLocaleDateString("es-MX")}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <button onClick={() => copyCode(inv)}
                        className="p-2 rounded-lg font-bold text-xs transition-all hover:opacity-80"
                        style={{ background: copiedId === inv.id ? "rgba(16,185,129,0.12)" : "rgba(0,0,0,0.06)", color: copiedId === inv.id ? "#10B981" : "rgba(26,22,18,0.5)" }}
                        title="Copiar código">
                        {copiedId === inv.id ? (
                          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                        ) : (
                          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                          </svg>
                        )}
                      </button>
                      <button onClick={() => shareWhatsApp(inv)}
                        className="px-3 py-2 rounded-lg font-bold text-xs text-white transition-all hover:opacity-90"
                        style={{ background: "#25D366" }} title="Compartir por WhatsApp">
                        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
                        </svg>
                      </button>
                      <button onClick={() => revokeInvitation(inv.id)}
                        className="p-2 rounded-lg transition-all hover:opacity-70"
                        style={{ background: "rgba(239,68,68,0.08)", color: "#EF4444" }} title="Revocar clave">
                        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                  </motion.div>
                ))}
              </div>
            </div>
          )}

          {used.length > 0 && (
            <div>
              <h4 className="text-xs font-black uppercase tracking-wider mb-3" style={{ color: "rgba(26,22,18,0.3)" }}>
                Claves usadas / revocadas ({used.length})
              </h4>
              <div className="space-y-1.5">
                {used.map((inv: any) => (
                  <div key={inv.id} className="flex items-center gap-3 p-3 rounded-xl opacity-50"
                    style={{ background: "rgba(0,0,0,0.03)", border: "1px solid rgba(0,0,0,0.06)" }}>
                    <span className="font-mono text-sm font-bold line-through" style={{ color: "#1a1612" }}>{inv.code}</span>
                    <span className="text-xs" style={{ color: "rgba(26,22,18,0.4)" }}>{ROLE_LABELS[inv.role] ?? inv.role}</span>
                    {inv.label && <span className="text-xs" style={{ color: "rgba(26,22,18,0.35)" }}>— {inv.label}</span>}
                    <span className="ml-auto text-[10px] px-2 py-0.5 rounded-full" style={{ background: inv.usedBy ? "rgba(16,185,129,0.1)" : "rgba(239,68,68,0.1)", color: inv.usedBy ? "#10B981" : "#EF4444" }}>
                      {inv.usedBy ? "Utilizada" : "Revocada"}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {invitations.length === 0 && (
            <div className="text-center py-12">
              <div className="text-4xl mb-3">🔑</div>
              <p className="text-sm font-semibold" style={{ color: "rgba(26,22,18,0.4)" }}>No hay claves generadas aún</p>
              <p className="text-xs mt-1" style={{ color: "rgba(26,22,18,0.25)" }}>Genera una clave para invitar a alguien al sistema</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── Content Tab ─────────────────────────────────────────────────────────────
function ContentTab() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [form, setForm] = useState({ type: "announcement", title: "", body: "", imageUrl: "", targetRole: "", linkUrl: "" });
  const [creating, setCreating] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const { isLoaded, isSignedIn } = useUser();
  const authFetch = useAuthFetch();

  const { data: items = [], isLoading } = useQuery<any[]>({
    queryKey: ["content-all"],
    queryFn: () => authFetch("/content/all"),
    enabled: isLoaded && !!isSignedIn,
  });

  const createItem = async () => {
    if (!form.title.trim()) { toast({ title: "El título es requerido", variant: "destructive" }); return; }
    setCreating(true);
    try {
      await authFetch("/content", {
        method: "POST",
        body: JSON.stringify({
          type: form.type,
          title: form.title.trim(),
          body: form.body.trim() || undefined,
          imageUrl: form.imageUrl.trim() || undefined,
          linkUrl: form.linkUrl.trim() || undefined,
          targetRole: form.targetRole || undefined,
        }),
      });
      qc.invalidateQueries({ queryKey: ["content-all"] });
      setForm({ type: "announcement", title: "", body: "", imageUrl: "", targetRole: "", linkUrl: "" });
      setShowForm(false);
      toast({ title: "Contenido publicado" });
    } catch (e: any) {
      toast({ title: e.message, variant: "destructive" });
    } finally {
      setCreating(false);
    }
  };

  const toggleActive = async (item: any) => {
    try {
      await authFetch(`/content/${item.id}`, {
        method: "PATCH",
        body: JSON.stringify({ isActive: !item.isActive }),
      });
      qc.invalidateQueries({ queryKey: ["content-all"] });
    } catch (e: any) {
      toast({ title: e.message, variant: "destructive" });
    }
  };

  const deleteItem = async (id: number) => {
    if (!confirm("¿Eliminar este contenido?")) return;
    try {
      await authFetch(`/content/${id}`, { method: "DELETE" });
      qc.invalidateQueries({ queryKey: ["content-all"] });
      toast({ title: "Contenido eliminado" });
    } catch (e: any) {
      toast({ title: e.message, variant: "destructive" });
    }
  };

  const TYPE_CONFIG: Record<string, { label: string; icon: string; color: string }> = {
    banner: { label: "Banner", icon: "🖼️", color: "#3B82F6" },
    announcement: { label: "Anuncio", icon: "📢", color: "#C8952A" },
    image: { label: "Imagen", icon: "🏙️", color: "#8B5CF6" },
  };

  return (
    <div className="space-y-6">
      {/* Add button */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-black text-base" style={{ color: "#1a1612" }}>Contenido dinámico</h3>
          <p className="text-xs" style={{ color: "rgba(26,22,18,0.4)" }}>Banners, anuncios e imágenes visibles para los usuarios</p>
        </div>
        <button onClick={() => setShowForm(!showForm)}
          className="px-4 py-2 rounded-xl font-bold text-sm text-white transition-all hover:opacity-90"
          style={{ background: showForm ? "rgba(0,0,0,0.1)" : "linear-gradient(135deg, #C8952A, #E8A830)", color: showForm ? "#1a1612" : "white" }}>
          {showForm ? "Cancelar" : "+ Nuevo"}
        </button>
      </div>

      {/* Form */}
      <AnimatePresence>
        {showForm && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden">
            <div className="rounded-2xl p-5 space-y-4" style={{ background: "rgba(200,149,42,0.05)", border: "1px solid rgba(200,149,42,0.15)" }}>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                {Object.entries(TYPE_CONFIG).map(([key, cfg]) => (
                  <button key={key} onClick={() => setForm((f) => ({ ...f, type: key }))}
                    className="flex items-center gap-2 p-2.5 rounded-xl text-sm font-bold transition-all"
                    style={{
                      background: form.type === key ? `${cfg.color}15` : "rgba(0,0,0,0.03)",
                      border: `1.5px solid ${form.type === key ? cfg.color : "rgba(0,0,0,0.08)"}`,
                      color: form.type === key ? cfg.color : "rgba(26,22,18,0.5)",
                    }}>
                    <span>{cfg.icon}</span> {cfg.label}
                  </button>
                ))}
              </div>
              <div>
                <label className="text-xs font-semibold block mb-1" style={{ color: "rgba(26,22,18,0.55)" }}>Título *</label>
                <input type="text" value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                  placeholder="Ej. Actualización importante del sistema"
                  className="w-full rounded-xl px-3 py-2.5 text-sm outline-none"
                  style={{ background: "white", border: "1px solid rgba(0,0,0,0.1)", color: "#1a1612" }} />
              </div>
              <div>
                <label className="text-xs font-semibold block mb-1" style={{ color: "rgba(26,22,18,0.55)" }}>Descripción</label>
                <textarea value={form.body} onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))}
                  placeholder="Texto adicional del anuncio..."
                  rows={3} className="w-full rounded-xl px-3 py-2.5 text-sm outline-none resize-none"
                  style={{ background: "white", border: "1px solid rgba(0,0,0,0.1)", color: "#1a1612" }} />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold block mb-1" style={{ color: "rgba(26,22,18,0.55)" }}>URL de imagen</label>
                  <input type="url" value={form.imageUrl} onChange={(e) => setForm((f) => ({ ...f, imageUrl: e.target.value }))}
                    placeholder="https://..."
                    className="w-full rounded-xl px-3 py-2.5 text-sm outline-none"
                    style={{ background: "white", border: "1px solid rgba(0,0,0,0.1)", color: "#1a1612" }} />
                </div>
                <div>
                  <label className="text-xs font-semibold block mb-1" style={{ color: "rgba(26,22,18,0.55)" }}>Visible para rol</label>
                  <select value={form.targetRole} onChange={(e) => setForm((f) => ({ ...f, targetRole: e.target.value }))}
                    className="w-full rounded-xl px-3 py-2.5 text-sm outline-none appearance-none"
                    style={{ background: "white", border: "1px solid rgba(0,0,0,0.1)", color: "#1a1612" }}>
                    <option value="">Todos los roles</option>
                    {Object.entries(ROLE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </div>
              </div>
              <button onClick={createItem} disabled={creating}
                className="w-full py-2.5 rounded-xl font-bold text-sm text-white transition-all hover:opacity-90 disabled:opacity-50"
                style={{ background: "linear-gradient(135deg, #C8952A, #E8A830)" }}>
                {creating ? "Publicando..." : "📢 Publicar contenido"}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Items list */}
      {isLoading ? (
        <div className="text-center py-8 text-sm" style={{ color: "rgba(26,22,18,0.35)" }}>Cargando...</div>
      ) : items.length === 0 ? (
        <div className="text-center py-12">
          <div className="text-4xl mb-3">📋</div>
          <p className="text-sm font-semibold" style={{ color: "rgba(26,22,18,0.4)" }}>No hay contenido publicado</p>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((item: any) => {
            const cfg = TYPE_CONFIG[item.type] ?? { label: item.type, icon: "📄", color: "#666" };
            return (
              <div key={item.id} className={`rounded-xl overflow-hidden transition-all ${!item.isActive ? "opacity-50" : ""}`}
                style={{ border: "1px solid rgba(0,0,0,0.08)", background: "white" }}>
                {item.imageUrl && (
                  <img src={item.imageUrl} alt={item.title} className="w-full h-32 object-cover" />
                )}
                <div className="p-4">
                  <div className="flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span className="text-xs px-2 py-0.5 rounded-full font-bold"
                          style={{ background: `${cfg.color}15`, color: cfg.color }}>
                          {cfg.icon} {cfg.label}
                        </span>
                        {item.targetRole && (
                          <span className="text-xs px-2 py-0.5 rounded-full font-bold"
                            style={{ background: `${ROLE_COLORS[item.targetRole]}12`, color: ROLE_COLORS[item.targetRole] }}>
                            Solo {ROLE_LABELS[item.targetRole]}
                          </span>
                        )}
                        {!item.isActive && (
                          <span className="text-xs px-2 py-0.5 rounded-full font-bold" style={{ background: "rgba(0,0,0,0.06)", color: "rgba(26,22,18,0.4)" }}>Oculto</span>
                        )}
                      </div>
                      <h4 className="font-bold text-sm" style={{ color: "#1a1612" }}>{item.title}</h4>
                      {item.body && <p className="text-xs mt-1" style={{ color: "rgba(26,22,18,0.5)" }}>{item.body}</p>}
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <button onClick={() => toggleActive(item)}
                        className="p-2 rounded-lg transition-all hover:opacity-70 text-xs"
                        style={{ background: item.isActive ? "rgba(16,185,129,0.08)" : "rgba(0,0,0,0.05)", color: item.isActive ? "#10B981" : "rgba(26,22,18,0.4)" }}
                        title={item.isActive ? "Ocultar" : "Mostrar"}>
                        {item.isActive ? "👁️" : "🙈"}
                      </button>
                      <button onClick={() => deleteItem(item.id)}
                        className="p-2 rounded-lg transition-all hover:opacity-70"
                        style={{ background: "rgba(239,68,68,0.08)", color: "#EF4444" }} title="Eliminar">
                        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Avisos Tab ───────────────────────────────────────────────────────────────
function AvisosTab() {
  const { toast } = useToast();
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [targetType, setTargetType] = useState<"all" | "role" | "user">("all");
  const [targetRole, setTargetRole] = useState("supervisor");
  const [targetUserId, setTargetUserId] = useState<string>("");
  const [sending, setSending] = useState(false);
  const { isLoaded, isSignedIn } = useUser();
  const authFetch = useAuthFetch();

  const { data: users = [] } = useQuery<any[]>({
    queryKey: ["users"],
    queryFn: () => authFetch("/users"),
    enabled: isLoaded && !!isSignedIn,
  });

  const sendNotification = async () => {
    if (!title.trim() || !message.trim()) {
      toast({ title: "Título y mensaje son requeridos", variant: "destructive" }); return;
    }
    if (targetType === "user" && !targetUserId) {
      toast({ title: "Selecciona un usuario", variant: "destructive" }); return;
    }
    setSending(true);
    try {
      const res = await authFetch("/notifications/send", {
        method: "POST",
        body: JSON.stringify({
          title: title.trim(), message: message.trim(), targetType,
          targetRole: targetType === "role" ? targetRole : undefined,
          targetUserId: targetType === "user" ? Number(targetUserId) : undefined,
        }),
      });
      toast({ title: `✅ Aviso enviado a ${res.sent} usuario${res.sent !== 1 ? "s" : ""}` });
      setTitle(""); setMessage("");
    } catch (e: any) {
      toast({ title: e.message, variant: "destructive" });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="font-black text-base" style={{ color: "#1a1612" }}>Enviar aviso</h3>
        <p className="text-xs" style={{ color: "rgba(26,22,18,0.4)" }}>Los avisos aparecen como notificaciones en la app de los usuarios seleccionados.</p>
      </div>

      <div className="rounded-2xl p-6 space-y-4" style={{ background: "rgba(0,0,0,0.02)", border: "1px solid rgba(0,0,0,0.08)" }}>
        {/* Target type selector */}
        <div>
          <label className="text-xs font-black uppercase tracking-wider block mb-2" style={{ color: "rgba(26,22,18,0.45)" }}>Enviar a</label>
          <div className="grid grid-cols-3 gap-2">
            {([
              { key: "all", label: "Todos", icon: "🌐" },
              { key: "role", label: "Por rol", icon: "👥" },
              { key: "user", label: "Persona", icon: "👤" },
            ] as const).map((opt) => (
              <button key={opt.key} onClick={() => setTargetType(opt.key)}
                className="flex flex-col items-center gap-1 p-3 rounded-xl text-xs font-bold transition-all"
                style={{
                  background: targetType === opt.key ? "rgba(200,149,42,0.1)" : "rgba(0,0,0,0.03)",
                  border: `1.5px solid ${targetType === opt.key ? "#C8952A" : "rgba(0,0,0,0.08)"}`,
                  color: targetType === opt.key ? "#C8952A" : "rgba(26,22,18,0.5)",
                }}>
                <span className="text-lg">{opt.icon}</span>
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Conditional target */}
        <AnimatePresence mode="wait">
          {targetType === "role" && (
            <motion.div key="role" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}>
              <label className="text-xs font-semibold block mb-1.5" style={{ color: "rgba(26,22,18,0.55)" }}>Rol destinatario</label>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                {Object.entries(ROLE_LABELS).map(([v, l]) => (
                  <button key={v} onClick={() => setTargetRole(v)}
                    className="flex items-center gap-2 p-2.5 rounded-xl text-xs font-bold transition-all"
                    style={{
                      background: targetRole === v ? `${ROLE_COLORS[v]}12` : "rgba(0,0,0,0.03)",
                      border: `1.5px solid ${targetRole === v ? ROLE_COLORS[v] : "rgba(0,0,0,0.08)"}`,
                      color: targetRole === v ? ROLE_COLORS[v] : "rgba(26,22,18,0.5)",
                    }}>
                    {ROLE_ICONS[v]} {l}
                  </button>
                ))}
              </div>
            </motion.div>
          )}
          {targetType === "user" && (
            <motion.div key="user" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}>
              <label className="text-xs font-semibold block mb-1.5" style={{ color: "rgba(26,22,18,0.55)" }}>Seleccionar persona</label>
              <select value={targetUserId} onChange={(e) => setTargetUserId(e.target.value)}
                className="w-full rounded-xl px-3 py-2.5 text-sm outline-none appearance-none"
                style={{ background: "white", border: "1px solid rgba(0,0,0,0.1)", color: "#1a1612" }}>
                <option value="">Selecciona un usuario...</option>
                {users.filter((u: any) => u.approvalStatus === "approved").map((u: any) => (
                  <option key={u.id} value={u.id}>{u.name} — {ROLE_LABELS[u.role] ?? u.role}</option>
                ))}
              </select>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Title & message */}
        <div>
          <label className="text-xs font-semibold block mb-1.5" style={{ color: "rgba(26,22,18,0.55)" }}>Título del aviso *</label>
          <input type="text" value={title} onChange={(e) => setTitle(e.target.value)}
            placeholder="Ej. Reunión obligatoria mañana a las 8am"
            className="w-full rounded-xl px-3 py-2.5 text-sm outline-none"
            style={{ background: "white", border: "1px solid rgba(0,0,0,0.1)", color: "#1a1612" }} />
        </div>
        <div>
          <label className="text-xs font-semibold block mb-1.5" style={{ color: "rgba(26,22,18,0.55)" }}>Mensaje *</label>
          <textarea value={message} onChange={(e) => setMessage(e.target.value)}
            placeholder="Escribe el mensaje del aviso aquí..."
            rows={4} className="w-full rounded-xl px-3 py-2.5 text-sm outline-none resize-none"
            style={{ background: "white", border: "1px solid rgba(0,0,0,0.1)", color: "#1a1612" }} />
        </div>

        {/* Preview */}
        {(title || message) && (
          <div className="rounded-xl p-4" style={{ background: "rgba(200,149,42,0.06)", border: "1px solid rgba(200,149,42,0.15)" }}>
            <p className="text-[10px] font-black uppercase tracking-wider mb-2" style={{ color: "rgba(26,22,18,0.35)" }}>Vista previa</p>
            <div className="flex gap-3">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: "rgba(200,149,42,0.15)" }}>
                <span className="text-sm">🔔</span>
              </div>
              <div>
                <p className="text-sm font-bold" style={{ color: "#1a1612" }}>{title || "Título del aviso"}</p>
                <p className="text-xs mt-0.5" style={{ color: "rgba(26,22,18,0.5)" }}>{message || "Mensaje del aviso"}</p>
              </div>
            </div>
          </div>
        )}

        <button onClick={sendNotification} disabled={sending}
          className="w-full py-3 rounded-xl font-bold text-sm text-white transition-all hover:opacity-90 disabled:opacity-50"
          style={{ background: "linear-gradient(135deg, #C8952A, #E8A830)" }}>
          {sending ? "Enviando..." : "🔔 Enviar aviso"}
        </button>
      </div>
    </div>
  );
}

// ─── Usuarios Tab ────────────────────────────────────────────────────────────
function UsuariosTab() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const authFetch = useAuthFetch();
  const [editingRole, setEditingRole] = useState<{ id: number; role: string } | null>(null);
  const [savingRole, setSavingRole] = useState(false);

  const { data: users = [], isLoading } = useQuery<any[]>({
    queryKey: ["admin-users"],
    queryFn: () => authFetch("/users"),
    refetchInterval: 30_000,
  });

  const approve = async (id: number) => {
    try {
      await authFetch(`/users/${id}/approve`, { method: "PATCH" });
      qc.invalidateQueries({ queryKey: ["admin-users"] });
      toast({ title: "Usuario aprobado", description: "Ya puede acceder al sistema." });
    } catch (e: any) { toast({ title: e.message, variant: "destructive" }); }
  };

  const reject = async (id: number) => {
    if (!confirm("¿Rechazar y bloquear este usuario?")) return;
    try {
      await authFetch(`/users/${id}/reject`, { method: "PATCH" });
      qc.invalidateQueries({ queryKey: ["admin-users"] });
      toast({ title: "Usuario rechazado." });
    } catch (e: any) { toast({ title: e.message, variant: "destructive" }); }
  };

  const saveRole = async () => {
    if (!editingRole) return;
    setSavingRole(true);
    try {
      await authFetch(`/users/${editingRole.id}`, {
        method: "PATCH",
        body: JSON.stringify({ role: editingRole.role }),
      });
      qc.invalidateQueries({ queryKey: ["admin-users"] });
      setEditingRole(null);
      toast({ title: "Rol actualizado correctamente." });
    } catch (e: any) { toast({ title: e.message, variant: "destructive" }); }
    finally { setSavingRole(false); }
  };

  const pending = users.filter((u: any) => u.approvalStatus === "pending");
  const active = users.filter((u: any) => u.approvalStatus === "approved" && u.isActive);
  const others = users.filter((u: any) => u.approvalStatus === "rejected" || !u.isActive);

  if (isLoading) return <div className="text-center py-12 text-sm" style={{ color: "rgba(26,22,18,0.4)" }}>Cargando usuarios...</div>;

  const UserCard = ({ u }: { u: any }) => (
    <div className="p-4 rounded-2xl flex items-start gap-3" style={{ background: "white", border: "1px solid rgba(0,0,0,0.07)" }}>
      <div className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0"
        style={{ background: `${ROLE_COLORS[u.role] ?? "#999"}20`, color: ROLE_COLORS[u.role] ?? "#999", border: `1.5px solid ${ROLE_COLORS[u.role] ?? "#999"}40` }}>
        {u.name?.slice(0, 2).toUpperCase()}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="font-bold text-sm truncate" style={{ color: "#1a1612" }}>{u.name}</p>
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
            style={{ background: `${ROLE_COLORS[u.role] ?? "#999"}15`, color: ROLE_COLORS[u.role] ?? "#999" }}>
            {ROLE_LABELS[u.role] ?? u.role}
          </span>
        </div>
        <p className="text-xs truncate" style={{ color: "rgba(26,22,18,0.45)" }}>{u.email}</p>
        {u.company && <p className="text-xs" style={{ color: "rgba(26,22,18,0.35)" }}>{u.company}</p>}

        {/* Role editor */}
        {editingRole?.id === u.id ? (
          <div className="mt-2 flex gap-2 items-center">
            <select
              value={editingRole?.role ?? u.role}
              onChange={(e) => setEditingRole({ id: u.id, role: e.target.value })}
              className="flex-1 text-xs px-3 py-1.5 rounded-lg border"
              style={{ border: "1.5px solid rgba(0,0,0,0.15)" }}>
              {Object.entries(ROLE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <button onClick={saveRole} disabled={savingRole}
              className="text-xs px-3 py-1.5 rounded-lg font-bold text-white"
              style={{ background: "#C8952A" }}>
              {savingRole ? "..." : "Guardar"}
            </button>
            <button onClick={() => setEditingRole(null)}
              className="text-xs px-2 py-1.5 rounded-lg"
              style={{ background: "rgba(0,0,0,0.06)" }}>✕</button>
          </div>
        ) : null}
      </div>

      {/* Actions */}
      <div className="flex flex-col gap-1.5 flex-shrink-0">
        {u.approvalStatus === "pending" && (
          <>
            <button onClick={() => approve(u.id)}
              className="text-[10px] font-bold px-3 py-1.5 rounded-lg text-white"
              style={{ background: "#10B981" }}>Aprobar</button>
            <button onClick={() => reject(u.id)}
              className="text-[10px] font-bold px-3 py-1.5 rounded-lg text-white"
              style={{ background: "#EF4444" }}>Rechazar</button>
          </>
        )}
        {u.approvalStatus === "approved" && (
          <>
            {editingRole?.id !== u.id && (
              <button onClick={() => setEditingRole({ id: u.id, role: u.role })}
                className="text-[10px] font-bold px-3 py-1.5 rounded-lg"
                style={{ background: "rgba(0,0,0,0.06)", color: "rgba(26,22,18,0.6)" }}>
                Rol ✎
              </button>
            )}
            <button onClick={() => reject(u.id)}
              className="text-[10px] font-bold px-3 py-1.5 rounded-lg text-white"
              style={{ background: "#EF4444" }}>Bloquear</button>
          </>
        )}
        {u.approvalStatus === "rejected" && (
          <button onClick={() => approve(u.id)}
            className="text-[10px] font-bold px-3 py-1.5 rounded-lg text-white"
            style={{ background: "#10B981" }}>Reactivar</button>
        )}
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Pending */}
      {pending.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <div className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
            <h3 className="font-black text-sm" style={{ color: "#1a1612" }}>
              Pendientes de aprobación ({pending.length})
            </h3>
          </div>
          <div className="space-y-2">
            {pending.map((u: any) => <UserCard key={u.id} u={u} />)}
          </div>
        </div>
      )}

      {/* Active */}
      <div>
        <h3 className="font-black text-sm mb-3" style={{ color: "#1a1612" }}>
          Usuarios activos ({active.length})
        </h3>
        {active.length === 0 ? (
          <div className="text-center py-8 text-sm" style={{ color: "rgba(26,22,18,0.4)" }}>
            Sin usuarios activos todavía.
          </div>
        ) : (
          <div className="space-y-2">
            {active.map((u: any) => <UserCard key={u.id} u={u} />)}
          </div>
        )}
      </div>

      {/* Rejected / inactive */}
      {others.length > 0 && (
        <div>
          <h3 className="font-black text-sm mb-3" style={{ color: "rgba(26,22,18,0.45)" }}>
            Bloqueados / rechazados ({others.length})
          </h3>
          <div className="space-y-2">
            {others.map((u: any) => <UserCard key={u.id} u={u} />)}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Obras Tab ────────────────────────────────────────────────────────────────
function ObrasTab() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const authFetch = useAuthFetch();
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: "", description: "", location: "", status: "active",
    budget: "", startDate: "", endDate: "",
    clientId: "", supervisorId: "",
  });

  const { data: projects = [], isLoading } = useQuery<any[]>({
    queryKey: ["admin-projects"],
    queryFn: () => authFetch("/projects"),
    refetchInterval: 30_000,
  });

  const { data: users = [] } = useQuery<any[]>({
    queryKey: ["admin-users"],
    queryFn: () => authFetch("/users"),
  });

  const clients = users.filter((u: any) => u.role === "client" && u.approvalStatus === "approved");
  const supervisors = users.filter((u: any) => u.role === "supervisor" && u.approvalStatus === "approved");

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) { toast({ title: "El nombre es obligatorio", variant: "destructive" }); return; }
    setSaving(true);
    try {
      const payload: Record<string, any> = { name: form.name.trim(), status: form.status };
      if (form.description.trim()) payload.description = form.description.trim();
      if (form.location.trim()) payload.location = form.location.trim();
      if (form.budget) payload.budget = parseFloat(form.budget);
      if (form.startDate) payload.startDate = form.startDate;
      if (form.endDate) payload.endDate = form.endDate;
      if (form.clientId) payload.clientId = parseInt(form.clientId);
      if (form.supervisorId) payload.supervisorId = parseInt(form.supervisorId);

      await authFetch("/projects", { method: "POST", body: JSON.stringify(payload) });
      qc.invalidateQueries({ queryKey: ["admin-projects"] });
      qc.invalidateQueries({ queryKey: ["projects"] });
      setForm({ name: "", description: "", location: "", status: "active", budget: "", startDate: "", endDate: "", clientId: "", supervisorId: "" });
      setShowForm(false);
      toast({ title: "Obra creada correctamente." });
    } catch (e: any) { toast({ title: e.message, variant: "destructive" }); }
    finally { setSaving(false); }
  };

  const deleteProject = async (id: number, name: string) => {
    if (!confirm(`¿Eliminar la obra "${name}"? Esta acción no se puede deshacer.`)) return;
    try {
      await authFetch(`/projects/${id}`, { method: "DELETE" });
      qc.invalidateQueries({ queryKey: ["admin-projects"] });
      qc.invalidateQueries({ queryKey: ["projects"] });
      toast({ title: "Obra eliminada." });
    } catch (e: any) { toast({ title: e.message, variant: "destructive" }); }
  };

  const STATUS_LABELS: Record<string, string> = { active: "Activa", completed: "Terminada", paused: "Pausada", cancelled: "Cancelada" };
  const STATUS_COLORS: Record<string, string> = { active: "#10B981", completed: "#3B82F6", paused: "#F59E0B", cancelled: "#EF4444" };

  const inputCls = "w-full px-3 py-2 rounded-xl text-sm outline-none border";
  const inputStyle = { border: "1.5px solid rgba(0,0,0,0.12)", background: "#FAFAF9" };

  return (
    <div className="space-y-4">
      {/* Header + create button */}
      <div className="flex items-center justify-between">
        <h3 className="font-black text-base" style={{ color: "#1a1612" }}>
          Obras / Proyectos ({projects.length})
        </h3>
        <button onClick={() => setShowForm(!showForm)}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-bold text-white transition-all"
          style={{ background: showForm ? "#EF4444" : "#C8952A" }}>
          {showForm ? "✕ Cancelar" : "+ Nueva obra"}
        </button>
      </div>

      {/* Create form */}
      <AnimatePresence>
        {showForm && (
          <motion.div key="obra-form" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}>
            <form onSubmit={handleCreate} className="rounded-2xl p-5 space-y-4"
              style={{ background: "white", border: "1.5px solid rgba(200,149,42,0.3)" }}>
              <h4 className="font-black text-sm" style={{ color: "#C8952A" }}>Nueva Obra</h4>

              <div className="grid grid-cols-1 gap-3">
                <div>
                  <label className="block text-xs font-semibold mb-1" style={{ color: "rgba(26,22,18,0.55)" }}>Nombre *</label>
                  <input className={inputCls} style={inputStyle} value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Ej: Torre Residencial Centro" required />
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1" style={{ color: "rgba(26,22,18,0.55)" }}>Descripción</label>
                  <textarea className={inputCls} style={inputStyle} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Descripción general de la obra" rows={2} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold mb-1" style={{ color: "rgba(26,22,18,0.55)" }}>Ubicación</label>
                    <input className={inputCls} style={inputStyle} value={form.location} onChange={e => setForm(f => ({ ...f, location: e.target.value }))} placeholder="Ciudad, Estado" />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold mb-1" style={{ color: "rgba(26,22,18,0.55)" }}>Presupuesto (MXN)</label>
                    <input className={inputCls} style={inputStyle} type="number" min="0" value={form.budget} onChange={e => setForm(f => ({ ...f, budget: e.target.value }))} placeholder="0.00" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold mb-1" style={{ color: "rgba(26,22,18,0.55)" }}>Fecha inicio</label>
                    <input className={inputCls} style={inputStyle} type="date" value={form.startDate} onChange={e => setForm(f => ({ ...f, startDate: e.target.value }))} />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold mb-1" style={{ color: "rgba(26,22,18,0.55)" }}>Fecha fin estimada</label>
                    <input className={inputCls} style={inputStyle} type="date" value={form.endDate} onChange={e => setForm(f => ({ ...f, endDate: e.target.value }))} />
                  </div>
                </div>
                <div className="grid grid-cols-1 gap-3">
                  <div>
                    <label className="block text-xs font-semibold mb-1" style={{ color: "rgba(26,22,18,0.55)" }}>Cliente asignado</label>
                    <select className={inputCls} style={inputStyle} value={form.clientId} onChange={e => setForm(f => ({ ...f, clientId: e.target.value }))}>
                      <option value="">— Sin asignar —</option>
                      {clients.map((c: any) => <option key={c.id} value={c.id}>{c.name} ({c.company || c.email})</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold mb-1" style={{ color: "rgba(26,22,18,0.55)" }}>Supervisor asignado</label>
                    <select className={inputCls} style={inputStyle} value={form.supervisorId} onChange={e => setForm(f => ({ ...f, supervisorId: e.target.value }))}>
                      <option value="">— Sin asignar —</option>
                      {supervisors.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1" style={{ color: "rgba(26,22,18,0.55)" }}>Estado</label>
                  <select className={inputCls} style={inputStyle} value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>
                    {Object.entries(STATUS_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </div>
              </div>

              <button type="submit" disabled={saving}
                className="w-full py-3 rounded-xl text-sm font-bold text-white disabled:opacity-50"
                style={{ background: "#C8952A" }}>
                {saving ? "Creando..." : "Crear Obra"}
              </button>
            </form>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Projects list */}
      {isLoading ? (
        <div className="text-center py-12 text-sm" style={{ color: "rgba(26,22,18,0.4)" }}>Cargando obras...</div>
      ) : projects.length === 0 ? (
        <div className="text-center py-12" style={{ color: "rgba(26,22,18,0.4)" }}>
          <div className="text-4xl mb-3">🏗️</div>
          <p className="text-sm font-semibold">Sin obras registradas</p>
          <p className="text-xs mt-1">Crea la primera obra con el botón de arriba.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {projects.map((p: any) => (
            <div key={p.id} className="rounded-2xl p-4" style={{ background: "white", border: "1px solid rgba(0,0,0,0.07)" }}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className="font-black text-sm" style={{ color: "#1a1612" }}>{p.name}</span>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                      style={{ background: `${STATUS_COLORS[p.status] ?? "#999"}15`, color: STATUS_COLORS[p.status] ?? "#999" }}>
                      {STATUS_LABELS[p.status] ?? p.status}
                    </span>
                  </div>
                  {p.location && <p className="text-xs" style={{ color: "rgba(26,22,18,0.45)" }}>📍 {p.location}</p>}
                  {p.clientName && <p className="text-xs" style={{ color: "rgba(26,22,18,0.45)" }}>👤 Cliente: {p.clientName}</p>}
                  {p.supervisorName && <p className="text-xs" style={{ color: "rgba(26,22,18,0.45)" }}>👷 Supervisor: {p.supervisorName}</p>}
                  {p.budget && (
                    <p className="text-xs mt-1 font-semibold" style={{ color: "#C8952A" }}>
                      💰 {new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 }).format(p.budget)}
                    </p>
                  )}
                </div>
                <button onClick={() => deleteProject(p.id, p.name)}
                  className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 transition-all hover:bg-red-50"
                  style={{ color: "#EF4444" }}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                  </svg>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Manual Tab ──────────────────────────────────────────────────────────────
function ManualTab() {
  const SOPORTE_WA = "https://wa.me/529984292748";

  const sections = [
    {
      icon: "🔑",
      title: "Sistema de Invitaciones",
      color: "#C8952A",
      items: [
        { q: "¿Cómo invito a alguien?", a: "Ve al tab 'Invitaciones', selecciona el rol que le corresponde, escribe su nombre (opcional) y presiona 'Generar clave'. Se crea un código único que puedes copiar o enviar directo por WhatsApp." },
        { q: "¿Qué es la clave maestra CASTORES?", a: "Es el código maestro de administrador. Solo los dueños del sistema deben conocerla. Con ella, cualquier persona puede registrarse como administrador con acceso inmediato." },
        { q: "¿Qué pasa si alguien se registra sin código?", a: "Su solicitud queda en estado 'Pendiente' y requiere aprobación manual desde la sección de Equipo. El usuario ve una pantalla de espera hasta ser aprobado." },
        { q: "¿Puedo revocar una clave?", a: "Sí. En la lista de claves activas, presiona el botón rojo de basura. El código queda inválido y nadie más puede usarlo, incluso si ya fue compartido." },
        { q: "¿Una clave puede usarse más de una vez?", a: "No. Cada clave es de un solo uso. Una vez que alguien se registra con ella, queda marcada como 'Utilizada' y ya no es válida." },
      ],
    },
    {
      icon: "👥",
      title: "Gestión de Usuarios (Equipo)",
      color: "#3B82F6",
      items: [
        { q: "¿Dónde apruebo usuarios pendientes?", a: "Ve al menú lateral → 'Equipo'. Ahí ves todos los usuarios con su estado. Los que tienen estado 'Pendiente' pueden ser aprobados o rechazados con un clic." },
        { q: "¿Qué roles existen?", a: "Administrador (acceso total), Supervisor de Obra (proyectos y bitácora), Cliente/Contratante (seguimiento y reportes), Trabajador (tareas y registro), Proveedor (suministros y entregas)." },
        { q: "¿Puedo cambiar el rol de un usuario?", a: "Sí, desde la sección de Equipo puedes editar el rol de cualquier usuario activo." },
      ],
    },
    {
      icon: "📋",
      title: "Contenido Dinámico",
      color: "#8B5CF6",
      items: [
        { q: "¿Para qué sirve la sección de Contenido?", a: "Para publicar banners, anuncios e imágenes que los usuarios ven al entrar al sistema. Útil para comunicados de obra, avisos de seguridad o imágenes de proyectos." },
        { q: "¿Cómo publico un anuncio?", a: "Tab 'Contenido' → botón '+ Nuevo' → elige el tipo (Banner, Anuncio o Imagen) → llena el título y descripción → opcionalmente filtra por rol → 'Publicar contenido'." },
        { q: "¿Puedo ocultar contenido sin eliminarlo?", a: "Sí. Cada elemento tiene un botón de ojo (👁️/🙈) para activar o desactivar su visibilidad sin perder la información." },
        { q: "¿Puedo hacer un anuncio visible solo para supervisores?", a: "Sí. Al crear el contenido, en el campo 'Visible para rol' selecciona el rol deseado. Los demás usuarios no lo verán." },
      ],
    },
    {
      icon: "🔔",
      title: "Avisos y Notificaciones",
      color: "#EF4444",
      items: [
        { q: "¿Cómo envío un aviso?", a: "Tab 'Avisos' → elige el destino (Todos, Por rol o Persona específica) → escribe título y mensaje → presiona 'Enviar aviso'. Los usuarios lo reciben en su bandeja de notificaciones." },
        { q: "¿Los usuarios reciben el aviso en tiempo real?", a: "El aviso aparece en la campana 🔔 con un badge rojo indicando cuántos no leídos tienen. La app revisa nuevos avisos automáticamente cada 30 segundos." },
        { q: "¿Puedo enviar un aviso a una sola persona?", a: "Sí. Selecciona 'Persona' en el tipo de destino y elige el usuario de la lista. Solo esa persona recibirá el mensaje." },
      ],
    },
    {
      icon: "🏗️",
      title: "Proyectos y Bitácora",
      color: "#10B981",
      items: [
        { q: "¿Cómo creo un nuevo proyecto?", a: "Ve al menú → 'Obras' → botón '+' o 'Nuevo Proyecto'. Llena nombre, descripción, ubicación y asigna responsables." },
        { q: "¿Qué es la Bitácora?", a: "Es el registro diario de la obra. Supervisores y administradores pueden crear entradas con fotos, notas, avance porcentual e incidencias. Los clientes pueden consultarla en modo lectura." },
        { q: "¿Los clientes pueden ver todo?", a: "Los clientes ven proyectos, bitácora y reportes, pero no pueden crear ni editar registros. Su acceso es de solo lectura para seguimiento." },
      ],
    },
    {
      icon: "📱",
      title: "Instalación como App",
      color: "#6B7280",
      items: [
        { q: "¿Se puede instalar en el celular?", a: "Sí, Castores Control es una PWA (Progressive Web App). Cuando entres desde el navegador del celular, aparecerá una opción para 'Agregar a pantalla de inicio'. Funciona como una app nativa." },
        { q: "¿Necesita internet para funcionar?", a: "Necesita conexión para cargar datos en tiempo real. Sin embargo, las pantallas ya visitadas pueden verse brevemente sin conexión gracias al caché del navegador." },
      ],
    },
  ];

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="rounded-2xl p-5" style={{ background: "linear-gradient(135deg, #1a1612 0%, #2d2419 100%)" }}>
        <div className="flex items-center gap-3 mb-2">
          <span className="text-2xl">📖</span>
          <div>
            <h3 className="font-black text-lg text-white" style={{ fontFamily: "'Bebas Neue', sans-serif", letterSpacing: "0.04em" }}>
              Manual de la App
            </h3>
            <p className="text-xs" style={{ color: "rgba(255,255,255,0.4)" }}>
              Guía completa para administradores de Castores Control
            </p>
          </div>
        </div>
      </div>

      {/* Soporte técnico */}
      <a href={SOPORTE_WA} target="_blank" rel="noopener noreferrer"
        className="flex items-center gap-4 p-4 rounded-2xl transition-all hover:opacity-90 active:scale-[0.98]"
        style={{ background: "#25D366", textDecoration: "none" }}>
        <div className="w-11 h-11 rounded-xl bg-white/20 flex items-center justify-center flex-shrink-0">
          <svg viewBox="0 0 24 24" fill="white" className="w-6 h-6">
            <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
          </svg>
        </div>
        <div className="flex-1">
          <p className="font-black text-white text-sm">Soporte Técnico</p>
          <p className="text-white/70 text-xs">Contactar directamente por WhatsApp</p>
        </div>
        <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" className="w-5 h-5 opacity-70">
          <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
        </svg>
      </a>

      {/* Sections */}
      {sections.map((section) => (
        <div key={section.title} className="rounded-2xl overflow-hidden"
          style={{ border: "1px solid rgba(0,0,0,0.07)" }}>
          {/* Section header */}
          <div className="flex items-center gap-3 px-5 py-3.5"
            style={{ background: `${section.color}08`, borderBottom: `1px solid ${section.color}18` }}>
            <span className="text-xl">{section.icon}</span>
            <h4 className="font-black text-sm" style={{ color: section.color }}>
              {section.title}
            </h4>
          </div>
          {/* Q&A items */}
          <div className="divide-y" style={{ background: "white" }}>
            {section.items.map((item, i) => (
              <div key={i} className="px-5 py-4">
                <p className="font-bold text-sm mb-1" style={{ color: "#1a1612" }}>
                  {item.q}
                </p>
                <p className="text-xs leading-relaxed" style={{ color: "rgba(26,22,18,0.55)" }}>
                  {item.a}
                </p>
              </div>
            ))}
          </div>
        </div>
      ))}

      {/* Bottom support repeat */}
      <div className="rounded-2xl p-5 text-center" style={{ background: "rgba(0,0,0,0.03)", border: "1px solid rgba(0,0,0,0.07)" }}>
        <p className="text-xs font-semibold mb-3" style={{ color: "rgba(26,22,18,0.5)" }}>
          ¿No encontraste lo que buscabas?
        </p>
        <a href={SOPORTE_WA} target="_blank" rel="noopener noreferrer"
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl font-bold text-sm text-white transition-all hover:opacity-90"
          style={{ background: "#25D366" }}>
          <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
            <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
          </svg>
          Contactar soporte técnico
        </a>
        <p className="text-[10px] mt-3" style={{ color: "rgba(26,22,18,0.3)" }}>
          © {new Date().getFullYear()} CASTORES Estructuras y Construcciones
        </p>
      </div>
    </div>
  );
}

// ─── Permisos por Rol Tab ────────────────────────────────────────────────────
function PermisosTab() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const authFetch = useAuthFetch();
  const { isLoaded, isSignedIn, user: clerkUser } = useUser();
  const [draft, setDraft] = useState<Record<string, Record<string, boolean>> | null>(null);
  const [savingRole, setSavingRole] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);

  const { data: matrix, isLoading } = useQuery<Record<string, Record<string, boolean>>>({
    queryKey: ["role-permissions", clerkUser?.id ?? "anon"],
    queryFn: () => authFetch("/role-permissions"),
    enabled: isLoaded && !!isSignedIn && !!clerkUser,
  });

  // Initialize draft from server data
  if (matrix && !draft) {
    setDraft(JSON.parse(JSON.stringify(matrix)));
  }

  const toggleCell = (role: string, key: string) => {
    if (!draft) return;
    setDraft({
      ...draft,
      [role]: { ...draft[role], [key]: !draft[role]?.[key] },
    });
  };

  const isDirty = (role: string) => {
    if (!draft || !matrix) return false;
    const a = draft[role] ?? {};
    const b = matrix[role] ?? {};
    return Object.keys({ ...a, ...b }).some((k) => a[k] !== b[k]);
  };

  const saveRole = async (role: string) => {
    if (!draft) return;
    setSavingRole(role);
    try {
      await authFetch(`/role-permissions/${role}`, {
        method: "PUT",
        body: JSON.stringify({ permissions: draft[role] }),
      });
      qc.invalidateQueries({ queryKey: ["role-permissions"] });
      toast({ title: `Permisos de ${ROLE_LABELS[role]} guardados` });
    } catch (e: any) {
      toast({ title: e.message || "Error al guardar", variant: "destructive" });
    } finally {
      setSavingRole(null);
    }
  };

  const resetAll = async () => {
    if (!confirm("¿Restaurar TODOS los roles a la configuración predeterminada? Se sobrescribirán tus cambios.")) return;
    setResetting(true);
    try {
      await authFetch("/role-permissions/reset", { method: "POST" });
      setDraft(null);
      qc.invalidateQueries({ queryKey: ["role-permissions"] });
      toast({ title: "Permisos restaurados a valores predeterminados" });
    } catch (e: any) {
      toast({ title: e.message || "Error", variant: "destructive" });
    } finally {
      setResetting(false);
    }
  };

  if (isLoading || !draft) {
    return (
      <div className="flex justify-center py-20">
        <div className="w-8 h-8 border-4 rounded-full animate-spin"
          style={{ borderColor: "rgba(200,149,42,0.2)", borderTopColor: "#C8952A" }} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Intro */}
      <div className="rounded-2xl p-5"
        style={{ background: "linear-gradient(135deg, rgba(200,149,42,0.08), rgba(200,149,42,0.03))", border: "1px solid rgba(200,149,42,0.25)" }}>
        <div className="flex items-start gap-3">
          <div className="text-2xl">🔐</div>
          <div className="flex-1">
            <h2 className="font-black text-lg mb-1" style={{ fontFamily: "'Bebas Neue', sans-serif", letterSpacing: "0.04em", color: "#1a1612" }}>
              Configuración de Permisos por Rol
            </h2>
            <p className="text-sm" style={{ color: "rgba(26,22,18,0.65)" }}>
              Define qué puede ver y hacer cada rol. Los cambios afectan a <strong>todos los usuarios actuales y futuros</strong> de ese rol.
            </p>
          </div>
          <button
            onClick={resetAll}
            disabled={resetting}
            className="px-3 py-2 rounded-xl text-xs font-bold whitespace-nowrap disabled:opacity-50"
            style={{ background: "rgba(26,22,18,0.08)", color: "#1a1612", border: "1px solid rgba(26,22,18,0.15)" }}>
            {resetting ? "..." : "↺ Restaurar"}
          </button>
        </div>
      </div>

      {/* Matrix per group */}
      {PERMISSION_GROUPS.map((group) => (
        <div key={group.group} className="rounded-2xl overflow-hidden"
          style={{ background: "white", border: "1px solid rgba(0,0,0,0.06)" }}>
          {/* Group header */}
          <div className="px-5 py-3 border-b" style={{ background: "rgba(0,0,0,0.02)", borderColor: "rgba(0,0,0,0.06)" }}>
            <h3 className="font-black text-sm uppercase tracking-wider" style={{ color: "#1a1612" }}>
              {group.group}
            </h3>
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ background: "rgba(0,0,0,0.015)" }}>
                  <th className="px-4 py-3 text-left font-semibold" style={{ color: "rgba(26,22,18,0.6)", minWidth: "260px" }}>
                    Permiso
                  </th>
                  {ROLES_ORDER.map((r) => (
                    <th key={r} className="px-3 py-3 text-center font-semibold" style={{ color: ROLE_COLORS[r], minWidth: "90px" }}>
                      <div className="flex flex-col items-center gap-0.5">
                        <span className="text-base">{ROLE_ICONS[r]}</span>
                        <span className="text-[11px] uppercase">{ROLE_LABELS[r]}</span>
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {group.items.map((item) => (
                  <tr key={item.key} className="border-t" style={{ borderColor: "rgba(0,0,0,0.04)" }}>
                    <td className="px-4 py-3">
                      <div className="font-semibold text-[13px]" style={{ color: "#1a1612" }}>{item.label}</div>
                      <div className="text-[11px] mt-0.5" style={{ color: "rgba(26,22,18,0.5)" }}>{item.description}</div>
                    </td>
                    {ROLES_ORDER.map((r) => {
                      const checked = draft[r]?.[item.key] ?? false;
                      const disabled = r === "admin"; // admin always has all permissions
                      return (
                        <td key={r} className="px-3 py-3 text-center">
                          <label className={`inline-flex items-center justify-center cursor-pointer ${disabled ? "opacity-60 cursor-not-allowed" : ""}`}>
                            <input
                              type="checkbox"
                              checked={checked}
                              disabled={disabled}
                              onChange={() => !disabled && toggleCell(r, item.key)}
                              className="sr-only"
                            />
                            <div
                              className="w-6 h-6 rounded-md flex items-center justify-center transition-all"
                              style={{
                                background: checked ? ROLE_COLORS[r] : "rgba(0,0,0,0.05)",
                                border: `1.5px solid ${checked ? ROLE_COLORS[r] : "rgba(0,0,0,0.12)"}`,
                              }}
                            >
                              {checked && (
                                <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="3">
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                </svg>
                              )}
                            </div>
                          </label>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}

      {/* Save bar — sticky at bottom showing dirty roles */}
      <div className="sticky bottom-4 rounded-2xl p-4 shadow-lg"
        style={{ background: "linear-gradient(135deg, #1a1612, #2d2419)", border: "1px solid rgba(200,149,42,0.3)" }}>
        <div className="flex items-center gap-3 flex-wrap">
          <p className="text-xs font-semibold mr-2" style={{ color: "rgba(255,255,255,0.7)" }}>
            Guardar cambios por rol:
          </p>
          {ROLES_ORDER.map((r) => {
            const dirty = isDirty(r);
            const saving = savingRole === r;
            return (
              <button
                key={r}
                onClick={() => saveRole(r)}
                disabled={!dirty || saving || r === "admin"}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                style={{
                  background: dirty ? ROLE_COLORS[r] : "rgba(255,255,255,0.05)",
                  color: dirty ? "white" : "rgba(255,255,255,0.4)",
                  border: `1px solid ${dirty ? ROLE_COLORS[r] : "rgba(255,255,255,0.1)"}`,
                }}>
                <span>{ROLE_ICONS[r]}</span>
                <span>{saving ? "..." : ROLE_LABELS[r]}</span>
                {dirty && !saving && <span className="w-1.5 h-1.5 rounded-full bg-white" />}
              </button>
            );
          })}
        </div>
        <p className="text-[10px] mt-2" style={{ color: "rgba(255,255,255,0.4)" }}>
          🛡️ Administrador siempre conserva todos los permisos (no editable).
        </p>
      </div>
    </div>
  );
}

// ─── Main Admin Page ──────────────────────────────────────────────────────────
const VALID_TABS: readonly Tab[] = [
  "permisos",
  "usuarios",
  "obras",
  "invitations",
  "content",
  "avisos",
  "manual",
] as const;

const TAB_STORAGE_KEY = "castores_admin_tab";

function getInitialTab(): Tab {
  if (typeof window === "undefined") return "permisos";
  // 1. URL hash takes priority (so links like /admin#invitations work)
  const hash = window.location.hash.replace(/^#/, "") as Tab;
  if (VALID_TABS.includes(hash)) return hash;
  // 2. Last visited tab from localStorage
  const stored = window.localStorage.getItem(TAB_STORAGE_KEY) as Tab | null;
  if (stored && VALID_TABS.includes(stored)) return stored;
  return "permisos";
}

export default function AdminPanel() {
  const { user } = useAuth();
  const [tab, setTabState] = useState<Tab>(getInitialTab);

  // Persist tab to URL hash + localStorage so it survives reloads,
  // PWA close/open, and browser back/forward navigation.
  const setTab = (next: Tab) => {
    setTabState(next);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(TAB_STORAGE_KEY, next);
      // Update hash without triggering wouter navigation
      const newHash = `#${next}`;
      if (window.location.hash !== newHash) {
        window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}${newHash}`);
      }
    }
  };

  // Sync state when user uses browser back/forward (hash change)
  useEffect(() => {
    const onHashChange = () => {
      const hash = window.location.hash.replace(/^#/, "") as Tab;
      if (VALID_TABS.includes(hash)) setTabState(hash);
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  // On first mount: ensure URL hash reflects current tab (so reload works
  // even if the user didn't manually click a tab this session).
  useEffect(() => {
    if (typeof window !== "undefined" && !window.location.hash) {
      window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}#${tab}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!user || user.role !== "admin") return <Redirect to="/dashboard" />;

  const tabs: { key: Tab; label: string; icon: string }[] = [
    { key: "permisos", label: "Permisos", icon: "🔐" },
    { key: "usuarios", label: "Usuarios", icon: "👥" },
    { key: "obras", label: "Obras", icon: "🏗️" },
    { key: "invitations", label: "Invitaciones", icon: "🔑" },
    { key: "content", label: "Contenido", icon: "📋" },
    { key: "avisos", label: "Avisos", icon: "🔔" },
    { key: "manual", label: "Manual", icon: "📖" },
  ];

  return (
    <MainLayout>
      {/* Hero */}
      <div className="rounded-3xl p-6 mb-6 relative overflow-hidden"
        style={{ background: "linear-gradient(135deg, #1a1612 0%, #2d2419 100%)" }}>
        <div className="absolute inset-0 opacity-10"
          style={{ backgroundImage: "radial-gradient(circle at 80% 50%, #C8952A 0%, transparent 60%)" }} />
        <div className="relative z-10">
          <div className="flex items-center gap-3 mb-1">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center text-xl"
              style={{ background: "rgba(200,149,42,0.2)", border: "1px solid rgba(200,149,42,0.3)" }}>
              🛡️
            </div>
            <div>
              <h1 className="text-white font-black text-2xl" style={{ fontFamily: "'Bebas Neue', sans-serif", letterSpacing: "0.04em" }}>
                Panel Administrativo
              </h1>
              <p className="text-xs" style={{ color: "rgba(255,255,255,0.4)" }}>
                Hola, {user.name} — Control total del sistema
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 p-1 rounded-2xl mb-6" style={{ background: "rgba(0,0,0,0.05)" }}>
        {tabs.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-bold transition-all"
            style={{
              background: tab === t.key ? "white" : "transparent",
              color: tab === t.key ? "#1a1612" : "rgba(26,22,18,0.45)",
              boxShadow: tab === t.key ? "0 1px 4px rgba(0,0,0,0.1)" : "none",
            }}>
            <span>{t.icon}</span>
            <span className="hidden sm:inline">{t.label}</span>
          </button>
        ))}
      </div>

      {/* Tab content */}
      <AnimatePresence mode="wait">
        <motion.div key={tab} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
          <TabErrorBoundary name={tab}>
            {tab === "permisos" && <PermisosTab />}
            {tab === "usuarios" && <UsuariosTab />}
            {tab === "obras" && <ObrasTab />}
            {tab === "invitations" && <InvitationsTab />}
            {tab === "content" && <ContentTab />}
            {tab === "avisos" && <AvisosTab />}
            {tab === "manual" && <ManualTab />}
          </TabErrorBoundary>
        </motion.div>
      </AnimatePresence>
    </MainLayout>
  );
}
