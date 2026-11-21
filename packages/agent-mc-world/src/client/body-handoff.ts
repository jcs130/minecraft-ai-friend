import { createHash } from 'node:crypto';
import type { ToolDef, ToolCallContext, ToolOutcome } from './contracts.ts';

export type CharacterBodyKind = 'mineflayer' | 'numen' | 'maid' | 'villager';
export type CharacterBodyRequest =
  | { op: 'current'; characterId: string }
  | { op: 'lookup'; characterId: string; requestId: string }
  | { op: 'controllerSwitch'; characterId: string; expectedGeneration: number; targetKind: CharacterBodyKind; requestId: string };

/** The host binds authorization and transport to one player body and generation. No credentials enter tool arguments. */
export interface MineflayerHandoffPort {
  readonly characterId: string;
  readonly playerUuid: string;
  readonly generation: number;
  /** Private server plugin channel for proving this exact connection. Never exposed as a game tool. */
  readonly witnessChannel?: string;
  /** A bound local controller may reply synchronously. A remote transport may return a promise. */
  request(message: CharacterBodyRequest): unknown;
}

const kinds: CharacterBodyKind[] = ['mineflayer', 'numen', 'maid', 'villager'];
const validId = (id: unknown): id is string => typeof id === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(id);
type Snapshot = { characterId: string; generation: number; activeKind: CharacterBodyKind | null; status: string;
  targetKinds?: CharacterBodyKind[]; requestId?: string; pendingRequestId?: string | null; targetKind?: CharacterBodyKind; phase?: string; reason?: string; autonomous?: boolean };

export class MineflayerHandoffSession {
  readonly characterId: string;
  readonly playerUuid: string;
  readonly generation: number;
  private readonly witnessChannel?: string;
  private readonly send: MineflayerHandoffPort['request'];
  private fence: string | null = null;
  private detached = false;

  constructor(port: MineflayerHandoffPort) {
    if (!validId(port.characterId) || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(port.playerUuid) ||
        !Number.isSafeInteger(port.generation) || port.generation < 1) throw Error('Invalid host body binding');
    this.characterId = port.characterId;
    this.playerUuid=port.playerUuid;
    if (port.witnessChannel !== undefined && (!/^[a-z0-9_.-]{1,64}:[a-z0-9_./-]{1,96}$/.test(port.witnessChannel) ||
        port.witnessChannel.startsWith('minecraft:'))) throw Error('Invalid private body witness channel');
    this.witnessChannel=port.witnessChannel;
    this.generation = port.generation;
    this.send = port.request.bind(port);
  }

  assertOpen(): void {
    if (this.fence !== null || this.detached) throw Error('Body control is fenced. Read the original handoff request.');
  }

  private async read(message: CharacterBodyRequest): Promise<Snapshot> {
    let data: Partial<Snapshot> | null;
    try { data = await this.send(message) as Partial<Snapshot> | null; }
    catch { throw Error('The host could not confirm the original body request'); }
    if (!data || data.characterId !== this.characterId || !Number.isSafeInteger(data.generation) ||
        typeof data.status !== 'string' || (data.activeKind !== null && !kinds.includes(data.activeKind!)) ||
        (message.op !== 'current' && data.requestId !== message.requestId) ||
        (message.op === 'controllerSwitch' && data.targetKind !== message.targetKind)) throw Error('Unconfirmed original body receipt');
    // Do not surface host, transport or credential metadata.
    const result: Snapshot = { characterId:this.characterId, generation:data.generation!, activeKind:data.activeKind!, status:data.status };
    if (data.requestId && validId(data.requestId)) result.requestId=data.requestId;
    if (data.pendingRequestId && validId(data.pendingRequestId)) result.pendingRequestId=data.pendingRequestId;
    if (kinds.includes(data.targetKind!)) result.targetKind=data.targetKind;
    if (Array.isArray(data.targetKinds)) result.targetKinds=data.targetKinds.filter(kind=>kinds.includes(kind));
    if (typeof data.autonomous === 'boolean') result.autonomous=data.autonomous;
    if (typeof data.phase === 'string') result.phase=data.phase;
    if (typeof data.reason === 'string') result.reason=data.reason;
    if (result.requestId === this.fence && result.status === 'blocked' && result.generation === this.generation &&
        result.activeKind === 'mineflayer' && !this.detached) this.fence=null;
    return result;
  }

