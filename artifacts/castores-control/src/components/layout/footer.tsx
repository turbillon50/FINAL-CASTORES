import { Link, useLocation } from "wouter";

export function LegalFooter() {
  const [location] = useLocation();
  // Hide on landing/login (root) — it has its own footer treatment
  if (location === "/") return null;

  return (
    <footer className="mt-12 pt-6 border-t border-border/60 text-xs text-muted-foreground">
      <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-center">
        <Link href="/cuenta"><span className="hover:text-foreground transition cursor-pointer">Mi cuenta</span></Link>
        <span aria-hidden>·</span>
        <Link href="/faq"><span className="hover:text-foreground transition cursor-pointer">Ayuda</span></Link>
        <span aria-hidden>·</span>
        <Link href="/legal/terminos"><span className="hover:text-foreground transition cursor-pointer">Términos</span></Link>
        <span aria-hidden>·</span>
        <Link href="/legal/privacidad"><span className="hover:text-foreground transition cursor-pointer">Privacidad</span></Link>
        <span aria-hidden>·</span>
        <a href="https://wa.me/529984292748" target="_blank" rel="noopener" className="hover:text-foreground transition">Soporte</a>
      </div>
      <div className="text-center mt-3 text-[10px] tracking-wider uppercase opacity-60">
        © {new Date().getFullYear()} CASTORES Estructuras y Construcciones
      </div>
    </footer>
  );
}
