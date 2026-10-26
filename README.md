# Railway Pantry

A working, database-backed pantry coordination application. A fresh installation has **no sample users, trains, products, orders, or stock**. Create your own administrator and configure your service.

## Start locally

Requires Node.js 22.12 or later (verified here with Node.js 24).

```powershell
npm ci
npm run dev
```

Open the **private first-run setup link printed in the terminal**. It lets you choose your own name, email and password. The setup token is random, local-only, and becomes unusable after the first administrator is created. After setup, sign in at http://localhost:5173.

The API runs on port 3001 and the web app on port 5173. Keep both running. No separate database installation is required: local data is persisted in `.data/postgres` using PGlite (embedded PostgreSQL). The replay encryption key is stored in `.data/replay-key`; keep that file with local backups. Do not run multiple processes against the same embedded database directory.

For the command-line administrator setup, stop the development server first and run `npm run setup`. This also works against a configured PostgreSQL database. There are no default credentials.

## Configure a real service

1. **Services & coaches:** create the train service and date, then its compartment codes.
2. **Catalogue:** create categories, products, rupee prices and optional HTTPS image URLs.
3. **Inventory:** select the service and set opening stock once per product. Subsequent changes require a reason.
4. **Staff & locations:** create staff accounts and assign them to the service. Staff should change their initial password using their profile.
5. **QR centre:** choose passenger ordering, staff compartment location or staff food collection. Missing compartments or stock are explained with setup links. Use **View / download** to reopen, download or print a saved code. Older codes without saved previews must be regenerated once.
6. Open a passenger QR link and verify an Indian mobile number with the six-digit OTP. Locally, the code is printed in the backend terminal. Then select **Order food** on the welcome page, choose items, enter a seat, and submit the request. Save the private tracking link.
7. In **Requests**, assign the request to an active staff member.
8. Staff signs in, uses **Scan & confirm** to collect items and report a compartment, then starts the assigned request and records actual delivered quantities.
9. Review inventory, compartment demand, staff custody and the audit trail.

A passenger can cancel an unassigned request. Administrators can cancel outstanding requests with a reason. Staff can record an inability to fulfil with a reason. All these release reserved stock. Partial delivery releases the undelivered portion and records actual sales.

Use **Review all views** in the administrator navigation to open a real passenger QR and inspect a read-only staff workspace. Preview controls cannot collect food, change location or deliver requests. Staff sign in independently at `/staff`; `/scan/...` links use the staff session. Administrator and staff sessions use separate HTTP-only cookies, so both work in the same browser without private windows or signing out of admin. Each login page rejects accounts for the other role. Passenger requests submitted while reviewing are real orders, not simulations.

QR validity counts from the later of creation time or the service date at midnight in India. Changing a service date later does not extend existing codes; regenerate them if necessary. A QR containing `localhost` cannot open this app on a phone. Keep local testing on this computer until a reachable HTTPS deployment is configured; no public network exposure is enabled automatically.

## What works

Passengers see an explicit saved-request confirmation and a private tracking page after submitting. Administrators see an incoming-request banner across all services, refreshed every five seconds while the workspace is open; select a service in the banner to assign its requests. This is an in-app alert, not SMS, email or background push delivery. Network failures display a refresh warning.

The staff entry point is `/staff`. Administrators create and assign staff accounts in **Staff & locations**, then share credentials privately. Staff scan a food QR, validate it and confirm collection quantities; they scan a staff compartment QR, validate it and confirm their location. Opening a staff QR uses only the independent staff session, never the administrator dashboard or credentials.

- Server-side admin/staff permissions, password hashing, HTTP-only sessions, CSRF checks, session expiry, logout and password changes.
- Passenger mobile verification with single-use OTPs, five-minute expiry, five attempts per code, a 60-second resend delay and persistent phone/network send limits. The menu and order API require a verified passenger session. Passenger sessions last eight hours; mobile numbers are encrypted at rest and only their last four digits are shown in the browser. Passenger, admin and staff sessions are independent.
- Persistent service, compartment, category, product, staff, inventory, request, QR, location, custody and audit records.
- Atomic stock reservations, explicit status transitions, actual delivery recording, stock returns and reasoned adjustments.
- Request idempotency, collection idempotency and delivery idempotency. Replay receipts containing bearer tokens are encrypted at rest.
- Real PNG QR generation, download/print, expiry, revocation and replacement.
- In-app QR camera reader with manual-entry fallback and explicit confirmation before stock/location changes.
- Mobile passenger catalogue, quantities, seat entry and private order tracking.
- Operational dashboards based on database records, refreshing every 15 seconds.
- Empty, loading, success and error states. No fake action buttons or seeded production data.

