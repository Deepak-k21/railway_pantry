# Create the database and SMS accounts

The app is already configured to use Neon-compatible PostgreSQL and Twilio Verify. You complete the providers' account registration and personal verification; then the project can connect using the private configuration file.

## 1. Neon PostgreSQL

1. Open https://console.neon.tech/signup and sign up or sign in. Complete any email verification requested by Neon.
2. Create a project named **railway-pantry**. Keep the default PostgreSQL version and select an available region appropriate for your deployment.
3. Open the project and select **Connect**. Select its production/default branch, database and role, then copy the PostgreSQL connection string.
4. Open the project's private `.env.cloudflare` file and put the complete connection string after `DATABASE_URL=`. Keep the TLS parameters supplied by Neon. Do not paste the connection string into chat.

You do not need to create tables manually or add sample data. The existing cloud administrator setup applies this project's schema. A fresh Neon database does not contain the records from your laptop; keep the local database and matching replay-key backup if those records need to be migrated.

Reference: https://neon.com/docs/get-started/connect-neon

## 2. Twilio Verify

1. Open https://www.twilio.com/try-twilio and create your account. Complete the email and personal mobile-number verification yourself.
2. In the Twilio Console, open **Verify** and create a verification service named **Railway Pantry**. Enable the SMS channel and set the verification code length to **6 digits**.
3. From the account dashboard, copy the Account SID beginning with `AC` and its Auth Token. From the Verify service, copy its Service SID beginning with `VA`.
4. Fill these existing keys in `.env.cloudflare` privately:

```dotenv
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_VERIFY_SERVICE_SID=
```

Twilio Verify handles the SMS sender; its quickstart does not require purchasing a separate Twilio phone number. A trial is suitable for testing with verified recipients. Public passenger use requires upgrading the account and completing the account profile/approval requirements shown by Twilio. Check Verify geographic permissions for your intended destination country if delivery is restricted.

References: https://www.twilio.com/docs/verify/quickstarts/node-express and https://www.twilio.com/docs/verify/quickstarts

## 3. Finish the Cloudflare requirements

The public origin is configured as `https://railway-pantry.deepakkannika2.workers.dev`; this is a deployment target, not confirmation that the site is live. The private replay and proxy keys have already been initialized. Leave those values unchanged.

Cloudflare currently rejects Containers access because Workers Paid is not enabled on the account. Enable that plan in the Cloudflare dashboard. The laptop deployment also requires Docker Desktop running in Linux containers mode, or a configured remote image-build pipeline.

After the database and Twilio credentials are in place, continue with `DEPLOY_CLOUDFLARE.md`. You can report that the accounts are ready without sharing passwords, OTPs, connection strings or authentication tokens in chat.
