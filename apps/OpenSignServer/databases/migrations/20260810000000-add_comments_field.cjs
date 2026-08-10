/**
 *
 * @param {Parse} Parse
 */
exports.up = async Parse => {
  const docSchema = new Parse.Schema('contracts_Document');
  docSchema.addArray('Comments');
  docSchema.addNumber('CommentsPagesCount');
  await docSchema.update();
};

/**
 *
 * @param {Parse} Parse
 */
exports.down = async Parse => {
  const docSchema = new Parse.Schema('contracts_Document');
  docSchema.deleteField('Comments');
  docSchema.deleteField('CommentsPagesCount');
  await docSchema.update();
};
