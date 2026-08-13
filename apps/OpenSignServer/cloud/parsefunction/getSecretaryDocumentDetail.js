import { getSignerContactRows } from '../../utils/secretaryUtils.js';

// `getSecretaryDocumentDetail` returns a viewable URL for a document, but
// only if the caller currently has an active secretary assignment for that
// document's signer. Re-derives that from the caller's own active
// assignments rather than trusting a signerUserId passed by the client, so
// this check can't be tricked by mismatching docId/signerUserId params.
export default async function getSecretaryDocumentDetail(request) {
  const docId = request.params.docId;
  if (!docId) {
    throw new Parse.Error(Parse.Error.INVALID_QUERY, 'Please provide docId.');
  }
  if (!request.user) {
    throw new Parse.Error(Parse.Error.INVALID_SESSION_TOKEN, 'User is not authenticated.');
  }

  const meQuery = new Parse.Query('contracts_Users');
  meQuery.equalTo('UserId', request.user);
  const me = await meQuery.first({ useMasterKey: true });
  if (!me) {
    throw new Parse.Error(Parse.Error.OBJECT_NOT_FOUND, 'User profile not found.');
  }

  const docQuery = new Parse.Query('contracts_Document');
  const doc = await docQuery.get(docId, { useMasterKey: true }).catch(() => null);
  if (!doc) {
    throw new Parse.Error(Parse.Error.OBJECT_NOT_FOUND, 'Document not found.');
  }
  const docSignerContactIds = new Set((doc.get('Signers') || []).map(p => p.id));

  const linksQuery = new Parse.Query('contracts_Secretary');
  linksQuery.equalTo('SecretaryUserId', me);
  linksQuery.equalTo('IsActive', true);
  linksQuery.include('SignerUserId');
  const links = await linksQuery.find({ useMasterKey: true });

  let isAuthorized = false;
  for (const link of links) {
    const signerUser = link.get('SignerUserId');
    if (!signerUser) continue;
    const contactRows = await getSignerContactRows(signerUser);
    if (contactRows.some(c => docSignerContactIds.has(c.id))) {
      isAuthorized = true;
      break;
    }
  }
  if (!isAuthorized) {
    throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, 'No active secretary assignment for this document.');
  }

  return {
    objectId: doc.id,
    name: doc.get('Name'),
    url: doc.get('SignedUrl') || doc.get('URL'),
  };
}
