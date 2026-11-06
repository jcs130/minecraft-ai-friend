// Offline only. Never prints packet bytes, decoded values, file paths or errors.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { observationFailure,observationPacketDecoder,observationPacketNames } from './worker.mjs';

const require=createRequire(import.meta.url),protocol=require('minecraft-protocol');
const protocolRequire=createRequire(require.resolve('minecraft-protocol'));
const registry=protocolRequire('minecraft-data')('1.21.1');
const stateOptions=state=>({version:'1.21.1',state,isServer:false,noErrorLogging:true});
const names=observationPacketNames(registry);

function inspect(bytes,state){
 const decoder=observationPacketDecoder({[state]:protocol.createDeserializer(stateOptions(state))},names);
 try{decoder.decode(bytes,state);return{outcome:'decoded',packet:decoder.lastDecoded()};}
 catch(error){return{outcome:'error',type:observationFailure('scene',error).type,packet:decoder.failure(error)};}
}

async function readPrivateFile(file){
 if(!path.isAbsolute(file))throw Error('INVALID_INPUT');
 const handle=await fs.open(file,'r');
 try{
  const info=await handle.stat();
  if(!info.isFile()||info.size<1||info.size>2*1024*1024)throw Error('INVALID_INPUT');
  const bytes=Buffer.alloc(info.size),{bytesRead}=await handle.read(bytes,0,bytes.length,0);
  if(bytesRead!==bytes.length)throw Error('INVALID_INPUT');
  return bytes;
 }finally{await handle.close();}
}

try{
 const args=process.argv.slice(2);
 if(args.length===1&&args[0]==='--synthetic'){
  const serializer=protocol.createSerializer({...stateOptions('play'),isServer:true});
  const valid=serializer.createPacketBuffer({name:'entity_metadata',params:{entityId:1,metadata:[{key:0,type:'string',value:'x'.repeat(36)}]}});
  const invalid=Buffer.from(valid);invalid[4]=38;
  const good=inspect(valid,'play'),bad=inspect(invalid,'play');
  if(valid.length!==42||good.outcome!=='decoded'||bad.outcome!=='error'||bad.type!=='PartialReadError')throw Error('SYNTHETIC_CHECK_FAILED');
  process.stdout.write(JSON.stringify({mode:'synthetic',minecraftVersion:'1.21.1',valid:good,invalid:bad})+'\n');
 }else if(args.length===4&&args[0]==='--file'&&args[2]==='--state'&&['play','configuration'].includes(args[3])){
  process.stdout.write(JSON.stringify({mode:'local_file',minecraftVersion:'1.21.1',result:inspect(await readPrivateFile(args[1]),args[3])})+'\n');
 }else throw Error('INVALID_INPUT');
}catch{
 // Neither the path nor a filesystem/parser exception may reach public logs.
 process.stderr.write('OBSERVER_REPLAY_FAILED\n');process.exitCode=1;
}
