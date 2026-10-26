import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { token } from "../server/security.js";

const root = resolve(".data");
await mkdir(root, { recursive: true });
const directory = await mkdtemp(resolve(root, "compiled-check-"));
const origin = "http://127.0.0.1:4181";
const server = spawn(process.execPath, ["build/server/index.js"], {
  env: {
    ...process.env,
    NODE_ENV: "development",
    DATABASE_URL: "",
    DATA_DIR: directory,
    REPLAY_SECRET: token(),
    PROXY_SECRET: "",
    OTP_PROVIDER: "console",
    APP_ORIGIN: origin,
    PORT: "4181",
    HOST: "127.0.0.1",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let output = "";
server.stdout.on("data", (chunk) => {
  output += chunk;
});
server.stderr.on("data", (chunk) => {
  output += chunk;
});
const closed = new Promise<void>((resolve) =>
  server.once("close", () => resolve()),
);
try {
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (server.exitCode !== null)
      throw new Error("Compiled server exited before readiness: " + output);
    try {
      ready = (await fetch(origin + "/api/health")).ok;
    } catch {
      ready = false;
    }
    if (ready) break;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  assert.ok(ready, "Compiled server did not become ready.");
  for (const path of ["/", "/staff", "/user"]) {
    const response = await fetch(origin + path);
    assert.equal(response.status, 200, path);
    assert.match(response.headers.get("content-type") || "", /text\/html/);
    await response.body?.cancel();
  }
  const video = await fetch(origin + "/images/railway-journey-v2.mp4", {
    method: "HEAD",
  });
  assert.equal(video.status, 200);
  assert.match(video.headers.get("content-type") || "", /video\/mp4/);
  console.log(
    "Compiled server check passed: database startup, admin/staff/passenger routes and railway video.",
  );
} finally {
  server.kill("SIGTERM");
  await closed;
  assert.ok(resolve(directory).startsWith(root + sep));
  await rm(directory, { recursive: true, force: true });
}
