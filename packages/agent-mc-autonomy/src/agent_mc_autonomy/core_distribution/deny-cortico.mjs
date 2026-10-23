export async function resolve(specifier, context, nextResolve) {
  if (/^cortico(?:\/|$)/.test(specifier) || specifier.includes('/integrations/qiandengji/')) {
    throw new Error('OFFLINE_CHECK_CORTICO_OR_SERVER_POLICY_FORBIDDEN');
  }
  return nextResolve(specifier, context);
}
