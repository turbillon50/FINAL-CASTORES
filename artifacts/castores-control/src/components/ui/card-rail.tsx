import { ReactNode, useRef, useState, useEffect, Children } from "react";
import { cn } from "@/lib/utils";

interface CardRailProps {
  children: ReactNode;
  /** Ancho de cada tarjeta (clase Tailwind). Ej: "w-[300px] sm:w-[340px]". */
  itemClassName?: string;
  className?: string;
}

// Riel horizontal deslizable estilo Apple TV: scroll con snap, momentum,
// asoma la siguiente tarjeta, oculta la barra de scroll y muestra flechas
// en desktop. En móvil se desliza con el dedo de forma natural.
export function CardRail({ children, itemClassName = "w-[300px] sm:w-[340px]", className }: CardRailProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);

  const update = () => {
    const el = ref.current;
    if (!el) return;
    setCanLeft(el.scrollLeft > 8);
    setCanRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 8);
  };

  useEffect(() => {
    update();
    const el = ref.current;
    if (!el) return;
    el.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      el.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [children]);

  const scrollBy = (dir: 1 | -1) => {
    const el = ref.current;
    if (!el) return;
    el.scrollBy({ left: dir * Math.round(el.clientWidth * 0.8), behavior: "smooth" });
  };

  const items = Children.toArray(children);

  return (
    <div className={cn("relative group/rail", className)}>
      <div
        ref={ref}
        className="flex gap-4 overflow-x-auto scrollbar-none snap-x snap-mandatory -mx-4 px-4 pb-1"
        style={{ scrollPadding: "0 1rem", WebkitOverflowScrolling: "touch" }}
      >
        {items.map((child, i) => (
          <div key={i} className={cn("snap-start shrink-0", itemClassName)}>
            {child}
          </div>
        ))}
      </div>

      {/* Flechas (solo desktop, aparecen al pasar el cursor) */}
      {canLeft && (
        <button
          type="button"
          aria-label="Anterior"
          onClick={() => scrollBy(-1)}
          className="hidden md:flex absolute left-0 top-1/2 -translate-y-1/2 -translate-x-1 w-10 h-10 rounded-full items-center justify-center opacity-0 group-hover/rail:opacity-100 transition-opacity z-20"
          style={{ background: "rgba(10,10,10,0.85)", border: "1px solid rgba(255,255,255,0.15)", backdropFilter: "blur(8px)" }}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" className="w-5 h-5">
            <path d="M15 19l-7-7 7-7" />
          </svg>
        </button>
      )}
      {canRight && (
        <button
          type="button"
          aria-label="Siguiente"
          onClick={() => scrollBy(1)}
          className="hidden md:flex absolute right-0 top-1/2 -translate-y-1/2 translate-x-1 w-10 h-10 rounded-full items-center justify-center opacity-0 group-hover/rail:opacity-100 transition-opacity z-20"
          style={{ background: "rgba(10,10,10,0.85)", border: "1px solid rgba(255,255,255,0.15)", backdropFilter: "blur(8px)" }}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" className="w-5 h-5">
            <path d="M9 5l7 7-7 7" />
          </svg>
        </button>
      )}
    </div>
  );
}
