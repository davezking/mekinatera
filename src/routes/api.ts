import { Hono } from "hono";
import type { AppEnv } from "../env";

// Public JSON API (/api/models). Implemented in P1-S2-T1.
export const apiRoutes = new Hono<AppEnv>();
