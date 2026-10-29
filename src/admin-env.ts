import type { PhoneStatus } from "./lib/heartbeat";

// The admin Worker's bindings: the public Env (generated from wrangler.jsonc) plus the Access
// and admin vars from wrangler.admin.jsonc. Kept by hand so there is only one global Env type.
export type AdminBindings = Env & {
  ACCESS_TEAM_DOMAIN: string;
  ACCESS_AUD: string;
  ADMIN_EMAIL: string;
  PUBLIC_SITE_URL: string;
  ADMIN_DEV_BYPASS?: string;
  /** Minutes without a phone heartbeat before the admin banner turns red (FR-27). */
  HEARTBEAT_STALE_MINUTES: string;
};

export type AdminEnv = {
  Bindings: AdminBindings;
  Variables: {
    adminEmail: string;
    /** Set by routes/admin.tsx for every non-upload request; adminPage renders it as the banner. */
    phone?: { status: PhoneStatus; now: number };
  };
};
