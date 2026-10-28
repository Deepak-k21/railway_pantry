import { useCallback, useEffect, useState } from "react";
import { ArrowRight, QrCode, Train } from "lucide-react";
import { api } from "./api";
import { Scanner, extractToken } from "./Scanner";

export function PassengerEntry() {
  const [raw, setRaw] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [demoQr, setDemoQr] = useState<{
    available: boolean;
    token?: string;
    coach?: string;
    service_name?: string;
    number?: string;
  } | null>(null);

  useEffect(() => {
    api("/public/demo-qr")
      .then((data) => {
        if (data?.available) setDemoQr(data);
      })
      .catch(() => {});
  }, []);

  const open = useCallback(async (value: string) => {
    setBusy(true);
    setError("");
    const trimmed = value.trim();
    if (/^\+?91?[6-9]\d{9}$/.test(trimmed.replace(/[\s()-]/g, ""))) {
      setError(
        "You entered a phone number. This step requires a coach QR link or code. Scan your coach QR or click the coach link below to enter.",
      );
      setBusy(false);
      return;
    }
    try {
      const token = extractToken(value);
      await api("/public/qr/" + encodeURIComponent(token));
      window.location.assign("/p/" + encodeURIComponent(token));
    } catch (error) {
      setError((error as Error).message);
      setBusy(false);
    }
  }, []);
  return (
    <main className="passenger-entry">
      <section className="panel passenger-auth-card">
        <div className="passenger-auth-icon">
          <QrCode size={28} />
        </div>
        <span className="eyebrow">WELCOME ABOARD</span>
        <h1>Passenger sign in</h1>
        <p className="muted">
          Scan the passenger QR in your coach, then verify your mobile number to
          order food to your seat.
        </p>

        {demoQr?.available && demoQr.token && (
          <div
            style={{
              margin: "14px 0",
              padding: "14px 16px",
              background: "rgba(37, 99, 235, 0.08)",
              border: "1px solid #3b82f6",
              borderRadius: "8px",
              textAlign: "center",
            }}
          >
            <p
              style={{
                margin: "0 0 8px 0",
                fontSize: "0.88rem",
                color: "#1e40af",
                fontWeight: 600,
              }}
            >
              Direct Access (Testing without camera):
            </p>
            <a
              href={`/p/${encodeURIComponent(demoQr.token)}`}
              className="button"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                fontSize: "0.9rem",
                padding: "8px 16px",
              }}
            >
              <Train size={16} /> Open Coach {demoQr.coach} ({demoQr.number}){" "}
              <ArrowRight size={16} />
            </a>
          </div>
        )}

        <Scanner
          onRead={open}
          description="Point at the passenger ordering QR in your coach."
        />
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void open(raw);
          }}
        >
          <label>
            Passenger QR link or code
            <input
              value={raw}
              onChange={(event) => setRaw(event.target.value)}
              required
              placeholder="Paste your coach’s passenger QR link"
            />
          </label>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <button disabled={busy}>
            {busy ? "Opening your coach…" : "Continue to mobile verification"}
            <ArrowRight size={17} />
          </button>
        </form>
      </section>
    </main>
  );
}
