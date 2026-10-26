import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { siteFixture } from './helpers.mjs';
import { agentClients, getAgentClients } from '../src/agent-clients.mjs';
import { skillAt,agentSkill } from '../src/agent-skill.mjs';
import {createHash} from 'node:crypto';

test('public discovery and fetch-only documentation share all adapter and parent links without credentials', async t => {
 const f=await siteFixture(t);
 const site=(await f.client().request('/site')).data;
 const access=(await (await fetch(f.origin+'/api/v1/agent-access')).json());
 assert.deepEqual(site.agentClients,getAgentClients(f.config));assert.deepEqual(access.clients,getAgentClients(f.config));
 assert.equal(site.agentSkill.sdkVersion,agentSkill.sdkVersion);assert.equal(site.agentSkill.channel,'github-main-candidate');
 assert.equal(site.agentSkill.viewerIncluded,false);
 for(const page of ['/join','/agent-api.html']){
  const html=await (await fetch(f.origin+page)).text(),dom=new JSDOM(html,{url:f.origin});
  const links=new Set([...dom.window.document.querySelectorAll('a[href]')].map(a=>a.href));
  for(const client of agentClients){assert.ok(links.has(client.source));if(client.framework)assert.ok(links.has(client.framework.url));if(client.releases)assert.ok(links.has(client.releases));}
  assert.ok(links.has(f.origin+'/downloads/agent-skill'));assert.ok(!html.includes('agent-mc-world 0.4.0'));
  dom.window.close();
 }
 for(const release of [skillAt('/downloads/qiandengji-agent-1.0.0.zip'),skillAt('/downloads/qiandengji-agent-1.1.0.zip')]){
  const response=await fetch(f.origin+release.url),bytes=Buffer.from(await response.arrayBuffer());
  assert.equal(response.status,200);assert.equal(createHash('sha256').update(bytes).digest('hex'),release.sha256);
 }
 assert.equal(skillAt('/downloads/arbitrary.zip'),undefined);
});
