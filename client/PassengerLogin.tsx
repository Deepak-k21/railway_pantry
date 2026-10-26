import { useEffect, useRef, useState } from "react";
import { ArrowRight, Check, Phone, ShieldCheck } from "lucide-react";
import { api, setPassengerCsrf, type RecordData } from "./api";
import { RailwayScene } from "./RailwayScene";

export function PassengerLogin({
  qr,
  context,
  delivery,
  onVerified,
}: {
  qr: string;
  context: RecordData;
  delivery: string;
  onVerified: () => Promise<void>;
}) {
  const [mobile, setMobile] = useState("");
  const [code, setCode] = useState("");
  const [challenge, setChallenge] = useState<RecordData | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [resendAt, setResendAt] = useState(0);
  const [now, setNow] = useState(Date.now());
  const codeField = useRef<HTMLInputElement>(null);
  const wait = Math.max(0, Math.ceil((resendAt - now) / 1000));
  useEffect(() => {
    if (!resendAt) return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [resendAt]);
  useEffect(() => {
    if (challenge) codeField.current?.focus();
  }, [challenge]);
  const send = async () => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await api("/public/auth/send-otp", { qr, mobile });
      setChallenge(result);
      setCode("");
      setNow(Date.now());
      setResendAt(Date.now() + result.resendAfter * 1000);
      setNotice(
        result.delivery === "console"
          ? "Your code is ready in the backend terminal. Enter it below to continue."
          : `Verification code sent to ${result.mobile}.`,
      );
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section
      className="passenger-auth"
      aria-label="Passenger mobile verification"
    >
      <div className="passenger-auth-story">
        <span className="eyebrow">WELCOME ABOARD</span>
        <h1>
          Your journey.
          <br />
          <em>A little more delicious.</em>
        </h1>
        <p>
          {context.service_name} · {context.number}
          <br />
          {context.origin} → {context.destination}
        </p>
        <RailwayScene compartment={context.compartment} />
      </div>
      <div className="passenger-auth-card panel">
        <div className="passenger-auth-icon">
          <Phone size={26} />
        </div>
        <span className="eyebrow">YOUR ONBOARD PANTRY</span>
        <h2>
          {challenge
            ? "Enter your verification code"
            : "Let’s get you settled in"}
        </h2>
        <p className="muted">
          {challenge
            ? `Enter the 6-digit code for ${challenge.mobile}. Your code is valid for 5 minutes.`
            : `Verify your mobile number to explore the menu and order to your seat in coach ${context.compartment}.`}
        </p>
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            if (!challenge) {
              await send();
              return;
            }
            setBusy(true);
            setError("");
            try {
              const result = await api("/public/auth/verify-otp", {
                qr,
                challenge: challenge.challenge,
                code,
              });
              setPassengerCsrf(result.passenger.csrf);
              await onVerified();
            } catch (error) {
              setError((error as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {challenge ? (
            <label>
              Verification code
              <input
                ref={codeField}
                className="otp-input"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                maxLength={6}
                minLength={6}
                placeholder="000000"
                required
                value={code}
                onChange={(event) =>
                  setCode(event.target.value.replace(/\D/g, "").slice(0, 6))
                }
              />
            </label>
          ) : (
            <div>
              <label htmlFor="passenger-mobile">Mobile number</label>
              <div className="mobile-number-field">
                <span>+91</span>
                <input
                  id="passenger-mobile"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel-national"
                  required
                  pattern="[6-9][0-9]{9}"
                  maxLength={10}
                  minLength={10}
                  placeholder="10-digit mobile number"
                  value={mobile}
                  onChange={(event) =>
                    setMobile(
                      event.target.value.replace(/\D/g, "").slice(0, 10),
                    )
                  }
                />
              </div>
            </div>
          )}
          {notice && (
            <p className="notice" role="status">
              {notice}
            </p>
          )}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <button disabled={busy}>
            {busy
              ? "Please wait…"
              : challenge
                ? "Verify & continue"
                : "Send verification code"}
            {challenge ? <Check size={18} /> : <ArrowRight size={18} />}
          </button>
        </form>
        {challenge && (
          <div className="otp-actions">
            <button
              className="text-button"
              disabled={busy || wait > 0}
              onClick={() => void send()}
            >
              {wait > 0 ? `Resend code in ${wait}s` : "Resend code"}
            </button>
            <button
              className="text-button"
              disabled={busy}
              onClick={() => {
                setChallenge(null);
                setCode("");
                setError("");
                setNotice("");
              }}
            >
              Change mobile number
            </button>
          </div>
        )}
        {delivery === "console" && (
          <p className="otp-local-note">
            Local testing: no SMS is sent. Find the 6-digit code in the terminal
            running npm run dev.
          </p>
        )}
        <p className="passenger-auth-security">
          <ShieldCheck size={17} /> A private sign-in for your food requests.
        </p>
      </div>
    </section>
  );
}
