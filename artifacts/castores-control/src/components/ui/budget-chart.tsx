import { motion } from "framer-motion";

interface BudgetChartProps {
  projects: Array<{
    name: string;
    budget: number | null | undefined;
    spentAmount: number | null | undefined;
    progressPercent: number | null | undefined;
    status: string;
  }>;
}

export function BudgetChart({ projects }: BudgetChartProps) {
  const active = projects.filter(p => p.status === "active" && p.budget);

  const fmt = (n: number) =>
    new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0, notation: "compact" }).format(n);

  const maxBudget = Math.max(...active.map(p => p.budget ?? 0), 1);

  const statusColors: Record<string, string> = {
    active: "#C8952A",
    completed: "#10B981",
    paused: "#F59E0B",
    cancelled: "#EF4444",
  };

  return (
    <div className="bg-white rounded-2xl border border-black/[0.07] p-5 shadow-sm">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h3 className="font-display text-xl text-foreground tracking-wide">Presupuesto vs. Gasto</h3>
          <p className="text-xs text-muted-foreground mt-0.5">Control financiero por obra activa</p>
        </div>
        <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-foreground/10" />Presupuesto</span>
          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-primary" />Gastado</span>
        </div>
      </div>

      {active.length === 0 ? (
        <p className="text-muted-foreground text-sm text-center py-8">Sin datos presupuestales disponibles</p>
      ) : (
        <div className="space-y-4">
          {active.map((p, i) => {
            const spent = p.spentAmount ?? 0;
            const budget = p.budget ?? 1;
            const pct = Math.min((spent / budget) * 100, 100);
            const over = pct > 90;

            return (
              <motion.div
                key={p.name}
                initial={{ opacity: 0, x: -16 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.06 }}
                className="space-y-1.5"
              >
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-foreground/80 truncate max-w-[160px]">{p.name}</span>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-muted-foreground font-mono">{fmt(spent)}</span>
                    <span className="text-muted-foreground">/</span>
                    <span className="font-mono text-foreground/60">{fmt(budget)}</span>
                    <span className={`font-bold text-[10px] px-1.5 py-0.5 rounded-full ${over ? "bg-red-100 text-red-600" : "bg-amber-50 text-amber-700"}`}>
                      {Math.round(pct)}%
                    </span>
                  </div>
                </div>
                {/* Budget bar */}
                <div className="relative h-2 bg-foreground/6 rounded-full overflow-hidden">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${pct}%` }}
                    transition={{ delay: 0.2 + i * 0.06, duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
                    className="absolute top-0 left-0 h-full rounded-full"
                    style={{ background: over ? "#EF4444" : "#C8952A" }}
                  />
                </div>
                {/* Progress bar */}
                <div className="relative h-1 bg-foreground/4 rounded-full overflow-hidden">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${p.progressPercent ?? 0}%` }}
                    transition={{ delay: 0.3 + i * 0.06, duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
                    className="absolute top-0 left-0 h-full rounded-full"
                    style={{ background: "#10B981" }}
                  />
                </div>
                <p className="text-[9px] text-muted-foreground">Avance obra: {p.progressPercent ?? 0}%</p>
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
  );
}
