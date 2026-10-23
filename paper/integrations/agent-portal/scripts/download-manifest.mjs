import { parseArgs } from 'node:util';
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { reviewedSkills } from '../src/agent-skill.mjs';
import { downloadBaseUrl, skillMirrorUrl } from '../src/download-mirror.mjs';
import { packageReleases } from '../src/download-catalog.mjs';

// Read-only preparation. It cannot upload files, open cloud credentials or
// publish a directory; only explicitly reviewed public releases are eligible.
const { values } = parseArgs({ options: { 'base-url': { type: 'string' },
  'include-packages': { type: 'boolean', default: false }, 'package-directory': { type: 'string' } } });
const baseUrl = downloadBaseUrl(values['base-url']);
if (!baseUrl) throw new Error('Provide --base-url https://your-bucket.oss-region.aliyuncs.com/qiandengji/skills/');
const objects = [];
const selected = reviewedSkills.map(release => ({ release, file: new URL('../public/downloads/' + release.filename, import.meta.url) }));
if (values['include-packages']) {
  if (!values['package-directory']) throw new Error('Provide the directory containing the exact reviewed upstream files');
  const directory = await fs.realpath(values['package-directory']);
  for (const release of packageReleases) selected.push({ release, file: path.join(directory, release.filename) });
}
for (const { release, file } of selected) {
  const stat = await fs.stat(file), hash = createHash('sha256');
  if (!stat.isFile() || stat.size !== release.bytes) throw new Error('Reviewed release size mismatch');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  if (hash.digest('hex') !== release.sha256) throw new Error('Reviewed release checksum mismatch');
  objects.push({ filename: release.filename, bytes: release.bytes, sha256: release.sha256,
    suffix: release.sha256 + '/' + release.filename, url: skillMirrorUrl({ downloads: { baseUrl } }, release),
    contentType: release.filename.endsWith('.tgz') ? 'application/gzip' : release.filename.endsWith('.zip') ? 'application/zip' : 'application/octet-stream', contentDisposition: `attachment; filename="${release.filename}"`,
    cacheControl: 'public, max-age=31536000, immutable' });
}
console.log(JSON.stringify({ dryRun: true, baseUrl, objects }, null, 2));
