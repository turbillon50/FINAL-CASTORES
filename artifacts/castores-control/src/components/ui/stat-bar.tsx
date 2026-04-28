import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import { DashboardSummary } from "@workspace/api-client-react";

interface StatBarProps {
  summary: DashboardSummary | undefined;
}

function AnimatedNumber({ value }: { value: number }) {
  const [displayValue, setDisplayValue] = useState(0);

  useEffect(() => {
    let start = 0;
    const end = value;
    if (start === end) { setDisplayValue(end); return; }
    const duration = 1500;
    let startTime: number | null = null;

    const step = (timestamp: number) => {
      if (!startTime) startTime = timestamp;
      const progress = Math.min((timestamp - startTime) / duration, 1);
      const easeProgress = progress === 1 ? 1 : 1 - Math.pow(2, -10 * progress);
      setDisplayValue(Math.floor(easeProgress * (end - start) + start));
      if (progress < 1) window.requestAnimationFrame(step);
      else setDisplayValue(end);
    };
    window.requestAnimationFrame(step);
  }, [value]);

  return <>{displayValue}</>;
}

export function StatBar({ summary }: StatBarProps) {
  if (!summary) {
    return (
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 w-full animate-pulse">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-32 bg-card rounded-xl border border-card-border" />
        ))}
      </div>
    );
  }

  const budgetUsedPercent = summary.totalBudget ? (summary.totalSpent / summary.totalBudget) * 100 : 0;

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 w-full">
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="bg-card border border-card-border p-6 rounded-xl flex flex-col justify-between relative overflow-hidden"
      >
        <div className="absolute top-0 right-0 w-32 h-32 bg-primary/10 rounded-bl-full -mr-16 -mt-16" />
        <p className="text-muted-foreground text-sm font-medium uppercase tracking-wider mb-2">Obras Activas</p>
        <h2 className="font-display text-5xl text-primary drop-shadow-sm">
          <AnimatedNumber value={summary.activeProjects} />
        </h2>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="bg-card border border-card-border p-6 rounded-xl flex flex-col justify-between relative overflow-hidden"
      >
        <p className="text-muted-foreground text-sm font-medium uppercase tracking-wider mb-2">Total Trabajadores</p>
        <h2 className="font-display text-5xl text-foreground">
          <AnimatedNumber value={summary.totalWorkers} />
        </h2>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
        className={`bg-card border p-6 rounded-xl flex flex-col justify-between relative overflow-hidden ${
          summary.pendingMaterialRequests > 0 ? "border-primary shadow-[0_0_15px_rgba(212,168,75,0.15)]" : "border-card-border"
        }`}
      >
        <p className={`text-sm font-medium uppercase tracking-wider mb-2 ${summary.pendingMaterialRequests > 0 ? 'text-primary/80' : 'text-muted-foreground'}`}>
          Materiales Pendientes
        </p>
        <h2 className={`font-display text-5xl ${summary.pendingMaterialRequests > 0 ? 'text-primary' : 'text-foreground'}`}>
          <AnimatedNumber value={summary.pendingMaterialRequests} />
        </h2>
        {summary.pendingMaterialRequests > 0 && (
          <div className="absolute top-4 right-4 w-2 h-2 rounded-full bg-primary animate-ping" />
        )}
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4 }}
        className="bg-card border border-card-border p-6 rounded-xl flex flex-col justify-between relative overflow-hidden"
      >
        <p className="text-muted-foreground text-sm font-medium uppercase tracking-wider mb-2">Presupuesto Usado</p>
        <div className="flex items-end gap-2">
          <h2 className="font-display text-5xl text-foreground">
            <AnimatedNumber value={Math.round(budgetUsedPercent)} />
          </h2>
          <span className="font-display text-3xl text-muted-foreground mb-1">%</span>
        </div>
        <div className="w-full h-1.5 bg-background rounded-full mt-4 overflow-hidden">
          <div
            className={`h-full rounded-full ${budgetUsedPercent > 90 ? 'bg-destructive' : 'bg-primary'}`}
            style={{ width: `${Math.min(budgetUsedPercent, 100)}%` }}
          />
        </div>
      </motion.div>
    </div>
  );
}
