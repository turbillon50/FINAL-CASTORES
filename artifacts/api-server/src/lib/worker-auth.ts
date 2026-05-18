import { createHmac, randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type { Request } from "express";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

// ─── Worker auth (login con código + PIN, sin email) ────────────────────────
//
// Workers operativos no tienen correo. Se identifican con un código
// "CAS-XXXX" + PIN de 4 dígitos. Este módulo:
//   - Genera códigos y hashea PINs (scrypt nativo de Node, sin npm extra).
//   - Firma un token portable (HMAC-SHA256 con SESSION_SECRET) que el
//     frontend guarda en localStorage y manda en el header X-Worker-Token.
//   - Provee `getWorkerFromRequest()` que `getRequestUser` consulta como
//     tercera vía después de Clerk JWT y session cookie.
//
// El token NO usa JWT estándar para evitar agregar dependencias; el formato
// es `<base64url(payload)>.<base64url(hmac)>`, similar al token de reset
// password que ya vive en auth.ts. Ambos usan el mismo secreto.

const scrypt = promisify(scryptCb);

const WORKER_TOKEN_HEADER = "x-worker-token";
const WORKER_TOKEN_TTL_DAYS = 30;

// Códigos visibles para humanos: "CAS-XXXX" con 4 dígitos. 10_000 combinaciones
// es más que suficiente para una empresa con cientos de trabajadores (la
// colisión se detecta por la UNIQUE constraint en users.worker_code y el
// caller reintenta). Si alguna vez excediéramos el espacio, basta cambiar
// el rango aquí y la unicidad sigue garantizada por la DB.
export function generateWorkerCode(): string {
  const n = Math.floor(Math.random() * 9000) + 1000; // 1000-9999
  return `CAS-${n}`;
}

export function isValidPinFormat(pin: string): boolean {
  return /^\d{4}$/.test(pin);
}

// scrypt: cost N=16384 (default), output 64 bytes. El formato persistido es
// `scrypt$<salt_hex>$<hash_hex>` para que el verifyPin pueda parsearlo sin
// guardar los parámetros aparte. Migrar a otro algoritmo en el futuro solo
// requiere agregar otra rama en verifyPin.
export async function hashPin(pin: string): Promise<string> {
  if (!isValidPinFormat(pin)) {
    throw new Error("PIN debe ser exactamente 4 dígitos numéricos");
  }
  const salt = randomBytes(16);
  const derived = (await scrypt(pin, salt, 64)) as Buffer;
  return `scrypt$${salt.toString("hex")}$${derived.toString("hex")}`;
}

export async function verifyPin(pin: string, stored: string): Promise<boolean> {
  if (!pin || !stored) return false;
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const salt = Buffer.from(parts[1], "hex");
  const expected = Buffer.from(parts[2], "hex");
  let derived: Buffer;
  try {
    derived = (await scrypt(pin, salt, expected.length)) as Buffer;
  } catch {
    return false;
  }
  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}

function getWorkerTokenSecret(): string {
  return (
    process.env["SESSION_SECRET"] ||
    process.env["CLERK_SECRET_KEY"] ||
    "castores-worker-token-dev-only"
  );
}

type WorkerTokenPayload = {
  uid: number;     // users.id
  role: string;    // generalmente "worker"
  exp: number;     // ms epoch
};

export function signWorkerToken(payload: { userId: number; role: string }): string {
  const body: WorkerTokenPayload = {
    uid: payload.userId,
    role: payload.role,
    exp: Date.now() + WORKER_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
  };
  const encoded = Buffer.from(JSON.stringify(body)).toString("base64url");
  const sig = createHmac("sha256", getWorkerTokenSecret()).update(encoded).digest("base64url");
  return `${encoded}.${sig}`;
}

export function verifyWorkerToken(token: string): WorkerTokenPayload | null {
  if (!token || typeof token !== "string") return null;
  const [encoded, sig] = token.split(".");
  if (!encoded || !sig) return null;

  const expectedSig = createHmac("sha256", getWorkerTokenSecret()).update(encoded).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  let parsed: WorkerTokenPayload;
  try {
    parsed = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (typeof parsed.exp !== "number" || Date.now() > parsed.exp) return null;
  if (typeof parsed.uid !== "number" || typeof parsed.role !== "string") return null;
  return parsed;
}

/**
 * Devuelve el user si la request trae un X-Worker-Token válido cuyo dueño
 * sigue activo. Llamada por `getRequestUser` como tercer fallback.
 */
export async function getWorkerFromRequest(req: Request): Promise<{ id: number; role: string } | null> {
  const raw = req.headers[WORKER_TOKEN_HEADER];
  const token = Array.isArray(raw) ? raw[0] : raw;
  if (!token) return null;
  const payload = verifyWorkerToken(token);
  if (!payload) return null;
  const [u] = await db
    .select({ id: usersTable.id, role: usersTable.role, isActive: usersTable.isActive })
    .from(usersTable)
    .where(eq(usersTable.id, payload.uid));
  if (!u || !u.isActive) return null;
  return { id: u.id, role: u.role };
}
