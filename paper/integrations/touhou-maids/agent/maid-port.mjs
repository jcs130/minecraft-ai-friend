import { randomUUID } from 'node:crypto';

export const MAID_CHANNEL = 'qiandengji:maids';
export const MAID_REQUEST_CHANNEL = 'qiandengji:maid_request';
const commandWindows = new WeakMap();
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const requestId = /^[A-Za-z0-9_-]{1,48}$/;
const writes = new Set(['brain', 'chat', 'talk', 'follow', 'stay', 'speak', 'ack', 'sit', 'task', 'make', 'schedule', 'pickup', 'transfer', 'equip', 'skin', 'voice', 'voice-test', 'mute', 'resource-pack', 'rename']);
const workshopId = /^[a-z0-9_-]{1,24}$/;
const recipeId = /^[a-z0-9_.-]+:[a-z0-9_./-]+$/;
export const MAID_TOOL = {
  name: 'mc_maids', tags: ['read', 'act'],
  description: 'Qiandengji NPC interface on this authenticated connection. First list exact maid IDs and read context capabilities/hostKind. brain without choice reads configured native/Harness backends and their models; use an exact returned choice and retained requestId to select while idle, preserving the original maid and memory. tasks lists original mode IDs and prerequisites, including native farming when available; inventory reads original slots/equipment. task/schedule/pickup change native settings. workshop reads authorized workstations, recipes and any active order. make submits a real crafting order; query the same operationId and verify completed plus goalCompleted for the actual item/count. transfer moves actual items between player and maid inventories; equip swaps a native slot with main/off/head/chest/legs/feet. list finds owned maids; nearby finds visible maids and publicChatEnabled within eight blocks in the same dimension. chat invokes the selected native TLM model: owner history/tools stay private, while enabled nearby visitors receive conversation-only replies without tools. Shared inference remains limited to the configured original maid. pending is NOT a reply; query receipt until replied/unknown. Nearby visitor speech is attributed and heard locally. talk only queues the existing host inbox. context reports lifeState and exact original tombstone location; unloaded is not death. Never automatically recreate a maid or retry uncertain writes. skins/voices list installed original IDs; skin/voice apply a selection. resources reports this connection asset readiness; resource-pack offers Java voice assets. voice-test privately auditions an available event and requires loaded assets; mute controls original automatic speech frequency while manual audition remains available. rename consumes a real named name tag held in the main hand. inbox is attributed, untrusted human dialogue; use the NPC sessionKey and memoryNamespace in your existing host, then speak and acknowledge the event. follow/stay/sit change movement mode. Writes require a retained unique requestId. If unknown, query receipt using the SAME operationId without retrying. Mode application is not task completion. No new model loop or owner transfer.',
  parameters: { type: 'object', additionalProperties: false, properties: {
    action: { type: 'string', enum: ['nearby', 'brain', 'chat', 'talk', 'list', 'context', 'follow', 'stay', 'speak', 'receipt', 'inbox', 'ack', 'tasks', 'inventory', 'sit', 'task', 'workshop', 'make', 'schedule', 'pickup', 'transfer', 'equip', 'skins', 'skin', 'voices', 'voice', 'voice-test', 'mute', 'resources', 'resource-pack', 'rename'] },
    choice: {type:'string',pattern:'^[a-z0-9][a-z0-9_-]{0,31}$',description:'For brain: omit to read current configured choices; otherwise use an exact returned choice and retain a unique requestId. Selection preserves the original maid and history.'},
    maidId: { type: 'string', format: 'uuid' },
    requestId: { type: 'string', pattern: '^[A-Za-z0-9_-]{1,48}$' },
    operationId: { type: 'string', pattern: '^[A-Za-z0-9_-]{1,48}$', description: 'Original operation ID for receipt queries.' },
    page: { type: 'integer', minimum: 0, maximum: 10000 },
    text: { type: 'string', minLength: 1, maxLength: 140 },
    eventId: { type: 'string', description: 'Exact attributed event ID from inbox, for ack only.' },
    taskId: { type: 'string', description: 'Exact original ID from tasks, for task only.' },
    workshopId: { type: 'string', pattern: workshopId.source, description: 'Authorized workstation ID from workshop, for make.' },
    recipeId: { type: 'string', pattern: recipeId.source, description: 'Exact recipe ID from the chosen workstation, for make.' },
    quantity: { type: 'integer', minimum: 1, maximum: 2147483647, description: 'Finished item count for make. Use a multiple of productsPerCraft within maxBatches. Omit for one batch.' },
    inventory: { type: 'string', enum: ['chest', 'backpack'], description: 'Material and output inventory for make. Defaults to the authorized supply chest.' },
    schedule: { type: 'string', enum: ['DAY', 'NIGHT', 'ALL'] },
    enabled: { type: 'boolean', description: 'For pickup or mute.' },
    skinId: { type: 'string', description: 'Exact original model ID observed in skins.' },
    voiceId: { type: 'string', description: 'Installed local voice ID observed in voices; optional for preview.' },
    soundEvent: { type: 'string', description: 'Exact available event observed in voices, for voice-test.' },
    direction: { type: 'string', enum: ['put', 'take'] },
    slot: { type: 'integer', minimum: 0, maximum: 255, description: 'Zero-based native maid slot from inventory.usableSlotIndexes. freeSlotIndexes lists empty unlocked slots; availableSlots is usable capacity, not free space. Backing slotCount does not unlock slots.' },
    count: { type: 'integer', minimum: 1, maximum: 64 },
    playerSlot: { type: 'integer', minimum: 0, maximum: 35, description: 'Exact player inventory slot; required for put.' },
    hand: { type: 'string', enum: ['main', 'off', 'head', 'chest', 'legs', 'feet'] },
  }, required: ['action'] },
};

