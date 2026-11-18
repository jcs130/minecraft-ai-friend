/** Project NPC evidence into the existing MC core notebook and optional PowerContext.
 * node --experimental-transform-types companion-memory.mjs private-config.json [--once | --recall body request]
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
  const result=Object.fromEntries(['id','at','speakerId','message','reply','decision','status','reason','channel','kind','sourceRequestId',
    'payloadTruncated','sourceJournal','payloadSha256','originalBytes','instruction','legacyEnvelopeRecovered']
    .filter(key=>Object.hasOwn(row,key)).map(key=>[key,row[key]]));
  if(row.receipt) result.receipt=Object.fromEntries(['action','status','reason','completed']
    .filter(key=>Object.hasOwn(row.receipt,key)).map(key=>[key,row.receipt[key]]));
  return result;
}

function validate(config) {
  if (config.schema !== 1 || !isAbsolute(config.coreRoot) || !isAbsolute(config.journalRoot) ||
      !isAbsolute(config.dataDir) || typeof config.realm !== 'string' || !config.realm.trim() ||
      !Array.isArray(config.npcs) || config.npcs.length > 64) throw Error('invalid_memory_configuration');
  if (config.goalsDirectory !== undefined && (typeof config.goalsDirectory!=='string'||!isAbsolute(config.goalsDirectory))) throw Error('absolute_core_goals_directory_required');
  if (new Set(config.npcs.map(n=>n.maidId)).size !== config.npcs.length ||
      new Set(config.npcs.filter(n=>n.memory?.mode==='remote').map(n=>`${n.memory.endpoint}:${n.memory.scopeId}`)).size !==
      config.npcs.filter(n=>n.memory?.mode==='remote').length) throw Error('duplicate_npc_or_shared_memory_scope');
}

export async function runOnce(config) {
  validate(config);
  await mkdir(config.dataDir,{recursive:true});
  const lock = join(config.dataDir,'companion-sync.lock');
  await mkdir(lock); // Never take over an unknown writer. After a crash the operator checks and removes this lock.
  try { return await synchronize(config); } finally { await rmdir(lock); }
}

function coreModule(config, name) {
  const prefix = config.source === true ? 'core' : 'dist/runtime/core';
  const extension = config.source === true ? 'ts' : 'js';
  return import(pathToFileURL(join(config.coreRoot, prefix, `${name}.${extension}`)).href);
}

function memoryContext(config, body) {
  return {scope:{realm:config.realm,account:`npc:${body}`,agent:body},dimension:null};
}

/** Read only. The caller verifies these IDs against the original delivered replies. */
export async function recallConversation(config, body, request) {
  validate(config);
  if (!UUID.test(body) || !UUID.test(request)) throw Error('invalid_dialogue_identity');
  const npc = config.npcs.find(row => row.maidId === body);
  if (!npc || npc.memory?.mode !== 'remote') return {mode:'local', sourceRequestIds:[]};
  if (npc.memory.provider !== 'powercontext' || !npc.memory.scopeId) throw Error('dedicated_npc_memory_scope_required');
  const row = await json(join(config.journalRoot,body,request+'-request.json'),32768);
  const age = Date.now() - row.at;
  if (row.schemaVersion !== 1 || row.kind !== 'social_dialogue' || row.status !== 'accepted'
      || row.id !== request || row.maidId !== body || !UUID.test(row.speakerId) || row.speakerId === body
      || !['private','public','nearby'].includes(row.channel) || !Number.isSafeInteger(row.at) || age < 0 || age > 120000
      || typeof row.message !== 'string' || !row.message.trim() || row.message.length > 800)
    throw Error('invalid_dialogue_request');
  const [{GameMemoryBook}, {GameMemoryService}] = await Promise.all([
    coreModule(config,'game-memory'), coreModule(config,'game-memory-service'),
  ]);
  const directory = join(config.dataDir,body);
  const book = new GameMemoryBook(directory);
  const context = memoryContext(config,body);
  const result = await new GameMemoryService(book,directory).execute({action:'search',kind:'relationship',
    query:row.message.trim().slice(0,200),tags:[`peer:${row.speakerId}`],limit:20,dimension:'*',preference:'balanced'},
    context,{...npc.memory,searchMode:'hybrid',timeoutMs:1500},AbortSignal.timeout(2000));
  const sourceRequestIds = [];
  for (const candidate of result.entries ?? []) {
    const note = book.execute({action:'get',id:candidate.id},context).entry;
    if (note.revision !== candidate.revision || note.archived || note.expired) continue;
    const evidence = JSON.parse(note.content);
    if (evidence.maidId !== body || evidence.speakerId !== row.speakerId || evidence.status !== 'answered'
        || !UUID.test(evidence.id) || evidence.id === request
        || !['private','public','nearby','npc'].includes(evidence.channel)
        || (row.channel !== 'private' && evidence.channel !== 'public')) continue;
    if (!sourceRequestIds.includes(evidence.id)) sourceRequestIds.push(evidence.id);
    if (sourceRequestIds.length === 8) break;
  }
  return {mode:result.retrieval?.remoteConsulted === true ? 'hybrid' : 'local',
    degraded:result.retrieval?.degraded === true, sourceRequestIds};
}

