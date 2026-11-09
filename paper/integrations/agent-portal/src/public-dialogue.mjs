// Publication policy for game speech, never a dump of command/authentication
// logs. Filter before persistence and again at the cloud trust boundary.
const sensitive = /(?:MC_AUTH_|^MC_[A-Z_]+\s*\{|\/(?:[\w-]+:)?(?:login|register|changepassword|changepass|password|2fa|totp|auth)\b|password|passwd|api[ _-]?key|authorization|bearer\s|(?:sk[-_]|(?:srv|obs|pub|pat)_)[A-Za-z0-9_-]{16}|eyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]+\.|密码|口令|验证码|密钥|令牌)/i;
export function publicDialogueText(value, maximum = 2000) {
  if (typeof value !== 'string' || value.length > maximum || /[\r\n\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value)) return null;
  const clean = value.replace(/§[0-9a-fk-or]/gi, '').trim();
  return clean && !sensitive.test(clean) ? clean : null;
}

const maidSource='minecraft.maid-nearby-chat';
const dimensions={'minecraft:overworld':'主世界','minecraft:the_nether':'下界','minecraft:the_end':'末地','minecraft:aincrad':'艾恩葛朗特'};
export function publicDialogueSource(row){
  if(!row||!publicDialogueText(row.body)||!publicDialogueText(row.title,400))return false;
  if(row.source==='minecraft.public-chat')return true;
  return row.source===maidSource&&/^.{1,32}（女仆·[^\r\n（）]{1,96}） 说$/u.test(row.title);
}
function maidDialogue(content,occurredAt){
  if(!content.startsWith('[QiandengjiMaidBridge] QD_PUBLIC_MAID '))return null;
  let row;try{row=JSON.parse(content.slice('[QiandengjiMaidBridge] QD_PUBLIC_MAID '.length));}catch{return null;}
  if(row?.schemaVersion!==1||!Number.isSafeInteger(row.delivered)||row.delivered<1||row.delivered>256
    ||!/^\.?[A-Za-z0-9_]{1,16}$/.test(row.ownerName||'')||!(/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/).test(row.maidUuid||'')
    ||!(/^[A-Za-z0-9_-]{1,64}$/).test(row.operationId||'')||typeof row.name!=='string'||row.name.length>32
    ||row.name!==publicDialogueText(row.name,32)||/[（）]/.test(row.name)
    ||!(/^[a-z0-9_.-]+:[a-z0-9_./-]{1,80}$/).test(row.dimension||''))return null;
  const body=publicDialogueText(row.text,1000);if(!body)return null;
  const title=row.name+'（女仆·'+(dimensions[row.dimension]||row.dimension)+'） 说';
  return{kind:'chat',playerName:row.ownerName,title,body,occurredAt,precision:'second',source:maidSource,eventIdentity:'maid:'+row.maidUuid+':'+row.operationId};
}

// Actual Paper vanilla or the deployed official EssentialsXChat envelopes. A forged join line inside a chat
// stays speech, titles/UUIDs are never inferred from its content. Whisper
// commands are not accepted: a command log is not proof it was delivered.
export function parsePublicDialogue(line, date) {
  // Youer's asynchronous chat logger has an empty thread label. Accept that
  // exact envelope as well; the speech grammar below still excludes commands,
  // whispers, plugin messages and arbitrary log output.
  // Youer's native plugin logger places the plugin name before the colon;
  // Paper's Bukkit logger places it in the content. Admit only this bridge.
  const maidEnvelope=/^\[(\d{2}:\d{2}:\d{2})\] \[Server thread\/INFO\] \[QiandengjiMaidBridge\]: QD_PUBLIC_MAID (?<maidJson>.+)$/.exec(line);
  const envelope=/^\[(\d{2}:\d{2}:\d{2})\] \[(?:Server thread|Async Chat Thread - #\d+)?\/INFO\]: (?:\[Not Secure\] )?(?<content>.+)$/.exec(line)||maidEnvelope;
  if(!envelope)return null;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return null;
  const observed=Date.parse(`${date}T${envelope[1]}+08:00`);if(!Number.isFinite(observed))return null;
  // Companion messages are emitted by the installed bridge only after nearby
  // delivery. ownerName is the visibility association, never the speaking role.
  const maid=maidDialogue(maidEnvelope?'[QiandengjiMaidBridge] QD_PUBLIC_MAID '+maidEnvelope.groups.maidJson:envelope.groups.content,observed);if(maid)return maid;
  if(maidEnvelope)return null;
  const match = /^<(?<name>\.?[A-Za-z0-9_]{1,16})> (?<body>.+)$/.exec(envelope.groups.content)
    || /^\[(?<channel>附近|大喇叭)\]\s*\[(?<world>[^\[\]\r\n]{1,64})\] (?<name>\.?[A-Za-z0-9_]{1,16}): (?<body>.+)$/.exec(envelope.groups.content);
  if (!match || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const body = publicDialogueText(match.groups.body), occurredAt = Date.parse(`${date}T${envelope[1]}+08:00`);
  if (!body || !Number.isFinite(occurredAt)) return null;
  const context=match.groups.channel?`（${match.groups.channel}·${match.groups.world}）`:'';
  const title=publicDialogueText(match.groups.name+context+' 说',400);if(!title)return null;
  return {kind:'chat', playerName:match.groups.name, title, body, occurredAt, precision:'second', source:'minecraft.public-chat'};
}
