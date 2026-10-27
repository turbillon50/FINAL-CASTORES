export const SCAN_SYSTEM_PROMPT = `Eres un asistente experto en leer notas, recibos, facturas y remisiones de proveedores de construcción mexicanos. La imagen puede ser:
- Una foto directa de una nota física (papel)
- Un screenshot de una imagen que el proveedor mandó por WhatsApp / correo
- Una factura PDF capturada como imagen
- Notas impresas o escritas a mano, con tachones, sellos o firmas

Tu trabajo es EXTRAER de forma intuitiva los conceptos comprados, aunque la imagen esté arrugada, mal iluminada, o tenga formato libre. Usa contexto: si dice "5 ton de cemento gris 50kg" eso es 5 toneladas (unidad=ton, qty=5, name="Cemento gris 50kg").

Devuelve EXCLUSIVAMENTE un objeto JSON con esta forma exacta:
{
  "supplierName": string | null,    // nombre del proveedor en mayúsculas si lo ves
  "folio": string | null,           // número de folio / nota / remisión / factura
  "noteDate": string | null,        // ISO YYYY-MM-DD si puedes inferir; "2024-05-12" no "12/5/24"
  "items": [
    {
      "name": string,               // descripción del concepto. p. ej. "Acero 5/8 grado 60", "Cemento gris 50kg", "Varilla corrugada 3/8"
      "unit": string,                // "kg", "ton", "saco", "pza", "m³", "m", "varilla", "lt", "caja", "rollo"
      "quantityRequested": number | null,   // cantidad numérica (no string)
      "costPerUnit": number | null   // precio unitario en MXN sin signo de pesos
    }
  ],
  "confidence": number               // 0..1 — qué tan seguro estás del extract completo
}


Reglas inteligentes:
- Si solo ves el TOTAL del renglón y la cantidad, divide para sacar el unitario.
- Nunca uses el total general como precio unitario: puede incluir IVA, descuentos o flete.
- Extrae TODOS los renglones, incluso notas de 30 o 40 conceptos. Conserva su orden. No agrupes conceptos repetidos.
- No inventes cantidades ni unidades: usa null para cantidad ilegible y "" para unidad ilegible.
- Conserva galones como "gal" y litros como "lt". Nunca cambies la unidad sin convertir también cantidad y precio; en este escaneo NO hagas conversiones.
- Unidades en español, minúsculas: "kgs"→"kg", "Tons"→"ton", "SACOS"→"saco", "PZAS"→"pza".
- Si no ves precio (solo conceptos y cantidades), pon costPerUnit: null. NO inventes.
- Si la imagen es ilegible / no es una nota / no se distingue nada útil, devuelve items: [] y confidence: 0.
- Importante: SOLO el JSON, sin markdown fences, sin texto antes o después.`;

export type ScanResponse = {
  supplierName: string | null;
  folio: string | null;
  noteDate: string | null;
  items: Array<{
    name: string;
    unit: string;
    quantityRequested: number | null;
    costPerUnit: number | null;
  }>;
  warnings: string[];
  confidence: number;
};

// Mapea lo que devuelve el modelo ("pieza", "PZAS", "galón", "kilos"…) a las
// unidades que acepta el formulario (UNITS en material-notes-view.tsx). Lo
// que no reconoce se deja en minúsculas tal cual para que el usuario lo corrija.
const UNIT_ALIASES: Record<string, string> = {
  pieza: "pza",
  piezas: "pza",
  pzas: "pza",
  pz: "pza",
  pc: "pza",
  pcs: "pza",
  unidad: "pza",
  unidades: "pza",
  u: "pza",
  kilo: "kg",
  kilos: "kg",
  kgs: "kg",
  kilogramo: "kg",
  kilogramos: "kg",
  tonelada: "ton",
  toneladas: "ton",
  tons: "ton",
  t: "ton",
  metro: "m",
  metros: "m",
  mts: "m",
  "metro lineal": "m",
  "metros lineales": "m",
  m2: "m²",
  mt2: "m²",
  "metro cuadrado": "m²",
  "metros cuadrados": "m²",
  m3: "m³",
  mt3: "m³",
  "metro cubico": "m³",
  "metro cúbico": "m³",
  "metros cubicos": "m³",
  "metros cúbicos": "m³",
  litro: "lt",
  litros: "lt",
  l: "lt",
  lts: "lt",
  galon: "gal",
  galón: "gal",
  galones: "gal",
  gal: "gal",
  sacos: "saco",
  bulto: "saco",
  bultos: "saco",
  costal: "saco",
  costales: "saco",
  rollos: "rollo",
  cajas: "caja",
  juegos: "juego",
  kit: "juego",
  varillas: "varilla",
  servicio: "serv",
  servicios: "serv",
  notas: "nota",
  tramos: "tramo",
};
export function normalizeUnit(raw: string): string {
  const u = raw.trim().toLowerCase().replace(/\.$/, "");
  return UNIT_ALIASES[u] ?? u;
}

