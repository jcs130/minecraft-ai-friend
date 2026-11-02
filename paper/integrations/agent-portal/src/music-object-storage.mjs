import { privateObjectClient } from './private-object-client.mjs';

export function createMusicObjectStorage(config, options = {}) {
  if (!config?.enabled) return null;
  const client = privateObjectClient(config, options);
  const key = id => {
    // Opaque, server-issued per-upload key. It is NOT a caller's content digest;
    // bad uploads cannot poison an asset used by another work or photo scene.
    if (!/^[a-f0-9]{64}$/.test(id)) throw Error('MUSIC_OBJECT_KEY');
    return config.prefix + 'assets/' + id;
  };
  return {
    origin: `https://${config.bucket}.${config.region}.aliyuncs.com`,
    async prepare(binding) {
      const oss = await client(), name = key(binding.objectId);
      const headers = { 'Content-Type': binding.mime, 'x-oss-object-acl': 'private', 'x-oss-forbid-overwrite': 'true', 'x-oss-meta-sha256': binding.sha256 };
      return { uploadUrl: await oss.asyncSignatureUrl(name, { method: 'PUT', expires: 300, ...headers }), headers, expiresInSeconds: 300 };
    },
    async head(binding) {
      try {
        const { res } = await (await client()).head(key(binding.objectId));
        return { bytes: Number(res.headers['content-length']), etag: res.headers.etag, sha256: res.headers['x-oss-meta-sha256'] };
      } catch (error) { if (error.code === 'NoSuchKey') return null; throw error; }
    },
    async open(binding, etag) {
      return (await (await client()).getStream(key(binding.objectId), { headers: { 'If-Match': etag } })).stream;
    },
    async playback(binding) {
      const oss = await client();
      // Full songs need seeking long after the initial request. The stable app
      // route can refresh a URL, but never caches it or exposes a private object.
      // OSS forbids response-content-type (0017-00000902); the verified upload
      // already stores the audio MIME on the object itself.
      return oss.asyncSignatureUrl(key(binding.objectId), { expires: 3600, response: {
        'content-disposition': `inline; filename="song.${binding.extension}"`, 'cache-control': 'private, no-store',
      } });
    },
  };
}
