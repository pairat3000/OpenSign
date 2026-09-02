# Patch package — signing order corruption ("position 5 signed at position 3")

**For:** a separate OpenSign-based production codebase (not this repo) that hit this bug for real.
**Purpose:** portable enough to apply to a different fork — no line numbers assumed, only concepts and code shape. Adapt file/variable names to match that codebase.

---

## 1. Root cause (read this first)

In OpenSign's data model, a document's signer order is **not** a separate field — it is literally each signer's **array index** inside `contracts_Document.Placeholders`. Whatever position a signer's `{ signerObjId, placeHolder: [...] }` entry sits at in that array is what "Send in order" enforces against, via something functionally equivalent to:

```js
// Locate a placeholder index by signerObjId.
function findPlaceholderIndex(placeholders, signerObjId) {
  return placeholders.findIndex(
    p => (p?.signerObjId || p?.signerPtr?.objectId) === signerObjId && p?.Role !== 'prefill'
  );
}

// Strict-order gate: is anyone *before* idx still unsigned?
function findPendingPriorSigner(placeholders, idx, auditTrail) {
  for (let i = 0; i < idx; i++) {
    const ph = placeholders[i];
    if (ph?.Role === 'prefill') continue;
    const signerObjId = ph?.signerObjId || ph?.signerPtr?.objectId;
    const acted = auditTrail.some(a => a?.UserPtr?.objectId === signerObjId && a?.Activity === 'Signed');
    if (!acted) return signerObjId;
  }
  return null;
}
```

This check itself is correct — the bug is **upstream of it**: something mutates the `Placeholders` array in a way that changes a signer's index without the admin intending to reorder anyone.

**Confirmed culprit in this fork's codebase** (`apps/OpenSign/src/pages/PlaceHolderSign.jsx`, the "Request Signatures" placeholder-editor page): its widget-delete handler, in the branch that handles *"the signer's last widget on the current page was just deleted, but they still have widgets on other pages,"* updated state like this:

```js
// BUGGY — moves the signer to the END of the array
const newUpdatePos = filterSignerPos.map(obj =>
  obj.Id === Id ? { ...obj, placeHolder: getRemainPage } : obj
);
let signerupdate = signerPos.filter(data => data.Id !== Id); // <-- drops them out
signerupdate.push(newUpdatePos[0]);                            // <-- re-adds at the end
setSignerPos(signerupdate);
```

Because array position **is** signing order, this silently bumps that signer to last place, and shifts every signer originally after them **up one position each**. If this happens to two signers earlier in the list than the one the admin set as "5th," that signer ends up 3rd — exactly the reported symptom. It's triggered by a completely ordinary admin action (deleting one field on one page for a signer who has fields on multiple pages), not an edge case.

**The fix** — update the signer's entry **in place**, never filter-out-then-push:

```js
// FIXED — preserves array position (= signing order)
const newUpdatePos = filterSignerPos.map(obj =>
  obj.Id === Id ? { ...obj, placeHolder: getRemainPage } : obj
);
const signerIndex = signerPos.findIndex(data => data.Id === Id);
if (signerIndex !== -1) {
  const signerupdate = [...signerPos];
  signerupdate[signerIndex] = newUpdatePos[0];
  setSignerPos(signerupdate);
}
```

### How to find the equivalent code in a different fork

Search the signature-request creation/placeholder-editor page for the widget-delete function (often named `handleDeleteWidget` or similar) and look for **every** branch that reassigns the signers-array state (`setSignerPos`/`setPlaceholders`/equivalent). Any branch using `.filter(...).push(...)` or `[...arr.filter(...), updatedItem]` to "remove and re-add" a signer entry has this bug — order-preserving branches should always use `.map()` or `array[foundIndex] = updated` instead. In this fork there was a second, parallel implementation of the same delete logic (in a shared utils file) that had already fixed this exact case correctly — worth checking whether your codebase has more than one copy of this logic that could have drifted apart the same way.

## 2. Retroactive detection — what can and can't be recovered

Once a signer has been reordered and then actually signs, the system's own record of "order" (the array) is self-consistent with the *corrupted* sequence — there is no separate "originally intended order" stored anywhere to diff against. **A document that already finished signing out of its intended order cannot be reliably detected after the fact from data alone.** The only fully safe path for a document already affected is to treat it as suspect and re-create/re-send it, not to try to repair it in place.

