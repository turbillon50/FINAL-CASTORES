import { MainLayout } from "@/components/layout/main-layout";
import { CinematicProjectCard } from "@/components/ui/cinematic-project-card";
import { PageHero } from "@/components/ui/page-hero";
import { useListProjects, useCreateProject, useListUsers, getAuthToken } from "@workspace/api-client-react";
import { Icons } from "@/lib/icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useToast } from "@/hooks/use-toast";
import { usePermissions } from "@/hooks/use-permissions";
import { apiUrl } from "@/lib/api-url";
import { PhotoUploadButtons } from "@/components/ui/photo-upload-buttons";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

const STATUS_META: Record<string, { label: string; color: string }> = {
  active:    { label: "Activas",     color: "#C8952A" },
  paused:    { label: "Pausadas",    color: "#F59E0B" },
  completed: { label: "Completadas", color: "#10B981" },
  cancelled: { label: "Canceladas",  color: "#EF4444" },
};

export default function Projects() {
  const permissions = usePermissions();
  const canCreate = permissions.has("projectsCreateEdit");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const { toast } = useToast();

  const { data: projects = [], isLoading, refetch } = useListProjects(
    statusFilter !== "all" ? { status: statusFilter } : undefined
  );
  const { data: users = [] } = useListUsers();
  const createProject = useCreateProject();

  const supervisors = users.filter(u => u.role === "supervisor" || u.role === "admin");
  const clients = users.filter(u => u.role === "client");

  const filteredProjects = projects.filter(p =>
    p.name.toLowerCase().includes(search.toLowerCase()) ||
    p.location?.toLowerCase().includes(search.toLowerCase())
  );

  const countByStatus = projects.reduce((acc, p) => {
    acc[p.status] = (acc[p.status] ?? 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const [form, setForm] = useState({
    name: "", description: "", location: "", budget: "",
    startDate: "", endDate: "", supervisorId: "", clientId: "",
    status: "active" as const,
    coverImageUrl: "",
    galleryImages: [] as string[],
  });
  const [initialDocs, setInitialDocs] = useState<{ name: string; type: string; size: number; dataUrl: string }[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const fileToDataUrl = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result as string);
      r.onerror = reject;
      r.readAsDataURL(file);
    });

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name) {
      toast({ variant: "destructive", title: "Campo requerido", description: "El nombre de la obra es obligatorio." });
      return;
    }
    setSubmitting(true);
    try {
      const created = await createProject.mutateAsync({
        data: {
          name: form.name,
          description: form.description || null,
          location: form.location || null,
          budget: form.budget ? Number(form.budget) : null,
          startDate: form.startDate || null,
          endDate: form.endDate || null,
          supervisorId: form.supervisorId ? Number(form.supervisorId) : null,
          clientId: form.clientId ? Number(form.clientId) : null,
          status: form.status,
          coverImageUrl: form.coverImageUrl || null,
          galleryImages: form.galleryImages,
        },
      });

      // Subir documentos iniciales (planos, contratos) ya enlazados a esta obra.
      // Cada uno se envía a /api/documents con projectId del recién creado.
      if (initialDocs.length > 0 && created?.id) {
        const token = await getAuthToken().catch(() => null);
        await Promise.all(initialDocs.map(async (d) => {
          const cat = /\.(jpe?g|png|gif|webp|heic)$/i.test(d.name) ? "photo"
            : /\.(pdf|dwg|dxf)$/i.test(d.name) ? "blueprint"
            : "other";
          await fetch(apiUrl("/api/documents"), {
            method: "POST",
            credentials: "include",
            headers: {
              "Content-Type": "application/json",
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            body: JSON.stringify({
              projectId: created.id,
              title: d.name,
              category: cat,
              fileUrl: d.dataUrl,
              fileType: d.type || "application/octet-stream",
              fileSize: d.size,
            }),
          }).catch(() => {});
        }));
      }

      toast({ title: "Obra creada", description: `"${form.name}" registrada${initialDocs.length ? ` con ${initialDocs.length} documento(s) inicial(es)` : ""}.` });
      setShowForm(false);
      setForm({ name: "", description: "", location: "", budget: "", startDate: "", endDate: "", supervisorId: "", clientId: "", status: "active", coverImageUrl: "", galleryImages: [] });
      setInitialDocs([]);
      refetch();
    } catch {
      toast({ variant: "destructive", title: "Error", description: "No se pudo crear la obra." });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <MainLayout>
      <div className="space-y-6 pb-4">
        <PageHero
          title="Portafolio de Obras"
          subtitle="Gestiona, monitorea y controla todas las obras en ejecución"
          imageUrl="https://images.unsplash.com/photo-1503387762-592deb58ef4e?w=1400&q=80&fit=crop"
          accentColor="#C8952A"
          badge="GESTIÓN OPERATIVA"
        />

        {/* Status pills */}
        <div className="flex flex-wrap gap-2">
          {Object.entries(STATUS_META).map(([key, meta]) => (
            <button key={key} onClick={() => setStatusFilter(key === statusFilter ? "all" : key)}
              className="flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-full transition-all"
              style={{
                background: statusFilter === key ? `${meta.color}20` : "rgba(0,0,0,0.04)",
                border: `1px solid ${statusFilter === key ? meta.color + "50" : "transparent"}`,
                color: statusFilter === key ? meta.color : "rgba(0,0,0,0.4)",
              }}>
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: meta.color }} />
              {meta.label}
              {countByStatus[key] != null && <span className="ml-1 opacity-70">{countByStatus[key]}</span>}
            </button>
          ))}
        </div>

        {/* Search + New */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
          <div className="relative flex-1">
            <Icons.Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input placeholder="Buscar por nombre o ubicación..." className="pl-9 bg-white border-black/10 rounded-xl"
              value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          {canCreate && (
            <Button onClick={() => setShowForm(true)} className="rounded-xl font-bold"
              style={{ background: "#C8952A", color: "#fff" }}>
              <Icons.Plus className="w-4 h-4 mr-2" /> Nueva Obra
            </Button>
          )}
        </div>

        {/* Grid */}
        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 animate-pulse">
            {[1,2,3,4,5,6].map(i => <div key={i} className="aspect-[4/3] bg-foreground/5 rounded-2xl" />)}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {filteredProjects.map((project, index) => (
                <CinematicProjectCard key={project.id} project={project} index={index} />
              ))}
            </div>
            {filteredProjects.length === 0 && (
              <div className="text-center py-20 rounded-2xl border border-dashed border-foreground/10 bg-foreground/[0.02]">
                <Icons.Projects className="w-10 h-10 mx-auto text-muted-foreground mb-3 opacity-30" />
                <h3 className="text-lg font-display text-foreground mb-1">Sin resultados</h3>
                <p className="text-muted-foreground text-sm">Ajusta los filtros o crea una nueva obra.</p>
              </div>
            )}
          </>
        )}
      </div>

      {/* ─── Modal Nueva Obra ─────────────────────── */}
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
              className="fixed inset-x-4 top-[4%] bottom-[4%] z-50 overflow-y-auto rounded-2xl md:inset-x-auto md:left-1/2 md:-translate-x-1/2 md:w-[560px]"
              style={{ background: "#fff", boxShadow: "0 24px 64px rgba(0,0,0,0.2)" }}
              onClick={e => e.stopPropagation()}
            >
              <div className="p-6">
                <div className="flex items-center justify-between mb-6">
                  <div>
                    <h2 className="font-display text-2xl text-foreground">Nueva Obra</h2>
                    <p className="text-xs text-muted-foreground mt-0.5">Registra un nuevo proyecto de construcción</p>
                  </div>
                  <button onClick={() => setShowForm(false)}
                    className="w-8 h-8 rounded-full flex items-center justify-center text-foreground/40 hover:bg-foreground/8 transition-colors">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="w-5 h-5">
                      <path d="M18 6L6 18M6 6l12 12" />
                    </svg>
                  </button>
                </div>

                <form onSubmit={handleCreate} className="space-y-4">
                  <div>
                    <label className="text-xs uppercase tracking-wider text-muted-foreground font-semibold block mb-1.5">Foto de portada</label>
                    {form.coverImageUrl ? (
                      <div className="relative">
                        <img src={form.coverImageUrl} alt="Portada" className="w-full h-40 object-cover rounded-xl border border-black/10" />
                        <button type="button"
                          onClick={() => setForm(f => ({ ...f, coverImageUrl: "" }))}
                          className="absolute top-2 right-2 px-2 py-1 rounded-md text-xs font-bold bg-white/90 backdrop-blur shadow text-red-600">
                          Quitar foto
                        </button>
                      </div>
                    ) : (
                      <PhotoUploadButtons
                        multiple={false}
                        helperText="Aparecerá en la tarjeta y en el detalle de la obra"
                        onFilesSelected={async (files) => {
                          const file = files[0];
                          if (!file) return;
                          const dataUrl = await fileToDataUrl(file);
                          setForm(f => ({ ...f, coverImageUrl: dataUrl }));
                        }}
                      />
                    )}
                  </div>

                  <div>
                    <label className="text-xs uppercase tracking-wider text-muted-foreground font-semibold block mb-1.5">Nombre de la Obra *</label>
                    <Input placeholder="Ej. Torre Residencial Polanco" value={form.name}
                      onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                      className="h-11 rounded-xl border-black/10" />
                  </div>

                  <div>
                    <label className="text-xs uppercase tracking-wider text-muted-foreground font-semibold block mb-1.5">Descripción</label>
                    <Textarea placeholder="Descripción del proyecto..." value={form.description}
                      onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                      className="rounded-xl border-black/10 resize-none" rows={2} />
                  </div>

                  <div>
                    <label className="text-xs uppercase tracking-wider text-muted-foreground font-semibold block mb-1.5">Ubicación</label>
                    <Input placeholder="Ej. Av. Presidente Masaryk 123, CDMX" value={form.location}
                      onChange={e => setForm(f => ({ ...f, location: e.target.value }))}
                      className="h-11 rounded-xl border-black/10" />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs uppercase tracking-wider text-muted-foreground font-semibold block mb-1.5">Fecha Inicio</label>
                      <Input type="date" value={form.startDate}
                        onChange={e => setForm(f => ({ ...f, startDate: e.target.value }))}
                        className="h-11 rounded-xl border-black/10" />
                    </div>
                    <div>
                      <label className="text-xs uppercase tracking-wider text-muted-foreground font-semibold block mb-1.5">Fecha Término</label>
                      <Input type="date" value={form.endDate}
                        onChange={e => setForm(f => ({ ...f, endDate: e.target.value }))}
                        className="h-11 rounded-xl border-black/10" />
                    </div>
                  </div>

                  <div>
                    <label className="text-xs uppercase tracking-wider text-muted-foreground font-semibold block mb-1.5">Presupuesto (MXN)</label>
                    <Input type="number" min="0" step="1000" placeholder="0.00" value={form.budget}
                      onChange={e => setForm(f => ({ ...f, budget: e.target.value }))}
                      className="h-11 rounded-xl border-black/10" />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs uppercase tracking-wider text-muted-foreground font-semibold block mb-1.5">Supervisor</label>
                      <Select value={form.supervisorId} onValueChange={v => setForm(f => ({ ...f, supervisorId: v }))}>
                        <SelectTrigger className="h-11 rounded-xl border-black/10">
                          <SelectValue placeholder="Seleccionar" />
                        </SelectTrigger>
                        <SelectContent>
                          {supervisors.map(u => <SelectItem key={u.id} value={u.id.toString()}>{u.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <label className="text-xs uppercase tracking-wider text-muted-foreground font-semibold block mb-1.5">Cliente</label>
                      <Select value={form.clientId} onValueChange={v => setForm(f => ({ ...f, clientId: v }))}>
                        <SelectTrigger className="h-11 rounded-xl border-black/10">
                          <SelectValue placeholder="Seleccionar" />
                        </SelectTrigger>
                        <SelectContent>
                          {clients.map(u => <SelectItem key={u.id} value={u.id.toString()}>{u.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div>
                    <label className="text-xs uppercase tracking-wider text-muted-foreground font-semibold block mb-1.5">Estado Inicial</label>
                    <Select value={form.status} onValueChange={v => setForm(f => ({ ...f, status: v as any }))}>
                      <SelectTrigger className="h-11 rounded-xl border-black/10">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="active">Activa</SelectItem>
                        <SelectItem value="paused">Pausada</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <label className="text-xs uppercase tracking-wider text-muted-foreground font-semibold block mb-1.5">Galería de imágenes (opcional)</label>
                    {form.galleryImages.length > 0 && (
                      <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 mb-2">
                        {form.galleryImages.map((img, i) => (
                          <div key={i} className="relative group aspect-square rounded-lg overflow-hidden border border-black/10">
                            <img src={img} alt={`img-${i}`} className="w-full h-full object-cover" />
                            <button type="button"
                              onClick={() => setForm(f => ({ ...f, galleryImages: f.galleryImages.filter((_, j) => j !== i) }))}
                              className="absolute top-1 right-1 w-5 h-5 rounded-full bg-red-600 text-white text-[10px] font-bold opacity-0 group-hover:opacity-100 transition-opacity">✕</button>
                          </div>
                        ))}
                      </div>
                    )}
                    <PhotoUploadButtons
                      variant="compact"
                      helperText="Renders, fotos del sitio o avances · Hasta 30 imágenes"
                      onFilesSelected={async (files) => {
                        if (files.length === 0) return;
                        const urls = await Promise.all(files.map(fileToDataUrl));
                        setForm(f => ({ ...f, galleryImages: [...f.galleryImages, ...urls].slice(0, 30) }));
                      }}
                    />
                  </div>

                  <div>
                    <label className="text-xs uppercase tracking-wider text-muted-foreground font-semibold block mb-1.5">Documentos iniciales (planos, contratos, permisos…)</label>
                    {initialDocs.length > 0 && (
                      <ul className="space-y-1 mb-2">
                        {initialDocs.map((d, i) => (
                          <li key={i} className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-black/5 text-xs">
                            <span className="truncate">📎 {d.name} <span className="text-muted-foreground">({(d.size / 1024).toFixed(0)} KB)</span></span>
                            <button type="button" onClick={() => setInitialDocs(ds => ds.filter((_, j) => j !== i))} className="text-red-600 font-bold">✕</button>
                          </li>
                        ))}
                      </ul>
                    )}
                    <label className="block">
                      <span className="block px-4 py-3 rounded-xl border-2 border-dashed border-black/15 text-center text-xs text-muted-foreground hover:bg-black/5 cursor-pointer transition-colors">
                        📂 Subir planos / contratos / permisos
                        <span className="block text-[10px] mt-1 text-muted-foreground/70">Quedan archivados en la pestaña "Documentos" de la obra.</span>
                      </span>
                      <input type="file" multiple className="hidden" onChange={async (e) => {
                        const files = Array.from(e.target.files ?? []);
                        if (files.length === 0) return;
                        const docs = await Promise.all(files.map(async (f) => ({
                          name: f.name,
                          type: f.type,
                          size: f.size,
                          dataUrl: await fileToDataUrl(f),
                        })));
                        setInitialDocs(prev => [...prev, ...docs].slice(0, 12));
                      }} />
                    </label>
                  </div>

                  <div className="flex gap-3 pt-2">
                    <Button type="button" variant="outline" onClick={() => setShowForm(false)}
                      className="flex-1 rounded-xl border-black/10">Cancelar</Button>
                    <Button type="submit" disabled={submitting} className="flex-1 rounded-xl font-bold"
                      style={{ background: "#C8952A", color: "#fff" }}>
                      {submitting ? "Creando..." : "Crear Obra"}
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
