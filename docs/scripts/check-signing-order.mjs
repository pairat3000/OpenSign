// Standalone diagnostic for the "signing order corrupted" bug class.
// See ../2026-09-signing-order-bug-patch-for-other-production.md for the
// full write-up. No dependency on any admin UI/cloud function - just Node +
// the `mongodb` driver, run directly against a production MongoDB.
//
// Usage:
//   MONGODB_URI="mongodb://user:pass@host:port/YOUR_DB_NAME" node check-signing-order.mjs
//
// npm i mongodb   (if not already available)

import { MongoClient } from 'mongodb';

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/YOUR_DB_NAME';

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

    // 2. Signed-out-of-current-array-order tripwire (only catches drift that
    // happens while the strict-order gate is actively enforcing - won't
    // catch corruption that occurred entirely before any signing started).
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
