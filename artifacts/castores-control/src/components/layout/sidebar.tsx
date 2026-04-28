import { Link, useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { motion, AnimatePresence } from "framer-motion";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { getAuthToken, getClerkUserInfo } from "@workspace/api-client-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

/* ─── All navigation lives in the overlay ───────────── */
const ALL_NAV = [
  {
    href: "/dashboard",
    label: "Panel",
    desc: "Centro de mando",
    roles: ["admin", "supervisor", "client", "worker", "proveedor"],
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className="w-6 h-6">
        <rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" />
        <rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" />
      </svg>
    ),
  },
  {
    href: "/projects",
    label: "Obras",
    desc: "Portafolio activo",
    roles: ["admin", "supervisor", "client", "worker"],
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className="w-6 h-6">
        <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 21h16.5M4.5 3h15M5.25 3v18m13.5-18v18M9 6.75h1.5m-1.5 3h1.5m-1.5 3h1.5m3-6H15m-1.5 3H15m-1.5 3H15M9 21v-3.375c0-.621.504-1.125 1.125-1.125h3.75c.621 0 1.125.504 1.125 1.125V21" />
      </svg>
    ),
  },
  {
    href: "/bitacora",
    label: "Bitácora",
    desc: "Registro de obra",
    roles: ["admin", "supervisor", "client"],
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className="w-6 h-6">
        <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
      </svg>
    ),
  },
  {
    href: "/materiales",
    label: "Materiales",
    desc: "Bodega y suministros",
    roles: ["admin", "supervisor", "proveedor"],
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className="w-6 h-6">
        <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" />
      </svg>
    ),
  },
  {
    href: "/reportes",
    label: "Reportes",
    desc: "Análisis y exportación",
    roles: ["admin", "supervisor", "client"],
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className="w-6 h-6">
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
      </svg>
    ),
  },
  {
    href: "/documentos",
    label: "Documentos",
    desc: "Archivos y contratos",
    roles: ["admin", "supervisor", "client"],
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className="w-6 h-6">
        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
      </svg>
    ),
  },
  {
    href: "/usuarios",
    label: "Equipo",
    desc: "Gestión de personal",
    roles: ["admin"],
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className="w-6 h-6">
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
      </svg>
    ),
  },
  {
    href: "/admin",
    label: "Admin",
    desc: "Panel maestro",
    roles: ["admin"],
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className="w-6 h-6">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
      </svg>
    ),
  },
  {
    href: "/cuenta",
    label: "Mi cuenta",
    desc: "Perfil y privacidad",
    roles: ["admin", "supervisor", "client", "worker", "proveedor"],
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className="w-6 h-6">
        <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
      </svg>
    ),
  },
  {
    href: "/faq",
    label: "Ayuda",
    desc: "Preguntas frecuentes",
    roles: ["admin", "supervisor", "client", "worker", "proveedor"],
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className="w-6 h-6">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9 5.25h.008v.008H12v-.008z" />
      </svg>
    ),
  },
  {
    href: "/notificaciones",
    label: "Avisos",
    desc: "Mis notificaciones",
    roles: ["admin", "supervisor", "client", "worker", "proveedor"],
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className="w-6 h-6">
        <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
      </svg>
    ),
  },
];

const SIDEBAR_NAV = ALL_NAV;

const ROLE_LABELS: Record<string, string> = {
  admin: "Administrador", supervisor: "Supervisor", client: "Cliente", worker: "Trabajador",
};
const ROLE_ACCENT: Record<string, string> = {
  admin: "#C8952A", supervisor: "#3B82F6", client: "#10B981", worker: "#EF4444",
};

/* vivid orange — not gold */
const ORANGE_BTN = {
  bg: "linear-gradient(145deg, #FF8000 0%, #FF5500 55%, #E84000 100%)",
  glow: "rgba(255,100,0,0.65)",
  sheen: "linear-gradient(180deg, rgba(255,255,255,0.42) 0%, rgba(255,255,255,0.08) 55%, transparent 100%)",
};

