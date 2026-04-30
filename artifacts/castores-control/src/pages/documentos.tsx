import { MainLayout } from "@/components/layout/main-layout";
import { useListDocuments, useCreateDocument, useDeleteDocument, useListProjects } from "@workspace/api-client-react";
import { Icons } from "@/lib/icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { PageHero } from "@/components/ui/page-hero";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { motion, AnimatePresence } from "framer-motion";
import { useState, useRef } from "react";
import { useToast } from "@/hooks/use-toast";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

const CATEGORY_META: Record<string, { label: string; icon: string; color: string }> = {
  contract:  { label: "Contrato",   icon: "📄", color: "#F59E0B" },
  blueprint: { label: "Plano",      icon: "📐", color: "#3B82F6" },
  permit:    { label: "Permiso",    icon: "✅", color: "#10B981" },
  report:    { label: "Reporte",    icon: "📊", color: "#8B5CF6" },
  invoice:   { label: "Factura",    icon: "💰", color: "#C8952A" },
  photo:     { label: "Fotografía", icon: "📷", color: "#EF4444" },
  other:     { label: "Otro",       icon: "📁", color: "#6B7280" },
};

function isImageUrl(url?: string | null): boolean {
  if (!url) return false;
  return url.startsWith("data:image/") || /\.(jpe?g|png|gif|webp|avif|svg)(\?|$)/i.test(url);
}

