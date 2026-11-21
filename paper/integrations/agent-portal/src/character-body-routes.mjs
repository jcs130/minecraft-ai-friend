const base = '/api/v1/character-bodies';
const id = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;
const kinds = new Set(['mineflayer', 'numen', 'maid', 'villager']);
const states = new Set(['ready', 'switching', 'recovery_required']);
const results = new Set(['completed', 'blocked', 'switching', 'recovery_required']);
const phases = new Set(['releasing', 'acquiring', 'completed', 'reconciled']);
const reasons = new Set(['SOURCE_NOT_READY', 'TARGET_NOT_READY', 'SOURCE_RELEASE_UNCONFIRMED', 'TARGET_ACQUIRE_UNCONFIRMED', 'SERVICE_RESTART', 'ORIGINAL_RECEIPTS_CONFIRMED']);
const failures = {
  BODY_HANDOFF_NOT_FOUND: [404, '未找到这个可管理的角色。'],
  BODY_HANDOFF_REQUEST_NOT_FOUND: [404, '未查到这笔换身请求。请核对原请求编号。'],
  BODY_HANDOFF_STALE: [409, '角色状态已变化，请刷新身体列表。'],
  BODY_HANDOFF_BUSY: [409, '已有换身请求进行中，请查看原请求。'],
  BODY_HANDOFF_TARGET_UNAVAILABLE: [409, '这个身体当前不可用，请刷新可选身体。'],
  BODY_HANDOFF_REQUEST_CONFLICT: [409, '这个请求编号已用于另一项操作，请查看原请求。'],
  BODY_HANDOFF_INVALID_ID: [400, '角色或请求编号无效。'],
  BODY_HANDOFF_INVALID: [400, '请选择可用身体并提供当前控制版本。'],
  BODY_HANDOFF_DISABLED: [503, '当前服务器尚未启用角色换身。'],
  BODY_HANDOFF_UNAVAILABLE: [503, '换身服务暂不可用。已提交的操作请按原编号查询。'],
  BODY_HANDOFF_INVALID_RESPONSE: [502, '无法核实这笔回执，请按原请求编号查询。'],
};
function failure(reason) {
  const [status, message] = failures[reason];
  return Object.assign(new Error(message), {status, reason});
}
const validId = value => typeof value === 'string' && id.test(value);
const generation = value => Number.isSafeInteger(value) && value >= 1;

function state(row, characterId) {
  if (row?.characterId !== characterId || !states.has(row.status) || !generation(row.generation)
      || !(kinds.has(row.activeKind) || (row.activeKind === null && row.status !== 'ready'))
      || !Array.isArray(row.targetKinds) || row.targetKinds.some(k => !kinds.has(k) || k === row.activeKind)
      || (row.pendingRequestId != null && !validId(row.pendingRequestId))) {
    throw failure('BODY_HANDOFF_INVALID_RESPONSE');
  }
  return {characterId, activeKind:row.activeKind, targetKinds:[...new Set(row.targetKinds)], generation:row.generation,
    status:row.status, pendingRequestId:row.pendingRequestId ?? null, autonomous:row.autonomous === true};
}
function receipt(row, {characterId, requestId, targetKind}) {
  if (row?.characterId !== characterId || row.requestId !== requestId || !kinds.has(row.targetKind)
      || (targetKind && row.targetKind !== targetKind) || !(row.activeKind === null || kinds.has(row.activeKind))
      || !generation(row.generation) || !results.has(row.status) || !phases.has(row.phase)) {
    throw failure('BODY_HANDOFF_INVALID_RESPONSE');
  }
  if (row.status === 'completed' && (!['completed','reconciled'].includes(row.phase) || row.activeKind !== row.targetKind)) {
    throw failure('BODY_HANDOFF_INVALID_RESPONSE');
  }
  return {characterId, requestId, targetKind:row.targetKind, status:row.status, phase:row.phase, generation:row.generation,
    activeKind:row.activeKind, reason:reasons.has(row.reason) ? row.reason : null};
}

async function backend(call) {
  try { return await call(); }
  catch (error) {
    const code = error?.code ?? error?.reason;
    throw failure(Object.hasOwn(failures, code) ? code : 'BODY_HANDOFF_UNAVAILABLE');
  }
}

