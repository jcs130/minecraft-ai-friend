/** Bounded movement recipes use the existing executor, never a second physics/controller loop. */
const cell = { type: 'array', items: { type: 'integer', minimum: -30_000_000, maximum: 30_000_000 }, minItems: 3, maxItems: 3 };
const shared = {
  dimension: { type: 'string', pattern: '^[a-z0-9_:./-]+$', minLength: 1, maxLength: 96 },
  minHealth: { type: 'number', minimum: 0, maximum: 1000, description: 'Stop below observed health; default 6.' },
};
const route = { type: 'array', items: cell, minItems: 1, maxItems: 8 };

const COMMON = String.raw`
let state = await mc.state();
const initial = state;
const records = [];
const dim = value => String(value).replace(/^minecraft:/, '');
const position = s => s && s.snapshot && s.snapshot.position;
const valid = p => p && [p.x,p.y,p.z].every(Number.isFinite);
const distance = (a,b) => Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
const center = at => ({x:at[0]+0.5,y:at[1],z:at[2]+0.5});
const unsafe = () => {
  if (!state || !state.snapshot || !valid(position(state))) return 'observation_unavailable';
  if (state.connectionGeneration !== initial.connectionGeneration) return 'connection_changed';
  if (dim(state.snapshot.dimension) !== dim(params.dimension)) return 'dimension_mismatch';
  if (state.bodyRestriction) return 'body_restricted';
  if (state.combatActive) return 'combat_active';
  if (!Number.isFinite(state.snapshot.health)) return 'health_unknown';
  if (state.snapshot.health <= 0) return 'dead';
  if (state.snapshot.health < (params.minHealth === undefined ? 6 : params.minHealth)) return 'low_health';
  return null;
};
const finish = (reason, remaining, extra = {}) => {
  const changed = records.some(r => r.changed);
  return {schema:'agent-mc.work/v1',routine:ROUTINE_ID,version:1,
    outcome:reason?(changed?'partial':'blocked'):(changed?'completed':'noop'),
    goalCompleted:!reason,reason:reason||null,remaining,records,inventoryDelta:null,
    startedAt:initial.sampledAt,sampledAt:state && state.sampledAt,
    connectionGeneration:initial.connectionGeneration,dimension:params.dimension,
    position:position(state),movement:state && state.movement,...extra};
};
const record = (at,from,group,met) => {
  const to = position(state);
  records.push({at,from,to,sampledAt:state && state.sampledAt,taskId:group.taskId,
    outcome:group.done && met?'ok':group.done?'progress':'blocked',
    changed:valid(to) && distance(from,to)>0.05,
    movement:state && state.movement,receipt:String(group.receipt||'').slice(0,400)});
};
let stop = unsafe();
if (stop) return finish(stop,params.waypoints || [params.at]);
`;

const WALK = `const ROUTINE_ID = 'navigate_route';\n` + COMMON + String.raw`
for (let i=0;i<params.waypoints.length;i++) {
  const at = params.waypoints[i];
  const matches = () => { const p=position(state); return valid(p) && [Math.floor(p.x),Math.floor(p.y),Math.floor(p.z)].every((n,j)=>n===at[j]); };
  if (matches()) { records.push({at,outcome:'noop',changed:false,reason:'already_at_waypoint'}); continue; }
  const from = position(state);
  const group = await mc.do([{skill:'goto',at,dimension:params.dimension,exact:true,walkOnly:params.walkOnly!==false}]);
  state = group.state;
  stop = unsafe();
  const met = !stop && matches();
  record(at,from,group,met);
  if (stop || !group.done || !met) return finish(stop || (!group.done?'operation_blocked':'arrival_unconfirmed'),params.waypoints.slice(i));
}
return finish(null,[]);
`;

