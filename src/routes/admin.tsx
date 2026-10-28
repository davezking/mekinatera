import { Hono } from "hono";
import type { AdminEnv } from "../admin-env";
import { HOUR, nowMs } from "../lib/time";
import { adminAuth } from "../middleware/admin-auth";
import { Dashboard, type DashboardCounts } from "../views/admin/dashboard";
import { adminPage } from "../views/admin/layout";
import { catalogRoutes } from "./admin/catalog";
import { ordersRoutes } from "./admin/orders";
import { paymentsRoutes } from "./admin/payments";
import { uploadsRoutes } from "./admin/uploads";

// /admin on the ADMIN Worker only (src/admin-worker.ts). Every route is behind adminAuth().
export const adminRoutes = new Hono<AdminEnv>();

adminRoutes.use("*", adminAuth());
adminRoutes.route("/catalog", catalogRoutes);
adminRoutes.route("/uploads", uploadsRoutes);
adminRoutes.route("/payments", paymentsRoutes);
adminRoutes.route("/orders", ordersRoutes);

/** Start of the current day in Ethiopia (UTC+3, no DST), as UTC ms. */
export function startOfEatDay(now: number): number {
  const day = 24 * HOUR;
  return Math.floor((now + 3 * HOUR) / day) * day - 3 * HOUR;
}

type Count = { today: number; total: number };

export async function dashboardCounts(db: D1Database, now: number): Promise<DashboardCounts> {
  const today = startOfEatDay(now);
  const [byStatus, orders, failed] = await db.batch<{
    status?: string;
    total: number;
    today: number | null;
  }>([
    // Covering scans of the (status, paid_at) and (parse_status, received_at) indexes.
    db
      .prepare(
        `SELECT status, COUNT(*) AS total, SUM(paid_at >= ?) AS today
         FROM payments INDEXED BY idx_payments_status_paid GROUP BY status`,
      )
      .bind(today),
    db.prepare("SELECT COUNT(*) AS total, SUM(created_at >= ?) AS today FROM orders").bind(today),
    db
      .prepare(
        `SELECT COUNT(*) AS total, SUM(received_at >= ?) AS today
         FROM raw_sms INDEXED BY idx_raw_sms_status_received WHERE parse_status = 'failed'`,
      )
      .bind(today),
  ]);
  const zero = (): Count => ({ today: 0, total: 0 });
  const payments = { received: zero(), claimed: zero(), unclaimed: zero(), flagged: zero() };
  for (const row of byStatus?.results ?? []) {
    const key = row.status as keyof typeof payments;
    if (!(key in payments) || key === "received") continue;
    payments[key] = { today: row.today ?? 0, total: row.total };
    payments.received.today += row.today ?? 0;
    payments.received.total += row.total;
  }
  const one = (r: typeof orders): Count => {
    const row = r?.results[0];
    return { today: row?.today ?? 0, total: row?.total ?? 0 };
  };
  return { payments, orders: one(orders), failedSms: one(failed) };
}

adminRoutes.get("/", async (c) => {
  const counts = await dashboardCounts(c.env.DB, nowMs());
  return adminPage(c, "Dashboard", "/admin", <Dashboard counts={counts} />);
});