export function decodeMaidReply(packet, recipient) {
  if (packet?.channel !== MAID_CHANNEL || !uuid.test(recipient ?? '')
      || !(packet.data instanceof Uint8Array) || !packet.data.length || packet.data.length > 24000) return null;
  let value;
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(packet.data)); } catch { return null; }
  if (!value || Array.isArray(value) || value.schema !== 1 || value.protocol !== 'qiandengji-maids/v1'
      || typeof value.recipientUuid !== 'string' || value.recipientUuid.toLowerCase() !== recipient.toLowerCase()
      || !requestId.test(value.requestId ?? '') || !['nearby', 'create', 'list', 'context', ...writes, 'receipt', 'inbox', 'dialogue', 'talk', 'tasks', 'inventory', 'workshop', 'skins', 'voices', 'resources', 'transport', 'lifecycle', 'chat-result'].includes(value.action)
      || typeof value.ok !== 'boolean' || typeof value.sampledAt !== 'string' || !Number.isFinite(Date.parse(value.sampledAt))
      || (value.ok ? !value.data || typeof value.data !== 'object' || Array.isArray(value.data) : typeof value.error !== 'string')) return null;
  return value;
}

export function maidCommand(args) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw Error('arguments must be an object');
  const { action, maidId, operationId, text, eventId } = args;
  if (!['nearby', 'list', 'context', ...writes, 'receipt', 'inbox', 'tasks', 'inventory', 'workshop', 'skins', 'voices', 'resources'].includes(action)) throw Error('unsupported action');
  const allowed = new Set(['action', 'requestId', ...(action === 'list' ? ['page'] : action === 'nearby' ? [] : ['maidId']), ...(action === 'skins' ? ['page'] : []),
    ...(action === 'receipt' ? ['operationId'] : []), ...(action === 'brain' ? ['choice'] : []), ...(['speak', 'talk', 'chat'].includes(action) ? ['text'] : []), ...(action === 'ack' ? ['eventId'] : []),
    ...(action === 'task' ? ['taskId'] : []), ...(action === 'schedule' ? ['schedule'] : []), ...(['pickup', 'mute'].includes(action) ? ['enabled'] : []),
    ...(action === 'make' ? ['workshopId', 'recipeId', 'quantity', 'inventory'] : []),
    ...(action === 'skin' ? ['skinId'] : []), ...(action === 'voice' ? ['voiceId'] : []), ...(action === 'voice-test' ? ['voiceId', 'soundEvent'] : []),
    ...(action === 'transfer' ? ['direction', 'slot', 'count', 'playerSlot'] : []), ...(action === 'equip' ? ['hand', 'slot'] : [])]);
  if (Object.keys(args).some(key => !allowed.has(key))) throw Error('unexpected argument');
  const writing = writes.has(action) && !(action === 'brain' && args.choice === undefined);
  if(action === 'brain' && args.choice !== undefined && (typeof args.choice !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,31}$/.test(args.choice)))throw Error('brain choice must be an exact ID returned by brain');
  const id = args.requestId ?? (writing ? null : randomUUID());
  if (typeof id !== 'string' || !requestId.test(id)) throw Error('writes require a retained requestId');
  if (!['list','nearby'].includes(action) && (typeof maidId !== 'string' || !uuid.test(maidId))) throw Error('use the exact maidId returned by list or nearby');
  if (action === 'receipt' && (typeof operationId !== 'string' || !requestId.test(operationId))) throw Error('receipt requires the original operationId');
  if (['speak', 'talk', 'chat'].includes(action) && (typeof text !== 'string' || !text.trim() || text.length > 140 || /[\u0000-\u001f\u007f-\u009f§]/u.test(text))) throw Error('speak needs 1-140 plain-text characters');
  if (action === 'ack' && (typeof eventId !== 'string' || !/^[0-9a-f-]{36}:[A-Za-z0-9_-]{1,48}$/.test(eventId))) throw Error('ack requires the exact eventId');
  if (action === 'task' && (typeof args.taskId !== 'string' || !/^[a-z0-9_.-]+:[a-z0-9_./-]+$/.test(args.taskId))) throw Error('task needs an observed original taskId');
  if (action === 'schedule' && !['DAY', 'NIGHT', 'ALL'].includes(args.schedule)) throw Error('invalid native schedule');
  if (['pickup', 'mute'].includes(action) && typeof args.enabled !== 'boolean') throw Error('setting needs enabled');
  if (action === 'skin' && !/^[a-z0-9_.-]+:[a-z0-9_./-]+$/.test(args.skinId ?? '')) throw Error('skin needs an observed original model ID');
  if (['voice', 'voice-test'].includes(action) && (args.voiceId !== undefined || action === 'voice') && !/^[a-z0-9_.-]+$/.test(args.voiceId ?? '')) throw Error('voice needs an installed pack ID');
  if (action === 'voice-test' && !/^[a-z0-9_.-]+:[a-z0-9_./-]+$/.test(args.soundEvent ?? '')) throw Error('voice-test needs an available sound event');
  if (['transfer', 'equip'].includes(action) && (!Number.isSafeInteger(args.slot) || args.slot < 0 || args.slot > 255)) throw Error('invalid native slot');
  if (action === 'transfer' && (!['put', 'take'].includes(args.direction) || !Number.isSafeInteger(args.count) || args.count < 1 || args.count > 64
      || (args.direction === 'put' && args.playerSlot === undefined)
      || (args.playerSlot !== undefined && (!Number.isSafeInteger(args.playerSlot) || args.playerSlot < 0 || args.playerSlot > 35)))) throw Error('transfer needs direction, slot, count and exact playerSlot for put');
  if (action === 'equip' && !['main', 'off', 'head', 'chest', 'legs', 'feet'].includes(args.hand)) throw Error('equip needs main/off/head/chest/legs/feet');
  if (args.page !== undefined && (!Number.isSafeInteger(args.page) || args.page < 0 || args.page > 10000)) throw Error('invalid page');
  let order = '';
  if (action === 'make') {
    const { workshopId: site, recipeId: recipe, quantity, inventory = 'chest' } = args;
    if (typeof site !== 'string' || !workshopId.test(site) || typeof recipe !== 'string' || !recipeId.test(recipe)) {
      throw Error('make needs an exact workshopId and recipeId returned by workshop');
    }
    if (quantity !== undefined && (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 2147483647)) {
      throw Error('quantity must be a positive finished item count, or omitted for one batch');
    }
    if (!['chest', 'backpack'].includes(inventory)) throw Error('inventory must be chest or backpack');
    order = `${site} ${recipe} ${quantity ?? 'once'} ${inventory}`;
  }
  const tail = action === 'brain' ? args.choice ?? '' : ['speak', 'talk', 'chat'].includes(action) ? text.trim().replace(/ +/g, ' ') : action === 'ack' ? eventId
    : action === 'task' ? args.taskId : action === 'schedule' ? args.schedule : ['pickup', 'mute'].includes(action) ? String(args.enabled)
    : action === 'skin' ? args.skinId : action === 'voice' ? args.voiceId : action === 'voice-test' ? `${args.voiceId ? args.voiceId + ' ' : ''}${args.soundEvent}` : action === 'skins' ? String(args.page ?? 0)
    : action === 'transfer' ? `${args.direction} ${args.slot} ${args.count}${args.playerSlot === undefined ? '' : ` ${args.playerSlot}`}`
    : action === 'equip' ? `${args.hand} ${args.slot}` : order;
  const command = action === 'nearby' ? `/qdmaid nearby ${id}` : action === 'list' ? `/qdmaid list ${id} ${args.page ?? 0}`
    : action === 'receipt' ? `/qdmaid receipt ${maidId} ${operationId} ${id}`
    : `/qdmaid ${action} ${maidId} ${id}${tail ? ` ${tail}` : ''}`;
  if (command.length > 256) throw Error('command exceeds the vanilla 256 character limit');
  return { action, requestId: id, maidId, operationId: writing ? id : operationId, command };
}