async function synchronize(config) {
  const {GameMemoryBook} = await coreModule(config,'game-memory');
  const {GameMemoryService} = await coreModule(config,'game-memory-service');
  const {GoalCheckpointBook} = await coreModule(config,'goal-checkpoint');
  const summary = [];
  for (const npc of config.npcs) {
    if (!UUID.test(npc.maidId) || (npc.memory?.mode === 'remote' &&
      (npc.memory.provider !== 'powercontext' || !npc.memory.scopeId))) throw Error('dedicated_npc_memory_scope_required');
    const root = join(config.journalRoot, npc.maidId);
    const directory = join(config.dataDir, npc.maidId);
    await mkdir(directory, {recursive:true});
    const service = new GameMemoryService(new GameMemoryBook(directory), directory);
    const context = memoryContext(config,npc.maidId);
    // Project the existing core goal book, never introduce a second goal authority.
    // These are durable intentions; restored plans are NOT fresh world verification.
    await mkdir(root,{recursive:true});
    let goals={schemaVersion:1,maidId:npc.maidId,scope:context.scope,observedAt:Date.now(),
      source:'agent-mc-goals/v1',semantics:'intentions_not_current_world_evidence',status:'not_configured',goals:[]};
    if(config.goalsDirectory!==undefined){
      try {
        goals.goals=new GoalCheckpointBook(config.goalsDirectory).load(context.scope);
        goals.status='available';
        if(Buffer.byteLength(JSON.stringify(goals))>24576)throw Error('goal_context_budget');
      }catch(error){
        goals={...goals,status:'unavailable',goals:[],reason:error.message==='goal_context_budget'?'goal_context_budget':'core_goal_checkpoint_unavailable'};
      }
    }
    await atomic(join(root,'core-goals.json'),goals);
    let files;
    try { files = await readdir(root); } catch (e) { if (e.code === 'ENOENT') continue; throw e; }
    const donePath = join(directory, 'companion-import.json');
    let imported = {};
    try { imported = await json(donePath, 8 * 1024 * 1024); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    let count = 0;
    for (const name of files.filter(f => /^[0-9a-f-]{36}-result\.json$/.test(f)).sort()) {
      if (imported[name] || count >= 20) continue;
      const stored = await json(join(root, name), 262144), original = JSON.stringify(stored);
      let record=stored;
      const fileId=name.slice(0,-'-result.json'.length);
      // Earlier resident candidates wrote private self-notices without the envelope ID. Their
      // canonical UUID is already in the immutable filename. No other missing
      // identity is guessed, and the original file is never rewritten.
      if(!Object.hasOwn(stored,'id')&&stored.kind==='game_notice'&&stored.channel==='private'
          &&stored.maidId===npc.maidId&&stored.speakerId===npc.maidId&&UUID.test(fileId)
          &&typeof stored.sentAt==='string'&&Number.isFinite(Date.parse(stored.sentAt)))
        record={...stored,schemaVersion:1,id:fileId,at:Date.parse(stored.sentAt),status:'recorded',sourceJournal:name,legacyEnvelopeRecovered:true};
      if (record.maidId !== npc.maidId || !UUID.test(record.speakerId) || !UUID.test(record.id) || record.id!==fileId)
        throw Error('conversation_identity_mismatch');
      const digest = createHash('sha256').update(original).digest('hex');
      let content=JSON.stringify(record);
      if(Buffer.byteLength(content)>6000) {
        // Preserve the full durable journal; a large CLI catalogue must not stop all later memories.
        const preview={schemaVersion:1,id:record.id,maidId:record.maidId,speakerId:record.speakerId,
          kind:record.kind,sourceRequestId:record.sourceRequestId,status:record.status,
          payloadTruncated:true,sourceJournal:name,payloadSha256:digest,originalBytes:Buffer.byteLength(original),
          instruction:'Preview only. Read the original scoped journal or action receipt for complete evidence.',
          reply:Array.from(String(record.reply??'')).slice(0,1200).join('')};
        content=JSON.stringify(preview);
        while(Buffer.byteLength(content)>5800){preview.reply=Array.from(preview.reply).slice(0,-100).join('');content=JSON.stringify(preview);}
      }
      const result = await service.execute({action:'remember',kind:'relationship',
        summary:`NPC conversation ${record.id}`,content,
        tags:[`peer:${record.speakerId}`],source:{kind:'agent_note',
          reference:`npc-conversation:${record.id}:sha256:${digest}`}}, context, npc.memory ?? {mode:'local'});
      if (!result.saved) throw Error('local_note_not_saved');
      imported[name] = {id:result.entry.id,revision:result.entry.revision,index:result.index ?? {status:'local-only'}};
      await atomic(donePath, imported);
      count++;
    }
    // Own executed actions need recall even when no self-conversation was started.
    // All searches stay in this NPC's scope; include at most 16 known speakers including self.
    const requests = (await Promise.all(files.filter(f => /^[0-9a-f-]{36}-request\.json$/.test(f))
      .map(async f => ({name:f,time:(await stat(join(root,f))).mtimeMs}))))
      .sort((a,b)=>b.time-a.time).slice(0,16);
    const speakers=[{maidId:npc.maidId,speakerId:npc.maidId}];
    for (const request of requests) {
      const record = await json(join(root, request.name), 32768);
      if (record.maidId !== npc.maidId || !UUID.test(record.speakerId)) throw Error('request_identity_mismatch');
      speakers.push(record);
    }
    const seen = new Set();
    for (const record of speakers) {
      if(seen.size>=16) break;
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

async function main([path, operation, body, request]) {
  const config = await json(resolve(path));
  if (operation === '--recall') {
    try { process.stdout.write(JSON.stringify(await recallConversation(config,body,request))+'\n'); }
    catch { process.exitCode = 1; }
    return;
  }
  do {
    try { process.stdout.write(JSON.stringify(await runOnce(config))+'\n'); }
    catch (error) { process.stderr.write(`NPC memory sync failed (${error.name}); original evidence is retained.\n`);
      if (operation === '--once') { process.exitCode=1; break; } }
    if (operation === '--once') break;
    await sleep(15000);
  } while (true);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main(process.argv.slice(2));
