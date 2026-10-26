import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import request from "supertest";
import { configureTrustedProxy } from "../server/proxy.js";
import { validateProductionConfig } from "../server/config.js";

test("production rejects ephemeral storage and malformed public origins", () => {
  const env = {
    NODE_ENV: "production",
    DATABASE_URL: "postgresql://database.example/pantry",
    APP_ORIGIN: "https://pantry.example",
    REPLAY_SECRET: "r".repeat(32),
  };
  assert.doesNotThrow(() => validateProductionConfig(env));
  assert.throws(
    () => validateProductionConfig({ ...env, DATABASE_URL: "" }),
    /PostgreSQL/,
  );
  assert.throws(
    () => validateProductionConfig({ ...env, DATABASE_URL: ".data/postgres" }),
    /PostgreSQL/,
  );
  assert.throws(
    () =>
      validateProductionConfig({ ...env, APP_ORIGIN: "http://pantry.example" }),
    /HTTPS/,
  );
  assert.throws(
    () =>
      validateProductionConfig({
        ...env,
        APP_ORIGIN: "https://pantry.example/",
      }),
    /trailing slash/,
  );
  assert.throws(
    () => validateProductionConfig({ ...env, REPLAY_SECRET: "short" }),
    /REPLAY_SECRET/,
  );
  assert.throws(
    () => validateProductionConfig({ ...env, PROXY_SECRET: "short" }),
    /PROXY_SECRET/,
  );
  assert.doesNotThrow(() =>
    validateProductionConfig({ NODE_ENV: "development" }),
  );
});

test("client-IP rate limits trust only the authenticated Cloudflare proxy header", async () => {
  const secret = "proxy-key-".repeat(5);
  const app = express();
  configureTrustedProxy(app, secret);
  app.get("/", (req, res) =>
    res.json({
      ip: req.ip,
      secret: req.header("X-Pantry-Proxy-Secret") || null,
    }),
  );
  const direct = (await request(app).get("/").expect(200)).body.ip;
  const spoofed = await request(app)
    .get("/")
    .set("X-Forwarded-For", "203.0.113.20")
    .set("Forwarded", "for=203.0.113.20")
    .set("X-Pantry-Client-IP", "203.0.113.20")
    .set("X-Pantry-Proxy-Secret", "wrong")
    .expect(200);
  assert.equal(spoofed.body.ip, direct);
  assert.equal(spoofed.body.secret, null);
  const trusted = await request(app)
    .get("/")
    .set("X-Pantry-Client-IP", "203.0.113.20")
    .set("X-Pantry-Proxy-Secret", secret)
    .expect(200);
  assert.equal(trusted.body.ip, "203.0.113.20");
  const invalid = await request(app)
    .get("/")
    .set("X-Pantry-Client-IP", "not-an-ip")
    .set("X-Pantry-Proxy-Secret", secret)
    .expect(200);
  assert.equal(invalid.body.ip, direct);
});
