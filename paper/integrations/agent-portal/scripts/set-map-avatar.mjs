import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {validateMapAvatar} from '../src/world-map.mjs';
// Reuses the private map publisher config. Never put the bearer token on the command line.
const [configFile,uuid,file]=process.argv.slice(2);
if(!configFile||!file||! /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(uuid||''))throw Error('Usage: node scripts/set-map-avatar.mjs PRIVATE_CONFIG PLAYER_UUID PUBLIC_PNG');
const config=JSON.parse(await fs.readFile(configFile,'utf8'));
const bytes=validateMapAvatar(await fs.readFile(file));
const base=new URL(config.endpoint);if(base.protocol!=='https:'||base.username||base.password)throw Error('HTTPS_REQUIRED');
const token=(await fs.readFile(config.tokenFile,'utf8')).trim();if(!/^srv_[A-Za-z0-9_-]{43}$/.test(token))throw Error('MAP_CREDENTIAL_FORMAT');
const response=await fetch(new URL('/api/v1/internal/world-map/avatars/'+uuid,base),{method:'PUT',redirect:'error',headers:{authorization:'Bearer '+token,'content-type':'image/png','x-content-sha256':createHash('sha256').update(bytes).digest('hex')},body:bytes,signal:AbortSignal.timeout(15000)});
const result=await response.json();if(!response.ok)throw Error(result.error?.reason||'MAP_AVATAR_UPLOAD_FAILED');
console.log(JSON.stringify(result));
