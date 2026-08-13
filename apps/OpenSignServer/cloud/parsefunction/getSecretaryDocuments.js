import { requireActiveSecretaryLink, getSignerContactRows } from '../../utils/secretaryUtils.js';
import { COMPLETION_ACTIVITIES } from '../../utils/workflowUtils.js';

// `getSecretaryDocuments` - lightweight list of a signer's incoming
// documents (name/status/date only, no file content) for a caller who has
// an active contracts_Secretary assignment for that signer. Re-verifies
// the assignment itself rather than trusting the client's picker.
export default async function getSecretaryDocuments(request) {
  if (!request.user) {
    throw new Parse.Error(Parse.Error.INVALID_SESSION_TOKEN, 'User is not authenticated.');
  }

  const meQuery = new Parse.Query('contracts_Users');
  meQuery.equalTo('UserId', request.user);
  const me = await meQuery.first({ useMasterKey: true });
  if (!me) {
    throw new Parse.Error(Parse.Error.OBJECT_NOT_FOUND, 'User profile not found.');
  }

  const signerUser = await requireActiveSecretaryLink(me, request.params.signerUserId);
  const contactRows = await getSignerContactRows(signerUser);
  if (contactRows.length === 0) {
    return { documents: [] };
  }
  const contactIds = new Set(contactRows.map(c => c.id));

  const docQuery = new Parse.Query('contracts_Document');
  docQuery.containedIn('Signers', contactRows);
  docQuery.notEqualTo('IsArchive', true);
  docQuery.descending('createdAt');
  docQuery.limit(200);
  const docs = await docQuery.find({ useMasterKey: true });

  const documents = docs.map(doc => {
    const d = doc.toJSON();
    const auditTrail = Array.isArray(d.AuditTrail) ? d.AuditTrail : [];
    const signed = auditTrail.some(
      a => contactIds.has(a?.UserPtr?.objectId) && COMPLETION_ACTIVITIES.includes(a?.Activity)
    );
    return {
      objectId: d.objectId,
      name: d.Name,
      status: d.IsDeclined ? 'Declined' : signed ? 'Signed' : 'Pending',
      sentAt: d.DocSentAt || d.createdAt,
    };
  });

  return { documents };
}
