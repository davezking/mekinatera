import { Hono } from "hono";
import type { AdminEnv } from "../../admin-env";

// /admin/payments. Filled in by a later Phase 2 task.
export const paymentsRoutes = new Hono<AdminEnv>();
