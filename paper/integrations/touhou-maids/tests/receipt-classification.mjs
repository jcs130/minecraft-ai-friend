import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const option = name => {
  const index = args.indexOf(name);
  return index < 0 ? undefined : args[index + 1];
};
const root = path.dirname(fileURLToPath(import.meta.url));
const source = option('--source') ?? path.resolve(root, '../hybrid-src/local/tlmcompat/hybrid/NativeMaidSocialSupport.java');
const gson = option('--gson');
assert(gson, 'Supply the existing Gson JAR with --gson; this test never downloads dependencies.');
assert.equal(createHash('sha256').update(await fs.readFile(gson)).digest('hex'), '4241c14a7727c34feea6507ec801318a3d4a90f070e4525681079fb94ee4c593', 'Use the pinned Gson 2.10.1 dependency.');
const code = await fs.readFile(source, 'utf8');
// Compile the production method itself, without needing a running Paper/TLM server.
const method = code.match(/^    static boolean visitorReceipt\(JsonObject receipt\)\{[\s\S]*?^    \}/m)?.[0];
assert(method, 'Production visitorReceipt method was not found; update the fixture extraction.');
const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'maid-receipt-'));
try {
  const wrapper = path.join(tmp, 'MaidReceiptClassifierUnderTest.java');
  await fs.writeFile(wrapper, `import com.google.gson.*;\nfinal class MaidReceiptClassifierUnderTest {\n${method}\n}\n`);
  const compile = spawnSync(option('--javac') ?? 'javac', ['--release', '21', '-encoding', 'UTF-8', '-cp', path.resolve(gson), '-d', tmp, wrapper, path.join(root, 'ReceiptClassificationQa.java')], { encoding: 'utf8' });
  process.stdout.write(compile.stdout ?? ''); process.stderr.write(compile.stderr ?? '');
  assert.equal(compile.status, 0, 'Receipt fixture compilation failed');
  const run = spawnSync(option('--java') ?? 'java', ['-cp', [tmp, path.resolve(gson)].join(path.delimiter), 'ReceiptClassificationQa'], { encoding: 'utf8' });
  process.stdout.write(run.stdout ?? ''); process.stderr.write(run.stderr ?? '');
  assert.equal(run.status, 0, 'Production receipt classification regression failed');
} finally {
  await fs.rm(tmp, { recursive: true, force: true });
}
