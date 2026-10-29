import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
test('embedded spectator protocol and relay match the reviewed shared renderer source record',async()=>{
 const base=new URL('../src/viewer/',import.meta.url),source=JSON.parse(await fs.readFile(new URL('source.json',base),'utf8'));
 assert.equal(source.repository,'https://github.com/jcs130/mc-visual-console');assert.match(source.commit,/^[a-f0-9]{40}$/);
 assert.equal(source.normalization,'CRLF-to-LF and listed relative imports');
 assert.deepEqual(source.transforms,{'spectator-public.mjs':{'../src/native-viewer/native-item-stack.js':'./native-item-stack.js','../src/native-viewer/native-rpg-state.js':'./native-rpg-state.js'}});
 assert.deepEqual(Object.keys(source.files).sort(),['native-item-stack.js','native-rpg-state.js','spectator-fanout.mjs','spectator-protocol.mjs','spectator-public.mjs','spectator-relay.mjs','spectator-site.mjs']);
 for(const [name,sha]of Object.entries(source.files)){
  const text=(await fs.readFile(new URL(name,base),'utf8')).replaceAll('\r\n','\n');
  assert.equal(createHash('sha256').update(text).digest('hex'),sha,name);
 }
});
