import { Hono } from "hono";
import type { AdminEnv } from "../../admin-env";
import {
  getPayment,
  listOrders,
  listPayments,
  listSms,
  PAYMENT_FILTERS,
  type PaymentFilter,
  parseCursor,
} from "../../lib/db/admin-queries";
import { nowMs } from "../../lib/time";
import { adminPage } from "../../views/admin/layout";
import { OrdersList } from "../../views/admin/orders-list";
import { PaymentDetail } from "../../views/admin/payment-detail";
import { PaymentsList } from "../../views/admin/payments";
import { type SmsFilter, SmsList } from "../../views/admin/sms";

// /admin/payments: payments, SMS and orders lists (FR-7, FR-25). Read-only; the actions on
// /admin/orders come in P2-S2-T3. These pages show payer names and phones: admin Worker only.
export const paymentsRoutes = new Hono<AdminEnv>();

/** Missing `before` is the first page; a malformed one is a 400 rather than a silent reset. */
function badRequest(message: string) {
  return new Response(message, { status: 400, headers: { "content-type": "text/plain" } });
}

paymentsRoutes.get("/", async (c) => {
  const statusParam = c.req.query("status") ?? "all";
  if (!PAYMENT_FILTERS.includes(statusParam as PaymentFilter)) return badRequest("Unknown status");
  const status = statusParam as PaymentFilter;
  const beforeParam = c.req.query("before");
  const before = parseCursor(beforeParam);
  if (beforeParam !== undefined && !before) return badRequest("Bad cursor");
  const { rows, next } = await listPayments(c.env.DB, { status, before });
  return adminPage(
    c,
    "Payments",
    "/admin/payments",
    <PaymentsList status={status} rows={rows} next={next} />,
  );
});

paymentsRoutes.get("/sms", async (c) => {
  const statusParam = c.req.query("status") ?? "failed";
  if (statusParam !== "failed" && statusParam !== "ignored") return badRequest("Unknown status");
  const status: SmsFilter = statusParam;
  const beforeParam = c.req.query("before");
  const before = parseCursor(beforeParam);
  if (beforeParam !== undefined && !before) return badRequest("Bad cursor");
  const { rows, next } = await listSms(c.env.DB, { parseStatus: status, before });
  return adminPage(
    c,
    "SMS",
    "/admin/payments/sms",
    <SmsList status={status} rows={rows} next={next} />,
  );
});

paymentsRoutes.get("/orders", async (c) => {
  const beforeParam = c.req.query("before");
  const before = beforeParam === undefined ? null : Number(beforeParam);
  if (before !== null && !(/^\d{1,16}$/.test(beforeParam ?? "") && Number.isSafeInteger(before))) {
    return badRequest("Bad cursor");
  }
  const { rows, next } = await listOrders(c.env.DB, { before });
  return adminPage(
    c,
    "Orders",
    "/admin/payments/orders",
    <OrdersList rows={rows} next={next} now={nowMs()} />,
  );
});

paymentsRoutes.get("/:id{[0-9]{1,16}}", async (c) => {
  const payment = await getPayment(c.env.DB, Number(c.req.param("id")));
  if (!payment) return c.notFound();
  return adminPage(
    c,
    `Payment ${payment.txn}`,
    "/admin/payments",
    <PaymentDetail payment={payment} now={nowMs()} />,
  );
});