  async verifyConnect(acquireRequest?: string): Promise<void> {
    if (!acquireRequest) this.assertOpen();
    const current = await this.read({op:'current',characterId:this.characterId});
    if (current.generation !== this.generation) throw Error('Body generation changed');
    if (!acquireRequest && current.status === 'ready' && current.activeKind === 'mineflayer') return;
    if (acquireRequest && current.status === 'switching' && current.pendingRequestId === acquireRequest) {
      const receipt=await this.read({op:'lookup',characterId:this.characterId,requestId:acquireRequest});
      if (receipt.phase === 'acquiring' && receipt.status === 'switching' && receipt.targetKind === 'mineflayer' && receipt.generation === this.generation) {
        this.freeze(acquireRequest); return;
      }
    }
    throw Error('This Mineflayer session does not own the active player body');
  }

  async preflight(requestId:string, targetGeneration:number):Promise<boolean> {
    if (!validId(requestId) || targetGeneration!==this.generation || this.fence!==null || this.detached) return false;
    const receipt=await this.read({op:'lookup',characterId:this.characterId,requestId});
    return receipt.status==='switching' && receipt.phase==='releasing' &&
      receipt.generation+1===targetGeneration && receipt.targetKind==='mineflayer';
  }

  async refresh(requestId:string):Promise<Snapshot> {
    if (!validId(requestId)) throw Error('Invalid original handoff request ID');
    const data=await this.read({op:'lookup',characterId:this.characterId,requestId});
    if (data.requestId===this.fence && !this.detached && data.status==='completed' &&
        data.targetKind==='mineflayer' && data.activeKind==='mineflayer' && data.generation===this.generation) this.fence=null;
    return data;
  }

  freeze(id: string): void {
    if (!validId(id) || this.detached || (this.fence !== null && this.fence !== id)) throw Error('Another handoff owns this body fence');
    this.fence=id;
  }

  markDetached(): void { this.detached=true; }

  async witnessChannelFor(requestId:string,generation:number):Promise<string> {
    if (!this.witnessChannel || this.detached || !validId(requestId) || generation!==this.generation)
      throw Error('No active host authorization for a connection witness');
    const receipt=await this.read({op:'lookup',characterId:this.characterId,requestId});
    if (receipt.status!=='switching' || receipt.generation!==this.generation ||
        !(receipt.phase==='releasing' && receipt.activeKind==='mineflayer' ||
          receipt.phase==='acquiring' && receipt.targetKind==='mineflayer')) throw Error('Handoff phase does not match the original connection');
    return this.witnessChannel;
  }

  tool(name: string): ToolDef {
    return { name, description:'Inspect your character’s available bodies, choose one, or look up the original handoff receipt. An accepted switch ends this turn. Read its request ID before taking another action.',
      tags:['flow','write'], bodyControl:'independent', readOnlyCall:args=>args.action==='lookup'||args.action==='current',
      parameters:{type:'object',additionalProperties:false,required:['action'],properties:{
        action:{enum:['current','switch','lookup']},targetKind:{enum:kinds},requestId:{type:'string',maxLength:128}}},
      handler:(args,ctx)=>this.handle(args,ctx) };
  }

  private async handle(args: Record<string,unknown>, ctx: ToolCallContext): Promise<ToolOutcome> {
    ctx.signal?.throwIfAborted();
    const keys=Object.keys(args);
    let data:Snapshot, endsTurn=false;
    if (args.action==='current' && keys.length===1) {
      data = await this.read({op:'current',characterId:this.characterId});
    } else if (args.action==='lookup' && keys.length===2 && validId(args.requestId)) {
      data=await this.refresh(args.requestId);
    } else if (args.action==='switch' && keys.length===2 && kinds.includes(args.targetKind as CharacterBodyKind) && ctx.callId) {
      const requestId='turn-'+createHash('sha256').update(ctx.callId).digest('hex');
      this.assertOpen();
      const current=await this.read({op:'current',characterId:this.characterId});
      if (current.status!=='ready'||current.activeKind!=='mineflayer'||current.generation!==this.generation||
          !current.autonomous||!current.targetKinds?.includes(args.targetKind as CharacterBodyKind)) throw Error('Target is not available to this Mineflayer controller');
      this.freeze(requestId);
      endsTurn=true;
      try {
        data=await this.read({op:'controllerSwitch',characterId:this.characterId,requestId,expectedGeneration:this.generation,targetKind:args.targetKind as CharacterBodyKind});
      } catch {
        return {text:'Handoff outcome unknown. Look up the original request ID.',failed:true,endsTurn,
          data:{characterId:this.characterId,requestId,status:'unknown',retryable:false}};
      }
    } else throw Error('Use current, switch with targetKind, or lookup with the original requestId');
    return {text:JSON.stringify(data),data:{...data},...(endsTurn?{endsTurn:true}:{})};
  }
}
