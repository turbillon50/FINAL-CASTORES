import { Router, type IRouter } from "express";
import { requireAuth } from "../middlewares/requireAuth";
import healthRouter from "./health";
import authRouter from "./auth";
import invitationsRouter from "./invitations";
import contentRouter from "./content";
import usersRouter from "./users";
import projectsRouter from "./projects";
import logsRouter from "./logs";
import materialsRouter from "./materials";
import materialNotesRouter from "./material-notes";
import documentsRouter from "./documents";
import reportsRouter from "./reports";
import notificationsRouter from "./notifications";
import dashboardRouter from "./dashboard";
import rolesRouter from "./roles";
import adminDbInitRouter from "./admin-db-init";
import pushRouter from "./push";
import auditRouter from "./audit";
import attendanceRouter from "./attendance";

const router: IRouter = Router();

// Public routes — no auth required
router.use(healthRouter);
router.use(authRouter);
router.use(invitationsRouter); // validate endpoint is public; list/create/delete check role internally
router.use(rolesRouter); // handles own auth check internally (admin-only per route handler)
// Public catalogue: GET /content must NOT go through requireAuth (that middleware hits the DB via
// getRequestUser and would 401/500 anonymous FAQ/legal reads or fail.closed when the pool errors).
router.use(contentRouter);
// One-shot DB schema/seed initializer. Idempotent. Guarded by ADMIN_ACCESS_PHRASE in body.
// Safe to keep registered: rejects without the master phrase.
router.use(adminDbInitRouter);

// Worker login (POST /auth/worker-login) ya está montado vía authRouter
// arriba — devuelve el X-Worker-Token que la PWA usa para autenticarse.
// El resto de endpoints de asistencia se monta abajo con requireAuth.

// Protected routes — require Clerk JWT or demo mode header
router.use(requireAuth);
router.use(usersRouter);
router.use(projectsRouter);
router.use(logsRouter);
router.use(materialsRouter);
router.use(materialNotesRouter);
router.use(documentsRouter);
router.use(reportsRouter);
router.use(notificationsRouter);
router.use(dashboardRouter);
router.use(pushRouter);
router.use(auditRouter);
router.use(attendanceRouter);

export default router;
