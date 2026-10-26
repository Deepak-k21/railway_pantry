import {
  createHmac,
  randomInt,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import type { Express, NextFunction, Request, Response } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { type Database, type Row, type Sql, one } from "./db.js";
import { hash, requireThat, seal, token, unseal } from "./security.js";

export interface OtpProvider {
  mode: "console" | "sms";
  send(phone: string, code: string): Promise<string | null>;
  check?(verificationId: string, code: string): Promise<boolean>;
}

export function createOtpProvider(production: boolean): OtpProvider {
  const allowConsole = process.env.ALLOW_CONSOLE_OTP === "true";
  const mode = process.env.OTP_PROVIDER || (production && !allowConsole ? "twilio" : "console");
  if (mode === "console") {
    if (production && !allowConsole)
      throw new Error(
        "Console OTPs are only available locally. Configure Twilio Verify for production.",
      );
    return {
      mode: "console",
      async send(phone, code) {
        console.log(
          `[LOCAL PASSENGER OTP] Mobile ending ${phone.slice(-4)}: ${code} (valid for 5 minutes; no SMS sent)`,
        );
        return null;
      },
    };
  }
  if (mode !== "twilio")
    throw new Error("OTP_PROVIDER must be console or twilio.");
  const account = process.env.TWILIO_ACCOUNT_SID;
  const auth = process.env.TWILIO_AUTH_TOKEN;
  const service = process.env.TWILIO_VERIFY_SERVICE_SID;
  if (!account || !auth || !service || !/^VA[0-9a-f]{32}$/i.test(service))
    throw new Error(
      "Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_VERIFY_SERVICE_SID for SMS OTPs.",
    );
  const call = async (resource: string, fields: Record<string, string>) => {
    const response = await fetch(
      `https://verify.twilio.com/v2/Services/${service}/${resource}`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(`${account}:${auth}`).toString("base64")}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams(fields),
        signal: AbortSignal.timeout(10000),
      },
    );
    if (response.status === 404 && resource === "VerificationCheck")
      return { status: "expired" };
    requireThat(
      response.ok,
      response.status === 429 ? 429 : 503,
      response.status === 429
        ? "Too many OTP attempts. Please wait before trying again."
        : "SMS verification is temporarily unavailable. Please try again shortly.",
    );
    return response.json();
  };
  return {
    mode: "sms",
    async send(phone) {
      const result = await call("Verifications", { To: phone, Channel: "sms" });
      requireThat(
        result.status === "pending" && typeof result.sid === "string",
        503,
        "The verification code could not be sent.",
      );
      return result.sid;
    },
    async check(verificationId, code) {
      return (
        (
          await call("VerificationCheck", {
            VerificationSid: verificationId,
            Code: code,
          })
        ).status === "approved"
      );
    },
  };
}

export type PassengerRequest = Request & { passenger?: Row };

