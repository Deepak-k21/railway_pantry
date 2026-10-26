import express, {
  type Request,
  type Response,
  type NextFunction,
} from "express";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import { rateLimit } from "express-rate-limit";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import QRCode from "qrcode";
import path from "node:path";
import { isAllowedOrigin } from "../shared/origins.js";
import { configureTrustedProxy } from "./proxy.js";
import {
  createOtpProvider,
  registerPassengerAuth,
  type OtpProvider,
} from "./passenger-auth.js";
import { type Database, type Sql, type Row, one } from "./db.js";
import {
  Fault,
  requireThat,
  hash,
  token,
  passwordHash,
  passwordMatches,
  seal,
  unseal,
} from "./security.js";

const id = z.string().uuid();
const sessionCookie = (req: Request) =>
  req.header("X-Workspace") === "staff"
    ? "pantry_staff_session"
    : "pantry_session";
const name = z.string().trim().min(1).max(100);
const count = z.number().int().min(1).max(10000);
const reason = z.string().trim().min(3).max(500);
const productInput = z.object({
  name,
  category_id: id,
  description: z.string().trim().max(500).default(""),
  image_url: z
    .union([
      z.literal(""),
      z
        .url()
        .refine(
          (value) => value.startsWith("https://"),
          "Use an HTTPS image URL",
        ),
    ])
    .default(""),
  price: z.number().int().min(0).max(10000000),
  active: z.boolean().default(true),
});
const serviceInput = z.object({
  name,
  number: name,
  service_date: z.iso.date(),
  origin: name,
  destination: name,
  active: z.boolean().default(true),
});
type AuthRequest = Request & { user?: Row; session?: Row; passenger?: Row };
async function audit(
  sql: Sql,
  actor: string | null,
  action: string,
  entity: string,
  detail: unknown = {},
) {
  await sql.query(
    "INSERT INTO audit(id,actor,action,entity_id,detail) VALUES($1,$2,$3,$4,$5)",
    [randomUUID(), actor, action, entity, JSON.stringify(detail)],
  );
}
async function movement(
  sql: Sql,
  service: string,
  product: string,
  kind: string,
  quantity: number,
  actor: string | null,
  why: string,
  request: string | null = null,
) {
  await sql.query(
    "INSERT INTO movements(id,service_id,product_id,kind,quantity,actor,reason,request_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
    [randomUUID(), service, product, kind, quantity, actor, why, request],
  );
}
async function activeService(sql: Sql, service: string) {
  const found = await one(
    sql,
    "SELECT * FROM services WHERE id=$1 AND active=true",
    [service],
  );
  requireThat(found, 409, "This service is closed or unavailable.");
  return found;
}
async function staffService(sql: Sql, user: string, service: string) {
  requireThat(
    await one(
      sql,
      "SELECT 1 FROM staff_services s JOIN users u ON u.id=s.user_id WHERE user_id=$1 AND service_id=$2 AND u.active=true AND u.role='staff'",
      [user, service],
    ),
    403,
    "Staff member is not assigned to this service.",
  );
}
async function resolveQr(sql: Sql, raw: string) {
  const qr = await one(
    sql,
    "SELECT q.*,s.name AS service_name,s.number,s.service_date,s.origin,s.destination,s.active,c.code,p.name AS product_name FROM qr_codes q JOIN services s ON s.id=q.service_id LEFT JOIN compartments c ON c.id=q.compartment_id LEFT JOIN products p ON p.id=q.product_id WHERE token_hash=$1",
    [hash(raw)],
  );
  requireThat(qr, 404, "Invalid QR code.");
  requireThat(!qr.revoked_at, 410, "This QR code has been revoked.");
  requireThat(
    new Date(qr.expires_at) > new Date(),
    410,
    "This QR code has expired.",
  );
  requireThat(qr.active, 409, "This service is closed.");
  return qr;
}
function safeQr(qr: Row) {
  const {
    token_hash: _token,
    encrypted_token: _encrypted,
    created_by: _creator,
    ...rest
  } = qr;
  return rest;
}
async function requestDetail(sql: Sql, request: Row, internal = false) {
  const items = (
    await sql.query(
      "SELECT ri.*,p.name FROM request_items ri JOIN products p ON p.id=ri.product_id WHERE request_id=$1",
      [request.id],
    )
  ).rows;
  const { access_hash: _access, ...safe } = request;
  if (!internal) delete safe.staff_id;
  return { ...safe, items };
}
export async function createAdmin(
  db: Database,
  email: string,
  password: string,
  displayName: string,
) {
  z.email().parse(email);
  z.string().min(12).max(128).parse(password);
  name.parse(displayName);
  const encoded = await passwordHash(password);
  return db.transaction(async (sql) => {
    requireThat(
      !(await one(sql, "SELECT id FROM users WHERE role='admin'")),
      409,
      "An administrator already exists.",
    );
    const userId = randomUUID();
    await sql.query(
      "INSERT INTO users(id,email,name,password,role) VALUES($1,$2,$3,$4,'admin')",
      [userId, email.toLowerCase(), displayName, encoded],
    );
    await audit(sql, userId, "admin_created", userId);
    return userId;
  });
}

