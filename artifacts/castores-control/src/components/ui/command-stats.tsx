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
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: i * 0.07, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
          className="relative overflow-hidden rounded-2xl p-5 flex flex-col gap-3"
          style={{
            background: "#fff",
            border: "1px solid rgba(0,0,0,0.07)",
            boxShadow: "0 2px 12px rgba(0,0,0,0.05)",
          }}
        >
          {/* Subtle accent corner */}
          <div className="absolute top-0 right-0 w-20 h-20 rounded-bl-full opacity-10"
            style={{ background: s.color, transform: "translate(30%, -30%)" }} />

          <div className="flex items-center justify-between">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center"
              style={{ background: `${s.color}18`, color: s.color }}>
              {s.icon}
            </div>
            {s.trend && (
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-0.5"
                style={{
                  background: s.trend.up ? "rgba(16,185,129,0.10)" : "rgba(239,68,68,0.10)",
                  color: s.trend.up ? "#10B981" : "#EF4444"
                }}>
                {s.trend.up ? "↑" : "↓"} {s.trend.value}%
              </span>
            )}
          </div>

          <div>
            <div className="font-display text-4xl leading-none" style={{ color: s.color }}>
              <AnimatedNumber value={s.value} prefix={s.prefix} suffix={s.suffix} />
            </div>
            <p className="text-xs text-foreground/40 uppercase tracking-wider font-semibold mt-1">{s.label}</p>
            {s.subtext && <p className="text-[10px] text-muted-foreground mt-1">{s.subtext}</p>}
          </div>
        </motion.div>
      ))}
    </div>
  );
}
