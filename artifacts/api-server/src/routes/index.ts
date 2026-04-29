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
import documentsRouter from "./documents";
import reportsRouter from "./reports";
import notificationsRouter from "./notifications";
import dashboardRouter from "./dashboard";
import rolesRouter from "./roles";

const router: IRouter = Router();

// Public routes — no auth required
router.use(healthRouter);
router.use(authRouter);
router.use(invitationsRouter); // validate endpoint is public; list/create/delete check role internally
router.use(rolesRouter); // handles own auth check internally (admin-only per route handler)
// Public catalogue: GET /content must NOT go through requireAuth (that middleware hits the DB via
// getRequestUser and would 401/500 anonymous FAQ/legal reads or fail.closed when the pool errors).
router.use(contentRouter);

// Protected routes — require Clerk JWT or demo mode header
router.use(requireAuth);
router.use(usersRouter);
router.use(projectsRouter);
router.use(logsRouter);
router.use(materialsRouter);
router.use(documentsRouter);
router.use(reportsRouter);
router.use(notificationsRouter);
router.use(dashboardRouter);

export default router;