const SWIM = `const ROUTINE_ID = 'swim_to';\n` + COMMON + String.raw`
const target = center(params.at), within = params.within===undefined?0.8:params.within;
const arrived = () => valid(position(state)) && distance(position(state),target)<=within;
const waterStop = () => {
  const w=state.movement;
  if (!w || w.bodyWet===null || w.headWet===null) return 'water_state_unknown';
  if (w.vehicleAttached) return 'vehicle_attached';
  if (!w.bodyWet) return 'not_in_water';
  if (!Number.isFinite(w.yaw)) return 'heading_unknown';
  if (w.headWet && w.oxygen===null) return 'oxygen_unknown';
  if (w.headWet && w.oxygen<=(params.minOxygen===undefined?8:params.minOxygen)) return 'low_oxygen';
  return null;
};
stop=waterStop();
if (stop) return finish(stop,[params.at]);
if (arrived()) return finish(null,[]);
const block=await bot.blockAt(new Vec3(...params.at));
if (!block) return finish('target_unobserved',[params.at]);
if (!['water','bubble_column','kelp','kelp_plant','seagrass','tall_seagrass'].includes(block.name)) return finish('target_not_water',[params.at]);
let stalled=0;
for (let i=0;i<(params.maxPulses===undefined?12:params.maxPulses);i++) {
  stop=unsafe() || waterStop();
  if (stop) return finish(stop,[params.at]);
  const from=position(state), beforeDistance=distance(from,target);
  const dx=target.x-from.x,dz=target.z-from.z;
  const desired=Math.atan2(-dx,-dz), delta=desired-state.movement.yaw;
  const yawDeg=Math.atan2(Math.sin(delta),Math.cos(delta))*180/Math.PI;
  const keys=[];
  if (Math.hypot(dx,dz)>0.3) keys.push('forward');
  if (target.y-from.y>0.2) keys.push('jump');
  const group=await mc.do([{skill:'control',mode:'water',keys,
    ...(keys.includes('forward')?{yawDeg}:{}),durationMs:params.pulseMs===undefined?500:params.pulseMs}]);
  state=group.state;
  stop=unsafe();
  const met=!stop && arrived();
  record(params.at,from,group,met);
  if (stop || !group.done) return finish(stop || 'operation_blocked',[params.at]);
  if (met) return finish(null,[]);
  stop=waterStop();
  if (stop) return finish(stop,[params.at]);
  stalled=beforeDistance-distance(position(state),target)<0.05?stalled+1:0;
  if (stalled>=3) return finish('no_progress',[params.at]);
}
return finish('pulse_budget_exhausted',[params.at]);
`;

const FLIGHT = `const ROUTINE_ID = 'flight_route';\n` + COMMON + String.raw`
if (!state.flight || state.flight.allowed!==true) return finish('flight_not_allowed',params.waypoints);
const points=params.waypoints.map((at,i)=>({at,land:i===params.waypoints.length-1 && params.land!==false}));
const plan=await mc.flightPlan({points,subdivide:true,...(params.budgetMs===undefined?{}:{budgetMs:params.budgetMs})});
const planning={sampledAt:plan.sampledAt,from:plan.from,estimatedDurationMs:plan.estimatedDurationMs,
  fitsBudget:plan.fitsBudget,endsOnSupport:plan.endsOnSupport,reason:plan.reason||null};
if (!plan.complete || !Array.isArray(plan.steps) || !plan.steps.length) return finish(plan.fitsBudget===false?'flight_budget_insufficient':'flight_plan_blocked',params.waypoints,{planning});
if (plan.steps.length>16) return finish('flight_leg_budget_exceeded',params.waypoints,{planning});
const remaining=i=>plan.steps.slice(i).map(s=>({at:s.at,land:s.land}));
for (let i=0;i<plan.steps.length;i++) {
  stop=unsafe();
  if (stop || !state.flight || state.flight.allowed!==true) return finish(stop || 'flight_permission_lost',remaining(i),{planning});
  const step=plan.steps[i],from=position(state);
  const group=await mc.do([{skill:'flight',at:step.at,land:step.land}]);
  state=group.state;
  stop=unsafe();
  const p=position(state),target=center(step.at);
  const near=valid(p) && distance(p,target)<=0.7;
  const met=!stop && near && (step.land===false || (state.movement && state.movement.onGround===true && state.flight && state.flight.flying===false));
  record(step.at,from,group,met);
  if (stop || !group.done || !met) return finish(stop || (!group.done?'operation_blocked':'arrival_unconfirmed'),remaining(i),{planning});
}
return finish(null,[],{planning});
`;

