import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createRoot } from "react-dom/client";
import {
  TrainFront,
  LayoutDashboard,
  ShoppingBag,
  Boxes,
  Users,
  QrCode,
  ClipboardList,
  Route,
  LogOut,
  Plus,
  ArrowRight,
  Check,
  Menu,
  X,
  Search,
  RefreshCw,
  Utensils,
  ShieldCheck,
  MapPin,
  Clock,
  ChevronRight,
  PackageCheck,
  LoaderCircle,
  Camera,
} from "lucide-react";
import {
  api,
  setCsrf,
  setPassengerCsrf,
  money,
  time,
  type RecordData as Row,
} from "./api";
import { Scanner, extractToken } from "./Scanner";
import { QrComposer, qrKinds } from "./QrComposer";
import "./styles.css";
import "./premium.css";
import { RailwayScene } from "./RailwayScene";
import { PassengerLogin } from "./PassengerLogin";
import { PassengerEntry } from "./PassengerEntry";

const labels: Row = {
  submitted: "Awaiting assignment",
  assigned: "Assigned",
  in_progress: "In progress",
  delivered: "Delivered",
  cancelled: "Cancelled",
  unable_to_fulfil: "Unable to fulfil",
};
function Badge({ value }: { value: string }) {
  return (
    <span className={"badge " + value}>
      {labels[value] || value.replaceAll("_", " ")}
    </span>
  );
}
function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <Utensils size={32} />
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}
function Loading() {
  return (
    <div className="loading" role="status">
      <LoaderCircle className="spin" /> Loading your workspace…
    </div>
  );
}
function Brand() {
  return (
    <div className="brand">
      <div className="brand-icon">
        <TrainFront size={25} />
      </div>
      <div>
        <strong>Railway Pantry</strong>
        <small>BETTER SERVICE. EVERY COACH.</small>
      </div>
    </div>
  );
}
function Panel({
  title,
  description,
  children,
  action,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className="panel">
      <header>
        <div>
          <h2>{title}</h2>
          {description && <p>{description}</p>}
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}
type Field = {
  name: string;
  label: string;
  type?: string;
  options?: { value: string; label: string }[];
  value?: string | number;
  required?: boolean;
  min?: number;
  max?: number;
  step?: string;
};
type DialogConfig = {
  title: string;
  description?: string;
  fields: Field[];
  submit: (values: Row, key: string) => Promise<unknown>;
  label?: string;
  after?: (result: any) => void;
};
function FormDialog({
  config,
  close,
  onSaved,
}: {
  config: DialogConfig;
  close: () => void;
  onSaved: () => Promise<void>;
}) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const key = useRef(crypto.randomUUID());
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
    return () => dialog.current?.close();
  }, []);
  return (
    <dialog
      ref={dialog}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) close();
      }}
    >
      <form
        onChange={() => {
          key.current = crypto.randomUUID();
        }}
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError("");
          try {
            const values = Object.fromEntries(
              new FormData(event.currentTarget),
            );
            const result = await config.submit(values, key.current);
            await onSaved();
            close();
            config.after?.(result);
          } catch (error) {
            setError((error as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="dialog-heading">
          <h2>{config.title}</h2>
          <button
            type="button"
            className="icon"
            aria-label="Close dialog"
            disabled={busy}
            onClick={close}
          >
            <X />
          </button>
        </div>
        {config.description && <p className="muted">{config.description}</p>}
        <div className="form-grid">
          {config.fields.map((field) => (
            <label key={field.name}>
              {field.label}
              {field.options ? (
                <select
                  aria-label={field.label}
                  name={field.name}
                  defaultValue={field.value ?? ""}
                  required={field.required !== false}
                >
                  <option value="">Choose…</option>
                  {field.options.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              ) : field.type === "textarea" ? (
                <textarea
                  name={field.name}
                  defaultValue={field.value}
                  required={field.required !== false}
                  maxLength={500}
                />
              ) : (
                <input
                  name={field.name}
                  type={field.type || "text"}
                  defaultValue={field.value}
                  required={field.required !== false}
                  min={field.min}
                  max={field.max}
                  step={field.step}
                  maxLength={field.type === "password" ? 128 : 500}
                  autoComplete={
                    field.type === "password" ? "new-password" : "off"
                  }
                />
              )}
            </label>
          ))}
        </div>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={close}
          >
            Cancel
          </button>
          <button disabled={busy}>
            {busy ? "Saving…" : config.label || "Save changes"}
            <Check size={16} />
          </button>
        </div>
      </form>
    </dialog>
  );
}
function Login({ onLogin }: { onLogin: (user: Row) => void }) {
  const staffEntry =
    window.location.pathname.replace(/\/+$/, "") === "/staff" ||
    window.location.pathname.startsWith("/scan/");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [needsSetup, setNeedsSetup] = useState(false);
  useEffect(() => {
    if (!staffEntry) {
      api<{ needsSetup: boolean }>("/setup/status")
        .then((res) => setNeedsSetup(!!res?.needsSetup))
        .catch(() => {});
    }
  }, [staffEntry]);
  return (
    <div className="login-layout">
      <section className="login-story">
        <Brand />
        <div className="story-content">
          <span className="eyebrow">SERVICE THAT MOVES WITH YOU</span>
          <h1>
            A better journey.
            <br />
            One coach
            <br />
            <em>at a time.</em>
          </h1>
          <p>
            A connected pantry for the people on board. Coordinate requests,
            keep stock accurate, and help every meal reach the right seat.
          </p>
          <div className="route-art">
            <span>Pantry</span>
            <i />
            <span>Coach</span>
            <i />
            <span>Passenger</span>
          </div>
        </div>
        <small>Railway Pantry · Operations platform</small>
      </section>
      <section className="login-form">
        <div>
          <span className="eyebrow">YOUR OPERATIONS WORKSPACE</span>
          <h2>{staffEntry ? "Service staff sign in" : "Welcome aboard."}</h2>
          <p className="muted">
            {staffEntry
              ? "Use the staff email and password issued by your administrator. Your scanned code will remain ready after sign in."
              : "Sign in to the administrator workspace."}
          </p>
          {!staffEntry && <a href="/staff">Open service staff login</a>}
          {needsSetup && !staffEntry && (
            <div
              style={{
                background: "rgba(234, 88, 12, 0.12)",
                border: "1px solid #ea580c",
                borderRadius: "8px",
                padding: "1rem",
                marginTop: "1rem",
                marginBottom: "1rem",
              }}
            >
              <strong style={{ color: "#ea580c", display: "block" }}>
                First-time setup required:
              </strong>
              <p style={{ margin: "4px 0 10px 0", fontSize: "0.9rem" }}>
                No administrator account exists yet. Create your administrator account to get started.
              </p>
              <a
                className="button"
                href="/setup"
                style={{ display: "inline-flex", padding: "0.5rem 1rem", fontSize: "0.9rem" }}
              >
                Create Administrator Account <ArrowRight size={16} />
              </a>
            </div>
          )}
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              const values = Object.fromEntries(
                new FormData(event.currentTarget),
              );
              setError("");
              setBusy(true);
              try {
                const result = await api("/auth/login", values);
                setCsrf(result.csrf);
                onLogin(result.user);
              } catch (error) {
                setError((error as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <label>
              Email address
              <input
                type="email"
                name="email"
                autoComplete="username"
                required
                placeholder="you@your-organisation.in"
              />
            </label>
            <label>
              Password
              <input
                type="password"
                name="password"
                autoComplete="current-password"
                required
              />
            </label>
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <button disabled={busy}>
              {busy ? "Signing in…" : "Sign in securely"}
              <ArrowRight size={18} />
            </button>
          </form>
          <div className="login-note">
            <ShieldCheck size={20} />
            <p>
              Staff accounts are created by your administrator. Passengers can
              scan the compartment QR to request food.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
function Setup() {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [done, setDone] = useState(false);
  const setupToken = useRef(window.location.hash.slice(1));
  useEffect(() => {
    window.history.replaceState(null, "", "/setup");
  }, []);
  return (
    <div className="standalone">
      <Brand />
      <section className="panel setup-card">
        <span className="eyebrow">FIRST-RUN SETUP</span>
        <h1>Your pantry starts here.</h1>
        {done ? (
          <>
            <p>
              Your administrator account is ready. Sign in, create a service,
              and add your catalogue.
            </p>
            <a className="button" href="/">
              Go to sign in <ArrowRight size={16} />
            </a>
          </>
        ) : (
          <>
            <p className="muted">
              Create your administrator account. No sample accounts or
              operational data will be added.
            </p>
            <form
              onSubmit={async (event) => {
                event.preventDefault();
                setBusy(true);
                setError("");
                try {
                  await api("/setup", {
                    ...Object.fromEntries(new FormData(event.currentTarget)),
                    token: setupToken.current || undefined,
                  });
                  setDone(true);
                } catch (error) {
                  setError((error as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <label>
                Your name
                <input name="name" autoComplete="name" required />
              </label>
              <label>
                Email address
                <input
                  name="email"
                  type="email"
                  autoComplete="username"
                  required
                />
              </label>
              <label>
                Password (at least 12 characters)
                <input
                  name="password"
                  type="password"
                  minLength={12}
                  maxLength={128}
                  autoComplete="new-password"
                  required
                />
              </label>
              {error && (
                <p className="error" role="alert">
                  {error}
                </p>
              )}
              <button disabled={busy}>
                {busy ? "Creating account…" : "Create administrator"}
                <ArrowRight size={16} />
              </button>
            </form>
          </>
        )}
      </section>
    </div>
  );
}
function App() {
  const [user, setUser] = useState<Row | null>(null),
    [ready, setReady] = useState(false),
    [initialError, setInitialError] = useState("");
  useEffect(() => {
    let active = true;
    let retry: ReturnType<typeof setTimeout>;
    const connect = () => {
      api("/auth/me")
        .then((result) => {
          if (!active) return;
          setUser(result.user);
          setCsrf(result.csrf);
          setInitialError("");
          setReady(true);
        })
        .catch((error) => {
          if (!active) return;
          setInitialError(error.message);
          retry = setTimeout(connect, 2000);
        });
    };
    connect();
    return () => {
      active = false;
      clearTimeout(retry);
    };
  }, []);
  const path = window.location.pathname.replace(/\/+$/, "") || "/";
  if (initialError)
    return (
      <div className="standalone">
        <Brand />
        <p className="error">{initialError} Reconnecting automatically…</p>
        <button onClick={() => window.location.reload()}>
          Retry connection
        </button>
      </div>
    );
  if (!ready) return <Loading />;
  if (path === "/setup") return <Setup />;
  if (path === "/user")
    return (
      <div className="passenger">
        <header>
          <Brand />
          <span className="passenger-label">ONBOARD SERVICE</span>
        </header>
        <PassengerEntry />
      </div>
    );
  if (path.startsWith("/p/")) return <Passenger token={path.split("/")[2]} />;
  if (path.startsWith("/r/")) return <Tracking access={path.split("/")[2]} />;
  if (!user) return <Login onLogin={setUser} />;
  return (
    <Workspace
      user={user}
      onLogout={() => {
        setCsrf(null);
        setUser(null);
      }}
    />
  );
}
const navigation = [
  ["overview", "Overview", LayoutDashboard],
  ["requests", "Requests", ShoppingBag],
  ["inventory", "Inventory", Boxes],
  ["staff", "Staff & locations", Users],
  ["services", "Services & coaches", Route],
  ["catalogue", "Catalogue", Utensils],
  ["qr", "QR centre", QrCode],
  ["ledger", "Ledger & audit", ClipboardList],
  ["views", "Review all views", LayoutDashboard],
] as const;
function RequestAlerts({ onOpen }: { onOpen: (service: string) => void }) {
  const [services, setServices] = useState<Row[]>([]),
    [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    let pending = false;
    const refresh = async () => {
      if (pending) return;
      pending = true;
      try {
        const result = await api("/admin/notifications");
        if (live) {
          setServices(result.services);
          setError("");
        }
      } catch {
        if (live)
          setError("Request alerts could not refresh. Check your connection.");
      } finally {
        pending = false;
      }
    };
    void refresh();
    const timer = setInterval(refresh, 5000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, []);
  return (
    <>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {services.length > 0 && (
        <section
          className="notice request-alerts"
          aria-label="Incoming passenger requests"
        >
          <div role="status">
            <strong>
              {services.reduce((count, entry) => count + entry.pending, 0)}{" "}
              passenger request(s) awaiting assignment
            </strong>
            <p>
              New requests appear here automatically. Checks every 5 seconds
              while this workspace is open.
            </p>
          </div>
          {services.map((entry) => (
            <button
              className="secondary"
              key={entry.service_id}
              onClick={() => onOpen(entry.service_id)}
            >
              Review {entry.pending} · {entry.number} · {entry.name}
            </button>
          ))}
        </section>
      )}
    </>
  );
}
function Workspace({ user, onLogout }: { user: Row; onLogout: () => void }) {
  const [data, setData] = useState<Row | null>(null),
    [service, setService] = useState(""),
    [view, setView] = useState(
      user.role === "admin"
        ? "overview"
        : window.location.pathname.startsWith("/scan/")
          ? "scan"
          : "tasks",
    ),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [mobile, setMobile] = useState(false),
    [busy, setBusy] = useState(false),
    [config, setConfig] = useState<DialogConfig | null>(null),
    [qrResult, setQrResult] = useState<Row | null>(null),
    [search, setSearch] = useState("");
  const reload = useCallback(async () => {
    const result = await api(
      user.role === "admin"
        ? "/admin/data" + (service ? "?service=" + service : "")
        : "/staff/data",
    );
    setData(result);
  }, [user.role, service]);
  useEffect(() => {
    let live = true;
    const update = async () => {
      try {
        const result = await api(
          user.role === "admin"
            ? "/admin/data" + (service ? "?service=" + service : "")
            : "/staff/data",
        );
        if (live) {
          setData(result);
          setError("");
        }
      } catch (error) {
        if (live) setError((error as Error).message);
      }
    };
    void update();
    const interval = setInterval(update, 15000);
    return () => {
      live = false;
      clearInterval(interval);
    };
  }, [user.role, service]);
  const action = async (endpoint: string, body: unknown) => {
    setBusy(true);
    setError("");
    try {
      await api(endpoint, body);
      await reload();
      setNotice("Changes saved.");
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const open = (
    title: string,
    endpoint: string,
    fields: Field[],
    map: (values: Row) => Row = (values) => values,
    after?: (result: any) => void,
  ) =>
    setConfig({
      title,
      fields,
      submit: (values, key) => api(endpoint, map(values), key),
      after,
    });
  const selected = data?.selected;
  const serviceContext = data?.services.find(
    (entry: Row) => entry.id === selected,
  );
  const options = (rows: Row[], label = "name") =>
    rows.map((entry) => ({ value: entry.id, label: entry[label] }));
  const addService = () =>
    open("Create a train service", "/admin/services", [
      { name: "name", label: "Service name" },
      { name: "number", label: "Train number" },
      { name: "service_date", label: "Service date", type: "date" },
      { name: "origin", label: "Origin station" },
      { name: "destination", label: "Destination station" },
    ]);
  const addCompartment = () =>
    open(
      "Add a compartment",
      "/admin/compartments",
      [{ name: "code", label: "Compartment code (for example S1)" }],
      (values) => ({ ...values, service_id: selected }),
    );
  const productForm = (product?: Row) =>
    open(
      product ? "Edit product" : "Create a product",
      "/admin/products",
      [
        { name: "name", label: "Product name", value: product?.name },
        {
          name: "category_id",
          label: "Category",
          options: options(data!.categories),
          value: product?.category_id,
        },
        {
          name: "price",
          label: "Price in rupees",
          type: "number",
          min: 0,
          max: 100000,
          step: "0.01",
          value: product ? product.price / 100 : undefined,
        },
        {
          name: "description",
          label: "Description",
          type: "textarea",
          value: product?.description,
          required: false,
        },
        {
          name: "image_url",
          label: "HTTPS image URL (optional)",
          type: "url",
          value: product?.image_url,
          required: false,
        },
      ],
      (values) => ({
        ...values,
        price: Math.round(Number(values.price) * 100),
        ...(product ? { id: product.id, active: product.active } : {}),
      }),
    );
  const stockForm = (stock?: Row) =>
    open(
      stock ? "Adjust stock" : "Set opening stock",
      "/admin/stock",
      [
        ...(!stock
          ? [
              {
                name: "product_id",
                label: "Product",
                options: options(
                  data!.products.filter(
                    (product: Row) =>
                      !data!.inventory.some(
                        (entry: Row) => entry.product_id === product.id,
                      ),
                  ),
                ),
              },
            ]
          : []),
        {
          name: "quantity",
          label: stock
            ? "Quantity change (negative for removal)"
            : "Opening quantity",
          type: "number",
          min: stock ? -100000 : 0,
          max: 100000,
        },
        { name: "reason", label: "Reason", type: "textarea" },
      ],
      (values) => ({
        ...values,
        service_id: selected,
        product_id: stock?.product_id || values.product_id,
        quantity: Number(values.quantity),
        opening: !stock,
      }),
    );
  const staffForm = () =>
    open(
      "Create staff account",
      "/admin/staff",
      [
        { name: "name", label: "Display name" },
        { name: "email", label: "Login email", type: "email" },
        {
          name: "password",
          label: "Initial password (at least 12 characters)",
          type: "password",
        },
      ],
      (values) => ({
        ...values,
        ...(selected ? { service_id: selected } : {}),
      }),
    );
  const [qrDraft, setQrDraft] = useState<{
    previous?: Row;
    kind?: string;
  } | null>(null);
  const qrForm = (previous?: Row, kind?: string) =>
    setQrDraft({ previous, kind });
  const reopenQr = async (entry: Row) => {
    setError("");
    setBusy(true);
    try {
      setQrResult(await api("/admin/qr/" + entry.id));
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const account = () =>
    open(
      "Change password",
      "/auth/password",
      [
        { name: "current", label: "Current password", type: "password" },
        {
          name: "password",
          label: "New password (at least 12 characters)",
          type: "password",
        },
      ],
      (values) => values,
      onLogout,
    );
  const nav =
    user.role === "admin"
      ? navigation
      : ([
          ["tasks", "Assigned requests", ShoppingBag],
          ["scan", "Scan & confirm", QrCode],
          ["carried", "My carried items", Boxes],
        ] as const);
  return (
    <div
      className={
        user.role === "staff" ? "workspace staff-workspace" : "workspace"
      }
    >
      <aside className={mobile ? "sidebar open" : "sidebar"}>
        <Brand />
        <p className="nav-label">
          {user.role === "admin" ? "CONTROL CENTRE" : "STAFF WORKSPACE"}
        </p>
        <nav aria-label="Main navigation">
          {nav.map(([key, label, Icon]) => (
            <button
              key={key}
              className={"nav-link " + (view === key ? "active" : "")}
              onClick={() => {
                setView(key);
                setMobile(false);
                setSearch("");
              }}
            >
              <Icon size={19} />
              {label}
              {view === key && <ChevronRight size={16} />}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="service-note">
            <ShieldCheck />
            <span>
              Connected operations
              <br />
              <small>Every movement accounted for.</small>
            </span>
          </div>
          <button className="profile" onClick={account}>
            <span className="avatar">
              {user.name.slice(0, 2).toUpperCase()}
            </span>
            <span>
              {user.name}
              <small>
                {user.role === "admin" ? "Administrator" : "Pantry staff"}
              </small>
            </span>
          </button>
          <button
            className="nav-link"
            onClick={async () => {
              try {
                await api("/auth/logout", {});
                onLogout();
              } catch (error) {
                setError((error as Error).message);
              }
            }}
          >
            <LogOut size={16} />
            Sign out
          </button>
        </div>
      </aside>
      <main>
        <header className="topbar">
          <button
            className="icon mobile-menu"
            aria-label="Toggle navigation"
            onClick={() => setMobile(!mobile)}
          >
            <Menu />
          </button>
          <span>
            Operations <span className="slash">/</span>{" "}
            <strong>{nav.find((entry) => entry[0] === view)?.[1]}</strong>
          </span>
          <div className="top-right">
            <span className="online">
              <i /> Connected workspace
            </span>
            <button
              className="icon"
              aria-label="Refresh data"
              disabled={busy}
              onClick={async () => {
                try {
                  await reload();
                  setError("");
                } catch (error) {
                  setError((error as Error).message);
                }
              }}
            >
              <RefreshCw size={18} />
            </button>
          </div>
        </header>
        <div className="page">
          {user.role === "admin" && (
            <RequestAlerts
              onOpen={(serviceId) => {
                setService(serviceId);
                setView("requests");
                if (serviceId === service)
                  void reload().catch((error) => setError(error.message));
              }}
            />
          )}
          {error && (
            <div role="alert" className="error">
              {error}
            </div>
          )}
          {notice && (
            <div role="status" className="notice">
              {notice}
              <button
                className="icon"
                aria-label="Dismiss notification"
                onClick={() => setNotice("")}
              >
                <X size={16} />
              </button>
            </div>
          )}
          {!data ? (
            <Loading />
          ) : (
            <>
              <div className="page-heading">
                <div>
                  <span className="eyebrow">
                    {user.role === "admin"
                      ? "PANTRY OPERATIONS"
                      : "YOUR SERVICE, IN FOCUS"}
                  </span>
                  <h1>
                    {user.role === "staff" && view === "tasks"
                      ? "Service staff"
                      : view === "overview"
                        ? `Welcome, ${user.name.split(" ")[0]}.`
                        : nav.find((entry) => entry[0] === view)?.[1]}
                  </h1>
                  <p className="muted">
                    {view === "overview"
                      ? "A clear view of your service. A smoother journey for everyone."
                      : "Connected to your service records. Changes are saved securely."}
                  </p>
                </div>
                {user.role === "admin" && (
                  <label className="service-select">
                    Current service
                    <select
                      value={selected || ""}
                      onChange={(event) => setService(event.target.value)}
                    >
                      <option value="" disabled>
                        Select a service
                      </option>
                      {data.services.map((entry: Row) => (
                        <option key={entry.id} value={entry.id}>
                          {entry.number} · {entry.name} ·{" "}
                          {String(entry.service_date).slice(0, 10)}
                          {entry.active ? "" : " (closed)"}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </div>
              {user.role === "admin" && view === "overview" && (
                <>
                  <div className="service-banner">
                    <div className="banner-icon">
                      <TrainFront size={32} />
                    </div>
                    <div>
                      <span className="eyebrow">
                        {serviceContext
                          ? "CURRENT SERVICE"
                          : "READY FOR YOUR FIRST JOURNEY"}
                      </span>
                      <h2>
                        {serviceContext
                          ? serviceContext.name
                          : "Let’s get your pantry ready."}
                      </h2>
                      <p>
                        {serviceContext
                          ? `${serviceContext.origin} → ${serviceContext.destination} · Train ${serviceContext.number}`
                          : "Create a service, add your catalogue and stock, then print your compartment QR codes."}
                      </p>
                    </div>
                    <button
                      className="light"
                      onClick={() =>
                        serviceContext ? setView("services") : addService()
                      }
                    >
                      {serviceContext
                        ? "Manage service"
                        : "Create first service"}
                      <ArrowRight size={16} />
                    </button>
                  </div>
                  <div className="stats">
                    {[
                      [
                        "Open requests",
                        data.summary.open,
                        ShoppingBag,
                        "Waiting or being served",
                      ],
                      [
                        "To assign",
                        data.summary.awaiting,
                        Clock,
                        "Ready for staff assignment",
                      ],
                      [
                        "Delivered",
                        data.summary.delivered,
                        PackageCheck,
                        "Recorded deliveries",
                      ],
                      [
                        "Available units",
                        data.inventory.reduce(
                          (total: number, entry: Row) =>
                            total + entry.available,
                          0,
                        ),
                        Boxes,
                        "After reservations",
                      ],
                    ].map(([label, value, Icon, caption]: any) => (
                      <article className="stat" key={label}>
                        <span>
                          {label}
                          <Icon size={19} />
                        </span>
                        <strong>{value}</strong>
                        <small>{caption}</small>
                      </article>
                    ))}
                  </div>
                  <div className="two-columns">
                    <Panel
                      title="Request queue"
                      description="Latest requests for the selected service"
                      action={
                        <button
                          className="text-button"
                          onClick={() => setView("requests")}
                        >
                          View queue <ArrowRight size={14} />
                        </button>
                      }
                    >
                      {data.requests.length ? (
                        <div className="list">
                          {data.requests.slice(0, 5).map((entry: Row) => (
                            <div className="list-row" key={entry.id}>
                              <span className="coach-icon">{entry.code}</span>
                              <div>
                                <strong>{entry.reference}</strong>
                                <small>
                                  Seat {entry.seat} ·{" "}
                                  {entry.items.reduce(
                                    (total: number, item: Row) =>
                                      total + item.quantity,
                                    0,
                                  )}{" "}
                                  items
                                </small>
                              </div>
                              <Badge value={entry.status} />
                            </div>
                          ))}
                        </div>
                      ) : (
                        <Empty title="No requests yet">
                          Passenger requests appear here after a compartment QR
                          is used.
                        </Empty>
                      )}
                    </Panel>
                    <Panel
                      title="Compartment demand"
                      description="Outstanding items, grouped by compartment"
                    >
                      {data.demand.length ? (
                        <div className="list">
                          {data.demand.map((entry: Row) => (
                            <div
                              className="list-row"
                              key={entry.code + entry.name}
                            >
                              <span className="coach-icon">{entry.code}</span>
                              <div>
                                <strong>{entry.name}</strong>
                                <small>Outstanding demand</small>
                              </div>
                              <strong>{entry.quantity}</strong>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <Empty title="All clear">
                          There are no outstanding items for this service.
                        </Empty>
                      )}
                    </Panel>
                  </div>
                  <div className="two-columns">
                    <Panel
                      title="Stock watch"
                      description="Products with fewer than 10 available units"
                    >
                      {data.inventory.filter(
                        (entry: Row) => entry.available < 10,
                      ).length ? (
                        <div className="list">
                          {data.inventory
                            .filter((entry: Row) => entry.available < 10)
                            .map((entry: Row) => (
                              <div className="list-row" key={entry.product_id}>
                                <Boxes size={20} />
                                <div>
                                  <strong>{entry.name}</strong>
                                  <small>
                                    {entry.available} available ·{" "}
                                    {entry.reserved} reserved
                                  </small>
                                </div>
                                <Badge
                                  value={
                                    entry.available
                                      ? "low_stock"
                                      : "out_of_stock"
                                  }
                                />
                              </div>
                            ))}
                        </div>
                      ) : (
                        <Empty title="No stock alerts">
                          Set inventory in the Inventory workspace.
                        </Empty>
                      )}
                    </Panel>
                    <Panel
                      title="Staff location reports"
                      description="Last reported by staff; not GPS tracking"
                    >
                      {data.locations.length ? (
                        <div className="list">
                          {data.locations.map((entry: Row) => (
                            <div className="list-row" key={entry.id}>
                              <MapPin size={20} />
                              <div>
                                <strong>
                                  {entry.name} · {entry.code}
                                </strong>
                                <small>{time(entry.created_at)}</small>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <Empty title="No location reports">
                          Staff can scan a location QR to report their
                          compartment.
                        </Empty>
                      )}
                    </Panel>
                  </div>
                </>
              )}
              {user.role === "admin" && view === "services" && (
                <>
                  <div className="toolbar">
                    <button onClick={addService}>
                      <Plus size={17} />
                      Create service
                    </button>
                    <button
                      className="secondary"
                      disabled={!selected}
                      onClick={addCompartment}
                    >
                      <Plus size={17} />
                      Add compartment
                    </button>
                  </div>
                  <div className="cards">
                    {data.services.map((entry: Row) => (
                      <article className="card" key={entry.id}>
                        <TrainFront className="card-icon" />
                        <span className="eyebrow">TRAIN {entry.number}</span>
                        <h2>{entry.name}</h2>
                        <p>
                          {entry.origin} → {entry.destination}
                        </p>
                        <p className="muted">
                          {String(entry.service_date).slice(0, 10)}
                        </p>
                        <div className="card-footer">
                          <Badge value={entry.active ? "active" : "closed"} />
                          <button
                            className="text-button"
                            onClick={() =>
                              open(
                                "Edit service",
                                "/admin/service-edit",
                                [
                                  {
                                    name: "name",
                                    label: "Service name",
                                    value: entry.name,
                                  },
                                  {
                                    name: "number",
                                    label: "Train number",
                                    value: entry.number,
                                  },
                                  {
                                    name: "service_date",
                                    label: "Service date",
                                    type: "date",
                                    value: String(entry.service_date).slice(
                                      0,
                                      10,
                                    ),
                                  },
                                  {
                                    name: "origin",
                                    label: "Origin station",
                                    value: entry.origin,
                                  },
                                  {
                                    name: "destination",
                                    label: "Destination station",
                                    value: entry.destination,
                                  },
                                ],
                                (values) => ({ ...values, id: entry.id }),
                              )
                            }
                          >
                            Edit
                          </button>
                          <button
                            className="text-button"
                            disabled={busy}
                            onClick={() =>
                              void action("/admin/service-status", {
                                id: entry.id,
                                active: !entry.active,
                              })
                            }
                          >
                            {entry.active ? "Close service" : "Reopen"}
                          </button>
                        </div>
                      </article>
                    ))}
                  </div>
                  <Panel
                    title="Compartments"
                    description="Compartment codes for the selected service"
                  >
                    {data.compartments.length ? (
                      <div className="coach-grid">
                        {data.compartments.map((entry: Row) => (
                          <button
                            key={entry.id}
                            className="coach-tile"
                            aria-label={"Edit compartment " + entry.code}
                            onClick={() =>
                              open(
                                "Edit compartment",
                                "/admin/compartment-edit",
                                [
                                  {
                                    name: "code",
                                    label: "Compartment code",
                                    value: entry.code,
                                  },
                                ],
                                (values) => ({ ...values, id: entry.id }),
                              )
                            }
                          >
                            <TrainFront size={21} />
                            {entry.code}
                          </button>
                        ))}
                      </div>
                    ) : (
                      <Empty title="No compartments yet">
                        Add the compartments that your pantry serves.
                      </Empty>
                    )}
                  </Panel>
                </>
              )}
              {user.role === "admin" && view === "catalogue" && (
                <>
                  <div className="toolbar">
                    <button
                      disabled={!data.categories.length}
                      onClick={() => productForm()}
                    >
                      <Plus size={17} />
                      Add product
                    </button>
                    <button
                      className="secondary"
                      onClick={() =>
                        open("Create category", "/admin/categories", [
                          { name: "name", label: "Category name" },
                        ])
                      }
                    >
                      Add category
                    </button>
                    {!data.categories.length && (
                      <span className="muted">Start by adding a category.</span>
                    )}
                    {data.categories.map((entry: Row) => (
                      <button
                        key={entry.id}
                        className="text-button"
                        aria-label={"Edit category " + entry.name}
                        onClick={() =>
                          open(
                            "Edit category",
                            "/admin/category-edit",
                            [
                              {
                                name: "name",
                                label: "Category name",
                                value: entry.name,
                              },
                            ],
                            (values) => ({ ...values, id: entry.id }),
                          )
                        }
                      >
                        {entry.name} · Edit
                      </button>
                    ))}
                  </div>
                  <div className="cards">
                    {data.products.map((entry: Row) => (
                      <article className="card product" key={entry.id}>
                        {entry.image_url ? (
                          <img
                            src={entry.image_url}
                            alt={entry.name}
                            referrerPolicy="no-referrer"
                          />
                        ) : (
                          <div className="product-placeholder">
                            <Utensils size={38} />
                          </div>
                        )}
                        <span className="eyebrow">{entry.category}</span>
                        <h2>{entry.name}</h2>
                        <p className="muted">
                          {entry.description || "No description added."}
                        </p>
                        <strong>{money(entry.price)}</strong>
                        <div className="card-footer">
                          <button
                            className="text-button"
                            onClick={() => productForm(entry)}
                          >
                            Edit product
                          </button>
                          <button
                            className="text-button"
                            disabled={busy}
                            onClick={() =>
                              void action("/admin/products", {
                                ...entry,
                                active: !entry.active,
                              })
                            }
                          >
                            {entry.active ? "Deactivate" : "Activate"}
                          </button>
                        </div>
                        <Badge value={entry.active ? "active" : "inactive"} />
                      </article>
                    ))}
                  </div>
                  {!data.products.length && (
                    <Empty title="Your catalogue starts here">
                      Create a category, then add your first product and price.
                    </Empty>
                  )}
                </>
              )}
              {user.role === "admin" && view === "inventory" && (
                <>
                  <div className="toolbar">
                    <button
                      disabled={!selected || !data.products.length}
                      onClick={() => stockForm()}
                    >
                      <Plus size={17} />
                      Set opening stock
                    </button>
                    <p className="muted">
                      Available = opening + adjustments − reserved − sold.
                    </p>
                  </div>
                  <div className="cards">
                    {data.inventory.map((entry: Row) => (
                      <article className="card" key={entry.product_id}>
                        <Boxes className="card-icon" />
                        <h2>{entry.name}</h2>
                        <div className="stock-number">
                          {entry.available}
                          <small>available</small>
                        </div>
                        <div className="stock-grid">
                          <span>
                            Opening<strong>{entry.opening}</strong>
                          </span>
                          <span>
                            Reserved<strong>{entry.reserved}</strong>
                          </span>
                          <span>
                            Sold<strong>{entry.sold}</strong>
                          </span>
                        </div>
                        <div className="card-footer">
                          <Badge
                            value={
                              entry.available === 0
                                ? "out_of_stock"
                                : entry.available < 10
                                  ? "low_stock"
                                  : "in_stock"
                            }
                          />
                          <button
                            className="text-button"
                            onClick={() => stockForm(entry)}
                          >
                            Adjust stock
                          </button>
                        </div>
                      </article>
                    ))}
                  </div>
                  {!data.inventory.length && (
                    <Empty title="No inventory configured">
                      Create products, choose a service, and set the opening
                      quantities.
                    </Empty>
                  )}
                </>
              )}
              {user.role === "admin" && view === "staff" && (
                <>
                  <div className="toolbar">
                    <button onClick={staffForm}>
                      <Plus size={17} />
                      Add staff member
                    </button>
                  </div>
                  <div className="cards">
                    {data.staff.map((entry: Row) => {
                      const location = data.locations.find(
                        (location: Row) => location.user_id === entry.id,
                      );
                      const carried = data.carried.filter(
                        (item: Row) => item.user_id === entry.id,
                      );
                      return (
                        <article className="card" key={entry.id}>
                          <span className="avatar">
                            {entry.name.slice(0, 2).toUpperCase()}
                          </span>
                          <h2>{entry.name}</h2>
                          <p className="muted">{entry.email}</p>
                          <Badge value={entry.active ? "active" : "inactive"} />
                          <div className="staff-location">
                            <MapPin size={17} />
                            <span>
                              {location
                                ? `Last reported: ${location.code}`
                                : "No reported location"}
                              <small>
                                {location
                                  ? time(location.created_at)
                                  : "For the selected service"}
                              </small>
                            </span>
                          </div>
                          <p>
                            {carried.length
                              ? carried
                                  .map(
                                    (item: Row) =>
                                      `${item.quantity} × ${item.product_name}`,
                                  )
                                  .join(", ")
                              : "No carried items on this service."}
                          </p>
                          <div className="card-footer">
                            {entry.assigned ? (
                              <span className="muted">Assigned to service</span>
                            ) : (
                              <button
                                className="text-button"
                                disabled={!selected || busy || !entry.active}
                                onClick={() =>
                                  void action("/admin/staff-service", {
                                    staff_id: entry.id,
                                    service_id: selected,
                                  })
                                }
                              >
                                Assign to service
                              </button>
                            )}
                            <button
                              className="text-button"
                              onClick={() =>
                                open(
                                  "Edit staff account",
                                  "/admin/staff-edit",
                                  [
                                    {
                                      name: "name",
                                      label: "Display name",
                                      value: entry.name,
                                    },
                                    {
                                      name: "email",
                                      label: "Login email",
                                      type: "email",
                                      value: entry.email,
                                    },
                                    {
                                      name: "password",
                                      label:
                                        "Reset password (optional, at least 12 characters)",
                                      type: "password",
                                      required: false,
                                    },
                                  ],
                                  (values) => ({
                                    id: entry.id,
                                    name: values.name,
                                    email: values.email,
                                    ...(values.password
                                      ? { password: values.password }
                                      : {}),
                                  }),
                                )
                              }
                            >
                              Edit
                            </button>
                            <button
                              className="text-button"
                              disabled={busy}
                              onClick={() =>
                                void action("/admin/staff-status", {
                                  id: entry.id,
                                  active: !entry.active,
                                })
                              }
                            >
                              {entry.active ? "Deactivate" : "Activate"}
                            </button>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                  {!data.staff.length && (
                    <Empty title="Build your pantry team">
                      Create a staff account so team members can sign in and
                      receive assignments.
                    </Empty>
                  )}
                </>
              )}
              {user.role === "admin" && view === "requests" && (
                <>
                  <div className="toolbar">
                    <label className="search">
                      <Search size={18} />
                      <input
                        aria-label="Search requests"
                        placeholder="Reference, compartment, status…"
                        value={search}
                        onChange={(event) => setSearch(event.target.value)}
                      />
                    </label>
                    <span className="muted">
                      Latest {data.requests.length} requests · refreshes every
                      15 seconds
                    </span>
                  </div>
                  <div className="request-grid">
                    {data.requests
                      .filter((entry: Row) =>
                        `${entry.reference} ${entry.code} ${labels[entry.status]}`
                          .toLowerCase()
                          .includes(search.toLowerCase()),
                      )
                      .map((entry: Row) => (
                        <article className="card request" key={entry.id}>
                          <div className="request-head">
                            <span className="coach-icon">{entry.code}</span>
                            <div>
                              <h2>{entry.reference}</h2>
                              <small>
                                Seat {entry.seat} · {time(entry.created_at)}
                              </small>
                            </div>
                            <Badge value={entry.status} />
                          </div>
                          <div className="order-lines">
                            {entry.items.map((item: Row) => (
                              <div key={item.product_id}>
                                <span>
                                  {item.quantity} × {item.name}
                                  {entry.status === "delivered"
                                    ? ` (${item.delivered} delivered)`
                                    : ""}
                                </span>
                                <strong>
                                  {money(item.quantity * item.unit_price)}
                                </strong>
                              </div>
                            ))}
                          </div>
                          <p className="muted">
                            {entry.staff_name
                              ? `Assigned to ${entry.staff_name}`
                              : "Waiting for assignment"}
                          </p>
                          <div className="card-footer">
                            {["submitted", "assigned"].includes(
                              entry.status,
                            ) && (
                              <button
                                className="secondary"
                                onClick={() =>
                                  open(
                                    "Assign request",
                                    "/admin/assign",
                                    [
                                      {
                                        name: "staff_id",
                                        label: "Staff member",
                                        options: options(
                                          data.staff.filter(
                                            (staff: Row) =>
                                              staff.active && staff.assigned,
                                          ),
                                        ),
                                      },
                                    ],
                                    (values) => ({
                                      ...values,
                                      request_id: entry.id,
                                    }),
                                  )
                                }
                              >
                                Assign staff
                              </button>
                            )}
                            {["submitted", "assigned", "in_progress"].includes(
                              entry.status,
                            ) && (
                              <button
                                className="text-button danger"
                                onClick={() =>
                                  open(
                                    "Cancel request and release stock",
                                    "/admin/cancel",
                                    [
                                      {
                                        name: "reason",
                                        label: "Cancellation reason",
                                        type: "textarea",
                                      },
                                    ],
                                    (values) => ({
                                      ...values,
                                      request_id: entry.id,
                                    }),
                                  )
                                }
                              >
                                Cancel request
                              </button>
                            )}
                          </div>
                        </article>
                      ))}
                  </div>
                  {!data.requests.length && (
                    <Empty title="No passenger requests yet">
                      Generate a passenger QR for a compartment to start
                      accepting requests.
                    </Empty>
                  )}
                </>
              )}
              {user.role === "admin" && view === "qr" && (
                <>
                  <div className="toolbar">
                    <button disabled={!selected} onClick={() => qrForm()}>
                      <Plus size={17} />
                      Generate QR
                    </button>
                    <span className="muted">
                      Reopen saved codes anytime. Regeneration invalidates the
                      previous code.
                    </span>
                  </div>
                  <div className="cards qr-options">
                    {qrKinds.map(({ kind, name, description, Icon }) => (
                      <article className="card" key={kind}>
                        <Icon className="card-icon" />
                        <h2>{name}</h2>
                        <p>{description}</p>
                        <button
                          disabled={!selected}
                          onClick={() => qrForm(undefined, kind)}
                        >
                          Create {kind === "item" ? "food" : kind} QR
                        </button>
                      </article>
                    ))}
                  </div>
                  <p className="payment-note">
                    Passenger and location codes need a compartment. Food codes
                    need a catalogue product with opening stock. Localhost links
                    work only on this computer; phone scanning requires a
                    reachable, securely hosted address.
                  </p>
                  <div className="cards">
                    {data.qrs.map((entry: Row) => (
                      <article className="card" key={entry.id}>
                        <QrCode size={32} className="card-icon" />
                        <span className="eyebrow">
                          {entry.kind === "passenger"
                            ? "PASSENGER ORDERING"
                            : entry.kind === "item"
                              ? "STAFF COLLECTION"
                              : "STAFF LOCATION"}
                        </span>
                        <h2>{entry.code || entry.product_name}</h2>
                        <p className="muted">
                          Expires {time(entry.expires_at)}
                        </p>
                        <Badge
                          value={
                            entry.revoked_at
                              ? "revoked"
                              : new Date(entry.expires_at) < new Date()
                                ? "expired"
                                : "active"
                          }
                        />
                        <div className="card-footer">
                          <button
                            className="secondary"
                            disabled={
                              busy ||
                              !entry.can_preview ||
                              !!entry.revoked_at ||
                              new Date(entry.expires_at) < new Date()
                            }
                            onClick={() => void reopenQr(entry)}
                          >
                            View / download
                          </button>
                          <button
                            className="text-button"
                            onClick={() => qrForm(entry)}
                          >
                            Regenerate
                          </button>
                          {!entry.revoked_at && (
                            <button
                              className="text-button danger"
                              onClick={() =>
                                open(
                                  "Revoke QR code",
                                  "/admin/qr-revoke",
                                  [
                                    {
                                      name: "reason",
                                      label: "Reason",
                                      type: "textarea",
                                    },
                                  ],
                                  (values) => ({ ...values, id: entry.id }),
                                )
                              }
                            >
                              Revoke
                            </button>
                          )}
                        </div>
                        {!entry.can_preview && (
                          <small className="muted">
                            Older code: regenerate once to enable saved
                            previews.
                          </small>
                        )}
                      </article>
                    ))}
                  </div>
                  {!data.qrs.length && (
                    <Empty title="Connect every compartment">
                      Generate a real QR for passenger ordering, staff location
                      reports, or item collection.
                    </Empty>
                  )}
                </>
              )}
              {user.role === "admin" && view === "ledger" && (
                <>
                  <Panel
                    title="Inventory ledger"
                    description="Latest 200 movements on this service"
                  >
                    <div className="table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th>Time</th>
                            <th>Product</th>
                            <th>Movement</th>
                            <th>Quantity</th>
                            <th>Reason / actor</th>
                          </tr>
                        </thead>
                        <tbody>
                          {data.movements.map((entry: Row) => (
                            <tr key={entry.id}>
                              <td>{time(entry.created_at)}</td>
                              <td>{entry.product_name}</td>
                              <td>
                                <Badge value={entry.kind} />
                              </td>
                              <td>{entry.quantity}</td>
                              <td>
                                {entry.reason}
                                <small>{entry.actor_name || "Passenger"}</small>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {!data.movements.length && (
                      <Empty title="No stock movements">
                        Opening stock and every subsequent movement will be
                        recorded here.
                      </Empty>
                    )}
                  </Panel>
                  <Panel
                    title="Audit trail"
                    description="Latest 200 administrative and operational events"
                  >
                    <div className="list">
                      {data.audit.map((entry: Row) => (
                        <div className="list-row" key={entry.id}>
                          <ShieldCheck size={18} />
                          <div>
                            <strong>{entry.action.replaceAll("_", " ")}</strong>
                            <small>
                              {entry.actor_name || "Passenger"} ·{" "}
                              {time(entry.created_at)}
                            </small>
                          </div>
                          <code>{entry.entity_id.slice(0, 8)}</code>
                        </div>
                      ))}
                    </div>
                  </Panel>
                </>
              )}
              {user.role === "admin" && view === "views" && (
                <ReviewViews
                  data={data}
                  reopenQr={reopenQr}
                  navigate={setView}
                />
              )}
              {user.role === "staff" && (
                <Staff
                  navigate={setView}
                  data={data}
                  view={view}
                  reload={reload}
                  open={open}
                  busy={busy}
                  action={action}
                />
              )}
            </>
          )}
          <footer className="page-footer">
            <TrainFront size={15} /> Railway Pantry{" "}
            <span>
              Online service coordination · No online payment processing
            </span>
          </footer>
        </div>
      </main>
      {config && (
        <FormDialog
          config={config}
          close={() => setConfig(null)}
          onSaved={async () => {
            if (config.title !== "Change password") await reload();
            setNotice(
              config.title === "Confirm item collection"
                ? "Food collection recorded. Your carried quantities have been updated."
                : config.title === "Confirm current location"
                  ? "Compartment reported successfully. Your administrator can see your location."
                  : "Changes saved.",
            );
          }}
        />
      )}
      {qrDraft && data && (
        <QrComposer
          data={data}
          previous={qrDraft.previous}
          initialKind={qrDraft.kind}
          onClose={() => setQrDraft(null)}
          onCreated={(result) => {
            setQrDraft(null);
            setQrResult(result);
            void reload().catch((error) => setError(error.message));
          }}
          onSetup={(target) => {
            setQrDraft(null);
            if (target === "compartment") addCompartment();
            else if (target === "inventory") stockForm();
            else setView(target);
          }}
        />
      )}
      {qrResult && (
        <QrResult result={qrResult} close={() => setQrResult(null)} />
      )}
    </div>
  );
}
function ReviewViews({
  data,
  reopenQr,
  navigate,
}: {
  data: Row;
  reopenQr: (entry: Row) => Promise<void>;
  navigate: (view: string) => void;
}) {
  const [staffId, setStaffId] = useState(""),
    [preview, setPreview] = useState<Row | null>(null),
    [error, setError] = useState(""),
    [tab, setTab] = useState("tasks");
  useEffect(() => {
    let cancelled = false;
    setPreview(null);
    setError("");
    if (staffId)
      void api("/admin/staff-preview/" + staffId)
        .then((result) => {
          if (!cancelled) setPreview(result);
        })
        .catch((error) => {
          if (!cancelled) setError(error.message);
        });
    return () => {
      cancelled = true;
    };
  }, [staffId]);
  return (
    <>
      <Panel
        title="Review every experience"
        description="Real service data. Your administrator account keeps its own permissions."
      >
        <div className="cards">
          <article className="card">
            <ShoppingBag />
            <h2>Passenger experience</h2>
            <p>
              Open a passenger QR to see the welcome page and ordering journey.
              Submitting an order creates a real request.
            </p>
            {data.qrs
              .filter(
                (entry: Row) =>
                  entry.kind === "passenger" &&
                  entry.can_preview &&
                  !entry.revoked_at &&
                  new Date(entry.expires_at) > new Date(),
              )
              .map((entry: Row) => (
                <button
                  key={entry.id}
                  className="secondary"
                  onClick={() => void reopenQr(entry)}
                >
                  Open compartment {entry.code}
                </button>
              ))}
            <button className="text-button" onClick={() => navigate("qr")}>
              Manage passenger QR codes
            </button>
          </article>
          <article className="card">
            <ShieldCheck />
            <h2>Administrator experience</h2>
            <p>
              You are in the live administrator workspace. Manage services,
              stock, staff, requests and QR codes from the navigation.
            </p>
            <button onClick={() => navigate("overview")}>Open overview</button>
          </article>
        </div>
      </Panel>
      <Panel
        title="Staff view · read-only"
        description="Inspect staff assignments and carried food without impersonating them. Staff sign in independently at /staff, including in another tab of this browser."
      >
        <label>
          Staff member
          <select
            aria-label="Staff member"
            value={staffId}
            onChange={(event) => setStaffId(event.target.value)}
          >
            <option value="">Choose a staff member</option>
            {data.staff.map((entry: Row) => (
              <option key={entry.id} value={entry.id}>
                {entry.name}
              </option>
            ))}
          </select>
        </label>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        {staffId && !preview && !error && <Loading />}
        {preview && (
          <>
            <div className="toolbar">
              {["tasks", "scan", "carried"].map((value) => (
                <button
                  className="secondary"
                  key={value}
                  onClick={() => setTab(value)}
                >
                  {value === "tasks"
                    ? "Assignments"
                    : value === "scan"
                      ? "Scan & confirm"
                      : "Carried food"}
                </button>
              ))}
            </div>
            <p className="payment-note">
              Read-only preview: all operational controls are disabled.
            </p>
            <fieldset disabled className="staff-preview">
              <Staff
                data={preview}
                view={tab}
                navigate={setTab}
                reload={async () => {}}
                open={() => {}}
                busy={true}
                action={async () => {}}
              />
            </fieldset>
          </>
        )}
      </Panel>
    </>
  );
}
function QrResult({ result, close }: { result: Row; close: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  return (
    <dialog className="qr-result" ref={dialog} onCancel={close}>
      <div className="dialog-heading">
        <h2>Your QR is ready</h2>
        <button className="icon" aria-label="Close QR preview" onClick={close}>
          <X />
        </button>
      </div>
      <p>
        Reopen this code from the QR centre anytime. Keep staff codes within
        authorised work areas.
      </p>
      <img src={result.image} alt="Generated Railway Pantry QR code" />
      <h3>{result.label}</h3>
      <a className="qr-url" href={result.url} target="_blank" rel="noreferrer">
        Open QR workflow <ArrowRight size={15} />
      </a>
      <p className="muted">Expires {time(result.expires_at)}</p>
      <div className="dialog-actions">
        <a
          className="button secondary"
          download={`pantry-${result.id}.png`}
          href={result.image}
        >
          Download PNG
        </a>
        <button onClick={() => window.print()}>Print QR</button>
      </div>
    </dialog>
  );
}
function Staff({
  navigate,
  data,
  view,
  reload,
  open,
  busy,
  action,
}: {
  navigate: (view: string) => void;
  data: Row;
  view: string;
  reload: () => Promise<void>;
  open: (
    title: string,
    endpoint: string,
    fields: Field[],
    map?: (values: Row) => Row,
    after?: (result: any) => void,
  ) => void;
  busy: boolean;
  action: (endpoint: string, body: unknown) => Promise<void>;
}) {
  const initial = window.location.pathname.startsWith("/scan/")
    ? window.location.pathname.split("/")[2]
    : "";
  const [raw, setRaw] = useState(initial),
    [qr, setQr] = useState<Row | null>(null),
    [error, setError] = useState(""),
    [checking, setChecking] = useState(false);
  const revision = useRef(0);
  const [cameraRequested, setCameraRequested] = useState(false);
  const scan = useCallback((value: string) => {
    revision.current++;
    setRaw(value);
    setQr(null);
    setError("");
  }, []);
  useEffect(() => {
    if (view !== "scan") {
      setQr(null);
      setCameraRequested(false);
    }
  }, [view]);
  if (view === "scan")
    return (
      <Panel
        title="Scan, review, confirm"
        description="A scan never changes stock or location until you confirm."
      >
        <div className="scan-workflow">
          <div className="qr-missing">
            <h3>Two codes, two actions</h3>
            <p>
              <strong>Food item QR:</strong> scan, select Validate code, check
              the food name, then Confirm collection and enter the quantity you
              are taking to sell.
            </p>
            <p>
              <strong>Staff compartment QR:</strong> scan, select Validate code,
              check the coach, then Report this location. Use this when you
              arrive at each compartment.
            </p>
            <p>
              Use Scan with camera, or paste the QR link below. A phone camera
              needs a reachable HTTPS website; localhost links only work on this
              computer.
            </p>
          </div>
          <Scanner onRead={scan} autoStart={cameraRequested} />
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              setChecking(true);
              setError("");
              setQr(null);
              const version = ++revision.current;
              try {
                const token = extractToken(raw);
                const result = await api("/staff/qr-validate", { token });
                if (version === revision.current)
                  setQr({ ...result, validatedToken: token });
              } catch (error) {
                setError((error as Error).message);
              } finally {
                setChecking(false);
              }
            }}
          >
            <label>
              QR link or code
              <input
                value={raw}
                onChange={(event) => {
                  revision.current++;
                  setRaw(event.target.value);
                  setQr(null);
                }}
                required
                placeholder="Paste the QR link or code"
              />
            </label>
            <button disabled={checking}>
              {checking ? "Validating…" : "Validate code"}
            </button>
          </form>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          {qr && (
            <div className="scan-confirm">
              <Badge value="validated" />
              <h2>
                {qr.kind === "item"
                  ? qr.product_name
                  : `Compartment ${qr.code}`}
              </h2>
              <p>
                {qr.service_name} · {qr.number}
              </p>
              <button
                onClick={() =>
                  open(
                    qr.kind === "item"
                      ? "Confirm item collection"
                      : "Confirm current location",
                    qr.kind === "item" ? "/staff/carry" : "/staff/location",
                    qr.kind === "item"
                      ? [
                          {
                            name: "quantity",
                            label: "Quantity you are taking",
                            type: "number",
                            min: 1,
                            max: 10000,
                          },
                        ]
                      : [],
                    (values) => ({
                      token: qr.validatedToken,
                      ...(qr.kind === "item"
                        ? { quantity: Number(values.quantity) }
                        : {}),
                    }),
                    () => {
                      setQr(null);
                      setRaw("");
                      void reload();
                    },
                  )
                }
              >
                {qr.kind === "item"
                  ? "Confirm collection"
                  : "Report this location"}
              </button>
            </div>
          )}
        </div>
      </Panel>
    );
  if (view === "carried")
    return (
      <>
        <div className="cards">
          {data.carried.map((entry: Row) => (
            <article key={entry.service_id + entry.product_id} className="card">
              <Boxes className="card-icon" />
              <h2>{entry.name}</h2>
              <p className="muted">
                {
                  data.services.find(
                    (service: Row) => service.id === entry.service_id,
                  )?.name
                }
              </p>
              <div className="stock-number">
                {entry.quantity}
                <small>units with you</small>
              </div>
              <button
                className="secondary"
                onClick={() =>
                  open(
                    "Return items to pantry",
                    "/staff/return",
                    [
                      {
                        name: "quantity",
                        label: "Quantity to return",
                        type: "number",
                        min: 1,
                        max: entry.quantity,
                      },
                    ],
                    (values) => ({
                      service_id: entry.service_id,
                      product_id: entry.product_id,
                      quantity: Number(values.quantity),
                    }),
                  )
                }
              >
                Return items
              </button>
            </article>
          ))}
        </div>
        {!data.carried.length && (
          <Empty title="No items carried">
            Use the Scan & confirm tab to scan an item collection QR.
          </Empty>
        )}
      </>
    );
  return (
    <>
      <div className="cards staff-steps">
        <article className="card">
          <Boxes className="card-icon" />
          <span className="eyebrow">01 · FOOD WITH YOU</span>
          <h2>Collect food to sell</h2>
          <p>
            Scan a food QR, check the item and confirm the quantity you take
            from the pantry.
          </p>
          <strong>
            {data.carried.reduce(
              (total: number, entry: Row) => total + Number(entry.quantity),
              0,
            )}{" "}
            units currently carried
          </strong>
          <button
            onClick={() => {
              setCameraRequested(true);
              navigate("scan");
            }}
          >
            <Camera size={18} /> Scan food QR
          </button>
          <button className="text-button" onClick={() => navigate("carried")}>
            View / return carried food
          </button>
        </article>
        <article className="card">
          <MapPin className="card-icon" />
          <span className="eyebrow">02 · YOUR COMPARTMENT</span>
          <h2>Report where you are</h2>
          <p>
            Scan the staff location QR when you reach a compartment. Review the
            coach and confirm your location.
          </p>
          <button
            onClick={() => {
              setCameraRequested(true);
              navigate("scan");
            }}
          >
            <Camera size={18} /> Scan compartment QR
          </button>
        </article>
      </div>
      <div className="request-grid">
        {data.requests.map((entry: Row) => (
          <article className="card request" key={entry.id}>
            <div className="request-head">
              <span className="coach-icon">{entry.code}</span>
              <div>
                <h2>{entry.reference}</h2>
                <small>Seat {entry.seat}</small>
              </div>
              <Badge value={entry.status} />
            </div>
            <div className="order-lines">
              {entry.items.map((item: Row) => (
                <div key={item.product_id}>
                  <span>
                    {item.quantity} × {item.name}
                  </span>
                  <strong>{money(item.quantity * item.unit_price)}</strong>
                </div>
              ))}
            </div>
            <div className="card-footer">
              {entry.status === "assigned" ? (
                <button
                  disabled={busy}
                  onClick={() =>
                    void action("/staff/request-action", {
                      request_id: entry.id,
                      action: "start",
                    })
                  }
                >
                  Start service
                </button>
              ) : (
                <button
                  onClick={() =>
                    open(
                      "Confirm actual delivery",
                      "/staff/request-action",
                      entry.items.map((item: Row) => ({
                        name: item.product_id,
                        label: `${item.name} (requested ${item.quantity})`,
                        type: "number",
                        value: item.quantity,
                        min: 0,
                        max: item.quantity,
                      })),
                      (values) => ({
                        request_id: entry.id,
                        action: "deliver",
                        items: entry.items.map((item: Row) => ({
                          product_id: item.product_id,
                          quantity: Number(values[item.product_id]),
                        })),
                      }),
                    )
                  }
                >
                  Record delivery
                </button>
              )}
              <button
                className="text-button danger"
                onClick={() =>
                  open(
                    "Unable to fulfil",
                    "/staff/request-action",
                    [{ name: "reason", label: "Reason", type: "textarea" }],
                    (values) => ({
                      ...values,
                      request_id: entry.id,
                      action: "unable",
                    }),
                  )
                }
              >
                Unable to fulfil
              </button>
            </div>
          </article>
        ))}
      </div>
      {!data.requests.length && (
        <Empty title="You’re all caught up">
          Your administrator’s assignments will appear here.
        </Empty>
      )}
      <Panel
        title="Your service locations"
        description="Your latest reported compartment for each service"
      >
        <div className="list">
          {data.services.map((entry: Row) => {
            const location = data.locations.find(
              (location: Row) => location.service_id === entry.id,
            );
            return (
              <div key={entry.id} className="list-row">
                <MapPin />
                <div>
                  <strong>
                    {entry.name} · {entry.number}
                  </strong>
                  <small>
                    {location
                      ? `Last reported ${location.code} · ${time(location.created_at)}`
                      : "No location reported"}
                  </small>
                </div>
              </div>
            );
          })}
        </div>
      </Panel>
    </>
  );
}
function Passenger({ token }: { token: string }) {
  const [submitted, setSubmitted] = useState("");
  const [ordering, setOrdering] = useState(false);
  const [data, setData] = useState<Row | null>(null),
    [error, setError] = useState(""),
    [cart, setCart] = useState<Record<string, number>>({}),
    [category, setCategory] = useState("All"),
    [busy, setBusy] = useState(false);
  const key = useRef(crypto.randomUUID());
  const load = useCallback(async () => {
    try {
      const result = await api("/public/qr/" + encodeURIComponent(token));
      setPassengerCsrf(result.passenger?.csrf || null);
      setData(result);
      setError("");
    } catch (error) {
      setError((error as Error).message);
    }
  }, [token]);
  useEffect(() => {
    void load();
  }, [load]);
  const total =
    data?.products.reduce(
      (amount: number, item: Row) => amount + (cart[item.id] || 0) * item.price,
      0,
    ) || 0;
  if (submitted)
    return (
      <>
        <div role="status" className="notice">
          Request sent successfully. Follow its current status below.
        </div>
        <Tracking access={submitted} />
      </>
    );
  return (
    <div className="passenger">
      <header>
        <Brand />
        {data?.passenger ? (
          <div className="passenger-account">
            <span>
              <ShieldCheck size={15} /> {data.passenger.mobile}
            </span>
            <button
              className="text-button"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await api("/public/auth/logout", {});
                  setPassengerCsrf(null);
                  setCart({});
                  setOrdering(false);
                  await load();
                } catch (error) {
                  setError((error as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Change mobile
            </button>
          </div>
        ) : (
          <span className="passenger-label">ONBOARD SERVICE</span>
        )}
      </header>
      <main>
        {error && (
          <div role="alert" className="error">
            {error}
            <button className="text-button" onClick={() => void load()}>
              Refresh
            </button>
          </div>
        )}
        {!data ? (
          error ? (
            <Empty title="We couldn’t open this compartment">
              Ask pantry staff for a valid passenger QR.
            </Empty>
          ) : (
            <Loading />
          )
        ) : !data.passenger ? (
          <PassengerLogin
            qr={token}
            context={data.context}
            delivery={data.otpDelivery}
            onVerified={load}
          />
        ) : (
          <>
            <div className="passenger-hero">
              <div>
                <span className="eyebrow">A LITTLE COMFORT, ON BOARD</span>
                <h1>
                  Good food.
                  <br />
                  <em>A better journey.</em>
                </h1>
                <p>
                  {data.context.service_name} · {data.context.number}
                  <br />
                  {data.context.origin} → {data.context.destination}
                </p>
                <p className="welcome-copy">
                  Settle in. Explore your onboard pantry, choose your favourites
                  and request delivery to your seat.
                </p>
                <button
                  className="welcome-cta"
                  onClick={() => {
                    setOrdering(true);
                    requestAnimationFrame(() =>
                      document
                        .getElementById("passenger-menu")
                        ?.scrollIntoView({
                          behavior: window.matchMedia(
                            "(prefers-reduced-motion: reduce)",
                          ).matches
                            ? "auto"
                            : "smooth",
                        }),
                    );
                  }}
                >
                  Order food <ArrowRight size={19} />
                </button>
              </div>
              <RailwayScene compartment={data.context.compartment} />
            </div>
            {!ordering && (
              <section
                className="welcome-steps"
                aria-label="How ordering works"
              >
                <article>
                  <span>01</span>
                  <ShoppingBag />
                  <h2>Pick your favourites</h2>
                  <p>
                    Browse the real menu and current availability for your
                    journey.
                  </p>
                </article>
                <article>
                  <span>02</span>
                  <TrainFront />
                  <h2>Stay in your seat</h2>
                  <p>
                    Your compartment is already selected. Just enter your seat
                    or berth.
                  </p>
                </article>
                <article>
                  <span>03</span>
                  <ShieldCheck />
                  <h2>Follow your request</h2>
                  <p>
                    Keep your private tracking link. No online payment is
                    collected here.
                  </p>
                </article>
              </section>
            )}
            <div
              id="passenger-menu"
              className="passenger-columns"
              hidden={!ordering}
            >
              <section>
                <div className="section-heading">
                  <h2>From your pantry</h2>
                  <button className="text-button" onClick={() => void load()}>
                    <RefreshCw size={14} />
                    Refresh availability
                  </button>
                </div>
                <div className="categories">
                  {[
                    "All",
                    ...new Set<string>(
                      data.products.map((item: Row) => item.category),
                    ),
                  ].map((value) => (
                    <button
                      key={value}
                      className={category === value ? "selected" : ""}
                      onClick={() => setCategory(value)}
                    >
                      {value}
                    </button>
                  ))}
                </div>
                <div className="menu-grid">
                  {data.products
                    .filter(
                      (item: Row) =>
                        category === "All" || item.category === category,
                    )
                    .map((item: Row) => (
                      <article className="card product" key={item.id}>
                        {item.image_url ? (
                          <img
                            src={item.image_url}
                            alt={item.name}
                            referrerPolicy="no-referrer"
                          />
                        ) : (
                          <div className="product-placeholder">
                            <Utensils size={38} />
                          </div>
                        )}
                        <span className="eyebrow">{item.category}</span>
                        <h3>{item.name}</h3>
                        <p className="muted">{item.description}</p>
                        <div className="card-footer">
                          <strong>{money(item.price)}</strong>
                          <div className="quantity">
                            <button
                              aria-label={"Remove " + item.name}
                              disabled={busy || !cart[item.id]}
                              onClick={() => {
                                setCart({
                                  ...cart,
                                  [item.id]: Math.max(
                                    0,
                                    (cart[item.id] || 0) - 1,
                                  ),
                                });
                                key.current = crypto.randomUUID();
                              }}
                            >
                              −
                            </button>
                            <span aria-live="polite">{cart[item.id] || 0}</span>
                            <button
                              aria-label={"Add " + item.name}
                              disabled={
                                busy ||
                                (cart[item.id] || 0) >=
                                  Math.min(20, item.available)
                              }
                              onClick={() => {
                                setCart({
                                  ...cart,
                                  [item.id]: (cart[item.id] || 0) + 1,
                                });
                                key.current = crypto.randomUUID();
                              }}
                            >
                              +
                            </button>
                          </div>
                        </div>
                        <small className={item.available ? "muted" : "danger"}>
                          {item.available
                            ? `${item.available} available`
                            : "Currently unavailable"}
                        </small>
                      </article>
                    ))}
                </div>
                {!data.products.length && (
                  <Empty title="The pantry is getting ready">
                    Please check back or contact pantry staff.
                  </Empty>
                )}
              </section>
              <aside className="cart panel">
                <header>
                  <h2>Your request</h2>
                  <ShoppingBag size={20} />
                </header>
                <form
                  onSubmit={async (event) => {
                    event.preventDefault();
                    if (!Object.values(cart).some(Boolean)) return;
                    const form = new FormData(event.currentTarget);
                    setBusy(true);
                    setError("");
                    try {
                      const result = await api(
                        "/public/requests",
                        {
                          qr: token,
                          seat: form.get("seat"),
                          items: Object.entries(cart)
                            .filter(([, quantity]) => quantity > 0)
                            .map(([product_id, quantity]) => ({
                              product_id,
                              quantity,
                            })),
                        },
                        key.current,
                      );
                      window.history.replaceState(
                        null,
                        "",
                        "/r/" + result.access,
                      );
                      setSubmitted(result.access);
                      window.scrollTo(0, 0);
                    } catch (error) {
                      setError((error as Error).message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  <div className="order-lines">
                    {data.products
                      .filter((item: Row) => cart[item.id] > 0)
                      .map((item: Row) => (
                        <div key={item.id}>
                          <span>
                            {cart[item.id]} × {item.name}
                          </span>
                          <strong>{money(cart[item.id] * item.price)}</strong>
                        </div>
                      ))}
                    {!Object.values(cart).some(Boolean) && (
                      <p className="muted">
                        Choose something from the catalogue to get started.
                      </p>
                    )}
                  </div>
                  <label>
                    Your seat / berth
                    <input
                      name="seat"
                      required
                      pattern="[A-Za-z0-9-]+"
                      maxLength={8}
                      placeholder="For example, 24"
                      onChange={() => {
                        key.current = crypto.randomUUID();
                      }}
                    />
                  </label>
                  <div className="total">
                    <span>Request total</span>
                    <strong>{money(total)}</strong>
                  </div>
                  <p className="payment-note">
                    This is a food request. No online payment is collected.
                    Confirm payment arrangements with pantry staff.
                  </p>
                  {error && (
                    <p role="alert" className="error">
                      {error}
                    </p>
                  )}
                  <button disabled={busy || !Object.values(cart).some(Boolean)}>
                    {busy ? "Submitting…" : "Send request"}
                    <ArrowRight size={17} />
                  </button>
                </form>
              </aside>
            </div>
          </>
        )}
      </main>
      <footer>Railway Pantry · Service to your seat</footer>
    </div>
  );
}
function Tracking({ access }: { access: string }) {
  const [request, setRequest] = useState<Row | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try {
      setRequest(await api("/public/request/" + encodeURIComponent(access)));
      setError("");
    } catch (error) {
      setError((error as Error).message);
    }
  }, [access]);
  useEffect(() => {
    void load();
    const timer = setInterval(load, 15000);
    return () => clearInterval(timer);
  }, [load]);
  return (
    <div className="tracking">
      <Brand />
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {!request ? (
        !error && <Loading />
      ) : (
        <section className="panel tracking-card">
          <div className="success-icon">
            <Check size={32} />
          </div>
          <span className="eyebrow">YOUR REQUEST</span>
          {request.status === "submitted" && (
            <div role="status">
              <h2>Request received successfully</h2>
              <p>
                Your food request is saved and waiting for the administrator to
                assign service staff. Keep this page to follow its progress.
              </p>
            </div>
          )}
          <h1>{request.reference}</h1>
          <p>
            Compartment {request.code} · Seat {request.seat}
          </p>
          <Badge value={request.status} />
          <p className="muted">
            Save this private link to track your request. Updates every 15
            seconds.
          </p>
          <div className="order-lines">
            {request.items.map((item: Row) => (
              <div key={item.product_id}>
                <span>
                  {item.name} ×{" "}
                  {request.status === "delivered"
                    ? item.delivered
                    : item.quantity}
                  {request.status === "delivered"
                    ? ` (requested ${item.quantity})`
                    : ""}
                </span>
                <strong>
                  {money(
                    (request.status === "delivered"
                      ? item.delivered
                      : item.quantity) * item.unit_price,
                  )}
                </strong>
              </div>
            ))}
          </div>
          <p className="payment-note">No online payment has been collected.</p>
          {request.status === "submitted" && (
            <button
              className="secondary"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await api("/public/cancel", { access });
                  await load();
                } catch (error) {
                  setError((error as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Cancel request
            </button>
          )}
          <small className="muted">
            Last change: {time(request.updated_at)}
          </small>
        </section>
      )}
    </div>
  );
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
