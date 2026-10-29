import type { Context } from "hono";
import { Hono } from "hono";
import type { AdminEnv } from "../../admin-env";
import { approvePayment, type CreatedLink, createOrder, regenerateLink } from "../../lib/claim";
import { getOrder, getPayment } from "../../lib/db/admin-queries";
import { listAdminCatalog } from "../../lib/db/catalog";
import { nowMs } from "../../lib/time";
import { adminPage } from "../../views/admin/layout";
import { LinkCreated } from "../../views/admin/link-created";
import { ManualOrderForm } from "../../views/admin/manual-order";
import {
  type ActionErrors,
  type ActionValues,
  PaymentActions,
  RegenerateForm,
  type VersionOption,
  versionLabel,
} from "../../views/admin/payment-actions";
import { PaymentDetail } from "../../views/admin/payment-detail";

// /admin/orders: admin approvals and new links (FR-26). These release PDFs WITHOUT the automatic
// payment checks, so every action is a POST (same-origin checked by adminAuth), needs a note and
// a ticked confirm box, and shows the new link exactly once.
export const ordersRoutes = new Hono<AdminEnv>();

const MAX_NOTE = 500;
const ID = /^\d{1,15}$/;

/** Manual versions an admin can release: those with an uploaded PDF (hidden ones included). */
export async function versionOptions(db: D1Database): Promise<VersionOption[]> {
  return (await listAdminCatalog(db))
    .filter((row) => row.versionId !== null && row.hasPdf)
    .map((row) => ({ versionId: row.versionId as number, label: versionLabel(row) }));
}

type ActionForm = ActionValues & { paymentId: string; confirmed: boolean };

async function readForm(c: Context<AdminEnv>): Promise<ActionForm> {
  let form: FormData;
  try {
    form = await c.req.formData();
  } catch {
    form = new FormData(); // Not a form post: every required field is reported missing.
  }
  const str = (key: string) => {
    const v = form.get(key);
    return typeof v === "string" ? v.trim() : "";
  };
  return {
    paymentId: str("paymentId"),
    versionId: str("versionId"),
    note: str("note"),
    confirmed: form.get("confirm") === "1",
  };
}

function checkNoteAndConfirm(form: ActionForm, errors: ActionErrors, confirmText: string) {
  if (!form.note) errors.note = "Enter a note.";
  else if (form.note.length > MAX_NOTE) errors.note = `Use ${MAX_NOTE} characters or fewer.`;
  if (!form.confirmed) errors.confirm = `Tick “${confirmText}”.`;
}

/** The chosen version, if it is one of the options (it exists and has a PDF). */
function checkVersion(form: ActionForm, versions: VersionOption[], errors: ActionErrors) {
  const id = ID.test(form.versionId) ? Number(form.versionId) : Number.NaN;
  const ok = versions.some((v) => v.versionId === id);
  if (!ok) errors.versionId = "Choose a manual.";
  return ok ? id : null;
}

function downloadUrl(c: Context<AdminEnv>, token: string): string {
  return `${c.env.PUBLIC_SITE_URL.replace(/\/+$/, "")}/d/${token}`;
}

function linkCreated(
  c: Context<AdminEnv>,
  heading: string,
  link: CreatedLink,
  paymentId: number | null,
) {
  c.header("Cache-Control", "no-store");
  return adminPage(
    c,
    heading,
    "/admin/payments/orders",
    <LinkCreated
      heading={heading}
      url={downloadUrl(c, link.token)}
      orderId={link.orderId}
      paymentId={paymentId}
    />,
  );
}

const hasErrors = (errors: ActionErrors) => Object.keys(errors).length > 0;

ordersRoutes.post("/approve-payment", async (c) => {
  const db = c.env.DB;
  const form = await readForm(c);
  const payment = ID.test(form.paymentId) ? await getPayment(db, Number(form.paymentId)) : null;
  if (!payment) return c.text("Payment not found", 404);

  const versions = await versionOptions(db);
  const errors: ActionErrors = {};
  const versionId = checkVersion(form, versions, errors);
  checkNoteAndConfirm(form, errors, "I checked this payment is real");

  let link: CreatedLink | null = null;
  if (!hasErrors(errors) && versionId !== null) {
    link = await approvePayment(c.env, {
      paymentId: payment.id,
      versionId,
      adminNote: form.note,
      now: nowMs(),
    });
    if (!link) errors.form = "Payment was already claimed. No new order was created.";
  }
  if (!link) {
    // Re-read: the payment may have been claimed meanwhile, and the page should show that.
    const current = (await getPayment(db, payment.id)) ?? payment;
    c.status(errors.form ? 409 : 400);
    return adminPage(
      c,
      `Payment ${current.txn}`,
      "/admin/payments",
      <PaymentDetail
        payment={current}
        now={nowMs()}
        actions={
          <PaymentActions payment={current} versions={versions} values={form} errors={errors} />
        }
      />,
    );
  }
  console.log(JSON.stringify({ event: "admin_approve", orderId: link.orderId }));
  return linkCreated(c, `Approved ${payment.txn}`, link, payment.id);
});

ordersRoutes.get("/manual", async (c) => {
  const versions = await versionOptions(c.env.DB);
  return adminPage(
    c,
    "Approve without a payment",
    "/admin/payments/orders",
    <ManualOrderForm versions={versions} />,
  );
});

ordersRoutes.post("/manual", async (c) => {
  const form = await readForm(c);
  const versions = await versionOptions(c.env.DB);
  const errors: ActionErrors = {};
  const versionId = checkVersion(form, versions, errors);
  checkNoteAndConfirm(form, errors, "I checked this payment is real");
  if (hasErrors(errors) || versionId === null) {
    c.status(400);
    return adminPage(
      c,
      "Approve without a payment",
      "/admin/payments/orders",
      <ManualOrderForm versions={versions} values={form} errors={errors} />,
    );
  }
  const link = await createOrder(c.env, {
    paymentId: null,
    versionId,
    createdBy: "admin",
    adminNote: form.note,
    now: nowMs(),
  });
  console.log(JSON.stringify({ event: "admin_manual_order", orderId: link.orderId }));
  return linkCreated(c, "Manual order created", link, null);
});

ordersRoutes.get("/:id{[0-9]{1,15}}/regenerate", async (c) => {
  const order = await getOrder(c.env.DB, Number(c.req.param("id")));
  if (!order) return c.notFound();
  return adminPage(c, "New link", "/admin/payments/orders", <RegenerateForm order={order} />);
});

ordersRoutes.post("/:id{[0-9]{1,15}}/regenerate", async (c) => {
  const order = await getOrder(c.env.DB, Number(c.req.param("id")));
  if (!order) return c.notFound();
  const form = await readForm(c);
  const errors: ActionErrors = {};
  checkNoteAndConfirm(form, errors, "Revoke the old link and create a new one");
  const link = hasErrors(errors)
    ? null
    : await regenerateLink(c.env, { orderId: order.id, adminNote: form.note, now: nowMs() });
  if (!link) {
    if (!hasErrors(errors)) return c.notFound();
    c.status(400);
    return adminPage(
      c,
      "New link",
      "/admin/payments/orders",
      <RegenerateForm order={order} values={form} errors={errors} />,
    );
  }
  console.log(JSON.stringify({ event: "admin_regenerate", orderId: link.orderId }));
  return linkCreated(c, `New link for order #${order.id}`, link, order.paymentId);
});
