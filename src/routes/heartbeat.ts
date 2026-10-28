import { Hono } from "hono";
import type { AppEnv } from "../env";

// Phone heartbeat (/api/heartbeat). Implemented in P2-S2-T2.
export const heartbeatRoutes = new Hono<AppEnv>();
