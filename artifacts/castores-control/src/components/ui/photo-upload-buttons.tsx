import { useRef } from "react";

/**
 * Botones explícitos para subir fotos: 📷 Cámara (tomar foto en el momento)
 * y 🖼️ Galería (elegir del rollo). En iOS Safari el `<input>` regular ya
 * ofrece ambas opciones, pero las separamos en dos CTAs visibles porque
 * los workers en obra suelen no entender el selector unificado.
 *
 * `accept` se queda en image/* en ambos. La diferencia es `capture`:
 *   - "environment" → abre directo la cámara trasera
 *   - sin atributo → abre el selector de archivos
 *
 * El callback recibe los File[] seleccionados; el caller decide cómo
 * convertirlos (data URL, multipart, etc.).
 */
export function PhotoUploadButtons({
  onFilesSelected,
  multiple = true,
  disabled = false,
  variant = "default",
  helperText,
}: {
  onFilesSelected: (files: File[]) => void;
  multiple?: boolean;
  disabled?: boolean;
  variant?: "default" | "compact";
  helperText?: string;
}) {
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);

  const pickCamera = () => cameraRef.current?.click();
  const pickGallery = () => galleryRef.current?.click();

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    onFilesSelected(files);
    e.target.value = ""; // permite re-seleccionar la misma foto
  };

  const baseBtn =
    variant === "compact"
      ? "flex-1 px-3 py-2 rounded-lg border-2 border-dashed text-xs font-semibold transition-colors"
      : "flex-1 px-4 py-4 rounded-xl border-2 border-dashed text-sm font-semibold transition-colors";

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <button
          type="button"
          onClick={pickCamera}
          disabled={disabled}
          className={`${baseBtn} border-amber-300/60 hover:bg-amber-50 disabled:opacity-50`}
        >
          📷 Cámara
        </button>
        <button
          type="button"
          onClick={pickGallery}
          disabled={disabled}
          className={`${baseBtn} border-blue-300/60 hover:bg-blue-50 disabled:opacity-50`}
        >
          🖼️ Galería
        </button>
      </div>
      {helperText && (
        <p className="text-[11px] text-muted-foreground text-center">{helperText}</p>
      )}
      {/* Inputs invisibles. El móvil decide el flujo según `capture`. */}
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        multiple={multiple}
        className="hidden"
        onChange={handleChange}
      />
      <input
        ref={galleryRef}
        type="file"
        accept="image/*"
        multiple={multiple}
        className="hidden"
        onChange={handleChange}
      />
    </div>
  );
}
