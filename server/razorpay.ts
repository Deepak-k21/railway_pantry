import { createHmac, timingSafeEqual } from "node:crypto";
import { requireThat } from "./security.js";
import type { Row } from "./db.js";

export interface PaymentGateway {
  keyId: string;
  mode: "test" | "live";
  verifyCheckout(
    orderId: string,
    paymentId: string,
    signature: string,
  ): boolean;
  verifyWebhook(body: Buffer, signature: string): boolean;
  createOrder(amount: number, receipt: string): Promise<Row>;
  findOrder(receipt: string): Promise<Row | undefined>;
  fetchOrder(id: string): Promise<Row>;
  fetchPayment(id: string): Promise<Row>;
  orderPayments(id: string): Promise<Row[]>;
  capturePayment(id: string, amount: number): Promise<Row>;
  refund(paymentId: string, amount: number, key: string): Promise<Row>;
  fetchRefund(id: string): Promise<Row>;
}

export function validSignature(
  data: string | Buffer,
  signature: string,
  secret: string,
) {
  if (!/^[a-f0-9]{64}$/i.test(signature)) return false;
  const expected = createHmac("sha256", secret).update(data).digest();
  return timingSafeEqual(expected, Buffer.from(signature, "hex"));
}

export function createRazorpay(env = process.env): PaymentGateway | undefined {
  const keyId = env.RAZORPAY_KEY_ID,
    secret = env.RAZORPAY_KEY_SECRET,
    webhook = env.RAZORPAY_WEBHOOK_SECRET;
  if (!keyId && !secret && !webhook) return undefined;
  const mode = env.PAYMENTS_MODE || "test";
  if (!keyId || !secret || !webhook)
    throw new Error(
      "Configure RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET and RAZORPAY_WEBHOOK_SECRET together.",
    );
  if (
    !["test", "live"].includes(mode) ||
    !keyId.startsWith(`rzp_${mode}_`) ||
    webhook.length < 32
  )
    throw new Error(
      "PAYMENTS_MODE must match the Razorpay key prefix; use a webhook secret with at least 32 characters.",
    );
  const call = async (
    path: string,
    body?: object,
    headers: Record<string, string> = {},
  ) => {
    let response: globalThis.Response;
    try {
      response = await fetch("https://api.razorpay.com/v1/" + path, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(`${keyId}:${secret}`).toString("base64")}`,
          "Content-Type": "application/json",
          ...headers,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(15000),
      });
    } catch {
      requireThat(
        false,
        503,
        "The payment provider could not be reached. Please check payment status before trying again.",
      );
    }
    requireThat(
      response.ok,
      503,
      "The payment provider could not complete this operation. Please retry or contact pantry support.",
    );
    return response.json();
  };
  return {
    keyId,
    mode: mode as "test" | "live",
    verifyCheckout: (orderId, paymentId, signature) =>
      validSignature(`${orderId}|${paymentId}`, signature, secret),
    verifyWebhook: (body, signature) =>
      validSignature(body, signature, webhook),
    createOrder: (amount, receipt) =>
      call("orders", {
        amount,
        currency: "INR",
        receipt,
        partial_payment: false,
      }),
    findOrder: async (receipt) =>
      (
        await call(
          "orders?receipt=" + encodeURIComponent(receipt) + "&count=100",
        )
      ).items?.find((order: Row) => order.receipt === receipt),
    fetchOrder: (id) => call("orders/" + encodeURIComponent(id)),
    fetchPayment: (id) => call("payments/" + encodeURIComponent(id)),
    orderPayments: async (id) =>
      (await call(`orders/${encodeURIComponent(id)}/payments`)).items || [],
    capturePayment: (id, amount) =>
      call(`payments/${encodeURIComponent(id)}/capture`, {
        amount,
        currency: "INR",
      }),
    refund: (id, amount, key) =>
      call(
        `payments/${encodeURIComponent(id)}/refund`,
        {
          amount,
          speed: "normal",
          receipt: key,
          notes: { pantry_refund_id: key },
        },
        { "X-Refund-Idempotency": key },
      ),
    fetchRefund: (id) => call("refunds/" + encodeURIComponent(id)),
  };
}
