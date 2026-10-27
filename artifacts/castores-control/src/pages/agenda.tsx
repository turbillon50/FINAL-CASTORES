import { useEffect, useState } from "react";
import { Link } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { CalendarDays, ArrowLeft, Download, MessageCircle } from "lucide-react";
import "./agenda.css";

type Appointment = {
  id: string;
  name: string;
  phone: string;
  service: string;
  starts_at: string;
  time_zone: string;
  status: string;
  opt_in: boolean;
  version: number;
  reminders: Array<{ id: string; hours: number; status: string }>;
};
type AgendaData = {
  appointments: Appointment[];
  template: string;
  whatsapp: { enabled: boolean; configured: boolean };
};
type Form = {
  name: string;
  phone: string;
  service: string;
  date: string;
  time: string;
  timeZone: string;
  status: string;
  optIn: boolean;
};
const STATUS: Record<string, string> = {
  pendiente: "Pendiente",
  confirmada: "Confirmada",
  cancelada: "Cancelada",
  completada: "Completada",
  no_asistio: "No asistió",
};
const DELIVERY: Record<string, string> = {
  scheduled: "Programado",
  processing: "En proceso",
  queued: "En cola",
  sending: "En proceso",
  sent: "Enviado",
  delivered: "Entregado",
  read: "Leído",
  failed: "No enviado",
  undelivered: "No entregado",
  unknown: "Entrega por verificar",
  cancelled: "Cancelado",
  expired: "Vencido",
};
function localParts(value: string, timeZone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(new Date(value))
      .map((p) => [p.type, p.value]),
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
  };
}
const blank = (): Form => ({
  name: "",
  phone: "",
  service: "",
  ...localParts(new Date().toISOString(), "America/Mexico_City"),
  time: "09:00",
  timeZone: "America/Mexico_City",
  status: "pendiente",
  optIn: false,
});
function formFor(a: Appointment): Form {
  return {
    name: a.name,
    phone: a.phone,
    service: a.service,
    ...localParts(a.starts_at, a.time_zone),
    timeZone: a.time_zone,
    status: a.status,
    optIn: a.opt_in,
  };
}
function messageError(error: unknown) {
  return (
    (error as { data?: { error?: string } })?.data?.error ||
    "No se pudo conectar. Tus cambios siguen aquí; vuelve a intentarlo."
  );
}
export default function Agenda() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [form, setForm] = useState<Form>(blank),
    [editing, setEditing] = useState<Appointment | null>(null),
    [tab, setTab] = useState("prox");
  const [template, setTemplate] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(""),
    [error, setError] = useState("");
  const [install, setInstall] = useState<any>(null);
  const query = useQuery({
    queryKey: ["agenda", user?.id],
    enabled: user?.role === "admin",
    queryFn: () => customFetch<AgendaData>("/api/agenda"),
    retry: 1,
  });
  useEffect(() => {
    const previous = document.title;
    document.title = "Agenda Castores";
    const link = document.querySelector<HTMLLinkElement>(
      'link[rel="manifest"]',
    );
    const old = link?.getAttribute("href");
    if (link) link.href = "/agenda-manifest.json";
    const handler = (e: Event) => {
      e.preventDefault();
      setInstall(e);
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => {
      document.title = previous;
      if (link && old) link.href = old;
      window.removeEventListener("beforeinstallprompt", handler);
    };
  }, []);
  const patch = (key: keyof Form, value: string | boolean) =>
    setForm((f) => ({ ...f, [key]: value }));
  async function perform(action: () => Promise<unknown>, success: string) {
    if (busy) return false;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
      await qc.invalidateQueries({ queryKey: ["agenda", user?.id] });
      setNotice(success);
      return true;
    } catch (e) {
      setError(messageError(e));
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function save(e: React.FormEvent) {
    e.preventDefault();
    const ok = await perform(
      () =>
        customFetch(
          `/api/agenda/appointments${editing ? `/${editing.id}` : ""}`,
          {
            method: editing ? "PUT" : "POST",
            body: JSON.stringify({
              ...form,
              ...(editing ? { version: editing.version } : {}),
            }),
          },
        ),
      editing ? "Cita actualizada." : "Cita guardada.",
    );
    if (ok) {
      setForm((f) => ({ ...blank(), date: f.date, timeZone: f.timeZone }));
      setEditing(null);
    }
  }
  async function changeStatus(a: Appointment, status: string) {
    await perform(
      () =>
        customFetch(`/api/agenda/appointments/${a.id}`, {
          method: "PUT",
          body: JSON.stringify({ ...formFor(a), status, version: a.version }),
        }),
      "Estado de la cita actualizado.",
    );
  }
  function manualMessage(a: Appointment) {
    const local = localParts(a.starts_at, a.time_zone);
    const date = new Intl.DateTimeFormat("es-MX", {
      timeZone: a.time_zone,
      weekday: "long",
      day: "numeric",
      month: "long",
    }).format(new Date(a.starts_at));
    const vars: Record<string, string> = {
      cliente: a.name,
      fecha: date,
      hora: local.time,
      servicio: a.service || "visita",
    };
    return (query.data?.template || "").replace(
      /\{(cliente|fecha|hora|servicio)\}/g,
      (_, key: string) => vars[key],
    );
  }
  if (user?.role !== "admin")
    return (
      <main className="agenda-page">
        <div className="agenda-wrap">
          <h1>Agenda privada</h1>
          <p>Disponible para administradores.</p>
          <Link href="/dashboard">Volver a Castores</Link>
        </div>
      </main>
    );
  const now = Date.now();
  const appointments = (query.data?.appointments || [])
    .filter(
      (a) =>
        tab === "all" ||
        (tab === "hoy" &&
          localParts(a.starts_at, a.time_zone).date ===
            localParts(new Date().toISOString(), a.time_zone).date) ||
        (tab === "prox" &&
          Date.parse(a.starts_at) >= now &&
          !["cancelada", "completada", "no_asistio"].includes(a.status)) ||
        (tab === "pas" && Date.parse(a.starts_at) < now),
    )
    .sort((a, b) =>
      tab === "pas"
        ? Date.parse(b.starts_at) - Date.parse(a.starts_at)
        : Date.parse(a.starts_at) - Date.parse(b.starts_at),
    );
  const automatic = !!(
    query.data?.whatsapp.enabled && query.data?.whatsapp.configured
  );
  return (
    <main className="agenda-page">
      <div className="agenda-wrap">
        <header className="agenda-top">
          <Link href="/dashboard" className="agenda-back">
            <ArrowLeft size={16} /> Castores Control
          </Link>
          {install && (
            <button
              onClick={async () => {
                await install.prompt();
                setInstall(null);
              }}
            >
              <Download size={16} /> Instalar
            </button>
          )}
        </header>
        <div className="agenda-brand">
          <img src="/castores-logo.jpeg" alt="Castores" />
          <div>
            <h1>
              <CalendarDays size={24} /> Agenda de citas
            </h1>
            <p>Clientes, visitas y recordatorios en un solo lugar.</p>
          </div>
        </div>
        <p className="agenda-note">
          {automatic
            ? "Recordatorios automáticos a las 24 y 2 horas previas, para clientes que los autorizaron."
            : "Los recordatorios automáticos aún no están activados. Puedes abrir WhatsApp para enviarlos personalmente."}
        </p>
        {error && (
          <div className="agenda-error" role="alert">
            {error}
          </div>
        )}
        {notice && (
          <div className="agenda-notice" role="status">
            {notice}
          </div>
        )}
        {query.isError && (
          <div className="agenda-error" role="alert">
            No se pudo cargar la agenda.{" "}
            <button onClick={() => query.refetch()}>Reintentar</button>
          </div>
        )}
        <div className="agenda-grid">
          <div>
            <section className="agenda-card">
              <h2>{editing ? "Editar cita" : "Nueva cita"}</h2>
              <form onSubmit={save}>
                <fieldset disabled={busy || query.isPending || query.isError}>
                  <label htmlFor="agenda-name">Cliente</label>
                  <input
                    id="agenda-name"
                    required
                    maxLength={160}
                    autoComplete="name"
                    value={form.name}
                    onChange={(e) => patch("name", e.target.value)}
                    placeholder="Nombre completo"
                  />
                  <label htmlFor="agenda-phone">WhatsApp con lada</label>
                  <input
                    id="agenda-phone"
                    required
                    type="tel"
                    autoComplete="tel"
                    value={form.phone}
                    onChange={(e) => patch("phone", e.target.value)}
                    placeholder="81 1234 5678"
                  />
                  <p className="agenda-note">
                    Diez dígitos se guardan con la lada de México (+52).
                  </p>
                  <div className="agenda-row">
                    <div>
                      <label htmlFor="agenda-date">Fecha</label>
                      <input
                        id="agenda-date"
                        type="date"
                        required
                        value={form.date}
                        onChange={(e) => patch("date", e.target.value)}
                      />
                    </div>
                    <div>
                      <label htmlFor="agenda-time">Hora</label>
                      <input
                        id="agenda-time"
                        type="time"
                        required
                        value={form.time}
                        onChange={(e) => patch("time", e.target.value)}
                      />
                    </div>
                  </div>
                  <label htmlFor="agenda-zone">Zona horaria de la cita</label>
                  <select
                    id="agenda-zone"
                    value={form.timeZone}
                    onChange={(e) => patch("timeZone", e.target.value)}
                  >
                    <option value="America/Mexico_City">
                      Centro de México
                    </option>
                    <option value="America/Cancun">
                      Cancún / Quintana Roo
                    </option>
                    <option value="America/Tijuana">Tijuana</option>
                  </select>
                  <label htmlFor="agenda-service">Servicio o motivo</label>
                  <input
                    id="agenda-service"
                    maxLength={300}
                    value={form.service}
                    onChange={(e) => patch("service", e.target.value)}
                    placeholder="Ej. Visita a obra o revisión de presupuesto"
                  />
                  {editing && (
                    <>
                      <label htmlFor="agenda-state">Estado</label>
                      <select
                        id="agenda-state"
                        value={form.status}
                        onChange={(e) => patch("status", e.target.value)}
                      >
                        {Object.entries(STATUS).map(([k, v]) => (
                          <option key={k} value={k}>
                            {v}
                          </option>
                        ))}
                      </select>
                    </>
                  )}
                  <label className="agenda-check">
                    <input
                      type="checkbox"
                      checked={form.optIn}
                      onChange={(e) => patch("optIn", e.target.checked)}
                    />
                    <span>
                      El cliente autorizó recibir recordatorios de esta cita por
                      WhatsApp.
                    </span>
                  </label>
                  <button type="submit" className="agenda-primary">
                    {busy
                      ? "Guardando…"
                      : editing
                        ? "Guardar cambios"
                        : "Agendar cita"}
                  </button>
                  {editing && (
                    <button
                      type="button"
                      className="agenda-secondary"
                      onClick={() => {
                        setEditing(null);
                        setForm(blank());
                      }}
                    >
                      Salir de edición
                    </button>
                  )}
                </fieldset>
              </form>
            </section>
            <section className="agenda-card agenda-template">
              <h2>Mensaje para envío personal</h2>
              <label htmlFor="agenda-template">Texto del recordatorio</label>
              <textarea
                id="agenda-template"
                maxLength={1500}
                value={template ?? query.data?.template ?? ""}
                onChange={(e) => setTemplate(e.target.value)}
                disabled={query.isPending || query.isError}
              />
              <p className="agenda-note">
                Variables: {"{cliente} {fecha} {hora} {servicio}"}. Los envíos
                automáticos utilizan la plantilla aprobada de WhatsApp.
              </p>
              <button
                disabled={busy || template === null}
                onClick={async () => {
                  if (
                    await perform(
                      () =>
                        customFetch("/api/agenda/settings", {
                          method: "PUT",
                          body: JSON.stringify({ template }),
                        }),
                      "Mensaje guardado.",
                    )
                  )
                    setTemplate(null);
                }}
              >
                Guardar mensaje
              </button>
            </section>
            <p className="agenda-note">
              En iPhone: Compartir → Agregar a inicio. Se necesita conexión para
              consultar y guardar citas.
            </p>
          </div>
          <section className="agenda-card agenda-list" aria-label="Citas">
            <div className="agenda-tabs">
              {[
                ["hoy", "Hoy"],
                ["prox", "Próximas"],
                ["pas", "Pasadas"],
                ["all", "Todas"],
              ].map(([k, v]) => (
                <button
                  key={k}
                  className={tab === k ? "on" : ""}
                  aria-pressed={tab === k}
                  onClick={() => setTab(k)}
                >
                  {v}
                </button>
              ))}
            </div>
            {query.isPending ? (
              <p role="status">Cargando agenda…</p>
            ) : appointments.length === 0 ? (
              <p className="agenda-empty">No hay citas en esta vista.</p>
            ) : (
              appointments.map((a) => (
                <article className="agenda-item" key={a.id}>
                  <div className="agenda-item-heading">
                    <div>
                      <h3>{a.name}</h3>
                      <p>
                        {new Intl.DateTimeFormat("es-MX", {
                          timeZone: a.time_zone,
                          weekday: "short",
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                          hourCycle: "h23",
                        }).format(new Date(a.starts_at))}
                      </p>
                      <p>
                        {a.time_zone === "America/Cancun"
                          ? "Hora de Cancún"
                          : a.time_zone === "America/Tijuana"
                            ? "Hora de Tijuana"
                            : "Hora del centro de México"}{" "}
                        · {a.service || "Sin motivo"}
                      </p>
                      <p>{a.phone}</p>
                    </div>
                    <span
                      className={`agenda-badge ${a.status === "cancelada" ? "cancelled" : ""}`}
                    >
                      {STATUS[a.status]}
                    </span>
                  </div>
                  <div className="agenda-delivery">
                    {a.reminders.map((r) => (
                      <span key={r.id}>
                        {r.hours} h:{" "}
                        {r.status === "scheduled" && !automatic
                          ? "Pendiente de activación"
                          : DELIVERY[r.status] || r.status}
                      </span>
                    ))}
                  </div>
                  <div className="agenda-actions">
                    <button
                      disabled={busy}
                      onClick={() => {
                        setEditing(a);
                        setForm(formFor(a));
                        window.scrollTo({ top: 0, behavior: "smooth" });
                      }}
                    >
                      Editar
                    </button>
                    {!["cancelada", "completada", "no_asistio"].includes(
                      a.status,
                    ) && (
                      <>
                        <a
                          className="agenda-wa"
                          href={`https://wa.me/${a.phone.replace(/\D/g, "")}?text=${encodeURIComponent(manualMessage(a))}`}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          <MessageCircle size={15} /> Abrir WhatsApp
                        </a>
                        {a.status !== "confirmada" && (
                          <button
                            disabled={busy}
                            onClick={() => changeStatus(a, "confirmada")}
                          >
                            Confirmar
                          </button>
                        )}
                        <button
                          disabled={busy}
                          onClick={() => changeStatus(a, "cancelada")}
                        >
                          Cancelar
                        </button>
                      </>
                    )}
                    <button
                      className="agenda-danger"
                      disabled={busy}
                      onClick={async () => {
                        if (
                          window.confirm(
                            `¿Eliminar la cita de ${a.name}? Se cancelarán sus recordatorios pendientes.`,
                          )
                        ) {
                          const ok = await perform(
                            () =>
                              customFetch(`/api/agenda/appointments/${a.id}`, {
                                method: "DELETE",
                                body: JSON.stringify({ version: a.version }),
                              }),
                            "Cita eliminada.",
                          );
                          if (ok && editing?.id === a.id) {
                            setEditing(null);
                            setForm(blank());
                          }
                        }
                      }}
                    >
                      Eliminar
                    </button>
                  </div>
                </article>
              ))
            )}
            <p className="agenda-note">
              Abrir WhatsApp prepara el mensaje; el envío y su confirmación se
              realizan en WhatsApp.
            </p>
          </section>
        </div>
      </div>
    </main>
  );
}
