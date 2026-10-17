import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {createHash} from 'node:crypto';
import {presentationFactory,mergePresentation} from '../src/agent_mc_autonomy/integrations/server-presentation.mjs';
test('default standard body loads no server module; an explicit local provider must match its exact hash',async t=>{
  assert.equal(await presentationFactory({}),null);
  const dir=await mkdtemp(join(tmpdir(),'mc-server-port-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const file=join(dir,'port.mjs'),source='export const createPresentationObserver=()=>({snapshot:()=>null,close(){}});';await writeFile(file,source);
  const config={presentationModule:file,presentationSha256:createHash('sha256').update(source).digest('hex')};
  const factory=await presentationFactory(config);assert.equal(factory({}).snapshot(),null);
  await assert.rejects(presentationFactory({...config,presentationSha256:'0'.repeat(64)}),/HASH_MISMATCH/);
});
test('extension may supplement own HUD only; never identity, pose, inventory or another player',()=>{
  const bot={_client:{uuid:'body'}},base={playerUuid:'body',self:{playerUuid:'body',yaw:2},inventory:{original:true}};
  const extra={schemaVersion:1,playerUuid:'body',self:{playerUuid:'body',health:14.97,maxHealth:20.8,yaw:8},inventory:{fake:true},skills:{mana:{current:28,max:28}}};
  const result=mergePresentation(base,extra,bot);assert.equal(result.self.maxHealth,20.8);assert.equal(result.self.yaw,2);assert.equal(result.inventory,base.inventory);
  assert.equal(mergePresentation(base,{...extra,playerUuid:'other'},bot),base);
});
