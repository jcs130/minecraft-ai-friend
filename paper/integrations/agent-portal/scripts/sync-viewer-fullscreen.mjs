import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { projectRoot } from '../src/config.mjs';
import path from 'node:path';

// Reproduce the classic-script export from a reviewed shared-viewer commit.
const [repository, commit] = process.argv.slice(2);
if (!repository || !/^[a-f0-9]{40}$/.test(commit ?? '')) throw Error('Usage: node scripts/sync-viewer-fullscreen.mjs <viewer-repository> <commit>');
const sourcePath = 'packages/modern-viewer/renderer-src/src/modern-viewer/viewer-fullscreen.js';
const source = execFileSync('git', ['-C', repository, 'show', `${commit}:${sourcePath}`], { encoding: 'utf8' });
if ((source.match(/export function installViewerFullscreen/g) ?? []).length !== 1) throw Error('Shared fullscreen export changed; review before updating');
const output = source.replace('export function installViewerFullscreen', 'function installViewerFullscreen') + '\nwindow.QdViewerFullscreen = { install: installViewerFullscreen };\n';
const sha = text => createHash('sha256').update(text).digest('hex');
await writeFile(path.join(projectRoot, 'public/viewer-fullscreen.js'), output);
await writeFile(path.join(projectRoot, 'public/viewer-fullscreen.source.json'), JSON.stringify({
  repository: 'https://github.com/jcs130/mc-visual-console', commit, sourcePath,
  sourceSha256: sha(source), outputSha256: sha(output),
  transform: 'classic-script-global-v1'
}, null, 2) + '\n');
