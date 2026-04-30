import { MainLayout } from "@/components/layout/main-layout";
import { useGetLog, useSubmitLog, useSignLog } from "@workspace/api-client-react";
import { useParams, Link } from "wouter";
import { Icons } from "@/lib/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { useToast } from "@/hooks/use-toast";
import { SignaturePad } from "@/components/ui/signature-pad";
import { useState } from "react";

export default function BitacoraDetail() {
  const { id } = useParams();
  const logId = Number(id);
  const { toast } = useToast();
  const [clientSig, setClientSig] = useState("");

  const { data: log, isLoading, refetch } = useGetLog(logId, {
    query: { queryKey: ["get-log", logId], enabled: !!logId }
  });

  const submitLog = useSubmitLog();
  const signLog = useSignLog();

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

          <div className="flex items-center gap-3 shrink-0">
            <Badge className={`text-sm px-3 py-1 font-bold uppercase tracking-wider border-none ${log.isSubmitted ? 'bg-[#2ECC71] text-white' : 'bg-[#F39C12] text-white'}`}>
              {log.isSubmitted ? 'Enviado' : 'Borrador'}
            </Badge>
            <Button variant="outline" className="gap-2 print:hidden" onClick={() => window.print()}>
              <Icons.Download className="w-4 h-4" /> PDF
            </Button>
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
    </MainLayout>
  );
}
