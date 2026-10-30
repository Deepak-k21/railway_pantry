import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import request from "supertest";
import { createApp } from "../server/app.js";
import { database, migrate, one, type Row } from "../server/db.js";
import { hash, seal, token, Fault } from "../server/security.js";
import {
  createRazorpay,
  validSignature,
  type PaymentGateway,
} from "../server/razorpay.js";

const checkoutSecret = "test-only-checkout-secret-never-used-live";
const webhookSecret = "test-only-webhook-secret-never-used-live";
const signature = (data: string, secret = checkoutSecret) =>
  createHmac("sha256", secret).update(data).digest("hex");

class TestGateway implements PaymentGateway {
  keyId = "rzp_test_fixture";
  mode = "test" as const;
  orders = new Map<string, Row>();
  payments = new Map<string, Row>();
  refunds = new Map<string, Row>();
  ordersCreated = 0;
  captures = 0;
  refundsCreated = 0;
  timeoutRefund = false;
  verifyCheckout(orderId: string, paymentId: string, value: string) {
    return validSignature(`${orderId}|${paymentId}`, value, checkoutSecret);
  }
  verifyWebhook(body: Buffer, value: string) {
    return validSignature(body, value, webhookSecret);
  }
  async createOrder(amount: number, receipt: string) {
    const order = {
      id: "order_" + ++this.ordersCreated,
      amount,
      amount_paid: 0,
      receipt,
      currency: "INR",
      status: "created",
    };
    this.orders.set(order.id, order);
    return structuredClone(order);
  }
  async findOrder(receipt: string) {
    return [...this.orders.values()].find((order) => order.receipt === receipt);
  }
  async fetchOrder(id: string) {
    return structuredClone(this.orders.get(id)!);
  }
  async fetchPayment(id: string) {
    if (!this.payments.has(id)) throw new Fault(503, "Unavailable");
    return structuredClone(this.payments.get(id)!);
  }
  async orderPayments(id: string) {
    return [...this.payments.values()]
      .filter((payment) => payment.order_id === id)
      .map((value) => structuredClone(value));
  }
  settle(orderId: string, status = "captured") {
    const order = this.orders.get(orderId)!;
    const payment = {
      id: "pay_" + (this.payments.size + 1),
      order_id: orderId,
      amount: order.amount,
      currency: "INR",
      status,
      captured: status === "captured",
      amount_refunded: 0,
    };
    this.payments.set(payment.id, payment);
    if (payment.captured) {
      order.status = "paid";
      order.amount_paid = order.amount;
    }
    return payment;
  }
  async capturePayment(id: string, amount: number) {
    const payment = this.payments.get(id)!;
    assert.equal(payment.amount, amount);
    this.captures++;
    payment.status = "captured";
    payment.captured = true;
    const order = this.orders.get(payment.order_id)!;
    order.status = "paid";
    order.amount_paid = order.amount;
    return structuredClone(payment);
  }
  async refund(paymentId: string, amount: number, key: string) {
    let refund = this.refunds.get(key);
    if (!refund) {
      refund = {
        id: "rfnd_" + ++this.refundsCreated,
        payment_id: paymentId,
        amount,
        currency: "INR",
        status: "processed",
        notes: { pantry_refund_id: key },
      };
      this.refunds.set(key, refund);
      this.payments.get(paymentId)!.amount_refunded += amount;
    }
    if (this.timeoutRefund) {
      this.timeoutRefund = false;
      throw new Fault(503, "Response timed out after provider acceptance");
    }
    return structuredClone(refund);
  }
  async fetchRefund(id: string) {
    return structuredClone(
      [...this.refunds.values()].find((refund) => refund.id === id)!,
    );
  }
}