const SWIM_ROUTE = `const ROUTINE_ID = 'swim_route';\n` + COMMON + String.raw`
const from=position(state);
const group=await mc.do([{skill:'swim',at:params.at,dimension:params.dimension,
  reserveOxygen:params.reserveOxygen===undefined?6:params.reserveOxygen,maxDurationMs:params.maxDurationMs===undefined?45000:params.maxDurationMs}]);
state=group.state;stop=unsafe();
const route=state && state.lastSwim && state.lastSwim.taskId===group.taskId?state.lastSwim:null;
const met=!stop && group.done && route && route.complete===true && distance(position(state),center(params.at))<=0.8;
record(params.at,from,group,met);
return finish(met?null:stop || (route && route.reason) || 'arrival_unconfirmed',met?[]:[params.at],{route});
`;

const RIDE_ROUTE = `const ROUTINE_ID = 'ride_route';\n` + COMMON + String.raw`
const mounted=()=>state.snapshot && state.snapshot.vehicle;
const vehicle=()=>{const v=mounted();return v && v.entityId===params.entityId;};
if(mounted() && !vehicle())return finish('different_vehicle_attached',params.waypoints);
if(!vehicle()) {
  const from=position(state),group=await mc.do([{skill:'ride',target:params.target,entityId:params.entityId}]);
  state=group.state;stop=unsafe();record(null,from,group,!stop && vehicle());
  if(stop || !group.done || !vehicle())return finish(stop || 'mount_unconfirmed',params.waypoints);
}
for(let i=0;i<params.waypoints.length;i++) {
  const at=params.waypoints[i],from=position(state);
  const group=await mc.do([{skill:'ride',to:at}]);state=group.state;stop=unsafe();
  const v=mounted(),p=v && v.position;
  const met=!stop && vehicle() && valid(p) && Math.hypot(p.x-at[0]-0.5,p.z-at[2]-0.5)<=2.5;
  record(at,from,group,met);
  if(stop || !group.done || !met)return finish(stop || 'vehicle_arrival_unconfirmed',params.waypoints.slice(i));
}
if(params.dismountAtEnd===true) {
  const from=position(state),group=await mc.do([{skill:'ride',off:true}]);state=group.state;stop=unsafe();
  record(null,from,group,!mounted());
  if(stop || !group.done || mounted())return finish(stop || 'dismount_unconfirmed',[]);
}
return finish(null,[],{vehicle:mounted()});
`;

const PORTAL_ROUTE = `const ROUTINE_ID = 'portal_route';let expectedDimension=params.dimension;\n`
  + COMMON.replace('dim(params.dimension)','dim(expectedDimension)').replace('params.waypoints || [params.at]','params.portals')
    .replace('dimension:params.dimension','dimension:state && state.snapshot && state.snapshot.dimension') + String.raw`
for(let i=0;i<params.portals.length;i++) {
  const portal=params.portals[i];
  if(dim(state.snapshot.dimension)!==dim(portal.fromDimension))return finish('portal_origin_dimension_mismatch',params.portals.slice(i));
  const from=position(state),group=await mc.do([{skill:'transit',at:portal.at}]);
  state=group.state;expectedDimension=portal.toDimension;stop=unsafe();
  const met=!stop && group.done && (dim(portal.fromDimension)!==dim(portal.toDimension) || distance(from,position(state))>64);
  record(portal.at,from,group,met);
  if(stop || !group.done || !met)return finish(stop || 'portal_transition_unconfirmed',params.portals.slice(i));
}
return finish(null,[]);
`;

