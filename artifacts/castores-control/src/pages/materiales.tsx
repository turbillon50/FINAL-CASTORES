import { MainLayout } from "@/components/layout/main-layout";
import { MaterialKanban } from "@/components/ui/material-kanban";
import { PageHero } from "@/components/ui/page-hero";
import {
  useListMaterials, useGetMaterialStats, useApproveMaterial,
  useCreateMaterial, useUpdateMaterial, useListProjects,
} from "@workspace/api-client-react";
import { Icons } from "@/lib/icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { usePermissions } from "@/hooks/use-permissions";
import { motion, AnimatePresence } from "framer-motion";
import { useState } from "react";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

export default function Materiales() {
  const permissions = usePermissions();
  const canRequest = permissions.has("materialsRequest");
  const canApprove = permissions.has("materialsApprove");
  const canSupply = permissions.has("materialsSupply");
  const { data: materials = [], refetch } = useListMaterials();
  const { data: stats, refetch: refetchStats } = useGetMaterialStats();
  const { data: projects = [] } = useListProjects();
  const approveMaterial = useApproveMaterial();
  const updateMaterial = useUpdateMaterial();
  const createMaterial = useCreateMaterial();
  const { toast } = useToast();

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    projectId: "",
    name: "",
    description: "",
    unit: "pza",
    quantityRequested: "",
    costPerUnit: "",
    notes: "",
  });
  const [submitting, setSubmitting] = useState(false);

  const reload = () => { refetch(); refetchStats(); };

  const handleApprove = (id: number) => {
    approveMaterial.mutate({ id }, {
      onSuccess: () => {
        toast({ title: "Material Aprobado", description: "La solicitud ha sido autorizada." });
        reload();
      },
    });
  };

  const handleReject = (id: number) => {
    updateMaterial.mutate({ id, data: { status: "rejected" } }, {
      onSuccess: () => {
        toast({ title: "Material Rechazado", description: "La solicitud fue rechazada." });
        reload();
      },
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.projectId || !form.name || !form.unit || !form.quantityRequested) {
      toast({ variant: "destructive", title: "Campos requeridos", description: "Completa proyecto, nombre, unidad y cantidad." });
      return;
    }
    setSubmitting(true);
    try {
      await createMaterial.mutateAsync({
        data: {
          projectId: Number(form.projectId),
          name: form.name,
          description: form.description || null,
          unit: form.unit,
          quantityRequested: Number(form.quantityRequested),
          costPerUnit: form.costPerUnit ? Number(form.costPerUnit) : null,
          notes: form.notes || null,
        },
      });
      toast({ title: "Solicitud Enviada", description: "El material fue solicitado correctamente." });
      setShowForm(false);
      setForm({ projectId: "", name: "", description: "", unit: "pza", quantityRequested: "", costPerUnit: "", notes: "" });
      reload();
    } catch {
      toast({ variant: "destructive", title: "Error", description: "No se pudo registrar la solicitud." });
    } finally {
      setSubmitting(false);
    }
  };

  const fmt = (n: number | null | undefined) => {
    if (n == null) return "$0";
    return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 }).format(n);
  };

  const statCards = [
    { label: "Total Gastado", value: fmt(stats?.totalMaterialCost), color: "#C8952A", icon: "💰" },
    { label: "Pendientes", value: stats?.pendingRequests ?? 0, color: "#F59E0B", icon: "⏳" },
    { label: "Aprobadas", value: stats?.approvedRequests ?? 0, color: "#10B981", icon: "✅" },
    { label: "Total Solicitudes", value: stats?.totalMaterialRequests ?? 0, color: "#3B82F6", icon: "📦" },
  ];

  return (
    <MainLayout>
      <div className="space-y-6 pb-4">
        <PageHero
          title="Logística de Materiales"
          subtitle="Control de inventario, solicitudes y movimientos de suministros"
          imageUrl="https://images.unsplash.com/photo-1607400201515-c2c41c8eb8e6?w=1400&q=80&fit=crop"
          accentColor="#C8952A"
          badge="BODEGA Y SUMINISTROS"
        >
          {canRequest && (
            <Button
              onClick={() => setShowForm(true)}
              className="mt-1 rounded-xl text-xs font-bold px-4 py-2 h-auto"
              style={{ background: "rgba(200,149,42,0.25)", border: "1px solid rgba(200,149,42,0.5)", color: "#fff" }}
            >
              <Icons.Plus className="w-3.5 h-3.5 mr-1.5" /> Solicitar Material
            </Button>
          )}
        </PageHero>

        {/* Stats */}
        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {statCards.map((s, i) => (
              <motion.div key={s.label} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.06 }} className="bg-white rounded-2xl p-4"
                style={{ border: "1px solid rgba(0,0,0,0.07)", boxShadow: "0 2px 8px rgba(0,0,0,0.04)" }}>
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-lg">{s.icon}</span>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">{s.label}</p>
                </div>
                <p className="font-display text-3xl" style={{ color: s.color }}>{s.value}</p>
              </motion.div>
            ))}
          </div>
        )}

        {(stats?.pendingRequests ?? 0) > 0 && (
          <div className="flex items-center gap-3 px-4 py-3 rounded-xl"
            style={{ background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.25)" }}>
            <div className="w-2 h-2 rounded-full animate-pulse" style={{ background: "#F59E0B" }} />
            <p className="text-sm text-foreground/70">
              <span className="font-bold" style={{ color: "#F59E0B" }}>{stats?.pendingRequests} solicitudes</span> esperando autorización
            </p>
          </div>
        )}

        <MaterialKanban
          materials={materials}
          onApprove={canApprove ? handleApprove : undefined}
          onReject={canApprove ? handleReject : undefined}
        />
      </div>

      {/* ─── Modal Solicitar Material ─────────────────── */}
      <AnimatePresence>
        {showForm && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 z-50" style={{ background: "rgba(0,0,0,0.4)", backdropFilter: "blur(8px)" }}
              onClick={() => setShowForm(false)} />
            <motion.div
              initial={{ opacity: 0, scale: 0.94, y: 16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.94, y: 16 }}
              transition={{ type: "spring", stiffness: 380, damping: 30 }}
              className="fixed inset-x-4 top-[5%] bottom-[5%] z-50 overflow-y-auto rounded-2xl md:inset-x-auto md:left-1/2 md:-translate-x-1/2 md:w-[520px]"
              style={{ background: "#fff", boxShadow: "0 24px 64px rgba(0,0,0,0.2)" }}
              onClick={e => e.stopPropagation()}
            >
              <div className="p-6">
                <div className="flex items-center justify-between mb-6">
                  <div>
                    <h2 className="font-display text-2xl text-foreground">Solicitar Material</h2>
                    <p className="text-xs text-muted-foreground mt-0.5">Llena los datos de la solicitud</p>
                  </div>
                  <button onClick={() => setShowForm(false)}
                    className="w-8 h-8 rounded-full flex items-center justify-center text-foreground/40 hover:bg-foreground/8 transition-colors">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="w-5 h-5">
                      <path d="M18 6L6 18M6 6l12 12" />
                    </svg>
                  </button>
                </div>

                <form onSubmit={handleSubmit} className="space-y-4">
                  <div>
                    <label className="text-xs uppercase tracking-wider text-muted-foreground font-semibold block mb-1.5">Proyecto *</label>
                    <Select value={form.projectId} onValueChange={v => setForm(f => ({ ...f, projectId: v }))}>
                      <SelectTrigger className="h-11 rounded-xl border-black/10">
                        <SelectValue placeholder="Seleccionar proyecto" />
                      </SelectTrigger>
                      <SelectContent>
                        {projects.map(p => <SelectItem key={p.id} value={p.id.toString()}>{p.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <label className="text-xs uppercase tracking-wider text-muted-foreground font-semibold block mb-1.5">Nombre del Material *</label>
                    <Input placeholder="Ej. Cemento gris 50 kg" value={form.name}
                      onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                      className="h-11 rounded-xl border-black/10" />
                  </div>

                  <div>
                    <label className="text-xs uppercase tracking-wider text-muted-foreground font-semibold block mb-1.5">Descripción</label>
                    <Textarea placeholder="Especificaciones, marca, calidad..."
                      value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                      className="rounded-xl border-black/10 resize-none" rows={2} />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs uppercase tracking-wider text-muted-foreground font-semibold block mb-1.5">Cantidad *</label>
                      <Input type="number" min="1" placeholder="0" value={form.quantityRequested}
                        onChange={e => setForm(f => ({ ...f, quantityRequested: e.target.value }))}
                        className="h-11 rounded-xl border-black/10" />
                    </div>
                    <div>
                      <label className="text-xs uppercase tracking-wider text-muted-foreground font-semibold block mb-1.5">Unidad *</label>
                      <Select value={form.unit} onValueChange={v => setForm(f => ({ ...f, unit: v }))}>
                        <SelectTrigger className="h-11 rounded-xl border-black/10">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {["pza", "kg", "ton", "m", "m²", "m³", "lt", "saco", "rollo", "caja", "juego"].map(u => (
                            <SelectItem key={u} value={u}>{u}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div>
                    <label className="text-xs uppercase tracking-wider text-muted-foreground font-semibold block mb-1.5">Costo Unitario (MXN)</label>
                    <Input type="number" min="0" step="0.01" placeholder="0.00" value={form.costPerUnit}
                      onChange={e => setForm(f => ({ ...f, costPerUnit: e.target.value }))}
                      className="h-11 rounded-xl border-black/10" />
                  </div>

                  <div>
                    <label className="text-xs uppercase tracking-wider text-muted-foreground font-semibold block mb-1.5">Notas</label>
                    <Textarea placeholder="Urgencia, proveedor sugerido, observaciones..."
                      value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                      className="rounded-xl border-black/10 resize-none" rows={2} />
                  </div>

                  <div className="flex gap-3 pt-2">
                    <Button type="button" variant="outline" onClick={() => setShowForm(false)}
                      className="flex-1 rounded-xl border-black/10">Cancelar</Button>
                    <Button type="submit" disabled={submitting} className="flex-1 rounded-xl font-bold"
                      style={{ background: "#C8952A", color: "#fff" }}>
                      {submitting ? "Enviando..." : "Solicitar"}
                    </Button>
                  </div>
                </form>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </MainLayout>
  );
}
