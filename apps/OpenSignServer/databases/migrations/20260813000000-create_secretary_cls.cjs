/**
 *
 * @param {Parse} Parse
 */
exports.up = async Parse => {
  const schema = new Parse.Schema('contracts_Secretary');
  schema.addPointer('SecretaryUserId', 'contracts_Users');
  schema.addPointer('SignerUserId', 'contracts_Users');
  schema.addPointer('TenantId', 'partners_Tenant');
  schema.addBoolean('IsActive');
  schema.addPointer('CreatedBy', '_User');
  await schema.save();
};

/**
 *
 * @param {Parse} Parse
 */
exports.down = async Parse => {
  const schema = new Parse.Schema('contracts_Secretary');
  return schema.purge().then(() => schema.delete());
};
