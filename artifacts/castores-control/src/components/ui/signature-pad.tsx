import { useRef, useEffect, useState } from "react";
import { Button } from "./button";

interface SignaturePadProps {
  onSave: (signatureDataUrl: string) => void;
  onClear?: () => void;
  readOnly?: boolean;
  initialDataUrl?: string;
  className?: string;
}

export function SignaturePad({ onSave, onClear, readOnly = false, initialDataUrl, className = "" }: SignaturePadProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasSignature, setHasSignature] = useState(!!initialDataUrl);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Set up canvas style
    ctx.strokeStyle = "hsl(var(--primary))"; // Amber brand color
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    // Load initial data if provided
    if (initialDataUrl) {
      const img = new Image();
      img.onload = () => {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0);
      };
      img.src = initialDataUrl;
    }
  }, [initialDataUrl]);

  const startDrawing = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    if (readOnly) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    let clientX, clientY;

    if ('touches' in e) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else {
      clientX = e.clientX;
      clientY = e.clientY;
    }

    ctx.beginPath();
    ctx.moveTo(clientX - rect.left, clientY - rect.top);
    setIsDrawing(true);
  };

  const draw = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    if (!isDrawing || readOnly) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    let clientX, clientY;

    if ('touches' in e) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else {
      clientX = e.clientX;
      clientY = e.clientY;
    }

    ctx.lineTo(clientX - rect.left, clientY - rect.top);
    ctx.stroke();
    setHasSignature(true);
  };

  const stopDrawing = () => {
    if (readOnly) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.closePath();
    setIsDrawing(false);
  };

  const handleClear = () => {
    if (readOnly) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasSignature(false);
    if (onClear) onClear();
  };

  const handleSave = () => {
    if (readOnly || !hasSignature) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const dataUrl = canvas.toDataURL("image/png");
    onSave(dataUrl);
  };

  return (
    <div className={`flex flex-col gap-4 ${className}`}>
      <div className="relative rounded-xl border border-card-border overflow-hidden bg-sidebar/50 isolate">
        {!hasSignature && !readOnly && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-[-1]">
            <span className="text-muted-foreground/30 font-display text-2xl tracking-widest uppercase">Sign Here</span>
          </div>
        )}
        <canvas
          ref={canvasRef}
          width={400}
          height={200}
          className="w-full h-48 touch-none cursor-crosshair"
          onMouseDown={startDrawing}
          onMouseMove={draw}
          onMouseUp={stopDrawing}
          onMouseOut={stopDrawing}
          onTouchStart={startDrawing}
          onTouchMove={draw}
          onTouchEnd={stopDrawing}
        />
      </div>
      {!readOnly && (
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={handleClear} disabled={!hasSignature}>
            Clear
          </Button>
          <Button type="button" onClick={handleSave} disabled={!hasSignature} className="bg-primary text-primary-foreground hover:bg-primary/90">
            Save Signature
          </Button>
        </div>
      )}
    </div>
  );
}
