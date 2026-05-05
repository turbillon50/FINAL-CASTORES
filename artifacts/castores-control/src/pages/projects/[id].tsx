import { MainLayout } from "@/components/layout/main-layout";
import { useGetProject, useGetProjectProgress, getAuthToken, getClerkUserInfo } from "@workspace/api-client-react";
import { useParams } from "wouter";
import { Icons } from "@/lib/icons";
import { Badge } from "@/components/ui/badge";
import { ProgressRing } from "@/components/ui/progress-ring";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { apiUrl } from "@/lib/api-url";

async function teamFetch(path: string, opts?: RequestInit) {
  const token = await getAuthToken();
  const { clerkId, email } = getClerkUserInfo();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const params = new URLSearchParams();
  if (clerkId) params.set("clerkId", clerkId);
  if (email) params.set("email", email);
  const qs = params.toString();
  const url = `${apiUrl(`/api${path}`)}${qs ? (path.includes("?") ? "&" : "?") + qs : ""}`;
  const res = await fetch(url, { ...opts, headers: { ...headers, ...(opts?.headers ?? {}) } });
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || "Error"); }
  if (res.status === 204) return null;
  return res.json();
}

function TeamTab({ projectId, isAdmin }: { projectId: number; isAdmin: boolean }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [selectedUserId, setSelectedUserId] = useState<string>("");

  const { data: assignments = [], isLoading } = useQuery<any[]>({
    queryKey: ["project-assignments", projectId],
    queryFn: () => teamFetch(`/projects/${projectId}/assignments`),
  });

  const { data: allUsers = [] } = useQuery<any[]>({
    queryKey: ["all-users-for-assignment"],
    queryFn: () => teamFetch("/users"),
    enabled: isAdmin,
  });

  const assignedIds = new Set(assignments.map((a) => a.userId));
  const eligibleUsers = allUsers.filter(
    (u) =>
      !assignedIds.has(u.id) &&
      u.isActive &&
      u.approvalStatus === "approved" &&
      ["client", "worker", "proveedor", "supervisor"].includes(u.role),
  );

  const assign = async () => {
    if (!selectedUserId) return;
    try {
      await teamFetch(`/projects/${projectId}/assignments`, {
        method: "POST",
        body: JSON.stringify({ userId: Number(selectedUserId) }),
      });
      setSelectedUserId("");
      qc.invalidateQueries({ queryKey: ["project-assignments", projectId] });
      toast({ title: "Usuario asignado" });
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
  };

  const remove = async (userId: number) => {
    if (!confirm("¿Remover este usuario de la obra?")) return;
    try {
      await teamFetch(`/projects/${projectId}/assignments/${userId}`, { method: "DELETE" });
      qc.invalidateQueries({ queryKey: ["project-assignments", projectId] });
      toast({ title: "Asignación removida" });
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
  };

  const roleLabel: Record<string, string> = {
    admin: "Administrador",
    supervisor: "Supervisor",
    client: "Cliente",
    worker: "Trabajador",
    proveedor: "Proveedor",
  };

  return (
    <div className="bg-card border border-card-border p-6 md:p-8 rounded-2xl">
      <h3 className="font-display text-2xl mb-1">Equipo de Obra</h3>
      <p className="text-muted-foreground mb-6 text-sm">
        Personas con acceso a esta obra. Solo administradores pueden asignar o remover.
      </p>

      {isAdmin && (
        <div className="flex flex-col sm:flex-row gap-3 mb-6 p-4 bg-background rounded-xl border border-card-border">
          <select
            value={selectedUserId}
            onChange={(e) => setSelectedUserId(e.target.value)}
            className="flex-1 px-3 py-2 rounded-lg bg-card border border-card-border text-sm"
          >
            <option value="">Selecciona un usuario para asignar...</option>
            {eligibleUsers.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name} ({roleLabel[u.role] ?? u.role}) — {u.email}
              </option>
            ))}
          </select>
          <Button onClick={assign} disabled={!selectedUserId} className="bg-primary text-primary-foreground">
            Asignar
          </Button>
        </div>
      )}

      {isLoading ? (
        <p className="text-muted-foreground text-sm">Cargando equipo...</p>
      ) : assignments.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <Icons.User className="w-12 h-12 mx-auto mb-3 opacity-40" />
          <p className="text-sm">Aún no hay usuarios asignados a esta obra.</p>
        </div>
      ) : (
        <ul className="divide-y divide-card-border">
          {assignments.map((a) => (
            <li key={a.id} className="py-3 flex items-center justify-between gap-4">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold flex-shrink-0">
                  {(a.name ?? "?").slice(0, 1).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <p className="font-medium truncate">{a.name ?? "Sin nombre"}</p>
                  <p className="text-xs text-muted-foreground truncate">{a.email}</p>
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <Badge variant="secondary" className="text-xs">{roleLabel[a.role] ?? a.role}</Badge>
                {isAdmin && (
                  <Button
                    onClick={() => remove(a.userId)}
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:bg-destructive/10"
                  >
                    Remover
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const STATUS_LABELS: Record<string, string> = {
  active: "Activa",
  completed: "Completada",
  paused: "Pausada",
  cancelled: "Cancelada",
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">{label}</span>
      {children}
    </label>
  );
}

export default function ProjectDetail() {
  const { id } = useParams();
  const projectId = Number(id);
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const { toast } = useToast();
  const qc = useQueryClient();
  const [editOpen, setEditOpen] = useState(false);
  const [editForm, setEditForm] = useState<any>({});
  const [editSaving, setEditSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const { data: project, isLoading: projectLoading } = useGetProject(projectId, {
    query: { queryKey: ["get-project", projectId], enabled: !!projectId }
  });

  const { data: progress } = useGetProjectProgress(projectId, {
    query: { queryKey: ["get-project-progress", projectId], enabled: !!projectId }
  });

  if (projectLoading) {
    return <MainLayout><div className="p-8 text-muted-foreground">Cargando...</div></MainLayout>;
  }

  if (!project) {
    return <MainLayout><div className="p-8 text-muted-foreground">Obra no encontrada</div></MainLayout>;
  }

  const formatCurrency = (amount: number | null | undefined) => {
    if (amount == null) return "$0";
    return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(amount);
  };

  const openEdit = () => {
    setEditForm({
      name: project.name ?? "",
      description: project.description ?? "",
      location: project.location ?? "",
      latitude: project.latitude ?? "",
      longitude: project.longitude ?? "",
      startDate: project.startDate ?? "",
      endDate: project.endDate ?? "",
      budget: project.budget ?? "",
      progressPercent: project.progressPercent ?? 0,
      status: project.status ?? "active",
    });
    setEditOpen(true);
  };

  const submitEdit = async () => {
    setEditSaving(true);
    try {
      const payload: Record<string, unknown> = {};
      const f = editForm;
      if (f.name !== project.name) payload.name = f.name;
      if (f.description !== (project.description ?? "")) payload.description = f.description || null;
      if (f.location !== (project.location ?? "")) payload.location = f.location || null;
      if (String(f.latitude) !== String(project.latitude ?? "")) payload.latitude = f.latitude === "" ? null : Number(f.latitude);
      if (String(f.longitude) !== String(project.longitude ?? "")) payload.longitude = f.longitude === "" ? null : Number(f.longitude);
      if (f.startDate !== (project.startDate ?? "")) payload.startDate = f.startDate || null;
      if (f.endDate !== (project.endDate ?? "")) payload.endDate = f.endDate || null;
      if (String(f.budget) !== String(project.budget ?? "")) payload.budget = f.budget === "" ? null : Number(f.budget);
      if (Number(f.progressPercent) !== (project.progressPercent ?? 0)) payload.progressPercent = Number(f.progressPercent);
      if (f.status !== project.status) payload.status = f.status;

      const res = await teamFetch(`/projects/${projectId}`, { method: "PATCH", body: JSON.stringify(payload) });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "No se pudo actualizar la obra");
      }
      toast({ title: "Obra actualizada", description: "Los cambios fueron guardados." });
      setEditOpen(false);
      qc.invalidateQueries({ queryKey: ["get-project", projectId] });
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setEditSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm(`¿Eliminar la obra "${project.name}"?\n\nEsto borra TODAS sus bitácoras, materiales, documentos y reportes. Esta acción queda registrada en la auditoría y no se puede deshacer.`)) return;
    setDeleting(true);
    try {
      const res = await teamFetch(`/projects/${projectId}`, { method: "DELETE" });
      if (!res.ok && res.status !== 204) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "No se pudo eliminar");
      }
      toast({ title: "Obra eliminada" });
      window.location.href = "/projects";
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
      setDeleting(false);
    }
  };

  return (
    <MainLayout>
      {/* Hero Banner */}
      <div className="relative h-64 md:h-80 -mx-4 md:-mx-8 -mt-4 md:-mt-8 mb-8 rounded-b-3xl overflow-hidden isolate">
        <img
          src={project.coverImageUrl || `/project-${(project.id % 5) + 1}.png`}
          alt={project.name}
          className="absolute inset-0 w-full h-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-background via-background/80 to-transparent" />

        <div className="absolute inset-x-0 bottom-0 p-6 md:p-10 flex flex-col md:flex-row md:items-end justify-between gap-6 z-10 max-w-7xl mx-auto">
          <div>
            <div className="flex items-center gap-3 mb-3 flex-wrap">
              <Badge variant="outline" className="bg-background/50 backdrop-blur-md border-primary text-primary font-bold tracking-wider uppercase">
                {STATUS_LABELS[project.status] ?? project.status}
              </Badge>
              {project.location && (
                <div className="flex items-center text-white/80 text-sm gap-1 bg-black/40 backdrop-blur-md px-2 py-1 rounded-md">
                  <Icons.Location className="w-4 h-4" />
                  <span>{project.location}</span>
                </div>
              )}
              {isAdmin && (
                <div className="flex items-center gap-2 ml-auto md:ml-0">
                  <Button onClick={openEdit} size="sm" variant="outline" className="bg-background/70 backdrop-blur-md gap-1.5">
                    <Icons.Edit className="w-3.5 h-3.5" /> Editar obra
                  </Button>
                  <Button onClick={handleDelete} disabled={deleting} size="sm" variant="outline" className="bg-background/70 backdrop-blur-md gap-1.5 border-red-300 text-red-700 hover:bg-red-50">
                    <Icons.Delete className="w-3.5 h-3.5" /> {deleting ? "..." : "Eliminar"}
                  </Button>
                </div>
              )}
            </div>
            <h1 className="font-display text-5xl md:text-7xl text-white drop-shadow-lg">{project.name}</h1>
          </div>

          <div className="flex items-center gap-6 bg-card/80 backdrop-blur-xl p-4 rounded-2xl border border-white/10 shrink-0">
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Avance</p>
              <div className="flex items-end gap-2">
                <span className="font-display text-4xl text-primary leading-none">{project.progressPercent}</span>
                <span className="text-muted-foreground mb-1">%</span>
              </div>
            </div>
            <div className="w-px h-12 bg-white/10" />
            <ProgressRing progress={project.progressPercent} size={60} strokeWidth={4} />
          </div>
        </div>
      </div>

      <Tabs defaultValue="overview" className="w-full">
        <TabsList className="bg-sidebar border-b border-card-border rounded-none p-0 h-auto justify-start overflow-x-auto w-full hide-scrollbar">
          <TabsTrigger value="overview" className="px-6 py-4 rounded-none data-[state=active]:bg-background data-[state=active]:border-b-2 data-[state=active]:border-primary font-bold uppercase tracking-wider text-xs">Resumen</TabsTrigger>
          <TabsTrigger value="bitacora" className="px-6 py-4 rounded-none data-[state=active]:bg-background data-[state=active]:border-b-2 data-[state=active]:border-primary font-bold uppercase tracking-wider text-xs">Bitácora</TabsTrigger>
          <TabsTrigger value="materials" className="px-6 py-4 rounded-none data-[state=active]:bg-background data-[state=active]:border-b-2 data-[state=active]:border-primary font-bold uppercase tracking-wider text-xs">Materiales</TabsTrigger>
          <TabsTrigger value="documents" className="px-6 py-4 rounded-none data-[state=active]:bg-background data-[state=active]:border-b-2 data-[state=active]:border-primary font-bold uppercase tracking-wider text-xs">Documentos</TabsTrigger>
          {isAdmin && (
            <TabsTrigger value="team" className="px-6 py-4 rounded-none data-[state=active]:bg-background data-[state=active]:border-b-2 data-[state=active]:border-primary font-bold uppercase tracking-wider text-xs">Equipo</TabsTrigger>
          )}
        </TabsList>

        <div className="mt-8">
          <TabsContent value="overview" className="space-y-8 m-0">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              <div className="lg:col-span-2 space-y-8">
                <div className="bg-card border border-card-border rounded-2xl p-6">
                  <h3 className="font-display text-2xl mb-4">Descripción del Proyecto</h3>
                  <p className="text-muted-foreground leading-relaxed whitespace-pre-wrap">
                    {project.description || "Sin descripción."}
                  </p>

                  <div className="grid grid-cols-2 gap-6 mt-8 pt-8 border-t border-card-border">
                    <div>
                      <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Cliente</p>
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-full bg-sidebar border border-sidebar-border flex items-center justify-center font-bold">
                          {project.clientName?.charAt(0) || 'C'}
                        </div>
                        <span className="font-medium text-foreground">{project.clientName || 'Sin asignar'}</span>
                      </div>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Supervisor</p>
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-full bg-primary/10 border border-primary/30 text-primary flex items-center justify-center font-bold">
                          {project.supervisorName?.charAt(0) || 'S'}
                        </div>
                        <span className="font-medium text-foreground">{project.supervisorName || 'Sin asignar'}</span>
                      </div>
                    </div>
                  </div>
                </div>

                {progress && (
                  <div className="grid grid-cols-2 gap-4">
                    <div className="bg-card border border-card-border rounded-2xl p-6">
                      <Icons.Logs className="w-6 h-6 text-primary mb-4" />
                      <h4 className="text-3xl font-display text-foreground">{progress.totalLogs}</h4>
                      <p className="text-sm text-muted-foreground font-medium">Entradas de Bitácora</p>
                    </div>
                    <div className="bg-card border border-card-border rounded-2xl p-6">
                      <Icons.Materials className="w-6 h-6 text-primary mb-4" />
                      <h4 className="text-3xl font-display text-foreground">{progress.totalMaterials}</h4>
                      <p className="text-sm text-muted-foreground font-medium">Materiales Gestionados</p>
                    </div>
                  </div>
                )}
              </div>

              <div className="space-y-8">
                <div className="bg-sidebar border border-sidebar-border rounded-2xl p-6">
                  <h3 className="font-display text-2xl mb-6">Finanzas</h3>

                  <div className="space-y-6">
                    <div>
                      <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Presupuesto Total</p>
                      <p className="font-mono text-2xl text-foreground">{formatCurrency(project.budget)}</p>
                    </div>

                    <div>
                      <div className="flex justify-between items-end mb-1">
                        <p className="text-xs text-muted-foreground uppercase tracking-wider">Monto Gastado</p>
                        <p className="text-xs font-bold text-primary">{Math.round(progress?.budgetUsedPercent || 0)}%</p>
                      </div>
                      <p className="font-mono text-xl text-foreground mb-2">{formatCurrency(project.spentAmount)}</p>
                      <div className="w-full h-1.5 bg-background rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full ${(progress?.budgetUsedPercent || 0) > 90 ? 'bg-destructive' : 'bg-primary'}`}
                          style={{ width: `${Math.min(progress?.budgetUsedPercent || 0, 100)}%` }}
                        />
                      </div>
                    </div>
                  </div>
                </div>

                <div className="bg-sidebar border border-sidebar-border rounded-2xl p-6">
                  <h3 className="font-display text-2xl mb-6">Calendario</h3>
                  <div className="space-y-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-background flex items-center justify-center">
                        <Icons.Calendar className="w-5 h-5 text-muted-foreground" />
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground uppercase tracking-wider">Fecha de Inicio</p>
                        <p className="font-medium text-sm">{project.startDate ? new Date(project.startDate).toLocaleDateString('es-MX') : 'Por definir'}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-background flex items-center justify-center">
                        <Icons.Check className="w-5 h-5 text-primary" />
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground uppercase tracking-wider">Fecha Estimada de Fin</p>
                        <p className="font-medium text-sm">{project.endDate ? new Date(project.endDate).toLocaleDateString('es-MX') : 'Por definir'}</p>
                      </div>
                    </div>
                  </div>
                </div>

                <Button className="w-full h-12 bg-primary text-primary-foreground font-bold tracking-wider hover:bg-primary/90">
                  Generar Reporte
                </Button>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="bitacora">
            <div className="bg-card border border-card-border p-8 rounded-2xl text-center">
              <Icons.Logs className="w-12 h-12 mx-auto text-muted-foreground mb-4 opacity-50" />
              <h3 className="font-display text-2xl mb-2">Bitácora de Obra</h3>
              <p className="text-muted-foreground mb-6">Ver y gestionar los registros diarios de esta obra.</p>
              <Button onClick={() => window.location.href = `/bitacora?projectId=${project.id}`} variant="outline">
                Abrir Bitácora Completa
              </Button>
            </div>
          </TabsContent>

          <TabsContent value="materials">
            <div className="bg-card border border-card-border p-8 rounded-2xl text-center">
              <Icons.Materials className="w-12 h-12 mx-auto text-muted-foreground mb-4 opacity-50" />
              <h3 className="font-display text-2xl mb-2">Seguimiento de Materiales</h3>
              <p className="text-muted-foreground mb-6">Gestiona solicitudes y uso de materiales.</p>
              <Button onClick={() => window.location.href = `/materiales`} variant="outline">
                Abrir Kanban de Materiales
              </Button>
            </div>
          </TabsContent>

          <TabsContent value="documents">
            <div className="bg-card border border-card-border p-8 rounded-2xl text-center">
              <Icons.Documents className="w-12 h-12 mx-auto text-muted-foreground mb-4 opacity-50" />
              <h3 className="font-display text-2xl mb-2">Documentos del Proyecto</h3>
              <p className="text-muted-foreground mb-6">Accede a planos, contratos y permisos.</p>
              <Button onClick={() => window.location.href = `/documentos`} variant="outline">
                Ver Documentos
              </Button>
            </div>
          </TabsContent>

          {isAdmin && (
            <TabsContent value="team">
              <TeamTab projectId={projectId} isAdmin={isAdmin} />
            </TabsContent>
          )}
        </div>
      </Tabs>

      {/* Modal de Editar Obra (admin) */}
      {editOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }} onClick={() => !editSaving && setEditOpen(false)}>
          <div className="bg-background border border-border rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="p-6 border-b border-border">
              <h3 className="font-display text-2xl">Editar obra</h3>
              <p className="text-sm text-muted-foreground mt-1">Cambia cualquier campo. Los cambios se guardan al confirmar.</p>
            </div>
            <div className="p-6 space-y-4">
              <Field label="Nombre">
                <input className="edit-input" value={editForm.name ?? ""} onChange={e => setEditForm({ ...editForm, name: e.target.value })} />
              </Field>
              <Field label="Descripción">
                <textarea className="edit-input min-h-[70px]" value={editForm.description ?? ""} onChange={e => setEditForm({ ...editForm, description: e.target.value })} />
              </Field>
              <Field label="Ubicación (texto)">
                <input className="edit-input" placeholder="Ej. Av. Reforma 123, CDMX" value={editForm.location ?? ""} onChange={e => setEditForm({ ...editForm, location: e.target.value })} />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Latitud">
                  <input className="edit-input" inputMode="decimal" placeholder="19.4326" value={editForm.latitude ?? ""} onChange={e => setEditForm({ ...editForm, latitude: e.target.value })} />
                </Field>
                <Field label="Longitud">
                  <input className="edit-input" inputMode="decimal" placeholder="-99.1332" value={editForm.longitude ?? ""} onChange={e => setEditForm({ ...editForm, longitude: e.target.value })} />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Inicio">
                  <input type="date" className="edit-input" value={editForm.startDate ?? ""} onChange={e => setEditForm({ ...editForm, startDate: e.target.value })} />
                </Field>
                <Field label="Entrega">
                  <input type="date" className="edit-input" value={editForm.endDate ?? ""} onChange={e => setEditForm({ ...editForm, endDate: e.target.value })} />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Presupuesto (MXN)">
                  <input className="edit-input" inputMode="numeric" value={editForm.budget ?? ""} onChange={e => setEditForm({ ...editForm, budget: e.target.value })} />
                </Field>
                <Field label="Avance (%)">
                  <input className="edit-input" type="number" min={0} max={100} value={editForm.progressPercent ?? 0} onChange={e => setEditForm({ ...editForm, progressPercent: e.target.value })} />
                </Field>
              </div>
              <Field label="Estado">
                <select className="edit-input" value={editForm.status ?? "active"} onChange={e => setEditForm({ ...editForm, status: e.target.value })}>
                  <option value="active">Activa</option>
                  <option value="paused">Pausada</option>
                  <option value="completed">Completada</option>
                  <option value="cancelled">Cancelada</option>
                </select>
              </Field>
            </div>
            <div className="p-6 border-t border-border flex justify-end gap-2">
              <Button variant="outline" onClick={() => setEditOpen(false)} disabled={editSaving}>Cancelar</Button>
              <Button onClick={submitEdit} disabled={editSaving} className="bg-primary text-primary-foreground hover:bg-primary/90">
                {editSaving ? "Guardando..." : "Guardar cambios"}
              </Button>
            </div>
          </div>
          <style>{`.edit-input { width: 100%; padding: 0.6rem 0.85rem; border-radius: 0.6rem; border: 1px solid hsl(var(--border)); background: hsl(var(--background)); font-size: 0.875rem; outline: none; transition: border-color 0.15s; } .edit-input:focus { border-color: hsl(var(--primary)); box-shadow: 0 0 0 3px hsl(var(--primary) / 0.1); }`}</style>
        </div>
      )}
    </MainLayout>
  );
}
