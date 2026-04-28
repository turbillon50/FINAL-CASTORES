import { Link } from "wouter";
import { Project } from "@workspace/api-client-react";
import { ProgressRing } from "./progress-ring";
import { Icons } from "@/lib/icons";
import { Badge } from "./badge";
import { motion } from "framer-motion";

interface CinematicProjectCardProps {
  project: Project;
  index: number;
}

const STATUS_LABELS: Record<string, string> = {
  active: "Activa",
  completed: "Completada",
  paused: "Pausada",
  cancelled: "Cancelada",
};

export function CinematicProjectCard({ project, index }: CinematicProjectCardProps) {
  const formatCurrency = (amount: number | null | undefined) => {
    if (amount == null) return "$0";
    return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 }).format(amount);
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "active": return "bg-primary text-primary-foreground";
      case "completed": return "bg-[#2ECC71] text-white";
      case "paused": return "bg-[#F39C12] text-white";
      case "cancelled": return "bg-[#E74C3C] text-white";
      default: return "bg-muted text-muted-foreground";
    }
  };

  const budgetUsed = project.budget && project.spentAmount ? (project.spentAmount / project.budget) * 100 : 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: index * 0.1 }}
      className="group relative overflow-hidden rounded-xl bg-card aspect-[16/9] sm:aspect-[4/3] lg:aspect-[16/9] shadow-lg ring-1 ring-white/5 cursor-pointer isolate"
      data-testid={`project-card-${project.id}`}
    >
      <img
        src={project.coverImageUrl || `/project-${(project.id % 5) + 1}.png`}
        alt={project.name}
        className="absolute inset-0 w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
      />

      <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/40 to-transparent transition-opacity duration-500 group-hover:opacity-90" />

      <div className="absolute top-4 right-4 z-10">
        <Badge className={`${getStatusColor(project.status)} uppercase font-bold tracking-wider text-xs border-none`}>
          {STATUS_LABELS[project.status] ?? project.status}
        </Badge>
      </div>

      <div className="absolute inset-x-0 bottom-0 p-6 flex flex-col justify-end z-10 transition-transform duration-500 transform translate-y-0 group-hover:-translate-y-4">
        <div className="flex justify-between items-end gap-4">
          <div className="flex-1">
            <h3 className="font-display text-3xl sm:text-4xl text-white leading-none mb-2 drop-shadow-md line-clamp-2">
              {project.name}
            </h3>
            {project.location && (
              <div className="flex items-center text-white/80 text-sm gap-1">
                <Icons.Location className="w-4 h-4 text-primary" />
                <span className="truncate">{project.location}</span>
              </div>
            )}
          </div>
          <div className="shrink-0 mb-1">
            <ProgressRing progress={project.progressPercent} size={56} strokeWidth={4} />
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-4 h-0 opacity-0 overflow-hidden transition-all duration-500 group-hover:h-auto group-hover:opacity-100 group-hover:mt-6">
          <div>
            <p className="text-white/60 text-xs uppercase tracking-wider mb-1">Presupuesto</p>
            <p className="text-white font-mono text-sm">{formatCurrency(project.budget)}</p>
            <div className="w-full bg-white/20 h-1.5 rounded-full mt-2 overflow-hidden">
              <div
                className={`h-full rounded-full ${budgetUsed > 90 ? 'bg-destructive' : 'bg-primary'}`}
                style={{ width: `${Math.min(budgetUsed, 100)}%` }}
              />
            </div>
          </div>
          <div>
            <p className="text-white/60 text-xs uppercase tracking-wider mb-1">Personal Clave</p>
            <div className="flex -space-x-2">
              <div className="w-8 h-8 rounded-full bg-sidebar border-2 border-primary/50 flex items-center justify-center text-xs font-bold text-primary z-20" title={project.supervisorName || 'Supervisor'}>
                {project.supervisorName?.charAt(0) || 'S'}
              </div>
              <div className="w-8 h-8 rounded-full bg-sidebar border-2 border-white/20 flex items-center justify-center text-xs font-bold text-white z-10" title={project.clientName || 'Cliente'}>
                {project.clientName?.charAt(0) || 'C'}
              </div>
            </div>
          </div>
        </div>

        <div className="flex gap-2 mt-0 h-0 opacity-0 overflow-hidden transition-all duration-500 group-hover:h-auto group-hover:opacity-100 group-hover:mt-4">
          <Link href={`/projects/${project.id}`} className="flex-1 bg-primary text-primary-foreground py-2 rounded-md font-bold text-sm text-center hover:bg-primary/90 transition-colors">
            Ver Obra
          </Link>
          <Link href={`/bitacora?projectId=${project.id}`} className="flex-1 bg-white/10 backdrop-blur-sm text-white py-2 rounded-md font-bold text-sm text-center hover:bg-white/20 transition-colors">
            Bitácora
          </Link>
        </div>
      </div>
    </motion.div>
  );
}
