import { Hono } from "hono";
import type { AppEnv } from "../env";

// Download endpoint (/d/:token). Implemented in P1-S3-T2.
export const downloadRoutes = new Hono<AppEnv>();
