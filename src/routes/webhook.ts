import { Hono } from "hono";
import type { AppEnv } from "../env";

// telebirr SMS webhook (/api/sms-webhook). Implemented in P1-S2-T3.
export const webhookRoutes = new Hono<AppEnv>();
