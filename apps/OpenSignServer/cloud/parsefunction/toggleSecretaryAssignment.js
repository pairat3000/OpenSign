// `toggleSecretaryAssignment` flips (or explicitly sets) IsActive on a
// contracts_Secretary row. This is the only way to revoke access - there is
// no delete endpoint, so assignment history is preserved.
export default async function toggleSecretaryAssignment(request) {
  const assignmentId = request.params.assignmentId;
  if (!assignmentId) {
    throw new Parse.Error(Parse.Error.INVALID_QUERY, 'Please provide assignmentId.');
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

  const query = new Parse.Query('contracts_Secretary');
  query.equalTo('objectId', assignmentId);
  if (tenantId) query.equalTo('TenantId', tenantId);
  const assignment = await query.first({ useMasterKey: true });
  if (!assignment) {
    throw new Parse.Error(Parse.Error.OBJECT_NOT_FOUND, 'Assignment not found.');
  }

  const nextValue =
    typeof request.params.isActive === 'boolean' ? request.params.isActive : !assignment.get('IsActive');
  assignment.set('IsActive', nextValue);
  await assignment.save(null, { useMasterKey: true });

  return { status: 'success', isActive: nextValue };
}
