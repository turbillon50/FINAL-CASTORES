/**
 * Comprime una imagen client-side antes de mandarla al server.
 *
 * FIX iOS Safari (2026-06): loadImage ahora usa createObjectURL en vez de
 * asignar el data URL directamente a img.src. En iOS, los data URLs de
 * imágenes grandes (>2MB) disparan onerror antes de cargar — el blob URL
 * no tiene ese límite y funciona de forma confiable en Safari/PWA.
 */
export async function compressImageFile(
  file: File,
  opts?: { maxDim?: number; quality?: number },
): Promise<string> {
  const maxDim = opts?.maxDim ?? 1920;
  const quality = opts?.quality ?? 0.78;

  if (!file.type.startsWith("image/")) return await readAsDataUrl(file);
  if (file.type === "image/svg+xml") return await readAsDataUrl(file);

  try {
    // iOS fix: usar blob URL para cargar la imagen, evita el límite de
    // ~2MB que tiene Safari al asignar data URLs a img.src directamente.
    const img = await loadImageFromFile(file);
    const ratio = Math.min(1, maxDim / Math.max(img.width, img.height));
    const w = Math.round(img.width * ratio);
    const h = Math.round(img.height * ratio);

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return await readAsDataUrl(file);
    ctx.drawImage(img, 0, 0, w, h);

    return new Promise<string>((resolve) => {
      canvas.toBlob(
        async (blob) => {
          if (!blob) { resolve(await readAsDataUrl(file)); return; }
          // Si la compresión no ayudó (imagen ya muy comprimida), devolver original
          if (blob.size >= file.size) { resolve(await readAsDataUrl(file)); return; }
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = async () => resolve(await readAsDataUrl(file));
          reader.readAsDataURL(blob);
        },
        "image/jpeg",
        quality,
      );
    });
  } catch {
    // Fallback: si falla la compresión, mandar la imagen sin comprimir
    return await readAsDataUrl(file);
  }
}

/** Mide el tamaño aproximado en bytes de un data URL (base64 → bytes). */
export function dataUrlSizeKB(dataUrl: string): number {
  const i = dataUrl.indexOf(",");
  const b64 = i >= 0 ? dataUrl.slice(i + 1) : dataUrl;
  return Math.round((b64.length * 3) / 4 / 1024);
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error ?? new Error("FileReader failed"));
    r.readAsDataURL(file);
  });
}

/**
 * Carga una imagen desde un File usando createObjectURL.
 * Compatible con iOS Safari — evita el límite de ~2MB de img.src con data URL.
 */
function loadImageFromFile(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("No se pudo cargar la imagen"));
    };
    img.src = url;
  });
}
