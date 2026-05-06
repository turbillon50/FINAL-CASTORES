import { MainLayout } from "@/components/layout/main-layout";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useCreateLog, useListProjects } from "@workspace/api-client-react";
import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { SignaturePad } from "@/components/ui/signature-pad";
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
} from "@/components/ui/form";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Icons } from "@/lib/icons";
import { useState } from "react";
import { PhotoUploadButtons } from "@/components/ui/photo-upload-buttons";
import { compressImageFile } from "@/lib/compress-image";
import { PageHero } from "@/components/ui/page-hero";

const logSchema = z.object({
  projectId: z.coerce.number().min(1, "El proyecto es obligatorio"),
  logDate: z.string(),
  activity: z.string().min(5, "El resumen de actividad es obligatorio"),
  observations: z.string().optional(),
  workersInvolved: z.string().optional(),
  materialsUsed: z.string().optional(),
  supervisorSignatureData: z.string().optional(),
  clientSignatureData: z.string().optional(),
});

type LogFormValues = z.infer<typeof logSchema>;

// Antes leíamos el archivo crudo (3-5 MB cada foto del iPhone). Con 6
// fotos por bitácora reventábamos el body de 4.5 MB de Vercel y el POST
// se caía sin guardar. Ahora compress-image.ts las baja a ~250 KB JPEG.
async function fileToDataUrl(file: File): Promise<string> {
  return compressImageFile(file);
}