export function Sidebar() {
  const [location, setLocation] = useLocation();
  const { user, logout } = useAuth();
  const [overlayOpen, setOverlayOpen] = useState(false);

  const { data: notifData } = useQuery<{ unread: number }>({
    queryKey: ["notifications-unread"],
    queryFn: async () => {
      const token = await getAuthToken();
      const { clerkId, email } = getClerkUserInfo();
      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const params = new URLSearchParams();
      if (clerkId) params.set("clerkId", clerkId);
      if (email) params.set("email", email);
      const qs = params.toString();
      const url = `${BASE}/api/notifications/unread-count${qs ? "?" + qs : ""}`;
      const res = await fetch(url, { headers });
      if (!res.ok) return { unread: 0 };
      return res.json();
    },
    refetchInterval: 30000,
    enabled: !!user,
  });
  const unreadCount = notifData?.unread ?? 0;

  if (!user) return null;

  const filteredNav = ALL_NAV.filter(item => item.roles.includes(user.role));
  const filteredSidebar = SIDEBAR_NAV.filter(item => item.roles.includes(user.role));
  const roleColor = ROLE_ACCENT[user.role] ?? "#C8952A";

  const close = () => setOverlayOpen(false);

  return (
    <>
      {/* ─── DESKTOP SIDEBAR ─────────────────────────────────── */}
      <aside className="hidden md:flex flex-col h-screen w-64 sticky top-0 shrink-0 z-30"
        style={{ background: "linear-gradient(180deg,#1a1612 0%,#0f0d0b 100%)", borderRight: "1px solid rgba(255,255,255,0.07)" }}>
        <div className="px-6 py-5" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
          <img src="/castores-logo.jpeg" alt="CASTORES" className="h-10 w-auto object-contain brightness-0 invert opacity-80" />
        </div>
        <div className="px-5 py-3" style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
          <span className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.2em] px-3 py-1.5 rounded-full"
            style={{ background: `${roleColor}18`, border: `1px solid ${roleColor}35`, color: roleColor }}>
            <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: roleColor }} />
            {ROLE_LABELS[user.role]}
          </span>
        </div>
        <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-0.5">
          {filteredSidebar.map((item) => {
            const isActive = location === item.href || (item.href !== "/dashboard" && location.startsWith(item.href + "/"));
            const showBadge = item.href === "/notificaciones" && unreadCount > 0;
            return (
              <Link key={item.href} href={item.href}>
                <span className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-all duration-200 cursor-pointer"
                  style={isActive
                    ? { background: `${roleColor}18`, color: roleColor, fontWeight: 600 }
                    : { color: "rgba(255,255,255,0.35)" }}>
                  <span className="relative" style={{ color: isActive ? roleColor : "rgba(255,255,255,0.25)" }}>
                    {item.icon}
                    {showBadge && (
                      <span className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full text-[8px] font-black flex items-center justify-center text-white"
                        style={{ background: "#EF4444" }}>
                        {unreadCount > 9 ? "9+" : unreadCount}
                      </span>
                    )}
                  </span>
                  {item.label}
                  {showBadge && !isActive && (
                    <span className="ml-auto text-[9px] px-1.5 py-0.5 rounded-full font-bold text-white" style={{ background: "#EF4444" }}>
                      {unreadCount}
                    </span>
                  )}
                  {isActive && <div className="ml-auto w-1 h-4 rounded-full" style={{ background: roleColor }} />}
                </span>
              </Link>
            );
          })}
        </nav>
        <div className="p-4" style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
          <div className="flex items-center gap-3 p-3 rounded-xl mb-2" style={{ background: "rgba(255,255,255,0.04)" }}>
            <Avatar className="h-8 w-8">
              <AvatarFallback className="text-xs font-bold" style={{ background: `${roleColor}20`, color: roleColor }}>
                {user.name.slice(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold truncate" style={{ color: "rgba(255,255,255,0.8)" }}>{user.name}</p>
              <p className="text-[10px] font-medium" style={{ color: roleColor }}>{ROLE_LABELS[user.role]}</p>
            </div>
          </div>
          <button onClick={logout} className="flex items-center gap-2 w-full px-3 py-2 rounded-lg text-xs transition-all"
            style={{ color: "rgba(255,255,255,0.3)" }} data-testid="button-logout">
            <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
              <path fillRule="evenodd" d="M3 4.25A2.25 2.25 0 015.25 2h5.5A2.25 2.25 0 0113 4.25v2a.75.75 0 01-1.5 0v-2a.75.75 0 00-.75-.75h-5.5a.75.75 0 00-.75.75v11.5c0 .414.336.75.75.75h5.5a.75.75 0 00.75-.75v-2a.75.75 0 011.5 0v2A2.25 2.25 0 0110.75 18h-5.5A2.25 2.25 0 013 15.75V4.25z" clipRule="evenodd" />
              <path fillRule="evenodd" d="M19 10a.75.75 0 00-.75-.75H8.704l1.048-1.04a.75.75 0 10-1.056-1.06l-2.5 2.5a.75.75 0 000 1.06l2.5 2.5a.75.75 0 101.056-1.06l-1.048-1.04h9.546A.75.75 0 0019 10z" clipRule="evenodd" />
            </svg>
            Salir / Cambiar rol
          </button>
        </div>
      </aside>

      {/* ─── MOBILE TOP BAR ──────────────────────────────────── */}
      <div className="md:hidden fixed top-0 left-0 right-0 z-40 flex items-center justify-between px-4 h-14"
        style={{ background: "rgba(15,13,11,0.92)", backdropFilter: "blur(20px)", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
        <img src="/castores-logo.jpeg" alt="CASTORES" className="h-7 w-auto object-contain brightness-0 invert opacity-80" />
        <div className="flex items-center gap-2">
          <span className="text-[9px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-full"
            style={{ background: `${roleColor}20`, border: `1px solid ${roleColor}40`, color: roleColor }}>
            {ROLE_LABELS[user.role]}
          </span>
          <Link href="/notificaciones">
            <button className="relative w-8 h-8 rounded-full flex items-center justify-center transition-all"
              style={{ background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.1)" }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.6)" strokeWidth="1.8" className="w-4.5 h-4.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
              </svg>
              {unreadCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full text-[9px] font-black flex items-center justify-center text-white"
                  style={{ background: "#EF4444" }}>
                  {unreadCount > 9 ? "9+" : unreadCount}
                </span>
              )}
            </button>
          </Link>
        </div>
      </div>

      {/* ─── MOBILE FLOATING ORANGE BUTTON (ONLY element) ──── */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 z-50 flex justify-center"
        style={{ paddingBottom: "max(env(safe-area-inset-bottom), 20px)", paddingTop: 12 }}>
        <motion.button
          whileTap={{ scale: 0.84 }}
          onClick={() => setOverlayOpen(o => !o)}
          data-testid="button-central-action"
          className="relative w-16 h-16 rounded-full flex items-center justify-center"
          style={{
            background: ORANGE_BTN.bg,
            boxShadow: `0 0 0 1px rgba(255,255,255,0.22) inset, 0 0 32px ${ORANGE_BTN.glow}, 0 8px 24px rgba(0,0,0,0.45)`,
          }}
        >
          {/* top white sheen */}
          <div className="absolute inset-0 rounded-full pointer-events-none overflow-hidden">
            <div className="absolute top-0 left-[15%] right-[15%] h-[55%] rounded-full"
              style={{ background: ORANGE_BTN.sheen }} />
          </div>
          {/* conic sparkle */}
          <div className="absolute inset-0 rounded-full pointer-events-none"
            style={{ background: "conic-gradient(from 200deg, rgba(255,255,255,0.14) 0deg, transparent 70deg, rgba(255,255,255,0.07) 140deg, transparent 200deg, rgba(255,255,255,0.14) 280deg, transparent 360deg)" }} />
          {/* + → × morph */}
          <motion.div
            animate={{ rotate: overlayOpen ? 45 : 0 }}
            transition={{ type: "spring", stiffness: 500, damping: 28 }}
            className="relative z-10"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.8" strokeLinecap="round" className="w-7 h-7"
              style={{ filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.4))" }}>
              <path d="M12 5v14M5 12h14" />
            </svg>
          </motion.div>
        </motion.button>
      </div>

      {/* ─── FULL-SCREEN OVERLAY ─────────────────────────────── */}
      <AnimatePresence>
        {overlayOpen && (
          <>
            {/* Backdrop — ultra-transparent so you see the app */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.22 }}
              className="fixed inset-0 z-[60] md:hidden"
              style={{
                background: "rgba(8,6,4,0.52)",
                backdropFilter: "blur(18px) saturate(160%) brightness(0.75)",
                WebkitBackdropFilter: "blur(18px) saturate(160%) brightness(0.75)",
              }}
              onClick={close}
            />

            {/* Close button — top LEFT */}
            <motion.button
              initial={{ opacity: 0, scale: 0.7 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.7 }}
              transition={{ duration: 0.18, delay: 0.06 }}
              onClick={close}
              className="fixed top-5 left-5 z-[70] md:hidden w-10 h-10 rounded-full flex items-center justify-center"
              style={{
                background: "rgba(255,255,255,0.12)",
                border: "1px solid rgba(255,255,255,0.22)",
                backdropFilter: "blur(12px)",
              }}
              aria-label="Cerrar menú"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.2" strokeLinecap="round" className="w-5 h-5">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </motion.button>

            {/* Navigation panel — floats above content */}
            <motion.div
              initial={{ opacity: 0, y: 60, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 60, scale: 0.96 }}
              transition={{ type: "spring", stiffness: 380, damping: 32 }}
              className="fixed inset-x-4 z-[70] md:hidden"
              style={{ bottom: "max(env(safe-area-inset-bottom), 20px)", paddingBottom: 88 }}
              onClick={e => e.stopPropagation()}
            >
              {/* User chip */}
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.05 }}
                className="flex items-center justify-between mb-4 px-1"
              >
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold"
                    style={{ background: `${roleColor}30`, color: roleColor, border: `1px solid ${roleColor}50` }}>
                    {user.name.slice(0, 2).toUpperCase()}
                  </div>
                  <div>
                    <p className="text-white font-semibold text-sm leading-tight">{user.name}</p>
                    <p className="text-[10px] font-medium" style={{ color: roleColor }}>{ROLE_LABELS[user.role]}</p>
                  </div>
                </div>
                <button
                  onClick={() => { logout(); close(); }}
                  className="text-[10px] font-bold uppercase tracking-wider px-3 py-1.5 rounded-full transition-all"
                  style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.12)", color: "rgba(255,255,255,0.45)" }}
                  data-testid="button-logout"
                >
                  Salir
                </button>
              </motion.div>

              {/* Nav grid */}
              <div className="grid grid-cols-3 gap-2.5">
                {filteredNav.map((item, i) => {
                  const isActive = location === item.href || (item.href !== "/dashboard" && location.startsWith(item.href + "/"));
                  return (
                    <motion.div
                      key={item.href}
                      initial={{ opacity: 0, scale: 0.82, y: 18 }}
                      animate={{ opacity: 1, scale: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.82, y: 18 }}
                      transition={{ delay: 0.04 + i * 0.035, type: "spring", stiffness: 420, damping: 28 }}
                    >
                      <Link href={item.href} onClick={close}>
                        <motion.div
                          whileTap={{ scale: 0.93 }}
                          className="flex flex-col items-center gap-2 p-3.5 rounded-2xl text-center cursor-pointer"
                          style={{
                            background: isActive
                              ? "rgba(255,255,255,0.14)"
                              : "rgba(255,255,255,0.06)",
                            border: isActive
                              ? `1px solid rgba(255,255,255,0.28)`
                              : "1px solid rgba(255,255,255,0.09)",
                            backdropFilter: "blur(8px)",
                          }}
                          data-testid={`overlay-nav-${item.label.toLowerCase()}`}
                        >
                          <div className="w-11 h-11 rounded-xl flex items-center justify-center"
                            style={{
                              background: isActive ? "rgba(255,128,0,0.20)" : "rgba(255,255,255,0.08)",
                              color: isActive ? "#FF8000" : "rgba(255,255,255,0.70)",
                              border: isActive ? "1px solid rgba(255,128,0,0.35)" : "1px solid rgba(255,255,255,0.08)",
                            }}>
                            {item.icon}
                          </div>
                          <div>
                            <p className="text-[12px] font-bold leading-tight"
                              style={{ color: isActive ? "#fff" : "rgba(255,255,255,0.80)" }}>
                              {item.label}
                            </p>
                            <p className="text-[9px] mt-0.5 leading-snug"
                              style={{ color: "rgba(255,255,255,0.30)" }}>
                              {item.desc}
                            </p>
                          </div>
                          {isActive && (
                            <div className="absolute bottom-2 w-4 h-0.5 rounded-full" style={{ background: "#FF8000" }} />
                          )}
                        </motion.div>
                      </Link>
                    </motion.div>
                  );
                })}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Spacer for mobile top bar */}
      <div className="h-14 md:hidden w-full shrink-0" />
    </>
  );
}
