import { randomUUID, timingSafeEqual } from "node:crypto";
import express, { type Express, type RequestHandler } from "express";
import { z } from "zod";
import { type Database, type Row, type Sql, one } from "./db.js";
import { hash, requireThat } from "./security.js";
import type { PassengerRequest } from "./passenger-auth.js";
import type { PaymentGateway } from "./razorpay.js";

const accessInput = z.string().min(30).max(100);
const providerId = z
  .string()
  .regex(/^[a-z]+_[A-Za-z0-9]+$/)
  .max(100);

export async function paymentSummary(sql: Sql, requestId: string) {
  const payment = await one(
    sql,
    "SELECT * FROM payment_orders WHERE request_id=$1",
    [requestId],
  );
  if (!payment)
    return {
      method: "pay_on_delivery",
      status: "not_required",
      refund_status: "none",
      refunded: 0,
      refund_due: 0,
    };
  const failed = await one(
    sql,
    "SELECT id FROM payment_refunds WHERE request_id=$1 AND status='failed' AND attempts>=5 LIMIT 1",
    [requestId],
  );
  return {
    method: "online",
    status: payment.status,
    amount: payment.amount,
    currency: "INR",
    mode: payment.mode,
    payment_id: payment.provider_payment_id,
    expires_at: payment.expires_at,
    refunded: payment.refunded_amount,
    refund_due: payment.refund_target,
    refund_status:
      payment.refund_target <= 0 && payment.refunded_amount <= 0
        ? "none"
        : payment.refunded_amount >= payment.refund_target
          ? "processed"
          : failed
            ? "needs_attention"
            : "pending",
  };
}

export async function requireServicePayment(sql: Sql, request: Row) {
  if (request.payment_method !== "online") return;
  const payment = await one(
    sql,
    "SELECT * FROM payment_orders WHERE request_id=$1",
    [request.id],
  );
  requireThat(
    payment?.status === "paid" && request.payment_status === "paid",
    409,
    "Verify online payment before serving this request.",
  );
  requireThat(
    payment.refund_target === 0 && payment.refunded_amount === 0,
    409,
    "This payment has a refund. Review or cancel the request before providing service.",
  );
}

export async function queuePaymentRefund(
  sql: Sql,
  requestId: string,
  target: number,
) {
  const payment = await one(
    sql,
    "SELECT * FROM payment_orders WHERE request_id=$1 AND status='paid'",
    [requestId],
  );
  if (!payment) return;
  const amount = Math.min(
    payment.amount,
    Math.max(payment.refund_target, target),
  );
  await sql.query(
    "UPDATE payment_orders SET refund_target=$2 WHERE request_id=$1",
    [requestId, amount],
  );
  const queued = await one(
    sql,
    "SELECT COALESCE(SUM(amount),0)::int AS amount FROM payment_refunds WHERE request_id=$1 AND status!='processed'",
    [requestId],
  );
  const difference = amount - queued.amount - payment.refunded_amount;
  if (difference > 0)
    await sql.query(
      "INSERT INTO payment_refunds(id,request_id,amount) VALUES($1,$2,$3)",
      [randomUUID(), requestId, difference],
    );
}

