import path from 'node:path';
import {pathToFileURL} from 'node:url';

// This is presence evidence only: intersect Geyser's authenticated Bedrock
// sessions with Paper's exact current UUIDs. A dotted name or stored UUID alone
// never grants observation, Java login, website ownership, or game permissions.
export function bedrockPresence(geyserReply, paperReply, {usernamePrefix='.',replaceSpaces=true}={}) {
  if(usernamePrefix!=='.')throw Error('BEDROCK_PREFIX_UNSUPPORTED');
  const clean=String(geyserReply).replace(/§[0-9a-fk-or]/gi,'').trim();
  const match=/^(?:Online players|在线玩家)\s*\((\d+)\):\s*(.*)$/i.exec(clean);
  if(!match || Number(match[1])>256) return [];
  const names=match[2]?match[2].split(/,\s*/):[];
  if(names.length!==Number(match[1]))return [];
  const roster=new Map();
  for(const row of String(paperReply).matchAll(/(?:^|[:,]\s*)(\.?[A-Za-z0-9_]{1,16}) \(([0-9a-f-]{36})\)/gi)) {
    if(/^00000000-0000-0000-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(row[2]) && !/^0{8}-0{4}-0{4}-0{4}-0{12}$/.test(row[2]))roster.set(row[1],row[2].toLowerCase());
  }
  return [...new Set(names)].flatMap(gamertag=>{
    const name=usernamePrefix+(replaceSpaces?gamertag.replaceAll(' ','_'):gamertag);
    if(!/^\.[A-Za-z0-9_]{1,16}$/.test(name)||!roster.has(name))return [];
    return [{name,playerUuid:roster.get(name),source:'Geyser.live-session'}];
  });
}
export async function readBedrockPresence(settings, commandOverride) {
  if(!commandOverride && !path.isAbsolute(settings.rconClientModule||''))throw Error('BEDROCK_RCON_MODULE_INVALID');
  const command=commandOverride||(await import(pathToFileURL(settings.rconClientModule).href)).command;
  const geyser=await command('geyser list',3000),paper=await command('minecraft:list uuids',3000);
  return {observedAt:Date.now(),players:bedrockPresence(geyser,paper,settings)};
}