export function parseScanJson(raw: string): ScanResponse | null {
  // Algunos modelos siguen agregando ```json wrappers o texto antes/después.
  // Buscamos el primer { y el último } para extraer el JSON crudo.
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  const slice = raw.slice(start, end + 1);
  try {
    const parsed = JSON.parse(slice) as Partial<ScanResponse>;
    if (!Array.isArray(parsed.items)) return null;

    // Keep every recognized row visible. Missing fields require human review;
    // silently filtering them would understate quantities and cost.
    if (
      parsed.items.some(
        (it) => !it || typeof it !== "object" || Array.isArray(it),
      )
    )
      return null;
    const warnings: string[] = [];
    const validItems = parsed.items.map((it, index) => {
      const name = typeof it.name === "string" ? it.name.trim() : "";
      const unit = typeof it.unit === "string" ? normalizeUnit(it.unit) : "";
      const quantityRequested =
        typeof it.quantityRequested === "number" &&
        Number.isFinite(it.quantityRequested) &&
        it.quantityRequested > 0
          ? it.quantityRequested
          : null;
      const costPerUnit =
        typeof it.costPerUnit === "number" &&
        Number.isFinite(it.costPerUnit) &&
        it.costPerUnit >= 0
          ? it.costPerUnit
          : null;
      if (
        !name ||
        !unit ||
        quantityRequested === null ||
        costPerUnit === null
      ) {
        warnings.push(
          `Renglón ${index + 1}: completa y verifica los datos que no se pudieron leer.`,
        );
      }
      return { name, unit, quantityRequested, costPerUnit };
    });

    return {
      supplierName:
        typeof parsed.supplierName === "string" && parsed.supplierName.trim()
          ? parsed.supplierName.trim()
          : null,
      folio:
        typeof parsed.folio === "string" && parsed.folio.trim()
          ? parsed.folio.trim()
          : null,
      noteDate:
        typeof parsed.noteDate === "string" &&
        /^\d{4}-\d{2}-\d{2}$/.test(parsed.noteDate)
          ? parsed.noteDate
          : null,
      items: validItems,
      warnings,
      confidence:
        typeof parsed.confidence === "number" &&
        Number.isFinite(parsed.confidence)
          ? Math.max(0, Math.min(1, parsed.confidence))
          : 0,
    };
  } catch {
    return null;
  }
}

export function scanErrorMessage(status: number, code: string): string {
  if (code === "MAX_TOKENS")
    return "La lectura quedó incompleta. Fotografía la nota por secciones para conservar todos sus renglones.";
  if (
    status === 401 ||
    status === 403 ||
    /API_KEY|CREDENTIAL|ACCOUNT/.test(code)
  )
    return "El servicio de lectura necesita que el administrador revise su acceso. Puedes continuar con la captura manual.";
  if (status === 429)
    return "El servicio de lectura alcanzó su límite de uso. Inténtalo más tarde; si persiste, avisa al administrador.";
  if (status === 404)
    return "El modelo de lectura no está disponible. Avísale al administrador.";
  if (status === 400)
    return "No se pudo procesar esta imagen. Usa una foto JPG, PNG o WebP nítida.";
  return "El servicio de lectura no está disponible por el momento. Conservamos la foto para que puedas capturar los conceptos.";
}

type GeminiResult =
  | { ok: true; text: string; model: string }
  | { ok: false; status: number; code: string; model: string };

export async function scanWithGemini(
  key: string,
  imageDataUrl: string,
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<GeminiResult> {
  const model = process.env["GEMINI_VISION_MODEL"] || "gemini-2.5-flash";
  const match =
    /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(
      imageDataUrl,
    );
  if (!match) return { ok: false, status: 400, code: "IMAGE_INVALID", model };
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await fetcher(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: "POST",
        signal,
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [
                { text: SCAN_SYSTEM_PROMPT },
                { inlineData: { mimeType: match[1], data: match[2] } },
              ],
            },
          ],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 16384,
            responseMimeType: "application/json",
            ...(model.startsWith("gemini-2.5")
              ? { thinkingConfig: { thinkingBudget: 0 } }
              : {}),
          },
        }),
      },
    );
    // Retry only explicit transient server failures. Authentication and quota
    // errors require configuration changes, not more billable attempts.
    if ([500, 502, 503].includes(response.status) && attempt === 0) {
      await response.body?.cancel();
      signal.throwIfAborted();
      continue;
    }
    if (!response.ok) {
      const error = (await response.json().catch(() => ({}))) as {
        error?: { status?: string; details?: Array<{ reason?: string }> };
      };
      const code =
        error.error?.details?.find((d) => d.reason)?.reason ||
        error.error?.status ||
        "UPSTREAM_ERROR";
      return { ok: false, status: response.status, code, model };
    }
    const body = (await response.json()) as {
      candidates?: Array<{
        finishReason?: string;
        content?: { parts?: Array<{ text?: string; thought?: boolean }> };
      }>;
    };
    const candidate = body.candidates?.[0];
    if (!candidate || candidate.finishReason !== "STOP")
      return {
        ok: false,
        status: 502,
        code: candidate?.finishReason || "EMPTY_RESPONSE",
        model,
      };
    return {
      ok: true,
      model,
      text: (candidate.content?.parts || [])
        .filter((p) => !p.thought)
        .map((p) => p.text || "")
        .join(""),
    };
  }
  return { ok: false, status: 503, code: "UNAVAILABLE", model };
}
