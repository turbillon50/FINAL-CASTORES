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

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

const sessionSecret = process.env["SESSION_SECRET"];
if (process.env["NODE_ENV"] === "production" && !sessionSecret) {
  throw new Error("SESSION_SECRET is required in production");
}
const resolvedSessionSecret =
  sessionSecret || "castores-dev-session-secret-not-for-production";

app.use(
  session({
    name: "castores.sid",
    secret: resolvedSessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: process.env["NODE_ENV"] === "production",
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    },
  }),
);

app.use(clerkMiddleware());

app.use("/api", router);

export default app;
