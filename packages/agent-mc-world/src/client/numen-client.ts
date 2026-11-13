import type { ToolDef, ToolOutcome, World, WorldHost, WorldRequestFacts } from '../contracts/host.ts';
import { numenCombatFrame, type NumenBattlefieldSample } from './numen-battlefield.ts';

export type NumenBodyFacts = {
  uuid: string; server: string; sampledAt: number;
  health: number; maxHealth: number; food: number; dimension: string;
  position: readonly [number, number, number]; workPending: boolean;
};

/** A scoped, fenced body transport supplied explicitly by its host. No model,
 * identity registration, login socket or second body queue is created here. */
export interface NumenBodyPort {
  identity: { server: string; uuid: string; name: string };
  connect(): Promise<{ uuid: string; server: string; ready: boolean }>;
  disconnect(): Promise<void>;
  /** Optional, freshly sampled status. Excludes inbox and chat text. */
  facts?(signal?: AbortSignal): Promise<NumenBodyFacts|null>;
  /** Fresh visible threats for the current idle Harness lease. Null when unavailable or occupied. */
  battlefield?(signal?: AbortSignal): Promise<NumenBattlefieldSample | null>;
  /** Non-consuming state; never substitute get_events and steal the inbox. */
  observe(signal?: AbortSignal): Promise<{ text: string; sampledAt: number; uuid: string; server: string }>;
  catalog(signal?: AbortSignal): Promise<Array<{name: string; description: string; parameters: Record<string,unknown>}>>;
  call(request: { id: string; tool: string; args: Record<string,unknown>; signal?: AbortSignal }): Promise<ToolOutcome>;
  result(id: string, signal?: AbortSignal): Promise<ToolOutcome>;
}

/** Numen's native tool vocabulary through the shared MC host/receipt contract.
 * Lua and Mineflayer JavaScript are distinct capabilities, not interchangeable. */
