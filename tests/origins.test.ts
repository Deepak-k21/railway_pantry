import { test } from "node:test";
import assert from "node:assert/strict";
import { isAllowedOrigin } from "../shared/origins.js";

test("local development accepts only loopback aliases with the configured scheme and port", () => {
  const configured = "http://localhost:5173";
  for (const allowed of [
    configured,
    "http://127.0.0.1:5173",
    "http://[::1]:5173",
  ])
    assert.equal(isAllowedOrigin(allowed, configured, true), true, allowed);
  for (const blocked of [
    undefined,
    "null",
    "invalid",
    "https://127.0.0.1:5173",
    "http://127.0.0.1:5174",
    "http://localhost.evil.test:5173",
    "http://192.168.1.2:5173",
    "http://127.0.0.2:5173",
    "http://evil.test:5173",
    "http://localhost:5173/path",
    "http://name@localhost:5173",
  ])
    assert.equal(
      isAllowedOrigin(blocked, configured, true),
      false,
      blocked ?? "missing origin",
    );
  assert.equal(
    isAllowedOrigin(configured, "http://127.0.0.1:5173", true),
    true,
  );
});

test("production and nonlocal origins stay restricted to the configured origin", () => {
  assert.equal(
    isAllowedOrigin("http://localhost:5173", "http://localhost:5173"),
    true,
  );
  assert.equal(
    isAllowedOrigin("http://127.0.0.1:5173", "http://localhost:5173"),
    false,
  );
  assert.equal(
    isAllowedOrigin("https://pantry.example", "https://pantry.example"),
    true,
  );
  assert.equal(
    isAllowedOrigin("https://other.example", "https://pantry.example"),
    false,
  );
  assert.equal(
    isAllowedOrigin("http://localhost:5173", "https://pantry.example", true),
    false,
  );
});
