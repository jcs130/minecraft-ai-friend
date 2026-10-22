import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

const originalSkill = Object.freeze({ version: '1.0.0', filename: 'qiandengji-agent-1.0.0.zip', bytes: 2705570,
  sha256: '3d1676e86f31396071866c64ce87d9e6820e1530b755c4221f04c22a15f94669',
  url: '/downloads/qiandengji-agent-1.0.0.zip', sourceCommit: 'abdf06fb2fe353698f02521f0f63bef902e18e4c' });
export const agentSkill = Object.freeze({ version: '1.1.0', filename: 'qiandengji-agent-1.1.0.zip', bytes: 2782362,
  sha256: '6a1be95fa174e37c330a756ffdbc32f0924254099390d1fc99a236c451d8fe7d',
  url: '/downloads/qiandengji-agent-1.1.0.zip', sdkSourceCommit: originalSkill.sourceCommit });
export const skillAt = url => [agentSkill, originalSkill].find(release => release.url === url);
const releases = new Map();

// A single pinned release, not an arbitrary filesystem download endpoint.
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
    res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Length': bytes.length,
      'Content-Disposition': `attachment; filename="${release.filename}"`, ETag: `"${release.sha256}"`, 'Cache-Control': 'public, max-age=86400' });
    res.end(req.method === 'HEAD' ? undefined : bytes);
}
