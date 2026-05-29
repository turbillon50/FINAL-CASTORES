import { motion } from "framer-motion";
import { ReactNode } from "react";

interface PageHeroProps {
  title: string;
  subtitle?: string;
  /** Conservado por compatibilidad: se usa solo como textura tenue en B/N. */
  imageUrl?: string;
  accentColor?: string;
  badge?: string;
  children?: ReactNode;
}

// Barras tipo skyline — el mismo lenguaje del logo Castores (estructuras
// verticales que suben en pirámide). Alturas relativas (0–1).
const SKYLINE = [
  0.28, 0.16, 0.34, 0.22, 0.46, 0.3, 0.58, 0.4, 0.72, 0.54, 0.88, 1, 0.86, 0.6,
  0.74, 0.44, 0.62, 0.34, 0.5, 0.24, 0.4, 0.18, 0.3, 0.14,
];

export function PageHero({
  title,
  subtitle,
  accentColor = "#FF3C00",
  badge,
  children,
}: PageHeroProps) {
  return (
    <div
      className="relative w-full rounded-2xl overflow-hidden mb-8"
      style={{
        height: 200,
        background: "linear-gradient(135deg, #0a0a0a 0%, #1f1f1f 55%, #141414 100%)",
        border: "1px solid rgba(255,255,255,0.06)",
      }}
    >
      {/* Resplandor de acento (radial sutil, da profundidad sin fotos ajenas) */}
      <div
        className="absolute -top-1/2 -right-1/4 w-[70%] h-[200%] pointer-events-none"
        style={{ background: `radial-gradient(ellipse at center, ${accentColor}1f 0%, transparent 60%)` }}
      />

      {/* Skyline de barras (motivo del logo) anclado abajo a la derecha */}
      <div className="absolute bottom-0 right-0 h-full flex items-end gap-[3px] pr-6 opacity-[0.13] pointer-events-none">
        {SKYLINE.map((h, i) => (
          <div
            key={i}
            style={{
              width: 6,
              height: `${h * 78}%`,
              background: "#ffffff",
            }}
          />
        ))}
      </div>

      {/* Retícula técnica sutil (blueprint) */}
      <div
        className="absolute inset-0 opacity-[0.06] pointer-events-none"
        style={{
          backgroundImage:
            "repeating-linear-gradient(0deg,transparent,transparent 39px,rgba(255,255,255,0.5) 39px,rgba(255,255,255,0.5) 40px),repeating-linear-gradient(90deg,transparent,transparent 39px,rgba(255,255,255,0.5) 39px,rgba(255,255,255,0.5) 40px)",
        }}
      />

      {/* Degradado de legibilidad para el texto a la izquierda */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(90deg, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.45) 55%, transparent 100%)",
        }}
      />

      {/* Línea de acento inferior */}
      <div
        className="absolute bottom-0 left-0 right-0 h-1"
        style={{ background: `linear-gradient(90deg, ${accentColor}, transparent)` }}
      />

      <div className="relative z-10 h-full flex flex-col justify-end p-6">
        {badge && (
          <motion.div
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            className="inline-flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-[0.25em] px-2.5 py-1 rounded-full mb-3 w-fit"
            style={{ background: `${accentColor}26`, border: `1px solid ${accentColor}66`, color: accentColor }}
          >
            <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: accentColor }} />
            {badge}
          </motion.div>
        )}
        <motion.h1
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 }}
          className="font-display text-4xl md:text-5xl text-white leading-none tracking-wide"
        >
          {title}
        </motion.h1>
        {subtitle && (
          <motion.p
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="text-white/55 text-sm mt-1.5"
          >
            {subtitle}
          </motion.p>
        )}
        {children && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.15 }}
            className="mt-3"
          >
            {children}
          </motion.div>
        )}
      </div>
    </div>
  );
}
