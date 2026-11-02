// Shared with photo scenes: temporary credentials from the existing ECS role.
// Never persist credentials or signed URLs in a work, log, or request ledger.
export function privateObjectClient(config, { clientFactory } = {}) {
  if (!/^[-a-z0-9]{3,63}$/.test(config?.bucket ?? '') || !/^oss-[a-z0-9-]+$/.test(config?.region ?? '')
    || !/^[-A-Za-z0-9_]{1,64}$/.test(config?.roleName ?? '') || !/^[-a-z0-9/]+\/$/.test(config?.prefix ?? '') || config.prefix.includes('..')) throw Error('SCENE_OBJECT_STORAGE_CONFIGURATION');
  let promise;
  return () => promise ??= Promise.resolve().then(async () => {
    if (clientFactory) return clientFactory();
    const [{ default: OSS }, Credential] = await Promise.all([import('ali-oss'), import('@alicloud/credentials')]);
    const namespace = Credential.default, Config = Credential.Config ?? namespace.Config, Provider = namespace.default ?? namespace;
    const provider = new Provider(new Config({ type: 'ecs_ram_role', roleName: config.roleName }));
    const credentials = async () => { const value = await provider.getCredential(); return { accessKeyId: value.accessKeyId, accessKeySecret: value.accessKeySecret, stsToken: value.securityToken }; };
    return new OSS({ region: config.region, bucket: config.bucket, secure: true, timeout: 30000, ...await credentials(), refreshSTSTokenInterval: 0, refreshSTSToken: credentials });
  }).catch(error => { promise = null; throw error; });
}
