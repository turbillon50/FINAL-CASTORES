import { useState } from "react";
import { useLocation } from "wouter";
import { useUser, useAuth as useClerkAuth } from "@clerk/react";
import { useToast } from "@/hooks/use-toast";
import { apiUrl } from "@/lib/api-url";

export default function AdminAccessPage() {
  const [, setLocation] = useLocation();
  const { user, isLoaded, isSignedIn } = useUser();
  const { getToken } = useClerkAuth();
  const { toast } = useToast();
  const [phrase, setPhrase] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!phrase.trim()) return;
    setLoading(true);
    try {
      const token = await getToken();
      if (!token) throw new Error("Sesión no válida. Vuelve a iniciar sesión.");
      const res = await fetch(apiUrl("/api/auth/admin-access"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          phrase: phrase.trim(),
          name: user?.fullName || user?.firstName || "Administrador General",
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "No se pudo activar el acceso administrador");
      toast({ title: "Acceso administrador activado" });
      setLocation("/dashboard");
    } catch (err: unknown) {
      toast({ title: (err as Error).message || "Error inesperado", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  if (!isLoaded) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f8f4ef]">
        <div className="animate-spin rounded-full h-10 w-10 border-4 border-amber-500 border-t-transparent" />
      </div>
    );
  }

  if (!isSignedIn) {
    setLocation("/sign-in");
    return null;
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#f8f4ef] px-4">
      <div className="w-full max-w-md bg-white rounded-3xl p-7 shadow-sm border border-black/10">
        <h1 className="text-[#1a1612] font-black text-2xl mb-2" style={{ fontFamily: "'Bebas Neue', sans-serif", letterSpacing: "0.05em" }}>
          Activar administrador
        </h1>
        <p className="text-sm text-[#1a1612]/55 mb-6">
          Esta pantalla solo se usa para activar al administrador general inicial.
          La frase se valida en el servidor y nunca se expone en frontend.
        </p>
        <form onSubmit={submit} className="space-y-4">
          <input
            value={phrase}
            onChange={(e) => setPhrase(e.target.value.toUpperCase())}
            placeholder="Ingresa frase de acceso"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            className="w-full rounded-2xl px-4 py-3 font-mono tracking-wider text-sm outline-none"
            style={{ border: "1.5px solid rgba(0,0,0,0.14)", background: "rgba(0,0,0,0.01)" }}
          />
          <button
            type="submit"
            disabled={loading || !phrase.trim()}
            className="w-full py-3 rounded-2xl text-white font-bold disabled:opacity-60"
            style={{ background: "linear-gradient(135deg, #C8952A, #E8A830)" }}
          >
            {loading ? "Validando..." : "Activar acceso"}
          </button>
          <button
            type="button"
            onClick={() => setLocation("/")}
            className="w-full py-2.5 rounded-xl text-sm font-semibold"
            style={{ border: "1px solid rgba(0,0,0,0.12)", color: "rgba(26,22,18,0.7)" }}
          >
            Volver
          </button>
        </form>
      </div>
    </div>
  );
}
