import { motion } from "framer-motion";
import { ReactNode } from "react";

interface PageHeroProps {
  title: string;
  subtitle?: string;
  imageUrl: string;
  accentColor?: string;
  badge?: string;
  children?: ReactNode;
}

export function PageHero({ title, subtitle, imageUrl, accentColor = "#C8952A", badge, children }: PageHeroProps) {
  return (
    <div className="relative w-full rounded-2xl overflow-hidden mb-8" style={{ height: 200 }}>
      {/* Background image */}
      <img
        src={imageUrl}
        alt={title}
        className="absolute inset-0 w-full h-full object-cover"
        style={{ filter: "brightness(0.45) saturate(1.1)" }}
      />
      {/* Gradient overlay */}
      <div className="absolute inset-0" style={{
        background: `linear-gradient(120deg, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.4) 60%, ${accentColor}22 100%)`
      }} />
      {/* Subtle grid texture */}
      <div className="absolute inset-0 opacity-10" style={{
        backgroundImage: "repeating-linear-gradient(0deg,transparent,transparent 39px,rgba(255,255,255,0.15) 39px,rgba(255,255,255,0.15) 40px),repeating-linear-gradient(90deg,transparent,transparent 39px,rgba(255,255,255,0.15) 39px,rgba(255,255,255,0.15) 40px)"
      }} />
      {/* Accent glow */}
      <div className="absolute bottom-0 left-0 right-0 h-1" style={{ background: `linear-gradient(90deg, ${accentColor}, transparent)` }} />

      <div className="relative z-10 h-full flex flex-col justify-end p-6">
        {badge && (
          <motion.div
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            className="inline-flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-[0.25em] px-2.5 py-1 rounded-full mb-3 w-fit"
            style={{ background: `${accentColor}30`, border: `1px solid ${accentColor}60`, color: accentColor }}
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
            className="text-white/50 text-sm mt-1.5"
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
