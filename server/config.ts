export function validateProductionConfig(
  env: Record<string, string | undefined>,
) {
  if (env.NODE_ENV !== "production") return;
  let origin: URL;
  try {
    origin = new URL(env.APP_ORIGIN || "");
  } catch {
    throw new Error("Production requires a valid HTTPS APP_ORIGIN.");
  }
  if (origin.protocol !== "https:" || origin.origin !== env.APP_ORIGIN)
    throw new Error(
      "APP_ORIGIN must be an exact HTTPS origin without a path or trailing slash.",
    );
  if (!env.DATABASE_URL || !/^postgres(ql)?:\/\//.test(env.DATABASE_URL))
    throw new Error(
      "Production requires a PostgreSQL DATABASE_URL; local database files cannot be used.",
    );
  if (!env.REPLAY_SECRET || env.REPLAY_SECRET.length < 32)
    throw new Error(
      "Production requires a stable random REPLAY_SECRET of at least 32 characters.",
    );
  if (env.PROXY_SECRET && env.PROXY_SECRET.length < 32)
    throw new Error("PROXY_SECRET must have at least 32 random characters.");
}
