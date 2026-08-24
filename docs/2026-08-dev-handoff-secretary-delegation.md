# Dev handoff — Secretary delegation for internal signers

**Branch:** `staging`
**Commits:** `b04066ea` (feature) → `67eeb627` (two-tier permissions, final)
**Pushed to:** `github.com/pairat3000/OpenSign` and `gitlab.dohome.technology/thitaphatana-san-sdl/opensign-golf`, both `staging`
**Status:** Final. Implemented, deployed, and verified end-to-end against the live Render+Atlas backend.

---

## 1. The problem

There was no way for an internal employee to delegate visibility of their incoming signature requests to another employee (e.g. an assistant/secretary covering for them) without sharing login credentials. Document visibility in the app is otherwise strictly "documents you created" or "documents you're a signer/viewer on" — there was no concept of one user seeing another's incoming documents.

## 2. What was built

Admins/OrgAdmins can assign a "secretary" (another internal org member) to monitor a signer's incoming documents. Both accounts must be internal `contracts_Users` (real logins, not guest Contactbook-only contacts) in the same tenant. Only Admin/OrgAdmin can create or toggle an assignment — never the secretary or signer themselves.

### Schema — `contracts_Secretary`

New Parse class: `SecretaryUserId` / `SignerUserId` (pointers to `contracts_Users`), `TenantId`, `IsActive` (Boolean), `CanViewContent` (Boolean, added in the second pass — see §3), `CreatedBy`. No hard-delete endpoint — toggling `IsActive` off is the only "remove access" path, preserving assignment history.

### Cloud functions (`apps/OpenSignServer/cloud/parsefunction/`)

- **`assignSecretary.js`** (`assignsecretary`) — admin-only. Resolves both emails within the admin's own tenant, rejects self-assignment, reactivates an existing (deactivated) row instead of creating a duplicate.
- **`listSecretaryAssignments.js`** (`listsecretaryassignments`) — admin-only. Every assignment in the admin's tenant, with names/emails included, for the management table.
- **`toggleSecretaryAssignment.js`** (`togglesecretaryassignment`) — admin-only. See §3 for the two-tier logic.
- **`listMySecretarySigners.js`** (`listmysecretarysigners`) — any authenticated user. The signers *they* currently have active visibility into.
- **`getSecretaryDocuments.js`** (`getsecretarydocuments`) — re-verifies an active assignment server-side (never trusts the client), resolves the signer's `contracts_Contactbook` rows (a signer can have one per sender), and returns their documents with a derived per-document status (`Signed`/`Pending`/`Declined`).
- **`getSecretaryDocumentDetail.js`** (`getsecretarydocumentdetail`) — independently re-derives authorization from the document's own `Signers` list rather than trusting a `signerUserId` param, so mismatched `docId`/`signerUserId` can't be used to bypass the check. Returns the document's viewable URL.

Shared helpers in `apps/OpenSignServer/utils/secretaryUtils.js`: `requireActiveSecretaryLink` and `getSignerContactRows`.

### Client pages

- **`apps/OpenSign/src/pages/AdminSecretaryManagement.jsx`** — admin-only (3-layer gating: hidden sidebar entry, server-side role check, client-side redirect). Assign by email pair, table of assignments with toggles (see §3).
- **`apps/OpenSign/src/pages/SecretaryDocuments.jsx`** — visible to every logged-in user (empty state handles having no assignments). Signer picker → document list with status badges → "ดูเอกสาร" opens a read-only `<iframe>` PDF viewer (deliberately not the signing-flow's `RenderPdf`, which is tightly coupled to widget-embedding state and unsuitable for a plain read-only view).

## 3. Two-tier permissions (the `CanViewContent` field)

Follow-up request: separate "can see the document list + status" from "can open the actual document content" as two independent, admin-controlled grants — not one on/off switch for both.

- **`IsActive`** — gates `getsecretarydocuments` (the list/status view). Unchanged from the original design.
- **`CanViewContent`** — new field, gates `getsecretarydocumentdetail` (opening the PDF) *in addition to* `IsActive`. A secretary can have list access without content access, but never content access without list access.

New assignments start with `IsActive: true` (as before) but `CanViewContent: false` — content access is a deliberate second grant, not bundled automatically.

`toggleSecretaryAssignment` now accepts `isActive` and/or `canViewContent` independently and enforces the dependency both directions:
- Requesting `canViewContent: true` while the resulting `isActive` is false is rejected outright (`OPERATION_FORBIDDEN`, Thai message: "ต้องเปิดสิทธิ์ดูรายการเอกสารก่อนจึงจะเปิดสิทธิ์ดูเนื้อหาได้").
- Setting `isActive: false` always cascades `canViewContent` to `false` too, even if the caller didn't touch that field — a secretary can never end up with content access while list access is off.

`AdminSecretaryManagement.jsx` renders this as two separate toggle columns ("ดูรายการเอกสาร" / "ดูเนื้อหาเอกสาร"); the content-view toggle is disabled (with a tooltip) whenever list-view is off, so the UI can't even attempt the rejected state.

`getSecretaryDocumentDetail.js` checks `CanViewContent` on whichever assignment row actually matched the document's signer (not just "does any active assignment exist") before returning the URL.

## 4. Testing performed

All tested against the live Render + MongoDB Atlas deployment (`https://opensign-jnjk.onrender.com`), not just locally:

- Assign a valid pair (same tenant) → row created, `IsActive: true`, `CanViewContent: false`.
- Self-assignment and cross-tenant assignment → rejected.
- Non-admin calling any of the admin-only functions → rejected (`Unauthorized.`).
- `getsecretarydocuments`/`getsecretarydocumentdetail` called with no active assignment, or a mismatched/guessed `signerUserId`/`docId` → rejected.
- Content permission: `getsecretarydocumentdetail` rejected before granting `CanViewContent`, succeeded after.
- List access still works with `CanViewContent: false` (list and content are genuinely independent).
- Enabling `canViewContent` while `isActive` is false → rejected with the expected error.
- Enabling both simultaneously, then disabling only `isActive` → confirmed `canViewContent` cascades to `false` automatically.
- Toggle off/on cycle confirmed both directions take effect immediately (`listmysecretarysigners` reflects the change right away).

## 5. Known follow-ups

- No delete endpoint for assignments, only the `IsActive` toggle — by design, preserves history.
- No email notification when an assignment is created or toggled — not requested; could reuse the existing `sendSystemMail.js` + `MailLog` pattern if wanted later.
- External (Contactbook-only, no login) contacts still can't be assigned as a monitored signer — only real internal accounts.
