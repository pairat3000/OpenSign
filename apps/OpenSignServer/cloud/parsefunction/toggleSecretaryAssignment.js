// `toggleSecretaryAssignment` flips (or explicitly sets) IsActive and/or
// CanViewContent on a contracts_Secretary row. This is the only way to
// revoke access - there is no delete endpoint, so assignment history is
// preserved.
//
// Two-tier permission model: IsActive gates seeing the signer's document
// list/status; CanViewContent (a strict subset of IsActive) additionally
// gates opening a document's actual content. Content access without list
// access makes no sense, so it's enforced both ways here: turning IsActive
// off always cascades CanViewContent off too, and turning CanViewContent on
// while IsActive is (or would remain) off is rejected outright.
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

  const isActiveGiven = typeof request.params.isActive === 'boolean';
  const canViewContentGiven = typeof request.params.canViewContent === 'boolean';

  let nextIsActive = isActiveGiven ? request.params.isActive : assignment.get('IsActive');
  let nextCanViewContent = canViewContentGiven
    ? request.params.canViewContent
    : !!assignment.get('CanViewContent');

  // Preserve old flip-with-no-params behavior when neither field is given.
  if (!isActiveGiven && !canViewContentGiven) {
    nextIsActive = !assignment.get('IsActive');
  }

  if (canViewContentGiven && nextCanViewContent && !nextIsActive) {
    throw new Parse.Error(
      Parse.Error.OPERATION_FORBIDDEN,
      'ต้องเปิดสิทธิ์ดูรายการเอกสารก่อนจึงจะเปิดสิทธิ์ดูเนื้อหาได้'
    );
  }
  if (!nextIsActive) {
    nextCanViewContent = false;
  }

  assignment.set('IsActive', nextIsActive);
  assignment.set('CanViewContent', nextCanViewContent);
  await assignment.save(null, { useMasterKey: true });

  return { status: 'success', isActive: nextIsActive, canViewContent: nextCanViewContent };
}
