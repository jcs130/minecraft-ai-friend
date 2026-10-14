import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync, rmdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { publicAgentReader } from '../src/agent_mc_autonomy/integrations/viewer-public.mjs'

test('public projection reader refuses stale, foreign-session, foreign-player and oversized input', () => {
  const directory=mkdtempSync(join(tmpdir(),'mc-public-')),file=join(directory,'agent.json'),now=Date.now()
  try {
    const base={schema_version:1,session:'mine',username:'Player',updated_at:new Date(now).toISOString(),goal:'Find food'}
    const read=publicAgentReader(file,'mine','Player',()=>now)
    writeFileSync(file,JSON.stringify(base));assert.equal(read().goal,'Find food')
    for(const patch of [{session:'other'},{username:'Other'},{updated_at:new Date(now-31000).toISOString()},{schema_version:2}]) {
      writeFileSync(file,JSON.stringify({...base,...patch}));assert.throws(read,/STALE_OR_FOREIGN/)
    }
    writeFileSync(file,'x'.repeat(16385));assert.throws(read,/UNAVAILABLE/)
  } finally {rmSync(file,{force:true});rmdirSync(directory)}
})
