// Audits the actual derived distribution, not an importable host checkout.
import { readFile, stat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

const root = resolve(process.argv[2]);
const read = async name => JSON.parse(await readFile(join(root,name),'utf8'));
const pin = JSON.parse(await readFile(new URL('./source.json',import.meta.url),'utf8'));
const pkg = await read('package.json'), receipt = await read('dist/neko-headless.json');
assert.deepEqual(pkg.nekoBuild.patches,pin.patches);
assert.deepEqual(receipt.patches,pin.patches);
assert.equal(pkg.nekoBuild.sourceRevision,pin.source_revision);
assert.equal(receipt.minecraftVersion,'1.21.1');
assert.equal(receipt.bundledViewer,false);
const forbidden = /corti(?:co|cal)?|qiandengji|\/mycli|可缇/i;
for (const entry of [...receipt.sourceFiles,...receipt.files]) {
  assert.ok(!forbidden.test(entry.file),`Legacy file: ${entry.file}`);
  const bytes = await readFile(join(root,entry.file));
  assert.equal(createHash('sha256').update(bytes).digest('hex'),entry.sha256,entry.file);
  assert.ok(!forbidden.test(bytes.toString('utf8')),`Legacy source/runtime: ${entry.file}`);
}
const declarations = await read('dist/types/manifest.json');
for (const entry of declarations.files) {
  const bytes = await readFile(join(root,'dist/types',entry.file));
  assert.equal(createHash('sha256').update(bytes).digest('hex'),entry.sha256,entry.file);
  if (!entry.file.startsWith('native/')) assert.ok(!forbidden.test(bytes.toString('utf8')),`Legacy type: ${entry.file}`);
}
assert.ok(!Object.keys(pkg.dependencies).some(name => forbidden.test(name)));
assert.ok(!pkg.files.some(file => /(?:^|\/)(?:migration|client-login|native-chat-filter|provenance|release-sources|integrations)(?:\/|\.|$)/.test(file)));
assert.ok(!await stat(join(root,'dist/runtime/src/client/migration.js')).catch(()=>null));
const entry = pathToFileURL(join(root,'dist/runtime/src/index.js')).href;
// Register denial hooks before importing the runtime: no sockets, fetch, listeners or framework.
await import('./deny-network.mjs');
const sdk = await import(entry);
assert.equal(sdk.MINECRAFT_CLIENT_DEFAULTS.version,'1.21.1');
assert.equal(sdk.MINECRAFT_CLIENT_DEFAULTS.enabled,false);
assert.equal(sdk.MINECRAFT_CLIENT_DEFAULTS.host,'');
assert.equal('planLegacyConfiguration' in sdk,false);
assert.equal('copyLegacyData' in sdk,false);
const core = name => import(pathToFileURL(join(root,'dist/runtime/core',name)).href);
assert.equal((await core('server.js')).REALM_MARKER_FILE,'agent-mc-realm.json');
const {BreakPermissions,BREAK_ACL_CHANNEL} = await core('break-permissions.js');
assert.equal(BREAK_ACL_CHANNEL,'agent_mc:break_acl');
const acl = new BreakPermissions(null,'fixture.invalid:25565');
const packet = Buffer.from(JSON.stringify({v:1,complete:true,dimension:'overworld',chunkX:0,chunkZ:0,
  revision:1,denyCells:[[0,64,0]],denyBoxes:[]}));
assert.equal(acl.applyPacket(BREAK_ACL_CHANNEL,packet,1),'changed');
assert.equal(acl.verdict('overworld',0,64,0,1,2),'protected');
assert.equal(acl.verdict('overworld',16,64,0,1,2),'unknown');
assert.equal(acl.applyPacket('foreign:break_acl',packet,2),false);
const procedure = await core('support/procedure.js');
assert.equal('LEGACY_PROCEDURE_SCHEMA' in procedure,false);
assert.throws(()=>procedure.parseProcedure({schema:'cortico.procedure/v1'}),/unsupported procedure schema/);
const {loadViewerRelay} = await core('relay-port.js');
assert.equal(await loadViewerRelay(undefined,'fixture'),undefined);
console.log(JSON.stringify({sourceFiles:receipt.sourceFiles.length,runtimeFiles:receipt.files.length,
  declarations:declarations.files.length,legacyRuntimeReferences:0,network:'denied',
  permissionBoundary:'passed',legacyProcedure:'rejected',migrationExports:'absent'}));
