import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { projectRoot } from '../src/config.mjs';
import path from 'node:path';

test('portal fullscreen is the exact recorded shared helper with only its classic-script export changed', async () => {
  const manifest = JSON.parse(await readFile(path.join(projectRoot, 'public/viewer-fullscreen.source.json'), 'utf8'));
  const output = await readFile(path.join(projectRoot, 'public/viewer-fullscreen.js'), 'utf8');
  const suffix = '\nwindow.QdViewerFullscreen = { install: installViewerFullscreen };\n';
  assert.equal(manifest.repository, 'https://github.com/jcs130/mc-visual-console');
  assert.match(manifest.commit, /^[a-f0-9]{40}$/);
  assert.ok(output.endsWith(suffix));
  const source = output.slice(0, -suffix.length).replace('function installViewerFullscreen', 'export function installViewerFullscreen');
  const sha = text => createHash('sha256').update(text).digest('hex');
  assert.equal(sha(source), manifest.sourceSha256);
  assert.equal(sha(output), manifest.outputSha256);
});
