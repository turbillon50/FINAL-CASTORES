import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import cookieParser from "cookie-parser";
import session from "express-session";
import { clerkMiddleware } from "@clerk/express";
import { CLERK_PROXY_PATH, clerkProxyMiddleware } from "./middlewares/clerkProxyMiddleware";
import router from "./routes";
import healthRouter from "./routes/health";
import { logger } from "./lib/logger";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());

// Health check mounted before Clerk middleware so it works in production
// even when Clerk keys are not yet configured
app.use("/api", healthRouter);

// Public invite redirect — MUST be before any auth middleware.
// Returns inline HTML that nukes service workers + caches, stores the
// code in localStorage, then hard-redirects to the signup page. This
// guarantees the user lands on a fresh, working version of the app.
app.get("/api/invite/:code", (req, res) => {
  const code = String(req.params["code"] || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const frontendBase = String(process.env["FRONTEND_PUBLIC_URL"] || "").replace(/\/+$/, "");
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(`<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8"><title>Castores Control</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Cache-Control" content="no-store, no-cache, must-revalidate">
<style>
body{margin:0;background:linear-gradient(135deg,#1a1612,#2d2419,#1a1612);color:#fff;display:flex;align-items:center;justify-content:center;min-height:100vh;font-family:-apple-system,BlinkMacSystemFont,sans-serif;font-size:14px}
.b{display:flex;flex-direction:column;align-items:center;gap:18px}
.s{width:48px;height:48px;border:4px solid rgba(200,149,42,0.2);border-top-color:#C8952A;border-radius:50%;animation:r 1s linear infinite}
@keyframes r{to{transform:rotate(360deg)}}
p{color:rgba(255,255,255,0.55);font-weight:600;margin:0}
</style></head><body><div class="b"><div class="s"></div><p>Verificando tu invitación...</p></div>
<script>(function(){
  var code=${JSON.stringify(code)};
  var frontendBase=${JSON.stringify(frontendBase)};
  try{localStorage.setItem("castores_invite_code",code);}catch(e){}
  function go(){
    var url = (frontendBase ? frontendBase : "") + "/?code=" + code + "&_t=" + Date.now();
    location.replace(url);
  }
  var p=[];
  if('serviceWorker' in navigator){p.push(navigator.serviceWorker.getRegistrations().then(function(rs){return Promise.all(rs.map(function(r){return r.unregister();}));}).catch(function(){}));}
  if('caches' in window){p.push(caches.keys().then(function(ks){return Promise.all(ks.map(function(k){return caches.delete(k);}));}).catch(function(){}));}
  Promise.all(p).then(function(){setTimeout(go,300);}).catch(go);
  setTimeout(go,1800);
})();</script></body></html>`);
});

// CORS: in production we deploy the API and the web on different Vercel
// projects (different origins). The browser will only send cookies and
// Authorization headers cross-origin if we explicitly allow the requesting
// origin AND set credentials: true. We accept any origin from the configured
// list (FRONTEND_PUBLIC_URL + ALLOWED_ORIGINS) plus any *.vercel.app preview
// deploy in non-production to make smoke tests trivial.
const allowedOrigins = (() => {
  const list: string[] = [];
  const primary = process.env["FRONTEND_PUBLIC_URL"];
  if (primary) list.push(primary.replace(/\/+$/, ""));
  const extra = process.env["ALLOWED_ORIGINS"];
  if (extra) {
    extra
      .split(",")
      .map((o) => o.trim().replace(/\/+$/, ""))
      .filter(Boolean)
      .forEach((o) => list.push(o));
  }
  return list;
})();

app.use(
  cors({
    credentials: true,
    origin(origin, callback) {
      // Same-origin / curl / server-to-server (no Origin header) are always allowed.
      if (!origin) return callback(null, true);
      const normalized = origin.replace(/\/+$/, "");
      if (allowedOrigins.includes(normalized)) return callback(null, true);
      // In non-production we accept any *.vercel.app preview to ease testing.
      if (
        process.env["NODE_ENV"] !== "production" &&
        /^https?:\/\/[^/]+\.vercel\.app$/i.test(normalized)
      ) {
        return callback(null, true);
      }
      // Allow localhost during dev regardless of NODE_ENV (Vite preview, etc.).
      if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(normalized)) {
        return callback(null, true);
      }
      return callback(new Error(`CORS: origin ${origin} not allowed`));
    },
  }),
);
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// SESSION_SECRET is required in production for stable sessions. If it's
// missing we fall back to a process-lifetime random string and log loudly,
// so the API still boots (a hard crash here would render the whole web app
// blank instead of just degrading auth).
const sessionSecret = process.env["SESSION_SECRET"];
const isProduction = process.env["NODE_ENV"] === "production";
let resolvedSessionSecret = sessionSecret || "";
if (!resolvedSessionSecret) {
  if (isProduction) {
    logger.error(
      "SESSION_SECRET missing in production; using ephemeral random secret. Sessions will not survive cold starts. Set SESSION_SECRET in Vercel environment variables.",
    );
    resolvedSessionSecret =
      Math.random().toString(36).slice(2) +
      Math.random().toString(36).slice(2) +
      Date.now().toString(36);
  } else {
    resolvedSessionSecret = "castores-dev-session-secret-not-for-production";
  }
}

app.use(
  session({
    name: "castores.sid",
    secret: resolvedSessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      // In production we run web and API on different domains so the cookie
      // must be SameSite=None + Secure to survive the cross-site request.
      // In dev we keep Lax so it works on plain http://localhost.
      secure: isProduction,
      sameSite: isProduction ? "none" : "lax",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    },
  }),
);

app.use(clerkMiddleware());

app.use("/api", router);

export default app;
