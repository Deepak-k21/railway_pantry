import { api } from "./api";

type CheckoutResult = {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
};
type CheckoutOptions = Record<string, unknown> & {
  handler: (result: CheckoutResult) => void;
  modal: { ondismiss: () => void };
};
type CheckoutInstance = {
  open(): void;
  on(
    name: string,
    handler: (event: { error?: { description?: string } }) => void,
  ): void;
};
declare global {
  interface Window {
    Razorpay?: new (options: CheckoutOptions) => CheckoutInstance;
  }
}
let loading: Promise<void> | undefined;
function loadCheckout() {
  if (window.Razorpay) return Promise.resolve();
  if (loading) return loading;
  loading = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.async = true;
    const timeout = window.setTimeout(() => {
      script.remove();
      reject(new Error("Secure checkout took too long to load. Please retry."));
    }, 20000);
    script.onload = () => {
      clearTimeout(timeout);
      if (window.Razorpay) resolve();
      else reject(new Error("Secure checkout is unavailable. Please retry."));
    };
    script.onerror = () => {
      clearTimeout(timeout);
      script.remove();
      reject(
        new Error(
          "Secure checkout could not load. Check your connection and retry.",
        ),
      );
    };
    document.head.appendChild(script);
  }).catch((error) => {
    loading = undefined;
    throw error;
  });
  return loading;
}

export async function checkout(
  access: string,
  onFailure: (message: string) => void,
) {
  const order = await api("/public/payments/order", { access });
  if (order.key_id === "rzp_test_demo_mode") {
    const demoResult: CheckoutResult = {
      razorpay_order_id: order.order_id,
      razorpay_payment_id: "pay_demo_" + Math.random().toString(36).slice(2, 12),
      razorpay_signature: "demo_signature",
    };
    await api("/public/payments/verify", { access, ...demoResult });
    return { paid: true };
  }
  await loadCheckout();
  return new Promise<{ paid: boolean; dismissed?: boolean }>(
    (resolve, reject) => {
      const instance = new window.Razorpay!({
        key: order.key_id,
        order_id: order.order_id,
        amount: order.amount,
        currency: order.currency,
        name: "Railway Pantry",
        description: `Food request ${order.reference}`,
        theme: { color: "#5147a7" },
        retry: { enabled: true },
        handler: (result) => {
          void api("/public/payments/verify", { access, ...result })
            .then(resolve)
            .catch(reject);
        },
        modal: { ondismiss: () => resolve({ paid: false, dismissed: true }) },
      });
      instance.on("payment.failed", (event) =>
        onFailure(
          event.error?.description ||
            "Payment was not completed. You can retry securely.",
        ),
      );
      instance.open();
    },
  );
}
