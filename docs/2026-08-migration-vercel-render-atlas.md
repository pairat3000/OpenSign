# Dev handoff — Hosting migration to Vercel + Render + MongoDB Atlas

**Branch:** `staging`
**Commits:** `707e5426` (port fix + vercel.json) → `5493cd96` (gitignore fix) → `041cd69c` (SMTP IPv4 fix) → `4878e069` (Resend fallback, final)
**Pushed to:** `github.com/pairat3000/OpenSign` and `gitlab.dohome.technology/thitaphatana-san-sdl/opensign-golf`, both `staging`
**Status:** Final. Deployed, verified end-to-end (login, data, email, persistent file storage), and confirmed reachable from the network that previously blocked the old setup.

---

## 1. The problem

Testing had been running on a self-hosted local backend/frontend exposed through a named Cloudflare Tunnel on a personally-registered domain. The corporate firewall (FortiGuard) flagged that domain as "newly registered" and blocked it outright, so testing only worked from outside the office network (mobile data). There was also no way to test without first starting three local processes (MongoDB, Node backend, Node frontend, plus the tunnel) by hand every session.

## 2. What was built

Moved to three free-tier hosted services, none of which need a personally-owned domain — each gives a subdomain of an already-trusted platform domain (`*.vercel.app`, `*.onrender.com`), which doesn't trip the same "newly registered domain" firewall rule.

- **Frontend → Vercel** (Hobby plan, free, no card): static Vite build, root directory `apps/OpenSign`, build command `npm run build`, output directory `build`.
- **Backend → Render** (free Web Service, no card): `apps/OpenSignServer`, build `npm install`, start `node index.js`.
- **Database → MongoDB Atlas** (free M0 cluster, no card): existing local data (`OpenSignDB`) migrated over in full — all 18 collections, including documents, users, sessions, and the Secretary-feature test data from the previous session.
- **File storage → Cloudflare R2** (free 10GB tier; required adding a card to enable R2 billing on the Cloudflare account, though usage stays $0 within the free tier). Initially left on `USE_LOCAL=true` (Render's local disk) as a zero-card tradeoff, but that turned out to be a real problem in practice: every redeploy wiped all uploaded files, including user profile pictures, which surfaced as "why does my profile picture keep disappearing." Switched to R2 (config-only change, no code — the existing `@parse/s3-files-adapter` / `DO_*` env vars already used for DigitalOcean Spaces work as-is against R2's S3-compatible API) once that cost was accepted. Verified a file survives a redeploy end-to-end before considering this closed.

### Code changes required

