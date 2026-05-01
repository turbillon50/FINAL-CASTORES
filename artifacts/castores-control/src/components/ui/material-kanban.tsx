import { Material } from "@workspace/api-client-react";
import { Icons } from "@/lib/icons";
import { Badge } from "./badge";
import { motion } from "framer-motion";

interface MaterialKanbanProps {
  materials: Material[];
  onApprove?: (id: number) => void;
  onReject?: (id: number) => void;
}

export function MaterialKanban({ materials, onApprove, onReject }: MaterialKanbanProps) {
  // The approve/reject affordances appear only when the parent passes
  // callbacks for them. The parent in turn checks materialsApprove via the
  // usePermissions hook. This avoids the old hard-coded role check that was
  // ignoring permission overrides set by an admin in /admin → Permisos.
  const showApprovalActions = typeof onApprove === "function" || typeof onReject === "function";

  const columns = [
    { id: "pending", title: "Solicitud Pendiente", status: "pending", color: "border-[#F39C12]" },
    { id: "approved", title: "Aprobado", status: "approved", color: "border-[#2ECC71]" },
    { id: "used", title: "En Uso", status: "used", color: "border-primary" },
  ];

  const getMaterialsByStatus = (status: string) => materials.filter((m) => m.status === status);

  const formatCurrency = (amount: number | null | undefined) => {
    if (amount == null) return "$0";
    return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(amount);
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
      {columns.map((col) => (
        <div key={col.id} className="flex flex-col bg-sidebar/50 rounded-xl border border-card-border overflow-hidden">
          <div className={`p-4 border-b border-card-border border-t-2 ${col.color} bg-card/80`}>
            <div className="flex items-center justify-between">
              <h3 className="font-display tracking-widest text-lg text-card-foreground">{col.title}</h3>
              <Badge variant="secondary" className="bg-background text-muted-foreground border-card-border">
                {getMaterialsByStatus(col.status).length}
              </Badge>
            </div>
          </div>

          <div className="flex-1 p-4 space-y-4 overflow-y-auto min-h-[500px]">
            {getMaterialsByStatus(col.status).map((material, idx) => (
              <motion.div
                key={material.id}
                layoutId={`material-${material.id}`}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: idx * 0.05 }}
                className="bg-card border border-card-border rounded-lg p-4 cursor-grab hover:border-primary/50 transition-colors shadow-sm group relative"
              >
                <div className="flex justify-between items-start mb-2">
                  <h4 className="font-semibold text-sm text-foreground line-clamp-1" title={material.name}>{material.name}</h4>
                  <span className="text-xs font-mono text-primary font-bold px-2 py-0.5 rounded bg-primary/10 border border-primary/20 shrink-0">
                    {material.quantityRequested} {material.unit}
                  </span>
                </div>

                {material.projectName && (
                  <p className="text-xs text-muted-foreground mb-3 flex items-center gap-1.5">
                    <Icons.Projects className="w-3 h-3" />
                    <span className="truncate">{material.projectName}</span>
                  </p>
                )}

                <div className="flex justify-between items-end mt-4 pt-3 border-t border-card-border/50">
                  <div>
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-0.5">Solicitado Por</p>
                    <p className="text-xs text-foreground truncate max-w-[120px]">{material.requestedByName}</p>
                  </div>
                  {material.totalCost && (
                    <div className="text-right">
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-0.5">Costo Est.</p>
                      <p className="text-xs font-mono text-white/90">{formatCurrency(material.totalCost)}</p>
                    </div>
                  )}
                </div>

                {col.status === "pending" && showApprovalActions && (
                  <div className="absolute inset-0 bg-card/90 backdrop-blur-[2px] rounded-lg opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-3 p-4">
                    <button
                      onClick={() => onApprove?.(material.id)}
                      className="flex-1 bg-[#2ECC71]/20 text-[#2ECC71] hover:bg-[#2ECC71] hover:text-white border border-[#2ECC71]/50 transition-colors py-2 rounded-md font-bold text-sm"
                    >
                      Aprobar
                    </button>
                    <button
                      onClick={() => onReject?.(material.id)}
                      className="flex-1 bg-destructive/20 text-destructive hover:bg-destructive hover:text-white border border-destructive/50 transition-colors py-2 rounded-md font-bold text-sm"
                    >
                      Rechazar
                    </button>
                  </div>
                )}
              </motion.div>
            ))}

            {getMaterialsByStatus(col.status).length === 0 && (
              <div className="h-full flex items-center justify-center opacity-30">
                <p className="text-sm font-medium">Vacío</p>
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