test("Razorpay configuration requires matching test/live keys and authentic signatures", () => {
  assert.equal(createRazorpay({}), undefined);
  assert.throws(
    () => createRazorpay({ RAZORPAY_KEY_ID: "rzp_test_fixture" }),
    /together/,
  );
  assert.throws(
    () =>
      createRazorpay({
        PAYMENTS_MODE: "test",
        RAZORPAY_KEY_ID: "rzp_live_fixture",
        RAZORPAY_KEY_SECRET: checkoutSecret,
        RAZORPAY_WEBHOOK_SECRET: webhookSecret,
      }),
    /prefix/,
  );
  const gateway = createRazorpay({
    PAYMENTS_MODE: "test",
    RAZORPAY_KEY_ID: "rzp_test_fixture",
    RAZORPAY_KEY_SECRET: checkoutSecret,
    RAZORPAY_WEBHOOK_SECRET: webhookSecret,
  })!;
  assert.equal(
    gateway.verifyCheckout("order_1", "pay_1", signature("order_1|pay_1")),
    true,
  );
  assert.equal(
    gateway.verifyCheckout("order_2", "pay_1", signature("order_1|pay_1")),
    false,
  );
  assert.equal(
    gateway.verifyWebhook(
      Buffer.from("raw-body"),
      signature("raw-body", webhookSecret),
    ),
    true,
  );
  assert.equal(
    gateway.verifyWebhook(
      Buffer.from("different-body"),
      signature("raw-body", webhookSecret),
    ),
    false,
  );
});

test("Razorpay transport sends exact paise totals, private authentication and stable refund keys", async (suite) => {
  const calls: { url: string; options: RequestInit }[] = [];
  suite.mock.method(
    globalThis,
    "fetch",
    async (url: string, options: RequestInit) => {
      calls.push({ url, options });
      return new Response(
        JSON.stringify({
          id: url.includes("/refund") ? "rfnd_transport" : "order_transport",
          amount: 1234,
          currency: "INR",
        }),
        { status: 200 },
      );
    },
  );
  const gateway = createRazorpay({
    RAZORPAY_KEY_ID: "rzp_test_transport",
    RAZORPAY_KEY_SECRET: checkoutSecret,
    RAZORPAY_WEBHOOK_SECRET: webhookSecret,
  })!;
  await gateway.createOrder(1234, "RP-transport");
  assert.equal(calls[0].url, "https://api.razorpay.com/v1/orders");
  assert.deepEqual(JSON.parse(calls[0].options.body as string), {
    amount: 1234,
    currency: "INR",
    receipt: "RP-transport",
    partial_payment: false,
  });
  const key = randomUUID();
  await gateway.refund("pay_transport", 1234, key);
  await gateway.refund("pay_transport", 1234, key);
  assert.deepEqual(calls[1].options.body, calls[2].options.body);
  assert.equal(
    (calls[1].options.headers as Record<string, string>)[
      "X-Refund-Idempotency"
    ],
    key,
  );
  assert.match(
    (calls[0].options.headers as Record<string, string>).Authorization,
    /^Basic /,
  );
  suite.mock.restoreAll();
});

