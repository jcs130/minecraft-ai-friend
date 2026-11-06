import { randomUUID } from 'node:crypto';
import { PROTOCOL, MODES, identity, keyOf, opaqueId, inputFrame, digest, fail } from './protocol.mjs';
import { numenCorePort } from './core-port.mjs';

// The game-side driver owns the last fence. It must confirm that native tasks,
// model calls and held inputs are stopped before a new epoch can drive the body.
export class HostedRoles {
  constructor({store,body,harness,profiles,now=Date.now}) {
    this.store=store; this.body=body; this.harness=harness; this.profiles=profiles; this.now=now;
    this.boot=randomUUID(); this.locks=new Map(); this.manual=new Map(); this.transitions=new Map();
  }
  async serial(id, task) {
    if (this.locks.has(id)) throw fail('TRANSITION_BUSY','角色正在切换控制方式，请先查询状态。');
    this.locks.set(id,true);
    try { return await task(); } finally { this.locks.delete(id); }
  }
  owned(role) {
    role=identity(role); const row=this.store.get(keyOf(role));
    if (!row || row.binding!==JSON.stringify(role)) throw fail('ROLE_NOT_BOUND','请从官网选择已绑定的角色。',403);
    return row;
  }
  public(row) {
    return {protocol:PROTOCOL,role:JSON.parse(row.binding),mode:row.mode,state:row.state,epoch:row.epoch,problem:row.problem,
      unresolvedRequest:this.store.unknown(row.id)?.id??null};
  }
  status(role) { return this.public(this.owned(role)); }
  async attach(role) {
    const row=this.store.bind(role);
    if(row.state==='ready')return this.public(row);
    return this.serial(row.id,async()=>{
      let next=this.store.transition(row.id,'paused','transitioning');
      try {
        const result=await this.body.attach(JSON.parse(row.binding),{boot:this.boot,epoch:next.epoch});
        this.assertBody(row,result);
        if (result.fenced!==true) throw fail('BODY_NOT_FENCED','身体尚未确认停止旧控制器，不能接管。');
        return this.public(this.store.state(row.id,next.epoch,'ready'));
      } catch(error) {
        this.store.state(row.id,next.epoch,'recovery_required',error.code??'ATTACH_UNKNOWN'); throw error;
      }
    });
  }
  assertBody(row,result) {
    if (!result || result.protocol!==PROTOCOL || result.roleUuid!==row.uuid || result.serverId!==row.server
        || result.name!==row.name || result.bodyKind!=='numen')
      throw fail('BODY_IDENTITY_MISMATCH','身体身份或后端不匹配，已停止接管；不会另开 Mineflayer 登录。');
  }
  async switch(role,mode,{controllerId,runtime}={}) {
    const row=this.owned(role);
    if(mode==='paused'&&row.state==='detached')return this.public(row);
    if (!MODES.includes(mode)) throw fail('MODE_INVALID','请选择 numen、harness、manual 或 paused。',400);
    if (mode==='manual') opaqueId(controllerId,'网页控制器编号');
    if (mode==='harness' && (!this.harness || !runtime)) throw fail('HARNESS_REQUIRED','请选择服务端已配置的 Harness；不会创建第二套模型循环。',400);
    return this.serial(row.id,async()=>{
      if (['numen','harness'].includes(mode) && this.store.unknown(row.id)) throw fail('ACTION_UNRESOLVED','上次动作结果未知；先查询原请求回执，确认后再切换，不要重放。');
      if(['numen','harness'].includes(mode))this.profiles?.require(role,mode,runtime);
      const current=this.store.get(row.id);
      if(this.profiles?.active.get(row.id)?.lease?.isolatedByok===true&&current.state==='ready'&&current.mode===mode&&['numen','harness'].includes(mode))return this.status(role);
      if(!this.profiles)await this.body.prepare?.(role,mode);
      let next=this.store.transition(row.id,'paused','transitioning');
      this.manual.delete(row.id);
      try {
        // Fence the actual body first: a late model answer is no longer allowed
        // to act even if a harness process is still draining its cancellation.
        const fence=await this.body.transition(role,{boot:this.boot,epoch:next.epoch,mode:'paused'});
        this.assertBody(row,fence);
        if (!fence.fenced) throw fail('CANCEL_UNKNOWN','服务端尚未确认旧动作停止；请查状态，不要重复提交动作。');
        const stopped=await this.harness?.stop(role);
        if (stopped && stopped.stopped!==true) throw fail('HARNESS_STOP_UNKNOWN','Harness 尚未确认停止，继续保持暂停。');
        await this.profiles?.stop(role);
        if(['numen','harness'].includes(mode))await this.profiles?.start(role,mode,runtime);
        if(this.profiles)await this.body.prepare?.(role,mode);
        if (mode==='harness') await this.harness.prepare(role,runtime);
        // Every game-side transition consumes a new generation, including stop.
        if(mode!=='paused')next=this.store.transition(row.id,'paused','transitioning');
        const confirmed=mode==='paused'?fence:await this.body.transition(role,{boot:this.boot,epoch:next.epoch,mode,controllerId});
        this.assertBody(row,confirmed);
        if (confirmed.mode!==mode || confirmed.epoch!==next.epoch || !confirmed.fenced)
          throw fail('TRANSITION_UNKNOWN','服务端尚未确认新控制方式，请查询状态。');
        this.store.db.prepare('UPDATE roles SET mode=?,state=? WHERE id=? AND epoch=?').run(mode,'ready',row.id,next.epoch);
        if (mode==='manual') this.manual.set(row.id,{controllerId,epoch:next.epoch,lastSequence:-1,expires:this.now()+3000});
        if (mode==='harness') await this.harness.start(role,{runtime,epoch:next.epoch,port:numenCorePort(this,role,next.epoch),
          call:(id,tool,args)=>this.call(role,{id,epoch:next.epoch,tool,args})});
        return this.status(role);
      } catch(error) {
        this.manual.delete(row.id);
        const recovery=this.store.transition(row.id,'paused','recovery_required');
        this.store.state(row.id,recovery.epoch,'recovery_required',error.code??'TRANSITION_UNKNOWN');
        // Explicitly try to stop once, but never turn a failed stop into success.
        try { await this.body.transition(role,{boot:this.boot,epoch:recovery.epoch,mode:'paused'}); } catch {}
        // Keep the binding if stop is uncertain; another profile cannot start.
        try { if((await this.harness?.stop(role))?.stopped!==false)await this.profiles?.stop(role); } catch {}
        throw error;
      }
    });
  }
  async release(role) {
    const original=this.owned(role);if(original.state==='detached')return this.public(original);
    await this.switch(role,'paused');
    return this.serial(original.id,async()=>{
      const row=this.owned(role);
      if(row.mode!=='paused'||row.state!=='ready')throw fail('HOSTING_MUST_PAUSE','先暂停当前控制器，再退出托管。');
      if(this.store.unknown(row.id))throw fail('ACTION_UNRESOLVED','先查询原动作结果，再退出托管；不会丢弃未知回执。');
      try{
        const result=await this.body.release(role,{boot:this.boot,epoch:row.epoch});this.assertBody(row,result);
        if(result.detached!==true||result.fenced!==true)throw fail('RELEASE_UNKNOWN','角色退出结果未确认，先查询原状态，不要重复登录。');
        return this.public(this.store.state(row.id,row.epoch,'detached'));
      }catch(error){this.store.state(row.id,row.epoch,'recovery_required',error.code??'RELEASE_UNKNOWN');throw error;}
    });
  }
  async saveProfile(role,input) {
    const row=this.store.bind(role);
    return this.serial(row.id,async()=>{
      if(row.mode!=='paused'||!['ready','detached'].includes(row.state))throw fail('HOSTING_MUST_PAUSE','请先暂停托管，确认身体停止后再修改模型设置。');
      if(!this.profiles)throw fail('HOSTING_CONFIGURATION_UNAVAILABLE','托管设置尚未接通。',503);
      return this.profiles.save(role,input);
    });
  }
  async input(role,controllerId,epoch,value) {
    const frame=inputFrame(value),row=this.owned(role),lease=this.manual.get(row.id);
    if (row.state!=='ready'||row.mode!=='manual'||epoch!==row.epoch||!lease||lease.epoch!==epoch
        ||lease.controllerId!==controllerId||lease.expires<=this.now())
      throw fail('CONTROL_EXPIRED','网页接管已失效，请重新点接管；旧按键不会重放。');
    if (frame.sequence<=lease.lastSequence) throw fail('STALE_INPUT','丢弃过期输入，请发送新的完整按键状态。');
    lease.lastSequence=frame.sequence;
    const result=await this.body.input(role,{boot:this.boot,epoch,controllerId,...frame});
    if (this.manual.get(row.id)!==lease) throw fail('CONTROL_CHANGED','控制方式已切换，这帧不再作为有效控制回执。');
    if (result.epoch!==epoch||result.sequence!==frame.sequence) throw fail('INPUT_UNKNOWN','输入未得到匹配回执，请查询控制状态。');
    lease.expires=this.now()+3000;
    return result;
  }
  async call(role,{id,epoch,tool,args={}}) {
    const row=this.owned(role); opaqueId(id);
    const signature=digest({tool,args});
    const saved=this.store.request(row.id,id);
    if (saved) {
      if(saved.signature!==signature) throw fail('REQUEST_CONFLICT','同一请求编号不能更换动作参数。');
      return saved.receipt?JSON.parse(saved.receipt):{id,state:saved.state};
    }
    if (row.state!=='ready'||row.mode!=='harness'||epoch!==row.epoch)
      throw fail('CONTROL_CHANGED','Harness 已失去身体控制权，请重新观察；不要重放旧决定。');
    if(this.store.unknown(row.id)) throw fail('ACTION_UNRESOLVED','已有未结算动作；先查询原请求。');
    if (!['lua','say','skill','todo','memory','guide'].includes(tool))
      throw fail('TOOL_UNAVAILABLE','请查询当前 Numen 工具目录；创建／删除身体不属于模型动作。',400);
    if (typeof args!=='object'||args===null||Array.isArray(args)||Object.keys(args).some(k=>['companion','token','password','_hosted'].includes(k)))
      throw fail('ARGUMENT_INVALID','不要在动作中改角色身份或传入登录凭据。',400);
    this.store.reserve(row.id,id,signature,epoch);
    let receipt;
    try {
      receipt=await this.body.call(role,{boot:this.boot,epoch,id,tool,args});
      if(receipt.id!==id || !['completed','partial','blocked','cancelled','unknown'].includes(receipt.state))
        throw fail('RECEIPT_INVALID','原动作回执不完整，结果未知。');
    } catch { receipt={id,state:'unknown',message:'动作是否执行尚未确认；查询原请求，不要换编号重试。'}; }
    this.store.finish(row.id,id,receipt.state,receipt);
    return receipt;
  }
  async reconcile(role,id) {
    const row=this.owned(role),old=this.store.request(row.id,opaqueId(id));
    if(!old) throw fail('REQUEST_NOT_FOUND','没有这个请求的本地记录。',404);
    if(!['unknown','pending'].includes(old.state)) return JSON.parse(old.receipt);
    const receipt=await this.body.result(role,id);
    if(receipt.id!==id||!['completed','partial','blocked','cancelled','unknown'].includes(receipt.state))
      throw fail('RECEIPT_INVALID','服务端没有返回可核对的原请求结果。');
    this.store.finish(row.id,id,receipt.state,receipt); return receipt;
  }
  async expire(onlyId) {
    const results=await Promise.allSettled([...this.manual].map(async([id,lease])=>{
      if(onlyId&&id!==onlyId)return;
      if(lease.expires>this.now()||this.locks.has(id))return;
      const row=this.store.get(id);
      await this.switch(JSON.parse(row.binding),'paused');
    }));
    const failed=results.find(result=>result.status==='rejected');
    if(failed)throw failed.reason;
  }
}