export function createApp(
  db: Database,
  options: {
    origin: string;
    production?: boolean;
    staticDir?: string;
    disableRateLimit?: boolean;
    replaySecret?: string;
    setupToken?: string;
    otpProvider?: OtpProvider;
    proxySecret?: string;
  },
) {
  const replaySecret = options.replaySecret || token();
  const app = express();
  configureTrustedProxy(app, options.proxySecret);
  app.disable("x-powered-by");
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", "data:", "https:"],
          connectSrc: ["'self'"],
          objectSrc: ["'none'"],
          upgradeInsecureRequests: options.production ? [] : null,
        },
      },
    }),
  );
  app.use(express.json({ limit: "64kb" }));
  app.use(cookieParser());
  if (!options.disableRateLimit)
    app.use(
      "/api",
      rateLimit({
        windowMs: 60000,
        limit: 240,
        standardHeaders: "draft-8",
        legacyHeaders: false,
        message: { error: "Too many requests. Try again shortly." },
      }),
    );
  app.use("/api", async (req: AuthRequest, res, next) => {
    res.set("Cache-Control", "no-store");
    try {
      if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
        requireThat(
          isAllowedOrigin(
            req.headers.origin,
            options.origin,
            !options.production,
          ),
          403,
          "Request origin is not allowed.",
        );
        requireThat(req.is("application/json"), 415, "Send JSON data.");
      }
      if (req.path.startsWith("/public/")) {
        next();
        return;
      }
      const raw = req.cookies[sessionCookie(req)];
      if (raw) {
        const session = await one(
          db,
          "SELECT s.*,u.id,u.name,u.email,u.role,u.active FROM sessions s JOIN users u ON u.id=s.user_id WHERE token_hash=$1 AND expires_at>now() AND u.active=true",
          [hash(raw)],
        );
        if (
          session &&
          (!req.header("X-Workspace") ||
            session.role === req.header("X-Workspace"))
        ) {
          req.user = {
            id: session.user_id,
            name: session.name,
            email: session.email,
            role: session.role,
          };
          req.session = session;
        }
      }
      if (
        req.user &&
        !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
        req.path != "/auth/login"
      )
        requireThat(
          req.headers["x-csrf-token"] === req.session?.csrf,
          403,
          "Session security check failed. Reload and try again.",
        );
      next();
    } catch (error) {
      next(error);
    }
  });
  const permit =
    (role?: string) =>
    (req: AuthRequest, _res: Response, next: NextFunction) => {
      try {
        requireThat(req.user, 401, "Please sign in.");
        if (role)
          requireThat(
            req.user.role === role,
            403,
            "You do not have permission for this action.",
          );
        next();
      } catch (error) {
        next(error);
      }
    };
  const mutation =
    (action: string, run: (sql: Sql, req: AuthRequest) => Promise<unknown>) =>
    async (req: AuthRequest, res: Response) => {
      const key = z.string().uuid().parse(req.header("Idempotency-Key"));
      const scope = `${req.passenger?.id || req.user?.id || "public"}:${action}`;
      const fingerprint = hash(JSON.stringify(req.body));
      const result = await db.transaction(async (sql) => {
        const previous = await one(
          sql,
          "SELECT * FROM idempotency WHERE scope=$1 AND key=$2",
          [scope, key],
        );
        if (previous) {
          requireThat(
            previous.fingerprint === fingerprint,
            409,
            "This submission key was already used with different data.",
          );
          return unseal(previous.response, replaySecret);
        }
        const response = await run(sql, req);
        await sql.query(
          "INSERT INTO idempotency(scope,key,fingerprint,response) VALUES($1,$2,$3,$4)",
          [
            scope,
            key,
            fingerprint,
            JSON.stringify(seal(response, replaySecret)),
          ],
        );
        return response;
      });
      res.json(result);
    };
  app.get("/api/health", async (_req, res) => {
    await db.query("SELECT 1");
    res.json({ status: "ok" });
  });
  app.get("/api/auth/me", (req: AuthRequest, res) =>
    res.json({ user: req.user || null, csrf: req.session?.csrf || null }),
  );
  app.get("/api/setup/status", async (_req, res) => {
    const admin = await one(db, "SELECT id FROM users WHERE role='admin'");
    res.json({ needsSetup: !admin });
  });
  app.post("/api/setup", async (req, res) => {
    const existing = await one(db, "SELECT id FROM users WHERE role='admin'");
    requireThat(
      !existing,
      409,
      "An administrator already exists. Please sign in.",
    );
    if (!options.production && options.setupToken) {
      const tokenInput = (req.body as any)?.token;
      if (tokenInput) {
        requireThat(
          hash(tokenInput) === hash(options.setupToken),
          403,
          "Invalid setup token.",
        );
      }
    }
    const input = z
      .object({
        name,
        email: z.email(),
        password: z.string().min(12).max(128),
      })
      .parse(req.body);
    await createAdmin(db, input.email, input.password, input.name);
    res.json({ ok: true });
  });
  const loginLimit = rateLimit({
    windowMs: 15 * 60000,
    limit: 10,
    skip: () => !!options.disableRateLimit,
    message: { error: "Too many sign-in attempts. Try again in 15 minutes." },
  });
  app.post("/api/auth/login", loginLimit, async (req, res) => {
    const input = z
      .object({ email: z.email(), password: z.string().min(1).max(128) })
      .parse(req.body);
    const user = await one(db, "SELECT * FROM users WHERE email=$1", [
      input.email.toLowerCase(),
    ]);
    const dummy = "0123456789abcdef0123456789abcdef:" + "00".repeat(64);
    const valid = await passwordMatches(
      input.password,
      user?.password || dummy,
    );
    requireThat(
      user && user.active && valid,
      401,
      "Email or password is incorrect.",
    );
    const workspace = req.header("X-Workspace");
    requireThat(
      !workspace || workspace === user.role,
      403,
      workspace === "staff"
        ? "Use a service staff account on this page."
        : "Use an administrator account here. Staff sign in at /staff.",
    );
    const raw = token(),
      csrf = token();
    await db.transaction(async (sql) => {
      await sql.query("DELETE FROM sessions WHERE expires_at<now()");
      await sql.query(
        "INSERT INTO sessions(token_hash,user_id,csrf,expires_at) VALUES($1,$2,$3,now()+interval '8 hours')",
        [hash(raw), user.id, csrf],
      );
      await audit(sql, user.id, "signed_in", user.id);
    });
    res
      .cookie(sessionCookie(req), raw, {
        httpOnly: true,
        secure: !!options.production,
        sameSite: "strict",
        maxAge: 8 * 3600000,
        path: "/",
      })
      .json({
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
        },
        csrf,
      });
  });
  app.post("/api/auth/logout", permit(), async (req: AuthRequest, res) => {
    await db.query("DELETE FROM sessions WHERE token_hash=$1", [
      hash(req.cookies[sessionCookie(req)]),
    ]);
    res.clearCookie(sessionCookie(req), { path: "/" }).json({ ok: true });
  });
  app.post("/api/auth/password", permit(), async (req: AuthRequest, res) => {
    const input = z
      .object({
        current: z.string().max(128),
        password: z.string().min(12).max(128),
      })
      .parse(req.body);
    const user = await one(db, "SELECT password FROM users WHERE id=$1", [
      req.user!.id,
    ]);
    requireThat(
      await passwordMatches(input.current, user.password),
      403,
      "Current password is incorrect.",
    );
    const encoded = await passwordHash(input.password);
    await db.transaction(async (sql) => {
      await sql.query("UPDATE users SET password=$1 WHERE id=$2", [
        encoded,
        req.user!.id,
      ]);
      await sql.query("DELETE FROM sessions WHERE user_id=$1", [req.user!.id]);
      await audit(sql, req.user!.id, "password_changed", req.user!.id);
    });
    res.clearCookie(sessionCookie(req), { path: "/" }).json({ ok: true });
  });
  app.use("/api/admin", permit("admin"));
  app.use("/api/staff", permit("staff"));
  app.get("/api/admin/notifications", async (_req, res) => {
    const result = await db.query(
      "SELECT s.id AS service_id,s.name,s.number,COUNT(r.id)::int AS pending FROM services s JOIN requests r ON r.service_id=s.id WHERE r.status='submitted' GROUP BY s.id ORDER BY MIN(r.created_at)",
    );
    res.json({ services: result.rows });
  });
  app.get("/api/admin/data", async (req, res) => {
    const service = req.query.service ? id.parse(req.query.service) : null;
    const services = (
      await db.query("SELECT * FROM services ORDER BY service_date DESC")
    ).rows;
    const selected = service || services[0]?.id || null;
    const results = await Promise.all([
      db.query("SELECT * FROM compartments WHERE service_id=$1 ORDER BY code", [
        selected,
      ]),
      db.query("SELECT * FROM categories ORDER BY name"),
      db.query(
        "SELECT p.*,c.name AS category FROM products p JOIN categories c ON c.id=p.category_id ORDER BY p.name",
      ),
      db.query(
        "SELECT i.*,p.name,p.price,p.active,i.opening+i.adjustments-i.reserved-i.sold AS available FROM inventory i JOIN products p ON p.id=i.product_id WHERE service_id=$1 ORDER BY p.name",
        [selected],
      ),
      db.query(
        "SELECT u.id,u.name,u.email,u.active,EXISTS(SELECT 1 FROM staff_services s WHERE s.user_id=u.id AND s.service_id=$1) AS assigned FROM users u WHERE role='staff' ORDER BY name",
        [selected],
      ),
      db.query(
        "SELECT r.*,c.code,u.name AS staff_name FROM requests r JOIN compartments c ON c.id=r.compartment_id LEFT JOIN users u ON u.id=r.staff_id WHERE r.service_id=$1 ORDER BY r.created_at DESC LIMIT 500",
        [selected],
      ),
      db.query(
        "SELECT q.id,q.kind,q.service_id,q.compartment_id,q.product_id,q.created_at,q.expires_at,q.revoked_at,q.reason,(q.encrypted_token IS NOT NULL) AS can_preview,c.code,p.name AS product_name FROM qr_codes q LEFT JOIN compartments c ON c.id=q.compartment_id LEFT JOIN products p ON p.id=q.product_id WHERE q.service_id=$1 ORDER BY q.created_at DESC",
        [selected],
      ),
      db.query(
        "SELECT DISTINCT ON(l.user_id) l.*,c.code,u.name FROM locations l JOIN compartments c ON c.id=l.compartment_id JOIN users u ON u.id=l.user_id WHERE l.service_id=$1 ORDER BY l.user_id,l.created_at DESC",
        [selected],
      ),
      db.query(
        "SELECT c.*,p.name AS product_name,u.name AS staff_name FROM carried c JOIN products p ON p.id=c.product_id JOIN users u ON u.id=c.user_id WHERE c.service_id=$1 AND c.quantity>0",
        [selected],
      ),
      db.query(
        "SELECT m.*,p.name AS product_name,u.name AS actor_name FROM movements m JOIN products p ON p.id=m.product_id LEFT JOIN users u ON u.id=m.actor WHERE m.service_id=$1 ORDER BY m.created_at DESC LIMIT 200",
        [selected],
      ),
      db.query(
        "SELECT a.*,u.name AS actor_name FROM audit a LEFT JOIN users u ON u.id=a.actor ORDER BY a.created_at DESC LIMIT 200",
      ),
      db.query(
        "SELECT c.code,p.name,SUM(ri.quantity)::int AS quantity FROM requests r JOIN compartments c ON c.id=r.compartment_id JOIN request_items ri ON ri.request_id=r.id JOIN products p ON p.id=ri.product_id WHERE r.service_id=$1 AND r.status IN ('submitted','assigned','in_progress') GROUP BY c.code,p.name ORDER BY c.code,p.name",
        [selected],
      ),
    ]);
    const keys = [
      "compartments",
      "categories",
      "products",
      "inventory",
      "staff",
      "requests",
      "qrs",
      "locations",
      "carried",
      "movements",
      "audit",
      "demand",
    ];
    const data: Row = { services, selected };
    results.forEach((result, index) => (data[keys[index]] = result.rows));
    data.requests = await Promise.all(
      data.requests.map((entry: Row) => requestDetail(db, entry, true)),
    );
    data.summary = await one(
      db,
      "SELECT COUNT(*) FILTER (WHERE status IN ('submitted','assigned','in_progress'))::int AS open, COUNT(*) FILTER (WHERE status='submitted')::int AS awaiting, COUNT(*) FILTER (WHERE status='delivered')::int AS delivered FROM requests WHERE service_id=$1",
      [selected],
    );
    res.json(data);
  });
  app.post(
    "/api/admin/services",
    mutation("service", async (sql, req) => {
      const input = serviceInput.parse(req.body);
      const service = randomUUID();
      await sql.query(
        "INSERT INTO services(id,name,number,service_date,origin,destination,active) VALUES($1,$2,$3,$4,$5,$6,$7)",
        [
          service,
          input.name,
          input.number,
          input.service_date,
          input.origin,
          input.destination,
          input.active,
        ],
      );
      await audit(sql, req.user!.id, "service_created", service);
      return { id: service };
    }),
  );
  app.post(
    "/api/admin/service-status",
    mutation("service-status", async (sql, req) => {
      const input = z.object({ id, active: z.boolean() }).parse(req.body);
      requireThat(
        await one(sql, "SELECT id FROM services WHERE id=$1", [input.id]),
        404,
        "Service not found.",
      );
      if (!input.active) {
        requireThat(
          !(await one(
            sql,
            "SELECT id FROM requests WHERE service_id=$1 AND status IN ('submitted','assigned','in_progress') LIMIT 1",
            [input.id],
          )),
          409,
          "Complete or cancel outstanding requests before closing the service.",
        );
        requireThat(
          !(await one(
            sql,
            "SELECT 1 FROM carried WHERE service_id=$1 AND quantity>0 LIMIT 1",
            [input.id],
          )),
          409,
          "Return carried stock before closing the service.",
        );
      }
      await sql.query("UPDATE services SET active=$1 WHERE id=$2", [
        input.active,
        input.id,
      ]);
      await audit(sql, req.user!.id, "service_status", input.id, {
        active: input.active,
      });
      return { ok: true };
    }),
  );
  app.post(
    "/api/admin/service-edit",
    mutation("service-edit", async (sql, req) => {
      const input = serviceInput.extend({ id }).parse(req.body);
      requireThat(
        await one(sql, "SELECT id FROM services WHERE id=$1", [input.id]),
        404,
        "Service not found.",
      );
      await sql.query(
        "UPDATE services SET name=$1,number=$2,service_date=$3,origin=$4,destination=$5 WHERE id=$6",
        [
          input.name,
          input.number,
          input.service_date,
          input.origin,
          input.destination,
          input.id,
        ],
      );
      await audit(sql, req.user!.id, "service_edited", input.id);
      return { ok: true };
    }),
  );
  app.post(
    "/api/admin/category-edit",
    mutation("category-edit", async (sql, req) => {
      const input = z.object({ id, name }).parse(req.body);
      requireThat(
        await one(sql, "SELECT id FROM categories WHERE id=$1", [input.id]),
        404,
        "Category not found.",
      );
      await sql.query("UPDATE categories SET name=$1 WHERE id=$2", [
        input.name,
        input.id,
      ]);
      await audit(sql, req.user!.id, "category_edited", input.id);
      return { ok: true };
    }),
  );
  app.post(
    "/api/admin/compartment-edit",
    mutation("compartment-edit", async (sql, req) => {
      const input = z
        .object({
          id,
          code: z
            .string()
            .trim()
            .min(1)
            .max(12)
            .regex(/^[A-Za-z0-9-]+$/),
        })
        .parse(req.body);
      requireThat(
        await one(sql, "SELECT id FROM compartments WHERE id=$1", [input.id]),
        404,
        "Compartment not found.",
      );
      await sql.query("UPDATE compartments SET code=$1 WHERE id=$2", [
        input.code.toUpperCase(),
        input.id,
      ]);
      await audit(sql, req.user!.id, "compartment_edited", input.id);
      return { ok: true };
    }),
  );
  app.post(
    "/api/admin/staff-edit",
    mutation("staff-edit", async (sql, req) => {
      const input = z
        .object({
          id,
          name,
          email: z.email(),
          password: z.string().min(12).max(128).optional(),
        })
        .parse(req.body);
      requireThat(
        await one(sql, "SELECT id FROM users WHERE id=$1 AND role='staff'", [
          input.id,
        ]),
        404,
        "Staff member not found.",
      );
      await sql.query("UPDATE users SET name=$1,email=$2 WHERE id=$3", [
        input.name,
        input.email.toLowerCase(),
        input.id,
      ]);
      if (input.password) {
        await sql.query("UPDATE users SET password=$1 WHERE id=$2", [
          await passwordHash(input.password),
          input.id,
        ]);
        await sql.query("DELETE FROM sessions WHERE user_id=$1", [input.id]);
      }
      await audit(sql, req.user!.id, "staff_edited", input.id, {
        password_reset: !!input.password,
      });
      return { ok: true };
    }),
  );
  app.post(
    "/api/admin/compartments",
    mutation("compartment", async (sql, req) => {
      const input = z
        .object({
          service_id: id,
          code: z
            .string()
            .trim()
            .min(1)
            .max(12)
            .regex(/^[A-Za-z0-9-]+$/),
        })
        .parse(req.body);
      await activeService(sql, input.service_id);
      const compartment = randomUUID();
      await sql.query(
        "INSERT INTO compartments(id,service_id,code) VALUES($1,$2,$3)",
        [compartment, input.service_id, input.code.toUpperCase()],
      );
      await audit(sql, req.user!.id, "compartment_created", compartment);
      return { id: compartment };
    }),
  );
  app.post(
    "/api/admin/categories",
    mutation("category", async (sql, req) => {
      const input = z.object({ name }).parse(req.body);
      const category = randomUUID();
      await sql.query("INSERT INTO categories(id,name) VALUES($1,$2)", [
        category,
        input.name,
      ]);
      await audit(sql, req.user!.id, "category_created", category);
      return { id: category };
    }),
  );
  app.post(
    "/api/admin/products",
    mutation("product", async (sql, req) => {
      const input = productInput.extend({ id: id.optional() }).parse(req.body);
      const product = input.id || randomUUID();
      await sql.query(
        "INSERT INTO products(id,name,category_id,description,image_url,price,active) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(id) DO UPDATE SET name=$2,category_id=$3,description=$4,image_url=$5,price=$6,active=$7",
        [
          product,
          input.name,
          input.category_id,
          input.description,
          input.image_url,
          input.price,
          input.active,
        ],
      );
      await audit(
        sql,
        req.user!.id,
        input.id ? "product_updated" : "product_created",
        product,
      );
      return { id: product };
    }),
  );
  app.post(
    "/api/admin/stock",
    mutation("stock", async (sql, req) => {
      const input = z
        .object({
          service_id: id,
          product_id: id,
          quantity: z.number().int().min(-100000).max(100000),
          reason,
          opening: z.boolean().default(false),
        })
        .parse(req.body);
      await activeService(sql, input.service_id);
      const stock = await one(
        sql,
        "SELECT * FROM inventory WHERE service_id=$1 AND product_id=$2",
        [input.service_id, input.product_id],
      );
      if (input.opening) {
        requireThat(
          !stock && input.quantity >= 0,
          409,
          "Opening stock can only be set once. Use an adjustment afterward.",
        );
        await sql.query(
          "INSERT INTO inventory(service_id,product_id,opening) VALUES($1,$2,$3)",
          [input.service_id, input.product_id, input.quantity],
        );
      } else {
        requireThat(stock, 404, "Set opening stock first.");
        const custody = await one(
          sql,
          "SELECT COALESCE(SUM(quantity),0)::int AS total FROM carried WHERE service_id=$1 AND product_id=$2",
          [input.service_id, input.product_id],
        );
        requireThat(
          stock.opening + stock.adjustments + input.quantity - stock.sold >=
            Math.max(stock.reserved, custody.total),
          409,
          "Adjustment would consume reserved or carried stock.",
        );
        await sql.query(
          "UPDATE inventory SET adjustments=adjustments+$1 WHERE service_id=$2 AND product_id=$3",
          [input.quantity, input.service_id, input.product_id],
        );
      }
      await movement(
        sql,
        input.service_id,
        input.product_id,
        input.opening ? "opening" : "adjustment",
        input.quantity,
        req.user!.id,
        input.reason,
      );
      await audit(sql, req.user!.id, "stock_changed", input.product_id, input);
      return { ok: true };
    }),
  );
  app.post(
    "/api/admin/staff",
    mutation("staff", async (sql, req) => {
      const input = z
        .object({
          name,
          email: z.email(),
          password: z.string().min(12).max(128),
          service_id: id.optional(),
        })
        .parse(req.body);
      const staff = randomUUID();
      await sql.query(
        "INSERT INTO users(id,name,email,password,role) VALUES($1,$2,$3,$4,'staff')",
        [
          staff,
          input.name,
          input.email.toLowerCase(),
          await passwordHash(input.password),
        ],
      );
      if (input.service_id) {
        await activeService(sql, input.service_id);
        await sql.query("INSERT INTO staff_services VALUES($1,$2)", [
          staff,
          input.service_id,
        ]);
      }
      await audit(sql, req.user!.id, "staff_created", staff);
      return { id: staff };
    }),
  );
  app.post(
    "/api/admin/staff-status",
    mutation("staff-status", async (sql, req) => {
      const input = z.object({ id, active: z.boolean() }).parse(req.body);
      requireThat(
        await one(sql, "SELECT id FROM users WHERE id=$1 AND role='staff'", [
          input.id,
        ]),
        404,
        "Staff member not found.",
      );
      if (!input.active) {
        requireThat(
          !(await one(
            sql,
            "SELECT id FROM requests WHERE staff_id=$1 AND status IN ('assigned','in_progress')",
            [input.id],
          )),
          409,
          "Complete or cancel assigned requests first.",
        );
        requireThat(
          !(await one(
            sql,
            "SELECT 1 FROM carried WHERE user_id=$1 AND quantity>0",
            [input.id],
          )),
          409,
          "Return all carried stock before deactivation.",
        );
      }
      await sql.query("UPDATE users SET active=$1 WHERE id=$2", [
        input.active,
        input.id,
      ]);
      if (!input.active)
        await sql.query("DELETE FROM sessions WHERE user_id=$1", [input.id]);
      await audit(sql, req.user!.id, "staff_status", input.id, {
        active: input.active,
      });
      return { ok: true };
    }),
  );
  app.post(
    "/api/admin/staff-service",
    mutation("staff-service", async (sql, req) => {
      const input = z.object({ staff_id: id, service_id: id }).parse(req.body);
      await activeService(sql, input.service_id);
      requireThat(
        await one(
          sql,
          "SELECT id FROM users WHERE id=$1 AND role='staff' AND active=true",
          [input.staff_id],
        ),
        404,
        "Active staff member not found.",
      );
      await sql.query(
        "INSERT INTO staff_services VALUES($1,$2) ON CONFLICT DO NOTHING",
        [input.staff_id, input.service_id],
      );
      await audit(sql, req.user!.id, "staff_service_assigned", input.staff_id, {
        service: input.service_id,
      });
      return { ok: true };
    }),
  );
  app.post(
    "/api/admin/qr",
    mutation("qr", async (sql, req) => {
      const input = z
        .object({
          kind: z.enum(["passenger", "location", "item"]),
          service_id: id,
          compartment_id: id.optional(),
          product_id: id.optional(),
          days: z.number().int().min(1).max(30).default(1),
          replace_id: id.optional(),
        })
        .parse(req.body);
      await activeService(sql, input.service_id);
      if (input.kind === "item")
        requireThat(
          input.product_id &&
            (await one(
              sql,
              "SELECT 1 FROM inventory WHERE service_id=$1 AND product_id=$2",
              [input.service_id, input.product_id],
            )),
          400,
          "Choose an item with service inventory.",
        );
      else
        requireThat(
          input.compartment_id &&
            (await one(
              sql,
              "SELECT 1 FROM compartments WHERE id=$1 AND service_id=$2",
              [input.compartment_id, input.service_id],
            )),
          400,
          "Choose a compartment from this service.",
        );
      if (input.replace_id) {
        const old = await one(sql, "SELECT * FROM qr_codes WHERE id=$1", [
          input.replace_id,
        ]);
        requireThat(
          old &&
            old.service_id === input.service_id &&
            old.kind === input.kind &&
            old.compartment_id === (input.compartment_id || null) &&
            old.product_id === (input.product_id || null),
          400,
          "Replacement must refer to the same QR target.",
        );
        await sql.query(
          "UPDATE qr_codes SET revoked_at=now(),reason='Regenerated' WHERE id=$1",
          [input.replace_id],
        );
      }
      const raw = token(),
        qrId = randomUUID();
      const travel = await one(
        sql,
        "SELECT service_date::text AS travel_day FROM services WHERE id=$1",
        [input.service_id],
      );
      const expires = new Date(
        Math.max(
          Date.now(),
          Date.parse(travel.travel_day + "T00:00:00+05:30"),
        ) +
          input.days * 86400000,
      ).toISOString();
      await sql.query(
        "INSERT INTO qr_codes(id,token_hash,kind,service_id,compartment_id,product_id,created_by,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
        [
          qrId,
          hash(raw),
          input.kind,
          input.service_id,
          input.kind === "item" ? null : input.compartment_id,
          input.kind === "item" ? input.product_id : null,
          req.user!.id,
          expires,
        ],
      );
      await audit(sql, req.user!.id, "qr_created", qrId, {
        kind: input.kind,
        replaces: input.replace_id,
      });
      await sql.query("UPDATE qr_codes SET encrypted_token=$1 WHERE id=$2", [
        JSON.stringify(seal({ token: raw }, replaySecret)),
        qrId,
      ]);
      const url = `${options.origin}/${input.kind === "passenger" ? "p" : "scan"}/${raw}`;
      const target =
        input.kind === "item"
          ? await one(sql, "SELECT name AS label FROM products WHERE id=$1", [
              input.product_id,
            ])
          : await one(
              sql,
              "SELECT code AS label FROM compartments WHERE id=$1",
              [input.compartment_id],
            );
      const service = await one(
        sql,
        "SELECT number,name FROM services WHERE id=$1",
        [input.service_id],
      );
      return {
        id: qrId,
        label: `${service.number} · ${service.name} · ${target.label} · ${input.kind}`,
        url,
        image: await QRCode.toDataURL(url, { width: 400, margin: 2 }),
        expires_at: expires,
      };
    }),
  );
  app.post(
    "/api/admin/qr-revoke",
    mutation("qr-revoke", async (sql, req) => {
      const input = z.object({ id, reason }).parse(req.body);
      requireThat(
        await one(sql, "SELECT id FROM qr_codes WHERE id=$1", [input.id]),
        404,
        "QR not found.",
      );
      await sql.query(
        "UPDATE qr_codes SET revoked_at=now(),reason=$1 WHERE id=$2",
        [input.reason, input.id],
      );
      await audit(sql, req.user!.id, "qr_revoked", input.id, {
        reason: input.reason,
      });
      return { ok: true };
    }),
  );
  app.get("/api/admin/qr/:id", async (req, res) => {
    const qr = await one(
      db,
      "SELECT q.*,s.number,s.name AS service_name,c.code,p.name AS product_name FROM qr_codes q JOIN services s ON s.id=q.service_id LEFT JOIN compartments c ON c.id=q.compartment_id LEFT JOIN products p ON p.id=q.product_id WHERE q.id=$1",
      [id.parse(req.params.id)],
    );
    requireThat(qr, 404, "QR code not found.");
    requireThat(
      !qr.revoked_at && new Date(qr.expires_at) > new Date(),
      410,
      "This code has expired or was revoked. Generate a replacement.",
    );
    requireThat(
      qr.encrypted_token,
      409,
      "This older code cannot be reopened. Regenerate it once to enable saved previews.",
    );
    const raw = unseal(qr.encrypted_token, replaySecret).token;
    const url = `${options.origin}/${qr.kind === "passenger" ? "p" : "scan"}/${raw}`;
    res.json({
      id: qr.id,
      label: `${qr.number} · ${qr.service_name} · ${qr.code || qr.product_name} · ${qr.kind}`,
      url,
      image: await QRCode.toDataURL(url, { width: 400, margin: 2 }),
      expires_at: qr.expires_at,
    });
  });
  const passengerAuth = registerPassengerAuth(app, db, {
    secret: replaySecret,
    production: !!options.production,
    provider: options.otpProvider || createOtpProvider(!!options.production),
    disableRateLimit: options.disableRateLimit,
    resolveQr,
  });
  app.get("/api/public/qr/:token", async (req, res) => {
    const qr = await resolveQr(
      db,
      z.string().min(30).max(100).parse(req.params.token),
    );
    requireThat(
      qr.kind === "passenger",
      403,
      "This QR is for authenticated pantry staff.",
    );
    const passenger = await passengerAuth.session(req);
    const products = passenger
      ? (
          await db.query(
            "SELECT p.id,p.name,p.description,p.image_url,p.price,c.name AS category,i.opening+i.adjustments-i.reserved-i.sold AS available FROM inventory i JOIN products p ON p.id=i.product_id JOIN categories c ON c.id=p.category_id WHERE i.service_id=$1 AND p.active=true ORDER BY c.name,p.name",
            [qr.service_id],
          )
        ).rows
      : [];
    res.json({
      context: {
        service_name: qr.service_name,
        number: qr.number,
        date: qr.service_date,
        origin: qr.origin,
        destination: qr.destination,
        compartment: qr.code,
      },
      products,
      passenger: passengerAuth.profile(passenger),
      otpDelivery: passengerAuth.delivery,
    });
  });
  app.post(
    "/api/public/requests",
    passengerAuth.guard,
    mutation("passenger-request", async (sql, req) => {
      const input = z
        .object({
          qr: z.string().min(30).max(100),
          seat: z
            .string()
            .trim()
            .min(1)
            .max(8)
            .regex(/^[A-Za-z0-9-]+$/),
          items: z
            .array(
              z.object({
                product_id: id,
                quantity: z.number().int().min(1).max(20),
              }),
            )
            .min(1)
            .max(30),
        })
        .parse(req.body);
      requireThat(
        new Set(input.items.map((item) => item.product_id)).size ===
          input.items.length,
        400,
        "Each product may appear only once.",
      );
      const qr = await resolveQr(sql, input.qr);
      requireThat(
        qr.kind === "passenger",
        403,
        "Use a passenger compartment QR.",
      );
      const requestId = randomUUID(),
        access = token(),
        reference =
          "RP-" + randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase();
      await sql.query(
        "INSERT INTO requests(id,reference,access_hash,service_id,compartment_id,seat,passenger_id) VALUES($1,$2,$3,$4,$5,$6,$7)",
        [
          requestId,
          reference,
          hash(access),
          qr.service_id,
          qr.compartment_id,
          input.seat,
          req.passenger!.id,
        ],
      );
      for (const item of input.items) {
        const product = await one(
          sql,
          "SELECT * FROM products WHERE id=$1 AND active=true",
          [item.product_id],
        );
        requireThat(product, 409, "A selected product is no longer available.");
        const updated = await sql.query(
          "UPDATE inventory SET reserved=reserved+$1 WHERE service_id=$2 AND product_id=$3 AND opening+adjustments-reserved-sold >= $1 RETURNING product_id",
          [item.quantity, qr.service_id, item.product_id],
        );
        requireThat(
          updated.rows.length,
          409,
          `Insufficient stock for ${product.name}. Refresh your catalogue.`,
        );
        await sql.query(
          "INSERT INTO request_items(request_id,product_id,quantity,unit_price) VALUES($1,$2,$3,$4)",
          [requestId, item.product_id, item.quantity, product.price],
        );
        await movement(
          sql,
          qr.service_id,
          item.product_id,
          "reserve",
          item.quantity,
          null,
          "Passenger request",
          requestId,
        );
      }
      await audit(sql, null, "request_submitted", requestId);
      return { reference, access };
    }),
  );
  app.get("/api/public/request/:access", async (req, res) => {
    const request = await one(
      db,
      "SELECT r.*,c.code FROM requests r JOIN compartments c ON c.id=r.compartment_id WHERE access_hash=$1",
      [hash(z.string().min(30).max(100).parse(req.params.access))],
    );
    requireThat(
      request,
      404,
      "Request not found. Use your private tracking link.",
    );
    res.json(await requestDetail(db, request));
  });
  app.post(
    "/api/admin/assign",
    mutation("assign", async (sql, req) => {
      const input = z.object({ request_id: id, staff_id: id }).parse(req.body);
      const request = await one(sql, "SELECT * FROM requests WHERE id=$1", [
        input.request_id,
      ]);
      requireThat(request, 404, "Request not found.");
      requireThat(
        ["submitted", "assigned"].includes(request.status),
        409,
        "Only submitted or assigned requests can be assigned.",
      );
      await activeService(sql, request.service_id);
      await staffService(sql, input.staff_id, request.service_id);
      await sql.query(
        "UPDATE requests SET staff_id=$1,status='assigned',updated_at=now() WHERE id=$2",
        [input.staff_id, input.request_id],
      );
      await audit(sql, req.user!.id, "request_assigned", input.request_id, {
        from: request.status,
        to: "assigned",
        staff: input.staff_id,
      });
      return { ok: true };
    }),
  );
  async function closeRequest(
    sql: Sql,
    request: Row,
    actor: string | null,
    status: string,
    why: string,
  ) {
    requireThat(
      ["submitted", "assigned", "in_progress"].includes(request.status),
      409,
      "This request is already closed.",
    );
    const items = (
      await sql.query("SELECT * FROM request_items WHERE request_id=$1", [
        request.id,
      ])
    ).rows;
    for (const item of items) {
      await sql.query(
        "UPDATE inventory SET reserved=reserved-$1 WHERE service_id=$2 AND product_id=$3",
        [item.quantity, request.service_id, item.product_id],
      );
      await movement(
        sql,
        request.service_id,
        item.product_id,
        "release",
        item.quantity,
        actor,
        why,
        request.id,
      );
    }
    await sql.query(
      "UPDATE requests SET status=$1,updated_at=now() WHERE id=$2",
      [status, request.id],
    );
    await audit(sql, actor, "request_" + status, request.id, {
      from: request.status,
      to: status,
      reason: why,
    });
    return { ok: true };
  }
  app.post(
    "/api/admin/cancel",
    mutation("admin-cancel", async (sql, req) => {
      const input = z.object({ request_id: id, reason }).parse(req.body);
      const request = await one(sql, "SELECT * FROM requests WHERE id=$1", [
        input.request_id,
      ]);
      requireThat(request, 404, "Request not found.");
      return closeRequest(
        sql,
        request,
        req.user!.id,
        "cancelled",
        input.reason,
      );
    }),
  );
  app.post(
    "/api/public/cancel",
    mutation("public-cancel", async (sql, req) => {
      const input = z
        .object({ access: z.string().min(30).max(100) })
        .parse(req.body);
      const request = await one(
        sql,
        "SELECT * FROM requests WHERE access_hash=$1",
        [hash(input.access)],
      );
      requireThat(request, 404, "Request not found.");
      requireThat(
        request.status === "submitted",
        409,
        "Assigned requests must be cancelled by pantry staff.",
      );
      return closeRequest(
        sql,
        request,
        null,
        "cancelled",
        "Passenger cancellation",
      );
    }),
  );
  async function staffData(staff: string) {
    const services = (
      await db.query(
        "SELECT s.* FROM services s JOIN staff_services ss ON ss.service_id=s.id WHERE ss.user_id=$1 ORDER BY service_date DESC",
        [staff],
      )
    ).rows;
    const requests = (
      await db.query(
        "SELECT r.*,c.code FROM requests r JOIN compartments c ON c.id=r.compartment_id WHERE staff_id=$1 AND status IN ('assigned','in_progress') ORDER BY created_at",
        [staff],
      )
    ).rows;
    const carried = (
      await db.query(
        "SELECT c.*,p.name FROM carried c JOIN products p ON p.id=c.product_id WHERE user_id=$1 AND quantity>0",
        [staff],
      )
    ).rows;
    const locations = (
      await db.query(
        "SELECT DISTINCT ON(l.service_id) l.*,c.code FROM locations l JOIN compartments c ON c.id=l.compartment_id WHERE user_id=$1 ORDER BY service_id,created_at DESC",
        [staff],
      )
    ).rows;
    return {
      services,
      requests: await Promise.all(
        requests.map((entry) => requestDetail(db, entry, true)),
      ),
      carried,
      locations,
    };
  }
  app.get("/api/staff/data", async (req: AuthRequest, res) =>
    res.json(await staffData(req.user!.id)),
  );
  app.get("/api/admin/staff-preview/:id", async (req, res) => {
    const staff = id.parse(req.params.id);
    requireThat(
      await one(db, "SELECT id FROM users WHERE id=$1 AND role='staff'", [
        staff,
      ]),
      404,
      "Staff member not found.",
    );
    res.json(await staffData(staff));
  });
  app.post("/api/staff/qr-validate", async (req: AuthRequest, res) => {
    const input = z
      .object({ token: z.string().min(30).max(100) })
      .parse(req.body);
    const qr = await resolveQr(db, input.token);
    requireThat(
      qr.kind !== "passenger",
      403,
      "Use a staff location or item QR.",
    );
    await staffService(db, req.user!.id, qr.service_id);
    res.json(safeQr(qr));
  });
  app.post(
    "/api/staff/location",
    mutation("location", async (sql, req) => {
      const input = z
        .object({ token: z.string().min(30).max(100) })
        .parse(req.body);
      const qr = await resolveQr(sql, input.token);
      requireThat(
        qr.kind === "location",
        400,
        "Use a compartment location QR.",
      );
      await staffService(sql, req.user!.id, qr.service_id);
      const location = randomUUID();
      await sql.query(
        "INSERT INTO locations(id,user_id,service_id,compartment_id) VALUES($1,$2,$3,$4)",
        [location, req.user!.id, qr.service_id, qr.compartment_id],
      );
      await audit(sql, req.user!.id, "location_reported", location, {
        compartment: qr.code,
      });
      return { ok: true };
    }),
  );
  app.post(
    "/api/staff/carry",
    mutation("carry", async (sql, req) => {
      const input = z
        .object({ token: z.string().min(30).max(100), quantity: count })
        .parse(req.body);
      const qr = await resolveQr(sql, input.token);
      requireThat(qr.kind === "item", 400, "Use an item-carrying QR.");
      await staffService(sql, req.user!.id, qr.service_id);
      const stock = await one(
        sql,
        "SELECT i.*,p.active FROM inventory i JOIN products p ON p.id=i.product_id WHERE service_id=$1 AND product_id=$2",
        [qr.service_id, qr.product_id],
      );
      requireThat(stock?.active, 409, "This product is unavailable.");
      const total = await one(
        sql,
        "SELECT COALESCE(SUM(quantity),0)::int AS quantity FROM carried WHERE service_id=$1 AND product_id=$2",
        [qr.service_id, qr.product_id],
      );
      requireThat(
        stock.opening + stock.adjustments - stock.sold - total.quantity >=
          input.quantity,
        409,
        "Not enough uncarried stock in the pantry.",
      );
      await sql.query(
        "INSERT INTO carried(user_id,service_id,product_id,quantity) VALUES($1,$2,$3,$4) ON CONFLICT(user_id,service_id,product_id) DO UPDATE SET quantity=carried.quantity+$4",
        [req.user!.id, qr.service_id, qr.product_id, input.quantity],
      );
      await movement(
        sql,
        qr.service_id,
        qr.product_id,
        "carry",
        input.quantity,
        req.user!.id,
        "Staff confirmed collection",
      );
      await audit(sql, req.user!.id, "stock_collected", qr.product_id, {
        quantity: input.quantity,
      });
      return { ok: true };
    }),
  );
  app.post(
    "/api/staff/return",
    mutation("return", async (sql, req) => {
      const input = z
        .object({ service_id: id, product_id: id, quantity: count })
        .parse(req.body);
      await staffService(sql, req.user!.id, input.service_id);
      const changed = await sql.query(
        "UPDATE carried SET quantity=quantity-$1 WHERE user_id=$2 AND service_id=$3 AND product_id=$4 AND quantity >= $1 RETURNING product_id",
        [input.quantity, req.user!.id, input.service_id, input.product_id],
      );
      requireThat(changed.rows.length, 409, "You do not carry that quantity.");
      await movement(
        sql,
        input.service_id,
        input.product_id,
        "return",
        input.quantity,
        req.user!.id,
        "Returned to pantry",
      );
      await audit(sql, req.user!.id, "stock_returned", input.product_id, {
        quantity: input.quantity,
      });
      return { ok: true };
    }),
  );
  app.post(
    "/api/staff/request-action",
    mutation("request-action", async (sql, req) => {
      const input = z
        .object({
          request_id: id,
          action: z.enum(["start", "deliver", "unable"]),
          reason: reason.optional(),
          items: z
            .array(
              z.object({
                product_id: id,
                quantity: z.number().int().min(0).max(20),
              }),
            )
            .optional(),
        })
        .parse(req.body);
      const request = await one(
        sql,
        "SELECT * FROM requests WHERE id=$1 AND staff_id=$2",
        [input.request_id, req.user!.id],
      );
      requireThat(request, 404, "Assigned request not found.");
      await staffService(sql, req.user!.id, request.service_id);
      if (input.action === "unable") {
        requireThat(input.reason, 400, "Please provide a reason.");
        return closeRequest(
          sql,
          request,
          req.user!.id,
          "unable_to_fulfil",
          input.reason,
        );
      }
      if (input.action === "start") {
        requireThat(
          request.status === "assigned",
          409,
          "This request cannot be started.",
        );
        await sql.query(
          "UPDATE requests SET status='in_progress',updated_at=now() WHERE id=$1",
          [request.id],
        );
        await audit(sql, req.user!.id, "request_started", request.id, {
          from: "assigned",
          to: "in_progress",
        });
        return { ok: true };
      }
      requireThat(
        request.status === "in_progress",
        409,
        "Start the request before recording delivery.",
      );
      const items = (
        await sql.query("SELECT * FROM request_items WHERE request_id=$1", [
          request.id,
        ])
      ).rows;
      requireThat(
        input.items &&
          input.items.length === items.length &&
          new Set(input.items.map((item) => item.product_id)).size ===
            items.length,
        400,
        "Confirm delivered quantities for every item.",
      );
      let deliveredTotal = 0;
      for (const item of items) {
        const actual = input.items.find(
          (entry) => entry.product_id === item.product_id,
        )?.quantity;
        requireThat(
          actual !== undefined && actual <= item.quantity,
          400,
          "Delivered quantity must not exceed requested quantity.",
        );
        deliveredTotal += actual;
        if (actual) {
          const carried = await sql.query(
            "UPDATE carried SET quantity=quantity-$1 WHERE user_id=$2 AND service_id=$3 AND product_id=$4 AND quantity >= $1 RETURNING product_id",
            [actual, req.user!.id, request.service_id, item.product_id],
          );
          requireThat(
            carried.rows.length,
            409,
            "Collect sufficient items before delivery.",
          );
        }
        await sql.query(
          "UPDATE inventory SET reserved=reserved-$1,sold=sold+$2 WHERE service_id=$3 AND product_id=$4",
          [item.quantity, actual, request.service_id, item.product_id],
        );
        await sql.query(
          "UPDATE request_items SET delivered=$1 WHERE request_id=$2 AND product_id=$3",
          [actual, request.id, item.product_id],
        );
        await movement(
          sql,
          request.service_id,
          item.product_id,
          "delivered",
          actual,
          req.user!.id,
          "Confirmed actual delivery",
          request.id,
        );
        if (actual < item.quantity)
          await movement(
            sql,
            request.service_id,
            item.product_id,
            "release",
            item.quantity - actual,
            req.user!.id,
            "Undelivered reservation released",
            request.id,
          );
      }
      requireThat(
        deliveredTotal > 0,
        400,
        "Use unable to fulfil if no items were delivered.",
      );
      await sql.query(
        "UPDATE requests SET status='delivered',updated_at=now() WHERE id=$1",
        [request.id],
      );
      await audit(sql, req.user!.id, "request_delivered", request.id, {
        from: request.status,
        to: "delivered",
        items: input.items,
      });
      return { ok: true };
    }),
  );
  app.use("/api", (_req, res) =>
    res.status(404).json({ error: "API endpoint not found." }),
  );
  if (options.staticDir) {
    app.use(express.static(options.staticDir));
    app.get("/{*path}", (_req, res) =>
      res.sendFile(path.resolve(options.staticDir!, "index.html")),
    );
  }
  app.use((error: any, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof z.ZodError) {
      res.status(400).json({
        error: error.issues
          .map(
            (issue) => `${issue.path.join(".") || "Input"}: ${issue.message}`,
          )
          .join("; "),
      });
      return;
    }
    if (error instanceof Fault) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    if (error.code === "23505") {
      res.status(409).json({ error: "This record already exists." });
      return;
    }
    if (error.code === "23503" || error.code === "23514") {
      res
        .status(400)
        .json({ error: "Invalid relationship or stock quantity." });
      return;
    }
    if (error.type === "entity.parse.failed") {
      res.status(400).json({ error: "Invalid JSON." });
      return;
    }
    console.error("Request failed", error.name, error.code || "unknown");
    res
      .status(500)
      .json({ error: "The request could not be completed. Please try again." });
  });
  return app;
}
