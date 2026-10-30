# Deploy Railway Pantry to Cloudflare

The full React website and Express API run together in a Cloudflare Container behind a Worker. Orders, logins, stock and OTP records live in your hosted PostgreSQL database. The public website uses one HTTPS origin for admin, staff, passenger ordering and camera access.

## What you need

If you do not yet have database or SMS accounts, follow **SERVICE_ACCOUNTS.md** first.

- A Cloudflare account with the **Workers Paid plan** and Containers enabled. Containers have usage charges in addition to the plan; review [Cloudflare's current pricing](https://developers.cloudflare.com/containers/platform/pricing/) before deploying.
- Docker Desktop running in **Linux containers** mode on the deployment laptop. Cloudflare builds a Linux/amd64 image from the included Dockerfile.
- Node.js 22.12+ and this complete project folder.
- A hosted PostgreSQL database and its TLS connection string. Use the provider's verified TLS settings; do not disable certificate verification. The local `.data/postgres` directory is not cloud storage, and container disk is ephemeral.
- A Twilio account and Verify service configured for six-digit SMS OTPs. Production requires real SMS verification. Local terminal OTP mode stays available through `npm run dev` and is intentionally blocked in production.

You can prepare and check the files before purchasing or connecting these services. The repository has not been published to your account automatically.

## 1. Install and check

Open PowerShell in `D:\raliway_project` (or your copied project folder):

```powershell
npm ci
npm run cloudflare:check
```

This builds the frontend, compiles the production Node server, checks the Cloudflare Worker types, and bundles the Worker in dry-run mode. It does not upload anything or build/push the Docker image. The dry run explicitly skips container rollouts. Docker image construction happens during the real deploy.

## 2. Sign in and choose your public address

```powershell
npm run cloudflare:login
```

Find your Workers subdomain in the Cloudflare dashboard under **Workers & Pages**. Edit `wrangler.json` and replace `vars.APP_ORIGIN` with your exact address:

```json
"APP_ORIGIN": "https://railway-pantry.YOUR-SUBDOMAIN.workers.dev"
```

Replace `YOUR-SUBDOMAIN` with your real Workers subdomain. Keep the value HTTPS with no trailing slash or path. The Worker name is `railway-pantry`; if you change it, update the address to match. Do not deploy a Pages-only `dist` folder: the Worker/Container deployment serves both the API and website.

For an existing domain managed by your Cloudflare account, you can instead use that origin and add a custom-domain route to `wrangler.json`:

```json
"routes": [{ "pattern": "pantry.your-domain.example", "custom_domain": true }]
```

Use your actual domain. The Worker redirects alternate GET/HEAD hostnames to `APP_ORIGIN`; mutation requests must come from that configured origin. A different Workers preview URL is not a second login origin.

## 3. Keep credentials in a private file

```powershell
npm run cloudflare:init
```

This creates `.env.cloudflare` without overwriting an existing file. It generates the private proxy key and preserves the local replay key when available (otherwise generating one). Edit the file and supply the hosted database and Twilio credentials. Its six keys are:

| Key | Value |
| --- | --- |
| `DATABASE_URL` | Your hosted PostgreSQL TLS connection string |
| `REPLAY_SECRET` | A stable random secret of at least 32 characters |
| `PROXY_SECRET` | A separate random secret of at least 32 characters |
| `TWILIO_ACCOUNT_SID` | Account SID beginning with `AC` |
| `TWILIO_AUTH_TOKEN` | Your account's authentication token |
| `TWILIO_VERIFY_SERVICE_SID` | Verify service SID beginning with `VA` |

Generate each new random secret separately:

```powershell
node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('base64url'))"
```

Keep those six base keys in the private file. For online payments, also add the four optional Razorpay settings from `RAZORPAY_SETUP.md`; the deploy helper accepts them. The deployment command uploads these settings as Cloudflare secrets with `--secrets-file`; they are not included in the Docker image or Worker source. `.env.cloudflare`, all private env variants, `.data`, and build/runtime caches are excluded from source control and Docker's build context. Never share this file, put it in a public repository, or paste its values into chat.

Back up the database and `REPLAY_SECRET` together. Changing or losing that secret prevents reopening saved QR previews and decrypting passenger data. If you later migrate existing local records, preserve the matching local replay key instead of generating a replacement.

## 4. Create the cloud administrator

With `DATABASE_URL` filled in and `APP_ORIGIN` configured:

```powershell
npm run cloudflare:setup
```

This connects directly to the hosted database, applies the schema, and asks you to create your administrator name, email and password. The existing setup prompt displays the password while you type, so use a private terminal. The command refuses to create a second administrator. It does not change your local embedded database. There are no default cloud credentials.

The local records in `.data` are **not automatically uploaded**. A fresh cloud database needs your services, catalogue, opening stock and staff configured again. If you need your current records moved, preserve the complete local `.data` backup and perform a separate database migration before accepting public orders; copying `.data` into the container does not migrate it to PostgreSQL.

## 5. Validate and deploy

Start Docker Desktop, then run:

```powershell
npm run cloudflare:ready
npm run cloudflare:deploy
npm run cloudflare:status
```

`cloudflare:ready` checks the public origin, required credentials and Docker availability. `cloudflare:deploy` runs those checks again, builds/pushes the container image, and deploys the Worker and its secrets to your signed-in account. It performs a real deployment and may incur Cloudflare charges. The first image build and container provisioning can take several minutes. No account ID is embedded in the repository; Wrangler uses your login/account selection.

The starter configuration routes all users to one named container and limits the deployment to one instance. This matches the application's process-local login/API rate limits. The container sleeps after ten idle minutes and wakes on the next request; the first request may take longer. Records and sessions remain in PostgreSQL across restarts. Keep the instance limit and named routing together until shared rate limiting and scaling have been reviewed.

## 6. Verify on the public HTTPS address

- Open `/api/health` and confirm `{"status":"ok"}`.
- Sign in at `/` with the cloud administrator credentials.
- Create/assign a staff account, then verify `/staff` independently.
- Generate **new passenger, food and location QRs** using the public origin. Previously printed localhost codes still point to the scanning device and must be replaced.
- Open `/user` or scan a passenger QR, enter a real mobile number and confirm actual SMS delivery and code verification.
- Place a request, assign it, scan both staff QR types with a real phone camera, and confirm collection, location and delivery.
- Restart/redeploy and verify that records remain available. Confirm database backups with your provider.

The proxy passes the visitor IP through authenticated headers so rate limits distinguish passengers instead of treating the entire Cloudflare proxy as one device. The backend ignores unauthenticated/spoofed forwarding headers. Secure HTTP-only cookies and exact-origin CSRF checks remain enabled.

## Updates and troubleshooting

When Razorpay keys are configured, the Worker cron triggers authenticated payment/refund maintenance every five minutes. The persistent refund queue survives restarts; scheduled maintenance may keep the container warm and affects Cloudflare usage. Test and live webhook settings must match their respective keys. Follow `RAZORPAY_SETUP.md` before enabling public payments.

After editing source, run the normal tests and `npm run cloudflare:check`, then `npm run cloudflare:deploy`. The Docker image builds from source; the production image includes compiled JavaScript and production dependencies, not `tsx` or Wrangler. Database migrations run before the server opens its port. Shutdown waits for active requests before closing the database.

Use Cloudflare's **Containers** dashboard for startup logs, or `npx wrangler tail` for Worker logs. A temporary 503 can occur during first provisioning or failed startup. Check the database TLS connection, all six secrets and exact `APP_ORIGIN`. Console OTP mode cannot be used on the public deployment. Updating secrets requires redeployment/container restart to refresh the process environment.

The current laptop preparation verifies source builds and Worker packaging. A Docker build, hosted PostgreSQL connectivity and real SMS/camera behavior must be checked in your configured deployment; the required account/services are not supplied by this repository.

Official references: [Container setup](https://developers.cloudflare.com/containers/get-started/), [container environment and secrets](https://developers.cloudflare.com/containers/examples/env-vars-and-secrets/), [container lifecycle/storage](https://developers.cloudflare.com/containers/faq/), [Wrangler deploy](https://developers.cloudflare.com/workers/wrangler/commands/#deploy).
