import {createHmac,randomUUID} from 'node:crypto';
import {identity,signGrant,PROTOCOL,fail} from './protocol.mjs';

/** Runs inside the website backend after its existing session, Origin and CSRF
 * checks. Uses its current ownership tables; never accepts owner/name from a
 * browser and never reads game passwords or changes account ownership. */
export function portalHostingAuthority({store,serverId,grantKey,ordinaryRoles,now=Date.now}) {
  const principalFor=owner=>{const h=createHmac('sha256',grantKey).update('hosting-principal:'+serverId+':'+owner).digest('hex');return`${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`;};
  const withRole=(role,fn)=>role?.then?role.then(fn):fn(role);
  function roleFor(authenticatedOwnerId,roleUuid) {
    const time=now();
    const owned=store.db.prepare('SELECT owner_id FROM ownerships WHERE agent_uuid=?').get(roleUuid);
    if(!owned||owned.owner_id!==authenticatedOwnerId)
      throw fail('ROLE_NOT_OWNED','请先登录官网，并选择自己已绑定的角色。',403);
    const native=store.db.prepare('SELECT name,creator_uuid,state,last_seen FROM numen_creator_relations WHERE player_uuid=?').get(roleUuid);
    if(!native){
      if(!ordinaryRoles)throw fail('NUMEN_BODY_NOT_ADMITTED','此角色尚未接入同 UUID 的 Numen 身体；可继续使用现有 Mineflayer，不能按名字另建身体。');
      return Promise.resolve(ordinaryRoles()).then(rows=>{
        const row=rows.find(r=>r.playerUuid===roleUuid);
        if(!row||row.reserved||row.isReserved||row.historical||row.identityConflict)throw fail('ROLE_NOT_AVAILABLE','该角色当前不能托管，请选择本人正常角色。',409);
        if(store.db.prepare('SELECT owner_id FROM ownerships WHERE agent_uuid=?').get(roleUuid)?.owner_id!==authenticatedOwnerId)throw fail('ROLE_NOT_OWNED','角色归属已变化，请刷新。',403);
        return identity({ownerId:authenticatedOwnerId,serverId,roleUuid,numenOwnerUuid:principalFor(authenticatedOwnerId),name:row.name});
      });
    }
    const creator=store.db.prepare('SELECT owner_id FROM ownerships WHERE agent_uuid=?').get(native.creator_uuid);
    if(native.state!=='bound'||(creator?.owner_id!==authenticatedOwnerId&&native.creator_uuid!==principalFor(authenticatedOwnerId)))
      throw fail('NUMEN_OWNERSHIP_CONFLICT','Numen 原生归属与官网绑定不一致，请核对原角色；不会覆盖归属。',403);
    if(!Number.isSafeInteger(native.last_seen)||Math.abs(time-native.last_seen)>45000)
      throw fail('NUMEN_IDENTITY_STALE','服务端角色归属资料尚未同步，请等待账号桥刷新后再试。',503);
    return identity({ownerId:authenticatedOwnerId,serverId,roleUuid,numenOwnerUuid:native.creator_uuid,name:native.name});
  }
  return {roleFor,conversation(viewer,roleUuid) {
    // Caller has just checked the selected channel's current public/owner scope.
    const owner=store.db.prepare('SELECT owner_id FROM ownerships WHERE agent_uuid=?').get(roleUuid);
    if(!owner)throw fail('ROLE_NOT_OWNED','该角色尚未绑定网站账号。',409);
    if(!viewer?.id||!viewer?.username)throw fail('CHAT_LOGIN_REQUIRED','请先登录官网。',401);
    return withRole(roleFor(owner.owner_id,roleUuid),role=>{const time=now();return signGrant({aud:PROTOCOL,jti:randomUUID(),iat:time,exp:time+60000,scope:'conversation',role,actor:{id:viewer.id,name:viewer.username}},grantKey);});
  },issue(authenticatedOwnerId,roleUuid,scope='manage') {
    if(!['manage','manual'].includes(scope))throw fail('SCOPE_INVALID','授权范围必须是 manage 或 manual。',400);
    return withRole(roleFor(authenticatedOwnerId,roleUuid),role=>{const time=now();return signGrant({aud:PROTOCOL,jti:randomUUID(),iat:time,exp:time+60000,scope,role},grantKey);});
  }};
}
