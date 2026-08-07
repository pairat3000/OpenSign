# CLAUDE.md

Guidance for Claude Code (and developers) when working in this repository.
This is a **Dohome-customized fork** of [OpenSign™](https://github.com/OpenSignLabs/OpenSign),
an open-source document e-signing platform (a DocuSign alternative).

> Primary Dohome customizations so far: **Thai font support (Sarabun) in embedded PDF widgets**
> and a **"comment before finishing signing" feature** with an on-document placement picker.
> See [Dohome Customizations](#dohome-customizations) before touching the signing UI.

---

## 1. Repository layout

Monorepo, no workspace tooling — each app has its own `package.json` and is built/deployed separately.

```
Opensign/
├── apps/
│   ├── OpenSign/          # Frontend — React 19 + Vite  (package name: open_sign, v2.37.0)
│   ├── OpenSignServer/    # Backend  — Parse Server 8 + MongoDB (open_sign_server)
│   ├── mongo/             # local MongoDB helper assets
│   └── localstack/        # local S3 (LocalStack) for file storage in dev
├── docker-compose.yml     # 4 services: server(8080), mongo, client(3000), caddy(reverse proxy/HTTPS)
├── Caddyfile
├── .env.example           # documents every env var (copy to .env.prod for docker)
└── CLAUDE.md
```

The client and server are **decoupled**: the frontend talks to the backend only through the
Parse JS SDK / Parse REST API mounted at `<SERVER_URL>` (`/api/app` in docker, `/app` via `PARSE_MOUNT`).

---

## 2. Tech stack

**Frontend (`apps/OpenSign`)**
- React 19, **Vite 8** (migrated off CRA — note `outDir: "build"` for CRA compatibility)
- Routing: `react-router` v7 (see `src/App.jsx`)
- State: Redux Toolkit (`src/redux`) + Zustand
- Backend calls: **Parse JS SDK** (`parse`), plus raw `axios` for some REST/cloud calls
- PDF: `react-pdf` (render) · **`pdf-lib` + `@pdf-lib/fontkit`** (embed widgets client-side) · `pkijs` (verify)
- UI: Tailwind + **DaisyUI** (`op-*` class prefix) + MUI + Radix; drag/drop via `react-dnd` + `react-rnd`
- i18n: `i18next` / `react-i18next` (locale JSON under `src/`); tests via **Vitest**

**Backend (`apps/OpenSignServer`)**
- **Parse Server 8** on Express 5, MongoDB (`mongodb` driver v7)
- All business logic = **Parse Cloud Functions** in `cloud/parsefunction/*.js`, registered in `cloud/main.js`
- Digital signing: **`@signpdf/signpdf` + `@signpdf/signer-p12`** (PAdES signature using a PFX/p12 cert)
- File storage: S3 / DigitalOcean Spaces (`@parse/s3-files-adapter`) or local FS (`USE_LOCAL=TRUE`)
- Email: **Mailgun** (`mailgun.js`) or SMTP (`nodemailer`) — one MUST be configured or the app won't boot
- Tests via **Jasmine** (`spec/`); DB schema via **migrations** (`databases/migrations/*.cjs`)

---

## 3. Common commands

Run these **inside the specific app directory** (`apps/OpenSign` or `apps/OpenSignServer`).

**Frontend**
```bash
npm run dev            # Vite dev server (default port 3000)
npm run build          # fetches latest version tag then vite build → build/
npm run build-win      # Windows-friendly version step (use this on Windows)
npm run test           # vitest run
```

**Backend**
```bash
npm run watch          # nodemon index.js
npm run start          # node index.js
npm run lint           # eslint ./cloud, index.js, ./spec
npm run test           # starts mongodb-runner + jasmine
```

**Whole stack (docker)** — from repo root, requires `.env.prod`:
```bash
docker compose up --force-recreate
```

> On Windows this repo lives under a OneDrive path with spaces. Prefer the `*-win` npm scripts,
> and quote paths. Node engines: **18 || 20 || 22**.

---

## 4. End-to-end signing flow

The most important flow in the codebase. Two roles: the **document owner** (creator) and
**recipients/signers** (contacts). The recipient signing page is
[`PdfRequestFiles.jsx`](apps/OpenSign/src/pages/PdfRequestFiles.jsx).

### Client side (`PdfRequestFiles.jsx` → `constant/Utils.js`)
1. Recipient opens `/recipientSignPdf/:docId/:contactBookId` (or `/load/...` for guest link).
   If `IsEnableOTP` is set, the guest must verify an emailed OTP first.
2. The unsigned PDF is loaded (`SignedUrl` if a prior signer already signed, else original `URL`)
   and rendered page-by-page by `RenderPdf`. Each signer's widgets live in **`signerPos`** state,
   shaped as `[{ Id, signerObjId, Role, placeHolder: [{ pageNumber, pos: [widget, ...] }] }]`.
3. Signer fills widgets (signature pad, text, checkbox, date…). On finish:
   - `handleSignPdf()` → **(Dohome) comment modal** → `handleCommentProceed()` → `embedWidgetsData()`.
4. `embedWidgetsData(overrideSignerPos)`:
   - re-fetches the latest document (avoids clobbering a concurrent signer),
   - loads the PDF into `pdf-lib`, and calls **`embedWidgetsToDoc(widgets, pdfDoc, ...)`**
     which **draws each widget onto the PDF** (images for signature/stamp/initials, text for the rest).
     Coordinates convert from screen space to PDF space using the page **CropBox** and the widget's
     `xPosition/yPosition`, `scale`, and `isMobile` flags.
   - Exports a base64 PDF and calls **`signPdfFun(base64Url, docId, signerObjectId, ...)`**.
5. `signPdfFun` (in `Utils.js`) extracts the signer's first signature image (for the certificate),
   then calls the backend cloud function **`signPdf`** with `{ pdfFile(base64), docId, userId, signature, activity }`.

### Server side (`cloud/parsefunction/pdf/PDF.js`, cloud fn `signPdf`)
`PDF(req)` does the authoritative work:
1. Loads `contracts_Document` (with `ExtUserPtr, Signers, TenantId, Bcc, Cc, CreatedBy`),
   rejecting declined/archived docs; enforces OTP session if `IsEnableOTP`.
2. **Strict-order gating**: if `SendinOrder && SendInOrderStrict`, a signer may only act after all
   prior non-prefill placeholders have a `Signed`/`Approved` audit entry
   (see `utils/workflowUtils.js`: `findPlaceholderIndex`, `findPendingPriorSigner`).
3. Computes completion: counts `Signed`/`Approved` audit entries vs. completion-relevant placeholders
   (`isCompletionRelevant` excludes prefill / viewers). `isCompleted` when counts match.
4. If completed → embeds a **completion certificate** (`GenerateCertificate.js`) + timestamp reason,
   then **digitally signs** the PDF with the tenant's PFX (falls back to `PFX_BASE64`/`PASS_PHRASE` env)
   via `SignPdf().sign(buffer, P12Signer)`, and computes a **SHA-256 `DocumentHash`**.
5. Uploads the signed PDF (`uploadFile` → S3/FS), then `updateDoc` writes `SignedUrl`, appended
   `AuditTrail` (with `UserPtr, Activity, ipAddress, SignedOn, Signature`), and `IsCompleted`.
6. Sends notification mail to owner (`sendNotifyMail`) and, on completion, the certificate mail
   to all parties (`sendMailsaveCertifcate`). Errors are written back to the doc's `DebugginLog`.

> Key point: **widgets are visually burned into the PDF on the client**, but the **cryptographic
> signature, certificate, hash, audit trail, and completion state are decided on the server.**
> Never trust client-computed completion.

---

## 5. Parse data model (MongoDB via Parse classes)

Classes are prefixed `contracts_` (core) and `partners_` (tenancy). Schema evolves through
`databases/migrations/*.cjs` — **add a migration for every schema change**, never mutate an
existing one. Triggers are wired in `cloud/main.js`.

| Class | Purpose | Notable fields |
|-------|---------|----------------|
| `contracts_Document` | A document sent for signing | `Name`, `URL`, `SignedUrl`, `Signers` (→ Contactbook[]), `Placeholders` (widget layout per signer), `ExtUserPtr` (→ Users), `CreatedBy`, `AuditTrail[]`, `IsCompleted`, `IsDeclined`/`DeclineReason`/`DeclineBy`, `IsArchive`, `ExpiryDate`, `TimeToCompleteDays`, `IsEnableOTP`, `SendinOrder`/`SendInOrderStrict`, `NotifyOnSignatures`, `Bcc`/`Cc`, `RedirectUrl`, `DocumentHash`, `SignatureType`, `DebugginLog` |
| `contracts_Template` | Reusable document template | mirrors Document (`Placeholders`, `Signers`, `SendinOrder`, `TemplateId`…) |
| `contracts_Contactbook` | A signer/contact | `Name`, `Email`, `Phone`, `UserId`, `TenantId`, `NormalizedEmail` |
| `contracts_Users` (aka `contracts_Users`/`Extand_Class`) | Extended app user profile | linked to Parse `_User`, `TenantId`, `Name` |
| `contracts_Signature` | Saved signatures | signature image + `PenColors`, `stamp` |
| `contracts_Teams` / org classes | Multi-user org/teams | created in `20240708200454-create_multiuser_classes` |
| `partners_Tenant` | Tenant config | `PfxFile{base64,password}`, completion mail templates, logo/branding |

**Triggers (`cloud/main.js`):**
- `beforeSave` — `contracts_Document`, `contracts_Template` (validation/normalization)
- `afterSave` — `contracts_Document`, `contracts_Contactbook`, `contracts_Template`, `contracts_Teams`
- `afterFind` — `_User`, `contracts_Document`, `contracts_Template`, `contracts_Signature`, `partners_Tenant`
- `Parse.Cloud.define('signPdf', PDF)` plus ~60 other cloud functions (getDocument, getReport, savefile,
  declinedoc, forwarddoc, saveastemplate, generatecertificate, adduser, addadmin, …).

**Widget shape** (element inside `placeHolder[].pos[]`), the object the comment feature also builds:
```js
{
  xPosition, yPosition,        // in PDF-page coordinate space (pre-scale)
  key, scale, zIndex,
  type,                        // "signature" | "stamp" | "initials" | "image" | "draw"
                               // | "text" | "text input" | "cells" | "checkbox" | "radio button" | ...
  options: { name, status, response, fontSize, fontColor, defaultValue, values, ... },
  Width, Height
}
```
Widget-type constants are exported from `src/constant/Utils.js`
(`textWidget = "text"`, `drawWidget = "draw"`, `radioButtonWidget`, `cellsWidget`, `textInputWidget`).
Image-type widgets (`signature/stamp/initials/image/draw`) embed as PNG/JPG; everything else as text.

---

## 6. Dohome customizations

Custom code added on top of upstream OpenSign. Preserve these when merging upstream.

### 6.1 Thai font in embedded widgets — `src/constant/Utils.js`
`embedWidgetsToDoc()` previously loaded Times from `cdn.opensignlabs.com`. It now loads
**Sarabun** (Thai + Latin) from `public/static/sarabun.ttf` (served at `/static/sarabun.ttf`),
falling back to the CDN Times font if the local asset fails:
```js
try { fontBytes = await fileasbytes(`${window.location.origin}/static/sarabun.ttf`); }
catch (_) { fontBytes = await fileasbytes("https://cdn.opensignlabs.com/webfonts/times.ttf"); }
```
`pdfDoc.embedFont(fontBytes, { subset: true })` — the font is subset-embedded into each signed PDF.
> If you add PDF text output elsewhere (e.g. certificate, server-side draw) and need Thai glyphs,
> mirror this and embed Sarabun there too.

### 6.2 "Comment before finishing" feature — `src/pages/PdfRequestFiles.jsx`
Before a signer completes signing, they can add a free-text comment placed anywhere on the document.
The UI strings are Thai.

State: `isCommentModal`, `commentText`, `commentPlacementMode`, `commentWidgetPos`, `commentMousePos`.

Flow:
1. `handleSignPdf()` no longer signs directly — it opens the **comment modal** (`ความเห็นเพิ่มเติม`).
2. From the modal, `handleEnterPlacementMode()` shows a full-screen **crosshair overlay** over the
   stacked PDF pages with a cursor-following preview label.
3. `handlePlacementClick(e)` finds which page was clicked using each page element's
   **`getBoundingClientRect()`** (`[data-page-number]`), computes page-relative coords, then divides by
   `getContainerScale(...) * scale` to get PDF coordinates → stores `commentWidgetPos { pageNumber, xPosition, yPosition }`.
4. `handleCommentProceed(comment)` builds a **text widget** (`type: textWidget`, `options.response = comment`)
   at the chosen position (or bottom of last page as fallback), **synchronously merges it into a copy of
   `signerPos`** (`finalSignerPos`), and calls `embedWidgetsData(finalSignerPos)` so it's embedded in the
   same pass — passing it explicitly avoids a `setState` race.

> Gotcha: `embedWidgetsData` accepts an `overrideSignerPos` param specifically so the freshly-added
> comment widget is used immediately rather than waiting for React state to flush.
> Placement math depends on real DOM rects — keep `data-page-number` attributes intact in `RenderPdf`.

---

## 7. Configuration & environment

Copy `.env.example` → `.env.prod` (docker) or set in each app's env. Key vars:
- **App identity:** `APP_ID` / `REACT_APP_APPID` (must match, 12-char id, default `opensign`), `MASTER_KEY`
- **URLs:** `PUBLIC_URL`, `SERVER_URL` / `REACT_APP_SERVERURL` (frontend reads `REACT_APP_*` via
  `vite.config.js` `define` shim), `PARSE_MOUNT=/app`
- **DB:** `MONGODB_URI`
- **Storage:** `DO_SPACE`/`DO_ENDPOINT`/`DO_BASEURL`/`DO_ACCESS_KEY_ID`/`DO_SECRET_ACCESS_KEY`/`DO_REGION`, or `USE_LOCAL=TRUE`
- **Email:** `MAILGUN_API_KEY`/`MAILGUN_DOMAIN`/`MAILGUN_SENDER` **or** `SMTP_ENABLE=true` + `SMTP_*`
- **Signing cert:** `PFX_BASE64` + `PASS_PHRASE` (a tenant's `partners_Tenant.PfxFile` overrides these per-tenant)

Frontend env quirk: CRA-style `REACT_APP_*` vars are exposed to the app through the Vite `define`
block, so keep that naming rather than switching to `VITE_*`.

---

## 8. Conventions & gotchas

- **Adding a cloud function:** create `cloud/parsefunction/<name>.js`, `import` it in `cloud/main.js`,
  register with `Parse.Cloud.define('<clientName>', fn)`. Call it from the client via
  `Parse.Cloud.run('<clientName>', params)` (or the existing `axios` helpers).
- **Schema changes:** always add a new dated migration in `databases/migrations/`; never edit old ones.
  Migrations use the Parse `Schema` API (`addString`, `addBoolean`, `addPointer`, `deleteField`…).
- **Signing correctness is server-authoritative** — completion, audit trail, hashing, and the PFX
  signature happen in `PDF.js`. Client-side embedding is presentation only.
- **PDF coordinates** are the top recurring bug source: screen ↔ PDF conversion depends on page
  CropBox, `scale`, container scale, `isMobile`, and (for the comment feature) DOM bounding rects.
  Test on both desktop and mobile viewports after any change here.
- **Styling:** DaisyUI components use the `op-` prefixed classes (`op-btn`, `op-textarea`, `op-modal`…).
- **i18n:** user-facing strings should go through `t("key")`. Some Dohome comment-feature strings are
  currently hard-coded Thai — prefer adding i18n keys when extending them.
- **Upstream sync:** this fork tracks `OpenSignLabs/OpenSign`. When merging upstream, re-check
  `embedWidgetsToDoc` (font) and `PdfRequestFiles.jsx` (comment flow) for conflicts.
- **Do not commit secrets** (`.env.prod`, PFX files, keys). `.env.example`/`.env.local_dev` are templates only.
