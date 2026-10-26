export type RecordData = Record<string, any>;
let csrf: string | null = null;
let passengerCsrf: string | null = null;
export function setCsrf(value: string | null) {
  csrf = value;
}
export function setPassengerCsrf(value: string | null) {
  passengerCsrf = value;
}
export async function api<T = any>(
  url: string,
  body?: unknown,
  key?: string,
): Promise<T> {
  const response = await fetch("/api" + url, {
    method: body === undefined ? "GET" : "POST",
    credentials: "same-origin",
    headers: {
      "X-Workspace":
        window.location.pathname.replace(/\/+$/, "") === "/staff" ||
        window.location.pathname.startsWith("/scan/")
          ? "staff"
          : "admin",
      ...(body === undefined
        ? {}
        : {
            "Content-Type": "application/json",
            ...(csrf ? { "X-CSRF-Token": csrf } : {}),
            ...(url.startsWith("/public/") && passengerCsrf
              ? { "X-Passenger-CSRF": passengerCsrf }
              : {}),
            "Idempotency-Key": key || crypto.randomUUID(),
          }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let result;
  try {
    result = await response.json();
  } catch {
    throw new Error("The server is unavailable. Please try again.");
  }
  if (!response.ok) throw new Error(result.error || "Request failed.");
  return result;
}
export const money = (amount: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(amount / 100);
export const time = (value: string) =>
  new Date(value).toLocaleString("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  });