export default function NewBitacoraEntry() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const createLog = useCreateLog();
  const { data: projects = [] } = useListProjects();
  const [photoFiles, setPhotoFiles] = useState<File[]>([]);
  const [photoPreviews, setPhotoPreviews] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const form = useForm<LogFormValues>({
    resolver: zodResolver(logSchema),
    defaultValues: {
      projectId: undefined,
      logDate: new Date().toISOString().split("T")[0],
      activity: "",
      observations: "",
      workersInvolved: "",
      materialsUsed: "",
      supervisorSignatureData: "",
      clientSignatureData: "",
    },
  });

  const handlePhotoSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    const newFiles = [...photoFiles, ...files].slice(0, 6);
    setPhotoFiles(newFiles);
    const previews = await Promise.all(newFiles.map(fileToDataUrl));
    setPhotoPreviews(previews);
  };

  const removePhoto = (idx: number) => {
    setPhotoFiles(f => f.filter((_, i) => i !== idx));
    setPhotoPreviews(p => p.filter((_, i) => i !== idx));
  };

  const onSubmit = async (values: LogFormValues) => {
    setIsSubmitting(true);
    try {
      const { supervisorSignatureData, clientSignatureData, ...rest } = values;

      const photoDataUrls = photoPreviews;

      // Mandamos las firmas en el mismo POST de creación: la versión vieja
      // hacía 2 llamadas extra a /logs/:id/signatures con role-gate, y si el
      // supervisor recogía la firma del cliente físicamente presente la
      // segunda llamada caía en 403, el catch tragaba el error y la bitácora
      // quedaba creada sin firmas — el usuario veía "no quedan guardadas las
      // firmas". Ahora se persisten atómicamente en el insert.
      const log = await createLog.mutateAsync({
        data: {
          ...rest,
          photos: photoDataUrls,
          ...(supervisorSignatureData ? { supervisorSignature: supervisorSignatureData } : {}),
          ...(clientSignatureData ? { clientSignature: clientSignatureData } : {}),
        },
      });

      toast({ title: "Entrada Guardada", description: "La bitácora fue registrada correctamente." });
      setLocation(`/bitacora/${log.id}`);
    } catch {
      toast({ variant: "destructive", title: "Error", description: "No se pudo crear el registro." });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <MainLayout>
      <div className="max-w-4xl mx-auto space-y-6 pb-4">
        <PageHero
          title="Nueva Entrada de Bitácora"
          subtitle="Registra el avance diario, materiales, observaciones y firmas de autorización"
          imageUrl="https://images.unsplash.com/photo-1621905251918-48416bd8575a?w=1400&q=80&fit=crop"
          accentColor="#C8952A"
          badge="REGISTRO OFICIAL"
        />

        <div className="bg-white rounded-2xl border border-black/[0.07] shadow-sm p-6 md:p-8">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">

              {/* ─ Proyecto y Fecha ─ */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <FormField control={form.control} name="projectId" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs uppercase tracking-wider text-muted-foreground">Proyecto *</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value?.toString()}>
                      <FormControl>
                        <SelectTrigger className="h-12 rounded-xl border-black/10 bg-foreground/[0.02]">
                          <SelectValue placeholder="Seleccionar proyecto" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {projects.map(p => (
                          <SelectItem key={p.id} value={p.id.toString()}>{p.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />

                <FormField control={form.control} name="logDate" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs uppercase tracking-wider text-muted-foreground">Fecha *</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} className="h-12 rounded-xl border-black/10 bg-foreground/[0.02]" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>

              {/* ─ Actividad y Observaciones ─ */}
              <div className="space-y-5 pt-6 border-t border-black/[0.06]">
                <div className="flex items-center gap-2">
                  <div className="w-1 h-5 rounded-full bg-primary" />
                  <h3 className="font-display text-xl text-foreground">Detalle del Trabajo</h3>
                </div>

                <FormField control={form.control} name="activity" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs uppercase tracking-wider text-muted-foreground">Actividad Principal *</FormLabel>
                    <FormControl>
                      <Input placeholder="Ej. Colado de cimentación sector A" {...field}
                        className="h-12 rounded-xl border-black/10 bg-foreground/[0.02] font-medium" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />

                <FormField control={form.control} name="observations" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs uppercase tracking-wider text-muted-foreground">Observaciones e Incidencias</FormLabel>
                    <FormControl>
                      <Textarea placeholder="Condiciones climáticas, retrasos, incidentes de seguridad..."
                        className="min-h-[120px] rounded-xl border-black/10 bg-foreground/[0.02] resize-y" {...field} />
                    </FormControl>
                  </FormItem>
                )} />
              </div>

              {/* ─ Trabajadores y Materiales ─ */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5 pt-6 border-t border-black/[0.06]">
                <FormField control={form.control} name="workersInvolved" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs uppercase tracking-wider text-muted-foreground">Personal Involucrado</FormLabel>
                    <FormControl>
                      <Textarea placeholder="Ej. 5 albañiles, 2 soldadores, contratista AceroCorp"
                        className="rounded-xl border-black/10 bg-foreground/[0.02]" {...field} />
                    </FormControl>
                  </FormItem>
                )} />

                <FormField control={form.control} name="materialsUsed" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs uppercase tracking-wider text-muted-foreground">Materiales Utilizados</FormLabel>
                    <FormControl>
                      <Textarea placeholder="Ej. 50 sacos de cemento, 2 ton de varilla"
                        className="rounded-xl border-black/10 bg-foreground/[0.02]" {...field} />
                    </FormControl>
                  </FormItem>
                )} />
              </div>

              {/* ─ Evidencia Fotográfica ─ */}
              <div className="pt-6 border-t border-black/[0.06]">
                <div className="flex items-center gap-2 mb-4">
                  <div className="w-1 h-5 rounded-full bg-blue-500" />
                  <h3 className="font-display text-xl text-foreground">Evidencia Fotográfica</h3>
                </div>

                {photoPreviews.length > 0 && (
                  <div className="grid grid-cols-3 gap-3 mb-4">
                    {photoPreviews.map((src, idx) => (
                      <div key={idx} className="relative aspect-square rounded-xl overflow-hidden border border-black/[0.08] group">
                        <img src={src} alt={`Foto ${idx + 1}`} className="w-full h-full object-cover" />
                        <button
                          type="button"
                          onClick={() => removePhoto(idx)}
                          className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-black/60 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity text-xs font-bold"
                        >✕</button>
                      </div>
                    ))}
                  </div>
                )}

                <PhotoUploadButtons
                  onFilesSelected={(files) => {
                    const dt = new DataTransfer();
                    files.forEach((f) => dt.items.add(f));
                    const fakeEvent = { target: { files: dt.files } } as unknown as React.ChangeEvent<HTMLInputElement>;
                    handlePhotoSelect(fakeEvent);
                  }}
                  helperText={photoPreviews.length > 0 ? `${photoPreviews.length} de 6 fotos` : "Toma fotos en obra o súbelas desde tu galería · Máx. 6"}
                />
              </div>

              {/* ─ Firmas ─ */}
              <div className="pt-6 border-t border-black/[0.06]">
                <div className="flex items-center gap-2 mb-6">
                  <div className="w-1 h-5 rounded-full bg-amber-500" />
                  <h3 className="font-display text-xl text-foreground">Autorización y Firmas</h3>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <FormField control={form.control} name="supervisorSignatureData" render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs font-bold uppercase tracking-wider text-muted-foreground block mb-2">
                        Firma del Supervisor
                      </FormLabel>
                      <FormControl>
                        <SignaturePad
                          onSave={(data) => field.onChange(data)}
                          onClear={() => field.onChange("")}
                        />
                      </FormControl>
                    </FormItem>
                  )} />

                  <FormField control={form.control} name="clientSignatureData" render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs font-bold uppercase tracking-wider text-muted-foreground block mb-2">
                        Firma del Cliente
                      </FormLabel>
                      <FormControl>
                        <SignaturePad
                          onSave={(data) => field.onChange(data)}
                          onClear={() => field.onChange("")}
                        />
                      </FormControl>
                    </FormItem>
                  )} />
                </div>
              </div>

              {/* ─ Acciones ─ */}
              <div className="flex flex-col sm:flex-row justify-end gap-3 pt-6 border-t border-black/[0.06]">
                <Button type="button" variant="outline" onClick={() => setLocation("/bitacora")}
                  className="rounded-xl border-black/10">
                  Cancelar
                </Button>
                <Button
                  type="submit"
                  disabled={isSubmitting}
                  className="rounded-xl font-bold h-12 px-8"
                  style={{ background: "#C8952A", color: "#fff" }}
                >
                  {isSubmitting ? "Guardando..." : "Guardar Entrada"}
                </Button>
              </div>

            </form>
          </Form>
        </div>
      </div>
    </MainLayout>
  );
}
