import { DIRECTIONS, DIRECTION_ZH, type Direction } from '../../core/terrain.ts';
import { parseTypedChoice } from '../../core/support/typed-decision.ts';
import type { ToolDef, ToolOutcome, WorldHost, WorldRequestFacts } from './contracts.ts';

const headings = Object.keys(DIRECTIONS) as Direction[];
const schema = {
  type: 'object', additionalProperties: false, properties: {
    direction: { type: 'string', enum: headings, description: '大致探索方位；省略方向和终点时由快决策选方向。' },
    distance: { type: 'integer', minimum: 4, maximum: 256, description: '方位探索的距离（格），默认 32。' },
    at: { type: 'array', minItems: 2, maxItems: 3, items: { type: 'integer' }, description: '固定目的地 [x,z] 或精确落脚格 [x,y,z]；与方向、距离互斥。' },
    goal: { type: 'string', maxLength: 160, description: '本次探索意图，如寻找可落脚的林地。' },
  },
};
interface Destination { id: string; label: string; at: number[] }
type Parsed = { goal: string; destinations: Destination[] } | { error: string };
function candidates(value: unknown, position: readonly number[]): Parsed {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { error: 'explore 需要对象' };
  const v = value as Record<string, unknown>;
  if (Object.keys(v).some(k => !(k in schema.properties))
    || (v.goal !== undefined && (typeof v.goal !== 'string' || v.goal.length > 160)))
    return { error: 'explore 仅接受 goal、direction、distance 或 at' };
  const goal = typeof v.goal === 'string' && v.goal.trim() ? v.goal.trim() : '探查周边';
  if (v.at !== undefined) {
    if (v.direction !== undefined || v.distance !== undefined || !Array.isArray(v.at)
      || ![2,3].includes(v.at.length) || !v.at.every(Number.isSafeInteger)) return { error: '固定终点请单独给 at:[x,z] 或 [x,y,z]' };
    return { goal, destinations: [{ id:'destination', at:[...v.at], label:'前往指定位置 ' + v.at.join(',') }] };
  }
  const distance = v.distance ?? 32;
  if (typeof distance !== 'number' || !Number.isInteger(distance) || distance < 4 || distance > 256)
    return { error:'distance 需要 4 到 256 之间的整数格数' };
  if (v.direction !== undefined && !headings.includes(v.direction as Direction)) return { error:'direction 需要标准罗盘方位' };
  const directions: Direction[] = v.direction ? [v.direction as Direction] : ['north','east','south','west'];
  return { goal, destinations: directions.map(id => {
    const [x,z] = DIRECTIONS[id], length = Math.hypot(x,z);
    const at = [Math.floor(position[0]!) + Math.round(distance*x/length), Math.floor(position[2]!) + Math.round(distance*z/length)];
    return { id, at, label:DIRECTION_ZH[id] + '，约' + distance + '格，到 ' + at.join(',') };
  }) };
}
type Sample = NonNullable<WorldRequestFacts['decisionStability']>;
function available(f: WorldRequestFacts | null): Sample | null {
  const s = f?.decisionStability, r = s?.route;
  const action = f?.decision?.state.action as { task?:unknown; queued?:number } | undefined;
  if (!r || !s.dimension || !s.position?.every(Number.isFinite) || Date.now()-s.sampledAtMs > 15_000
    || s.sampledAtMs > Date.now()+1000 || !action || action.task !== null || action.queued !== 0
    || r.task || r.waiting.length || r.hold || r.fighting || r.environment || r.windowOpen || r.cursorOccupied) return null;
  return s;
}
function refused(reason: string, failed = true): ToolOutcome {
  return { text:reason, ...(failed ? { failed:true as const } : {}), data:{ status:'not_dispatched', executed:false } };
}

