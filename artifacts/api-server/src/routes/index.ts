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
import adminDbInitRouter from "./admin-db-init";

const router: IRouter = Router();

// Public routes — no auth required
router.use(healthRouter);
router.use(authRouter);
router.use(invitationsRouter);
router.use(rolesRouter);
router.use(contentRouter);
// One-shot DB schema init — guarded by ADMIN_ACCESS_PHRASE in body
router.use(adminDbInitRouter);

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
