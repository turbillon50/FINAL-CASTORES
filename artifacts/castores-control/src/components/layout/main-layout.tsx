import { ReactNode } from "react";
import { Sidebar } from "./sidebar";
import { LegalFooter } from "./footer";
import { InstallPrompt } from "@/components/install-prompt";
import { useAuth } from "@/lib/auth";
import { useLocation, Redirect } from "wouter";

interface MainLayoutProps {
  children: ReactNode;
  publicAccess?: boolean;
}

export function MainLayout({ children, publicAccess = false }: MainLayoutProps) {
  const { user } = useAuth();
  const [location] = useLocation();

  if (location === "/") {
    return (
      <main className="min-h-[100dvh] bg-background text-foreground">
        {children}
        <InstallPrompt />
      </main>
    );
  }

  // Public pages (FAQ, legal) render without sidebar when there's no user
  if (!user) {
    if (publicAccess) {
      return (
        <div className="min-h-[100dvh] bg-background text-foreground">
          <header className="border-b border-border bg-card/80 backdrop-blur sticky top-0 z-30">
            <div className="max-w-3xl mx-auto px-4 py-3 flex items-center justify-between">
              <a href={import.meta.env.BASE_URL} className="flex items-center gap-2">
                <img src={`${import.meta.env.BASE_URL}castores-logo.jpeg`} alt="Castores" className="h-8 w-8 rounded-lg object-cover" />
                <span className="font-bebas tracking-wider text-lg">CASTORES CONTROL</span>
              </a>
              <a href={import.meta.env.BASE_URL} className="text-sm text-muted-foreground hover:text-foreground">Iniciar sesión →</a>
            </div>
          </header>
          <main className="p-4 md:p-8">
            {children}
            <LegalFooter />
          </main>
          <InstallPrompt />
        </div>
      );
    }
    return <Redirect to="/" />;
  }

  return (
    <div className="min-h-[100dvh] bg-background text-foreground flex flex-col md:flex-row">
      <Sidebar />
      {/* pb-[120px] on mobile accounts for floating orange button (64px) + 20px gap + safe area */}
      <main className="flex-1 w-full max-w-[100vw] overflow-x-hidden pb-[120px] md:pb-0">
        <div className="p-4 md:p-8 max-w-7xl mx-auto w-full">
          {children}
          <LegalFooter />
        </div>
      </main>
      <InstallPrompt />
    </div>
  );
}
