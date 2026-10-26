import { describe, it, expect, vi, afterEach } from 'vitest';
import { createMinecraftChoiceTool } from '../src/client/choice.ts';
import { minecraftLifeTool } from '../src/client/life.ts';
import { FakeHost } from './method-host.ts';
import type { WorldRequestFacts } from '../src/contracts/host.ts';

const args = { category: 'route', goal: '到达河岸', candidates: [
  { id: 'bridge', label: '走已见桥面', evidence: '小切片确认支撑/净空', ready: true },
  { id: 'water', label: '直接涉水', evidence: '水深未知', ready: false },
] };
const answer = { answers: { action: { type: 'choice', choice: 'bridge', confidence: .9,
  probabilities: { bridge: .9, _inspect: .1 } } } };
const ctx = { role: 'test', log: new FakeHost().log };
const fact = { text: '在桥头，任务仍进行', snapshotTypes: [] };
afterEach(() => vi.useRealTimers());
describe('explicit host choice', () => {
  it('focuses real segment keys, ignores sampling clock churn and respects provider changes', async () => {
    const owner: any = new FakeHost(); let time = 'before', connection: string | undefined;
    const request = vi.fn(async () => { time = 'after'; return answer; }); owner.decisions = { request };
    const parts = () => ({ text: '', snapshotTypes: [], parts: [
      { key: 'sample', text: time }, { key: 'realclock', text: time },
      { key: 'place', text: '桥头' }, { key: 'body', text: '健康' },
      { key: 'terrain', text: '桥面支撑已测' }, { key: 'players', text: '不相关在线列表' },
    ] });
    const tool = createMinecraftChoiceTool(() => owner, parts, () => connection);
    expect(JSON.parse(String(await tool.handler(args, ctx))).status).toBe('advice');
    expect(request.mock.calls[0][0].state.observed.facts.map(p => p.key)).toEqual(['place', 'body', 'terrain']);
    connection = 'saved-other'; await tool.handler(args, ctx);
    expect(request).toHaveBeenCalledTimes(2); expect(request.mock.calls[1][1].provider).toBe('saved-other');
  });
  it('does not request absent services and never grants unknown candidates eligibility', async () => {
    const host = new FakeHost();
    const request = vi.fn(async () => answer);
    const tool = createMinecraftChoiceTool(() => host, () => fact);
    expect(JSON.stringify(await tool.handler(args, ctx))).toContain('unavailable');
    Object.assign(host, { decisions: { request } });
    const result = JSON.parse(String(await tool.handler(args, ctx)));
    expect(result.status).toBe('advice'); expect(result.inputTokens).toBeNull();
    expect(request.mock.calls[0][0].questions.action.criteria).toEqual({ bridge: '走已见桥面', _inspect: expect.any(String) });
    expect(request.mock.calls[0][1].provider).toBeUndefined();
    expect(result.execution).toContain('未执行');
    await tool.handler(args, ctx); expect(request).toHaveBeenCalledTimes(1);
  });
  it('discards a response after current facts or host identity changes', async () => {
    let facts = fact, owner: any = new FakeHost();
    owner.decisions = { request: async () => { facts = { ...fact, text: '桥毁了' }; return answer; } };
    const tool = createMinecraftChoiceTool(() => owner, () => facts);
    expect(JSON.stringify(await tool.handler(args, ctx))).toContain('stale');
    owner.decisions.request = async () => { owner = new FakeHost(); return answer; };
    expect(JSON.stringify(await tool.handler(args, ctx))).toContain('stale');
  });
  it('rejects fabricated IDs and low confidence without executing fallback work', async () => {
    const owner: any = new FakeHost(); owner.decisions = { request: async () => ({ answers: { action: { ...answer.answers.action, choice: 'water' } } }) };
    const tool = createMinecraftChoiceTool(() => owner, () => fact);
    expect(JSON.stringify(await tool.handler(args, ctx))).toContain('invalid-response');
    owner.decisions.request = async () => ({ answers: { action: { choice: 'bridge', confidence: .55, probabilities: { bridge: .55, _inspect: .45 } } } });
    expect(JSON.parse(String(await tool.handler(args, ctx))).choice).toBeNull();
  });
  it('bounds a non-cooperative provider and cancels promptly', async () => {
    vi.useFakeTimers(); const owner: any = new FakeHost();
    owner.decisions = { request: () => new Promise(() => {}) };
    const tool = createMinecraftChoiceTool(() => owner, () => fact);
    const result = tool.handler(args, ctx); await vi.advanceTimersByTimeAsync(1601);
    expect(JSON.stringify(await result)).toContain('unavailable');
    const controller = new AbortController(); const cancelled = tool.handler(args, { ...ctx, signal: controller.signal });
    controller.abort(); expect(JSON.stringify(await cancelled)).toContain('cancelled');
  });
  it('keeps invalid/all-unknown input off the provider and manuals progressive', async () => {
    const request = vi.fn(), owner: any = Object.assign(new FakeHost(), { decisions: { request } });
    const tool = createMinecraftChoiceTool(() => owner, () => fact);
    await tool.handler({ ...args, candidates: args.candidates.map(c => ({ ...c, ready: false })) }, ctx);
    await tool.handler({ ...args, candidates: [args.candidates[0], args.candidates[0]] }, ctx);
    expect(request).not.toHaveBeenCalled();
    const life = minecraftLifeTool(); const index = String(await life.handler({}, ctx));
    expect(index.length).toBeLessThan(650); expect(index).not.toContain('stages');
    expect(JSON.parse(String(await life.handler({ id: 'harvest' }, ctx))).proof).toContain('补种');
  });
});

