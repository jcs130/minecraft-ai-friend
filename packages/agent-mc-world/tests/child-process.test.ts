import { expect, it } from 'vitest';
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { childExecArgv } from '../src/runtime/child-process.ts';
import { childExecArgv as coreChildExecArgv } from '../core/support/child-process.ts';

it('source development retains its local TypeScript loader through the shared implementation', () => {
  expect(coreChildExecArgv()).toEqual(childExecArgv());
  expect(childExecArgv()[0]).toBe('--import');
  expect(existsSync(fileURLToPath(childExecArgv()[1]))).toBe(true);
});

it('compiled children need no TypeScript loader, even outside the dependency tree', () => {
  const root = mkdtempSync(join(tmpdir(), 'mc-compiled-child-'));
  try {
    const output = fileURLToPath(new URL('../dist/runtime/', import.meta.url));
    for (const relative of ['src/runtime/child-process.js', 'core/support/child-process.js']) {
      const target = join(root, relative);
      mkdirSync(dirname(target), { recursive: true });
      cpSync(join(output, relative), target);
    }
    writeFileSync(join(root, 'package.json'), '{"type":"module"}\n');
    writeFileSync(join(root, 'probe.mjs'), `
import assert from 'node:assert/strict';
import { childExecArgv } from './src/runtime/child-process.js';
import { childExecArgv as engineArgs } from './core/support/child-process.js';
assert.deepEqual(childExecArgv(), []);
assert.deepEqual(engineArgs(), []);
const {spawnSync}=await import('node:child_process');
const result=spawnSync(process.execPath,[...engineArgs(),'-e','process.stdout.write("compiled-child-ok")'],{encoding:'utf8',windowsHide:true});
assert.equal(result.status,0);assert.equal(result.stdout,'compiled-child-ok');
console.log('loader-free child verified');
`);
    const run = spawnSync(process.execPath, [join(root, 'probe.mjs')], {
      cwd: root, encoding: 'utf8', timeout: 10_000, windowsHide: true,
    });
    expect(run.status, run.stderr).toBe(0);
    expect(run.stdout).toContain('loader-free child verified');
  } finally {
    expect(dirname(root)).toBe(resolve(tmpdir()));
    expect(root.split(/[\\/]/).at(-1)).toMatch(/^mc-compiled-child-/);
    rmSync(root, { recursive: true, force: true });
  }
});

it('ships an executable offline training worker alongside the compiled engine', () => {
  const worker = fileURLToPath(new URL('../dist/runtime/training/worker.js', import.meta.url));
  const run = spawnSync(process.execPath, [worker], { encoding: 'utf8', windowsHide: true, timeout: 10_000,
    input: '{"op":"hello"}\n{"op":"reset","task":"walk","seed":7}\n' });
  expect(run.status, run.stderr).toBe(0);
  const [hello, reset] = run.stdout.trim().split('\n').map(line => JSON.parse(line));
  expect(hello.backend).toBe('offline');
  expect(reset.error).toBeUndefined();
  expect(reset.features).toHaveLength(hello.featureCount);
});
