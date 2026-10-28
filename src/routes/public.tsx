import { Hono } from "hono";
import type { AppEnv } from "../env";

// Catalog page (/) and checkout page (/m/:slug). Implemented in P1-S2-T1.
export const publicRoutes = new Hono<AppEnv>();
