// Sesión paralela a Clerk para trabajadores operativos (PWA en celular).
// El backend nos da un token al hacer POST /auth/worker-login con
// worker_code + PIN; lo guardamos en localStorage y lo mandamos como
// header X-Worker-Token en cada request. Ningún flow de Clerk se toca.

import { apiUrl } from "./api-url";

const TOKEN_KEY = "castores_worker_token";
const USER_KEY = "castores_worker_user";

export type WorkerSessionUser = {
  id: number;
  name: string;
  role: string;
  workerCode: string | null;
  avatarUrl: string | null;
};

export function getWorkerToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function getWorkerUser(): WorkerSessionUser | null {
  try {
    const raw = localStorage.getItem(USER_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as WorkerSessionUser;
  } catch {
    return null;
  }
}

export function setWorkerSession(token: string, user: WorkerSessionUser): void {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function clearWorkerSession(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

/**
 * Fetch con header de worker auto-inyectado. Devuelve la response cruda;
 * si el caller quiere JSON debe parsearlo. Lanza solo en errores de red,
 * NO en 4xx/5xx (el caller decide cómo manejar status).
 */
export async function workerFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = getWorkerToken();
  const headers = new Headers(init.headers);
  if (token) headers.set("X-Worker-Token", token);
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  return fetch(apiUrl(path), { ...init, headers });
}

/**
 * Login del worker. Devuelve el user y persiste la sesión, o lanza con
 * el mensaje del backend. Útil para que el componente de login solo
 * tenga que escribir try { await loginWorker(...) }.
 */
export async function loginWorker(workerCode: string, pin: string): Promise<WorkerSessionUser> {
  const res = await fetch(apiUrl("/api/auth/worker-login"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workerCode: workerCode.trim().toUpperCase(), pin: pin.trim() }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error || "No pudimos iniciar sesión.");
  }
  setWorkerSession(data.token as string, data.user as WorkerSessionUser);
  return data.user as WorkerSessionUser;
}