## Verification

The multi-colour visual theme lives in `client/premium.css`. The passenger sign-in and welcome pages play a locally stored MP4 converted from the supplied Gemini frames, with interpolated motion, a soft loop, a pause control and automatic reduced-motion support. Hover effects are limited to fine pointers; touch users do not need to hover to access any action. Design inspiration, asset provenance and video regeneration instructions are recorded in `public/images/ASSET-NOTES.md`. For setup on another laptop, follow `setup.md`.

```powershell
npm run check
npm run lint
npm test
npm run build
npx playwright install chromium
npm run test:browser
```

The integration suite uses isolated databases. Browser testing uses an isolated in-memory database and a temporary server on port 4175. Its test accounts and operational fixtures never populate your local database. Browser screenshots are written under `.data/browser-check`.

The browser test exercises first-run setup, login, service/catalogue/stock/staff creation, QR generation, a mobile passenger request, assignment, staff collection, compartment reporting, delivery and camera-denial fallback. Real phone camera testing over HTTPS is still required before release.

## Architecture

- React + TypeScript + Vite frontend in `client/`.
- Express + TypeScript API in `server/app.ts`.
- Parameterised SQL and PostgreSQL constraints in `server/schema.sql`.
- `server/db.ts` selects a PostgreSQL pool when `DATABASE_URL` is set, or local PGlite otherwise.
- All business mutations execute inside a transaction. PostgreSQL serialises business writes through a row lock; PGlite serialises transactions. This intentionally favours correctness for the initial operational deployment.
- Money is stored in integer paise. Prices are snapshotted when a passenger submits a request.
- Availability = opening + adjustments − reserved − sold. Carried items are custody transfers, not additional deductions from service stock.
- Session and tracking bearer tokens are stored as hashes. QR verification uses a hash; saved previews additionally store an encrypted copy available only through the administrator endpoint. Idempotency receipts and saved QR copies use the stable replay key. Back up that key securely with the database; losing it prevents reopening saved codes.

## Configuration and later deployment

See `.env.example`. Do not commit a real `.env` or credentials. Local passenger verification defaults to `OTP_PROVIDER=console`: a real random code is printed in the backend terminal, never returned by the API, and no SMS is sent. For phone delivery, set `OTP_PROVIDER=twilio`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` and `TWILIO_VERIFY_SERVICE_SID` for a Twilio Verify service configured for six-digit SMS codes. Production requires SMS mode and refuses console OTPs. SMS delivery still needs testing with the operator's configured account.

For a deployment, use PostgreSQL, a stable random `REPLAY_SECRET`, an HTTPS `APP_ORIGIN`, and `NODE_ENV=production`. Build with `npm run build`, then run `npm start`. Set `HOST=0.0.0.0` when running in a container; otherwise the server binds to loopback. Serve frontend and API under the same origin. Browser bootstrap is disabled in production; use `npm run setup` on the server.

Cloudflare deployment is prepared in `wrangler.json`, `cloudflare/worker.ts` and `Dockerfile`. Follow `DEPLOY_CLOUDFLARE.md` for the paid Containers setup, hosted PostgreSQL, private secrets, cloud administrator setup and deploy commands. `npm run cloudflare:check` builds and validates without publishing. No domain, live deployment, Google indexing, Android package or Play Store submission has been created. A Play Store release will need a mobile packaging decision, device tests, signing and your developer account.

## Current limits to account for before release

- Online operation only; no offline order submission or stock synchronisation.
- No payment gateway: the app records requests and delivered value, not successful payments.
- Operational requests show the most recent 500 records per service; the dashboard totals cover the whole service. Ledger/audit views show the most recent 200 events.
- Product images use supplied HTTPS URLs; image uploads and storage are not implemented.
- Rate limits are process-local. Horizontal scaling needs a shared limiter and reviewed database write-lock strategy.
- Automated checks cover local embedded PostgreSQL and Chromium. A deployed PostgreSQL instance, HTTPS proxy/cookies, real Android/iOS cameras, accessibility assistive technology and backups/restores still need environment-specific verification.
- This project does not assert government affiliation or approval. Confirm the operator identity, privacy/retention policy and approved service rules before public release.

The original product blueprint remains in `PROJECT_SPEC.md`.
