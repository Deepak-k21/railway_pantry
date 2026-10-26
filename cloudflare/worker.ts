import { Container } from "@cloudflare/containers";

interface Env {
  PANTRY: DurableObjectNamespace<RailwayPantryContainer>;
  APP_ORIGIN: string;
  DATABASE_URL: string;
  REPLAY_SECRET: string;
  PROXY_SECRET: string;
  TWILIO_ACCOUNT_SID: string;
  TWILIO_AUTH_TOKEN: string;
  TWILIO_VERIFY_SERVICE_SID: string;
}

export class RailwayPantryContainer extends Container<Env> {
  defaultPort = 3001;
  sleepAfter = "10m";
  enableInternet = true;
  envVars = {
    NODE_ENV: "production",
    HOST: "0.0.0.0",
    PORT: "3001",
    OTP_PROVIDER: "twilio",
    APP_ORIGIN: this.env.APP_ORIGIN,
    DATABASE_URL: this.env.DATABASE_URL,
    REPLAY_SECRET: this.env.REPLAY_SECRET,
    PROXY_SECRET: this.env.PROXY_SECRET,
    TWILIO_ACCOUNT_SID: this.env.TWILIO_ACCOUNT_SID,
    TWILIO_AUTH_TOKEN: this.env.TWILIO_AUTH_TOKEN,
    TWILIO_VERIFY_SERVICE_SID: this.env.TWILIO_VERIFY_SERVICE_SID,
  };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const unavailable = () =>
      Response.json(
        {
          error:
            "Service is temporarily unavailable. Please try again shortly.",
        },
        {
          status: 503,
          headers: { "Retry-After": "15", "Cache-Control": "no-store" },
        },
      );
    const required = [
      "DATABASE_URL",
      "REPLAY_SECRET",
      "PROXY_SECRET",
      "TWILIO_ACCOUNT_SID",
      "TWILIO_AUTH_TOKEN",
      "TWILIO_VERIFY_SERVICE_SID",
    ] as const;
    if (
      required.some((key) => !env[key]) ||
      !env.APP_ORIGIN ||
      /YOUR-SUBDOMAIN/i.test(env.APP_ORIGIN)
    ) {
      console.error(
        "Deployment configuration is incomplete. Check the required bindings and APP_ORIGIN.",
      );
      return unavailable();
    }
    const url = new URL(request.url);
    if (url.origin !== env.APP_ORIGIN) {
      if (request.method === "GET" || request.method === "HEAD")
        return Response.redirect(
          env.APP_ORIGIN + url.pathname + url.search,
          308,
        );
      return Response.json(
        { error: "Open the website at its configured address and try again." },
        { status: 403 },
      );
    }
    const headers = new Headers(request.headers);
    for (const name of [
      "forwarded",
      "x-forwarded-for",
      "x-pantry-client-ip",
      "x-pantry-proxy-secret",
    ])
      headers.delete(name);
    const clientIp = request.headers.get("CF-Connecting-IP");
    if (clientIp) {
      headers.set("X-Pantry-Client-IP", clientIp);
      headers.set("X-Pantry-Proxy-Secret", env.PROXY_SECRET);
    }
    try {
      return await env.PANTRY.getByName("production").fetch(
        new Request(request, { headers }),
      );
    } catch {
      console.error("The application container is unavailable.");
      return unavailable();
    }
  },
} satisfies ExportedHandler<Env>;
