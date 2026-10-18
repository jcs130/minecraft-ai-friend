import {execFileSync} from 'node:child_process';
import {mkdirSync, mkdtempSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {expect, it} from 'vitest';
const root = fileURLToPath(new URL('../', import.meta.url));
const executable = (name: string): string => process.env.JAVA_HOME
  ? join(process.env.JAVA_HOME, 'bin', name + (process.platform === 'win32' ? '.exe' : '')) : name;
let javaAvailable = false;
try { execFileSync(executable('javac'), ['--version'], {stdio:'pipe'}); javaAvailable = true; } catch {}
it.skipIf(!javaAvailable)('scopes client appearances by server, observer and UUID while retaining opaque Unicode catalogue ids', () => {
  const scratch = join(root, 'scratch', 'client-appearance-checks');
  mkdirSync(scratch, {recursive:true});
  const output = mkdtempSync(join(scratch, 'run-'));
  execFileSync(executable('javac'), ['--release','21','-encoding','UTF-8','-d',output,
    ...['AppearancePolicy.java','AppearancePolicyCheck.java'].map(file => join(root,'client-appearance',file))],
    {stdio:'pipe',windowsHide:true});
  expect(execFileSync(executable('java'), ['-cp',output,'AppearancePolicyCheck'], {encoding:'utf8',windowsHide:true}))
    .toContain('22 checks passed');
}, 20_000);