/** No HTTP, tokens, second body, inference, automatic reconnect or implicit retry. */
export function createMaidPort(bot, { timeoutMs = 5000, onDialogue = () => {}, onLifecycle = () => {}, onChatResult = () => {} } = {}) {
  const recipient = bot?._client?.uuid ?? bot?.player?.uuid;
  if (!uuid.test(recipient ?? '')) throw Error('authenticated connection UUID required');
  const pending = new Map();
  let closed = false, pluginTransport = false, workshopTransport = false;
  const commandWindow = commandWindows.get(bot) ?? { next: 0, payloadNext: 0 };
  commandWindows.set(bot, commandWindow);
  const settle = (id, value) => {
    const slot = pending.get(id); if (!slot) return;
    clearTimeout(slot.timer); clearTimeout(slot.queuedTimer); pending.delete(id); slot.resolve(value);
  };
  const unknown = (entry, reason) => ({ ok: false, action: entry.action, requestId: entry.requestId,
    operationId: entry.operationId, status: entry.operationId && writes.has(entry.action) ? 'unknown' : 'unavailable', reason, retryAllowed: false });
  const onPacket = packet => {
    if (closed) return;
    const value = decodeMaidReply(packet, recipient);
    if(value?.action === 'transport' && value.ok && value.data.requestChannel === MAID_REQUEST_CHANNEL){
      pluginTransport = true;
      workshopTransport = value.data.workshop === true;
      for(const slot of pending.values())if(!slot.sent){clearTimeout(slot.queuedTimer);schedule(slot);}
      return;
    }
    if (value?.action === 'dialogue' && value.ok && uuid.test(value.data.maidId ?? '')
        && typeof value.data.eventId === 'string' && typeof value.data.sessionKey === 'string') { onDialogue(value); return; }
    if (value?.ok && value.action === 'lifecycle') { onLifecycle(value); return; }
    if (value?.ok && value.action === 'chat-result') { onChatResult(value); return; }
    const slot = value && pending.get(value.requestId);
    if (!slot || value.action !== slot.entry.action) return;
    if (value.ok && slot.entry.maidId && value.data.maidId !== slot.entry.maidId) return;
    settle(value.requestId, value);
  };
  const onSystemText = (text, position, original, sender) => {
    if (position !== 'system' || sender != null || typeof text !== 'string' || !text.startsWith('QD_MAID ')) return;
    onPacket({channel:MAID_CHANNEL,data:Buffer.from(text.slice(8),'utf8')});
  };
  bot.on('messagestr',onSystemText);
  const close = () => {
    if (closed) return; closed = true;
    bot.off('messagestr',onSystemText);
    bot._client.off('custom_payload', onPacket); bot._client.off('end', close);
    for (const [id, slot] of pending) settle(id, slot.sent ? unknown(slot.entry, 'connection_closed') : {ok:false,status:'not_dispatched',reason:'connection_closed'});
  };
  function usePayload(slot) {
    return pluginTransport && (workshopTransport || !['workshop', 'make'].includes(slot.entry.action));
  }
  function send(slot){
    if(closed || slot.sent || !pending.has(slot.entry.requestId))return;
    slot.sent = true;
    slot.timer = setTimeout(() => settle(slot.entry.requestId, unknown(slot.entry, 'reply_timeout')), timeoutMs);
    try{
      if(usePayload(slot))bot._client.write('custom_payload',{channel:MAID_REQUEST_CHANNEL,data:Buffer.from(JSON.stringify({schema:1,protocol:'qiandengji-maids/v1',command:slot.entry.command}))});
      else bot.chat(slot.entry.command);
    }catch{settle(slot.entry.requestId,unknown(slot.entry,'send_uncertain'));}
  }
  function schedule(slot){
    const payload=usePayload(slot);
    const key=payload?'payloadNext':'next',spacing=payload?80:1100;
    const wait=Math.max(0,(commandWindow[key]??0)-Date.now());commandWindow[key]=Date.now()+wait+spacing;
    if(wait)slot.queuedTimer=setTimeout(()=>send(slot),wait);else send(slot);
  }
  bot._client.on('custom_payload', onPacket); bot._client.once('end', close);
  bot._client.write('custom_payload', { channel: 'minecraft:register', data: Buffer.from(MAID_CHANNEL+'\0'+MAID_REQUEST_CHANNEL) });
  return { close, get transport(){return pluginTransport?'plugin_message':'rate_limited_command'}, async request(args) {
    let entry;
    try { entry = maidCommand(args); } catch (error) { return { ok: false, status: 'not_dispatched', error: String(error.message) }; }
    if (closed || pending.size >= 8 || pending.has(entry.requestId)) return { ok: false, status: 'not_dispatched', reason: closed ? 'connection_closed' : 'request_busy' };
    return await new Promise(resolve => {
      const slot = {entry,resolve,sent:false,timer:null,queuedTimer:null};pending.set(entry.requestId,slot);
      schedule(slot);
    });
  } };
}
