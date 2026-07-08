/**
 * Blindaje de precios para el rol "client".
 *
 * La feature "vista de cliente sin precios" solo redactaba en el endpoint de
 * reportes, pero un cliente con sesión válida seguía viendo montos por otras
 * puertas (GET /materials, /projects, /dashboard...). La redacción SIEMPRE se
 * hace del lado servidor: no basta con esconder columnas en la UI, el JSON
 * tampoco debe llevar los montos.
 *
 * Solo aplica al rol "client". admin/supervisor/proveedor/worker siguen viendo
 * todo igual que hoy.
 */

/** True únicamente para el rol cliente. */
export function isClientRole(role: string | null | undefined): boolean {
  return role === "client";
}

/**
 * Claves monetarias que un cliente NUNCA debe ver. Se nulean recursivamente en
 * cualquier objeto/array de la respuesta para no dejar huecos si un endpoint
 * agrega un campo de dinero nuevo con uno de estos nombres.
 */
const MONEY_KEYS: ReadonlySet<string> = new Set([
  // Proyecto / presupuesto
  "budget",
  "spentAmount",
  "budgetUsedPercent",
  "totalBudget",
  "totalSpent",
  // Materiales / notas
  "costPerUnit",
  "totalCost",
  "totalAmount",
  "unitPrice",
  "price",
  "amount",
  // Agregados de dashboard / reportes
  "materialCost",
  "approvedMaterialCost",
  "pendingMaterialCost",
  "totalMaterialCost",
  "cost",
]);

function deepRedact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(deepRedact);
  // Los Date (timestamps) se conservan tal cual; no son objetos "planos".
  if (value !== null && typeof value === "object" && !(value instanceof Date)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = MONEY_KEYS.has(k) ? null : deepRedact(v);
    }
    return out;
  }
  return value;
}

/**
 * Devuelve `payload` intacto salvo que `role === "client"`, en cuyo caso nulea
 * recursivamente todo campo monetario conocido. Para cualquier otro rol es un
 * no-op (retorna la misma referencia).
 */
export function redactForClient<T>(payload: T, role: string | null | undefined): T {
  if (!isClientRole(role)) return payload;
  return deepRedact(payload) as T;
}
