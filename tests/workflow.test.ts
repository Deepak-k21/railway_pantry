import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { database, migrate, one } from "../server/db.js";
import { createApp, createAdmin } from "../server/app.js";

test("real database: complete pantry workflow, permissions, QR lifecycle and stock integrity", async (suite) => {
  const db = await database();
  await migrate(db);
  const origin = "http://localhost:5173";
  let otpCode = "";
  let passengerCsrf = "";
  const app = createApp(db, {
    origin,
    disableRateLimit: true,
    otpProvider: {
      mode: "console",
      async send(_phone, code) {
        otpCode = code;
        return null;
      },
    },
  });
  const admin = request.agent(app),
    staff = request.agent(app),
    other = request.agent(app),
    passenger = request.agent(app);
  const adminPassword = "Test-only-admin-password-297!";
  await createAdmin(
    db,
    "admin@example.test",
    adminPassword,
    "Test Administrator",
  );
  const login = await admin
    .post("/api/auth/login")
    .set("Origin", origin)
    .send({ email: "admin@example.test", password: adminPassword })
    .expect(200);
  const csrf = login.body.csrf;
  let staffCsrf = "";
  let serviceId = "",
    compartmentId = "",
    productId = "",
    staffId = "",
    passengerQr = "",
    locationQr = "",
    itemQr = "",
    requestId = "",
    access = "",
    qrId = "";
  const post = (
    agent: typeof admin,
    url: string,
    body: object,
    sessionCsrf = csrf,
    key = randomUUID(),
  ) =>
    agent
      .post("/api" + url)
      .set("Origin", origin)
      .set("X-CSRF-Token", sessionCsrf)
      .set("Idempotency-Key", key)
      .send(body);
  const publicPost = (url: string, body: object, key = randomUUID()) =>
    passenger
      .post("/api" + url)
      .set("Origin", origin)
      .set("X-Passenger-CSRF", passengerCsrf)
      .set("Idempotency-Key", key)
      .send(body);
  try {
    await suite.test(
      "fresh install is empty and administrator setup cannot repeat",
      async () => {
        const data = await admin.get("/api/admin/data").expect(200);
        assert.equal(data.body.services.length, 0);
        assert.equal(data.body.products.length, 0);
        await assert.rejects(
          createAdmin(db, "second@example.test", adminPassword, "Second"),
          /already exists/,
        );
      },
    );
    await suite.test("enforces authentication, origin and CSRF", async () => {
      await passenger.get("/api/admin/data").expect(401);
      await admin
        .post("/api/admin/categories")
        .set("Origin", "https://evil.example")
        .send({ name: "X" })
        .expect(403);
      await admin
        .post("/api/admin/categories")
        .set("Origin", origin)
        .send({ name: "X" })
        .expect(403);
      await passenger
        .post("/api/auth/login")
        .set("Origin", origin)
        .send({ email: "admin@example.test", password: "wrong" })
        .expect(401);
    });
    await suite.test(
      "creates service, compartment, catalogue, stock and staff",
      async () => {
        serviceId = (
          await post(admin, "/admin/services", {
            name: "Test Express",
            number: "12345",
            origin: "Station A",
            destination: "Station B",
            service_date: "2026-10-18",
          }).expect(200)
        ).body.id;
        compartmentId = (
          await post(admin, "/admin/compartments", {
            service_id: serviceId,
            code: "S1",
          }).expect(200)
        ).body.id;
        const category = (
          await post(admin, "/admin/categories", { name: "Beverages" }).expect(
            200,
          )
        ).body.id;
        productId = (
          await post(admin, "/admin/products", {
            name: "Water",
            category_id: category,
            price: 2000,
          }).expect(200)
        ).body.id;
        await post(admin, "/admin/stock", {
          service_id: serviceId,
          product_id: productId,
          opening: true,
          quantity: 3,
          reason: "Initial stock",
        }).expect(200);
        await post(admin, "/admin/stock", {
          service_id: serviceId,
          product_id: productId,
          opening: true,
          quantity: 3,
          reason: "Duplicate opening",
        }).expect(409);
        staffId = (
          await post(admin, "/admin/staff", {
            name: "Test Staff",
            email: "staff@example.test",
            password: "Test-only-staff-password-297!",
            service_id: serviceId,
          }).expect(200)
        ).body.id;
        staffCsrf = (
          await staff
            .post("/api/auth/login")
            .set("Origin", origin)
            .send({
              email: "staff@example.test",
              password: "Test-only-staff-password-297!",
            })
            .expect(200)
        ).body.csrf;
        await staff.get("/api/admin/data").expect(403);
      },
    );
    await suite.test(
      "admin and staff can sign in and sign out from either local address",
      async () => {
        for (const address of [
          origin,
          "http://127.0.0.1:5173",
          "http://[::1]:5173",
        ]) {
          for (const role of ["admin", "staff"]) {
            const browser = request.agent(app);
            const result = await browser
              .post("/api/auth/login")
              .set("Origin", address)
              .set("X-Workspace", role)
              .send({
                email: `${role}@example.test`,
                password:
                  role === "admin"
                    ? adminPassword
                    : "Test-only-staff-password-297!",
              })
              .expect(200);
            assert.equal(result.body.user.role, role);
            await browser
              .post("/api/auth/logout")
              .set("Origin", address)
              .set("X-Workspace", role)
              .set("X-CSRF-Token", result.body.csrf)
              .send({})
              .expect(200);
          }
        }
        await request(app)
          .post("/api/auth/login")
          .set("Origin", "http://localhost.evil.test:5173")
          .send({ email: "admin@example.test", password: adminPassword })
          .expect(403);
      },
    );
    await suite.test(
      "staff and admin have independent sessions in the same browser",
      async () => {
        const browser = request.agent(app);
        const adminLogin = await browser
          .post("/api/auth/login")
          .set("Origin", origin)
          .set("X-Workspace", "admin")
          .send({ email: "admin@example.test", password: adminPassword })
          .expect(200);
        assert.equal(
          (await browser.get("/api/auth/me").set("X-Workspace", "staff")).body
            .user,
          null,
        );
        await browser
          .post("/api/auth/login")
          .set("Origin", origin)
          .set("X-Workspace", "staff")
          .send({ email: "admin@example.test", password: adminPassword })
          .expect(403);
        const staffLogin = await browser
          .post("/api/auth/login")
          .set("Origin", origin)
          .set("X-Workspace", "staff")
          .send({
            email: "staff@example.test",
            password: "Test-only-staff-password-297!",
          })
          .expect(200);
        assert.equal(
          (await browser.get("/api/auth/me").set("X-Workspace", "admin")).body
            .user.role,
          "admin",
        );
        assert.equal(
          (await browser.get("/api/auth/me").set("X-Workspace", "staff")).body
            .user.role,
          "staff",
        );
        await browser
          .get("/api/admin/data")
          .set("X-Workspace", "staff")
          .expect(403);
        await browser
          .get("/api/staff/data")
          .set("X-Workspace", "admin")
          .expect(403);
        await browser
          .post("/api/auth/logout")
          .set("Origin", origin)
          .set("X-Workspace", "staff")
          .set("X-CSRF-Token", adminLogin.body.csrf)
          .send({})
          .expect(403);
        await browser
          .post("/api/auth/logout")
          .set("Origin", origin)
          .set("X-Workspace", "staff")
          .set("X-CSRF-Token", staffLogin.body.csrf)
          .send({})
          .expect(200);
        assert.equal(
          (await browser.get("/api/auth/me").set("X-Workspace", "staff")).body
            .user,
          null,
        );
        await browser
          .get("/api/admin/data")
          .set("X-Workspace", "admin")
          .expect(200);
      },
    );
    await suite.test(
      "generates real QR images with random server-validated tokens",
      async () => {
        for (const kind of ["passenger", "location", "item"]) {
          const result = await post(admin, "/admin/qr", {
            kind,
            service_id: serviceId,
            ...(kind === "item"
              ? { product_id: productId }
              : { compartment_id: compartmentId }),
            days: 1,
          }).expect(200);
          assert.match(result.body.image, /^data:image\/png;base64,/);
          const reopened = await admin
            .get("/api/admin/qr/" + result.body.id)
            .expect(200);
          assert.equal(reopened.body.url, result.body.url);
          await passenger.get("/api/admin/qr/" + result.body.id).expect(401);
          const stored = await one(
            db,
            "SELECT encrypted_token FROM qr_codes WHERE id=$1",
            [result.body.id],
          );
          assert.ok(
            !JSON.stringify(stored).includes(result.body.url.split("/").pop()),
          );
          const raw = result.body.url.split("/").pop();
          if (kind === "passenger") {
            passengerQr = raw;
            qrId = result.body.id;
          } else if (kind === "location") locationQr = raw;
          else itemQr = raw;
        }
        const catalogue = await passenger
          .get("/api/public/qr/" + passengerQr)
          .expect(200);
        assert.equal(catalogue.body.context.compartment, "S1");
        assert.deepEqual(catalogue.body.products, []);
        assert.equal(catalogue.body.passenger, null);
        const challenge = await publicPost("/public/auth/send-otp", {
          qr: passengerQr,
          mobile: "9876543210",
        }).expect(200);
        const verified = await publicPost("/public/auth/verify-otp", {
          qr: passengerQr,
          challenge: challenge.body.challenge,
          code: otpCode,
        }).expect(200);
        passengerCsrf = verified.body.passenger.csrf;
        const unlocked = await passenger
          .get("/api/public/qr/" + passengerQr)
          .expect(200);
        assert.equal(unlocked.body.products[0].available, 3);
        await passenger.get("/api/public/qr/" + itemQr).expect(403);
        await passenger.get("/api/public/qr/" + "x".repeat(43)).expect(404);
      },
    );
    await suite.test(
      "reserves stock once under retried passenger submissions",
      async () => {
        const body = {
          qr: passengerQr,
          seat: "24",
          items: [{ product_id: productId, quantity: 2 }],
        };
        const key = randomUUID();
        const created = await publicPost("/public/requests", body, key).expect(
          200,
        );
        const retried = await publicPost("/public/requests", body, key).expect(
          200,
        );
        assert.deepEqual(retried.body, created.body);
        access = created.body.access;
        const tracked = await passenger
          .get("/api/public/request/" + access)
          .expect(200);
        requestId = tracked.body.id;
        const alerts = await admin.get("/api/admin/notifications").expect(200);
        assert.equal(alerts.body.services[0].service_id, serviceId);
        assert.equal(alerts.body.services[0].pending, 1);
        await passenger.get("/api/admin/notifications").expect(401);
        await staff.get("/api/admin/notifications").expect(403);
        assert.equal(tracked.body.staff_id, undefined);
        assert.equal(tracked.body.access_hash, undefined);
        assert.equal(
          (await one(db, "SELECT reserved FROM inventory")).reserved,
          2,
        );
        await publicPost(
          "/public/requests",
          { ...body, seat: "25" },
          key,
        ).expect(409);
      },
    );
    await suite.test(
      "staff previews require admin and future journey QRs survive until the service date",
      async () => {
        const preview = await admin
          .get("/api/admin/staff-preview/" + staffId)
          .expect(200);
        assert.ok(Array.isArray(preview.body.carried));
        await staff.get("/api/admin/staff-preview/" + staffId).expect(403);
        await staff.get("/api/admin/qr/" + qrId).expect(403);
        assert.equal(preview.body.password_hash, undefined);
        await passenger.get("/api/admin/staff-preview/" + staffId).expect(401);
        const futureDate = new Date(Date.now() + 10 * 86400000)
          .toISOString()
          .slice(0, 10);
        await db.query("UPDATE services SET service_date=$1 WHERE id=$2", [
          futureDate,
          serviceId,
        ]);
        const generated = await post(admin, "/admin/qr", {
          kind: "passenger",
          service_id: serviceId,
          compartment_id: compartmentId,
          days: 1,
        }).expect(200);
        assert.ok(
          Date.parse(generated.body.expires_at) >
            Date.parse(futureDate + "T00:00:00+05:30"),
        );
        await db.query("UPDATE qr_codes SET encrypted_token=NULL WHERE id=$1", [
          generated.body.id,
        ]);
        await admin.get("/api/admin/qr/" + generated.body.id).expect(409);
        await db.query(
          "UPDATE services SET service_date='2026-10-18' WHERE id=$1",
          [serviceId],
        );
      },
    );
    await suite.test(
      "concurrent requests cannot reserve the same final unit",
      async () => {
        const body = {
          qr: passengerQr,
          seat: "25",
          items: [{ product_id: productId, quantity: 1 }],
        };
        const results = await Promise.all([
          publicPost("/public/requests", body),
          publicPost("/public/requests", body),
        ]);
        assert.deepEqual(
          results.map((result) => result.status).sort(),
          [200, 409],
        );
        assert.equal(
          (await one(db, "SELECT reserved FROM inventory")).reserved,
          3,
        );
        const winner = results.find((result) => result.status === 200)!;
        await publicPost("/public/cancel", {
          access: winner.body.access,
        }).expect(200);
        assert.equal(
          (await one(db, "SELECT reserved FROM inventory")).reserved,
          2,
        );
      },
    );
    await suite.test(
      "invalid quantities, service relationships and stock removals are rejected",
      async () => {
        await publicPost("/public/requests", {
          qr: passengerQr,
          seat: "1",
          items: [{ product_id: productId, quantity: -1 }],
        }).expect(400);
        await publicPost("/public/requests", {
          qr: passengerQr,
          seat: "1",
          items: [
            { product_id: productId, quantity: 1 },
            { product_id: productId, quantity: 1 },
          ],
        }).expect(400);
        await post(admin, "/admin/stock", {
          service_id: serviceId,
          product_id: productId,
          quantity: -2,
          reason: "Cannot remove reservation",
        }).expect(409);
        await post(admin, "/admin/qr", {
          service_id: serviceId,
          kind: "passenger",
          compartment_id: randomUUID(),
        }).expect(400);
      },
    );
    await suite.test(
      "failed multi-item submissions roll back every stock change",
      async () => {
        const before = await one(db, "SELECT reserved FROM inventory");
        const beforeCount = await one(
          db,
          "SELECT COUNT(*)::int AS count FROM requests",
        );
        await publicPost("/public/requests", {
          qr: passengerQr,
          seat: "27",
          items: [
            { product_id: productId, quantity: 1 },
            { product_id: randomUUID(), quantity: 1 },
          ],
        }).expect(409);
        assert.equal(
          (await one(db, "SELECT reserved FROM inventory")).reserved,
          before.reserved,
        );
        assert.equal(
          (await one(db, "SELECT COUNT(*)::int AS count FROM requests")).count,
          beforeCount.count,
        );
        await post(admin, "/admin/service-status", {
          id: serviceId,
          active: false,
        }).expect(409);
      },
    );
    await suite.test(
      "assignments are restricted and request price stays unchanged",
      async () => {
        await post(admin, "/admin/assign", {
          request_id: requestId,
          staff_id: staffId,
        }).expect(200);
        const product = await one(db, "SELECT * FROM products WHERE id=$1", [
          productId,
        ]);
        await post(admin, "/admin/products", {
          ...product,
          price: 3000,
        }).expect(200);
        assert.equal(
          (await passenger.get("/api/public/request/" + access)).body.items[0]
            .unit_price,
          2000,
        );
        await publicPost("/public/cancel", { access }).expect(409);
        assert.deepEqual(
          (await admin.get("/api/admin/notifications").expect(200)).body
            .services,
          [],
        );
        await post(admin, "/admin/staff-status", {
          id: staffId,
          active: false,
        }).expect(409);
        await post(admin, "/admin/staff", {
          name: "Other",
          email: "other@example.test",
          password: "Test-only-other-password-297!",
        }).expect(200);
        const otherCsrf = (
          await other.post("/api/auth/login").set("Origin", origin).send({
            email: "other@example.test",
            password: "Test-only-other-password-297!",
          })
        ).body.csrf;
        await post(
          other,
          "/staff/request-action",
          { request_id: requestId, action: "start" },
          otherCsrf,
        ).expect(404);
        await post(
          other,
          "/staff/qr-validate",
          { token: itemQr },
          otherCsrf,
        ).expect(403);
      },
    );
    await suite.test(
      "staff scan requires explicit confirmation and collection is idempotent",
      async () => {
        const validated = await post(
          staff,
          "/staff/qr-validate",
          { token: itemQr },
          staffCsrf,
        ).expect(200);
        assert.equal((await db.query("SELECT * FROM carried")).rows.length, 0);
        assert.equal(validated.body.encrypted_token, undefined);
        assert.equal(validated.body.token_hash, undefined);
        const key = randomUUID();
        for (let attempt = 0; attempt < 2; attempt++)
          await post(
            staff,
            "/staff/carry",
            { token: itemQr, quantity: 2 },
            staffCsrf,
            key,
          ).expect(200);
        assert.equal(
          (await one(db, "SELECT quantity FROM carried")).quantity,
          2,
        );
        await post(
          staff,
          "/staff/carry",
          { token: itemQr, quantity: 2 },
          staffCsrf,
        ).expect(409);
        await post(
          staff,
          "/staff/location",
          { token: locationQr },
          staffCsrf,
        ).expect(200);
        assert.equal(
          (await one(db, "SELECT compartment_id FROM locations"))
            .compartment_id,
          compartmentId,
        );
      },
    );
    await suite.test(
      "delivery transitions, actual quantities and ledger are atomic",
      async () => {
        await post(
          staff,
          "/staff/request-action",
          {
            request_id: requestId,
            action: "deliver",
            items: [{ product_id: productId, quantity: 1 }],
          },
          staffCsrf,
        ).expect(409);
        await post(
          staff,
          "/staff/request-action",
          { request_id: requestId, action: "start" },
          staffCsrf,
        ).expect(200);
        await post(
          staff,
          "/staff/request-action",
          {
            request_id: requestId,
            action: "deliver",
            items: [{ product_id: productId, quantity: 3 }],
          },
          staffCsrf,
        ).expect(400);
        const key = randomUUID();
        const body = {
          request_id: requestId,
          action: "deliver",
          items: [{ product_id: productId, quantity: 1 }],
        };
        await post(staff, "/staff/request-action", body, staffCsrf, key).expect(
          200,
        );
        await post(staff, "/staff/request-action", body, staffCsrf, key).expect(
          200,
        );
        const stock = await one(db, "SELECT * FROM inventory");
        assert.equal(stock.sold, 1);
        assert.equal(stock.reserved, 0);
        assert.equal(
          (await one(db, "SELECT quantity FROM carried")).quantity,
          1,
        );
        const tracked = (await passenger.get("/api/public/request/" + access))
          .body;
        assert.equal(tracked.status, "delivered");
        assert.equal(tracked.items[0].delivered, 1);
        await post(staff, "/staff/request-action", body, staffCsrf).expect(409);
      },
    );
    await suite.test(
      "stock returns and deactivation invalidate active sessions",
      async () => {
        await post(
          staff,
          "/staff/return",
          { service_id: serviceId, product_id: productId, quantity: 1 },
          staffCsrf,
        ).expect(200);
        await post(admin, "/admin/staff-status", {
          id: staffId,
          active: false,
        }).expect(200);
        await staff.get("/api/staff/data").expect(401);
      },
    );
    await suite.test(
      "QR regeneration, expiry and revocation are enforced",
      async () => {
        const generated = await post(admin, "/admin/qr", {
          kind: "passenger",
          service_id: serviceId,
          compartment_id: compartmentId,
          replace_id: qrId,
          days: 1,
        }).expect(200);
        await passenger.get("/api/public/qr/" + passengerQr).expect(410);
        await admin.get("/api/admin/qr/" + qrId).expect(410);
        const raw = generated.body.url.split("/").pop();
        await passenger.get("/api/public/qr/" + raw).expect(200);
        await db.query(
          "UPDATE qr_codes SET expires_at=now()-interval '1 hour' WHERE id=$1",
          [generated.body.id],
        );
        await passenger.get("/api/public/qr/" + raw).expect(410);
        await admin.get("/api/admin/qr/" + generated.body.id).expect(410);
        await post(admin, "/admin/qr-revoke", {
          id: generated.body.id,
          reason: "Retired code",
        }).expect(200);
        const audit = (await db.query("SELECT * FROM audit")).rows;
        assert.ok(audit.length > 10);
        assert.ok(!JSON.stringify(audit).includes(passengerQr));
      },
    );
    await suite.test(
      "administrative edits preserve relationships and tokens stay encrypted",
      async () => {
        const service = await one(db, "SELECT * FROM services WHERE id=$1", [
          serviceId,
        ]);
        await post(admin, "/admin/service-edit", {
          ...service,
          service_date: "2026-10-18",
          name: "Updated Express",
        }).expect(200);
        const category = await one(db, "SELECT * FROM categories");
        await post(admin, "/admin/category-edit", {
          id: category.id,
          name: "Drinks",
        }).expect(200);
        await post(admin, "/admin/compartment-edit", {
          id: compartmentId,
          code: "S01",
        }).expect(200);
        await post(admin, "/admin/staff-edit", {
          id: staffId,
          name: "Updated Staff",
          email: "staff@example.test",
          password: "Updated-test-password-938!",
        }).expect(200);
        const data = (await admin.get("/api/admin/data")).body;
        assert.equal(data.services[0].name, "Updated Express");
        assert.equal(data.products[0].category, "Drinks");
        assert.equal(
          data.requests.find((entry: { id: string }) => entry.id === requestId)
            .code,
          "S01",
        );
        assert.equal(data.summary.delivered, 1);
        const receipts = JSON.stringify(
          (await db.query("SELECT response FROM idempotency")).rows,
        );
        assert.ok(!receipts.includes(access));
        assert.ok(!receipts.includes(passengerQr));
        assert.ok(receipts.includes("sealed"));
        await post(admin, "/admin/service-status", {
          id: serviceId,
          active: false,
        }).expect(200);
      },
    );
    await suite.test("logout removes the session", async () => {
      await admin
        .post("/api/auth/logout")
        .set("Origin", origin)
        .set("X-CSRF-Token", csrf)
        .send({})
        .expect(200);
      await admin.get("/api/admin/data").expect(401);
    });
  } finally {
    await db.close();
  }
});
