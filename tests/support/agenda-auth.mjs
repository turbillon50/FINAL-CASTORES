export async function resolveAuthedUser(req) {
  return req.authUser || null;
}
