import { MainLayout } from "@/components/layout/main-layout";
import { useGetProject, useGetProjectProgress, getAuthToken, getClerkUserInfo } from "@workspace/api-client-react";
import { PhotoUploadButtons } from "@/components/ui/photo-upload-buttons";
import { compressImageFile } from "@/lib/compress-image";
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

function ProjectMilestonesView({ project }: { project: any }) {
  const milestones: any[] = Array.isArray(project.milestones) ? project.milestones : [];
  if (milestones.length === 0) return null;
  const fmt = (d?: string | null) => {
    if (!d) return "Sin fecha";
    try {
      return new Date(d).toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "2-digit" });
    } catch { return d; }
  };
  const total = milestones.length;
  const done = milestones.filter((m) => m.completed).length;
  return (
    <div className="bg-card border border-card-border rounded-2xl p-5 mb-6">
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <span className="text-xl">🚧</span>
          <h3 className="font-display text-lg">Hitos y partidas</h3>
        </div>
        <span className="text-xs text-muted-foreground">{done} de {total} completados</span>
      </div>
      <div className="space-y-2">
        {milestones.map((m, i) => (
          <div key={m.id ?? i} className={"flex items-center gap-3 p-3 rounded-lg border " + (m.completed ? "bg-emerald-50/50 border-emerald-200" : "bg-sidebar border-card-border")}>
            <span className={"flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold " + (m.completed ? "bg-emerald-500 text-white" : "bg-muted text-muted-foreground")}>
              {m.completed ? "✓" : i + 1}
            </span>
            <div className="flex-1 min-w-0">
              <p className={"font-medium text-sm " + (m.completed ? "line-through text-muted-foreground" : "")}>{m.name || `Hito ${i + 1}`}</p>
              {m.notes && <p className="text-xs text-muted-foreground mt-0.5">{m.notes}</p>}
            </div>
            <span className="flex-shrink-0 text-[10px] uppercase tracking-wider text-muted-foreground font-mono">
              {fmt(m.dueDate)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ProjectGalleryView({ project }: { project: any }) {
  const images: string[] = Array.isArray(project.galleryImages) ? project.galleryImages : [];
  if (images.length === 0) return null;
  return (
    <div className="bg-card border border-card-border rounded-2xl p-5 mb-6">
      <div className="flex items-center gap-2 mb-4">
        <span className="text-xl">🖼️</span>
        <h3 className="font-display text-lg">Galería</h3>
        <span className="text-xs text-muted-foreground ml-auto">{images.length} imágenes</span>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
        {images.map((img, i) => (
          <a key={i} href={img} target="_blank" rel="noreferrer" className="relative aspect-square rounded-lg overflow-hidden border border-card-border group">
            <img src={img} alt={`Imagen ${i + 1}`} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
          </a>
        ))}
      </div>
    </div>
  );
}

function ProjectCalendarCard({ project }: { project: any }) {
  const fmt = (d?: string | null) => {
    if (!d) return null;
    try {
      return new Date(d).toLocaleDateString("es-MX", { day: "2-digit", month: "long", year: "numeric" });
    } catch { return d; }
  };
  const start = project.startDate;
  const end = project.endDate;

  // Días entre hoy y la fecha de entrega; negativo = ya se pasó.
  let daysLeft: number | null = null;
  if (end) {
    const e = new Date(end);
    const now = new Date();
    daysLeft = Math.round((e.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  }

  // Duración total y % transcurrido en tiempo (no en avance).
  let elapsedPct: number | null = null;
  if (start && end) {
    const s = new Date(start).getTime();
    const e = new Date(end).getTime();
    const now = Date.now();
    if (e > s) {
      elapsedPct = Math.max(0, Math.min(100, Math.round(((now - s) / (e - s)) * 100)));
    }
  }

  return (
    <div className="bg-card border border-card-border rounded-2xl p-5 mt-4 mb-6">
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <span className="text-xl">🗓️</span>
          <h3 className="font-display text-lg">Calendario y plazo</h3>
        </div>
        {daysLeft != null && (
          <span className={"text-xs font-bold px-2.5 py-1 rounded-full " + (daysLeft < 0 ? "bg-red-100 text-red-700" : daysLeft < 14 ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700")}>
            {daysLeft < 0 ? `Vencida hace ${Math.abs(daysLeft)} días` : daysLeft === 0 ? "Vence hoy" : `Faltan ${daysLeft} días`}
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
        <div>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">Fecha de inicio</p>
          <p className="font-medium">{fmt(start) ?? <span className="text-muted-foreground italic">No definida</span>}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">Fecha de entrega</p>
          <p className="font-medium">{fmt(end) ?? <span className="text-muted-foreground italic">No definida</span>}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">Tiempo transcurrido</p>
          <p className="font-medium">
            {elapsedPct != null
              ? <span>{elapsedPct}% del plazo</span>
              : <span className="text-muted-foreground italic">Sin fechas completas</span>}
          </p>
        </div>
      </div>

      {elapsedPct != null && (
        <div className="mt-4 space-y-1.5">
          <div className="flex items-center justify-between text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">
            <span>Avance en tiempo</span>
            <span>Avance reportado</span>
          </div>
          <div className="relative h-2 rounded-full bg-foreground/10 overflow-hidden">
            <div className="absolute left-0 top-0 h-full bg-amber-500/60" style={{ width: `${elapsedPct}%` }} />
            <div className="absolute left-0 top-0 h-full border-r-2 border-emerald-500" style={{ width: `${project.progressPercent ?? 0}%` }} />
          </div>
          <p className="text-[11px] text-muted-foreground">
            {(project.progressPercent ?? 0) >= elapsedPct
              ? "✓ El avance reportado va al día con el calendario."
              : `⚠️ Vas ${elapsedPct - (project.progressPercent ?? 0)} puntos atrás del calendario.`}
          </p>
        </div>
      )}
    </div>
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
    return (
      <MainLayout>
        <div className="max-w-md mx-auto py-20 text-center space-y-4">
          <div className="text-6xl opacity-30">🏗️</div>
          <h2 className="font-display text-2xl">Esta obra no existe</h2>
          <p className="text-sm text-muted-foreground">
            Puede que haya sido eliminada o que el enlace esté desactualizado.
          </p>
          <Button onClick={() => (window.location.href = "/projects")} className="mt-4">
            Ver todas las obras
          </Button>
        </div>
      </MainLayout>
    );
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
      coverImageUrl: project.coverImageUrl ?? "",
      galleryImages: Array.isArray((project as any).galleryImages) ? [...(project as any).galleryImages] : [],
      milestones: Array.isArray((project as any).milestones) ? [...(project as any).milestones] : [],
    });
    setEditOpen(true);
  };

  const addGalleryFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const dataUrls = await Promise.all(Array.from(files).map(fileToDataUrl));
    setEditForm((f: any) => ({ ...f, galleryImages: [...(f.galleryImages ?? []), ...dataUrls].slice(0, 30) }));
  };
  const removeGalleryAt = (idx: number) =>
    setEditForm((f: any) => ({ ...f, galleryImages: (f.galleryImages ?? []).filter((_: any, i: number) => i !== idx) }));

  const addMilestone = () => {
    const id = (crypto as any).randomUUID?.() ?? `m_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    setEditForm((f: any) => ({
      ...f,
      milestones: [...(f.milestones ?? []), { id, name: "", dueDate: "", completed: false, notes: "" }],
    }));
  };
  const updateMilestone = (id: string, patch: Partial<any>) =>
    setEditForm((f: any) => ({
      ...f,
      milestones: (f.milestones ?? []).map((m: any) => (m.id === id ? { ...m, ...patch } : m)),
    }));
  const removeMilestone = (id: string) =>
    setEditForm((f: any) => ({ ...f, milestones: (f.milestones ?? []).filter((m: any) => m.id !== id) }));

  // Compresión client-side antes de mandar — ver compress-image.ts.
  // Sin esto, una galería de 6 fotos del iPhone reventaba el límite
  // de 4.5 MB de Vercel y el PATCH se caía sin guardar nada.
  const fileToDataUrl = (file: File): Promise<string> => compressImageFile(file);

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
      if ((f.coverImageUrl ?? "") !== (project.coverImageUrl ?? "")) payload.coverImageUrl = f.coverImageUrl || null;

      const galleryBefore: string[] = Array.isArray((project as any).galleryImages) ? (project as any).galleryImages : [];
      const galleryAfter: string[] = Array.isArray(f.galleryImages) ? f.galleryImages : [];
      const galleryChanged =
        galleryBefore.length !== galleryAfter.length ||
        galleryBefore.some((p, i) => p !== galleryAfter[i]);
      if (galleryChanged) payload.galleryImages = galleryAfter;

      const milesBefore = Array.isArray((project as any).milestones) ? (project as any).milestones : [];
      const milesAfter = Array.isArray(f.milestones) ? f.milestones : [];
      if (JSON.stringify(milesBefore) !== JSON.stringify(milesAfter)) payload.milestones = milesAfter;

      // teamFetch ya parsea el body y lanza en errores. No envolver en
      // res.ok / res.json — eso era el bug que generaba el toast rojo
      // "W.json is not a function" sobre una operación que en realidad
      // se guardaba bien.
      await teamFetch(`/projects/${projectId}`, { method: "PATCH", body: JSON.stringify(payload) });
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
      await teamFetch(`/projects/${projectId}`, { method: "DELETE" });
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

      {/* Calendario / Plazo de la obra */}
      <ProjectCalendarCard project={project} />

      {/* Hitos y partidas */}
      <ProjectMilestonesView project={project} />

      {/* Galería de imágenes */}
      <ProjectGalleryView project={project} />

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
              <Field label="Foto de portada">
                {editForm.coverImageUrl ? (
                  <div className="relative">
                    <img src={editForm.coverImageUrl} alt="Portada" className="w-full h-40 object-cover rounded-lg border border-border" />
                    <button type="button"
                      onClick={() => setEditForm({ ...editForm, coverImageUrl: "" })}
                      className="absolute top-2 right-2 px-2 py-1 rounded-md text-xs font-bold bg-white/90 backdrop-blur shadow text-red-600">
                      Quitar foto
                    </button>
                  </div>
                ) : (
                  <PhotoUploadButtons
                    multiple={false}
                    helperText="Esta foto sale en la tarjeta y en el banner"
                    onFilesSelected={async (files) => {
                      const file = files[0];
                      if (!file) return;
                      const dataUrl = await fileToDataUrl(file);
                      setEditForm({ ...editForm, coverImageUrl: dataUrl });
                    }}
                  />
                )}
              </Field>

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

              <Field label="Galería de imágenes (planos, render, fotos del sitio)">
                <div className="space-y-3">
                  {Array.isArray(editForm.galleryImages) && editForm.galleryImages.length > 0 && (
                    <div className="grid grid-cols-3 md:grid-cols-4 gap-2">
                      {editForm.galleryImages.map((img: string, i: number) => (
                        <div key={i} className="relative group aspect-square rounded-lg overflow-hidden border border-border">
                          <img src={img} alt={`Imagen ${i + 1}`} className="w-full h-full object-cover" />
                          <button type="button"
                            onClick={() => removeGalleryAt(i)}
                            className="absolute top-1 right-1 w-6 h-6 rounded-full bg-red-600 text-white flex items-center justify-center text-xs font-bold opacity-0 group-hover:opacity-100 transition-opacity"
                            title="Quitar imagen"
                          >✕</button>
                        </div>
                      ))}
                    </div>
                  )}
                  <PhotoUploadButtons
                    variant="compact"
                    helperText="Hasta 30 imágenes por obra"
                    onFilesSelected={(files) => {
                      const dt = new DataTransfer();
                      files.forEach((f) => dt.items.add(f));
                      addGalleryFiles(dt.files);
                    }}
                  />
                </div>
              </Field>

              <Field label="Hitos / Partidas de la obra">
                <div className="space-y-2">
                  {(editForm.milestones ?? []).length === 0 && (
                    <p className="text-xs italic text-muted-foreground">Sin hitos. Agrega los pasos clave de la obra: cimentación, estructura, instalaciones, acabados, entrega…</p>
                  )}
                  {(editForm.milestones ?? []).map((m: any) => (
                    <div key={m.id} className="grid grid-cols-12 gap-2 items-center p-2 rounded-lg border border-border">
                      <input
                        type="checkbox"
                        checked={!!m.completed}
                        onChange={(e) => updateMilestone(m.id, { completed: e.target.checked })}
                        className="col-span-1 w-4 h-4 accent-emerald-600"
                        title="Marcar completado"
                      />
                      <input
                        className="col-span-6 px-2 py-1 rounded-md text-sm border border-transparent focus:border-primary outline-none bg-transparent"
                        placeholder="Nombre del hito (ej. Cimentación)"
                        value={m.name ?? ""}
                        onChange={(e) => updateMilestone(m.id, { name: e.target.value })}
                      />
                      <input
                        type="date"
                        className="col-span-4 px-2 py-1 rounded-md text-sm border border-transparent focus:border-primary outline-none bg-transparent"
                        value={(m.dueDate ?? "").slice(0, 10)}
                        onChange={(e) => updateMilestone(m.id, { dueDate: e.target.value })}
                      />
                      <button type="button" onClick={() => removeMilestone(m.id)} className="col-span-1 text-red-600 hover:bg-red-50 rounded-md p-1" title="Eliminar hito">✕</button>
                    </div>
                  ))}
                  <button type="button" onClick={addMilestone}
                    className="w-full px-3 py-2 rounded-lg border-2 border-dashed border-border text-sm text-muted-foreground hover:bg-accent transition">
                    + Agregar hito
                  </button>
                </div>
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
