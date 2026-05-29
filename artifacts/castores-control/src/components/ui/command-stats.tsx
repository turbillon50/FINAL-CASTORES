import { motion } from "framer-motion";
import { useEffect, useState } from "react";

function AnimatedNumber({ value, prefix = "", suffix = "" }: { value: number; prefix?: string; suffix?: string }) {
  const [display, setDisplay] = useState(0);
  useEffect(() => {
    if (value === 0) { setDisplay(0); return; }
    let start = 0;
    const duration = 1200;
    let startTime: number | null = null;
    const step = (ts: number) => {
      if (!startTime) startTime = ts;
      const p = Math.min((ts - startTime) / duration, 1);
      const ease = p === 1 ? 1 : 1 - Math.pow(2, -10 * p);
      setDisplay(Math.floor(ease * value));
      if (p < 1) requestAnimationFrame(step);
      else setDisplay(value);
    };
    requestAnimationFrame(step);
  }, [value]);
  return <>{prefix}{display}{suffix}</>;
}

interface CommandStatsProps {
  stats: {
    label: string;
    value: number;
    prefix?: string;
    suffix?: string;
    icon: React.ReactNode;
    color: string;
    trend?: { value: number; up: boolean };
    subtext?: string;
  }[];
}

export function CommandStats({ stats }: CommandStatsProps) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
      {stats.map((s, i) => (
        <motion.div
          key={s.label}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: i * 0.06, duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
          whileHover={{ y: -2 }}
          className="relative rounded-xl p-5 flex flex-col gap-4 bg-card"
          style={{ border: "1px solid hsl(var(--border))" }}
        >
          <div className="flex items-center justify-between">
            {/* Ícono monocromo (estilo Vercel/v0: sin relleno de color) */}
            <div className="w-9 h-9 rounded-lg flex items-center justify-center text-foreground/55"
              style={{ background: "hsl(var(--muted))", border: "1px solid hsl(var(--border))" }}>
              {s.icon}
            </div>
            {s.trend && (
              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md flex items-center gap-0.5 text-muted-foreground">
                {s.trend.up ? "↑" : "↓"} {s.trend.value}%
              </span>
            )}
          </div>

          <div>
            <div className="font-display text-4xl leading-none text-foreground tabular-nums">
              <AnimatedNumber value={s.value} prefix={s.prefix} suffix={s.suffix} />
            </div>
            <p className="text-xs text-muted-foreground uppercase tracking-wider font-semibold mt-2">{s.label}</p>
            {s.subtext && <p className="text-[11px] text-muted-foreground/70 mt-1 tabular-nums">{s.subtext}</p>}
          </div>
        </motion.div>
      ))}
    </div>
  );
}
