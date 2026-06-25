import { useEffect } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/lib/auth";

// Lazy import del dashboard real para no romper admin
import AsistenciaDashboardPage from "./dashboard";

export default function AsistenciaPage() {
  const [, setLocation] = useLocation();
  const { user } = useAuth();

  useEffect(() => {
    if (user?.role === "supervisor") {
      setLocation("/asistencia/registro");
    }
  }, [user, setLocation]);

  // Admin y otros roles con attendanceViewAll ven el dashboard
  if (!user || user.role === "supervisor") return null;
  return <AsistenciaDashboardPage />;
}
