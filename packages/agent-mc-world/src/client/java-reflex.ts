import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { appendFileSync, mkdirSync } from 'node:fs';
import { Vec3 } from 'vec3';
import type { Bot } from 'mineflayer';
import { CombatSession } from '../../core/combat.ts';
import { Reflexes, HOSTILE, type QueueHoldToken } from '../../core/executor.ts';
import { DEFAULT_FIGHT } from '../../core/policy.ts';
import { clearObservationRay } from '../../core/perception-sight.ts';
import { onEscapeGoal, dropGoal } from '../../core/travel.ts';
import { CombatAbilities } from '../../core/combat-abilities.ts';
import { CombatTacticBook } from '../../core/combat-tactics.ts';
import { CombatProgramRunner, combatProgramCandidates, combatProgramHash, validCombatProgram } from '../../core/combat-program.ts';
import { combatReactions } from '../../core/combat-reactions.ts';
import { diverseCombatOptions } from '../../core/combat-options.ts';
import { corridorSafe } from '../../core/idle-actions.ts';
import { COMBAT_EXECUTION_DEFAULTS, type CombatCandidate, type CombatDecisionFrame } from '../../core/combat-decision-types.ts';
import type { Battlefield } from '../../core/battlefield.ts';
import type { JavaClientState } from '../contracts/java-client.ts';
import type { ToolCallContext, ToolOutcome, WorldHost } from './contracts.ts';
import type { MinecraftClientConfig } from './config.ts';
import { nativeAuthorization } from './native-authorization.ts';
const require=createRequire(import.meta.url);
const bodyRequire=createRequire(require.resolve('mineflayer'));
const name=(v:unknown)=>String(v??'').replace(/^minecraft:/,'');
const vec=(v:any)=>new Vec3(v[0]??v.x,v[1]??v.y,v[2]??v.z);
export const JAVA_REFLEX_PROTOCOL='agent-mc-reflex/v1';
type Port={rpc(method:string,args:Record<string,unknown>,signal?:AbortSignal):Promise<any>;owner():Record<string,unknown>;canControl():boolean;verify(state:JavaClientState):void;host():WorldHost|null};

