// `listSecretaryAssignments` returns every secretary/signer assignment in
// the calling admin's tenant, for the admin management table (including
// inactive ones, so the admin can see and re-toggle them).
export default async function listSecretaryAssignments(request) {
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

  const query = new Parse.Query('contracts_Secretary');
  if (tenantId) query.equalTo('TenantId', tenantId);
  query.include('SecretaryUserId');
  query.include('SignerUserId');
  query.descending('createdAt');
  query.limit(200);
  const rows = await query.find({ useMasterKey: true });

  const assignments = rows.map(row => {
    const r = row.toJSON();
    return {
      objectId: r.objectId,
      isActive: !!r.IsActive,
      createdAt: r.createdAt,
      secretary: { name: r.SecretaryUserId?.Name, email: r.SecretaryUserId?.Email },
      signer: { name: r.SignerUserId?.Name, email: r.SignerUserId?.Email },
    };
  });

  return { assignments };
}