/** The chooser supplies one endpoint. The ordinary native body task owns every pathfinder waypoint and terminal. */
export function explorationActions(getHost: () => WorldHost | null, facts: () => WorldRequestFacts | null,
  getProvider: () => string | undefined) {
  let deciding = false;
  return (tool: ToolDef): ToolDef => {
    const properties = tool.parameters.properties as Record<string,unknown>;
    return { ...tool, description: tool.description + ' 自主探路可单独传 explore；系统一选方向或判断指定终点并直接提交寻路，只需一次调用。',
      parameters: { ...tool.parameters, required: [], properties: { ...properties, explore:schema } },
      handler: async (args,ctx) => {
        if (!Object.hasOwn(args,'explore')) return tool.handler(args,ctx);
        if (Object.keys(args).some(k=>k!=='explore')) return refused('探路单独传 explore，不混入 steps 或 queue。');
        const host=getHost(), initial=facts(), scene=available(initial);
        if (!scene) return refused('当前身体或位置未就绪；沿用现有动作。');
        const before=structuredClone(scene);
        if (!before.position || !before.route) return refused('当前缺少探路起点。');
        const intent=candidates(args.explore,before.position);
        if ('error' in intent) return refused(intent.error);
        if (deciding) return refused('上一条探路选择正在进行。');
        if (!host?.decisions) return refused('当前宿主没有快决策服务；可直接用 goto 前往指定位置。');
        deciding=true;
        let submitted=false;
        try {
          const timeout=AbortSignal.timeout(3500);
          const signal=ctx.signal ? AbortSignal.any([ctx.signal,timeout]) : timeout;
          signal.throwIfAborted();
          const options=Object.fromEntries(intent.destinations.map(d=>[d.id,d.label]));
          const criteria={...options,hold:'当前条件需要先处理别的事情，暂缓出发'};
          const terrain=initial?.parts?.find(p=>p.key==='terrain')?.text.slice(0,450) ?? null;
          const request=host.decisions.request({state:{ goal:intent.goal, origin:before.position, dimension:before.dimension,
            terrain, risks:before.route.risks, health:before.health, destinations:intent.destinations },
            questions:{ action:{type:'choice',instructions:'根据探索意图和实测地形选择一个方向或终点。未观测地区由寻路器探索；有当前阻碍需处理才暂缓。',criteria} } },
            {provider:getProvider(),timeoutMs:3500,signal,correlationId:ctx.callId});
          let cancel: () => void = () => {};
          const abort = new Promise<never>((_,reject)=>{ cancel=()=>reject(signal.reason);signal.addEventListener('abort',cancel,{once:true});if(signal.aborted)cancel(); });
          const result=await Promise.race([request,abort]).finally(()=>signal.removeEventListener('abort',cancel));
          const choice=parseTypedChoice(result.answers.action,Object.keys(criteria));
          if (!choice) return refused('系统一返回了无效方向，尚未出发。');
          if (choice.choice==='hold') return refused('系统一选择暂缓；身体没有出发。',false);
          const endpoint=intent.destinations.find(d=>d.id===choice.choice)!;
          const now=available(facts());
          if (signal.aborted || getHost()!==host || !now?.position || !now.route || now.dimension!==before.dimension
            || JSON.stringify(now.identity)!==JSON.stringify(before.identity) || now.route.generation!==before.route.generation
            || now.route.positionEpoch!==before.route.positionEpoch || JSON.stringify(now.route.risks)!==JSON.stringify(before.route.risks)
            || Math.hypot(...now.position.map((x,i)=>x-before.position![i]!))>1.5)
            return refused('选择期间位置、连接或身体状态已改变；旧目的地未提交。');
          const info={ choice:choice.choice, at:endpoint.at, origin:before.position, dimension:before.dimension, model:result.model??null };
          submitted=true;
          const reply=await tool.handler({steps:[{skill:'goto',at:endpoint.at,dimension:before.dimension,
            ...(endpoint.at.length===3 ? {exact:true} : {})}],queue:'append',explorationOrigin:{
              position:before.position,dimension:before.dimension,generation:before.route.generation,epoch:before.route.positionEpoch
            }}, {...ctx,attribution:{...ctx.attribution,controller:'system1'}});
          const outcome=typeof reply==='string' ? {text:reply} : reply;
          return {...outcome,text:'快决策选择 '+endpoint.label+'。'+outcome.text,
            data:{...outcome.data,exploration:info}};
        } catch (error) {
          const reason=error instanceof Error ? error.message : String(error);
          if (submitted) return {text:'寻路受理回执中断，请核对现有任务后再决定是否重试。'+reason,
            failed:true,data:{status:'admission_unknown',executed:null}};
          return refused('系统一选路未完成：'+reason);
        } finally { deciding=false; }
      } };
  };
}
