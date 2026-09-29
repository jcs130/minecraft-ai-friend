const PLAYER = /^[A-Za-z0-9_.-]{1,32}$/;
const ITEM = /^minecraft:[a-z0-9_]+$/;
const NONCE = /^[a-f0-9]{16}$/;

export function parseCreationDecision(text) {
  if (typeof text !== 'string' || text.length > 600) throw new Error('invalid Goddess decision length');
  const value = JSON.parse(text.trim());
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid Goddess decision');
  const message = typeof value.message === 'string'
    ? value.message.replace(/[\x00-\x1f§]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100)
    : '';
  if (value.decision === 'decline') {
    if (!message) throw new Error('decline needs a player reply');
    return { decision: 'decline', message };
  }
  if (value.decision !== 'approve' || !ITEM.test(value.item)
      || !Number.isInteger(value.amount) || value.amount < 1 || value.amount > 16) {
    throw new Error('invalid Goddess approval');
  }
  return { decision: 'approve', item: value.item, amount: value.amount, message };
}

export function giftCommand(nonce, player, decision) {
  if (!NONCE.test(nonce) || !PLAYER.test(player) || decision.decision !== 'approve'
      || !ITEM.test(decision.item) || !Number.isInteger(decision.amount)
      || decision.amount < 1 || decision.amount > 16) throw new Error('invalid gift command data');
  return `/mycli admin gift ${nonce} ${player} ${decision.item} ${decision.amount}`;
}

export function giftAck(text, nonce) {
  if (!NONCE.test(nonce)) throw new Error('invalid gift nonce');
  const match = String(text).match(new RegExp(`(?:^|\\s)QDJ-GIFT ${nonce} (OK|FAIL)(?: ([a-z-]+))?(?:$|\\s)`));
  return match ? { ok: match[1] === 'OK', reason: match[2] ?? '' } : null;
}
