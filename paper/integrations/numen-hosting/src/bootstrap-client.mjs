import {createHmac} from 'node:crypto';
import {identity,fail} from './protocol.mjs';

export function hostedBootstrapClient({endpoint,controlKey,fetcher=fetch}) {
  const url=new URL(endpoint);
  if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||url.pathname!=='/v1/hosted-role'||url.username||url.password||url.search||url.hash
      ||!Buffer.isBuffer(controlKey)||controlKey.length!==32)throw new Error('Explicit protected loopback bootstrap required');
  async function call(supplied,op,scope={}) {
    const role=identity(supplied),payload=Buffer.from(JSON.stringify({op,roleUuid:role.roleUuid,ownerUuid:role.numenOwnerUuid,name:role.name,expires:Date.now()+45000,...scope})).toString('base64url');
    const signature=createHmac('sha256',controlKey).update(payload).digest('base64url');
    let response,value;
    try{response=await fetcher(url,{method:'POST',redirect:'error',signal:AbortSignal.timeout(50000),headers:{'content-type':'application/json'},body:JSON.stringify({payload,signature})});
      const text=await response.text();if(text.length>8192)throw Error();value=JSON.parse(text);}
    catch{throw fail('HOSTED_ADMISSION_UNKNOWN','接入结果暂不确定，请查询原角色；不要重新建号或替换 UUID。',503);}
    if(!response.ok)throw fail('HOSTED_ROLE_NOT_READY','请先让此角色的原客户端正常退出，再在官网启动托管。旧版 Numen 角色须单独迁移，不能直接占用。',409);
    if(value.roleUuid!==role.roleUuid)throw fail('BODY_IDENTITY_MISMATCH','托管接入返回了不同角色，已停止。',503);
    return value;
  }
  async function player(role,op,{characterId,requestId,generation,expect}) {
    const id=/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;
    if(typeof characterId!=='string'||!id.test(characterId)||typeof requestId!=='string'||!id.test(requestId)||
        !Number.isSafeInteger(generation)||generation<1||!['saved','client'].includes(expect))throw fail('INVALID_PLAYER_WITNESS','玩家交接需要原请求、控制版本和角色。',400);
    const scope={characterId,requestId,generation,expect};
    const value=await call(role,op,scope);
    if(value.uuid!==role.roleUuid||Object.entries(scope).some(([key,v])=>value[key]!==v)
        ||['online','saved','witnessed'].some(key=>typeof value[key]!=='boolean')
        ||!['mineflayer','ordinary','other','offline'].includes(value.kind)
        ||(value.saved && (!value.witnessed || value.online || expect!=='saved'))
        ||(value.kind==='mineflayer' && (!value.online || !value.witnessed))
        ||(op==='arm_player_witness' && (value.channel!=='qiandengji:handoff'||!/^[0-9a-f]{64}$/.test(value.nonce)))) {
      throw fail('PLAYER_WITNESS_MISMATCH','无法核实同一请求与玩家连接，请查询原请求。',503);
    }
    return value;
  }
  return {admit:role=>call(role,'admit'),session:role=>call(role,'session'),
    armPlayer:(role,scope)=>player(role,'arm_player_witness',scope),
    playerState:(role,scope)=>player(role,'player_state',scope)};
}
