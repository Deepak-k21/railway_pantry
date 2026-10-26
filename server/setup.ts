import "dotenv/config";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { database, migrate } from "./db.js";
import { createAdmin } from "./app.js";
if (process.env.NODE_ENV === "production" && !process.env.DATABASE_URL)
  throw new Error(
    "Set the hosted PostgreSQL DATABASE_URL before production administrator setup.",
  );
const terminal = createInterface({ input: stdin, output: stdout });
const db = await database(
  process.env.DATABASE_URL || undefined,
  process.env.DATA_DIR || ".data/postgres",
);
try {
  await migrate(db);
  const name = await terminal.question("Administrator display name: ");
  const email = await terminal.question("Administrator email: ");
  const password = await terminal.question(
    "Password (12+ characters; visible in this local terminal): ",
  );
  await createAdmin(db, email, password, name);
  console.log(
    `Administrator created. Sign in at ${process.env.APP_ORIGIN || "http://localhost:5173"}.`,
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : "Setup failed.");
  process.exitCode = 1;
} finally {
  terminal.close();
  await db.close();
}
