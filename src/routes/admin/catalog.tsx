import { Hono } from "hono";
import type { AdminEnv } from "../../admin-env";

// /admin/catalog. Filled in by a later Phase 2 task.
export const catalogRoutes = new Hono<AdminEnv>();
