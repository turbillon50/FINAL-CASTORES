import { Resend } from "resend";

const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;

const FROM_EMAIL = "Castores Control <no-reply@castores.info>";
const APP_URL = "https://castores.info";

const ROLE_LABELS: Record<string, string> = {
  admin: "Administrador",
  supervisor: "Supervisor",
  client: "Cliente",
  worker: "Trabajador",
  proveedor: "Proveedor",
};

function baseTemplate(content: string) {
  return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f0ebe3;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 20px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
        <!-- Header -->
        <tr><td style="background:linear-gradient(135deg,#1a1612 0%,#2d2318 100%);padding:32px 40px;text-align:left;">
          <div style="display:inline-flex;align-items:center;gap:12px;">
            <div style="width:36px;height:36px;background:#C8952A;border-radius:8px;display:flex;align-items:center;justify-content:center;">
              <span style="color:#fff;font-weight:900;font-size:16px;">C</span>
            </div>
            <div>
              <div style="color:#C8952A;font-weight:900;font-size:15px;letter-spacing:0.15em;">CASTORES</div>
              <div style="color:rgba(255,255,255,0.45);font-size:10px;letter-spacing:0.2em;">ESTRUCTURAS Y CONSTRUCCIONES</div>
            </div>
          </div>
        </td></tr>
        <!-- Content -->
        <tr><td style="padding:40px;">
          ${content}
        </td></tr>
        <!-- Footer -->
        <tr><td style="background:#f8f4ef;padding:24px 40px;border-top:1px solid rgba(0,0,0,0.06);">
          <p style="margin:0;color:#aaa;font-size:11px;text-align:center;">
            © ${new Date().getFullYear()} CASTORES Estructuras y Construcciones &nbsp;·&nbsp;
            <a href="${APP_URL}" style="color:#C8952A;text-decoration:none;">castores.info</a>
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function btn(href: string, text: string) {
  return `<a href="${href}" style="display:inline-block;margin-top:28px;padding:14px 28px;background:#C8952A;color:#fff;border-radius:10px;text-decoration:none;font-weight:700;font-size:14px;letter-spacing:0.02em;">${text}</a>`;
}

function infoRow(label: string, value: string) {
  return `<tr>
    <td style="padding:10px 0;color:#999;font-size:13px;width:140px;vertical-align:top;">${label}</td>
    <td style="padding:10px 0;font-weight:600;color:#1a1612;font-size:13px;">${value}</td>
  </tr>`;
}

function sendEmail(to: string, subject: string, html: string) {
  if (!resend) {
    console.warn("[email] RESEND_API_KEY no configurado — omitiendo envío:", subject, "→", to);
    return Promise.resolve(null);
  }
  return resend.emails.send({ from: FROM_EMAIL, to, subject, html });
}

/* ─── Nueva solicitud de acceso → Admin ─── */
export async function sendNewRegistrationEmail(opts: {
  adminEmail: string;
  userName: string;
  userEmail: string;
  role: string;
  company?: string | null;
  userId: number;
}) {
  const roleLabel = ROLE_LABELS[opts.role] ?? opts.role;
  const html = baseTemplate(`
    <h2 style="margin:0 0 8px;color:#1a1612;font-size:22px;font-weight:800;">Nueva solicitud de acceso</h2>
    <p style="margin:0 0 28px;color:#777;font-size:14px;line-height:1.6;">
      Un nuevo usuario ha completado su registro y está esperando aprobación.
    </p>
    <table style="width:100%;border-collapse:collapse;background:#f8f4ef;border-radius:10px;padding:4px 16px;" cellpadding="0" cellspacing="0">
      <tr><td style="padding:16px;"><table style="width:100%;border-collapse:collapse;">
        ${infoRow("Nombre", opts.userName)}
        ${infoRow("Correo", opts.userEmail)}
        ${infoRow("Rol solicitado", roleLabel)}
        ${opts.company ? infoRow("Empresa", opts.company) : ""}
      </table></td></tr>
    </table>
    <div style="display:flex;gap:12px;margin-top:28px;">
      ${btn(`${APP_URL}/usuarios`, "Revisar solicitud →")}
    </div>
    <p style="margin:20px 0 0;color:#bbb;font-size:12px;">
      Ingresa al panel de administración para aprobar o rechazar esta solicitud.
    </p>
  `);

  return sendEmail(
    opts.adminEmail,
    `Nueva solicitud de acceso: ${opts.userName} (${roleLabel})`,
    html,
  );
}

/* ─── Acceso aprobado → Usuario ─── */
export async function sendApprovalEmail(opts: {
  to: string;
  name: string;
  role: string;
}) {
  const roleLabel = ROLE_LABELS[opts.role] ?? opts.role;
  const html = baseTemplate(`
    <h2 style="margin:0 0 8px;color:#10B981;font-size:22px;font-weight:800;">✓ Acceso aprobado</h2>
    <p style="margin:0 0 16px;color:#1a1612;font-size:15px;line-height:1.6;">
      Hola <strong>${opts.name}</strong>, tu solicitud de acceso a Castores Control ha sido aprobada.
    </p>
    <p style="margin:0 0 28px;color:#777;font-size:14px;line-height:1.6;">
      Ya puedes iniciar sesión con tu cuenta y acceder al sistema con el rol de <strong>${roleLabel}</strong>.
    </p>
    ${btn(`${APP_URL}`, "Ingresar al sistema →")}
    <p style="margin:24px 0 0;color:#bbb;font-size:12px;">
      Si tienes algún problema para acceder, contacta al administrador de tu empresa.
    </p>
  `);

  return sendEmail(
    opts.to,
    "Tu acceso a Castores Control fue aprobado",
    html,
  );
}

/* ─── Solicitud rechazada → Usuario ─── */
export async function sendRejectionEmail(opts: {
  to: string;
  name: string;
}) {
  const html = baseTemplate(`
    <h2 style="margin:0 0 8px;color:#EF4444;font-size:22px;font-weight:800;">Solicitud de acceso</h2>
    <p style="margin:0 0 16px;color:#1a1612;font-size:15px;line-height:1.6;">
      Hola <strong>${opts.name}</strong>, después de revisar tu solicitud de acceso, 
      en este momento no ha podido ser aprobada.
    </p>
    <p style="margin:0 0 28px;color:#777;font-size:14px;line-height:1.6;">
      Si crees que esto es un error o deseas más información, contacta directamente 
      al administrador de CASTORES Estructuras y Construcciones.
    </p>
    <a href="mailto:admin@castores.info" style="display:inline-block;padding:12px 24px;background:#f4f4f4;color:#1a1612;border-radius:10px;text-decoration:none;font-weight:600;font-size:14px;border:1px solid rgba(0,0,0,0.1);">
      Contactar al administrador
    </a>
  `);

  return sendEmail(
    opts.to,
    "Tu solicitud de acceso a Castores Control",
    html,
  );
}

/* ─── Bienvenida (usuario creado desde panel admin) ─── */
export async function sendWelcomeEmail(opts: {
  to: string;
  name: string;
  role: string;
}) {
  const roleLabel = ROLE_LABELS[opts.role] ?? opts.role;
  const html = baseTemplate(`
    <h2 style="margin:0 0 8px;color:#C8952A;font-size:22px;font-weight:800;">Bienvenido a Castores Control</h2>
    <p style="margin:0 0 16px;color:#1a1612;font-size:15px;line-height:1.6;">
      Hola <strong>${opts.name}</strong>, tu cuenta ha sido creada en el sistema 
      de control operacional de CASTORES.
    </p>
    <p style="margin:0 0 28px;color:#777;font-size:14px;line-height:1.6;">
      Accede con el rol de <strong>${roleLabel}</strong> usando el botón de abajo.
    </p>
    ${btn(APP_URL, "Ingresar al sistema →")}
  `);

  return sendEmail(opts.to, "Bienvenido a Castores Control", html);
}

/* ─── Firma de bitácora ─── */
export async function sendLogSignedEmail(opts: {
  to: string;
  projectName: string;
  logDate: string;
  signedBy: string;
  signatureType: "supervisor" | "client";
}) {
  const typeLabel = opts.signatureType === "supervisor" ? "Supervisor" : "Cliente";
  const html = baseTemplate(`
    <h2 style="margin:0 0 8px;color:#1a1612;font-size:22px;font-weight:800;">Entrada de bitácora firmada</h2>
    <p style="margin:0 0 28px;color:#777;font-size:14px;line-height:1.6;">
      La siguiente entrada ha sido firmada digitalmente por el ${typeLabel}.
    </p>
    <table style="width:100%;border-collapse:collapse;background:#f8f4ef;border-radius:10px;padding:4px 16px;" cellpadding="0" cellspacing="0">
      <tr><td style="padding:16px;"><table style="width:100%;border-collapse:collapse;">
        ${infoRow("Proyecto", opts.projectName)}
        ${infoRow("Fecha", opts.logDate)}
        ${infoRow("Firmado por", `${opts.signedBy} (${typeLabel})`)}
      </table></td></tr>
    </table>
    ${btn(`${APP_URL}/bitacora`, "Ver bitácora →")}
  `);

  return sendEmail(
    opts.to,
    `Bitácora firmada — ${opts.projectName} (${opts.logDate})`,
    html,
  );
}

/* ─── Alerta de solicitud de material ─── */
export async function sendMaterialRequestEmail(opts: {
  to: string;
  requesterName: string;
  materialName: string;
  quantity: number;
  unit: string;
  projectName: string;
}) {
  const html = baseTemplate(`
    <h2 style="margin:0 0 8px;color:#1a1612;font-size:22px;font-weight:800;">Solicitud de material pendiente</h2>
    <p style="margin:0 0 28px;color:#777;font-size:14px;line-height:1.6;">
      Una nueva solicitud de material requiere tu autorización.
    </p>
    <table style="width:100%;border-collapse:collapse;background:#f8f4ef;border-radius:10px;padding:4px 16px;" cellpadding="0" cellspacing="0">
      <tr><td style="padding:16px;"><table style="width:100%;border-collapse:collapse;">
        ${infoRow("Material", opts.materialName)}
        ${infoRow("Cantidad", `${opts.quantity} ${opts.unit}`)}
        ${infoRow("Proyecto", opts.projectName)}
        ${infoRow("Solicitante", opts.requesterName)}
      </table></td></tr>
    </table>
    ${btn(`${APP_URL}/materiales`, "Ver solicitud →")}
  `);

  return sendEmail(
    opts.to,
    `Nueva solicitud de material: ${opts.materialName}`,
    html,
  );
}
