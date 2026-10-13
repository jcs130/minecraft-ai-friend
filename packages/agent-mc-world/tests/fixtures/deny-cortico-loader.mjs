export async function resolve(specifier, context, next) {
  if (specifier === 'cortico' || specifier.startsWith('cortico/')) throw new Error(`CORTICO_RUNTIME_FORBIDDEN: ${specifier}`);
  const result = await next(specifier, context);
  if (process.env.MINECRAFT_CLIENT_ONLY === '1' && (result.url.includes('/integrations/') || [
    '/src/world.ts', '/src/config.ts', '/src/agent/runtime.ts', '/src/mcp/config.ts',
    '/src/adapters/cortico.ts', '/src/skill-catalog.ts', '/src/server-guide.ts',
  ].some(path => result.url.endsWith(path)))) throw new Error(`SERVER_POLICY_FORBIDDEN: ${specifier}`);
  return result;
}
