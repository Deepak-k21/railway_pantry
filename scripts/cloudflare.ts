import { readFile, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parse } from "dotenv";
import { createRazorpay } from "../server/razorpay.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const config = JSON.parse(
  await readFile(new URL("../wrangler.json", import.meta.url), "utf8"),
);
const mode = process.argv[2];
const run = (program: string, args: string[], env = process.env) =>
  new Promise<void>((resolve, reject) => {
    const child = spawn(program, args, {
      cwd: root,
      env,
      stdio: "inherit",
      shell: false,
    });
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`Command exited with status ${code}.`)),
    );
  });
try {
  let origin: URL;
  try {
    origin = new URL(config.vars.APP_ORIGIN);
  } catch {
    throw new Error(
      "Set APP_ORIGIN in wrangler.json to your full public HTTPS origin.",
    );
  }
  if (
    origin.protocol !== "https:" ||
    origin.origin !== config.vars.APP_ORIGIN ||
    /YOUR-SUBDOMAIN/i.test(origin.hostname)
  )
    throw new Error(
      "Replace APP_ORIGIN in wrangler.json with your exact HTTPS website origin, without a trailing slash.",
    );
  if (mode === "init") {
    let replay: string;
    try {
      replay = (
        await readFile(new URL("../.data/replay-key", import.meta.url), "utf8")
      ).trim();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      replay = randomBytes(32).toString("base64url");
    }
    if (replay.length < 32)
      throw new Error(
        "The saved replay key is invalid; restore its private backup before deployment.",
      );
    try {
      await writeFile(
        new URL("../.env.cloudflare", import.meta.url),
        [
          "DATABASE_URL=",
          `REPLAY_SECRET=${replay}`,
          `PROXY_SECRET=${randomBytes(32).toString("base64url")}`,
          "TWILIO_ACCOUNT_SID=",
          "TWILIO_AUTH_TOKEN=",
          "TWILIO_VERIFY_SERVICE_SID=",
          "",
        ].join("\n"),
        { flag: "wx", mode: 0o600 },
      );
      console.log(
        "Private deployment configuration created. Existing local replay key preserved when available. Fill in the hosted database and Twilio credentials.",
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      console.log(
        "Private deployment configuration already exists and was kept unchanged.",
      );
    }
    process.exit(0);
  }
  const secrets = parse(
    await readFile(new URL("../.env.cloudflare", import.meta.url), "utf8"),
  );
  if (
    !secrets.DATABASE_URL ||
    !/^postgres(ql)?:\/\//.test(secrets.DATABASE_URL)
  )
    throw new Error(
      "Set DATABASE_URL in .env.cloudflare to your hosted PostgreSQL connection string.",
    );
  if (mode === "setup") {
    await run(process.execPath, ["--import", "tsx", "server/setup.ts"], {
      ...process.env,
      ...secrets,
      NODE_ENV: "production",
      APP_ORIGIN: origin.origin,
    });
  } else if (mode === "deploy" || mode === "ready") {
    for (const key of [
      "REPLAY_SECRET",
      "PROXY_SECRET",
      "TWILIO_ACCOUNT_SID",
      "TWILIO_AUTH_TOKEN",
      "TWILIO_VERIFY_SERVICE_SID",
    ])
      if (!secrets[key]?.trim())
        throw new Error(`Set ${key} in .env.cloudflare before deployment.`);
    if (secrets.REPLAY_SECRET.length < 32 || secrets.PROXY_SECRET.length < 32)
      throw new Error(
        "REPLAY_SECRET and PROXY_SECRET must each have at least 32 random characters.",
      );
    if (
      !/^AC[0-9a-f]{32}$/i.test(secrets.TWILIO_ACCOUNT_SID) ||
      !/^VA[0-9a-f]{32}$/i.test(secrets.TWILIO_VERIFY_SERVICE_SID)
    )
      throw new Error(
        "Check the Twilio Account SID (AC…) and Verify Service SID (VA…).",
      );
    const allowed = new Set([
      "DATABASE_URL",
      "REPLAY_SECRET",
      "PROXY_SECRET",
      "TWILIO_ACCOUNT_SID",
      "TWILIO_AUTH_TOKEN",
      "TWILIO_VERIFY_SERVICE_SID",
      "PAYMENTS_MODE",
      "RAZORPAY_KEY_ID",
      "RAZORPAY_KEY_SECRET",
      "RAZORPAY_WEBHOOK_SECRET",
    ]);
    createRazorpay(secrets);
    if (Object.keys(secrets).some((key) => !allowed.has(key)))
      throw new Error(
        "Keep only the keys from .env.cloudflare.example in .env.cloudflare; other settings belong in wrangler.json.",
      );
    await run("docker", ["info", "--format", "{{.OSType}}"]);
    console.log(
      "Cloudflare configuration is ready. No credential values were printed.",
    );
    if (mode === "deploy")
      await run(process.execPath, [
        fileURLToPath(
          new URL("../node_modules/wrangler/bin/wrangler.js", import.meta.url),
        ),
        "deploy",
        "--secrets-file",
        ".env.cloudflare",
      ]);
  } else throw new Error("Choose init, ready, setup or deploy.");
} catch (error) {
  console.error(
    error instanceof Error && (error as NodeJS.ErrnoException).code === "ENOENT"
      ? "A required file or Docker executable is missing. Copy .env.cloudflare.example to .env.cloudflare and install Docker Desktop; see DEPLOY_CLOUDFLARE.md."
      : error instanceof Error
        ? error.message
        : "Cloudflare preparation failed.",
  );
  process.exitCode = 1;
}
