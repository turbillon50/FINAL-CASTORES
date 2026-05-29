import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { clearWorkerSession, getWorkerToken, getWorkerUser, workerFetch } from "@/lib/worker-session";
import { compressImageFile } from "@/lib/compress-image";

// ─── Tipos del payload del backend ────────────────────────────────────────
type AttendanceProject = {
  id: number;
  name: string;
  location: string | null;
  latitude: number | null;
  longitude: number | null;
  geofenceRadiusMeters: number;
  geofenceMode: "strict" | "tolerant" | "off";
};

type CheckInRow = {
  id: number;
  projectId: number;
  checkInAt: string;
  checkInStatus: "ok" | "flagged" | "manual";
};

type MeResponse = {
  user: { id: number; name: string; role: string; workerCode: string | null; avatarUrl: string | null };
  projects: AttendanceProject[];
  openCheckIn: CheckInRow | null;
};

type GeoSample = { latitude: number; longitude: number; accuracy: number };

// ─── Distancia Haversine (mismo cálculo que backend) — usada para
// mostrar al worker qué obra es más cercana y autoseleccionarla.
function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const φ1 = toRad(lat1);
  const φ2 = toRad(lat2);
  const Δφ = toRad(lat2 - lat1);
  const Δλ = toRad(lon2 - lon1);
  const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function getCurrentPosition(): Promise<GeoSample> {
  return new Promise((resolve, reject) => {
    if (!("geolocation" in navigator)) {
      reject(new Error("Este dispositivo no permite obtener tu ubicación."));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
        accuracy: pos.coords.accuracy,
      }),
      (err) => reject(new Error(
        err.code === err.PERMISSION_DENIED
          ? "Activa los permisos de ubicación para marcar tu asistencia."
          : "No pudimos leer tu ubicación. Asegúrate de tener GPS activo y vuelve a intentar."
      )),
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 5_000 },
    );
  });
}

