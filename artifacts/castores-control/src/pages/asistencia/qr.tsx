import { useCallback, useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { useLocation } from "wouter";
import { MainLayout } from "@/components/layout/main-layout";
import { getAuthToken, getClerkUserInfo } from "@workspace/api-client-react";
import { apiUrl } from "@/lib/api-url";
import { usePermissions } from "@/hooks/use-permissions";

type ProjectMini = { id: number; name: string };
type QrResponse = {
  token: string;
  projectId: number;
  projectName: string;
  expiresAt: string;
  ttlSeconds: number;
};

async function authedFetch(path: string, init?: RequestInit): Promise<Response> {
  const token = await getAuthToken();
  const { clerkId, email } = getClerkUserInfo();
  const headers: Record<string, string> = {
    Accept: "application/json",
    ...(init?.body ? { "Content-Type": "application/json" } : {}),
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const params = new URLSearchParams();
  if (clerkId) params.set("clerkId", clerkId);
  if (email) params.set("email", email);
  const qs = params.toString();
  const sep = path.includes("?") ? "&" : "?";
  return fetch(`${apiUrl(path)}${qs ? sep + qs : ""}`, {
    ...init,
    headers: { ...headers, ...(init?.headers as Record<string, string> | undefined) },
    credentials: "include",
  });
}

/**
 * Pantalla del supervisor: elige una obra, genera un token QR efímero
 * (2 min) y lo muestra grande. Los workers escanean con la cámara nativa
 * del teléfono → los abre en /check?qr=TOKEN que autocompleta el input.
 * Si la cámara no detecta el QR, también pueden tipear el código de 8
 * caracteres a mano.
 */
export default function SupervisorQrPage() {
  const [, setLocation] = useLocation();
  const perms = usePermissions();
  const [projects, setProjects] = useState<ProjectMini[]>([]);
  const [projectId, setProjectId] = useState<number | null>(null);
  const [qr, setQr] = useState<QrResponse | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const autoGenIntervalRef = useRef<number | null>(null);

  useEffect(() => {
    authedFetch("/api/projects").then(async (r) => {
      if (!r.ok) return;
      const data = (await r.json()) as ProjectMini[];
      setProjects(data.map((p) => ({ id: p.id, name: p.name })));
      if (data.length > 0 && projectId == null) setProjectId(data[0].id);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const generate = useCallback(async () => {
    if (!projectId || generating) return;
    setGenerating(true);
    setError(null);
    try {
      const res = await authedFetch("/api/attendance/qr", {
        method: "POST",
        body: JSON.stringify({ projectId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error || "No se pudo generar el QR.");
        return;
      }
      setQr(data as QrResponse);
      // El payload del QR es el deeplink que los workers ya tienen en su
      // PWA. Si la cámara nativa detecta el QR, los manda al check con
      // ?qr=TOKEN; si no, el token grande de 8 chars se puede tipear.
      const baseUrl = window.location.origin;
      const deeplink = `${baseUrl}/check?qr=${encodeURIComponent(data.token)}`;
      const dataUrl = await QRCode.toDataURL(deeplink, {
        width: 480, margin: 2, errorCorrectionLevel: "M",
        color: { dark: "#141414", light: "#ffffff" },
      });
      setQrDataUrl(dataUrl);
      const ttl = Math.floor((new Date(data.expiresAt).getTime() - Date.now()) / 1000);
      setSecondsLeft(Math.max(0, ttl));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Error de red");
    } finally {
      setGenerating(false);
    }
  }, [projectId, generating]);

  // Cuenta regresiva visual + auto-regen cuando expira.
  useEffect(() => {
    if (!qr) return;
    const id = window.setInterval(() => {
      setSecondsLeft((s) => Math.max(0, s - 1));
    }, 1000);
    return () => window.clearInterval(id);
  }, [qr]);

  useEffect(() => {
    if (secondsLeft === 0 && qr && autoGenIntervalRef.current == null) {
      // Token expiró — auto regen para que la pantalla del supervisor
      // siempre muestre algo válido. Damos pequeño respiro de 1s.
      autoGenIntervalRef.current = window.setTimeout(() => {
        autoGenIntervalRef.current = null;
        void generate();
      }, 1000) as unknown as number;
    }
  }, [secondsLeft, qr, generate]);

  if (!perms.loading && !perms.has("attendanceGenerateQr")) {
    return (
      <MainLayout>
        <div className="max-w-2xl mx-auto px-6 py-12 text-center">
          <h1 className="text-xl font-bold text-gray-900">Sin permiso para generar QR</h1>
          <p className="mt-2 text-sm text-gray-500">
            Solo supervisores y administradores pueden mostrar el QR de salida.
          </p>
        </div>
      </MainLayout>
    );
  }

  return (
    <MainLayout>
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        <div className="flex items-end justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">QR de salida</h1>
            <p className="text-sm text-gray-500 mt-0.5">
              Muestra esta pantalla cuando los trabajadores se van. Se renueva solo cada 2 min.
            </p>
          </div>
          <button
            onClick={() => setLocation("/asistencia")}
            className="px-4 py-2 rounded-xl text-sm font-bold text-gray-700 border border-gray-200"
            data-testid="button-back-dashboard"
          >
            ← Dashboard
          </button>
        </div>

        <div className="bg-white rounded-2xl border border-gray-100 p-4 flex items-center gap-3">
          <label className="text-[10px] font-bold uppercase tracking-widest text-gray-400 whitespace-nowrap">Obra:</label>
          <select
            value={projectId ?? ""}
            onChange={(e) => { setProjectId(Number(e.target.value)); setQr(null); setQrDataUrl(null); }}
            className="flex-1 px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm"
            data-testid="select-qr-project"
          >
            {projects.length === 0 && <option>Cargando...</option>}
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <button
            onClick={generate}
            disabled={generating || !projectId}
            className="px-5 py-2 rounded-xl text-sm font-bold text-white disabled:opacity-40"
            style={{ background: "#FF3C00" }}
            data-testid="button-generate-qr"
          >
            {generating ? "..." : qr ? "Renovar" : "Generar QR"}
          </button>
        </div>

        {error && (
          <div className="rounded-xl px-4 py-3 text-sm font-medium bg-red-50 border border-red-200 text-red-700">
            {error}
          </div>
        )}

        {qr && qrDataUrl ? (
          <div className="bg-white rounded-3xl border-2 p-8 text-center"
            style={{ borderColor: secondsLeft <= 15 ? "#DC2626" : "#141414" }}>
            <p className="text-xs uppercase tracking-widest font-bold text-gray-500 mb-2">
              Escanea con la cámara
            </p>
            <p className="text-xl font-black text-gray-900 mb-5">{qr.projectName}</p>
            <img
              src={qrDataUrl}
              alt="Código QR"
              className="mx-auto rounded-2xl"
              style={{ width: 320, height: 320, imageRendering: "pixelated" }}
              data-testid="qr-image"
            />
            <div className="mt-6 inline-block px-5 py-2 rounded-full"
              style={{ background: "#141414" }}>
              <p className="text-[10px] uppercase tracking-widest font-bold text-[#FF7A3C] mb-0.5">
                Código manual
              </p>
              <p className="text-3xl font-mono font-black text-white tracking-[0.25em]"
                data-testid="qr-token">
                {qr.token}
              </p>
            </div>
            <p className="text-sm mt-4 font-bold"
              style={{ color: secondsLeft <= 15 ? "#DC2626" : "#525252" }}>
              {secondsLeft > 0 ? (
                <>Válido {secondsLeft}s — se renueva solo</>
              ) : (
                <>Renovando...</>
              )}
            </p>
          </div>
        ) : (
          !error && (
            <div className="bg-white rounded-3xl border border-gray-100 p-12 text-center">
              <p className="text-sm text-gray-500">
                {projectId
                  ? "Toca \"Generar QR\" para mostrarlo en pantalla."
                  : "Selecciona una obra primero."}
              </p>
            </div>
          )
        )}

        <div className="text-xs text-gray-500 px-2">
          ¿Cómo funciona? El trabajador escanea este QR con la cámara de su celular; el código abre su PWA en la pantalla de salida con el código ya cargado. Si la cámara no lo detecta, puede teclear el código de 8 letras a mano.
        </div>
      </div>
    </MainLayout>
  );
}
