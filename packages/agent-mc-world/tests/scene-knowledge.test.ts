import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';
import {afterEach,it,expect,vi} from 'vitest';
import {GameMemoryBook,GAME_MEMORY_TOOL,type GameMemoryContext} from '../core/game-memory.ts';
import {GameMemoryService} from '../core/game-memory-service.ts';
import {SceneKnowledgeLibrary,validateSceneCard,type SceneKnowledgeCard} from '../core/scene-knowledge.ts';
const dirs:string[]=[];afterEach(()=>{for(const d of dirs.splice(0))rmSync(d,{recursive:true,force:true});});
const ctx:GameMemoryContext={scope:{realm:'fixture',account:'alice',agent:'agent'},dimension:'overworld'};
const card:SceneKnowledgeCard={title:'碎石采集的替代路线',scenes:['采矿','绕路'],when:'当前目标是采矿，原路线受阻；先核实工具与支撑',guidance:'依据工具回包比较绕行与短步控制，不重放未知任务',verify:'抵达矿点、实际获得物品且没有不可接受的资源损失',counterexamples:'示例 task:1 未抵达，不能推出整个区域不可达',author:'fixture-model',sources:[{reference:'fixture:task:1',observedAt:'2026-01-01T00:00:00.000Z',excerpt:'task 1 failed: blocked'}]};
function fixture(){const dir=mkdtempSync(join(tmpdir(),'mc-scene-'));dirs.push(dir);const book=new GameMemoryBook(dir);return {dir,book,lib:new SceneKnowledgeLibrary(book)};}
const save=(lib:SceneKnowledgeLibrary,c=card)=>lib.execute({operation:'upsert',input:{card:c}},ctx);
it('persists model labels with provenance and revision; identical retry is not new evidence',()=>{
 const {lib,dir}=fixture(),a=save(lib),b=save(lib);expect(b).toMatchObject({id:a.id,revision:1,written:false,benefitVerified:false});
 const reloaded=new SceneKnowledgeLibrary(new GameMemoryBook(dir));expect(reloaded.execute({operation:'get',input:{id:a.id}},ctx)).toMatchObject({card,trust:'model-organized-guidance',referencesVerified:false});
 expect(()=>lib.execute({operation:'upsert',input:{id:a.id,expectedRevision:0,card}},ctx)).toThrow(/Revision/);
 const c=lib.execute({operation:'upsert',input:{id:a.id,expectedRevision:1,card:{...card,guidance:'新回执要求另一条有支撑的路线'}}},ctx);expect(c.revision).toBe(2);
 expect(reloaded.execute({operation:'get',input:{id:a.id,revision:1}},ctx)).toMatchObject({card});
});
it('recalls only relevant guides and isolates server, account and agent',()=>{
 const {lib}=fixture();save(lib);save(lib,{...card,title:'对话沟通',scenes:['社交'],when:'有人问好',guidance:'简短接话',sources:[{...card.sources[0],reference:'fixture:chat'}]});
 const r=lib.execute({operation:'recall',input:{query:'采矿'}},ctx);expect(r.cards).toHaveLength(1);
 for(const key of ['realm','account','agent'])expect(lib.execute({operation:'recall',input:{query:'采矿'}},{...ctx,scope:{...ctx.scope,[key]:'other'}}).cards).toEqual([]);
 expect(lib.execute({operation:'recall',input:{query:'完全不存在'}},ctx).cards).toEqual([]);
 expect(()=>lib.execute({operation:'recall',input:{query:''}},ctx)).toThrow(/task terms/);
});
it('keeps full originals on demand when a task context budget cannot fit them',()=>{
 const {lib}=fixture(),r=save(lib,{...card,guidance:'路径事实。'.repeat(390)});
 const recalled=lib.execute({operation:'recall',input:{query:'采矿',maxChars:600}},ctx);expect(recalled.chars).toBeLessThanOrEqual(600);
 expect(recalled.cards).toEqual([expect.objectContaining({id:r.id,revision:1,detailOmitted:true})]);
 expect(JSON.stringify(lib.execute({operation:'get',input:{id:r.id}},ctx))).toContain('路径事实。'.repeat(390));
});
it('archives exact scene revisions without deleting unrelated memories',()=>{
 const {lib,book}=fixture(),r=save(lib),n=book.execute({action:'remember',kind:'note',summary:'other',content:'personal-independent',source:{kind:'agent_note'}},ctx).entry as any;
 expect(()=>lib.execute({operation:'archive',input:{id:n.id,expectedRevision:1}},ctx)).toThrow(/Not a scene/);
 lib.execute({operation:'archive',input:{id:r.id,expectedRevision:1}},ctx);
 expect(lib.execute({operation:'recall',input:{query:'采矿'}},ctx).cards).toEqual([]);
 expect(lib.execute({operation:'get',input:{id:r.id,revision:1}},ctx)).toMatchObject({archived:false});
});
it('does not invent sources, silently accept unknown fields or mark learning as success',()=>{
 expect(()=>validateSceneCard({...card,sources:[]})).toThrow(/sources/);
 expect(()=>validateSceneCard({...card,success:true})).toThrow(/Unknown/);
 expect(()=>validateSceneCard({...card,sources:[{...card.sources[0],observedAt:'2999-01-01T00:00:00Z'}]})).toThrow(/past/);
 expect(()=>validateSceneCard({...card,scenes:Array(9).fill('x')})).toThrow(/scenes/);
});
it('exposes safe background writes and local retrieval independent of remote memory availability',async()=>{
 const {book,dir}=fixture(),fetch=vi.fn(()=>{throw Error('must not call network');}),service=new GameMemoryService(book,dir,fetch as any);
 expect(GAME_MEMORY_TOOL.sceneKnowledge?.protocol).toBe('agent-mc-scenes/v1');
 expect(GAME_MEMORY_TOOL.learningCall?.({action:'scene',operation:'upsert'})).toBe(true);
 expect(GAME_MEMORY_TOOL.readOnlyCall?.({action:'scene',operation:'upsert'})).toBe(false);
 expect(GAME_MEMORY_TOOL.readOnlyCall?.({action:'scene',operation:'recall'})).toBe(true);
 const r=await service.execute({action:'scene',operation:'upsert',input:{card}},ctx,{mode:'remote'});expect(r.saved).toBe(true);
 expect((await service.execute({action:'scene',operation:'recall',input:{query:'采矿'}},ctx,{mode:'remote'})).cards).toHaveLength(1);expect(fetch).not.toHaveBeenCalled();
});
