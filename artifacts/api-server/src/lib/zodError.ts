/**
 * Convierte un error de Zod en un mensaje legible en español para el usuario final.
 * Evita exponer la estructura cruda del error (que incluye paths internos y JSON).
 */
export function formatZodError(err: unknown): string {
  try {
    const issues = ((err as { issues?: Array<{ path?: Array<string | number> }> })?.issues ?? []).map(
      (issue) => ({
        path: Array.isArray(issue.path) ? issue.path : [],
      }),
    );
    if (issues.length === 0) return "Datos inválidos. Revisa los campos enviados.";

    const fields = Array.from(
      new Set(
        issues
          .map((i) => (Array.isArray(i.path) && i.path.length > 0 ? String(i.path[i.path.length - 1]) : ""))
          .filter(Boolean),
      ),
    );

    if (fields.length === 0) {
      return "Datos inválidos. Revisa los campos enviados.";
    }
    if (fields.length === 1) {
      return `Dato inválido en el campo: ${fields[0]}`;
    }
    return `Datos inválidos en: ${fields.join(", ")}`;
  } catch {
    return "Datos inválidos. Revisa los campos enviados.";
  }
}
