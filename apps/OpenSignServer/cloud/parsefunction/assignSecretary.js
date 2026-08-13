// `assignSecretary` lets an Admin/OrgAdmin grant a "secretary" (another
// internal org member) read-only visibility into a signer's incoming
// documents. Both accounts must already exist as contracts_Users in the
// admin's own tenant. Re-assigning an existing (inactive) pair reactivates
// it instead of creating a duplicate row.
export default async function assignSecretary(request) {
  const secretaryEmail = (request.params.secretaryEmail || '').trim().toLowerCase();
  const signerEmail = (request.params.signerEmail || '').trim().toLowerCase();

  if (!secretaryEmail || !signerEmail) {
    throw new Parse.Error(Parse.Error.INVALID_QUERY, 'Please provide secretaryEmail and signerEmail.');
  }
  if (secretaryEmail === signerEmail) {
    throw new Parse.Error(Parse.Error.INVALID_QUERY, 'A user cannot be their own secretary.');
  }
  if (!request.user) {
    throw new Parse.Error(Parse.Error.INVALID_SESSION_TOKEN, 'User is not authenticated.');
  }

  const adminUserQuery = new Parse.Query('contracts_Users');
  adminUserQuery.equalTo('UserId', request.user);
  const adminUser = await adminUserQuery.first({ useMasterKey: true });
  const isAdmin =
    adminUser?.get('UserRole') === 'contracts_Admin' || adminUser?.get('UserRole') === 'contracts_OrgAdmin';
  if (!isAdmin) {
    throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, 'Unauthorized.');
  }
  const tenantId = adminUser.get('TenantId');

  const secretaryQuery = new Parse.Query('contracts_Users');
  secretaryQuery.equalTo('Email', secretaryEmail);
  if (tenantId) secretaryQuery.equalTo('TenantId', tenantId);
  const secretaryUser = await secretaryQuery.first({ useMasterKey: true });
  if (!secretaryUser) {
    throw new Parse.Error(Parse.Error.OBJECT_NOT_FOUND, 'Secretary email not found in this organization.');
  }

  const signerQuery = new Parse.Query('contracts_Users');
  signerQuery.equalTo('Email', signerEmail);
  if (tenantId) signerQuery.equalTo('TenantId', tenantId);
  const signerUser = await signerQuery.first({ useMasterKey: true });
  if (!signerUser) {
    throw new Parse.Error(Parse.Error.OBJECT_NOT_FOUND, 'Signer email not found in this organization.');
  }

  const existingQuery = new Parse.Query('contracts_Secretary');
  existingQuery.equalTo('SecretaryUserId', secretaryUser);
  existingQuery.equalTo('SignerUserId', signerUser);
  const existing = await existingQuery.first({ useMasterKey: true });

  if (existing) {
    existing.set('IsActive', true);
    await existing.save(null, { useMasterKey: true });
    return { status: 'success', objectId: existing.id, reactivated: true };
  }

  const Secretary = Parse.Object.extend('contracts_Secretary');
  const assignment = new Secretary();
  assignment.set('SecretaryUserId', secretaryUser);
  assignment.set('SignerUserId', signerUser);
  assignment.set('TenantId', tenantId);
  assignment.set('IsActive', true);
  assignment.set('CreatedBy', request.user);
  await assignment.save(null, { useMasterKey: true });

  return { status: 'success', objectId: assignment.id, reactivated: false };
}
