import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import { MainLayout } from "@/components/layout/main-layout";
import { apiUrl } from "@/lib/api-url";

type FaqItem = {
  id: number;
  title: string;
  body: string | null;
  category: string | null;
};

const FALLBACK: FaqItem[] = [
  { id: -1, category: "Uso de la app", title: "¿Qué es Castores Control?", body: "Es la plataforma oficial de gestión de obra de CASTORES Estructuras y Construcciones: bitácoras, materiales, reportes, documentos y notificaciones en un solo lugar." },
  { id: -2, category: "Invitaciones", title: "¿Cómo me invitan al sistema?", body: "Recibirás un enlace por WhatsApp con tu código de invitación. Al abrirlo, el código se carga automáticamente en el registro." },
  { id: -3, category: "Cuenta", title: "¿Puedo cambiar mi rol después de registrarme?", body: "El rol lo asigna el administrador. Si necesitas cambiarlo, contáctanos por WhatsApp al +52 998 429 2748." },
  { id: -4, category: "Cuenta", title: "¿Cómo elimino mi cuenta?", body: "Entra a Mi Cuenta → Zona de peligro → Eliminar mi cuenta. Tus datos personales se borran de forma permanente." },
  { id: -5, category: "Problemas", title: "La app no carga o veo una versión antigua", body: "Cierra la app por completo y vuelve a abrirla. Si persiste, entra desde castores.info para limpiar la caché." },
  { id: -6, category: "Soporte", title: "¿Cómo contacto a soporte?", body: "WhatsApp: +52 998 429 2748. Estamos disponibles de lunes a sábado de 8:00 a 19:00." },
];

export default function FAQ() {
  const [, navigate] = useLocation();
  const { data } = useQuery<FaqItem[]>({
    queryKey: ["content", "faq"],
    queryFn: async () => {
      const r = await fetch(apiUrl(`/api/content?type=faq`));
      if (!r.ok) return [];
      return r.json();
    },
  });

  const items: FaqItem[] = (data && data.length > 0) ? data : FALLBACK;
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<number | null>(null);

  const categories = useMemo(() => {
    const set = new Set<string>();
    items.forEach(i => { if (i.category) set.add(i.category); });
    return Array.from(set);
  }, [items]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return items;
    return items.filter(i =>
      i.title.toLowerCase().includes(needle) ||
      (i.body || "").toLowerCase().includes(needle) ||
      (i.category || "").toLowerCase().includes(needle)
    );
  }, [items, q]);

  const grouped = useMemo(() => {
    const g: Record<string, FaqItem[]> = {};
    filtered.forEach(i => {
      const k = i.category || "General";
      if (!g[k]) g[k] = [];
      g[k].push(i);
    });
    return g;
  }, [filtered]);

  return (
    <MainLayout publicAccess>
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="max-w-3xl mx-auto space-y-6">
        <button onClick={() => window.history.length > 1 ? window.history.back() : navigate("/dashboard")}
          className="flex items-center gap-2 text-sm font-semibold text-muted-foreground hover:text-foreground transition -ml-1">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="w-4 h-4">
            <path d="M15 18l-6-6 6-6" />
          </svg>
          Regresar
        </button>
        <header>
          <h1 className="font-bebas text-4xl tracking-wider">PREGUNTAS FRECUENTES</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Encuentra respuestas rápidas. ¿No está aquí? Escríbenos por WhatsApp.
          </p>
        </header>

        <div className="relative">
          <input
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Buscar pregunta…"
            className="w-full pl-11 pr-4 py-3 rounded-2xl border border-border bg-card focus:border-orange-500 outline-none transition"
          />
          <span className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground">⌕</span>
        </div>

        {categories.length > 0 && !q && (
          <div className="flex flex-wrap gap-2">
            {categories.map(c => (
              <button
                key={c}
                onClick={() => { const el = document.getElementById(`cat-${c}`); el?.scrollIntoView({ behavior: "smooth", block: "start" }); }}
                className="px-3 py-1.5 rounded-full border border-border bg-card text-sm hover:bg-accent transition"
              >
                {c}
              </button>
            ))}
          </div>
        )}

        <div className="space-y-6">
          {Object.entries(grouped).map(([cat, list]) => (
            <section key={cat} id={`cat-${cat}`}>
              <h2 className="font-bebas text-xl tracking-wide text-muted-foreground mb-2">{cat.toUpperCase()}</h2>
              <div className="bg-card border border-border rounded-2xl divide-y divide-border overflow-hidden">
                {list.map(item => {
                  const isOpen = open === item.id;
                  return (
                    <div key={item.id}>
                      <button
                        onClick={() => setOpen(isOpen ? null : item.id)}
                        className="w-full flex items-center justify-between gap-4 p-4 text-left hover:bg-accent transition"
                      >
                        <span className="font-medium">{item.title}</span>
                        <span className={`text-orange-600 text-xl transition-transform ${isOpen ? "rotate-45" : ""}`}>+</span>
                      </button>
                      <AnimatePresence>
                        {isOpen && item.body && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: "auto", opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            className="overflow-hidden"
                          >
                            <p className="px-4 pb-4 text-sm text-muted-foreground whitespace-pre-wrap leading-relaxed">{item.body}</p>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
          {filtered.length === 0 && (
            <p className="text-center text-muted-foreground py-8">No encontramos resultados para "{q}".</p>
          )}
        </div>

        <div className="bg-orange-50 border border-orange-200 rounded-2xl p-5 text-center">
          <p className="text-sm text-orange-900 mb-2">¿Sigues con dudas?</p>
          <a href="https://wa.me/529984292748" target="_blank" rel="noopener" className="inline-block px-5 py-2.5 rounded-xl bg-orange-600 hover:bg-orange-700 text-white font-semibold transition">
            Hablar con soporte
          </a>
        </div>
      </motion.div>
    </MainLayout>
  );
}
