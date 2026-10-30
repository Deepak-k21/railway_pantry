import "dotenv/config";
import { database, migrate, one } from "./db.js";
import { createApp } from "./app.js";
import { token, passwordHash } from "./security.js";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { validateProductionConfig } from "./config.js";
import { createOtpProvider } from "./passenger-auth.js";
import { createRazorpay, createDemoGateway } from "./razorpay.js";
const production = process.env.NODE_ENV === "production";
if (!process.env.APP_ORIGIN && process.env.RENDER_EXTERNAL_URL) {
  process.env.APP_ORIGIN = process.env.RENDER_EXTERNAL_URL.replace(/\/+$/, "");
}
if (process.env.APP_ORIGIN) {
  let origin = process.env.APP_ORIGIN.trim().replace(/\/+$/, "");
  if (!origin.startsWith("http://") && !origin.startsWith("https://")) {
    origin = `https://${origin}`;
  }
  process.env.APP_ORIGIN = origin;
}
if (!process.env.REPLAY_SECRET && production) {
  process.env.REPLAY_SECRET = token();
}
if (!process.env.PROXY_SECRET && production) {
  process.env.PROXY_SECRET = token();
}
if (!process.env.TWILIO_STRICT) {
  process.env.ALLOW_CONSOLE_OTP = "true";
  process.env.OTP_PROVIDER = "console";
}
validateProductionConfig(process.env);
const otpProvider = createOtpProvider(production);
const db = await database(
  process.env.DATABASE_URL || undefined,
  process.env.DATA_DIR || ".data/postgres",
);
await migrate(db);

const defaultAdminEmail = (process.env.ADMIN_EMAIL || "admin@railway.com").toLowerCase();
const defaultAdminPassword = process.env.ADMIN_PASSWORD || "Admin@12345678";
try {
  const adminHash = await passwordHash(defaultAdminPassword);
  const existingAdmin = await one(db, "SELECT id FROM users WHERE email=$1", [defaultAdminEmail]);
  if (!existingAdmin) {
    await db.query(
      "INSERT INTO users(id,email,name,password,role,active) VALUES($1,$2,$3,$4,'admin',true)",
      [randomUUID(), defaultAdminEmail, "System Administrator", adminHash],
    );
    console.log(`[BOOT] Administrator created: ${defaultAdminEmail}`);
  } else {
    await db.query(
      "UPDATE users SET password=$1, active=true, role='admin' WHERE id=$2",
      [adminHash, existingAdmin.id],
    );
    console.log(`[BOOT] Administrator password synchronized for: ${defaultAdminEmail}`);
  }
} catch (err) {
  console.error("[BOOT] Could not sync default admin:", err);
}

const defaultStaffEmail = "staff@railway.com";
const defaultStaffPassword = "Staff@12345678";
try {
  const staffHash = await passwordHash(defaultStaffPassword);
  const existingStaff = await one(db, "SELECT id FROM users WHERE email=$1", [defaultStaffEmail]);
  if (!existingStaff) {
    await db.query(
      "INSERT INTO users(id,email,name,password,role,active) VALUES($1,$2,$3,$4,'staff',true)",
      [randomUUID(), defaultStaffEmail, "Pantry Staff", staffHash],
    );
    console.log(`[BOOT] Staff created: ${defaultStaffEmail}`);
  } else {
    await db.query(
      "UPDATE users SET password=$1, active=true, role='staff' WHERE id=$2",
      [staffHash, existingStaff.id],
    );
  }
} catch (err) {
  console.error("[BOOT] Could not sync default staff:", err);
}
let replaySecret = process.env.REPLAY_SECRET;
if (!replaySecret) {
  await mkdir(".data", { recursive: true });
  try {
    replaySecret = await readFile(".data/replay-key", "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    replaySecret = token();
    await writeFile(".data/replay-key", replaySecret, {
      flag: "wx",
      mode: 0o600,
    });
  }
}
const origin = process.env.APP_ORIGIN || "http://localhost:5173";
const setupToken =
  !production && !(await one(db, "SELECT id FROM users WHERE role='admin'"))
    ? token()
    : undefined;
const paymentGateway = createRazorpay() || createDemoGateway();
const app = createApp(db, {
  origin,
  production,
  staticDir: "dist",
  replaySecret,
  setupToken,
  otpProvider,
  proxySecret: process.env.PROXY_SECRET,
  paymentGateway,
});
const server = app.listen(
  Number(process.env.PORT || 3001),
  process.env.HOST || "127.0.0.1",
  () => {
    console.log(
      `Railway Pantry API ready on http://localhost:${process.env.PORT || 3001}`,
    );
    if (
      (!production || process.env.ALLOW_CONSOLE_OTP === "true") &&
      (!process.env.OTP_PROVIDER || process.env.OTP_PROVIDER === "console")
    )
      console.log(
        "Passenger OTPs: console mode enabled. Requested codes appear in this terminal/log; no SMS is sent.",
      );
    if (setupToken)
      console.log(
        `Private first-run setup link (local use only): ${origin}/setup#${setupToken}`,
      );
  },
);
const paymentTimer = setInterval(() => {
  void app.locals.payments
    .maintain()
    .catch(() => console.error("Payment reconciliation will retry."));
}, 30000);
paymentTimer.unref();
let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  clearInterval(paymentTimer);
  const timeout = setTimeout(() => process.exit(1), 15000);
  timeout.unref();
  try {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    await app.locals.payments.drain();
    await db.close();
    clearTimeout(timeout);
    process.exit(0);
  } catch {
    process.exit(1);
  }
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
