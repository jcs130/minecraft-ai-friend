/** Reuse the independent JS worker, method versions and receipts on the real Java body. */
import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { MethodRunner, METHOD_ADAPTER, METHOD_LIMITS, type MethodOperation, type MethodRun } from '../../core/method-runner.ts';
import { MethodLibrary, METHOD_LIBRARY_SCHEMA } from '../../core/method-library.ts';
import { procedureReference, resolveProcedure } from '../../core/support/procedure.ts';
import { translateJavaLegacy } from './java-legacy.ts';
import { NativeEvidenceArchive, compactNativeState, compactNativeItems } from './native-evidence.ts';
import type { JavaClientState, JavaClientAction, JavaClientConfiguration } from '../contracts/java-client.ts';
import type { ToolCallContext, ToolOutcome, WorldHost } from './contracts.ts';

export const JAVA_METHOD_PROTOCOL = 'agent-mc-method/v1';
// The v1 baseline stays usable on bridges built before optional methods were added.
export const JAVA_METHOD_REQUIRED = ['read','blockAt','canSeeBlock','inventory.items','getControlState','look','lookAt','setControlState','clearControlStates','waitForTicks','equip','activateBlock','activateItem','deactivateItem'];
export const JAVA_METHODS = [...JAVA_METHOD_REQUIRED,'findBlocks','findBlock','setQuickBarSlot'];
const READS = new Set(['read','blockAt','findBlocks','findBlock','canSeeBlock','inventory.items','getControlState']);
export const JAVA_METHOD_FIELDS = {
  name:{type:'string',minLength:1,maxLength:80}, params:{type:'object'}, durationMs:{type:'integer',minimum:1000,maximum:120000},
  validate:{type:'boolean'}, stop:{type:'boolean'}, runId:{type:'integer',minimum:1}, call:{type:'integer',minimum:1,maximum:32},
  procedure:{type:'object',properties:{handle:{type:'string'},revision:{type:'string'}},required:['handle','revision'],additionalProperties:false}, library:METHOD_LIBRARY_SCHEMA,
};
export function javaMethodHelp(topic='index'):string {
  const base='JavaScript uses the SAME mc_script {name,code,params,validate,runId,call,stop,library,procedure} and SES/Vec3/method version format as the Mineflayer backend. Use language:"javascript" (or legacy name+code); Python remains explicit language:"python" or legacy unnamed code. Every bot call is awaited; Vec3 arithmetic and Block.getProperties() are synchronous. No Python translation, second connection, arbitrary imports/plugins or hidden model. Requires bridge methodAdapter agent-mc-method/v1 for execution; syntax validation is offline. Claim mc_control before body calls. First body call reserves the one native queue until program end; held keys survive SDK calls. Stop/timeout/disconnect cancels only the original action and releases keys; unknown cleanup blocks another program. Read runId/call to inspect actual terminals. A completed program is not goal completion.';
  const topics:Record<string,string>={
    index:`Known bot methods: ${JAVA_METHODS.join(', ')}. Actual bridge methodCalls decides availability. On-demand api: read, blockAt, findBlocks, inventory, movement, interaction, mc.state, mc.do, methods, compatibility. With language:python use the Minescript guide.`,
    read:'await bot.read(path): entity(position/velocity Vec3, yaw/pitch Mineflayer radians, onGround), health, food, game(dimension only), heldItem, inventory.slots, registry.itemsByName.<id>/blocksByName.<id>. Registry entries contain actual client id/name, not assumed vanilla IDs. Other game/registry fields are unavailable, not zero.',
    blockAt:'await bot.blockAt(new Vec3(x,y,z)): observed Block|null within 32 blocks and loaded chunks. Native collision ray visibility; may be more conservative than Mineflayer. name/type/stateId/position/getProperties() are available; hardness/shapes/light/metadata are not yet projected. Properties retain numeric/boolean/string types. await bot.canSeeBlock(block) rechecks current visibility. Null is unknown, not air. Re-read after actions.',
    findBlocks:'await bot.findBlocks({point?,matching,maxDistance?,count?,useExtraInfo?}) returns observed Vec3 positions nearest first; await bot.findBlock(options) returns the nearest observed Block|null. matching is an actual numeric block registry ID or array of 1..64 IDs; function predicates are unavailable across JSON. Filter returned Block.getProperties() in your program. Native maxDistance is integer 1..16 (default16), count1..64 (default1); Mineflayer backend permits radius32. The entire search sphere must be within 32 blocks of your eyes. Only loaded, ray-visible blocks are returned; hidden/unloaded is unknown, not absent. At most256 matching candidates receive visibility tests; excess fails explicitly, so narrow radius/IDs rather than treating it as an empty result. useExtraInfo accepts a boolean; native block fields stay those listed in blockAt, no extra NBT. Read-only, no movement or body reservation.',
    inventory:'await bot.inventory.items() returns inventory stacks (excludes equipped armor/offhand); await bot.read("inventory.slots") returns standard player slots: hotbar36..44, armor5..8, offhand45; crafting slots0..4 are unknown/null. Items contain name/type/count/displayName/slot/instanceHash; component identity is hashed, full components are queried separately with mc_bag. Long display names are explicitly truncated. Preserve the returned item for equip; native menu slot numbers remain separate. await bot.equip(item,"hand") only supports fresh HOTBAR items; other slots/destinations fail before action. await bot.setQuickBarSlot(0..8) selects a hotbar index and waits for an actual game tick; re-read heldItem for the actual item. Inventory slot36 means hotbar index0, not36. No implicit item moves or drops.',
    movement:'await bot.look(yaw,pitch,force?) uses Mineflayer RADIANS; lookAt(Vec3) uses exact coordinates. Native view is set then at least one actual game tick elapses (force does not select a smoothing model). setControlState(key,boolean), clearControlStates(), getControlState(key); forward/back/left/right/jump/sprint/sneak remain held across awaited calls until release/end. waitForTicks(1..200) counts actual native game ticks, not sleep(milliseconds). Normal collision applies; no teleport/pathfinder. Body session is cancelled on GUI takeover/death/disconnect.',
    interaction:'await bot.activateBlock(block,direction?,cursorPos?) validates fresh observed state and conservative 4.5-block reach, then vanilla main-hand interaction; default direction up, cursor center. Dispatch is not growth/placement/server success: compare fresh block/inventory. activateItem(false) holds use until deactivateItem() or program cleanup; offhand use unsupported. clearControlStates releases movement only; use is separate. Inventory/body changes must be observed before claiming results.',
    'mc.state':'await mc.state(): sampledAt, connectionGeneration, snapshot(position/dimension/health/food/inventory), queue, method; unavailable flight/combat/scaffolds are null, not false. Native details remain in nativeState. No block scan.',
    'mc.do':'await mc.do(steps) currently accepts ONE compatible legacy step (chat/control/look/equip/eat/use), waits for actual native terminal, returns {accepted,taskId,kind,done,receipt,steps,state}. Partial dispatch returns done:false and outcome:partial. Unsupported options/multi-step/navigation fail before dispatch. Cannot use after a bot body call reserves the queue. Use sequential awaited bot calls for native programs.',
    methods:'Same versioned method library: library {op:list/query}, {op:read,id}, {op:save,id,code,description,conditions,parent,validationRunId}. Validate matching source first; save is not execute or improvement evidence. procedure explicitly selects an immutable version. Storage is isolated by actual server/UUID/controller under the configured private ledger. Existing Mineflayer versions can be imported without source rewriting; no automatic cross-identity migration.',
    compatibility:'Supported common script contract is incremental, not full Mineflayer plugin compatibility. canDigBlock/digTime/dig/placeBlock/stopDigging/unequip, non-hotbar equip, arbitrary plugins/events, pathfinder, flightPlan and broad mc.do skills are unavailable. Missing methods reject; never translate them into successful no-ops. Block fields and native visibility differences are described in blockAt; registry/game fields in read. findBlock(s) and setQuickBarSlot require their names in actual bridge methodCalls; an older v1 bridge can still run its supported methods. Check current bridge capability before executing old methods.',
  };
  const aliases:Record<string,string>={'inventory.items':'inventory',equip:'inventory',setQuickBarSlot:'inventory',findBlock:'findBlocks',canSeeBlock:'blockAt',look:'movement',lookAt:'movement',setControlState:'movement',clearControlStates:'movement',getControlState:'movement',waitForTicks:'movement',activateBlock:'interaction',activateItem:'interaction',deactivateItem:'interaction'};
  if(!(topic in topics)&&!(topic in aliases))throw new Error(`Native JavaScript API ${topic} unavailable; api:compatibility lists gaps`);
  return base+'\n'+topics[aliases[topic]??topic];
}
type Port={rpc(method:string,args:Record<string,unknown>,signal?:AbortSignal):Promise<any>;state(signal?:AbortSignal):Promise<JavaClientState>;owner():Record<string,unknown>;host():WorldHost|null};
const pause=(signal:AbortSignal)=>new Promise<void>((resolve,reject)=>{signal.throwIfAborted();const end=()=>{clearTimeout(timer);signal.removeEventListener('abort',abort);};const abort=()=>{end();reject(signal.reason);};const timer=setTimeout(()=>{end();resolve();},25);signal.addEventListener('abort',abort,{once:true});});

