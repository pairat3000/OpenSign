exports.up = async Parse => {
  const schema = new Parse.Schema('contracts_Secretary');
  schema.addBoolean('CanViewContent');
  return schema.update();
};

exports.down = async Parse => {
  const schema = new Parse.Schema('contracts_Secretary');
  schema.deleteField('CanViewContent');
  return schema.update();
};
