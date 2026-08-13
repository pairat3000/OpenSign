# Dev handoff — Mail-send logging + "Document Recheck" admin tool

**Branch:** `staging`
**Commit:** `f351cd14`
**Pushed to:** `github.com/pairat3000/OpenSign` and `gitlab.dohome.technology/thitaphatana-san-sdl/opensign-golf`, both `staging`
**Status:** Implemented and tested (API-level, with a real admin session token). Not yet exercised through a full browser click-through by an end user.

---

## 1. The problem

There was no way to answer "did this document's signature-request emails actually go out?" after the fact. Every mail-sending code path only `console.log`'d success/failure — once the server log rotated, that information was gone. The one DB field that looked relevant, `SendMail` on `contracts_Document`, is misleading: it's set from whichever recipient's send happened to finish *last* in the invite loop, not "did everyone get it."

Admins had no tool to investigate a specific document creator's outgoing requests when something looked wrong (a recipient claims they never got the email, a document looks stuck, etc.).

## 2. What was built

### Persistent mail log — `MailLog` on `contracts_Document`

New migration `apps/OpenSignServer/databases/migrations/20260811000000-add_maillog_field.cjs` adds an Array field `MailLog`. Each entry: `{ Recipient, Purpose, Status, ErrorMessage, SentAt }`. `Purpose` is one of `invite | resend | next-signer-notify | owner-notify | completion`.

Written via a new shared helper, `apps/OpenSignServer/utils/mailLogUtils.js` → `logMailAttempt(docId, {...})`, using Parse's **atomic array Add** operation (`{ MailLog: { __op: "Add", objects: [entry] } }`) rather than a read-modify-write — so concurrent sends can never clobber each other's log entries, and no pre-fetch is needed.

Every mail-sending path now calls it:
- `cloud/parsefunction/sendMailv3.js` (`sendmailv3`) — this is the one cloud function used by invite, resend, *and* next-signer-notify, so instrumenting it there covers all three. Client callers now pass `docId` + `purpose` alongside the existing params: `apps/OpenSign/src/constant/Utils.js` (`sendEmailToSigners`), `apps/OpenSign/src/reports/document/DocumentsReport.jsx` (`handleResendMail`), `apps/OpenSign/src/pages/PdfRequestFiles.jsx` (the next-signer-notify block after a signature completes).
- `cloud/parsefunction/sendSystemMail.js` and `cloud/parsefunction/sendMailWithAttachment.js` — server-initiated (owner-notify and completion-mail respectively, both called from `PDF.js`), no client change needed since `docId` was already in scope there.

Note: **template mail sends aren't logged** — `MailLog` only exists on `contracts_Document`, not `contracts_Template` (templates aren't signed documents).

### Admin page — Settings → "Document Recheck"

New cloud function `apps/OpenSignServer/cloud/parsefunction/adminAuditDocuments.js` (registered as `adminauditdocuments` in `cloud/main.js`):
- Requires the caller's `contracts_Users.UserRole` to be `contracts_Admin` or `contracts_OrgAdmin` (same check pattern as `resetPassword.js`), else throws `OPERATION_FORBIDDEN`.
- Takes `creatorEmail` (required) + `documentName` (optional substring match), resolves the creator within the admin's own tenant, and returns up to 50 of their documents with:
  - `status` — `Completed | Declined | Not yet sent | In progress (waiting on: ...)`, computed from existing `IsCompleted`/`IsDeclined`/`AuditTrail`/`Placeholders` (no new tracking needed for this part).
  - `sendInOrder` — the raw `SendinOrder` boolean.
  - `mailLog` — the document's `MailLog`, newest first.
  - `diagnosis` — plain-Thai findings generated from simple rules: any failed send, any signer who was never emailed at all, or (for `SendinOrder` documents) a later signer having signed while an earlier one hasn't.

New page `apps/OpenSign/src/pages/AdminDocumentAudit.jsx` — two inputs (email, optional document name), results as expandable rows showing status/Send-in-order/mail-log table/diagnosis list. **Read-only by design** — no resend button in this tool; admins already have Resend on the document itself.

Access is gated three ways: sidebar link hidden for non-admins (`apps/OpenSign/src/json/menuJson.js`, added alongside the existing "Users" admin-only item so it inherits the same `isAdmin` gate in `Sidebar.jsx`), the cloud function rejects non-admins server-side, and the page itself now redirects non-admins to the dashboard if they hit the URL directly.

## 3. Also fixed in this pass

- **Sidebar showed a raw i18n key** (`sidebar.Settings-Children.Document Audit`) instead of a label, because the menu item's title had no matching translation entry. Renamed the item to "Document Recheck" and added the key to all 7 locale files (`apps/OpenSign/public/locales/{en,de,fr,es,it,kr,hi}/translation.json`).
- Widened Vite's dev-server `allowedHosts` (`apps/OpenSign/vite.config.js`) for the current test-tunnel domain (internal detail, not covered here — ask if you need the current test URL).

## 4. Testing performed

- Sent a real mail via `sendmailv3` with `docId`/`purpose` set → confirmed a `Status: "success"` entry landed in `MailLog`.
- Forced a failure (invalid recipient) → confirmed a `Status: "error"` entry with a real error message landed in `MailLog`, not just a console log.
- Called `adminauditdocuments` with a real admin session token → got back the right document with correct `status`/`sendInOrder`/`mailLog`/`diagnosis` (including the flagged failed send).
- Called it with no session token → correctly rejected (`INVALID_SESSION_TOKEN`).
- Called it with an email that matches no user → returns `{ documents: [] }`, no error.

## 5. Known follow-ups

- Not yet verified by an actual admin clicking through the UI in a browser — API-level testing only so far.
