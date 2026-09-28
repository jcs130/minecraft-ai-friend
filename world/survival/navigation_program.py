"""One explicitly selected, bounded navigation program; no planner or world IO."""
import copy

NAME = 'base_navigate'
MOTION_NAME = 'base_motion_plan'


def bind_motion_choice(plan, action):
    """Bind Jev's exact offered goto to the next receipt expectation."""
    choice = plan.get('choose') or {}
    memory = plan.get('memory') or {}
    offered = [row.get('action') for row in choice.get('candidates', [])
               if isinstance(row, dict) and row.get('action') is not None]
    if (memory.get('policy') is not True or memory.get('stage') != 'selecting'
            or not isinstance(action, dict) or action.get('tool') != 'goto'
            or action not in offered or not isinstance(action.get('args'), dict)):
        raise ValueError('motion_policy_choice_unbound')
    bound = copy.deepcopy(plan)
    bound['memory'].update(stage='moving', segment=copy.deepcopy(action['args']))
    bound['action'] = copy.deepcopy(action)
    return bound


def recovery_program(library, job):
    """Only a promoted, currently tested explicit return intent gets this lane.

    This is admission, not authority to move: every proposed step still passes
    the executor's goto-only check and the gateway's fresh inward-area preflight.
    """
    if (library is None or job.get('name') != NAME
            or not isinstance(job.get('memory'), dict)
            or job['memory'].get('mode') != 'return_to_work_area'):
        return False
    record = library.read(job['name'], job['version'])
    if record.get('promoted') is not True or record.get('version') != job['version']:
        return False
    library._tested(job['name'], job['version'])
    return True


