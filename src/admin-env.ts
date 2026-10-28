// The admin Worker's bindings: the public Env (generated from wrangler.jsonc) plus the Access
// and admin vars from wrangler.admin.jsonc. Kept by hand so there is only one global Env type.
export type AdminBindings = Env & {
  ACCESS_TEAM_DOMAIN: string;
  ACCESS_AUD: string;
  ADMIN_EMAIL: string;
  PUBLIC_SITE_URL: string;
  ADMIN_DEV_BYPASS?: string;
};

export type AdminEnv = { Bindings: AdminBindings; Variables: { adminEmail: string } };
