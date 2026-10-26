import { useCallback, useState } from "react";
import { ArrowRight, QrCode } from "lucide-react";
import { api } from "./api";
import { Scanner, extractToken } from "./Scanner";

export function PassengerEntry() {
  const [raw, setRaw] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const open = useCallback(async (value: string) => {
    setBusy(true);
    setError("");
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