export const MOVEMENT_ROUTINES = [
  { id:'navigate_route',title:'多路点行走',description:'一次提交依次到达的绝对落脚格；每段以实际三维位置核验，失败保留剩余路段。',
    conditions:['最多8个路点，可重复路点组成巡逻或往返；不自动无限巡逻',
      'walkOnly默认true；false才允许现有寻路器按服务器权限挖路或垫脚',
      '水面通路和连续梯子由现有寻路器处理；水下主动下潜改用swim_to；跨维度先显式transit'],
    parameters:{type:'object',additionalProperties:false,properties:{...shared,waypoints:route,walkOnly:{type:'boolean'}},required:['dimension','waypoints']},code:WALK },
  { id:'swim_to',title:'短程定点游泳',description:'按真实朝向和位置闭环转向、划水、上浮或自然下沉；监测氧气与卡住，不把输入结束当到达。',
    conditions:['身体已入水、未乘船；目标是已观察到的水格，按脚底格中心和三维距离判断',
      '不是水下A*；不绕未知洞穴、不穿墙，不保证一次到达；默认12次500ms输入，最多12次1000ms',
      '头部浸水时氧气未知或低于阈值停止；low_oxygen后优先用surface换气登岸，不能原参反复重试'],
    parameters:{type:'object',additionalProperties:false,properties:{...shared,at:cell,
      within:{type:'number',minimum:0.5,maximum:2},pulseMs:{type:'integer',minimum:200,maximum:1000},
      maxPulses:{type:'integer',minimum:1,maximum:12},minOxygen:{type:'integer',minimum:6,maximum:19}},required:['dimension','at']},code:SWIM },
  { id:'flight_route',title:'分段飞行',description:'复用已有几何/期限试算，自动拆成12格内航段；逐段核验，末段默认安全落地。',
    conditions:['必须已有服务端飞行权限；不施法、不提权，不是鞘翅或模组载具飞控',
      '最多8个路点和16个编译航段；路径须已加载、无碰撞，预算不足不出发',
      'land:false末段悬停；失败时返回当前flight/movement状态，不能把取消当自动落地或自动重试'],
    parameters:{type:'object',additionalProperties:false,properties:{...shared,waypoints:route,land:{type:'boolean'},
      budgetMs:{type:'integer',minimum:1,maximum:120000}},required:['dimension','waypoints']},code:FLIGHT },
  {id:'swim_route',title:'水下绕障',description:'一次请求在已加载水域内三维寻路、绕障并换气；保存实际输入、重算和耗时指标。',
    conditions:['最多32格，六向邻接不跳过中间方块；不加载未知区块或拆方块',
      '规划氧气预算且实际换气后才继续下潜；失败不自动重放整条路线'],
    parameters:{type:'object',additionalProperties:false,properties:{...shared,at:cell,reserveOxygen:{type:'integer',minimum:6,maximum:16},
      maxDurationMs:{type:'integer',minimum:1000,maximum:90000}},required:['dimension','at']},code:SWIM_ROUTE},
  {id:'ride_route',title:'指定载具多路点',description:'按当前连接实体ID上车并串联最多8个水平目的地，核验同一坐骑实际位置。',
    conditions:['支持现有ride能驾驶的原版船/猪/炽足兽；不声称模组飞机可用',
      '坐骑身份变化立即停止；默认不下车，dismountAtEnd:true才明确下车；Y不作为驾驶到达条件'],
    parameters:{type:'object',additionalProperties:false,properties:{...shared,waypoints:route,target:{type:'string',minLength:1,maxLength:80,pattern:'^[a-z0-9_]+$'},
      entityId:{type:'integer',minimum:0,maximum:2147483647},dismountAtEnd:{type:'boolean'}},required:['dimension','waypoints','target','entityId']},code:RIDE_ROUTE},
  {id:'portal_route',title:'连续穿门',description:'串联最多4次明确的穿门，按每段起始/目标维度与实际位置核验，传错维度立即停止。',
    conditions:['fromDimension/toDimension由当前世界实际路线给出，不猜坐标缩放或未发现的传送门',
      '同维度仅接受transit实测的大于64格折跃；不自动重复穿门'],
    parameters:{type:'object',additionalProperties:false,properties:{...shared,portals:{type:'array',minItems:1,maxItems:4,items:{type:'object',additionalProperties:false,
      properties:{at:cell,fromDimension:shared.dimension,toDimension:shared.dimension},required:['at','fromDimension','toDimension']}}},required:['dimension','portals']},code:PORTAL_ROUTE},
];
