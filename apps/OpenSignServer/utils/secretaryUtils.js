// Shared helpers for the secretary-delegation feature. These re-verify the
// secretary relationship server-side on every call - this is the actual
// access-control boundary, not just something the client UI enforces.

// Throws unless `secretaryUserObj` (a contracts_Users Parse.Object) has an
// active contracts_Secretary row for `signerUserId`. Returns the resolved
// signer contracts_Users object on success.
export async function requireActiveSecretaryLink(secretaryUserObj, signerUserId) {
  if (!signerUserId) {
    throw new Parse.Error(Parse.Error.INVALID_QUERY, 'Please provide signerUserId.');
  }
  const signerQuery = new Parse.Query('contracts_Users');
  const signerUser = await signerQuery.get(signerUserId, { useMasterKey: true }).catch(() => null);
  if (!signerUser) {
    throw new Parse.Error(Parse.Error.OBJECT_NOT_FOUND, 'Signer not found.');
  }

  const linkQuery = new Parse.Query('contracts_Secretary');
  linkQuery.equalTo('SecretaryUserId', secretaryUserObj);
  linkQuery.equalTo('SignerUserId', signerUser);
  linkQuery.equalTo('IsActive', true);
  const link = await linkQuery.first({ useMasterKey: true });
  if (!link) {
    throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, 'No active secretary assignment for this signer.');
  }
  return signerUser;
}

// A signer may have more than one contracts_Contactbook row (one gets
// auto-created per sender by linkContactToDoc.js's saveRoleContact()) -
// this returns all of them, since contracts_Document.Signers/AuditTrail
// reference Contactbook rows, never contracts_Users directly.
export async function getSignerContactRows(signerUser) {
  const signerUserPtr = signerUser.get('UserId'); // pointer to _User
  if (!signerUserPtr) return [];
  const contactQuery = new Parse.Query('contracts_Contactbook');
  contactQuery.equalTo('UserId', signerUserPtr);
  contactQuery.limit(200);
  return contactQuery.find({ useMasterKey: true });
}