test("online payments protect totals, stock, assignment, captured funds and refunds", async (suite) => {
  const db = await database();
  await migrate(db);
  const origin = "http://localhost:5173",
    secret = token(),
    gateway = new TestGateway();
  const proxySecret = token();
  const app = createApp(db, {
    origin,
    replaySecret: secret,
    disableRateLimit: true,
    paymentGateway: gateway,
    proxySecret,
    otpProvider: {
      mode: "console",
      async send() {
        return null;
      },
    },
  });
  const adminId = randomUUID(),
    staffId = randomUUID(),
    passengerId = randomUUID(),
    otherId = randomUUID();
  const service = randomUUID(),
    coach = randomUUID(),
    category = randomUUID(),
    product = randomUUID(),
    qr = token();
  const passengerToken = token(),
    otherToken = token(),
    adminToken = token(),
    staffToken = token();
  const csrf = token(),
    adminCsrf = token(),
    staffCsrf = token();
  await db.query(
    "INSERT INTO users(id,name,email,password,role) VALUES($1,'Owner','owner@payment.test','unused','admin'),($2,'Staff','staff@payment.test','unused','staff')",
    [adminId, staffId],
  );
  await db.query(
    "INSERT INTO sessions(token_hash,user_id,csrf,expires_at) VALUES($1,$2,$3,now()+interval '1 hour'),($4,$5,$6,now()+interval '1 hour')",
    [
      hash(adminToken),
      adminId,
      adminCsrf,
      hash(staffToken),
      staffId,
      staffCsrf,
    ],
  );
  for (const [id, raw] of [
    [passengerId, passengerToken],
    [otherId, otherToken],
  ]) {
    await db.query(
      "INSERT INTO passengers(id,phone_hash,phone_cipher) VALUES($1,$2,$3)",
      [id, hash(raw), JSON.stringify(seal({ phone: "+919876543210" }, secret))],
    );
    await db.query(
      "INSERT INTO passenger_sessions(token_hash,passenger_id,csrf,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')",
      [hash(raw), id, csrf],
    );
  }
  await db.query(
    "INSERT INTO services(id,name,number,service_date,origin,destination) VALUES($1,'Payment Express','12345',CURRENT_DATE,'A','B')",
    [service],
  );
  await db.query(
    "INSERT INTO compartments(id,service_id,code) VALUES($1,$2,'S1')",
    [coach, service],
  );
  await db.query(
    "INSERT INTO staff_services(user_id,service_id) VALUES($1,$2)",
    [staffId, service],
  );
  await db.query("INSERT INTO categories(id,name) VALUES($1,'Meals')", [
    category,
  ]);
  await db.query(
    "INSERT INTO products(id,name,category_id,price) VALUES($1,'Test meal',$2,1000)",
    [product, category],
  );
  await db.query(
    "INSERT INTO inventory(service_id,product_id,opening) VALUES($1,$2,100)",
    [service, product],
  );
  await db.query(
    "INSERT INTO qr_codes(id,token_hash,kind,service_id,compartment_id,created_by,expires_at) VALUES($1,$2,'passenger',$3,$4,$5,now()+interval '1 day')",
    [randomUUID(), hash(qr), service, coach, adminId],
  );
  const publicPost = (
    path: string,
    body: object,
    raw = passengerToken,
    key = randomUUID(),
  ) =>
    request(app)
      .post("/api/public/" + path)
      .set("Origin", origin)
      .set("Cookie", `pantry_passenger_session=${raw}`)
      .set("X-Passenger-CSRF", csrf)
      .set("Idempotency-Key", key)
      .send(body);
  const adminPost = (path: string, body: object) =>
    request(app)
      .post("/api/admin/" + path)
      .set("Origin", origin)
      .set("Cookie", `pantry_session=${adminToken}`)
      .set("X-CSRF-Token", adminCsrf)
      .set("Idempotency-Key", randomUUID())
      .send(body);
  const staffPost = (body: object) =>
    request(app)
      .post("/api/staff/request-action")
      .set("Origin", origin)
      .set("X-Workspace", "staff")
      .set("Cookie", `pantry_staff_session=${staffToken}`)
      .set("X-CSRF-Token", staffCsrf)
      .set("Idempotency-Key", randomUUID())
      .send(body);
  const create = async (quantity = 1) =>
    (
      await publicPost("requests", {
        qr,
        seat: "24",
        items: [{ product_id: product, quantity }],
        payment_method: "online",
        amount: 1,
      }).expect(200)
    ).body;
  const record = (access: string) =>
    one(
      db,
      "SELECT r.*,p.provider_order_id,p.amount,p.refund_target,p.refunded_amount FROM requests r JOIN payment_orders p ON p.request_id=r.id WHERE access_hash=$1",
      [hash(access)],
    );
  const open = async (access: string) =>
    (await publicPost("payments/order", { access }).expect(200)).body;
  const verify = (
    access: string,
    payment: Row,
    value = signature(`${payment.order_id}|${payment.id}`),
  ) =>
    publicPost("payments/verify", {
      access,
      razorpay_order_id: payment.order_id,
      razorpay_payment_id: payment.id,
      razorpay_signature: value,
    });
  const webhook = (event: string, payment: Row, correct = true) => {
    const raw = JSON.stringify({
      event,
      payload: { payment: { entity: payment } },
    });
    return request(app)
      .post("/api/payments/webhook")
      .set("Content-Type", "application/json")
      .set(
        "X-Razorpay-Signature",
        correct ? signature(raw, webhookSecret) : "0".repeat(64),
      )
      .send(raw);
  };
  let first: Row, firstPayment: Row;
  try {
    await suite.test(
      "computes amount from database prices and blocks unpaid staff assignment",
      async () => {
        first = await create();
        assert.equal(first.payment_required, true);
        const saved = await record(first.access);
        assert.equal(saved.amount, 1000);
        assert.equal(saved.payment_status, "pending");
        await adminPost("assign", {
          request_id: saved.id,
          staff_id: staffId,
        }).expect(409);
        const checkout = await open(first.access);
        assert.equal(checkout.amount, 1000);
        assert.equal(checkout.key_id, gateway.keyId);
        assert.equal(checkout.mode, "test");
        await open(first.access);
        assert.equal(gateway.ordersCreated, 1);
        await publicPost(
          "payments/order",
          { access: first.access },
          otherToken,
        ).expect(404);
        await request(app)
          .post("/api/public/payments/order")
          .set("Origin", origin)
          .send({ access: first.access })
          .expect(401);
        await request(app)
          .post("/api/public/payments/order")
          .set("Origin", origin)
          .set("Cookie", `pantry_passenger_session=${passengerToken}`)
          .send({ access: first.access })
          .expect(403);
        const privateView = await request(app)
          .get("/api/public/request/" + first.access)
          .expect(200);
        assert.equal(privateView.body.can_pay, false);
        assert.equal(privateView.body.passenger_csrf, null);
      },
    );
    await suite.test(
      "rejects forged signatures, wrong amounts and wrong currencies before marking paid",
      async () => {
        const order = (await record(first.access)).provider_order_id;
        firstPayment = gateway.settle(order);
        await verify(first.access, firstPayment, "0".repeat(64)).expect(400);
        firstPayment.amount = 1;
        await verify(first.access, firstPayment).expect(409);
        firstPayment.amount = 1000;
        firstPayment.currency = "USD";
        await verify(first.access, firstPayment).expect(409);
        assert.equal((await record(first.access)).payment_status, "pending");
        firstPayment.currency = "INR";
        assert.equal(
          (await verify(first.access, firstPayment).expect(200)).body.paid,
          true,
        );
        await verify(first.access, firstPayment).expect(200);
        assert.equal(
          (
            await one(
              db,
              "SELECT count(*)::int AS total FROM audit WHERE action='payment_captured' AND entity_id=$1",
              [(await record(first.access)).id],
            )
          ).total,
          1,
        );
      },
    );
    await suite.test(
      "captures an authorized payment once and recovers a lost browser callback",
      async () => {
        const created = await create(),
          checkout = await open(created.access);
        const payment = gateway.settle(checkout.order_id, "authorized");
        assert.equal(
          (await verify(created.access, payment).expect(200)).body.paid,
          true,
        );
        await verify(created.access, payment).expect(200);
        assert.equal(gateway.captures, 1);
        const dropped = await create(),
          droppedOrder = await open(dropped.access);
        gateway.settle(droppedOrder.order_id);
        await publicPost("payments/status", { access: dropped.access }).expect(
          200,
        );
        assert.equal((await record(dropped.access)).payment_status, "paid");
      },
    );
    await suite.test(
      "authenticates raw webhooks, handles replay and never downgrades captured payments",
      async () => {
        const created = await create(),
          checkout = await open(created.access),
          payment = gateway.settle(checkout.order_id);
        await webhook("payment.captured", payment, false).expect(400);
        assert.equal((await record(created.access)).payment_status, "pending");
        await webhook("payment.captured", payment).expect(200);
        await webhook("payment.captured", payment).expect(200);
        await webhook("payment.failed", {
          ...payment,
          status: "failed",
        }).expect(200);
        assert.equal((await record(created.access)).payment_status, "paid");
        await app.locals.payments.drain();
      },
    );
    await suite.test(
      "refunds a cancellation safely after a provider timeout without double refunding",
      async () => {
        gateway.timeoutRefund = true;
        await publicPost("cancel", { access: first.access }).expect(200);
        await app.locals.payments.maintain(true);
        const saved = await record(first.access);
        assert.equal(saved.status, "cancelled");
        assert.equal(saved.refund_target, 1000);
        const job = await one(
          db,
          "SELECT * FROM payment_refunds WHERE request_id=$1",
          [saved.id],
        );
        assert.equal(job.status, "failed");
        await db.query(
          "UPDATE payment_refunds SET next_retry_at=now()-interval '1 second' WHERE id=$1",
          [job.id],
        );
        const count = gateway.refundsCreated;
        await app.locals.payments.maintain(true);
        assert.equal(gateway.refundsCreated, count);
        assert.equal((await record(first.access)).refunded_amount, 1000);
      },
    );
    await suite.test(
      "expires unpaid reservations and refunds payments arriving after cancellation",
      async () => {
        const created = await create(),
          checkout = await open(created.access);
        const saved = await record(created.access);
        await db.query(
          "UPDATE payment_orders SET expires_at=now()-interval '1 second' WHERE request_id=$1",
          [saved.id],
        );
        await request(app)
          .get("/api/public/request/" + created.access)
          .expect(200);
        assert.equal((await record(created.access)).status, "cancelled");
        await publicPost("payments/order", { access: created.access }).expect(
          409,
        );
        const payment = gateway.settle(checkout.order_id);
        await webhook("payment.captured", payment).expect(200);
        await app.locals.payments.drain();
        assert.equal((await record(created.access)).refunded_amount, 1000);
      },
    );
    await suite.test(
      "refunds only undelivered items after a partial staff delivery",
      async () => {
        const created = await create(3),
          checkout = await open(created.access),
          payment = gateway.settle(checkout.order_id);
        await verify(created.access, payment).expect(200);
        await app.locals.payments.drain();
        const saved = await record(created.access);
        await adminPost("assign", {
          request_id: saved.id,
          staff_id: staffId,
        }).expect(200);
        await staffPost({ request_id: saved.id, action: "start" }).expect(200);
        await db.query(
          "INSERT INTO carried(user_id,service_id,product_id,quantity) VALUES($1,$2,$3,1)",
          [staffId, service, product],
        );
        await staffPost({
          request_id: saved.id,
          action: "deliver",
          items: [{ product_id: product, quantity: 1 }],
        }).expect(200);
        await app.locals.payments.maintain(true);
        const after = await record(created.access);
        assert.equal(after.status, "delivered");
        assert.equal(after.refund_target, 2000);
        assert.equal(after.refunded_amount, 2000);
        const count = gateway.refundsCreated;
        await app.locals.payments.maintain(true);
        assert.equal(gateway.refundsCreated, count);
      },
    );
    await suite.test(
      "records external refunds and prevents staff serving refunded payments",
      async () => {
        const created = await create(),
          checkout = await open(created.access),
          payment = gateway.settle(checkout.order_id);
        await verify(created.access, payment).expect(200);
        await app.locals.payments.drain();
        const saved = await record(created.access);
        await adminPost("assign", {
          request_id: saved.id,
          staff_id: staffId,
        }).expect(200);
        payment.amount_refunded = payment.amount;
        payment.status = "refunded";
        const raw = JSON.stringify({
          event: "refund.processed",
          payload: {
            refund: {
              entity: {
                id: "rfnd_external",
                payment_id: payment.id,
                amount: payment.amount,
                currency: "INR",
                notes: {},
              },
            },
          },
        });
        await request(app)
          .post("/api/payments/webhook")
          .set("Content-Type", "application/json")
          .set("X-Razorpay-Signature", signature(raw, webhookSecret))
          .send(raw)
          .expect(200);
        await app.locals.payments.drain();
        await staffPost({ request_id: saved.id, action: "start" }).expect(409);
        const before = gateway.refundsCreated;
        await adminPost("cancel", {
          request_id: saved.id,
          reason: "Payment refunded externally",
        }).expect(200);
        await app.locals.payments.maintain(true);
        assert.equal(gateway.refundsCreated, before);
        assert.equal(
          (await record(created.access)).refunded_amount,
          payment.amount,
        );
      },
    );
    await suite.test(
      "cancellation refunds only the remainder after an external partial refund",
      async () => {
        const created = await create(),
          checkout = await open(created.access),
          payment = gateway.settle(checkout.order_id);
        await verify(created.access, payment).expect(200);
        await app.locals.payments.drain();
        payment.amount_refunded = 200;
        const raw = JSON.stringify({
          event: "refund.processed",
          payload: {
            refund: {
              entity: {
                id: "rfnd_partialexternal",
                payment_id: payment.id,
                amount: 200,
                currency: "INR",
                notes: {},
              },
            },
          },
        });
        await request(app)
          .post("/api/payments/webhook")
          .set("Content-Type", "application/json")
          .set("X-Razorpay-Signature", signature(raw, webhookSecret))
          .send(raw)
          .expect(200);
        await app.locals.payments.drain();
        await publicPost("cancel", { access: created.access }).expect(200);
        await app.locals.payments.maintain(true);
        const saved = await record(created.access);
        const job = await one(
          db,
          "SELECT * FROM payment_refunds WHERE request_id=$1",
          [saved.id],
        );
        assert.equal(job.amount, 800);
        assert.equal(saved.refunded_amount, 1000);
        assert.equal(payment.amount_refunded, 1000);
      },
    );
    await suite.test(
      "authenticates scheduled payment maintenance independently of browser sessions",
      async () => {
        await request(app).post("/api/internal/payments/reconcile").expect(403);
        await request(app)
          .post("/api/internal/payments/reconcile")
          .set("X-Pantry-Maintenance-Secret", "incorrect")
          .expect(403);
        await request(app)
          .post("/api/internal/payments/reconcile")
          .set("X-Pantry-Maintenance-Secret", proxySecret)
          .expect(200);
      },
    );
    await suite.test(
      "disabled payment configuration rejects online requests without reserving stock",
      async () => {
        const disabled = createApp(db, {
          origin,
          replaySecret: secret,
          disableRateLimit: true,
          otpProvider: {
            mode: "console",
            async send() {
              return null;
            },
          },
        });
        const before = (
          await one(
            db,
            "SELECT reserved FROM inventory WHERE service_id=$1 AND product_id=$2",
            [service, product],
          )
        ).reserved;
        await request(disabled)
          .post("/api/public/requests")
          .set("Origin", origin)
          .set("Cookie", `pantry_passenger_session=${passengerToken}`)
          .set("X-Passenger-CSRF", csrf)
          .set("Idempotency-Key", randomUUID())
          .send({
            qr,
            seat: "24",
            items: [{ product_id: product, quantity: 1 }],
            payment_method: "online",
          })
          .expect(503);
        assert.equal(
          (
            await one(
              db,
              "SELECT reserved FROM inventory WHERE service_id=$1 AND product_id=$2",
              [service, product],
            )
          ).reserved,
          before,
        );
      },
    );
  } finally {
    await app.locals.payments.drain();
    await db.close();
  }
});