export class NumenClientWorld implements World {
  readonly id='minecraft-numen';
  private ready=false;
  private facts: WorldRequestFacts|null=null;
  private brief: NumenBodyFacts|null=null;
  private readonly port:NumenBodyPort;
  constructor(port:NumenBodyPort) {this.port=port;}
  async start(_host:WorldHost) {
    if(this.ready)return;
    const state=await this.port.connect();
    if(!state.ready||state.uuid!==this.port.identity.uuid||state.server!==this.port.identity.server){
      await this.port.disconnect();throw new Error('Numen body is not ready or its identity differs from the selected role.');
    }
    this.ready=true;
  }
  async stop(){this.ready=false;this.facts=null;this.brief=null;await this.port.disconnect();}
  async combatFrame(generation: number, signal: AbortSignal) {
    if (!this.ready || !this.port.battlefield) return null;
    const sample = await this.port.battlefield(signal);
    signal.throwIfAborted();
    return this.ready ? numenCombatFrame(sample, generation) : null;
  }
  connectionReadiness(){return{ready:this.ready,phase:this.ready?'numen-hosted':'disconnected',disconnectStopsBody:false};}
  async refreshFacts(signal: AbortSignal) {
    if(!this.ready||!this.port.facts)return;
    this.brief=null;
    const state=await this.port.facts(signal);
    signal.throwIfAborted();
    if(!this.ready||!state)return;
    if(state.uuid!==this.port.identity.uuid||state.server!==this.port.identity.server){
      this.ready=false;this.facts=null;
      throw new Error('Numen body facts do not match the selected identity.');
    }
    if(!Number.isFinite(state.sampledAt)||!Number.isFinite(state.health)||!Number.isFinite(state.maxHealth)
      ||!Number.isInteger(state.food)||typeof state.dimension!=='string'||state.position?.length!==3
      ||!state.position.every(Number.isInteger)||typeof state.workPending!=='boolean')
      throw new Error('Numen body returned invalid sampled facts.');
    this.brief=state;
  }
  requestFacts(): WorldRequestFacts|null {
    const state=this.brief;
    if(!state)return this.facts;
    return {text:this.facts?.text??'',snapshotTypes:['numen.state'],parts:[
      {key:'sample',text:String(state.sampledAt)},
      {key:'body',text:`health ${state.health}/${state.maxHealth}, food ${state.food}/20`},
      {key:'place',text:`${state.dimension} [${state.position.join(',')}]`},
      {key:'nativeWork',text:state.workPending?'running':'idle'},
      ...(this.facts?.text ? [{key:'world',text:this.facts.text}] : []),
    ]};
  }
  environment(){return 'Minecraft body: Numen server player. Use mc_protocol to mark actual decision turns and read current facts. Use mc_numen op=catalog for native tools and their schemas, then op=observe for current state. Call advertised tools through op=call. Numen executes Lua, not Mineflayer JavaScript. If you receive a combat attention event, use its native target reference to recheck the visible threat and decide whether to engage, observe or retreat; it records no action. Preserve request IDs. Dispatch is not task completion: read the original result and current state. Do not replay unknown actions, invent commands, summon another body, or drive after CONTROL_CHANGED. The host owns authentication, model choice and manual takeover.';}
  envPromptVars(){return {world:'Minecraft',body:'Numen server body',
    instructions:'Use mc_numen catalog, then observe and call the advertised native tool. Lua is Numen Lua, not Mineflayer JavaScript. A dispatch receipt is not success. Reconcile an unknown request by its original ID; never replay it. This adapter does not own a model loop.'};}
  tools():ToolDef[]{return [{
    name:'mc_numen',description:'Numen 身体：先 catalog 查实际工具，再 observe 看当前状态，call 执行；result 查询原请求。保留当前角色和游戏数据。',
    parameters:{type:'object',required:['op'],properties:{op:{enum:['catalog','observe','call','result']},
      tool:{type:'string'},args:{type:'object'},requestId:{type:'string'}},additionalProperties:false},
    tags:['read','act'],bodyControl:'exclusive',interruptible:true,
    readOnlyCall:args=>['catalog','observe','result'].includes(String(args.op)),
    handler:async(args,context)=>{
      if(!this.ready)return{failed:true,text:'Numen 身体未就绪，请在托管服务中核对角色与控制方式。'};
      if(args.op==='catalog')return{text:JSON.stringify(await this.port.catalog(context.signal))};
      if(args.op==='observe'){
        const state=await this.port.observe(context.signal);
        if(state.uuid!==this.port.identity.uuid||state.server!==this.port.identity.server){
          this.ready=false;this.facts=null;this.brief=null;return{failed:true,text:'身体身份不匹配，已停止动作；请重新选择角色。'};
        }
        if(!Number.isFinite(state.sampledAt)){this.facts=null;return{failed:true,text:'状态缺少实际采样时间；不能当成当前世界事实。'};}
        // Preserve the producer's timestamp in cached facts. Reading the cache
        // later must not make an old position look newly sampled.
        const text=`Numen observation at ${state.sampledAt} ms; server=${state.server}; uuid=${state.uuid}\n${state.text}`;
        this.facts={text,snapshotTypes:['numen.state']};
        return{text,meta:{sampledAt:state.sampledAt,backend:'numen'}};
      }
      if(args.op==='result'&&typeof args.requestId==='string')return this.port.result(args.requestId,context.signal);
      if(args.op==='call'){
        const id=context.callId;
        if(!id)return{failed:true,text:'动作需要宿主分配的稳定 callId；不得随机重发结果未知的动作。'};
        if(typeof args.tool!=='string'||!args.args||typeof args.args!=='object'||Array.isArray(args.args))
          return{failed:true,text:'用 call + catalog 中的 tool 和 args；先查 catalog 确认用法。'};
        return this.port.call({id,tool:args.tool,args:args.args as Record<string,unknown>,signal:context.signal});
      }
      return{failed:true,text:'用法：mc_numen op=catalog|observe|call|result；result 需要原 requestId。'};
    }
  }];}
}