1. **`apps/OpenSignServer/Utils.js`** — `cloudServerUrl` was hardcoded to `http://localhost:8080/app`. ~15 cloud functions (`createBatchDocs.js`, `getDocument.js`, `getReport.js`, `pdf/PDF.js`, `AddAdmin.js`, `AuthLoginAsMail.js`, `usersignup.js`, etc.) use it for internal server-to-server REST calls to the app's own Parse API. Render assigns its own `PORT`, so the hardcoded `8080` broke every one of those calls. Fixed to derive the port dynamically:
   ```js
   export const cloudServerUrl = `http://localhost:${process.env.PORT || 8080}/app`;
   ```
2. **`apps/OpenSign/vercel.json`** (new) — SPA rewrite so `react-router` client-side routing works on Vercel's static hosting (previously handled by the local `server.cjs`'s fallback logic, which Vercel doesn't run):
   ```json
   { "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }] }
   ```
3. **SMTP → force IPv4** (`index.js`, `sendMailv3.js`, `sendMailWithAttachment.js`, `sendSystemMail.js`) — added `family: 4` to nodemailer's `transporterConfig`. Turned out not to matter in the end (see §3) but is a correct, harmless fix on its own for hosts that resolve mail servers to an unreachable IPv6 address.
4. **Resend HTTP API as a third mail provider** (same four files) — see §3.

## 3. The SMTP dead end, and why email now goes through Resend

Gmail SMTP (the mail config already in use locally) does not work from Render at all — confirmed across **both** port 465 and 587, and even after switching the SMTP relay target from `smtp.gmail.com` to a non-Google relay (Resend's own `smtp.resend.com`). Every attempt timed out. This points to Render's free tier blocking outbound SMTP traffic at the network level (a common anti-abuse measure on free PaaS tiers), not a DNS/routing/reputation issue with any specific mail host.

Since HTTP isn't subject to that block, added a third branch to the existing SMTP/Mailgun provider selection in `sendMailv3.js`, `sendMailWithAttachment.js`, and `sendSystemMail.js`: if neither `SMTP_ENABLE` nor `MAILGUN_API_KEY` is set, and `RESEND_API_KEY` is, send via a plain `fetch()` POST to `https://api.resend.com/emails`. No new dependency — Node 20's built-in `fetch` is enough. `sendMailWithAttachment.js`'s attachment path base64-encodes the PDF/certificate buffers, since Resend's JSON API expects attachment content as a base64 string rather than a raw buffer.

Currently configured with Resend's free tier and its sandbox sender (`onboarding@resend.dev`) — sending works and lands in the inbox (verified, not spam), but a free/unverified Resend account can only send **to the account owner's own verified email**, not arbitrary recipients. Real signer-invite emails (to arbitrary recipients) will need a verified sending domain on Resend before this is usable beyond the current admin-only testing.

## 4. Environment variables (Render)

Values live in Render's dashboard, not in git. Names, for reference:

`appName`, `MASTER_KEY`, `MONGODB_URI` (Atlas `mongodb+srv://` connection string, includes `retryWrites=true&w=majority`), `PARSE_MOUNT=/app`, `SERVER_URL` (the Render service's own public URL + `/app`), `USE_LOCAL=false`, `APP_ID`, `SMTP_ENABLE=false`, `RESEND_API_KEY`, `RESEND_SENDER=onboarding@resend.dev`, `PASS_PHRASE`, `PFX_BASE64`, `NODE_VERSION=20.18.1`.

**R2 storage vars**: `DO_SPACE` (bucket name, `opensign-files`), `DO_ENDPOINT` (the R2 account's S3 API endpoint, `https://<account-id>.r2.cloudflarestorage.com`), `DO_BASEURL` (the bucket's public R2.dev URL — Settings → Public Development URL → Enable; no custom domain needed), `DO_ACCESS_KEY_ID` / `DO_SECRET_ACCESS_KEY` (from an R2 Account API Token, Object Read & Write, scoped to the bucket), `DO_REGION=auto`. These reuse the same `s3Options` code path index.js already had for DigitalOcean Spaces — no code change was needed, only these env vars.

**Atlas Network Access** must allow `0.0.0.0/0` — the auto-created entry only allowlists whoever's IP created the cluster, which is not Render's IP. Without this, MongoDB connections fail with a TLS-layer error (`tlsv1 alert internal error`) rather than a clean connection-refused, which is non-obvious to diagnose.

**Vercel** build-time env vars: `REACT_APP_SERVERURL` (Render backend URL + `/app`), `REACT_APP_APPID=opensign`, `PUBLIC_URL` (the Vercel deployment URL), `GENERATE_SOURCEMAP=false`. These are baked into the JS bundle at build time (Vite's `define`), not read at runtime — changing them requires a rebuild, not just a redeploy.

## 5. Testing performed

- Migrated all 18 local MongoDB collections to Atlas via a one-off Node script (not committed — used the `mongodb` driver already in `node_modules`, no new tooling installed).
- Confirmed `GET /app/health` responds and `GET /app/users/me` with a pre-migration session token returns the correct user — proves both the Mongo connection and the migrated session data work end-to-end.
- Sent a real test email via `sendmailv3` after the Resend switch → `{"status":"success"}`, and visually confirmed receipt in the inbox (not spam).
- Confirmed the Vercel frontend loads and the full app (login, Document Recheck, Secretary Management) is reachable from a network where the old domain was blocked by the corporate firewall — the actual goal of this migration.
- Uploaded a test file after switching to R2, triggered a fresh Render redeploy, then fetched the same file again (both via a presigned URL and the plain public R2.dev URL) — confirmed it survived, closing out the `USE_LOCAL` data-loss issue.

## 6. Known follow-ups

- **Resend sending restriction**: only sends to the account owner's own email until a real domain is verified on Resend. Fine for admin-only testing of the mail pipeline; not yet usable for actual signer invites to third parties.
- **Render free tier cold starts**: the backend sleeps after 15 minutes of inactivity; the first request after a sleep takes ~30-60s to wake up. No cost, just a UX quirk to expect during testing.
- The local Cloudflare Tunnel / `thitaphat.online` setup from the previous session is no longer needed for testing and can be left off; nothing currently depends on it.