/** Internal body facet for the existing kernels; no second login, model or simulated physics. */
export class JavaReflexRuntime {
  readonly combat:CombatSession;
  readonly reflexes:Reflexes;
  private readonly bot:any=new EventEmitter();
  private readonly stream=`reflex:${randomUUID()}`;
  private sequence=0;private serial=0;private generation=-1;private dimension:string|null=null;private damageSeq=0;
  private bodyScope=-1;
  private readonly attachedAt=Date.now();
  private sampledAt=0;private frame:any=null;private timer?:ReturnType<typeof setInterval>;private polling:Promise<void>|null=null;private stopped=false;
  private outputTail:Promise<unknown>=Promise.resolve();
  private readonly held:Record<string,boolean>={};private look:{yaw:number;pitch:number}|null=null;private attack:{id:number;uuid:string}|null=null;
  private goal:any=null;private environmentHolds=new Set<symbol>();private combatHold=false;
  private readonly cells=new Map<string,any>();private lastError:string|null=null;private lastAck:any=null;
  private nutritionVersion:string|null=null;
  private readonly tactics:CombatAbilities;private readonly program=new CombatProgramRunner();private failedProgram:string|null=null;
  private programError:string|null=null;
  private receiptSerial=0;private readonly receipts:Record<string,unknown>[]=[];
  private choiceRequestId:string|null=null;private lastControlEvent='';
  constructor(private readonly cfg:MinecraftClientConfig,private readonly port:Port){
    mkdirSync(cfg.javaClient!.ledgerDir,{recursive:true});
    const inventory:any={slots:Array(46).fill(null)};inventory.items=()=>inventory.slots.filter((i:any,index:number)=>i&&index>=9&&index<=44);
    Object.assign(this.bot,{_client:new EventEmitter(),username:cfg.username,player:{},entities:{},inventory,controlState:this.held,
      registry:{entitiesByName:{},foodsByName:{}},entity:null,health:null,food:null,currentWindow:null,game:{dimension:null},
      blockAt:(at:Vec3)=>this.cells.get(at.floored().toString())??null,
      getControlState:(key:string)=>this.held[key]===true,setControlState:(key:string,value:boolean)=>{this.held[key]=value;},
      clearControlStates:()=>{for(const key of Object.keys(this.held))this.held[key]=false;},
      lookAt:async(at:Vec3)=>{const p=this.bot.entity?.position;if(!p)throw Error('Native body unavailable');const dx=at.x-p.x,dy=at.y-p.y-(this.bot.entity.eyeHeight??1.62),dz=at.z-p.z;
        this.look={yaw:Math.atan2(-dx,dz)*180/Math.PI,pitch:-Math.atan2(dy,Math.hypot(dx,dz))*180/Math.PI};},
      attack:(entity:any)=>{if(!entity?.uuid||this.bot.entities[entity.id]!==entity)throw Error('Native attack identity unavailable');this.attack={id:entity.id,uuid:entity.uuid};},
      equip:(item:any,destination:string)=>this.equip(item,destination),
      activateItem:(offhand=false)=>{if(offhand)throw Error('Native offhand use is unavailable in this body facet');this.held.use=true;},
      deactivateItem:()=>{this.held.use=false;},consume:()=>this.consume(),stopDigging:()=>{},
      dig:async()=>{throw Error('Native reflex block breaking needs authoritative server block receipts; no break dispatched.');},
      activateBlock:async()=>{throw Error('Native reflex block use needs the explicit interaction contract; no use dispatched.');},
      world:{raycast:(from:Vec3,direction:Vec3,distance:number)=>{const to=from.plus(direction.scaled(distance));
        const actor=Object.values(this.bot.entities).find((e:any)=>e!==this.bot.entity&&e.position&&to.distanceTo(e.position.offset(0,e.height*.5,0))<.8) as any;
        return (actor?actor.nativeVisible===true:clearObservationRay(this.bot,from,to))?null:{position:to,unknown:true};}},
      pathfinder:{goal:null,movements:{canDig:false,scafoldingBlocks:[]},setGoal:(target:any)=>{this.bot.pathfinder.goal=target;this.goal=this.nativeGoal(target);},stop:()=>{this.bot.pathfinder.goal=null;this.goal=null;}},
    });
    this.tactics=new CombatAbilities(new CombatTacticBook(join(cfg.javaClient!.ledgerDir,'native-combat-tactics.json')));
    this.tactics.useRealm(`${cfg.javaClient!.expectedServer}|${cfg.javaClient!.expectedUuid}`);
    const emit=(text:string,urgent=false,meta?:Record<string,unknown>)=>{void this.port.host()?.pushEvent({type:'minecraft.reflex',source:'minecraft',ts:new Date().toISOString(),text,
      meta:{protocol:JAVA_REFLEX_PROTOCOL,sharedKernel:true,goalCompleted:false,...meta}},{trigger:urgent?'debounce':'piggyback'}).catch(()=>{});};
    const log={info(){},warn(){},error(){},debug(){},trace(){},child(){return this}} as any;
    this.combat=new CombatSession({getBot:()=>this.currentBot(),tuning:()=>({...cfg.combat,fleeHealth:cfg.reflex.fleeHealth,fight:DEFAULT_FIGHT}),
      envBusy:()=>this.environmentHolds.size>0||this.reflexes?.envActive===true,
      suspendTasks:()=>{this.combatHold=true;},resumeTasks:()=>{this.combatHold=false;return null;},emit:(text,urgent,hurt)=>emit(text,urgent,{hurt:hurt===true}),
      report:result=>{try{const receipt=this.tactics.recordCombat(result);void this.port.host()?.pushEvent({type:'minecraft.combat',source:'minecraft',ts:new Date().toISOString(),
        text:JSON.stringify({receipt,sharedKernel:true,backend:'java-client',goalCompleted:false}),meta:{receipt,nativeChoiceRequestId:this.choiceRequestId,controlStream:this.stream}},{trigger:'piggyback'}).catch(()=>{});}catch{emit('Native combat receipt could not be saved; outcome is not archived or verified.',false,{receiptSaved:false});}this.choiceRequestId=null;},log});
    const hold=()=>{this.combat.yieldToEnv();const owner=Symbol('native-environment');this.environmentHolds.add(owner);return{owner};};
    this.reflexes=new Reflexes({getBot:()=>this.currentBot(),report:r=>emit(r.text,r.hurt===true,{kind:r.kind}),log,
      preempt:reason=>{this.combat.yieldToEnv();this.cancelOriginalTask(reason);},pauseEnvironment:hold,resumeEnvironment:(token:QueueHoldToken)=>({released:this.environmentHolds.delete(token.owner),note:null}),
      stopFallTask:reason=>{this.cancelOriginalTask(reason);return hold();},resumeAfterFall:token=>this.environmentHolds.delete(token.owner),
      fightBack:()=>cfg.reflex.fightBack,fleeHealth:()=>cfg.reflex.fleeHealth,reactCooldownSec:()=>cfg.reflex.reactCooldownSec,
      antiDrown:()=>cfg.reflex.antiDrown,antiLava:()=>cfg.reflex.antiLava,combatHurt:(id,kind)=>this.combat.onHurtBy(id,kind),
      escapeActive:()=>this.combat.reactionState().retreating,
    });
  }
  private currentBot():Bot|null{return !this.stopped&&this.frame&&this.port.canControl()&&Date.now()-this.sampledAt<=500
    &&this.frame.state.connected&&nativeAuthorization(this.frame.state,this.cfg.javaClient?.requireServerAuthorization).ready
    &&!this.frame.state.screen&&this.bot.health>0?this.bot as Bot:null;}
  private cancelOriginalTask(_reason:string){const id=this.frame?.taskId;if(typeof id!=='string'||!this.port.canControl())return;
    void this.port.rpc('cancel',{...this.port.owner(),action_id:id,expectedGeneration:this.generation}).catch(error=>{this.lastError=`Original task cancellation unknown: ${String(error)}`;});}
  start(){this.combat.start();this.reflexes.start();this.timer=setInterval(()=>{void this.poll();},100);this.timer.unref();}
  status(){return{supported:true,kernels:['CombatSession','Reflexes'],active:this.combat.active||this.reflexes.envActive,
    bodyControl:this.sampledAt>0&&Date.now()-this.sampledAt<=500&&this.port.canControl()&&typeof this.frame?.taskRunning==='boolean'
      ?{sampledAt:new Date(this.sampledAt).toISOString(),source:'native-reflex-frame',taskRunning:this.frame.taskRunning,
        taskId:typeof this.frame.taskId==='string'?this.frame.taskId:null,generation:this.generation,bodyScope:this.bodyScope}:null,
    combat:this.combat.reactionState(),environment:this.reflexes.environmentOwnerKind,inputs:this.lastAck,unknown:this.lastError,programError:this.programError,
    gaps:['native block breaking in reflexes','native offhand equip/use','server spell provider'],goalCompleted:false};}
  async poll(){if(this.stopped||!this.port.canControl()||this.polling)return this.polling;const work=this.sampleAndApply();this.polling=work;try{await work;}finally{this.polling=null;}}
  private async sampleAndApply(){try{
    const frame=await this.port.rpc('reflex_frame',{});if(frame.protocol!==JAVA_REFLEX_PROTOCOL||!Number.isSafeInteger(frame.generation)||Date.now()-frame.sampledAtMs>500||!Array.isArray(frame.state?.position))throw Error('Native reflex sample unavailable or stale');
    if(!Number.isSafeInteger(frame.reflexGeneration))throw Error('Native reflex body scope unavailable');
    this.port.verify(frame.state);if(this.generation!==frame.generation||this.bodyScope!==frame.reflexGeneration||this.dimension!==frame.state.dimension){this.combat.onConnectionLost();this.reflexes.stop();this.environmentHolds.clear();this.combatHold=false;if(this.generation!==frame.generation)this.damageSeq=0;this.generation=frame.generation;this.bodyScope=frame.reflexGeneration;this.dimension=frame.state.dimension;this.bot.emit('respawn');this.reflexes.start();}
    this.frame=frame;this.sampledAt=frame.sampledAtMs;this.updateBody(frame);
    if(!this.currentBot()){this.combat.inhibit();this.reflexes.inhibit();this.environmentHolds.clear();this.combatHold=false;await this.flush(true);return;}
    this.reflexes.start();this.bot.emit('physicsTick');await this.flush(false);this.lastError=null;
  }catch(error){this.lastError=String(error);this.sampledAt=0;this.combat.onConnectionLost();this.reflexes.inhibit();this.environmentHolds.clear();this.combatHold=false;}}
  private updateBody(frame:any){
    const s=frame.state,oldHealth=this.bot.health;
    this.bot.username=s.username;this.bot.player={uuid:s.uuid};this.bot.game={dimension:name(s.dimension)};
    this.bot.oxygenLevel=Number.isFinite(frame.oxygen)&&frame.maxOxygen>0?Math.max(0,Math.min(20,frame.oxygen/frame.maxOxygen*20)):null;
    this.bot.currentWindow=s.screen?{id:s.syncId}:null;
    this.bot.entity={id:frame.entityId,uuid:s.uuid,name:'player',type:'player',position:vec(s.position),velocity:vec(frame.velocity),
      yaw:Math.PI-s.yaw*Math.PI/180,pitch:-s.pitch*Math.PI/180,onGround:frame.onGround,height:frame.height,eyeHeight:frame.eyeHeight,
      isValid:true,metadata:[frame.burning?1:0,frame.oxygen,s.health],attributes:{'minecraft:generic.max_health':{value:frame.maxHealth,modifiers:[]}}};
    const old=this.bot.entities;this.bot.entities={[frame.entityId]:this.bot.entity};
    for(const raw of frame.actors??[]){const kind=name(raw.name),entity={id:raw.id,uuid:raw.uuid,name:kind,username:raw.player?raw.username:undefined,type:raw.player?'player':raw.projectile?'projectile':'mob',position:vec(raw.position),velocity:vec(raw.velocity),width:raw.width,height:raw.height,isValid:raw.alive===true,
      nativeVisible:raw.visible===true,metadata:[0,null,raw.health??null],attributes:{'minecraft:generic.max_health':{value:raw.maxHealth,modifiers:[]}}};
      this.bot.entities[raw.id]=entity;this.bot.registry.entitiesByName[kind]={metadataKeys:['shared_flags','air_supply','health'],type:entity.type};
      if(raw.alive===false&&old[raw.id]?.isValid)this.bot.emit('entityDead',entity);
    }
    this.bot.registry.entitiesByName.player={metadataKeys:['shared_flags','air_supply','health','player_absorption'],type:'player'};
    this.bot.inventory.slots=frame.inventorySlots??Array(46).fill(null);this.bot.heldItem=this.bot.inventory.slots[36+s.selectedSlot]??null;
    this.cells.clear();for(const cell of frame.cells??[]){const raw=frame.palette[cell[3]];if(!raw)continue;const position=new Vec3(cell[0],cell[1],cell[2]);this.cells.set(position.toString(),{...raw,name:name(raw.name),position,boundingBox:raw.shapes.length?'block':'empty',getProperties:()=>({...raw.properties})});}
    this.bot.health=s.health;this.bot.food=s.food;this.reflexes.start();
    for(const damage of frame.damage??[])if(damage.seq>this.damageSeq){this.damageSeq=damage.seq;if(damage.atMs<this.attachedAt)continue;
      if(damage.entityId!==frame.entityId){const actor=this.bot.entities[damage.entityId]??old[damage.entityId];if(actor)this.bot.emit('entityHurt',actor,this.bot.entities[damage.causeId]);}
      this.bot._client.emit('damage_event',{entityId:damage.entityId,nativeDecodedIds:true,nativeSourceType:damage.sourceType,
        sourceCauseId:damage.causeId,sourceDirectId:damage.directId,sourcePosition:damage.position?vec(damage.position):null});}
    this.bot._client.emit('update_health',{health:s.health});if(oldHealth!==s.health)this.bot.emit('health');if(s.health===0&&oldHealth>0)this.bot.emit('death');
    if(Number.isFinite(frame.absorption))this.bot._client.emit('entity_metadata',{entityId:frame.entityId,metadata:[{key:3,value:frame.absorption}]});
    if(this.nutritionVersion!==frame.minecraftVersion){this.nutritionVersion=frame.minecraftVersion;try{this.bot.registry.foodsByName=bodyRequire('prismarine-registry')(frame.minecraftVersion).foodsByName??{};}catch{this.bot.registry.foodsByName={};}}
    if(s.reflex?.goalReached&&this.goal&&JSON.stringify(s.reflex.goal)===JSON.stringify(this.goal)){const goal=this.bot.pathfinder.goal;dropGoal(this.bot,'escape','native measured arrival');this.goal=null;this.bot.emit('goal_reached',goal);}
  }
  private nativeGoal(goal:any){if(!goal)return null;if(!Number.isFinite(goal.x)||!Number.isFinite(goal.z))throw Error('Native reflex navigation requires an absolute goal');
    if(goal.y===undefined)return{kind:'xz',x:Math.floor(goal.x),z:Math.floor(goal.z)};
    const range=goal.range??(goal.rangeSq===undefined?0:Math.sqrt(goal.rangeSq));if(!Number.isInteger(range)||range<0||range>16)throw Error('Native reflex navigation range unavailable');
    return{kind:range?'near':'block',x:Math.floor(goal.x),y:Math.floor(goal.y),z:Math.floor(goal.z),range};}
  private flush(idle:boolean):Promise<void>{const work=this.outputTail.catch(()=>{}).then(async()=>{
    if(!this.port.canControl()||!this.frame?.state.connected)return;
    const owner=idle?'idle':this.environmentHolds.size||this.reflexes.envActive||onEscapeGoal(this.bot)?'environment':this.combatHold||this.combat.active?'combat':'idle';
    const keys={...this.held};
    if(this.look&&this.frame.state.yaw!==this.look.yaw){const before=this.frame.state.yaw*Math.PI/180,after=this.look.yaw*Math.PI/180,forward=Number(!!keys.forward)-Number(!!keys.back),left=Number(!!keys.left)-Number(!!keys.right);
      const x=-Math.sin(before)*forward+Math.cos(before)*left,z=Math.cos(before)*forward+Math.sin(before)*left;
      const f=-Math.sin(after)*x+Math.cos(after)*z,l=Math.cos(after)*x+Math.sin(after)*z;keys.forward=f>.3;keys.back=f<-.3;keys.left=l>.3;keys.right=l<-.3;}
    const input:Record<string,unknown>={owner,keys:owner==='idle'?{}:keys,...(owner!=='idle'&&this.look?{look:this.look}:{}),...(owner!=='idle'&&this.attack?{attack:this.attack}:{}),...(owner!=='idle'&&this.goal?{goal:this.goal}:{})};
    this.attack=null;
    this.lastAck=await this.port.rpc('reflex_control',{...this.port.owner(),expectedGeneration:this.generation,control:{stream:this.stream,sequence:++this.sequence,bodyScope:this.bodyScope,sampledAtMs:this.frame.sampledAtMs,ttlMs:400,input}});
    const key=JSON.stringify([owner,this.choiceRequestId,this.lastAck.attacksSent??null]);if(key!==this.lastControlEvent){this.lastControlEvent=key;
      appendFileSync(join(this.cfg.javaClient!.ledgerDir,'reflex-control-metadata.jsonl'),JSON.stringify({at:new Date().toISOString(),stream:this.stream,generation:this.generation,
        sequence:this.sequence,owner,choiceRequestId:this.choiceRequestId,accepted:this.lastAck.accepted??null,attacksSent:this.lastAck.attacksSent??null,goalCompleted:false})+'\n');}
  });this.outputTail=work;return work;}
  private async equip(item:any,destination:string){if(destination!=='hand')throw Error('Native reflex offhand/armor equipment is unavailable; original inventory preserved');
    if(!item||!Number.isInteger(item.slot)||typeof item.instanceHash!=='string')throw Error('Native reflex equipment needs a fresh observed item');
    const slot=item.slot>=36&&item.slot<=44?item.slot-36:item.slot;if(slot<0||slot>35)throw Error('Native reflex equipment slot unavailable');
    await this.flush(false);const id=`${this.stream}:item:${++this.serial}`;
    let result=await this.port.rpc('reflex_item',{...this.port.owner(),expectedGeneration:this.generation,expectedBodyScope:this.bodyScope,action_id:id,input:{slot,instanceHash:item.instanceHash}});
    const until=Date.now()+10000;while(['accepted','running'].includes(result.phase)&&!this.stopped&&Date.now()<until){await new Promise(r=>setTimeout(r,50));result=await this.port.rpc('result',{action_id:id});}
    if(result.phase!=='completed')throw Error(`Original reflex item ${id}: ${result.phase??'unknown'}; reconcile before retry`);
    const fresh=Date.now()+1000;while(!this.stopped&&Date.now()<fresh){await this.poll();if(this.bot.heldItem?.instanceHash===item.instanceHash)return;await new Promise(r=>setTimeout(r,50));}
    throw Error('Reflex equip terminal lacks matching fresh held-item evidence');
  }
  private async consume(){const item=this.bot.heldItem;if(!item)throw Error('No actual held food');const before=this.bot.inventory.items().filter((i:any)=>i.name===item.name).reduce((n:number,i:any)=>n+i.count,0);
    this.held.use=true;const until=Date.now()+6000;try{while(!this.stopped&&Date.now()<until){await new Promise(r=>setTimeout(r,50));const count=this.bot.inventory.items().filter((i:any)=>i.name===item.name).reduce((n:number,i:any)=>n+i.count,0);if(count<before)return;}throw Error('Native consume lacks observed inventory reduction');}finally{this.held.use=false;}}
  private decisionFrame():CombatDecisionFrame|null{const bot=this.currentBot();if(!bot)return null;const s=this.frame.state,p=bot.entity.position,now=Date.now(),reaction=this.combat.reactionState();
    const health=(current:number|null,max:number|null)=>({current,max,source:'native' as const,updatedAtMs:null});
    const field:Battlefield={sampledAtMs:now,connectionGeneration:this.bodyScope,dimension:s.dimension,self:{entityId:bot.entity.id,health:health(bot.health,this.frame.maxHealth),food:bot.food,position:[p.x,p.y,p.z],scoreboardTeam:null,equipment:{held:bot.heldItem?.name??null,armor:[5,6,7,8].map(i=>bot.inventory.slots[i]?.name??null)}},
      action:{fighting:this.combat.fighting,emergency:this.reflexes.envActive||this.environmentHolds.size>0||reaction.retreating||bot.health<=this.cfg.reflex.fleeHealth,taskId:null,step:this.frame.taskId??null,targetEntityId:reaction.targetId,sinceHitMs:reaction.sinceHitMs,canStep:reaction.canStep,tracking:this.combat.tracking},
      actors:(this.frame.actors??[]).filter((e:any)=>e.visible&&e.alive&&HOSTILE.has(name(e.name))&&name(e.name)!=='enderman').map((e:any)=>({entityId:e.id,uuid:e.uuid,type:name(e.name),name:e.player?e.username:null,relation:'hostile',relationSource:'hostile-type',scoreboardTeam:null,health:health(e.health??null,e.maxHealth??null),position:e.position,distance:p.distanceTo(vec(e.position)),lineOfSight:e.visible,targetEntityId:null})),omitted:this.frame.actorsOmitted??0,server:null};
    const cfg={...COMBAT_EXECUTION_DEFAULTS,...this.cfg.combatOptions};
    const frame=this.tactics.decisionFrame(bot,field,16,now);frame.candidates=[];
    const control={bodyFree:(!this.frame.taskRunning||this.combat.active)&&!bot.currentWindow,canStep:reaction.canStep,targetId:reaction.targetId,sinceHitMs:reaction.sinceHitMs,
      fight:DEFAULT_FIGHT,fleeHealth:this.cfg.reflex.fleeHealth,chaseMax:this.cfg.combat.chaseMax,trackingTargets:new Set(this.combat.trackingTargets()),retreatAvailable:this.combat.canRetreat()};
    const pool=combatReactions(bot,field,cfg,control,true).filter(c=>c.kind!=='engage'||this.combat.engagementTargets().includes(c.targetId));
    frame.actionPool=pool;frame.candidates=diverseCombatOptions(pool,cfg.maxCandidates);frame.omittedCandidates=Math.max(0,pool.length-frame.candidates.length);
    const program=this.tactics.getTactic()?.program;if(program)frame.program=program;return frame;
  }
  async tool(args:Record<string,unknown>,ctx:ToolCallContext):Promise<ToolOutcome>{
    if(args.routines!==undefined)return{text:'Native reflex has no saved-method execution port; routines were not registered or run. Use the native mc_script interface explicitly.',failed:true};
    if(args.battlefield===true){let frame=this.decisionFrame();if(frame?.program){const hash=combatProgramHash(frame.program);if(hash!==this.failedProgram)try{const result=combatProgramCandidates(await this.program.run(frame.program,frame),frame,to=>corridorSafe(this.currentBot()!,this.bot.entity.position,new Vec3(...to)));frame={...frame,candidates:diverseCombatOptions(result.candidates,({...COMBAT_EXECUTION_DEFAULTS,...this.cfg.combatOptions}).maxCandidates),policy:{name:frame.program.name,sourceHash:hash,instructions:result.instructions}};this.programError=null;}catch(error){this.failedProgram=hash;this.programError=`Program ${hash} unavailable: ${String(error).slice(0,240)}`;}}
      return{text:JSON.stringify({frame,capabilities:this.status()}),meta:{protocol:'agent-mc-tactics/v1',frame}};}
    if(args.choice){const choice=args.choice as any,frame=this.decisionFrame();const candidate=choice.candidate as CombatCandidate;
      let eligible=!!frame&&frame.battlefield.connectionGeneration===choice.connectionGeneration&&frame.tacticRevision===choice.tacticRevision&&!frame.battlefield.action.emergency;
      if(eligible&&frame?.program){try{combatProgramCandidates({candidates:[candidate],instructions:''},frame,to=>corridorSafe(this.currentBot()!,this.bot.entity.position,new Vec3(...to)));}catch{eligible=false;}}
      else eligible=eligible&&!!frame?.candidates.some(c=>JSON.stringify(c)===JSON.stringify(candidate));
      const accepted=eligible&&candidate.kind!=='cast'&&candidate.kind!=='method'&&this.combat.react(candidate);if(accepted){this.choiceRequestId=ctx.callId??null;await this.flush(false);}
      const receipt={id:++this.receiptSerial,at:new Date().toISOString(),accepted,candidate,tacticRevision:choice.tacticRevision,goalCompleted:false,meaning:accepted?'shared-controller-armed; inspect native inputs and observed effects':'stale-or-ineligible'};
      this.receipts.push(receipt);if(this.receipts.length>32)this.receipts.shift();return{text:JSON.stringify(receipt),meta:{protocol:'agent-mc-tactics/v1',receipt}};}
    if(args.decisions===true||args.decision!==undefined)return{text:JSON.stringify(args.decision?this.receipts.find(r=>r.id===args.decision)??null:this.receipts)};
    if(args.report!==undefined)return{text:this.tactics.readout(Number(args.report))};
    if(!Object.keys(args).length)return{text:JSON.stringify({tactic:this.tactics.getTactic(),capabilities:this.status()})};
    if(args.spells!==undefined||args.rules!==undefined||args.healAtOrBelow!==undefined)throw Error('Native server spell provider is not installed; no spell or healing command dispatched');
    if(args.enabled===false){this.tactics.setTactic(null);this.program.close();this.failedProgram=null;this.programError=null;return{text:'Custom program removed; shared reflex kernel remains configured.'};}
    if(args.program!==undefined){if(args.program!==null&&!validCombatProgram(args.program))throw Error('Invalid shared combat program');if(args.program)await this.program.configure(args.program as any);else this.program.close();this.tactics.setTactic({spells:null,healAtOrBelow:null,program:args.program as any});this.failedProgram=null;this.programError=null;return{text:'Shared combat program saved; actual adoption and gameplay outcomes remain unverified.'};}
    throw Error('Unsupported native tactic operation');
  }
  async beforeBody(firstStep?:any){this.combat.standDown(firstStep);if(!this.combat.active)this.combatHold=false;if(!this.combat.active&&!this.reflexes.envActive&&!this.environmentHolds.size&&!onEscapeGoal(this.bot))await this.flush(true);}
  async requestStop(){const result=this.combat.requestStop();if(result)await this.flush(false);return result;}
  async close(){this.stopped=true;clearInterval(this.timer);this.combat.stop();this.reflexes.stop();this.program.close();this.environmentHolds.clear();this.combatHold=false;await this.polling?.catch(()=>{});await this.flush(true).catch(()=>{});this.bot.emit('end');}
}