export function createPayments(
  db: Database,
  options: {
    gateway?: PaymentGateway;
    closeUnpaid: (sql: Sql, request: Row) => Promise<unknown>;
  },
) {
  const gateway = options.gateway;
  let maintaining: Promise<void> | undefined;
  let lastMaintenance = 0;
  const capabilities = () => ({
    enabled: !!gateway,
    mode: gateway?.mode || null,
  });
  const ownedRequest = async (
    req: PassengerRequest,
    access: string,
    sql: Sql = db,
  ) => {
    const request = await one(
      sql,
      "SELECT * FROM requests WHERE access_hash=$1 AND passenger_id=$2",
      [hash(access), req.passenger!.id],
    );
    requireThat(request, 404, "Food request not found for this passenger.");
    return request;
  };
  const audit = async (
    sql: Sql,
    request: string,
    action: string,
    detail: object,
  ) => {
    await sql.query(
      "INSERT INTO audit(id,action,entity_id,detail) VALUES($1,$2,$3,$4)",
      [randomUUID(), action, request, JSON.stringify(detail)],
    );
  };
  const expire = async () => {
    await db.transaction(async (sql) => {
      const expired = (
        await sql.query(
          "SELECT r.* FROM requests r JOIN payment_orders p ON p.request_id=r.id WHERE r.status='submitted' AND r.payment_status='pending' AND p.expires_at<now() LIMIT 100",
        )
      ).rows;
      for (const request of expired) await options.closeUnpaid(sql, request);
    });
  };
  const ensureGateway = (payment?: Row): PaymentGateway => {
    requireThat(
      gateway,
      503,
      "Online payments are not configured yet. Please use pay on delivery or contact pantry staff.",
    );
    if (payment)
      requireThat(
        payment.key_id === gateway.keyId && payment.mode === gateway.mode,
        409,
        "This payment uses a different Razorpay configuration. Contact pantry support before retrying.",
      );
    return gateway;
  };
  const applyCaptured = async (
    record: Row,
    paymentId: string,
    capture = false,
  ) => {
    const api = ensureGateway(record);
    let payment = await api.fetchPayment(paymentId);
    requireThat(
      payment.id === paymentId &&
        payment.order_id === record.provider_order_id &&
        payment.amount === record.amount &&
        payment.currency === "INR",
      409,
      "Payment details do not match this food request.",
    );
    if (capture && payment.status === "authorized") {
      const request = await one(db, "SELECT * FROM requests WHERE id=$1", [
        record.request_id,
      ]);
      if (
        request?.status === "submitted" &&
        new Date(record.expires_at).getTime() > Date.now()
      ) {
        try {
          payment = await api.capturePayment(paymentId, record.amount);
        } catch {
          payment = await api.fetchPayment(paymentId);
        }
      }
    }
    if (
      !["captured", "refunded"].includes(payment.status) ||
      payment.captured !== true
    )
      return false;
    const order = await api.fetchOrder(record.provider_order_id);
    requireThat(
      order.id === record.provider_order_id &&
        order.status === "paid" &&
        order.amount === record.amount &&
        order.amount_paid === record.amount &&
        order.currency === "INR",
      409,
      "Payment has not yet been confirmed by the provider.",
    );
    await db.transaction(async (sql) => {
      const current = await one(
        sql,
        "SELECT * FROM payment_orders WHERE request_id=$1",
        [record.request_id],
      );
      requireThat(
        !current.provider_payment_id ||
          current.provider_payment_id === paymentId,
        409,
        "A different payment is already recorded for this request.",
      );
      const request = await one(sql, "SELECT * FROM requests WHERE id=$1", [
        record.request_id,
      ]);
      if (
        request.status === "submitted" &&
        current.status !== "paid" &&
        new Date(current.expires_at).getTime() <= Date.now()
      ) {
        await options.closeUnpaid(sql, request);
        request.status = "cancelled";
      }
      await sql.query(
        "UPDATE payment_orders SET status='paid',provider_payment_id=$2,refunded_amount=GREATEST(refunded_amount,$3),updated_at=now() WHERE request_id=$1",
        [
          record.request_id,
          paymentId,
          Math.min(record.amount, Number(payment.amount_refunded || 0)),
        ],
      );
      await sql.query(
        "UPDATE requests SET payment_status='paid',updated_at=now() WHERE id=$1",
        [record.request_id],
      );
      if (current.status !== "paid")
        await audit(sql, record.request_id, "payment_captured", {
          payment_id: paymentId,
          amount: record.amount,
          mode: record.mode,
        });
      if (["cancelled", "unable_to_fulfil"].includes(request.status))
        await queuePaymentRefund(sql, record.request_id, record.amount);
      if (request.status === "delivered") {
        const actual = await one(
          sql,
          "SELECT COALESCE(SUM(delivered*unit_price),0)::int AS amount FROM request_items WHERE request_id=$1",
          [record.request_id],
        );
        await queuePaymentRefund(
          sql,
          record.request_id,
          record.amount - actual.amount,
        );
      }
    });
    return true;
  };
  const applyRefund = async (job: Row, refund: Row) => {
    const payment = await one(
      db,
      "SELECT * FROM payment_orders WHERE request_id=$1",
      [job.request_id],
    );
    requireThat(
      refund.payment_id === payment.provider_payment_id &&
        refund.amount === job.amount &&
        refund.currency === "INR" &&
        typeof refund.id === "string",
      409,
      "Refund details do not match the recorded payment.",
    );
    let providerRefunded = payment.refunded_amount;
    if (refund.status === "processed") {
      const source = await ensureGateway(payment).fetchPayment(
        payment.provider_payment_id,
      );
      requireThat(
        source.id === payment.provider_payment_id &&
          source.order_id === payment.provider_order_id &&
          source.amount === payment.amount &&
          source.currency === "INR" &&
          Number.isInteger(source.amount_refunded) &&
          source.amount_refunded >= 0 &&
          source.amount_refunded <= payment.amount,
        409,
        "Provider refund balance does not match the recorded payment.",
      );
      providerRefunded = source.amount_refunded;
    }
    await db.transaction(async (sql) => {
      const current = await one(
        sql,
        "SELECT * FROM payment_refunds WHERE id=$1",
        [job.id],
      );
      if (current.status === "processed") return;
      const status =
        refund.status === "processed"
          ? "processed"
          : refund.status === "failed"
            ? "failed"
            : "submitted";
      await sql.query(
        "UPDATE payment_refunds SET provider_refund_id=$2,status=$3,lease_until=NULL,next_retry_at=now()+interval '5 minutes',last_error=$4 WHERE id=$1",
        [
          job.id,
          refund.id,
          status,
          status === "failed"
            ? "Provider reported a failed refund. Review it in the Razorpay dashboard."
            : null,
        ],
      );
      if (status === "processed") {
        const refunded = await one(
          sql,
          "SELECT COALESCE(SUM(amount),0)::int AS amount FROM payment_refunds WHERE request_id=$1 AND status='processed'",
          [job.request_id],
        );
        await sql.query(
          "UPDATE payment_orders SET refunded_amount=GREATEST(refunded_amount,$2),updated_at=now() WHERE request_id=$1",
          [job.request_id, Math.max(refunded.amount, providerRefunded)],
        );
        await audit(sql, job.request_id, "payment_refunded", {
          refund_id: refund.id,
          amount: job.amount,
        });
      }
    });
  };
  const processRefunds = async () => {
    if (!gateway) return;
    await db.transaction(async (sql) => {
      const targets = (
        await sql.query(
          "SELECT request_id,refund_target FROM payment_orders WHERE status='paid' AND refund_target>refunded_amount AND key_id=$1 LIMIT 100",
          [gateway.keyId],
        )
      ).rows;
      for (const target of targets)
        await queuePaymentRefund(sql, target.request_id, target.refund_target);
    });
    const jobs = (
      await db.query(
        "SELECT f.* FROM payment_refunds f JOIN payment_orders p ON p.request_id=f.request_id WHERE f.status!='processed' AND f.attempts<5 AND f.next_retry_at<=now() AND (f.lease_until IS NULL OR f.lease_until<now()) AND p.key_id=$1 LIMIT 5",
        [gateway.keyId],
      )
    ).rows;
    for (const job of jobs) {
      const claimed = await db.transaction(
        async (sql) =>
          (
            await sql.query(
              "UPDATE payment_refunds SET lease_until=now()+interval '60 seconds',attempts=attempts+1 WHERE id=$1 AND status!='processed' AND (lease_until IS NULL OR lease_until<now()) RETURNING *",
              [job.id],
            )
          ).rows[0],
      );
      if (!claimed) continue;
      try {
        const payment = await one(
          db,
          "SELECT * FROM payment_orders WHERE request_id=$1",
          [job.request_id],
        );
        const refund = job.provider_refund_id
          ? await gateway.fetchRefund(job.provider_refund_id)
          : await gateway.refund(
              payment.provider_payment_id,
              job.amount,
              job.id,
            );
        await applyRefund(job, refund);
      } catch {
        await db.query(
          "UPDATE payment_refunds SET lease_until=NULL,status='failed',last_error='Refund could not be confirmed. Retry reconciliation or review the Razorpay dashboard.',next_retry_at=now()+interval '5 minutes' WHERE id=$1 AND status!='processed'",
          [job.id],
        );
      }
    }
  };
  const maintain = (force = false) => {
    if (maintaining) return maintaining;
    if (!force && Date.now() - lastMaintenance < 30000)
      return Promise.resolve();
    lastMaintenance = Date.now();
    maintaining = (async () => {
      await expire();
      if (gateway) {
        const pending = (
          await db.query(
            "SELECT * FROM payment_orders WHERE status='pending' AND provider_order_id IS NOT NULL AND key_id=$1 AND last_checked_at<now()-interval '30 seconds' ORDER BY last_checked_at LIMIT 5",
            [gateway.keyId],
          )
        ).rows;
        for (const record of pending) {
          await db.query(
            "UPDATE payment_orders SET last_checked_at=now() WHERE request_id=$1",
            [record.request_id],
          );
          try {
            const payments = await gateway.orderPayments(
              record.provider_order_id,
            );
            const captured = payments.find(
              (payment) => payment.status === "captured",
            );
            if (captured) await applyCaptured(record, captured.id);
          } catch {
            continue;
          }
        }
      }
      await processRefunds();
    })().finally(() => {
      maintaining = undefined;
    });
    return maintaining;
  };
  const installWebhook = (app: Express) => {
    app.post(
      "/api/payments/webhook",
      express.raw({ type: "application/json", limit: "256kb" }),
      async (req, res) => {
        const api = ensureGateway();
        requireThat(
          Buffer.isBuffer(req.body) &&
            api.verifyWebhook(
              req.body,
              req.header("X-Razorpay-Signature") || "",
            ),
          400,
          "Invalid payment webhook signature.",
        );
        const eventKey = hash(req.body.toString("utf8"));
        if (
          await one(db, "SELECT id FROM payment_events WHERE id=$1", [eventKey])
        ) {
          res.json({ ok: true });
          return;
        }
        let event: Row;
        try {
          event = JSON.parse(req.body.toString("utf8"));
        } catch {
          requireThat(false, 400, "Invalid payment webhook JSON.");
        }
        if (
          ["payment.captured", "order.paid", "payment.authorized"].includes(
            event.event,
          )
        ) {
          const payment = event.payload?.payment?.entity;
          if (payment?.order_id && payment?.id) {
            const record = await one(
              db,
              "SELECT * FROM payment_orders WHERE provider_order_id=$1",
              [payment.order_id],
            );
            if (record)
              await applyCaptured(
                record,
                payment.id,
                event.event === "payment.authorized",
              );
          }
        } else if (
          ["refund.processed", "refund.failed", "refund.created"].includes(
            event.event,
          )
        ) {
          const refund = event.payload?.refund?.entity;
          if (refund?.id) {
            const job = await one(
              db,
              "SELECT * FROM payment_refunds WHERE provider_refund_id=$1 OR id::text=$2",
              [refund.id, refund.notes?.pantry_refund_id || ""],
            );
            if (job) await applyRefund(job, await api.fetchRefund(refund.id));
            else if (refund.payment_id) {
              const record = await one(
                db,
                "SELECT * FROM payment_orders WHERE provider_payment_id=$1",
                [refund.payment_id],
              );
              if (record) {
                ensureGateway(record);
                const source = await api.fetchPayment(refund.payment_id);
                requireThat(
                  source.id === record.provider_payment_id &&
                    source.order_id === record.provider_order_id &&
                    source.amount === record.amount &&
                    source.currency === "INR" &&
                    Number.isInteger(source.amount_refunded) &&
                    source.amount_refunded >= 0 &&
                    source.amount_refunded <= record.amount,
                  409,
                  "Refunded payment details do not match this request.",
                );
                await db.query(
                  "UPDATE payment_orders SET refunded_amount=GREATEST(refunded_amount,$2),updated_at=now() WHERE request_id=$1",
                  [record.request_id, source.amount_refunded],
                );
              }
            }
          }
        }
        await db.query(
          "INSERT INTO payment_events(id,event) VALUES($1,$2) ON CONFLICT DO NOTHING",
          [eventKey, String(event.event || "unknown")],
        );
        res.json({ ok: true });
        void maintain(true).catch(() => {});
      },
    );
  };
  const installMaintenance = (app: Express, secret?: string) => {
    app.post("/api/internal/payments/reconcile", async (req, res) => {
      const supplied = req.header("X-Pantry-Maintenance-Secret") || "";
      requireThat(
        secret &&
          secret.length >= 32 &&
          timingSafeEqual(
            Buffer.from(hash(supplied)),
            Buffer.from(hash(secret)),
          ),
        403,
        "Maintenance authentication failed.",
      );
      await maintain(true);
      res.set("Cache-Control", "no-store").json({ ok: true });
    });
  };
  const mount = (app: Express, guard: RequestHandler) => {
    app.post(
      "/api/public/payments/order",
      guard,
      async (req: PassengerRequest, res) => {
        const { access } = z.object({ access: accessInput }).parse(req.body);
        await expire();
        const request = await ownedRequest(req, access);
        requireThat(
          request.payment_method === "online",
          409,
          "This request uses pay on delivery.",
        );
        requireThat(
          request.status === "submitted" &&
            request.payment_status === "pending",
          409,
          "This request is paid or its payment window is closed.",
        );
        let record = await one(
          db,
          "SELECT * FROM payment_orders WHERE request_id=$1",
          [request.id],
        );
        const api = ensureGateway(record);
        if (!record.provider_order_id) {
          const claimed = await db.transaction(
            async (sql) =>
              (
                await sql.query(
                  "UPDATE payment_orders SET order_claimed_at=now() WHERE request_id=$1 AND provider_order_id IS NULL AND (order_claimed_at IS NULL OR order_claimed_at<now()-interval '60 seconds') RETURNING *",
                  [request.id],
                )
              ).rows[0],
          );
          requireThat(
            claimed,
            409,
            "Checkout is being prepared. Wait a moment and retry.",
          );
          try {
            let order = await api.findOrder(request.reference);
            if (!order)
              order = await api.createOrder(record.amount, request.reference);
            requireThat(
              order.amount === record.amount &&
                order.currency === "INR" &&
                order.receipt === request.reference &&
                typeof order.id === "string",
              409,
              "Provider order details do not match this food request.",
            );
            await db.query(
              "UPDATE payment_orders SET provider_order_id=$2,order_claimed_at=NULL WHERE request_id=$1",
              [request.id, order.id],
            );
          } catch (error) {
            await db.query(
              "UPDATE payment_orders SET order_claimed_at=NULL WHERE request_id=$1",
              [request.id],
            );
            throw error;
          }
          record = await one(
            db,
            "SELECT * FROM payment_orders WHERE request_id=$1",
            [request.id],
          );
        }
        res.json({
          key_id: api.keyId,
          mode: api.mode,
          order_id: record.provider_order_id,
          amount: record.amount,
          currency: "INR",
          reference: request.reference,
          expires_at: record.expires_at,
        });
      },
    );
    app.post(
      "/api/public/payments/verify",
      guard,
      async (req: PassengerRequest, res) => {
        const input = z
          .object({
            access: accessInput,
            razorpay_order_id: providerId,
            razorpay_payment_id: providerId,
            razorpay_signature: z.string().length(64),
          })
          .parse(req.body);
        const request = await ownedRequest(req, input.access);
        const record = await one(
          db,
          "SELECT * FROM payment_orders WHERE request_id=$1",
          [request.id],
        );
        requireThat(
          record && record.provider_order_id === input.razorpay_order_id,
          400,
          "This payment belongs to a different food request.",
        );
        const api = ensureGateway(record);
        requireThat(
          api.verifyCheckout(
            record.provider_order_id,
            input.razorpay_payment_id,
            input.razorpay_signature,
          ),
          400,
          "Payment signature verification failed.",
        );
        const paid = await applyCaptured(
          record,
          input.razorpay_payment_id,
          true,
        );
        res.json({ paid, payment: await paymentSummary(db, request.id) });
        void maintain(true).catch(() => {});
      },
    );
    app.post(
      "/api/public/payments/status",
      guard,
      async (req: PassengerRequest, res) => {
        const { access } = z.object({ access: accessInput }).parse(req.body);
        const request = await ownedRequest(req, access);
        const record = await one(
          db,
          "SELECT * FROM payment_orders WHERE request_id=$1",
          [request.id],
        );
        if (
          gateway &&
          record?.provider_order_id &&
          record.key_id === gateway.keyId
        ) {
          const payments = await gateway.orderPayments(
            record.provider_order_id,
          );
          const payment = payments.find(
            (entry) =>
              entry.status === "captured" || entry.status === "authorized",
          );
          if (payment) await applyCaptured(record, payment.id, true);
        }
        await expire();
        res.json({ payment: await paymentSummary(db, request.id) });
      },
    );
  };
  return {
    capabilities,
    installWebhook,
    installMaintenance,
    mount,
    maintain,
    expire,
    ensureGateway,
    drain: () => maintaining || Promise.resolve(),
  };
}
