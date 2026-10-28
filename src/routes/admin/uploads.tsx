import { Hono } from "hono";
import type { AdminEnv } from "../../admin-env";

// /admin/uploads. Filled in by a later Phase 2 task.
export const uploadsRoutes = new Hono<AdminEnv>();