export default function Documentos() {
  const { data: documents = [], isLoading, refetch } = useListDocuments();
  const { data: projects = [] } = useListProjects();
  const createDocument = useCreateDocument();
  const deleteDocument = useDeleteDocument();
  const { toast } = useToast();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showForm, setShowForm] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);
  const [previewDoc, setPreviewDoc] = useState<any | null>(null);
  const [form, setForm] = useState({
    title: "", description: "", category: "other", projectId: "",
  });

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      if (!form.title) setForm(f => ({ ...f, title: file.name.replace(/\.[^/.]+$/, "") }));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title || !form.category || !form.projectId) {
      toast({ variant: "destructive", title: "Campos requeridos", description: "Completa título, categoría y proyecto." });
      return;
    }
    setSubmitting(true);
    try {
      let fileUrl = "";
      let fileType = "application/octet-stream";
      let fileSize: number | null = null;

      if (selectedFile) {
        fileType = selectedFile.type || "application/octet-stream";
        fileSize = selectedFile.size;
        fileUrl = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.readAsDataURL(selectedFile);
        });
      }

      await createDocument.mutateAsync({
        data: {
          title: form.title,
          description: form.description || null,
          category: form.category as any,
          projectId: Number(form.projectId),
          fileUrl,
          fileType,
          fileSize,
        },
      });
      toast({ title: "Documento Subido", description: `"${form.title}" fue registrado en la bóveda.` });
      setShowForm(false);
      setSelectedFile(null);
      setForm({ title: "", description: "", category: "other", projectId: "" });
      refetch();
    } catch {
      toast({ variant: "destructive", title: "Error", description: "No se pudo guardar el documento." });
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await deleteDocument.mutateAsync({ id });
      toast({ title: "Documento Eliminado" });
      setConfirmDelete(null);
      refetch();
    } catch {
      toast({ variant: "destructive", title: "Error", description: "No se pudo eliminar el documento." });
    }
  };

  const handleDownload = (doc: any) => {
    if (doc.fileUrl?.startsWith("data:")) {
      const a = document.createElement("a");
      a.href = doc.fileUrl;
      a.download = doc.title;
      a.click();
    } else if (doc.fileUrl && !doc.fileUrl.startsWith("file://")) {
      window.open(doc.fileUrl, "_blank");
    } else {
      toast({ variant: "destructive", title: "Sin archivo", description: "Este documento no tiene un archivo descargable." });
    }
  };

  return (
    <MainLayout>
      <div className="space-y-6 pb-4">
        <PageHero
          title="Bóveda Documental"
          subtitle="Almacenamiento seguro de planos, contratos, permisos y evidencias"
          imageUrl="https://images.unsplash.com/photo-1568992687947-868a62a9f521?w=1400&q=80&fit=crop"
          accentColor="#3B82F6"
          badge="GESTIÓN DOCUMENTAL"
        >
          <button onClick={() => setShowForm(true)}
            className="mt-1 text-xs font-bold px-4 py-2 rounded-xl flex items-center gap-1.5"
            style={{ background: "rgba(59,130,246,0.25)", border: "1px solid rgba(59,130,246,0.5)", color: "#fff" }}>
            <Icons.Upload className="w-3.5 h-3.5 mr-1" /> Subir Archivo
          </button>
        </PageHero>

        {isLoading ? (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 animate-pulse">
            {[1,2,3,4].map(i => <div key={i} className="aspect-[3/4] bg-foreground/5 rounded-2xl" />)}
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {documents.map((doc, i) => {
              const meta = CATEGORY_META[doc.category] ?? CATEGORY_META.other;
              const hasImage = isImageUrl(doc.fileUrl);
              return (
                <motion.div key={doc.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.04 }}
                  className="bg-white rounded-2xl flex flex-col group relative overflow-hidden cursor-pointer active:scale-[0.98] transition-transform"
                  style={{ border: "1px solid rgba(0,0,0,0.07)", boxShadow: "0 2px 8px rgba(0,0,0,0.04)" }}
                  onClick={() => setPreviewDoc(doc)}>

                  {/* Image thumbnail or icon */}
                  {hasImage ? (
                    <div className="w-full aspect-video overflow-hidden bg-gray-100">
                      <img src={doc.fileUrl!} alt={doc.title}
                        className="w-full h-full object-cover" />
                    </div>
                  ) : (
                    <div className="w-full aspect-video flex items-center justify-center text-4xl"
                      style={{ background: `${meta.color}10` }}>
                      {meta.icon}
                    </div>
                  )}

                  <div className="p-3 flex flex-col gap-2 flex-1">
                    <h3 className="font-semibold text-sm text-foreground leading-tight line-clamp-2">{doc.title}</h3>
                    {doc.projectName && (
                      <p className="text-[10px] text-muted-foreground truncate">{doc.projectName}</p>
                    )}

                    <div className="flex items-center justify-between mt-auto">
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                        style={{ background: `${meta.color}15`, color: meta.color }}>
                        {meta.label}
                      </span>
                      <span className="text-[9px] text-muted-foreground font-mono">
                        {format(new Date(doc.createdAt), "dd MMM yy", { locale: es })}
                      </span>
                    </div>
                  </div>
                </motion.div>
              );
            })}

            {documents.length === 0 && (
              <div className="col-span-full py-20 text-center rounded-2xl border border-dashed border-foreground/10">
                <Icons.Documents className="w-10 h-10 mx-auto text-muted-foreground mb-3 opacity-30" />
                <h3 className="text-lg font-display text-foreground mb-1">Bóveda Vacía</h3>
                <p className="text-muted-foreground text-sm mb-4">Aún no hay documentos registrados.</p>
                <button onClick={() => setShowForm(true)}
                  className="px-4 py-2 rounded-xl text-sm font-bold"
                  style={{ background: "#3B82F6", color: "#fff" }}>
                  Subir primer documento
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ─── Preview Modal ─── */}
      <AnimatePresence>
        {previewDoc && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 z-50" style={{ background: "rgba(0,0,0,0.85)", backdropFilter: "blur(8px)" }}
              onClick={() => setPreviewDoc(null)} />
            <motion.div
              initial={{ opacity: 0, scale: 0.94 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.94 }}
              transition={{ type: "spring", stiffness: 380, damping: 30 }}
              className="fixed inset-x-4 top-[5%] bottom-[5%] z-50 rounded-2xl flex flex-col overflow-hidden md:inset-x-auto md:left-1/2 md:-translate-x-1/2 md:w-[560px]"
              style={{ background: "#fff", boxShadow: "0 24px 64px rgba(0,0,0,0.4)" }}
              onClick={e => e.stopPropagation()}
            >
              {/* Header */}
              <div className="flex items-center justify-between px-5 py-4 border-b border-black/[0.07] flex-shrink-0">
                <div className="min-w-0 flex-1 mr-3">
                  <h2 className="font-semibold text-base text-foreground truncate">{previewDoc.title}</h2>
                  {previewDoc.projectName && (
                    <p className="text-xs text-muted-foreground truncate">{previewDoc.projectName}</p>
                  )}
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {(previewDoc.fileUrl?.startsWith("data:") || (previewDoc.fileUrl && !previewDoc.fileUrl.startsWith("file://"))) && (
                    <button
                      onClick={() => handleDownload(previewDoc)}
                      className="w-8 h-8 rounded-lg flex items-center justify-center text-white text-xs font-bold"
                      style={{ background: CATEGORY_META[previewDoc.category]?.color ?? "#6B7280" }}>
                      <Icons.Download className="w-4 h-4" />
                    </button>
                  )}
                  <button
                    onClick={() => { setConfirmDelete(previewDoc.id); setPreviewDoc(null); }}
                    className="w-8 h-8 rounded-lg flex items-center justify-center text-white bg-red-500">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="w-4 h-4">
                      <path d="M3 6h18M19 6l-1 14H6L5 6M10 11v6M14 11v6M9 6V4h6v2" />
                    </svg>
                  </button>
                  <button onClick={() => setPreviewDoc(null)}
                    className="w-8 h-8 rounded-full flex items-center justify-center text-foreground/40 hover:bg-foreground/8">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="w-5 h-5">
                      <path d="M18 6L6 18M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </div>

              {/* Content */}
              <div className="flex-1 overflow-auto flex flex-col">
                {isImageUrl(previewDoc.fileUrl) ? (
                  <div className="flex-1 flex items-center justify-center p-4 bg-gray-50">
                    <img src={previewDoc.fileUrl} alt={previewDoc.title}
                      className="max-w-full max-h-full object-contain rounded-lg"
                      style={{ maxHeight: "calc(100vh - 240px)" }} />
                  </div>
                ) : (
                  <div className="flex-1 flex flex-col items-center justify-center gap-4 p-8 text-center bg-gray-50">
                    <span className="text-6xl">{CATEGORY_META[previewDoc.category]?.icon ?? "📁"}</span>
                    <p className="text-sm text-muted-foreground">
                      {previewDoc.fileUrl?.startsWith("file://")
                        ? "Archivo local — no disponible para previsualización en línea."
                        : "Este tipo de archivo no tiene vista previa."}
                    </p>
                    {!previewDoc.fileUrl?.startsWith("file://") && (
                      <button onClick={() => handleDownload(previewDoc)}
                        className="px-5 py-2.5 rounded-xl text-sm font-bold text-white"
                        style={{ background: CATEGORY_META[previewDoc.category]?.color ?? "#6B7280" }}>
                        Descargar / Abrir
                      </button>
                    )}
                  </div>
                )}

                {/* Meta info */}
                {(previewDoc.description || previewDoc.uploadedByName) && (
                  <div className="px-5 py-4 border-t border-black/[0.07] space-y-1 flex-shrink-0">
                    {previewDoc.description && (
                      <p className="text-sm text-foreground/80">{previewDoc.description}</p>
                    )}
                    {previewDoc.uploadedByName && (
                      <p className="text-xs text-muted-foreground">Subido por {previewDoc.uploadedByName}</p>
                    )}
                  </div>
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* ─── Modal Subir Documento ─── */}
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
              className="fixed inset-x-4 top-[10%] z-50 rounded-2xl md:inset-x-auto md:left-1/2 md:-translate-x-1/2 md:w-[480px]"
              style={{ background: "#fff", boxShadow: "0 24px 64px rgba(0,0,0,0.2)" }}
              onClick={e => e.stopPropagation()}
            >
              <div className="p-6">
                <div className="flex items-center justify-between mb-5">
                  <div>
                    <h2 className="font-display text-2xl text-foreground">Subir Documento</h2>
                    <p className="text-xs text-muted-foreground mt-0.5">Agrega archivos a la bóveda</p>
                  </div>
                  <button onClick={() => setShowForm(false)}
                    className="w-8 h-8 rounded-full flex items-center justify-center text-foreground/40 hover:bg-foreground/8">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="w-5 h-5">
                      <path d="M18 6L6 18M6 6l12 12" />
                    </svg>
                  </button>
                </div>

                <form onSubmit={handleSubmit} className="space-y-4">
                  <input ref={fileInputRef} type="file" className="hidden" onChange={handleFileSelect}
                    accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,.dwg,.zip" />
                  <button type="button" onClick={() => fileInputRef.current?.click()}
                    className="w-full border-2 border-dashed border-black/10 rounded-xl p-5 text-center hover:border-blue-400/50 hover:bg-blue-50/30 transition-all">
                    {selectedFile ? (
                      <div className="flex items-center justify-center gap-3">
                        <span className="text-2xl">
                          {selectedFile.type.startsWith("image/") ? "🖼️" : "📄"}
                        </span>
                        <div className="text-left">
                          <p className="font-medium text-sm text-foreground">{selectedFile.name}</p>
                          <p className="text-xs text-muted-foreground">{(selectedFile.size / 1024).toFixed(0)} KB</p>
                        </div>
                      </div>
                    ) : (
                      <>
                        <Icons.Upload className="w-8 h-8 mx-auto text-muted-foreground mb-2" />
                        <p className="text-sm font-medium text-foreground/60">Toca para seleccionar archivo</p>
                        <p className="text-xs text-muted-foreground">PDF, DOC, XLS, imágenes, DWG</p>
                      </>
                    )}
                  </button>

                  <div>
                    <label className="text-xs uppercase tracking-wider text-muted-foreground font-semibold block mb-1.5">Título *</label>
                    <Input placeholder="Nombre del documento" value={form.title}
                      onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                      className="h-11 rounded-xl border-black/10" />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs uppercase tracking-wider text-muted-foreground font-semibold block mb-1.5">Categoría *</label>
                      <Select value={form.category} onValueChange={v => setForm(f => ({ ...f, category: v }))}>
                        <SelectTrigger className="h-11 rounded-xl border-black/10">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {Object.entries(CATEGORY_META).map(([key, meta]) => (
                            <SelectItem key={key} value={key}>{meta.icon} {meta.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <label className="text-xs uppercase tracking-wider text-muted-foreground font-semibold block mb-1.5">Proyecto *</label>
                      <Select value={form.projectId} onValueChange={v => setForm(f => ({ ...f, projectId: v }))}>
                        <SelectTrigger className="h-11 rounded-xl border-black/10">
                          <SelectValue placeholder="Seleccionar" />
                        </SelectTrigger>
                        <SelectContent>
                          {projects.map(p => <SelectItem key={p.id} value={p.id.toString()}>{p.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div>
                    <label className="text-xs uppercase tracking-wider text-muted-foreground font-semibold block mb-1.5">Descripción</label>
                    <Textarea placeholder="Notas adicionales..." value={form.description}
                      onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                      className="rounded-xl border-black/10 resize-none" rows={2} />
                  </div>

                  <div className="flex gap-3 pt-1">
                    <Button type="button" variant="outline" onClick={() => setShowForm(false)}
                      className="flex-1 rounded-xl border-black/10">Cancelar</Button>
                    <Button type="submit" disabled={submitting} className="flex-1 rounded-xl font-bold"
                      style={{ background: "#3B82F6", color: "#fff" }}>
                      {submitting ? "Subiendo..." : "Guardar Documento"}
                    </Button>
                  </div>
                </form>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* ─── Confirm Delete ─── */}
      <AnimatePresence>
        {confirmDelete !== null && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 z-50" style={{ background: "rgba(0,0,0,0.4)", backdropFilter: "blur(8px)" }}
              onClick={() => setConfirmDelete(null)} />
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="fixed z-50 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-80 rounded-2xl p-6"
              style={{ background: "#fff", boxShadow: "0 24px 64px rgba(0,0,0,0.2)" }}
              onClick={e => e.stopPropagation()}
            >
              <h3 className="font-display text-xl mb-2">¿Eliminar documento?</h3>
              <p className="text-sm text-muted-foreground mb-5">Esta acción no se puede deshacer.</p>
              <div className="flex gap-3">
                <Button variant="outline" onClick={() => setConfirmDelete(null)} className="flex-1 rounded-xl border-black/10">Cancelar</Button>
                <Button onClick={() => handleDelete(confirmDelete!)} className="flex-1 rounded-xl font-bold bg-red-500 hover:bg-red-600 text-white">
                  Eliminar
                </Button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </MainLayout>
  );
}
