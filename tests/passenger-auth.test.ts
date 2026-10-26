import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { createApp } from "../server/app.js";
import { database, migrate, one } from "../server/db.js";
import { Fault, hash, token } from "../server/security.js";
import { createOtpProvider } from "../server/passenger-auth.js";

test("passenger OTPs enforce identity, expiry, limits, browser binding and session protection", async (suite) => {
  const db = await database();
  await migrate(db);
  const origin = "http://localhost:5173",
    secret = token();
  const codes = new Map<string, string>();
  const provider = {
    mode: "console" as const,
    async send(phone: string, code: string) {
      codes.set(phone, code);
      return null;
    },
  };
  const options = {
    origin,
    replaySecret: secret,
    disableRateLimit: true,
    otpProvider: provider,
  };
  const app = createApp(db, options);
  const admin = randomUUID(),
    service = randomUUID(),
    compartment = randomUUID(),
    qrId = randomUUID(),
    qr = token(),
    otherQr = token();
  await db.query(
    "INSERT INTO users(id,name,email,password,role) VALUES($1,'Owner','owner@otp.test','unused','admin')",
    [admin],
  );
  await db.query(
    "INSERT INTO services(id,name,number,service_date,origin,destination) VALUES($1,'OTP Express','12345',CURRENT_DATE,'A','B')",
    [service],
  );
  await db.query(
    "INSERT INTO compartments(id,service_id,code) VALUES($1,$2,'S1')",
    [compartment, service],
  );
  for (const [raw, recordId] of [
    [qr, qrId],
    [otherQr, randomUUID()],
  ])
    await db.query(
      "INSERT INTO qr_codes(id,token_hash,kind,service_id,compartment_id,created_by,expires_at) VALUES($1,$2,'passenger',$3,$4,$5,now()+interval '1 day')",
      [recordId, hash(raw), service, compartment, admin],
    );
  const passenger = request.agent(app);
  const post = (agent: typeof passenger, endpoint: string, body: object) =>
    agent
      .post(`/api/public/${endpoint}`)
      .set("Origin", "http://127.0.0.1:5173")
      .set("Idempotency-Key", randomUUID())
      .send(body);
  const start = (agent: typeof passenger, mobile: string) =>
    post(agent, "auth/send-otp", { qr, mobile });
  const verify = (
    agent: typeof passenger,
    challenge: string,
    code: string,
    raw = qr,
  ) => post(agent, "auth/verify-otp", { qr: raw, challenge, code });
  let challenge = "",
    csrf = "",
    sessionCookie = "";
  try {
    await suite.test(
      "requires mobile verification on the API as well as the page",
      async () => {
        const page = await passenger.get(`/api/public/qr/${qr}`).expect(200);
        assert.equal(page.body.passenger, null);
        assert.deepEqual(page.body.products, []);
        await post(passenger, "requests", {}).expect(401);
        await start(passenger, "1234567890").expect(400);
        await passenger
          .post("/api/public/auth/send-otp")
          .set("Origin", "https://untrusted.test")
          .send({ qr, mobile: "9876543210" })
          .expect(403);
        const sent = await start(passenger, "9876543210").expect(200);
        challenge = sent.body.challenge;
        assert.equal(sent.body.delivery, "console");
        assert.equal(sent.body.code, undefined);
        assert.match(codes.get("+919876543210")!, /^\d{6}$/);
        const stored = await one(
          db,
          "SELECT * FROM passenger_otp_challenges WHERE id=$1",
          [challenge],
        );
        assert.ok(!JSON.stringify(stored).includes("9876543210"));
        assert.notEqual(stored.code_hash, codes.get("+919876543210"));
      },
    );
    await suite.test(
      "binds the code to the browser and QR and persists failed attempts",
      async () => {
        const code = codes.get("+919876543210")!;
        await verify(request.agent(app), challenge, code).expect(400);
        await verify(passenger, challenge, code, otherQr).expect(400);
        const wrong = code === "000000" ? "111111" : "000000";
        await verify(passenger, challenge, wrong).expect(400);
        assert.equal(
          (
            await one(
              db,
              "SELECT attempts FROM passenger_otp_challenges WHERE id=$1",
              [challenge],
            )
          ).attempts,
          1,
        );
        const result = await verify(passenger, challenge, code).expect(200);
        csrf = result.body.passenger.csrf;
        const cookies = result.headers["set-cookie"] as unknown as string[];
        sessionCookie = cookies
          .find((value: string) =>
            value.startsWith("pantry_passenger_session="),
          )!
          .split(";")[0];
        assert.match(result.body.passenger.mobile, /3210$/);
        assert.ok(
          cookies.some(
            (value: string) =>
              value.includes("HttpOnly") && value.includes("SameSite=Strict"),
          ),
        );
        await verify(passenger, challenge, code).expect(400);
        const unlocked = await passenger
          .get(`/api/public/qr/${qr}`)
          .expect(200);
        assert.equal(unlocked.body.passenger.csrf, csrf);
        assert.equal(
          (
            await request(createApp(db, options))
              .get(`/api/public/qr/${qr}`)
              .set("Cookie", sessionCookie)
              .expect(200)
          ).body.passenger.csrf,
          csrf,
        );
      },
    );
    await suite.test(
      "requires the passenger CSRF token and revokes sessions on logout",
      async () => {
        await post(passenger, "requests", {}).expect(403);
        await post(passenger, "requests", {})
          .set("X-Passenger-CSRF", csrf)
          .expect(400);
        await post(passenger, "auth/logout", {})
          .set("X-Passenger-CSRF", csrf)
          .expect(200);
        assert.equal(
          (await passenger.get(`/api/public/qr/${qr}`)).body.passenger,
          null,
        );
        await request(app)
          .post("/api/public/requests")
          .set("Origin", origin)
          .set("Cookie", sessionCookie)
          .set("X-Passenger-CSRF", csrf)
          .send({})
          .expect(401);
      },
    );
    await suite.test(
      "enforces resend cooldown and invalidates expired and exhausted codes",
      async () => {
        await start(passenger, "9876543210").expect(429);
        const sent = await start(passenger, "9876543211").expect(200);
        const correct = codes.get("+919876543211")!;
        const wrong = correct === "000000" ? "111111" : "000000";
        for (let attempt = 0; attempt < 5; attempt++)
          await verify(passenger, sent.body.challenge, wrong).expect(400);
        await verify(passenger, sent.body.challenge, correct).expect(429);
        const expired = await start(passenger, "9876543212").expect(200);
        await db.query(
          "UPDATE passenger_otp_challenges SET expires_at=now()-interval '1 second' WHERE id=$1",
          [expired.body.challenge],
        );
        await verify(
          passenger,
          expired.body.challenge,
          codes.get("+919876543212")!,
        ).expect(400);
      },
    );
    await suite.test(
      "limits repeated sends across browsers and preserves delivery failures",
      async () => {
        for (let attempt = 0; attempt < 5; attempt++) {
          await start(passenger, "9876543213").expect(200);
          await db.query(
            "UPDATE passenger_otp_challenges SET created_at=created_at-interval '61 seconds' WHERE phone_hash=(SELECT phone_hash FROM passenger_otp_challenges ORDER BY created_at DESC LIMIT 1)",
          );
        }
        await start(request.agent(app), "9876543213").expect(429);
        const failingApp = createApp(db, {
          ...options,
          otpProvider: {
            mode: "console",
            async send() {
              throw new Fault(503, "SMS unavailable");
            },
          },
        });
        await start(request.agent(failingApp), "9876543214").expect(503);
        assert.equal(
          (
            await one(
              db,
              "SELECT status FROM passenger_otp_challenges ORDER BY created_at DESC LIMIT 1",
            )
          ).status,
          "failed",
        );
      },
    );
    await suite.test("rejects console delivery in production", async () => {
      assert.throws(
        () => createApp(db, { ...options, production: true }),
        /SMS OTP/,
      );
      const previous = process.env.OTP_PROVIDER;
      try {
        process.env.OTP_PROVIDER = "console";
        assert.throws(() => createOtpProvider(true), /only available locally/);
      } finally {
        if (previous === undefined) delete process.env.OTP_PROVIDER;
        else process.env.OTP_PROVIDER = previous;
      }
    });
  } finally {
    await db.close();
  }
});