/** The portal owns the website identity check. The coordinator owns each physical handoff. */
export async function characterBodyRoutes({req, res, pathname, browserAuth, respond, jsonBody, residents, provider, ownedPlayers, characterHistory, characterDevices}) {
  if (pathname !== base && !pathname.startsWith(base + '/')) return false;
  const desktop = !!req.headers.authorization;
  const owner = desktop ? residents.bodyViewOwner(req) : browserAuth(req).owner;
  res.setHeader('Cache-Control', 'private, no-store');
  const roles = [...residents.roles.values()]
    .filter(role => (!role.fresh || role.ready) && residents.owns(owner.id, role))
    .map(role => ({...role, owns:() => (!role.fresh || role.ready) && residents.owns(owner.id, role)}));
  const playerRoles = provider && ownedPlayers ? await ownedPlayers(owner) : [];
  for (const player of playerRoles) {
    if (!roles.some(role => role.characterId === player.characterId)) roles.push(player);
  }
  if (pathname === base && req.method === 'GET') {
    const eligible = [];
    if (provider) {
      for (const role of roles) {
        let row;
        try { row = await backend(() => provider.current(role.characterId, {ownerId:role.ownerGameId})); }
        catch (error) {
          if (error.reason === 'BODY_HANDOFF_NOT_FOUND') continue;
          throw error;
        }
        if (role.owns()) {
          const devicePairing = !desktop && await characterDevices?.browserAvailable(req, role);
          eligible.push({role, current:{...state(row, role.characterId), name:role.name, ...(devicePairing ? {devicePairing:true} : {})}});
        }
      }
    }
    const characters = eligible.filter(({role}) => role.owns()).map(({current}) => current);
    if (desktop) residents.bodyViewOwner(req);
    respond(res, 200, {available:!!provider, characters});
    return true;
  }
  const parts = pathname.slice(base.length + 1).split('/');
  if (req.method === 'GET' && parts.length === 2 && parts[0] === 'catalog' && validId(parts[1])) {
    const requested = parts[1];
    if (!provider) throw failure('BODY_HANDOFF_NOT_FOUND');
    let role = roles.find(candidate => candidate.characterId === requested && candidate.owns());
    if (!role && characterHistory && !desktop) {
      const resolved = await characterHistory.resolveCatalog(requested, owner.id);
      role = roles.find(candidate => candidate.characterId === resolved && candidate.owns());
    }
    if (!role) throw failure('BODY_HANDOFF_NOT_FOUND');
    const status = state(await backend(() => provider.current(role.characterId, {ownerId:role.ownerGameId})), role.characterId);
    if (!role.owns()) throw failure('BODY_HANDOFF_NOT_FOUND');
    if (desktop) residents.bodyViewOwner(req);
    if (role.characterId !== requested) {
      res.writeHead(307, {Location:`${base}/catalog/${encodeURIComponent(role.characterId)}`});
      res.end();
      return true;
    }
    respond(res, 200, {...status, name:role.name});
    return true;
  }
  const [characterId, action, requestId] = parts;
  if (action === 'device' && parts.length === 2 && req.method === 'POST' && validId(characterId)) {
    if (desktop) throw Object.assign(new Error('请登录官网授权或撤销设备接力。'),
      { status:403, reason:'DEVICE_BROWSER_REQUIRED',expose:true });
    const role = roles.find(candidate => candidate.characterId === characterId && candidate.owns());
    if (!role) throw failure('BODY_HANDOFF_NOT_FOUND');
    const result = await characterDevices.authorize(req,role,await jsonBody(req,1024));
    respond(res,200,result);
    return true;
  }
  const read = parts.length === 3 && req.method === 'GET' && validId(requestId);
  const write = parts.length === 2 && req.method === 'POST';
  if (action !== 'switch' || !validId(characterId) || (!read && !write)) throw failure('BODY_HANDOFF_NOT_FOUND');
  const role = roles.find(r => r.characterId === characterId);
  if (!role) throw failure('BODY_HANDOFF_NOT_FOUND');
  if (!provider) throw failure('BODY_HANDOFF_DISABLED');
  const auth = {ownerId:role.ownerGameId};
  let request = {characterId, requestId};
  if (write) {
    const body = await jsonBody(req, 1024);
    if (!body || typeof body !== 'object' || Object.keys(body).sort().join(',') !== 'expectedGeneration,requestId,targetKind' || !validId(body.requestId)
        || !kinds.has(body.targetKind) || !generation(body.expectedGeneration)
        || body.expectedGeneration >= Number.MAX_SAFE_INTEGER) throw failure('BODY_HANDOFF_INVALID');
    request = {characterId, requestId:body.requestId, targetKind:body.targetKind, expectedGeneration:body.expectedGeneration};
  }
  if (!role.owns()) throw failure('BODY_HANDOFF_NOT_FOUND');
  const row = await backend(() => read ? provider.lookup(request, auth) : provider.switchBody(request, auth));
  if (!role.owns()) throw failure('BODY_HANDOFF_NOT_FOUND');
  const verified = receipt(row, request);
  if (desktop) residents.bodyViewOwner(req);
  respond(res, write && verified.status === 'switching' ? 202 : 200, verified);
  return true;
}