function walkingFacts(): WorldRequestFacts {
  const sampledAtMs = Date.now();
  return { text: 'current route', snapshotTypes: [], parts: [
    { key: 'place', text: '主世界 (0,64,0)，石头支撑，步行' },
    { key: 'queue', text: '任务#44第1步，到[256,64,0]，已跑1s，我在(0,64,0)' },
    { key: 'taskProgress', text: '已跑1s' }, { key: 'players', text: '远方玩家A在线' },
    { key: 'body', text: '生命20，饥饿20' }, { key: 'clock', text: '上午' },
    { key: 'journey', text: 'journey:1:44:0:1，同一已见告示牌，任务#44前往[256,64,0]' },
    { key: 'terrain', text: '当前未扫描更多地形' }, { key: 'life', text: '' },
    { key: 'recoveryState', text: JSON.stringify({sampledAt:'old',position:{x:0,y:64,z:0},episodeId:2,health:20,inventory:[]}) },
  ], decision: { sampledAtMs, state: {
    connection: {ready:true,phase:'ready'}, danger:{water:false,environment:null,hostileCount:0},
    constraints:{body:null,support:'stone',grounded:true},
  } }, decisionStability: { sampledAtMs, identity: ['realm','account'], dimension:'minecraft:overworld',
    position:[0,64,0],health:20,food:20,guards:{body:[false,null],place:['plains','stone','minecraft:overworld','survival'],clock:[false,false,false]},
    route:{generation:1,positionEpoch:0,speedBlocksPerSec:4,policy:{choiceMinBlocks:10,choiceMaxBlocks:20,dangerChoiceMaxBlocks:5},risks:[],
      task:{id:44,stepIndex:0,stepCount:1,step:'goto (256,64,0)',skill:'goto',resumable:true,destination:[256,64,0],dimension:'minecraft:overworld'},
      waiting:[{id:45,label:'later task'}],hold:null,goalOwner:'task',fighting:false,environment:null,windowOpen:false,cursorOccupied:false,
      footing:{kind:'support',block:'stone',grounded:true},entities:[],journeyId:'journey:1:44:0:1',journeyCues:[{position:[4,64,0],observedAtMs:sampledAtMs}]} } };
}
async function choiceDuring(update: (facts: WorldRequestFacts) => void, category = 'route', before = walkingFacts()) {
  let facts = before;
  const owner: any = new FakeHost();
  const request = vi.fn(async () => { facts = structuredClone(facts); update(facts); return answer; });
  owner.decisions = {request};
  const tool = createMinecraftChoiceTool(() => owner, () => facts);
  const result = await tool.handler({...args,category},ctx);
  return {result:JSON.parse(typeof result==='string'?result:result.text),request};
}
describe('bounded route advice while the original goto continues', () => {
  it('keeps one observation time when the clock advances during fixture preparation', async () => {
    let now = 1_000_000;
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => now++);
    try {
      const { result } = await choiceDuring(facts => { facts.decisionStability!.position = [2,64,0]; });
      expect(result.status).toBe('advice');
    } finally { clock.mockRestore(); }
  });
  it('still expires a journey cue timestamp later than its producer snapshot', async () => {
    const before = walkingFacts();
    before.decisionStability!.route!.journeyCues[0]!.observedAtMs++;
    expect((await choiceDuring(facts => { facts.decisionStability!.position = [2,64,0]; }, 'route', before)).result.status).toBe('stale');
  });
  it('does not reuse cached advice across an unrendered forced move or replacement guard',async()=>{
    let facts=walkingFacts();const owner:any=new FakeHost();
    owner.decisions={request:vi.fn(async()=>answer)};
    const tool=createMinecraftChoiceTool(()=>owner,()=>facts);
    const first=JSON.parse(String(await tool.handler(args,ctx)));
    expect(JSON.parse(String(await tool.handler(args,ctx))).decisionId).toBe(first.decisionId);
    facts=structuredClone(facts);facts.decisionStability!.route!.positionEpoch++;
    const second=JSON.parse(String(await tool.handler(args,ctx)));
    expect(second.decisionId).not.toBe(first.decisionId);expect(owner.decisions.request).toHaveBeenCalledTimes(2);
    delete facts.decisionStability!.route;
    await tool.handler(args,ctx);expect(owner.decisions.request).toHaveBeenCalledTimes(3);
  });
  it('tolerates ordinary position/time/roster churn with producer-owned identity and no extra decision prompt', async () => {
    const {result,request}=await choiceDuring(facts=>{
      facts.decisionStability!.position=[2,64,0];
      facts.parts=facts.parts!.map(part=>['place','queue','taskProgress','players','clock'].includes(part.key)?{...part,text:part.text+' updated'}:
        part.key==='recoveryState'?{...part,text:JSON.stringify({sampledAt:'new',position:{x:2,y:64,z:0},episodeId:2,health:20,inventory:[]})}:part);
    });
    expect(result.status).toBe('advice');expect(result.execution).toContain('未执行');
    expect(request.mock.calls[0][0].state.observed).not.toHaveProperty('route');
    expect(request.mock.calls[0][0].state.observed.facts.find((part:any)=>part.key==='journey')).toBeTruthy();
  });
  it.each(['old cue','open window','body hold'])('keeps typed expiry when %s prevents relaxed comparison',async reason=>{
    const before=walkingFacts();
    if(reason==='old cue')before.decisionStability!.route!.journeyCues[0]!.observedAtMs-=11_000;
    if(reason==='open window')before.decisionStability!.route!.windowOpen=true;
    if(reason==='body hold')before.decisionStability!.route!.hold='waiting';
    expect((await choiceDuring(f=>{f.decisionStability!.route!.positionEpoch++;},'route',before)).result.status).toBe('stale');
    expect((await choiceDuring(f=>{f.decisionStability!.route!.waiting=[{id:46,label:'later task'}];},'route',before)).result.status).toBe('stale');
  });
  it('expires when the same absolute entity becomes occluded',async()=>{
    const before=walkingFacts();
    before.decisionStability!.route!.entities=[{id:55,name:'villager',kind:'other',visible:true,position:[4,64,0],health:20,note:null,item:null}];
    expect((await choiceDuring(f=>{f.decisionStability!.route!.entities[0]!.visible=false;},'route',before)).result.status).toBe('stale');
  });
  it('does not reuse typed fallback advice after an unrendered forced move',async()=>{
    let facts=walkingFacts();facts.decisionStability!.route!.windowOpen=true;
    const owner:any=new FakeHost();owner.decisions={request:vi.fn(async()=>answer)};
    const tool=createMinecraftChoiceTool(()=>owner,()=>facts);
    const first=JSON.parse(String(await tool.handler(args,ctx)));
    facts=structuredClone(facts);facts.decisionStability!.route!.positionEpoch++;
    const second=JSON.parse(String(await tool.handler(args,ctx)));
    expect(second.decisionId).not.toBe(first.decisionId);expect(owner.decisions.request).toHaveBeenCalledTimes(2);
  });
  it.each([
    ['connection generation',(f:WorldRequestFacts)=>f.decisionStability!.route!.generation++],
    ['short server teleport',(f:WorldRequestFacts)=>{f.decisionStability!.route!.positionEpoch++;f.decisionStability!.position=[2,64,0];}],
    ['policy changed',(f:WorldRequestFacts)=>f.decisionStability!.route!.policy.choiceMaxBlocks=15],
    ['new task',(f:WorldRequestFacts)=>f.decisionStability!.route!.task!.id++],
    ['next step',(f:WorldRequestFacts)=>f.decisionStability!.route!.task!.stepIndex++],
    ['new destination',(f:WorldRequestFacts)=>f.decisionStability!.route!.task!.destination=[999,64,0]],
    ['same-count queued replacement',(f:WorldRequestFacts)=>f.decisionStability!.route!.waiting=[{id:46,label:'later task'}]],
    ['other body owner',(f:WorldRequestFacts)=>f.decisionStability!.route!.goalOwner='combat'],
    ['body hold',(f:WorldRequestFacts)=>f.decisionStability!.route!.hold='waiting'],
    ['combat',(f:WorldRequestFacts)=>f.decisionStability!.route!.fighting=true],
    ['environment owner',(f:WorldRequestFacts)=>f.decisionStability!.route!.environment='drown'],
    ['open window',(f:WorldRequestFacts)=>f.decisionStability!.route!.windowOpen=true],
    ['cursor item',(f:WorldRequestFacts)=>f.decisionStability!.route!.cursorOccupied=true],
    ['airborne',(f:WorldRequestFacts)=>f.decisionStability!.route!.footing!.grounded=false],
    ['unknown support',(f:WorldRequestFacts)=>f.decisionStability!.route!.footing=null],
    ['water',(f:WorldRequestFacts)=>(f.decision!.state.danger as any).water=true],
    ['injury',(f:WorldRequestFacts)=>f.decisionStability!.health=19],
    ['food change',(f:WorldRequestFacts)=>f.decisionStability!.food=19],
    ['dimension change',(f:WorldRequestFacts)=>f.decisionStability!.dimension='minecraft:the_nether'],
    ['teleport distance',(f:WorldRequestFacts)=>f.decisionStability!.position=[100,64,0]],
    ['vertical displacement',(f:WorldRequestFacts)=>f.decisionStability!.position=[0,66,0]],
    ['new hostile',(f:WorldRequestFacts)=>(f.decision!.state.danger as any).hostileCount=1],
    ['new cue',(f:WorldRequestFacts)=>f.decisionStability!.route!.journeyId='journey:1:44:0:2'],
    ['cue no longer near',(f:WorldRequestFacts)=>f.decisionStability!.route!.journeyCues=[{position:[100,64,0],observedAtMs:Date.now()}]],
    ['cue expired',(f:WorldRequestFacts)=>f.decisionStability!.route!.journeyCues=[{position:[4,64,0],observedAtMs:Date.now()-11_000}]],
    ['new terrain evidence',(f:WorldRequestFacts)=>f.parts=[...f.parts!,{key:'terrain',text:'前方新见深沟'}]],
    ['new nearby entity',(f:WorldRequestFacts)=>f.decisionStability!.route!.entities=[{id:55,name:'villager',kind:'other',visible:true,position:[4,64,0],health:20,note:null,item:null}]],
    ['unknown nearby entity',(f:WorldRequestFacts)=>f.decisionStability!.route!.entities=[{id:null,name:'unknown',kind:'other',visible:null,position:null,health:null,note:null,item:null}]],
    ['old sample',(f:WorldRequestFacts)=>f.decisionStability!.sampledAtMs-=3000],
    ['unknown position',(f:WorldRequestFacts)=>f.decisionStability!.position=null],
    ['guard lost',(f:WorldRequestFacts)=>delete f.decisionStability!.route],
  ] as const)('expires advice on %s even if its rendered summary did not change',async(_name,update)=>{
    expect((await choiceDuring(update)).result.status).toBe('stale');
  });
  it('keeps the conservative full-fact fallback for old producers and non-route categories',async()=>{
    const old=walkingFacts();delete old.decisionStability!.route;
    const move=(f:WorldRequestFacts)=>{f.parts=[...f.parts!,{key:'place',text:'前进2格'}];f.decisionStability!.position=[2,64,0];};
    expect((await choiceDuring(move,'route',old)).result.status).toBe('stale');
    expect((await choiceDuring(move,'survival')).result.status).toBe('stale');
  });
  it.each([
    ['ordinary walking',4,13,[],undefined,'advice',14],
    ['ordinary maximum for this elapsed time',4,15,[],undefined,'stale',undefined],
    ['normal upper cap',12,19,[],undefined,'advice',20],
    ['beyond normal upper cap',12,21,[],undefined,'stale',undefined],
    ['known risk tighter cap',4,4,['low-health'],undefined,'advice',5],
    ['beyond risk cap',4,6,['low-health'],undefined,'stale',undefined],
    ['configured normal range',8,17,[],{choiceMinBlocks:12,choiceMaxBlocks:18,dangerChoiceMaxBlocks:3},'advice',18],
    ['configured risk cap',8,4,['effect:poison'],{choiceMinBlocks:12,choiceMaxBlocks:18,dangerChoiceMaxBlocks:3},'stale',undefined],
  ] as const)('calculates dynamic advice tolerance: %s',async(_label,speed,dx,risks,policy,status,tolerance)=>{
    vi.useFakeTimers();const at=Date.now(),before=walkingFacts();
    before.decisionStability!.route!.speedBlocksPerSec=speed;
    before.decisionStability!.route!.risks=risks;
    if(policy)before.decisionStability!.route!.policy=policy;
    const {result}=await choiceDuring(facts=>{
      vi.setSystemTime(at+1000);facts.decisionStability!.sampledAtMs=Date.now();facts.decisionStability!.position=[dx,64,0];
      facts.parts=facts.parts!.map(part=>part.key==='place'?{...part,text:`walked ${dx}`} : part);
    },'route',before);
    expect(result.status).toBe(status);
    if(tolerance!==undefined)expect(result.routeTolerance.horizontalBlocks).toBe(tolerance);
  });
});
