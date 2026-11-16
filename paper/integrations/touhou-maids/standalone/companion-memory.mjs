/** Project NPC evidence into the existing MC core notebook and optional PowerContext.
 * node --experimental-transform-types companion-memory.mjs private-config.json [--once]
 * No model inference, game commands, new memory engine or automatic unknown-write replay here.
 */
import { readFile, readdir, mkdir, writeFile, rename, stat, rmdir } from 'node:fs/promises';
import { resolve, join, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
async function json(path, max = 1024 * 1024) {
  if ((await stat(path)).size > max) throw Error('memory_file_too_large');
  return JSON.parse(await readFile(path, 'utf8'));
}
async function atomic(path, data) {
  await mkdir(resolve(path, '..'), {recursive:true});
  const temporary = path + '.tmp';
  await writeFile(temporary, JSON.stringify(data));
  await rename(temporary, path);
}

function compactEvidence(row) {
  const result=Object.fromEntries(['id','at','speakerId','message','reply','decision','status','reason']
    .filter(key=>Object.hasOwn(row,key)).map(key=>[key,row[key]]));
  if(row.receipt) result.receipt=Object.fromEntries(['action','status','reason','completed']
    .filter(key=>Object.hasOwn(row.receipt,key)).map(key=>[key,row.receipt[key]]));
  return result;
}

export async function runOnce(config) {
  if (config.schema !== 1 || !isAbsolute(config.coreRoot) || !isAbsolute(config.journalRoot) ||
      !isAbsolute(config.dataDir) || typeof config.realm !== 'string' || !config.realm.trim() ||
      !Array.isArray(config.npcs) || config.npcs.length > 64) throw Error('invalid_memory_configuration');
  if (new Set(config.npcs.map(n=>n.maidId)).size !== config.npcs.length ||
      new Set(config.npcs.filter(n=>n.memory?.mode==='remote').map(n=>`${n.memory.endpoint}:${n.memory.scopeId}`)).size !==
      config.npcs.filter(n=>n.memory?.mode==='remote').length) throw Error('duplicate_npc_or_shared_memory_scope');
  await mkdir(config.dataDir,{recursive:true});
  const lock = join(config.dataDir,'companion-sync.lock');
  await mkdir(lock); // Never take over an unknown writer. After a crash the operator checks and removes this lock.
  try { return await synchronize(config); } finally { await rmdir(lock); }
}

async function synchronize(config) {
  const core = resolve(config.coreRoot);
  const extension = config.source === true ? 'ts' : 'js';
  const prefix = config.source === true ? 'core' : 'dist/runtime/core';
  const {GameMemoryBook} = await import(pathToFileURL(join(core, prefix, `game-memory.${extension}`)).href);
  const {GameMemoryService} = await import(pathToFileURL(join(core, prefix, `game-memory-service.${extension}`)).href);
  const summary = [];
  for (const npc of config.npcs) {
    if (!UUID.test(npc.maidId) || (npc.memory?.mode === 'remote' &&
      (npc.memory.provider !== 'powercontext' || !npc.memory.scopeId))) throw Error('dedicated_npc_memory_scope_required');
    const root = join(config.journalRoot, npc.maidId);
    const directory = join(config.dataDir, npc.maidId);
    await mkdir(directory, {recursive:true});
    const service = new GameMemoryService(new GameMemoryBook(directory), directory);
    const context = {scope:{realm:config.realm,account:`npc:${npc.maidId}`,agent:npc.maidId},dimension:null};
    let files;
    try { files = await readdir(root); } catch (e) { if (e.code === 'ENOENT') continue; throw e; }
    const donePath = join(directory, 'companion-import.json');
    let imported = {};
    try { imported = await json(donePath, 8 * 1024 * 1024); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    let count = 0;
    for (const name of files.filter(f => /^[0-9a-f-]{36}-result\.json$/.test(f)).sort()) {
      if (imported[name] || count >= 20) continue;
      const record = await json(join(root, name), 32768);
      if (record.maidId !== npc.maidId || !UUID.test(record.speakerId) || !UUID.test(record.id))
        throw Error('conversation_identity_mismatch');
      const content = JSON.stringify(record);
      if (Buffer.byteLength(content) > 6000) throw Error('conversation_exceeds_core_note_budget');
      const digest = createHash('sha256').update(content).digest('hex');
      const result = await service.execute({action:'remember',kind:'relationship',
        summary:`NPC conversation ${record.id}`,content,
        tags:[`peer:${record.speakerId}`],source:{kind:'agent_note',
          reference:`npc-conversation:${record.id}:sha256:${digest}`}}, context, npc.memory ?? {mode:'local'});
      if (!result.saved) throw Error('local_note_not_saved');
      imported[name] = {id:result.entry.id,revision:result.entry.revision,index:result.index ?? {status:'local-only'}};
      await atomic(donePath, imported);
      count++;
    }
    // Refresh only known conversation partners; no other NPC/account/scope is queried.
    const requests = (await Promise.all(files.filter(f => /^[0-9a-f-]{36}-request\.json$/.test(f))
      .map(async f => ({name:f,time:(await stat(join(root,f))).mtimeMs}))))
      .sort((a,b)=>b.time-a.time).slice(0,16);
    const seen = new Set();
    for (const request of requests) {
      const record = await json(join(root, request.name), 32768);
      if (record.maidId !== npc.maidId || !UUID.test(record.speakerId)) throw Error('request_identity_mismatch');
      if (seen.has(record.speakerId)) continue;
      seen.add(record.speakerId);
      const results = await service.execute({action:'search',query:record.speakerId,tags:[`peer:${record.speakerId}`],
        limit:4,dimension:'*',preference:'balanced'}, context, npc.memory ?? {mode:'local'});
      const items = [];
      for (const entry of results.entries ?? []) {
        const note = await service.execute({action:'get',id:entry.id}, context, npc.memory ?? {mode:'local'});
        const evidence=JSON.parse(note.entry.content);
        if(evidence.maidId!==npc.maidId || evidence.speakerId!==record.speakerId)
          throw Error('recalled_conversation_identity_mismatch');
        items.push({entryId:note.entry.id,revision:note.entry.revision,recordedAt:note.entry.recordedAt,
          source:note.entry.source,evidence:compactEvidence(evidence)});
      }
      await atomic(join(root, `recall-${record.speakerId}.json`), {schemaVersion:1,maidId:npc.maidId,
        speakerId:record.speakerId,historical:true,observedAt:new Date().toISOString(),items,
        retrieval:{mode:results.retrieval?.mode??'local',degraded:results.retrieval?.degraded??false,
          remoteConsulted:results.retrieval?.remoteConsulted??false,
          acceptedRemoteMatches:results.retrieval?.acceptedRemoteMatches??0}});
    }
    summary.push({maidId:npc.maidId,imported:count,provider:npc.memory?.mode === 'remote' ? 'powercontext':'local'});
  }
  return summary;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const config = await json(resolve(process.argv[2]));
  do {
    try { process.stdout.write(JSON.stringify(await runOnce(config))+'\n'); }
    catch (error) { process.stderr.write(`NPC memory sync failed (${error.name}); original evidence is retained.\n`);
      if (process.argv.includes('--once')) { process.exitCode=1; break; } }
    if (process.argv.includes('--once')) break;
    await sleep(15000);
  } while (true);
}
