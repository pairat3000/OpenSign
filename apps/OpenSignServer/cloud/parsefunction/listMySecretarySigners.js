// `listMySecretarySigners` returns the internal org members the CURRENT
// user currently has active secretary access to. Any authenticated user
// can call this - it just returns an empty list if they have no active
// assignments.
export default async function listMySecretarySigners(request) {
  if (!request.user) {
    throw new Parse.Error(Parse.Error.INVALID_SESSION_TOKEN, 'User is not authenticated.');
  }

  const meQuery = new Parse.Query('contracts_Users');
  meQuery.equalTo('UserId', request.user);
  const me = await meQuery.first({ useMasterKey: true });
  if (!me) {
    return { signers: [] };
  }

  const query = new Parse.Query('contracts_Secretary');
  query.equalTo('SecretaryUserId', me);
  query.equalTo('IsActive', true);
  query.include('SignerUserId');
  query.limit(200);
  const rows = await query.find({ useMasterKey: true });

  const signers = rows
    .map(row => row.get('SignerUserId'))
    .filter(Boolean)
    .map(signer => ({
      objectId: signer.id,
      name: signer.get('Name'),
      email: signer.get('Email'),
    }));

  return { signers };
}