SOURCE = '''
function next(s,m) {
  const stop=why=>({action:null,memory:m,replan:true,reason:why});
  const point=p=>p&&["x","y","z"].every(k=>Number.isFinite(p[k]));
  const horizontal=p=>p&&["x","z"].every(k=>Number.isFinite(p[k]));
 const distance=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
 const distinct=rows=>{
  const result=[];
  // Neighbouring stances on the same level are one route choice for Jev.
  // They remain available on the next survey if the first exact goto fails.
  for(const c of rows) if(result.every(x=>distance(x,c)>2.5||Math.abs(x.y-c.y)>0.25)) result.push(c);
  return result;
 };
 const area=s.workArea||{}, p=s.position, e=(s.execution||{}).lastExecution||{};
 const control=s.bodyControl||{}, epoch=(typeof s.navigationEpoch==="string"&&s.navigationEpoch)||null;
 const observedAt=(s.execution||{}).observedAt||s.observedAt;
 const inside=p=>p.x>=area.minX&&p.x<=area.maxX&&p.z>=area.minZ&&p.z<=area.maxZ;
 const gap=p=>Math.hypot(Math.max(area.minX-p.x,0,p.x-area.maxX),Math.max(area.minZ-p.z,0,p.z-area.maxZ));
 const returning=m.mode==="return_to_work_area";
 if(s.ok!==true||!point(p)||!s.bodyUuid||!s.dimension||
    !s.task||s.task.busy!==false) return stop("navigation_body_unavailable");
 if(!["minX","maxX","minZ","maxZ"].every(k=>Number.isFinite(area[k]))||
    area.maxX-area.minX<4||area.maxZ-area.minZ<4) return stop("navigation_area_unavailable");
 if(control.available!==true||control.actorUuid!==s.bodyUuid||control.dimension!==s.dimension||
    !["gameTime","bodyTickCount","observedAt"].every(k=>Number.isSafeInteger(control[k])&&control[k]>=0)||
    !Number.isFinite(observedAt)||Math.abs(observedAt-control.observedAt)>15000)
   return stop("navigation_body_continuity_unavailable");
 if(m.identity&&(m.identity.bodyUuid!==s.bodyUuid||m.identity.dimension!==s.dimension||
    m.identity.epoch!==epoch)) return stop("navigation_body_changed");
 if(m.identity&&["gameTime","bodyTickCount","observedAt"].some(k=>
    !Number.isSafeInteger(m.identity[k])||control[k]<m.identity[k]))
   return stop("navigation_body_continuity_lost");
 m={...m,identity:{bodyUuid:s.bodyUuid,dimension:s.dimension,epoch:epoch,
                  gameTime:control.gameTime,bodyTickCount:control.bodyTickCount,observedAt:control.observedAt}};
 if(m.policy===true) {
   if(!Array.isArray(m.waypoints)||
      (m.singleGoal===true?m.waypoints.length!==1:m.waypoints.length<2||m.waypoints.length>6)||
      !Number.isSafeInteger(m.index||0)||(m.index||0)<0||(m.index||0)>=m.waypoints.length||
      !m.waypoints.every(w=>horizontal(w)&&(!Object.prototype.hasOwnProperty.call(w,"y")||Number.isFinite(w.y))&&inside(w)))
     return stop("invalid_motion_waypoints");
   m={...m,index:m.index||0,target:m.waypoints[m.index||0]};
 }
 if(!m.target&&returning) m.target={x:Math.max(area.minX+2,Math.min(area.maxX-2,p.x)),
                                   y:p.y,z:Math.max(area.minZ+2,Math.min(area.maxZ-2,p.z))};
  const t=m.target;
  const hasY=t&&Object.prototype.hasOwnProperty.call(t,"y"), ground=!returning&&!hasY;
  if(!horizontal(t)||(hasY&&!Number.isFinite(t.y))||!inside(t)) return stop("known_in_area_target_required");
  // Intermediate waypoints describe a corridor, not an exact final stance.
  // Accept a nearby supported stance, then survey the next leg. The final
  // destination still requires the original 1.5-block arrival proof.
  const intermediate=m.policy===true&&m.index+1<m.waypoints.length;
  const tolerance=intermediate?3:1.5;
  const arrived=(returning&&inside(p))||(!returning&&distance(p,t)<=tolerance&&(ground||Math.abs(p.y-t.y)<=1.5));
  const advance=reason=>{
   if(m.policy===true&&m.index+1<m.waypoints.length) {
     m={...m,index:m.index+1,target:m.waypoints[m.index+1],stage:null,probe:null,
        probeAttempt:0,probeSpan:null,detour:false,detours:0,detourVisited:[],
        lastFailedSegment:null,failedSegments:0};
     return next(s,m);
   }
   if(m.policy===true&&m.continueWhileThinking===true&&m.continuationUsed!==true) {
     const env=s.environment||{}, stamp=env.observedAt;
     if(s.onGround!==true||s.inWater===true||s.inLava===true||s.hp<=8||s.hunger<=4||
        env.ok!==true||env.bodyUuid!==s.bodyUuid||!Number.isFinite(stamp)||
        !Number.isFinite(s.observedAt)||Math.abs(s.observedAt-stamp)>5000||
        !Array.isArray(env.hostiles)||env.hostiles.length>0)
       return {action:null,memory:m,done:true,reason:"motion_continuation_not_safe"};
     const back=[...m.waypoints.slice(0,-1)].reverse();
     if(back.length<2) back.push(m.waypoints[m.waypoints.length-1]);
     else if(back.length<=3) back.push(...m.waypoints.slice(1,1+6-back.length));
     m={...m,continuationUsed:true,waypoints:back,index:0,target:back[0],
        stage:null,probe:null,probeAttempt:0,probeSpan:null,detour:false,
        detours:0,detourVisited:[],lastFailedSegment:null};
     return next(s,m);
   }
   return {action:null,memory:m,done:true,reason:reason};
  };
 if(m.stage==="moving") {
   const expected=(s.execution||{}).expectedAction||{};
   if(!["succeeded","failed"].includes(e.status)||e.completionConfirmed!==true||e.tool!=="goto"||
      typeof e.actionId!=="string"||!e.actionId||!e.turnId||e.actionId===m.lastActionId||
      expected.turnId!==e.turnId||expected.actionId!==e.actionId||expected.tool!=="goto"||
      !point(expected.args)||!point(m.segment)||!["x","y","z"].every(k=>expected.args[k]===m.segment[k]))
     return stop("navigation_completion_not_confirmed");
   const sideways=m.detour===true;
   if(e.status==="failed") {
     const result=e.navigationOutcome||{};
     if(s.onGround!==true||s.inWater===true||s.inLava===true||
        result.success!==false||!Number.isFinite(result.final_x)||
        !Number.isFinite(result.final_y)||!Number.isFinite(result.final_z)||
        Math.hypot(p.x-result.final_x,p.z-result.final_z)>1.5||
        Math.abs(p.y-result.final_y)>1.5||
        !point(m.before)||
        (distance(p,m.before)>1.5&&distance(m.before,t)-distance(p,t)<0.5)||
        (m.failedSegments||0)>=2)
       return stop("navigation_failed_segment_no_safe_progress");
     m={...m,stage:null,probe:null,probeAttempt:0,probeSpan:null,
        lastActionId:e.actionId,failedSegments:(m.failedSegments||0)+1,
        lastFailedSegment:{...m.segment},segments:(m.segments||0)+1,detour:false,
        sideProbeAfterFailure:m.policy===true&&distance(p,m.before)<=1.5&&
                              (m.detours||0)<2};
   } else {
   if(!arrived&&(!point(m.before)||distance(p,m.before)<=1.5||
      (!sideways&&distance(m.before,t)-distance(p,t)<0.5)||
      (sideways&&(distance(p,t)>distance(m.before,t)+6.5||
                  !point(m.segment)||distance(p,m.segment)>2.5||Math.abs(p.y-m.segment.y)>1.5))))
     return stop("navigation_progress_not_observed");
   m={...m,stage:null,probe:null,probeAttempt:0,probeSpan:null,lastActionId:e.actionId,
      segments:(m.segments||0)+1,detour:false,
      sideProbeAfterFailure:false,sideProbeFallback:false,
      detours:(m.detours||0)+(sideways?1:0),
      detourVisited:sideways?[...(Array.isArray(m.detourVisited)?m.detourVisited:[]),m.before].slice(-4):m.detourVisited};
   }
 }
  const readSurvey=()=>{
   const obs=(s.execution||{}).observation, r=(obs||{}).result||{}, n=r.navigationSense||{};
   const dest=n.destination||{};
   if(!obs||obs.tool!=="navigation_sense"||!obs.fresh||obs.ageMs>5000||r.ok!==true||n.ok!==true||
      n.actorUuid!==s.bodyUuid||n.dimension!==s.dimension||!point(n.position)||distance(n.position,p)>1.5||
      Math.abs(n.position.y-p.y)>1.5||!Number.isFinite(n.observedAt)||
      !Number.isFinite((s.execution||{}).observedAt)||Math.abs(s.execution.observedAt-n.observedAt)>5000||
      !point(obs.args)||!point(m.probe)||!["x","y","z"].every(k=>obs.args[k]===m.probe[k])||
      !point(dest.requested)||!["x","y","z"].every(k=>dest.requested[k]===m.probe[k])||
      dest.available!==true||dest.pathVerified!==false) return null;
   return n;
  };
  if(ground&&m.stage==="arrival_survey"&&!arrived) return stop("navigation_arrival_position_changed");
  if(arrived&&ground) {
   if(m.stage!=="arrival_survey")
    return {memory:{...m,stage:"arrival_survey",probe:{...p}},observe:{tool:"navigation_sense",args:{...p}}};
   const n=readSurvey(), dest=(n||{}).destination||{};
   if(!n||distance(m.probe,p)>0.01||Math.abs(m.probe.y-p.y)>0.01||
      distance(n.position,p)>0.01||Math.abs(n.position.y-p.y)>0.01||
      s.inWater===true||s.inLava===true||dest.requestedStanceClear!==true||dest.requestedStanceSupported!==true)
     return stop("navigation_arrival_stance_unconfirmed");
   return advance("observed_horizontal_supported_target");
  }
  if(arrived)
   return advance(returning?"observed_inside_work_area":"observed_navigation_target");
  const d=distance(p,t);
  if(d<=1.5) return stop("navigation_vertical_route_required");
  const surveyAt=(span,attempt)=>{
   const probe={x:p.x+(t.x-p.x)*span/d,y:p.y,z:p.z+(t.z-p.z)*span/d};
   return {memory:{...m,stage:"survey",probe:probe,probeSpan:span,probeAttempt:attempt,detour:false},
           observe:{tool:"navigation_sense",args:probe}};
  };
  const lateralAt=side=>{
   const probe={x:p.x-side*(t.z-p.z)*6/d,y:p.y,z:p.z+side*(t.x-p.x)*6/d};
   if(!inside(probe)) return null;
   return {memory:{...m,stage:side===1?"detour_left":"detour_right",probe:probe},
           observe:{tool:"navigation_sense",args:probe}};
  };
  if(m.sideProbeAfterFailure===true) {
   m={...m,sideProbeAfterFailure:false,sideProbeFallback:true};
   const side=lateralAt(1)||lateralAt(-1);
   if(side) return side;
   m={...m,sideProbeFallback:false};
  }
  if(m.stage==="detour_left"||m.stage==="detour_right") {
   if(m.policy!==true) return stop("motion_policy_required");
   const n=readSurvey();
   if(!n) return stop("navigation_survey_unusable");
   const dest=n.destination;
   const candidates=(dest.candidates||[]).slice(0,5).filter(point).map(c=>({x:c.x,y:c.y,z:c.z}));
   if(dest.requestedStanceClear===true&&dest.requestedStanceSupported===true) candidates.push({...m.probe});
   const seen=Array.isArray(m.detourVisited)?m.detourVisited.filter(point):[];
   const usable=candidates.filter(c=>inside(c)&&distance(p,c)>2&&distance(p,c)<=10&&
     Math.abs(c.y-p.y)<=3&&distance(c,t)<=d+6&&
     !seen.some(previous=>distance(previous,c)<2)&&
     (!point(m.lastFailedSegment)||distance(c,m.lastFailedSegment)>2));
   usable.sort((a,b)=>distance(a,t)-distance(b,t));
   if(usable.length) {
    const options=distinct(usable).slice(0,3).map((c,i)=>({id:"path_"+i,
      description:"Fresh surveyed supported lateral detour toward waypoint "+(m.index+1)+": "+JSON.stringify(c),
      action:{tool:"goto",args:c}}));
    options.push({id:"replan",description:"No lateral step is appropriate; stop for slow replanning",action:null});
    return {memory:{...m,stage:"selecting",before:{...p},detour:true},choose:{
      question:"Choose one safe supported lateral detour or stop. Avoid hazards and revisiting a recent position.",
      candidates:options,context:{waypoint:m.index+1,total:m.waypoints.length,target:t,detours:m.detours||0}}};
   }
   if(m.stage==="detour_left") {
    const right=lateralAt(-1);
    if(right) return right;
   }
   if(m.sideProbeFallback===true) {
    m={...m,sideProbeFallback:false};
    return surveyAt(Math.min(16,d),0);
   }
   return stop("navigation_no_supported_progress");
  }
  if(m.stage!=="survey") {
   return surveyAt(Math.min(16,d),0);
 }
  const n=readSurvey();
  if(!n) return stop("navigation_survey_unusable");
  const dest=n.destination;
 const candidates=(dest.candidates||[]).slice(0,5).filter(point).map(c=>({x:c.x,y:c.y,z:c.z}));
 if(dest.requestedStanceClear===true&&dest.requestedStanceSupported===true) candidates.push({...m.probe});
 const usable=candidates.filter(c=>distance(p,c)>(d<=3?1.5:2)&&distance(p,c)<=20&&
   Math.abs(c.y-p.y)<=5&&distance(c,t)<d-0.5&&(inside(p)?inside(c):gap(c)<gap(p)-0.5));
 const freshUsable=usable.filter(c=>!point(m.lastFailedSegment)||distance(c,m.lastFailedSegment)>2);
 freshUsable.sort((a,b)=>distance(a,t)-distance(b,t));
  if(!freshUsable.length) {
   const attempt=m.probeAttempt===undefined?0:m.probeAttempt;
   const span=m.probeSpan===undefined?distance(p,m.probe):m.probeSpan;
   const shorter=Math.min(d,span/2);
   if(Number.isSafeInteger(attempt)&&attempt>=0&&attempt<2&&Number.isFinite(span)&&span<=16.01&&
      shorter>1.5&&shorter<span-0.01) {
    const next=surveyAt(shorter,attempt+1);
    if(distance(next.observe.args,m.probe)>0.01||Math.abs(next.observe.args.y-m.probe.y)>0.01) return next;
   }
   if(m.policy===true&&Number.isSafeInteger(m.detours||0)&&(m.detours||0)<2) {
    const side=lateralAt(1)||lateralAt(-1);
    if(side) return side;
   }
   return stop("navigation_no_supported_progress");
  }
 if(m.policy===true) {
   const options=distinct(freshUsable).slice(0,3).map((c,i)=>({id:"path_"+i,
      description:"Fresh surveyed supported next segment toward waypoint "+(m.index+1)+
        ": "+JSON.stringify(c)+"; remaining horizontal distance "+distance(c,t).toFixed(1),
      action:{tool:"goto",args:c}}));
   options.push({id:"replan",description:"No candidate is appropriate; stop this plan for slow replanning",action:null});
   return {memory:{...m,stage:"selecting",before:{...p}},choose:{
      question:"Choose a freshly surveyed safe segment that advances toward this waypoint. Escalate if the present body or route looks unsafe.",
      candidates:options,context:{waypoint:m.index+1,total:m.waypoints.length,target:t}}};
 }
 return {memory:{...m,stage:"moving",before:{...p},segment:freshUsable[0]},
         action:{tool:"goto",args:freshUsable[0]}};
}
'''


