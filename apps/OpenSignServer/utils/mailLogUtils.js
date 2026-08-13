import axios from 'axios';
import { cloudServerUrl, serverAppId } from '../Utils.js';

const headers = {
  'Content-Type': 'application/json',
  'X-Parse-Application-Id': serverAppId,
  'X-Parse-Master-Key': process.env.MASTER_KEY,
};

// Appends one entry to contracts_Document.MailLog via Parse's atomic array
// Add op, so concurrent sends never clobber each other (no read-modify-write
// needed, unlike AuditTrail/Comments which need the prior value to decide
// other logic). `docId` is optional - callers that aren't sending mail on
// behalf of a specific document (e.g. a generic admin-composed email) just
// skip logging.
export async function logMailAttempt(docId, { recipient, purpose, status, error }) {
  if (!docId) return;
  try {
    const entry = {
      Recipient: recipient || '',
      Purpose: purpose || 'unknown',
      Status: status,
      ErrorMessage: error || '',
      SentAt: new Date().toISOString(),
    };
    await axios.put(
      `${cloudServerUrl}/classes/contracts_Document/${docId}`,
      { MailLog: { __op: 'Add', objects: [entry] } },
      { headers }
    );
  } catch (err) {
    console.log('err in logMailAttempt', err?.message || err);
  }
}
