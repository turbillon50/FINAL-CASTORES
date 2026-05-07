import { MainLayout } from "@/components/layout/main-layout";
import { useGetLog, useSubmitLog, useSignLog, getAuthToken } from "@workspace/api-client-react";
import { useParams, Link, useLocation } from "wouter";
import { Icons } from "@/lib/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { useToast } from "@/hooks/use-toast";
import { SignaturePad } from "@/components/ui/signature-pad";
import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { apiUrl } from "@/lib/api-url";
import { PhotoUploadButtons } from "@/components/ui/photo-upload-buttons";
import { compressImageFile } from "@/lib/compress-image";

export default function BitacoraDetail() {
  const { id } = useParams();
  const logId = Number(id);
  const { toast } = useToast();
  const [clientSig, setClientSig] = useState("");
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const isAdmin = user?.role === "admin";
  const [deleting, setDeleting] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editForm, setEditForm] = useState<any>({});
  const [editSaving, setEditSaving] = useState(false);

  const { data: log, isLoading, refetch } = useGetLog(logId, {
    query: { queryKey: ["get-log", logId], enabled: !!logId }
  });

  const submitLog = useSubmitLog();
  const signLog = useSignLog();

  const openEdit = () => {
    setEditForm({
      activity: log?.activity ?? "",
      observations: log?.observations ?? "",
      workersInvolved: log?.workersInvolved ?? "",
      materialsUsed: log?.materialsUsed ?? "",
      logDate: log?.logDate ?? "",
      photos: Array.isArray(log?.photos) ? [...log.photos] : [],
      supervisorSignature: log?.supervisorSignature ?? "",
      clientSignature: log?.clientSignature ?? "",
    });
    setEditOpen(true);
  };

  // Compresión client-side para no reventar el body de Vercel.
  const fileToDataUrl = (file: File): Promise<string> => compressImageFile(file);

  const MAX_PHOTOS_BITACORA = 10;
  const [compressingMsg, setCompressingMsg] = useState<string | null>(null);

  const onAddPhotos = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const current = Array.isArray(editForm.photos) ? editForm.photos.length : 0;
    const room = Math.max(0, MAX_PHOTOS_BITACORA - current);
    const arr = Array.from(files);
    if (arr.length > room && room > 0) {
      toast({ title: "Demasiadas fotos", description: `Solo entran ${room} más (límite ${MAX_PHOTOS_BITACORA}).` });
    }
    const accepted = arr.slice(0, room);
    if (accepted.length === 0) {
      toast({ title: "Tope alcanzado", description: `Esta bitácora ya tiene ${MAX_PHOTOS_BITACORA} fotos. Quita alguna para agregar otras.`, variant: "destructive" });
      return;
    }
    const newPhotos: string[] = [];
    for (let i = 0; i < accepted.length; i++) {
      setCompressingMsg(`Comprimiendo ${i + 1} de ${accepted.length}...`);
      newPhotos.push(await fileToDataUrl(accepted[i]));
    }
    setCompressingMsg(null);
    setEditForm((f: any) => ({ ...f, photos: [...(f.photos ?? []), ...newPhotos] }));
  };

  const removePhoto = (idx: number) =>
    setEditForm((f: any) => ({ ...f, photos: (f.photos ?? []).filter((_: any, i: number) => i !== idx) }));

  const submitEdit = async () => {
    if (!log) return;
    const f = editForm;
    // Validación mínima — la bitácora pierde sentido sin actividad y sin
    // fecha. Si el admin las vacía a propósito, mostramos por qué se bloqueó
    // en vez de mandar un PATCH que el servidor aceptaría con NULL.
    const activityTrim = String(f.activity ?? "").trim();
    if (activityTrim.length < 5) {
      toast({
        variant: "destructive",
        title: "Actividad requerida",
        description: "Describe la actividad realizada (mínimo 5 caracteres).",
      });
      return;
    }
    if (!f.logDate) {
      toast({
        variant: "destructive",
        title: "Fecha requerida",
        description: "La bitácora necesita una fecha válida.",
      });
      return;
    }
    setEditSaving(true);
    try {
      const payload: Record<string, unknown> = {};
      if ((f.activity ?? "") !== (log.activity ?? "")) payload.activity = f.activity;
      if ((f.observations ?? "") !== (log.observations ?? "")) payload.observations = f.observations || null;
      if ((f.workersInvolved ?? "") !== (log.workersInvolved ?? "")) payload.workersInvolved = f.workersInvolved || null;
      if ((f.materialsUsed ?? "") !== (log.materialsUsed ?? "")) payload.materialsUsed = f.materialsUsed || null;
      if ((f.logDate ?? "") !== (log.logDate ?? "")) payload.logDate = f.logDate || null;
      if ((f.supervisorSignature ?? "") !== (log.supervisorSignature ?? "")) payload.supervisorSignature = f.supervisorSignature || null;
      if ((f.clientSignature ?? "") !== (log.clientSignature ?? "")) payload.clientSignature = f.clientSignature || null;

      const photosBefore = Array.isArray(log.photos) ? log.photos : [];
      const photosAfter = Array.isArray(f.photos) ? f.photos : [];
      const photosChanged =
        photosBefore.length !== photosAfter.length ||
        photosBefore.some((p, i) => p !== photosAfter[i]);
      if (photosChanged) payload.photos = photosAfter;

      const token = await getAuthToken().catch(() => null);
      const res = await fetch(apiUrl(`/api/logs/${logId}`), {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        credentials: "include",
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.error || "No se pudo guardar");
      }
      toast({ title: "Bitácora actualizada", description: "Los cambios fueron guardados." });
      setEditOpen(false);
      refetch();
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setEditSaving(false);
    }
  };

  const handleAdminDelete = async () => {
    if (!confirm("¿Eliminar esta bitácora? Esta acción no se puede deshacer y queda registrada en la auditoría.")) return;
    setDeleting(true);
    try {
      const token = await getAuthToken().catch(() => null);
      const res = await fetch(apiUrl(`/api/logs/${logId}`), {
        method: "DELETE",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        credentials: "include",
      });
      if (!res.ok) throw new Error(await res.text());
      toast({ title: "Bitácora eliminada", description: "El registro fue eliminado." });
      setLocation("/bitacora");
    } catch (e: any) {
      toast({ title: "Error", description: e.message || "No se pudo eliminar", variant: "destructive" });
      setDeleting(false);
    }
  };

  if (isLoading) return <MainLayout><div className="p-8 text-muted-foreground">Cargando...</div></MainLayout>;
  if (!log) return <MainLayout><div className="p-8 text-muted-foreground">Registro no encontrado</div></MainLayout>;

  const handleSubmit = () => {
    submitLog.mutate({ id: logId }, {
      onSuccess: () => {
        toast({ title: "Registro Enviado", description: "El registro fue enviado correctamente." });
        refetch();
      }
    });
  };

  const handleClientSign = () => {
    if (!clientSig) return;
    signLog.mutate({ id: logId, data: { signatureType: 'client', signatureData: clientSig } }, {
      onSuccess: () => {
        toast({ title: "Firma Guardada", description: "La firma del cliente fue registrada." });
        refetch();
      }
    });
  };

  return (
    <MainLayout>
      <div className="max-w-5xl mx-auto space-y-8 pb-12">
        <header className="flex flex-col md:flex-row md:items-start justify-between gap-4 border-b border-card-border pb-6">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <Link href={`/projects/${log.projectId}`} className="text-primary hover:underline text-sm font-bold flex items-center gap-1">
                <Icons.Projects className="w-4 h-4" /> {log.projectName}
              </Link>
              <span className="text-muted-foreground text-sm">•</span>
              <span className="text-muted-foreground text-sm font-mono">{format(new Date(log.logDate), "PPP", { locale: es })}</span>
            </div>
            <h1 className="font-display text-4xl md:text-5xl tracking-wide">{log.activity}</h1>
          </div>

          <div className="flex items-center gap-3 shrink-0 flex-wrap">
            <Badge className={`text-sm px-3 py-1 font-bold uppercase tracking-wider border-none ${log.isSubmitted ? 'bg-[#2ECC71] text-white' : 'bg-[#F39C12] text-white'}`}>
              {log.isSubmitted ? 'Enviado' : 'Borrador'}
            </Badge>
            <Button variant="outline" className="gap-2 print:hidden" onClick={() => window.print()}>
              <Icons.Download className="w-4 h-4" /> PDF
            </Button>
            {isAdmin && (
              <>
                <Button
                  variant="outline"
                  className="gap-2 print:hidden"
                  onClick={openEdit}
                  title="Editar todos los campos (admin)"
                >
                  <Icons.Edit className="w-4 h-4" /> Editar
                </Button>
                <Button
                  variant="outline"
                  className="gap-2 print:hidden border-red-300 text-red-700 hover:bg-red-50"
                  onClick={handleAdminDelete}
                  disabled={deleting}
                  title="Solo el administrador puede eliminar"
                >
                  <Icons.Delete className="w-4 h-4" /> {deleting ? "Eliminando..." : "Eliminar"}
                </Button>
              </>
            )}
          </div>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 space-y-8">
            <div className="bg-card border border-card-border rounded-2xl p-6 md:p-8 shadow-sm">
              <h3 className="font-display text-2xl mb-4 text-primary">Observaciones</h3>
              <p className="text-foreground leading-relaxed whitespace-pre-wrap bg-background/50 p-4 rounded-xl border border-white/5">
                {log.observations || "Sin observaciones adicionales."}
              </p>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-8">
                <div>
                  <h4 className="text-xs uppercase tracking-wider text-muted-foreground mb-2">Trabajadores Involucrados</h4>
                  <p className="text-sm bg-sidebar p-3 rounded-md border border-sidebar-border">
                    {log.workersInvolved || "No especificado."}
                  </p>
                </div>
                <div>
                  <h4 className="text-xs uppercase tracking-wider text-muted-foreground mb-2">Materiales Utilizados</h4>
                  <p className="text-sm bg-sidebar p-3 rounded-md border border-sidebar-border">
                    {log.materialsUsed || "No especificado."}
                  </p>
                </div>
              </div>
            </div>

            {log.photos && log.photos.length > 0 && (
              <div className="bg-card border border-card-border rounded-2xl p-6 shadow-sm">
                <h3 className="font-display text-2xl mb-4">Evidencia Fotográfica</h3>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  {log.photos.map((photo, i) => (
                    <div key={i} className="aspect-square rounded-xl overflow-hidden border border-card-border">
                      <img src={photo} alt="Evidencia" className="w-full h-full object-cover hover:scale-110 transition-transform duration-500" />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="space-y-8">
            <div className="bg-sidebar border border-sidebar-border rounded-2xl p-6">
              <h3 className="font-display text-xl mb-4 border-b border-sidebar-border pb-2">Detalles del Registro</h3>
              <div className="space-y-4">
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wider">Creado Por</p>
                  <p className="font-medium flex items-center gap-2 mt-1">
                    <Icons.User className="w-4 h-4 text-primary" /> {log.supervisorName}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wider">Fecha de Registro</p>
                  <p className="font-medium text-sm mt-1 font-mono">{format(new Date(log.createdAt), "PPpp", { locale: es })}</p>
                </div>
                {log.submittedAt && (
                  <div>
                    <p className="text-xs text-muted-foreground uppercase tracking-wider">Enviado el</p>
                    <p className="font-medium text-sm mt-1 font-mono text-[#2ECC71]">{format(new Date(log.submittedAt), "PPpp", { locale: es })}</p>
                  </div>
                )}
              </div>
            </div>

            <div className="bg-card border border-card-border rounded-2xl p-6">
              <h3 className="font-display text-xl mb-4">Firmas</h3>

              <div className="space-y-6">
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wider mb-2">Supervisor</p>
                  {log.supervisorSignature ? (
                    <div className="bg-white rounded-lg p-2 h-24 border border-card-border flex items-center justify-center">
                      <img src={log.supervisorSignature} alt="Firma Supervisor" className="max-h-full max-w-full object-contain invert" />
                    </div>
                  ) : (
                    <div className="bg-sidebar rounded-lg p-4 h-24 border border-dashed border-card-border flex items-center justify-center text-muted-foreground text-sm italic">
                      Firma pendiente
                    </div>
                  )}
                </div>

                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wider mb-2">Cliente (Opcional)</p>
                  {log.clientSignature ? (
                    <div className="bg-white rounded-lg p-2 h-24 border border-card-border flex items-center justify-center">
                      <img src={log.clientSignature} alt="Firma Cliente" className="max-h-full max-w-full object-contain invert" />
                    </div>
                  ) : (
                    log.isSubmitted ? (
                      <div className="space-y-3">
                        <SignaturePad onSave={setClientSig} onClear={() => setClientSig("")} />
                        {clientSig && (
                          <Button onClick={handleClientSign} className="w-full text-xs">Guardar Firma del Cliente</Button>
                        )}
                      </div>
                    ) : (
                      <div className="bg-sidebar rounded-lg p-4 h-24 border border-dashed border-card-border flex items-center justify-center text-muted-foreground text-sm italic">
                        El registro debe enviarse primero
                      </div>
                    )
                  )}
                </div>
              </div>
            </div>

            {!log.isSubmitted && (
              <Button
                onClick={handleSubmit}
                className="w-full h-12 bg-primary text-primary-foreground font-bold tracking-wider hover:bg-primary/90 text-lg shadow-[0_0_15px_rgba(212,168,75,0.3)]"
                disabled={submitLog.isPending}
              >
                {submitLog.isPending ? "Enviando..." : "Enviar Registro Final"}
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Modal Editar Bitácora (admin) */}
      {editOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.65)", backdropFilter: "blur(4px)" }} onClick={() => !editSaving && setEditOpen(false)}>
          <div className="bg-background border border-border rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="p-6 border-b border-border sticky top-0 bg-background/95 backdrop-blur-sm z-10">
              <h3 className="font-display text-2xl">Editar bitácora</h3>
              <p className="text-sm text-muted-foreground mt-1">
                Como admin puedes cambiar cualquier campo, agregar/quitar fotos y ajustar firmas. {log.isSubmitted && "El registro ya fue enviado; los cambios quedan en auditoría."}
              </p>
            </div>

            <div className="p-6 space-y-5">
              <Field label="Fecha del registro">
                <input type="date" className="bita-input" value={(editForm.logDate ?? "").slice(0, 10)} onChange={e => setEditForm({ ...editForm, logDate: e.target.value })} />
              </Field>

              <Field label="Actividad">
                <input className="bita-input" value={editForm.activity ?? ""} onChange={e => setEditForm({ ...editForm, activity: e.target.value })} />
              </Field>

              <Field label="Observaciones">
                <textarea className="bita-input min-h-[90px]" value={editForm.observations ?? ""} onChange={e => setEditForm({ ...editForm, observations: e.target.value })} />
              </Field>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Field label="Trabajadores involucrados">
                  <textarea className="bita-input min-h-[60px]" value={editForm.workersInvolved ?? ""} onChange={e => setEditForm({ ...editForm, workersInvolved: e.target.value })} />
                </Field>
                <Field label="Materiales usados">
                  <textarea className="bita-input min-h-[60px]" value={editForm.materialsUsed ?? ""} onChange={e => setEditForm({ ...editForm, materialsUsed: e.target.value })} />
                </Field>
              </div>

              <Field label="Evidencia fotográfica">
                <div className="space-y-3">
                  {Array.isArray(editForm.photos) && editForm.photos.length > 0 && (
                    <div className="grid grid-cols-3 md:grid-cols-4 gap-2">
                      {editForm.photos.map((p: string, i: number) => (
                        <div key={i} className="relative group aspect-square rounded-lg overflow-hidden border border-card-border">
                          <img src={p} alt={`Foto ${i + 1}`} className="w-full h-full object-cover" />
                          <button
                            type="button"
                            onClick={() => removePhoto(i)}
                            className="absolute top-1 right-1 w-6 h-6 rounded-full bg-red-600 text-white flex items-center justify-center text-xs font-bold opacity-0 group-hover:opacity-100 transition-opacity"
                            title="Quitar foto"
                          >
                            ✕
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  <PhotoUploadButtons
                    currentCount={Array.isArray(editForm.photos) ? editForm.photos.length : 0}
                    maxCount={MAX_PHOTOS_BITACORA}
                    currentSizeKB={(Array.isArray(editForm.photos) ? editForm.photos : []).reduce((acc: number, p: string) => acc + Math.round((p.length * 3) / 4 / 1024), 0)}
                    busyLabel={compressingMsg ?? undefined}
                    onLimitExceeded={(_attempted, allowed) => {
                      toast({ title: "Demasiadas fotos", description: allowed === 0 ? `Tope ${MAX_PHOTOS_BITACORA} alcanzado.` : `Solo entran ${allowed} más.` });
                    }}
                    onFilesSelected={(files) => {
                      const dt = new DataTransfer();
                      files.forEach((f) => dt.items.add(f));
                      return onAddPhotos(dt.files);
                    }}
                    helperText="Toma fotos en el momento o súbelas desde tu galería"
                  />
                </div>
              </Field>

              <Field label="Firma del supervisor">
                <div className="space-y-2">
                  {editForm.supervisorSignature ? (
                    <div className="flex items-center gap-3 p-3 rounded-lg bg-sidebar border border-card-border">
                      <img src={editForm.supervisorSignature} alt="Firma supervisor" className="h-12 invert" />
                      <button type="button" onClick={() => setEditForm({ ...editForm, supervisorSignature: "" })} className="text-xs text-red-600 hover:underline">
                        Borrar firma
                      </button>
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground italic">Sin firma. Quien tenga rol supervisor o admin puede firmar después desde esta misma pantalla.</p>
                  )}
                </div>
              </Field>

              <Field label="Firma del cliente">
                <div className="space-y-2">
                  {editForm.clientSignature ? (
                    <div className="flex items-center gap-3 p-3 rounded-lg bg-sidebar border border-card-border">
                      <img src={editForm.clientSignature} alt="Firma cliente" className="h-12 invert" />
                      <button type="button" onClick={() => setEditForm({ ...editForm, clientSignature: "" })} className="text-xs text-red-600 hover:underline">
                        Borrar firma
                      </button>
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground italic">Sin firma del cliente.</p>
                  )}
                </div>
              </Field>
            </div>

            <div className="p-6 border-t border-border flex justify-end gap-2 sticky bottom-0 bg-background/95 backdrop-blur-sm">
              <Button variant="outline" onClick={() => setEditOpen(false)} disabled={editSaving}>Cancelar</Button>
              <Button onClick={submitEdit} disabled={editSaving} className="bg-primary text-primary-foreground hover:bg-primary/90">
                {editSaving ? "Guardando..." : "Guardar cambios"}
              </Button>
            </div>
          </div>
          <style>{`.bita-input { width: 100%; padding: 0.6rem 0.85rem; border-radius: 0.6rem; border: 1px solid hsl(var(--border)); background: hsl(var(--background)); font-size: 0.875rem; outline: none; transition: border-color 0.15s; } .bita-input:focus { border-color: hsl(var(--primary)); box-shadow: 0 0 0 3px hsl(var(--primary) / 0.1); }`}</style>
        </div>
      )}

      {/*
        Barra de acciones flotante para admin. Anclada al fondo de la
        ventana, siempre visible aunque el usuario haga scroll por la
        bitácora. Resuelve el caso real: el admin estaba abajo de la
        página viendo las fotos y NO veía dónde editar/eliminar porque
        los botones estaban en el header. Aparece SOLO para admin y SOLO
        cuando el modal de edición está cerrado.
      */}
      {isAdmin && !editOpen && (
        <div className="fixed bottom-0 inset-x-0 z-30 border-t border-border bg-background/95 backdrop-blur-md print:hidden">
          <div className="max-w-5xl mx-auto px-4 py-3 flex gap-2">
            <Button
              onClick={openEdit}
              className="flex-1 gap-2 bg-primary text-primary-foreground hover:bg-primary/90 font-semibold"
            >
              <Icons.Edit className="w-4 h-4" /> Editar bitácora
            </Button>
            <Button
              variant="outline"
              onClick={handleAdminDelete}
              disabled={deleting}
              className="flex-1 gap-2 border-red-300 text-red-700 hover:bg-red-50 font-semibold"
            >
              <Icons.Delete className="w-4 h-4" /> {deleting ? "Eliminando..." : "Eliminar"}
            </Button>
          </div>
          {/* Espacio extra para que el FAB de + nueva entrada no choque */}
          <div className="h-[env(safe-area-inset-bottom)]" />
        </div>
      )}
      {/* Padding extra al final del contenido para que la barra flotante no tape la última fila */}
      {isAdmin && <div className="h-24" aria-hidden="true" />}
    </MainLayout>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">{label}</span>
      {children}
    </label>
  );
}