def record():
    state = {'ok': True, 'bodyUuid': 'navigation-fixture', 'dimension': 'minecraft:overworld',
             'navigationEpoch': None, 'observedAt': 1000000, 'task': {'busy': False},
             'bodyControl': {'available': True, 'actorUuid': 'navigation-fixture', 'dimension': 'minecraft:overworld',
                             'observedAt': 1000000, 'gameTime': 35364424, 'bodyTickCount': 33487},
             'position': {'x': 200, 'y': 64, 'z': 100},
             'workArea': {'minX': 64, 'maxX': 160, 'minZ': 64, 'maxZ': 160}}
    probe = {'x': 184, 'y': 64, 'z': 100}
    memory = {'mode': 'return_to_work_area', 'stage': 'survey', 'target': {'x': 158, 'y': 64, 'z': 100},
              'probe': probe, 'identity': {'bodyUuid': state['bodyUuid'], 'dimension': state['dimension'],
                                          'epoch': None, 'gameTime': 35364424, 'bodyTickCount': 33487,
                                          'observedAt': 1000000}}
    observed = copy.deepcopy(state)
    observed['execution'] = {'observedAt': 1000250, 'observation': {'tool': 'navigation_sense', 'args': probe, 'fresh': True, 'ageMs': 250,
        'result': {'ok': True, 'navigationSense': {'ok': True, 'actorUuid': state['bodyUuid'],
            'dimension': state['dimension'], 'position': state['position'], 'observedAt': 1000000,
            'destination': {'available': True, 'requested': probe, 'pathVerified': False,
                'requestedStanceClear': True, 'requestedStanceSupported': True, 'candidates': []}}}}}
    moved = copy.deepcopy(state)
    moved['position'] = probe
    moved['execution'] = {'lastExecution': {'status': 'succeeded', 'completionConfirmed': True,
        'tool': 'goto', 'actionId': 'fixture-action', 'turnId': 'fixture-turn'},
        'expectedAction': {'tool': 'goto', 'args': probe, 'actionId': 'fixture-action', 'turnId': 'fixture-turn'}}
    moving = memory | {'stage': 'moving', 'before': state['position'], 'segment': probe}
    failed_still = copy.deepcopy(state)
    failed_still.update(onGround=True, inWater=False, inLava=False,
        execution={'lastExecution': {'status': 'failed', 'completionConfirmed': True,
            'tool': 'goto', 'actionId': 'failed-action', 'turnId': 'failed-turn',
            'navigationOutcome': {'success': False, 'final_x': 200, 'final_y': 64,
                                  'final_z': 100}},
                   'expectedAction': {'tool': 'goto', 'args': probe,
                                      'actionId': 'failed-action', 'turnId': 'failed-turn'}})
    ground = copy.deepcopy(state)
    ground['position'] = {'x': 100, 'y': 70, 'z': 100}
    ground_memory = {'target': {'x': 101, 'z': 100}, 'stage': 'arrival_survey', 'probe': ground['position']}
    ground['execution'] = {'observedAt': 1000250, 'observation': {
        'tool': 'navigation_sense', 'args': ground['position'], 'fresh': True, 'ageMs': 250,
        'result': {'ok': True, 'navigationSense': {'ok': True, 'actorUuid': ground['bodyUuid'],
            'dimension': ground['dimension'], 'position': ground['position'], 'observedAt': 1000000,
            'destination': {'available': True, 'requested': ground['position'], 'pathVerified': False,
                'requestedStanceClear': True, 'requestedStanceSupported': True, 'candidates': []}}}}}
    unsupported = copy.deepcopy(ground)
    unsupported['execution']['observation']['result']['navigationSense']['destination']['requestedStanceSupported'] = False
    blocked = copy.deepcopy(observed)
    blocked['execution']['observation']['result']['navigationSense']['destination']['requestedStanceSupported'] = False
    exhausted = copy.deepcopy(blocked)
    probe4 = {'x': 196, 'y': 64, 'z': 100}
    exhausted['execution']['observation']['args'] = probe4
    exhausted['execution']['observation']['result']['navigationSense']['destination']['requested'] = probe4
    return {'name': NAME, 'source': SOURCE,
        'description': '显式连续导航：memory.target 为区内已知XZ地面目标，已知目标高度可带Y；或 memory.mode=return_to_work_area 返回工作区。'
                        '每段先勘察可站立点，无安全进展时同方向最多16/8/4格三次勘察；精确动作到达回执和实际进展续段，'
                        'UUID/维度/原生计数连续性检查；'
                        'XZ到达还须勘察当前脚下支撑与净空，只证明水平位置站稳，不证明建筑楼层；失败/无进展交回，不负责全局寻路。',
        'fixtures': [
            {'state': state, 'memory': {'mode': 'return_to_work_area'},
             'expectedObserve': {'tool': 'navigation_sense', 'args': {'x': 184, 'y': 64, 'z': 100}}},
            {'state': state, 'memory': {}, 'expectedActionTool': None, 'replan': True},
            {'state': moved | {'execution': {}}, 'memory': moving, 'expectedActionTool': None, 'replan': True},
            {'state': state | {'position': {'x': 159, 'y': 64, 'z': 100}},
             'memory': {'mode': 'return_to_work_area'}, 'expectedActionTool': None, 'done': True},
            {'state': moved | {'bodyControl': moved['bodyControl'] | {'bodyTickCount': 1}},
             'memory': moving, 'expectedActionTool': None, 'replan': True},
            {'state': state, 'memory': {'target': {'x': 80, 'z': 100}},
             'expectedObserve': {'tool': 'navigation_sense', 'args': probe}},
            {'state': observed, 'memory': memory | {'mode': 'target', 'target': {'x': 80, 'z': 100}},
             'expectedAction': {'tool': 'goto', 'args': probe}, 'expectedActionTool': 'goto'},
            {'state': moved, 'memory': moving | {'mode': 'target', 'target': {'x': 80, 'z': 100}},
             'expectedObserve': {'tool': 'navigation_sense', 'args': {'x': 168, 'y': 64, 'z': 100}}},
            {'state': failed_still, 'memory': moving,
             'expectedObserve': {'tool': 'navigation_sense', 'args': probe}},
            {'state': exhausted, 'memory': memory | {'probe': probe4, 'probeSpan': 4, 'probeAttempt': 2},
             'expectedActionTool': None, 'replan': True},
            {'state': ground, 'memory': ground_memory, 'expectedActionTool': None, 'done': True},
            {'state': unsupported, 'memory': ground_memory, 'expectedActionTool': None, 'replan': True},
        ]}


