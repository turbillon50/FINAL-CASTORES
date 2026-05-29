import { useEffect, useState, useMemo } from "react";
import { MainLayout } from "@/components/layout/main-layout";
import { PageHero } from "@/components/ui/page-hero";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Icons } from "@/lib/icons";
import { useUser } from "@clerk/react";
import { customFetch } from "@workspace/api-client-react";
import { motion } from "framer-motion";
import { useLocation } from "wouter";

interface AuditItem {
  id: number;
  type: string;
  description: string;
  userId: number | null;
  userName: string | null;
  userRole: string | null;
  projectId: number | null;
  projectName: string | null;
  createdAt: string;
}

interface AuditResponse {
  total: number;
  limit: number;
  offset: number;
  items: AuditItem[];
}

const PAGE_SIZE = 50;

const typeStyle: Record<string, { color: string; label: string }> = {
  "user.approve": { color: "#10B981", label: "Usuario aprobado" },
  "user.reject": { color: "#EF4444", label: "Usuario rechazado" },
  "user.password_reset_sent": { color: "#3B82F6", label: "Reset de contraseña" },
  "project.delete": { color: "#EF4444", label: "Obra eliminada" },
  "log.edit_after_submit": { color: "#F59E0B", label: "Bitácora editada" },
  "log.delete": { color: "#EF4444", label: "Bitácora eliminada" },
  "material.delete": { color: "#EF4444", label: "Material eliminado" },
  "material.approve": { color: "#10B981", label: "Material aprobado" },
  "email.failure": { color: "#F97316", label: "Email no enviado" },
};

function describeType(t: string) {
  return typeStyle[t] ?? { color: "#6B7280", label: t };
}

function formatDate(iso: string) {
  try {
    const d = new Date(iso);
    return d.toLocaleString("es-MX", {
      day: "2-digit", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export default function AdminAuditoria() {
  const [, setLocation] = useLocation();
  const { user } = useUser();
  const [data, setData] = useState<AuditResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [knownTypes, setKnownTypes] = useState<string[]>([]);

  const role = (user?.publicMetadata?.["role"] as string | undefined) ?? "";
  const isAdmin = role === "admin";

  useEffect(() => {
    if (!user) return;
    if (!isAdmin) {
      setLocation("/dashboard");
    }
  }, [user, isAdmin, setLocation]);

  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({
      limit: String(PAGE_SIZE),
      offset: String(offset),
    });
    if (typeFilter && typeFilter !== "all") params.set("type", typeFilter);
    customFetch<AuditResponse>(`/api/admin/audit-log?${params.toString()}`, { method: "GET" })
      .then((res) => { if (!cancelled) setData(res); })
      .catch((err) => { if (!cancelled) setError(err?.message || "No se pudo cargar la auditoría"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [isAdmin, offset, typeFilter]);

  useEffect(() => {
    if (!isAdmin) return;
    customFetch<string[]>("/api/admin/audit-log/types", { method: "GET" })
      .then(setKnownTypes)
      .catch(() => setKnownTypes([]));
  }, [isAdmin]);

  const filteredItems = useMemo(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    if (!q) return data.items;
    return data.items.filter((it) =>
      it.description.toLowerCase().includes(q) ||
      (it.userName ?? "").toLowerCase().includes(q) ||
      (it.projectName ?? "").toLowerCase().includes(q),
    );
  }, [data, search]);

  if (!isAdmin) return null;

  const total = data?.total ?? 0;
  const page = Math.floor(offset / PAGE_SIZE) + 1;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <MainLayout>
      <div className="space-y-6 pb-4">
        <PageHero
          title="Auditoría del Sistema"
          subtitle="Historial de acciones administrativas: aprobaciones, ediciones, eliminaciones."
          imageUrl="https://images.unsplash.com/photo-1450101499163-c8848c66ca85?w=1400&q=80&fit=crop"
          accentColor="#FF3C00"
          badge="ADMIN — TRAZABILIDAD"
        />

        <div className="bg-white rounded-2xl p-4 grid grid-cols-1 md:grid-cols-3 gap-3"
          style={{ border: "1px solid rgba(0,0,0,0.07)", boxShadow: "0 2px 8px rgba(0,0,0,0.04)" }}>
          <div>
            <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold block mb-1">Tipo de acción</label>
            <Select value={typeFilter} onValueChange={(v) => { setTypeFilter(v); setOffset(0); }}>
              <SelectTrigger className="h-10 rounded-xl border-black/10">
                <SelectValue placeholder="Todos" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                {knownTypes.map((t) => (
                  <SelectItem key={t} value={t}>{describeType(t).label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="md:col-span-2">
            <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold block mb-1">Buscar (descripción, usuario, obra)</label>
            <Input value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar..." className="h-10 rounded-xl border-black/10" />
          </div>
        </div>

        {error && (
          <div className="rounded-xl p-4 text-sm text-destructive"
            style={{ background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.18)" }}>
            {error}
          </div>
        )}

        <div className="bg-white rounded-2xl overflow-hidden"
          style={{ border: "1px solid rgba(0,0,0,0.07)", boxShadow: "0 2px 8px rgba(0,0,0,0.04)" }}>
          <div className="px-5 py-4 border-b border-black/5 flex items-center justify-between">
            <p className="text-sm font-semibold text-foreground/80">
              {loading ? "Cargando..." : `${filteredItems.length} de ${total} registros`}
            </p>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" disabled={offset === 0 || loading}
                onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
                className="h-8 px-3 rounded-lg border-black/10">
                ← Anterior
              </Button>
              <span className="text-xs text-muted-foreground tabular-nums">{page} / {totalPages}</span>
              <Button size="sm" variant="outline" disabled={offset + PAGE_SIZE >= total || loading}
                onClick={() => setOffset(offset + PAGE_SIZE)}
                className="h-8 px-3 rounded-lg border-black/10">
                Siguiente →
              </Button>
            </div>
          </div>

          <div className="divide-y divide-black/5">
            {filteredItems.length === 0 && !loading && (
              <div className="px-5 py-12 text-center text-muted-foreground text-sm">
                Sin registros para los filtros aplicados.
              </div>
            )}
            {filteredItems.map((it, idx) => {
              const meta = describeType(it.type);
              return (
                <motion.div key={it.id}
                  initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: Math.min(idx, 12) * 0.015 }}
                  className="px-5 py-4 hover:bg-black/[0.02] transition-colors">
                  <div className="flex items-start gap-3">
                    <span className="mt-1 inline-block w-2 h-2 rounded-full shrink-0" style={{ background: meta.color }} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-2 flex-wrap">
                        <span className="text-xs font-bold uppercase tracking-wider" style={{ color: meta.color }}>
                          {meta.label}
                        </span>
                        <span className="text-[11px] text-muted-foreground">{formatDate(it.createdAt)}</span>
                      </div>
                      <p className="text-sm text-foreground mt-1 break-words">{it.description}</p>
                      <div className="mt-1.5 flex items-center gap-3 flex-wrap text-[11px] text-muted-foreground">
                        {it.userName && (
                          <span className="inline-flex items-center gap-1">
                            <Icons.User className="w-3 h-3" />
                            {it.userName}{it.userRole ? ` (${it.userRole})` : ""}
                          </span>
                        )}
                        {it.projectName && (
                          <span className="inline-flex items-center gap-1">
                            <Icons.Projects className="w-3 h-3" />
                            {it.projectName}
                          </span>
                        )}
                        <span className="inline-flex items-center gap-1 font-mono opacity-60">#{it.id}</span>
                      </div>
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </div>
        </div>
      </div>
    </MainLayout>
  );
}
