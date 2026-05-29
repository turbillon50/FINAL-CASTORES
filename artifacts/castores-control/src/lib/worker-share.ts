import { jsPDF } from "jspdf";
import QRCode from "qrcode";

// Helpers para distribuir credenciales de worker (alta o reset). Todo se
// arma en cliente porque la URL pública depende del origen donde está
// abierto el navegador del admin (dev/preview/prod) — el backend no la sabe.

export type WorkerCredentials = {
  name: string;
  workerCode: string;
  pin: string;
  phone?: string | null;
};

/**
 * Deeplink que autocompleta el form de login con código + PIN al abrirlo.
 * /check/login lee `?code=` y `?pin=` desde el query.
 */
export function buildShareLink(c: WorkerCredentials): string {
  const params = new URLSearchParams({ code: c.workerCode, pin: c.pin });
  return `${window.location.origin}/check/login?${params.toString()}`;
}

const WHATSAPP_MESSAGE = (c: WorkerCredentials, link: string): string =>
  `Hola ${c.name}, te dieron de alta en Castores 👷

Tu código: ${c.workerCode}
Tu PIN inicial: ${c.pin}

Entra aquí (el código y PIN se autollenan):
${link}

⚠ Tu PIN te pedirá cambiarlo la primera vez que entres.`;

/**
 * URL `wa.me` que abre WhatsApp con el mensaje y, si conocemos el teléfono,
 * con el contacto pre-seleccionado. wa.me/<phone>?text=... funciona desde
 * web, iOS y Android sin app instalada (redirige a la web de WhatsApp).
 * El teléfono debe ir solo con dígitos (sin +, espacios o guiones).
 */
export function buildWhatsAppLink(c: WorkerCredentials, link: string): string {
  const text = encodeURIComponent(WHATSAPP_MESSAGE(c, link));
  const phone = (c.phone ?? "").replace(/\D/g, "");
  return phone
    ? `https://wa.me/${phone}?text=${text}`
    : `https://wa.me/?text=${text}`;
}

/**
 * Tarjeta PDF tamaño "credencial horizontal" (85.6 × 54 mm — formato
 * tarjeta bancaria). Lleva nombre, código, PIN, QR del deeplink y aviso
 * de cambio obligatorio. El admin imprime y entrega en persona.
 */
export async function downloadCredentialPdf(c: WorkerCredentials): Promise<void> {
  const link = buildShareLink(c);
  const qrDataUrl = await QRCode.toDataURL(link, {
    width: 240, margin: 1, errorCorrectionLevel: "M",
    color: { dark: "#141414", light: "#ffffff" },
  });

  // Hoja carta vertical pero con la tarjeta como bloque grande (más
  // legible que tarjeta tamaño físico — los trabajadores suelen guardar
  // hojas dobladas en bolsillos, no carnets).
  const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "letter" });
  const W = 215.9; // letter width mm
  const margin = 18;
  const cardX = margin;
  const cardY = 25;
  const cardW = W - 2 * margin;
  const cardH = 110;

  // Marco
  pdf.setDrawColor(26, 22, 18);
  pdf.setLineWidth(0.6);
  pdf.roundedRect(cardX, cardY, cardW, cardH, 4, 4, "S");

  // Banda superior con título
  pdf.setFillColor(26, 22, 18);
  pdf.roundedRect(cardX, cardY, cardW, 14, 4, 4, "F");
  pdf.setFillColor(26, 22, 18);
  pdf.rect(cardX, cardY + 8, cardW, 6, "F"); // tapa esquinas para que solo arriba sea redondo
  pdf.setTextColor(200, 149, 42);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(10);
  pdf.text("CREDENCIAL DE TRABAJADOR — CASTORES", cardX + 5, cardY + 9);

  // Nombre
  pdf.setTextColor(26, 22, 18);
  pdf.setFontSize(18);
  pdf.text(c.name, cardX + 6, cardY + 28);

  // Código
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(8);
  pdf.setTextColor(100, 100, 100);
  pdf.text("CÓDIGO DE TRABAJADOR", cardX + 6, cardY + 42);
  pdf.setFont("courier", "bold");
  pdf.setFontSize(26);
  pdf.setTextColor(26, 22, 18);
  pdf.text(c.workerCode, cardX + 6, cardY + 56);

  // PIN
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(8);
  pdf.setTextColor(100, 100, 100);
  pdf.text("PIN INICIAL", cardX + 6, cardY + 70);
  pdf.setFont("courier", "bold");
  pdf.setFontSize(32);
  pdf.setTextColor(200, 149, 42);
  pdf.text(c.pin.split("").join(" "), cardX + 6, cardY + 86);

  // QR a la derecha
  const qrSize = 50;
  pdf.addImage(qrDataUrl, "PNG", cardX + cardW - qrSize - 6, cardY + 22, qrSize, qrSize);
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(7);
  pdf.setTextColor(100, 100, 100);
  pdf.text("Escanea para entrar", cardX + cardW - qrSize - 6, cardY + qrSize + 27, { maxWidth: qrSize });

  // Aviso al pie de la tarjeta
  pdf.setFillColor(245, 245, 245); // gris concreto
  pdf.rect(cardX, cardY + cardH - 14, cardW, 14, "F");
  pdf.setTextColor(20, 20, 20); // negro neutro
  pdf.setFontSize(8);
  pdf.setFont("helvetica", "bold");
  pdf.text(
    "⚠ Cambia tu PIN la primera vez que entres. Este PIN es de un solo uso.",
    cardX + 5,
    cardY + cardH - 5,
  );

  // Instrucciones debajo
  pdf.setFont("helvetica", "normal");
  pdf.setTextColor(80, 80, 80);
  pdf.setFontSize(10);
  const instrY = cardY + cardH + 20;
  pdf.text("Cómo entrar desde tu celular:", margin, instrY);
  pdf.setFontSize(9);
  pdf.text(
    [
      "1. Abre la cámara y escanea el código QR de la tarjeta, o entra a la dirección que aparece abajo.",
      "2. El código y el PIN se llenan solos.",
      "3. Toca \"Entrar\".",
      "4. Te pedirá un PIN nuevo que solo tú sepas. Cámbialo y listo.",
    ],
    margin,
    instrY + 7,
    { lineHeightFactor: 1.4 },
  );

  pdf.setFont("courier", "normal");
  pdf.setFontSize(8);
  pdf.setTextColor(120, 120, 120);
  pdf.text(link, margin, instrY + 40, { maxWidth: W - 2 * margin });

  const filename = `castores_${c.workerCode}.pdf`;
  pdf.save(filename);
}

/** Copia el deeplink al portapapeles. Devuelve true si pudo. */
export async function copyShareLink(c: WorkerCredentials): Promise<boolean> {
  const link = buildShareLink(c);
  try {
    await navigator.clipboard.writeText(link);
    return true;
  } catch {
    return false;
  }
}
