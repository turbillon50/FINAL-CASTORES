import type { Request, Response, NextFunction } from "express";

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

function cleanup(now: number): void {
  if (buckets.size < 5000) return;
  for (const [k, v] of buckets) {
    if (v.resetAt <= now) buckets.delete(k);
  }
}

export interface RateLimitOptions {
  windowMs: number;
  max: number;
  keyPrefix: string;
}

export function rateLimit(opts: RateLimitOptions) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const ip =
      (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() ||
      req.socket.remoteAddress ||
      "unknown";
    const emailRaw = (req.body as { email?: string } | undefined)?.email;
    const email = typeof emailRaw === "string" ? emailRaw.trim().toLowerCase() : "";
    const key = `${opts.keyPrefix}:${ip}:${email}`;
    const now = Date.now();

    cleanup(now);

    const existing = buckets.get(key);
    if (!existing || existing.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + opts.windowMs });
      next();
      return;
    }

    if (existing.count >= opts.max) {
      const retryAfterSec = Math.max(1, Math.ceil((existing.resetAt - now) / 1000));
      res.setHeader("Retry-After", String(retryAfterSec));
      res.status(429).json({
        error: "Demasiados intentos. Espera un momento e intenta de nuevo.",
        retryAfterSeconds: retryAfterSec,
      });
      return;
    }

    existing.count += 1;
    next();
  };
}
