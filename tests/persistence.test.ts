import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { database, migrate, one } from "../server/db.js";

test("local PostgreSQL data survives a complete close and reopen", async () => {
  const root = resolve(".data");
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(resolve(root, "persistence-test-"));
  let db = await database(undefined, directory);
  try {
    await migrate(db);
    const category = randomUUID();
    await db.query("INSERT INTO categories(id,name) VALUES($1,$2)", [
      category,
      "Persistence verification",
    ]);
    await db.close();
    db = await database(undefined, directory);
    await migrate(db);
    assert.equal(
      (await one(db, "SELECT name FROM categories WHERE id=$1", [category]))
        .name,
      "Persistence verification",
    );
  } finally {
    await db.close();
    assert.ok(resolve(directory).startsWith(root + sep));
    await rm(directory, { recursive: true, force: true });
  }
});
