// Publication policy for game speech, never a dump of command/authentication
// logs. Filter before persistence and again at the cloud trust boundary.
const sensitive = /(?:MC_AUTH_|^MC_[A-Z_]+\s*\{|\/(?:[\w-]+:)?(?:login|register|changepassword|changepass|password|2fa|totp|auth)\b|password|passwd|api[ _-]?key|authorization|bearer\s|(?:sk[-_]|(?:srv|obs|pub|pat)_)[A-Za-z0-9_-]{16}|eyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]+\.|密码|口令|验证码|密钥|令牌)/i;
export function publicDialogueText(value, maximum = 2000) {
  if (typeof value !== 'string' || value.length > maximum || /[\r\n\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value)) return null;
  const clean = value.replace(/§[0-9a-fk-or]/gi, '').trim();
  return clean && !sensitive.test(clean) ? clean : null;
}

// Actual Paper vanilla chat envelopes only. A forged join line inside a chat
// stays speech, titles/UUIDs are never inferred from its content. Whisper
// commands are not accepted: a command log is not proof it was delivered.
export function parsePublicDialogue(line, date) {
  const match = /^\[(\d{2}:\d{2}:\d{2})\] \[(?:Server thread|Async Chat Thread - #\d+)\/INFO\]: (?:\[Not Secure\] )?<(?<name>\.?[A-Za-z0-9_]{1,16})> (?<body>.+)$/.exec(line);
  if (!match || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const body = publicDialogueText(match.groups.body), occurredAt = Date.parse(`${date}T${match[1]}+08:00`);
  if (!body || !Number.isFinite(occurredAt)) return null;
  return {kind:'chat', playerName:match.groups.name, title:match.groups.name+' 说', body, occurredAt, precision:'second', source:'minecraft.public-chat'};
}