function formatElapsed(fromISO: string): string {
  const ms = Date.now() - new Date(fromISO).getTime();
  if (ms < 60_000) return `${Math.round(ms / 1000)} s`;
  const min = Math.round(ms / 60_000);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

// ──────────────────────────────────────────────────────────────────────────
// Página principal: muestra estado actual y permite check-in/check-out.
// ──────────────────────────────────────────────────────────────────────────
export default function WorkerCheckPage() {
  const [, setLocation] = useLocation();
  const [me, setMe] = useState<MeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null);
  const [position, setPosition] = useState<GeoSample | null>(null);
  const [gpsBusy, setGpsBusy] = useState(false);
  const [gpsError, setGpsError] = useState<string | null>(null);

  const [photoDataUrl, setPhotoDataUrl] = useState<string | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const photoInputRef = useRef<HTMLInputElement>(null);

  const [qrToken, setQrToken] = useState<string>(""); // para checkout
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionOk, setActionOk] = useState<string | null>(null);

  // Tick para refrescar el "tiempo en obra" cada minuto en el banner abierto.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  // Si no hay sesión worker → al login.
  // Si la sesión arrastra pinMustChange=true (alta/reset reciente),
  // forzar paso por /check/change-pin antes de cualquier check-in.
  useEffect(() => {
    if (!getWorkerToken() || !getWorkerUser()) {
      setLocation("/check/login");
      return;
    }
    const u = getWorkerUser();
    if (u?.pinMustChange) setLocation("/check/change-pin");
  }, [setLocation]);

  // Si llegamos con ?qr=TOKEN (link generado por el supervisor),
  // lo capturamos para auto-rellenar el checkout.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const t = params.get("qr");
    if (t) setQrToken(t);
  }, []);

  const reload = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await workerFetch("/api/attendance/me");
      if (res.status === 401) {
        clearWorkerSession();
        setLocation("/check/login");
        return;
      }
      if (!res.ok) throw new Error("No pudimos cargar tus obras.");
      const data = (await res.json()) as MeResponse;
      setMe(data);
    } catch (err: unknown) {
      setLoadError(err instanceof Error ? err.message : "Error de red");
    } finally {
      setLoading(false);
    }
  }, [setLocation]);

  useEffect(() => { reload(); }, [reload]);

  // Cuando llega el GPS y tenemos obras, autoseleccionar la más cercana.
  useEffect(() => {
    if (!me || !position) return;
    if (selectedProjectId) return; // respeta selección manual
    if (me.openCheckIn) {
      setSelectedProjectId(me.openCheckIn.projectId);
      return;
    }
    if (me.projects.length === 0) return;
    if (me.projects.length === 1) {
      setSelectedProjectId(me.projects[0].id);
      return;
    }
    const ranked = me.projects
      .filter((p) => p.latitude != null && p.longitude != null)
      .map((p) => ({
        id: p.id,
        d: haversineMeters(p.latitude!, p.longitude!, position.latitude, position.longitude),
      }))
      .sort((a, b) => a.d - b.d);
    if (ranked.length > 0) setSelectedProjectId(ranked[0].id);
    else setSelectedProjectId(me.projects[0].id);
  }, [me, position, selectedProjectId]);

  const requestLocation = useCallback(async () => {
    setGpsBusy(true);
    setGpsError(null);
    try {
      const sample = await getCurrentPosition();
      setPosition(sample);
    } catch (err: unknown) {
      setGpsError(err instanceof Error ? err.message : "GPS no disponible");
    } finally {
      setGpsBusy(false);
    }
  }, []);

  // Pedir GPS apenas carga la página (UX: la decisión de geofence depende
  // de tenerlo ya cuando el usuario tape "Entrar"/"Salir").
  useEffect(() => { void requestLocation(); }, [requestLocation]);

  const onPickPhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhotoBusy(true);
    try {
      // Comprime fuerte porque vamos a meter el data URL directo en la
      // columna de Postgres y el body del request: max ~250 KB target.
      const compressed = await compressImageFile(file, { maxDim: 1024, quality: 0.7 });
      setPhotoDataUrl(compressed);
    } catch {
      setActionError("No se pudo procesar la foto. Intenta otra.");
    } finally {
      setPhotoBusy(false);
    }
  };

  const openCheckInProject = useMemo(() => {
    if (!me?.openCheckIn) return null;
    return me.projects.find((p) => p.id === me.openCheckIn!.projectId) ?? null;
  }, [me]);

  const submitCheckIn = async () => {
    if (!selectedProjectId || !position || submitting) return;
    setSubmitting(true);
    setActionError(null);
    setActionOk(null);
    try {
      const res = await workerFetch("/api/attendance/check-in", {
        method: "POST",
        body: JSON.stringify({
          projectId: selectedProjectId,
          latitude: position.latitude,
          longitude: position.longitude,
          accuracy: position.accuracy,
          photoUrl: photoDataUrl ?? undefined,
          notes: notes.trim() || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 422 && data?.distanceMeters != null) {
          setActionError(
            `${data.error} Estás a ~${data.distanceMeters} m del centro (máx ${data.allowedRadiusMeters} m).`,
          );
        } else {
          setActionError(data?.error || "No pudimos registrar tu entrada.");
        }
        setSubmitting(false);
        return;
      }
      setActionOk("Entrada registrada. ¡Buen día de trabajo!");
      setPhotoDataUrl(null);
      setNotes("");
      await reload();
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : "Error de red");
    } finally {
      setSubmitting(false);
    }
  };

  const submitCheckOut = async () => {
    if (!position || submitting) return;
    setSubmitting(true);
    setActionError(null);
    setActionOk(null);
    try {
      const res = await workerFetch("/api/attendance/check-out", {
        method: "POST",
        body: JSON.stringify({
          latitude: position.latitude,
          longitude: position.longitude,
          accuracy: position.accuracy,
          photoUrl: photoDataUrl ?? undefined,
          notes: notes.trim() || undefined,
          qrToken: qrToken.trim() || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 422 && data?.distanceMeters != null) {
          setActionError(
            `${data.error} Estás a ~${data.distanceMeters} m del centro (máx ${data.allowedRadiusMeters} m).`,
          );
        } else {
          setActionError(data?.error || "No pudimos registrar tu salida.");
        }
        setSubmitting(false);
        return;
      }
      setActionOk(`Salida registrada. Trabajaste ${data.totalMinutes} min.`);
      setPhotoDataUrl(null);
      setNotes("");
      setQrToken("");
      await reload();
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : "Error de red");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center"
        style={{ background: "linear-gradient(160deg, #141414 0%, #262626 60%, #141414 100%)" }}>
        <div className="animate-spin rounded-full h-10 w-10 border-4"
          style={{ borderColor: "rgba(255,60,0,0.2)", borderTopColor: "#FF3C00" }} />
      </div>
    );
  }
  if (loadError || !me) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-6 gap-3 text-center"
        style={{ background: "linear-gradient(160deg, #141414 0%, #262626 60%, #141414 100%)" }}>
        <p className="text-white">{loadError || "Sin datos"}</p>
        <button onClick={reload} className="px-5 py-2 rounded-xl bg-amber-600 text-white text-sm font-bold">
          Reintentar
        </button>
      </div>
    );
  }

  const hasOpen = !!me.openCheckIn;
  const selectedProject = me.projects.find((p) => p.id === selectedProjectId) ?? null;
  // Distancia al centro de la obra (lo mostramos para que el worker entienda
  // por qué fue rechazado / aceptado por el geofence).
  const liveDistance = (() => {
    if (!position || !selectedProject?.latitude || !selectedProject?.longitude) return null;
    return Math.round(
      haversineMeters(selectedProject.latitude, selectedProject.longitude, position.latitude, position.longitude),
    );
  })();
  const insideRadius = liveDistance != null && selectedProject
    ? liveDistance <= selectedProject.geofenceRadiusMeters + (position?.accuracy ?? 0)
    : null;

  return (
    <div className="min-h-screen pb-12"
      style={{ background: "linear-gradient(160deg, #141414 0%, #262626 60%, #141414 100%)" }}>
      {/* Top bar */}
      <header className="px-5 pt-6 pb-4 flex items-center justify-between"
        style={{ paddingTop: "max(env(safe-area-inset-top), 24px)" }}>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center text-xl"
            style={{ background: "rgba(255,60,0,0.18)", border: "1px solid rgba(255,60,0,0.4)" }}>
            👷
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-widest font-bold"
              style={{ color: "rgba(255,255,255,0.4)" }}>
              {me.user.workerCode}
            </p>
            <p className="text-white font-bold text-base leading-tight">{me.user.name}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setLocation("/check/change-pin")}
            className="text-[10px] font-bold uppercase tracking-widest px-3 py-2 rounded-full"
            style={{ background: "rgba(255,60,0,0.18)", border: "1px solid rgba(255,60,0,0.4)", color: "#fde68a" }}
            data-testid="button-go-change-pin"
          >
            🔐 PIN
          </button>
          <button
            onClick={() => { clearWorkerSession(); setLocation("/check/login"); }}
            className="text-[10px] font-bold uppercase tracking-widest px-3 py-2 rounded-full"
            style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)", color: "rgba(255,255,255,0.55)" }}
            data-testid="button-worker-logout"
          >
            Salir
          </button>
        </div>
      </header>

      <div className="px-5 max-w-md mx-auto space-y-4">
        {/* Banner de check-in abierto */}
        {hasOpen && me.openCheckIn && (
          <div className="rounded-2xl p-4"
            style={{ background: "rgba(34,197,94,0.10)", border: "1.5px solid rgba(34,197,94,0.4)" }}>
            <div className="flex items-center gap-2 mb-2">
              <span className="w-2 h-2 rounded-full animate-pulse" style={{ background: "#22c55e" }} />
              <p className="text-[10px] font-black uppercase tracking-widest" style={{ color: "#86efac" }}>
                En obra desde hace {formatElapsed(me.openCheckIn.checkInAt)}
              </p>
            </div>
            <p className="text-white font-bold text-base">{openCheckInProject?.name ?? "Obra"}</p>
            {openCheckInProject?.location && (
              <p className="text-xs mt-0.5" style={{ color: "rgba(255,255,255,0.5)" }}>{openCheckInProject.location}</p>
            )}
            {me.openCheckIn.checkInStatus === "flagged" && (
              <p className="text-[11px] mt-2 px-2 py-1 rounded-md inline-block"
                style={{ background: "rgba(234,179,8,0.2)", color: "#fde68a" }}>
                ⚠ Tu entrada quedó marcada para revisión (estabas fuera del rango).
              </p>
            )}
          </div>
        )}

        {/* GPS card */}
        <div className="rounded-2xl p-4"
          style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-widest mb-1.5"
                style={{ color: "rgba(255,255,255,0.4)" }}>
                Tu ubicación
              </p>
              {position ? (
                <>
                  <p className="text-white text-sm font-mono">
                    {position.latitude.toFixed(5)}, {position.longitude.toFixed(5)}
                  </p>
                  <p className="text-[11px] mt-0.5" style={{ color: "rgba(255,255,255,0.45)" }}>
                    Precisión: ±{Math.round(position.accuracy)} m
                    {liveDistance != null && selectedProject && (
                      <> · {liveDistance} m al centro de la obra ({insideRadius ? "✓ dentro" : "✗ fuera"} del rango)</>
                    )}
                  </p>
                </>
              ) : gpsError ? (
                <p className="text-sm" style={{ color: "#fca5a5" }}>{gpsError}</p>
              ) : (
                <p className="text-sm" style={{ color: "rgba(255,255,255,0.5)" }}>
                  {gpsBusy ? "Obteniendo GPS..." : "Toca para activar GPS"}
                </p>
              )}
            </div>
            <button
              onClick={requestLocation}
              disabled={gpsBusy}
              className="text-[10px] font-bold uppercase tracking-widest px-3 py-2 rounded-full disabled:opacity-40"
              style={{ background: "rgba(255,60,0,0.18)", border: "1px solid rgba(255,60,0,0.4)", color: "#fde68a" }}
              data-testid="button-refresh-gps"
            >
              {gpsBusy ? "..." : "Actualizar"}
            </button>
          </div>
        </div>

        {/* Selector de obra (solo cuando NO hay check-in abierto) */}
        {!hasOpen && (
          <div className="rounded-2xl p-4 space-y-3"
            style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
            <p className="text-[10px] font-bold uppercase tracking-widest"
              style={{ color: "rgba(255,255,255,0.4)" }}>
              Selecciona obra
            </p>
            {me.projects.length === 0 ? (
              <p className="text-sm" style={{ color: "rgba(255,255,255,0.5)" }}>
                No estás asignado a ninguna obra. Pídele a tu supervisor que te asigne.
              </p>
            ) : (
              <div className="space-y-1.5">
                {me.projects.map((p) => {
                  const dist = position && p.latitude != null && p.longitude != null
                    ? Math.round(haversineMeters(p.latitude, p.longitude, position.latitude, position.longitude))
                    : null;
                  const isSelected = selectedProjectId === p.id;
                  return (
                    <button
                      key={p.id}
                      onClick={() => setSelectedProjectId(p.id)}
                      className="w-full text-left px-3 py-2.5 rounded-xl transition-colors"
                      style={{
                        background: isSelected ? "rgba(255,60,0,0.18)" : "rgba(255,255,255,0.04)",
                        border: `1px solid ${isSelected ? "rgba(255,60,0,0.5)" : "rgba(255,255,255,0.08)"}`,
                      }}
                      data-testid={`project-option-${p.id}`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <p className="text-white font-semibold text-sm truncate">{p.name}</p>
                          {p.location && (
                            <p className="text-[11px] truncate" style={{ color: "rgba(255,255,255,0.45)" }}>{p.location}</p>
                          )}
                        </div>
                        {dist != null && (
                          <span className="text-[10px] font-bold whitespace-nowrap"
                            style={{ color: dist <= p.geofenceRadiusMeters ? "#86efac" : "rgba(255,255,255,0.5)" }}>
                            {dist} m
                          </span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* QR token (solo en checkout) */}
        {hasOpen && (
          <div className="rounded-2xl p-4 space-y-2"
            style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
            <p className="text-[10px] font-bold uppercase tracking-widest"
              style={{ color: "rgba(255,255,255,0.4)" }}>
              QR del supervisor (opcional)
            </p>
            <input
              type="text"
              value={qrToken}
              onChange={(e) => setQrToken(e.target.value.trim())}
              placeholder="Escanea el QR del super o pégalo aquí"
              autoCorrect="off"
              spellCheck={false}
              className="w-full px-3 py-2.5 rounded-xl text-sm font-mono"
              style={{
                background: "rgba(0,0,0,0.25)",
                border: "1px solid rgba(255,255,255,0.12)",
                color: "#fff",
              }}
              data-testid="input-qr-token"
            />
            <p className="text-[11px]" style={{ color: "rgba(255,255,255,0.45)" }}>
              Si el supervisor te muestra un código QR para cerrar la jornada, escanéalo con tu cámara — se autollena al abrir el link.
            </p>
          </div>
        )}

        {/* Foto + nota */}
        <div className="rounded-2xl p-4 space-y-3"
          style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest mb-2"
              style={{ color: "rgba(255,255,255,0.4)" }}>
              Foto (opcional)
            </p>
            <input
              ref={photoInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={onPickPhoto}
              className="hidden"
            />
            {photoDataUrl ? (
              <div className="flex items-center gap-3">
                <img src={photoDataUrl} alt="Foto" className="w-16 h-16 rounded-lg object-cover" />
                <button
                  onClick={() => setPhotoDataUrl(null)}
                  className="text-xs underline" style={{ color: "rgba(255,255,255,0.6)" }}
                >
                  Quitar
                </button>
              </div>
            ) : (
              <button
                onClick={() => photoInputRef.current?.click()}
                disabled={photoBusy}
                className="w-full py-3 rounded-xl text-sm font-bold disabled:opacity-50"
                style={{ background: "rgba(255,255,255,0.06)", border: "1px dashed rgba(255,255,255,0.2)", color: "rgba(255,255,255,0.8)" }}
                data-testid="button-pick-photo"
              >
                {photoBusy ? "Procesando..." : "📷 Tomar foto"}
              </button>
            )}
          </div>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest mb-1.5"
              style={{ color: "rgba(255,255,255,0.4)" }}>
              Nota (opcional)
            </p>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value.slice(0, 500))}
              placeholder="Algo que mencionar..."
              rows={2}
              className="w-full px-3 py-2 rounded-xl text-sm resize-none"
              style={{ background: "rgba(0,0,0,0.25)", border: "1px solid rgba(255,255,255,0.12)", color: "#fff" }}
              data-testid="input-notes"
            />
          </div>
        </div>

        {/* Feedback */}
        {actionError && (
          <div className="rounded-xl px-4 py-3 text-sm font-medium"
            style={{ background: "rgba(220,38,38,0.15)", border: "1px solid rgba(220,38,38,0.35)", color: "#fca5a5" }}>
            {actionError}
          </div>
        )}
        {actionOk && (
          <div className="rounded-xl px-4 py-3 text-sm font-medium text-center"
            style={{ background: "rgba(34,197,94,0.15)", border: "1px solid rgba(34,197,94,0.35)", color: "#86efac" }}>
            {actionOk}
          </div>
        )}

        {/* Action button */}
        {hasOpen ? (
          <button
            onClick={submitCheckOut}
            disabled={submitting || !position}
            className="w-full py-5 rounded-2xl text-lg font-black tracking-wide disabled:opacity-40 transition-all"
            style={{
              background: "linear-gradient(135deg, #DC2626, #B91C1C)",
              color: "white",
              boxShadow: "0 6px 24px rgba(220,38,38,0.4)",
            }}
            data-testid="button-check-out"
          >
            {submitting ? "Registrando..." : "🏁 Marcar salida"}
          </button>
        ) : (
          <button
            onClick={submitCheckIn}
            disabled={submitting || !position || !selectedProjectId}
            className="w-full py-5 rounded-2xl text-lg font-black tracking-wide disabled:opacity-40 transition-all"
            style={{
              background: "linear-gradient(135deg, #22C55E, #16A34A)",
              color: "white",
              boxShadow: "0 6px 24px rgba(34,197,94,0.4)",
            }}
            data-testid="button-check-in"
          >
            {submitting ? "Registrando..." : "▶ Marcar entrada"}
          </button>
        )}
      </div>
    </div>
  );
}