What **is** retroactively detectable, as a related risk signal from the same bug class:

- **Duplicate `signerObjId` within `Placeholders`.** `findPlaceholderIndex` (via `.findIndex`) only ever resolves the *first* occurrence of a given signer — a second entry for the same signer elsewhere in the array is never checked by the strict-order gate. This is detectable at any time, doesn't require knowing prior state, and is a legitimate red flag on its own.
- **A document mid-flight where a later-array-position signer has signed while an earlier one hasn't**, for `SendinOrder` documents — this only catches drift that happens *while the strict-order gate is actively enforcing*, so it won't catch corruption that occurred entirely before any signing started (the reported case), but it's worth having as a general tripwire.

## 3. Standalone diagnostic script (run against the production MongoDB directly)

No dependency on any admin UI or cloud function existing in that codebase — just Node + the `mongodb` driver. Adjust `MONGODB_URI` (and the collection name, if it differs) and run with `node check-signing-order.mjs`.

```js
// check-signing-order.mjs
import { MongoClient } from 'mongodb';

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/YOUR_DB_NAME';

function findPlaceholderIndex(placeholders, signerObjId) {
  return placeholders.findIndex(
    p => (p?.signerObjId || p?.signerPtr?.objectId) === signerObjId && p?.Role !== 'prefill'
  );
}

async function main() {
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db = client.db();
  const docs = await db
    .collection('contracts_Document')
    .find({ SendinOrder: true })
    .project({ Name: 1, Placeholders: 1, AuditTrail: 1, IsCompleted: 1, IsDeclined: 1, CreatedBy: 1 })
    .toArray();

  console.log(`Scanning ${docs.length} Send-in-order documents...\n`);

  let flagged = 0;
  for (const doc of docs) {
    const placeholders = (doc.Placeholders || []).filter(p => p?.Role !== 'prefill');
    const auditTrail = doc.AuditTrail || [];
    const signedIds = new Set(
      auditTrail.filter(a => a?.Activity === 'Signed').map(a => a?.UserPtr?.objectId)
    );

    // 1. Duplicate signerObjId - findPlaceholderIndex only ever sees the first one.
    const seen = new Set();
    const dupes = [];
    for (const p of placeholders) {
      const id = p?.signerObjId || p?.signerPtr?.objectId;
      if (!id) continue;
      if (seen.has(id)) dupes.push(id);
      seen.add(id);
    }

    // 2. Signed-out-of-current-array-order tripwire.
    let sawUnsigned = false;
    let outOfOrder = false;
    for (const p of placeholders) {
      const id = p?.signerObjId || p?.signerPtr?.objectId;
      const signed = signedIds.has(id);
      if (!signed) sawUnsigned = true;
      else if (sawUnsigned) {
        outOfOrder = true;
        break;
      }
    }

    if (dupes.length > 0 || outOfOrder) {
      flagged++;
      console.log(`⚠️  ${doc._id}  "${doc.Name}"`);
      if (dupes.length > 0) console.log(`    duplicate signerObjId(s): ${dupes.join(', ')}`);
      if (outOfOrder) console.log(`    later signer signed while an earlier one is still pending`);
    }
  }

  console.log(`\n${flagged} of ${docs.length} Send-in-order documents flagged for review.`);
  await client.close();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
```

This is the same logic already added to this repo's `adminAuditDocuments.js`/Document Recheck tool, extracted to run standalone — no admin UI, no dependency on a `MailLog` field or any other feature that only exists in this repo's fork.

## 4. Recommended next steps for the production system

1. Apply the in-place-update fix from §1 to the equivalent widget-delete code.
2. Run the script in §3 against production to get a concrete list of at-risk documents.
3. For any flagged document that's still active (not yet completed): re-create and re-send it rather than trying to fix its `Placeholders` order in place — there's no reliable way to know the *correct* order to restore it to.
4. Optionally, if worth the investment: add an explicit stored field (e.g. `Placeholders[i].order` set once at creation and never mutated by widget edits) so the strict-order gate stops depending on array position at all — this would make the entire bug class structurally impossible, not just this one triggering code path.
