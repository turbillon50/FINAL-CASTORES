/**
 * Comprime una imagen client-side antes de mandarla al server.
 *
 * Por qué: cuando subimos varias fotos de obra (cada una de 3-5 MB del
 * iPhone) directamente como data URL, el body del POST se va a 30+ MB
 * y Vercel rechaza con 413 (límite de 4.5 MB por request). En el server
 * tampoco tenemos un blob storage, así que la imagen vive en la columna
 * de Postgres como texto base64 — comprimirla a 200-400 KB hace toda
 * la diferencia entre "creo la obra" y "Vercel cierra la conexión".
 *
 * Estrategia:
 *   - Cargar el archivo como `<img>`.
 *   - Renderizar a un canvas con un lado máximo de `maxDim` (default
 *     1920px), preservando proporciones.
 *   - Exportar como JPEG con calidad 0.78. Pierde transparencia pero
 *     gana ~10x compresión vs PNG. Aceptable para fotos de obra y
 *     renders; los planos PDF/DWG no pasan por aquí.
 *   - Si el resultado todavía es más grande que el original (caso raro
 *     de imágenes ya muy comprimidas), devolvemos el data URL original.
 */
export async function compressImageFile(
  file: File,
  opts?: { maxDim?: number; quality?: number },
): Promise<string> {
  const maxDim = opts?.maxDim ?? 1920;
  const quality = opts?.quality ?? 0.78;

  // Si NO es imagen, devuelve el data URL crudo. Útil cuando el mismo
  // helper se usa para "documentos" donde el usuario podría subir un PDF.
  if (!file.type.startsWith("image/")) return await readAsDataUrl(file);

  // SVG: mejor enviarlo tal cual; comprimirlo a canvas pierde el vector.
  if (file.type === "image/svg+xml") return await readAsDataUrl(file);

  const original = await readAsDataUrl(file);

  try {
    const img = await loadImage(original);
    const ratio = Math.min(1, maxDim / Math.max(img.width, img.height));
    const w = Math.round(img.width * ratio);
    const h = Math.round(img.height * ratio);

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return original;
    ctx.drawImage(img, 0, 0, w, h);

    const compressed = canvas.toDataURL("image/jpeg", quality);
    return compressed.length < original.length ? compressed : original;
  } catch {
    return original;
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

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Image load failed"));
    img.src = src;
  });
}