export function registerPassengerAuth(
  app: Express,
  db: Database,
  options: {
    secret: string;
    production: boolean;
    provider: OtpProvider;
    disableRateLimit?: boolean;
    resolveQr: (sql: Sql, raw: string) => Promise<Row>;
  },
) {
  const { secret, provider } = options;
  requireThat(
    !options.production ||
      provider.mode === "sms" ||
      process.env.ALLOW_CONSOLE_OTP === "true",
    500,
    "Production requires SMS OTP delivery.",
  );
  const digest = (value: string) =>
    createHmac("sha256", secret).update(value).digest("hex");
  const cookie = {
    httpOnly: true,
    secure: options.production,
    sameSite: "strict" as const,
    path: "/api/public",
  };
  const qrInput = z.string().min(30).max(100);
  const phoneInput = z
    .string()
    .trim()
    .transform((value) => value.replace(/[\s()-]/g, ""))
    .transform((value) => (/^\d{10}$/.test(value) ? `+91${value}` : value))
    .pipe(
      z
        .string()
        .regex(
          /^\+91[6-9]\d{9}$/,
          "Enter a valid 10-digit Indian mobile number.",
        ),
    );
  const passengerQr = async (sql: Sql, raw: string) => {
    const qr = await options.resolveQr(sql, raw);
    requireThat(
      qr.kind === "passenger",
      403,
      "Use a passenger compartment QR.",
    );
    return qr;
  };
  const session = async (req: Request, sql: Sql = db) => {
    const raw = req.cookies.pantry_passenger_session;
    if (typeof raw !== "string" || raw.length > 100) return undefined;
    return one(
      sql,
      "SELECT p.*,s.csrf FROM passenger_sessions s JOIN passengers p ON p.id=s.passenger_id WHERE s.token_hash=$1 AND s.expires_at>now()",
      [hash(raw)],
    );
  };
  const profile = (passenger: Row | undefined) =>
    passenger
      ? {
          mobile: `+91 ••••••${unseal(passenger.phone_cipher, secret).phone.slice(-4)}`,
          csrf: passenger.csrf,
        }
      : null;
  const guard = async (
    req: PassengerRequest,
    _res: Response,
    next: NextFunction,
  ) => {
    try {
      const passenger = await session(req);
      requireThat(passenger, 401, "Verify your mobile number before ordering.");
      requireThat(
        req.header("X-Passenger-CSRF") === passenger.csrf,
        403,
        "Passenger session check failed. Refresh and verify your mobile number again.",
      );
      req.passenger = passenger;
      next();
    } catch (error) {
      next(error);
    }
  };
  const limit = rateLimit({
    windowMs: 60000,
    limit: 30,
    skip: () => !!options.disableRateLimit,
    message: { error: "Too many verification attempts. Please wait a minute." },
  });
  app.post("/api/public/auth/send-otp", limit, async (req, res) => {
    const input = z.object({ qr: qrInput, mobile: phoneInput }).parse(req.body);
    const challenge = randomUUID(),
      browser = token(),
      code = randomInt(0, 1000000).toString().padStart(6, "0");
    const phoneHash = digest(`phone:${input.mobile}`),
      ipHash = digest(`ip:${req.ip}`);
    await db.transaction(async (sql) => {
      const qr = await passengerQr(sql, input.qr);
      await sql.query(
        "DELETE FROM passenger_otp_challenges WHERE created_at<now()-interval '1 day'",
      );
      const recent = await one(
        sql,
        "SELECT count(*) AS total, count(*) FILTER (WHERE created_at>now()-interval '60 seconds') AS cooldown FROM passenger_otp_challenges WHERE phone_hash=$1 AND created_at>now()-interval '1 hour'",
        [phoneHash],
      );
      requireThat(
        Number(recent.cooldown) === 0,
        429,
        "Please wait 60 seconds before requesting another code.",
      );
      requireThat(
        Number(recent.total) < 5,
        429,
        "This mobile has reached its hourly OTP limit. Try again later.",
      );
      const network = await one(
        sql,
        "SELECT count(*) AS total FROM passenger_otp_challenges WHERE ip_hash=$1 AND created_at>now()-interval '1 hour'",
        [ipHash],
      );
      requireThat(
        Number(network.total) < 15,
        429,
        "Too many codes requested from this connection. Try again later.",
      );
      await sql.query(
        "UPDATE passenger_otp_challenges SET status='failed' WHERE phone_hash=$1 AND status IN ('pending','sent')",
        [phoneHash],
      );
      await sql.query(
        "INSERT INTO passenger_otp_challenges(id,qr_id,phone_hash,phone_cipher,browser_hash,ip_hash,code_hash,delivery,status,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'pending',now()+interval '5 minutes')",
        [
          challenge,
          qr.id,
          phoneHash,
          JSON.stringify(seal({ phone: input.mobile }, secret)),
          hash(browser),
          ipHash,
          provider.check ? null : digest(`${challenge}:${code}`),
          provider.mode,
        ],
      );
    });
    try {
      const providerId = await provider.send(input.mobile, code);
      await db.query(
        "UPDATE passenger_otp_challenges SET status='sent',provider_id=$2 WHERE id=$1 AND status='pending'",
        [challenge, providerId],
      );
    } catch (error) {
      await db.query(
        "UPDATE passenger_otp_challenges SET status='failed' WHERE id=$1",
        [challenge],
      );
      throw error;
    }
    res
      .cookie("pantry_otp_browser", browser, { ...cookie, maxAge: 5 * 60000 })
      .json({
        challenge,
        delivery: provider.mode,
        expiresIn: 300,
        resendAfter: 60,
        mobile: `+91 ••••••${input.mobile.slice(-4)}`,
      });
  });
  app.post("/api/public/auth/verify-otp", limit, async (req, res) => {
    const input = z
      .object({
        qr: qrInput,
        challenge: z.uuid(),
        code: z
          .string()
          .regex(/^\d{6}$/, "Enter the 6-digit verification code."),
      })
      .parse(req.body);
    const browser =
      typeof req.cookies.pantry_otp_browser === "string"
        ? req.cookies.pantry_otp_browser
        : "";
    const challenge = await db.transaction(async (sql) => {
      const qr = await passengerQr(sql, input.qr);
      const record = await one(
        sql,
        "SELECT * FROM passenger_otp_challenges WHERE id=$1 AND browser_hash=$2 AND qr_id=$3",
        [input.challenge, hash(browser), qr.id],
      );
      requireThat(
        record &&
          record.status === "sent" &&
          new Date(record.expires_at).getTime() > Date.now() &&
          record.delivery === provider.mode,
        400,
        "This code has expired or was already used. Request a new code.",
      );
      requireThat(
        record.attempts < 5,
        429,
        "Too many incorrect codes. Request a new code.",
      );
      await sql.query(
        "UPDATE passenger_otp_challenges SET attempts=attempts+1,status='checking' WHERE id=$1",
        [record.id],
      );
      return record;
    });
    let valid: boolean;
    try {
      valid = provider.check
        ? await provider.check(challenge.provider_id, input.code)
        : typeof challenge.code_hash === "string" &&
          challenge.code_hash.length === 64 &&
          timingSafeEqual(
            Buffer.from(challenge.code_hash, "hex"),
            Buffer.from(digest(`${challenge.id}:${input.code}`), "hex"),
          );
    } catch (error) {
      await db.query(
        "UPDATE passenger_otp_challenges SET status='sent' WHERE id=$1 AND status='checking'",
        [challenge.id],
      );
      throw error;
    }
    if (!valid) {
      await db.query(
        "UPDATE passenger_otp_challenges SET status='sent' WHERE id=$1 AND status='checking'",
        [challenge.id],
      );
      requireThat(false, 400, "Incorrect verification code. Please try again.");
    }
    const raw = token(),
      csrf = token();
    const passenger = await db.transaction(async (sql) => {
      const consumed = await sql.query(
        "UPDATE passenger_otp_challenges SET status='consumed' WHERE id=$1 AND status='checking' AND expires_at>now() RETURNING id",
        [challenge.id],
      );
      requireThat(
        consumed.rows.length,
        400,
        "This code has expired. Request a new code.",
      );
      await sql.query("DELETE FROM passenger_sessions WHERE expires_at<now()");
      const passenger = (
        await sql.query(
          "INSERT INTO passengers(id,phone_hash,phone_cipher) VALUES($1,$2,$3) ON CONFLICT(phone_hash) DO UPDATE SET phone_cipher=EXCLUDED.phone_cipher RETURNING *",
          [
            randomUUID(),
            challenge.phone_hash,
            JSON.stringify(challenge.phone_cipher),
          ],
        )
      ).rows[0];
      const previous = req.cookies.pantry_passenger_session;
      if (typeof previous === "string")
        await sql.query("DELETE FROM passenger_sessions WHERE token_hash=$1", [
          hash(previous),
        ]);
      await sql.query(
        "INSERT INTO passenger_sessions(token_hash,passenger_id,csrf,expires_at) VALUES($1,$2,$3,now()+interval '8 hours')",
        [hash(raw), passenger.id, csrf],
      );
      return { ...passenger, csrf };
    });
    res
      .clearCookie("pantry_otp_browser", cookie)
      .cookie("pantry_passenger_session", raw, {
        ...cookie,
        maxAge: 8 * 3600000,
      })
      .json({ passenger: profile(passenger) });
  });
  app.post("/api/public/auth/logout", guard, async (req, res) => {
    await db.query("DELETE FROM passenger_sessions WHERE token_hash=$1", [
      hash(req.cookies.pantry_passenger_session),
    ]);
    res.clearCookie("pantry_passenger_session", cookie).json({ ok: true });
  });
  return { session, profile, guard, delivery: provider.mode };
}