def motion_record():
    """A distinct tested program so installed navigation versions stay immutable."""
    base = record()
    state = copy.deepcopy(base['fixtures'][0]['state'])
    state['position'] = {'x': 100, 'y': 64, 'z': 100}
    waypoints = [{'x': 130, 'z': 100}, {'x': 145, 'z': 105}]
    memory = {'policy': True, 'waypoints': waypoints}
    probe = {'x': 116, 'y': 64, 'z': 100}
    surveyed = copy.deepcopy(state)
    surveyed['execution'] = {'observedAt': 1000250, 'observation': {
        'tool': 'navigation_sense', 'args': probe, 'fresh': True, 'ageMs': 250,
        'result': {'ok': True, 'navigationSense': {'ok': True,
            'actorUuid': state['bodyUuid'], 'dimension': state['dimension'],
            'position': state['position'], 'observedAt': 1000000,
            'destination': {'available': True, 'requested': probe, 'pathVerified': False,
                'requestedStanceClear': True, 'requestedStanceSupported': True,
                'candidates': [{'x': 112, 'y': 64, 'z': 102}]}}}}}
    near_duplicates = copy.deepcopy(surveyed)
    near_duplicates['execution']['observation']['result']['navigationSense']['destination']['candidates'] = [
        {'x': 115.5, 'y': 64, 'z': 100.5}, {'x': 116.5, 'y': 64, 'z': 100.5}]
    bad = copy.deepcopy(memory)
    bad['waypoints'][1]['x'] = 200
    blocked = copy.deepcopy(surveyed)
    probe4 = {'x': 104, 'y': 64, 'z': 100}
    blocked['execution']['observation']['args'] = probe4
    blocked_destination = blocked['execution']['observation']['result']['navigationSense']['destination']
    blocked_destination.update(requested=probe4, requestedStanceSupported=False, candidates=[])
    blocked_memory = memory | {'stage': 'survey', 'probe': probe4, 'probeSpan': 4, 'probeAttempt': 2}
    lateral = copy.deepcopy(blocked)
    left = {'x': 100, 'y': 64, 'z': 106}
    lateral['execution']['observation']['args'] = left
    lateral_destination = lateral['execution']['observation']['result']['navigationSense']['destination']
    lateral_destination.update(requested=left, requestedStanceSupported=True)
    near_waypoint = copy.deepcopy(state)
    near_waypoint['position'] = {'x': 128, 'y': 64, 'z': 100}
    failed_progress = copy.deepcopy(state)
    failed_progress.update(position={'x': 108, 'y': 64, 'z': 100}, onGround=True,
                           inWater=False, inLava=False)
    failed_segment = {'x': 116, 'y': 64, 'z': 100}
    failed_progress['execution'] = {'lastExecution': {'status': 'failed',
        'completionConfirmed': True, 'tool': 'goto', 'actionId': 'failed-action',
        'turnId': 'failed-turn', 'navigationOutcome': {'success': False,
            'final_x': 108, 'final_y': 64, 'final_z': 100}},
        'expectedAction': {'tool': 'goto', 'args': failed_segment,
            'actionId': 'failed-action', 'turnId': 'failed-turn'}}
    failed_still = copy.deepcopy(failed_progress)
    failed_still['position'] = copy.deepcopy(state['position'])
    failed_still['execution']['lastExecution']['navigationOutcome'].update(
        final_x=100, final_y=64, final_z=100)
    completed = copy.deepcopy(state)
    completed.update(position={'x': 145, 'y': 64, 'z': 105}, hp=16, hunger=12,
                     onGround=True, inWater=False, inLava=False,
                     environment={'ok': True, 'bodyUuid': state['bodyUuid'],
                                  'observedAt': 1000000, 'hostiles': []})
    completed['execution'] = {'observedAt': 1000250, 'observation': {
        'tool': 'navigation_sense', 'args': completed['position'], 'fresh': True, 'ageMs': 250,
        'result': {'ok': True, 'navigationSense': {'ok': True,
            'actorUuid': state['bodyUuid'], 'dimension': state['dimension'],
            'position': completed['position'], 'observedAt': 1000000,
            'destination': {'available': True, 'requested': completed['position'],
                            'pathVerified': False, 'requestedStanceClear': True,
                            'requestedStanceSupported': True, 'candidates': []}}}}}
    continuation = memory | {'continueWhileThinking': True, 'goalClaim': 'patrol',
        'index': 1, 'target': waypoints[1], 'stage': 'arrival_survey',
        'probe': completed['position']}
    hostile = copy.deepcopy(completed)
    hostile['environment']['hostiles'] = [{'type': 'minecraft:zombie'}]
    return {'name': MOTION_NAME, 'source': SOURCE,
        'description': '一次提交2–6个已知工作区路标；逐段勘察与精确回执，受阻时最多两次侧向绕行；明确启用的安全往返路线可成功后接续折返一次。Jev从真实支持的候选中选择或交回慢脑。',
        'fixtures': [
            {'state': state, 'memory': memory, 'expectedObserve': {'tool': 'navigation_sense', 'args': probe}},
            {'state': surveyed, 'memory': memory | {'stage': 'survey', 'probe': probe, 'probeSpan': 16, 'probeAttempt': 0},
             'expectedActionTool': None, 'replan': False},
            {'state': blocked, 'memory': blocked_memory,
             'expectedObserve': {'tool': 'navigation_sense', 'args': left}},
            {'state': lateral, 'memory': memory | {'stage': 'detour_left', 'probe': left},
             'expectedActionTool': None, 'replan': False},
            {'state': state, 'memory': bad, 'expectedActionTool': None, 'replan': True},
            {'state': near_duplicates, 'memory': memory | {'stage': 'survey', 'probe': probe, 'probeSpan': 16,
                                                           'probeAttempt': 0},
             'expectedActionTool': None, 'replan': False},
            {'state': near_waypoint, 'memory': memory,
             'expectedObserve': {'tool': 'navigation_sense', 'args': near_waypoint['position']}},
            {'state': failed_progress, 'memory': memory | {'index': 0, 'target': waypoints[0],
                'stage': 'moving', 'before': state['position'], 'segment': failed_segment},
             'expectedObserve': {'tool': 'navigation_sense', 'args': {'x': 124, 'y': 64, 'z': 100}}},
            {'state': failed_still, 'memory': memory | {'index': 0, 'target': waypoints[0],
                'stage': 'moving', 'before': state['position'], 'segment': failed_segment},
             'expectedObserve': {'tool': 'navigation_sense', 'args': left}},
            {'state': completed, 'memory': continuation,
             'expectedObserve': {'tool': 'navigation_sense', 'args': {'x': 130, 'y': 64, 'z': 100}}},
            {'state': hostile, 'memory': continuation, 'expectedActionTool': None, 'done': True},
            {'state': completed, 'memory': continuation | {'continuationUsed': True},
             'expectedActionTool': None, 'done': True},
        ]}
