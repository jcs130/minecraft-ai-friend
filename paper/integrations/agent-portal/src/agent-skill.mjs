import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { skillMirrorUrl } from './download-mirror.mjs';

export const agentSkill = Object.freeze({"version": "1.3.12", "filename": "qiandengji-agent-1.3.12.zip", "bytes": 5086352, "sha256": "c106d94c22296b3d6b9b6538ccd9a040af1ebb3e257afbcc0bde60f8aee4ed25", "url": "/downloads/qiandengji-agent-1.3.12.zip", "sdkVersion": "0.5.7-rc.160-preview.102", "sdkSourceCommit": "1c2705a1f845bde490f4824313237125db742ee1", "sourceUrl": "https://github.com/jcs130/minecraft-ai-friend/tree/main/packages/agent-mc-world", "channel": "github-main-candidate", "viewerIncluded": false});
export const reviewedSkills = Object.freeze([agentSkill]);
export const skillAt = url => url === '/downloads/agent-skill' || url === agentSkill.url ? agentSkill : undefined;
const releases = new Map();

// Only known pinned releases, not an arbitrary filesystem download endpoint.
export async function serveAgentSkill(req, res, config, release = agentSkill) {
  const file = path.join(config.publicDir, 'downloads', release.filename);
  if (!releases.has(file)) releases.set(file, (async () => {
    const stat = await fs.stat(file);
    if (!stat.isFile() || stat.size !== release.bytes) throw Error('Invalid Agent skill release');
    const bytes = await fs.readFile(file);
    if (createHash('sha256').update(bytes).digest('hex') !== release.sha256) throw Error('Agent skill release checksum mismatch');
    return bytes;
  })());
  const bytes = await releases.get(file);
  const mirror = skillMirrorUrl(config, release);
  if (mirror) {
    // Keep the original website link and reviewed digest stable. The browser
    // downloads directly from OSS, without this server relaying the file.
    res.writeHead(307, { Location: mirror, 'Content-Length': '0', 'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer', 'X-Checksum-Sha256': release.sha256 });
    return res.end();
  }
    res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Length': bytes.length,
      'Content-Disposition': `attachment; filename="${release.filename}"`, ETag: `"${release.sha256}"`, 'Cache-Control': 'public, max-age=86400' });
    res.end(req.method === 'HEAD' ? undefined : bytes);
}
