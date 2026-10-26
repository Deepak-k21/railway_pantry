# Set up Railway Pantry on another laptop

This guide runs the project locally on a second computer. Local addresses work on the computer running the app; phone scanning across devices requires a reachable HTTPS deployment.

## 1. Copy and install

Install Node.js **22.12 or newer** and npm on the new laptop. Copy the complete `raliway_project` folder there, including `client`, `server`, `public`, `scripts`, `tests`, `package.json`, `package-lock.json`, and `.env.example`. Keep `public/images/railway-journey-v2.mp4` and `railway-journey-v2-poster.jpg` with the rest of `public`; you do not need to render the video again. You may omit `node_modules`, `dist`, `.data/video-tools`, `.data/railway-frames` and `.data/browser-check` because they are rebuilt or test-only.

Open a terminal in the copied project folder and run:

```powershell
node --version
npm --version
npm ci
npm run dev
```

Open `http://localhost:5173` on that laptop. Leave the terminal running while using the site; stop it with `Ctrl+C`.

### Run it yourself in VS Code

Open the **`raliway_project` folder** in VS Code (the folder containing `package.json`). Open **Terminal → New Terminal**, run `npm ci` only for a new copy or after dependency changes, then run `npm run dev`. Wait for both the API-ready message on port `3001` and the Vite-ready message on port `5173`. The frontend now retries its initial connection if the API starts a moment later. Keep this terminal open; restarting the app later is simply `Ctrl+C`, then `npm run dev` again. Your accounts and records remain in `.data` across restarts.

Only run **one** `npm run dev` for this project at a time. If port `3001` or `5173` is already in use, the app is likely still running in another terminal: return to that terminal and stop it with `Ctrl+C` before starting a new copy. Vite will not silently move to another port. Avoid running `npm ci` while the app is active on Windows because the running process can lock a native dependency file.

Both `http://localhost:5173` and Vite's printed `http://127.0.0.1:5173` address work for local sign-in, OTPs and QR scanning. Use one address consistently during a session: browsers store separate sign-in cookies for each hostname. Local aliases must use the configured port and scheme; production accepts only its configured `APP_ORIGIN`. Passengers can also open `/user` to scan or paste their passenger QR and continue to mobile verification.

- **Admin:** open `http://localhost:5173/` and use the administrator email and password you created at first setup.
- **Service staff:** open `http://localhost:5173/staff` and use the email and password created for that staff member in the admin **Staff & locations** page. The staff member must be assigned to an active service. Admin and staff sessions can coexist in the same browser.
- **Passenger:** in admin **QR centre**, generate a passenger compartment QR and open its link on this computer. Enter a valid 10-digit Indian mobile number, select **Send verification code**, and read the six-digit code in the VS Code terminal running the backend (`[LOCAL PASSENGER OTP]`). Enter it and select **Verify & continue** to reach the welcome page and food menu. No SMS is sent in local mode. Codes expire after five minutes; wait 60 seconds between requests and use at most five code attempts. The verified session remains available for eight hours unless you select **Change mobile**. Scan the staff-only compartment and food QRs from the staff workspace; the camera button opens the rear camera when available. Allow camera permission in the browser.

There are no built-in admin or staff passwords to display. If you move this project to another computer and want the **same** logins, services and QRs, follow the data-copy instructions below rather than starting fresh.

## 2. Choose fresh setup or copy your records

### Start fresh

Do not copy `.data`. On first start, the terminal prints a **private setup link**. Open it on that laptop and create the administrator name, email and password. There are no default credentials or sample records. Then add services, compartments, catalogue products, inventory and staff in the admin workspace. Staff sign in at `http://localhost:5173/staff` with accounts created by the administrator.

### Move your existing records

Stop the app on **both** computers before copying data. Copy the entire `.data` folder from the old project into the same location in the new project. This includes `.data/postgres` (the embedded database) and `.data/replay-key` (needed to reopen saved QR codes and encrypted replay receipts). Keep a separate, private backup of the complete `.data` folder. Never open the same embedded database directory with two app processes at once.

Start `npm run dev` on the new laptop and sign in with the existing administrator and staff credentials. Passwords cannot be displayed by the app. Do not put `.data`, `.env`, or passwords in a public repository or shared archive.

## 3. Verify the transfer

Visit `http://localhost:5173`. Sign in as admin and check that the expected services, staff, stock and requests appear. Open `http://localhost:5173/staff` in another tab to sign in as staff. The two roles have separate sessions. To verify the source builds, run `npm run build`.

Existing passenger, food and compartment QR codes contain the website address used when they were created. A code containing `localhost` refers to the computer that scans it. Regenerate QR codes after moving to a different public HTTPS address.

## 4. Optional configuration

The default local setup needs no `.env` file. For custom settings, copy `.env.example` to `.env` and edit it privately. Local development starts the API on port `3001` and the website on port `5173`. If either port is in use, close the other app using it before starting Railway Pantry.

Public hosting is a separate step. Production requires a PostgreSQL server, an HTTPS `APP_ORIGIN`, a stable random `REPLAY_SECRET` of at least 32 characters, and `NODE_ENV=production`. Build with `npm run build` and start with `npm start`. Back up the database and secret together.

## 5. Enable real SMS later

For public hosting on Cloudflare, follow **DEPLOY_CLOUDFLARE.md**. The Cloudflare commands use a separate private `.env.cloudflare` file and hosted PostgreSQL; `npm run dev` remains the local setup described above.

Create a Twilio Verify service with six-digit SMS codes. Copy `.env.example` to `.env` if needed and privately set `OTP_PROVIDER=twilio`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` and `TWILIO_VERIFY_SERVICE_SID`. Restart `npm run dev` after changing configuration. The app then sends and checks OTPs through Twilio Verify; codes are not printed locally. Until these credentials are configured, use the local terminal code. Production refuses console delivery. Provider credentials remain on the backend and must never be placed in frontend code.
