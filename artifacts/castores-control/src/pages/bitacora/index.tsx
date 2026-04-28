import { MainLayout } from "@/components/layout/main-layout";
import { useListLogs, useListProjects } from "@workspace/api-client-react";
import { Icons } from "@/lib/icons";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { Badge } from "@/components/ui/badge";
import { PageHero } from "@/components/ui/page-hero";

export default function Bitacora() {
  const { data: logs = [], isLoading } = useListLogs();

  const groupedLogs = logs.reduce((acc, log) => {
    const date = log.logDate.split('T')[0];
    if (!acc[date]) acc[date] = [];
    acc[date].push(log);
    return acc;
  }, {} as Record<string, typeof logs>);

  const sortedDates = Object.keys(groupedLogs).sort((a, b) => new Date(b).getTime() - new Date(a).getTime());

  return (
    <MainLayout>
      <div className="space-y-6 pb-4">
        <PageHero
          title="Bitácora de Obra"
          subtitle="Registro oficial diario de avances, observaciones e incidencias"
          imageUrl="https://images.unsplash.com/photo-1621905251918-48416bd8575a?w=1400&q=80&fit=crop"
          accentColor="#C8952A"
          badge="REGISTRO OFICIAL"
        >
          <Link href="/bitacora/new">
            <button className="mt-1 text-xs font-bold px-4 py-2 rounded-xl flex items-center gap-1.5 transition-all"
              style={{ background: "rgba(200,149,42,0.25)", border: "1px solid rgba(200,149,42,0.5)", color: "#fff" }}>
              + Nueva Entrada
            </button>
          </Link>
        </PageHero>

        {isLoading ? (
          <div className="space-y-6 animate-pulse">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-32 bg-card rounded-xl border border-card-border" />
            ))}
          </div>
        ) : (
          <div className="space-y-12">
            {sortedDates.map((date) => (
              <div key={date} className="relative">
                <div className="sticky top-0 z-10 bg-background/90 backdrop-blur-md py-4 mb-6 border-b border-card-border flex items-center gap-4">
                  <div className="bg-sidebar border border-sidebar-border px-4 py-2 rounded-lg font-mono font-bold text-primary">
                    {format(new Date(date), "dd 'de' MMMM, yyyy", { locale: es })}
                  </div>
                  <div className="h-px bg-card-border flex-1" />
                </div>

                <div className="space-y-6 pl-4 md:pl-12 border-l-2 border-card-border relative before:absolute before:top-0 before:bottom-0 before:left-[-2px] before:w-1 before:bg-gradient-to-b before:from-primary before:to-transparent">
                  {groupedLogs[date].map((log) => (
                    <div key={log.id} className="relative bg-card border border-card-border rounded-xl p-6 shadow-sm hover:border-primary/30 transition-colors group">
                      <div className="absolute top-8 -left-[29px] md:-left-[61px] w-6 h-6 rounded-full bg-background border-4 border-card-border group-hover:border-primary transition-colors" />

                      <div className="flex flex-col md:flex-row justify-between gap-4 mb-4">
                        <div>
                          <div className="flex items-center gap-2 mb-2">
                            <Badge variant={log.isSubmitted ? "default" : "secondary"} className={log.isSubmitted ? "bg-[#2ECC71]" : "bg-[#F39C12]"}>
                              {log.isSubmitted ? "Enviado" : "Borrador"}
                            </Badge>
                            <span className="text-sm font-medium text-primary flex items-center gap-1">
                              <Icons.Projects className="w-4 h-4" />
                              {log.projectName}
                            </span>
                          </div>
                          <h3 className="font-display text-2xl">{log.activity}</h3>
                        </div>

                        <div className="flex items-center gap-2 text-sm text-muted-foreground shrink-0 bg-sidebar px-3 py-1.5 rounded-md border border-sidebar-border h-fit">
                          <Icons.User className="w-4 h-4" />
                          <span>{log.supervisorName}</span>
                        </div>
                      </div>

                      {log.observations && (
                        <p className="text-sm text-card-foreground/80 bg-background p-4 rounded-lg border border-white/5 mb-4">
                          {log.observations}
                        </p>
                      )}

                      {log.photos && log.photos.length > 0 && (
                        <div className="flex gap-2 mt-4 overflow-x-auto pb-2">
                          {log.photos.map((photo, idx) => (
                            <img key={idx} src={photo} alt="Evidencia" className="w-24 h-24 object-cover rounded-md border border-card-border" />
                          ))}
                        </div>
                      )}

                      <div className="mt-6 pt-4 border-t border-card-border flex justify-end">
                        <Link href={`/bitacora/${log.id}`}>
                          <Button variant="ghost" className="text-primary hover:text-primary hover:bg-primary/10">
                            Ver Detalles <Icons.View className="w-4 h-4 ml-2" />
                          </Button>
                        </Link>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}

            {logs.length === 0 && (
              <div className="text-center py-20 bg-sidebar/30 border border-dashed border-card-border rounded-xl">
                <Icons.Logs className="w-12 h-12 mx-auto text-muted-foreground mb-4 opacity-50" />
                <h3 className="text-xl font-display text-foreground mb-2">Sin Registros</h3>
                <p className="text-muted-foreground mb-6">Registra tu primera jornada de trabajo.</p>
                <Link href="/bitacora/new">
                  <Button className="bg-primary text-primary-foreground">Crear Registro</Button>
                </Link>
              </div>
            )}
          </div>
        )}
      </div>
    </MainLayout>
  );
}
