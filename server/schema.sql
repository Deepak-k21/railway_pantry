CREATE TABLE IF NOT EXISTS operation_lock(id integer PRIMARY KEY);
INSERT INTO operation_lock VALUES(1) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS users (
 id uuid PRIMARY KEY, name text NOT NULL, email text UNIQUE NOT NULL, password text NOT NULL,
 role text NOT NULL CHECK(role IN ('admin','staff')), active boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sessions (
 token_hash text PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id), csrf text NOT NULL,
 expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS services (
 id uuid PRIMARY KEY, name text NOT NULL, number text NOT NULL, service_date date NOT NULL,
 origin text NOT NULL, destination text NOT NULL, active boolean NOT NULL DEFAULT true
);
CREATE TABLE IF NOT EXISTS compartments (
 id uuid PRIMARY KEY, service_id uuid NOT NULL REFERENCES services(id), code text NOT NULL,
 UNIQUE(service_id,code)
);
CREATE TABLE IF NOT EXISTS staff_services (
 user_id uuid NOT NULL REFERENCES users(id),service_id uuid NOT NULL REFERENCES services(id),
 PRIMARY KEY(user_id,service_id)
);
CREATE TABLE IF NOT EXISTS categories(id uuid PRIMARY KEY,name text NOT NULL UNIQUE);
CREATE TABLE IF NOT EXISTS products (
 id uuid PRIMARY KEY, name text NOT NULL, category_id uuid NOT NULL REFERENCES categories(id),
 description text NOT NULL DEFAULT '', image_url text NOT NULL DEFAULT '', price integer NOT NULL CHECK(price>=0),
 active boolean NOT NULL DEFAULT true
);
CREATE TABLE IF NOT EXISTS inventory (
 service_id uuid NOT NULL REFERENCES services(id), product_id uuid NOT NULL REFERENCES products(id),
 opening integer NOT NULL CHECK(opening>=0), adjustments integer NOT NULL DEFAULT 0,
 reserved integer NOT NULL DEFAULT 0 CHECK(reserved>=0), sold integer NOT NULL DEFAULT 0 CHECK(sold>=0),
 CHECK(opening+adjustments-reserved-sold>=0), PRIMARY KEY(service_id,product_id)
);
CREATE TABLE IF NOT EXISTS qr_codes (
 id uuid PRIMARY KEY, token_hash text UNIQUE NOT NULL, kind text NOT NULL CHECK(kind IN ('passenger','location','item')),
 service_id uuid NOT NULL REFERENCES services(id), compartment_id uuid REFERENCES compartments(id),
 product_id uuid REFERENCES products(id), created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL,
 revoked_at timestamptz, reason text, CHECK((kind='item' AND product_id IS NOT NULL AND compartment_id IS NULL) OR (kind IN ('passenger','location') AND compartment_id IS NOT NULL AND product_id IS NULL))
);
CREATE TABLE IF NOT EXISTS requests (
 id uuid PRIMARY KEY, reference text UNIQUE NOT NULL, access_hash text UNIQUE NOT NULL,
 service_id uuid NOT NULL REFERENCES services(id), compartment_id uuid NOT NULL REFERENCES compartments(id),
 seat text NOT NULL, status text NOT NULL DEFAULT 'submitted' CHECK(status IN ('submitted','assigned','in_progress','delivered','cancelled','unable_to_fulfil')),
 staff_id uuid REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS request_items (
 request_id uuid NOT NULL REFERENCES requests(id), product_id uuid NOT NULL REFERENCES products(id),
 quantity integer NOT NULL CHECK(quantity>0), delivered integer NOT NULL DEFAULT 0 CHECK(delivered>=0 AND delivered<=quantity),
 unit_price integer NOT NULL CHECK(unit_price>=0), PRIMARY KEY(request_id,product_id)
);
CREATE TABLE IF NOT EXISTS carried (
 user_id uuid NOT NULL REFERENCES users(id), service_id uuid NOT NULL REFERENCES services(id), product_id uuid NOT NULL REFERENCES products(id),
 quantity integer NOT NULL CHECK(quantity>=0), PRIMARY KEY(user_id,service_id,product_id)
);
CREATE TABLE IF NOT EXISTS locations (
 id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES users(id), service_id uuid NOT NULL REFERENCES services(id),
 compartment_id uuid NOT NULL REFERENCES compartments(id),created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS movements (
 id uuid PRIMARY KEY,service_id uuid NOT NULL REFERENCES services(id),product_id uuid NOT NULL REFERENCES products(id),
 kind text NOT NULL,quantity integer NOT NULL, actor uuid REFERENCES users(id),request_id uuid REFERENCES requests(id),
 reason text NOT NULL,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS audit (
 id uuid PRIMARY KEY, actor uuid REFERENCES users(id), action text NOT NULL, entity_id text NOT NULL,
 detail jsonb NOT NULL DEFAULT '{}',created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS idempotency (
 scope text NOT NULL, key text NOT NULL, fingerprint text NOT NULL, response jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(scope,key)
);
CREATE INDEX IF NOT EXISTS requests_service_status ON requests(service_id,status);
CREATE INDEX IF NOT EXISTS requests_staff ON requests(staff_id);
CREATE INDEX IF NOT EXISTS locations_recent ON locations(user_id,created_at DESC);
CREATE INDEX IF NOT EXISTS movements_service ON movements(service_id,created_at DESC);
CREATE INDEX IF NOT EXISTS audit_recent ON audit(created_at DESC);
ALTER TABLE qr_codes ADD COLUMN IF NOT EXISTS encrypted_token jsonb;
CREATE TABLE IF NOT EXISTS passengers (
 id uuid PRIMARY KEY, phone_hash text UNIQUE NOT NULL, phone_cipher jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS passenger_sessions (
 token_hash text PRIMARY KEY, passenger_id uuid NOT NULL REFERENCES passengers(id),
 csrf text NOT NULL, expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS passenger_otp_challenges (
 id uuid PRIMARY KEY, qr_id uuid NOT NULL REFERENCES qr_codes(id), phone_hash text NOT NULL,
 phone_cipher jsonb NOT NULL, browser_hash text NOT NULL, ip_hash text NOT NULL,
 code_hash text, provider_id text, delivery text NOT NULL CHECK(delivery IN ('console','sms')),
 status text NOT NULL CHECK(status IN ('pending','sent','checking','consumed','failed')),
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 5),
 created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS passenger_otp_phone ON passenger_otp_challenges(phone_hash,created_at DESC);
CREATE INDEX IF NOT EXISTS passenger_otp_ip ON passenger_otp_challenges(ip_hash,created_at DESC);
ALTER TABLE requests ADD COLUMN IF NOT EXISTS passenger_id uuid REFERENCES passengers(id);
