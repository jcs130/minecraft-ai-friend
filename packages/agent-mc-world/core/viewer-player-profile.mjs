import {Buffer} from 'node:buffer';
import {minecraftTextureHash} from './viewer-item-profile.mjs';
/** Only texture data actually delivered on this connection, never a name lookup. */
export function playerSkinTexture(player){
  let skin=player?.skinData;
  if(!skin?.url){
    const property=Array.isArray(player?.properties)?player.properties.slice(0,64).find(p=>p?.name==='textures'):null;
    const value=property?.value;
    if(typeof value!=='string'||value.length>16384||!value.length||!/^[A-Za-z0-9+/]*={0,2}$/.test(value))return null;
    try{const decoded=JSON.parse(Buffer.from(value,'base64').toString('utf8'));const texture=decoded?.textures?.SKIN;
      skin=texture&&{url:texture.url,model:texture.metadata?.model};}catch{return null;}
  }
  const hash=minecraftTextureHash(skin?.url);
  return hash?{hash,model:skin.model==='slim'?'slim':'classic'}:null;
}
