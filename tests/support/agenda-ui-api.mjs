export const calls = [];
let appointments = [];
let template = "Hola {cliente}, cita el {fecha} a las {hora}: {servicio}";
export async function customFetch(path, options = {}) {
  calls.push({ path, ...options });
  if (path === "/api/agenda")
    return {
      appointments: [...appointments],
      template,
      whatsapp: { enabled: false, configured: false },
    };
  if (path === "/api/agenda/settings") {
    template = JSON.parse(options.body).template;
    return { template };
  }
  const data = options.body ? JSON.parse(options.body) : {};
  if (options.method === "POST") {
    const row = {
      id: "test-1",
      name: data.name,
      phone: "+528112345678",
      service: data.service,
      starts_at: data.date + "T15:00:00.000Z",
      time_zone: data.timeZone,
      status: data.status,
      opt_in: data.optIn,
      version: 1,
      reminders: [],
    };
    appointments.push(row);
    return row;
  }
  if (options.method === "DELETE") {
    appointments = [];
    return { ok: true };
  }
  return {};
}
