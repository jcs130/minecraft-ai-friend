import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { skillMirrorUrl } from './download-mirror.mjs';

const originalSkill = Object.freeze({ version: '1.0.0', filename: 'qiandengji-agent-1.0.0.zip', bytes: 2705570,
  sha256: '3d1676e86f31396071866c64ce87d9e6820e1530b755c4221f04c22a15f94669',
  url: '/downloads/qiandengji-agent-1.0.0.zip', sourceCommit: 'abdf06fb2fe353698f02521f0f63bef902e18e4c' });
const previousSkill = Object.freeze({ version: '1.1.0', filename: 'qiandengji-agent-1.1.0.zip', bytes: 2782362,
  sha256: '6a1be95fa174e37c330a756ffdbc32f0924254099390d1fc99a236c451d8fe7d',
  url: '/downloads/qiandengji-agent-1.1.0.zip', sdkSourceCommit: originalSkill.sourceCommit });
const priorSkill120 = Object.freeze({"version": "1.2.0", "filename": "qiandengji-agent-1.2.0.zip", "bytes": 3867516, "sha256": "a0618f8c2d75a71d42ca532973a43f7d837e91ee47707a7ce9de2d9167cf858b", "url": "/downloads/qiandengji-agent-1.2.0.zip", "sdkVersion": "0.5.7-rc.67", "sdkSourceCommit": "aff5bb8ef25ce24c76efb7d608c1eea8da9fc129", "sourceUrl": "https://github.com/jcs130/minecraft-ai-friend/tree/main/packages/agent-mc-world", "channel": "github-main-candidate", "viewerIncluded": false});
const priorSkill121 = Object.freeze({"version": "1.2.1", "filename": "qiandengji-agent-1.2.1.zip", "bytes": 3903081, "sha256": "1c3c57962babb47fd2ca2100b12e1d941949e85e6774b63b5cbd1a874e435c66", "url": "/downloads/qiandengji-agent-1.2.1.zip", "sdkVersion": "0.5.7-rc.71", "sdkSourceCommit": "e399b276fdd5bada4848d0ad2f047611f3bdae7d", "sourceUrl": "https://github.com/jcs130/minecraft-ai-friend/tree/main/packages/agent-mc-world", "channel": "github-main-candidate", "viewerIncluded": false});
const priorSkill130 = Object.freeze({"version": "1.3.0", "filename": "qiandengji-agent-1.3.0.zip", "bytes": 4076891, "sha256": "4a796785a388d22022428a43d4d2c5873b53d9b9569dfc15a5cef7d290ae3f27", "url": "/downloads/qiandengji-agent-1.3.0.zip", "sdkVersion": "0.5.7-rc.90", "sdkSourceCommit": "79b30f982739ca276b28ae7e59655eb6ca9990d1", "sourceUrl": "https://github.com/jcs130/minecraft-ai-friend/tree/main/packages/agent-mc-world", "channel": "github-main-candidate", "viewerIncluded": false});
const priorSkill131 = Object.freeze({"version": "1.3.1", "filename": "qiandengji-agent-1.3.1.zip", "bytes": 4077125, "sha256": "034046f6dd9926067b89b8f4ff004180882df223b393b43d68729ab383c0c272", "url": "/downloads/qiandengji-agent-1.3.1.zip", "sdkVersion": "0.5.7-rc.90", "sdkSourceCommit": "79b30f982739ca276b28ae7e59655eb6ca9990d1", "sourceUrl": "https://github.com/jcs130/minecraft-ai-friend/tree/main/packages/agent-mc-world", "channel": "github-main-candidate", "viewerIncluded": false});
const priorSkill132 = Object.freeze({"version": "1.3.2", "filename": "qiandengji-agent-1.3.2.zip", "bytes": 4085052, "sha256": "f9482d6dcbfa4c125a5924f703577de1992a9af2a64519113f71fdc409915813", "url": "/downloads/qiandengji-agent-1.3.2.zip", "sdkVersion": "0.5.7-rc.90", "sdkSourceCommit": "79b30f982739ca276b28ae7e59655eb6ca9990d1", "sourceUrl": "https://github.com/jcs130/minecraft-ai-friend/tree/main/packages/agent-mc-world", "channel": "github-main-candidate", "viewerIncluded": false});
const priorSkill133 = Object.freeze({"version": "1.3.3", "filename": "qiandengji-agent-1.3.3.zip", "bytes": 4096940, "sha256": "b00e5c9f8a5bc59d291cb18a93eeb3f63e86f5322d682f9990f5f4a0a9576f4f", "url": "/downloads/qiandengji-agent-1.3.3.zip", "sdkVersion": "0.5.7-rc.95", "sdkSourceCommit": "d21f036d72f6ae8aa07083d6981627c49886efc1", "sourceUrl": "https://github.com/jcs130/minecraft-ai-friend/tree/main/packages/agent-mc-world", "channel": "github-main-candidate", "viewerIncluded": false});
const priorSkill134 = Object.freeze({"version": "1.3.4", "filename": "qiandengji-agent-1.3.4.zip", "bytes": 4283990, "sha256": "44117277f1fa41209be05fd01f1dc9c99d92dbaead2943121d8184b593a7b235", "url": "/downloads/qiandengji-agent-1.3.4.zip", "sdkVersion": "0.5.7-rc.130", "sdkSourceCommit": "bca0abf761625b6109e692f4d864cfae85dd6810", "sourceUrl": "https://github.com/jcs130/minecraft-ai-friend/tree/main/packages/agent-mc-world", "channel": "github-main-candidate", "viewerIncluded": false});
const priorSkill135 = Object.freeze({"version": "1.3.5", "filename": "qiandengji-agent-1.3.5.zip", "bytes": 4289864, "sha256": "d257fe047457a45150e28409e48e6a107233fc591ff4ff4135c9189074f6b0f9", "url": "/downloads/qiandengji-agent-1.3.5.zip", "sdkVersion": "0.5.7-rc.130", "sdkSourceCommit": "bca0abf761625b6109e692f4d864cfae85dd6810", "sourceUrl": "https://github.com/jcs130/minecraft-ai-friend/tree/main/packages/agent-mc-world", "channel": "github-main-candidate", "viewerIncluded": false});
export const agentSkill = Object.freeze({"version": "1.3.6", "filename": "qiandengji-agent-1.3.6.zip", "bytes": 4289862, "sha256": "ea519eaa49b3f09828708eb86e57b2bf32e351a86a888e0e1abd0cda38e536cf", "url": "/downloads/qiandengji-agent-1.3.6.zip", "sdkVersion": "0.5.7-rc.130", "sdkSourceCommit": "bca0abf761625b6109e692f4d864cfae85dd6810", "sourceUrl": "https://github.com/jcs130/minecraft-ai-friend/tree/main/packages/agent-mc-world", "channel": "github-main-candidate", "viewerIncluded": false});
export const reviewedSkills = Object.freeze([agentSkill, priorSkill135, priorSkill134, priorSkill133, priorSkill132, priorSkill131, priorSkill130, priorSkill121, priorSkill120, previousSkill, originalSkill]);
export const skillAt = url => url==='/downloads/agent-skill'?agentSkill:reviewedSkills.find(release => release.url === url);
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
