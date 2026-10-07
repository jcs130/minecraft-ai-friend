const PLAYER = /^[A-Za-z0-9_.-]{1,32}$/;
const ITEM = /^minecraft:[a-z0-9_]+$/;
const GIFT = /^[a-z0-9_]{1,48}$/;
const NONCE = /^[a-f0-9]{16}$/;
const HASH = /^[a-f0-9]{64}$/;
const STATEFUL = new Set(['enchanted_book', 'potion', 'splash_potion', 'lingering_potion',
  'tipped_arrow', 'written_book', 'filled_map', 'knowledge_book', 'firework_rocket', 'firework_star', 'player_head']
  .map(id => `minecraft:${id}`));
const plainObject = value => value && typeof value === 'object' && !Array.isArray(value);

export function validateApproval(value) {
  if (!plainObject(value) || value.decision !== 'approve' || !Number.isInteger(value.amount)
      || value.amount < 1 || value.amount > 16) throw new Error('invalid Goddess approval');
  if (Object.keys(value).some(key => !['decision', 'item', 'gift', 'amount', 'message'].includes(key)))
    throw new Error('unsupported gift properties');
  const hasItem = Object.hasOwn(value, 'item'), hasGift = Object.hasOwn(value, 'gift');
  if (hasItem === hasGift || hasItem && (typeof value.item !== 'string' || !ITEM.test(value.item) || STATEFUL.has(value.item))
      || hasGift && (typeof value.gift !== 'string' || !GIFT.test(value.gift))) throw new Error('gift needs a valid catalog preset or plain item');
  return value;
}

export function parseCreationDecision(text) {
  if (typeof text !== 'string' || text.length > 600) throw new Error('invalid Goddess decision length');
  const value = JSON.parse(text.trim());
  if (!plainObject(value)) throw new Error('invalid Goddess decision');
  const message = typeof value.message === 'string'
    ? value.message.replace(/[\x00-\x1f§]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100) : '';
  if (['reply', 'decline'].includes(value.decision)) {
    if (!message || Object.keys(value).some(key => !['decision', 'message'].includes(key)))
      throw new Error('invalid Goddess reply');
    return { decision: value.decision, message };
  }
  validateApproval(value);
  return { decision: 'approve', ...(Object.hasOwn(value, 'gift') ? { gift: value.gift } : { item: value.item }),
    amount: value.amount, message };
}

export function giftCommand(nonce, player, decision, recipeHash) {
  validateApproval(decision);
  if (!NONCE.test(nonce) || !PLAYER.test(player)) throw new Error('invalid gift target/request');
  if (decision.gift && !HASH.test(recipeHash)) throw new Error('catalog recipe hash required');
  return `mycli admin gift ${nonce} ${player} ${decision.gift ? `gift:${decision.gift}` : decision.item} ${decision.amount}`
    + (decision.gift ? ` ${recipeHash}` : '');
}

export function giftAck(text, nonce) {
  if (!NONCE.test(nonce)) throw new Error('invalid gift nonce');
  const match = String(text).match(new RegExp(`(?:^|\\s)QDJ-GIFT ${nonce} (OK|FAIL)(?: ([a-z-]+))?(?:$|\\s)`));
  return match ? { ok: match[1] === 'OK', reason: match[2] ?? '' } : null;
}
