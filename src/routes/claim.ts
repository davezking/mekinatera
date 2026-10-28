import { Hono } from "hono";
import type { AppEnv } from "../env";

// Claim + poll endpoints (/api/claim). Implemented in P1-S3-T1.
export const claimRoutes = new Hono<AppEnv>();
