import { isIP } from "node:net";
import { timingSafeEqual } from "node:crypto";
import type { Express } from "express";
import { hash } from "./security.js";

export function configureTrustedProxy(app: Express, secret?: string) {
  if (!secret) return;
  app.set("trust proxy", 1);
  app.use((req, _res, next) => {
    const clientIp = req.header("X-Pantry-Client-IP");
    const supplied = req.header("X-Pantry-Proxy-Secret") || "";
    delete req.headers["x-forwarded-for"];
    delete req.headers.forwarded;
    delete req.headers["x-pantry-client-ip"];
    delete req.headers["x-pantry-proxy-secret"];
    if (
      clientIp &&
      isIP(clientIp) &&
      timingSafeEqual(Buffer.from(hash(supplied)), Buffer.from(hash(secret)))
    )
      req.headers["x-forwarded-for"] = clientIp;
    next();
  });
}
