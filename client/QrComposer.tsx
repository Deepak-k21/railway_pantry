import { useEffect, useRef, useState } from "react";
import {
  QrCode,
  ShoppingBag,
  MapPin,
  Boxes,
  X,
  ArrowRight,
} from "lucide-react";
import { api, type RecordData as Row } from "./api";

export const qrKinds = [
  {
    kind: "passenger",
    name: "Passenger ordering",
    description: "Opens the welcome page and menu for this compartment.",
    Icon: ShoppingBag,
  },
  {
    kind: "location",
    name: "Staff compartment location",
    description: "Staff confirms their current coach after scanning.",
    Icon: MapPin,
  },
  {
    kind: "item",
    name: "Staff item collection",
    description: "Staff confirms food quantities before taking them to sell.",
    Icon: Boxes,
  },
];

export function QrComposer({
  data,
  previous,
  initialKind,
  onClose,
  onCreated,
  onSetup,
}: {
  data: Row;
  previous?: Row;
  initialKind?: string;
  onClose: () => void;
  onCreated: (result: Row) => void;
  onSetup: (target: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const key = useRef(crypto.randomUUID());
  const [kind, setKind] = useState(
      previous?.kind || initialKind || "passenger",
    ),
    [target, setTarget] = useState(
      previous?.product_id || previous?.compartment_id || "",
    ),
    [days, setDays] = useState(1),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const service = data.services.find(
    (entry: Row) => entry.id === data.selected,
  );
  const targets =
    kind === "item"
      ? data.inventory
          .filter((entry: Row) => entry.active)
          .map((entry: Row) => ({ id: entry.product_id, name: entry.name }))
      : data.compartments.map((entry: Row) => ({
          id: entry.id,
          name: entry.code,
        }));
  const ready = service?.active && targets.length > 0;
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  const change = () => {
    key.current = crypto.randomUUID();
    setError("");
  };
  return (
    <dialog
      ref={dialog}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          if (!ready) return;
          setBusy(true);
          setError("");
          try {
            const result = await api(
              "/admin/qr",
              {
                service_id: data.selected,
                kind,
                ...(kind === "item"
                  ? { product_id: target }
                  : { compartment_id: target }),
                days,
                ...(previous ? { replace_id: previous.id } : {}),
              },
              key.current,
            );
            onCreated(result);
          } catch (error) {
            setError((error as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="dialog-heading">
          <h2>{previous ? "Regenerate QR code" : "Generate a QR code"}</h2>
          <button
            type="button"
            className="icon"
            disabled={busy}
            aria-label="Close dialog"
            onClick={onClose}
          >
            <X />
          </button>
        </div>
        <div className="qr-service">
          <QrCode />
          <div>
            <strong>{service?.name || "No service selected"}</strong>
            <small>
              {service
                ? `Train ${service.number} · ${String(service.service_date).slice(0, 10)}`
                : "Create a service to get started."}
            </small>
          </div>
        </div>
        <div className="form-grid">
          <label>
            Workflow
            <select
              aria-label="Workflow"
              value={kind}
              disabled={!!previous || busy}
              onChange={(event) => {
                setKind(event.target.value);
                setTarget("");
                change();
              }}
            >
              {qrKinds.map((entry) => (
                <option key={entry.kind} value={entry.kind}>
                  {entry.name}
                </option>
              ))}
            </select>
          </label>
          <p className="muted">
            {qrKinds.find((entry) => entry.kind === kind)?.description}
          </p>
          {!service?.active ? (
            <p role="status" className="error">
              Select an active service before generating a QR code.
            </p>
          ) : !targets.length ? (
            <div className="qr-missing" role="status">
              <h3>
                {kind === "item"
                  ? "No stocked food items yet"
                  : "No compartments yet"}
              </h3>
              <p>
                {kind === "item"
                  ? "Add a product to your catalogue and set its opening stock for this service."
                  : "Add a real compartment code, such as S1 or B2, for this service."}
              </p>
              <button
                type="button"
                className="secondary"
                onClick={() =>
                  onSetup(
                    kind === "item"
                      ? data.products.length
                        ? "inventory"
                        : "catalogue"
                      : "compartment",
                  )
                }
              >
                {kind === "item"
                  ? data.products.length
                    ? "Set opening stock"
                    : "Add catalogue products"
                  : "Add a compartment"}
                <ArrowRight size={16} />
              </button>
            </div>
          ) : (
            <label>
              {kind === "item" ? "Food item" : "Compartment"}
              <select
                aria-label={
                  kind === "item"
                    ? "Product (item QR only)"
                    : "Compartment (passenger or location QR)"
                }
                value={target}
                disabled={!!previous || busy}
                required
                onChange={(event) => {
                  setTarget(event.target.value);
                  change();
                }}
              >
                <option value="">
                  Choose{" "}
                  {kind === "item" ? "a stocked food item" : "a compartment"}…
                </option>
                {targets.map((entry: Row) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label>
            Valid for days
            <input
              type="number"
              min={1}
              max={30}
              required
              value={days}
              disabled={busy}
              onChange={(event) => {
                setDays(Number(event.target.value));
                change();
              }}
            />
          </label>
          <small className="muted">
            For future journeys, expiry is calculated from the service date.{" "}
            {previous
              ? "The previous code will stop working when you confirm."
              : "You can reopen, download and print this code later."}
          </small>
        </div>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button
            className="secondary"
            type="button"
            disabled={busy}
            onClick={onClose}
          >
            Cancel
          </button>
          <button disabled={!ready || !target || busy}>
            {busy ? "Generating…" : "Save changes"}
            <QrCode size={16} />
          </button>
        </div>
      </form>
    </dialog>
  );
}
