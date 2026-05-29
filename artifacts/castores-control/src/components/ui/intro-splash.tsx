import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

// Skyline del logo Castores (alturas relativas) — sube barra por barra.
const SKYLINE = [0.3, 0.18, 0.42, 0.26, 0.54, 0.36, 0.7, 0.5, 0.9, 1, 0.82, 0.58, 0.7, 0.4, 0.52, 0.28];

// Intro de marca: pantalla de entrada deliberada (logo + skyline animado)
// que se muestra una vez por sesión al abrir la app. Reemplaza el parpadeo
// de carga que parecía un error por una entrada intencional.
export function IntroSplash() {
  const [show, setShow] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try {
      return !sessionStorage.getItem("castores-intro-shown");
    } catch {
      return true;
    }
  });

  useEffect(() => {
    if (!show) return;
    try {
      sessionStorage.setItem("castores-intro-shown", "1");
    } catch {
      /* almacenamiento no disponible — no pasa nada */
    }
    const t = setTimeout(() => setShow(false), 1850);
    return () => clearTimeout(t);
  }, [show]);

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          key="castores-intro"
          className="fixed inset-0 z-[200] flex flex-col items-center justify-center"
          style={{ background: "linear-gradient(160deg,#0a0a0a 0%,#1f1f1f 60%,#141414 100%)" }}
          initial={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.6, ease: "easeInOut" } }}
        >
          {/* Resplandor de acento */}
          <div
            className="absolute pointer-events-none"
            style={{
              width: 420,
              height: 420,
              background: "radial-gradient(circle, rgba(255,60,0,0.18) 0%, transparent 60%)",
            }}
          />

          {/* Skyline que sube barra por barra */}
          <div className="flex items-end gap-1.5 h-24 mb-7 relative">
            {SKYLINE.map((h, i) => (
              <motion.div
                key={i}
                initial={{ height: "0%" }}
                animate={{ height: `${h * 100}%` }}
                transition={{ delay: 0.08 + i * 0.035, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
                style={{ width: 7, background: i % 6 === 0 ? "#FF3C00" : "#ffffff", opacity: 0.92 }}
              />
            ))}
          </div>

          {/* Logo en chip blanco */}
          <motion.div
            initial={{ opacity: 0, y: 14, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ delay: 0.55, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
            className="bg-white rounded-xl px-4 py-2.5 relative"
          >
            <img src="/castores-logo.jpeg" alt="CASTORES" className="h-8 w-auto object-contain" />
          </motion.div>

          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.85, duration: 0.5 }}
            className="text-white/40 text-[10px] uppercase tracking-[0.32em] mt-5"
          >
            Sistema de Control Operacional
          </motion.p>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
