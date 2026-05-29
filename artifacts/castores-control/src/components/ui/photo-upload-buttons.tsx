import { useRef, useState } from "react";

/**
 * Botones explícitos para subir fotos: 📷 Cámara (tomar foto en el momento)
 * y 🖼️ Galería (elegir del rollo).
 *
 * Comportamiento de QA agregado:
 *   - `currentCount` + `maxCount` → muestra "3 de 10 · ~750 KB" arriba
 *     y bloquea ambos botones cuando llegas al tope (con mensaje claro
 *     en lugar de truncar silenciosamente).
 *   - `onLimitExceeded(intentaron)` → callback opcional para que el caller
 *     dispare un toast cuando el usuario intentó subir más de los que
 *     caben.
 *   - `busyLabel` → texto visible (p.ej. "Comprimiendo 3/5...") mientras
 *     el caller procesa los archivos. Mientras está activo deshabilita
 *     los botones para evitar doble selección.
 *   - `currentSizeKB` → si el caller lo pasa, mostramos el peso estimado
 *     para que el usuario vea cuánto va.
 *
 * En iOS Safari el `<input>` regular ya ofrece ambas opciones, pero las
 * separamos en dos CTAs porque los workers en obra suelen no entender el
 * selector unificado.
 */
export function PhotoUploadButtons({
  onFilesSelected,
  multiple = true,
  disabled = false,
  variant = "default",
  helperText,
  currentCount,
  maxCount,
  currentSizeKB,
  busyLabel,
  onLimitExceeded,
}: {
  onFilesSelected: (files: File[]) => void;
  multiple?: boolean;
  disabled?: boolean;
  variant?: "default" | "compact";
  helperText?: string;
  currentCount?: number;
  maxCount?: number;
  currentSizeKB?: number;
  busyLabel?: string;
  onLimitExceeded?: (attempted: number, allowed: number) => void;
}) {
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const [internalBusy, setInternalBusy] = useState(false);

  const atLimit =
    typeof currentCount === "number" && typeof maxCount === "number" && currentCount >= maxCount;
  const busy = !!busyLabel || internalBusy;
  const isDisabled = disabled || atLimit || busy;

  const pickCamera = () => cameraRef.current?.click();
  const pickGallery = () => galleryRef.current?.click();

  const handleChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length === 0) return;

    let toUse = files;
    if (typeof currentCount === "number" && typeof maxCount === "number") {
      const room = Math.max(0, maxCount - currentCount);
      if (files.length > room) {
        onLimitExceeded?.(files.length, room);
        toUse = files.slice(0, room);
        if (toUse.length === 0) return;
      }
    }

    setInternalBusy(true);
    try {
      await onFilesSelected(toUse);
    } finally {
      setInternalBusy(false);
    }
  };

  const baseBtn =
    variant === "compact"
      ? "flex-1 px-3 py-2 rounded-lg border-2 border-dashed text-xs font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
      : "flex-1 px-4 py-4 rounded-xl border-2 border-dashed text-sm font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed";

  return (
    <div className="space-y-2">
      {(typeof currentCount === "number" && typeof maxCount === "number") && (
        <div className="flex items-center justify-between text-[11px] text-muted-foreground">
          <span className="font-semibold">
            {currentCount} de {maxCount} fotos
            {typeof currentSizeKB === "number" && currentSizeKB > 0 && (
              <span className="ml-1 font-normal">· ~{currentSizeKB.toLocaleString("es-MX")} KB</span>
            )}
          </span>
          {atLimit && (
            <span className="text-[#FF3C00] font-semibold">Límite alcanzado</span>
          )}
        </div>
      )}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={pickCamera}
          disabled={isDisabled}
          className={`${baseBtn} border-[#FF3C00]/30 hover:bg-[#FF3C00]/[0.06]`}
        >
          📷 Cámara
        </button>
        <button
          type="button"
          onClick={pickGallery}
          disabled={isDisabled}
          className={`${baseBtn} border-blue-300/60 hover:bg-blue-50`}
        >
          🖼️ Galería
        </button>
      </div>

      {busy && (
        <p className="text-[11px] text-[#FF3C00] text-center font-semibold animate-pulse">
          {busyLabel || "Procesando..."}
        </p>
      )}

      {!busy && atLimit && (
        <p className="text-[11px] text-[#FF3C00] text-center">
          Quita una foto para poder agregar otra.
        </p>
      )}

      {!busy && !atLimit && helperText && (
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
