import { useState } from "react";
import { CreditCard, ShieldCheck } from "lucide-react";
import { api, money, time, type RecordData } from "./api";
import { checkout } from "./checkout";

export function PaymentStatus({
  payment,
  closed = false,
}: {
  payment?: RecordData;
  closed?: boolean;
}) {
  if (!payment || payment.method !== "online")
    return <span className="payment-status">Pay on delivery</span>;
  return (
    <div
      className={`payment-status ${payment.status === "paid" ? "is-paid" : "is-pending"}`}
    >
      <strong>
        {payment.status === "paid"
          ? "Paid online"
          : closed
            ? "Payment window closed"
            : "Awaiting online payment"}
      </strong>
      {payment.mode === "test" && (
        <span className="test-payment-tag">TEST PAYMENT</span>
      )}
      {(payment.refund_due > 0 || payment.refunded > 0) && (
        <span>
          {payment.refund_status === "processed"
            ? `Refund processed: ${money(payment.refunded)}`
            : payment.refund_status === "needs_attention"
              ? "Refund requires pantry support"
              : `Refund pending: ${money(Math.max(0, payment.refund_due - payment.refunded))}`}
        </span>
      )}
    </div>
  );
}

export function PaymentCheckout({
  access,
  request,
  onUpdate,
}: {
  access: string;
  request: RecordData;
  onUpdate: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const payment = request.payment;
  const pending =
    payment?.method === "online" &&
    payment.status === "pending" &&
    request.status === "submitted";
  const perform = async (open: boolean) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = open
        ? await checkout(access, setError)
        : await api("/public/payments/status", { access });
      if (result.paid || result.payment?.status === "paid") {
        setError("");
        setNotice("Payment verified successfully.");
      }
      if (result.dismissed)
        setNotice(
          "Checkout closed. You can resume payment below. If your bank shows a debit, check payment status first.",
        );
      else if (result.paid === false)
        setNotice(
          "Payment is awaiting provider confirmation. Check payment status shortly; do not pay again if your bank shows a debit.",
        );
      await onUpdate();
    } catch (error) {
      setError((error as Error).message);
      await onUpdate();
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="payment-receipt" aria-label="Payment details">
      <PaymentStatus
        payment={payment}
        closed={request.status !== "submitted"}
      />
      {payment?.method === "online" ? (
        <>
          <p>
            Order total <strong>{money(payment.amount)}</strong>
          </p>
          {payment.mode === "test" && (
            <p className="payment-test-note">
              Razorpay test mode — no real money is transferred.
            </p>
          )}
          {payment.payment_id && (
            <p className="muted">Payment reference: {payment.payment_id}</p>
          )}
          {pending && (
            <>
              <p>
                Pay before {time(payment.expires_at)}. Staff receive the request
                after payment is verified.
              </p>
              {request.can_pay ? (
                <div className="payment-actions">
                  <button disabled={busy} onClick={() => void perform(true)}>
                    <CreditCard size={17} />
                    {busy ? "Please wait…" : "Pay securely with Razorpay"}
                  </button>
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() => void perform(false)}
                  >
                    Check payment status
                  </button>
                </div>
              ) : (
                <p>
                  <a
                    href={`/user?return=${encodeURIComponent("/r/" + access)}`}
                  >
                    Verify your mobile to resume payment
                  </a>
                </p>
              )}
            </>
          )}
          {!pending && payment.status === "pending" && (
            <p>
              This payment window is closed. Any late successful charge will be
              queued for refund.
            </p>
          )}
          {payment.refund_due > 0 && (
            <p>
              Refunds go back to the original payment method. Bank processing
              times vary; keep this tracking link.
            </p>
          )}
          <p className="muted">
            <ShieldCheck size={15} /> Payment is confirmed by the server, not
            just the checkout popup.
          </p>
        </>
      ) : (
        <p>
          Payment is due on delivery. Confirm the payment method with pantry
          staff.
        </p>
      )}
      {notice && (
        <p role="status" className="notice">
          {notice}
        </p>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </section>
  );
}