export class JavaMethods {
  readonly runner:MethodRunner;
  private readonly library:MethodLibrary;
  private readonly evidence:NativeEvidenceArchive;
  private readonly epoch=randomUUID();
  private body:string|null=null;
  private bodyCall=0;
  private actionSerial=0;
  private owned=new Set<string>();
  private cleanup:Promise<void>|null=null;
  private uncertain:string|null=null;
  private generation:number|null=null;
  private availableMethods=new Set<string>();
  private renewAt=0;
  constructor(private readonly cfg:JavaClientConfiguration,private readonly port:Port){
    const scope=createHash('sha256').update(JSON.stringify([cfg.expectedServer.toLowerCase().replace(/:25565$/,''),cfg.expectedUuid.replaceAll('-','').toLowerCase(),cfg.controllerId])).digest('hex');
    this.library=new MethodLibrary(join(cfg.ledgerDir,'minecraft-methods',scope));
    this.evidence=new NativeEvidenceArchive(join(cfg.ledgerDir,'native-evidence'));
    this.runner=new MethodRunner({nativeMethods:JAVA_METHODS,call:(method,args,signal)=>this.call(method,args,signal),onFinish:run=>{this.cleanup=this.finish(run).finally(()=>{this.cleanup=null;});}});
  }
  get busy(){return !!this.runner.current||!!this.cleanup||!!this.uncertain;}
  guard(){if(this.busy)throw new Error('A JavaScript method owns execution or cleanup is pending; inspect mc_script runId or explicitly stop it before another body command');}
  async stop(reason:string){this.runner.stop(reason);if(this.cleanup)await this.cleanup;}
  private async finish(run:MethodRun){
    let error:string|undefined;
    for(const id of this.owned){
      try{
        const result:JavaClientAction=await this.port.rpc(run.status==='completed'&&id===this.body?'method_finish':'cancel',{...this.port.owner(),action_id:id},AbortSignal.timeout(2000));
        if(!['completed','partial','blocked','cancelled'].includes(result.phase))throw new Error('Native terminal not confirmed');
        this.owned.delete(id);
      }catch(e){
        // Disconnect/expiry can revoke the lease after the native queue already cancelled it.
        // Reconcile the original persisted action instead of requiring a new controller.
        try{const original:JavaClientAction=await this.port.rpc('result',{action_id:id},AbortSignal.timeout(2000));if(!['completed','partial','blocked','cancelled'].includes(original.phase))throw e;this.owned.delete(id);}
        catch{error=String(e);this.uncertain=id;}
      }
    }
    this.body=null;this.bodyCall=0;
    const phase=error?'blocked':run.status==='completed'||run.status==='validated'?'completed':run.status==='cancelled'?'cancelled':'blocked';
    let raw:ReturnType<NativeEvidenceArchive['save']>|undefined;
    try{raw=this.evidence.save(`method:${this.epoch}:${run.id}`,{script:run,backend:'java-client',cleanup:error??'confirmed'});}catch(e){error=`${error??''} Evidence archive failed: ${String(e)}`;}
    const host=this.port.host();if(host)await host.pushEvent({type:'minecraft.method',source:'minecraft',ts:new Date().toISOString(),
      text:JSON.stringify({program:this.runner.inspect(run.id),backend:'java-client',cleanup:error??'confirmed',goalCompleted:false,raw}),
      execution:{kind:'method',id:`${this.epoch}:${run.id}`,phase,terminal:!this.uncertain,goalCompleted:false,evidence:{localId:run.id,sourceHash:run.sourceHash,cleanup:error??'confirmed',raw}}},{trigger:'flush'}).catch(()=>{});
  }
  private async reconcile(){if(!this.uncertain)return;const action:JavaClientAction=await this.port.rpc('result',{action_id:this.uncertain});if(['completed','partial','blocked','cancelled'].includes(action.phase)){this.owned.delete(this.uncertain);this.uncertain=null;}else throw new Error(`Cleanup unknown for ${this.uncertain}; reconcile original action, no replay`);}
  async execute(args:Record<string,unknown>,ctx:ToolCallContext):Promise<ToolOutcome>{
    if(args.api)return {text:javaMethodHelp(String(args.api))+(args.code?'\nAPI query only: supplied code was not executed.':'')};
    if(args.library){if(Object.keys(args).some(k=>!['library','language'].includes(k)))throw new Error('Use library separately');const q=args.library as Record<string,unknown>;
      const value=q.op==='list'?this.library.list(q):q.op==='read'?this.library.read(String(q.id),q.revision as string|undefined):q.op==='save'?this.library.save(q,this.runner.read(Number(q.validationRunId))[0],ctx.role):null;
      if(value===null)throw new Error('library.op must be list/read/save');return {text:JSON.stringify(value)};}
    if(args.stop===true){if(args.code||args.procedure||args.runId||args.call)throw new Error('Use stop separately');await this.stop('mc_script explicit cancellation');await this.reconcile();return{text:'Method stopped; own native cleanup confirmed'};}
    if(args.code!==undefined||args.procedure!==undefined){
      if(args.runId||args.call||args.code&&args.procedure)throw new Error('Choose code OR procedure; inspect runs separately');
      await this.reconcile();this.guard();ctx.signal?.throwIfAborted();
      if(args.validate!==true){const caps=await this.port.rpc('capabilities',{},ctx.signal);if(caps.methodAdapter!==JAVA_METHOD_PROTOCOL||!Array.isArray(caps.methodCalls)||!JAVA_METHOD_REQUIRED.every(n=>caps.methodCalls.includes(n)))throw new Error('Actual Java bridge lacks agent-mc-method/v1; install matching bridge before JS execution. No Python conversion occurred.');this.availableMethods=new Set(caps.methodCalls);this.generation=(await this.port.state(ctx.signal)).generation;}
      const reference=args.procedure===undefined?undefined:procedureReference(args.procedure);
      const graph=reference?resolveProcedure(reference,METHOD_ADAPTER,handle=>handle.startsWith('mem:mc-method/')?this.library.blob(handle):this.port.host()?.blob(handle)??null):undefined;
      const root=graph?.versions[graph.root];
      const run=this.runner.start({name:root?.id??args.name as string,code:root?.code??args.code as string,params:args.params as Record<string,unknown>|undefined,durationMs:args.durationMs as number|undefined,validate:args.validate===true,...(reference&&graph?{procedure:{reference,graph}}:{})});
      return{text:JSON.stringify(run),execution:{kind:'method',id:`${this.epoch}:${run.id}`,phase:'accepted',terminal:false,goalCompleted:false,evidence:{localId:run.id}}};
    }
    if(args.runId!==undefined&&(!Number.isInteger(args.runId)||Number(args.runId)<1))throw new Error('runId must be positive integer');
    if(args.call!==undefined&&(!args.runId||!Number.isInteger(args.call)||Number(args.call)<1||Number(args.call)>METHOD_LIMITS.calls))throw new Error('call requires runId and range 1..32');
    await this.reconcile();const program=this.runner.inspect(args.runId as number|undefined,args.call as number|undefined);
    return{text:JSON.stringify(args.runId===undefined?program:{...(program as Record<string,unknown>),cleanupPending:!!this.cleanup,cleanupUnknown:this.uncertain})};
  }
  private async fresh(signal?:AbortSignal){const s=await this.port.state(signal);if(!s.connected||this.generation!==null&&s.generation!==this.generation)throw new Error('Method connection changed; no action dispatched');return s;}
  private async snapshot(signal:AbortSignal){const s=await this.fresh(signal);return{sampledAt:s.sampledAt,connectionGeneration:s.generation,snapshot:{position:s.position,dimension:s.dimension,health:s.health,food:s.food,inventory:compactNativeItems(s).inventory?.occupied??null},queue:s.actions,method:this.runner.current,flight:null,temporaryScaffolds:null,combatActive:null,combat:null,nativeState:compactNativeState(s)};}
  private async renew(signal:AbortSignal){if(Date.now()<this.renewAt)return;await this.port.rpc('renew',{...this.port.owner(),ttlMs:this.cfg.leaseMs},signal);this.renewAt=Date.now()+this.cfg.leaseMs/2;}
  private async wait(id:string,signal:AbortSignal,starting=false):Promise<JavaClientAction>{for(;;){signal.throwIfAborted();await this.renew(signal);const result:JavaClientAction=await this.port.rpc('result',{action_id:id},signal);if(starting&&result.phase==='running'||!['accepted','running'].includes(result.phase))return result;await pause(signal);}}
  private async submit(operation:string,input:Record<string,unknown>,signal:AbortSignal,starting=false){
    const owner=this.port.owner(),id=`js-${this.epoch}-${++this.actionSerial}`;await this.renew(signal);this.owned.add(id);
    await this.port.rpc('do',{...owner,action_id:id,operation,input,queue:'append',expectedGeneration:this.generation},signal);
    const result=await this.wait(id,signal,starting);if(!starting&&result.phase!=='unknown')this.owned.delete(id);return result;
  }
  private async call(method:MethodOperation,args:Record<string,unknown>,signal:AbortSignal):Promise<unknown>{
    signal.throwIfAborted();await this.fresh(signal);
    if(method==='state')return this.snapshot(signal);
    if(method==='flightPlan')throw new Error('flightPlan is unavailable on the native Java backend');
    if(method==='do'){
      if(this.body)throw new Error('bot body session already reserved; mc.do would wait on itself');
      let command:ReturnType<typeof translateJavaLegacy>;
      try{command=translateJavaLegacy(args,await this.fresh(signal));}catch(e){return{accepted:false,done:false,kind:'rejected',receipt:String(e),steps:[],state:await this.snapshot(signal)};}
      const action=await this.submit(command.operation,command.input,signal);
      const raw=this.evidence.save(action.id,action),compact={...action,evidence:compactNativeState(action.evidence??{}),raw};
      return{accepted:true,taskId:action.id,kind:action.phase==='completed'?'done':action.phase,done:action.phase==='completed',receipt:JSON.stringify(compact),steps:[{step:1,outcome:action.phase==='completed'?'ok':action.phase==='partial'?'partial':'fail',why:action.reason??null}],state:await this.snapshot(signal)};
    }
    if(typeof args.name!=='string'||!Array.isArray(args.args)||!JAVA_METHODS.includes(args.name))throw new Error('Unsupported native bot method; api:compatibility lists gaps');
    if(!this.availableMethods.has(args.name))throw new Error(`Actual Java bridge does not advertise bot.${args.name}; update the bridge or use its supported methods. No native call dispatched.`);
    if(READS.has(args.name))return this.port.rpc('method_read',{name:args.name,args:args.args,expectedGeneration:this.generation},signal);
    if(!this.body){const action=await this.submit('method.run',{durationMs:METHOD_LIMITS.maxDurationMs},signal,true);if(action.phase!=='running')throw new Error(`Native body session ${action.id} did not start: ${action.phase}`);this.body=action.id;}
    const request={...this.port.owner(),action_id:this.body,call:++this.bodyCall,name:args.name,args:args.args,expectedGeneration:this.generation};
    let result=await this.port.rpc('method_call',request,signal);
    while(result.status==='running'){await pause(signal);await this.renew(signal);result=await this.port.rpc('method_result',{...this.port.owner(),action_id:this.body,call:this.bodyCall},signal);}
    if(result.status!=='completed')throw new Error(result.error??'Native method terminal unknown');
    return{value:result.value??null,taskId:this.body,nativeMethod:args.name,call:this.bodyCall,sampledAt:new Date().toISOString(),dispatchOnly:['activateBlock','activateItem','deactivateItem'].includes(args.name)};
  }
}
