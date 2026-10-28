import { Hono } from "hono";
import type { AdminEnv } from "../../admin-env";

// /admin/orders. Filled in by a later Phase 2 task.
export const ordersRoutes = new Hono<AdminEnv>();
